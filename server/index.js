require('dotenv').config();
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const C = require('./config');
const { buildWorld, ZONE_STRIDE } = require('./world');
const { verifyInitData } = require('./auth');
const { SKILLS, PASSIVES, NEEDS_TARGET, skillRange } = require('./skills');
const { createPets, createSummon, rescalePets, updatePets, hurtPet } = require('./pets');
const I = require('./items');
const MOBX = require('./mobs');
const createDungeons = require('./dungeon');
C.MONSTERS = MOBX.MOBS; // 75 видов монстров + миньоны (server/mobs.js)
const createMeta = require('./meta');
const createQuests = require('./quests');
const createAdmin = require('./admin');
const Loot = require('./loot');

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ALLOW_GUESTS = process.env.ALLOW_GUESTS !== 'false';
const FREE_SPINS = process.env.FREE_SPINS === 'true'; // для тестов: крутки гачи без оплаты
const store = require('./store');

// ---------- Хранилище прогресса (server/store.js: атомарная запись, бэкапы, постоянный диск Railway) ----------
let profiles = store.readJSON('players.json', {});
function saveProfiles() {
  try { store.writeJSON('players.json', profiles); } catch (e) { console.error('save error', e.message); }
}
setInterval(saveProfiles, 15000);
// Бэкап раз в час (последние 48): игроки, рынок, турнир, настройки админки
store.startBackups(['players.json', 'market.json', 'tournament.json', 'admin.json', 'clans.json'], saveProfiles);

function getProfile(uid) {
  profiles[uid] ??= {};
  const pr = profiles[uid];
  pr.chars ??= {};
  pr.heroes ??= [];
  pr.bgs ??= [];
  pr.paidSpins ??= 0;
  pr.freeSpinUsed ??= false;
  // Предметы, экипировка, дубликаты героев, кошелёк аккаунта
  pr.items ??= [];
  pr.equip ??= {};
  pr.heroDupes ??= {};
  pr.itemSpins ??= 0;
  I.migrate(pr); // старые слоты бижутерии → кольцо и амулет, стопки материалов
  if (pr.gold === undefined) pr.gold = Object.values(pr.chars).reduce((sum, c) => sum + (c.gold || 0), 0);
  // Удалённые из игры герои пропадают из профиля; если не осталось ни одного — возвращаем бесплатную крутку
  const before = pr.heroes.length;
  pr.heroes = pr.heroes.filter((id) => C.HEROES[id]);
  if (before > 0 && pr.heroes.length === 0) pr.freeSpinUsed = false;
  return pr;
}
function getChar(uid, heroId) {
  const pr = getProfile(uid);
  pr.chars[heroId] ??= { level: 1, xp: 0, kills: 0, gold: 0 };
  return pr.chars[heroId];
}

// ---------- HTTP ----------
const app = express();
// Версия сборки: коммит на Railway (или время запуска) — видна в админке и в /health
const VERSION = (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || 'локально ' + new Date().toISOString().slice(0, 16).replace('T', ' ');
// Сжатие gzip: скрипты, HTML и JSON в 3–5 раз меньше (картинки и музыка уже сжаты — их не трогает)
app.use(require('compression')());
// HTML, скрипты и стили браузер всегда перепроверяет у сервера — после деплоя сразу видна новая версия.
// Картинки, звуки и музыку телефон держит в кеше: сутки без запросов, ещё неделю — показывает из кеша и тихо сверяет
// в фоне. Повторный запуск игры почти ничего не качает.
const ASSET_CACHE = 'public, max-age=86400, stale-while-revalidate=604800';
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, file) => {
    res.setHeader('Cache-Control', /\.(html|js|css|json)$/.test(file) ? 'no-cache' : ASSET_CACHE);
    if (/\.(png|webp|jpg)$/.test(file)) res.setHeader('Access-Control-Allow-Origin', '*'); // значок игры для кошелька TON
  },
}));
// Phaser меняется только с обновлением пакета — кешируем на сутки
app.use('/vendor/phaser.min.js', (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'node_modules', 'phaser', 'dist', 'phaser.min.js'), { headers: { 'Cache-Control': ASSET_CACHE } }));
// Админ-панель (server/admin.js): свой разбор JSON с большим лимитом, поэтому подключается раньше общего
const admin = createAdmin({
  C, I, MOBX, verifyInitData, store, version: () => VERSION,
  get players() { return players; }, get monsters() { return monsters; }, get world() { return world; },
  get D() { return D; }, get meta() { return meta; }, get io() { return io; }, profiles: null,
  getProfile: (uid) => getProfile(uid), getChar: (uid, h) => getChar(uid, h), saveProfiles: () => saveProfiles(),
  refreshUid: (uid) => refreshUid(uid), markDirty: (p) => markDirty(p), moveToZone: (...a) => moveToZone(...a),
  hurtPlayer: (...a) => hurtPlayer(...a), grantXp: (...a) => grantXp(...a), unlockedSkills: (...a) => unlockedSkills(...a), xpForLevel: (l) => xpForLevel(l), syncCooldowns: (...a) => syncCooldowns(...a),
});
Object.defineProperty(admin.ctx, 'profiles', { get: () => profiles });
const S = admin.settings;
app.use('/admin/api', admin.router);
app.use(express.json({ limit: '16kb' }));
// Профиль игрока для лобби: полученные герои, их прогресс, крутки гачи, фоны
function profileView(who) {
  const pr = getProfile(who.uid);
  const chars = {};
  for (const id of pr.heroes) {
    const ch = getChar(who.uid, id);
    chars[id] = { ...ch, xpNext: xpForLevel(ch.level), ...statsFor(id, ch.level, pr), dupes: pr.heroDupes[id] || 0, unlocked: unlockedSkills(pr, id) };
  }
  const bgs = C.LOBBY_BACKGROUNDS.filter((b) => b.price === 0 || pr.bgs.includes(b.id)).map((b) => b.id);
  return {
    name: who.name, uid: who.uid, tgId: who.tg ? who.uid.slice(2) : null, heroes: pr.heroes, chars, bgs,
    isAdmin: !!who.tg && admin.isAdminUid(who.uid),
    freeSpin: !pr.freeSpinUsed || FREE_SPINS || S.freeSpins, paidSpins: pr.paidSpins, spinPrice: C.GACHA.spinPrice, gold: pr.gold, dupeMax: C.GACHA.heroDupeMax,
    wish: Wish.view(pr), spin10Price: C.GACHA.spin10Price,
  };
}
app.post('/api/profile', (req, res) => {
  const { initData, guestId } = req.body || {};
  const who = resolveUid(initData, guestId);
  if (!who) return res.status(403).json({ error: 'Откройте игру через Telegram-бота' });
  const ban = getProfile(who.uid).banned;
  if (ban) return res.status(403).json({ error: `Вы заблокированы: ${ban.reason}` });
  res.json(profileView(who));
});

// Призыв героев (server/wish.js): Избранный недели и Зал героев, ×1/×10, гарант
const Wish = require('./wish')({
  C, getChar: (...a) => getChar(...a), refreshUid: (uid) => refreshUid(uid),
  addPassXp: (pr, n) => meta.addPassXp(pr, n), quest: (...a) => Q.track(...a),
});
app.post('/api/gacha/spin', (req, res) => {
  const { initData, guestId, banner, n } = req.body || {};
  const who = resolveUid(initData, guestId);
  if (!who) return res.status(403).json({ error: 'Откройте игру через Telegram-бота' });
  const pr = getProfile(who.uid);
  const r = Wish.pull(who.uid, pr, banner, n, FREE_SPINS || S.freeSpins);
  if (r.error) return res.status(402).json(r);
  saveProfiles();
  const one = r.results[0];
  res.json({ results: r.results, hero: one.hero, dupe: one.dupe, profile: profileView(who) });
});
// Обмен осколков душ на печати призыва героя или снаряжения
app.post('/api/gacha/exchange', (req, res) => {
  const { initData, guestId, what, n } = req.body || {};
  const who = resolveUid(initData, guestId);
  if (!who) return res.status(403).json({ error: 'Нет игрока' });
  const r = Wish.exchange(getProfile(who.uid), what, n);
  if (r.error) return res.status(400).json(r);
  saveProfiles();
  res.json({ profile: profileView(who) });
});
app.get('/api/config', (req, res) => res.json({
  heroes: C.HEROES, rarities: C.RARITIES, monsters: C.MONSTERS, backgrounds: C.LOBBY_BACKGROUNDS, gacha: C.GACHA, skillUnlock: C.SKILL_UNLOCK,
}));

// Покупки за Telegram Stars: фон лобби (item=bg) или крутка гачи (item=spin)
let bot = null;
app.post('/api/invoice', async (req, res) => {
  const { initData, guestId, item, bgId } = req.body || {};
  // DEV_PAYMENTS=true — тестовый режим: покупка зачисляется сразу, без Telegram
  if (process.env.DEV_PAYMENTS === 'true') {
    const w = resolveUid(initData, guestId);
    if (!w) return res.status(403).json({ error: 'Нет игрока' });
    const ok = onPaid(item === 'bg' ? `bg:${w.uid}:${bgId}` : `${item}:${w.uid}`);
    return ok ? res.json({ devPaid: true }) : res.status(400).json({ error: 'Неизвестный товар' });
  }
  const who = resolveUid(initData, null);
  if (!who || !who.tg) return res.status(403).json({ error: 'Покупки доступны только в Telegram' });
  if (!bot) return res.status(503).json({ error: 'Оплата временно недоступна' });
  const inv = buildInvoice(who, item, bgId);
  if (inv.error) return res.status(400).json({ error: inv.error });
  try {
    const link = await bot.telegram.createInvoiceLink({ ...inv.invoice, provider_token: '', currency: 'XTR' });
    res.json({ link });
  } catch (e) {
    console.error('createInvoiceLink:', e.message);
    res.status(500).json({ error: 'Не удалось создать счёт' });
  }
});
// Счёт на товар: название, payload для зачисления (onPaid) и цена в Stars. Общий для Stars и TON
function buildInvoice(who, item, bgId) {
  let invoice;
  if (/^pass[1-4]$/.test(item)) { // сезонный орден: цена — разница с уже купленным
    const v = meta.passInvoice(getProfile(who.uid), +item[4]);
    if (v.error) return { error: v.error };
    invoice = { title: v.title, description: v.description, payload: `${item}:${who.uid}`, prices: [{ label: v.title, amount: v.amount }] };
  } else if (meta.INVOICES[item]) {
    const v = meta.INVOICES[item];
    invoice = { title: v.title, description: v.description, payload: `${item}:${who.uid}`, prices: [{ label: v.title, amount: v.amount }] };
  } else if (item === 'spin' || item === 'spin10') {
    const ten = item === 'spin10';
    invoice = { title: ten ? 'Печати призыва ×10' : 'Печать призыва', description: ten ? 'Десять призывов героя' : 'Один призыв героя', payload: `${item}:${who.uid}`,
      prices: [{ label: ten ? 'Печати ×10' : 'Печать', amount: ten ? C.GACHA.spin10Price : C.GACHA.spinPrice }] };
  } else {
    const bg = C.LOBBY_BACKGROUNDS.find((b) => b.id === bgId && b.price > 0);
    if (!bg) return { error: 'Неизвестный фон' };
    invoice = { title: `Фон лобби «${bg.name}»`, description: 'Новый фон для лобби выбора героя',
      payload: `bg:${who.uid}:${bg.id}`, prices: [{ label: bg.name, amount: bg.price }] };
  }
  // Первая покупка аккаунта (Stars или GRAM) — скидка 50%
  const pr = getProfile(who.uid);
  if (!pr.paidOnce) {
    const full = invoice.prices[0].amount, cut = Math.max(1, Math.ceil(full * (1 - FIRST_BUY_OFF)));
    invoice = { ...invoice, title: `${invoice.title} · −50%`, description: `Скидка на первую покупку: ${cut} ⭐ вместо ${full} ⭐. ${invoice.description}`.slice(0, 255),
      prices: [{ label: invoice.prices[0].label, amount: cut }] };
  }
  return { invoice, stars: invoice.prices[0].amount };
}
const FIRST_BUY_OFF = 0.5;

