// Торговля за GRAM (server/trade.js)
//
//  • GRAM-баланс игрока (pr.gram): пополнение переводом на кошелёк игры (server/ton.js → onDeposit),
//    траты на Рынке и в Торговом доме. Всё в нано-GRAM (целые числа, 1 GRAM = 1e9).
//      dep  — пополненные GRAM: тратятся в игре, вывести нельзя;
//      earn — деньги с продаж [{ a, at }]: вывести можно, когда наступит at (через HOLD_DAYS после продажи).
//    Тратится сначала dep, затем ещё не созревшие продажи, затем созревшие (дольше остаётся доступное к выводу).
//  • Рынок — полный каталог вещей игры от эпических за GRAM: каждый вид вещи каждого слота, все руны и вещи комплектов
//    любого класса — можно собрать нужный комплект. Вещь создаётся при покупке (доп. свойства — случайные).
//    Цена — от ожидаемой стоимости такой вещи в призыве снаряжения (×1.5: выбор слота и гарантия),
//    чтобы крутить и выбивать оставалось интереснее. Вещи с Рынка — обычные (отборные — только из призыва).
//  • Торговый дом — продажа между игроками за GRAM: эпические+ вещи и руны (в том числе с заточкой и рунами),
//    ценные материалы. Цена не ниже минимума (половина цены Рынка, + за заточку, руны, комплект, отборность)
//    и не выше максимума. Комиссия с продавца 20% (торговые ордена — меньше); деньги — через 3 дня к выводу.
//  • Вывод: заявка → комиссия 10% (ордена — меньше) → выплата вручную администратором (вечером 20:00–24:00 МСК).
//    Условия: герой 30+ уровня, аккаунту 7+ дней, одна заявка за раз.
//  • Журнал всех движений GRAM (gram.json) и сводка для админки.
const { Address } = require('@ton/core');

const NANO = 1e9;
const RAR_OK = ['epic', 'legendary', 'mythic'];
const CFG = {
  fee: 0.20, wFee: 0.10, holdDays: 3,
  wMin: 1, wMaxDay: 300, wLevel: 30, wAgeDays: 7, depMin: 0.5,
  slots: 5, slotsSub: 3, lotDays: 7,
  // Цена на Рынке в ⭐ для мира I: ожидаемая цена вещи этой редкости в призыве снаряжения (15 ⭐ за крутку:
  // эпик ~51 ⭐, легендарка ~199 ⭐, мифик ~1008 ⭐) × 1.5. В GRAM — по курсу TON_PER_STAR (как остальные покупки)
  starsK: { epic: 75, legendary: 300, mythic: 1500 },
  tierK: { 1: 1, 2: 1.3, 3: 1.6 },
  runeK: 0.4,      // руна — 40% цены вещи той же редкости
  minK: 0.5,       // минимум в Торговом доме — половина цены Рынка
  maxK: 20,        // максимум — в 20 раз дороже (защита от перевода денег между аккаунтами)
  dupeK: 0.1,      // каждая заточка +10% к минимуму
  setK: 1.5, fineK: 1.25, // вещь комплекта — в 1.5 раза дороже обычной той же редкости (сильнее и с бонусами комплекта)
  // Материалы, которые можно продавать, и их минимальная цена за штуку в ⭐ (дальше — по курсу)
  matMinStars: { core1: 20, core2: 30, core3: 45, scrollE: 10, scrollL: 60, scrollM: 250, luckStone: 30, skillCrystal: 60, dust: 10,
    kitSmith: 25, chestSet: 50, chestLegend: 75, elxXp2: 25, elxGold2: 25, elxLuck2: 30, elxHero: 35, elxTitan: 30 },
  bpMinStars: 40, // чертёж комплекта: × мир
  orders: {
    tord1: { id: 'merchant', name: 'Орден Купца', icon: '🟢', stars: 299, days: 30, fee: 0.05, wFee: 0.02, slots: 5, lotDays: 14, top: false, itemSpins: 1,
      perks: ['Комиссия Торгового дома 15% вместо 20%', 'Комиссия вывода 8% вместо 10%', '+5 лотов в Торговом доме', 'Лоты висят 14 дней', 'Знак купца у ваших лотов', 'Выплаты — в первую очередь', '+1 печать снаряжения сразу'] },
    tord2: { id: 'magnate', name: 'Орден Магната', icon: '👑', stars: 699, days: 30, fee: 0.10, wFee: 0.05, slots: 15, lotDays: 30, top: true, itemSpins: 3,
      perks: ['Комиссия Торгового дома 10% вместо 20%', 'Комиссия вывода 5% вместо 10%', '+15 лотов в Торговом доме', 'Лоты висят 30 дней', 'Ваши лоты — вверху списка', 'Золотой знак магната у лотов', 'Выплаты — в первую очередь', '+3 печати снаряжения сразу'] },
  },
};

