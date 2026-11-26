// Мета-игра: инвентарь и экипировка, соединение (merge), руны, склад, магазины, призыв предметов,
// рынок и аукцион между игроками (с комиссией), батл-пасс, подписка, реклама, PvP-арена.
// Все действия приходят по сокету: socket.emit('act', { op, ... }, ack)
const I = require('./items');
const store = require('./store');

const DAY = 864e5;
const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
// Внешний вид: цвет имени и сияние видят все игроки, рамка аватара — у себя на панели. На силу не влияет.
// В каждом разделе две вещи за самоцветы (price, 💎), остальные — за GRAM (stars: цена в ⭐, в GRAM — по курсу, с GRAM-баланса)
const COSMETICS = {
  name: {
    // Красный и розовый цвет имени заняты опасным данжем (убийца / напавший) — у купивших они заменены на янтарный и бирюзовый
    crimson: { name: 'Янтарное имя', color: '#ffa64a', price: 900 }, azure: { name: 'Лазурное имя', color: '#6ac8ff', price: 900 },
    emerald: { name: 'Изумрудное имя', color: '#6aff9a', stars: 240 }, violet: { name: 'Фиолетовое имя', color: '#c890ff', stars: 240 },
    rose: { name: 'Бирюзовое имя', color: '#5ae6d0', stars: 240 }, gold: { name: 'Золотое имя', color: '#ffd36a', stars: 400 },
  },
  aura: {
    frost: { name: 'Ледяное сияние', color: 0x8ad3ff, price: 1200 }, life: { name: 'Сияние жизни', color: 0x6aff8a, price: 1200 },
    flame: { name: 'Огненное сияние', color: 0xff6a2a, stars: 320 }, shadow: { name: 'Теневое сияние', color: 0x9a5aff, stars: 320 },
    gold: { name: 'Золотое сияние', color: 0xffd36a, stars: 400 },
  },
  frame: {
    diamond: { name: 'Алмазная рамка', price: 1800 }, legend: { name: 'Легендарная рамка', price: 2700 },
    obsidian: { name: 'Обсидиановая рамка', stars: 720 }, celestial: { name: 'Небесная рамка', stars: 960 }, dragon: { name: 'Драконья рамка', stars: 1200 },
    founder: { name: 'Рамка основателя', grant: true }, // только в подарок основателям (первые 3 дня после открытия) — не продаётся
    veteran: { name: 'Рамка ветерана ЗБТ', grant: true }, // подарок участникам ЗБТ при релизе
  },
};
// Награда за вход 7 дней подряд: день — по Москве; пропустил день — серия начинается заново, после 7-го — по кругу
const mskDay = (t = Date.now()) => new Date(t + 3 * 36e5).toISOString().slice(0, 10);
const LOGIN_REWARDS = [
  { gold: 1000, mats: { potHp: 5 } },
  { gold: 1500, mats: { dust: 1 } },
  { gems: 30, mats: { potHp2: 2 } },
  { gold: 2500, mats: { elxAtk: 1, elxDef: 1 } },
  { itemSpins: 1, mats: { dust: 2 } },
  { gems: 60, mats: { luckStone: 1 } },
  { heroSpins: 1, gems: 100, mats: { elxHero: 1, skillCrystal: 1 } },
];

// ---------- Баланс монетизации ----------
const SHOP = {
  bag: 60, bagSub: 80, wh: 150,
  marketFee: 0.10, marketFeeSub: 0.05, auctionFee: 0.12, marketSlots: 5, marketSlotsSub: 10, auctionSlots: 3,
  itemSpin: { price: 15, price10: 135 }, // Telegram Stars
  freeItemSpins: 1, freeItemSpinsSub: 2, // бесплатно каждый день
  pity: 80, // гарантированный легендарный предмет каждые 80 круток (добыча редкая — призыв за ⭐ не должен быть её заменой)
  gemsPerWish: 100, // самоцветов за один призыв снаряжения, если печатей нет (≈ цене печати в ⭐; призыв героя — 160, server/wish.js)
  gems: { gems1: { gems: 330, amount: 50 }, gems2: { gems: 1090, amount: 150 }, gems3: { gems: 2240, amount: 300 }, gems4: { gems: 6480, amount: 800 } }, // пачки самоцветов за Stars
  pass: { levels: 30, xpPerLevel: 100, days: 30 },
  // Сезонные ордена (Telegram Stars): каждый следующий включает все бонусы предыдущих, доплата — только разница в цене
  // Бесплатный орден — у всех игроков автоматически
  passFree: { tier: 0, id: 'free', icon: '🎖️', name: 'Орден Странника', price: 0, perks: ['Бесплатные награды всех 30 уровней сезона', '+5% опыта и золота', 'Автобой 15 мин в день'] },
  passTiers: [
    { tier: 1, id: 'bronze', icon: '🥉', name: 'Бронзовый орден', price: 149, perks: ['Премиум-награды всех 30 уровней сезона', 'Автобой 30 мин в день'] },
    { tier: 2, id: 'silver', icon: '🥈', name: 'Серебряный орден', price: 299, perks: ['Опыт пропуска +50%', '+1 бесплатный призыв снаряжения в день', '+8% опыта и золота', 'Автобой 1 ч в день'] },
    { tier: 3, id: 'gold', icon: '🥇', name: 'Золотой орден', price: 599, perks: ['Автобой 2 ч в день — и без вас: выйдите из игры, герой фармит в данже сам', '+12% опыта и золота'] },
    { tier: 4, id: 'champion', icon: '👑', name: 'Орден Чемпиона', price: 1199, perks: ['Премиум-награды ×2', 'Мифический предмет на 30 уровне', '+20% опыта и золота', 'Автобой 4 ч в день'] },
    // Торговые ордена — только поверх Ордена Чемпиона: в цену входят все предыдущие ордена (server/trade.js — скидки комиссий)
    { tier: 5, id: 'merchant', icon: '🟢', name: 'Орден Купца', price: 1499, trade: true, perks: ['Включает Орден Чемпиона и все предыдущие ордена', 'Автобой 5 ч в день', 'Комиссия Торгового дома 17.5% вместо 20%', 'Комиссия вывода 9% вместо 10%', '+5 лотов в Торговом доме', 'Лоты висят 14 дней', 'Знак купца у ваших лотов', 'Выплаты — в первую очередь', '+1 печать снаряжения сразу'] },
    { tier: 6, id: 'magnate', icon: '🏦', name: 'Орден Магната', price: 1899, trade: true, perks: ['Включает Орден Купца, Орден Чемпиона и все предыдущие ордена', 'Автобой 6 ч в день', 'Комиссия Торгового дома 15% вместо 20%', 'Комиссия вывода 7.5% вместо 10%', '+15 лотов в Торговом доме', 'Лоты висят 30 дней', 'Ваши лоты — вверху списка', 'Золотой знак магната у лотов', 'Выплаты — в первую очередь', '+3 печати снаряжения сразу'] },
    // Старшие ордена: больше автобоя и бонуса, комиссия снижается ступенями; полная скидка — в Ордене Вечности
    { tier: 7, id: 'warden', icon: '🛡️', name: 'Орден Хранителя', price: 2499, trade: true, perks: ['Включает Орден Магната и все предыдущие ордена', 'Автобой 7 ч в день', '+22% опыта и золота', 'Комиссия Торгового дома 14% вместо 20%', 'Комиссия вывода 7% вместо 10%', '+20 лотов в Торговом доме', '+5 печатей снаряжения сразу', '+1 бесплатный призыв снаряжения в день'] },
    { tier: 8, id: 'archon', icon: '⚜️', name: 'Орден Архонта', price: 3299, trade: true, perks: ['Включает Орден Хранителя и все предыдущие ордена', 'Автобой 8 ч в день', '+24% опыта и золота', 'Комиссия Торгового дома 13% вместо 20%', 'Комиссия вывода 6.5% вместо 10%', '+25 лотов в Торговом доме', '+7 печатей снаряжения сразу', '+500 💎 сразу'] },
    { tier: 9, id: 'dragon', icon: '🐉', name: 'Орден Дракона', price: 4299, trade: true, perks: ['Включает Орден Архонта и все предыдущие ордена', 'Автобой 10 ч в день', '+27% опыта и золота', 'Комиссия Торгового дома 12% вместо 20%', 'Комиссия вывода 6% вместо 10%', '+30 лотов в Торговом доме', '+10 печатей снаряжения сразу', '+1000 💎 сразу', 'Ещё +1 бесплатный призыв снаряжения в день'] },
    { tier: 10, id: 'eternal', icon: '💠', name: 'Орден Вечности', price: 5499, trade: true, perks: ['Включает все ордена сезона', 'Автобой 12 ч в день', '+30% опыта и золота', 'Комиссия Торгового дома 10% вместо 20%', 'Комиссия вывода 5% вместо 10%', '+40 лотов в Торговом доме', '+15 печатей снаряжения сразу', '+2000 💎 сразу', 'Второй мифический предмет сезона'] },
  ],
  autofarmTier: 3, // (старое) с какого ордена автобой был без лимита
  autofarmMin: { 0: 15, 1: 30, 2: 60, 3: 120, 4: 240, 5: 300, 6: 360, 7: 420, 8: 480, 9: 600, 10: 720 }, // минут автобоя в день по ордену (бесплатный — 15)
  passXpGold: { 0: 0.05, 1: 0.05, 2: 0.08, 3: 0.12, 4: 0.2, 5: 0.2, 6: 0.2, 7: 0.22, 8: 0.24, 9: 0.27, 10: 0.3 }, // новый баланс: прокачка в десятки раз дольше — +30% было бы слишком сильно // бонус к опыту и золоту в бою по ордену (не складывается — берётся свой)
  sub: { price: 250, days: 30, xpBonus: 0.15, goldBonus: 0.15 },
  ads: { perDay: 5, cooldownMs: 30000 },
  arena: { perDay: 5, perDaySub: 8 },
};
// Веса редкостей в призыве предметов (обычных нет)
// Баннер снаряжения: каждую неделю — свой «комплект недели» (класс), его вещи выпадают чаще
const gearBanner = (t = Date.now()) => {
  const week = Math.floor((t - Date.UTC(2024, 0, 1)) / (7 * DAY)), cls = Object.keys(I.CLASSES)[week % Object.keys(I.CLASSES).length];
  return { cls, name: I.CLASSES[cls].name, ends: Date.UTC(2024, 0, 1) + (week + 1) * 7 * DAY };
};
const ITEM_GACHA = { rare: 66.6, epic: 30, legendary: 3, mythic: 0.4 }; // мифики редки и в добыче — призыв за ⭐ не должен быть проще

