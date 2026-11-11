// Хранилище сохранений.
//
// С базой (задана переменная DATABASE_URL — Postgres на Railway): все данные в базе. Игроки — по строке на игрока
// (сохраняются только изменившиеся), остальное (рынок, кланы, турнир, настройки…) — документами. Данные держатся в памяти,
// запись в базу — пачками раз в ~1,5 с и обязательно при остановке сервера (деплой). Первый запуск с базой сам переносит
// туда прежние JSON-файлы с диска. Файлы-бэкапы на Volume (если он подключён) продолжают делаться по расписанию.
//
// Без базы: JSON-файлы в папке данных + автоматические бэкапы (как раньше).
//
// Где лежат данные (по приоритету):
//   DATA_DIR                    — явно заданная папка;
//   RAILWAY_VOLUME_MOUNT_PATH   — постоянный диск (Volume) Railway, переменную Railway ставит сам;
//   ./data                      — рядом с проектом (локальная разработка).
// Без постоянного диска Railway стирает файлы при каждом деплое — сервер предупредит об этом в логах и в админке.
//
// Запись атомарная: сначала во временный файл, затем переименование — при падении сервера посреди записи
// остаётся прежний целый файл, а не обрывок. Если файл всё же не читается, данные поднимаются из последнего бэкапа,
// а испорченный файл откладывается в сторону (не затирается).
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'data'));
const BACKUP_DIR = path.join(DIR, 'backups');
const ON_RAILWAY = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
// На Railway данные переживают деплой только на Volume (или в явно заданной папке)
const PERSISTENT_DISK = !ON_RAILWAY || !!(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH);
const PERSISTENT = PERSISTENT_DISK || !!(process.env.DATABASE_URL || '').trim(); // с базой данные переживают деплой и без диска
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 48); // сколько бэкапов каждого файла хранить
const EVERY_MS = Math.max(5, Number(process.env.BACKUP_EVERY_MIN) || 60) * 60000;

const file = (name) => path.join(DIR, name);
const base = (name) => name.replace(/\.json$/, '');
let lastBackup = null;

// ---------- Postgres ----------
const DB_URL = (process.env.DATABASE_URL || '').trim();
let pool = null, flushTm = null, flushing = null;
const mem = new Map(), dirty = new Set(), saved = new Map(); // документы в памяти; что записать; что уже лежит в базе (игроки)
const dbStat = { lastFlush: 0, lastError: null, players: 0, flushMs: 0 };
const DOCS_TEXT = new Set(['admin_password.txt']);