module.exports = function createTrade(deps) {
  const { I, store, getProfile, profiles, notifyUid, bagSize, isSub, tierOf, classOf, rate, Econ, log, alertAdmins } = deps;
  const st = store.readJSON('gram.json', null) || {};
  st.lots ??= []; st.seq ??= 1; st.wd ??= []; st.log ??= []; delete st.shopBuys; // витрина больше не дневная
  let saveTm = null;
  const save = () => { clearTimeout(saveTm); saveTm = setTimeout(() => { try { store.writeJSON('gram.json', st); } catch (e) { console.error('gram save', e.message); } }, 300); };
  const now = () => Date.now();
  const mskDay = (t = now()) => new Date(t + 3 * 36e5).toISOString().slice(0, 10);
  const gramOf = (stars) => Math.max(0.01, Math.round(stars * rate() * 100) / 100); // ⭐ → GRAM, до сотых
  const toNano = (g) => Math.round(Number(g) * NANO);
  const fmt = (n) => (Math.round(n / NANO * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

  // ---------- Баланс ----------
  function G(pr) {
    pr.gram ??= { dep: 0, earn: [], wallet: '', log: [] };
    pr.gram.earn ??= []; pr.gram.log ??= [];
    return pr.gram;
  }
  const order = (pr) => { const o = pr.tOrder; if (!o || o.until < now()) return null; return Object.values(CFG.orders).find((x) => x.id === o.id) || null; };
  function bal(pr) {
    const g = G(pr), t = now();
    let free = 0, hold = 0, next = 0;
    for (const c of g.earn) { if (c.at <= t) free += c.a; else { hold += c.a; next = next ? Math.min(next, c.at) : c.at; } }
    return { dep: g.dep, free, hold, next, total: g.dep + free + hold };
  }
  function note(uid, kind, a, text) {
    const pr = getProfile(uid), g = G(pr), e = { t: now(), kind, a, text };
    g.log.unshift(e); g.log.length = Math.min(g.log.length, 60);
    st.log.unshift({ ...e, uid, name: pr.name || uid }); st.log.length = Math.min(st.log.length, 5000);
    if (Econ && Econ.gram) Econ.gram(kind, a);
  }
  function credit(uid, kind, a, text, held) {
    const g = G(getProfile(uid));
    if (held) g.earn.push({ a, at: now() + CFG.holdDays * 864e5 }); else if (kind === 'refund') g.earn.push({ a, at: now() }); else g.dep += a;
    note(uid, kind, a, text);
  }
  // Списать: сначала пополненные, затем ещё удерживаемые продажи, затем доступные к выводу
  function spend(uid, a, kind, text) {
    const pr = getProfile(uid), g = G(pr), b = bal(pr);
    if (b.total < a) return false;
    let left = a;
    const take = Math.min(g.dep, left); g.dep -= take; left -= take;
    const t = now();
    g.earn.sort((x, y) => (x.at <= t) - (y.at <= t) || y.at - x.at); // сначала удерживаемые (новые первыми), потом созревшие
    for (const c of g.earn) { if (!left) break; const k = Math.min(c.a, left); c.a -= k; left -= k; }
    g.earn = g.earn.filter((c) => c.a > 0);
    note(uid, kind, -a, text);
    return true;
  }
  // Склеить созревшие кусочки (чтобы список не рос)
  function compact(pr) { const g = G(pr), t = now(), ripe = g.earn.filter((c) => c.at <= t).reduce((s, c) => s + c.a, 0); g.earn = g.earn.filter((c) => c.at > t); if (ripe) g.earn.push({ a: ripe, at: 0 }); }

  // ---------- Цены ----------
  const isWear = (cat) => I.WEAR_CATS.includes(cat);
  const shopStars = (cat, rar, tier) => (CFG.starsK[rar] || 0) * (CFG.tierK[tier] || 1) * (cat === 'rune' ? CFG.runeK : 1);
  const shopPrice = (cat, rar, tier, set = false) => toNano(gramOf(shopStars(cat, rar, tier) * (set ? CFG.setK : 1)));
  function itemBounds(it) {
    const set = !!(I.TEMPLATES[it.cat] && I.TEMPLATES[it.cat][it.tpl] && I.TEMPLATES[it.cat][it.tpl].setCls);
    const k = (1 + CFG.dupeK * (it.dupes || 0)) * (it.fine ? CFG.fineK : 1);
    const base = shopPrice(it.cat, it.rar, it.tier, set) * k;
    const runes = (it.runes || []).reduce((s, r) => s + shopPrice('rune', r.rar, r.tier), 0);
    return { min: Math.ceil((base + runes) * CFG.minK / 1e7) * 1e7, max: Math.floor((base + runes) * CFG.maxK / 1e7) * 1e7 };
  }
  function matMinStars(id) { if (id.startsWith('bp_')) { const m = I.MATS[id]; return CFG.bpMinStars * ((m && m.tier) || 1); } return CFG.matMinStars[id] || 0; }
  function matBounds(id, n) { const s = matMinStars(id) * n, min = toNano(gramOf(s)); return { min, max: min / CFG.minK * CFG.maxK }; }
  function tradable(it) {
    if (!it) return 'Предмет не найден';
    if (!(isWear(it.cat) || it.cat === 'rune')) return 'В Торговом доме продаются вещи, руны и ценные материалы';
    if (!RAR_OK.includes(it.rar)) return 'Продавать можно вещи и руны от эпических';
    return '';
  }

  // ---------- Рынок (вещи игры за GRAM): полный каталог ----------
  // cat — слот, 'rune' или 'set'; cls — класс (для чьих героев вещи), tier — мир героя
  const tplOk = (cat, tpl, cls) => { const t = I.TEMPLATES[cat] && I.TEMPLATES[cat][tpl]; return !!t && !t.setCls && (!cls || I.canWear({ cat, tpl }, I.CLASSES[cls].heroes[0])); };
  function catalog(cat, cls, tier) {
    const out = [];
    const add = (c, tpl, set) => { for (const rar of RAR_OK) out.push({ key: `${c}:${tpl}:${rar}`, cat: c, tpl, rar, set, price: shopPrice(c, rar, tier, set) }); };
    if (cat === 'set') { for (const slot of I.SET_SLOTS) add(slot, `set_${cls}`, true); }
    else if (cat === 'rune') { for (const tpl of Object.keys(I.TEMPLATES.rune)) add('rune', tpl, false); }
    else if (isWear(cat)) { for (const tpl of Object.keys(I.TEMPLATES[cat])) if (tplOk(cat, tpl, cls)) add(cat, tpl, false); }
    return out;
  }
  // Образец для витрины: только основные свойства (доп. свойства появятся при покупке)
  const sample = (o, tier) => ({ ...I.itemView({ id: `s:${o.key}`, cat: o.cat, tpl: o.tpl, rar: o.rar, tier, attrs: [], dupes: 0, runes: [] }), attrsN: I.ITEM_RARITIES[o.rar].attrs });

  // ---------- Торговый дом ----------
  const slotsOf = (pr) => CFG.slots + (isSub(pr) ? CFG.slotsSub : 0) + ((order(pr) || {}).slots || 0);
  const lotView = (l, uid) => ({ id: l.id, price: l.price, seller: l.sellerName, mine: l.seller === uid, badge: l.badge || null, until: l.until,
    item: l.mat ? { ...I.matView(l.mat, l.n), name: `${I.MATS[l.mat].name} ×${l.n}` } : I.itemView(l.item) });
  function giveBack(l) {
    const pr = getProfile(l.seller);
    if (l.mat) I.addMat(pr, l.mat, l.n); else { l.item.loc = 'bag'; I.addItem(pr, l.item, bagSize(pr), false); }
  }
  // Просроченные лоты возвращаются продавцам
  function sweep() {
    const t = now(), old = st.lots.filter((l) => l.until <= t);
    if (!old.length) return;
    st.lots = st.lots.filter((l) => l.until > t);
    for (const l of old) { giveBack(l); notifyUid(l.seller, `Торговый дом: срок лота «${l.mat ? I.MATS[l.mat].name : I.itemView(l.item).name}» истёк — предмет вернулся в сумку`); }
    save();
  }
  setInterval(sweep, 60e3).unref();

  const maxLevel = (pr) => Math.max(0, ...Object.values(pr.chars || {}).map((c) => c.level || 0));
  const isEquipped = (pr, id) => Object.values(pr.equip || {}).includes(id);

  // ---------- Действия игрока (Bag.act с op 'gram…' / 'gm…' / 'th…') ----------
  const OPS = {
    gramInfo(p, d, pr) {
      compact(pr);
      const b = bal(pr), o = order(pr), g = G(pr), mine = st.wd.filter((w) => w.uid === p.uid).slice(0, 10);
      return { gram: {
        dep: b.dep, free: b.free, hold: b.hold, next: b.next, total: b.total, wallet: g.wallet || '', log: g.log.slice(0, 30),
        fee: CFG.fee - ((o && o.fee) || 0), wFee: CFG.wFee - ((o && o.wFee) || 0), holdDays: CFG.holdDays, wMin: toNano(CFG.wMin), depMin: CFG.depMin,
        wLevel: CFG.wLevel, wAgeDays: CFG.wAgeDays, level: maxLevel(pr), ageDays: Math.floor((now() - (pr.created || now())) / 864e5),
        order: o ? { ...o, until: pr.tOrder.until } : null, wd: mine,
        orders: Object.entries(CFG.orders).map(([kind, x]) => ({ kind, ...x, gram: gramOf(x.stars) })),
      } };
    },
    // Рынок
    gmShop(p, d, pr) {
      const tier = tierOf(p), own = classOf(p.heroId);
      const cls = I.CLASSES[d.cls] ? d.cls : own;
      const cat = d.cat === 'set' || d.cat === 'rune' || isWear(d.cat) ? d.cat : 'weapon';
      const list = catalog(cat, cls, tier);
      return { offers: list.map((o) => ({ key: o.key, price: o.price, set: o.set, item: sample(o, tier) })), bal: bal(pr), tier, cat, cls, own,
        classes: I.CLASS_ORDER.map((c) => ({ id: c, name: I.CLASSES[c].name, icon: I.CLASSES[c].icon })),
        set: cat === 'set' ? (() => { const S = I.SETS[`${cls}${tier}`]; return S ? { name: S.name, bonus: S.bonus } : null; })() : null };
    },
    gmBuy(p, d, pr) {
      const tier = tierOf(p), [cat, tpl, rar] = String(d.key || '').split(':');
      const set = /^set_/.test(tpl || '');
      const okT = I.TEMPLATES[cat] && I.TEMPLATES[cat][tpl] && RAR_OK.includes(rar) && (cat === 'rune' || isWear(cat)) && (!set || I.SET_SLOTS.includes(cat));
      if (!okT) return { error: 'Товар не найден' };
      if (pr.items.filter((i) => i.loc !== 'wh').length >= bagSize(pr)) return { error: 'Сумка полна — освободите место' };
      const price = shopPrice(cat, rar, tier, set);
      const it = I.createItem(cat, rar, tier, tpl);
      const name = I.itemView(it).name;
      if (!spend(p.uid, price, 'shop', `Рынок: ${name}`)) return { error: `Нужно ${fmt(price)} GRAM — пополните баланс`, needGram: true };
      I.addItem(pr, it, bagSize(pr), false);
      save();
      return { toast: `Куплено: ${name} за ${fmt(price)} GRAM`, refresh: true };
    },
    // Торговый дом
    th(p, d, pr) {
      sweep();
      const lots = st.lots.map((l) => lotView(l, p.uid)).sort((a, b) => (b.badge === 'magnate') - (a.badge === 'magnate') || b.id - a.id);
      return { lots, bal: bal(pr), slots: slotsOf(pr), fee: CFG.fee - ((order(pr) || {}).fee || 0) };
    },
    thQuote(p, d, pr) {
      if (d.mat) { const n = Math.max(1, Math.floor(Number(d.n) || 1)); if (!matMinStars(d.mat)) return { error: 'Этот материал в Торговом доме не продаётся' }; return matBounds(d.mat, n); }
      const it = I.findItem(pr, d.id), no = tradable(it);
      if (no) return { error: no };
      return itemBounds(it);
    },
    thSell(p, d, pr) {
      if (st.lots.filter((l) => l.seller === p.uid).length >= slotsOf(pr)) return { error: 'Все места для лотов заняты' };
      const price = toNano(d.price);
      if (!(price > 0)) return { error: 'Укажите цену в GRAM' };
      let lot;
      if (d.mat) {
        const n = Math.floor(Number(d.n) || 0);
        if (!(n > 0) || !matMinStars(d.mat)) return { error: 'Этот материал в Торговом доме не продаётся' };
        const b = matBounds(d.mat, n);
        if (price < b.min) return { error: `Цена не ниже ${fmt(b.min)} GRAM` };
        if (price > b.max) return { error: `Цена не выше ${fmt(b.max)} GRAM` };
        if (!I.takeMats(pr, { [d.mat]: n })) return { error: 'Не хватает материалов' };
        lot = { mat: d.mat, n };
      } else {
        const it = I.findItem(pr, d.id), no = tradable(it);
        if (no) return { error: no };
        if (isEquipped(pr, it.id)) return { error: 'Сначала снимите предмет' };
        const b = itemBounds(it);
        if (price < b.min) return { error: `Цена не ниже ${fmt(b.min)} GRAM` };
        if (price > b.max) return { error: `Цена не выше ${fmt(b.max)} GRAM` };
        pr.items = pr.items.filter((i) => i !== it);
        delete it.loc;
        lot = { item: it };
      }
      const o = order(pr);
      st.lots.push({ id: st.seq++, seller: p.uid, sellerName: p.name, ...lot, price, at: now(), until: now() + ((o && o.lotDays) || CFG.lotDays) * 864e5, badge: o ? o.id : null });
      save();
      return { toast: 'Лот выставлен в Торговый дом', refresh: true };
    },
    thBuy(p, d, pr) {
      const l = st.lots.find((x) => x.id === d.id);
      if (!l) return { error: 'Лот уже продан' };
      if (l.seller === p.uid) return { error: 'Это ваш лот' };
      if (!l.mat && pr.items.filter((i) => i.loc !== 'wh').length >= bagSize(pr)) return { error: 'Сумка полна — освободите место' };
      const name = l.mat ? `${I.MATS[l.mat].name} ×${l.n}` : I.itemView(l.item).name;
      if (!spend(p.uid, l.price, 'buy', `Торговый дом: ${name} у ${l.sellerName}`)) return { error: `Нужно ${fmt(l.price)} GRAM — пополните баланс`, needGram: true };
      st.lots = st.lots.filter((x) => x !== l);
      const spr = getProfile(l.seller), o = order(spr), fee = Math.round(l.price * (CFG.fee - ((o && o.fee) || 0))), income = l.price - fee;
      credit(l.seller, 'sale', income, `Продано: ${name} за ${fmt(l.price)} GRAM (комиссия ${fmt(fee)})`, true);
      note(l.seller, 'fee', -fee, `Комиссия Торгового дома: ${name}`);
      if (l.mat) I.addMat(pr, l.mat, l.n); else { l.item.loc = 'bag'; I.addItem(pr, l.item, bagSize(pr), false); }
      notifyUid(l.seller, `Торговый дом: продано «${name}» за ${fmt(l.price)} GRAM — вам ${fmt(income)} GRAM, к выводу через ${CFG.holdDays} дня`);
      save();
      return { toast: `Куплено: ${name}`, refresh: true };
    },
    thCancel(p, d, pr) {
      const l = st.lots.find((x) => x.id === d.id && x.seller === p.uid);
      if (!l) return { error: 'Лот не найден' };
      st.lots = st.lots.filter((x) => x !== l);
      giveBack(l);
      save();
      return { toast: 'Лот снят — предмет в сумке', refresh: true };
    },
    // Вывод
    gramWithdraw(p, d, pr) {
      compact(pr);
      if (maxLevel(pr) < CFG.wLevel) return { error: `Вывод — с ${CFG.wLevel} уровня героя` };
      if (now() - (pr.created || now()) < CFG.wAgeDays * 864e5) return { error: `Вывод — через ${CFG.wAgeDays} дней после регистрации` };
      if (st.wd.some((w) => w.uid === p.uid && w.status === 'wait')) return { error: 'Уже есть заявка на вывод — дождитесь выплаты' };
      let addr;
      try { addr = Address.parse(String(d.address || '').trim()).toString({ bounceable: false }); } catch { return { error: 'Неверный адрес кошелька' }; }
      const gross = toNano(d.amount), b = bal(pr);
      if (!(gross >= toNano(CFG.wMin))) return { error: `Минимум к выводу — ${CFG.wMin} GRAM` };
      if (gross > b.free) return { error: `Доступно к выводу ${fmt(b.free)} GRAM (продажи — через ${CFG.holdDays} дня; пополненные GRAM выводить нельзя)` };
      const today = st.wd.filter((w) => w.uid === p.uid && mskDay(w.at) === mskDay() && w.status !== 'rejected').reduce((s, w) => s + w.gross, 0);
      if (today + gross > toNano(CFG.wMaxDay)) return { error: `Не больше ${CFG.wMaxDay} GRAM в день` };
      // Списываем только созревшие деньги
      const g = G(pr); let left = gross;
      for (const c of g.earn) { if (!left || c.at > now()) continue; const k = Math.min(c.a, left); c.a -= k; left -= k; }
      g.earn = g.earn.filter((c) => c.a > 0);
      const o = order(pr), fee = Math.round(gross * (CFG.wFee - ((o && o.wFee) || 0)));
      const w = { id: st.seq++, uid: p.uid, name: p.name, gross, fee, net: gross - fee, address: addr, at: now(), status: 'wait', prio: o ? (o.top ? 2 : 1) : 0 };
      st.wd.unshift(w); st.wd.length = Math.min(st.wd.length, 3000);
      g.wallet = addr;
      note(p.uid, 'withdraw', -gross, `Заявка на вывод №${w.id}: ${fmt(w.net)} GRAM на ${addr.slice(0, 6)}…${addr.slice(-4)} (комиссия ${fmt(fee)})`);
      save();
      if (alertAdmins) alertAdmins(`💸 Заявка на вывод №${w.id}: ${p.name} · ${fmt(w.net)} GRAM → ${addr}\nАдминка → GRAM`);
      return { toast: `Заявка №${w.id} принята: ${fmt(w.net)} GRAM. Выплаты — ежедневно с 20:00 до 24:00 МСК`, refresh: true };
    },
  };
  function act(p, d) {
    const fn = Object.hasOwn(OPS, d.op) ? OPS[d.op] : null;
    if (!fn) return { error: 'Неизвестное действие' };
    const pr = getProfile(p.uid);
    const res = fn(p, d, pr) || {};
    if (!res.error && deps.saveProfiles) deps.saveProfiles();
    res.gramBal = bal(pr).total;
    return res;
  }

  // ---------- Пополнение (server/ton.js нашёл перевод) ----------
  function onDeposit(uid, nano, hash) {
    if (!(nano > 0)) return false;
    credit(uid, 'deposit', nano, `Пополнение ${fmt(nano)} GRAM`);
    save();
    notifyUid(uid, `💎 Баланс пополнен: +${fmt(nano)} GRAM`);
    log && log('pay', `GRAM: пополнение ${fmt(nano)} · ${uid} · ${hash || ''}`);
    return true;
  }

  // ---------- Торговые ордена ----------
  function grantOrder(pr, kind) {
    const o = CFG.orders[kind];
    if (!o) return false;
    const cur = pr.tOrder && pr.tOrder.until > now() ? pr.tOrder : null;
    // Тот же орден — продлевается; другой — заменяется (остаток не переносится)
    const base = cur && cur.id === o.id ? cur.until : now();
    pr.tOrder = { id: o.id, until: base + o.days * 864e5 };
    pr.itemSpins = (pr.itemSpins || 0) + (o.itemSpins || 0);
    return true;
  }
  const invoices = () => Object.fromEntries(Object.entries(CFG.orders).map(([k, o]) => [k, { title: `${o.name} · 30 дней`, description: o.perks.join(', ').slice(0, 250), amount: o.stars }]));

  // ---------- Админка ----------
  function adminView() {
    let dep = 0, free = 0, hold = 0;
    for (const pr of Object.values(profiles())) if (pr.gram) { const b = bal(pr); dep += b.dep; free += b.free; hold += b.hold; }
    const wait = st.wd.filter((w) => w.status === 'wait').sort((a, b) => b.prio - a.prio || a.at - b.at);
    return { totals: { dep, free, hold, all: dep + free + hold, waitNet: wait.reduce((s, w) => s + w.net, 0), lots: st.lots.length },
      wait, done: st.wd.filter((w) => w.status !== 'wait').slice(0, 50), log: st.log.slice(0, 200) };
  }
  function adminPay(id, tx) {
    const w = st.wd.find((x) => x.id === Number(id));
    if (!w || w.status !== 'wait') return { error: 'Заявка не найдена или уже обработана' };
    w.status = 'paid'; w.paidAt = now(); w.tx = String(tx || '').slice(0, 120);
    note(w.uid, 'payout', 0, `Выплачено по заявке №${w.id}: ${fmt(w.net)} GRAM`);
    notifyUid(w.uid, `💸 Выплата по заявке №${w.id}: ${fmt(w.net)} GRAM отправлены на ваш кошелёк`);
    save();
    return { text: `Заявка №${w.id} отмечена выплаченной` };
  }
  function adminReject(id, reason) {
    const w = st.wd.find((x) => x.id === Number(id));
    if (!w || w.status !== 'wait') return { error: 'Заявка не найдена или уже обработана' };
    w.status = 'rejected'; w.doneAt = now(); w.reason = String(reason || '').slice(0, 200);
    credit(w.uid, 'refund', w.gross, `Заявка №${w.id} отклонена${w.reason ? `: ${w.reason}` : ''} — GRAM вернулись`);
    notifyUid(w.uid, `Заявка на вывод №${w.id} отклонена${w.reason ? `: ${w.reason}` : ''}. GRAM вернулись на баланс`);
    save();
    return { text: `Заявка №${w.id} отклонена, ${fmt(w.gross)} GRAM возвращены` };
  }
  // Ручная корректировка баланса из админки (возврат, компенсация): + пополненные, − списание
  function adminAdjust(uid, gram, text) {
    const a = toNano(gram);
    if (!a) return { error: 'Укажите сумму' };
    if (a > 0) credit(uid, 'admin', a, text || 'Начислено администрацией');
    else if (!spend(uid, -a, 'admin', text || 'Списано администрацией')) return { error: 'Недостаточно GRAM на балансе' };
    save();
    return { text: `Баланс GRAM: ${fmt(bal(getProfile(uid)).total)}` };
  }

  // Старые лоты рынка и аукциона за золото — вернуть продавцам (торговля за золото убрана)
  function migrateGoldMarket(market, giveLot, refundBid) {
    let n = 0;
    for (const l of market.lots || []) { giveLot(getProfile(l.seller), l); notifyUid(l.seller, 'Рынок за золото закрыт — ваш лот вернулся в сумку. Торговля теперь за GRAM в Торговом доме'); n++; }
    for (const a of market.auctions || []) { if (a.bidder) refundBid(a); giveLot(getProfile(a.seller), a); n++; }
    market.lots = []; market.auctions = [];
    return n;
  }

  return { act, isOp: (op) => Object.hasOwn(OPS, op), onDeposit, grantOrder, invoices, isOrder: (k) => Object.hasOwn(CFG.orders, k), adminView, adminPay, adminReject, adminAdjust, bal, migrateGoldMarket, CFG, fmt, gramOf, shopPrice, itemBounds, save };
};
module.exports.CFG = CFG;