const isSub = (pr) => (pr.subUntil || 0) > Date.now();
// Размер инвентаря: база (подписка — больше) + надетая сумка
const bagBonus = (pr) => { const b = pr.equip && pr.equip.bag && I.findItem(pr, pr.equip.bag); return b ? I.BAG_SLOTS[b.rar] || 0 : 0; };
const bagSize = (pr) => (isSub(pr) ? SHOP.bagSub : SHOP.bag) + bagBonus(pr);
// Склад: улучшается за золото (и самоцветы на последних уровнях)
const WH_UPGRADES = [
  { slots: 50, gold: 25000 }, // первый уровень — за золото, дальше — только за Stars
  { slots: 50, gold: 0, stars: 99, kind: 'whUp2' }, { slots: 50, gold: 0, stars: 149, kind: 'whUp3' },
  { slots: 50, gold: 0, stars: 199, kind: 'whUp4' }, { slots: 50, gold: 0, stars: 249, kind: 'whUp5' },
];
const whSize = (pr) => SHOP.wh + WH_UPGRADES.slice(0, pr.whLvl || 0).reduce((s, u) => s + u.slots, 0);
const inBagCount = (pr) => (pr.items || []).filter((i) => i.loc !== 'wh').length;

// ---------- Батл-пасс ----------
const passSeason = () => Math.floor(Date.now() / (SHOP.pass.days * DAY));
const PASS_REWARDS = Array.from({ length: SHOP.pass.levels }, (_, i) => {
  const lvl = i + 1;
  const free = lvl % 10 === 0 ? { heroSpins: 1 } : lvl % 5 === 0 ? { itemSpins: 1 } : lvl % 3 === 0 ? { gems: 80 } : { gold: 80 + lvl * 20 };
  const RARE = { 5: 'rare', 10: 'epic', 15: 'epic', 20: 'legendary', 25: 'legendary', 30: 'legendary' }; // мифик на 30-м — только Орден Чемпиона (passClaim)
  const MATS = { 3: { scrollE: 1 }, 7: { ore: 20, ess: 10 }, 9: { scrollE: 1 }, 12: { core: 2 }, 17: { scrollE: 2 }, 21: { scrollL: 1 }, 24: { core: 3 }, 27: { scrollL: 1 }, 29: { scrollM: 1 } };
  const prem = RARE[lvl] ? { item: RARE[lvl] } : MATS[lvl] ? { mats: MATS[lvl] } : lvl % 2 ? { gold: 250 + lvl * 50 } : { itemSpins: 1 };
  return { lvl, free, prem };
});
function passOf(pr) {
  const s = passSeason();
  if (!pr.pass || pr.pass.season !== s) pr.pass = { season: s, xp: 0, tier: 0, free: [], prem: [] };
  if (pr.pass.tier === undefined) pr.pass.tier = pr.pass.premium ? 2 : 0; // старый «премиум» за 300 ⭐ = Серебряный орден
  return pr.pass;
}
const passTier = (pr) => passOf(pr).tier;
// Сколько наград сезона уже можно забрать (светящаяся точка в меню)
const passReady = (pr) => {
  const ps = passOf(pr), lvl = Math.floor(ps.xp / SHOP.pass.xpPerLevel);
  let n = 0;
  for (let l = 1; l <= Math.min(lvl, SHOP.pass.levels); l++) { if (!ps.free.includes(l)) n++; if (ps.tier >= 1 && !ps.prem.includes(l)) n++; }
  return n;
};
function addPassXp(pr, n) {
  const ps = passOf(pr);
  const k = ps.tier >= 2 ? 1.5 : 1; // Серебряный орден и выше: опыт пропуска +50%
  const f = n * k * (1 + require('./collection').k(pr, 'passXp')); // Светоносцы в коллекции — опыт ордена быстрее
  ps.xp = Math.min(SHOP.pass.levels * SHOP.pass.xpPerLevel, ps.xp + Math.floor(f) + (Math.random() < f % 1 ? 1 : 0));
}
// Счёт на орден: цена — разница с уже купленным в этом сезоне
// Личная цена ордена (админка → игрок → «Личная цена ордена»): { tier, stars } — разово, на один указанный орден.
// Пока орден не куплен — в окне орденов и в счёте цена из неё (без скидки первой покупки); после оплаты сгорает
const passDeal = (pr, tier) => (pr.passDeal && pr.passDeal.tier === tier && passTier(pr) < tier ? pr.passDeal : null);
function passInvoice(pr, tier) {
  const t = SHOP.passTiers[tier - 1], cur = passTier(pr);
  if (!t) return { error: 'Неизвестный орден' };
  if (cur >= tier) return { error: 'Этот орден уже открыт' };
  const paid = cur ? SHOP.passTiers[cur - 1].price : 0, deal = passDeal(pr, tier);
  if (deal) return { title: `${t.name} · личная цена`, description: `${cur ? 'Улучшение до ордена' : 'Сезонный орден'}: ${t.perks.join(', ')}`.slice(0, 255), amount: deal.stars, personal: true };
  return { title: `${t.name} · сезон`, description: cur ? `Улучшение до ордена: ${t.perks.join(', ')}` : `Сезонный орден: ${t.perks.join(', ')}`, amount: t.price - paid };
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

// ---------- Наценка на звёзды ----------
// Telegram оставляет разработчику ~65% цены звезды. Товары за ⭐ дороже в STAR_K раз, а оплата в GRAM/TON считается
// от базовой цены (⭐ / STAR_K) — выручка с обеих оплат почти одинаковая, а GRAM для игрока на треть дешевле и приходит сразу.
// Цены, которые и так только в GRAM (внешний вид, Рынок, взносы), не трогаем.
const STAR_K = Number(process.env.STAR_K) || 1.5;
const starPrice = (n) => Math.round(n * STAR_K); // ровно ×STAR_K — тогда цена в GRAM (⭐ / STAR_K) совпадает с прежней
if (STAR_K !== 1) {
  SHOP.itemSpin.price = starPrice(SHOP.itemSpin.price); SHOP.itemSpin.price10 = starPrice(SHOP.itemSpin.price10);
  for (const g of Object.values(SHOP.gems)) g.amount = starPrice(g.amount);
  for (const t of SHOP.passTiers) t.price = starPrice(t.price);
  SHOP.sub.price = starPrice(SHOP.sub.price);
  for (const u of WH_UPGRADES) if (u.stars) u.stars = starPrice(u.stars);
  { const C = require('./config'); C.GACHA.spinPrice = starPrice(C.GACHA.spinPrice); C.GACHA.spin10Price = starPrice(C.GACHA.spin10Price);
    for (const b of C.LOBBY_BACKGROUNDS) if (b.price > 0) b.price = starPrice(b.price); }
}
module.exports = function createMeta(deps) {
  const { C, getProfile, saveProfiles, players, refreshPlayer, notifyUid, profiles } = deps;
  let market = { lots: [], auctions: [], seq: 1 };
  market = { ...market, ...store.readJSON('market.json', {}) };
  let saveTm = null;
  const save = () => {
    saveProfiles();
    clearTimeout(saveTm);
    saveTm = setTimeout(() => { try { store.writeJSON('market.json', market); } catch (e) { console.error('market save', e.message); } }, 300);
  };
  const tierOf = (p) => p.zoneTier || 1;
  const F = (t) => I.TIER_MULT[t] || 1;
  const grant = (pr, item) => I.addItem(pr, item, bagSize(pr)); // добыча и призыв: дубликат усиливает оригинал
  const put = (pr, item) => I.addItem(pr, item, bagSize(pr), false); // покупка: предмет как есть
  const grantMsg = (res) => (res.dupe ? `Дубликат! ${I.itemView(res.item).name} усилен` : `Получено: ${I.itemView(res.item).name}`);
  const matName = (id, n) => `${I.MATS[id].icon} ${I.MATS[id].name}${n > 1 ? ` ×${n}` : ''}`;
  // Подпись награды пропуска с материалами (свитки, руда, сердца — для мира игрока); у остальных наград подпись строит клиент
  const rwT = (r, tier) => (r.mats ? { ...r, t: Object.entries(r.mats).map(([k, n]) => matName(matKey(k, tier), n)).join(', ') } : r);
  // Ключи 'ore' / 'ess' / 'core' в наградах — материал мира tier
  const matKey = (k, tier) => (['ore', 'ess', 'core'].includes(k) ? `${k}${tier}` : k);
  // Цена материала в лавке мира tier (у материалов мира цена своя, свитки и зелья дорожают по миру лавки)
// Новый баланс: золота с монстров вчетверо меньше — цены лавок снижены, чтобы ~1 час фарма своего мира хватало
  // на запас зелий и пару эликсиров, а вещи лавки оставались запасным вариантом (дешевле продажи назад не бывает)
  const B2K = { potion: 0.4, elixir: 0.25, mat: 0.4, scroll: 0.5 }; // зелья — вдвое дороже прежнего снижения: осторожнее в бою, автобой тратит золото
  const b2k = (kind) => (require('./mobs').bal2() ? B2K[kind] || 1 : 1);
  const shopPrice = (id, tier) => Math.max(Math.round(I.MATS[id].price * (I.MATS[id].tier ? 1 : F(tier)) * b2k(I.MATS[id].kind)), Math.round((I.MATS[id].buy || 0) * (I.MATS[id].tier ? 1 : F(tier)) * 1.5));

  // ---------- Витрины магазинов (обновляются раз в день, свои в каждом мире) ----------
  const shopCache = new Map();
  const ITEM_PRICE = { common: 400, rare: 2000, epic: 9000 }; // лавка — запасной вариант: хорошие вещи дают боссы, кузница и призыв
  const RUNE_PRICE = { common: 800, rare: 3500, epic: 12000 };
  // Вставка и извлечение рун — дорогие, чтобы руны не переставляли «когда захочется»: [золото вставки, золото извлечения, 💎 извлечения]
  // по редкости руны, × множитель мира руны. Извлечение в тот же день (МСК) дорожает: 2-е ×2, 3-е ×3…
  const RUNE_SOCK = { common: [300, 1000, 0], rare: [1200, 4000, 0], epic: [4000, 12000, 0], legendary: [12000, 30000, 50], mythic: [30000, 75000, 150] };
  const sockCost = (rune) => Math.round((RUNE_SOCK[rune.rar] || RUNE_SOCK.common)[0] * F(rune.tier || 1));
  const unsockCost = (pr, rune) => {
    const day = new Date(Date.now() + 3 * 36e5).toISOString().slice(0, 10);
    if (!pr.unsock || pr.unsock.day !== day) pr.unsock = { day, n: 0 };
    const k = 1 + pr.unsock.n, c = RUNE_SOCK[rune.rar] || RUNE_SOCK.common;
    return { gold: Math.round(c[1] * F(rune.tier || 1) * k), gems: c[2] * k, k };
  };
  function offers(kind, tier, cls = null) {
    if (kind !== 'equip') cls = null; // снаряжение — под класс героя, остальное одинаково для всех
    const key = `${dayKey()}:${kind}:${tier}:${cls || ''}`;
    if (shopCache.has(key)) return shopCache.get(key);
    const list = [];
    const B2 = require('./mobs').bal2();
    const price = (rar) => Math.round(ITEM_PRICE[rar] * F(tier) * (B2 ? 0.35 : 1));
    const matOffer = (mat, limit = 0) => list.push({ oid: list.length, mat, price: shopPrice(mat, tier), limit: limit || I.MATS[mat].limit || 0 });
    if (kind === 'equip') {
      // По обычному и редкому предмету на каждый слот и два эпических на день
      // Только то, что может надеть класс героя
      const mk = (cat, rar) => { const fit = I.TEMPLATES[cat] && Object.keys(I.TEMPLATES[cat]).filter((t) => !I.TEMPLATES[cat][t].setCls && (!cls || I.canWear({ cat, tpl: t }, I.CLASSES[cls].heroes[0]))); return I.createItem(cat, rar, tier, fit && fit.length ? fit[Math.floor(Math.random() * fit.length)] : null); };
      for (const cat of I.WEAR_CATS) for (const rar of ['common', 'rare']) list.push({ oid: list.length, item: mk(cat, rar), price: price(rar) });
      list.push({ oid: list.length, item: I.createBag('rare', tier), price: Math.round(40000 * F(tier) * (B2 ? 0.4 : 1)) }); // сумка — дорогое удовольствие
    } else if (kind === 'runes') {
      for (const rar of ['common', 'common', 'common', 'rare', 'rare', 'rare', 'epic']) list.push({ oid: list.length, item: I.createItem('rune', rar, tier), price: Math.round(RUNE_PRICE[rar] * F(tier) * (B2 ? 0.4 : 1)) });
    } else if (kind === 'smith') {
      // Руду и эссенцию продают только в Эльдмире: материалы Морграта и Аэлиона — только фармом
      if (tier === 1) { matOffer('ore1'); matOffer('ess1'); }
      matOffer('scrollR'); matOffer('scrollE');
    } else {
      for (const m of ['potHp', 'potHp2', 'potRes', 'elxAtk', 'elxDef', 'elxAgi', 'elxMind', 'elxWind', 'elxFury', 'elxVamp']) matOffer(m); // свиток возвращения убран: в город ведёт кнопка навигации
    }
    shopCache.set(key, list);
    return list;
  }
  const SHOP_KINDS = ['equip', 'alchemy', 'runes', 'smith'];

  function invView(p) {
    const pr = getProfile(p.uid);
    const st = I.setState(pr, p.heroId);
    return {
      items: (pr.items || []).map(I.itemView), equip: pr.equip, gear: I.gearStats(pr, p.heroId), gold: pr.gold, memory: require('./collection').view(pr), heroesN: (pr.heroes || []).length,
      mats: Object.entries(pr.mats || {}).filter(([id, n]) => n > 0 && I.MATS[id]).map(([id, n]) => I.matView(id, n, tierOf(p))),
      sets: { counts: st.counts, active: st.active, cls: st.cls, clsName: st.cls ? I.CLASSES[st.cls].name : null },
      bagSize: bagSize(pr), bagBase: isSub(pr) ? SHOP.bagSub : SHOP.bag, whSize: whSize(pr), whLvl: pr.whLvl || 0, whNext: WH_UPGRADES[pr.whLvl || 0] || null, whMax: WH_UPGRADES.length, sub: isSub(pr) ? pr.subUntil : 0, buffs: pr.buffs || {}, tier: tierOf(p),
      hero: { id: p.heroId, level: p.char.level, dupes: (pr.heroDupes || {})[p.heroId] || 0, unlocked: deps.unlockedSkills(pr, p.heroId), cls: I.classOf(p.heroId),
        skillUp: C.HEROES[p.heroId].skills.map((sk, i) => { const L = skillLv(pr, p.heroId, i); return { lvl: L, max: p.char.level, bonus: Math.round((I.skillMul(L) - 1) * 100), next: Math.round((I.skillMul(L + 1) - 1) * 100), cost: I.skillUpCost(L) }; }),
        dust: (pr.mats || {}).dust || 0, crystals: (pr.mats || {}).skillCrystal || 0,
        // Зал мастеров: ветка характеристик и мастерство пассивки
        tree: Object.fromEntries(Object.entries(I.TREE).map(([k, n]) => { const L = ((p.char.tree || {})[k]) || 0; return [k, { name: n.name, desc: n.desc, per: n.stats, lvl: L, max: I.TREE_MAX, req: I.treeReq(L), cost: I.treeCost(L) }]; })),
        pas: (() => { const L = p.char.pasLv || 1; return { lvl: L, max: I.PAS_MAX, req: I.pasReq(L), cost: I.pasCost(L), pct: Math.round(I.PAS_STEP * (L - 1) * 100), next: Math.round(I.PAS_STEP * L * 100) }; })() },
      // Все характеристики героя с учётом снаряжения, комплектов, эликсиров, спутника и Зала мастеров
      full: (() => {
        const g = I.gearStats(pr, p.heroId), H = C.HEROES[p.heroId], st = deps.statsFor(p.heroId, p.char.level, pr);
        return { hp: st.maxHp, dmg: st.dmg, res: st.resMax, resName: H.resource.name, regen: H.resource.regen, range: H.range,
          atkSec: Math.round(1000 / (H.cooldown / (1 + (g.aspd || 0) / 100)) * 100) / 100, aspd: g.aspd || 0, atkP: g.atkP || 0, hpP: g.hpP || 0,
          crit: Math.round((15 + (g.crit || 0)) * 10) / 10, critDmg: 200 + (g.critDmg || 0), def: g.def || 0, ls: g.ls || 0, skill: g.skill || 0, cdr: g.cdr || 0,
          ms: Math.round(H.speed * (1 + (g.ms || 0) / 100)), msP: g.ms || 0, gold: g.gold || 0, xp: g.xp || 0, luck: Math.round((I.buffLuck(pr) - 1) * 100), caps: I.CAPS };
      })(),
      classNames: Object.fromEntries(Object.entries(I.CLASSES).map(([k, c]) => [k, `${c.icon} ${c.name}`])),
      power: (({ hp, dmg, crit, power }) => ({ hp, dmg: Math.round(dmg), crit: Math.round(crit * 100), power }))(fighter(deps, pr, p.heroId, '')),
      itemSpins: pr.itemSpins || 0, heroSpins: pr.paidSpins || 0, freeItemSpins: freeSpinsLeft(pr), pity: typeof pr.pity === 'number' ? pr.pity : 0, pityMax: SHOP.pity, pityE: pr.pityE || 0, gems: pr.gems || 0, glitter: pr.glitter || 0, gemsPerWish: SHOP.gemsPerWish, gearBanner: gearBanner(),
      attrs: I.ATTRS, rarities: I.ITEM_RARITIES, rarOrder: I.RARITY_ORDER, cats: I.CATEGORIES, slots: I.SLOT_ORDER, slotNames: I.SLOT_NAMES,
    };
  }
  const freeSpinsLeft = (pr) => (pr.freeItemDay === dayKey() ? pr.freeItemLeft || 0 : (isSub(pr) ? SHOP.freeItemSpinsSub : SHOP.freeItemSpins) + (passTier(pr) >= 2 ? 1 : 0) + (passTier(pr) >= 7 ? 1 : 0) + (passTier(pr) >= 9 ? 1 : 0)); // Серебряный, Хранитель, Дракон: +1 в день
  // Какой день серии забирать сегодня: next — номер (0–6), streak — дней подряд
  function loginState(pr) {
    const L = pr.login || {}, today = mskDay(), yest = mskDay(Date.now() - 864e5);
    if (L.last === today) return { last: L.last, next: L.day, streak: L.streak || 1, done: true };
    const cont = L.last === yest;
    return { last: L.last, next: cont ? ((L.day ?? -1) + 1) % 7 : 0, streak: cont ? L.streak || 0 : 0, done: false };
  }
  function loginView(p, pr) {
    const L = loginState(pr), t = tierOf(p);
    const label = (r) => [r.gold && `💰 ${r.gold}`, r.gems && `💎 ${r.gems}`, r.itemSpins && `🎁 ×${r.itemSpins}`, r.heroSpins && `🔮 ×${r.heroSpins}`,
      ...Object.entries(r.mats || {}).map(([k, n]) => `${I.MATS[matKey(k, t)].name}${n > 1 ? ' ×' + n : ''}`)].filter(Boolean);
    return { card: cardReady(pr), day: L.next, done: L.done, streak: L.streak, days: LOGIN_REWARDS.map((r, i) => ({ i, items: label(r),
      art: Object.keys(r.mats || {}).map((k) => matKey(k, t))[0] || null, big: i === 6 })) };
  }
  const STARTER_MS = 72 * 3600e3;
  const mskDayKey = () => new Date(Date.now() + 3 * 36e5).toISOString().slice(0, 10);
  // Можно ли купить особый товар (null — можно, иначе причина)
  function canBuy(kind, pr) {
    if (kind !== 'starter') return null;
    if (pr.starterBought) return 'Набор новичка уже куплен';
    if (Date.now() > (pr.created || 0) + STARTER_MS) return 'Предложение для новичков закончилось';
    return null;
  }
  const cardReady = (pr) => !!(pr.card && pr.card.until > Date.now() && pr.card.last !== mskDayKey());
  function compView(pr) {
    const C2 = pr.comp || { owned: [], active: null };
    return { gems: pr.gems || 0, active: C2.active || null, list: Object.entries(I.COMPANIONS).map(([id, c]) => ({ id, name: c.name, rare: c.rare, price: c.price, art: c.art, w: c.w, h: c.h,
      bonus: Object.entries(c.bonus).map(([k, v]) => `${I.ATTRS[k] ? I.ATTRS[k][0] : k} +${v}%`).join(', '), owned: C2.owned.includes(id) })) };
  }
  function cosmView(pr) {
    const C2 = pr.cosm || { owned: [] };
    return { gems: pr.gems || 0, cur: { name: C2.name || null, aura: C2.aura || null, frame: C2.frame || null },
      list: Object.entries(COSMETICS).flatMap(([kind, L]) => Object.entries(L).filter(([id, c]) => !c.grant || C2.owned.includes(`${kind}:${id}`)).map(([id, c]) => ({ grant: !!c.grant, id: `${kind}:${id}`, kind, key: id, name: c.name, price: c.price || 0, gram: c.stars ? deps.gram.nano(c.stars) : 0,
        color: typeof c.color === 'number' ? '#' + c.color.toString(16).padStart(6, '0') : c.color || null, owned: C2.owned.includes(`${kind}:${id}`) }))) };
  }
  // Что видно другим: цвет имени и цвет сияния
  const cosmLook = (pr) => { const C2 = pr.cosm || {}; return { nc: C2.name ? COSMETICS.name[C2.name].color : null, au: C2.aura ? COSMETICS.aura[C2.aura].color : null, fr: C2.frame || null }; };
  const skillLv = (pr, heroId, i) => ((pr.skillLv || {})[heroId] || [])[i] || 1;
  const equipped = (pr, id) => Object.values(pr.equip || {}).includes(id);
  // Журнал покупок в лавках за сегодня (для возврата)
  const todayBuys = (pr) => (pr.buys || []).filter((b) => b.day === dayKey());
  const logBuy = (pr, b) => {
    pr.buys = [...todayBuys(pr), { ...b, id: Math.random().toString(36).slice(2, 9), day: dayKey(), at: Date.now() }].slice(-60);
  };

  // Выдать награду (батл-пасс, реклама)
  function reward(pr, r, tier) {
    const out = [];
    if (r.gold) { pr.gold += r.gold; out.push(`💰 ${r.gold}`); }
    if (r.itemSpins) { pr.itemSpins = (pr.itemSpins || 0) + r.itemSpins; out.push(`🎁 печать снаряжения ×${r.itemSpins}`); }
    if (r.gems) { pr.gems = (pr.gems || 0) + r.gems; out.push(`💎 ${r.gems} самоцветов`); }
    if (r.heroSpins) { pr.paidSpins = (pr.paidSpins || 0) + r.heroSpins; out.push(`🔮 печать призыва ×${r.heroSpins}`); }
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
      const res = grant(pr, I.refineItem(I.createSetItem(cls, t, roll < 0.015 ? 'mythic' : roll < 0.165 ? 'legendary' : 'epic'))); // за Stars — отборная
      return grantMsg(res);
    }
    return null;
  }

  const OPS = {
    inv: (p) => ({ inv: invView(p) }),
    // ---------- Спутники ----------
    companions(p, d, pr) { return { comp: compView(pr) }; },
    companionBuy(p, d, pr) {
      const id = String(d.id || ''), c = Object.hasOwn(I.COMPANIONS, id) ? I.COMPANIONS[id] : null;
      if (!c || !c.art) return { error: 'Этот спутник пока недоступен' };
      const C2 = (pr.comp ??= { owned: [], active: null });
      if (C2.owned.includes(id)) return { error: 'Уже есть' };
      if ((pr.gems || 0) < c.price) return { error: `Нужно ${c.price} 💎` };
      pr.gems -= c.price; C2.owned.push(id); C2.active = id;
      deps.companionChanged(p.uid);
      return { toast: `🐾 ${c.name} теперь с вами!`, comp: compView(pr) };
    },
    companionSet(p, d, pr) {
      const id = d.id ? String(d.id) : null, C2 = (pr.comp ??= { owned: [], active: null });
      if (id && !C2.owned.includes(id)) return { error: 'Сначала получите этого спутника' };
      C2.active = id;
      deps.companionChanged(p.uid);
      return { toast: id ? `🐾 ${I.COMPANIONS[id].name} рядом с вами` : 'Спутник отдыхает', comp: compView(pr) };
    },
    // ---------- Внешний вид ----------
    cosmetics(p, d, pr) { return { cosm: cosmView(pr) }; },
    cosmeticBuy(p, d, pr) {
      const [kind, id] = String(d.id || '').split(':'), c = COSMETICS[kind] && Object.hasOwn(COSMETICS[kind], id) ? COSMETICS[kind][id] : null;
      if (!c) return { error: 'Нет такого' };
      if (c.grant) return { error: 'Это не продаётся — только подарок основателям' };
      const C2 = (pr.cosm ??= { owned: [] });
      if (C2.owned.includes(d.id)) return { error: 'Уже куплено' };
      if (c.stars) { // за GRAM — с GRAM-баланса (server/trade.js)
        const nano = deps.gram.nano(c.stars);
        if (!deps.gram.spend(p.uid, nano, `Внешний вид: ${c.name}`)) return { error: `Нужно ${deps.gram.fmt(nano)} GRAM — пополните GRAM-кошелёк`, needGram: true };
      } else {
        if ((pr.gems || 0) < c.price) return { error: `Нужно ${c.price} 💎` };
        pr.gems -= c.price;
      }
      C2.owned.push(d.id); C2[kind] = id;
      deps.cosmeticsChanged(p.uid);
      return { toast: `✨ ${c.name} — куплено и надето`, cosm: cosmView(pr) };
    },
    cosmeticSet(p, d, pr) {
      const kind = String(d.kind || ''), id = d.id ? String(d.id) : null;
      if (!COSMETICS[kind] || !Object.hasOwn(COSMETICS, kind)) return { error: 'Нет такого' };
      const C2 = (pr.cosm ??= { owned: [] });
      if (id && !C2.owned.includes(`${kind}:${id}`)) return { error: 'Сначала купите' };
      C2[kind] = id;
      deps.cosmeticsChanged(p.uid);
      return { toast: id ? `✨ ${COSMETICS[kind][id].name} — надето` : 'Снято', cosm: cosmView(pr) };
    },
    // Уведомления в Telegram: вкл/выкл (Настройки)
    notify(p, d, pr) { if (typeof d.on === 'boolean') { pr.notifyOff = !d.on; if (d.on) pr.pushBlocked = false; } return { notify: !pr.notifyOff, tg: String(p.uid).startsWith('tg') }; },
    // ---------- Награда за вход ----------
    login(p, d, pr) { return { login: loginView(p, pr) }; },
    loginClaim(p, d, pr) {
      const L = loginState(pr), today = mskDay();
      if (L.last === today) return { error: 'Сегодня награда уже получена — приходите завтра', login: loginView(p, pr) };
      const r = LOGIN_REWARDS[L.next];
      const msg = reward(pr, r, tierOf(p));
      pr.login = { last: today, day: L.next, streak: L.streak + 1 };
      return { toast: `🎁 День ${L.next + 1}: ${msg}`, login: loginView(p, pr) };
    },
    // Улучшение умения: до уровня героя, за волшебную пыль, золото и (на 10/20/30/40) кристаллы мастерства
    skillUp(p, d, pr) {
      const i = Math.floor(Number(d.i)), H = C.HEROES[p.heroId];
      if (!(i >= 0 && i < H.skills.length)) return { error: 'Нет такого умения' };
      if (i >= deps.unlockedSkills(pr, p.heroId)) return { error: 'Сначала откройте это умение' };
      const L = skillLv(pr, p.heroId, i);
      if (L >= p.char.level) return { error: `Умение не выше уровня героя (${p.char.level}) — поднимите уровень` };
      const c = I.skillUpCost(L), mats = pr.mats || {};
      if ((mats.dust || 0) < c.dust) return { error: `Нужно ✨ ${c.dust} волшебной пыли (есть ${mats.dust || 0}) — она падает с полубоссов, боссов и мировых боссов` };
      if (c.skillCrystal && (mats.skillCrystal || 0) < c.skillCrystal) return { error: `Нужно 💠 ${c.skillCrystal} кристалл(а) мастерства — редкая добыча боссов` };
      if (pr.gold < c.gold) return { error: `Нужно ${c.gold} 💰` };
      I.takeMats(pr, c.skillCrystal ? { dust: c.dust, skillCrystal: c.skillCrystal } : { dust: c.dust });
      pr.gold -= c.gold;
      ((pr.skillLv ??= {})[p.heroId] ??= [])[i] = L + 1;
      return { toast: `${H.skills[i].icon} ${H.skills[i].name}: уровень ${L + 1} · сила +${Math.round((I.skillMul(L + 1) - 1) * 100)}%`, inv: invView(p) };
    },

    // Зал мастеров: +1 уровень узла ветки характеристик (не выше половины уровня героя, за золото)
    treeUp(p, d, pr) {
      const n = I.TREE[d.k];
      if (!n || !Object.hasOwn(I.TREE, d.k)) return { error: 'Нет такой характеристики' };
      const t = (p.char.tree ??= {}), L = t[d.k] || 0;
      if (L >= I.TREE_MAX) return { error: `${n.name}: максимальный уровень` };
      if (p.char.level < I.treeReq(L)) return { error: `Нужен ${I.treeReq(L)} уровень героя (сейчас ${p.char.level})` };
      const cost = I.treeCost(L);
      if (pr.gold < cost) return { error: `Нужно ${cost.toLocaleString('ru-RU')} 💰` };
      pr.gold -= cost; t[d.k] = L + 1;
      refreshPlayer(p);
      return { toast: `${n.name}: уровень ${L + 1}`, inv: invView(p) };
    },
    // Мастерство пассивного навыка: уровень не выше половины уровня героя, за золото и волшебную пыль
    pasUp(p, d, pr) {
      const H = C.HEROES[p.heroId];
      if (!H.passive) return { error: 'У героя нет пассивного навыка' };
      const L = p.char.pasLv || 1;
      if (L >= I.PAS_MAX) return { error: 'Пассивный навык уже максимального уровня' };
      if (p.char.level < I.pasReq(L)) return { error: `Нужен ${I.pasReq(L)} уровень героя (сейчас ${p.char.level})` };
      const c = I.pasCost(L), mats = pr.mats || {};
      if ((mats.dust || 0) < c.dust) return { error: `Нужно ✨ ${c.dust} волшебной пыли (есть ${mats.dust || 0})` };
      if (pr.gold < c.gold) return { error: `Нужно ${c.gold.toLocaleString('ru-RU')} 💰` };
      I.takeMats(pr, { dust: c.dust }); pr.gold -= c.gold; p.char.pasLv = L + 1;
      refreshPlayer(p);
      return { toast: `${H.passive.icon} ${H.passive.name}: уровень ${L + 1} · сила пассивки +${Math.round(I.PAS_STEP * L * 100)}%`, inv: invView(p) };
    },

    equip(p, d, pr) {
      if ((pr.karma || 0) > 0) return { error: '🔴 Пока вы красный, снимать и менять надетые вещи нельзя' };
      const it = I.findItem(pr, d.id);
      if (!it || !I.SLOTS[it.cat]) return { error: 'Этот предмет нельзя надеть' };
      if (it.plan) return { error: '📜 Это чертёж — сначала выкуйте вещь в кузнице' };
      if (!I.canWear(it, p.heroId)) { // класс героя: «Лучник не носит посох»
        const names = (I.classesFor(it) || []).map((c) => I.CLASSES[c].name).join(', ');
        return { error: `${C.HEROES[p.heroId].name} не может это надеть — только для: ${names}` };
      }
      if (p.char.level < I.reqLevel(it)) return { error: `Нужен ${I.reqLevel(it)} уровень героя — у ${C.HEROES[p.heroId].name} сейчас ${p.char.level}` };
      if (it.cat === 'bag') { // меньшая сумка: вещи должны поместиться
        const cap = bagSize(pr) - bagBonus(pr) + (I.BAG_SLOTS[it.rar] || 0);
        if (inBagCount(pr) > cap) return { error: `В эту сумку не поместится: освободите ${inBagCount(pr) - cap} ячеек (перенесите на склад)` };
      }
      pr.equip ??= {};
      // Слот: для кольца — указанный (ring / ring2) или первый свободный из двух
      let slot = it.cat;
      if (it.cat === 'ring') slot = d.slot === 'ring2' || d.slot === 'ring' ? d.slot : !pr.equip.ring ? 'ring' : !pr.equip.ring2 ? 'ring2' : 'ring';
      for (const s of Object.keys(pr.equip)) if (pr.equip[s] === it.id) pr.equip[s] = null;
      pr.equip[slot] = it.id;
      it.loc = 'bag';
      // Новый баланс: надетая мифическая вещь привязывается к владельцу — продать или передать её больше нельзя
      const bind = require('./mobs').bal2() && it.rar === 'mythic' && !it.bound;
      if (bind) it.bound = 1;
      refreshPlayer(p);
      return { toast: `Надето: ${I.itemView(it).name}${bind ? ' · 🔒 привязана к вам' : ''}` };
    },
    // Ремонт в кузнице: одна вещь (d.id) или всё надетое (d.all)
    repair(p, d, pr) {
      const list = d.all ? Object.values(pr.equip || {}).map((id) => id && I.findItem(pr, id)).filter(Boolean) : [I.findItem(pr, d.id)].filter(Boolean);
      const need = list.filter((it) => I.repairCost(it) > 0);
      if (!need.length) return { error: 'Чинить нечего' };
      const cost = need.reduce((a, it) => a + I.repairCost(it), 0);
      if ((pr.gold || 0) < cost) return { error: `Нужно ${cost} 💰` };
      pr.gold -= cost;
      for (const it of need) it.dur = 100;
      refreshPlayer(p);
      return { toast: `🔧 Починено: ${need.length} · −${cost} 💰`, gold: pr.gold };
    },
    unequip(p, d, pr) {
      if ((pr.karma || 0) > 0) return { error: '🔴 Пока вы красный, снимать и менять надетые вещи нельзя' };
      if (!pr.equip?.[d.slot]) return { error: 'Слот пуст' };
      if (d.slot === 'bag' && inBagCount(pr) > bagSize(pr) - bagBonus(pr)) {
        return { error: `Без сумки вещи не поместятся: освободите ${inBagCount(pr) - (bagSize(pr) - bagBonus(pr))} ячеек` };
      }
      pr.equip[d.slot] = null;
      refreshPlayer(p);
      return {};
    },
    // Автосоединение: по 5 одинаковых (категория + редкость) снизу вверх, до легендарного. Не трогает надетое, склад,
    // комплектные, заточенные, с дубликатами, с рунами и тиражные — у них при соединении пропала бы ценность.
    // preview — только посчитать, сколько соединений будет
    mergeAuto(p, d, pr) {
      // Каждая вещь — это 1 + дубликаты (★) копий: 5 копий одной категории и редкости → 1 вещь следующей редкости.
      // Не трогаем надетое, склад, комплектные, заточенные, с рунами и тиражные
      const eq = new Set(Object.values(pr.equip || {}));
      const ok = (i) => i.loc !== 'wh' && !eq.has(i.id) && !['bag', 'rune', 'mat'].includes(i.cat) && !I.setIdOf(i) && !(i.ench > 0) && !(i.runes && i.runes.length) && !i.ltd && !i.locked && !i.plan;
      const ORDER = ['common', 'rare', 'epic'];
      const made = { rare: 0, epic: 0, legendary: 0 }; let used = 0, stars = 0;
      if (d.preview) {
        const cnt = {};
        for (const i of pr.items || []) if (ok(i) && ORDER.includes(i.rar)) { cnt[i.cat + ':' + i.rar] = (cnt[i.cat + ':' + i.rar] || 0) + 1 + (i.dupes || 0); stars += i.dupes || 0; }
        for (const r of ORDER) for (const k of Object.keys(cnt)) {
          const [cat, rr] = k.split(':'); if (rr !== r) continue;
          const n = Math.floor(cnt[k] / 5); if (!n) continue;
          const nx = I.RARITY_ORDER[I.RARITY_ORDER.indexOf(r) + 1];
          made[nx] += n; used += n * 5; cnt[k] -= n * 5; cnt[cat + ':' + nx] = (cnt[cat + ':' + nx] || 0) + n;
        }
        return { preview: { made, used, stars } };
      }
      let seq = 0;
      for (const r of ORDER) {
        let again = true;
        while (again) {
          again = false;
          const groups = {};
          for (const i of pr.items || []) if (ok(i) && i.rar === r) (groups[i.cat] ??= []).push(i);
          for (const list of Object.values(groups)) {
            if (list.reduce((x, i) => x + 1 + (i.dupes || 0), 0) < 5) continue;
            list.sort((a, b) => (a.tier || 1) - (b.tier || 1)); // сначала вещи младших миров
            // 5 копий: сначала «звёздочки» (копия-клон, у вещи −1 ★), потом сами вещи без звёзд
            const ids = [];
            for (const it of list) {
              while (ids.length < 5 && (it.dupes || 0) > 0) { it.dupes--; const c = { ...it, id: 'mx' + Date.now().toString(36) + (seq++), dupes: 0 }; delete c.runes; if (it.cat === 'weapon') c.runes = []; pr.items.push(c); ids.push(c.id); }
              if (ids.length >= 5) break;
            }
            for (const it of list) { if (ids.length >= 5) break; if (!(it.dupes > 0) && !ids.includes(it.id) && pr.items.includes(it)) ids.push(it.id); }
            if (ids.length < 5) continue;
            const res = I.mergeItems(pr, ids);
            if (res.error) continue;
            made[res.item.rar] = (made[res.item.rar] || 0) + 1; used += 5; again = true;
          }
        }
      }
      if (!used) return { error: 'Нечего соединять: нужно 5 копий одной категории и редкости (★ тоже считаются), без заточки, рун и не из комплекта' };
      refreshPlayer(p);
      const R = I.ITEM_RARITIES;
      return { toast: `Автосоединение: ${used} копий → ${Object.entries(made).filter(([, n]) => n).map(([k, n]) => `${R[k].name.toLowerCase()} ×${n}`).join(', ')}` };
    },
    merge(p, d, pr) {
      const r = I.mergeItems(pr, d.ids || []);
      if (r.error) return { error: r.error };
      refreshPlayer(p);
      return { result: I.itemView(r.item), toast: `Соединение: ${I.itemView(r.item).name} (${I.ITEM_RARITIES[r.item.rar].name})` };
    },

    // ---------- Кузница: рецепты мира (что получится и что для этого нужно) ----------
    recipes(p, d, pr) {
      const t = [1, 2, 3].includes(+d.tier) ? +d.tier : tierOf(p), here = tierOf(p) === t, cls = I.classOf(p.heroId);
      const free = (pr.items || []).filter((it) => it.loc !== 'wh' && !equipped(pr, it.id) && it.cat !== 'rune' && !it.plan);
      return { tier: t, here, title: I.WORLD_CRAFT[t].title, gold: pr.gold, stones: (pr.mats || {}).luckStone || 0, stone: { ...I.LUCK_STONE, ...I.matView('luckStone') }, cls, clsName: I.CLASSES[cls] && I.CLASSES[cls].name, list: I.worldRecipes(t).map((r) => {
        // Подходящие вещи: этого слота, нужной редкости и мира, не надеты; первой — самая «простая» (без усиления и рун)
        const items = r.needItem ? free.filter((it) => it.cat === r.needItem.cat && it.rar === r.needItem.rar && it.tier === r.needItem.tier)
          .sort((a, b) => (a.dupes || 0) - (b.dupes || 0) || ((a.runes || []).length - (b.runes || []).length)).map(I.itemView) : [];
        const mats = Object.entries(r.mats).map(([k, n]) => ({ ...I.matView(k, n), need: n, have: (pr.mats || {})[k] || 0 }));
        const ok = (!r.needItem || items.length > 0) && mats.every((m) => m.have >= m.need) && pr.gold >= r.gold;
        return { id: r.id, kind: r.kind, slot: r.slot, slotName: I.SLOT_NAMES[r.slot], name: r.name, rar: r.rar, rarName: I.ITEM_RARITIES[r.rar].name, color: I.ITEM_RARITIES[r.rar].color,
          chance: r.chance, needItem: r.needItem && { ...r.needItem, rarName: I.ITEM_RARITIES[r.needItem.rar].name, color: I.ITEM_RARITIES[r.needItem.rar].color }, items, mats, gold: r.gold, ok };
      }) };
    },
    craft(p, d, pr) {
      const r = I.findRecipe(d.id);
      if (!r) return { error: 'Нет такого рецепта' };
      if (r.tier !== tierOf(p)) return { error: `Этот рецепт куют только в кузнице своего мира` };
      let it = null;
      if (r.needItem) {
        it = I.findItem(pr, d.item);
        if (!it || it.cat !== r.needItem.cat || it.rar !== r.needItem.rar || it.tier !== r.needItem.tier || it.loc === 'wh') return { error: `Нужен предмет: ${I.SLOT_NAMES[r.slot]} (${I.ITEM_RARITIES[r.needItem.rar].name.toLowerCase()}) этого мира` };
        if (equipped(pr, it.id)) return { error: 'Снимите предмет, прежде чем перековать его' };
        if (it.plan) return { error: 'Чертёж сначала выкуйте' };
      }
      if (pr.gold < r.gold) return { error: `Нужно ${r.gold} золота` };
      if (!Object.entries(r.mats).every(([k, n]) => ((pr.mats || {})[k] || 0) >= n)) return { error: 'Не хватает материалов' };
      const st = Math.max(0, Math.min(I.LUCK_STONE.max, Math.floor(+d.stones || 0), (pr.mats || {}).luckStone || 0)); // камни удачи
      const chance = Math.min(I.LUCK_STONE.cap, r.chance + st * I.LUCK_STONE.per);
      I.takeMats(pr, st ? { ...r.mats, luckStone: st } : r.mats);
      pr.gold -= r.gold;
      // Ковка может не удаться: материалы, камни и золото сгорают, сама вещь остаётся как была
      if (Math.random() >= chance) return { failed: true, toast: `💥 Ковка не удалась (шанс был ${Math.round(chance * 100)}%) — материалы и золото сгорели` };
      let res;
      if (it) { it.rar = r.rar; it.attrs = I.rollAttrs(r.rar, it.tier); res = it; } // тот же предмет — следующей редкости
      else { const out = put(pr, I.SET_SLOTS.includes(r.slot) ? I.createSetItem(I.classOf(p.heroId), r.tier, r.rar, r.slot) : I.createItem(r.slot, r.rar, r.tier, null, I.classOf(p.heroId))); if (out.error) return { error: out.error }; res = out.item; }
      refreshPlayer(p);
      return { result: I.itemView(res), toast: `⚒️ Создано: ${I.itemView(res).name} (${I.ITEM_RARITIES[res.rar].name})` };
    },

    // ---------- Кузница: улучшение, вещи комплектов, разбор ----------
    craftInfo(p, d, pr) {
      const it = I.findItem(pr, d.id);
      if (!it) return { error: 'Предмет не найден' };
      if (it.plan) { const c = I.planCost(it); return { plan: { ...c, have: Object.fromEntries(Object.keys(c.need).map((k) => [k, (pr.mats || {})[k] || 0])), names: Object.fromEntries(Object.keys(c.need).map((k) => [k, matName(k, 1)])) }, salvage: Object.entries(I.salvage(it, true)).map(([k, n]) => matName(k, n)).join(', ') }; }
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
      if (it.plan) return { error: 'Чертёж сначала выкуйте' };
      const up = I.upgradeCost(it);
      if (!up) return { error: it.rar === 'legendary' && it.tier < 2 ? 'Мифические вещи куются только из вещей второго и третьего мира' : 'Этот предмет нельзя улучшить' };
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
      if (it.plan) return { error: 'Чертёж сначала выкуйте' };
      const c = I.setCraftCost(it, bp.set);
      if (pr.gold < c.gold) return { error: `Нужно ${c.gold} золота` };
      if (!I.takeMats(pr, c.need)) return { error: 'Не хватает материалов' };
      pr.gold -= c.gold;
      it.tpl = `set_${I.SETS[bp.set].cls}`;
      refreshPlayer(p);
      return { result: I.itemView(it), toast: `🗺️ Создано: ${I.itemView(it).name}` };
    },
    // Ковка по чертежу: материалы мира вещи + золото, успех 100%. Вещь выходит такой, какой была видна в чертеже
    planForge(p, d, pr) {
      const it = I.findItem(pr, d.id);
      if (!it || !it.plan) return { error: 'Чертёж не найден' };
      const c = I.planCost(it);
      if ((pr.gold || 0) < c.gold) return { error: `Нужно ${c.gold.toLocaleString('ru-RU')} 💰` };
      if (!I.takeMats(pr, c.need)) return { error: `Не хватает: ${Object.entries(c.need).filter(([k, n]) => ((pr.mats || {})[k] || 0) < n).map(([k, n]) => matName(k, n)).join(', ')}` };
      pr.gold -= c.gold;
      delete it.plan;
      it.smith = p.name; // имя мастера — в карточке вещи
      return { result: I.itemView(it), toast: `⚒️ Выковано: ${I.itemView(it).name} (${I.ITEM_RARITIES[it.rar].name})` };
    },
    // Заточка вещи (кузница): цена — I.enchCost, шанс падает с +4; с +7 неудача снижает заточку на 1
    enchant(p, d, pr) {
      const it = I.findItem(pr, d.id);
      if (!it || it.cat === 'rune' || it.cat === 'bag' || !I.WEAR_CATS.includes(it.cat)) return { error: 'Заточить можно только снаряжение' };
      if (it.plan) return { error: 'Чертёж сначала выкуйте' };
      const L = it.ench || 0;
      if (L >= I.ENCH.max) return { error: `Максимальная заточка +${I.ENCH.max}` };
      const c = I.enchCost(it), luck = !!d.luck && L >= 3;
      if (pr.gold < c.gold) return { error: `Нужно ${c.gold} 💰` };
      for (const [k, n] of Object.entries(c.mats)) if (((pr.mats || {})[k] || 0) < n) return { error: `Не хватает: ${I.MATS[k].name} ×${n}` };
      if (luck && !((pr.mats || {}).luckStone > 0)) return { error: 'Нет камня удачи' };
      pr.gold -= c.gold;
      I.takeMats(pr, { ...c.mats, ...(luck ? { luckStone: 1 } : {}) });
      const chance = Math.min(1, c.chance + (luck ? I.ENCH.luck : 0));
      const ok = Math.random() < chance;
      let msg;
      if (ok) { it.ench = L + 1; msg = `⚒ Успех! Заточка +${it.ench}`; }
      else if (L >= I.ENCH.dropFrom) { it.ench = L - 1; msg = `💥 Неудача — заточка упала до +${it.ench}`; }
      else msg = '💥 Неудача — заточка не изменилась';
      if (equipped(pr, it.id)) refreshPlayer(p);
      deps.quest(p.uid, 'enchant', 1);
      return { toast: msg, ok, ench: it.ench || 0, item: I.itemView(it) };
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

    // Разбор нескольких вещей сразу: quote — только показать, что выйдет (ядро у легендарных — с шансом 30%)
    salvageMany(p, d, pr) {
      const ids = [...new Set((Array.isArray(d.ids) ? d.ids : []).map(String))].slice(0, 200);
      const list = ids.map((id) => I.findItem(pr, id)).filter((it) => it && !equipped(pr, it.id) && it.loc !== 'wh');
      if (!list.length) return { error: 'Выберите вещи для разбора' };
      if (d.quote) {
        const sure = {}; let coreChance = 0;
        for (const it of list) {
          for (const [k, n] of Object.entries(I.salvage(it, true))) sure[k] = (sure[k] || 0) + n;
          if (it.rar === 'legendary') coreChance++;
        }
        return { quote: { n: list.length, mats: Object.entries(sure).filter(([, n]) => n > 0).map(([k, n]) => matName(k, n)), icons: Object.entries(sure).filter(([, n]) => n > 0).map(([k, n]) => I.matView(k, n, tierOf(p))), coreChance } };
      }
      const got = {};
      for (const it of list) {
        const out = I.salvage(it);
        I.detach(pr, it);
        pr.items = pr.items.filter((i) => i !== it);
        for (const [k, n] of Object.entries(out)) { I.addMat(pr, k, n); got[k] = (got[k] || 0) + n; }
      }
      return { toast: `♻️ Разобрано вещей: ${list.length} → ${Object.entries(got).map(([k, n]) => matName(k, n)).join(', ')}` };
    },

    // ---------- Расходники и ларцы ----------
    useMat(p, d, pr) {
      const id = d.mat, m = I.MATS[id];
      if (!m || !(pr.mats || {})[id]) return { error: 'Нет такого предмета' };
      const now = Date.now();
      let msg = '', healed = 0;
      if (m.kind === 'potion') {
        if (p.dead) return { error: 'Герой повержен' };
        if (/^surv\d/.test(String(p.zone))) return { error: 'В данже выживания зелья запрещены — только сила героя' };
        if (/^pvp/.test(String(p.zone))) return { error: 'На арене зелья запрещены — только сила героя' };
        if (now < (p.potionAt || 0)) return { error: `Зелье будет готово через ${Math.ceil((p.potionAt - now) / 1000)} с` };
        if (m.heal && !m.res && p.hp >= p.maxHp) return { error: 'Здоровье и так полное' }; // не тратим зелье впустую
        p.potionAt = now + 8000;
        const pkz = /^pk_/.test(String(p.zone)); // опасный данж: зелья на 70% слабее (и лечение, и ресурс)
        const hk = m.heal ? m.heal * (1 + require('./collection').k(pr, 'potion')) * (pkz ? 0.3 : 1) : 0; // Друиды в коллекции — зелья сильнее
        if (m.heal) { healed = Math.round(Math.min(p.maxHp - p.hp, p.maxHp * hk)); p.hp = Math.min(p.maxHp, p.hp + p.maxHp * hk); msg = `${m.icon} +${healed} здоровья`; }
        if (m.res) { p.res = Math.min(p.resMax, p.res + p.resMax * m.res * (pkz ? 0.3 : 1)); msg = `${m.icon} ресурс восстановлен`; }
      } else if (m.kind === 'elixir') {
        pr.buffs ??= {};
        const mins = Math.round((m.mins || 30) * (1 + require('./collection').k(pr, 'elixir'))); // Стихийники в коллекции — дольше
        pr.buffs[m.buff] = Math.max(now, pr.buffs[m.buff] || 0) + mins * 60000;
        msg = `${m.icon} ${m.name}: ещё ${mins >= 60 ? `${mins / 60} ч` : `${mins} минут`}`;
      } else if (m.kind === 'scrollTp') {
        if (!deps.toTown(p)) return { error: 'Вы уже в городе' };
        msg = `${m.icon} Возвращение в город`;
      } else if (m.kind === 'chest') {
        msg = `${m.icon} ${m.name}: ${openChest(p, pr, id, d)}`;
      } else return { error: 'Этот предмет используется в кузнице' };
      I.takeMats(pr, { [id]: 1 });
      refreshPlayer(p);
      return { toast: msg, healed };
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
      if (w.plan) return { error: 'Чертёж сначала выкуйте' };
      if (!rune || rune.cat !== 'rune') return { error: 'Выберите руну' };
      w.runes ??= [];
      if (w.runes.length >= I.ITEM_RARITIES[w.rar].sockets) return { error: 'Все гнёзда заняты' };
      if (w.runes.some((r) => r.tpl === rune.tpl)) return { error: 'Такая руна уже стоит в этом оружии — нужны разные руны' };
      const cost = sockCost(rune);
      if (d.quote) return { quote: { gold: cost, gems: 0 } };
      if ((pr.gold || 0) < cost) return { error: `Вставка руны стоит ${cost.toLocaleString('ru-RU')} 💰` };
      pr.gold -= cost;
      pr.items = pr.items.filter((i) => i !== rune);
      delete rune.loc;
      w.runes.push(rune);
      refreshPlayer(p);
      return { toast: `${I.itemView(rune).name} вставлена в ${I.itemView(w).name} (−${cost.toLocaleString('ru-RU')} 💰)` };
    },
    unsocket(p, d, pr) {
      const w = I.findItem(pr, d.weapon);
      if (!w || !w.runes || !w.runes[d.idx]) return { error: 'Руна не найдена' };
      const c = unsockCost(pr, w.runes[d.idx]);
      if (d.quote) return { quote: c };
      if ((pr.gold || 0) < c.gold || (pr.gems || 0) < c.gems) return { error: `Извлечение стоит ${c.gold.toLocaleString('ru-RU')} 💰${c.gems ? ` и ${c.gems} 💎` : ''}` };
      if (pr.items.filter((i) => i.loc !== 'wh').length >= bagSize(pr)) return { error: 'Сумка полна — освободите место' };
      pr.gold -= c.gold; if (c.gems) pr.gems -= c.gems;
      pr.unsock.n++;
      const [rune] = w.runes.splice(d.idx, 1);
      rune.loc = 'bag';
      pr.items.push(rune);
      refreshPlayer(p);
      return { toast: `Руна извлечена (−${c.gold.toLocaleString('ru-RU')} 💰${c.gems ? `, −${c.gems} 💎` : ''})` };
    },
    // Улучшение склада: +50 ячеек за уровень, до 5 уровней
    whUpgrade(p, d, pr) {
      const lvl = pr.whLvl || 0, u = WH_UPGRADES[lvl];
      if (!u) return { error: 'Склад уже улучшен до максимума' };
      if (u.stars) return { error: `Этот уровень склада — за ${u.stars} ⭐`, buy: u.kind };
      if ((pr.gold || 0) < u.gold) return { error: `Нужно ${u.gold.toLocaleString('ru-RU')} 💰` };
      if (u.gems && (pr.gems || 0) < u.gems) return { error: `Нужно ${u.gems} 💎` };
      pr.gold -= u.gold;
      if (u.gems) pr.gems -= u.gems;
      pr.whLvl = lvl + 1;
      return { toast: `Склад улучшен: ${whSize(pr)} ячеек` };
    },
    store(p, d, pr) {
      const it = I.findItem(pr, d.id);
      if (!it || equipped(pr, it.id)) return { error: 'Снимите предмет перед переносом' };
      const toWh = it.loc !== 'wh';
      const count = pr.items.filter((i) => (i.loc === 'wh') === toWh).length;
      if (count >= (toWh ? whSize(pr) : bagSize(pr))) return { error: toWh ? 'Склад полон — улучшите его' : 'Сумка полна' };
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
      const list = offers(kind, tierOf(p), I.classOf(p.heroId));
      const bought = pr.shopDay === dayKey() ? pr.shopBought || [] : [];
      const cnt = (o) => bought.filter((k) => k === `${kind}:${tierOf(p)}:${o.oid}`).length;
      return { offers: list.map((o) => ({ oid: o.oid, price: o.price, sold: o.item ? cnt(o) > 0 : o.limit ? cnt(o) >= o.limit : false,
        left: o.limit ? o.limit - cnt(o) : null, item: o.item ? I.itemView(o.item) : null, mat: o.mat ? I.matView(o.mat, 1, tierOf(p)) : null })) };
    },
    buy(p, d, pr) {
      const kind = SHOP_KINDS.includes(d.kind) ? d.kind : 'equip';
      const o = offers(kind, tierOf(p), I.classOf(p.heroId)).find((x) => x.oid === d.oid);
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
        logBuy(pr, { kind, mat: o.mat, n, gold: o.price * n, key: o.limit ? key : null });
        return { toast: `Куплено: ${matName(o.mat, n)} · вернуть можно сегодня во вкладке «Возврат»` };
      }
      // Каждый предмет витрины можно купить раз в день
      if (done) return { error: 'Уже куплено сегодня — витрина обновится завтра' };
      if (pr.items.filter((i) => i.loc !== 'wh').length >= bagSize(pr)) return { error: 'Сумка полна — освободите место или перенесите вещи на склад' };
      if (pr.gold < o.price) return { error: 'Не хватает золота' };
      pr.gold -= o.price;
      pr.shopBought.push(key);
      const copy = { ...JSON.parse(JSON.stringify(o.item)), id: I.createItem(o.item.cat, o.item.rar).id };
      const res = put(pr, copy);
      logBuy(pr, { kind, itemId: res.item.id, name: I.itemView(res.item).name, gold: o.price, key });
      return { toast: grantMsg(res) + ' · вернуть можно сегодня во вкладке «Возврат»' };
    },
    // ---------- Возврат покупок из лавок (только золото, в тот же день) ----------
    buys(p, d, pr) {
      const list = todayBuys(pr).map((b) => {
        const it = b.itemId ? I.findItem(pr, b.itemId) : null;
        const ok = b.itemId ? !!it && !equipped(pr, it.id) && !(it.dupes || 0) && !it.ench && !(it.runes || []).length : (pr.mats || {})[b.mat] >= b.n;
        return { id: b.id, gold: b.gold, at: b.at, n: b.n || 1, item: it ? I.itemView(it) : null, mat: b.mat ? I.matView(b.mat, b.n, tierOf(p)) : null, name: b.name, ok,
          why: ok ? '' : b.itemId ? (!it ? 'предмета уже нет' : equipped(pr, it.id) ? 'снимите предмет' : 'предмет изменён') : 'не хватает в сумке' };
      });
      return { buys: list.reverse() };
    },
    refund(p, d, pr) {
      const all = todayBuys(pr), b = all.find((x) => x.id === d.id);
      if (!b) return { error: 'Вернуть можно только сегодняшние покупки' };
      if (b.itemId) {
        const it = I.findItem(pr, b.itemId);
        if (!it) return { error: 'Предмета уже нет' };
        if (equipped(pr, it.id)) return { error: 'Сначала снимите предмет' };
        if ((it.dupes || 0) || it.ench || (it.runes || []).length) return { error: 'Предмет усилен или с рунами — вернуть нельзя' };
        pr.items = pr.items.filter((i) => i !== it);
      } else if (!I.takeMats(pr, { [b.mat]: b.n })) return { error: 'В сумке уже нет столько — вернуть нельзя' };
      pr.gold += b.gold;
      if (b.key && pr.shopDay === dayKey()) for (let i = 0; i < (b.itemId ? 1 : b.n); i++) { const k = pr.shopBought.indexOf(b.key); if (k >= 0) pr.shopBought.splice(k, 1); }
      pr.buys = (pr.buys || []).filter((x) => x.id !== b.id);
      refreshPlayer(p);
      return { toast: `Возвращено: +${b.gold.toLocaleString('ru-RU')} 💰` };
    },

    // ---------- Призыв предметов ----------
    itemSpin(p, d, pr) {
      const n = d.n === 10 ? 10 : 1;
      if (pr.pity && typeof pr.pity === 'object') pr.pity = 0; // старый формат счётчика гаранта героя
      const free = freeSpinsLeft(pr);
      const useFree = Math.min(free, n), tickets = Math.min(pr.itemSpins || 0, n - useFree), gems = (n - useFree - tickets) * SHOP.gemsPerWish;
      if ((pr.gems || 0) < gems) return { error: 'Не хватает печатей или самоцветов', needPayment: true };
      if (pr.freeItemDay !== dayKey()) { pr.freeItemDay = dayKey(); pr.freeItemLeft = free; }
      pr.freeItemLeft -= useFree;
      pr.itemSpins = (pr.itemSpins || 0) - tickets;
      pr.gems = (pr.gems || 0) - gems;
      deps.quest(p.uid, 'summon', n);
      const results = [], feat = gearBanner();
      for (let i = 0; i < n; i++) {
        pr.pity = (pr.pity || 0) + 1;
        pr.pityE = (pr.pityE || 0) + 1;
        let rar = I.rollRarity(ITEM_GACHA);
        if (pr.pity >= SHOP.pity && I.RARITY_ORDER.indexOf(rar) < 3) rar = 'legendary';
        else if (pr.pityE >= 10 && I.RARITY_ORDER.indexOf(rar) < 2) rar = 'epic'; // эпический и лучше — не реже раза в 10
        if (I.RARITY_ORDER.indexOf(rar) >= 3) pr.pity = 0;
        if (I.RARITY_ORDER.indexOf(rar) >= 2) pr.pityE = 0;
        // Комплект недели: легендарная и лучше — в половине случаев его вещь; эпическая — с шансом 25% вещь комплекта
        const hi = I.RARITY_ORDER.indexOf(rar) >= 3;
        const setPiece = hi ? Math.random() < 0.5 : I.RARITY_ORDER.indexOf(rar) >= 2 && Math.random() < 0.25;
        const cls = hi ? feat.cls : Math.random() < 0.5 ? I.classOf(p.heroId) : null;
        const res = grant(pr, I.refineItem(setPiece ? I.createSetItem(cls, tierOf(p), rar) : I.rollItem(tierOf(p), { [rar]: 1 }, null, p.heroId)));
        results.push({ ...I.itemView(res.item), dupe: res.dupe });
      }
      addPassXp(pr, 5 * n);
      refreshPlayer(p);
      return { results };
    },

    // Рынок и аукцион за золото убраны: торговля — за GRAM (server/trade.js: Рынок и Торговый дом)

    // ---------- Профиль другого игрока (тап по персонажу на карте) ----------
    inspect(p, d) {
      const t = players.get(String(d.id || ''));
      if (!t) return { error: 'Игрок уже вышел из игры' };
      const pr = getProfile(t.uid), items = pr.items || [];
      const worn = Object.entries(pr.equip || {}).map(([slot, id]) => {
        const it = items.find((i) => i.id === id);
        return it ? { ...I.itemView(it), slot } : null;
      }).filter(Boolean);
      const f = fighter(deps, pr, t.heroId, '');
      const a = pr.arena || {};
      return { player: {
        id: t.id, name: t.name, hero: t.heroId, level: t.char.level, dupes: (pr.heroDupes || {})[t.heroId] || 0,
        power: { hp: f.hp, dmg: Math.round(f.dmg), crit: Math.round(f.crit * 100), power: f.power },
        worn, slots: I.SLOT_ORDER, slotNames: I.SLOT_NAMES, rating: a.hero ? a.rating : null,
        heroes: (pr.heroes || []).length, title: pr.title || null, me: t.id === p.id, party: t.party || null, myParty: p.party || null,
      } };
    },

    // ---------- Батл-пасс ----------
    pass(p, d, pr) {
      const ps = passOf(pr);
      const paid = ps.tier ? SHOP.passTiers[ps.tier - 1].price : 0;
      return { pass: { ...ps, premium: ps.tier >= 1, level: Math.floor(ps.xp / SHOP.pass.xpPerLevel), xpPerLevel: SHOP.pass.xpPerLevel,
        ends: (passSeason() + 1) * SHOP.pass.days * DAY, rewards: PASS_REWARDS.map((r) => ({ ...r, free: rwT(r.free, tierOf(p)), prem: rwT(r.prem, tierOf(p)) })),
        freeOrder: SHOP.passFree, tiers: SHOP.passTiers.map((t) => { const deal = passDeal(pr, t.tier); return { ...t, cost: deal ? deal.stars : Math.max(0, t.price - paid), deal: !!deal, owned: ps.tier >= t.tier }; }) } };
    },
    passClaim(p, d, pr) {
      const ps = passOf(pr), lvl = +d.lvl, track = d.track === 'prem' ? 'prem' : 'free';
      const rw = PASS_REWARDS[lvl - 1];
      if (!rw || Math.floor(ps.xp / SHOP.pass.xpPerLevel) < lvl) return { error: 'Уровень ещё не достигнут' };
      if (track === 'prem' && ps.tier < 1) return { error: 'Нужен сезонный орден' };
      if (ps[track].includes(lvl)) return { error: 'Уже получено' };
      ps[track].push(lvl);
      let msg = reward(pr, rw[track], tierOf(p));
      // Орден Чемпиона: премиум-награды дважды, а на 30 уровне вторая награда — мифический предмет
      if (track === 'prem' && ps.tier >= 4) msg += ' · ' + reward(pr, lvl === SHOP.pass.levels ? { item: 'mythic' } : rw[track], tierOf(p));
      if (track === 'prem' && ps.tier >= 10 && lvl === SHOP.pass.levels) msg += ' · ' + reward(pr, { item: 'mythic' }, tierOf(p)); // Орден Вечности — второй мифический
      refreshPlayer(p);
      return { toast: `Награда: ${msg}` };
    },

    // ---------- Реклама (заглушка: подключите сеть, например Adsgram, в public/js/town.js → showAd) ----------
    ad(p, d, pr) {
      return { error: 'Реклама отключена' }; // рекламы в игре нет
      // eslint-disable-next-line no-unreachable
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
      return { firstBuy: !pr.paidOnce, sub: isSub(pr) ? pr.subUntil : 0, subPrice: SHOP.sub.price, passTier: passTier(pr), passTiers: SHOP.passTiers,
        itemSpin: SHOP.itemSpin, gemPacks: Object.entries(SHOP.gems).map(([id, g]) => ({ id, ...g })), gems: pr.gems || 0, adsLeft: SHOP.ads.perDay - pr.adCount, gold: pr.gold,
        chests: Object.entries(CHESTS).filter(([, c]) => !c.special).map(([k, c]) => ({ id: k, title: c.title, desc: c.description, amount: c.amount, bag: !!c.bag, elixir: !!c.elixir })),
        starter: canBuy('starter', pr) ? null : { left: pr.created + STARTER_MS - Date.now(), amount: CHESTS.starter.amount, desc: CHESTS.starter.description },
        card: { amount: CHESTS.card30.amount, desc: CHESTS.card30.description, until: pr.card && pr.card.until > Date.now() ? pr.card.until : 0, ready: cardReady(pr) } };
    },
    // Карта месяца: 100 самоцветов в день
    cardClaim(p, d, pr) {
      if (!cardReady(pr)) return { error: pr.card && pr.card.until > Date.now() ? 'Сегодня уже получено — приходите завтра' : 'Карта месяца не активна' };
      pr.card.last = mskDayKey();
      pr.gems = (pr.gems || 0) + 100;
      return { toast: `💎 +100 самоцветов · карта действует ещё ${Math.ceil((pr.card.until - Date.now()) / DAY)} дн.` };
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
      deps.quest(p.uid, 'arena');
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

  // Торговля за золото закрыта: оставшиеся лоты рынка и аукциона — продавцам, ставки — тем, кто ставил (один раз)
  // Запускается после полной загрузки сервера (уведомления игрокам ещё не готовы в момент создания меты) и не может его уронить
  if ((market.lots || []).length || (market.auctions || []).length) setImmediate(() => { try {
    let n = 0;
    for (const l of market.lots || []) { giveLot(getProfile(l.seller), l); notifyUid(l.seller, 'Рынок за золото закрыт — ваш лот вернулся в сумку. Торговля теперь за GRAM в Торговом доме'); n++; }
    for (const a of market.auctions || []) {
      if (a.bidder) { getProfile(a.bidder).gold += a.bid; notifyUid(a.bidder, 'Аукцион закрыт — ваша ставка вернулась'); }
      giveLot(getProfile(a.seller), a); notifyUid(a.seller, 'Аукцион закрыт — ваш лот вернулся в сумку. Торговля теперь за GRAM в Торговом доме'); n++;
    }
    market.lots = []; market.auctions = [];
    console.log(`[meta] рынок и аукцион за золото закрыты: возвращено лотов ${n}`);
    save();
  } catch (e) { console.error('[meta] возврат лотов рынка и аукциона:', e); } });

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
    const fn = d && typeof d.op === 'string' && Object.hasOwn(OPS, d.op) ? OPS[d.op] : null;
    if (!fn) return { error: 'Неизвестное действие' };
    const pr = getProfile(p.uid);
    if (p.name && pr.arena) pr.arena.name = p.name;
    const res = fn(p, d, pr) || {};
    if (!res.error && ['equip', 'buy', 'socket'].includes(d.op)) deps.quest(p.uid, d.op); // шаги сюжета
    if (!res.error && !['inv', 'inspect', 'buys', 'shop', 'pass', 'shopInfo', 'arena', 'craftInfo', 'recipes', 'login'].includes(d.op)) save();
    res.gold = pr.gold;
    return res;
  }

  const PASS_GIFTS = [[5, 1, 0], [6, 3, 0], [7, 5, 0], [8, 7, 500], [9, 10, 1000], [10, 15, 2000]];
  // Покупки за Stars (зачисляются ботом после оплаты)
  function onPaid(kind, pr) {
    if (/^whUp[2-5]$/.test(kind)) { const lv = +kind[4] - 1; if ((pr.whLvl || 0) === lv) pr.whLvl = lv + 1; return true; }
    if (kind === 'ispin') pr.itemSpins = (pr.itemSpins || 0) + 1;
    else if (kind === 'ispin10') pr.itemSpins = (pr.itemSpins || 0) + 10;
    else if (SHOP.gems[kind]) pr.gems = (pr.gems || 0) + SHOP.gems[kind].gems;
    else if (kind === 'pass') passOf(pr).tier = Math.max(passOf(pr).tier, 2); // старые счета премиум-пропуска
    else if (/^pass([1-9]|10)$/.test(kind)) {
      const was = passOf(pr).tier;
      passOf(pr).tier = Math.max(was, +kind.slice(4));
      // Старшие ордена: печати снаряжения и кристаллы при первом получении в сезоне (за каждую новую ступень)
      for (const [t, spins, gems] of PASS_GIFTS) if (passOf(pr).tier >= t && was < t) { pr.itemSpins = (pr.itemSpins || 0) + spins; pr.gems = (pr.gems || 0) + gems; }
      if (pr.passDeal && passOf(pr).tier >= pr.passDeal.tier) delete pr.passDeal; // личная цена использована
    }
    else if (kind === 'sub') pr.subUntil = Math.max(Date.now(), pr.subUntil || 0) + SHOP.sub.days * DAY;
    else if (kind === 'starter') {
      pr.starterBought = true;
      pr.gems = (pr.gems || 0) + 300; pr.paidSpins = (pr.paidSpins || 0) + 3; pr.itemSpins = (pr.itemSpins || 0) + 5;
      grant(pr, I.createBag('epic', 1));
      I.addMat(pr, 'elxXp2', 2); I.addMat(pr, 'elxHero', 1); I.addMat(pr, 'potHp2', 10);
    } else if (kind === 'card30') {
      pr.gems = (pr.gems || 0) + 300;
      pr.card = { until: Math.max(Date.now(), (pr.card && pr.card.until) || 0) + 30 * DAY, last: (pr.card && pr.card.last) || '' };
    }
    else if (CHESTS[kind] && CHESTS[kind].bag) grant(pr, I.createBag(CHESTS[kind].bag, 1)); // сумка за Stars — сразу в инвентарь
    else if (CHESTS[kind]) I.addMat(pr, CHESTS[kind].mat || kind, CHESTS[kind].n);
    else return false;
    return true;
  }
  // Ларцы за Stars: попадают в сумку, открываются там (мир — по месту открытия)
  const CHESTS_BASE = {
    bagEpic: { n: 1, amount: 199, bag: 'epic', title: 'Рюкзак искателя', description: 'Эпическая сумка: +20 ячеек инвентаря' },
    bagLegend: { n: 1, amount: 499, bag: 'legendary', title: 'Сума гномьего торговца', description: 'Легендарная сумка: +35 ячеек инвентаря' },
    kitSmith: { n: 1, amount: 49, title: 'Сундук кузнеца', description: '30 руды, 15 эссенции и 2 свитка мастера' },
    chestSet: { n: 1, amount: 199, title: 'Ларец комплекта', description: 'Вещь комплекта вашего класса: эпическая, 15% легендарная, 1,5% мифическая' },
    chestSet5: { n: 5, amount: 899, title: 'Ларцы комплекта ×5', description: 'Пять ларцов комплекта со скидкой 10%' },
    chestLegend: { n: 1, amount: 149, title: 'Ларец грандмастера', description: '2 свитка грандмастера и редкий материал' },
    // Особые предложения (своя витрина в магазине)
    starter: { special: true, amount: 99, title: 'Набор новичка', description: '300 💎, 3 печати призыва, 5 печатей снаряжения, эпическая сумка, 2 великих эликсира опыта, эликсир героя, 10 больших зелий' },
    card30: { special: true, amount: 199, title: 'Карта месяца', description: '300 💎 сразу и ещё 100 💎 каждый день 30 дней — всего 3300 💎' },
    // Великие эликсиры — в сумку, пьются оттуда (1 час)
    elxXp2: { n: 1, amount: 49, elixir: true, title: 'Великий эликсир опыта', description: '+50% опыта на 1 час' },
    elxXp2x5: { n: 5, amount: 199, elixir: true, title: 'Великий эликсир опыта ×5', description: '5 эликсиров: +50% опыта на 1 час каждый, скидка 20%' },
    elxGold2: { n: 1, amount: 49, elixir: true, title: 'Великий эликсир богатства', description: '+50% золота с монстров на 1 час' },
    elxLuck2: { n: 1, amount: 59, elixir: true, title: 'Великий эликсир удачи', description: 'Предметы и материалы падают на 30% чаще 1 час' },
    elxHero: { n: 1, amount: 69, elixir: true, title: 'Эликсир героя', description: '+15% урона и здоровья, +5% крита, +10% скорости атаки на 1 час' },
    elxTitan: { n: 1, amount: 59, elixir: true, title: 'Эликсир титана', description: '+15% защиты, +25% здоровья, 2% вампиризма на 1 час' },
  };
  const CHESTS = Object.fromEntries(Object.entries(CHESTS_BASE).map(([k, c]) => [k, { ...c, amount: starPrice(c.amount) }])); // цены за ⭐ — с наценкой
  CHESTS.chestSet5.mat = 'chestSet';
  CHESTS.elxXp2x5.mat = 'elxXp2';
  const INVOICES = {
    ...Object.fromEntries(Object.entries(CHESTS).map(([k, c]) => [k, { title: c.title, description: c.description, amount: c.amount }])),
    ispin: { title: 'Призыв предмета', description: 'Одна крутка призыва предметов', amount: SHOP.itemSpin.price },
    ispin10: { title: 'Призыв предметов ×10', description: 'Десять круток призыва предметов', amount: SHOP.itemSpin.price10 },
    ...Object.fromEntries(Object.entries(SHOP.gems).map(([k, g]) => [k, { title: `Самоцветы ×${g.gems}`, description: `${g.gems} самоцветов: 160 = призыв героя, 100 = призыв снаряжения`, amount: g.amount }])),
    sub: { title: 'Подписка на 30 дней', description: '+15% опыта и золота, +3 лота в Торговом доме, больше сумка', amount: SHOP.sub.price },
    ...Object.fromEntries(WH_UPGRADES.filter((u) => u.stars).map((u) => [u.kind, { title: `Склад: уровень ${u.kind.slice(4)}`, description: '+50 ячеек склада навсегда', amount: u.stars }])),
  };

  // Сила лучшего героя игрока (рейтинг «Сила»)
  const powerOf = (pr) => Math.max(0, ...(pr.heroes || []).map((h) => { try { return fighter(deps, pr, h, '').power; } catch { return 0; } }));
  return { cosmLook, powerOf, canBuy, handle, addPassXp, passOf, passTier, passReady, passInvoice, isSub, bagSize, whSize, onPaid, INVOICES, SHOP, reward, grant: (pr, item) => I.addItem(pr, item, bagSize(pr)) };
};
module.exports.simulate = simulate;
module.exports.STAR_K = STAR_K;