// ---------- Оплата в TON (server/ton.js): заказ → перевод из кошелька игрока → проверка в блокчейне ----------
const ton = require('./ton')({ store, onPaid: (payload) => onPaid(payload), log: (k, t) => admin.log(k, t) });
app.get('/api/ton/info', (req, res) => res.json(ton.info()));
// Манифест TON Connect: кошелёк показывает игроку название и значок игры
// Кошелёк скачивает его до подключения: нужен CORS (иначе вечная загрузка «Продолжите в Telegram…»),
// а url — ровно адрес, с которого открыта игра (Railway всегда https; WEBAPP_URL — только запасной вариант)
app.get('/tonconnect-manifest.json', (req, res) => {
  const host = req.get('x-forwarded-host') || req.get('host');
  const url = (host && !/^localhost|^127\./.test(host) ? `https://${host}` : (process.env.WEBAPP_URL || `${req.protocol}://${host}`)).replace(/\/$/, '');
  res.set({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
  res.json({ url, name: 'Mystic Horizon', iconUrl: `${url}/assets/ui/ton_icon.png` });
});
app.use('/vendor/tonconnect-ui.min.js', (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'node_modules', '@tonconnect', 'ui', 'dist', 'tonconnect-ui.min.js'), { headers: { 'Cache-Control': ASSET_CACHE } }));
const tonWho = (req) => {
  const { initData, guestId } = req.body || {};
  return process.env.DEV_PAYMENTS === 'true' ? resolveUid(initData, guestId) : resolveUid(initData, null);
};
app.post('/api/ton/quote', (req, res) => {
  if (!ton.enabled()) return res.status(400).json({ error: 'Оплата в GRAM выключена' });
  const who = tonWho(req);
  if (!who) return res.status(403).json({ error: 'Покупки доступны только в Telegram' });
  const inv = buildInvoice(who, req.body.item, req.body.bgId);
  if (inv.error) return res.status(400).json({ error: inv.error });
  res.json({ title: inv.invoice.title, stars: inv.stars, ton: ton.tonPrice(inv.stars) });
});
app.post('/api/ton/order', (req, res) => {
  if (!ton.enabled()) return res.status(400).json({ error: 'Оплата в GRAM выключена' });
  const who = tonWho(req);
  if (!who) return res.status(403).json({ error: 'Покупки доступны только в Telegram' });
  const inv = buildInvoice(who, req.body.item, req.body.bgId);
  if (inv.error) return res.status(400).json({ error: inv.error });
  res.json(ton.createOrder(who.uid, inv.invoice.payload, inv.stars, inv.invoice.title));
});
app.post('/api/ton/status', async (req, res) => {
  const who = tonWho(req);
  if (!who) return res.status(403).json({ error: 'Нет игрока' });
  await ton.poll(); // проверяем блокчейн сразу, не дожидаясь планового опроса
  res.json(ton.status(String(req.body.id || ''), who.uid));
});

// Проверка и зачисление оплаты (вызывается ботом)
function isValidPayload(payload) {
  const [kind, uid, id] = String(payload).split(':');
  if (!uid) return false;
  if (kind === 'spin' || kind === 'spin10' || meta.INVOICES[kind] || kind === 'pass' || /^pass[1-4]$/.test(kind)) return true;
  return kind === 'bg' && C.LOBBY_BACKGROUNDS.some((b) => b.id === id && b.price > 0);
}
function onPaid(payload) {
  if (!isValidPayload(payload)) return false;
  const [kind, uid, id] = String(payload).split(':');
  const pr = getProfile(uid);
  pr.paidOnce = true; // скидка на первую покупку израсходована
  if (kind === 'spin') pr.paidSpins += 1;
  else if (kind === 'spin10') pr.paidSpins += 10;
  else if (meta.INVOICES[kind]) { meta.onPaid(kind, pr); refreshUid(uid); notifyUid(uid, `Покупка получена: ${meta.INVOICES[kind].title}`); }
  else if (kind === 'pass' || /^pass[1-4]$/.test(kind)) {
    meta.onPaid(kind, pr);
    const t = meta.SHOP.passTiers[meta.passTier(pr) - 1];
    notifyUid(uid, `Покупка получена: ${t.icon} ${t.name}`);
    for (const p of players.values()) if (p.uid === uid) p.socket.emit('passTier', meta.passTier(pr));
  }
  else if (!pr.bgs.includes(id)) pr.bgs.push(id);
  admin.log('pay', `${pr.name || uid}: оплата ${kind}${id ? ' ' + id : ''}`);
  saveProfiles();
  return true;
}
app.get('/health', (req, res) => res.json({ ok: true, version: VERSION, players: players.size, persistent: store.PERSISTENT }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------- Мир ----------
const world = buildWorld(); // города и охотничьи земли за порталами (server/world.js)
const players = new Map(); // socket.id -> player
const chatHistory = []; // последние сообщения общего чата
const monsters = new Map(); // id -> monster
const pets = new Map(); // id -> зверь-спутник (Урсус)
let monsterSeq = 1;
let fx = []; // события за тик (удары, снаряды, смерти)

// Задания «Квесты» (server/quests.js)
const Q = createQuests({
  getProfile: (uid) => getProfile(uid), notifyUid: (uid, t) => notifyUid(uid, t),
  reward: (...a) => meta.reward(...a), addPassXp: (pr, n) => meta.addPassXp(pr, n), save: () => saveProfiles(),
});
{ const track = Q.track; Q.track = (uid, type, n = 1, info) => { track(uid, type, n, info); clanTrack(uid, type, n); }; } // + клановые задания
// Мета-игра: предметы, рынок, аукцион, батл-пасс, подписка, арена (server/meta.js)
const meta = createMeta({
  quest: (...a) => Q.track(...a),
  C, getProfile, saveProfiles, players, profiles,
  refreshPlayer: (p) => refreshPlayer(p), notifyUid: (uid, t) => notifyUid(uid, t),
  statsFor: (...a) => statsFor(...a), unlockedSkills: (...a) => unlockedSkills(...a),
  // Свиток возвращения: в город текущего мира
  toTown: (p) => { const z = world.byId.get(p.zone); const home = z && world.byId.get(z.town || z.id); if (!home || home.id === p.zone) return false; moveToZone(p, home.id); return true; },
});

// Бой монстров, данжи-лабиринты, выживание и мировые боссы (server/dungeon.js)
const D = createDungeons({
  C, world, monsters, players, pets,
  pushFx: (f) => fx.push(f),
  hurtPlayer: (...a) => hurtPlayer(...a),
  hurtPet: (pet, dmg, now) => hurtPet(skillCtx, pet, dmg, now),
  markDirty: (p) => markDirty(p),
  moveEntity: (...a) => moveEntity(...a),
  moveToZone: (...a) => moveToZone(...a),
  partyMembers: (p) => partyMembers(p),
  getProfile: (uid) => getProfile(uid),
  addPassXp: (pr, n) => meta.addPassXp(pr, n),
  quest: (...a) => Q.track(...a),
  giveLoot: (...a) => giveLoot(...a),
  giveMats: (...a) => giveMats(...a), rollMats: (...a) => Loot.rollMats(...a),
  rollItem: (...a) => I.rollItem(...a), createBag: (...a) => I.createBag(...a),
  corpses: () => corpses,
  removeCorpse: (c) => { corpses = corpses.filter((x) => x !== c); },
  broadcast: (text) => io.emit('chat', { sys: true, text }),
  // Отбрасывание героя (таран, воздушный удар)
  knockPlayer(p, dx, dy, distPx) {
    const l = Math.hypot(dx, dy) || 1;
    for (let i = 0; i < 6; i++) {
      const nx = p.x + dx / l * distPx / 6, ny = p.y + dy / l * distPx / 6;
      if (world.isSolidAt(nx, ny)) break;
      p.x = nx; p.y = ny;
    }
    p.socket.emit('correct', { x: p.x, y: p.y });
  },
  // Подчинение: герой бьёт себя или ближайшего союзника
  selfHit(p, k) { fx.push({ t: 'mtext', x: p.x, y: p.y - 20, text: 'Подчинён!', color: '#ff6ad8' }); hurtPlayer(p, p.dmg * k, null, Date.now()); },
  allyHit(p) {
    let ally = null, bd = 220;
    for (const o of players.values()) if (o !== p && !o.dead && o.zone === p.zone && Math.hypot(o.x - p.x, o.y - p.y) < bd) { ally = o; bd = Math.hypot(o.x - p.x, o.y - p.y); }
    if (ally) { fx.push({ t: 'mtext', x: p.x, y: p.y - 20, text: `Атакует ${ally.name}!`, color: '#ff6ad8' }); hurtPlayer(ally, p.dmg, null, Date.now()); }
    else D_selfHit(p);
  },
});
// Режимы арены: дуэль, команды, клон, тень чемпиона (server/arena.js)
const Arena = require('./arena')({
  C, world, players, monsters, D,
  moveToZone: (...a) => moveToZone(...a), getProfile: (uid) => getProfile(uid), partyMembers: (p) => partyMembers(p),
  revive: (p) => revivePlayer(p), addPassXp: (pr, n) => meta.addPassXp(pr, n), quest: (...a) => Q.track(...a),
  statsFor: (...a) => statsFor(...a), profiles: () => profiles, markDirty: (p) => markDirty(p),
  store, notifyUid: (uid, t) => notifyUid(uid, t), broadcast: (t) => io.emit('chat', { sys: true, text: t }), save: () => saveProfiles(),
});
// ---------- Кланы (data/clans.json): название, тег, глава, участники, история кланового чата ----------
const CLAN = { price: 10000, max: 30, vault: 50, takesPerDay: 3 };
// Клановые задания недели: общий прогресс всех участников; награду забирает каждый, кто внёс вклад
const CLAN_QUESTS = [
  { id: 'ck', icon: '⚔️', name: 'Охота клана', desc: 'Победите монстров всем кланом', type: 'kill', goal: 3000, reward: { gold: 2000, gems: 30 } },
  { id: 'cd', icon: '⭐', name: 'Гроза подземелий', desc: 'Победите полубоссов и боссов данжей', type: 'dungeon', goal: 40, reward: { gold: 3000, gems: 50, mats: { luckStone: 1 } } },
  { id: 'cw', icon: '👹', name: 'Против исполинов', desc: 'Победите мировых боссов', type: 'world', goal: 10, reward: { gold: 4000, gems: 80, itemSpins: 1 } },
  { id: 'ca', icon: '🏟️', name: 'Слава арены', desc: 'Проведите бои на арене', type: 'arena', goal: 30, reward: { gold: 2500, gems: 50 } },
  { id: 'cs', icon: '🎰', name: 'Зов алтаря', desc: 'Сделайте призывы', type: 'summon', goal: 50, reward: { gems: 100 } },
];
const weekNo = () => Math.floor((Date.now() - Date.UTC(2024, 0, 1)) / (7 * 864e5));
const clanWeek = (c) => { if (!c.cq || c.cq.week !== weekNo()) c.cq = { week: weekNo(), prog: {}, by: {}, claimed: {} }; return c.cq; };
function clanTrack(uid, type, n = 1) {
  const c = clanOf(uid);
  if (!c || !CLAN_QUESTS.some((q) => q.type === type)) return;
  const cq = clanWeek(c);
  for (const q of CLAN_QUESTS) {
    if (q.type !== type) continue;
    const before = cq.prog[q.id] || 0;
    if (before >= q.goal) continue;
    cq.prog[q.id] = Math.min(q.goal, before + n);
    (cq.by[uid] ??= {})[q.id] = (cq.by[uid][q.id] || 0) + n;
    if (cq.prog[q.id] >= q.goal) clanNotify(c, `🛡️ Клановое задание «${q.name}» выполнено! Заберите награду: «Игра» → «Клан»`);
  }
  saveClans();
}
// Тег клана над именем героя
const setClanTag = (uid) => { const c = clanOf(uid); for (const o of players.values()) if (o.uid === uid) { o.clanTag = c ? c.tag : null; markDirty(o); } };
const clans = store.readJSON('clans.json', {});
let clanSaveTm = null;
const saveClans = () => { if (clanSaveTm) return; clanSaveTm = setTimeout(() => { clanSaveTm = null; try { store.writeJSON('clans.json', clans); } catch (e) { console.error('clans save', e.message); } }, 500); };
const clanOf = (uid) => { const id = getProfile(uid).clan; const c = id && clans[id]; return c && c.members.includes(uid) ? c : null; };
const clanNotify = (c, text) => { for (const o of players.values()) if (c.members.includes(o.uid)) o.socket.emit('chat', { sys: true, ch: 'clan', text }); };
function clanView(c) {
  const online = new Set([...players.values()].map((o) => o.uid));
  return { id: c.id, name: c.name, tag: c.tag, leader: c.leader, max: CLAN.max,
    members: c.members.map((uid) => { const pr = getProfile(uid); return { uid, name: pr.name || 'Герой', online: online.has(uid), leader: uid === c.leader }; }),
    log: (c.log || []).slice(-30), vault: (c.vault || []).map((it) => ({ ...I.itemView(it), by: it.clanBy || '' })), vaultMax: CLAN.vault };
}
function clanQuestView(c, uid) {
  const cq = clanWeek(c), ends = (weekNo() + 1) * 7 * 864e5 + Date.UTC(2024, 0, 1) - Date.now();
  return { endsIn: ends, list: CLAN_QUESTS.map((q) => ({ id: q.id, icon: q.icon, name: q.name, desc: q.desc, goal: q.goal, prog: cq.prog[q.id] || 0,
    mine: (cq.by[uid] || {})[q.id] || 0, claimed: (cq.claimed[q.id] || []).includes(uid), reward: rewardLabel(q.reward) })) };
}
const rewardLabel = (r) => [r.gold && `💰 ${r.gold}`, r.gems && `💎 ${r.gems}`, r.itemSpins && `🎁 печать ×${r.itemSpins}`, r.mats && Object.entries(r.mats).map(([k, n]) => `${(I.MATS[k] || {}).name || k} ×${n}`).join(', ')].filter(Boolean).join(' · ');
function clanAct(p, d) {
  const pr = getProfile(p.uid), mine = clanOf(p.uid);
  if (d.op === 'info') return { clan: mine ? clanView(mine) : null, quests: mine ? clanQuestView(mine, p.uid) : null, price: CLAN.price };
  // Клановое хранилище: вложить вещь из сумки / забрать (участник — до 3 вещей в день, глава — без лимита)
  if (d.op === 'vaultPut') {
    if (!mine) return { error: 'Вы не в клане' };
    const it = I.findItem(pr, String(d.id || ''));
    if (!it) return { error: 'Предмет не найден' };
    if (Object.values(pr.equip || {}).includes(it.id)) return { error: 'Сначала снимите предмет' };
    if (it.cat === 'bag') return { error: 'Сумки в хранилище не кладут' };
    mine.vault ??= [];
    if (mine.vault.length >= CLAN.vault) return { error: `Хранилище клана заполнено (${CLAN.vault})` };
    I.detach(pr, it);
    pr.items = pr.items.filter((i) => i !== it);
    it.loc = 'clan'; it.clanBy = p.name;
    mine.vault.push(it);
    clanNotify(mine, `📦 ${p.name} положил в хранилище: ${I.itemView(it).name}`);
    saveClans(); saveProfiles();
    return { toast: 'Предмет в хранилище клана', clan: clanView(mine) };
  }
  if (d.op === 'vaultTake') {
    if (!mine) return { error: 'Вы не в клане' };
    const it = (mine.vault || []).find((x) => x.id === String(d.id || ''));
    if (!it) return { error: 'Предмета уже нет' };
    if ((pr.items || []).filter((i) => i.loc !== 'wh').length >= meta.bagSize(pr)) return { error: 'Сумка полна — освободите место' };
    const day = new Date().toISOString().slice(0, 10);
    if (pr.clanTakeDay !== day) { pr.clanTakeDay = day; pr.clanTakes = 0; }
    if (mine.leader !== p.uid && pr.clanTakes >= CLAN.takesPerDay) return { error: `Сегодня уже взято ${CLAN.takesPerDay} вещи — завтра снова` };
    mine.vault = mine.vault.filter((x) => x !== it);
    delete it.clanBy; it.loc = 'bag';
    (pr.items ??= []).push(it);
    pr.clanTakes += 1;
    clanNotify(mine, `📦 ${p.name} взял из хранилища: ${I.itemView(it).name}`);
    saveClans(); saveProfiles();
    return { toast: 'Предмет в сумке', clan: clanView(mine) };
  }
  if (d.op === 'questClaim') {
    if (!mine) return { error: 'Вы не в клане' };
    const q = CLAN_QUESTS.find((x) => x.id === d.id), cq = clanWeek(mine);
    if (!q) return { error: 'Нет такого задания' };
    if ((cq.prog[q.id] || 0) < q.goal) return { error: 'Задание ещё не выполнено' };
    if (!((cq.by[p.uid] || {})[q.id] > 0)) return { error: 'Награду получают участники, которые внесли вклад' };
    if ((cq.claimed[q.id] ??= []).includes(p.uid)) return { error: 'Награда уже получена' };
    cq.claimed[q.id].push(p.uid);
    const msg = meta.reward(pr, q.reward, p.zoneTier || 1);
    saveClans(); saveProfiles();
    return { toast: `🛡️ ${q.name}: ${msg}`, clan: clanView(mine), quests: clanQuestView(mine, p.uid) };
  }
  if (d.op === 'create') {
    if (mine) return { error: 'Вы уже в клане' };
    const name = String(d.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20), tag = String(d.tag || '').replace(/[^A-Za-zА-Яа-яЁё0-9]/g, '').slice(0, 4).toUpperCase();
    if (name.length < 3) return { error: 'Название клана — от 3 символов' };
    if (tag.length < 2) return { error: 'Тег — 2–4 буквы или цифры' };
    if (Object.values(clans).some((c) => c.name.toLowerCase() === name.toLowerCase() || c.tag === tag)) return { error: 'Такое название или тег уже заняты' };
    if (pr.gold < CLAN.price) return { error: `Нужно ${CLAN.price.toLocaleString('ru-RU')} 💰` };
    pr.gold -= CLAN.price;
    const id = 'c' + Date.now().toString(36);
    clans[id] = { id, name, tag, leader: p.uid, members: [p.uid], created: Date.now(), log: [] };
    pr.clan = id; saveClans(); saveProfiles(); setClanTag(p.uid);
    return { toast: `Клан «${name}» [${tag}] создан`, clan: clanView(clans[id]) };
  }
  if (d.op === 'invite') {
    if (!mine) return { error: 'Вы не в клане' };
    const t = players.get(String(d.target || ''));
    if (!t) return { error: 'Игрок не в сети' };
    if (clanOf(t.uid)) return { error: `${t.name} уже в клане` };
    if (mine.members.length >= CLAN.max) return { error: 'В клане нет мест' };
    (mine.invited ??= []).push(t.uid);
    t.socket.emit('clanInvite', { id: mine.id, name: mine.name, tag: mine.tag, from: p.name });
    return { toast: `Приглашение в клан отправлено: ${t.name}` };
  }
  if (d.op === 'accept') {
    const c = clans[String(d.id || '')];
    if (!c || !(c.invited || []).includes(p.uid)) return { error: 'Приглашение устарело' };
    if (mine) return { error: 'Сначала выйдите из своего клана' };
    if (c.members.length >= CLAN.max) return { error: 'В клане нет мест' };
    c.invited = c.invited.filter((u) => u !== p.uid);
    c.members.push(p.uid); pr.clan = c.id; saveClans(); saveProfiles(); setClanTag(p.uid);
    clanNotify(c, `🛡️ ${p.name} вступил в клан`);
    return { toast: `Вы вступили в клан «${c.name}»`, clan: clanView(c) };
  }
  if (d.op === 'leave') {
    if (!mine) return { error: 'Вы не в клане' };
    mine.members = mine.members.filter((u) => u !== p.uid); pr.clan = null;
    if (!mine.members.length) delete clans[mine.id];
    else { if (mine.leader === p.uid) mine.leader = mine.members[0]; clanNotify(mine, `🛡️ ${p.name} покинул клан`); }
    if (!mine.members.length) for (const it of mine.vault || []) { delete it.clanBy; it.loc = 'wh'; pr.items.push(it); } // последний забирает хранилище на склад
    saveClans(); saveProfiles(); setClanTag(p.uid);
    return { toast: 'Вы покинули клан' };
  }
  if (d.op === 'kick') {
    if (!mine || mine.leader !== p.uid) return { error: 'Исключать может только глава клана' };
    const uid = String(d.uid || '');
    if (uid === p.uid || !mine.members.includes(uid)) return { error: 'Нет такого участника' };
    mine.members = mine.members.filter((u) => u !== uid); getProfile(uid).clan = null;
    clanNotify(mine, `🛡️ ${getProfile(uid).name || 'Игрок'} исключён из клана`); notifyUid(uid, `🛡️ Вас исключили из клана «${mine.name}»`);
    saveClans(); saveProfiles(); setClanTag(uid);
    return { toast: 'Участник исключён', clan: clanView(mine) };
  }
  return { error: 'Неизвестное действие' };
}

// Поднять героя с полным здоровьем и ресурсом (возрождение, начало и конец боя на арене)
function revivePlayer(p) {
  p.dead = false; p.hp = p.maxHp; p.res = startRes(p); p.shieldHp = 0; p.cheatUsed = false;
  markDirty(p);
}
function D_selfHit(p) { fx.push({ t: 'mtext', x: p.x, y: p.y - 20, text: 'Подчинён!', color: '#ff6ad8' }); hurtPlayer(p, p.dmg * 0.6, null, Date.now()); }

// Определяет игрока: Telegram (подпись initData) или гость
function resolveUid(initData, guestId) {
  const tgUser = verifyInitData(initData, BOT_TOKEN);
  if (tgUser) {
    const name = tgUser.username || [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'Герой';
    return { uid: 'tg' + tgUser.id, name, tg: true };
  }
  if (!ALLOW_GUESTS || !guestId) return null;
  return { uid: 'guest_' + String(guestId).replace(/[^\w-]/g, '').slice(0, 40), name: null, tg: false };
}

const xpForLevel = (lvl) => Math.round(40 * Math.pow(lvl, 1.6));
// Статы героя: уровень + экипировка (pr.equip) + дубликаты героя (+5% за копию)
const statsFor = (heroId, lvl, pr = null) => {
  const b = C.HEROES[heroId];
  const g = pr ? I.gearStats(pr, heroId) : {};
  const dk = 1 + I.DUPE_STEP * ((pr && pr.heroDupes && pr.heroDupes[heroId]) || 0);
  const R = C.RARITIES[b.rarity] || { base: 1, grow: 1 }; // редкость: сильнее старт и быстрее рост
  return {
    maxHp: Math.round((b.hp * R.base * (1 + 0.12 * R.grow * (lvl - 1)) + (g.hp || 0)) * (1 + (g.hpP || 0) / 100) * dk),
    dmg: Math.round((b.dmg * R.base * (1 + 0.1 * R.grow * (lvl - 1)) + (g.atk || 0)) * (1 + (g.atkP || 0) / 100) * dk),
    resMax: Math.round(b.resource.max * (1 + 0.05 * (lvl - 1))),
  };
};
// Сколько умений героя открыто: по уровню или по дубликатам (C.SKILL_UNLOCK), либо выдано из админки (pr.skillGrant)
function unlockedSkills(pr, heroId, byProgressOnly = false) {
  const lvl = (pr.chars[heroId] || { level: 1 }).level, dup = (pr.heroDupes || {})[heroId] || 0;
  const n = C.SKILL_UNLOCK.filter((u) => lvl >= u.lvl || dup >= u.dup).length;
  const granted = byProgressOnly ? 0 : (pr.skillGrant || {})[heroId] || 0;
  return Math.min(C.HEROES[heroId].skills.length, Math.max(n, granted));
}
// Пересчёт статов игрока после смены экипировки, уровня или дубликатов
function refreshPlayer(p) {
  const pr = getProfile(p.uid);
  p.gear = I.gearStats(pr, p.heroId);
  const k = p.hp / (p.maxHp || 1);
  Object.assign(p, statsFor(p.heroId, p.char.level, pr));
  p.hp = Math.min(p.maxHp, Math.max(1, Math.round(p.maxHp * k)));
  p.unlocked = unlockedSkills(pr, p.heroId);
  if (p.pets) rescalePets(p);
  markDirty(p);
}
const refreshUid = (uid) => { for (const p of players.values()) if (p.uid === uid) refreshPlayer(p); };
const notifyUid = (uid, text) => { for (const p of players.values()) if (p.uid === uid) p.socket.emit('chat', { sys: true, text }); };
// Усиления урона и скорости атаки: временные эффекты навыков и пассивные навыки
const startRes = (p) => (p.hero.resource.start ?? 1) * p.resMax;
// Текущий облик героя (Талиесин): свои дальность, скорость атаки, бег и снаряд
// Аурелиус: стихия меняет только снаряд обычной атаки
const formOf = (p) => (p.hero.forms ? p.hero.forms[p.form || 'human']
  : p.hero.elements ? { ...p.hero, projectile: p.hero.elements[p.form || 'fire'].projectile }
  : p.hero.aspects ? { ...p.hero, projectile: p.hero.aspects[p.form || 'fire'].projectile } : p.hero);
const passiveOf = (p) => (p.hero.passive ? PASSIVES[p.hero.passive.id] : null);
// Штраф за гибель (кроме PvP-арены, матчей и данжа выживания): −10% опыта уровня и «Слабость» на 2 минуты
const DEATH = { xpLoss: 0.1, ms: 2 * 60000, dmg: 0.2, xp: 0.2 };
function deathPenalty(p) {
  const pr = getProfile(p.uid), need = xpForLevel(p.char.level);
  const lost = Math.min(p.char.xp, Math.round(need * DEATH.xpLoss)); // уровень не теряется
  p.char.xp -= lost;
  p.deathUntil = pr.deathUntil = Date.now() + DEATH.ms; // сохраняется в профиле — перезаход не снимает
  const lostElx = Object.values(pr.buffs || {}).some((t) => t > Date.now());
  pr.buffs = {}; // эликсиры сгорают при гибели
  p.gear = I.gearStats(pr, p.heroId); p.buffSig = '';
  p.socket.emit('chat', { sys: true, text: `💀 Вы погибли: −${lost} опыта${lostElx ? ', действие эликсиров закончилось' : ''}. Слабость на 2 минуты: урон −20%, получаемый опыт −20%` });
  p.lastStats = 0;
}
// ---------- Эффекты на герое: значки под полоской здоровья (тап — описание) ----------
// [поле, бафф?, значок (assets/ui/status/<…>.webp или items/<…>), название, описание]
const FX_TIMED = [
  ['roarUntil', 1, 'rage', 'Рёв ярости', 'Урон +40%'], ['frenzyUntil', 1, 'rage', 'Безумие', 'Урон +50%'],
  ['linkUntil', 1, 'rage', 'Связь душ', 'Урон +30%'], ['blessUntil', 1, 'rage', 'Благословение', 'Урон +20%'],
  ['cryUntil', 1, 'rage', 'Клич валькирии', 'Урон +20%'], ['songUntil', 1, 'rage', 'Песнь вдохновения', 'Урон увеличен'],
  ['pactUntil', 1, 'rage', 'Пакт', 'Сила пакта действует'], ['mightUntil', 1, 'rage', 'Мощь', 'Сила атак увеличена'],
  ['atkBuffUntil', 1, 'rage', 'Усиление атаки', 'Урон увеличен'], ['empoweredUntil', 1, 'rage', 'Усиленный удар', 'Следующая атака сильнее'],
  ['nextCritUntil', 1, 'rage', 'Верный удар', 'Следующая атака — критическая'], ['weaponRuneUntil', 1, 'rage', 'Руна оружия', 'Оружие заряжено силой руны'],
  ['elemBuffUntil', 1, 'rage', 'Сила стихии', 'Бонус выбранной стихии'], ['shiftBuffUntil', 1, 'rage', 'Сила облика', 'Бонус после смены облика'],
  ['runeBuffUntil', 1, 'rage', 'Сила руны', 'Бонус выбранной руны'], ['abyssUntil', 1, 'rage', 'Бездна', 'Сила Бездны усиливает атаки'],
  ['hasteUntil', 1, 'haste', 'Ускорение', 'Скорость увеличена'], ['spdBuffUntil', 1, 'haste', 'Быстрота', 'Скорость атаки увеличена'],
  ['flyUntil', 1, 'haste', 'Полёт', 'Монстры не могут достать'], ['stealthUntil', 1, 'invuln', 'Невидимость', 'Монстры вас не замечают'],
  ['dodgeUntil', 1, 'invuln', 'Уклонение', 'Атаки проходят мимо'], ['defUntil', 1, 'shield', 'Защита', 'Получаемый урон снижен'],
  ['stoneArmorUntil', 1, 'shield', 'Каменная броня', 'Получаемый урон снижен'], ['ashArmorUntil', 1, 'shield', 'Пепельная броня', 'Получаемый урон снижен'],
  ['reflectShieldUntil', 1, 'shield', 'Отражение', 'Часть урона возвращается врагу'], ['shieldUntil', 1, 'shield', 'Щит', 'Поглощает урон'],
  ['regenUntil', 1, 'regen', 'Регенерация', 'Здоровье восстанавливается'], ['feralLeechUntil', 1, 'regen', 'Звериная жажда', 'Удары лечат героя'],
  ['slowUntil', 0, 'slow', 'Замедление', 'Скорость снижена'], ['weakUntil', 0, 'weak', 'Проклятие слабости', 'Урон −30%'],
  ['deathUntil', 0, 'curse', 'Слабость после гибели', 'Урон −20%, получаемый опыт −20%'],
];
const FX_CC = { stun: ['stun', 'Оглушение', 'Нельзя действовать'], freeze: ['freeze', 'Заморозка', 'Нельзя действовать'],
  fear: ['fear', 'Страх', 'Герой бежит и не слушается'], root: ['root', 'Корни', 'Нельзя двигаться'], taunt: ['taunt', 'Провокация', 'Атакуете только провокатора'],
  charm: ['curse', 'Очарование', 'Герой под чужой волей'], blind: ['weak', 'Ослепление', 'Атаки промахиваются'] };
const FX_DOT = { poison: ['poison', 'Яд', 'Урон каждую секунду'], burn: ['burn', 'Горение', 'Урон огнём каждую секунду'], bleed: ['bleed', 'Кровотечение', 'Урон каждую секунду'] };
const FX_ELX = { atk: 'elxAtk', def: 'elxDef', agi: 'elxAgi', mind: 'elxMind', xp: 'elxXp', luck: 'elxLuck' };
function playerEffects(p, now = Date.now()) {
  const out = [], left = (t) => Math.ceil((t - now) / 1000);
  for (const [k, buff, icon, name, desc] of FX_TIMED) if (p[k] > now) out.push({ k, b: buff, i: icon, n: name, d: desc, l: left(p[k]) });
  if (p.shieldHp > 0 && !(p.shieldUntil > now)) out.push({ k: 'shieldHp', b: 1, i: 'shield', n: 'Щит', d: `Поглотит ещё ${Math.round(p.shieldHp)} урона`, l: 0 });
  if (p.cc && p.cc.until > now && FX_CC[p.cc.type]) { const [i, n, d] = FX_CC[p.cc.type]; out.push({ k: 'cc', b: 0, i, n, d, l: left(p.cc.until) }); }
  for (const x of p.pdots || []) if (x.until > now && FX_DOT[x.kind]) { const [i, n, d] = FX_DOT[x.kind]; out.push({ k: 'dot_' + x.kind, b: 0, i, n, d, l: left(x.until) }); }
  const pr = getProfile(p.uid);
  for (const [buff, until] of Object.entries(pr.buffs || {})) if (until > now && FX_ELX[buff]) { const m = I.MATS[FX_ELX[buff]]; out.push({ k: 'elx_' + buff, b: 1, art: 'mat_' + FX_ELX[buff], n: m.name, d: m.desc, l: left(until) }); }
  return out;
}
const dmgMult = (p, now = Date.now()) => {
  const ps = passiveOf(p);
  return (p.roarUntil > now ? 1.4 : 1) * (p.frenzyUntil > now ? 1.5 : 1) * (p.linkUntil > now ? 1.3 : 1)
    * (p.pactUntil > now && p.pactType === 'fury' ? 1.5 : 1) * (p.blessUntil > now ? 1.2 : 1)
    * (p.songUntil > now ? 1 + 0.15 * (p.songPw || 1) : 1) // песнь вдохновения Джакомо
    * (p.cryUntil > now ? 1.2 : 1) // клич валькирии
    * (p.weakUntil > now ? 0.7 : 1) // проклятие слабости монстров
    * (p.deathUntil > now ? 1 - DEATH.dmg : 1) // слабость после гибели
    * (ps && ps.dmgMult ? ps.dmgMult(p) : 1);
};
const attackCd = (p, now = Date.now()) => {
  const ps = passiveOf(p);
  const speed = (p.frenzyUntil > now ? 1.5 : 1) * (p.pactUntil > now && p.pactType === 'wind' ? 1.4 : 1) * (p.blessUntil > now ? 1.2 : 1) * (p.songUntil > now ? 1 + 0.1 * (p.songPw || 1) : 1) * (p.hasteUntil > now ? 1.25 : 1) * (ps && ps.speedMult ? ps.speedMult(p) : 1) * (1 + ((p.gear && p.gear.aspd) || 0) / 100);
  return Math.round(formOf(p).cooldown / speed * (p.stoneArmorUntil > now ? 1.3 : 1)); // каменная броня Эмета замедляет
};

// ---------- Зоны ----------
const zoneOf = (e) => world.zoneAtX(e.x);

// Перенос игрока в другую зону (город, портал, телепорт)
function moveToZone(p, zoneId, pos) {
  const z = world.byId.get(zoneId);
  if (!z) return;
  if (p.zone) p.socket.leave('z:' + p.zone);
  p.zone = z.id;
  p.zoneTier = z.tier;
  p.socket.join('z:' + z.id);
  const at = pos || { x: z.spawn.x + (Math.random() - 0.5) * 48, y: z.spawn.y + (Math.random() - 0.5) * 24 };
  p.x = at.x; p.y = at.y; p.lastMove = Date.now();
  p.stealthUntil = 0;
  if (z.kind === 'dungeon') Q.track(p.uid, 'dungeonEnter');
  if (z.kind === 'town') Q.track(p.uid, 'town', z.tier);
  if (p.autofarm) setAutofarm(p, z.kind === 'dungeon'); // автобой — только в данжах; в новом данже замер темпа заново
  for (const pet of p.pets || []) { pet.x = p.x + (Math.random() - 0.5) * 40; pet.y = p.y + 16; pet.target = null; }
  p.socket.emit('zone', { zone: world.payload(z), x: p.x, y: p.y });
  markDirty(p);
}

// Ледяная стена Итилиора: монстр не может зайти внутрь стены
function inIceWall(x, y) {
  for (const t of totems) {
    if (t.kind !== 'iceWall') continue;
    const rx = x - t.x, ry = y - t.y, w = t.wall;
    const along = rx * w.nx + ry * w.ny, across = Math.abs(rx * w.ny - ry * w.nx);
    if (Math.abs(along) <= w.len / 2 + 8 && across <= w.thick / 2 + 10) return true;
  }
  return false;
}
function moveEntity(e, dx, dy) {
  const r = 10;
  const nx = e.x + dx, ny = e.y + dy;
  // Летающие и призрачные монстры проходят сквозь стены (но не за край зоны)
  if (e.noclip) {
    const z = world.zoneAtX(e.x);
    if (z && world.zoneAtX(nx) === z && nx > z.ox + 40 && ny > z.oy + 40 && nx < z.ox + z.w * C.TILE - 40 && ny < z.oy + z.h * C.TILE - 40) { e.x = nx; e.y = ny; }
    return;
  }
  if (e.type && totems.length && !inIceWall(e.x, e.y) && inIceWall(nx, ny)) {
    // Скользим вдоль стены, если можно
    if (!inIceWall(nx, e.y)) e.x = nx; else if (!inIceWall(e.x, ny)) e.y = ny;
    return;
  }
  if (!world.isSolidAt(nx + Math.sign(dx) * r, e.y)) e.x = nx;
  if (!world.isSolidAt(e.x, ny + Math.sign(dy) * r)) e.y = ny;
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, hero: p.heroId, x: Math.round(p.x), y: Math.round(p.y), dir: p.dir,
    hp: p.hp, maxHp: p.maxHp, lvl: p.char.level, tag: p.clanTag || null, dead: p.dead, form: p.form || null, rage: p.roarUntil > Date.now() || p.frenzyUntil > Date.now(),
    guard: p.packUntil > Date.now(), smoke: p.dodgeUntil > Date.now(),
    sh: p.shieldUntil > Date.now() && p.shieldHp > 0, stealth: p.stealthUntil > Date.now(),
    pact: p.pactUntil > Date.now() ? p.pactType : null, elem: p.hero.elements ? p.form : null, asp: p.hero.aspects ? p.form : null, phase: p.hero.phases ? p.form : null, heat: Math.round(p.heat || 0), abyss: p.abyssUntil > Date.now(), mt: p.match ? `${p.match}:${p.team}` : null, pcc: D.ccActive(p), pdot: (p.pdots || []).filter((x) => x.until > Date.now()).map((x) => x.kind)[0] || null, pslow: p.slowUntil > Date.now(), pweak: p.weakUntil > Date.now(), flame: p.hero.flames ? p.form : null, ash: p.ashArmorUntil > Date.now(), rootSelf: p.rootSelfUntil > Date.now(), cry: p.crystals && p.crystals.length ? p.crystals : null, wrune: p.weaponRuneUntil > Date.now() ? p.weaponRuneType : null, might: p.mightUntil > Date.now(), stoneArmor: p.stoneArmorUntil > Date.now(), vow: p.hero.vows ? p.form : null, bless: p.blessUntil > Date.now(),
    song: p.hero.songs ? p.form : null, haste: p.hasteUntil > Date.now(), fly: p.flyUntil > Date.now(), tree: (p.nature || 0) >= 100, vow: p.vowUntil > Date.now() ? p.vowBy : null,
    emp: p.empoweredUntil > Date.now() };
}
function privateStats(p) {
  return { fx: playerEffects(p), passReady: meta.passReady(getProfile(p.uid)), level: p.char.level, xp: p.char.xp, xpNext: xpForLevel(p.char.level), kills: p.char.kills, deathLeft: Math.max(0, Math.ceil(((p.deathUntil || 0) - Date.now()) / 1000)), passTier: meta.passTier(getProfile(p.uid)), autofarm: !!p.autofarm,
    gold: getProfile(p.uid).gold, unlocked: p.unlocked, hp: Math.ceil(p.hp), maxHp: p.maxHp, dmg: Math.round(p.dmg * dmgMult(p)),
    res: Math.floor(p.res), resMax: p.resMax, cd: attackCd(p),
    bonusDmg: Math.round((dmgMult(p) - 1) * 100), bonusSpd: Math.round((formOf(p).cooldown / attackCd(p) - 1) * 100), form: p.form || null,
    formKeys: p.potion ? { potion: p.potion, sign: p.sign } : p.rune ? { rune: p.rune } : p.facet ? { facet: p.facet } : null,
    passiveNote: passiveOf(p)?.note ? passiveOf(p).note(p) : '',
    shield: p.shieldUntil > Date.now() ? Math.round(p.shieldHp) : 0, haste: p.hasteUntil > Date.now(), rooted: p.rootSelfUntil > Date.now(),
    cc: D.ccActive(p), ccMs: p.cc ? Math.max(0, p.cc.until - Date.now()) : 0, rootMs: Math.max(0, (p.rootSelfUntil || 0) - Date.now()), // клиент снимает контроль сам по времени
    slow: p.slowUntil > Date.now(), weak: p.weakUntil > Date.now(),
    flyBoost: (1 + ((p.gear && p.gear.ms) || 0) / 100) * (p.flyUntil > Date.now() ? 1 + 0.03 * (p.blessings || 0) : 1) * (p.stoneArmorUntil > Date.now() ? 0.7 : 1) };
}
// Статы отправляются не чаще 4 раз в секунду (см. игровой цикл)
const markDirty = (p) => { p.dirty = true; };

// ---------- PvP-арена: бой героев в реальном времени ----------
// На арене у каждого героя есть невидимая цель-двойник (запись в monsters с pvpOf), которая каждый тик стоит на месте героя.
// Атаки и умения бьют по двойникам как по монстрам, а урон и контроль переходят на самого героя — так работают все 44 героя без доработки умений.
const PVP_K = 0.45; // урон героев рассчитан на монстров — по игрокам он ниже
const PVP_LEVELS = { town1: [1, 20], town2: [15, 35], town3: [30, 99] };
let pvpSeq = 9e6;
function pvpSync(now) {
  for (const p of players.values()) {
    const z = world.byId.get(p.zone), want = z && z.kind === 'pvp' && !p.dead;
    let m = p.pvpProxy && monsters.get(p.pvpProxy);
    if (!want) { if (m) monsters.delete(m.id); p.pvpProxy = null; continue; }
    if (!m) {
      m = { id: pvpSeq++, pvpOf: p.id, type: 'goblin', x: p.x, y: p.y, homeX: p.x, homeY: p.y, zone: p.zone, tier: z.tier, level: p.char.level, rank: 'normal', affixes: [],
        hp: p.hp, maxHp: p.maxHp, dmg: 0, cd: 1e9, speed: 0, xp: 0, range: 0, aggro: 0, size: 1, target: null, lastAttack: 0, abAt: 1e15,
        dots: [], summons: 0, stunUntil: 0, rootUntil: 0, slowUntil: 0, contrib: null, nm: p.name };
      monsters.set(m.id, m); p.pvpProxy = m.id;
    }
    m.x = p.x; m.y = p.y; m.hp = Math.max(1, p.hp); m.maxHp = p.maxHp; m.level = p.char.level;
    // Контроль, наложенный умениями на двойника, переходит на героя (короче, чем на монстрах)
    if (m.stunUntil > now) { D.ccPlayer(p, 'stun', Math.min(1500, m.stunUntil - now), now); m.stunUntil = 0; }
    if (m.rootUntil > now) { D.ccPlayer(p, 'root', Math.min(1500, m.rootUntil - now), now); m.rootUntil = 0; }
    if (m.freezeUntil > now) { D.ccPlayer(p, 'freeze', Math.min(1200, m.freezeUntil - now), now); m.freezeUntil = 0; }
    if (m.slowUntil > now) { p.slowUntil = Math.max(p.slowUntil || 0, Math.min(m.slowUntil, now + 2500)); m.slowUntil = 0; markDirty(p); }
    m.fearUntil = 0; m.confusedUntil = 0; m.charmUntil = 0; m.tauntUntil = 0;
  }
}
function pvpHit(p, m, raw, opt) {
  const victim = players.get(m.pvpOf);
  if (!victim || victim === p || victim.dead || !p.uid) return 0;
  if (Arena.sameTeam(p, victim)) return 0; // своя команда в матче
  if (!p.match && p.party && p.party === victim.party) return 0; // по своей группе не бьём
  let crit = opt.crit ?? false;
  if (opt.basic && p.nextCritUntil > Date.now()) { crit = true; p.nextCritUntil = 0; }
  const dmg = opt.fixed ? raw * PVP_K : raw * dmgMult(p) * (0.85 + Math.random() * 0.3) * (crit ? 1.6 : 1) * PVP_K
    * (!opt.basic && !opt.pet && p.gear && p.gear.skill ? 1 + p.gear.skill / 100 : 1);
  const before = victim.hp;
  victim.lastPvpBy = p.id; victim.lastPvpAt = Date.now();
  hurtPlayer(victim, dmg, null, Date.now());
  const dealt = Math.max(0, before - Math.max(0, victim.hp));
  if (p.gear && p.gear.ls && dealt > 0 && !p.dead) { p.hp = Math.min(p.maxHp, p.hp + dealt * p.gear.ls / 100); markDirty(p); }
  return dealt;
}
// Победа на арене: рейтинг по Эло; за одного и того же соперника чаще раза в 5 минут рейтинг не растёт
function pvpKill(victim) {
  const killer = Date.now() - (victim.lastPvpAt || 0) < 8000 ? players.get(victim.lastPvpBy) : null;
  const zid = victim.zone;
  if (!killer || killer.zone !== zid) return;
  const kp = getProfile(killer.uid), vp = getProfile(victim.uid);
  const ka = kp.arena ??= { rating: 1000, wins: 0, losses: 0, fights: 0, fightsDay: '' }, va = vp.arena ??= { rating: 1000, wins: 0, losses: 0, fights: 0, fightsDay: '' };
  killer.pvpRecent = (killer.pvpRecent || []).filter((x) => Date.now() - x.t < 5 * 60000);
  const farm = killer.pvpRecent.some((x) => x.uid === victim.uid);
  killer.pvpRecent.push({ uid: victim.uid, t: Date.now() });
  const exp = 1 / (1 + 10 ** ((va.rating - ka.rating) / 400)), delta = farm ? 0 : Math.max(1, Math.round(24 * (1 - exp)));
  ka.rating += delta; va.rating = Math.max(0, va.rating - delta); ka.wins++; va.losses++;
  ka.hero = killer.heroId; ka.name = killer.name; va.hero = victim.heroId; va.name = victim.name;
  const gold = farm ? 0 : 15 * (world.byId.get(zid).tier || 1);
  kp.gold += gold;
  if (!farm) { meta.addPassXp(kp, 3); Q.track(killer.uid, 'arena'); Arena.addPoints(kp, 1); }
  killer.streak = (killer.streak || 0) + 1; victim.streak = 0;
  const msg = `⚔️ ${killer.name} победил ${victim.name}${delta ? ` · рейтинг +${delta} (${ka.rating})` : ' · без рейтинга (тот же соперник)'}${killer.streak >= 3 ? ` · серия ${killer.streak}!` : ''}`;
  for (const o of players.values()) if (o.zone === zid) o.socket.emit('chat', { sys: true, text: msg });
  if (gold) killer.socket.emit('chat', { sys: true, text: `+${gold} 💰 за победу` });
  markDirty(killer);
}

// Урон монстру с учётом разброса и усилений; возвращает нанесённый урон
function damageMonster(p, m, raw, opt = {}) {
  if (!monsters.has(m.id) || m.hp <= 0) return 0;
  if (m.pvpOf) return pvpHit(p, m, raw, opt); // на PvP-арене «монстр» — цель-двойник другого героя
  if (p.oneShot) raw = m.maxHp * 1000; // тест из админки: убийство с одного удара
  let crit = opt.crit ?? false;
  const ps = passiveOf(p);
  const now0 = Date.now();
  // Бонус против конкретной цели (пассивки) и пробитая защита монстра (Кира)
  const tMult = (ps && ps.targetMult ? ps.targetMult(p, m) : 1) * (m.brokenUntil > now0 ? 1.25 : 1)
    * (m.curseUntil > now0 ? 1 + (m.curseAmp || 0.2) : 1) // проклятие Гидеона
    * (m.charmUntil > now0 ? 1.3 : 1) // очарование Галатеи
    * D.takenMult(m, opt, now0); // защита монстра: броня, иммунитеты, «Каменная кожа»
  // Следующая атака из дыма — критическая (Кира)
  if (opt.basic && p.nextCritUntil > now0) { crit = true; p.nextCritUntil = 0; }
  if (opt.basic && ps && ps.forceCrit && ps.forceCrit(p, m)) crit = true; // соколиный глаз Фаэлина
  // fixed — урон без множителей (отражённый урон Малакора)
  const dmg = opt.fixed ? Math.max(1, Math.round(raw))
    : Math.max(1, Math.round(raw * dmgMult(p) * tMult * (0.85 + Math.random() * 0.3) * (crit ? 2 + ((p.gear && p.gear.critDmg) || 0) / 100 : 1)
      * (!opt.basic && !opt.pet && p.gear && p.gear.skill ? 1 + p.gear.skill / 100 : 1))); // сила умений с экипировки
  if (p.gear && p.gear.ls && !opt.pet && !opt.fixed && p.hp < p.maxHp && !p.dead) { p.hp = Math.min(p.maxHp, p.hp + Math.min(dmg, m.hp) * p.gear.ls / 100); markDirty(p); } // вампиризм
  if (ps && ps.onDealt) ps.onDealt(skillCtx, p, Math.min(dmg, m.hp), Date.now()); // вампиризм Кельт'о
  // Кровавая связь Сангвейна: 35% урона передаётся остальным связанным монстрам
  if (!opt.shared && m.bondUntil > now0) {
    for (const o of monsters.values()) {
      if (o !== m && o.bondBy === m.bondBy && o.bondUntil > now0) {
        const owner = players.get(m.bondBy) || p;
        setImmediate(() => damageMonster(owner, o, dmg * 0.35, { fixed: true, shared: true }));
      }
    }
  }
  if (p.feralLeechUntil > now0 && p.hp < p.maxHp) { p.hp = Math.min(p.maxHp, p.hp + Math.min(dmg, m.hp) * 0.4); markDirty(p); } // жажда зверя
  // Щит монстра поглощает урон первым
  let left = dmg;
  if (m.shieldHp > 0) { const a = Math.min(m.shieldHp, left); m.shieldHp -= a; left -= a; }
  m.hp -= left;
  D.onHurt(m, p, dmg, opt, now0);
  D.onMonsterHp(m, now0);
  if (m.hp <= 0 && D.preventDeath(m)) { fx.push({ t: 'hit', kind: 'm', target: m.id, dmg, crit, from: p.id, fx: p.x, fy: p.y, tx: m.x, ty: m.y }); return dmg; }
  if (!opt.confused) m.target = opt.pet || p.id; // монстр отвечает тому, кто ударил (кроме драки под мороком)
  fx.push({ t: 'hit', kind: 'm', target: m.id, dmg, crit, from: p.id, proj: opt.proj || null, basic: !!opt.basic, pet: opt.pet || null, pfx: opt.fromX ?? null, pfy: opt.fromY ?? null, shared: !!opt.shared, reflect: !!opt.reflect, confused: !!opt.confused,
    fx: p.x, fy: p.y, tx: m.x, ty: m.y });
  if (m.hp <= 0) {
    const def = C.MONSTERS[m.type];
    const rw = ps && ps.rewardMult ? ps.rewardMult(p, m) : { xp: 1, gold: 1 };
    // Монстры намного ниже уровнем дают меньше опыта
    const diff = p.char.level - (m.level || 1);
    const baseXp = m.xp * (diff > 4 ? Math.max(0.1, 1 - 0.15 * (diff - 4)) : 1);
    const xp = Math.round(baseXp * rw.xp);
    const gold = Math.round(baseXp / 3 * (0.5 + Math.random()) * rw.gold);
    fx.push({ t: 'death', target: m.id, x: m.x, y: m.y, xp, gold, by: p.id, contract: !!rw.contract });
    monsters.delete(m.id);
    corpses.push({ x: m.x, y: m.y, t: Date.now(), type: m.type, zone: m.zone, level: m.level, maxHp: m.maxHp, dmg: m.dmg, speed: m.speed });
    if (corpses.length > 40) corpses.shift();
    grantXp(p, xp, gold);
    shareKill(p, m, xp);
    dropLoot(p, m);
    if (ps && ps.onKill) ps.onKill(skillCtx, p, Date.now(), m);
    if (m.rank === 'boss') io.emit('chat', { sys: true, text: `${p.name} победил босса «${m.name || def.name}»!` });
    D.onKilled(m, p);
    const zt = (world.byId.get(m.zone) || {}).tier;
    Q.track(p.uid, 'kill', 1, { tier: zt });
    if (['magic', 'rare', 'mini'].includes(m.rank)) Q.track(p.uid, 'elite');
    if (m.rank === 'boss' && !m.hall) Q.track(p.uid, 'boss'); // боссы данжей засчитываются всем участникам (server/dungeon.js)
    if (m.rank === 'world') Q.track(p.uid, 'world');
  }
  return dmg;
}
function healPlayer(p, amount) {
  if (p.dead) return;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  const healed = Math.round(p.hp - before);
  if (healed > 0) fx.push({ t: 'heal', target: p.id, amount: healed });
  markDirty(p);
}
function knockback(m, dx, dy, distPx) {
  // Сдвигаем монстра по шагам, чтобы не проходить сквозь стены
  for (let i = 0; i < 7; i++) moveEntity(m, dx * distPx / 7, dy * distPx / 7);
}
function teleport(p, x, y) {
  if (world.isSolidAt(x, y)) return;
  p.x = x; p.y = y; p.lastMove = Date.now();
  p.socket.emit('correct', { x, y });
}
// Эффекты на земле: тотем Аламариэль (лечит союзников) и осквернённая земля Кельт'о (свой tick).
// Срабатывают раз в секунду.
let totems = [];
let totemSeq = 1;
function addTotem(t) {
  const totem = { id: totemSeq++, kind: 'totem', next: Date.now() + 1000, ...t };
  totems.push(totem);
  return totem;
}
const addGround = (g) => addTotem({ ...g, next: Date.now() + 300 });

// Павшие враги (для «Восстания мёртвых»): хранятся 15 с
let corpses = [];
function takeCorpse(x, y, r, now) {
  corpses = corpses.filter((c) => now - c.t < 15000);
  let best = null, bd = r;
  for (const c of corpses) { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; best = c; } }
  if (best) corpses = corpses.filter((c) => c !== best);
  return best;
}

// Барьер, поглощающий урон (Брендан); суммируется, но не больше 60% здоровья цели
function giveShield(o, amount, until) {
  const now = Date.now();
  const cur = o.shieldUntil > now ? o.shieldHp : 0;
  o.shieldHp = Math.min(o.maxHp * 0.6, cur + amount);
  o.shieldUntil = Math.max(o.shieldUntil || 0, until);
  fx.push({ t: 'shield', target: o.id, amount: Math.round(amount) });
  markDirty(o);
}
// Поднятый монстр-слуга Ориона: облик и сила самого монстра, до 5 слуг
function raiseMinion(owner, corpse, now, auto = false) {
  const def = { hp: corpse.maxHp || 100, dmg: corpse.dmg || 10, speed: corpse.speed || 80, name: (C.MONSTERS[corpse.type] || {}).name || 'Слуга' };
  const minions = owner.pets.filter((pet) => pet.kind === 'minion');
  if (minions.length >= 5) removePet(minions[0]);
  const pet = createSummon(owner, 'minion', corpse.x, corpse.y, 30000, now);
  pet.maxHp = Math.round(def.hp * 0.8); pet.hp = pet.maxHp;
  pet.dmgAbs = def.dmg * 1.2;
  pet.speedAbs = Math.max(110, def.speed * 1.3);
  pet.monsterType = corpse.type || 'skeleton';
  pet.label = def.name;
  addPet(owner, pet);
  fx.push({ t: 'skill', s: 'raiseCorpse', from: owner.id, x: corpse.x, y: corpse.y, auto, quiet: auto });
  markDirty(owner);
  return pet;
}
function addPet(owner, pet) { owner.pets.push(pet); pets.set(pet.id, pet); }
function removePet(pet) {
  pets.delete(pet.id);
  const list = pet.owner.pets;
  const i = list.indexOf(pet);
  if (i >= 0) list.splice(i, 1);
}
// Урон по игроку от монстра: уклонение, защитные эффекты, обет защиты, барьер, пассивки, смерть
function hurtPlayer(target, raw, m, now, viaVow = false) {
  if (target.god) return; // тест из админки: бессмертие
  // Подмена двойником (Ле Блан): удар достаётся иллюзии
  const ps0 = passiveOf(target);
  if (!viaVow && ps0 && ps0.avoidHit && ps0.avoidHit(skillCtx, target, m, now)) return;
  // Уклонение в дыму (Найри)
  if (target.dodgeUntil > now && Math.random() < (target.dodgeChance || 0.5)) { fx.push({ t: 'dodge', target: target.id }); return; }
  const ps = passiveOf(target);
  // Множители входящего урона: «в ущерб защите» (Вайалд), «Зов стаи» (Урсус), пассивки (Брендан)
  let dmg = raw * (target.hero.dmgTaken || 1) * (target.packUntil > now ? 0.65 : 1)
    * (target.pactUntil > now && target.pactType === 'stone' ? 0.6 : 1)
    * (target.blessUntil > now ? 0.8 : 1) * (target.holyAuraUntil > now ? target.holyAuraMult : 1) * (ps && ps.dmgTakenMult ? ps.dmgTakenMult(target) : 1)
    * (1 - ((target.gear && target.gear.def) || 0) / 100 * (1 - ((m && m._pierce) || 0))) // защита с экипировки (бронебойные игнорируют часть)
    * (m && target.hero.fireImmune && C.MONSTERS[m.type] && C.MONSTERS[m.type].fire ? 0.3 : 1); // Кальдеро не боится огня
  // Обет защиты (Брендан): 40% урона союзника принимает на себя защитник, остальное союзнику −20%
  const guardian = !viaVow && target.vowUntil > now ? players.get(target.vowBy) : null;
  if (guardian && !guardian.dead && Math.hypot(guardian.x - target.x, guardian.y - target.y) < 400) {
    const share = dmg * 0.4;
    hurtPlayer(guardian, share, m, now, true);
    dmg = (dmg - share) * 0.8;
  }
  dmg = Math.round(dmg);
  // Барьер поглощает урон первым
  // Отражение магическим барьером (Илирия)
  if (m && target.reflectShieldUntil > now && target.shieldHp > 0 && monsters.has(m.id)) damageMonster(target, m, dmg * 0.3, { fixed: true, reflect: true });
  if (target.shieldHp > 0 && target.shieldUntil > now) {
    const absorbed = Math.min(target.shieldHp, dmg);
    target.shieldHp -= absorbed;
    dmg -= absorbed;
    fx.push({ t: 'absorb', target: target.id, amount: absorbed });
    markDirty(target);
    if (dmg <= 0) return;
  }
  target.hp -= dmg;
  target.lastHurt = now;
  fx.push({ t: 'hit', kind: 'p', target: target.id, dmg, from: m ? m.id : null });
  if (ps && ps.onHurt && target.hp > 0) ps.onHurt(skillCtx, target, dmg, m);
  // Пассивка может спасти от смерти (Вебранд)
  if (target.hp <= 0 && ps && ps.onLethal) ps.onLethal(skillCtx, target);
  if (target.hp <= 0) {
    target.hp = 0;
    target.dead = true;
    target.cc = null; target.pdots = [];
    if (m) m.target = null;
    fx.push({ t: 'pdeath', target: target.id });
    const zKind = (world.byId.get(target.zone) || {}).kind;
    if (zKind === 'pvp' && !target.match) pvpKill(target);
    if (zKind !== 'pvp' && zKind !== 'survival' && !target.match) deathPenalty(target);
    // Гибель союзника рядом усиливает Талмиру
    for (const o of players.values()) {
      const ops = passiveOf(o);
      if (o !== target && !o.dead && ops && ops.onAllyDeath && Math.hypot(o.x - target.x, o.y - target.y) < 400) ops.onAllyDeath(skillCtx, o, now);
    }
    const victim = target;
    setTimeout(() => {
      if (!players.has(victim.id) || Arena.holdsDeath(victim)) return; // павший в матче ждёт конца боя
      victim.dead = false;
      victim.hp = victim.maxHp;
      victim.res = startRes(victim);
      victim.cheatUsed = false;
      victim.shieldHp = 0;
      victim.souls = 0; // души Элнаэрис рассеиваются
      victim.flame = 100; victim.bark = 0; if (victim.crystals) victim.crystals = [];
      if (victim.darkCharges) victim.darkCharges = Math.floor(victim.darkCharges / 2); // Гидеон теряет половину зарядов тьмы
      if (victim.hero.forms) victim.form = 'human'; // возрождается в облике друида
      markDirty(victim);
      // Возрождение в городе своего мира; на PvP-арене — на арене, в случайной точке
      const vz = world.byId.get(victim.zone);
      if (vz.kind === 'pvp') {
        const a = Math.random() * Math.PI * 2, r = (vz.w / 2 - 5) * C.TILE * Math.random();
        victim.x = vz.ox + vz.w * C.TILE / 2 + Math.cos(a) * r; victim.y = vz.oy + vz.h * C.TILE / 2 + Math.sin(a) * r;
        victim.socket.emit('correct', { x: victim.x, y: victim.y, respawn: true });
        return;
      }
      const home = world.byId.get(vz.town);
      if (home.id !== victim.zone) moveToZone(victim, home.id);
      else { victim.x = home.spawn.x; victim.y = home.spawn.y; }
      victim.socket.emit('correct', { x: victim.x, y: victim.y, respawn: true });
    }, 4000);
  }
  markDirty(target);
}

// Отправить клиенту оставшееся время перезарядки умений (после сокращения)
function syncCooldowns(p, now) {
  const left = {};
  for (const sk of p.hero.skills) left[sk.id] = { left: Math.max(0, (p.skillReadyAt[sk.id] || 0) - now), total: sk.cooldown };
  p.socket.emit('skillCds', left);
}
let curSkillMul = 1;
const skillCtx = {
  moveEntity, syncCooldowns, passiveOf,
  isUndead: (m) => !!C.MONSTERS[m.type].undead,
  raiseMinion,
  monsters, players, teleport,
  damageMonster: (p, m, dmg, o) => damageMonster(p, m, dmg * curSkillMul, o), // + уровень умения, которое сейчас применяется
  healPlayer: (p, amount, ...a) => healPlayer(p, amount * curSkillMul, ...a), knockback, addTotem, addGround, takeCorpse, giveShield, addPet, removePet,
  isSolidAt: (x, y) => world.isSolidAt(x, y),
  monsterDef: (m) => C.MONSTERS[m.type] || {},
  pushFx: (f) => fx.push(f),
};

// ---------- Автобой (Золотой орден и выше, server/meta.js → SHOP.passTiers) ----------
// Только онлайн: работает, пока игра открыта; закрыл игру — герой вышел из мира, автобой выключен.
function setAutofarm(p, on) {
  const pr = getProfile(p.uid);
  if (on && meta.passTier(pr) < meta.SHOP.autofarmTier) return 'Автобой открывается Золотым орденом';
  if (on && (world.byId.get(p.zone) || {}).kind !== 'dungeon') return 'Автобой работает только в данжах';
  p.autofarm = !!on;
  p.socket.emit('autofarm', p.autofarm);
  return null;
}

function grantXp(p, amount, gold, shared = false) {
  const pr = getProfile(p.uid), now = Date.now();
  const sub = (meta.isSub(pr) ? meta.SHOP.sub.xpBonus : 0) + (meta.SHOP.passXpGold[meta.passTier(pr)] || 0); // подписка + орден (бесплатный Странника — тоже)
  amount = Math.round(amount * (1 + ((p.gear && p.gear.xp) || 0) / 100 + sub + ((pr.buffs || {}).xp > now ? 0.5 : 0)) * S.xpMult * (p.deathUntil > now ? 1 - DEATH.xp : 1));
  gold = Math.round(gold * (1 + ((p.gear && p.gear.gold) || 0) / 100 + sub) * S.goldMult);
  p.char.xp += amount;
  p.char.gold += gold;
  pr.gold += gold; // общий кошелёк аккаунта
  if (!shared) p.char.kills += 1;
  let leveled = false;
  if (p.char.level >= MOBX.MAX_LEVEL) p.char.xp = Math.min(p.char.xp, xpForLevel(p.char.level) - 1);
  while (p.char.level < MOBX.MAX_LEVEL && p.char.xp >= xpForLevel(p.char.level)) {
    p.char.xp -= xpForLevel(p.char.level);
    p.char.level += 1;
    leveled = true;
  }
  if (leveled) Q.track(p.uid, 'level', p.char.level);
  if (leveled) {
    p.gear = I.gearStats(pr, p.heroId); // надетая вещь могла «открыться» новым уровнем
    Object.assign(p, statsFor(p.heroId, p.char.level, pr));
    p.hp = p.maxHp;
    const before = p.unlocked;
    p.unlocked = unlockedSkills(pr, p.heroId);
    if (p.unlocked > before) p.socket.emit('chat', { sys: true, text: `Открыто новое умение: ${p.hero.skills[p.unlocked - 1].icon} ${p.hero.skills[p.unlocked - 1].name}!` });
    if (p.pets) rescalePets(p);
    p.res = p.resMax;
    fx.push({ t: 'levelup', id: p.id, x: p.x, y: p.y, lvl: p.char.level });
    io.emit('chat', { sys: true, text: `${p.name} (${p.hero.name}) достиг ${p.char.level} уровня!` });
    // Каждые 10 уровней героя — самоцветы (на один призыв)
    if (p.char.level % 10 === 0) { pr.gems = (pr.gems || 0) + 160; p.socket.emit('chat', { sys: true, text: `💎 ${p.hero.name} — ${p.char.level} уровень: +160 самоцветов` }); }
  }
  markDirty(p);
}

// ---------- Группы (кооператив) ----------
const parties = new Map();
let partySeq = 1;
const partyOf = (p) => (p.party ? parties.get(p.party) : null);
const partyMembers = (p) => { const pt = partyOf(p); return pt ? [...pt.members].map((id) => players.get(id)).filter(Boolean) : [p]; };
function sendParty(pt) {
  const list = [...pt.members].map((id) => players.get(id)).filter(Boolean)
    .map((m) => ({ id: m.id, name: m.name, hero: m.hero.name, lvl: m.char.level, zone: world.byId.get(m.zone)?.name || '' }));
  for (const m of list) players.get(m.id).socket.emit('party', { id: pt.id, leader: pt.leader, members: list });
}
function leaveParty(p) {
  const pt = partyOf(p);
  if (!pt) return;
  pt.members.delete(p.id);
  p.party = null;
  p.socket.emit('party', null);
  if (pt.members.size <= 1) {
    for (const id of pt.members) { const o = players.get(id); if (o) { o.party = null; o.socket.emit('party', null); } }
    parties.delete(pt.id);
  } else {
    if (pt.leader === p.id) pt.leader = [...pt.members][0];
    sendParty(pt);
  }
}
// Опыт за убийство делится с группой рядом (каждый получает 70%)
function shareKill(killer, m, xp) {
  for (const o of partyMembers(killer)) {
    if (o === killer || o.dead || o.zone !== killer.zone || Math.hypot(o.x - m.x, o.y - m.y) > 900) continue;
    grantXp(o, Math.round(xp * 0.7), 0, true);
  }
}
// Добыча: обычный монстр — шанс предмета убийце; босс — 2 предмета каждому из группы рядом
function dropLoot(killer, m) {
  const tier = m.tier || 1, boss = m.rank === 'boss' || m.rank === 'mini';
  if (m.rank === 'world') return; // награда мирового босса — по вкладу (server/dungeon.js)
  // Босс и полубосс оставляют сундук: клиент открывает его, и добыча вылетает из него
  if (boss) fx.push({ t: 'chest', x: m.x, y: m.y + 10, big: m.rank === 'boss' });
  const receivers = boss ? partyMembers(killer).filter((o) => o.zone === killer.zone && Math.hypot(o.x - m.x, o.y - m.y) < 900) : [killer];
  for (const o of receivers) {
    const pr = getProfile(o.uid);
    meta.addPassXp(pr, m.rank === 'boss' ? 20 : m.rank === 'mini' ? 8 : 1);
    const luck = (pr.buffs || {}).luck > Date.now() ? 1.3 : 1;
    const rankK = m.rank === 'rare' ? 5 : m.rank === 'magic' ? 2.5 : 1; // усиленные и редкие роняют чаще
    const rolls = m.rank === 'boss' ? 2 : m.rank === 'mini' ? 1 : Math.random() < C.DROPS.chance * luck * rankK * (m.lootMult ?? 1) * S.dropMult ? 1 : 0;
    for (let i = 0; i < rolls; i++) giveLoot(o, pr, I.rollItem(tier, boss ? C.DROPS.boss[tier] : C.DROPS.weights[tier], null, o.heroId), m); // 75% — под класс героя
    // Сумки — редкость: босс 3% (эпическая), полубосс 1% (редкая, 20% — эпическая)
    if (boss && Math.random() < (m.rank === 'boss' ? 0.03 : 0.01) * luck) giveLoot(o, pr, I.createBag(m.rank === 'boss' || Math.random() < 0.2 ? 'epic' : 'rare', tier), m);
    // Материалы, свитки, чертежи и вещи комплектов данжа (server/loot.js)
    const z = world.byId.get(m.zone);
    const dungeon = z && z.kind === 'dungeon' ? { sets: Loot.dungeonSets(z.tier, z.dgIndex) } : null;
    const drop = Loot.rollMats(m, tier, dungeon, luck * (m.lootMult ?? 1) * S.dropMult);
    giveMats(o, pr, drop.mats, m);
    for (const it of drop.items) giveLoot(o, pr, it, m);
  }
}
// Выдать стопку материалов: всплывающая надпись, в чат — только ценное (свитки, чертежи, редкие материалы)
function giveMats(o, pr, mats, at) {
  const names = [];
  for (const [id, n] of Object.entries(mats)) {
    I.addMat(pr, id, n);
    const M = I.MATS[id];
    names.push(`${M.icon}${n > 1 ? '×' + n : ''}`);
    if (['scroll', 'blueprint'].includes(M.kind) || id.startsWith('core')) o.socket.emit('chat', { sys: true, text: `Добыча: ${M.icon} ${M.name}${n > 1 ? ' ×' + n : ''}` });
  }
  if (names.length && at) fx.push({ t: 'loot', x: at.x, y: at.y + 12, to: o.id, name: names.join(' '), color: '#e8d49a' });
}
function giveLoot(o, pr, item, at) {
  // Сумка полна и это не дубликат (дубликат усиливает вещь, места не занимает) — вещь продаётся торговцу сама
  const full = pr.items.filter((i) => i.loc !== 'wh').length >= meta.bagSize(pr);
  const dupe = pr.items.some((i) => i.cat === item.cat && i.tpl === item.tpl && i.rar === item.rar && i.tier === item.tier && (i.dupes || 0) < I.DUPE_MAX);
  if (full && !dupe && item.cat !== 'bag') {
    const v0 = I.itemView(item);
    pr.gold += v0.sell;
    if (at) fx.push({ t: 'loot', x: at.x, y: at.y, to: o.id, name: `💰 +${v0.sell}`, color: '#ffd36a' });
    o.socket.emit('chat', { sys: true, text: `🎒 Сумка полна: ${v0.icon} ${v0.name} продан за ${v0.sell} 💰 — освободите место или перенесите вещи на склад` });
    return v0;
  }
  const res = meta.grant(pr, item);
  const v = I.itemView(res.item);
  if (at) fx.push({ t: 'loot', x: at.x, y: at.y, to: o.id, name: `${v.icon} ${v.name}${res.dupe ? ' ⇧' : ''}`, color: v.color });
  o.socket.emit('chat', { sys: true, text: res.dupe ? `Дубликат! ${v.icon} ${v.name} — оригинал усилен на 5%` : `Добыча: ${v.icon} ${v.name} · ${v.rarName}` });
  if (res.dupe && Object.values(pr.equip).includes(res.item.id)) refreshPlayer(o);
  return v;
}

// ---------- Сокеты ----------
io.on('connection', (socket) => {
  socket.on('join', (data = {}) => {
    if (players.has(socket.id)) return;
    const who = resolveUid(data.initData, data.guestId || socket.id);
    if (!who) {
      socket.emit('error_msg', 'Откройте игру через Telegram-бота');
      return;
    }
    const uid = who.uid;
    const heroId = String(data.hero || '');
    const prj = getProfile(uid);
    if (prj.banned) return socket.emit('error_msg', `Вы заблокированы: ${prj.banned.reason}`);
    if (S.maintenance && !(prj.test || {}).tester) return socket.emit('error_msg', 'Технические работы, зайдите позже');
    if (!C.HEROES[heroId] || !getProfile(uid).heroes.includes(heroId)) {
      socket.emit('error_msg', 'Сначала получите персонажа');
      return;
    }
    const hero = C.HEROES[heroId];
    const name = who.tg ? who.name : (String(data.guestName || '').trim().slice(0, 16) || 'Гость');
    const char = getChar(uid, heroId);
    const p = {
      id: socket.id, uid, name: name.slice(0, 20), heroId, hero, char, socket,
      x: 0, y: 0, zone: null,
      dir: 1, dead: false, lastAttack: 0, lastHurt: 0, lastMove: Date.now(),
      skillReadyAt: {}, wrath: 0, roarUntil: 0, frenzyUntil: 0, bloodStacks: 0, lastKill: 0, favor: 0, empoweredUntil: 0, cheatUsed: false, lastHit: 0, dirty: false, lastStats: 0,
      ...statsFor(heroId, char.level, getProfile(uid)), gear: I.gearStats(getProfile(uid), heroId), unlocked: unlockedSkills(getProfile(uid), heroId),
    };
    p.hp = p.maxHp;
    p.res = startRes(p);
    p.deathUntil = prj.deathUntil || 0; // слабость после гибели переживает перезаход
    p.god = !!(prj.test || {}).god; p.oneShot = !!(prj.test || {}).oneShot; // тестовые режимы из админки
    prj.name = p.name; prj.lastSeen = Date.now();
    if (hero.pets) { p.pets = createPets(p); p.pets.forEach((pet) => pets.set(pet.id, pet)); }
    if (hero.summons) p.pets = []; // слуги появляются навыком «Восстание мёртвых»
    if (hero.elements) p.form = 'fire'; // Аурелиус начинает с огня
    if (hero.vows) { p.form = 'protection'; p.vowSince = Date.now(); } // Валериан начинает с обета защиты
    if (hero.songs) p.form = 'inspire'; // Джакомо начинает с песни вдохновения
    if (hero.aspects) p.form = 'fire'; // Зефира начинает с аспекта пламени
    if (hero.phases) p.form = 'waxing'; // Селена начинает с растущей луны
    if (hero.flames) { p.form = 'bonfire'; p.flame = 100; } // Флэйр начинает в форме костра
    if (heroId === 'brilda') { p.facet = 'atk'; p.crystals = []; }
    if (heroId === 'gardin') p.rune = 'fire';
    if (heroId === 'blaze') p.heat = 0;
    if (heroId === 'tibor') { p.potion = 'thunder'; p.sign = 'igni'; p.tox = 0; }
    p.joinedAt = Date.now();
    // Вход в мир — в стартовом городе
    const start = world.byId.get('town1');
    p.zone = start.id; p.zoneTier = 1; socket.join('z:' + start.id);
    p.x = start.spawn.x + (Math.random() - 0.5) * 64; p.y = start.spawn.y + (Math.random() - 0.5) * 32;
    for (const pet of p.pets || []) { pet.x = p.x; pet.y = p.y + 16; }
    players.set(socket.id, p);
    p.clanTag = (clanOf(uid) || {}).tag || null;

    socket.emit('welcome', {
      id: socket.id,
      tile: C.TILE,
      zone: world.payload(start),
      towns: world.towns,
      skillUnlock: C.SKILL_UNLOCK,
      heroes: C.HEROES,
      monsters: C.MONSTERS,
      stats: privateStats(p),
    });
    socket.emit('chatHistory', [...chatHistory, ...((clanOf(uid) || {}).log || []).slice(-30)].sort((a, b) => a.t - b.t)); // + история клана
    io.emit('chat', { sys: true, text: `${p.name} (${hero.name}, ${hero.title}) вошёл в мир` });
    if (S.motd) socket.emit('chat', { sys: true, text: `📢 ${S.motd}` });
    admin.log('join', `${p.name} (${uid}) вошёл: ${hero.name}`);
  });

  socket.on('move', (d) => {
    const p = players.get(socket.id);
    if (!p || p.dead || !d) return;
    const now = Date.now();
    const dt = Math.min(0.5, (now - p.lastMove) / 1000);
    p.lastMove = now;
    const x = Number(d.x), y = Number(d.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (p.rootSelfUntil > now) { socket.emit('correct', { x: p.x, y: p.y }); return; } // укоренение Ву'гажа
    const cct = D.ccActive(p, now);
    if (cct === 'stun' || cct === 'freeze' || cct === 'root') { socket.emit('correct', { x: p.x, y: p.y }); return; } // контроль от монстров
    // Античит: ограничение скорости (у облика зверя бег быстрее; после смены облика даём запас)
    const flyBoost = p.flyUntil > now ? 1 + 0.03 * (p.blessings || 0) : 1; // полёт Талмиры
    const maxDist = (p.slowUntil > now ? 1 : 1) * Math.max(formOf(p).speed, p.hero.speed) * (p.hasteUntil > now ? 1.25 : 1) * flyBoost * (1 + ((p.gear && p.gear.ms) || 0) / 100) * dt * 1.6 + 12;
    const dist = Math.hypot(x - p.x, y - p.y);
    if (dist > maxDist || world.isSolidAt(x, y)) {
      socket.emit('correct', { x: p.x, y: p.y });
      return;
    }
    if (Math.hypot(x - p.x, y - p.y) > 0.5) p.movedAt = now;
    p.x = x; p.y = y;
    if (d.dir === -1 || d.dir === 1) p.dir = d.dir;
  });

  socket.on('attack', (d) => {
    const p = players.get(socket.id);
    if (!p || p.dead || !d) return;
    const now = Date.now();
    if (now - p.lastAttack < attackCd(p, now) * 0.9) return;
    const ccA = D.ccActive(p, now);
    if (ccA === 'stun' || ccA === 'freeze') return;
    const m = monsters.get(d.targetId);
    if (!m || m.hp <= 0) return;
    if (Math.hypot(m.x - p.x, m.y - p.y) > formOf(p).range + 20) return;
    if (!world.lineOfSight(p.x, p.y, m.x, m.y)) return socket.emit('skillFail', 'Цель за стеной');
    p.lastAttack = now;
    p.dir = m.x < p.x ? -1 : 1;
    p.stealthUntil = 0; // атака выводит из тени
    // Усиленная атака после «Дыхания гармонии»
    const empowered = p.empoweredUntil > now;
    if (empowered) { p.empoweredUntil = 0; fx.push({ t: 'skill', s: 'empHit', from: p.id, x: m.x, y: m.y, quiet: true }); }
    const ps1 = passiveOf(p);
    let basic = ps1 && ps1.basicMult ? ps1.basicMult(p) : 1; // рвение Валериана, жар Блейза, трещины Эмета
    if (p.weaponRuneUntil > now && p.weaponRuneType === 'fire') { m.burnUntil = now + 3000; m.dots = (m.dots || []).concat({ until: now + 3000, dps: p.dmg * 0.3, by: p.id }); }
    if (p.nextAttackBoost) { basic *= p.nextAttackBoost; p.nextAttackBoost = 0; } // овация Джакомо
    damageMonster(p, m, p.dmg * basic * (empowered ? p.empMult || 2 : 1), { crit: Math.random() < 0.15 + ((p.gear && p.gear.crit) || 0) / 100, proj: formOf(p).projectile, basic: true });
    if (ps1 && ps1.onBasicHit && monsters.has(m.id)) ps1.onBasicHit(skillCtx, p, m, now); // мороз Итилиора
    // Ресурс, который копится от ударов (ярость Вебранда)
    p.lastHit = now;
    if (p.hero.resource.perHit) { p.res = Math.min(p.resMax, p.res + p.hero.resource.perHit); markDirty(p); }
  });

  // Уникальное умение героя
  socket.on('skill', (d = {}) => {
    const p = players.get(socket.id);
    if (!p || p.dead) return;
    const now = Date.now();
    const sk = p.hero.skills.find((k) => k.id === d.id) || p.hero.skills[0];
    const fail = (reason) => socket.emit('skillFail', reason);
    const ccS = D.ccActive(p, now);
    if (ccS === 'stun' || ccS === 'freeze') return fail(ccS === 'stun' ? '💫 Оглушение!' : '🧊 Заморожен!');
    // Умения открываются по уровню или дубликатам героя
    const si = p.hero.skills.indexOf(sk);
    if (si >= p.unlocked) { const u = C.SKILL_UNLOCK[si]; return fail(`🔒 Откроется на ${u.lvl} уровне или с ${u.dup} дубл.`); }
    if (now < (p.skillReadyAt[sk.id] || 0)) return fail('Умение ещё не готово');
    const ps = passiveOf(p);
    const cast = ps && ps.beforeCast ? ps.beforeCast(p, sk) : { free: false, power: 1 };
    if (!cast.free && p.res < sk.cost) return fail(`Не хватает: ${p.hero.resource.name}`);
    const hpCost = sk.hpCost ? p.hp * sk.hpCost : 0;
    if (hpCost && p.hp - hpCost < 1) return fail('Слишком мало здоровья');
    const range = skillRange(sk.id, p.hero);
    // Цель умения — только в прямой видимости (не через стены)
    const seen = (m) => world.lineOfSight(p.x, p.y, m.x, m.y);
    let target = monsters.get(d.targetId);
    if (!target || Math.hypot(target.x - p.x, target.y - p.y) > range || !seen(target)) {
      target = null;
      let best = range;
      for (const m of monsters.values()) {
        const dd = Math.hypot(m.x - p.x, m.y - p.y);
        if (dd < best && seen(m)) { best = dd; target = m; }
      }
    }
    if (NEEDS_TARGET.has(sk.id) && !target) return fail('Нет цели рядом');
    if (target) p.dir = target.x < p.x ? -1 : 1;
    p.castPower = cast.power;
    p.castFree = cast.free;
    curSkillMul = I.skillMul(((getProfile(p.uid).skillLv || {})[p.heroId] || [])[si] || 1); // уровень умения (server/meta.js → skillUp)
    let err;
    try { err = SKILLS[sk.id](skillCtx, p, target, now); } finally { curSkillMul = 1; }
    p.castPower = 1;
    p.castFree = false;
    if (err) return fail(err);
    if (sk.id !== 'shadowCloak') p.stealthUntil = 0; // навык выводит из тени
    p.lastSkill = sk.name; // для «Зеркала» Аватара бездны
    if (!cast.free) p.res -= sk.cost;
    if (hpCost) { p.hp -= hpCost; p.lastHurt = now; fx.push({ t: 'hit', kind: 'p', target: p.id, dmg: Math.round(hpCost), from: null }); }
    if (ps && ps.afterCast) ps.afterCast(skillCtx, p, cast.free, sk);
    // Успешная казнь (Кассиан) не уходит на перезарядку
    const cd = p.skillNoCd ? 0 : Math.round(sk.cooldown * (1 - ((p.gear && p.gear.cdr) || 0) / 100)); // перезарядка с экипировки
    p.skillNoCd = false;
    p.skillReadyAt[sk.id] = now + cd;
    socket.emit('skillUsed', { id: sk.id, cooldown: cd });
    markDirty(p);
  });

  // Портал / телепорт: игрок должен стоять рядом с объектом
  socket.on('travel', (d = {}) => {
    const p = players.get(socket.id);
    if (!p || p.dead) return;
    const z = world.byId.get(p.zone);
    const obj = z && z.objs.find((o) => o.id === d.via);
    if (!obj || Math.hypot(obj.x - p.x, obj.y - p.y) > 110) return socket.emit('skillFail', 'Подойдите ближе');
    if (obj.id === 'survival') return D.startSurvival(p);
    if (obj.id === 'arena' && z.kind === 'town') {
      const [lo, hi] = PVP_LEVELS[z.id] || [1, 99];
      if (p.char.level < lo || p.char.level > hi) return socket.emit('skillFail', `Арена ${z.name}: герои ${lo}–${hi} уровня`);
      moveToZone(p, `pvp_${z.id}`);
      return socket.emit('chat', { sys: true, text: `🏟️ PvP-арена ${z.name}: бей других героев! Победа — рейтинг и золото, после гибели — возрождение на арене. Выход — портал на юге.` });
    }
    if (obj.dungeon !== undefined) return D.startDungeon(p, z.id, obj.dungeon);
    let to = obj.to;
    if (obj.id === 'teleport') {
      to = String(d.to || '');
      const target = world.byId.get(to);
      if (!target || target.kind !== 'town' || to === p.zone) return;
      const need = (world.towns.find((t) => t.id === to) || {}).minLevel || 1;
      if (p.char.level < need) return socket.emit('skillFail', `${target.name}: нужен ${need} уровень`);
    }
    if (!to) return;
    // Логово мирового босса: не ниже уровня города и не более чем на 5 уровней ниже босса
    if (obj.world && obj.lv) {
      const need = Math.max((world.towns.find((t) => t.id === z.id) || {}).minLevel || 1, obj.lv[0] - 5);
      if (p.char.level < need) return socket.emit('skillFail', `${obj.name}: нужен ${need} уровень`);
      // Выхода из логова нет — пускаем, только пока босс жив
      const st = D.wbState[z.id];
      if (!st || !st.bossId) return socket.emit('skillFail', `Мирового босса нет · ${D.worldBossInfo(z.id)}`);
    }
    moveToZone(p, to);
    const nz = world.byId.get(to);
    socket.emit('chat', { sys: true, text: nz.kind === 'town' ? `Вы прибыли в город ${nz.name}` : nz.kind === 'worldboss' ? D.worldBossInfo(nz.town) : `Портал: ${nz.name} (${nz.sub})` });
  });

  // Возврат в город из данжа, логова мирового босса или общей PvP-арены (меню «Игра» → «В город»): не в бою
  socket.on('recall', () => {
    const p = players.get(socket.id);
    if (!p || p.dead) return;
    const z = world.byId.get(p.zone);
    if (z && z.kind === 'survival') return socket.emit('skillFail', 'Из данжа выживания не уйти — бой до конца');
    if (z && z.kind === 'worldboss') return socket.emit('skillFail', 'Из логова не уйти, пока жив мировой босс');
    if (!z || !['dungeon', 'pvp'].includes(z.kind) || z.inst || !z.town) return socket.emit('skillFail', 'Отсюда телепорт недоступен');
    if (Date.now() - (p.lastHurt || 0) < 3000) return socket.emit('skillFail', 'Нельзя в бою — подождите 3 секунды без урона');
    moveToZone(p, z.town);
    socket.emit('chat', { sys: true, text: `🌀 Вы вернулись в город ${world.byId.get(z.town).name}` });
  });

  // Инвентарь, магазины, рынок, аукцион, пропуск, арена (server/meta.js)
  socket.on('act', (d, cb) => {
    const p = players.get(socket.id);
    if (!p || typeof cb !== 'function') return;
    try { cb(d && /^(quest|story)/.test(d.op) ? Q.handle(p, d) : meta.handle(p, d || {})); markDirty(p); } catch (e) { console.error('act', d && d.op, e); cb({ error: 'Ошибка сервера' }); }
  });

  // Группа: приглашение игрока из своей зоны, до 4 человек
  socket.on('party', (d = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    if (d.op === 'invite') {
      const t = players.get(d.target);
      if (!t || t === p) return socket.emit('skillFail', 'Игрок не найден');
      if (t.party) return socket.emit('skillFail', `${t.name} уже в группе`);
      let pt = partyOf(p);
      if (!pt) { pt = { id: partySeq++, leader: p.id, members: new Set([p.id]), invited: new Set() }; parties.set(pt.id, pt); p.party = pt.id; sendParty(pt); }
      if (pt.members.size >= 4) return socket.emit('skillFail', 'В группе уже 4 игрока');
      pt.invited.add(t.id);
      t.socket.emit('partyInvite', { id: pt.id, from: p.name });
      socket.emit('chat', { sys: true, text: `Приглашение отправлено: ${t.name}` });
    } else if (d.op === 'accept') {
      const pt = parties.get(d.id);
      if (!pt || !pt.invited.has(p.id)) return socket.emit('skillFail', 'Приглашение устарело');
      if (pt.members.size >= 4) return socket.emit('skillFail', 'Группа заполнена');
      leaveParty(p);
      pt.invited.delete(p.id);
      pt.members.add(p.id);
      p.party = pt.id;
      sendParty(pt);
    } else if (d.op === 'leave') leaveParty(p);
  });

  // Общий чат: последние сообщения хранятся, чтобы вошедший видел, о чём говорили; не чаще раза в 0,7 с
  // Чат: общий, группа, клан, личные сообщения. Клиент шлёт строку (общий) или { text, ch, to }
  socket.on('chat', (d) => {
    const p = players.get(socket.id);
    if (!p) return;
    const text = typeof d === 'string' ? d : d && d.text;
    const ch = typeof d === 'object' && d ? d.ch : 'talk';
    if (typeof text !== 'string') return;
    const clean = text.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 160);
    const now = Date.now();
    if (!clean || now - (p.chatAt || 0) < 700) return;
    p.chatAt = now;
    const msg = { name: p.name, text: clean, t: now, sid: socket.id, ch: 'talk' };
    if (ch === 'party') {
      if (!p.party) return socket.emit('chat', { sys: true, ch: 'party', text: 'Вы не в группе — пригласите игроков через профиль или меню «Группа»' });
      msg.ch = 'party';
      for (const o of partyMembers(p)) o.socket.emit('chat', msg);
      return;
    }
    if (ch === 'clan') {
      const cl = clanOf(p.uid);
      if (!cl) return socket.emit('chat', { sys: true, ch: 'clan', text: 'Вы не в клане — создайте его или вступите по приглашению (меню «Игра» → «Клан»)' });
      msg.ch = 'clan'; msg.tag = cl.tag;
      (cl.log ??= []).push(msg); if (cl.log.length > 50) cl.log.shift();
      for (const o of players.values()) if (cl.members.includes(o.uid)) o.socket.emit('chat', msg);
      saveClans();
      return;
    }
    if (ch === 'pm') {
      const t = players.get(String(d.to || ''));
      if (!t) return socket.emit('chat', { sys: true, ch: 'pm', text: 'Игрок не в сети — личное сообщение не доставлено' });
      if (t === p) return;
      const pm = { ...msg, ch: 'pm', to: t.name, toId: t.id, fromId: p.id };
      t.socket.emit('chat', pm); socket.emit('chat', pm);
      return;
    }
    chatHistory.push(msg);
    if (chatHistory.length > 60) chatHistory.shift();
    io.emit('chat', msg);
  });

  // Кланы: создать, пригласить, вступить, выйти, исключить (глава), состав
  socket.on('clan', (d = {}, cb) => {
    const p = players.get(socket.id);
    if (!p || typeof cb !== 'function') return;
    cb(clanAct(p, d));
  });

  // Арена: очередь на дуэль и команды, бой с клоном и тенью чемпиона
  socket.on('arena', (d = {}, cb) => {
    const p = players.get(socket.id);
    if (!p || typeof cb !== 'function') return;
    if (d.op === 'join') return cb(Arena.join(p, d.mode));
    if (d.op === 'leave') { Arena.leave(p); return cb({ ok: true }); }
    cb(Arena.info(p));
  });

  socket.on('autofarm', (on) => {
    const p = players.get(socket.id);
    if (!p) return;
    const err = setAutofarm(p, !!on);
    if (err) { socket.emit('skillFail', err); socket.emit('autofarm', false); }
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.id);
    if (!p) return;
    Arena.leave(p);
    leaveParty(p);
    players.delete(socket.id);
    getProfile(p.uid).lastSeen = Date.now();
    (p.pets || []).forEach((pet) => pets.delete(pet.id));
    io.emit('chat', { sys: true, text: `${p.name} покинул мир` });
    saveProfiles();
  });
});

// ---------- Игровой цикл ----------
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  // Звери-спутники
  for (const p of players.values()) if (p.pets) updatePets(skillCtx, p, now, dt);

  pvpSync(now);
  // ИИ монстров
  for (const m of monsters.values()) {
    const def = C.MONSTERS[m.type];
    const mspeed = D.curSpeed(m, now);
    // Периодический урон (корни Сильваны)
    if (m.dots.length) {
      for (const d of m.dots) {
        d.next ??= now + 1000;
        const owner = players.get(d.by);
        if (now >= d.next && now <= d.until + 50 && owner) {
          d.next += 1000;
          const dealt = damageMonster(owner, m, d.dps);
          if (d.leech && dealt > 0) healPlayer(owner, dealt * d.leech); // проклятие крови Зу'кры
        }
      }
      m.dots = m.dots.filter((d) => now < d.until);
      if (!monsters.has(m.id)) continue;
    }
    if (m.pvpOf || m.still) continue; // цель-двойник героя на арене и кристаллы босса не ходят и не атакуют
    if (m.stunUntil > now) continue; // оглушён
    // Страх (рёв Талиесина): монстр убегает от источника
    if (m.starUntil > now) { m.fearUntil = 0; m.confusedUntil = 0; } // звёздная метка Фаэлина не даёт скрыться
    if (m.fearUntil > now) {
      const dx = m.x - m.fearX, dy = m.y - m.fearY, d = Math.hypot(dx, dy) || 1;
      moveEntity(m, (dx / d) * mspeed * dt, (dy / d) * mspeed * dt);
      continue;
    }
    // Морок (Ле Блан): монстр нападает на соседа-монстра, без соседей — бродит
    if (m.confusedUntil > now) {
      let other = null, bd = 140;
      for (const o of monsters.values()) {
        if (o === m) continue;
        const d = Math.hypot(o.x - m.x, o.y - m.y);
        if (d < bd) { bd = d; other = o; }
      }
      if (other) {
        const dx = other.x - m.x, dy = other.y - m.y, d = Math.hypot(dx, dy) || 1;
        if (d > C.MONSTER_ATTACK_RANGE) { if (m.rootUntil <= now) moveEntity(m, (dx / d) * mspeed * 0.8 * dt, (dy / d) * mspeed * 0.8 * dt); }
        else if (now - m.lastAttack > m.cd) {
          m.lastAttack = now;
          const caster = players.get(m.confusedBy);
          const dmg = m.dmg * (0.8 + Math.random() * 0.4);
          if (caster) damageMonster(caster, other, dmg, { fixed: true, confused: true });
          else other.hp -= dmg;
        }
      }
      continue;
    }
    // Очарование (песнь Галатеи): монстр не нападает и идёт к сирене
    if (m.charmUntil > now) {
      const siren = players.get(m.charmBy);
      if (siren && !siren.dead) {
        const dx = siren.x - m.x, dy = siren.y - m.y, d = Math.hypot(dx, dy) || 1;
        if (d > 40 && m.rootUntil <= now) moveEntity(m, (dx / d) * mspeed * 0.7 * dt, (dy / d) * mspeed * 0.7 * dt);
      }
      m.target = null;
      continue;
    }
    const rooted = m.rootUntil > now;
    // Цель монстра — игрок или зверь-спутник; провокация Брендана перекрывает выбор
    const taunter = m.tauntUntil > now ? players.get(m.tauntBy) : null;
    if (taunter && !taunter.dead) m.target = taunter.id;
    let target = m.target ? players.get(m.target) || pets.get(m.target) : null;
    if (target && (target.dead || target.down || target.stealthUntil > now || target.flyUntil > now || Math.hypot(target.x - m.x, target.y - m.y) > (m.aggro || def.aggro) * 1.8 || !D.inLeash(m, target))) target = null;
    if (!target) {
      let best = null, bestD = m.aggro || def.aggro;
      for (const p of players.values()) {
        if (p.dead) continue;
        if (m.ignoreUntil > now && m.ignoreId === p.id) continue; // потерял из виду (дымовая завеса)
        if (p.stealthUntil > now || p.flyUntil > now) continue; // невидимость (Кассиан), полёт (Талмира)
        if (!D.canAggro(m, p)) continue; // в данже — только герои в комнате монстра
        const d = Math.hypot(p.x - m.x, p.y - m.y);
        if (d < bestD && world.lineOfSight(m.x, m.y, p.x, p.y)) { best = p; bestD = d; } // замечает только тех, кого видит
      }
      for (const pet of pets.values()) {
        if (pet.down || !D.canAggro(m, pet)) continue;
        const d = Math.hypot(pet.x - m.x, pet.y - m.y);
        if (d < bestD) { best = pet; bestD = d; }
      }
      target = best;
    }
    m.target = target ? target.id : null;
    // Умения, дальний бой и пассивные механики монстра (server/dungeon.js)
    if (D.act(m, target, now, dt)) continue;

    if (target) {
      const dx = target.x - m.x, dy = target.y - m.y;
      const d = Math.hypot(dx, dy);
      if (d > D.meleeRange(m)) {
        if (rooted) continue;
        const s = mspeed * dt; // замедление (осквернённая земля, яд) уже учтено
        if (Math.abs(dx) > 2) m.face = Math.sign(dx); // куда смотрит монстр (удар в спину)
        moveEntity(m, (dx / d) * s, (dy / d) * s);
      } else if (now - m.lastAttack > m.cd) {
        m.lastAttack = now;
        D.melee(m, target, now); // промах при ослеплении, насмешка, вампиризм, яд — внутри
      }
    } else {
      if (rooted) continue;
      // Данж: потерял цель вдали от дома — бегом обратно, дома восстанавливает здоровье
      if (m.room != null) {
        const hx = m.homeX - m.x, hy = m.homeY - m.y, hd = Math.hypot(hx, hy);
        if (hd > 120 && !m.goingHome) { m.goingHome = true; m.homeSince = now; }
        if (m.goingHome) {
          if (now - m.homeSince > 8000) { m.x = m.homeX; m.y = m.homeY; } // застрял за стеной — вернулся сам
          if (Math.hypot(m.homeX - m.x, m.homeY - m.y) < 30) { m.goingHome = false; m.hp = m.maxHp; }
          else { moveEntity(m, (hx / hd) * mspeed * dt, (hy / hd) * mspeed * dt); continue; }
        }
      }
      // Бродим около дома
      if (now > m.nextWander) {
        m.nextWander = now + 1500 + Math.random() * 3000;
        const a = Math.random() * Math.PI * 2;
        m.wander = Math.random() < 0.4 ? null : { x: m.homeX + Math.cos(a) * 80, y: m.homeY + Math.sin(a) * 80 };
      }
      if (m.wander) {
        const dx = m.wander.x - m.x, dy = m.wander.y - m.y;
        const d = Math.hypot(dx, dy);
        if (d > 4) {
          const s = m.speed * 0.4 * dt;
          moveEntity(m, (dx / d) * s, (dy / d) * s);
        }
      }
      if (m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.05 * dt);
    }
  }

  // Регенерация: здоровье вне боя, ресурс (мана/энергия/ярость) всегда
  for (const p of players.values()) {
    if (p.dead) continue;
    D.tickPlayer(p, now); // яд, кровотечение, горение от монстров
    if (p.dead) continue;
    // Регенерация от «Лесного благословения» (Нимуэ)
    if (p.regenUntil > now && p.hp < p.maxHp) { p.hp = Math.min(p.maxHp, p.hp + p.maxHp * p.regenRate * dt); markDirty(p); }
    if (p.hp < p.maxHp && now - p.lastHurt > 5000) {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.04 * dt);
      if (Math.ceil(before) !== Math.ceil(p.hp)) markDirty(p);
    }
    const rs = p.hero.resource;
    const before = p.res;
    if (rs.decay && now - Math.max(p.lastHit, p.lastHurt) > 5000) p.res = Math.max(0, p.res - rs.decay * dt);
    else if (p.res < p.resMax) p.res = Math.min(p.resMax, p.res + rs.regen * dt);
    if (Math.floor(before) !== Math.floor(p.res)) markDirty(p);
    const ps = passiveOf(p);
    if (ps && ps.onTick) ps.onTick(p, now, skillCtx);
    if (ps && ps.dmgMult && p.hp < p.maxHp) markDirty(p); // бонус зависит от здоровья
    // Набор эффектов изменился (появился или закончился) — отправить HUD; отсчёт идёт на клиенте
    if (now - (p.fxCheck || 0) > 400) {
      p.fxCheck = now;
      const sig = playerEffects(p, now).map((e) => `${e.k}:${Math.round(now / 1000 + e.l)}`).join(); // + момент окончания: продление тоже обновит
      if (sig !== p.fxSig) { p.fxSig = sig; markDirty(p); }
    }
    if (p.dirty && now - p.lastStats >= 250) {
      p.dirty = false;
      p.lastStats = now;
      p.socket.emit('stats', privateStats(p));
    }
  }

  // Тотемы
  for (const t of totems) {
    if (now >= t.next && now <= t.until) {
      t.next += t.period || 1000;
      if (t.tick) { t.tick(now); continue; }
      for (const o of players.values()) {
        if (!o.dead && Math.hypot(o.x - t.x, o.y - t.y) <= t.r) healPlayer(o, o.maxHp * t.heal);
      }
    }
  }
  totems = totems.filter((t) => now < t.until);

  // Рассылка состояния — каждой зоне только её объекты
  const zIdx = (x) => Math.floor(x / ZONE_STRIDE);
  const fxZone = (f) => {
    const x = f.x ?? f.fx ?? f.tx;
    if (typeof x === 'number') return zIdx(x);
    const e = players.get(f.target) || players.get(f.id) || players.get(f.from) || monsters.get(f.target);
    return e ? zIdx(e.x) : -1;
  };
  const byZone = new Map();
  for (const p of players.values()) {
    const zi = zIdx(p.x);
    if (!byZone.has(zi)) byZone.set(zi, { zone: p.zone, p: [], m: [], pt: [], t: [], fx: [] });
    byZone.get(zi).p.push(p);
  }
  for (const m of monsters.values()) byZone.get(zIdx(m.x))?.m.push(m);
  for (const pet of pets.values()) byZone.get(zIdx(pet.x))?.pt.push(pet);
  for (const t of totems) byZone.get(zIdx(t.x))?.t.push(t);
  for (const f of fx) byZone.get(fxZone(f))?.fx.push(f);
  for (const Z of byZone.values()) {
  const state = {
    p: Z.p.map(publicPlayer).map((p) => ({ ...p, hp: Math.ceil(p.hp) })),
    m: Z.m.map((m) => slim(m.pvpOf ? { id: m.id, pv: m.pvpOf, nm: '⚔️ ' + m.nm, lv: m.level, tm: (players.get(m.pvpOf) || {}).match ? `${players.get(m.pvpOf).match}:${players.get(m.pvpOf).team}` : null, x: Math.round(m.x), y: Math.round(m.y), hp: Math.ceil(m.hp), maxHp: m.maxHp } : ({ id: m.id, type: m.type, tr: m.tier, lv: m.level, rk: m.rank, nm: m.name, inv: m.inv ? 1 : 0, sz: m.size, sh: m.shieldHp > 0 ? 1 : 0, fm: m.form || m.phase || m.element || null, x: Math.round(m.x), y: Math.round(m.y),
      hs: m.heroSkin || undefined, hp: Math.ceil(m.hp), maxHp: m.maxHp, st: m.stunUntil > now ? 1 : 0, wk: m.weakUntil > now ? 1 : 0,
      mk: m.markUntil > now ? m.markedBy : null, sl: m.sealUntil > now ? 1 : 0,
      sw: m.slowUntil > now ? 1 : 0, tn: m.tauntUntil > now ? 1 : 0,
      ws: m.weakSpotUntil > now ? 1 : 0, br: m.brokenUntil > now ? 1 : 0, ps: m.poisonUntil > now ? 1 : 0,
      bn: m.burnUntil > now ? 1 : 0, bc: m.bloodCurseUntil > now ? 1 : 0, rt: m.rootUntil > now ? 1 : 0,
      cf: m.confusedUntil > now ? 1 : 0, fr: m.fearUntil > now ? 1 : 0, fz: m.frozenUntil > now ? 1 : 0, mo: m.mockUntil > now ? 1 : 0, st2: m.starUntil > now ? 1 : 0, bd: m.bondUntil > now ? 1 : 0, ds: m.darkSealUntil > now ? 1 : 0, bl: m.bleedUntil > now ? 1 : 0, ch: m.charmUntil > now ? 1 : 0, cu: m.curseUntil > now ? 1 : 0, fs: m.frost > 0 ? Math.round(m.frost) : 0, sn: m.stoneUntil > now ? 1 : 0, wsh: m.wbShield ? 1 : 0, vu: m.vulnUntil > now ? 1 : 0, pf: m.petrify > 0 ? Math.round(m.petrify) : 0 }))),
    pt: Z.pt.map((pet) => ({ id: pet.id, kind: pet.kind, owner: pet.owner.id, skin: pet.kind === 'clone' ? 'hero_' + pet.owner.heroId : pet.kind === 'minion' ? 'mon_' + pet.monsterType : null, label: pet.label || null, drowned: pet.drowned ? 1 : 0, x: Math.round(pet.x), y: Math.round(pet.y),
      hp: Math.ceil(Math.max(0, pet.hp)), maxHp: pet.maxHp, down: pet.down, boost: pet.boostUntil > now })),
    t: Z.t.map((t) => ({ id: t.id, kind: t.kind, sub: t.sub || null, ang: t.ang ?? null, x: Math.round(t.x), y: Math.round(t.y), r: t.r, left: t.until - now })),
    fx: Z.fx,
  };
  for (const p of Z.p) p.socket.emit('state', state);
  }
  fx = [];
}, C.TICK_MS);