async function init() {
  if (!DB_URL) return false;
  const { Pool } = require('pg');
  const ssl = /sslmode=require|\.proxy\.rlwy\.net|amazonaws|supabase|neon\.tech/.test(DB_URL) || process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false;
  pool = new Pool({ connectionString: DB_URL, ssl, max: 5 });
  pool.on('error', (e) => console.error('[db] соединение', e.message));
  // База может подняться позже сервера (деплой) — ждём до 60 с
  for (let i = 0; ; i++) {
    try { await pool.query('SELECT 1'); break; } catch (e) {
      if (i >= 12) throw new Error('[db] база недоступна: ' + e.message);
      console.warn('[db] жду базу…', e.message); await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS docs (name text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS players (uid text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());`);
  const docs = await pool.query('SELECT name, data FROM docs');
  const pl = await pool.query('SELECT uid, data FROM players');
  if (!docs.rows.length && !pl.rows.length) {
    // Первый запуск с базой: переносим всё, что было в файлах
    let n = 0;
    for (const name of fs.existsSync(DIR) ? fs.readdirSync(DIR) : []) {
      if (!/\.json$/.test(name) && !DOCS_TEXT.has(name)) continue;
      const v = DOCS_TEXT.has(name) ? readText(name) : readFileJSON(name, undefined);
      if (v === undefined || v === null) continue;
      mem.set(name, v); dirty.add(name); n++;
    }
    if (n) { console.log(`[db] перенос из файлов в базу: ${n} файлов, игроков ${Object.keys(mem.get('players.json') || {}).length}`); await flushNow(); }
  } else {
    for (const r of docs.rows) mem.set(r.name, DOCS_TEXT.has(r.name) ? r.data.text : r.data);
    const players = {};
    for (const r of pl.rows) { players[r.uid] = r.data; saved.set(r.uid, JSON.stringify(r.data)); }
    mem.set('players.json', players);
  }
  dbStat.players = Object.keys(mem.get('players.json') || {}).length;
  console.log(`[db] Postgres подключён: игроков ${dbStat.players}, документов ${mem.size - 1}`);
  return true;
}
// Записать в базу всё, что изменилось (all — проверить все документы, например перед остановкой)
async function flushNow(all = false) {
  if (!pool) return;
  if (flushing) { await flushing; if (!all && !dirty.size) return; }
  if (all) for (const k of mem.keys()) dirty.add(k);
  const names = [...dirty]; dirty.clear();
  const t0 = Date.now();
  flushing = (async () => {
    for (const name of names) {
      try {
        if (name === 'players.json') await flushPlayers(mem.get(name) || {});
        else {
          const v = mem.get(name);
          await pool.query('INSERT INTO docs (name, data, updated_at) VALUES ($1, $2, now()) ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = now()',
            [name, JSON.stringify(DOCS_TEXT.has(name) ? { text: v } : v)]);
        }
      } catch (e) { dirty.add(name); dbStat.lastError = `${new Date().toISOString()} ${e.message}`; console.error('[db] запись', name, e.message); }
    }
  })();
  await flushing; flushing = null;
  dbStat.lastFlush = Date.now(); dbStat.flushMs = Date.now() - t0;
  if (dirty.size) schedule(5000); // ошибка — повторим позже
}
// Игроки: только изменившиеся строки (сравниваем с тем, что уже лежит в базе), удалённые — удаляем
async function flushPlayers(players) {
  const uids = [], datas = [];
  for (const [uid, pr] of Object.entries(players)) {
    const j = JSON.stringify(pr);
    if (saved.get(uid) !== j) { uids.push(uid); datas.push(j); }
  }
  for (let i = 0; i < uids.length; i += 500) {
    const u = uids.slice(i, i + 500), d = datas.slice(i, i + 500);
    await pool.query(`INSERT INTO players (uid, data, updated_at) SELECT t.uid, t.data, now() FROM unnest($1::text[], $2::jsonb[]) AS t(uid, data)
      ON CONFLICT (uid) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [u, d]);
    u.forEach((uid, k) => saved.set(uid, d[k]));
  }
  const gone = [...saved.keys()].filter((uid) => !(uid in players));
  if (gone.length) { await pool.query('DELETE FROM players WHERE uid = ANY($1::text[])', [gone]); gone.forEach((u) => saved.delete(u)); }
  dbStat.players = Object.keys(players).length;
}
function schedule(ms = 1500) { if (!flushTm) flushTm = setTimeout(() => { flushTm = null; flushNow().catch((e) => console.error('[db]', e.message)); }, ms); }

function readFileJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}

function writeJSON(name, obj) {
  if (pool) { mem.set(name, obj); dirty.add(name); schedule(); return; }
  fs.mkdirSync(DIR, { recursive: true });
  const f = file(name), tmp = f + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, JSON.stringify(obj)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, f);
}

function writeText(name, text) {
  if (pool) { mem.set(name, text); dirty.add(name); schedule(); return; }
  fs.mkdirSync(DIR, { recursive: true });
  const f = file(name);
  fs.writeFileSync(f + '.tmp', text);
  fs.renameSync(f + '.tmp', f);
}

function readText(name) {
  if (pool && mem.has(name)) return mem.get(name);
  try { return fs.readFileSync(file(name), 'utf8'); } catch { return null; }
}

