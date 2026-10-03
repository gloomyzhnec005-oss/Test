require('dotenv').config();
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const C = require('./config');
const { generateMap, SOLID } = require('./world');
const { verifyInitData } = require('./auth');

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ALLOW_GUESTS = process.env.ALLOW_GUESTS !== 'false';
const DATA_FILE = path.join(__dirname, '..', 'data', 'players.json');

// ---------- Хранилище прогресса (JSON-файл) ----------
let profiles = {};
try { profiles = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { profiles = {}; }
function saveProfiles() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(profiles)); } catch (e) { console.error('save error', e.message); }
}
setInterval(saveProfiles, 15000);

function getChar(uid, cls) {
  profiles[uid] ??= { chars: {} };
  profiles[uid].chars[cls] ??= { level: 1, xp: 0, kills: 0, gold: 0 };
  return profiles[uid].chars[cls];
}

// ---------- HTTP ----------
const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/vendor/phaser.min.js', (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'node_modules', 'phaser', 'dist', 'phaser.min.js')));
app.use(express.json({ limit: '16kb' }));
// Профиль игрока для лобби: уровень и прогресс каждого героя
app.post('/api/profile', (req, res) => {
  const { initData, guestId } = req.body || {};
  const uid = resolveUid(initData, guestId);
  if (!uid) return res.status(403).json({ error: 'Откройте игру через Telegram-бота' });
  const chars = {};
  for (const cls of Object.keys(C.CLASSES)) {
    const ch = profiles[uid.uid]?.chars?.[cls] || { level: 1, xp: 0, kills: 0, gold: 0 };
    chars[cls] = { ...ch, xpNext: xpForLevel(ch.level), ...statsFor(cls, ch.level),
      resMax: Math.round(C.CLASSES[cls].resource.max * (1 + 0.05 * (ch.level - 1))) };
  }
  const bgs = C.LOBBY_BACKGROUNDS.filter((b) => b.price === 0 || profiles[uid.uid]?.bgs?.includes(b.id)).map((b) => b.id);
  res.json({ name: uid.name, chars, bgs });
});
app.get('/api/config', (req, res) => res.json({ classes: C.CLASSES, monsters: C.MONSTERS, backgrounds: C.LOBBY_BACKGROUNDS }));

// Покупка платного фона лобби за Telegram Stars
let bot = null;
app.post('/api/invoice', async (req, res) => {
  const { initData, bgId } = req.body || {};
  const who = resolveUid(initData, null);
  const bg = C.LOBBY_BACKGROUNDS.find((b) => b.id === bgId && b.price > 0);
  if (!who || !who.tg) return res.status(403).json({ error: 'Покупки доступны только в Telegram' });
  if (!bg) return res.status(400).json({ error: 'Неизвестный фон' });
  if (!bot) return res.status(503).json({ error: 'Оплата временно недоступна' });
  try {
    const link = await bot.telegram.createInvoiceLink({
      title: `Фон лобби «${bg.name}»`,
      description: 'Новый фон для лобби выбора героя',
      payload: `bg:${who.uid}:${bg.id}`,
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: bg.name, amount: bg.price }],
    });
    res.json({ link });
  } catch (e) {
    console.error('createInvoiceLink:', e.message);
    res.status(500).json({ error: 'Не удалось создать счёт' });
  }
});

