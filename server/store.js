// Хранилище сохранений: JSON-файлы в папке данных + автоматические бэкапы.
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
const PERSISTENT = !ON_RAILWAY || !!(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH);
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 48); // сколько бэкапов каждого файла хранить
const EVERY_MS = Math.max(5, Number(process.env.BACKUP_EVERY_MIN) || 60) * 60000;

const file = (name) => path.join(DIR, name);
const base = (name) => name.replace(/\.json$/, '');
let lastBackup = null;

function writeJSON(name, obj) {
  fs.mkdirSync(DIR, { recursive: true });
  const f = file(name), tmp = f + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, JSON.stringify(obj)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, f);
}

function writeText(name, text) {
  fs.mkdirSync(DIR, { recursive: true });
  const f = file(name);
  fs.writeFileSync(f + '.tmp', text);
  fs.renameSync(f + '.tmp', f);
}

function readText(name) {
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
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const t = stamp();
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
  let sizeKb = 0;
  try { sizeKb = Math.round(fs.statSync(file('players.json')).size / 1024); } catch { /* нет файла */ }
  return { dir: DIR, persistent: PERSISTENT, onRailway: ON_RAILWAY, sizeKb, backups: backupsOf('players.json').length, keep: KEEP, everyMin: EVERY_MS / 60000, lastBackup };
}

if (!PERSISTENT) {
  console.warn('\n⚠️  [store] Railway без постоянного диска: сохранения игроков СОТРУТСЯ при следующем деплое!\n' +
    '   Подключите Volume к сервису (Settings → Volumes, путь /app/data) — см. README, раздел «Сохранения».\n');
} else console.log(`[store] данные: ${DIR}`);

module.exports = { DIR, PERSISTENT, file, readJSON, writeJSON, readText, writeText, backup, startBackups, info };