// Бэкапы файла name, от новых к старым
function backupsOf(name) {
  try {
    const pre = base(name) + '-';
    return fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(pre) && f.endsWith('.json')).sort().reverse();
  } catch { return []; }
}

// Прочитать JSON. Нет файла или он испорчен — берём самый свежий читаемый бэкап; совсем ничего — fallback.
function readJSON(name, fallback) {
  if (pool) return mem.has(name) ? mem.get(name) : fallback;
  const f = file(name);
  if (fs.existsSync(f)) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {
      const bad = `${f}.corrupt-${Date.now()}`;
      try { fs.renameSync(f, bad); } catch { /* оставим как есть */ }
      console.error(`[store] ${name} не читается (${e.message}) — отложен в ${path.basename(bad)}, ищу бэкап`);
    }
  }
  for (const b of backupsOf(name)) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, b), 'utf8'));
      console.warn(`[store] ${name} восстановлен из бэкапа ${b}`);
      return data;
    } catch { /* этот бэкап тоже испорчен — пробуем старше */ }
  }
  return fallback;
}

const stamp = () => new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-'); // 2026-11-04_12-00

// Скопировать текущие файлы в backups/ и удалить лишние старые
function backup(names) {
  if (pool && !PERSISTENT_DISK) return; // с базой и без постоянного диска файлы-бэкапы бессмысленны (бэкапы делает сама база)
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const t = stamp();
  if (pool) for (const name of names) if (mem.has(name)) { try { fs.writeFileSync(file(name), JSON.stringify(mem.get(name))); } catch { /* диск недоступен */ } } // снимок базы — в файл для бэкапа
  for (const name of names) {
    if (!fs.existsSync(file(name))) continue;
    try {
      fs.copyFileSync(file(name), path.join(BACKUP_DIR, `${base(name)}-${t}.json`));
      for (const old of backupsOf(name).slice(KEEP)) fs.unlinkSync(path.join(BACKUP_DIR, old));
    } catch (e) { console.error('[store] бэкап', name, e.message); }
  }
  lastBackup = Date.now();
}

// Бэкап при запуске и затем по расписанию; beforeEach — сохранить свежие данные перед копированием
function startBackups(names, beforeEach) {
  const run = () => { try { if (beforeEach) beforeEach(); } catch (e) { console.error('[store]', e.message); } backup(names); };
  setTimeout(run, 30000); // через полминуты после старта — когда всё загружено
  setInterval(run, EVERY_MS).unref();
}

function info() {
  if (pool) return { db: true, persistent: true, onRailway: ON_RAILWAY, players: dbStat.players, lastFlush: dbStat.lastFlush, flushMs: dbStat.flushMs, lastError: dbStat.lastError, dir: DIR, backups: backupsOf('players.json').length, keep: KEEP, everyMin: EVERY_MS / 60000, lastBackup };
  let sizeKb = 0;
  try { sizeKb = Math.round(fs.statSync(file('players.json')).size / 1024); } catch { /* нет файла */ }
  return { dbUrlSet: !!DB_URL, dir: DIR, persistent: PERSISTENT, onRailway: ON_RAILWAY, sizeKb, backups: backupsOf('players.json').length, keep: KEEP, everyMin: EVERY_MS / 60000, lastBackup };
}

if (!PERSISTENT) {
  console.warn('\n⚠️  [store] Railway без постоянного диска: сохранения игроков СОТРУТСЯ при следующем деплое!\n' +
    '   Подключите Volume к сервису (Settings → Volumes, путь /app/data) — см. README, раздел «Сохранения».\n');
} else console.log(`[store] данные: ${DIR}`);

module.exports = { DIR, get PERSISTENT() { return PERSISTENT; }, file, readJSON, writeJSON, readText, writeText, backup, startBackups, info, init, flushNow, get db() { return !!pool; } };
