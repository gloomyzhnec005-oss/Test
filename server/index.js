require('dotenv').config({ quiet: true });
// Запуск напрямую (node server/index.js — например, своя команда старта на Railway) при заданной базе:
// сначала загрузчик server/boot.js подключит Postgres и загрузит данные, потом он сам запустит этот файл заново
if ((process.env.DATABASE_URL || '').trim() && !global.__booted) { require('./boot'); return; }
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const C = require('./config');
const { buildWorld, ZONE_STRIDE } = require('./world');
const { verifyInitData } = require('./auth');
const { SKILLS, PASSIVES, NEEDS_TARGET, skillRange } = require('./skills');
// Для клиента: id умения → дальность, если без цели рядом оно не сработает
const SKILL_TARGET = Object.fromEntries(Object.values(C.HEROES).flatMap((h) => h.skills.filter((s) => NEEDS_TARGET.has(s.id)).map((s) => [s.id, skillRange(s.id, h)])));
const { createPets, createSummon, rescalePets, updatePets, hurtPet } = require('./pets');
const I = require('./items');
const MOBX = require('./mobs');
const Coll = require('./collection'); // «Память героев»: бонусы за каждого героя в коллекции
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
setInterval(() => Econ.online([...players.values()].filter((p) => !p.offline).length), 30000).unref();
// Сводка экономики по дням (админка → «Экономика»)
const Econ = require('./econ')({ store, profiles: () => profiles });
// Бэкап раз в час (последние 48): игроки, рынок, турнир, настройки админки
store.startBackups(['players.json', 'market.json', 'tournament.json', 'admin.json', 'clans.json'], saveProfiles);
// Снимки всей игры: с базой — каждый час в базу; раз в сутки копия файлом администраторам в Telegram (ADMIN_TG_IDS)
store.startSnapshots(() => { if (global.__saveAll) global.__saveAll(); }, async (buf, nPlayers) => {
  const ids = String(process.env.ADMIN_TG_IDS || '').split(/[\s,]+/).filter(Boolean);
  if (!bot || !ids.length) return;
  const date = new Date(Date.now() + 3 * 36e5).toISOString().slice(0, 10);
  const mb = (buf.length / 1048576).toFixed(1);
  for (const id of ids) {
    try {
      if (buf.length > 49 * 1048576) { await bot.telegram.sendMessage(id, `💾 Бэкап за ${date}: ${mb} МБ — больше лимита Telegram (50 МБ), скачайте в админке → Обзор → Снимки.`); continue; }
      await bot.telegram.sendDocument(id, { source: buf, filename: `mystic-backup-${date}.json.gz` },
        { caption: `💾 Ежедневный бэкап игры · ${date}\nИгроков: ${nPlayers} · ${mb} МБ\nСохраните файл. Восстановить: админка → Обзор → «Восстановить из файла».`, disable_notification: true });
    } catch (e) { console.error('бэкап в Telegram', id, e.message); }
  }
});

function getProfile(uid) {
  profiles[uid] ??= {};
  const pr = profiles[uid];
  pr.chars ??= {};
  pr.heroes ??= [];
  pr.bgs ??= [];
  pr.paidSpins ??= 0;
  pr.freeSpinUsed ??= false;
  pr.created ??= Date.now(); // с этого момента 72 ч действует набор новичка (у старых игроков — с выхода обновления)
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
  linkLevels(pr);
  return pr;
}
// Общий уровень аккаунта: уровень и опыт одни на всех героев (pr.acct). У каждого героя level/xp — ссылки на них,
// поэтому весь код, который читает и меняет p.char.level / p.char.xp, работает как раньше, но для всех героев сразу.
// Переход со старых профилей: берётся лучший уровень среди героев (и его опыт)
function linkLevels(pr) {
  if (!pr.acct) {
    let best = { level: 1, xp: 0 };
    for (const c of Object.values(pr.chars)) if ((c.level || 1) > best.level || ((c.level || 1) === best.level && (c.xp || 0) > best.xp)) best = { level: c.level || 1, xp: c.xp || 0 };
    pr.acct = best;
  }
  for (const c of Object.values(pr.chars)) linkChar(pr, c);
}
const LINKED = Symbol('linked');
function linkChar(pr, c) {
  if (c[LINKED]) return c;
  Object.defineProperty(c, LINKED, { value: true });
  for (const k of ['level', 'xp']) Object.defineProperty(c, k, { enumerable: true, configurable: true, get: () => pr.acct[k], set: (v) => { pr.acct[k] = v; } });
  return c;
}
function getChar(uid, heroId) {
  const pr = getProfile(uid);
  if (!pr.chars[heroId]) { pr.chars[heroId] = { kills: 0, gold: 0 }; linkChar(pr, pr.chars[heroId]); } // уровень — общий (pr.acct)
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
const admin = createAdmin({ evCast: (m) => evCast(m),
  C, I, MOBX, verifyInitData, store, version: () => VERSION,
  get players() { return players; }, get monsters() { return monsters; }, get world() { return world; },
  get D() { return D; }, get Castle() { return Castle; }, get meta() { return meta; }, get io() { return io; }, profiles: null,
  getProfile: (uid) => getProfile(uid), getChar: (uid, h) => getChar(uid, h), saveProfiles: () => saveProfiles(),
  refreshUid: (uid) => refreshUid(uid), markDirty: (p) => markDirty(p), moveToZone: (...a) => moveToZone(...a),
  hurtPlayer: (...a) => hurtPlayer(...a), grantXp: (...a) => grantXp(...a), unlockedSkills: (...a) => unlockedSkills(...a), xpForLevel: (l) => xpForLevel(l), syncCooldowns: (...a) => syncCooldowns(...a),
});
Object.defineProperty(admin.ctx, 'profiles', { get: () => profiles });
// Нагрузка сервера (видно в админке → Обзор): задержка игрового цикла и загрузка процессора за последние ~10 с.
// Задержка p99 больше ~50 мс или процессор под 90% — сервер не успевает, пора брать тариф мощнее
const perf = { lagP50: 0, lagP99: 0, lagMax: 0, cpu: 0 };
{ const h = require('perf_hooks').monitorEventLoopDelay({ resolution: 10 }); h.enable();
  let cpu0 = process.cpuUsage(), t0 = Date.now();
  setInterval(() => {
    const c = process.cpuUsage(cpu0), dt = Date.now() - t0;
    perf.cpu = Math.round(((c.user + c.system) / 1000 / dt) * 100);
    perf.lagP50 = Math.round(h.percentile(50) / 1e6); perf.lagP99 = Math.round(h.percentile(99) / 1e6); perf.lagMax = Math.round(h.max / 1e6);
    h.reset(); cpu0 = process.cpuUsage(); t0 = Date.now();
  }, 10000).unref(); }
admin.ctx.perf = () => perf;
admin.ctx.econ = Econ;
const S = admin.settings;
if (!S.bal2Mig) { S.bal2 = true; S.bal2Mig = 1; admin.saveSettings(); } // ЗБТ: новый баланс включён сразу (выключить можно в админке)
MOBX.setBal2(S.bal2); // «Новый баланс» — прокачка по ступеням, монстры крепче, добыча реже (админка → Настройки)
app.get('/admin/dl/:t/:name', (req, res) => admin.download(req, res)); // одноразовая ссылка на бэкап (для телефона)
app.use('/admin/api', admin.router);
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => (req.body && badArg(req.body) ? res.status(400).json({ error: 'Неверный запрос' }) : next()));
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
    name: pr.nick || who.name, nick: pr.nick || null, nickAt: pr.nickAt || 0, nickCost: nickCost(pr), uid: who.uid, tgId: who.tg ? who.uid.slice(2) : null, heroes: pr.heroes, chars, bgs,
    isAdmin: !!who.tg && admin.isAdminUid(who.uid),
    freeSpin: !pr.freeSpinUsed || FREE_SPINS || S.freeSpins, paidSpins: pr.paidSpins, spinPrice: C.GACHA.spinPrice, gold: pr.gold, dupeMax: C.GACHA.heroDupeMax,
    wish: Wish.view(pr), spin10Price: C.GACHA.spin10Price,
  };
}
// До открытия (админка → Настройки → «Открытие») в лобби можно только смотреть и нажать «Напомнить»:
// призыв героев, покупки и пополнение — только для админов и тестеров
const PRE_OPEN_BLOCK = ['/api/gacha/', '/api/invoice', '/api/ton/quote', '/api/ton/order', '/api/gram/deposit'];
app.use((req, res, next) => {
  if (req.method !== 'POST' || !(S.openAt > Date.now()) || !PRE_OPEN_BLOCK.some((x) => req.path.startsWith(x))) return next();
  const { initData, guestId } = req.body || {};
  const who = resolveUid(initData, guestId);
  if (who && (admin.isAdminUid(who.uid) || ((profiles[who.uid] || {}).test || {}).tester)) return next();
  const d = new Date(S.openAt + 3 * 36e5).toISOString();
  res.status(403).json({ error: `Игра откроется ${d.slice(8, 10)}.${d.slice(5, 7)} в ${d.slice(11, 16)} МСК — тогда станут доступны призыв и покупки` });
});
// Кто открыл игру: что сообщает Telegram (имя, @username, язык, Premium), устройство и откуда пришёл (start_param ссылки).
// Номера телефона мини-приложение не получает. Видно в админке → Игроки.
// ---------- Приглашения друзей (реферальная ссылка игрока) ----------
// Ссылка: https://t.me/<бот>/<приложение>?startapp=r<код>, код — Telegram ID в 36-ричной записи.
// Новичок по ссылке: +100 💎 и 1 печать призыва героя. Пригласившему: друг достиг 10 ур. — 100 💎, 20 ур. — 100 💎 и 2 призыва
// снаряжения; с каждой покупки друга — самоцветы на 10% её стоимости (навсегда). Считается только для новых аккаунтов.
const REF = { newGems: 100, newSpins: 1, l10: { gems: 100 }, l20: { gems: 100, itemSpins: 2 }, share: 0.1, gemsPerStar: 330 / 50 };
const refCode = (uid) => (/^tg\d+$/.test(uid) ? 'r' + Number(uid.slice(2)).toString(36) : null);
const refUid = (code) => (/^r[0-9a-z]{1,14}$/.test(code || '') ? 'tg' + parseInt(code.slice(1), 36) : null);
// При запуске: кто уже пришёл по чьей-то ссылке, но не был засчитан (ошибка до открытия) — засчитать сейчас
setImmediate(() => { try { for (const uid of Object.keys(profiles)) getProfile(uid); } catch (e) { console.error('levels link', e); } }); // общий уровень: связать героев всех профилей сразу (рейтинги читают pr.chars)
setImmediate(() => { try { let n = 0; for (const [uid, pr] of Object.entries(profiles)) if (pr.tgInfo && pr.tgInfo.src && !pr.refBy) { refJoin(uid, pr, pr.tgInfo.src); if (pr.refBy) n++; } if (n) { console.log(`[ref] засчитано приглашений задним числом: ${n}`); saveProfiles(); } } catch (e) { console.error('ref migrate', e); } });
function refJoin(uid, pr, code) {
  const inv = refUid(code);
  // Пригласивший — любой игрок из Telegram, уже открывавший игру (до открытия героев ещё ни у кого нет — раньше из-за этого
  // приглашения не засчитывались). Новичок — без героев и ещё ни к кому не привязан
  if (!inv || inv === uid || pr.refBy || (pr.heroes || []).length || !profiles[inv] || profiles[inv].refBy === uid) return;
  pr.refBy = inv; pr.refAt = Date.now();
  pr.gems = (pr.gems || 0) + REF.newGems; pr.paidSpins = (pr.paidSpins || 0) + REF.newSpins;
  const ip = profiles[inv]; (ip.refs ??= []).push(uid); ip.refN = (ip.refN || 0) + 1;
  notifyUid(inv, `👥 По вашей ссылке пришёл новый игрок! Награды — когда друг достигнет 10 и 20 уровня, и 10% самоцветами с его покупок`);
  admin.log('ref', `${uid} пришёл по приглашению ${inv}`);
}
function refReward(inv, r, why) {
  const ip = profiles[inv]; if (!ip) return;
  if (r.gems) ip.gems = (ip.gems || 0) + r.gems;
  if (r.itemSpins) ip.itemSpins = (ip.itemSpins || 0) + r.itemSpins;
  ip.refEarned = (ip.refEarned || 0) + (r.gems || 0);
  notifyUid(inv, `👥 ${why}: ${r.gems ? `+${r.gems} 💎` : ''}${r.itemSpins ? ` +${r.itemSpins} призыва снаряжения` : ''}`);
  refreshUid(inv);
}
function refLevel(uid, lvl) {
  const pr = profiles[uid]; if (!pr || !pr.refBy) return;
  const who = pr.name || 'Друг';
  if (lvl >= 10 && !pr.refL10) { pr.refL10 = true; refReward(pr.refBy, REF.l10, `${who} достиг 10 уровня`); }
  if (lvl >= 20 && !pr.refL20) { pr.refL20 = true; refReward(pr.refBy, REF.l20, `${who} достиг 20 уровня`); }
}
function refPaid(pr, info) {
  if (!pr.refBy) return;
  const stars = info.currency === 'GRAM' ? (Number(info.amount) || 0) / Math.max(1e-9, ton.rate()) : Number(info.amount) || 0;
  const gems = Math.round(stars * REF.gemsPerStar * REF.share);
  if (gems > 0) refReward(pr.refBy, { gems }, `Покупка приглашённого друга (${pr.name || 'друг'})`);
}
// Доля пригласившего в GRAM: с каждой GRAM-покупки друга (Рынок, Торговый дом, заявки, внешний вид) — 5% суммы,
// а тем, кто пригласил друга ДО открытия игры, — 7%. Платится из дохода игры (на Торговом доме — не больше половины комиссии,
// чтобы торговля «сам с собой» через второй аккаунт не становилась выгодной). К выводу — через 3 дня, как деньги с продаж
const REF_GRAM = { rate: 0.05, early: 0.07 };
// Блогер (флаг в админке у пригласившего) — 7% со всех покупок приглашённых
const refRate = (pr) => (((profiles[pr.refBy] || {}).test || {}).blogger || (S.openAt && pr.refAt && pr.refAt < S.openAt) ? REF_GRAM.early : REF_GRAM.rate);
// Владыки недели (клан-победитель войны кланов): 10% дохода игры с Рынка и Торгового дома — в казну, в понедельник
// делится поровну между участниками, заходившими за неделю. Деньги — только из дохода игры, новых не появляется
const REIGN_SHARE = 0.1;
function reignHouse(house) {
  const c = Object.values(clans).find((x) => x.reignUntil > Date.now());
  if (c && house > 0) { c.reignPool = (c.reignPool || 0) + house * REIGN_SHARE; saveClans(); }
}
function reignPayout(c) {
  const pool = Math.floor(c.reignPool || 0); c.reignPool = 0;
  if (pool < 1e7) return; // меньше 0,01 GRAM — не делим
  const since = Date.now() - 7 * 864e5, act = c.members.filter((u) => profiles[u] && (profiles[u].lastSeen || 0) > since);
  if (!act.length) return;
  const each = Math.floor(pool / act.length);
  for (const u of act) { Trade.grant(u, each, 'reign', `Казна владык клана [${c.tag}]: доля за неделю`); notifyUid(u, `👑 Казна владык [${c.tag}]: ваша доля ${(each / 1e9).toFixed(2)} GRAM — к выводу через 3 дня`); }
  admin.log('reign', `[${c.tag}] казна ${(pool / 1e9).toFixed(2)} GRAM → ${act.length} участникам`);
}
function refHouse(uid, amount, house, city) {
  // Сделка между игроками (комиссия меньше цены): игре — 15% цены, всё сверх — казне замков. Покупка у игры — 10% владыкам
  if (house < amount) { try { Castle.onDeal(amount, house, city); } catch (e) { console.error('castle', e); } }
  else { try { reignHouse(house); } catch (e) { console.error('reign', e); } }
  const pr = profiles[uid];
  if (!pr || !pr.refBy || !profiles[pr.refBy]) return;
  const share = Math.min(amount * refRate(pr), house * 0.5);
  if (!(share >= 1e6)) return; // меньше 0,001 GRAM — не начисляем
  Trade.grant(pr.refBy, share, 'ref', `Доля за покупку друга ${pr.name || ''} (${Math.round(refRate(pr) * 100)}%)`);
  const ip = profiles[pr.refBy]; ip.refGram = (ip.refGram || 0) + Math.round(share);
}
function refInfo(p) { return refInfoUid(p.uid); }
function refInfoUid(uid) {
  const pr = getProfile(uid), code = refCode(uid);
  const refs = (pr.refs || []).map((u) => profiles[u]).filter(Boolean);
  return { ref: { code, app: (process.env.APP_SHORT_NAME || 'play').trim(), bot: (bot && bot.botInfo && bot.botInfo.username) || process.env.BOT_USERNAME || null,
    gram: S.openAt && S.openAt > Date.now() ? null : { rate: REF_GRAM.rate, early: REF_GRAM.early, mine: refs.some((o) => refRate(o) === REF_GRAM.early), got: pr.refGram || 0 }, // до открытия не показываем (анонс после старта)
    n: pr.refN || 0, l10: refs.filter((o) => o.refL10).length, l20: refs.filter((o) => o.refL20).length, earned: pr.refEarned || 0, cfg: REF,
    list: refs.slice(-20).reverse().map((o) => ({ name: o.name || (o.tgInfo && (o.tgInfo.user ? '@' + o.tgInfo.user : o.tgInfo.first)) || 'Новичок', lvl: Math.max(1, ...Object.values(o.chars || {}).map((c) => c.level || 1)) })) } };
}
function noteVisitor(uid, initData, plat) {
  try {
    const q = new URLSearchParams(initData || ''), u = JSON.parse(q.get('user') || 'null');
    if (!u) return;
    const pr = getProfile(uid), now = Date.now(), o = pr.tgInfo || { firstAt: now, visits: 0 };
    if (!pr.tgInfo) refJoin(uid, pr, q.get('start_param')); // первый визит по чужой ссылке — новичок получает бонус
    else if (!pr.refBy && pr.tgInfo.src) refJoin(uid, pr, pr.tgInfo.src); // пришёл по ссылке раньше, но тогда не засчиталось
    pr.tgInfo = { ...o, first: String(u.first_name || '').slice(0, 64), last: String(u.last_name || '').slice(0, 64), user: String(u.username || '').slice(0, 64),
      lang: String(u.language_code || '').slice(0, 8), prem: !!u.is_premium, plat: String(plat || '').slice(0, 16), src: o.src || String(q.get('start_param') || '').slice(0, 64),
      chat: o.chat || String(q.get('chat_type') || '').slice(0, 16), lastAt: now, visits: (o.visits || 0) + 1 };
  } catch { /* необязательно */ }
}
// Публично — только остаток лимитированного тиража (общий оборот игры игрокам не показываем)
app.get('/api/economy', (req, res) => res.json(Trade.publicStats()));
// Окно «Пригласить друга» в лобби (до входа в мир)
app.post('/api/ref', (req, res) => {
  const who = resolveUid((req.body || {}).initData, null);
  if (!who || !who.tg) return res.status(403).json({ error: 'Приглашения доступны в игре через Telegram' });
  res.json(refInfoUid(who.uid));
});
// Окно «Обновления»: только опубликованные (не черновики), новые сверху
const NEWS = require('./news');
app.get('/api/news', (req, res) => res.json({ list: NEWS.filter((n) => !n.draft).slice(0, 20) }));

app.post('/api/profile', (req, res) => {
  const { initData, guestId } = req.body || {};
  const who = resolveUid(initData, guestId);
  if (!who) return res.status(403).json({ error: 'Откройте игру через Telegram-бота' });
  if (who.tg) noteVisitor(who.uid, initData, req.body.plat);
  const ban = getProfile(who.uid).banned;
  if (ban) return res.status(403).json({ error: `Вы заблокированы: ${ban.reason}` });
  res.json(profileView(who));
});