// Вызывается ботом после успешной оплаты
function onPaid(payload) {
  const [kind, uid, id] = String(payload).split(':');
  if (kind !== 'bg' || !uid || !C.LOBBY_BACKGROUNDS.some((b) => b.id === id)) return false;
  profiles[uid] ??= { chars: {} };
  profiles[uid].bgs ??= [];
  if (!profiles[uid].bgs.includes(id)) profiles[uid].bgs.push(id);
  saveProfiles();
  return true;
}
function isValidPayload(payload) {
  const [kind, uid, id] = String(payload).split(':');
  return kind === 'bg' && !!uid && C.LOBBY_BACKGROUNDS.some((b) => b.id === id && b.price > 0);
}
app.get('/health', (req, res) => res.json({ ok: true, players: players.size }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------- Мир ----------
const world = generateMap(Number(process.env.WORLD_SEED) || 1337);
const players = new Map(); // socket.id -> player
const monsters = new Map(); // id -> monster
let monsterSeq = 1;
let fx = []; // события за тик (удары, снаряды, смерти)

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
const statsFor = (cls, lvl) => {
  const b = C.CLASSES[cls];
  return { maxHp: Math.round(b.hp * (1 + 0.12 * (lvl - 1))), dmg: Math.round(b.dmg * (1 + 0.1 * (lvl - 1))) };
};

function randomFreeSpot(minR, maxR) {
  const cx = world.width / 2, cy = world.height / 2;
  for (let i = 0; i < 200; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = minR + Math.random() * (maxR - minR);
    const tx = Math.floor(cx + Math.cos(a) * r), ty = Math.floor(cy + Math.sin(a) * r);
    if (!world.isSolidTile(tx, ty)) return { x: (tx + 0.5) * C.TILE, y: (ty + 0.5) * C.TILE };
  }
  return { ...world.spawn };
}

function pickMonsterType() {
  const roll = Math.random();
  if (roll < 0.03) return 'dragon';
  if (roll < 0.18) return 'orc';
  if (roll < 0.40) return 'skeleton';
  if (roll < 0.68) return 'wolf';
  return 'slime';
}

function spawnMonster(type = pickMonsterType()) {
  const def = C.MONSTERS[type];
  const maxR = Math.min(world.width, world.height) / 2 - 2;
  const p = randomFreeSpot(def.zone, Math.min(maxR, def.zone + 12));
  const m = {
    id: monsterSeq++, type, x: p.x, y: p.y, homeX: p.x, homeY: p.y,
    hp: def.hp, maxHp: def.hp, target: null, lastAttack: 0,
    wander: null, nextWander: 0,
  };
  monsters.set(m.id, m);
  return m;
}
for (let i = 0; i < C.MONSTER_COUNT; i++) spawnMonster();

function moveEntity(e, dx, dy) {
  const r = 10;
  const nx = e.x + dx, ny = e.y + dy;
  if (!world.isSolidAt(nx + Math.sign(dx) * r, e.y)) e.x = nx;
  if (!world.isSolidAt(e.x, ny + Math.sign(dy) * r)) e.y = ny;
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, cls: p.cls, x: Math.round(p.x), y: Math.round(p.y), dir: p.dir,
    hp: p.hp, maxHp: p.maxHp, lvl: p.char.level, dead: p.dead };
}
function privateStats(p) {
  return { level: p.char.level, xp: p.char.xp, xpNext: xpForLevel(p.char.level), kills: p.char.kills,
    gold: p.char.gold, hp: Math.ceil(p.hp), maxHp: p.maxHp, dmg: p.dmg };
}

function grantXp(p, amount, gold) {
  p.char.xp += amount;
  p.char.gold += gold;
  p.char.kills += 1;
  let leveled = false;
  while (p.char.xp >= xpForLevel(p.char.level)) {
    p.char.xp -= xpForLevel(p.char.level);
    p.char.level += 1;
    leveled = true;
  }
  if (leveled) {
    Object.assign(p, statsFor(p.cls, p.char.level));
    p.hp = p.maxHp;
    fx.push({ t: 'levelup', id: p.id, x: p.x, y: p.y, lvl: p.char.level });
    io.emit('chat', { sys: true, text: `${p.name} достиг ${p.char.level} уровня!` });
  }
  p.socket.emit('stats', privateStats(p));
}

// ---------- Сокеты ----------
io.on('connection', (socket) => {
  socket.on('join', (data = {}) => {
    if (players.has(socket.id)) return;
    const cls = C.CLASSES[data.cls] ? data.cls : 'warrior';
    const who = resolveUid(data.initData, data.guestId || socket.id);
    if (!who) {
      socket.emit('error_msg', 'Откройте игру через Telegram-бота');
      return;
    }
    const uid = who.uid;
    const name = who.tg ? who.name : (String(data.guestName || '').trim().slice(0, 16) || 'Гость');
    const char = getChar(uid, cls);
    const p = {
      id: socket.id, uid, name: name.slice(0, 20), cls, char, socket,
      x: world.spawn.x + (Math.random() - 0.5) * 64, y: world.spawn.y + (Math.random() - 0.5) * 64,
      dir: 1, dead: false, lastAttack: 0, lastHurt: 0, lastMove: Date.now(),
      ...statsFor(cls, char.level),
    };
    p.hp = p.maxHp;
    players.set(socket.id, p);

    socket.emit('welcome', {
      id: socket.id,
      tile: C.TILE,
      map: { w: world.width, h: world.height, tiles: world.tiles, solid: SOLID },
      classes: C.CLASSES,
      monsters: C.MONSTERS,
      stats: privateStats(p),
    });
    io.emit('chat', { sys: true, text: `${p.name} (${C.CLASSES[cls].name}) вошёл в мир` });
  });

  socket.on('move', (d) => {
    const p = players.get(socket.id);
    if (!p || p.dead || !d) return;
    const now = Date.now();
    const dt = Math.min(0.5, (now - p.lastMove) / 1000);
    p.lastMove = now;
    const x = Number(d.x), y = Number(d.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const maxDist = C.CLASSES[p.cls].speed * dt * 1.6 + 12; // античит: ограничение скорости
    const dist = Math.hypot(x - p.x, y - p.y);
    if (dist > maxDist || world.isSolidAt(x, y)) {
      socket.emit('correct', { x: p.x, y: p.y });
      return;
    }
    p.x = x; p.y = y;
    if (d.dir === -1 || d.dir === 1) p.dir = d.dir;
  });

  socket.on('attack', (d) => {
    const p = players.get(socket.id);
    if (!p || p.dead || !d) return;
    const now = Date.now();
    const cls = C.CLASSES[p.cls];
    if (now - p.lastAttack < cls.cooldown * 0.9) return;
    const m = monsters.get(d.targetId);
    if (!m || m.hp <= 0) return;
    if (Math.hypot(m.x - p.x, m.y - p.y) > cls.range + 20) return;
    p.lastAttack = now;
    p.dir = m.x < p.x ? -1 : 1;

    const crit = Math.random() < 0.15;
    const dmg = Math.round(p.dmg * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1));
    m.hp -= dmg;
    m.target = p.id;
    fx.push({ t: 'hit', kind: 'm', target: m.id, dmg, crit, from: p.id, proj: cls.projectile,
      fx: p.x, fy: p.y, tx: m.x, ty: m.y });

    if (m.hp <= 0) {
      const def = C.MONSTERS[m.type];
      const gold = Math.round(def.xp / 3 * (0.5 + Math.random()));
      fx.push({ t: 'death', target: m.id, x: m.x, y: m.y, xp: def.xp, gold, by: p.id });
      monsters.delete(m.id);
      grantXp(p, def.xp, gold);
      if (def.boss) io.emit('chat', { sys: true, text: `${p.name} победил босса «${def.name}»!` });
      setTimeout(() => spawnMonster(), C.MONSTER_RESPAWN_MS);
    }
  });

  socket.on('chat', (text) => {
    const p = players.get(socket.id);
    if (!p || typeof text !== 'string') return;
    const clean = text.trim().slice(0, 120);
    if (clean) io.emit('chat', { name: p.name, text: clean });
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.id);
    if (!p) return;
    players.delete(socket.id);
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

  // ИИ монстров
  for (const m of monsters.values()) {
    const def = C.MONSTERS[m.type];
    let target = m.target ? players.get(m.target) : null;
    if (target && (target.dead || Math.hypot(target.x - m.x, target.y - m.y) > def.aggro * 1.8)) target = null;
    if (!target) {
      let best = null, bestD = def.aggro;
      for (const p of players.values()) {
        if (p.dead) continue;
        const d = Math.hypot(p.x - m.x, p.y - m.y);
        if (d < bestD) { best = p; bestD = d; }
      }
      target = best;
    }
    m.target = target ? target.id : null;

    if (target) {
      const dx = target.x - m.x, dy = target.y - m.y;
      const d = Math.hypot(dx, dy);
      if (d > C.MONSTER_ATTACK_RANGE) {
        const s = def.speed * dt;
        moveEntity(m, (dx / d) * s, (dy / d) * s);
      } else if (now - m.lastAttack > C.MONSTER_ATTACK_CD) {
        m.lastAttack = now;
        const dmg = Math.round(def.dmg * (0.8 + Math.random() * 0.4));
        target.hp -= dmg;
        target.lastHurt = now;
        fx.push({ t: 'hit', kind: 'p', target: target.id, dmg, from: m.id });
        if (target.hp <= 0) {
          target.hp = 0;
          target.dead = true;
          m.target = null;
          fx.push({ t: 'pdeath', target: target.id });
          const victim = target;
          setTimeout(() => {
            if (!players.has(victim.id)) return;
            victim.dead = false;
            victim.hp = victim.maxHp;
            victim.x = world.spawn.x; victim.y = world.spawn.y;
            victim.socket.emit('correct', { x: victim.x, y: victim.y, respawn: true });
          }, 4000);
        }
        target.socket.emit('stats', privateStats(target));
      }
    } else {
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
          const s = def.speed * 0.4 * dt;
          moveEntity(m, (dx / d) * s, (dy / d) * s);
        }
      }
      if (m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.05 * dt);
    }
  }

  // Регенерация игроков вне боя
  for (const p of players.values()) {
    if (!p.dead && p.hp < p.maxHp && now - p.lastHurt > 5000) {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.04 * dt);
      if (Math.ceil(before) !== Math.ceil(p.hp)) p.socket.emit('stats', privateStats(p));
    }
  }

  // Рассылка состояния
  const state = {
    p: [...players.values()].map(publicPlayer).map((p) => ({ ...p, hp: Math.ceil(p.hp) })),
    m: [...monsters.values()].map((m) => ({ id: m.id, type: m.type, x: Math.round(m.x), y: Math.round(m.y),
      hp: Math.ceil(m.hp), maxHp: m.maxHp })),
    fx,
  };
  io.emit('state', state);
  fx = [];
}, C.TICK_MS);

server.listen(PORT, () => {
  console.log(`MMORPG сервер запущен: http://localhost:${PORT}`);
  if (BOT_TOKEN && process.env.RUN_BOT !== 'false') bot = require('../bot/bot')({ onPaid, isValidPayload });
});

process.on('SIGINT', () => { saveProfiles(); process.exit(0); });
process.on('SIGTERM', () => { saveProfiles(); process.exit(0); });
