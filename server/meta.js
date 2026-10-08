// Мета-игра: инвентарь и экипировка, соединение (merge), руны, склад, магазины, призыв предметов,
// рынок и аукцион между игроками (с комиссией), батл-пасс, подписка, реклама, PvP-арена.
// Все действия приходят по сокету: socket.emit('act', { op, ... }, ack)
const fs = require('fs');
const path = require('path');
const I = require('./items');

const MARKET_FILE = path.join(__dirname, '..', 'data', 'market.json');
const DAY = 864e5;
const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

// ---------- Баланс монетизации ----------
const SHOP = {
  bag: 60, bagSub: 80, wh: 150,
  marketFee: 0.10, marketFeeSub: 0.05, auctionFee: 0.12, marketSlots: 5, marketSlotsSub: 10, auctionSlots: 3,
  itemSpin: { price: 15, price10: 135 }, // Telegram Stars
  freeItemSpins: 1, freeItemSpinsSub: 2, // бесплатно каждый день
  pity: 50, // гарантированный легендарный предмет каждые 50 круток
  pass: { price: 300, levels: 30, xpPerLevel: 100, days: 30 },
  sub: { price: 250, days: 30, xpBonus: 0.25, goldBonus: 0.25 },
  ads: { perDay: 5, cooldownMs: 30000 },
  arena: { perDay: 5, perDaySub: 8 },
};
// Веса редкостей в призыве предметов (обычных нет)
const ITEM_GACHA = { rare: 62, epic: 29, legendary: 7.5, mythic: 1.5 };

const isSub = (pr) => (pr.subUntil || 0) > Date.now();
const bagSize = (pr) => (isSub(pr) ? SHOP.bagSub : SHOP.bag);

// ---------- Батл-пасс ----------
const passSeason = () => Math.floor(Date.now() / (SHOP.pass.days * DAY));
const PASS_REWARDS = Array.from({ length: SHOP.pass.levels }, (_, i) => {
  const lvl = i + 1;
  const free = lvl % 5 === 0 ? { itemSpins: 1 } : { gold: 80 + lvl * 20 };
  const RARE = { 5: 'rare', 10: 'epic', 15: 'epic', 20: 'legendary', 25: 'legendary', 30: 'mythic' };
  const MATS = { 3: { scrollE: 1 }, 7: { ore: 20, ess: 10 }, 9: { scrollE: 1 }, 12: { core: 2 }, 17: { scrollE: 2 }, 21: { scrollL: 1 }, 24: { core: 3 }, 27: { scrollL: 1 }, 29: { scrollM: 1 } };
  const prem = RARE[lvl] ? { item: RARE[lvl] } : MATS[lvl] ? { mats: MATS[lvl] } : lvl % 2 ? { gold: 250 + lvl * 50 } : { itemSpins: 1 };
  return { lvl, free, prem };
});
function passOf(pr) {
  const s = passSeason();
  if (!pr.pass || pr.pass.season !== s) pr.pass = { season: s, xp: 0, premium: false, free: [], prem: [] };
  return pr.pass;
}
function addPassXp(pr, n) {
  const ps = passOf(pr);
  ps.xp = Math.min(SHOP.pass.levels * SHOP.pass.xpPerLevel, ps.xp + n);
}

// ---------- Арена (асинхронное PvP: бой со снимком героя другого игрока) ----------
function fighter(deps, pr, heroId, name) {
  const C = deps.C, h = C.HEROES[heroId];
  const lvl = (pr.chars[heroId] || { level: 1 }).level;
  const st = deps.statsFor(heroId, lvl, pr);
  const g = I.gearStats(pr, heroId);
  return { name, hero: heroId, heroName: h.name, lvl, hp: st.maxHp, maxHp: st.maxHp, dmg: st.dmg,
    cd: h.cooldown / (1 + (g.aspd || 0) / 100), crit: 0.15 + (g.crit || 0) / 100, critDmg: 2 + (g.critDmg || 0) / 100,
    def: (g.def || 0) / 100, ls: (g.ls || 0) / 100, skill: 1 + (g.skill || 0) / 100, skills: deps.unlockedSkills(pr, heroId),
    power: Math.round(st.maxHp * 0.4 + st.dmg * 6 * (1 + (g.crit || 0) / 100) * (1 + (g.aspd || 0) / 100)) };
}
function simulate(a, b) {
  const log = [];
  const t = { [a.name]: 0, [b.name]: 0 };
  const sk = { a: 0, b: 0 };
  for (let time = 0; time < 60000; time += 100) {
    for (const [me, foe, key] of [[a, b, 'a'], [b, a, 'b']]) {
      if (me.hp <= 0 || foe.hp <= 0) continue;
      t[me.name] += 100;
      if (t[me.name] >= me.cd) {
        t[me.name] = 0;
        const crit = Math.random() < me.crit;
        const dmg = me.dmg * (0.85 + Math.random() * 0.3) * (crit ? me.critDmg : 1) * (1 - foe.def);
        foe.hp -= dmg; me.hp = Math.min(me.maxHp, me.hp + dmg * me.ls);
      }
      // Умения: чем больше открыто, тем чаще мощные удары
      sk[key] += 100;
      if (me.skills > 0 && sk[key] >= 6000 / me.skills) {
        sk[key] = 0;
        foe.hp -= me.dmg * 1.8 * me.skill * (1 - foe.def);
      }
    }
    if (a.hp <= 0 || b.hp <= 0) { log.push(time); break; }
  }
  const win = a.hp > 0 && (b.hp <= 0 || a.hp / a.maxHp >= b.hp / b.maxHp);
  return { win, aHp: Math.max(0, Math.round(a.hp)), bHp: Math.max(0, Math.round(b.hp)), time: log[0] || 60000 };
}