// Свой ник для игроков Telegram (по умолчанию — имя из Telegram). 3–16 символов, уникальный, менять — раз в сутки.
// Смена ника: первая — бесплатно, дальше 500 💎, 1000, 1500 … (не больше 2000)
// Ники уникальны: сравнение без регистра, пробелов и знаков, ё = е, похожие латинские буквы = русские (A/А, O/О…)
const LOOK = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в', '0': 'о', '3': 'з' };
const nickKey = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[\s_.\-]+/g, '').replace(/[aeopcxykmthb03]/g, (c) => LOOK[c]);
const nickOwner = new Map(); // ключ ника → uid
function nickTaken(v, uid) { const o = nickOwner.get(nickKey(v)); return !!o && o !== uid && !!profiles[o]; }
function claimNick(uid, v) { const pr = profiles[uid]; if (pr && pr.nick) { const k = nickKey(pr.nick); if (nickOwner.get(k) === uid) nickOwner.delete(k); } nickOwner.set(nickKey(v), uid); }
// Свободный вариант имени: «Имя», занято — «Имя 2», «Имя 3»…
function freeNick(base, uid) {
  base = (cleanName(base).replace(/\s+/g, ' ').slice(0, 13) || 'Герой');
  if (base.length < 3) base = base.padEnd(3, '_');
  if (!nickTaken(base, uid)) return base;
  for (let i = 2; i < 100000; i++) { const v = `${base} ${i}`; if (!nickTaken(v, uid)) return v; }
  return base + ' ' + uid.slice(-5);
}
// При запуске: у всех игроков из Telegram — свой ник; дубли (старые одинаковые имена) — младшим аккаунтам номер
setImmediate(() => { try {
  const list = Object.entries(profiles).filter(([u]) => /^tg\d+$/.test(u)).sort((a, b) => (a[1].created || a[1].refAt || 0) - (b[1].created || b[1].refAt || 0) || a[0].localeCompare(b[0]));
  let n = 0;
  for (const [u, pr] of list) if (pr.nick && !nickTaken(pr.nick, u)) claimNick(u, pr.nick);
  for (const [u, pr] of list) {
    if (pr.nick && nickOwner.get(nickKey(pr.nick)) === u) continue;
    const v = freeNick(pr.nick || pr.name || 'Герой', u);
    if (pr.nick || pr.name) { pr.nickAuto = !pr.nick || pr.nickAuto; pr.nick = v; pr.name = v; claimNick(u, v); n++; }
  }
  if (n) { console.log(`[nick] уникальные ники выданы: ${n}`); saveProfiles(); }
} catch (e) { console.error('nick index', e); } });
const nickCost = (pr) => (pr.nick && !pr.nickAuto ? Math.min(2000, 500 * ((pr.nickPaid || 0) + 1)) : 0);
app.post('/api/nick', (req, res) => {
  const { initData, nick } = req.body || {};
  const who = resolveUid(initData, null);
  if (!who || !who.tg) return res.status(403).json({ error: 'Откройте игру через Telegram-бота' });
  const pr = getProfile(who.uid);
  if (pr.banned) return res.status(403).json({ error: 'Аккаунт заблокирован' });
  const v = cleanName(nick).replace(/\s+/g, ' ').slice(0, 16);
  if (v.length < 3) return res.status(400).json({ error: 'Ник — от 3 до 16 символов' });
  if (!/^[\p{L}\p{N} _.\-]+$/u.test(v)) return res.status(400).json({ error: 'Только буквы, цифры, пробел, _ . -' });
  if (v === pr.nick && !pr.nickAuto) return res.json(profileView(who));
  const cost = nickCost(pr);
  if (cost && (pr.gems || 0) < cost) return res.status(400).json({ error: `Смена ника стоит ${cost} 💎 — не хватает самоцветов` });
  if (nickTaken(v, who.uid)) return res.status(400).json({ error: 'Этот ник уже занят (или очень похожий)' });
  if (cost) { pr.gems -= cost; pr.nickPaid = (pr.nickPaid || 0) + 1; }
  claimNick(who.uid, v); pr.nickAuto = false;
  pr.nick = v; pr.nickAt = Date.now(); pr.name = v;
  for (const o of players.values()) if (o.uid === who.uid) { o.name = v; o.lastStats = 0; markDirty(o); }
  saveProfiles();
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
  const r = Econ.measure('heroSummon', pr, () => Wish.pull(who.uid, pr, banner, n, FREE_SPINS || S.freeSpins));
  if (r.error) return res.status(402).json(r);
  for (const x of r.results) Econ.item(x.rar, 'hero');
  // «События»: новый мифический герой из призыва (повторы не объявляем)
  const nm = cleanName(pr.nick || pr.name || who.name) || 'Герой';
  for (const x of r.results) if (x.isNew && x.rar === 'mythic') {
    const h = C.HEROES[x.hero];
    if (h) evCast({ ev: 'hero', text: `🌟 ${nm} призвал мифического героя: ${h.name}!` });
  }
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
// Энциклопедия игры: цифры берём прямо из игровых данных, чтобы справка не расходилась с балансом
let wikiCache = null;
app.get('/api/wiki', (req, res) => {
  if (!wikiCache) {
    const towns = world.towns.map((t, i) => ({ id: t.id, name: t.name, sub: t.sub, level: t.level, tier: t.tier || (world.byId.get(t.id) || {}).tier || i + 1 }));
    const nm = (id) => (MOBX.MOBS[id] ? MOBX.MOBS[id].name : id);
    wikiCache = {
      towns, unlock: C.SKILL_UNLOCK, heroRar: Object.fromEntries(Object.entries(C.RARITIES).map(([k, r]) => [k, { name: r.name, color: r.color }])),
      heroes: Object.entries(C.HEROES).map(([id, h]) => ({ id, name: h.name, title: h.title, rarity: h.rarity, cls: I.classOf(id), range: h.range, res: h.resource.name, passive: h.passive && h.passive.name })),
      classes: Object.fromEntries(Object.entries(I.CLASSES).map(([k, c]) => [k, { name: c.name, icon: c.icon }])),
      itemRar: I.ITEM_RARITIES, rarOrder: I.RARITY_ORDER, drops: MOBX.bal2() ? { ...C.DROPS, chance: C.DROPS.chance * 0.25, weights: Object.fromEntries(Object.entries(C.DROPS.weights).map(([t, w]) => [t, dropW2(w, 'normal')])) } : C.DROPS, bal2: MOBX.bal2(), slots: I.SLOT_NAMES, attrs: I.ATTRS, caps: I.CAPS,
      wish: { rates: Wish.RATES, soft: Wish.SOFT, hard: Wish.HARD, legEvery: Wish.LEG_EVERY, gemsPerWish: Wish.GEMS_PER_WISH, dupeMax: C.GACHA.heroDupeMax },
      gear: { pity: meta.SHOP.pity, free: meta.SHOP.freeItemSpins, freeSub: meta.SHOP.freeItemSpinsSub, gemsPerWish: meta.SHOP.gemsPerWish },
      craft: I.WORLD_CRAFT, luck: I.LUCK_STONE, upgrade: I.UPGRADE, craftSlots: I.CRAFT_SLOTS, mats: Object.fromEntries(Object.entries(I.MATS).filter(([, m]) => !m.removed).map(([k, m]) => [k, { name: m.name, icon: m.icon, kind: m.kind, desc: m.desc, buy: m.buy }])),
      runes: Object.entries(I.TEMPLATES.rune).map(([id, r]) => ({ id, name: r.name, icon: r.icon, base: r.base })),
      tree: I.TREE, treeMax: I.TREE_MAX, pasMax: I.PAS_MAX, pasStep: I.PAS_STEP,
      dungeons: Object.fromEntries(Object.entries(MOBX.DUNGEONS).map(([t, list]) => [t, list.map((d) => ({ name: d.name, lv: d.lv, boss: d.bossName || nm(d.boss), minis: (d.minis || []).map(nm), pool: d.pool.map(nm) }))])),
      worldBosses: Object.fromEntries(Object.entries(MOBX.WORLD_BOSSES).map(([t, w]) => [t, { lv: w.lv, list: w.list.map(nm) }])), wbTime: D.wbTimeText(),
      bossTimes: String(process.env.DUNGEON_BOSS_TIMES || '12:00,18:00,23:00'), overLv: D.OVER_LV, death: DEATH,
      trade: { fee: Trade.CFG.fee, wFee: Trade.CFG.wFee, hold: Trade.CFG.holdDays, wLevel: Trade.CFG.wLevel, wAge: Trade.CFG.wAgeDays, wMin: Trade.CFG.wMin, slots: Trade.CFG.slots, orders: meta.SHOP.passTiers.filter((t) => t.trade).map((o) => ({ name: o.name, icon: o.icon, stars: o.price, perks: o.perks })) },
      bag: meta.SHOP.bag, bagSub: meta.SHOP.bagSub, wh: meta.SHOP.wh,
      companions: Object.entries(I.COMPANIONS).filter(([, c]) => c.art).map(([id, c]) => ({ id, name: c.name, rare: !!c.rare, price: c.price, bonus: c.bonus })),
      warPts: WAR_PTS, passDays: meta.SHOP.pass.days, passLevels: meta.SHOP.pass.levels,
    };
  }
  res.json(wikiCache);
});
// ---------- Онлайн, открытие игры, технический перерыв ----------
// Настоящий онлайн: всего в игре, в данжах, у мировых боссов; S.onlineMin — с какого числа показывать общий онлайн
function onlineInfo() {
  let total = 0, dg = 0, wb = 0, town = 0;
  for (const p of players.values()) {
    if (p.offline) continue;
    total++;
    const z = world.byId.get(p.zone);
    if (!z) continue;
    if (z.kind === 'dungeon' || z.kind === 'survival') dg++; else if (z.kind === 'worldboss') wb++; else if (z.kind === 'town') town++;
  }
  return { total, dg, wb, town, showTotal: total >= (S.onlineMin ?? 20) };
}
const launchInfo = () => ({ links: { channel: S.channel || '', chat: S.chat || '', partners: S.partners || [], zbt: !!S.zbt }, openAt: S.openAt > Date.now() ? S.openAt : 0, brk: S.brk && S.brk.at + S.brk.min * 60e3 > Date.now() ? { at: S.brk.at, min: S.brk.min } : null, maint: !!S.maintenance, now: Date.now() });
app.get('/api/status', (req, res) => res.json({ online: onlineInfo(), ...launchInfo() }));
// «Напомнить об открытии» — бот напишет в момент открытия
app.post('/api/remind', (req, res) => {
  const { initData, guestId } = req.body || {};
  const who = resolveUid(initData, guestId);
  if (!who) return res.status(403).json({ error: 'Откройте игру через Telegram-бота' });
  const pr = getProfile(who.uid);
  pr.remindOpen = true; saveProfiles();
  res.json({ ok: true, tg: !!who.tg });
});
let launchFired = !S.openAt || S.openAt <= Date.now();
const fmtHM = (t) => new Date(t + 3 * 36e5).toISOString().slice(11, 16);
setInterval(() => {
  if (MOBX.bal2() !== !!S.bal2) MOBX.setBal2(S.bal2); // переключили в админке — новые монстры и опыт уже по нему
  const now = Date.now();
  io.emit('online', onlineInfo());
  // Открытие: в момент openAt — объявление и сообщение от бота всем, кто нажал «Напомнить»
  if (S.openAt && !launchFired && now >= S.openAt) {
    launchFired = true;
    evCast({ text: '🎉 Mystic Horizon открыт! Добро пожаловать, герои!' });
    // Сообщение от бота — всем игрокам Telegram, кому ещё не писали об ЭТОМ открытии (pr.openMsg), кроме отключивших
    // уведомления: и нажавшим «Напомнить», и всем, кто заходил до открытия. Кто получил сообщение о раннем (ошибочном)
    // открытии — получит и это. Отправка с паузой 50 мс (лимит Telegram ~30 сообщений в секунду)
    if (bot) {
      const list = Object.entries(profiles).filter(([uid, pr]) => uid.startsWith('tg') && pr.openMsg !== S.openAt && !pr.notifyOff && !pr.pushBlocked);
      const kb = process.env.WEBAPP_URL ? { reply_markup: { inline_keyboard: [[{ text: '⚔️ Играть', web_app: { url: process.env.WEBAPP_URL } }]] } } : {};
      const log = S.launchLog = { at: now, openAt: S.openAt, n: list.length, ok: 0, fail: 0 };
      list.forEach(([uid, pr], i) => {
        pr.remindOpen = false; pr.openMsg = S.openAt;
        setTimeout(() => bot.telegram.sendMessage(uid.slice(2), '🎉 Mystic Horizon открыт! Первые 3 дня — подарок основателя: 300 💎, призывы и великий эликсир опыта.', kb)
          .then(() => { log.ok++; }, (e) => { log.fail++; if (e && (e.code === 403 || /blocked|deactivated|chat not found/i.test(e.message || ''))) pr.pushBlocked = true; })
          .finally(() => { if (log.ok + log.fail === log.n) { admin.saveSettings(); saveProfiles(); } }), i * 50);
      });
      admin.saveSettings();
      console.log(`[launch] открытие: сообщение бота ${list.length} игрокам`);
    }
    saveProfiles();
  }
  if (S.openAt > now) launchFired = false;
  // Технический перерыв: предупреждения за 30, 15, 5 и 1 минуту, затем вход закрыт до конца перерыва
  const b = S.brk;
  if (b) {
    const left = b.at - now, end = b.at + b.min * 60e3;
    for (const m of [60, 30, 15, 5, 1]) if (left <= m * 60e3 && left > 0 && !(b.warned || []).includes(m)) {
      (b.warned ??= []).push(m);
      evCast({ text: `🔧 Через ${m} мин (в ${fmtHM(b.at)} МСК) — технический перерыв на ${b.min} мин. Закончите бой и выйдите в город.` });
      io.emit('brk', launchInfo().brk);
    }
    if (now >= b.at && now < end && !S.maintenance) {
      S.maintenance = true; S.brkAuto = true; admin.saveSettings();
      for (const p of [...players.values()]) if (!(getProfile(p.uid).test || {}).tester) { p.socket.emit('error_msg', `Технический перерыв до ${fmtHM(end)} МСК`); p.socket.disconnect(true); }
    }
    if (now >= end) { if (S.brkAuto) { S.maintenance = false; S.brkAuto = false; } S.brk = null; admin.saveSettings(); }
  }
}, 5000);

app.get('/api/config', (req, res) => res.json({
  heroPerks: Object.fromEntries(Object.keys(C.HEROES).map((id) => [id, Coll.heroPerk(id)])), // «Память героев»: что даёт каждый
  heroes: C.HEROES, rarities: C.RARITIES, monsters: C.MONSTERS, backgrounds: C.LOBBY_BACKGROUNDS, gacha: C.GACHA, skillUnlock: C.SKILL_UNLOCK,
  botName: (bot && bot.botInfo && bot.botInfo.username) || process.env.BOT_USERNAME || null, // для кнопки «Помощь с покупками»
}));

// Покупки за Telegram Stars: фон лобби (item=bg) или крутка гачи (item=spin)
let bot = null;
app.post('/api/invoice', async (req, res) => {
  const { initData, guestId, item, bgId, to } = req.body || {};
  // DEV_PAYMENTS=true — тестовый режим: покупка зачисляется сразу, без Telegram
  if (process.env.DEV_PAYMENTS === 'true') {
    const w = resolveUid(initData, guestId);
    if (!w) return res.status(403).json({ error: 'Нет игрока' });
    const no = meta.INVOICES[item] && meta.canBuy(item, getProfile(w.uid));
    if (no) return res.status(400).json({ error: no });
    const to = req.body && req.body.to;
    const ok = onPaid(item === 'bg' ? `bg:${w.uid}:${bgId}` : to ? `${item}:${to}:g${w.uid}` : `${item}:${w.uid}`); // тест подарка — как настоящий
    return ok ? res.json({ devPaid: true }) : res.status(400).json({ error: 'Неизвестный товар' });
  }
  const who = resolveUid(initData, null);
  if (!who || !who.tg) return res.status(403).json({ error: 'Покупки доступны только в Telegram' });
  if (!bot) return res.status(503).json({ error: 'Оплата временно недоступна' });
  const inv = buildInvoice(who, item, bgId, to);
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
// Подарки другу (магазин → «🎁 Подарок другу»): платит дарящий, получает друг. Только эти товары (без личных:
// ордена считаются от текущего ордена получателя, набор новичка — разовый)
const GIFTABLE = (k) => k === 'spin' || k === 'spin10' || (meta.INVOICES[k] && !/^(starter|card30|sub|whUp)/.test(k) && !Trade.isOrder(k));
function buildInvoice(who, item, bgId, to) {
  let invoice;
  if (to) { // подарок: счёт выставляется дарящему, payload — на получателя с пометкой g<дарящий>
    const tu = String(to);
    if (!/^tg\d+$/.test(tu) || !profiles[tu]) return { error: 'Получатель не найден' };
    if (tu === who.uid) return { error: 'Себе подарок не отправить' };
    if (!GIFTABLE(item)) return { error: 'Этот товар нельзя подарить' };
    const v = item === 'spin' || item === 'spin10' ? { title: item === 'spin10' ? 'Печати призыва ×10' : 'Печать призыва', description: 'Призыв героя', amount: item === 'spin10' ? C.GACHA.spin10Price : C.GACHA.spinPrice } : meta.INVOICES[item];
    const nm = (profiles[tu].name || 'игрок').slice(0, 30);
    invoice = { title: `🎁 ${v.title} → ${nm}`.slice(0, 32), description: `Подарок для ${nm}: ${v.description}`.slice(0, 255), payload: `${item}:${tu}:g${who.uid}`, prices: [{ label: v.title, amount: v.amount }] };
    return { invoice, stars: v.amount }; // без скидки первой покупки
  }
  if (/^pass([1-9]|10)$/.test(item)) { // сезонный орден: цена — разница с уже купленным
    const v = meta.passInvoice(getProfile(who.uid), +item.slice(4));
    if (v.error) return { error: v.error };
    invoice = { title: v.title, description: v.description, payload: `${item}:${who.uid}`, prices: [{ label: v.title, amount: v.amount }] };
    if (v.personal) return { invoice, stars: v.amount }; // личная цена от администрации — без скидки первой покупки
  } else if (meta.INVOICES[item]) {
    const no = meta.canBuy(item, getProfile(who.uid)); // набор новичка — один раз и только первые 72 ч
    if (no) return { error: no };
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
const ton = require('./ton')({ store, onPaid: (payload, info) => onPaid(payload, info), onDeposit: (uid, nano, hash) => Trade.onDeposit(uid, nano, hash), log: (k, t) => admin.log(k, t) });
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
  const inv = buildInvoice(who, req.body.item, req.body.bgId, req.body.to);
  if (inv.error) return res.status(400).json({ error: inv.error });
  res.json({ title: inv.invoice.title, stars: inv.stars, ton: ton.tonPrice(inv.stars) });
});
app.post('/api/ton/order', (req, res) => {
  if (!ton.enabled()) return res.status(400).json({ error: 'Оплата в GRAM выключена' });
  const who = tonWho(req);
  if (!who) return res.status(403).json({ error: 'Покупки доступны только в Telegram' });
  const inv = buildInvoice(who, req.body.item, req.body.bgId, req.body.to);
  if (inv.error) return res.status(400).json({ error: inv.error });
  res.json(ton.createOrder(who.uid, inv.invoice.payload, inv.stars, inv.invoice.title));
});
// Пополнение GRAM-баланса: адрес кошелька игры и личный комментарий игрока (перевод с ним зачисляется на баланс)
app.post('/api/gram/deposit', (req, res) => {
  if (!ton.enabled()) return res.status(400).json({ error: 'Оплата в GRAM выключена' });
  const who = tonWho(req);
  if (!who) return res.status(403).json({ error: 'Пополнение доступно только в Telegram' });
  const g = Number(req.body.amount) || 0;
  if (g && g < Trade.CFG.depMin) return res.status(400).json({ error: `Минимум ${Trade.CFG.depMin} GRAM` });
  res.json(ton.depositInfo(who.uid, g));
});
app.post('/api/gram/check', async (req, res) => {
  const who = tonWho(req);
  if (!who) return res.status(403).json({ error: 'Нет игрока' });
  await ton.poll();
  res.json({ total: Trade.bal(getProfile(who.uid)).total });
});
app.post('/api/ton/status', async (req, res) => {
  const who = tonWho(req);
  if (!who) return res.status(403).json({ error: 'Нет игрока' });
  await ton.poll(); // проверяем блокчейн сразу, не дожидаясь планового опроса
  res.json(ton.status(String(req.body.id || ''), who.uid));
});

// Проверка и зачисление оплаты (вызывается ботом)
function isValidPayload(payload, beforePay = false) {
  const [kind, uid, id] = String(payload).split(':');
  if (!uid) return false;
  // Перед оплатой (pre_checkout): не брать деньги за то, что уже нельзя получить (второй набор новичка, орден не выше купленного)
  if (beforePay) {
    const pr = profiles[uid];
    if (pr && kind === 'starter' && pr.starterBought) return false;
    if (pr && /^pass([1-9]|10)$/.test(kind) && meta.passTier(pr) >= +kind.slice(4)) return false;
    if (pr && /^whUp[2-5]$/.test(kind) && (pr.whLvl || 0) !== +kind[4] - 1) return false; // уровень склада — строго следующий
  }
  if (kind === 'spin' || kind === 'spin10' || meta.INVOICES[kind] || kind === 'pass' || /^pass([1-9]|10)$/.test(kind)) return true;
  return kind === 'bg' && C.LOBBY_BACKGROUNDS.some((b) => b.id === id && b.price > 0);
}
function onGiftPaid(kind, toUid, fromUid, info) {
  const from = getProfile(fromUid), to = getProfile(toUid);
  if (info.charge) {
    from.charges ??= [];
    if (from.charges.includes(info.charge)) return true;
    from.charges.push(info.charge); if (from.charges.length > 300) from.charges.splice(0, from.charges.length - 300);
  }
  (from.payments ??= []).push({ t: Date.now(), kind, giftTo: toUid, amount: info.amount, cur: info.currency || 'XTR', charge: info.charge });
  if (from.payments.length > 50) from.payments.splice(0, from.payments.length - 50);
  from.paidOnce = true;
  try { Q.track(fromUid, 'purchase', 1); } catch (e) { console.error('quest purchase', e); }
  try { refPaid(from, info); } catch (e) { console.error('ref paid', e); }
  Econ.paid(kind, info.amount, info.currency || 'XTR');
  if (kind === 'spin') to.paidSpins += 1;
  else if (kind === 'spin10') to.paidSpins += 10;
  else meta.onPaid(kind, to);
  refreshUid(toUid);
  const title = kind === 'spin' ? 'Печать призыва' : kind === 'spin10' ? 'Печати призыва ×10' : meta.INVOICES[kind].title;
  notifyUid(toUid, `🎁 Подарок от ${from.name || 'игрока'}: ${title}!`);
  notifyUid(fromUid, `🎁 Подарок отправлен: ${title} → ${to.name || 'игрок'}`);
  admin.log('pay', `${from.name || fromUid}: подарок ${kind} → ${to.name || toUid}`);
  saveProfiles();
  return true;
}
function onPaid(payload, info = {}) {
  if (!isValidPayload(payload)) return false;
  const [kind, uid, id] = String(payload).split(':');
  // Подарок: платил дарящий (журнал оплат, скидки, задания, реферальная доля — у него), получает uid
  if (id && /^gtg\d+$/.test(id) && GIFTABLE(kind)) return onGiftPaid(kind, uid, id.slice(1), info);
  const pr = getProfile(uid);
  // Telegram может прислать одно и то же сообщение об оплате повторно (повтор доставки после сбоя) — выдаём покупку один раз
  if (info.charge) {
    pr.charges ??= [];
    if (pr.charges.includes(info.charge)) { admin.log('pay', `${pr.name || uid}: повтор оплаты ${info.charge} — пропущен`); return true; }
    pr.charges.push(info.charge);
    if (pr.charges.length > 300) pr.charges.splice(0, pr.charges.length - 300);
  }
  // Журнал покупок игрока: нужен поддержке (/paysupport) и для возврата Stars (/refund)
  (pr.payments ??= []).push({ t: Date.now(), kind, id: id || undefined, amount: info.amount, cur: info.currency || 'XTR', charge: info.charge });
  if (pr.payments.length > 50) pr.payments.splice(0, pr.payments.length - 50);
  pr.paidOnce = true; // скидка на первую покупку израсходована
  try { Q.track(uid, 'purchase', 1); } catch (e) { console.error('quest purchase', e); } // недельное «Покровитель»
  try { refPaid(pr, info); } catch (e) { console.error('ref paid', e); } // 10% пригласившему
  Econ.paid(kind, info.amount, info.currency || 'XTR');
  if (kind === 'spin') pr.paidSpins += 1;
  else if (kind === 'spin10') pr.paidSpins += 10;
  else if (Trade.isOrder(kind)) { Trade.grantOrder(pr, kind); notifyUid(uid, `Покупка получена: ${meta.INVOICES[kind].title}`); }
  else if (meta.INVOICES[kind]) { meta.onPaid(kind, pr); refreshUid(uid); notifyUid(uid, `Покупка получена: ${meta.INVOICES[kind].title}`); }
  else if (kind === 'pass' || /^pass([1-9]|10)$/.test(kind)) {
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
// Плохая связь: короткий обрыв (до 2 минут) не выкидывает из мира — socket.io восстанавливает сессию с тем же id,
// пакеты сжимаются, связь проверяется чаще (обрыв замечаем за ~15 с, а не за 45)
const io = new Server(server, {
  cors: { origin: '*' },
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60000, skipMiddlewares: true },
  perMessageDeflate: { threshold: 1024 },
  pingInterval: 8000, pingTimeout: 7000,
});
const GRACE_MS = 2 * 60000; // столько герой ждёт в мире после обрыва связи

// ---------- Мир ----------
const world = buildWorld(); // города и охотничьи земли за порталами (server/world.js)
const players = new Map(); // socket.id -> player
// Последние сообщения общего чата — сохраняются в базу, после обновления игры (перезапуска сервера) не пропадают
// Лента «Событий» — только редкое (мифические находки и герои, боссы, войны, техперерывы). Отдельная история,
// чтобы сообщения игроков её не вытесняли; приходит при входе вместе с чатом
const evHistory = (() => { try { const a = store.readJSON('events.json', []); return Array.isArray(a) ? a.slice(-80) : []; } catch { return []; } })();
let evSaveTm = null;
function evCast(msg) {
  const m = { sys: true, ...msg, t: Date.now() };
  evHistory.push(m); if (evHistory.length > 80) evHistory.shift();
  clearTimeout(evSaveTm); evSaveTm = setTimeout(() => { try { store.writeJSON('events.json', evHistory); } catch (e) { console.error('events save', e.message); } }, 3000);
  io.emit('chat', m);
}
const chatHistory = (() => { try { const a = store.readJSON('chat.json', []); return Array.isArray(a) ? a.slice(-60) : []; } catch { return []; } })();
let chatSaveTm = null;
const chatSave = () => { clearTimeout(chatSaveTm); chatSaveTm = setTimeout(() => { try { store.writeJSON('chat.json', chatHistory); } catch (e) { console.error('chat save', e.message); } }, 3000); };
const monsters = new Map(); // id -> monster
const AfBot = require('./afbot')({ C, world, players, monsters, SOLID: require('./world').SOLID, getProfile: (uid) => getProfile(uid) }); // автобой без игрока
const pets = new Map(); // id -> зверь-спутник (Урсус)
let monsterSeq = 1;
let fx = []; // события за тик (удары, снаряды, смерти)

// Задания «Квесты» (server/quests.js)
const Q = createQuests({
  getProfile: (uid) => getProfile(uid), notifyUid: (uid, t) => notifyUid(uid, t),
  reward: (...a) => meta.reward(...a), addPassXp: (pr, n) => meta.addPassXp(pr, n), save: () => saveProfiles(),
});
// Задания у NPC в городах (server/npcq.js)
const NQ = require('./npcq')({ X: MOBX, I, getProfile: (uid) => getProfile(uid), grantXp: (...a) => grantXp(...a), refreshPlayer: (p) => refreshPlayer(p), notifyUid: (uid, t) => notifyUid(uid, t), save: () => saveProfiles() });
// События игры → задания NPC: убийства и элита по зоне, полубосс/босс данжа (всем участникам), выживание, мировой босс
const npcTrack = (uid, type, n, info = {}) => {
  if (type === 'kill') return NQ.track(uid, type, n, info);
  if (type === 'elite') { if (info.rank === 'rare') NQ.track(uid, 'rare', n, info); return; }
  if (type === 'dungeon' && info.rank === 'mini') return NQ.track(uid, 'mini', 1, info);
  if (type === 'boss' && info.zone) return NQ.track(uid, 'boss', 1, info);
  if (type === 'survival') return NQ.track(uid, 'survival', n, info);
  if (type === 'worldPart') return NQ.track(uid, 'world', 1, info);
};
// В группе: рядом (в той же локации) есть живой союзник по группе — для заданий «Отряд», «Плечом к плечу», «Братство подземелий»
const inPartyNear = (uid) => {
  for (const p of players.values()) {
    if (p.uid !== uid || !p.party) continue;
    const pt = parties.get(p.party);
    if (pt) for (const id of pt.members) { const o = players.get(id); if (o && o !== p && o.zone === p.zone && !o.offline) return true; }
  }
  return false;
};
{ const track = Q.track; Q.track = (uid, type, n = 1, info) => { track(uid, type, n, info);
  if ((type === 'kill' || type === 'dungeon') && inPartyNear(uid)) track(uid, type === 'kill' ? 'partyKill' : 'partyDungeon', n, info);
  if (type === 'level') try { refLevel(uid, n); } catch (e) { console.error('ref', e); } clanTrack(uid, type, n); clanWar(uid, type); try { npcTrack(uid, type, n, info); } catch (e) { console.error('npcq', e); } }; } // + клановые задания, война кланов, NPC
// Мета-игра: предметы, рынок, аукцион, батл-пасс, подписка, арена (server/meta.js)
const meta = createMeta({
  quest: (...a) => Q.track(...a),
  C, getProfile, saveProfiles, players, profiles,
  refreshPlayer: (p) => refreshPlayer(p), notifyUid: (uid, t) => notifyUid(uid, t),
  companionChanged: (uid) => { for (const o of players.values()) if (o.uid === uid) { o.cp = (getProfile(uid).comp || {}).active || null; refreshPlayer(o); markDirty(o); } },
  cosmeticsChanged: (uid) => { for (const o of players.values()) if (o.uid === uid) { Object.assign(o, { look: meta.cosmLook(getProfile(uid)) }); o.lastStats = 0; markDirty(o); } },
  statsFor: (...a) => statsFor(...a), unlockedSkills: (...a) => unlockedSkills(...a),
  gram: { nano: (s) => Trade.nanoOf(s), spend: (uid, n, t) => Trade.spendGram(uid, n, t), fmt: (n) => Trade.fmt(n) }, // внешний вид за GRAM
  // Свиток возвращения: в город текущего мира
  toTown: (p) => { if (isPkZone(p.zone) && pkState(p) !== 'white') return false; const z = world.byId.get(p.zone); const home = z && world.byId.get(z.town || z.id); if (!home || home.id === p.zone) return false; moveToZone(p, home.id); return true; },
});
// Торговля за GRAM: баланс, Рынок (вещи игры), Торговый дом (между игроками), вывод, торговые ордена (server/trade.js)
// Особые задания (подписка на канал/чат, партнёры) → самоцветы: server/special.js
const SP = require('./special')({ S, getProfile: (uid) => getProfile(uid), botToken: BOT_TOKEN, save: () => saveProfiles() });
const Trade = require('./trade')({
  I, store, getProfile, profiles: () => profiles, notifyUid: (uid, t) => notifyUid(uid, t), saveProfiles: () => saveProfiles(),
  bagSize: (pr) => meta.bagSize(pr), isSub: (pr) => meta.isSub(pr), tierOf: (p) => p.zoneTier || 1, classOf: (h) => I.classOf(h),
  rate: () => ton.rate(), Econ, log: (k, t) => admin.log(k, t), quest: (...a) => Q.track(...a), onHouse: (uid, amount, house, city) => refHouse(uid, amount, house, city),
  cityOf: (p) => { const z = world.byId.get(p.zone); return z ? (z.kind === 'town' ? z.id : z.town || 'town1') : 'town1'; }, cityName: (id) => (world.byId.get(id) || {}).name || id,
  liab: () => Object.values(clans).reduce((x, c) => x + (c.reignPool || 0), 0) + (typeof Castle !== 'undefined' ? Castle.liab() : 0) + (Arena && Arena.glOwed ? Arena.glOwed() : 0), // казна владык и взносы лиги — ещё не выплачены broadcast: (t) => evCast({ text: t }), alertAdmins: (t, loud) => adminAlert(t, loud),
  // Торговые ордена — ступени сезонных орденов после Чемпиона: цена — доплата до них с учётом купленного
  passTier: (pr) => meta.passTier(pr), passEnds: () => (Math.floor(Date.now() / (meta.SHOP.pass.days * 864e5)) + 1) * meta.SHOP.pass.days * 864e5,
  passOrders: (pr) => { const cur = meta.passTier(pr), paid = cur ? meta.SHOP.passTiers[cur - 1].price : 0;
    return meta.SHOP.passTiers.filter((t) => t.trade).map((t) => ({ kind: `pass${t.tier}`, tier: t.tier, id: t.id, icon: t.icon, name: t.name, perks: t.perks, price: t.price, cost: Math.max(0, t.price - paid), owned: cur >= t.tier })); },
});
Object.assign(meta.INVOICES, Trade.invoices());
const Mail = require('./mail')({ I, Trade, getProfile: (uid) => getProfile(uid), profilesFn: () => profiles, notifyUid: (uid, t) => notifyUid(uid, t), save: () => saveProfiles(),
  nickUid: (v) => { const u = nickOwner.get(nickKey(v)); if (u) return u; const low = String(v).toLowerCase(); return [...players.values()].filter((o) => !o.bot && o.name.toLowerCase() === low).map((o) => o.uid)[0] || null; },
  nameOf: (uid) => (profiles[uid] && (profiles[uid].nick || profiles[uid].name)) || 'игрок' }); // старые отдельные торговые ордена — только чтобы зачесть уже начатые оплаты (теперь это ступени сезонных орденов)
admin.ctx.trade = Trade;

// Бой монстров, данжи-лабиринты, выживание и мировые боссы (server/dungeon.js)
const D = createDungeons({
  C, world, monsters, players, pets,
  push: (kind, text, filter) => Push.sendAll(kind, text, filter), maxHeroLevel: (pr) => maxHeroLevel(pr),
  notifyUid: (uid, t) => notifyUid(uid, t), companionDrop: (o, ch, rare) => companionDrop(o, ch, rare),
  wbWeek: (uid, dmg) => { const pr = getProfile(uid), w = Ranks.weekNo(); if (!pr.wbWeek || pr.wbWeek.w !== w) pr.wbWeek = { w, dmg: 0, n: 0 }; pr.wbWeek.dmg += Math.round(dmg); pr.wbWeek.n += 1; },
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
  broadcast: (text) => evCast({ text }),
  // Отбрасывание героя (таран, воздушный удар)
  knockPlayer(p, dx, dy, distPx) {
    const l = Math.hypot(dx, dy) || 1;
    for (let i = 0; i < 6; i++) {
      const nx = p.x + dx / l * distPx / 6, ny = p.y + dy / l * distPx / 6;
      if (world.isSolidAt(nx, ny)) break;
      p.x = nx; p.y = ny;
    }
    // Как перенос умением: номер переноса — старые шаги (со старого места) сервер отбросит, телефон плавно «отлетит», а не прыгнет
    p.tpSeq = (p.tpSeq || 0) + 1; p.tpAt = Date.now(); p.mvBudget = 0;
    p.socket.emit('correct', { x: p.x, y: p.y, tp: p.tpSeq, knock: true });
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
const Castle = require('./castle')({ world, players, monsters, D, MOBX, store, Trade, getProfile: (uid) => getProfile(uid), clansFn: () => clans, clanOf: (uid) => clanOf(uid),
  saveClans: () => saveClans(), moveToZone: (...a) => moveToZone(...a), notifyUid: (uid, t) => notifyUid(uid, t), evCast: (m) => evCast(m), markDirty: (p) => markDirty(p), profilesFn: () => profiles });
const Tower = require('./tower')({ world, players, monsters, D, X: MOBX, store, I, getProfile: (uid) => getProfile(uid), profilesFn: () => profiles, notifyUid: (uid, t) => notifyUid(uid, t),
  moveToZone: (...a) => moveToZone(...a), markDirty: (p) => markDirty(p), evCast: (m) => evCast(m), save: () => saveProfiles() });
const Arena = require('./arena')({
  C, world, players, monsters, D,
  moveToZone: (...a) => moveToZone(...a), getProfile: (uid) => getProfile(uid), partyMembers: (p) => partyMembers(p),
  revive: (p) => revivePlayer(p), addPassXp: (pr, n) => meta.addPassXp(pr, n), quest: (...a) => Q.track(...a),
  statsFor: (...a) => statsFor(...a), profiles: () => profiles, markDirty: (p) => markDirty(p),
  store, notifyUid: (uid, t) => notifyUid(uid, t), broadcast: (t) => evCast({ text: t }), save: () => saveProfiles(),
  get gram() { return Trade; }, // GRAM-лига турнира: взносы и призы
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
    if (cq.prog[q.id] >= q.goal) {
      clanNotify(c, `🛡️ Клановое задание «${q.name}» выполнено! Заберите награду: «Игра» → «Клан»`);
      for (const m of c.members) Push.send(m, 'clan', `🛡️ Клан [${c.tag}]: задание «${q.name}» выполнено — заберите награду в игре («Игра» → «Клан»)`);
    }
  }
  saveClans();
}
// ---------- Война кланов: очки недели за боссов и арену; лучший клан недели — «Владыки» на следующую неделю ----------
const WAR_PTS = { dungeon: 3, boss: 10, world: 8, arena: 1 }; // dungeon — полубосс или босс данжа, boss — ещё +10 за босса
const warWeek = () => Math.floor((Date.now() + 3 * 36e5 - Date.UTC(2024, 0, 1)) / (7 * 864e5));
function clanWar(uid, type) {
  const c = WAR_PTS[type] && clanOf(uid);
  if (!c) return;
  if (!c.war || c.war.w !== warWeek()) c.war = { w: warWeek(), pts: 0 };
  c.war.pts += WAR_PTS[type];
  saveClans();
}
// Клан-владыка: +10% опыта и золота участникам до конца недели
const reignBonus = (uid) => { const c = clanOf(uid); return c && c.reignUntil > Date.now() ? 0.1 : 0; };
// Итоги недели (раз в минуту проверка смены недели)
const warState = store.readJSON('clanwar.json', { week: warWeek() });
setInterval(() => {
  const w = warWeek();
  if (warState.week === w) return;
  const prev = warState.week; warState.week = w;
  for (const c of Object.values(clans)) if (c.reignPool) try { reignPayout(c); } catch (e) { console.error('reign payout', e); } // казна прошлых владык
  const best = Object.values(clans).filter((c) => !c.system && c.war && c.war.w === prev && c.war.pts > 0).sort((a, b) => b.war.pts - a.war.pts)[0];
  if (best) {
    best.reignUntil = (w + 1) * 7 * 864e5 + Date.UTC(2024, 0, 1) - 3 * 36e5;
    best.reigns = (best.reigns || 0) + 1;
    for (const uid of best.members) { const pr = getProfile(uid); pr.gems = (pr.gems || 0) + 100; notifyUid(uid, `👑 Ваш клан [${best.tag}] победил в войне кланов! +100 💎 и +10% опыта и золота всю неделю`); }
    evCast({ text: `👑 Война кланов: победил клан [${best.tag}] ${best.name} (${best.war.pts} очков) — владыки недели!` });
    saveClans(); saveProfiles();
  }
  try { store.writeJSON('clanwar.json', warState); } catch (e) { console.error('clanwar save', e.message); }
}, 60e3);
// Тег клана над именем героя
const setClanTag = (uid) => { const c = clanOf(uid); for (const o of players.values()) if (o.uid === uid) { o.clanTag = c ? c.tag : null; markDirty(o); } };
const clans = store.readJSON('clans.json', {});
for (const c of Object.values(clans)) for (const it of c.vault || []) I.cleanItem(it); // старые «Золото»/«Опыт» в хранилищах кланов
let clanSaveTm = null;
const saveClans = () => { if (clanSaveTm) return; clanSaveTm = setTimeout(() => { clanSaveTm = null; try { store.writeJSON('clans.json', clans); } catch (e) { console.error('clans save', e.message); } }, 500); };
const clanOf = (uid) => { const id = getProfile(uid).clan; const c = id && clans[id]; return c && c.members.includes(uid) ? c : null; };
const clanNotify = (c, text) => { for (const o of players.values()) if (c.members.includes(o.uid)) o.socket.emit('chat', { sys: true, ch: 'clan', text }); };
function clanView(c) {
  const online = new Set([...players.values()].map((o) => o.uid));
  return { id: c.id, name: c.name, tag: c.tag, leader: c.leader, max: c.system ? 999 : CLAN.max, system: !!c.system,
    members: c.members.map((uid) => { const pr = getProfile(uid); return { uid, name: pr.name || 'Герой', online: online.has(uid), leader: uid === c.leader }; }),
    war: { pts: c.war && c.war.w === warWeek() ? c.war.pts : 0, reign: c.reignUntil > Date.now() ? c.reignUntil : 0, reigns: c.reigns || 0, pool: c.reignPool || 0 },
    log: (c.log || []).slice(-30), vault: (c.vault || []).map((it) => ({ ...I.itemView(it), by: it.clanBy || '' })), vaultMax: CLAN.vault,
    rating: clanRating(c), reqs: (c.reqs || []).map((r) => ({ uid: r.uid, name: r.name, lvl: r.lvl, at: r.at })) };
}
function clanQuestView(c, uid) {
  const cq = clanWeek(c), ends = (weekNo() + 1) * 7 * 864e5 + Date.UTC(2024, 0, 1) - Date.now();
  return { endsIn: ends, list: CLAN_QUESTS.map((q) => ({ id: q.id, icon: q.icon, name: q.name, desc: q.desc, goal: q.goal, prog: cq.prog[q.id] || 0,
    mine: (cq.by[uid] || {})[q.id] || 0, claimed: (cq.claimed[q.id] || []).includes(uid), reward: rewardLabel(q.reward) })) };
}
const rewardLabel = (r) => [r.gold && `💰 ${r.gold}`, r.gems && `💎 ${r.gems}`, r.itemSpins && `🎁 печать ×${r.itemSpins}`, r.mats && Object.entries(r.mats).map(([k, n]) => `${(I.MATS[k] || {}).name || k} ×${n}`).join(', ')].filter(Boolean).join(' · ');
// Рейтинг клана: сумма уровней участников (лучший герой) + очки войны кланов за неделю + 100 за каждую победу в войне
function clanRating(c) {
  const lv = c.members.reduce((x, uid) => x + Math.max(1, ...Object.values(getProfile(uid).chars || {}).map((h) => h.level || 1)), 0);
  return lv + (c.war && c.war.w === warWeek() ? c.war.pts : 0) + 100 * (c.reigns || 0);
}
// Вступил в клан — его заявки в другие кланы больше не нужны
const clearReqs = (uid) => { for (const c of Object.values(clans)) if (c.reqs) c.reqs = c.reqs.filter((r) => r.uid !== uid); };
// ---------- Академия героев: системный клан для новичков ----------
// Новичок без клана (до 20 ур.) при входе попадает в Академию: клан-чат с такими же новичками, тег [АКД].
// В 20 ур. — выпуск (+100 💎). Вступление в обычный клан (заявка, приглашение, создание) — выход из Академии сам.
// Наставники: герой на 10+ уровней старше в группе с новичком (до 20 ур.) рядом — +15 💎 за каждый уровень новичка (до 150 в день)
const ACADEMY = 'academy';
function academy() {
  return clans[ACADEMY] ??= { id: ACADEMY, name: 'Академия героев', tag: 'АКД', leader: null, system: true, members: [], created: Date.now(), log: [] };
}
function leaveAcademy(uid) {
  const a = clans[ACADEMY];
  if (!a || !a.members.includes(uid)) return;
  a.members = a.members.filter((u) => u !== uid);
  if (getProfile(uid).clan === ACADEMY) getProfile(uid).clan = null;
  saveClans();
}
function academyJoin(p) {
  const pr = getProfile(p.uid);
  if (pr.clan || pr.academyLeft || p.char.level >= 20) return;
  const a = academy();
  if (!a.members.includes(p.uid)) a.members.push(p.uid);
  pr.clan = ACADEMY; saveClans(); setClanTag(p.uid);
  setTimeout(() => p.socket.emit('chat', { sys: true, text: '🎓 Вы в Академии героев: спрашивайте в клан-чате, ищите группу. Выпуск — на 20 уровне. Выйти или вступить в свой клан — Игра → Клан' }), 5000);
}
function academyLevel(p, pr) {
  const L = p.char.level;
  if (L >= 20 && pr.clan === ACADEMY) {
    leaveAcademy(p.uid); setClanTag(p.uid);
    pr.gems = (pr.gems || 0) + 100;
    p.socket.emit('chat', { sys: true, text: '🎓 Выпуск из Академии героев! +100 💎. Теперь найдите свой клан — Игра → Клан' });
  }
  if (L >= 20) return;
  const day = new Date(Date.now() + 3 * 36e5).toISOString().slice(0, 10);
  for (const o of partyMembers(p)) {
    if (o === p || o.dead || o.char.level < L + 10 || !D.groupNear(p, o)) continue;
    const opr = getProfile(o.uid), m = opr.mentor && opr.mentor.day === day ? opr.mentor : (opr.mentor = { day, gems: 0 });
    if (m.gems >= 150) continue;
    m.gems += 15; opr.gems = (opr.gems || 0) + 15;
    o.socket.emit('chat', { sys: true, text: `🎓 Наставник: ${p.name} достиг ${L} уровня рядом с вами — +15 💎 (сегодня ${m.gems}/150)` });
  }
}
function clanAct(p, d) {
  const pr = getProfile(p.uid);
  let mine = clanOf(p.uid);
  // Из Академии — сами: создать свой клан, подать заявку, принять приглашение
  if (mine && mine.system && ['create', 'apply', 'accept'].includes(d.op)) { leaveAcademy(p.uid); mine = null; }
  if (d.op === 'info') return { clan: mine ? clanView(mine) : null, quests: mine ? clanQuestView(mine, p.uid) : null, price: CLAN.price };
  // Список кланов по рейтингу и заявка на вступление (глава принимает или отклоняет во вкладке «Заявки»)
  if (d.op === 'list') {
    const list = Object.values(clans).map((c) => ({ id: c.id, name: c.name, tag: c.tag, n: c.members.length, max: c.system ? 999 : CLAN.max, rating: clanRating(c),
      leader: c.system ? 'Наставники' : getProfile(c.leader).name || 'Герой', reign: c.reignUntil > Date.now(), applied: (c.reqs || []).some((r) => r.uid === p.uid) })).sort((a, b) => b.rating - a.rating);
    list.forEach((x, i) => { x.place = i + 1; });
    return { list, mine: mine ? mine.id : null };
  }
  if (d.op === 'apply' || d.op === 'unapply') {
    const c = clans[String(d.id || '')];
    if (!c) return { error: 'Клан не найден' };
    if (d.op === 'unapply') { c.reqs = (c.reqs || []).filter((r) => r.uid !== p.uid); saveClans(); return { toast: 'Заявка отозвана' }; }
    if (mine) return { error: 'Сначала выйдите из своего клана' };
    if (c.system) { if (p.char.level >= 20) return { error: 'Академия — для героев до 20 уровня' }; pr.academyLeft = false; academyJoin(p); return { toast: '🎓 Вы снова в Академии героев' }; }
    if (c.members.length >= CLAN.max) return { error: 'В клане нет мест' };
    c.reqs ??= [];
    if (c.reqs.some((r) => r.uid === p.uid)) return { error: 'Заявка уже подана' };
    if (c.reqs.length >= 50) return { error: 'У клана слишком много заявок — попробуйте позже' };
    c.reqs.push({ uid: p.uid, name: p.name, lvl: p.char ? p.char.level : 1, at: Date.now() });
    saveClans();
    notifyUid(c.leader, `🛡️ Заявка в клан «${c.name}» от ${p.name} (ур. ${p.char ? p.char.level : 1}) — Игра → Клан → Заявки`);
    return { toast: `Заявка в клан «${c.name}» отправлена — ждите ответа главы` };
  }
  if (d.op === 'reqAccept' || d.op === 'reqDecline') {
    if (!mine || mine.leader !== p.uid) return { error: 'Заявки рассматривает глава клана' };
    const uid = String(d.uid || ''), req = (mine.reqs || []).find((r) => r.uid === uid);
    if (!req) return { error: 'Заявки уже нет' };
    mine.reqs = mine.reqs.filter((r) => r.uid !== uid);
    if (d.op === 'reqDecline') { saveClans(); notifyUid(uid, `🛡️ Клан «${mine.name}» отклонил заявку`); return { toast: 'Заявка отклонена', clan: clanView(mine) }; }
    if (clanOf(uid) && clanOf(uid).system) leaveAcademy(uid);
    if (clanOf(uid)) { saveClans(); return { error: 'Игрок уже вступил в другой клан', clan: clanView(mine) }; }
    if (mine.members.length >= CLAN.max) return { error: 'В клане нет мест' };
    mine.members.push(uid); getProfile(uid).clan = mine.id; clearReqs(uid);
    saveClans(); saveProfiles(); setClanTag(uid);
    clanNotify(mine, `🛡️ ${req.name} вступил в клан`); notifyUid(uid, `🛡️ Вас приняли в клан «${mine.name}»!`);
    return { toast: `${req.name} принят в клан`, clan: clanView(mine) };
  }
  // Клановое хранилище: вложить вещь из сумки / забрать (участник — до 3 вещей в день, глава — без лимита)
  if (d.op === 'vaultPut') {
    if (!mine) return { error: 'Вы не в клане' };
    const it = I.findItem(pr, String(d.id || ''));
    if (!it) return { error: 'Предмет не найден' };
    if (Object.values(pr.equip || {}).includes(it.id)) return { error: 'Сначала снимите предмет' };
    if (it.bound) return { error: 'Привязанную вещь нельзя передать' };
    if ((it.trophy || 0) > Date.now()) return { error: 'Трофей из опасного данжа — передать можно через 7 дней после добычи' };
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
    pr.clan = id; clearReqs(p.uid); saveClans(); saveProfiles(); setClanTag(p.uid);
    return { toast: `Клан «${name}» [${tag}] создан`, clan: clanView(clans[id]) };
  }
  if (d.op === 'invite') {
    if (!mine) return { error: 'Вы не в клане' };
    const t = players.get(String(d.target || ''));
    if (!t) return { error: 'Игрок не в сети' };
    if (clanOf(t.uid) && !clanOf(t.uid).system) return { error: `${t.name} уже в клане` };
    if (mine.system) return { error: 'В Академию приглашать не нужно — новички попадают туда сами' };
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
    c.members.push(p.uid); pr.clan = c.id; clearReqs(p.uid); saveClans(); saveProfiles(); setClanTag(p.uid);
    clanNotify(c, `🛡️ ${p.name} вступил в клан`);
    return { toast: `Вы вступили в клан «${c.name}»`, clan: clanView(c) };
  }
  if (d.op === 'leave') {
    if (!mine) return { error: 'Вы не в клане' };
    if (mine.system) { leaveAcademy(p.uid); pr.academyLeft = true; setClanTag(p.uid); return { toast: 'Вы вышли из Академии героев' }; }
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

const xpForLevel = (lvl) => MOBX.XP_NEED(lvl); // server/mobs.js: с 15-го уровня прокачка медленнее
// Статы героя: уровень + экипировка (pr.equip) + дубликаты героя (+5% за копию)
const statsFor = (heroId, lvl, pr = null) => {
  const b = C.HEROES[heroId];
  const g = pr ? I.gearStats(pr, heroId) : {};
  const dk = 1 + I.DUPE_STEP * ((pr && pr.heroDupes && pr.heroDupes[heroId]) || 0);
  const R = C.RARITIES[b.rarity] || { base: 1, grow: 1 }; // редкость: сильнее старт и быстрее рост
  return {
    maxHp: Math.round((b.hp * R.base * (1 + 0.12 * R.grow * (lvl - 1)) + (g.hp || 0)) * (1 + (g.hpP || 0) / 100) * dk),
    dmg: Math.round((b.dmg * R.base * (1 + 0.1 * R.grow * (lvl - 1)) + (g.atk || 0)) * (1 + (g.atkP || 0) / 100) * dk),
    resMax: Math.round(b.resource.max * (1 + 0.02 * (lvl - 1))), // запас растёт медленно: к 50 ур. ×2 (умения не дешевеют — зелья маны нужны)
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
// Сообщение игроку: в игре — в чат, не в игре — уведомлением от бота в Telegram (лот продан и т. п.)
const notifyUid = (uid, text) => {
  let on = false;
  for (const p of players.values()) if (p.uid === uid) { p.socket.emit('chat', { sys: true, text }); if (!p.offline) on = true; }
  if (!on) Push.send(uid, 'notify', text);
};
// Не заходил сутки (но играл за последние 2 недели) — бот зовёт обратно: «+50 💎 за возвращение» (раз в неделю, Push.KINDS.comeback)
setInterval(() => {
  const now = Date.now();
  for (const [uid, pr] of Object.entries(profiles)) {
    if (!uid.startsWith('tg') || !(pr.heroes || []).length) continue;
    const away = now - (pr.lastSeen || now);
    if (away < 864e5 || away > 14 * 864e5 || (pr.comeback && pr.comeback.for === pr.lastSeen)) continue;
    if (Push.send(uid, 'comeback', '⚔️ Ваш герой ждёт вас в Mystic Horizon! Зайдите сегодня — +50 💎 за возвращение')) pr.comeback = { for: pr.lastSeen, gift: true };
  }
}, 30 * 60e3).unref();
// ---------- Рейтинги: уровень, сила, кланы, мировые боссы за неделю (кэш на 2 минуты) ----------
const Ranks = (() => {
  const weekNo = () => Math.floor((Date.now() + 3 * 36e5 - Date.UTC(2024, 0, 1)) / (7 * 864e5)); // неделя по МСК, с понедельника
  const PRIZE = [500, 300, 150]; // самоцветы тройке недели по урону мировым боссам
  let cache = null, at = 0;
  const state = store.readJSON('ranks.json', { week: weekNo() });
  const nm = (uid, pr) => `${(clanOf(uid) || {}).tag ? `[${clanOf(uid).tag}] ` : ''}${pr.name || 'Герой'}`;
  function build() {
    const since = Date.now() - 30 * 864e5, list = Object.entries(profiles).filter(([, pr]) => (pr.heroes || []).length && (pr.lastSeen || 0) > since && !pr.banned);
    const top = (arr, val) => arr.sort((a, b) => b.v - a.v).slice(0, 100).map((x, i) => ({ ...x, place: i + 1, val: val(x) }));
    const lvl = top(list.map(([uid, pr]) => { const c = Object.values(pr.chars || {}).sort((a, b) => (b.level || 1) - (a.level || 1) || (b.xp || 0) - (a.xp || 0))[0] || {}; return { uid, name: nm(uid, pr), v: (c.level || 1) * 1e7 + (c.xp || 0), lvl: c.level || 1 }; }), (x) => `ур. ${x.lvl}`);
    const pow = top(list.map(([uid, pr]) => ({ uid, name: nm(uid, pr), v: meta.powerOf(pr) })), (x) => `⚔️ ${x.v}`);
    const w = weekNo();
    const wb = top(list.filter(([, pr]) => pr.wbWeek && pr.wbWeek.w === w).map(([uid, pr]) => ({ uid, name: nm(uid, pr), v: pr.wbWeek.dmg, n: pr.wbWeek.n })), (x) => `${x.v.toLocaleString('ru-RU')} урона · боссов ${x.n}`);
    const cl = Object.values(clans).map((c) => ({ uid: c.id, name: `[${c.tag}] ${c.name}`, v: c.members.reduce((s, u) => s + maxHeroLevel(getProfile(u)), 0), n: c.members.length }))
      .sort((a, b) => b.v - a.v).slice(0, 50).map((x, i) => ({ ...x, place: i + 1, val: `сила ${x.v} · участников ${x.n}` }));
    const ww = warWeek();
    const war = Object.values(clans).filter((c) => c.war && c.war.w === ww && c.war.pts > 0).map((c) => ({ uid: c.id, name: `${c.reignUntil > Date.now() ? '👑 ' : ''}[${c.tag}] ${c.name}`, v: c.war.pts }))
      .sort((a, b) => b.v - a.v).slice(0, 50).map((x, i) => ({ ...x, place: i + 1, val: `${x.v} очков` }));
    return { lvl, pow, wb, cl, war, weekEnds: (w + 1) * 7 * 864e5 + Date.UTC(2024, 0, 1) - 3 * 36e5 };
  }
  function get() { if (!cache || Date.now() - at > 120e3) { cache = build(); at = Date.now(); } return cache; }
  // Конец недели: награда тройке по урону мировым боссам
  setInterval(() => {
    const w = weekNo();
    if (state.week === w) return;
    const prev = state.week; state.week = w;
    const rows = Object.entries(profiles).filter(([, pr]) => pr.wbWeek && pr.wbWeek.w === prev).sort((a, b) => b[1].wbWeek.dmg - a[1].wbWeek.dmg).slice(0, 3);
    rows.forEach(([uid, pr], i) => { pr.gems = (pr.gems || 0) + PRIZE[i]; notifyUid(uid, `🏆 Рейтинг недели «Мировые боссы»: ${i + 1} место! +${PRIZE[i]} 💎`); });
    if (rows.length) evCast({ text: `🏆 Итоги недели по мировым боссам: ${rows.map(([uid, pr], i) => `${['🥇', '🥈', '🥉'][i]} ${pr.name || 'Герой'}`).join(' · ')}` });
    try { store.writeJSON('ranks.json', state); } catch (e) { console.error('ranks save', e.message); }
    saveProfiles(); cache = null;
  }, 60e3);
  function view(uid, tab) {
    const R = get(), list = R[tab] || R.lvl, key = tab === 'cl' || tab === 'war' ? ((clanOf(uid) || {}).id) : uid;
    const mine = list.find((x) => x.uid === key);
    return { tab, list: list.slice(0, 50).map(({ name, val, place }) => ({ name, val, place })), me: mine ? { place: mine.place, val: mine.val } : null, weekEnds: R.weekEnds, prize: PRIZE };
  }
  return { view, weekNo, reset: () => { cache = null; } };
})();
// Уведомления в Telegram (server/push.js)
const Push = require('./push')({
  getBot: () => bot, profiles: () => profiles, save: () => saveProfiles(),
  // До открытия игры уведомления (боссы, задания, серия входов) — только админам и тестерам
  allowed: (uid) => !(S.openAt > Date.now()) || admin.isAdminUid(uid) || !!((profiles[uid] || {}).test || {}).tester,
  isOnline: (uid) => [...players.values()].some((p) => p.uid === uid && !p.offline),
  webAppUrl: () => (process.env.WEBAPP_URL || '').trim(),
});
const maxHeroLevel = (pr) => Math.max(1, ...Object.values(pr.chars || {}).map((c) => c.level || 1));
// Напоминание вечером (19–22 МСК): серия входов есть, сегодня ещё не заходил — «не прервите серию»
setInterval(() => {
  const msk = new Date(Date.now() + 3 * 36e5), h = msk.getUTCHours();
  if (h < 19 || h >= 22) return;
  const today = msk.toISOString().slice(0, 10), yest = new Date(msk - 864e5).toISOString().slice(0, 10);
  for (const [uid, pr] of Object.entries(profiles)) {
    const L = pr.login;
    if (!L || L.last !== yest || !(L.streak > 0)) continue;
    Push.send(uid, 'login', `🔥 Серия входов: ${L.streak} дн. подряд! Зайдите сегодня и заберите награду дня ${(L.day + 1) % 7 + 1} — иначе серия начнётся заново.`);
  }
}, 5 * 60e3);
// Усиления урона и скорости атаки: временные эффекты навыков и пассивные навыки
const startRes = (p) => (p.hero.resource.start ?? 1) * p.resMax;
// Текущий облик героя (Талиесин): свои дальность, скорость атаки, бег и снаряд
// Аурелиус: стихия меняет только снаряд обычной атаки
const formOf = (p) => (p.hero.forms ? p.hero.forms[p.form || 'human']
  : p.hero.elements ? { ...p.hero, projectile: p.hero.elements[p.form || 'fire'].projectile }
  : p.hero.aspects ? { ...p.hero, projectile: p.hero.aspects[p.form || 'fire'].projectile } : p.hero);
const passiveOf = (p) => (p.hero.passive ? PASSIVES[p.hero.passive.id] : null);
// Мастерство пассивки (Зал мастеров): прибавка множителя пассивки растёт на 4% за уровень (×1,96 к прибавке на 25 уровне)
const pasK = (p) => 1 + I.PAS_STEP * (((p.char && p.char.pasLv) || 1) - 1);
const pasScale = (p, m) => (m === 1 ? 1 : 1 + (m - 1) * pasK(p));
const pasScaleTaken = (p, m) => (m >= 1 ? m : Math.max(0.3, 1 - (1 - m) * pasK(p))); // снижение получаемого урона — сильнее, но не меньше ×0,3
// Штраф за гибель (кроме PvP-арены, матчей и данжа выживания): −10% опыта уровня и «Слабость» на 2 минуты
const DEATH = { xpLoss: 0.15, ms: 5 * 60000, dmg: 0.3, xp: 0.1 }; // слабость: урон −30%, опыт −10% // слабость после гибели идёт только пока игрок в игре
function deathPenalty(p) {
  const pr = getProfile(p.uid), need = xpForLevel(p.char.level);
  const pkz = isPkZone(p.zone); // опасный данж: риск — вещи, а не опыт: потеря опыта втрое меньше, слабость 2 мин
  const lost = Math.min(p.char.xp, Math.round(need * DEATH.xpLoss * (pkz ? 1 / 3 : 1) * (1 - Coll.k(pr, 'deathXp')))); // уровень не теряется; «Память героев» (Чернокнижники) — меньше
  p.char.xp -= lost;
  p.deathUntil = pr.deathUntil = pkz ? 0 : Date.now() + DEATH.ms; // в опасном данже слабости нет — можно сразу вернуться за обидчиком // сохраняется в профиле — перезаход не снимает
  const lostElx = Object.values(pr.buffs || {}).some((t) => t > Date.now());
  pr.buffs = {}; // эликсиры сгорают при гибели
  // Новый баланс: надетые вещи теряют 10% прочности (0 — вещь сломана и не даёт статов до ремонта в кузнице)
  let broke = 0;
  // Опасный данж с пустой сумкой (всё ценное оставили на складе) — надетое изнашивается вдвое сильнее
  const wearK = pkz && p.bagEmptyAtDeath ? 2 : 1;
  if (MOBX.bal2()) for (const id of Object.values(pr.equip || {})) {
    const it = id && I.findItem(pr, id);
    if (!it || it.cat === 'bag') continue;
    const was = it.dur ?? 100; it.dur = Math.max(0, Math.round((was - 10 * wearK * (1 - Coll.k(pr, 'dur'))) * 10) / 10); // Рыцари в коллекции — износ меньше
    if (was > 0 && it.dur === 0) broke++;
  }
  p.gear = I.gearStats(pr, p.heroId); p.buffSig = '';
  if (broke) p.socket.emit('chat', { sys: true, text: `🔧 Сломано вещей: ${broke} — они не дают силы, пока не почините («Сумка» → вещь → «Починить»)` });
  p.socket.emit('chat', { sys: true, text: pkz ? `💀 Вы погибли: −${lost} опыта${lostElx ? ', действие эликсиров закончилось' : ''}. В опасном данже слабости нет` : `💀 Вы погибли: −${lost} опыта${lostElx ? ', действие эликсиров закончилось' : ''}. Слабость на 5 минут: урон −30%, получаемый опыт −10%` });
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
  ['deathUntil', 0, 'curse', 'Слабость после гибели', 'Урон −30%, получаемый опыт −10%'],
];
const FX_CC = { stun: ['stun', 'Оглушение', 'Нельзя действовать'], freeze: ['freeze', 'Заморозка', 'Нельзя действовать'],
  fear: ['fear', 'Страх', 'Герой бежит и не слушается'], root: ['root', 'Корни', 'Нельзя двигаться'], taunt: ['taunt', 'Провокация', 'Атакуете только провокатора'],
  charm: ['curse', 'Очарование', 'Герой под чужой волей'], blind: ['weak', 'Ослепление', 'Атаки промахиваются'] };
const FX_DOT = { poison: ['poison', 'Яд', 'Урон каждую секунду'], burn: ['burn', 'Горение', 'Урон огнём каждую секунду'], bleed: ['bleed', 'Кровотечение', 'Урон каждую секунду'] };
const FX_ELX = I.ELIXIR_OF; // бафф → эликсир (значок под здоровьем)
function playerEffects(p, now = Date.now()) {
  const out = [], left = (t) => Math.ceil((t - now) / 1000);
  for (const [k, buff, icon, name, desc] of FX_TIMED) if (p[k] > now) out.push({ k, b: buff, i: icon, n: name, d: desc, l: left(p[k]) });
  if (p.shieldHp > 0 && !(p.shieldUntil > now)) out.push({ k: 'shieldHp', b: 1, i: 'shield', n: 'Щит', d: `Поглотит ещё ${Math.round(p.shieldHp)} урона`, l: 0 });
  if (p.cc && p.cc.until > now && FX_CC[p.cc.type]) { const [i, n, d] = FX_CC[p.cc.type]; out.push({ k: 'cc', b: 0, i, n, d, l: left(p.cc.until) }); }
  for (const x of p.pdots || []) if (x.until > now && FX_DOT[x.kind]) { const [i, n, d] = FX_DOT[x.kind]; out.push({ k: 'dot_' + x.kind, b: 0, i, n, d, l: left(x.until) }); }
  const pr = getProfile(p.uid);
  for (const [buff, until] of Object.entries(pr.buffs || {})) if (until > now && FX_ELX[buff]) { const m = I.MATS[FX_ELX[buff]]; out.push({ k: 'elx_' + buff, b: 1, art: 'mat_' + FX_ELX[buff], ic: m.icon, n: m.name, d: m.desc, l: left(until) }); }
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
    * (ps && ps.dmgMult ? pasScale(p, ps.dmgMult(p)) : 1);
};
const attackCd = (p, now = Date.now()) => {
  const ps = passiveOf(p);
  const speed = (p.frenzyUntil > now ? 1.5 : 1) * (p.pactUntil > now && p.pactType === 'wind' ? 1.4 : 1) * (p.blessUntil > now ? 1.2 : 1) * (p.songUntil > now ? 1 + 0.1 * (p.songPw || 1) : 1) * (p.hasteUntil > now ? 1.25 : 1) * (ps && ps.speedMult ? pasScale(p, ps.speedMult(p)) : 1) * (1 + ((p.gear && p.gear.aspd) || 0) / 100);
  return Math.round(formOf(p).cooldown / speed * (p.stoneArmorUntil > now ? 1.3 : 1)); // каменная броня Эмета замедляет
};

// ---------- Зоны ----------
const zoneOf = (e) => world.zoneAtX(e.x);

// Перенос игрока в другую зону (город, портал, телепорт)
// ---------- Карта мира: города, данжи, логова — с метками сюжета, поручителей, друзей и «вы здесь» ----------
function worldMapView(p) {
  const pr = getProfile(p.uid), lvl = p.char.level;
  const mz = world.byId.get(p.zone), hereTown = mz ? (mz.town || mz.id) : null;
  const st = Q.storyRaw ? Q.storyRaw(pr) : null;
  let storyZone = null;
  if (st) {
    const town = `town${Math.min(3, st.ch)}`;
    if (st.type === 'town') storyZone = `town${st.goal}`;
    else if (st.type === 'world') storyZone = `wb_${town}`;
    else if (['kill', 'elite', 'dungeon', 'boss'].includes(st.type)) {
      let best = null;
      for (let i = 0; world.byId.has(`dg_${town}_${i}`); i++) { const dg = world.byId.get(`dg_${town}_${i}`).dg; if (Math.max(1, dg.lv[0] - 2) <= lvl) best = `dg_${town}_${i}`; }
      storyZone = best || `dg_${town}_0`;
    } else storyZone = town;
  }
  const npcs = NQ.mapInfo ? NQ.mapInfo(p) : [];
  const fr = {}; // зона → ники друзей онлайн
  for (const u of pr.friends || []) { const o = onlineOf(u); if (o) (fr[o.zone] ??= []).push(o.name); }
  const place = (z, kind, name, lv, open) => ({ id: z.id, kind, name, lv, open, here: p.zone === z.id, story: storyZone === z.id,
    npc: npcs.filter((n) => n.zone === z.id).map((n) => ({ name: n.name, quest: n.quest, prog: n.prog })), friends: fr[z.id] || [] });
  const towns = world.towns.map((t) => {
    const z = world.byId.get(t.id), places = [];
    for (let i = 0; world.byId.has(`dg_${t.id}_${i}`); i++) {
      const dz = world.byId.get(`dg_${t.id}_${i}`), dg = dz.dg;
      places.push(place(dz, 'dungeon', dg.name, `${dg.lv[0]}–${dg.lv[1]}`, lvl >= Math.max(1, dg.lv[0] - 2)));
    }
    const pz = world.byId.get(`pk_${t.id}`);
    if (pz) places.push(place(pz, 'pk', pz.dg.name, `${pz.dg.lv[0]}–${pz.dg.maxLv || '∞'}`, lvl >= Math.max(1, pz.dg.lv[0] - 2) && !(pz.dg.maxLv && lvl > pz.dg.maxLv)));
    const wz = world.byId.get(`wb_${t.id}`);
    if (wz) places.push(place(wz, 'wb', 'Логово мирового босса', '', lvl >= (t.minLevel || 1)));
    // Поручители города: «!» новое, «?» сдать, «…» в работе
    const tn = npcs.filter((n) => n.town === t.id && ['new', 'ready', 'prog'].includes(n.mark)).map((n) => ({ name: n.name, mark: n.mark, quest: n.quest, prog: n.prog }));
    return { id: t.id, name: t.name, sub: t.sub, theme: t.theme, level: t.level, open: lvl >= (t.minLevel || 1), minLevel: t.minLevel || 1,
      here: hereTown === t.id, inTown: p.zone === t.id, story: storyZone === t.id, npc: tn, friends: z ? fr[z.id] || [] : [], places };
  });
  return { towns, story: st ? { icon: st.icon, name: st.name, prog: `${Math.min(st.prog, st.goal)}/${st.goal}`, zone: storyZone } : null, lvl };
}

// ---------- Друзья ----------
const FRIEND_MAX = 50, FIGHT_MS = 10000;
const onlineOf = (uid) => [...players.values()].find((o) => o.uid === uid && !o.bot) || null;
const inFight = (o) => Date.now() - Math.max(o.lastHurt || 0, o.lastFight || 0) < FIGHT_MS;
function friendTpCheck(p, f) {
  if (!f) return 'Друг не в игре';
  if (p.dead || f.dead) return 'Нельзя: кто-то из вас погиб';
  if (pkState(f) !== 'white') return `${f.name} флагнут — к нему нельзя`;
  if (pkState(p) !== 'white') return 'Вы флагнуты — телепорт недоступен';
  if (inFight(f)) return `${f.name} в бою`;
  if (inFight(p)) return 'Вы в бою';
  const z = world.byId.get(f.zone), mz = world.byId.get(p.zone);
  if (!z || z.inst || !['town', 'dungeon'].includes(z.kind)) return `${f.name} там, куда телепорт не ведёт`;
  if (mz && ['survival', 'worldboss'].includes(mz.kind)) return 'Отсюда телепорт недоступен';
  if (mz && mz.inst) return 'С арены телепорт недоступен';
  if (z.kind === 'town') { const need = (world.towns.find((t) => t.id === z.id) || {}).minLevel || 1; if (p.char.level < need) return `${z.name}: нужен ${need} уровень`; }
  if (z.dg) {
    const need = Math.max(1, z.dg.lv[0] - 2);
    if (p.char.level < need) return `${z.dg.name || z.name}: нужен ${need} уровень`;
    if (z.pk && z.dg.maxLv && p.char.level > z.dg.maxLv) return `${z.dg.name}: только до ${z.dg.maxLv} уровня`;
  }
  return null;
}
function friendAct(p, d) {
  const pr = getProfile(p.uid); pr.friends ??= []; pr.friendReq ??= [];
  const nameOf = (uid) => (profiles[uid] && (profiles[uid].nick || profiles[uid].name)) || 'игрок';
  const link = (a, b) => { const pa = getProfile(a), pb = getProfile(b); pa.friends ??= []; pb.friends ??= [];
    if (!pa.friends.includes(b)) pa.friends.push(b); if (!pb.friends.includes(a)) pb.friends.push(a);
    pa.friendReq = (pa.friendReq || []).filter((u) => u !== b); pb.friendReq = (pb.friendReq || []).filter((u) => u !== a); };
  if (d.op === 'list') {
    pr.friends = pr.friends.filter((u) => profiles[u]);
    const fr = pr.friends.map((u) => {
      const o = onlineOf(u), fp = profiles[u], z = o && world.byId.get(o.zone);
      return { uid: u, sid: o ? o.id : null, name: nameOf(u), lvl: (fp.acct && fp.acct.level) || 1, online: !!o, where: z ? z.name : null, seen: fp.lastSeen || 0, tp: o ? !friendTpCheck(p, o) : false, why: o ? friendTpCheck(p, o) : null };
    }).sort((a, b) => b.online - a.online || b.seen - a.seen);
    return { friends: fr, reqs: pr.friendReq.filter((u) => profiles[u]).map((u) => ({ uid: u, name: nameOf(u) })), max: FRIEND_MAX };
  }
  if (d.op === 'add') {
    let uid = null;
    if (d.target) { const t = players.get(d.target); uid = t && t.uid; }
    else if (d.name) {
      // Ник из Telegram может совпадать у разных игроков: сначала — кто в игре, затем уникальный ник
      const low = String(d.name).trim().toLowerCase();
      const on = [...new Set([...players.values()].filter((o) => !o.bot && String(o.name || '').toLowerCase() === low).map((o) => o.uid))];
      const all = on.length ? on : Object.keys(profiles).filter((u) => String(profiles[u].nick || profiles[u].name || '').toLowerCase() === low);
      if (all.length > 1) return { error: 'Игроков с таким ником несколько — добавьте через профиль (тап по герою)' };
      uid = all[0] || null;
    }
    if (!uid || !profiles[uid]) return { error: 'Игрок не найден' };
    if (uid === p.uid) return { error: 'Это вы' };
    if (pr.friends.includes(uid)) return { error: 'Уже в друзьях' };
    if (pr.friends.length >= FRIEND_MAX) return { error: `Друзей не больше ${FRIEND_MAX}` };
    const op = getProfile(uid); op.friendReq ??= [];
    if (pr.friendReq.includes(uid)) { link(p.uid, uid); saveProfiles(); notifyUid(uid, `🤝 ${p.name} теперь ваш друг`); return { toast: `🤝 ${nameOf(uid)} теперь ваш друг` }; }
    if ((op.friends || []).length >= FRIEND_MAX) return { error: 'У игрока уже максимум друзей' };
    if (!op.friendReq.includes(p.uid)) { op.friendReq.push(p.uid); op.friendReq = op.friendReq.slice(-30); }
    saveProfiles();
    const o = onlineOf(uid);
    if (o) o.socket.emit('chat', { sys: true, text: `🤝 ${p.name} хочет добавить вас в друзья — меню → Друзья` });
    return { toast: `Заявка отправлена: ${nameOf(uid)}` };
  }
  const uid = String(d.uid || '');
  if (d.op === 'accept') {
    if (!pr.friendReq.includes(uid) || !profiles[uid]) return { error: 'Заявка устарела' };
    if (pr.friends.length >= FRIEND_MAX) return { error: `Друзей не больше ${FRIEND_MAX}` };
    link(p.uid, uid); saveProfiles();
    const o = onlineOf(uid); if (o) o.socket.emit('chat', { sys: true, text: `🤝 ${p.name} принял(а) вашу заявку в друзья` });
    return { toast: `🤝 ${nameOf(uid)} теперь ваш друг` };
  }
  if (d.op === 'decline') { pr.friendReq = pr.friendReq.filter((u) => u !== uid); saveProfiles(); return { ok: true }; }
  if (d.op === 'remove') {
    pr.friends = pr.friends.filter((u) => u !== uid);
    if (profiles[uid]) profiles[uid].friends = (profiles[uid].friends || []).filter((u) => u !== p.uid);
    saveProfiles(); return { toast: 'Удалён из друзей' };
  }
  if (d.op === 'tp') {
    if (!pr.friends.includes(uid)) return { error: 'Это не ваш друг' };
    const f = onlineOf(uid), err = friendTpCheck(p, f);
    if (err) return { error: err };
    flushChests(p);
    moveToZone(p, f.zone, { x: f.x + (Math.random() - 0.5) * 30, y: f.y + 12 });
    f.socket.emit('chat', { sys: true, text: `🌀 ${p.name} телепортировался к вам` });
    return { toast: `🌀 Вы рядом с ${f.name}`, close: true };
  }
  return { error: 'Неизвестное действие' };
}

function moveToZone(p, zoneId, pos) {
  const z = world.byId.get(zoneId);
  if (!z) return;
  if (p.zone && p.zone !== zoneId) flushChests(p); // ушёл из зоны — неоткрытая добыча из сундуков сразу в сумку
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

// Значения «по умолчанию» у записи героя в пакете состояния: такие поля не отправляем (клиент восстанавливает их из pDef,
// присланного в welcome) — пакет с 10 героями рядом становится в несколько раз меньше
const P_DEF = { pk: null, psh: undefined, tag: null, cp: null, dm: 0, nc: null, au: null, dead: false, form: null, rage: false, guard: false, smoke: false, sh: false, stealth: false, pact: null, elem: null, asp: null, phase: null,
  heat: 0, abyss: false, mt: null, pcc: null, pdot: null, pslow: false, pweak: false, flame: null, ash: false, rootSelf: false, cry: null, wrune: null, might: false, stoneArmor: false, vow: null,
  bless: false, song: null, haste: false, fly: false, tree: false, emp: false };
function slimPlayer(o) { for (const k in P_DEF) if (o[k] === P_DEF[k] || o[k] === undefined) delete o[k]; return o; }
function publicPlayer(p) {
  return { id: p.id, name: p.name, hero: p.heroId, x: Math.round(p.x), y: Math.round(p.y), dir: p.dir,
    hp: p.hp, maxHp: p.maxHp, lvl: p.char.level, pk: isPkZone(p.zone) && pkState(p) !== 'white' ? pkState(p) : null, psh: p.pvpShZone ? Math.round(p.pvpSh / (p.maxHp * 2) * 50) / 50 : undefined, tag: p.clanTag || null, cp: p.cp || null, dm: p.deathMarkUntil > Date.now() ? 1 : 0, nc: (p.look && p.look.nc) || null, au: (p.look && p.look.au) || null, dead: p.dead, form: p.form || null, rage: p.roarUntil > Date.now() || p.frenzyUntil > Date.now(),
    guard: p.packUntil > Date.now(), smoke: p.dodgeUntil > Date.now(),
    sh: p.shieldUntil > Date.now() && p.shieldHp > 0, stealth: p.stealthUntil > Date.now(),
    pact: p.pactUntil > Date.now() ? p.pactType : null, elem: p.hero.elements ? p.form : null, asp: p.hero.aspects ? p.form : null, phase: p.hero.phases ? p.form : null, heat: Math.round(p.heat || 0), abyss: p.abyssUntil > Date.now(), mt: p.match ? `${p.match}:${p.team}` : null, pcc: D.ccActive(p), pdot: (p.pdots || []).filter((x) => x.until > Date.now()).map((x) => x.kind)[0] || null, pslow: p.slowUntil > Date.now(), pweak: p.weakUntil > Date.now(), flame: p.hero.flames ? p.form : null, ash: p.ashArmorUntil > Date.now(), rootSelf: p.rootSelfUntil > Date.now(), cry: p.crystals && p.crystals.length ? p.crystals : null, wrune: p.weaponRuneUntil > Date.now() ? p.weaponRuneType : null, might: p.mightUntil > Date.now(), stoneArmor: p.stoneArmorUntil > Date.now(), vow: p.hero.vows ? p.form : null, bless: p.blessUntil > Date.now(),
    song: p.hero.songs ? p.form : null, haste: p.hasteUntil > Date.now(), fly: p.flyUntil > Date.now(), tree: (p.nature || 0) >= 100, vow: p.vowUntil > Date.now() ? p.vowBy : null,
    emp: p.empoweredUntil > Date.now() };
}
function privateStats(p) {
  return { fx: playerEffects(p), passReady: meta.passReady(getProfile(p.uid)), level: p.char.level, xp: p.char.xp, xpNext: xpForLevel(p.char.level), kills: p.char.kills, deathLeft: Math.max(0, Math.ceil(((p.deathUntil || 0) - Date.now()) / 1000)), passTier: meta.passTier(getProfile(p.uid)), autofarm: !!p.autofarm, afLeft: ((a) => (a < 0 ? -1 : Math.ceil(a / 10000) * 10000))(afLeftMs(p)), // с точностью до 10 с — статы не шлются каждую секунду; −1 — без лимита
    gold: getProfile(p.uid).gold, gems: getProfile(p.uid).gems || 0, frame: (p.look && p.look.fr) || null, unlocked: p.unlocked, hp: Math.ceil(p.hp), maxHp: p.maxHp, dmg: Math.round(p.dmg * dmgMult(p)),
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
const PVP_K = 0.3; // урон героев рассчитан на монстров — по игрокам он ниже: равные бьются ~10–20 с, без убийств в одно касание
// Разница в снаряжении в PvP сглажена: урон по игроку × (сила цели / сила атакующего)^0,25, в пределах 0,6…1,6.
// Сильный всё равно выигрывает (впятеро сильнее — ~в 2,2 раза быстрее), но слабый успевает ответить. Сила = урон × здоровье
const pvpGap = (a, v) => Math.min(1.6, Math.max(0.6, ((v.dmg * v.maxHp) / Math.max(1, a.dmg * a.maxHp)) ** 0.25));
const PVP_LEVELS = { town1: [1, 20], town2: [15, 35], town3: [30, 99] };
let pvpSeq = 9e6;
function pvpSync(now) {
  for (const p of players.values()) {
    const z = world.byId.get(p.zone), want = z && (z.kind === 'pvp' || z.pk) && !p.dead; // PvP-арена и опасный данж
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
  if (Castle.sameSide(p, victim)) return 0; // осада: своих не бьём
  if (!p.match && p.party && p.party === victim.party) return 0; // по своей группе не бьём
  let crit = opt.crit ?? false;
  if (opt.basic && p.nextCritUntil > Date.now()) { crit = true; p.nextCritUntil = 0; }
  // «Добивания» по монстрам (казнь, жертва, раскол льда…) наносят здоровье цели целиком — по героям не больше 25% их здоровья
  const dmg = opt.fixed ? Math.min(raw * PVP_K, victim.maxHp * 0.25) : raw * dmgMult(p) * (0.85 + Math.random() * 0.3) * (crit ? 1.6 : 1) * PVP_K * pvpGap(p, victim)
    * (!opt.basic && !opt.pet && p.gear && p.gear.skill ? 1 + p.gear.skill / 100 : 1);
  pkOnHit(p, victim); // опасный данж: напал на мирного — «розовый»
  // PvP-щит: сначала урон игроков принимает он (с учётом защиты цели), потом здоровье
  let raw2 = dmg;
  if (victim.pvpSh > 0 && !opt.fixed) {
    const defK = 1 - ((victim.gear && victim.gear.def) || 0) / 100, eff = raw2 * defK, a = Math.min(victim.pvpSh, eff);
    victim.pvpSh -= a; raw2 = defK > 0 ? (eff - a) / defK : 0; victim.pvpShAt = Date.now(); markDirty(victim);
    if (a > 0) fx.push({ t: 'absorb', target: victim.id, amount: Math.round(a) });
  }
  victim.pvpShAt = Date.now();
  const before = victim.hp;
  victim.lastPvpBy = p.id; victim.lastPvpAt = Date.now();
  if (raw2 > 0) hurtPlayer(victim, raw2, null, Date.now());
  const dealt = Math.max(0, before - Math.max(0, victim.hp));
  if (p.gear && p.gear.ls && dealt > 0 && !p.dead) { p.hp = Math.min(p.maxHp, p.hp + dealt * p.gear.ls / 100 * (isPkZone(p.zone) ? 0.25 : 0.5)); markDirty(p); } // вампиризм по игрокам — вдвое слабее
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
  p.lastFight = Date.now(); // «в бою» — для телепорта к другу
  if (m.castleCrystal) { const k = Castle.crystalK(p, m); if (!k) return 0; raw *= k; } // кристалл замка: бьют только нападающие
  if (m.pvpOf) return pvpHit(p, m, raw, opt); // на PvP-арене «монстр» — цель-двойник другого героя
  if (p.oneShot) raw = m.maxHp * 1000; // тест из админки: убийство с одного удара
  let crit = opt.crit ?? false;
  const ps = passiveOf(p);
  const now0 = Date.now();
  m.hurtAt = now0; // в бою: восстановление «вне боя» — только через 6 с без урона
  // Бонус против конкретной цели (пассивки) и пробитая защита монстра (Кира)
  const tMult = D.overDmg(p, m) * (ps && ps.targetMult ? pasScale(p, ps.targetMult(p, m)) : 1) * (m.brokenUntil > now0 ? 1.25 : 1)
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
  if (p.gear && p.gear.ls && !opt.pet && !opt.fixed && p.hp < p.maxHp && !p.dead) { p.hp = Math.min(p.maxHp, p.hp + Math.min(dmg, m.hp) * p.gear.ls / 100 * (isPkZone(p.zone) ? 0.5 : 1)); markDirty(p); } // опасный данж: вампиризм вдвое слабее (умения лечения — как есть) // вампиризм
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
  if (m.hp <= 0 && (m.castleCrystal || m.castleGuard)) { // замок: без опыта и добычи
    fx.push({ t: 'death', target: m.id, x: m.x, y: m.y, xp: 0, gold: 0, by: p.id });
    monsters.delete(m.id);
    if (m.castleCrystal) Castle.crystalDown(m.castleCrystal);
    return dmg;
  }
  if (m.hp <= 0) {
    const def = C.MONSTERS[m.type];
    const rw = ps && ps.rewardMult ? ps.rewardMult(p, m) : { xp: 1, gold: 1 };
    // Монстры намного ниже уровнем дают меньше опыта
    const diff = p.char.level - (m.level || 1);
    const baseXp = m.xp * (diff > 4 ? Math.max(0.1, 1 - 0.15 * (diff - 4)) : 1);
    const xpF = baseXp * rw.xp * xpBonusK(p), xp = Math.floor(xpF) + (Math.random() < xpF % 1 ? 1 : 0); // дробный опыт — случайным округлением
    const gold = Math.round((baseXp / 3 + 1) * (0.5 + Math.random()) * rw.gold * (MOBX.bal2() ? 0.25 : 1) * pkRate(p)); // +1: на первых уровнях хоть немного золота; новый баланс — золота вчетверо меньше
    fx.push({ t: 'death', target: m.id, x: m.x, y: m.y, xp, gold, by: p.id, contract: !!rw.contract });
    monsters.delete(m.id);
    corpses.push({ x: m.x, y: m.y, t: Date.now(), type: m.type, zone: m.zone, level: m.level, maxHp: m.maxHp, dmg: m.dmg, speed: m.speed });
    if (corpses.length > 40) corpses.shift();
    // Каждый шаг награды — отдельно: ошибка в одном (например, в пассивке героя) не отменяет остальные
    const safe = (what, fn) => { try { fn(); } catch (e) { console.error('kill reward', what, m.type, e); } };
    safe('xp', () => grantXp(p, xp, gold));
    safe('karma', () => karmaWash(p, m));
    safe('share', () => shareKill(p, m, xp));
    safe('loot', () => dropLoot(p, m));
    if (ps && ps.onKill) safe('passive', () => ps.onKill(skillCtx, p, Date.now(), m));
    safe('onKilled', () => D.onKilled(m, p));
    const zt = (world.byId.get(m.zone) || {}).tier;
    Q.track(p.uid, 'kill', 1, { tier: zt, zone: m.zone });
    if (['magic', 'rare', 'mini'].includes(m.rank)) Q.track(p.uid, 'elite', 1, { zone: m.zone, rank: m.rank });
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
// Перенос героя умением. Если точка в стене — ищем ближайшую свободную рядом (иначе герой «оставался» на месте,
// а клиент уже показывал его у цели — и потом его откатывало назад). Возвращает точку приземления или null.
// tp — номер переноса: шаги клиента, отправленные ещё со старого места, сервер отбрасывает (см. socket.on('move')).
function teleport(p, x, y) {
  let at = null;
  if (!world.isSolidAt(x, y)) at = [x, y];
  else {
    for (let r = 8; r <= 48 && !at; r += 8) {
      for (let a = 0; a < 16; a++) {
        const tx = x + Math.cos(a * Math.PI / 8) * r, ty = y + Math.sin(a * Math.PI / 8) * r;
        if (!world.isSolidAt(tx, ty) && world.lineOfSight(x, y, tx, ty)) { at = [tx, ty]; break; } // не за стеной
      }
    }
  }
  if (!at) return null;
  p.x = at[0]; p.y = at[1]; p.lastMove = Date.now();
  p.tpSeq = (p.tpSeq || 0) + 1; p.tpAt = p.lastMove; p.mvBudget = 0;
  p.socket.emit('correct', { x: p.x, y: p.y, tp: p.tpSeq });
  return at;
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
    * (target.blessUntil > now ? 0.8 : 1) * (target.holyAuraUntil > now ? target.holyAuraMult : 1) * (ps && ps.dmgTakenMult ? pasScaleTaken(target, ps.dmgTakenMult(target)) : 1)
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
    // Сумка пуста в момент гибели (до выпадения) — в опасном данже надетое изнашивается вдвое (deathPenalty)
    { const tpr = getProfile(target.uid), eq = new Set(Object.values(tpr.equip || {}).filter(Boolean)); target.bagEmptyAtDeath = !(tpr.items || []).some((it) => it.loc !== 'wh' && !eq.has(it.id) && it.cat !== 'bag'); }
    const inCastle = Castle.isCastle(target.zone);
    if (inCastle) target.castleRes = Castle.onDeath(target);
    if (zKind === 'pvp' && !target.match && !inCastle) pvpKill(target);
    if (isPkZone(target.zone)) { // опасный данж: выпадение вещей и карма
      const byPlayer = Date.now() - (target.lastPvpAt || 0) < 8000 && players.get(target.lastPvpBy);
      if (byPlayer) pkOnKill(target);
      else if (pkState(target) === 'red') { karmaDeath(target, 1 / 3); const lost = pkDrop(target, 'red', null); if (lost.length) target.socket.emit('chat', { sys: true, text: `💀 Красный погиб — на землю выпало: ${lost.join(', ')}. Вещи лежат 30 минут` }); }
    }
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
      if (vz.castle) { // осада: у своего лагеря, если остались жизни; нет — в город
        const r = victim.castleRes || { town: true }; victim.castleRes = null;
        if (r.at) { victim.x = r.at.x; victim.y = r.at.y; victim.socket.emit('correct', { x: victim.x, y: victim.y, respawn: true }); }
        else { moveToZone(victim, vz.town); victim.socket.emit('correct', { x: victim.x, y: victim.y, respawn: true }); }
        if (r.text) victim.socket.emit('chat', { sys: true, text: r.text });
        return;
      }
      if (vz.kind === 'pvp') {
        const a = Math.random() * Math.PI * 2, r = (vz.w / 2 - 5) * C.TILE * Math.random();
        victim.x = vz.ox + vz.w * C.TILE / 2 + Math.cos(a) * r; victim.y = vz.oy + vz.h * C.TILE / 2 + Math.sin(a) * r;
        victim.socket.emit('correct', { x: victim.x, y: victim.y, respawn: true });
        return;
      }
      // Красный в опасном данже возрождается у входа в этот же данж; смерть карму не снимает — только охота на монстров
      const vpr0 = getProfile(victim.uid);
      if (vz.pk && (vpr0.karma || 0) > 0) {
        victim.x = vz.spawn.x; victim.y = vz.spawn.y;
        victim.socket.emit('chat', { sys: true, text: `🔴 Вы красный — возрождение у входа в данж. Карма: ${vpr0.karma} — отмывается охотой на монстров` });
        victim.socket.emit('correct', { x: victim.x, y: victim.y, respawn: true });
        return;
      }
      const home = world.byId.get(vz.town);
      if (home.id !== victim.zone) moveToZone(victim, home.id);
      else { victim.x = home.spawn.x; victim.y = home.spawn.y; }
      victim.socket.emit('correct', { x: victim.x, y: victim.y, respawn: true });
    }, Castle.isCastle(target.zone) ? Castle.SIEGE.respawnMs : 4000); // в замке возрождение дольше — 10 с
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

// ---------- Автобой ----------
// Минут в день — по ордену: бесплатный 15, Бронзовый 30, Серебряный 60, Золотой 120, Чемпион 240, Купец 300, Магнат 360
// (meta.SHOP.autofarmMin). Работает только в данжах. Вышел из игры с включённым автобоем в данже — герой остаётся
// и фармит сам (сервер ведёт его, afBotTick), пока не кончится время или его не убьют. Счёт — по дням МСК
const afDay = () => new Date(Date.now() + 3 * 36e5).toISOString().slice(0, 10);
function afLimitMs(p, pr) { return (meta.SHOP.autofarmMin[meta.passTier(pr)] ?? 15) * 60e3; }
function afUsed(pr) { if (!pr.afUse || pr.afUse.day !== afDay()) pr.afUse = { day: afDay(), ms: 0 }; return pr.afUse.ms; }
function afLeftMs(p) { const pr = getProfile(p.uid), lim = afLimitMs(p, pr); return lim === Infinity ? -1 : Math.max(0, lim - afUsed(pr)); }
setInterval(() => {
  const now = Date.now();
  for (const p of players.values()) {
    if (!p.autofarm || !p.uid) { if (p) p.afTick = 0; continue; }
    const pr = getProfile(p.uid), lim = afLimitMs(p, pr), dt = p.afTick ? Math.min(5000, now - p.afTick) : 0;
    p.afTick = now;
    if (lim === Infinity) continue;
    afUsed(pr); pr.afUse.ms += dt;
    if (pr.afUse.ms >= lim) { setAutofarm(p, false); p.socket.emit('skillFail', `Автобой на сегодня закончился (${lim / 60e3} мин). Больше времени — с сезонным орденом`); if (p.offline) afBotEnd(p, 'время автобоя закончилось'); }
  }
}, 1000);
function setAutofarm(p, on) {
  const pr = getProfile(p.uid);
  if (on) {
    const lim = afLimitMs(p, pr);
    if (afUsed(pr) >= lim) return `Автобой на сегодня закончился (${lim / 60e3} мин). Больше времени — с сезонным орденом`;
  }
  if (on && (world.byId.get(p.zone) || {}).kind !== 'dungeon') return 'Автобой работает только в данжах';
  if (on && (pr.karma || 0) > 0) return '🔴 Красному автобой недоступен — отмывайте карму сами';
  if (on && !p.autofarm) p.afTick = Date.now();
  p.autofarm = !!on;
  p.socket.emit('autofarm', p.autofarm);
  return null;
}

// ---------- Автобой без игрока ----------
function afBotStart(p, socket) {
  const pr = getProfile(p.uid);
  p.offline = true;
  p.afBot = { sock: socket, skip: new Map(), nextPlan: 0, pr: () => getProfile(p.uid), at: Date.now(),
    from: { lvl: p.char.level, xp: p.char.xp, gold: pr.gold || 0, kills: p.char.kills || 0, items: (pr.items || []).length } };
  p.socket = offlineSocket(socket);
  clearTimeout(p.graceTimer);
  p.graceTimer = setTimeout(() => afBotEnd(p, 'время автобоя закончилось'), Math.min(8 * 36e5, afLeftMs(p) + 10000));
}
function afBotEnd(p, why) {
  const b = p.afBot;
  if (!b) return;
  p.afBot = null; clearTimeout(p.graceTimer);
  const pr = getProfile(p.uid), f = b.from, mins = Math.round((Date.now() - b.at) / 60000);
  const gold = Math.max(0, (pr.gold || 0) - f.gold), kills = Math.max(0, (p.char.kills || 0) - f.kills), lv = p.char.level - f.lvl;
  notifyUid(p.uid, `🤖 Автобой завершён (${why}) · ${mins} мин: побеждено ${kills} монстров, +${gold} 💰${lv > 0 ? `, +${lv} ур.` : ''}`);
  if (players.get(b.sock.id) === p) removePlayerG(p, b.sock);
}
setInterval(() => {
  const now = Date.now();
  for (const p of players.values()) {
    if (!p.afBot) continue;
    if (p.dead) { afBotEnd(p, 'герой погиб'); continue; }
    if (AfBot.step(p, now) === 'stop') afBotEnd(p, 'герой покинул данж');
  }
}, 140);

function grantXp(p, amount, gold, shared = false) {
  const pr = getProfile(p.uid), now = Date.now();
  const sub = (meta.isSub(pr) ? meta.SHOP.sub.xpBonus : 0) + (meta.SHOP.passXpGold[meta.passTier(pr)] || 0) + reignBonus(p.uid); // подписка + орден (бесплатный Странника — тоже) + клан-владыка
  amount = Math.round(amount * (1 + ((p.gear && p.gear.xp) || 0) / 100 + sub) * S.xpMult * (p.deathUntil > now ? 1 - DEATH.xp : 1));
  gold = Math.round(gold * (1 + ((p.gear && p.gear.gold) || 0) / 100 + sub + Coll.k(pr, 'gold')) * S.goldMult); // + «Память героев» (Тени)
  p.char.xp += amount;
  p.char.gold += gold;
  pr.gold += gold; // общий кошелёк аккаунта
  Econ.gold('kills', gold);
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
    if (p.char.level >= 30 && p.char.level % 10 === 0) evCast({ ev: 'level', text: `${p.name} (${p.hero.name}) достиг ${p.char.level} уровня!` }); // только вехи
    academyLevel(p, pr); // Академия: выпуск на 20 ур., награда наставникам
    // Новичку на 10 уровне — гарантированная эпическая вещь под класс (один раз на аккаунт)
    if (p.char.level >= 10 && !pr.gift10) {
      pr.gift10 = Date.now();
      const v = giveLoot(p, pr, I.rollItem(Math.min(2, p.zoneTier || 1), { epic: 1 }, null, p.heroId), p);
      p.socket.emit('chat', { sys: true, text: `🎁 10 уровень! Подарок новичку: ${v ? v.name : 'эпическая вещь'}` });
    }
    // Каждые 10 уровней героя — самоцветы (на один призыв)
    if (p.char.level % 10 === 0 && (!MOBX.bal2() || p.char.level <= 30)) { pr.gems = (pr.gems || 0) + 160; p.socket.emit('chat', { sys: true, text: `💎 ${p.hero.name} — ${p.char.level} уровень: +160 самоцветов` }); }
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
// Новый баланс: бонус опыта за группу рядом — +5% за каждого (до +25%), за соклановца +10% (до +50%), всего не больше +50%.
// Автобой — опыт ×0,6 (ручная игра выгоднее)
// ---------- Опасный данж: PvP с выпадением вещей ----------
// Белый (мирный) → напал на белого → розовый на 35 с (после последнего удара). Убил белого → красный (карма):
// 30 мин за каждое убийство, до 3 ч; карма уходит только пока герой в игре (выйти и переждать нельзя).
// Выпадение при гибели от игрока: с белого — 25% вещей из сумки, с розового — 50% из сумки (надетое у них не падает),
// с красного — вся сумка и 1 надетая вещь. Вещи достаются убийце. Привязанные (мифические) не выпадают. Группа друг друга не бьёт
const PK = { flagMs: 60e3 };
// Карма — очки, как в Lineage 2: убийство мирного (и розового — если убийца уже красный) даёт 60 + 30 × (прежние такие убийства),
// не больше 1500 за раз. Смерть смывает часть: от игрока — карму одного убийства, от монстров — треть (друзья/клан/группа не смывают).
// Автобой красному недоступен — отмывать монстрами только вручную. Пока красный — снимать и менять надетое нельзя.
// Отмывается только монстрами: обычный −1, синий/жёлтый −2, полубосс −5, босс −15; монстры намного ниже уровнем (на 10+) не считаются.
// Смерть карму не снимает (договориться «умирать друг от друга» бесполезно). Пока карма > 0 — «красный» и из опасного данжа не выйти
const KARMA = { base: 60, perPk: 30, max: 1500, wash: { normal: 1, magic: 2, rare: 2, mini: 5, boss: 15, world: 15 } };
const karmaAdd = (pr) => Math.min(KARMA.max, KARMA.base + KARMA.perPk * (pr.pkCount || 0));
// Старая карма (миллисекунды) → очки: минута = очко
setImmediate(() => { for (const pr of Object.values(profiles)) if (pr.karma > 0 && pr.karmaV !== 2) { pr.karma = Math.ceil(pr.karma / 60000); pr.karmaV = 2; } });
// Смерть красного: k = 1 — от игрока (карма одного убийства), 1/3 — от монстров
function karmaDeath(p, k) {
  const pr = getProfile(p.uid);
  if (!(pr.karma > 0)) return;
  const v = Math.round((pr.karmaLast || Math.min(pr.karma, KARMA.base)) * k);
  pr.karma = Math.max(0, pr.karma - v);
  if (!pr.karma) { p.pkFlagUntil = Date.now() + PK.flagMs; p.socket.emit('chat', { sys: true, text: '🕊️ Карма очищена смертью — ещё 60 с вы «розовый», потом снова мирный' }); }
  else p.socket.emit('chat', { sys: true, text: `🔴 Смерть смыла ${v} кармы — осталось ${pr.karma}` });
}
function karmaWash(p, m) {
  const pr = getProfile(p.uid);
  if (!(pr.karma > 0) || !m || m.pvpOf || (m.level || 1) < p.char.level - 10) return;
  pr.karma = Math.max(0, pr.karma - (KARMA.wash[m.rank] || 1)); pr.karmaV = 2;
  if (!pr.karma) { p.pkFlagUntil = Date.now() + PK.flagMs; p.socket.emit('chat', { sys: true, text: '🕊️ Карма очищена — ещё 60 с вы «розовый», потом снова мирный' }); }
  else if (pr.karma % 10 === 0) p.socket.emit('chat', { sys: true, text: `🔴 Карма: ${pr.karma} — продолжайте охоту на монстров` });
  markDirty(p);
}
const pkState = (p) => ((getProfile(p.uid).karma || 0) > 0 ? 'red' : (p.pkFlagUntil || 0) > Date.now() ? 'pink' : 'white');
function pkOnHit(p, victim) {
  if (!isPkZone(p.zone) || !isPkZone(victim.zone)) return;
  const vs = pkState(victim);
  if ((vs === 'white' || vs === 'red') && pkState(p) !== 'red') { // напал на мирного или на красного — розовый
    const was = (p.pkFlagUntil || 0) > Date.now();
    p.pkFlagUntil = Date.now() + PK.flagMs; markDirty(p);
    if (!was) p.socket.emit('skillFail', (vs === 'red' ? '🩷 Вы напали на красного' : '🩷 Вы напали на мирного игрока') + ' — 60 с вы «розовый»: вас можно бить без кармы, телепорт и выход из данжа закрыты; при гибели выпадает половина сумки');
  }
}
function pkOnKill(victim) {
  const killer = Date.now() - (victim.lastPvpAt || 0) < 8000 ? players.get(victim.lastPvpBy) : null;
  if (!killer || killer === victim || !isPkZone(killer.zone)) return;
  const vs = pkState(victim) === 'red' ? 'red' : (victim.pkFlagUntil || 0) > Date.now() ? 'pink' : 'white';
  const kpr = getProfile(killer.uid), vpr = getProfile(victim.uid);
  const killerRed = (kpr.karma || 0) > 0;
  // Карма красного, павшего от игрока, — минус одно убийство (не от друзей/клана/группы — иначе «отмывали» бы договорной смертью)
  if (vs === 'red' && !pkFriends(killer, victim)) karmaDeath(victim, 1);
  if (vs === 'white' || (vs === 'pink' && killerRed)) { // убил мирного (или красный убил розового) — карма
    const was = killerRed;
    const add = karmaAdd(kpr);
    kpr.karma = (kpr.karma || 0) + add; kpr.karmaV = 2; kpr.karmaLast = add; kpr.pkCount = (kpr.pkCount || 0) + 1; kpr.pkZone = killer.zone; markDirty(killer);
    if (killer.autofarm) setAutofarm(killer, false); // красному автобой недоступен
    killer.socket.emit('chat', { sys: true, text: `🩸 Вы убили ${vs === 'pink' ? 'розового' : 'мирного'} игрока: карма +${add} (всего ${kpr.karma}, убийств мирных: ${kpr.pkCount}). Вы «красный»: из данжа не выйти, при гибели теряете всю сумку и 1 надетую вещь. Отмыть карму — охотой на монстров (вручную, без автобоя) или смертью: от игрока — одно убийство, от монстров — треть` });
    if (!was) evCast({ ev: 'boss', text: `🩸 ${killer.name} стал убийцей в опасном данже — его можно наказать!` });
  }
  const lost = pkDrop(victim, vs, killer);
  victim.socket.emit('chat', { sys: true, text: lost.length ? `💀 Вас убил ${killer.name}. На землю выпало: ${lost.join(', ')}` : `💀 Вас убил ${killer.name}. На этот раз вещи уцелели` });
  if (lost.length) killer.socket.emit('chat', { sys: true, text: `⚔️ С ${victim.name} выпало на землю: ${lost.join(', ')} — 60 с подобрать можете только вы` });
  saveProfiles();
}
// PvP-щит ×2 здоровья в опасном данже и на аренах: полный при входе, восстанавливается через 30 с без урона от игроков (15%/с) —
// убежать и «отхилить» щит за пару секунд нельзя
const pvpZone = (zid) => { const z = world.byId.get(zid); return !!(z && (z.pk || z.kind === 'pvp')); };
setInterval(() => {
  const now = Date.now();
  for (const p of players.values()) {
    if (!pvpZone(p.zone) || p.dead) { if (p.pvpShZone) { p.pvpShZone = null; p.pvpSh = 0; } continue; }
    const max = p.maxHp * 2;
    if (p.pvpShZone !== p.zone) { p.pvpShZone = p.zone; p.pvpSh = max; markDirty(p); continue; }
    if (p.pvpSh < max && now - (p.pvpShAt || 0) > 30000) { p.pvpSh = Math.min(max, p.pvpSh + max * 0.15); markDirty(p); }
  }
}, 1000);
// Тело флагнутого без игрока: исчезает, когда флаг спал (или герой погиб); место — для возвращения в игру
setInterval(() => {
  for (const p of [...players.values()]) {
    if (!p.pkBody) continue;
    if (p.dead || pkState(p) === 'white' || !isPkZone(p.zone)) { const sock = p.pkBody; p.pkBody = null; if (players.get(sock.id) === p) removePlayerG(p, sock); }
  }
}, 3000);
// Выпадение (вещи падают на землю у тела, лежат 30 мин; 60 с подобрать может только убийца, потом — любой):
// белый — 25% вещей из сумки, надетое не падает; розовый — 50% из сумки, надетое не падает; красный — вся сумка и 1 надетая.
// Привязанные (мифические) и сумки не выпадают
const PK_DROP = { white: [0.25, 0], pink: [0.5, 0], red: [1, 1] };
const groundLoot = new Map();
let groundSeq = 1;
const TROPHY_MS = 7 * 864e5;
function pkFriends(a, b) {
  const pa = getProfile(a.uid), pb = getProfile(b.uid), wk = Date.now() - 7 * 864e5;
  if ((pa.friends || []).includes(b.uid) || (pb.friends || []).includes(a.uid)) return true;
  const ca = clanOf(a.uid); if (ca && !ca.system && ca.members.includes(b.uid)) return true;
  if (a.party && a.party === b.party) return true;
  return ((pa.mailTo || {})[b.uid] || 0) > wk || ((pb.mailTo || {})[a.uid] || 0) > wk;
}
function pkDrop(victim, vs, killer) {
  const vpr = getProfile(victim.uid), [bagK, eqN] = PK_DROP[vs];
  const eqIds = new Set(Object.values(vpr.equip || {}).filter(Boolean));
  const ok = (it) => !it.bound && it.cat !== 'bag';
  const bag = (vpr.items || []).filter((it) => ok(it) && !eqIds.has(it.id) && it.loc !== 'wh');
  const worn = (vpr.items || []).filter((it) => ok(it) && eqIds.has(it.id));
  const pick = (arr, n) => { const out = []; while (n-- > 0 && arr.length) out.push(arr.splice(Math.floor(Math.random() * arr.length), 1)[0]); return out; };
  // Сговор (перенос вещей «в обход рынка»): друзья, соклановцы, одна группа или переписка почтой за 7 дней — вещи не падают
  if (killer && pkFriends(killer, victim)) return [];
  const drop = [...pick(bag, Math.round(bag.length * bagK)), ...pick(worn, eqN)];
  const names = [];
  for (const it of drop) {
    for (const sl of Object.keys(vpr.equip || {})) if (vpr.equip[sl] === it.id) vpr.equip[sl] = null;
    I.detach(vpr, it);
    vpr.items = vpr.items.filter((x) => x !== it);
    delete it.loc;
    const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 36;
    let x = victim.x + Math.cos(a) * r, y = victim.y + Math.sin(a) * r;
    if (world.isSolidAt(x, y)) { x = victim.x; y = victim.y; }
    const g = { id: groundSeq++, zone: victim.zone, x, y, item: it, from: victim.uid, owner: killer ? killer.uid : null, ownerUntil: Date.now() + 60e3, until: Date.now() + 30 * 60e3 };
    groundLoot.set(g.id, g);
    names.push(I.itemView(it).name);
  }
  if (drop.length) { refreshPlayer(victim); saveProfiles(); }
  return names;
}
function groundList(zid, now) {
  if (!zid || !isPkZone(zid)) return undefined;
  const out = [];
  for (const g of groundLoot.values()) if (g.zone === zid) { const v = I.itemView(g.item); out.push([g.id, Math.round(g.x), Math.round(g.y), v.color, v.name, g.owner && now < g.ownerUntil ? g.owner : 0]); }
  return out;
}
function pickupGround(p, id) {
  const g = groundLoot.get(id);
  if (!g || g.zone !== p.zone) return { error: 'Уже подобрали' };
  if (Math.hypot(g.x - p.x, g.y - p.y) > 140) return { error: 'Подойдите ближе' };
  if (g.owner && g.owner !== p.uid && Date.now() < g.ownerUntil) return { error: `Ещё ${Math.ceil((g.ownerUntil - Date.now()) / 1000)} с это может подобрать только победитель` };
  const pr = getProfile(p.uid);
  if ((pr.items || []).filter((i) => i.loc !== 'wh').length >= meta.bagSize(pr)) return { error: 'Сумка полна — освободите место' };
  groundLoot.delete(id);
  // Чужая вещь с земли — «трофей»: 7 дней её нельзя отправить почтой и положить в хранилище клана (продавать и терять при смерти — можно)
  if (g.from && g.from !== p.uid) g.item.trophy = Date.now() + TROPHY_MS; else delete g.item.trophy; // продавать в Торговом доме — можно
  g.item.loc = 'bag'; pr.items.push(g.item);
  const v = I.itemView(g.item);
  fx.push({ t: 'loot', x: g.x, y: g.y, to: p.id, name: `${v.icon} ${v.name}`, color: v.color });
  saveProfiles();
  return { toast: `Подобрано: ${v.name}` };
}
setInterval(() => { const now = Date.now(); for (const [id, g] of groundLoot) if (now > g.until) groundLoot.delete(id); }, 10000);
// Карма — очки (см. KARMA): со временем не уходит, отмывается монстрами (karmaWash)

// Опасный данж: опыт, золото и добыча ×6, в автобое ×3 (автобойный штраф ×0,6 там не действует — вместо него половина рейта)
const isPkZone = (zid) => { const z = world.byId.get(zid); return !!(z && z.pk); };
const pkRate = (p) => (isPkZone(p.zone) ? (p.autofarm ? 3 : 6) : 1); // золото и добыча
const pkXpRate = (p) => (isPkZone(p.zone) ? (p.autofarm ? 1.5 : 3) : 1); // опыт: ×3, в автобое ×1,5
function xpBonusK(p) {
  if (!MOBX.bal2() || !isPkZone(p.zone)) return pkXpRate(p) * (p.autofarm && MOBX.bal2() ? 0.6 : 1); // бонус группы — только в опасном данже
  let other = 0, clan = 0;
  const myClan = clanOf(p.uid);
  for (const o of partyMembers(p)) {
    if (o === p || o.dead || !D.groupNear(p, o)) continue; // бонус — только за тех, кто в той же или соседней комнате
    if (myClan && clanOf(o.uid) === myClan) clan++; else other++;
  }
  // В группе до 4 героев (3 союзника): чужие — до +20% (по 6,7%), соклановцы — до +40% (по 13,3%), всего не больше +40%
  const grp = Math.min(0.4, Math.min(0.2, (0.2 / 3) * other) + Math.min(0.4, (0.4 / 3) * clan));
  return (1 + grp) * (p.autofarm && !isPkZone(p.zone) ? 0.6 : 1) * pkXpRate(p);
}
// Опыт за убийство делится с группой рядом (каждый получает 70% — от опыта без бонусов убийцы, со своими бонусами)
function shareKill(killer, m, xp) {
  const base = xp / xpBonusK(killer);
  for (const o of partyMembers(killer)) {
    if (o === killer || o.dead || !D.groupNear(killer, o)) continue; // опыт за убийство — тем, кто в той же или соседней комнате
    grantXp(o, Math.round(base * 0.7 * xpBonusK(o)), 0, true);
  }
}
// Добыча: обычный монстр — шанс предмета убийце; босс — 2 предмета каждому из группы рядом
function dropLoot(killer, m) {
  const tier = m.tier || 1, boss = m.rank === 'boss' || m.rank === 'mini';
  if (m.rank === 'world') return; // награда мирового босса — по вкладу (server/dungeon.js)
  const receivers = boss ? partyMembers(killer).filter((o) => o.zone === killer.zone && Math.hypot(o.x - m.x, o.y - m.y) < 900) : [killer];
  // Босс и полубосс оставляют сундук: добыча каждого из группы лежит в нём, пока он не нажмёт на сундук
  // (в автобое, при уходе из зоны, выходе из игры и через 3 минуты — открывается сам, ничего не теряется)
  let chest = null;
  if (boss) {
    chest = { id: 'c' + (++chestSeq), x: m.x, y: m.y + 10, zone: m.zone, big: m.rank === 'boss', until: Date.now() + CHEST_MS, pend: new Map() };
    chests.set(chest.id, chest);
  }
  for (const o of receivers) {
    if (boss && D.overFor(o, m)) continue; // перерос данж — с его босса и полубоссов добычи нет
    if (chest) chest.pend.set(o.uid, () => lootFor(o, m, tier, boss, { x: chest.x, y: chest.y }));
    else lootFor(o, m, tier, boss, m);
  }
  if (chest) {
    fx.push({ t: 'chest', id: chest.id, x: chest.x, y: chest.y, big: chest.big, own: [...receivers].filter((o) => chest.pend.has(o.uid)).map((o) => o.id) });
    for (const o of receivers) if (o.autofarm) openChest(o, chest.id); // автобой — сундук открывается сам
    if (!chest.pend.size) chests.delete(chest.id);
  }
}
// Сундуки боссов с неоткрытой добычей
const chests = new Map();
let chestSeq = 0;
const CHEST_MS = 3 * 60e3;
function openChest(o, id, auto = false) {
  const c = chests.get(id);
  if (!c) return { error: 'Сундук уже пуст' };
  const fn = c.pend.get(o.uid);
  if (!fn) return { error: 'В этом сундуке нет вашей добычи' };
  if (!auto && (o.zone !== c.zone || Math.hypot(o.x - c.x, o.y - c.y) > 220)) return { error: 'Подойдите к сундуку' };
  c.pend.delete(o.uid);
  if (!c.pend.size) chests.delete(id);
  fx.push({ t: 'chestOpen', id, x: c.x, y: c.y, to: o.id, big: c.big });
  try { fn(); } catch (e) { console.error('chest loot', e); }
  return { ok: true };
}
// Уход из зоны, выход из игры: всё своё из сундуков — сразу в сумку
function flushChests(o) {
  for (const c of [...chests.values()]) if (c.pend.has(o.uid)) openChest(o, c.id, true);
}
setInterval(() => {
  const now = Date.now();
  for (const c of [...chests.values()]) {
    if (now < c.until) continue;
    for (const uid of [...c.pend.keys()]) { const o = [...players.values()].find((x) => x.uid === uid); if (o) openChest(o, c.id, true); else c.pend.delete(uid); }
    chests.delete(c.id);
  }
}, 5000);
function lootFor(o, m, tier, boss, at) {
  {
    const pr = getProfile(o.uid);
    meta.addPassXp(pr, m.rank === 'boss' ? 20 : m.rank === 'mini' ? 8 : m.rank === 'rare' ? 2 : m.rank === 'magic' ? 1 : Math.random() < 0.12 ? 1 : 0); // орден — на ~3–4 недели обычной игры, а не на пару вечеров
    const luck = I.buffLuck(pr); // эликсиры удачи
    const rankK = m.rank === 'rare' ? 5 : m.rank === 'magic' ? 2.5 : 1; // усиленные и редкие роняют чаще
    const B2 = MOBX.bal2(), pk = pkRate(o), dropK = (B2 ? 0.25 : 1) * pk; // новый баланс: вещей и материалов вчетверо меньше; опасный данж ×6 (автобой ×3)
    const rolls = m.rank === 'boss' ? (B2 ? 1 + (Math.random() < 0.5 ? 1 : 0) : 2) + (pk > 1 ? 1 : 0) : m.rank === 'mini' ? 1 + (pk > 1 ? 1 : 0) : Math.random() < Math.min(0.9, C.DROPS.chance * luck * rankK * (m.lootMult ?? 1) * S.dropMult * dropK) ? 1 : 0;
    const wt = m.rank === 'boss' ? C.DROPS.boss[tier] : m.rank === 'mini' ? C.DROPS.mini[tier] : C.DROPS.weights[tier];
    for (let i = 0; i < rolls; i++) giveLoot(o, pr, I.rollItem(tier, B2 ? dropW2(wt, m.rank) : wt, null, o.heroId), at); // 75% — под класс героя
    // Сумки — редкость: босс 3% (эпическая), полубосс 1% (редкая, 20% — эпическая)
    if (boss && Math.random() < (m.rank === 'boss' ? 0.03 : 0.01) * luck) giveLoot(o, pr, I.createBag(m.rank === 'boss' || Math.random() < 0.2 ? 'epic' : 'rare', tier), at);
    // Материалы, свитки, чертежи и вещи комплектов данжа (server/loot.js)
    const z = world.byId.get(m.zone);
    const dungeon = z && z.kind === 'dungeon' ? { sets: Loot.dungeonSets(z.tier, z.dgIndex) } : null;
    if (m.rank === 'boss') companionDrop(o, 0.005);
    const drop = Loot.rollMats(m, tier, dungeon, luck * (m.lootMult ?? 1) * S.dropMult * dropK);
    giveMats(o, pr, drop.mats, at);
    for (const it of drop.items) giveLoot(o, pr, it, at);
  }
}
// Новый баланс — редкости добычи: легендарные с обычных монстров в 10 раз реже (с полубоссов и боссов — в 3 раза),
// мифические — только с полубоссов, боссов, мировых боссов и крафта
function dropW2(w, rank) {
  const boss = rank === 'boss' || rank === 'mini';
  return { ...w, legendary: (w.legendary || 0) / (boss ? 3 : 10), mythic: boss ? w.mythic || 0 : 0 };
}
// Спутник в добычу — очень редко: обычный (босс данжа 0,5%, мировой босс 1%), редкий — только с мирового босса (0,2%).
// Выпадает тот, которого у игрока ещё нет
function companionDrop(o, chance, rare = false) {
  if (Math.random() >= chance) return;
  const pr = getProfile(o.uid), C2 = (pr.comp ??= { owned: [], active: null });
  const pool = Object.entries(I.COMPANIONS).filter(([id, c]) => c.art && !!c.rare === rare && !C2.owned.includes(id));
  if (!pool.length) return;
  const [id, c] = pool[Math.floor(Math.random() * pool.length)];
  C2.owned.push(id); if (!C2.active) { C2.active = id; o.cp = id; refreshPlayer(o); }
  o.socket.emit('chat', { sys: true, text: `🐾 Новый спутник: ${c.name}! Выбрать — «Герой» → «Спутники»` });
  evCast({ text: `🐾 ${o.name} нашёл спутника «${c.name}»!` });
  markDirty(o);
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
  // Сумка полна: продаётся самая слабая простая вещь из сумки (ниже по редкости, чем новая; не надетая, без заточки,
  // рун, комплекта, тиража и привязки) — а новая ложится на её место. Если новая сама слабее всех — продаётся она
  if (full && !dupe && item.cat !== 'bag') {
    const R = I.RARITY_ORDER, eq = new Set(Object.values(pr.equip || {}));
    const weak = (pr.items || []).filter((i) => i.loc !== 'wh' && !eq.has(i.id) && i.cat !== 'bag' && i.cat !== 'rune' && !i.ench && !(i.runes || []).length && !i.ltd && !i.bound && !I.setIdOf(i) && !(i.dupes > 0)
      && (R.indexOf(i.rar) < R.indexOf(item.rar) || (i.rar === item.rar && (i.tier || 1) < (item.tier || 1))))
      .sort((a, b) => R.indexOf(a.rar) - R.indexOf(b.rar) || (a.tier || 1) - (b.tier || 1))[0];
    if (weak) {
      const vw = I.itemView(weak);
      pr.items = pr.items.filter((i) => i !== weak);
      pr.gold += vw.sell; Econ.gold('autosell', vw.sell);
      o.socket.emit('chat', { sys: true, text: `🎒 Сумка полна: продан ${vw.icon} ${vw.name} (${vw.rarName}) за ${vw.sell} 💰, чтобы взять новую вещь` });
      const res = meta.grant(pr, item);
      Econ.item(item.rar, 'drop');
      const v = I.itemView(res.item);
      if (at) fx.push({ t: 'loot', x: at.x, y: at.y, to: o.id, name: `${v.icon} ${v.name}`, color: v.color });
      o.socket.emit('chat', { sys: true, ev: 'loot', text: `Добыча: ${v.icon} ${v.name} · ${v.rarName}` });
      if (!res.dupe && item.rar === 'mythic') evCast({ ev: 'myth', text: `🔴 ${o.name} добыл ${v.icon} ${v.name} · ${v.rarName}!` });
      return v;
    }
    const v0 = I.itemView(item);
    pr.gold += v0.sell; Econ.gold('autosell', v0.sell); Econ.item(item.rar, 'drop');
    if (at) fx.push({ t: 'loot', x: at.x, y: at.y, to: o.id, name: `💰 +${v0.sell}`, color: '#ffd36a' });
    o.socket.emit('chat', { sys: true, text: `🎒 Сумка полна: ${v0.icon} ${v0.name} продан за ${v0.sell} 💰 — освободите место или перенесите вещи на склад` });
    return v0;
  }
  const res = meta.grant(pr, item);
  Econ.item(item.rar, 'drop');
  const v = I.itemView(res.item);
  if (at) fx.push({ t: 'loot', x: at.x, y: at.y, to: o.id, name: `${v.icon} ${v.name}${res.dupe ? ' ⇧' : ''}`, color: v.color });
  o.socket.emit('chat', { sys: true, ev: 'loot', text: res.dupe ? `Дубликат! ${v.icon} ${v.name} — оригинал усилен на 5%` : `Добыча: ${v.icon} ${v.name} · ${v.rarName}` });
  // «События»: всем — только мифическая находка
  if (!res.dupe && item.rar === 'mythic') evCast({ ev: 'myth', text: `🔴 ${o.name} добыл ${v.icon} ${v.name} · ${v.rarName}!` });
  if (res.dupe && Object.values(pr.equip || {}).includes(res.item.id)) refreshPlayer(o);
  return v;
}

// Пока у игрока нет связи: вместо сокета — копилка сообщений (чат, добыча); кадры мира не копим
function offlineSocket(real) {
  const missed = [];
  const keep = new Set(['chat', 'party', 'clanInvite', 'passTier', 'autofarm']);
  return { id: real.id, missed, offline: true, rooms: real.rooms, conn: { transport: { writable: false } },
    emit(ev, data) { if (keep.has(ev) && missed.length < 100) missed.push([ev, data]); return true; },
    volatile: { emit() { return true; } }, join() {}, leave() {}, disconnect() {}, to() { return { emit() {} }; } };
}

// Путь шага не проходит сквозь стену (длинный шаг не «перепрыгивает» тонкую стену)
function walkable(ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 6);
  for (let i = 1; i < n; i++) if (world.isSolidAt(ax + (bx - ax) * i / n, ay + (by - ay) * i / n)) return false;
  return true;
}
// Защита от подмены служебных имён (constructor, __proto__, toString…) в командах и запросах
const BAD_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype));
function badArg(a, depth = 0) {
  if (typeof a === 'string') return BAD_KEYS.has(a);
  if (a && typeof a === 'object' && depth < 3) {
    for (const k of Object.keys(a)) if (BAD_KEYS.has(k) || badArg(a[k], depth + 1)) return true;
  }
  return false;
}
// Имя героя без разметки (имена из Telegram попадают в окна игры)
const cleanName = (s) => String(s || '').replace(/[<>&"'`\u0000-\u001f]/g, '').trim();

// ---------- Сокеты ----------
io.on('connection', (socket) => {
  // Любая команда со служебным именем в данных — молча отбрасывается
  socket.use(([, ...args], next) => { if (args.some((a) => typeof a !== 'function' && badArg(a))) return; next(); });
  // Не больше ~40 команд в секунду (шаги — отдельно, до 40/с): лишние отбрасываются, упорный флуд — отключение
  const rate = { t: Date.now(), n: 0, mv: 0, strikes: 0 };
  socket.use(([ev], next) => {
    const now = Date.now();
    if (now - rate.t >= 1000) { if (rate.n > 80 || rate.mv > 80) rate.strikes++; else rate.strikes = Math.max(0, rate.strikes - 1); rate.t = now; rate.n = 0; rate.mv = 0; }
    if (rate.strikes >= 5) { console.error('flood: отключён', socket.id); socket.disconnect(true); return; }
    if (ev === 'move') { if (++rate.mv > 40) return; } else if (++rate.n > 40) return;
    next();
  });
  // Связь восстановлена: тот же герой, то же место, те же перезарядки — без перезахода
  if (socket.recovered && players.has(socket.id)) {
    const p = players.get(socket.id);
    clearTimeout(p.graceTimer); p.graceTimer = null; p.offline = false;
    const missed = (p.socket && p.socket.missed) || [];
    p.socket = socket; p.lastMove = Date.now();
    for (const [ev, data] of missed) socket.emit(ev, data); // что произошло, пока не было связи
    socket.join('z:' + p.zone);
    socket.emit('resumed', { x: p.x, y: p.y, zone: p.zone });
    p.lastStats = 0; markDirty(p);
  }
  socket.on('ping2', (cb) => { if (typeof cb === 'function') cb(); }); // замер задержки связи (Настройки → FPS и пинг)
  socket.on('join', (data = {}) => {
    if (players.has(socket.id)) return;
    const who = resolveUid(data.initData, data.guestId || socket.id);
    if (!who) {
      socket.emit('error_msg', 'Откройте игру через Telegram-бота');
      return;
    }
    const uid = who.uid;
    // Сессию после обрыва восстановить не удалось — убираем «ожидающего» героя этого игрока
    let resume = null; // вернулся к своему флагнутому телу в опасном данже — продолжает там же, с тем же здоровьем
    for (const o of [...players.values()]) if (o.uid === uid && o.offline) {
      if (o.pkBody) { resume = { zone: o.zone, x: o.x, y: o.y, hp: o.hp, flag: o.pkFlagUntil }; const sock = o.pkBody; o.pkBody = null; removePlayerG(o, sock); continue; }
      if (o.afBot) { afBotEnd(o, 'вы вернулись в игру'); continue; }
      clearTimeout(o.graceTimer); removePlayer(o.socket, o);
    }
    // Один аккаунт — один герой в мире: вход с другой вкладки или устройства отключает прежнюю сессию
    for (const o of [...players.values()]) if (o.uid === uid && !o.offline && o.socket.id !== socket.id) {
      o.socket.emit('kicked', 'Вы вошли в игру с другого устройства или вкладки');
      removePlayer(o.socket, o);
      o.socket.disconnect(true);
    }
    const heroId = String(data.hero || '');
    const prj = getProfile(uid);
    Econ.active(uid);
    if (prj.banned) return socket.emit('error_msg', `Вы заблокированы: ${prj.banned.reason}`);
    const isTester = !!(prj.test || {}).tester || admin.isAdminUid(uid);
    if (S.openAt > Date.now() && !isTester) return socket.emit('error_msg', `Игра откроется ${(() => { const d = new Date(S.openAt + 3 * 36e5).toISOString(); return `${d.slice(8, 10)}.${d.slice(5, 7)} в ${d.slice(11, 16)}`; })()} МСК`);
    if (S.maintenance && !isTester) return socket.emit('error_msg', S.brk ? `Технический перерыв до ${fmtHM(S.brk.at + S.brk.min * 60e3)} МСК` : 'Технические работы, зайдите позже');
    // Подарок основателя: всем, кто вошёл в первые 3 дня после открытия (один раз на аккаунт)
    if (S.openAt && Date.now() >= S.openAt && Date.now() < S.openAt + 3 * 864e5 && !prj.founder) {
      prj.founder = Date.now();
      prj.gems = (prj.gems || 0) + 300; prj.paidSpins = (prj.paidSpins || 0) + 2; prj.itemSpins = (prj.itemSpins || 0) + 3; I.addMat(prj, 'elxHero', 1);
      const C2 = (prj.cosm ??= { owned: [] }); if (!C2.owned.includes('frame:founder')) { C2.owned.push('frame:founder'); C2.frame = 'founder'; } // знак основателя — навсегда, не продаётся
      setTimeout(() => socket.emit('chat', { sys: true, text: '🎁 Подарок основателя: 300 💎, 2 печати призыва героев, 3 печати снаряжения, Великий эликсир опыта и Рамка основателя (больше никогда не будет в продаже). Спасибо, что вы с нами с первых дней!' }), 2500);
    }
    if (prj.zbtGiftMsg) { const m = prj.zbtGiftMsg; delete prj.zbtGiftMsg; setTimeout(() => socket.emit('chat', { sys: true, text: m }), 3500); }
    if (prj.comeback && prj.comeback.gift) { prj.comeback.gift = false; prj.gems = (prj.gems || 0) + 50; setTimeout(() => socket.emit('chat', { sys: true, text: '💎 С возвращением! +50 самоцветов' }), 3000); }
    if (!C.HEROES[heroId] || !getProfile(uid).heroes.includes(heroId)) {
      socket.emit('error_msg', 'Сначала получите персонажа');
      return;
    }
    const hero = C.HEROES[heroId];
    // Новичок: стартовое снаряжение под класс героя (сразу надето) и зелья — чтобы первые бои шли уверенно
    if (!prj.kitGiven && !(prj.items || []).length) {
      prj.kitGiven = true;
      for (const cat of ['weapon', 'armor']) {
        const it = I.createItem(cat, 'rare', 1, null, I.classOf(heroId));
        I.addItem(prj, it, 999, false);
        (prj.equip ??= {})[cat] = it.id;
      }
      I.addMat(prj, 'potHp', 10);
    }
    if (who.tg && !getProfile(uid).nick) { const pj = getProfile(uid), v = freeNick(who.name || 'Герой', uid); pj.nick = v; pj.nickAuto = true; claimNick(uid, v); } // ник из Telegram, занят — с номером
    const name = (who.tg ? cleanName(getProfile(uid).nick || who.name) : cleanName(data.guestName).slice(0, 16)) || (who.tg ? 'Герой' : 'Гость');
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
    // Слабость после гибели переживает перезаход и идёт только в игре: вне игры остаток «замораживается»
    p.deathUntil = prj.deathLeft > 0 ? Date.now() + prj.deathLeft : prj.deathUntil || 0;
    prj.deathUntil = p.deathUntil; prj.deathLeft = 0;
    p.god = !!(prj.test || {}).god; p.oneShot = !!(prj.test || {}).oneShot; // тестовые режимы из админки
    prj.name = p.name; prj.lastSeen = Date.now();
    if (['ru', 'en', 'es', 'pt', 'de', 'fr', 'tr'].includes(data.lang)) prj.lang = data.lang; // уведомления бота — на языке игры
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
    // Красный (карма) или розовое тело в опасном данже — вход обратно туда же, а не в город
    const pkz = resume ? world.byId.get(resume.zone) : null;
    const redZone = !pkz && (getProfile(uid).karma || 0) > 0 && getProfile(uid).pkZone && world.byId.get(getProfile(uid).pkZone);
    if (pkz || redZone) {
      const z = pkz || redZone;
      socket.leave('z:' + start.id); p.zone = z.id; p.zoneTier = z.tier; socket.join('z:' + z.id);
      if (pkz) { p.x = resume.x; p.y = resume.y; p.hp = Math.max(1, Math.min(p.maxHp, resume.hp)); p.pkFlagUntil = resume.flag; }
      else { p.x = z.spawn.x; p.y = z.spawn.y; }
    }
    for (const pet of p.pets || []) { pet.x = p.x; pet.y = p.y + 16; }
    players.set(socket.id, p);
    academyJoin(p); // новичок без клана — в Академию героев
    p.clanTag = (clanOf(uid) || {}).tag || null;
    p.look = meta.cosmLook(getProfile(uid)); // цвет имени, сияние, рамка аватара
    p.cp = (getProfile(uid).comp || {}).active || null; // спутник рядом с героем

    socket.emit('welcome', {
      id: socket.id,
      tile: C.TILE,
      zone: world.payload(start),
      towns: world.towns,
      skillUnlock: C.SKILL_UNLOCK,
      heroes: C.HEROES,
      monsters: C.MONSTERS,
      skillTarget: SKILL_TARGET, // умения, которым нужна цель, и их дальность — клиент не играет звук впустую
      stats: privateStats(p),
      pDef: P_DEF, // поля героев, которых нет в пакете состояния, — со значениями отсюда
      x: p.x, y: p.y, // место героя (для повторного входа после долгого обрыва — без перезагрузки страницы)
    });
    socket.emit('chatHistory', [...evHistory, ...chatHistory, ...((clanOf(uid) || {}).log || []).slice(-30)].sort((a, b) => a.t - b.t)); // + история клана
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
    // Шаг отправлен до того, как клиент узнал о переносе умением, — со старого места: не принимаем, иначе героя откатит назад
    if (p.tpSeq && (d.tp | 0) !== p.tpSeq && now - p.tpAt < 1500) return;
    if (p.rootSelfUntil > now) { socket.emit('correct', { x: p.x, y: p.y }); return; } // укоренение Ву'гажа
    const cct = D.ccActive(p, now);
    // Контроль от монстров (оглушение, заморозка, паутина): шаги не принимаем, но и НЕ возвращаем героя назад —
    // телефон узнаёт об оглушении с задержкой связи и успевает сделать пару шагов; откат выглядел как лаг.
    // Небольшое расхождение (до 120 px) сервер примет первым же шагом после конца оглушения. Поправка — только если ушёл далеко
    if (cct === 'stun' || cct === 'freeze' || cct === 'root') { p.mvBudget = undefined; if (Math.hypot(x - p.x, y - p.y) > 120) socket.emit('correct', { x: p.x, y: p.y }); return; } // запас шага — полный, чтобы после оглушения расхождение приняли без рывка
    // Античит: ограничение скорости (у облика зверя бег быстрее; после смены облика даём запас)
    const flyBoost = p.flyUntil > now ? 1 + 0.03 * (p.blessings || 0) : 1; // полёт Талмиры
    const speed = Math.max(formOf(p).speed, p.hero.speed) * (p.hasteUntil > now ? 1.25 : 1) * flyBoost * (1 + ((p.gear && p.gear.ms) || 0) / 100);
    // Античит: «бюджет» пути копится со временем (скорость × 1,4) и тратится на шаги — частые мелкие шаги не дают бежать быстрее
    const cap = speed * 0.6 + 24;
    p.mvBudget = Math.min(cap, (p.mvBudget ?? cap) + speed * 1.4 * dt);
    const dist = Math.hypot(x - p.x, y - p.y);
    if (dist > p.mvBudget + 2 || world.isSolidAt(x, y) || (dist > 16 && !walkable(p.x, p.y, x, y))) {
      p.mvBudget = Math.max(0, p.mvBudget - 4);
      socket.emit('correct', { x: p.x, y: p.y });
      return;
    }
    p.mvBudget -= dist;
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
    let basic = ps1 && ps1.basicMult ? pasScale(p, ps1.basicMult(p)) : 1; // рвение Валериана, жар Блейза, трещины Эмета
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
    // Игрок выбрал живую цель, но она дальше дальности (или за стеной) — умению с целью отказ, а не удар по другому монстру
    if (target && target.hp > 0 && NEEDS_TARGET.has(sk.id) && (Math.hypot(target.x - p.x, target.y - p.y) > range + 30 || !seen(target))) return fail('Цель слишком далеко');
    if (target && Math.hypot(target.x - p.x, target.y - p.y) > range + 30) target = null;
    if (!target || target.hp <= 0 || !seen(target)) {
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
    if (obj.id === 'survival') return D.startSurvival(p, !!d.trial);
    if (obj.id === 'arena' && z.kind === 'town') {
      const [lo, hi] = PVP_LEVELS[z.id] || [1, 99];
      if (p.char.level < lo || p.char.level > hi) return socket.emit('skillFail', `Арена ${z.name}: герои ${lo}–${hi} уровня`);
      moveToZone(p, `pvp_${z.id}`);
      return socket.emit('chat', { sys: true, text: `🏟️ PvP-арена ${z.name}: бей других героев! Победа — рейтинг и золото, после гибели — возрождение на арене. Выход — портал на юге.` });
    }
    if (obj.dungeon !== undefined) return D.startDungeon(p, z.id, obj.dungeon);
    if (obj.pk) return D.startPk(p, z.id); // опасный данж
    if (z.pk && pkState(p) !== 'white') return socket.emit('skillFail', pkState(p) === 'red' ? '🔴 Вы красный — из опасного данжа не уйти, пока не очистится карма' : '🩷 Вы розовый — выход недоступен, пока не спадёт флаг');
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
    if (z.pk && pkState(p) !== 'white') return socket.emit('skillFail', pkState(p) === 'red' ? '🔴 Вы красный — из опасного данжа не уйти, пока не очистится карма' : '🩷 Вы розовый — телепорт в город недоступен, пока не спадёт флаг');
    moveToZone(p, z.town);
    socket.emit('chat', { sys: true, text: `🌀 Вы вернулись в город ${world.byId.get(z.town).name}` });
  });

  // Инвентарь, магазины, рынок, аукцион, пропуск, арена (server/meta.js)
  socket.on('act', (d, cb) => {
    const p = players.get(socket.id);
    if (!p || typeof cb !== 'function') return;
    const op = d && typeof d.op === 'string' ? d.op : '';
    if (/^sp(List|Go|Claim)$/.test(op)) { // особые задания: проверка подписки — запрос в Telegram, ответ асинхронный
      SP.act(p, d).then((res) => { cb(res); markDirty(p); }, (e) => { console.error('special', e); cb({ error: 'Ошибка сервера' }); });
      return;
    }
    if (/^mail(List|Send|Quote|Read|Take|Del)$/.test(op)) { try { const r = Mail.act(p, d, (pr) => meta.bagSize(pr)); cb(r); if (r && (r.refresh || r.toast)) refreshPlayer(p); } catch (e) { console.error('mail', e); cb({ error: 'Ошибка сервера' }); } return; }
    if (/^castle(Info|Reg|Join)$/.test(op)) { try { cb(Castle.act(p, d)); } catch (e) { console.error('castle', e); cb({ error: 'Ошибка сервера' }); } return; }
    if (op === 'towerInfo' || op === 'towerEnter') { try { cb(Tower.act(p, d)); } catch (e) { console.error('tower', e); cb({ error: 'Ошибка сервера' }); } return; }
    if (op === 'zbtInfo' || op === 'zbtChoice') { cb(zbtAct(p, d)); return; }
    if (op === 'worldMap') { try { cb(worldMapView(p)); } catch (e) { console.error('worldMap', e); cb({ error: 'Ошибка сервера' }); } return; }
    const src = /^(quest|story)/.test(op) ? 'quests' : /^npc/.test(op) ? 'npc' : op;
    try {
      const res = Econ.measure(src, getProfile(p.uid), () => (/^(quest|story)/.test(op) ? Q.handle(p, d) : op === 'npcMarks' ? NQ.marks(p, p.zone) : op === 'refInfo' ? refInfo(p) : /^npc/.test(op) ? NQ.act(p, d) : Trade.isOp(op) ? Trade.act(p, d) : meta.handle(p, d || {})));
      if (op === 'itemSpin' && res && res.results) for (const x of res.results) Econ.item(x.rar, 'gearSummon');
      cb(res); markDirty(p);
    } catch (e) { console.error('act', d && d.op, e); cb({ error: 'Ошибка сервера' }); }
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

  // Настройка умений героя для оффлайн-автобоя: порядок и выключенные (клиент шлёт при входе и при изменении)
  socket.on('skillCfg', (d = {}) => {
    const p = players.get(socket.id);
    if (!p || !d || typeof d.hero !== 'string' || !C.HEROES[d.hero]) return;
    const ids = new Set(C.HEROES[d.hero].skills.map((s) => s.id));
    const pr = getProfile(p.uid); pr.skillCfg ??= {};
    pr.skillCfg[d.hero] = { order: (Array.isArray(d.order) ? d.order : []).filter((x) => ids.has(x)).slice(0, 12), off: (Array.isArray(d.off) ? d.off : []).filter((x) => ids.has(x)).slice(0, 12) };
  });

  // Друзья (до 50): заявка → принять. Телепорт к другу онлайн — если ни он, ни вы не флагнуты (розовый/красный)
  // и никто не в бою (10 с без урона и ударов); только в город, обычный или опасный данж по своему уровню
  socket.on('friend', (d = {}, cb) => {
    const p = players.get(socket.id);
    if (!p || typeof cb !== 'function') return;
    try { cb(friendAct(p, d) || {}); markDirty(p); } catch (e) { console.error('friend', e); cb({ error: 'Ошибка сервера' }); }
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
    chatSave();
    io.emit('chat', msg);
  });

  // Испытание дня: условие, сделано ли сегодня, лучшие
  socket.on('trialInfo', (cb) => { const p = players.get(socket.id); if (p && typeof cb === 'function') cb(D.trialInfo(getProfile(p.uid))); });
  // Рейтинги (меню «Игра» → «Рейтинги»)
  socket.on('ranks', (d = {}, cb) => {
    const p = players.get(socket.id);
    if (!p || typeof cb !== 'function') return;
    try { cb(Ranks.view(p.uid, ['lvl', 'pow', 'cl', 'wb', 'war'].includes(d.tab) ? d.tab : 'lvl')); } catch (e) { console.error('ranks', e); cb({ error: 'Рейтинг недоступен' }); }
  });
  // Кланы: создать, пригласить, вступить, выйти, исключить (глава), состав
  socket.on('clan', (d = {}, cb) => {
    const p = players.get(socket.id);
    if (!p || typeof cb !== 'function') return;
    cb(Econ.measure('clan', getProfile(p.uid), () => clanAct(p, d)));
  });

  // Арена: очередь на дуэль и команды, бой с клоном и тенью чемпиона
  socket.on('arena', (d = {}, cb) => {
    const p = players.get(socket.id);
    if (!p || typeof cb !== 'function') return;
    if (d.op === 'join') return cb(Arena.join(p, d.mode));
    if (d.op === 'leave') { Arena.leave(p); return cb({ ok: true }); }
    if (d.op === 'glJoin') return cb(Arena.glJoin(p));
    cb(Arena.info(p));
  });

  socket.on('pickup', (d = {}, cb) => {
    const p = players.get(socket.id);
    const r = p && !p.dead ? pickupGround(p, Number(d.id)) : { error: 'Недоступно' };
    if (typeof cb === 'function') cb(r);
  });
  socket.on('openChest', (d = {}, cb) => {
    const p = players.get(socket.id);
    const r = p && !p.dead ? openChest(p, String(d.id || '')) : { error: 'Недоступно' };
    if (typeof cb === 'function') cb(r);
  });
  socket.on('autofarm', (on) => {
    const p = players.get(socket.id);
    if (!p) return;
    const err = setAutofarm(p, !!on);
    if (err) { socket.emit('skillFail', err); socket.emit('autofarm', false); }
  });

  socket.on('disconnect', (reason) => {
    const p = players.get(socket.id);
    if (!p || p.socket !== socket) return;
    try { flushChests(p); } catch (e) { console.error('chest flush', e); }
    // Вышел с включённым автобоем в данже — герой остаётся и фармит сам, пока есть время автобоя (его могут убить)
    if (p.autofarm && !p.dead && !p.match && (world.byId.get(p.zone) || {}).kind === 'dungeon' && afLeftMs(p) > 0) { afBotStart(p, socket); return; }
    // Розовый или красный в опасном данже вышел из игры — тело остаётся на месте (его можно убить), пока не спадёт флаг
    if (!p.dead && isPkZone(p.zone) && pkState(p) !== 'white') {
      p.offline = true; p.autofarm = false; p.pkBody = socket;
      p.socket = offlineSocket(socket);
      clearTimeout(p.graceTimer); p.graceTimer = null;
      return;
    }
    // Обрыв связи (не выход из игры): герой ждёт в мире, пока игрок не переподключится
    if (reason !== 'client namespace disconnect' && reason !== 'server namespace disconnect' && !p.match) {
      p.offline = true; p.autofarm = false;
      p.socket = offlineSocket(socket); // сообщения (добыча, награды) копятся и придут, когда связь вернётся
      clearTimeout(p.graceTimer);
      p.graceTimer = setTimeout(() => { if (players.get(socket.id) === p && p.offline) removePlayer(socket, p); }, GRACE_MS);
      return;
    }
    removePlayer(socket, p);
  });
  function removePlayer(socket, p) { removePlayerG(p, socket); }
});
// Убрать героя из мира (выход, обрыв, вход с другой вкладки, обнуление из админки)
function removePlayerG(p, socket = p.socket) {
  {
    Arena.leave(p);
    leaveParty(p);
    players.delete(socket.id);
    getProfile(p.uid).lastSeen = Date.now();
    { const pr = getProfile(p.uid), left = (p.deathUntil || 0) - Date.now(); pr.deathLeft = left > 0 ? left : 0; } // остаток слабости — до следующего входа
    (p.pets || []).forEach((pet) => pets.delete(pet.id));
    saveProfiles();
  }
}

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
    const bigOne = m.room != null && (m.boss || m.mini); // босс или полубосс данжа
    if (target && (target.dead || target.down || target.stealthUntil > now || target.flyUntil > now || Math.hypot(target.x - m.x, target.y - m.y) > (m.aggro || def.aggro) * (bigOne ? 3 : 1.8) || !D.inLeash(m, target))) target = null;
    // Босс в бою потерял цель — переключается на другого героя, который его бил и ещё рядом, а не уходит лечиться
    if (!target && bigOne && m.contrib && m.hp < m.maxHp) {
      let bd = 1e9;
      for (const p of players.values()) {
        if (p.dead || p.zone !== m.zone || !m.contrib[p.uid] || p.stealthUntil > now || !D.inLeash(m, p)) continue;
        const d = Math.hypot(p.x - m.x, p.y - m.y);
        if (d < bd) { bd = d; target = p; }
      }
    }
    if (!target) {
      let best = null, bestD = m.aggro || def.aggro;
      for (const p of players.values()) {
        if (p.dead) continue;
        if (m.ignoreUntil > now && m.ignoreId === p.id) continue; // потерял из виду (дымовая завеса)
        if (p.stealthUntil > now || p.flyUntil > now) continue; // невидимость (Кассиан), полёт (Талмира)
        const dx = p.x - m.x, dy = p.y - m.y;
        if (dx > bestD || dx < -bestD || dy > bestD || dy < -bestD) continue; // далеко (сначала дешёвая проверка — героев и монстров сотни)
        const d = Math.hypot(dx, dy);
        if (d >= bestD || !D.canAggro(m, p)) continue; // в данже — только герои в комнате монстра
        if (world.lineOfSight(m.x, m.y, p.x, p.y)) { best = p; bestD = d; } // замечает только тех, кого видит
      }
      for (const pet of pets.values()) {
        if (pet.down) continue;
        const d = Math.hypot(pet.x - m.x, pet.y - m.y);
        if (d < bestD && D.canAggro(m, pet)) { best = pet; bestD = d; }
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
          if (Math.hypot(m.homeX - m.x, m.homeY - m.y) < 30) { m.goingHome = false; if (now - (m.hurtAt || 0) > 6000) m.hp = m.maxHp; }
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
      // Вне боя восстанавливается — только если 6 с никто не бил (раньше босс лечился 5%/с, пока Зефира на секунду
      // взлетала «Драконьими крыльями» и он терял цель); боссы, полубоссы и мировые — 1%/с
      if (m.hp < m.maxHp && now - (m.hurtAt || 0) > 6000) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * (m.boss || m.mini ? 0.01 : 0.05) * dt);
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
      const st = privateStats(p), js = JSON.stringify(st);
      if (js !== p.lastStatsJs) { p.lastStatsJs = js; p.socket.emit('stats', st); } // без изменений — не шлём
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
  tickNo++;
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
  // Лёгкий кадр (каждый второй такт): позиции героев и монстров рядом, здоровье монстров и эффекты — без полного состояния
  if (tickNo % 2 === 1) {
    for (const Z of byZone.values()) {
      const pl = Z.p.filter((p) => !p.dead).map((p) => [p.id, Math.round(p.x), Math.round(p.y), p.dir]);
      const important = Z.fx.filter((f) => FX_KEEP.has(f.t));
      for (const p of Z.p) {
        if (p.offline) continue;
        const tr = p.socket.conn && p.socket.conn.transport;
        if (tr && !tr.writable) {
          const keep = important.filter((f) => !FX_NEAR.has(f.t) || f.x === undefined || (Math.abs(f.x - p.x) < VIEW.x && Math.abs(f.y - p.y) < VIEW.y));
          if (keep.length) p.pendFx = (p.pendFx || []).concat(keep).slice(-80);
          continue;
        }
        const rx = p.autofarm ? VIEW.x * 1.5 : VIEW.x, ry = p.autofarm ? VIEW.y * 1.5 : VIEW.y, ml = [];
        for (const m of Z.m) if (Math.abs(m.x - p.x) <= rx && Math.abs(m.y - p.y) <= ry || m.rank === 'world') ml.push([m.id, Math.round(m.x), Math.round(m.y), Math.ceil(m.hp)]);
        const out = { ts: now, p: pl, m: ml, fx: Z.fx };
        if (p.pendFx) { out.fx = p.pendFx.concat(Z.fx); p.pendFx = null; }
        p.socket.volatile.emit('lt', out);
      }
    }
    fx = [];
    return;
  }
  // Полное состояние — 5 раз в секунду (было 10): между ними лёгкие кадры (позиции, здоровье, эффекты) 10 раз в секунду.
  // В такт без отправки эффекты копятся и уйдут со следующим кадром. Меньше трафика — модем телефона чаще «отдыхает»
  if (tickNo % 4 === 2) return;
  const fullNo = tickNo >> 2, refreshStatic = fullNo % 10 === 0; // раз в 2 с — постоянные данные монстров всем заново
  for (const Z of byZone.values()) {
  const state = {
    gl: groundList(Z.p[0] && Z.p[0].zone, now), // вещи на земле (опасный данж)
    p: Z.p.map((pl) => { const o = slimPlayer(publicPlayer(pl)); o.hp = Math.ceil(o.hp); return o; }),
    m: Z.m.map((m) => slim(m.pvpOf ? { id: m.id, pv: m.pvpOf, nm: '⚔️ ' + m.nm, lv: m.level, tm: (players.get(m.pvpOf) || {}).match ? `${players.get(m.pvpOf).match}:${players.get(m.pvpOf).team}` : null, x: Math.round(m.x), y: Math.round(m.y), hp: Math.ceil(m.hp), maxHp: m.maxHp } : ({ id: m.id, type: m.type, tr: m.tier, lv: m.level, rk: m.rank, nm: m.name, inv: m.inv ? 1 : 0, sz: m.size, sh: m.shieldHp > 0 ? 1 : 0, fm: m.form || m.phase || m.element || null, x: Math.round(m.x), y: Math.round(m.y),
      hs: m.heroSkin || undefined, hp: Math.ceil(m.hp), maxHp: m.maxHp, st: m.stunUntil > now ? 1 : 0, wk: m.weakUntil > now ? 1 : 0,
      mk: m.markUntil > now ? m.markedBy : null, sl: m.sealUntil > now ? 1 : 0,
      sw: m.slowUntil > now ? 1 : 0, tn: m.tauntUntil > now ? 1 : 0,
      ws: m.weakSpotUntil > now ? 1 : 0, br: m.brokenUntil > now ? 1 : 0, ps: m.poisonUntil > now ? 1 : 0,
      bn: m.burnUntil > now ? 1 : 0, bc: m.bloodCurseUntil > now ? 1 : 0, rt: m.rootUntil > now ? 1 : 0,
      cf: m.confusedUntil > now ? 1 : 0, fr: m.fearUntil > now ? 1 : 0, fz: m.frozenUntil > now ? 1 : 0, mo: m.mockUntil > now ? 1 : 0, st2: m.starUntil > now ? 1 : 0, bd: m.bondUntil > now ? 1 : 0, ds: m.darkSealUntil > now ? 1 : 0, bl: m.bleedUntil > now ? 1 : 0, ch: m.charmUntil > now ? 1 : 0, cu: m.curseUntil > now ? 1 : 0, fs: m.frost > 0 ? Math.round(m.frost) : 0, sn: m.stoneUntil > now ? 1 : 0, wsh: m.wbShield || m.wbImmune ? 1 : 0, ai: m.wbAir ? 1 : 0, vu: m.vulnUntil > now ? 1 : 0, pf: m.petrify > 0 ? Math.round(m.petrify) : 0 }))),
    pt: Z.pt.map((pet) => ({ id: pet.id, kind: pet.kind, owner: pet.owner.id, skin: pet.kind === 'clone' ? 'hero_' + pet.owner.heroId : pet.kind === 'minion' ? 'mon_' + pet.monsterType : null, label: pet.label || null, drowned: pet.drowned ? 1 : 0, x: Math.round(pet.x), y: Math.round(pet.y),
      hp: Math.ceil(Math.max(0, pet.hp)), maxHp: pet.maxHp, down: pet.down, boost: pet.boostUntil > now })),
    t: Z.t.map((t) => ({ id: t.id, kind: t.kind, sub: t.sub || null, ang: t.ang ?? null, x: Math.round(t.x), y: Math.round(t.y), r: t.r, left: t.until - now })),
    fx: Z.fx,
    ts: now, // время сервера: клиент показывает чужих героев с небольшой задержкой по этому времени (плавно при неровной связи)
  };
  // volatile: если связь медленная и прошлый кадр ещё не ушёл — этот пропускаем, а не копим очередь (иначе игра «догоняет» с задержкой)
  const important = Z.fx.filter((f) => FX_KEEP.has(f.t));
  // Монстры: полные данные — только рядом с героем (экран и запас), дальние — точками для мини-карты раз в 3 тика.
  // В данже из ~65 монстров на экране обычно 3–5: пакет в разы меньше, телефону меньше разбирать
  const allM = state.m, mmTick = fullNo % 2 === 0; // мини-карта — 2–3 раза в секунду
  for (const p of Z.p) {
    if (p.offline) continue;
    const tr = p.socket.conn && p.socket.conn.transport;
    if (tr && !tr.writable) { // связь занята — кадр пропускаем, важное копим (умения — только рядом с героем, чтобы пакет не раздувался)
      const keep = important.filter((f) => !FX_NEAR.has(f.t) || f.x === undefined || (Math.abs(f.x - p.x) < VIEW.x && Math.abs(f.y - p.y) < VIEW.y));
      if (keep.length) p.pendFx = (p.pendFx || []).concat(keep).slice(-80);
      continue;
    }
    const rx = p.autofarm ? VIEW.x * 1.5 : VIEW.x, ry = p.autofarm ? VIEW.y * 1.5 : VIEW.y; // автобою нужен запас — искать цели дальше
    let near = allM;
    const far = mmTick ? [] : null; // пустой список тоже шлём: мини-карта стирает старые точки
    if (allM.length > 12) {
      near = [];
      for (const m of allM) {
        if (Math.abs(m.x - p.x) <= rx && Math.abs(m.y - p.y) <= ry || m.rk === 'world' || m.pv) near.push(m);
        else if (far) far.push([m.x >> 3, m.y >> 3, m.rk === 'boss' || m.rk === 'mini' ? 1 : 0]);
      }
    }
    // Постоянные данные монстра (тип, мир, уровень, ранг, имя, размер, облик) — только если в прошлом полном кадре
    // этому игроку его не было (появился, вернулся в обзор, новая зона) и раз в 2 с; иначе только меняющееся
    const prevSeen = p.seenM || EMPTY_SET, seen = new Set();
    const mOut = near.map((m) => {
      seen.add(m.id);
      if (m.pv || refreshStatic || !prevSeen.has(m.id)) return m;
      const o = {};
      for (const k in m) if (!M_STATIC.has(k)) o[k] = m[k];
      return o;
    });
    p.seenM = seen;
    const out = { ...state, m: mOut };
    if (far) out.mm = far;
    if (p.pendFx) { out.fx = p.pendFx.concat(state.fx); p.pendFx = null; }
    p.socket.volatile.emit('state', out);
  }
  }
  fx = [];
}, C.TICK_MS);

// Видимая область вокруг героя (мировые пиксели), в которой монстры приходят целиком
const VIEW = { x: 520, y: 720 };
let tickNo = 0;
// Эффекты, которые нельзя терять при плохой связи: гибель монстра, сундук, добыча, повышение уровня
const FX_KEEP = new Set(['death', 'chest', 'chestOpen', 'loot', 'levelup', 'pdeath', 'skill', 'heal', 'shield', 'absorb', 'dodge']);
// Умения и лечение при плохой связи тоже не теряем (иначе умение «не срабатывало» — ни картинки, ни звука), но только те, что рядом
const FX_NEAR = new Set(['skill', 'heal', 'shield', 'absorb', 'dodge']);
// Пустые флаги состояния монстров не отправляем: пакет в разы меньше — на медленной связи не копится очередь
const SLIM_KEEP = new Set(['x', 'y', 'hp', 'maxHp', 'lv', 'tr']);
const M_STATIC = new Set(['type', 'tr', 'lv', 'rk', 'nm', 'sz', 'hs']), EMPTY_SET = new Set();
function slim(o) { for (const k in o) if ((o[k] === 0 || o[k] === null || o[k] === undefined) && !SLIM_KEEP.has(k)) delete o[k]; return o; }
// Между тиками — только позиции героев (лёгкий пакет): чужие герои на экране двигаются плавно и без отставания
if (C.TICK_MS >= 100) setTimeout(() => setInterval(() => { // при 20 тиках позиции идут в лёгком кадре — отдельный пакет не нужен
  const byZ = new Map();
  for (const p of players.values()) {
    if (p.dead) continue;
    if (!byZ.has(p.zone)) byZ.set(p.zone, []);
    byZ.get(p.zone).push(p);
  }
  for (const list of byZ.values()) {
    if (list.length < 2) continue;
    const pos = list.map((p) => [p.id, Math.round(p.x), Math.round(p.y), p.dir]);
    const ts = Date.now();
    for (const p of list) p.socket.volatile.emit('pp', pos, ts);
  }
}, C.TICK_MS), C.TICK_MS / 2);

// Ошибка в одном обработчике не должна ронять весь сервер (иначе перезапуск: все теряют бой, босса и награды)
// Все ошибки сервера (console.error) — ещё и в админку: вкладка «Журнал» → «Ошибки сервера»
{ const orig = console.error.bind(console);
  console.error = (...a) => { orig(...a); try { admin.log('error', a.map((x) => (x && x.stack) || (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ')); } catch { /* журнал недоступен */ } }; }
process.on('uncaughtException', (e) => console.error('uncaughtException', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

server.listen(PORT, () => {
  console.log(`MMORPG сервер запущен: http://localhost:${PORT}`);
  if (BOT_TOKEN && process.env.RUN_BOT !== 'false') bot = require('../bot/bot')({ onStart: (id) => noteBotUser(id), links: () => ({ channel: S.channel || '', chat: S.chat || '' }), onPaid, isValidPayload, profiles: () => profiles, save: () => saveProfiles(),
    onNotify: (tgId) => { const pr = profiles['tg' + tgId]; if (!pr) return null; pr.notifyOff = !pr.notifyOff; if (!pr.notifyOff) pr.pushBlocked = false; saveProfiles(); return !pr.notifyOff; } });
});
// Возврат Stars кнопкой в админке; игроку — сообщение от бота
admin.setRefund(async (tgId, charge) => {
  if (!bot) throw new Error('бот не запущен');
  await bot.telegram.callApi('refundStarPayment', { user_id: tgId, telegram_payment_charge_id: charge });
  bot.telegram.sendMessage(tgId, '💫 Stars за покупку возвращены. / Your Stars have been refunded.').catch(() => {});
});
// Рассылка от бота (админка → Объявления → «Разослать ботом»): всем игрокам Telegram (кто открывал игру) и всем,
// кто нажимал /start в боте; кроме отключивших уведомления и заблокировавших бота. Не дошло — Telegram не разрешил
// боту писать этому человеку (не нажимал /start и не дал разрешение при входе в игру). Пауза 50 мс между сообщениями.
const botUsers = new Set(store.readJSON('botusers.json', []));
let botUsersTm = null;
const noteBotUser = (id) => { const k = String(id); if (botUsers.has(k)) return; botUsers.add(k); clearTimeout(botUsersTm); botUsersTm = setTimeout(() => store.writeJSON('botusers.json', [...botUsers]), 2000); };
admin.setBotcast((text, testOnly) => {
  if (!bot) return { error: 'Бот не запущен' };
  const adminsIds = String(process.env.ADMIN_TG_IDS || '').split(/[\s,]+/).filter(Boolean);
  let ids;
  if (testOnly) ids = adminsIds;
  else {
    const set = new Set(botUsers);
    for (const [uid, pr] of Object.entries(profiles)) if (uid.startsWith('tg')) set.add(uid.slice(2));
    ids = [...set].filter((id) => { const pr = profiles['tg' + id]; return !(pr && (pr.notifyOff || pr.pushBlocked)); });
  }
  const kb = process.env.WEBAPP_URL ? { reply_markup: { inline_keyboard: [[{ text: '⚔️ Играть', web_app: { url: process.env.WEBAPP_URL } }]] } } : {};
  const log = S.botcastLog = { at: Date.now(), text: text.slice(0, 80), test: !!testOnly, n: ids.length, ok: 0, fail: 0 };
  ids.forEach((id, i) => setTimeout(() => bot.telegram.sendMessage(id, text, kb)
    .then(() => { log.ok++; }, (e) => { log.fail++; const pr = profiles['tg' + id]; if (pr && e && (e.code === 403 || /blocked|deactivated/i.test(e.message || ''))) pr.pushBlocked = true; })
    .finally(() => { if (log.ok + log.fail === log.n) { admin.saveSettings(); saveProfiles(); } }), i * 50));
  admin.saveSettings();
  return { text: `${testOnly ? 'Пробная рассылка (только админам)' : 'Рассылка'} запущена: ${ids.length} получателей, займёт ~${Math.ceil(ids.length * 0.05)} с. Итог — в этом окне (обновите вкладку)` };
});
// Бэкап из админки — файлом администраторам в Telegram (на телефоне скачать иначе нельзя)
admin.setSendFile(async (buf, filename, caption) => {
  if (!bot) return 0;
  let n = 0;
  for (const id of String(process.env.ADMIN_TG_IDS || '').split(/[\s,]+/).filter(Boolean)) {
    try { await bot.telegram.sendDocument(id, { source: buf, filename }, { caption }); n++; } catch (e) { console.error('admin-alert: бэкап', id, e.message); }
  }
  return n;
});
// Новые ошибки сервера — администраторам (ADMIN_TG_IDS) в Telegram, не чаще раза в 10 минут
// loud — со звуком (заявки на вывод); ошибки сервера и прочее — беззвучно, чтобы не будить ночью
function adminAlert(text, loud) {
  if (!bot) { console.error('admin-alert: бот не запущен —', text.slice(0, 120)); return; }
  const ids = String(process.env.ADMIN_TG_IDS || '').split(/[\s,]+/).filter(Boolean);
  if (!ids.length) console.error('admin-alert: не задан ADMIN_TG_IDS —', text.slice(0, 120));
  // Связь с Telegram иногда рвётся — до 3 попыток (через 5 и 30 с), иначе в журнал «admin-alert»
  const send = (id, n) => bot.telegram.sendMessage(id, text.slice(0, 4000), { disable_notification: !loud })
    .catch((e) => (n < 3 ? setTimeout(() => send(id, n + 1), n === 1 ? 5e3 : 30e3) : console.error('admin-alert', id, e.message)));
  for (const id of ids) send(id, 1);
}
admin.setAlert(adminAlert);
// ---------- Наследие ЗБТ (переживает все обнуления, применяется при релизе) ----------
// pr.zbt = { lvl — лучший уровень за ЗБТ, choice — 'keep' (оставить вложения: ×1,5 самоцветами) | 'refund' (вернуть звёзды),
//            gifted — подарки уже выданы }. Звёзды считаются по истории оплат (она тоже переживает обнуление).
// Ветеран ЗБТ при релизе: рамка «Ветерана», титул и самоцветы по уровню: до 10 — 50, 10 — 100, 20 — 150, 30 — 250, 40 — 350, 50 — 500
const ZBT = { gemsPerStar: 330 / 50, keepK: 1.5, vet: [[50, 500], [40, 350], [30, 250], [20, 150], [10, 100], [0, 50]] };
const zbtStars = (pr) => (pr.payments || []).filter((x) => (x.cur || 'XTR') === 'XTR' && !x.refunded).reduce((a, x) => a + (Number(x.amount) || 0), 0);
const zbtLvl = (pr) => Math.max((pr.zbt && pr.zbt.lvl) || 0, (pr.acct && pr.acct.level) || 0, ...Object.values(pr.chars || {}).map((c) => c.level || 0));
const zbtVetGems = (lvl) => ZBT.vet.find(([l]) => lvl >= l)[1];
function zbtView(p) {
  const pr = getProfile(p.uid), z = pr.zbt || {}, stars = zbtStars(pr), lvl = zbtLvl(pr);
  return { stars, keepGems: Math.round(stars * ZBT.gemsPerStar * ZBT.keepK), lvl, vetGems: zbtVetGems(lvl), choice: z.choice || 'keep', released: !!S.zbtReleased, gifted: !!z.gifted };
}
function zbtAct(p, d) {
  if (d.op === 'zbtChoice') {
    if (S.zbtReleased) return { error: 'Релиз уже состоялся — выбор закрыт' };
    const pr = getProfile(p.uid); pr.zbt ??= {};
    if (!zbtStars(pr)) return { error: 'У вас нет покупок за звёзды' };
    pr.zbt.choice = d.choice === 'refund' ? 'refund' : 'keep'; saveProfiles();
    admin.log('zbt', `${p.uid} ${pr.zbt.choice === 'refund' ? 'просит вернуть' : 'оставляет'} вложения (${zbtStars(pr)} ⭐)`);
  }
  return zbtView(p);
}
// Подарки релиза одному профилю (после обнуления)
function zbtGift(np, z, stars) {
  if (z.gifted) return;
  z.gifted = true;
  const gems = zbtVetGems(z.lvl || 0) + (stars && z.choice !== 'refund' ? Math.round(stars * ZBT.gemsPerStar * ZBT.keepK) : 0);
  np.gems = (np.gems || 0) + gems;
  const C2 = (np.cosm ??= { owned: [] }); if (!C2.owned.includes('frame:veteran')) C2.owned.push('frame:veteran'); C2.frame = C2.frame || 'veteran';
  np.title = 'Ветеран ЗБТ';
  np.zbtGiftMsg = `🎖️ Ветеран ЗБТ: рамка, титул и ${gems} 💎${stars && z.choice !== 'refund' ? ` (из них ${Math.round(stars * ZBT.gemsPerStar * ZBT.keepK)} — за ваши вложения ×1,5)` : ''}. Спасибо, что были с нами!`;
}
// Обнуление перед стартом (админка → Настройки): удаляем всех, кроме keep
admin.setWipe((keep, opt = {}) => {
  for (const o of [...players.values()]) if (!keep.has(o.uid)) {
    o.socket.emit('kicked', 'Игровой мир обновлён — войдите заново');
    clearTimeout(o.graceTimer); removePlayerG(o); try { o.socket.disconnect(true); } catch {}
  }
  let nP = 0, nC = 0, nG = 0, nV = 0;
  if (opt.release) S.zbtReleased = Date.now(); // после релиза выбор «вернуть/оставить» закрыт
  // Деньги игроков не обнуляются: сначала снимаем заявки на покупку (GRAM — на балансы), раздаём казну владык
  // участникам кланов, затем при удалении профиля переносим GRAM-кошелёк (балансы, адрес, журнал, итоги) и историю оплат
  const lots = Trade.wipe(keep);
  for (const c of Object.values(clans)) if (c.reignPool > 0 && (c.members || []).length) {
    const each = Math.floor(c.reignPool / c.members.length);
    for (const u of c.members) Trade.grant(u, each, 'reign', `Казна владык [${c.tag}]: выплата перед обнулением игры`);
    c.reignPool = 0;
  }
  for (const uid of Object.keys(profiles)) if (!keep.has(uid)) {
    const old = profiles[uid], remind = old.remindOpen, gram = old.gram, pays = old.payments;
    const lvl = Math.max(old.wdLevel || 0, ...Object.values(old.chars || {}).map((c) => c.level || 0));
    // Наследие ЗБТ: лучший уровень за все обнуления, выбор по вложениям; при релизе — подарки
    const zbt = /^tg\d+$/.test(uid) && (old.zbt || lvl > 1 || zbtStars(old)) ? { ...(old.zbt || {}), lvl: zbtLvl(old) } : null;
    // Приглашения переживают обнуление: кто кого пригласил, список друзей, заработанное с них и источник визита.
    // Флаги «друг дошёл до 10/20 уровня» тоже — награда за одного друга не выдаётся дважды
    const REF_KEEP = ['refBy', 'refAt', 'refs', 'refN', 'refGram', 'refL10', 'refL20', 'tgInfo'];
    const ref = Object.fromEntries(REF_KEEP.filter((k) => old[k] !== undefined).map((k) => [k, old[k]]));
    delete profiles[uid]; nP++;
    const np = (remind || gram || pays || zbt || Object.keys(ref).length) ? getProfile(uid) : null;
    if (zbt) { np.zbt = zbt; if (opt.release) { zbtGift(np, zbt, zbtStars(old)); nV++; } }
    if (np) Object.assign(np, ref);
    if (remind) np.remindOpen = true; // подписку «Напомнить об открытии» сохраняем — это не прогресс
    // GRAM-кошелёк; дата регистрации и достигнутый уровень — чтобы условия вывода (30 ур., 7 дней) не «сбросились» вайпом
    if (gram) { np.gram = gram; np.created = old.created || np.created; if (lvl >= 30) np.wdLevel = lvl; nG++; }
    if (pays) np.payments = pays; // для возвратов и проверки оплат после обнуления
  }
  for (const [id, c] of Object.entries(clans)) {
    c.members = c.members.filter((u) => keep.has(u));
    if (!c.members.length) { delete clans[id]; nC++; continue; }
    if (!c.system && !keep.has(c.leader)) c.leader = c.members[0];
  }
  saveProfiles(); saveClans(); Ranks.reset();
  if (opt.release) admin.saveSettings();
  return { players: nP, clans: nC, lots, gram: nG, vets: nV };
});

if (!store.db) process.on('SIGINT', () => { saveProfiles(); process.exit(0); });
// Остановка сервера: server/boot.js вызывает это, дописывает всё в хранилище (базу) и только потом выходит
global.__saveAll = () => { saveProfiles(); try { store.writeJSON('clans.json', clans); store.writeJSON('chat.json', chatHistory); } catch (e) { console.error('clans/chat save', e.message); } };
if (!store.db) process.on('SIGTERM', () => { saveProfiles(); process.exit(0); }); // запуск без boot.js (старый способ) — как раньше