// Пустые флаги состояния монстров не отправляем: пакет в разы меньше — на медленной связи не копится очередь
const SLIM_KEEP = new Set(['x', 'y', 'hp', 'maxHp', 'lv', 'tr']);
function slim(o) { for (const k in o) if ((o[k] === 0 || o[k] === null || o[k] === undefined) && !SLIM_KEEP.has(k)) delete o[k]; return o; }
// Между тиками — только позиции героев (лёгкий пакет): чужие герои на экране двигаются плавно и без отставания
setTimeout(() => setInterval(() => {
  const byZ = new Map();
  for (const p of players.values()) {
    if (p.dead) continue;
    if (!byZ.has(p.zone)) byZ.set(p.zone, []);
    byZ.get(p.zone).push(p);
  }
  for (const list of byZ.values()) {
    if (list.length < 2) continue;
    const pos = list.map((p) => [p.id, Math.round(p.x), Math.round(p.y), p.dir]);
    for (const p of list) p.socket.volatile.emit('pp', pos);
  }
}, C.TICK_MS), C.TICK_MS / 2);

server.listen(PORT, () => {
  console.log(`MMORPG сервер запущен: http://localhost:${PORT}`);
  if (BOT_TOKEN && process.env.RUN_BOT !== 'false') bot = require('../bot/bot')({ onPaid, isValidPayload });
});

process.on('SIGINT', () => { saveProfiles(); process.exit(0); });
process.on('SIGTERM', () => { saveProfiles(); process.exit(0); });
