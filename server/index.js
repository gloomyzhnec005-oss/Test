require('dotenv').config();
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const C = require('./config');
const { generateMap, SOLID } = require('./world');
const { verifyInitData } = require('./auth');
const { SKILLS, PASSIVES, NEEDS_TARGET, skillRange } = require('./skills');
const { createPets, createSummon, rescalePets, updatePets, hurtPet } = require('./pets');

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ALLOW_GUESTS = process.env.ALLOW_GUESTS !== 'false';
const FREE_SPINS = process.env.FREE_SPINS === 'true'; // для тестов: крутки гачи без оплаты
const DATA_FILE = path.join(__dirname, '..', 'data', 'players.json');

// ---------- Хранилище прогресса (JSON-файл) ----------
let profiles = {};
try { profiles = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { profiles = {}; }
function saveProfiles() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(profiles)); } catch (e) { console.error('save error', e.message); }
}
setInterval(saveProfiles, 15000);

function getProfile(uid) {
  profiles[uid] ??= {};
  const pr = profiles[uid];
  pr.chars ??= {};
  pr.heroes ??= [];
  pr.bgs ??= [];
  pr.paidSpins ??= 0;
  pr.freeSpinUsed ??= false;
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
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/vendor/phaser.min.js', (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'node_modules', 'phaser', 'dist', 'phaser.min.js')));
app.use(express.json({ limit: '16kb' }));
// Профиль игрока для лобби: полученные герои, их прогресс, крутки гачи, фоны
function profileView(who) {
  const pr = getProfile(who.uid);
  const chars = {};
  for (const id of pr.heroes) {
    const ch = getChar(who.uid, id);
    chars[id] = { ...ch, xpNext: xpForLevel(ch.level), ...statsFor(id, ch.level) };
  }
  const bgs = C.LOBBY_BACKGROUNDS.filter((b) => b.price === 0 || pr.bgs.includes(b.id)).map((b) => b.id);
  return {
    name: who.name, heroes: pr.heroes, chars, bgs,
    freeSpin: !pr.freeSpinUsed || FREE_SPINS, paidSpins: pr.paidSpins, spinPrice: C.GACHA.spinPrice,
  };
}
app.post('/api/profile', (req, res) => {
  const { initData, guestId } = req.body || {};
  const who = resolveUid(initData, guestId);
  if (!who) return res.status(403).json({ error: 'Откройте игру через Telegram-бота' });
  res.json(profileView(who));
});

// Гача: выдаёт случайного ещё не полученного героя с учётом редкости
app.post('/api/gacha/spin', (req, res) => {
  const { initData, guestId } = req.body || {};
  const who = resolveUid(initData, guestId);
  if (!who) return res.status(403).json({ error: 'Откройте игру через Telegram-бота' });
  const pr = getProfile(who.uid);
  const pool = Object.keys(C.HEROES).filter((id) => !pr.heroes.includes(id));
  if (!pool.length) return res.status(400).json({ error: 'Все герои уже получены' });
  if (FREE_SPINS || !pr.freeSpinUsed) pr.freeSpinUsed = true;
  else if (pr.paidSpins > 0) pr.paidSpins -= 1;
  else return res.status(402).json({ error: 'Нет круток', needPayment: true });

  const weight = (id) => C.RARITIES[C.HEROES[id].rarity].weight;
  let roll = Math.random() * pool.reduce((sum, id) => sum + weight(id), 0);
  let hero = pool[pool.length - 1];
  for (const id of pool) { roll -= weight(id); if (roll < 0) { hero = id; break; } }
  pr.heroes.push(hero);
  getChar(who.uid, hero);
  saveProfiles();
  res.json({ hero, profile: profileView(who) });
});
app.get('/api/config', (req, res) => res.json({
  heroes: C.HEROES, rarities: C.RARITIES, monsters: C.MONSTERS, backgrounds: C.LOBBY_BACKGROUNDS, gacha: C.GACHA,
}));

// Покупки за Telegram Stars: фон лобби (item=bg) или крутка гачи (item=spin)
let bot = null;
app.post('/api/invoice', async (req, res) => {
  const { initData, item, bgId } = req.body || {};
  const who = resolveUid(initData, null);
  if (!who || !who.tg) return res.status(403).json({ error: 'Покупки доступны только в Telegram' });
  if (!bot) return res.status(503).json({ error: 'Оплата временно недоступна' });
  let invoice;
  if (item === 'spin') {
    invoice = { title: 'Крутка призыва героя', description: 'Призыв случайного нового героя', payload: `spin:${who.uid}`,
      prices: [{ label: 'Крутка', amount: C.GACHA.spinPrice }] };
  } else {
    const bg = C.LOBBY_BACKGROUNDS.find((b) => b.id === bgId && b.price > 0);
    if (!bg) return res.status(400).json({ error: 'Неизвестный фон' });
    invoice = { title: `Фон лобби «${bg.name}»`, description: 'Новый фон для лобби выбора героя',
      payload: `bg:${who.uid}:${bg.id}`, prices: [{ label: bg.name, amount: bg.price }] };
  }
  try {
    const link = await bot.telegram.createInvoiceLink({ ...invoice, provider_token: '', currency: 'XTR' });
    res.json({ link });
  } catch (e) {
    console.error('createInvoiceLink:', e.message);
    res.status(500).json({ error: 'Не удалось создать счёт' });
  }
});

// Проверка и зачисление оплаты (вызывается ботом)
function isValidPayload(payload) {
  const [kind, uid, id] = String(payload).split(':');
  if (!uid) return false;
  if (kind === 'spin') return true;
  return kind === 'bg' && C.LOBBY_BACKGROUNDS.some((b) => b.id === id && b.price > 0);
}
function onPaid(payload) {
  if (!isValidPayload(payload)) return false;
  const [kind, uid, id] = String(payload).split(':');
  const pr = getProfile(uid);
  if (kind === 'spin') pr.paidSpins += 1;
  else if (!pr.bgs.includes(id)) pr.bgs.push(id);
  saveProfiles();
  return true;
}
app.get('/health', (req, res) => res.json({ ok: true, players: players.size }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------- Мир ----------
const world = generateMap(Number(process.env.WORLD_SEED) || 1337);
const players = new Map(); // socket.id -> player
const monsters = new Map(); // id -> monster
const pets = new Map(); // id -> зверь-спутник (Урсус)
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
const statsFor = (heroId, lvl) => {
  const b = C.HEROES[heroId];
  return {
    maxHp: Math.round(b.hp * (1 + 0.12 * (lvl - 1))),
    dmg: Math.round(b.dmg * (1 + 0.1 * (lvl - 1))),
    resMax: Math.round(b.resource.max * (1 + 0.05 * (lvl - 1))),
  };
};
// Усиления урона и скорости атаки: временные эффекты навыков и пассивные навыки
const startRes = (p) => (p.hero.resource.start ?? 1) * p.resMax;
// Текущий облик героя (Талиесин): свои дальность, скорость атаки, бег и снаряд
// Аурелиус: стихия меняет только снаряд обычной атаки
const formOf = (p) => (p.hero.forms ? p.hero.forms[p.form || 'human']
  : p.hero.elements ? { ...p.hero, projectile: p.hero.elements[p.form || 'fire'].projectile } : p.hero);
const passiveOf = (p) => (p.hero.passive ? PASSIVES[p.hero.passive.id] : null);
const dmgMult = (p, now = Date.now()) => {
  const ps = passiveOf(p);
  return (p.roarUntil > now ? 1.4 : 1) * (p.frenzyUntil > now ? 1.5 : 1) * (p.linkUntil > now ? 1.3 : 1)
    * (p.pactUntil > now && p.pactType === 'fury' ? 1.5 : 1) * (p.blessUntil > now ? 1.2 : 1)
    * (p.songUntil > now ? 1 + 0.15 * (p.songPw || 1) : 1) // песнь вдохновения Джакомо
    * (p.cryUntil > now ? 1.2 : 1) // клич валькирии
    * (ps && ps.dmgMult ? ps.dmgMult(p) : 1);
};
const attackCd = (p, now = Date.now()) => {
  const ps = passiveOf(p);
  const speed = (p.frenzyUntil > now ? 1.5 : 1) * (p.pactUntil > now && p.pactType === 'wind' ? 1.4 : 1) * (p.blessUntil > now ? 1.2 : 1) * (p.songUntil > now ? 1 + 0.1 * (p.songPw || 1) : 1) * (p.hasteUntil > now ? 1.25 : 1) * (ps && ps.speedMult ? ps.speedMult(p) : 1);
  return Math.round(formOf(p).cooldown / speed);
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
    hp: def.hp, maxHp: def.hp, target: null, lastAttack: 0, undead: !!def.undead, boss: !!def.boss,
    wander: null, nextWander: 0, stunUntil: 0, rootUntil: 0, dots: [],
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
  return { id: p.id, name: p.name, hero: p.heroId, x: Math.round(p.x), y: Math.round(p.y), dir: p.dir,
    hp: p.hp, maxHp: p.maxHp, lvl: p.char.level, dead: p.dead, form: p.form || null, rage: p.roarUntil > Date.now() || p.frenzyUntil > Date.now(),
    guard: p.packUntil > Date.now(), smoke: p.dodgeUntil > Date.now(),
    sh: p.shieldUntil > Date.now() && p.shieldHp > 0, stealth: p.stealthUntil > Date.now(),
    pact: p.pactUntil > Date.now() ? p.pactType : null, elem: p.hero.elements ? p.form : null, vow: p.hero.vows ? p.form : null, bless: p.blessUntil > Date.now(),
    song: p.hero.songs ? p.form : null, haste: p.hasteUntil > Date.now(), fly: p.flyUntil > Date.now(), tree: (p.nature || 0) >= 100, vow: p.vowUntil > Date.now() ? p.vowBy : null,
    emp: p.empoweredUntil > Date.now() };
}
function privateStats(p) {
  return { level: p.char.level, xp: p.char.xp, xpNext: xpForLevel(p.char.level), kills: p.char.kills,
    gold: p.char.gold, hp: Math.ceil(p.hp), maxHp: p.maxHp, dmg: Math.round(p.dmg * dmgMult(p)),
    res: Math.floor(p.res), resMax: p.resMax, cd: attackCd(p),
    bonusDmg: Math.round((dmgMult(p) - 1) * 100), bonusSpd: Math.round((formOf(p).cooldown / attackCd(p) - 1) * 100), form: p.form || null,
    formKeys: p.potion ? { potion: p.potion, sign: p.sign } : null,
    passiveNote: passiveOf(p)?.note ? passiveOf(p).note(p) : '',
    shield: p.shieldUntil > Date.now() ? Math.round(p.shieldHp) : 0, haste: p.hasteUntil > Date.now(),
    flyBoost: p.flyUntil > Date.now() ? 1 + 0.03 * (p.blessings || 0) : 1 };
}
// Статы отправляются не чаще 4 раз в секунду (см. игровой цикл)
const markDirty = (p) => { p.dirty = true; };

// Урон монстру с учётом разброса и усилений; возвращает нанесённый урон
function damageMonster(p, m, raw, opt = {}) {
  if (!monsters.has(m.id) || m.hp <= 0) return 0;
  let crit = opt.crit ?? false;
  const ps = passiveOf(p);
  const now0 = Date.now();
  // Бонус против конкретной цели (пассивки) и пробитая защита монстра (Кира)
  const tMult = (ps && ps.targetMult ? ps.targetMult(p, m) : 1) * (m.brokenUntil > now0 ? 1.25 : 1);
  // Следующая атака из дыма — критическая (Кира)
  if (opt.basic && p.nextCritUntil > now0) { crit = true; p.nextCritUntil = 0; }
  if (opt.basic && ps && ps.forceCrit && ps.forceCrit(p, m)) crit = true; // соколиный глаз Фаэлина
  // fixed — урон без множителей (отражённый урон Малакора)
  const dmg = opt.fixed ? Math.max(1, Math.round(raw))
    : Math.max(1, Math.round(raw * dmgMult(p) * tMult * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1)));
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
  m.hp -= dmg;
  if (!opt.confused) m.target = opt.pet || p.id; // монстр отвечает тому, кто ударил (кроме драки под мороком)
  fx.push({ t: 'hit', kind: 'm', target: m.id, dmg, crit, from: p.id, proj: opt.proj || null, basic: !!opt.basic, pet: opt.pet || null, pfx: opt.fromX ?? null, pfy: opt.fromY ?? null, shared: !!opt.shared, reflect: !!opt.reflect, confused: !!opt.confused,
    fx: p.x, fy: p.y, tx: m.x, ty: m.y });
  if (m.hp <= 0) {
    const def = C.MONSTERS[m.type];
    const rw = ps && ps.rewardMult ? ps.rewardMult(p, m) : { xp: 1, gold: 1 };
    const xp = Math.round(def.xp * rw.xp);
    const gold = Math.round(def.xp / 3 * (0.5 + Math.random()) * rw.gold);
    fx.push({ t: 'death', target: m.id, x: m.x, y: m.y, xp, gold, by: p.id, contract: !!rw.contract });
    monsters.delete(m.id);
    corpses.push({ x: m.x, y: m.y, t: Date.now(), type: m.type });
    if (corpses.length > 40) corpses.shift();
    grantXp(p, xp, gold);
    if (ps && ps.onKill) ps.onKill(skillCtx, p, Date.now(), m);
    if (def.boss) io.emit('chat', { sys: true, text: `${p.name} победил босса «${def.name}»!` });
    setTimeout(() => spawnMonster(), C.MONSTER_RESPAWN_MS);
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
  const def = C.MONSTERS[corpse.type] || C.MONSTERS.slime;
  const minions = owner.pets.filter((pet) => pet.kind === 'minion');
  if (minions.length >= 5) removePet(minions[0]);
  const pet = createSummon(owner, 'minion', corpse.x, corpse.y, 30000, now);
  pet.maxHp = Math.round(def.hp * 0.8); pet.hp = pet.maxHp;
  pet.dmgAbs = def.dmg * 1.2;
  pet.speedAbs = Math.max(110, def.speed * 1.3);
  pet.monsterType = corpse.type || 'slime';
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
  // Подмена двойником (Ле Блан): удар достаётся иллюзии
  const ps0 = passiveOf(target);
  if (!viaVow && ps0 && ps0.avoidHit && ps0.avoidHit(skillCtx, target, m, now)) return;
  // Уклонение в дыму (Найри)
  if (target.dodgeUntil > now && Math.random() < (target.dodgeChance || 0.5)) { fx.push({ t: 'dodge', target: target.id }); return; }
  const ps = passiveOf(target);
  // Множители входящего урона: «в ущерб защите» (Вайалд), «Зов стаи» (Урсус), пассивки (Брендан)
  let dmg = raw * (target.hero.dmgTaken || 1) * (target.packUntil > now ? 0.65 : 1)
    * (target.pactUntil > now && target.pactType === 'stone' ? 0.6 : 1)
    * (target.blessUntil > now ? 0.8 : 1) * (target.holyAuraUntil > now ? target.holyAuraMult : 1) * (ps && ps.dmgTakenMult ? ps.dmgTakenMult(target) : 1);
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
    if (m) m.target = null;
    fx.push({ t: 'pdeath', target: target.id });
    // Гибель союзника рядом усиливает Талмиру
    for (const o of players.values()) {
      const ops = passiveOf(o);
      if (o !== target && !o.dead && ops && ops.onAllyDeath && Math.hypot(o.x - target.x, o.y - target.y) < 400) ops.onAllyDeath(skillCtx, o, now);
    }
    const victim = target;
    setTimeout(() => {
      if (!players.has(victim.id)) return;
      victim.dead = false;
      victim.hp = victim.maxHp;
      victim.res = startRes(victim);
      victim.cheatUsed = false;
      victim.shieldHp = 0;
      if (victim.hero.forms) victim.form = 'human'; // возрождается в облике друида
      markDirty(victim);
      victim.x = world.spawn.x; victim.y = world.spawn.y;
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
const skillCtx = {
  moveEntity, syncCooldowns, passiveOf,
  isUndead: (m) => !!C.MONSTERS[m.type].undead,
  raiseMinion,
  monsters, players, damageMonster, healPlayer, teleport, knockback, addTotem, addGround, takeCorpse, giveShield, addPet, removePet,
  isSolidAt: (x, y) => world.isSolidAt(x, y),
  pushFx: (f) => fx.push(f),
};

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
    Object.assign(p, statsFor(p.heroId, p.char.level));
    p.hp = p.maxHp;
    if (p.pets) rescalePets(p);
    p.res = p.resMax;
    fx.push({ t: 'levelup', id: p.id, x: p.x, y: p.y, lvl: p.char.level });
    io.emit('chat', { sys: true, text: `${p.name} (${p.hero.name}) достиг ${p.char.level} уровня!` });
  }
  markDirty(p);
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
    if (!C.HEROES[heroId] || !getProfile(uid).heroes.includes(heroId)) {
      socket.emit('error_msg', 'Сначала получите персонажа');
      return;
    }
    const hero = C.HEROES[heroId];
    const name = who.tg ? who.name : (String(data.guestName || '').trim().slice(0, 16) || 'Гость');
    const char = getChar(uid, heroId);
    const p = {
      id: socket.id, uid, name: name.slice(0, 20), heroId, hero, char, socket,
      x: world.spawn.x + (Math.random() - 0.5) * 64, y: world.spawn.y + (Math.random() - 0.5) * 64,
      dir: 1, dead: false, lastAttack: 0, lastHurt: 0, lastMove: Date.now(),
      skillReadyAt: {}, wrath: 0, roarUntil: 0, frenzyUntil: 0, bloodStacks: 0, lastKill: 0, favor: 0, empoweredUntil: 0, cheatUsed: false, lastHit: 0, dirty: false, lastStats: 0,
      ...statsFor(heroId, char.level),
    };
    p.hp = p.maxHp;
    p.res = startRes(p);
    if (hero.pets) { p.pets = createPets(p); p.pets.forEach((pet) => pets.set(pet.id, pet)); }
    if (hero.summons) p.pets = []; // слуги появляются навыком «Восстание мёртвых»
    if (hero.elements) p.form = 'fire'; // Аурелиус начинает с огня
    if (hero.vows) { p.form = 'protection'; p.vowSince = Date.now(); } // Валериан начинает с обета защиты
    if (hero.songs) p.form = 'inspire'; // Джакомо начинает с песни вдохновения
    if (heroId === 'tibor') { p.potion = 'thunder'; p.sign = 'igni'; p.tox = 0; }
    p.joinedAt = Date.now();
    players.set(socket.id, p);

    socket.emit('welcome', {
      id: socket.id,
      tile: C.TILE,
      map: { w: world.width, h: world.height, tiles: world.tiles, solid: SOLID },
      heroes: C.HEROES,
      monsters: C.MONSTERS,
      stats: privateStats(p),
    });
    io.emit('chat', { sys: true, text: `${p.name} (${hero.name}, ${hero.title}) вошёл в мир` });
  });

  socket.on('move', (d) => {
    const p = players.get(socket.id);
    if (!p || p.dead || !d) return;
    const now = Date.now();
    const dt = Math.min(0.5, (now - p.lastMove) / 1000);
    p.lastMove = now;
    const x = Number(d.x), y = Number(d.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    // Античит: ограничение скорости (у облика зверя бег быстрее; после смены облика даём запас)
    const flyBoost = p.flyUntil > now ? 1 + 0.03 * (p.blessings || 0) : 1; // полёт Талмиры
    const maxDist = Math.max(formOf(p).speed, p.hero.speed) * (p.hasteUntil > now ? 1.25 : 1) * flyBoost * dt * 1.6 + 12;
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
    const m = monsters.get(d.targetId);
    if (!m || m.hp <= 0) return;
    if (Math.hypot(m.x - p.x, m.y - p.y) > formOf(p).range + 20) return;
    p.lastAttack = now;
    p.dir = m.x < p.x ? -1 : 1;
    p.stealthUntil = 0; // атака выводит из тени
    // Усиленная атака после «Дыхания гармонии»
    const empowered = p.empoweredUntil > now;
    if (empowered) { p.empoweredUntil = 0; fx.push({ t: 'skill', s: 'empHit', from: p.id, x: m.x, y: m.y, quiet: true }); }
    const ps1 = passiveOf(p);
    let basic = ps1 && ps1.basicMult ? ps1.basicMult(p) : 1; // рвение Валериана
    if (p.nextAttackBoost) { basic *= p.nextAttackBoost; p.nextAttackBoost = 0; } // овация Джакомо
    damageMonster(p, m, p.dmg * basic * (empowered ? p.empMult || 2 : 1), { crit: Math.random() < 0.15, proj: formOf(p).projectile, basic: true });
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
    if (now < (p.skillReadyAt[sk.id] || 0)) return fail('Умение ещё не готово');
    const ps = passiveOf(p);
    const cast = ps && ps.beforeCast ? ps.beforeCast(p, sk) : { free: false, power: 1 };
    if (!cast.free && p.res < sk.cost) return fail(`Не хватает: ${p.hero.resource.name}`);
    const hpCost = sk.hpCost ? p.hp * sk.hpCost : 0;
    if (hpCost && p.hp - hpCost < 1) return fail('Слишком мало здоровья');
    const range = skillRange(sk.id, p.hero);
    let target = monsters.get(d.targetId);
    if (!target || Math.hypot(target.x - p.x, target.y - p.y) > range) {
      target = null;
      let best = range;
      for (const m of monsters.values()) {
        const dd = Math.hypot(m.x - p.x, m.y - p.y);
        if (dd < best) { best = dd; target = m; }
      }
    }
    if (NEEDS_TARGET.has(sk.id) && !target) return fail('Нет цели рядом');
    if (target) p.dir = target.x < p.x ? -1 : 1;
    p.castPower = cast.power;
    p.castFree = cast.free;
    const err = SKILLS[sk.id](skillCtx, p, target, now);
    p.castPower = 1;
    p.castFree = false;
    if (err) return fail(err);
    if (sk.id !== 'shadowCloak') p.stealthUntil = 0; // навык выводит из тени
    if (!cast.free) p.res -= sk.cost;
    if (hpCost) { p.hp -= hpCost; p.lastHurt = now; fx.push({ t: 'hit', kind: 'p', target: p.id, dmg: Math.round(hpCost), from: null }); }
    if (ps && ps.afterCast) ps.afterCast(skillCtx, p, cast.free, sk);
    // Успешная казнь (Кассиан) не уходит на перезарядку
    const cd = p.skillNoCd ? 0 : sk.cooldown;
    p.skillNoCd = false;
    p.skillReadyAt[sk.id] = now + cd;
    socket.emit('skillUsed', { id: sk.id, cooldown: cd });
    markDirty(p);
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

  // ИИ монстров
  for (const m of monsters.values()) {
    const def = C.MONSTERS[m.type];
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
    if (m.stunUntil > now) continue; // оглушён
    // Страх (рёв Талиесина): монстр убегает от источника
    if (m.starUntil > now) { m.fearUntil = 0; m.confusedUntil = 0; } // звёздная метка Фаэлина не даёт скрыться
    if (m.fearUntil > now) {
      const dx = m.x - m.fearX, dy = m.y - m.fearY, d = Math.hypot(dx, dy) || 1;
      moveEntity(m, (dx / d) * def.speed * dt, (dy / d) * def.speed * dt);
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
        if (d > C.MONSTER_ATTACK_RANGE) { if (m.rootUntil <= now) moveEntity(m, (dx / d) * def.speed * 0.8 * dt, (dy / d) * def.speed * 0.8 * dt); }
        else if (now - m.lastAttack > C.MONSTER_ATTACK_CD) {
          m.lastAttack = now;
          const caster = players.get(m.confusedBy);
          const dmg = def.dmg * (0.8 + Math.random() * 0.4);
          if (caster) damageMonster(caster, other, dmg, { fixed: true, confused: true });
          else other.hp -= dmg;
        }
      }
      continue;
    }
    const rooted = m.rootUntil > now;
    // Цель монстра — игрок или зверь-спутник; провокация Брендана перекрывает выбор
    const taunter = m.tauntUntil > now ? players.get(m.tauntBy) : null;
    if (taunter && !taunter.dead) m.target = taunter.id;
    let target = m.target ? players.get(m.target) || pets.get(m.target) : null;
    if (target && (target.dead || target.down || target.stealthUntil > now || target.flyUntil > now || Math.hypot(target.x - m.x, target.y - m.y) > def.aggro * 1.8)) target = null;
    if (!target) {
      let best = null, bestD = def.aggro;
      for (const p of players.values()) {
        if (p.dead) continue;
        if (m.ignoreUntil > now && m.ignoreId === p.id) continue; // потерял из виду (дымовая завеса)
        if (p.stealthUntil > now || p.flyUntil > now) continue; // невидимость (Кассиан), полёт (Талмира)
        const d = Math.hypot(p.x - m.x, p.y - m.y);
        if (d < bestD) { best = p; bestD = d; }
      }
      for (const pet of pets.values()) {
        if (pet.down) continue;
        const d = Math.hypot(pet.x - m.x, pet.y - m.y);
        if (d < bestD) { best = pet; bestD = d; }
      }
      target = best;
    }
    m.target = target ? target.id : null;

    if (target) {
      const dx = target.x - m.x, dy = target.y - m.y;
      const d = Math.hypot(dx, dy);
      if (d > C.MONSTER_ATTACK_RANGE) {
        if (rooted) continue;
        const s = def.speed * dt * (m.slowUntil > now ? 0.6 : 1); // замедление (осквернённая земля, яд)
        if (Math.abs(dx) > 2) m.face = Math.sign(dx); // куда смотрит монстр (удар в спину)
        moveEntity(m, (dx / d) * s, (dy / d) * s);
      } else if (now - m.lastAttack > C.MONSTER_ATTACK_CD) {
        m.lastAttack = now;
        // Удар по зверю: зверь не гибнет, а «падает» и отступает
        if (target.owner) { hurtPet(skillCtx, target, Math.round(def.dmg * (0.8 + Math.random() * 0.4) * (m.weakUntil > now ? 0.6 : 1)), now); continue; }
        // Насмешка Джакомо снижает урон монстра
        hurtPlayer(target, def.dmg * (0.8 + Math.random() * 0.4) * (m.weakUntil > now ? 0.6 : 1)
          * (m.mockUntil > now ? Math.max(0.4, 1 - 0.25 * (m.mockPw || 1)) : 1), m, now);
      }
    } else {
      if (rooted) continue;
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

  // Регенерация: здоровье вне боя, ресурс (мана/энергия/ярость) всегда
  for (const p of players.values()) {
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
    if (p.dirty && now - p.lastStats >= 250) {
      p.dirty = false;
      p.lastStats = now;
      p.socket.emit('stats', privateStats(p));
    }
  }

  // Тотемы
  for (const t of totems) {
    if (now >= t.next && now <= t.until) {
      t.next += 1000;
      if (t.tick) { t.tick(now); continue; }
      for (const o of players.values()) {
        if (!o.dead && Math.hypot(o.x - t.x, o.y - t.y) <= t.r) healPlayer(o, o.maxHp * t.heal);
      }
    }
  }
  totems = totems.filter((t) => now < t.until);

  // Рассылка состояния
  const state = {
    p: [...players.values()].map(publicPlayer).map((p) => ({ ...p, hp: Math.ceil(p.hp) })),
    m: [...monsters.values()].map((m) => ({ id: m.id, type: m.type, x: Math.round(m.x), y: Math.round(m.y),
      hp: Math.ceil(m.hp), maxHp: m.maxHp, st: m.stunUntil > now ? 1 : 0, wk: m.weakUntil > now ? 1 : 0,
      mk: m.markUntil > now ? m.markedBy : null, sl: m.sealUntil > now ? 1 : 0,
      sw: m.slowUntil > now ? 1 : 0, tn: m.tauntUntil > now ? 1 : 0,
      ws: m.weakSpotUntil > now ? 1 : 0, br: m.brokenUntil > now ? 1 : 0, ps: m.poisonUntil > now ? 1 : 0,
      bn: m.burnUntil > now ? 1 : 0, bc: m.bloodCurseUntil > now ? 1 : 0, rt: m.rootUntil > now ? 1 : 0,
      cf: m.confusedUntil > now ? 1 : 0, fr: m.fearUntil > now ? 1 : 0, fz: m.frozenUntil > now ? 1 : 0, mo: m.mockUntil > now ? 1 : 0, st2: m.starUntil > now ? 1 : 0, bd: m.bondUntil > now ? 1 : 0, bl: m.bleedUntil > now ? 1 : 0 })),
    pt: [...pets.values()].map((pet) => ({ id: pet.id, kind: pet.kind, owner: pet.owner.id, skin: pet.kind === 'clone' ? 'hero_' + pet.owner.heroId : pet.kind === 'minion' ? 'mon_' + pet.monsterType : null, label: pet.label || null, x: Math.round(pet.x), y: Math.round(pet.y),
      hp: Math.ceil(Math.max(0, pet.hp)), maxHp: pet.maxHp, down: pet.down, boost: pet.boostUntil > now })),
    t: totems.map((t) => ({ id: t.id, kind: t.kind, x: Math.round(t.x), y: Math.round(t.y), r: t.r, left: t.until - now })),
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