module.exports = function createMeta(deps) {
  const { C, getProfile, saveProfiles, players, refreshPlayer, notifyUid, profiles } = deps;
  let market = { lots: [], auctions: [], seq: 1 };
  try { market = { ...market, ...JSON.parse(fs.readFileSync(MARKET_FILE, 'utf8')) }; } catch { /* нет файла */ }
  let saveTm = null;
  const save = () => {
    saveProfiles();
    clearTimeout(saveTm);
    saveTm = setTimeout(() => { try { fs.mkdirSync(path.dirname(MARKET_FILE), { recursive: true }); fs.writeFileSync(MARKET_FILE, JSON.stringify(market)); } catch (e) { console.error('market save', e.message); } }, 300);
  };
  const tierOf = (p) => p.zoneTier || 1;
  const F = (t) => I.TIER_MULT[t] || 1;
  const grant = (pr, item) => I.addItem(pr, item, bagSize(pr)); // добыча и призыв: дубликат усиливает оригинал
  const put = (pr, item) => I.addItem(pr, item, bagSize(pr), false); // покупка: предмет как есть
  const grantMsg = (res) => (res.dupe ? `Дубликат! ${I.itemView(res.item).name} усилен` : `Получено: ${I.itemView(res.item).name}`);
  const matName = (id, n) => `${I.MATS[id].icon} ${I.MATS[id].name}${n > 1 ? ` ×${n}` : ''}`;
  // Ключи 'ore' / 'ess' / 'core' в наградах — материал мира tier
  const matKey = (k, tier) => (['ore', 'ess', 'core'].includes(k) ? `${k}${tier}` : k);
  // Цена материала в лавке мира tier (у материалов мира цена своя, свитки и зелья дорожают по миру лавки)
  const shopPrice = (id, tier) => Math.round(I.MATS[id].price * (I.MATS[id].tier ? 1 : F(tier)));

  // ---------- Витрины магазинов (обновляются раз в день, свои в каждом мире) ----------
  const shopCache = new Map();
  const ITEM_PRICE = { common: 120, rare: 450, epic: 2200 };
  function offers(kind, tier) {
    const key = `${dayKey()}:${kind}:${tier}`;
    if (shopCache.has(key)) return shopCache.get(key);
    const list = [];
    const price = (rar) => Math.round(ITEM_PRICE[rar] * F(tier));
    const matOffer = (mat, limit = 0) => list.push({ oid: list.length, mat, price: shopPrice(mat, tier), limit: limit || I.MATS[mat].limit || 0 });
    if (kind === 'equip') {
      // По обычному и редкому предмету на каждый слот и два эпических на день
      for (const cat of I.SLOT_ORDER) for (const rar of ['common', 'rare']) list.push({ oid: list.length, item: I.createItem(cat, rar, tier), price: price(rar) });
      for (let i = 0; i < 2; i++) list.push({ oid: list.length, item: I.createItem(I.SLOT_ORDER[Math.floor(Math.random() * 7)], 'epic', tier), price: price('epic') });
    } else if (kind === 'runes') {
      for (const rar of ['common', 'common', 'common', 'rare', 'rare', 'rare', 'epic']) list.push({ oid: list.length, item: I.createItem('rune', rar, tier), price: price(rar) });
    } else if (kind === 'smith') {
      matOffer(`ore${tier}`); matOffer(`ess${tier}`); matOffer('scrollR'); matOffer('scrollE');
    } else {
      for (const m of ['potHp', 'potHp2', 'potRes', 'elxAtk', 'elxDef', 'elxAgi', 'elxMind', 'elxXp', 'elxLuck', 'tpScroll']) matOffer(m);
    }
    shopCache.set(key, list);
    return list;
  }
  const SHOP_KINDS = ['equip', 'alchemy', 'runes', 'smith'];

  function invView(p) {
    const pr = getProfile(p.uid);
    const st = I.setState(pr, p.heroId);
    return {
      items: (pr.items || []).map(I.itemView), equip: pr.equip, gear: I.gearStats(pr, p.heroId), gold: pr.gold,
      mats: Object.entries(pr.mats || {}).filter(([id, n]) => n > 0 && I.MATS[id]).map(([id, n]) => I.matView(id, n, tierOf(p))),
      sets: { counts: st.counts, active: st.active, cls: st.cls, clsName: st.cls ? I.CLASSES[st.cls].name : null },
      bagSize: bagSize(pr), whSize: SHOP.wh, sub: isSub(pr) ? pr.subUntil : 0, buffs: pr.buffs || {}, tier: tierOf(p),
      hero: { id: p.heroId, level: p.char.level, dupes: (pr.heroDupes || {})[p.heroId] || 0, unlocked: deps.unlockedSkills(pr, p.heroId) },
      itemSpins: pr.itemSpins || 0, freeItemSpins: freeSpinsLeft(pr), pity: pr.pity || 0, pityMax: SHOP.pity,
      attrs: I.ATTRS, rarities: I.ITEM_RARITIES, rarOrder: I.RARITY_ORDER, cats: I.CATEGORIES, slots: I.SLOT_ORDER, slotNames: I.SLOT_NAMES,
    };
  }
  const freeSpinsLeft = (pr) => (pr.freeItemDay === dayKey() ? pr.freeItemLeft || 0 : isSub(pr) ? SHOP.freeItemSpinsSub : SHOP.freeItemSpins);
  const equipped = (pr, id) => Object.values(pr.equip || {}).includes(id);

  // Выдать награду (батл-пасс, реклама)
  function reward(pr, r, tier) {
    const out = [];
    if (r.gold) { pr.gold += r.gold; out.push(`💰 ${r.gold}`); }
    if (r.itemSpins) { pr.itemSpins = (pr.itemSpins || 0) + r.itemSpins; out.push(`🎁 крутка предмета ×${r.itemSpins}`); }
    if (r.item) out.push(grantMsg(grant(pr, I.rollItem(tier, { [r.item]: 1 }))));
    for (const [k, n] of Object.entries(r.mats || {})) { const id = matKey(k, tier); I.addMat(pr, id, n); out.push(matName(id, n)); }
    return out.join(', ');
  }
  // Открыть платный ларец
  function openChest(p, pr, id, d) {
    const t = tierOf(p);
    if (id === 'kitSmith') { I.addMat(pr, `ore${t}`, 30); I.addMat(pr, `ess${t}`, 15); I.addMat(pr, 'scrollE', 2); return `${matName(`ore${t}`, 30)}, ${matName(`ess${t}`, 15)}, ${matName('scrollE', 2)}`; }
    if (id === 'chestLegend') { I.addMat(pr, 'scrollL', 2); I.addMat(pr, `core${t}`, 1); return `${matName('scrollL', 2)}, ${matName(`core${t}`, 1)}`; }
    if (id === 'chestSet') {
      const cls = I.CLASSES[d.cls] ? d.cls : I.classOf(p.heroId);
      const roll = Math.random();
      const res = grant(pr, I.createSetItem(cls, t, roll < 0.02 ? 'mythic' : roll < 0.17 ? 'legendary' : 'epic'));
      return grantMsg(res);
    }
    return null;
  }

  const OPS = {
    inv: (p) => ({ inv: invView(p) }),

    equip(p, d, pr) {
      const it = I.findItem(pr, d.id);
      if (!it || !I.SLOTS[it.cat]) return { error: 'Этот предмет нельзя надеть' };
      pr.equip ??= {};
      for (const s of Object.keys(pr.equip)) if (pr.equip[s] === it.id) pr.equip[s] = null;
      pr.equip[it.cat] = it.id;
      it.loc = 'bag';
      refreshPlayer(p);
      return { toast: `Надето: ${I.itemView(it).name}` };
    },
    unequip(p, d, pr) {
      if (!pr.equip?.[d.slot]) return { error: 'Слот пуст' };
      pr.equip[d.slot] = null;
      refreshPlayer(p);
      return {};
    },
    merge(p, d, pr) {
      const r = I.mergeItems(pr, d.ids || []);
      if (r.error) return { error: r.error };
      refreshPlayer(p);
      return { result: I.itemView(r.item), toast: `Соединение: ${I.itemView(r.item).name} (${I.ITEM_RARITIES[r.item.rar].name})` };
    },

    // ---------- Кузница: улучшение, вещи комплектов, разбор ----------
    craftInfo(p, d, pr) {
      const it = I.findItem(pr, d.id);
      if (!it) return { error: 'Предмет не найден' };
      const up = I.upgradeCost(it);
      const bps = Object.keys(pr.mats || {}).filter((m) => I.MATS[m] && I.MATS[m].kind === 'blueprint' && I.MATS[m].tier === it.tier);
      const canSet = it.cat !== 'rune' && I.RARITY_ORDER.indexOf(it.rar) >= 2 && !I.setIdOf(it);
      return { up: up && { ...up, have: Object.fromEntries(Object.keys(up.need).map((k) => [k, (pr.mats || {})[k] || 0])), names: Object.fromEntries(Object.keys(up.need).map((k) => [k, matName(k, 1)])) },
        sets: canSet ? bps.map((bp) => { const c = I.setCraftCost(it, I.MATS[bp].set); return { bp, name: I.SETS[I.MATS[bp].set].name, ...c, have: Object.fromEntries(Object.keys(c.need).map((k) => [k, (pr.mats || {})[k] || 0])), names: Object.fromEntries(Object.keys(c.need).map((k) => [k, matName(k, 1)])) }; }) : [],
        salvage: Object.entries(I.salvage({ ...it, rar: it.rar })).map(([k, n]) => matName(k, n)).join(', ') };
    },
    upgrade(p, d, pr) {
      const it = I.findItem(pr, d.id);
      if (!it) return { error: 'Предмет не найден' };
      const up = I.upgradeCost(it);
      if (!up) return { error: 'Этот предмет нельзя улучшить' };
      if (pr.gold < up.gold) return { error: `Нужно ${up.gold} золота` };
      if (!I.takeMats(pr, up.need)) return { error: 'Не хватает материалов или свитка' };
      pr.gold -= up.gold;
      it.rar = up.next;
      it.attrs = I.rollAttrs(up.next, it.tier); // атрибуты переговариваются под новую редкость
      refreshPlayer(p);
      return { result: I.itemView(it), toast: `⚒️ Улучшено: ${I.itemView(it).name} — ${I.ITEM_RARITIES[it.rar].name}` };
    },
    setCraft(p, d, pr) {
      const it = I.findItem(pr, d.id), bp = I.MATS[d.bp];
      if (!it || !bp || bp.kind !== 'blueprint') return { error: 'Выберите предмет и чертёж' };
      if (it.cat === 'rune' || I.RARITY_ORDER.indexOf(it.rar) < 2) return { error: 'Нужен эпический или лучший предмет' };
      if (it.tier !== bp.tier) return { error: 'Предмет и чертёж должны быть одного мира' };
      if (I.setIdOf(it)) return { error: 'Это уже вещь комплекта' };
      const c = I.setCraftCost(it, bp.set);
      if (pr.gold < c.gold) return { error: `Нужно ${c.gold} золота` };
      if (!I.takeMats(pr, c.need)) return { error: 'Не хватает материалов' };
      pr.gold -= c.gold;
      it.tpl = `set_${I.SETS[bp.set].cls}`;
      refreshPlayer(p);
      return { result: I.itemView(it), toast: `🗺️ Создано: ${I.itemView(it).name}` };
    },
    salvage(p, d, pr) {
      const it = I.findItem(pr, d.id);
      if (!it || equipped(pr, it.id)) return { error: 'Снимите предмет перед разбором' };
      const out = I.salvage(it);
      I.detach(pr, it);
      pr.items = pr.items.filter((i) => i !== it);
      for (const [k, n] of Object.entries(out)) I.addMat(pr, k, n);
      return { toast: `Разобрано: ${Object.entries(out).map(([k, n]) => matName(k, n)).join(', ')}` };
    },

    // ---------- Расходники и ларцы ----------
    useMat(p, d, pr) {
      const id = d.mat, m = I.MATS[id];
      if (!m || !(pr.mats || {})[id]) return { error: 'Нет такого предмета' };
      const now = Date.now();
      let msg = '';
      if (m.kind === 'potion') {
        if (p.dead) return { error: 'Герой повержен' };
        if (now < (p.potionAt || 0)) return { error: `Зелье будет готово через ${Math.ceil((p.potionAt - now) / 1000)} с` };
        p.potionAt = now + 8000;
        if (m.heal) { p.hp = Math.min(p.maxHp, p.hp + p.maxHp * m.heal); msg = `${m.icon} +${Math.round(p.maxHp * m.heal)} здоровья`; }
        if (m.res) { p.res = Math.min(p.resMax, p.res + p.resMax * m.res); msg = `${m.icon} ресурс восстановлен`; }
      } else if (m.kind === 'elixir') {
        pr.buffs ??= {};
        pr.buffs[m.buff] = Math.max(now, pr.buffs[m.buff] || 0) + 30 * 60000;
        msg = `${m.icon} ${m.name}: ещё 30 минут`;
      } else if (m.kind === 'scrollTp') {
        if (!deps.toTown(p)) return { error: 'Вы уже в городе' };
        msg = `${m.icon} Возвращение в город`;
      } else if (m.kind === 'chest') {
        msg = `${m.icon} ${m.name}: ${openChest(p, pr, id, d)}`;
      } else return { error: 'Этот предмет используется в кузнице' };
      I.takeMats(pr, { [id]: 1 });
      refreshPlayer(p);
      return { toast: msg };
    },
    sellMat(p, d, pr) {
      const m = I.MATS[d.mat], n = Math.floor(Number(d.n) || 1);
      if (!m || !(n > 0) || ((pr.mats || {})[d.mat] || 0) < n) return { error: 'Не хватает' };
      if (!m.buy) return { error: 'Торговец это не покупает' };
      const v = Math.round(m.buy * (m.tier ? 1 : F(tierOf(p)))) * n;
      I.takeMats(pr, { [d.mat]: n });
      pr.gold += v;
      return { toast: `Продано: ${matName(d.mat, n)} за ${v} 💰` };
    },
    socket(p, d, pr) {
      const w = I.findItem(pr, d.weapon), rune = I.findItem(pr, d.rune);
      if (!w || w.cat !== 'weapon') return { error: 'Выберите оружие' };
      if (!rune || rune.cat !== 'rune') return { error: 'Выберите руну' };
      w.runes ??= [];
      if (w.runes.length >= I.ITEM_RARITIES[w.rar].sockets) return { error: 'Все гнёзда заняты' };
      pr.items = pr.items.filter((i) => i !== rune);
      delete rune.loc;
      w.runes.push(rune);
      refreshPlayer(p);
      return { toast: `${I.itemView(rune).name} вставлена в ${I.itemView(w).name}` };
    },
    unsocket(p, d, pr) {
      const w = I.findItem(pr, d.weapon);
      if (!w || !w.runes || !w.runes[d.idx]) return { error: 'Руна не найдена' };
      const cost = 50 * w.tier;
      if (pr.gold < cost) return { error: `Нужно ${cost} золота` };
      pr.gold -= cost;
      const [rune] = w.runes.splice(d.idx, 1);
      rune.loc = 'bag';
      pr.items.push(rune);
      refreshPlayer(p);
      return { toast: `Руна извлечена (−${cost} 💰)` };
    },
    store(p, d, pr) {
      const it = I.findItem(pr, d.id);
      if (!it || equipped(pr, it.id)) return { error: 'Снимите предмет перед переносом' };
      const toWh = it.loc !== 'wh';
      const count = pr.items.filter((i) => (i.loc === 'wh') === toWh).length;
      if (count >= (toWh ? SHOP.wh : bagSize(pr))) return { error: toWh ? 'Склад полон' : 'Сумка полна' };
      it.loc = toWh ? 'wh' : 'bag';
      return { toast: toWh ? 'Перенесено на склад' : 'Перенесено в сумку' };
    },
    sell(p, d, pr) {
      const it = I.findItem(pr, d.id);
      if (!it || equipped(pr, it.id)) return { error: 'Снимите предмет перед продажей' };
      const v = I.itemView(it).sell;
      I.detach(pr, it);
      pr.items = pr.items.filter((i) => i !== it);
      pr.gold += v;
      return { toast: `Продано за ${v} 💰` };
    },

    // ---------- Магазины ----------
    shop(p, d, pr) {
      const kind = SHOP_KINDS.includes(d.kind) ? d.kind : 'equip';
      const list = offers(kind, tierOf(p));
      const bought = pr.shopDay === dayKey() ? pr.shopBought || [] : [];
      const cnt = (o) => bought.filter((k) => k === `${kind}:${tierOf(p)}:${o.oid}`).length;
      return { offers: list.map((o) => ({ oid: o.oid, price: o.price, sold: o.item ? cnt(o) > 0 : o.limit ? cnt(o) >= o.limit : false,
        left: o.limit ? o.limit - cnt(o) : null, item: o.item ? I.itemView(o.item) : null, mat: o.mat ? I.matView(o.mat, 1, tierOf(p)) : null })) };
    },
    buy(p, d, pr) {
      const kind = SHOP_KINDS.includes(d.kind) ? d.kind : 'equip';
      const o = offers(kind, tierOf(p)).find((x) => x.oid === d.oid);
      if (!o) return { error: 'Товар не найден' };
      if (pr.shopDay !== dayKey()) { pr.shopDay = dayKey(); pr.shopBought = []; }
      const key = `${kind}:${tierOf(p)}:${o.oid}`;
      const done = pr.shopBought.filter((k) => k === key).length;
      if (o.mat) {
        let n = Math.max(1, Math.min(50, Math.floor(Number(d.n) || 1)));
        if (o.limit) n = Math.min(n, o.limit - done);
        if (n <= 0) return { error: 'Лимит на сегодня исчерпан — завтра будет снова' };
        if (pr.gold < o.price * n) return { error: 'Не хватает золота' };
        pr.gold -= o.price * n;
        I.addMat(pr, o.mat, n);
        if (o.limit) for (let i = 0; i < n; i++) pr.shopBought.push(key);
        return { toast: `Куплено: ${matName(o.mat, n)}` };
      }
      // Каждый предмет витрины можно купить раз в день
      if (done) return { error: 'Уже куплено сегодня — витрина обновится завтра' };
      if (pr.gold < o.price) return { error: 'Не хватает золота' };
      pr.gold -= o.price;
      pr.shopBought.push(key);
      const copy = { ...JSON.parse(JSON.stringify(o.item)), id: I.createItem(o.item.cat, o.item.rar).id };
      return { toast: grantMsg(put(pr, copy)) };
    },

    // ---------- Призыв предметов ----------
    itemSpin(p, d, pr) {
      const n = d.n === 10 ? 10 : 1;
      const free = freeSpinsLeft(pr);
      const useFree = Math.min(free, n);
      if (useFree + (pr.itemSpins || 0) < n) return { error: 'Нет круток', needPayment: true };
      if (pr.freeItemDay !== dayKey()) { pr.freeItemDay = dayKey(); pr.freeItemLeft = free; }
      pr.freeItemLeft -= useFree;
      pr.itemSpins = (pr.itemSpins || 0) - (n - useFree);
      const results = [];
      for (let i = 0; i < n; i++) {
        pr.pity = (pr.pity || 0) + 1;
        let rar = I.rollRarity(ITEM_GACHA);
        if (pr.pity >= SHOP.pity && I.RARITY_ORDER.indexOf(rar) < 3) rar = 'legendary';
        if (I.RARITY_ORDER.indexOf(rar) >= 3) pr.pity = 0;
        // Эпические и лучшие — с шансом 25% вещь комплекта (класса текущего героя чаще)
        const setPiece = I.RARITY_ORDER.indexOf(rar) >= 2 && Math.random() < 0.25;
        const cls = Math.random() < 0.5 ? I.classOf(p.heroId) : null;
        const res = grant(pr, setPiece ? I.createSetItem(cls, tierOf(p), rar) : I.rollItem(tierOf(p), { [rar]: 1 }));
        results.push({ ...I.itemView(res.item), dupe: res.dupe });
      }
      addPassXp(pr, 5 * n);
      refreshPlayer(p);
      return { results };
    },

    // ---------- Рынок: фиксированная цена, комиссия с продавца. Продаются предметы и стопки материалов ----------
    market(p, d, pr) {
      return { lots: market.lots.map((l) => ({ id: l.id, item: lotView(l), price: l.price, seller: l.sellerName, mine: l.seller === p.uid })),
        fee: isSub(pr) ? SHOP.marketFeeSub : SHOP.marketFee, slots: isSub(pr) ? SHOP.marketSlotsSub : SHOP.marketSlots };
    },
    marketSell(p, d, pr) {
      const price = Math.floor(Number(d.price));
      if (!(price >= 10 && price <= 1e8)) return { error: 'Цена от 10 золота' };
      if (market.lots.filter((l) => l.seller === p.uid).length >= (isSub(pr) ? SHOP.marketSlotsSub : SHOP.marketSlots)) return { error: 'Все прилавки заняты' };
      const lot = takeForLot(pr, d);
      if (lot.error) return lot;
      market.lots.push({ id: market.seq++, seller: p.uid, sellerName: p.name, ...lot, price, at: Date.now() });
      return { toast: 'Выставлено на рынок' };
    },
    marketBuy(p, d, pr) {
      const l = market.lots.find((x) => x.id === d.id);
      if (!l) return { error: 'Лот уже продан' };
      if (l.seller === p.uid) return { error: 'Это ваш лот' };
      if (pr.gold < l.price) return { error: 'Не хватает золота' };
      pr.gold -= l.price;
      market.lots = market.lots.filter((x) => x !== l);
      const seller = getProfile(l.seller);
      const fee = isSub(seller) ? SHOP.marketFeeSub : SHOP.marketFee;
      const income = Math.floor(l.price * (1 - fee));
      seller.gold += income;
      notifyUid(l.seller, `Рынок: продано «${lotView(l).name}» за ${l.price} 💰 (вам ${income} после комиссии)`);
      return { toast: giveLot(pr, l) };
    },
    marketCancel(p, d, pr) {
      const l = market.lots.find((x) => x.id === d.id && x.seller === p.uid);
      if (!l) return { error: 'Лот не найден' };
      market.lots = market.lots.filter((x) => x !== l);
      giveLot(pr, l);
      return { toast: 'Лот снят' };
    },

    // ---------- Аукцион: ставки, лот уходит лучшей ставке ----------
    auction(p) {
      return { lots: market.auctions.map((a) => ({ id: a.id, item: lotView(a), start: a.start, bid: a.bid, bidder: a.bidderName || null,
        mineBid: a.bidder === p.uid, mine: a.seller === p.uid, seller: a.sellerName, left: a.endsAt - Date.now() })), fee: SHOP.auctionFee };
    },
    auctionSell(p, d, pr) {
      const start = Math.floor(Number(d.start)), hours = [2, 8, 24].includes(+d.hours) ? +d.hours : 8;
      if (!(start >= 10 && start <= 1e8)) return { error: 'Стартовая цена от 10 золота' };
      if (market.auctions.filter((a) => a.seller === p.uid).length >= SHOP.auctionSlots) return { error: `Не больше ${SHOP.auctionSlots} лотов` };
      const lot = takeForLot(pr, d);
      if (lot.error) return lot;
      market.auctions.push({ id: market.seq++, seller: p.uid, sellerName: p.name, ...lot, start, bid: 0, bidder: null, endsAt: Date.now() + hours * 36e5 });
      return { toast: `Лот выставлен на ${hours} ч` };
    },
    auctionBid(p, d, pr) {
      const a = market.auctions.find((x) => x.id === d.id);
      if (!a) return { error: 'Торги завершены' };
      if (a.seller === p.uid) return { error: 'Это ваш лот' };
      if (a.bidder === p.uid) return { error: 'Ваша ставка и так лучшая' };
      const min = a.bid ? Math.ceil(a.bid * 1.05) : a.start;
      const amount = Math.max(min, Math.floor(Number(d.amount) || 0));
      if (pr.gold < amount) return { error: `Нужно ${amount} золота` };
      pr.gold -= amount; // ставка замораживается
      if (a.bidder) { getProfile(a.bidder).gold += a.bid; notifyUid(a.bidder, `Аукцион: вашу ставку на «${lotView(a).name}» перебили, золото возвращено`); }
      a.bid = amount; a.bidder = p.uid; a.bidderName = p.name;
      if (a.endsAt - Date.now() < 60000) a.endsAt = Date.now() + 60000; // защита от ставок в последнюю секунду
      return { toast: `Ставка ${amount} 💰 принята` };
    },
    auctionCancel(p, d, pr) {
      const a = market.auctions.find((x) => x.id === d.id && x.seller === p.uid);
      if (!a) return { error: 'Лот не найден' };
      if (a.bidder) return { error: 'На лот уже есть ставки' };
      market.auctions = market.auctions.filter((x) => x !== a);
      giveLot(pr, a);
      return { toast: 'Лот снят' };
    },

    // ---------- Батл-пасс ----------
    pass(p, d, pr) {
      const ps = passOf(pr);
      return { pass: { ...ps, level: Math.floor(ps.xp / SHOP.pass.xpPerLevel), xpPerLevel: SHOP.pass.xpPerLevel, price: SHOP.pass.price,
        ends: (passSeason() + 1) * SHOP.pass.days * DAY, rewards: PASS_REWARDS } };
    },
    passClaim(p, d, pr) {
      const ps = passOf(pr), lvl = +d.lvl, track = d.track === 'prem' ? 'prem' : 'free';
      const rw = PASS_REWARDS[lvl - 1];
      if (!rw || Math.floor(ps.xp / SHOP.pass.xpPerLevel) < lvl) return { error: 'Уровень ещё не достигнут' };
      if (track === 'prem' && !ps.premium) return { error: 'Нужен премиум-пропуск' };
      if (ps[track].includes(lvl)) return { error: 'Уже получено' };
      ps[track].push(lvl);
      const msg = reward(pr, rw[track], tierOf(p));
      refreshPlayer(p);
      return { toast: `Награда: ${msg}` };
    },

    // ---------- Реклама (заглушка: подключите сеть, например Adsgram, в public/js/town.js → showAd) ----------
    ad(p, d, pr) {
      if (pr.adDay !== dayKey()) { pr.adDay = dayKey(); pr.adCount = 0; }
      if (pr.adCount >= SHOP.ads.perDay) return { error: 'На сегодня реклама закончилась' };
      if (Date.now() - (pr.adAt || 0) < SHOP.ads.cooldownMs) return { error: 'Подождите немного' };
      pr.adAt = Date.now(); pr.adCount += 1;
      const msg = reward(pr, pr.adCount % 5 === 0 ? { itemSpins: 1 } : { gold: 150 * tierOf(p) }, tierOf(p));
      addPassXp(pr, 10);
      return { toast: `Награда за просмотр: ${msg}`, left: SHOP.ads.perDay - pr.adCount };
    },
    shopInfo(p, d, pr) {
      if (pr.adDay !== dayKey()) { pr.adDay = dayKey(); pr.adCount = 0; }
      return { sub: isSub(pr) ? pr.subUntil : 0, subPrice: SHOP.sub.price, passPrice: SHOP.pass.price, premium: passOf(pr).premium,
        itemSpin: SHOP.itemSpin, adsLeft: SHOP.ads.perDay - pr.adCount, gold: pr.gold,
        chests: Object.entries(CHESTS).map(([k, c]) => ({ id: k, title: c.title, desc: c.description, amount: c.amount })) };
    },

    // ---------- PvP-арена ----------
    arena(p, d, pr) {
      const a = arenaOf(pr);
      a.hero = p.heroId; // защищается текущим героем
      const me = fighter(deps, pr, p.heroId, p.name);
      const rivals = Object.entries(profiles).filter(([uid, o]) => uid !== p.uid && o.arena && o.arena.hero && C.HEROES[o.arena.hero])
        .map(([uid, o]) => ({ uid, name: o.arena.name || 'Герой', rating: o.arena.rating, hero: o.arena.hero }))
        .sort((x, y) => Math.abs(x.rating - a.rating) - Math.abs(y.rating - a.rating)).slice(0, 3);
      while (rivals.length < 3) rivals.push({ uid: 'bot' + rivals.length, name: ['Тень арены', 'Страж ворот', 'Бродячий гладиатор'][rivals.length], rating: a.rating + (rivals.length - 1) * 40, bot: true, hero: p.heroId });
      const top = Object.values(profiles).filter((o) => o.arena && o.arena.hero).sort((x, y) => y.arena.rating - x.arena.rating).slice(0, 10)
        .map((o) => ({ name: o.arena.name || 'Герой', rating: o.arena.rating, hero: C.HEROES[o.arena.hero]?.name || '' }));
      return { arena: { rating: a.rating, wins: a.wins, losses: a.losses, left: arenaLeft(pr), power: me.power, rivals, top } };
    },
    arenaFight(p, d, pr) {
      const a = arenaOf(pr);
      if (arenaLeft(pr) <= 0) return { error: 'Бои на сегодня закончились' };
      const me = fighter(deps, pr, p.heroId, p.name);
      let foe, foeArena = null;
      if (String(d.uid).startsWith('bot')) {
        const k = 0.85 + Math.random() * 0.25 + Number(String(d.uid).slice(3)) * 0.08;
        foe = { ...me, name: 'Соперник', hp: me.maxHp * k, maxHp: me.maxHp * k, dmg: me.dmg * k };
        foeArena = { rating: a.rating + (Number(String(d.uid).slice(3)) - 1) * 40 };
      } else {
        const op = profiles[d.uid];
        if (!op || !op.arena || !op.arena.hero) return { error: 'Соперник не найден' };
        foe = fighter(deps, op, op.arena.hero, op.arena.name || 'Герой');
        foeArena = op.arena;
      }
      a.fightsDay = dayKey(); a.fights = (a.fights || 0) + 1;
      const res = simulate({ ...me }, { ...foe, name: foe.name + ' ' });
      const exp = 1 / (1 + 10 ** ((foeArena.rating - a.rating) / 400));
      const delta = Math.round(32 * ((res.win ? 1 : 0) - exp));
      a.rating = Math.max(0, a.rating + delta);
      if (res.win) a.wins++; else a.losses++;
      if (!String(d.uid).startsWith('bot')) foeArena.rating = Math.max(0, foeArena.rating - delta);
      const gold = res.win ? 120 + Math.round(a.rating / 10) : 40;
      pr.gold += gold;
      addPassXp(pr, res.win ? 15 : 5);
      return { fight: { ...res, delta, rating: a.rating, gold, foe: foe.name.trim(), foeHero: C.HEROES[foe.hero]?.name } };
    },
  };
  const arenaOf = (pr) => (pr.arena ??= { rating: 1000, wins: 0, losses: 0, fights: 0, fightsDay: '' });
  const arenaLeft = (pr) => {
    const a = arenaOf(pr);
    if (a.fightsDay !== dayKey()) { a.fightsDay = dayKey(); a.fights = 0; }
    return (isSub(pr) ? SHOP.arena.perDaySub : SHOP.arena.perDay) - a.fights;
  };

  // Лот рынка/аукциона: предмет или стопка материалов
  const lotView = (l) => (l.mat ? { ...I.matView(l.mat, l.n), name: `${I.MATS[l.mat].name} ×${l.n}` } : I.itemView(l.item));
  function takeForLot(pr, d) {
    if (d.mat) {
      const n = Math.floor(Number(d.n) || 0);
      if (!I.MATS[d.mat] || !(n > 0)) return { error: 'Укажите количество' };
      if (!I.takeMats(pr, { [d.mat]: n })) return { error: 'Не хватает материалов' };
      return { mat: d.mat, n };
    }
    const it = I.findItem(pr, d.id);
    if (!it || equipped(pr, it.id)) return { error: 'Снимите предмет перед продажей' };
    pr.items = pr.items.filter((i) => i !== it);
    return { item: it };
  }
  function giveLot(pr, l) {
    if (l.mat) { I.addMat(pr, l.mat, l.n); return `Получено: ${matName(l.mat, l.n)}`; }
    l.item.loc = 'bag';
    return grantMsg(put(pr, l.item));
  }

  // Завершение аукционов
  setInterval(() => {
    const now = Date.now();
    const done = market.auctions.filter((a) => a.endsAt <= now);
    if (!done.length) return;
    market.auctions = market.auctions.filter((a) => a.endsAt > now);
    for (const a of done) {
      const name = lotView(a).name;
      if (a.bidder) {
        const buyer = getProfile(a.bidder), seller = getProfile(a.seller);
        giveLot(buyer, a);
        const income = Math.floor(a.bid * (1 - (isSub(seller) ? SHOP.marketFeeSub : SHOP.auctionFee)));
        seller.gold += income;
        notifyUid(a.bidder, `Аукцион: вы выиграли «${name}» за ${a.bid} 💰`);
        notifyUid(a.seller, `Аукцион: «${name}» продан за ${a.bid} 💰 (вам ${income})`);
      } else {
        giveLot(getProfile(a.seller), a);
        notifyUid(a.seller, `Аукцион: на «${name}» не было ставок, предмет вернулся`);
      }
    }
    save();
  }, 5000);

  // Эликсир закончился — пересчитать статы героя
  setInterval(() => {
    const now = Date.now();
    for (const p of players.values()) {
      const pr = getProfile(p.uid);
      const sig = Object.keys(I.BUFF_STATS).filter((k) => (pr.buffs || {})[k] > now).join();
      if (p.buffSig !== undefined && p.buffSig !== sig) refreshPlayer(p);
      p.buffSig = sig;
    }
  }, 3000);

  function handle(p, d) {
    const fn = OPS[d && d.op];
    if (!fn) return { error: 'Неизвестное действие' };
    const pr = getProfile(p.uid);
    if (p.name && pr.arena) pr.arena.name = p.name;
    const res = fn(p, d, pr) || {};
    if (!res.error && !['inv', 'market', 'auction', 'shop', 'pass', 'shopInfo', 'arena', 'craftInfo'].includes(d.op)) save();
    res.gold = pr.gold;
    return res;
  }

  // Покупки за Stars (зачисляются ботом после оплаты)
  function onPaid(kind, pr) {
    if (kind === 'ispin') pr.itemSpins = (pr.itemSpins || 0) + 1;
    else if (kind === 'ispin10') pr.itemSpins = (pr.itemSpins || 0) + 10;
    else if (kind === 'pass') passOf(pr).premium = true;
    else if (kind === 'sub') pr.subUntil = Math.max(Date.now(), pr.subUntil || 0) + SHOP.sub.days * DAY;
    else if (CHESTS[kind]) I.addMat(pr, CHESTS[kind].mat || kind, CHESTS[kind].n);
    else return false;
    return true;
  }
  // Ларцы за Stars: попадают в сумку, открываются там (мир — по месту открытия)
  const CHESTS = {
    kitSmith: { n: 1, amount: 49, title: 'Сундук кузнеца', description: '30 руды, 15 эссенции и 2 свитка мастера' },
    chestSet: { n: 1, amount: 99, title: 'Ларец комплекта', description: 'Вещь комплекта вашего класса: эпическая, 15% легендарная, 2% мифическая' },
    chestSet5: { n: 5, amount: 449, title: 'Ларцы комплекта ×5', description: 'Пять ларцов комплекта со скидкой 10%' },
    chestLegend: { n: 1, amount: 149, title: 'Ларец грандмастера', description: '2 свитка грандмастера и редкий материал' },
  };
  CHESTS.chestSet5.mat = 'chestSet';
  const INVOICES = {
    ...Object.fromEntries(Object.entries(CHESTS).map(([k, c]) => [k, { title: c.title, description: c.description, amount: c.amount }])),
    ispin: { title: 'Призыв предмета', description: 'Одна крутка призыва предметов', amount: SHOP.itemSpin.price },
    ispin10: { title: 'Призыв предметов ×10', description: 'Десять круток призыва предметов', amount: SHOP.itemSpin.price10 },
    pass: { title: 'Премиум батл-пасс', description: 'Премиум-награды текущего сезона', amount: SHOP.pass.price },
    sub: { title: 'Подписка на 30 дней', description: '+25% опыта и золота, скидка комиссии рынка, больше сумка', amount: SHOP.sub.price },
  };

  return { handle, addPassXp, passOf, isSub, bagSize, onPaid, INVOICES, SHOP, grant: (pr, item) => I.addItem(pr, item, bagSize(pr)) };
};
module.exports.simulate = simulate;
