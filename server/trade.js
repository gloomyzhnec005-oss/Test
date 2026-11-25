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
  dupeK: 0.1,      // каждый дубликат +10% к минимуму
  enchK: 0.15,     // каждый уровень заточки в кузнице +15% к минимуму и максимуму
  setK: 2.5, fineK: 1.25, // вещь комплекта — в 2.5 раза дороже обычной той же редкости (сильнее и даёт бонусы комплекта)
  // Материалы, которые можно продавать, и их минимальная цена за штуку в ⭐ (дальше — по курсу)
  matMinStars: { core1: 20, core2: 30, core3: 45, scrollE: 10, scrollL: 60, scrollM: 250, luckStone: 30, skillCrystal: 60, dust: 10,
    kitSmith: 25, chestSet: 50, chestLegend: 75, elxXp2: 25, elxGold2: 25, elxLuck2: 30, elxHero: 35, elxTitan: 30 },
  bpMinStars: 40, // чертёж комплекта: × мир
  // Лимитированный тираж сезона: мифические вещи с номером (#N/of), +10% к статам, только на Рынке и пока не кончились,
  // не больше perUser в одни руки; дальше — только перепродажа в Торговом доме (цена ×k к обычной мифической)
  ltd: { id: 's1', name: 'Первый Рассвет', of: 100, perUser: 3, k: 1.5 },
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
  st.bids ??= []; st.hist ??= {}; // заявки на покупку; история цен (ключ товара → последние сделки)
  // Касса: сколько всего пришло пополнений и сколько отправлено игрокам (для сводки «можно забрать себе»)
  if (!st.cash) st.cash = { in: st.log.filter((e) => e.kind === 'deposit').reduce((x, e) => x + e.a, 0), out: st.wd.filter((w) => w.status === 'paid').reduce((x, w) => x + w.net, 0) };
  for (const l of st.lots) if (l.item) I.cleanItem(l.item); // старые свойства «Золото»/«Опыт» на выставленных вещах
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
  const byId = (id) => Object.values(CFG.orders).find((x) => x.id === id) || null;
  const order = (pr) => {
    const t = deps.passTier ? deps.passTier(pr) : 0; // сезонный орден 6 — Магнат, 5 — Купец
    if (t >= 6) return byId('magnate');
    if (t >= 5) return byId('merchant');
    const o = pr.tOrder; return o && o.until >= now() ? byId(o.id) : null; // купленный раньше отдельно — до конца срока
  };
  // Тест вывода (админка → игрок → «Тест вывода»): без условий уровня/возраста, к выводу — весь баланс, включая
  // пополнения и продажи на удержании. Только для проверки выплат администратором; после теста выключить.
  const wdTest = (pr) => !!(pr.test && pr.test.wdTest);
  function bal(pr) {
    const g = G(pr), t = now();
    let free = 0, hold = 0, next = 0;
    for (const c of g.earn) { if (c.at <= t) free += c.a; else { hold += c.a; next = next ? Math.min(next, c.at) : c.at; } }
    return { dep: g.dep, free, hold, next, total: g.dep + free + hold };
  }
  // Личные итоги игрока за всё время (окно «Моя экономика»): журнал хранит только 60 записей, поэтому копим счётчики
  // dep — пополнено, sale/saleN — получено с продаж (после комиссии), fee — комиссии, spent — потрачено на покупки
  // (за вычетом возвратов), prize — награды GRAM (лига, приглашения, казна владык), adm — от администрации
  function tally(g, kind, a, wdBack) {
    if (!g.tot) { g.tot = { dep: 0, sale: 0, saleN: 0, fee: 0, spent: 0, prize: 0, adm: 0 }; for (const e of [...g.log].reverse()) tally(g, e.kind, e.a, e.kind === 'refund' && /^Заявка №/.test(e.text || '')); }
    const T = g.tot;
    if (kind === 'deposit') T.dep += a;
    else if (kind === 'sale') { T.sale += a; T.saleN++; }
    else if (kind === 'fee') T.fee -= a;
    else if (kind === 'refund') { if (!wdBack) T.spent = Math.max(0, T.spent - a); }
    else if (['prize', 'ref', 'reign'].includes(kind)) T.prize += a;
    else if (kind === 'admin') T.adm += a;
    else if (kind !== 'withdraw' && kind !== 'payout' && a < 0) T.spent -= a;
  }
  function note(uid, kind, a, text, wdBack) {
    const pr = getProfile(uid), g = G(pr), e = { t: now(), kind, a, text };
    if (!g.tot) tally(g, 'init', 0); // счётчики из прежнего журнала — до новой записи
    tally(g, kind, a, wdBack);
    g.log.unshift(e); g.log.length = Math.min(g.log.length, 60);
    st.log.unshift({ ...e, uid, name: pr.name || uid }); st.log.length = Math.min(st.log.length, 5000);
    if (Econ && Econ.gram) Econ.gram(kind, a);
  }
  function credit(uid, kind, a, text, held, wdBack) {
    const g = G(getProfile(uid));
    if (held) g.earn.push({ a, at: now() + CFG.holdDays * 864e5 }); else if (kind === 'refund') g.earn.push({ a, at: now() }); else g.dep += a;
    note(uid, kind, a, text, wdBack);
  }
  // Списать: сначала пополненные, затем ещё удерживаемые продажи, затем доступные к выводу
  function spend(uid, a, kind, text) {
    const pr = getProfile(uid), g = G(pr), b = bal(pr);
    if (b.total < a) return false;
    if (!['admin', 'escrow', 'tour'].includes(kind) && deps.quest) try { deps.quest(uid, 'purchase', 1); } catch { /* задание — не главное */ } // покупка за GRAM — «Покровитель» (заявка — при исполнении)
    let left = a;
    const take = Math.min(g.dep, left); g.dep -= take; left -= take;
    const parts = { dep: take, earn: [] }; // откуда взяты деньги — чтобы вернуть туда же (заявки на покупку)
    const t = now();
    g.earn.sort((x, y) => (x.at <= t) - (y.at <= t) || y.at - x.at); // сначала удерживаемые (новые первыми), потом созревшие
    for (const c of g.earn) { if (!left) break; const k = Math.min(c.a, left); c.a -= k; left -= k; parts.earn.push({ a: k, at: c.at }); }
    g.earn = g.earn.filter((c) => c.a > 0);
    note(uid, kind, -a, text);
    return parts;
  }
  // Покупка за GRAM принесла игре доход house (вся цена на Рынке, комиссия в Торговом доме) — для реферальной доли
  // и доли владык (server/index.js). amount — сумма покупки покупателя uid
  function onHouse(uid, amount, house) { st.vol = (st.vol || 0) + amount; st.house = (st.house || 0) + house; if (deps.onHouse) try { deps.onHouse(uid, amount, house); } catch (e) { console.error('onHouse', e); } }
  // Вернуть замороженное (заявка снята/истекла): пополненные — в пополненные, деньги с продаж — с прежним сроком.
  // Так через заявку нельзя превратить невыводимые пополнения в выводимые
  function refundParts(uid, parts, text) {
    const g = G(getProfile(uid)), sum = parts.dep + parts.earn.reduce((x, c) => x + c.a, 0);
    if (!sum) return;
    g.dep += parts.dep; for (const c of parts.earn) if (c.a > 0) g.earn.push({ a: c.a, at: c.at });
    note(uid, 'refund', sum, text);
  }
  // Взять из замороженного a (исполнение заявки): сначала пополненные, остаток заявки — более «выводимый»
  function takeParts(parts, a) {
    const k = Math.min(parts.dep, a); parts.dep -= k; let left = a - k;
    for (const c of parts.earn) { if (!left) break; const m = Math.min(c.a, left); c.a -= m; left -= m; }
    parts.earn = parts.earn.filter((c) => c.a > 0);
    return left === 0;
  }
  // Склеить созревшие кусочки (чтобы список не рос)
  function compact(pr) { const g = G(pr), t = now(), ripe = g.earn.filter((c) => c.at <= t).reduce((s, c) => s + c.a, 0); g.earn = g.earn.filter((c) => c.at > t); if (ripe) g.earn.push({ a: ripe, at: 0 }); }

  // ---------- Цены ----------
  const isWear = (cat) => I.WEAR_CATS.includes(cat);
  const shopStars = (cat, rar, tier) => (CFG.starsK[rar] || 0) * (CFG.tierK[tier] || 1) * (cat === 'rune' ? CFG.runeK : 1);
  const shopPrice = (cat, rar, tier, set = false) => toNano(gramOf(shopStars(cat, rar, tier) * (set ? CFG.setK : 1)));
  function itemBounds(it) {
    const set = !!it.setForce || !!(I.TEMPLATES[it.cat] && I.TEMPLATES[it.cat][it.tpl] && I.TEMPLATES[it.cat][it.tpl].setCls);
    const k = (1 + CFG.dupeK * (it.dupes || 0)) * (it.fine ? CFG.fineK : 1) * (1 + CFG.enchK * (it.ench || 0)) * (it.ltd ? CFG.ltd.k : 1); // заточка и тираж дорожают вещь
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
    if (it.bound) return 'Вещь привязана к владельцу — её нельзя продать или передать';
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
  // ---------- Ключ товара и история цен ----------
  const isSetItem = (it) => !!(I.TEMPLATES[it.cat] && I.TEMPLATES[it.cat][it.tpl] && I.TEMPLATES[it.cat][it.tpl].setCls);
  const itemKey = (it) => `i:${it.cat}:${it.rar}:${it.tier || 1}:${isSetItem(it) ? 1 : 0}`;
  const matKey = (id) => `m:${id}`;
  // Сделка — в публичную ленту (без имён: товар и цена)
  function dealAdd(name, price) { (st.deals ??= []).push([now(), name, price]); if (st.deals.length > 500) st.deals.splice(0, st.deals.length - 500); }
  // Публично — только тираж (общий оборот игры игрокам не показываем)
  function publicStats() {
    return { ltd: { name: CFG.ltd.name, left: CFG.ltd.of - ((st.ltd || {})[CFG.ltd.id] || 0), of: CFG.ltd.of } };
  }
  function histAdd(key, unit) {
    const h = (st.hist[key] ??= []);
    h.push([now(), unit]); if (h.length > 40) h.splice(0, h.length - 40);
  }
  function histView(key) {
    const h = st.hist[key] || [], wk = h.filter(([t]) => now() - t < 7 * 864e5).map(([, v]) => v);
    if (!h.length) return null;
    return { last: h[h.length - 1][1], avg7: wk.length ? Math.round(wk.reduce((a, b) => a + b, 0) / wk.length) : null, n7: wk.length, min7: wk.length ? Math.min(...wk) : null, max7: wk.length ? Math.max(...wk) : null };
  }
  const bidName = (b) => (b.mat ? I.MATS[b.mat].name : `${I.SLOT_NAMES ? (I.SLOT_NAMES[b.cat] || b.cat) : b.cat} · ${I.ITEM_RARITIES[b.rar].name} · мир ${b.tier}${b.set ? ' · комплект' : ''}`);
  const bidView = (b, uid) => ({ id: b.id, mine: b.buyer === uid, buyer: b.buyerName, mat: b.mat || null, cat: b.cat || null, rar: b.rar || null, tier: b.tier || null, set: !!b.set,
    n: b.n, price: b.price, until: b.until, name: bidName(b), item: b.mat ? I.matView(b.mat, b.n) : null, hist: histView(b.mat ? matKey(b.mat) : `i:${b.cat}:${b.rar}:${b.tier}:${b.set ? 1 : 0}`) });
  // Подходит ли вещь под заявку: тот же слот, редкость, мир, комплект/нет
  const fits = (b, it) => !b.mat && it && it.cat === b.cat && it.rar === b.rar && (it.tier || 1) === b.tier && isSetItem(it) === !!b.set;
  // Границы цены заявки на вещь — как у лота такой же вещи без заточки и рун
  const bidBounds = (b) => (b.mat ? matBounds(b.mat, 1) : itemBounds({ cat: b.cat, tpl: b.set ? `set_x` : '', rar: b.rar, tier: b.tier, dupes: 0, runes: [], setForce: !!b.set }));
  function sweepBids() {
    const t = now(), old = st.bids.filter((b) => b.until <= t);
    if (!old.length) return;
    st.bids = st.bids.filter((b) => b.until > t);
    for (const b of old) { refundParts(b.buyer, b.parts, `Заявка истекла: ${bidName(b)} — GRAM возвращены`); notifyUid(b.buyer, `Торговый дом: срок заявки «${bidName(b)}» истёк — GRAM вернулись на баланс`); }
    save();
  }
  setInterval(sweepBids, 60e3).unref();
  // Просроченные лоты возвращаются продавцам
  function sweep() {
    const t = now(), old = st.lots.filter((l) => l.until <= t);
    if (!old.length) return;
    st.lots = st.lots.filter((l) => l.until > t);
    for (const l of old) { giveBack(l); notifyUid(l.seller, `Торговый дом: срок лота «${l.mat ? I.MATS[l.mat].name : I.itemView(l.item).name}» истёк — предмет вернулся в сумку`); }
    save();
  }
  setInterval(sweep, 60e3).unref();

  // Уровень для вывода: после обнуления игры (вайпа) засчитывается и уровень, достигнутый до него (pr.wdLevel)
  const maxLevel = (pr) => Math.max(pr.wdLevel || 0, ...Object.values(pr.chars || {}).map((c) => c.level || 0));
  const isEquipped = (pr, id) => Object.values(pr.equip || {}).includes(id);

  // Разобрать заявку из запроса: материал (из списка продаваемых) или вещь (слот, редкость от эпической, мир, комплект)
  function parseBid(d) {
    if (d.mat) { if (!matMinStars(d.mat) || !I.MATS[d.mat] || d.mat.startsWith('bp_')) return { error: 'Этот материал в Торговом доме не продаётся' }; return { mat: d.mat }; }
    const cat = String(d.cat || ''), rar = String(d.rar || ''), tier = Math.floor(Number(d.tier) || 0), set = !!d.set;
    if (!(isWear(cat) || cat === 'rune') || !RAR_OK.includes(rar) || !(tier >= 1 && tier <= 3)) return { error: 'Выберите слот, редкость (от эпической) и мир' };
    if (set && !I.SET_SLOTS.includes(cat)) return { error: 'Комплектных вещей такого слота нет' };
    return { cat, rar, tier, set };
  }
  // ---------- Действия игрока (Bag.act с op 'gram…' / 'gm…' / 'th…') ----------
  const OPS = {
    gramInfo(p, d, pr) {
      compact(pr);
      const b = bal(pr), o = order(pr), g = G(pr), mine = st.wd.filter((w) => w.uid === p.uid).slice(0, 10), tw = wdTest(pr);
      return { gram: {
        dep: b.dep, free: tw ? b.total : b.free, wdTest: tw, hold: b.hold, next: b.next, total: b.total, wallet: g.wallet || '', log: g.log.slice(0, 30),
        fee: CFG.fee - ((o && o.fee) || 0), wFee: CFG.wFee - ((o && o.wFee) || 0), holdDays: CFG.holdDays, wMin: toNano(CFG.wMin), depMin: CFG.depMin,
        wLevel: CFG.wLevel, wAgeDays: CFG.wAgeDays, level: tw ? Math.max(CFG.wLevel, maxLevel(pr)) : maxLevel(pr), ageDays: tw ? Math.max(CFG.wAgeDays, Math.floor((now() - (pr.created || now())) / 864e5)) : Math.floor((now() - (pr.created || now())) / 864e5),
        order: o ? { ...o, until: deps.passEnds ? (deps.passTier(pr) >= 5 ? deps.passEnds() : pr.tOrder.until) : 0 } : null, wd: mine,
        orders: deps.passOrders ? deps.passOrders(pr).map((x) => ({ ...x, gram: gramOf(x.cost) })) : [],
      } };
    },
    // Поиск получателя подарка или перевода: по нику (от 2 букв) или ID вида tg123…
    findPlayer(p, d) {
      const q = String(d.q || '').trim().toLowerCase().slice(0, 32);
      if (q.length < 2) return { error: 'Введите хотя бы 2 буквы ника' };
      const out = [];
      for (const [uid, x] of Object.entries(profiles())) {
        if (!/^tg\d+$/.test(uid) || uid === p.uid || !x.name) continue;
        const n = x.name.toLowerCase();
        if (uid === q || n === q || n.includes(q)) out.push({ uid, name: x.name, lvl: maxLevel(x), exact: n === q || uid === q });
        if (out.length >= 40) break;
      }
      out.sort((a, b) => b.exact - a.exact || b.lvl - a.lvl);
      return { players: out.slice(0, 8).map(({ uid, name, lvl }) => ({ uid, name, lvl })) };
    },
    // Перевод GRAM другому игроку: комиссия 10% (доход игры). Получатель может тратить их в игре, но не выводить
    // (иначе через второй аккаунт пополнения превращались бы в выводимые деньги и обходились условия вывода)
    gramSend(p, d, pr) {
      const to = String(d.to || ''), a = toNano(Number(d.amount) || 0);
      if (!/^tg\d+$/.test(p.uid)) return { error: 'Переводы доступны в игре через Telegram' };
      if (!/^tg\d+$/.test(to) || to === p.uid) return { error: 'Выберите другого игрока' };
      const tp = profiles()[to]; // не getProfile: тот создал бы пустой профиль для несуществующего ID
      if (!tp || !tp.created) return { error: 'Получатель не найден' };
      if (a < toNano(0.5) || a > toNano(500)) return { error: 'Перевод — от 0,5 до 500 GRAM' };
      const day = mskDay(); if (!pr.gsend || pr.gsend.day !== day) pr.gsend = { day, a: 0 };
      if (pr.gsend.a + a > toNano(1000)) return { error: 'Лимит переводов — 1000 GRAM в день' };
      const fee = Math.round(a * 0.1), net = a - fee, name = tp.name || 'игрок';
      if (d.quote) return { quote: { amount: a, fee, net, name } };
      if (!spend(p.uid, a, 'gift', `Перевод ${name}: ${fmt(a)} GRAM (комиссия ${fmt(fee)})`)) return { error: `Нужно ${fmt(a)} GRAM — пополните баланс`, needGram: true };
      credit(to, 'gift', net, `Перевод от ${p.name}: ${fmt(net)} GRAM (тратить в игре, вывод недоступен)`);
      pr.gsend.a += a;
      st.house = (st.house || 0) + fee;
      save();
      notifyUid(to, `💎 ${p.name} перевёл вам ${fmt(net)} GRAM — можно тратить в игре`);
      return { toast: `Отправлено ${fmt(net)} GRAM → ${name} (комиссия ${fmt(fee)})` };
    },
    // Моя экономика: только свои деньги игрока — общий оборот игры не показываем
    gramMine(p, d, pr) {
      compact(pr);
      const b = bal(pr), g = G(pr); if (!g.tot) tally(g, 'init', 0);
      const mine = st.wd.filter((w) => w.uid === p.uid), paid = mine.filter((w) => w.status === 'paid'), wait = mine.filter((w) => w.status === 'wait');
      const sum = (a) => a.reduce((x, w) => x + w.net, 0);
      return { mine: { bal: b, tot: g.tot, wd: { paid: sum(paid), paidN: paid.length, wait: sum(wait), waitN: wait.length }, log: g.log.slice(0, 15),
        ltd: { name: CFG.ltd.name, left: CFG.ltd.of - ((st.ltd || {})[CFG.ltd.id] || 0), of: CFG.ltd.of } } };
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
      onHouse(p.uid, price, price); // вся цена — доход игры
      save();
      return { toast: `Куплено: ${name} за ${fmt(price)} GRAM`, refresh: true };
    },
    // Лимитированный тираж
    gmLtd(p, d, pr) {
      const L = CFG.ltd, sold = (st.ltd ??= {})[L.id] || 0, tier = tierOf(p), mine = ((pr.ltdBuys || {})[L.id]) || 0;
      return { ltd: { name: L.name, of: L.of, left: L.of - sold, perUser: L.perUser, mine, tier,
        offers: I.WEAR_CATS.filter((c) => c !== 'bag').map((c) => ({ cat: c, price: Math.round(shopPrice(c, 'mythic', tier) * L.k), item: { ...sample({ cat: c, tpl: Object.keys(I.TEMPLATES[c]).find((k) => !I.TEMPLATES[c][k].setCls), rar: 'mythic' }, tier), name: `${I.CATEGORIES[c]} «${L.name}»` } })) } };
    },
    gmLtdBuy(p, d, pr) {
      const L = CFG.ltd, cat = String(d.cat || '');
      if (!I.WEAR_CATS.includes(cat) || cat === 'bag') return { error: 'Выберите слот' };
      const sold = (st.ltd ??= {})[L.id] || 0;
      if (sold >= L.of) return { error: `Тираж «${L.name}» распродан — ищите в Торговом доме` };
      pr.ltdBuys ??= {};
      if ((pr.ltdBuys[L.id] || 0) >= L.perUser) return { error: `Не больше ${L.perUser} вещей тиража в одни руки` };
      if (pr.items.filter((i) => i.loc !== 'wh').length >= bagSize(pr)) return { error: 'Сумка полна — освободите место' };
      const tier = tierOf(p), price = Math.round(shopPrice(cat, 'mythic', tier) * L.k);
      const tpls = Object.keys(I.TEMPLATES[cat]).filter((k) => !I.TEMPLATES[cat][k].setCls), cls = classOf(p.heroId);
      const fit = tpls.filter((k) => I.canWear({ cat, tpl: k }, p.heroId));
      const it = I.createItem(cat, 'mythic', tier, (fit.length ? fit : tpls)[Math.floor(Math.random() * (fit.length || tpls.length))], cls);
      it.ltd = { id: L.id, name: L.name, n: sold + 1, of: L.of };
      const name = I.itemView(it).name;
      if (!spend(p.uid, price, 'shop', `Рынок: ${name}`)) return { error: `Нужно ${fmt(price)} GRAM — пополните баланс`, needGram: true };
      st.ltd[L.id] = sold + 1; pr.ltdBuys[L.id] = (pr.ltdBuys[L.id] || 0) + 1;
      I.addItem(pr, it, bagSize(pr), false);
      onHouse(p.uid, price, price);
      save();
      if (deps.broadcast && (sold + 1) % 10 === 0) deps.broadcast(`⭐ Тираж «${L.name}»: продано ${sold + 1} из ${L.of}`);
      return { toast: `Куплено: ${name}`, refresh: true };
    },
    // Торговый дом
    th(p, d, pr) {
      sweep();
      sweepBids();
      const lots = st.lots.map((l) => ({ ...lotView(l, p.uid), hist: histView(l.mat ? matKey(l.mat) : itemKey(l.item)) })).sort((a, b) => (b.badge === 'magnate') - (a.badge === 'magnate') || b.id - a.id);
      const bids = st.bids.map((b) => bidView(b, p.uid)).sort((a, b) => b.price - a.price);
      // Сколько комиссии заплачено за 30 дней — и сколько сэкономили бы торговые ордена
      const fees30 = -G(pr).log.filter((e) => e.kind === 'fee' && now() - e.t < 30 * 864e5).reduce((x, e) => x + e.a, 0), o = order(pr);
      const oSave = o ? null : { fees: fees30, merchant: Math.round(fees30 * byId('merchant').fee / CFG.fee), magnate: Math.round(fees30 * byId('magnate').fee / CFG.fee) };
      return { lots, bids, bal: bal(pr), slots: slotsOf(pr), fee: CFG.fee - ((order(pr) || {}).fee || 0), bidDays: CFG.lotDays, orderSave: oSave,
        mats: Object.keys(CFG.matMinStars).filter((m) => I.MATS[m]).map((m) => ({ id: m, name: I.MATS[m].name, icon: I.MATS[m].icon })),
        slotsList: I.WEAR_CATS.concat('rune').map((c) => ({ id: c, name: (I.SLOT_NAMES && I.SLOT_NAMES[c]) || c })) };
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
      histAdd(l.mat ? matKey(l.mat) : itemKey(l.item), l.mat ? Math.round(l.price / l.n) : l.price);
      dealAdd(l.mat ? `${I.MATS[l.mat].name} ×${l.n}` : I.itemView(l.item).name, l.price);
      const spr = getProfile(l.seller), o = order(spr), fee = Math.round(l.price * (CFG.fee - ((o && o.fee) || 0))), income = l.price - fee;
      credit(l.seller, 'sale', income, `Продано: ${name} за ${fmt(l.price)} GRAM (комиссия ${fmt(fee)})`, true);
      if (deps.quest) try { deps.quest(p.uid, 'trade', 1); deps.quest(l.seller, 'trade', 1); } catch { /* задание — не главное */ } // «Честная сделка» — обоим
      note(l.seller, 'fee', -fee, `Комиссия Торгового дома: ${name}`);
      onHouse(p.uid, l.price, fee); // доход игры — комиссия
      if (l.mat) I.addMat(pr, l.mat, l.n); else { l.item.loc = 'bag'; I.addItem(pr, l.item, bagSize(pr), false); }
      notifyUid(l.seller, `Торговый дом: продано «${name}» за ${fmt(l.price)} GRAM — вам ${fmt(income)} GRAM, к выводу через ${CFG.holdDays} дня`);
      save();
      return { toast: `Куплено: ${name}`, refresh: true };
    },
    // ---------- Заявки на покупку: деньги замораживаются сразу, продавец отдаёт товар и сразу получает оплату ----------
    thBidQuote(p, d) {
      const b = parseBid(d); if (b.error) return b;
      return bidBounds(b);
    },
    thBid(p, d, pr) {
      sweepBids();
      if (st.bids.filter((x) => x.buyer === p.uid).length >= slotsOf(pr)) return { error: 'Все места для заявок заняты (столько же, сколько для лотов)' };
      const b = parseBid(d); if (b.error) return b;
      const n = b.mat ? Math.floor(Number(d.n) || 0) : 1;
      if (!(n >= 1 && n <= 999)) return { error: 'Количество — от 1 до 999' };
      const price = toNano(d.price), bd = bidBounds(b);
      if (!(price > 0)) return { error: 'Укажите цену в GRAM' };
      if (price < bd.min) return { error: `Цена за штуку не ниже ${fmt(bd.min)} GRAM` };
      if (price > bd.max) return { error: `Цена за штуку не выше ${fmt(bd.max)} GRAM` };
      const total = price * n;
      const parts = spend(p.uid, total, 'escrow', `Заявка на покупку: ${bidName(b)}${b.mat ? ' ×' + n : ''} — GRAM заморожены`);
      if (!parts) return { error: `Нужно ${fmt(total)} GRAM — пополните баланс`, needGram: true };
      const o = order(pr);
      st.bids.push({ id: st.seq++, buyer: p.uid, buyerName: p.name, ...b, n, price, parts, at: now(), until: now() + ((o && o.lotDays) || CFG.lotDays) * 864e5 });
      save();
      return { toast: `Заявка создана: заморожено ${fmt(total)} GRAM`, refresh: true };
    },
    thBidCancel(p, d) {
      const b = st.bids.find((x) => x.id === d.id && x.buyer === p.uid);
      if (!b) return { error: 'Заявка не найдена' };
      st.bids = st.bids.filter((x) => x !== b);
      refundParts(p.uid, b.parts, `Заявка снята: ${bidName(b)} — GRAM возвращены`);
      save();
      return { toast: 'Заявка снята — GRAM вернулись на баланс', refresh: true };
    },
    // Продать по заявке: материалы (сколько есть, но не больше заявки) или подходящую вещь
    thFill(p, d, pr) {
      sweepBids();
      const b = st.bids.find((x) => x.id === d.id);
      if (!b) return { error: 'Заявка уже исполнена или снята' };
      if (b.buyer === p.uid) return { error: 'Это ваша заявка' };
      const bpr = getProfile(b.buyer);
      let q = 1, name, give;
      if (b.mat) {
        q = Math.min(b.n, Math.floor(Number(d.n) || 0));
        if (!(q >= 1)) return { error: 'Укажите количество' };
        if (((pr.mats || {})[b.mat] || 0) < q) return { error: 'Не хватает материалов' };
        name = `${I.MATS[b.mat].name} ×${q}`;
        give = () => { I.takeMats(pr, { [b.mat]: q }); I.addMat(bpr, b.mat, q); };
      } else {
        const it = I.findItem(pr, d.item), no = tradable(it);
        if (no) return { error: no };
        if (!fits(b, it)) return { error: 'Эта вещь не подходит под заявку' };
        if (isEquipped(pr, it.id)) return { error: 'Сначала снимите предмет' };
        name = I.itemView(it).name;
        // Покупателю — в сумку, если полна — на склад (заявку он создал заранее, отказываться от сделки нельзя)
        give = () => { pr.items = pr.items.filter((i) => i !== it); const full = bpr.items.filter((i) => i.loc !== 'wh').length >= bagSize(bpr); it.loc = full ? 'wh' : 'bag'; bpr.items.push(it); };
      }
      const pay = b.price * q;
      if (!takeParts(b.parts, pay)) return { error: 'Ошибка заявки — попробуйте позже' };
      give();
      b.n -= q;
      if (b.n <= 0) { st.bids = st.bids.filter((x) => x !== b); refundParts(b.buyer, b.parts, `Заявка исполнена: остаток возвращён`); }
      histAdd(b.mat ? matKey(b.mat) : `i:${b.cat}:${b.rar}:${b.tier}:${b.set ? 1 : 0}`, b.price);
      dealAdd(name, pay);
      const o = order(pr), fee = Math.round(pay * (CFG.fee - ((o && o.fee) || 0))), income = pay - fee;
      credit(p.uid, 'sale', income, `Продано по заявке: ${name} за ${fmt(pay)} GRAM (комиссия ${fmt(fee)})`, true);
      note(p.uid, 'fee', -fee, `Комиссия Торгового дома: ${name}`);
      note(b.buyer, 'buy', 0, `Куплено по заявке: ${name} у ${p.name} за ${fmt(pay)} GRAM`);
      if (deps.quest) try { deps.quest(p.uid, 'trade', 1); deps.quest(b.buyer, 'trade', 1); deps.quest(b.buyer, 'purchase', 1); } catch { /* задание — не главное */ }
      onHouse(b.buyer, pay, fee);
      notifyUid(b.buyer, `Торговый дом: ваша заявка исполнена — «${name}» за ${fmt(pay)} GRAM`);
      save();
      return { toast: `Продано по заявке: ${name} — вам ${fmt(income)} GRAM (к выводу через ${CFG.holdDays} дня)`, refresh: true };
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
      const tw = wdTest(pr);
      if (!tw && maxLevel(pr) < CFG.wLevel) return { error: `Вывод — с ${CFG.wLevel} уровня героя` };
      if (!tw && now() - (pr.created || now()) < CFG.wAgeDays * 864e5) return { error: `Вывод — через ${CFG.wAgeDays} дней после регистрации` };
      if (st.wd.some((w) => w.uid === p.uid && w.status === 'wait')) return { error: 'Уже есть заявка на вывод — дождитесь выплаты' };
      let addr;
      try { addr = Address.parse(String(d.address || '').trim()).toString({ bounceable: false }); } catch { return { error: 'Неверный адрес кошелька' }; }
      const gross = toNano(d.amount), b = bal(pr);
      if (!(gross >= toNano(CFG.wMin))) return { error: `Минимум к выводу — ${CFG.wMin} GRAM` };
      if (gross > (tw ? b.total : b.free)) return { error: `Доступно к выводу ${fmt(b.free)} GRAM (продажи — через ${CFG.holdDays} дня; пополненные GRAM выводить нельзя)` };
      const today = st.wd.filter((w) => w.uid === p.uid && mskDay(w.at) === mskDay() && w.status !== 'rejected').reduce((s, w) => s + w.gross, 0);
      if (today + gross > toNano(CFG.wMaxDay)) return { error: `Не больше ${CFG.wMaxDay} GRAM в день` };
      // Списываем только созревшие деньги
      const g = G(pr); let left = gross;
      for (const c of g.earn) { if (!left || (c.at > now() && !tw)) continue; const k = Math.min(c.a, left); c.a -= k; left -= k; }
      g.earn = g.earn.filter((c) => c.a > 0);
      if (left && tw) { const k = Math.min(g.dep, left); g.dep -= k; left -= k; } // тест: и из пополнений
      const o = order(pr), fee = Math.round(gross * (CFG.wFee - ((o && o.wFee) || 0)));
      const w = { id: st.seq++, uid: p.uid, name: p.name, gross, fee, net: gross - fee, address: addr, at: now(), status: 'wait', prio: o ? (o.top ? 2 : 1) : 0 };
      st.wd.unshift(w); st.wd.length = Math.min(st.wd.length, 3000);
      g.wallet = addr;
      note(p.uid, 'withdraw', -gross, `Заявка на вывод №${w.id}: ${fmt(w.net)} GRAM на ${addr.slice(0, 6)}…${addr.slice(-4)} (комиссия ${fmt(fee)})`);
      save();
      if (alertAdmins) alertAdmins(`💸 Заявка на вывод №${w.id}: ${p.name} · ${fmt(w.net)} GRAM → ${addr}\nАдминка → GRAM`, true);
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
    st.cash.in += nano;
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
    // Касса: в кошельке игры должно быть (пополнения − выплаты). Обязательства перед игроками: балансы, заявки на вывод,
    // замороженное в заявках на покупку, взносы GRAM-лиги и казна владык (deps.liab). Остаток — доход игры, его можно забрать
    const bidsFrozen = (st.bids || []).reduce((x, b) => x + b.parts.dep + b.parts.earn.reduce((y, c) => y + c.a, 0), 0);
    const extra = deps.liab ? deps.liab() : 0, waitNet = wait.reduce((s, w) => s + w.net, 0);
    const should = st.cash.in - st.cash.out, owe = dep + free + hold + waitNet + bidsFrozen + extra;
    return { totals: { dep, free, hold, all: dep + free + hold, waitNet, lots: st.lots.length,
      cash: { in: st.cash.in, out: st.cash.out, should, owe, bids: bidsFrozen, extra, profit: should - owe, house: st.house || 0 } },
      wait, done: st.wd.filter((w) => w.status !== 'wait').slice(0, 50), log: st.log.slice(0, 200) };
  }
  function adminPay(id, tx) {
    const w = st.wd.find((x) => x.id === Number(id));
    if (!w || w.status !== 'wait') return { error: 'Заявка не найдена или уже обработана' };
    w.status = 'paid'; w.paidAt = now(); w.tx = String(tx || '').slice(0, 120);
    st.cash.out += w.net;
    note(w.uid, 'payout', 0, `Выплачено по заявке №${w.id}: ${fmt(w.net)} GRAM`);
    notifyUid(w.uid, `💸 Выплата по заявке №${w.id}: ${fmt(w.net)} GRAM отправлены на ваш кошелёк`);
    save();
    return { text: `Заявка №${w.id} отмечена выплаченной` };
  }
  function adminReject(id, reason) {
    const w = st.wd.find((x) => x.id === Number(id));
    if (!w || w.status !== 'wait') return { error: 'Заявка не найдена или уже обработана' };
    w.status = 'rejected'; w.doneAt = now(); w.reason = String(reason || '').slice(0, 200);
    credit(w.uid, 'refund', w.gross, `Заявка №${w.id} отклонена${w.reason ? `: ${w.reason}` : ''} — GRAM вернулись`, false, true);
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

  // Списать GRAM за покупку вне торговли (внешний вид): сначала пополненные, затем деньги с продаж
  const spendGram = (uid, nano, text) => { const ok = spend(uid, nano, 'shop', text); if (ok) { onHouse(uid, nano, nano); save(); } return ok; };
  // Начислить игроку GRAM (реферальная доля, призы): к выводу — через срок удержания, как деньги с продаж
  // Взнос (турнир): списать с возможностью вернуть туда же (parts) — без реферальной доли и заданий
  const take = (uid, nano, text) => { const parts = spend(uid, nano, 'tour', text); if (parts) save(); return parts; };
  const refundTo = (uid, parts, text) => { refundParts(uid, parts, text); save(); };
  const houseAdd = (nano) => { st.house = (st.house || 0) + nano; save(); };
  const grant = (uid, nano, kind, text) => { if (!(nano > 0)) return; credit(uid, kind, Math.round(nano), text, true); save(); };
  // Обнуление игроков (админка): лоты, заявки и журнал удалённых — убрать
  // Обнуление (вайп): лоты стираются (вещи — часть прогресса), замороженные в заявках на покупку GRAM возвращаются
  // на баланс (туда же: пополнения — в пополнения), заявки на вывод и журнал GRAM СОХРАНЯЮТСЯ — это реальные деньги игроков.
  // Сами балансы переносит server/index.js (pr.gram в новый профиль)
  function wipe(keep) {
    const n = st.lots.length;
    st.lots = st.lots.filter((l) => keep.has(l.seller));
    for (const b of st.bids) if (!keep.has(b.buyer)) refundParts(b.buyer, b.parts, `Обнуление игры: заявка «${bidName(b)}» снята — GRAM возвращены`);
    st.bids = st.bids.filter((b) => keep.has(b.buyer));
    save();
    return n - st.lots.length;
  }
  return { publicStats, wipe, spendGram, grant, take, giveBack: refundTo, houseAdd, nanoOf: (stars) => toNano(gramOf(stars)), act, isOp: (op) => Object.hasOwn(OPS, op), onDeposit, grantOrder, invoices, isOrder: (k) => Object.hasOwn(CFG.orders, k), adminView, adminPay, adminReject, adminAdjust, bal, migrateGoldMarket, CFG, fmt, gramOf, shopPrice, itemBounds, save };
};
module.exports.CFG = CFG;
