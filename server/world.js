// Мир: три города (зелёный, подземный, небесный) и охотничьи земли за порталами.
// Все зоны лежат в одном пространстве координат, сдвинутые по X на ZONE_STRIDE, —
// поэтому дальности умений и агро монстров сами собой не «перелетают» между зонами.
const { TILE } = require('./config');

// Типы тайлов (вид зависит от темы мира, см. Gfx.tileset на клиенте)
const T = { GRASS: 0, WATER: 1, TREE: 2, PATH: 3, FLOWERS: 4, DIRT: 5, ROCK: 6, WALL: 7, PLAZA: 8 };
const SOLID = new Set([T.WATER, T.TREE, T.ROCK, T.WALL]);
const ZONE_STRIDE = 8192; // px между началами зон

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Простой value-noise
function makeNoise(rand, cell, W, H) {
  const gw = Math.ceil(W / cell) + 2, gh = Math.ceil(H / cell) + 2;
  const grid = Array.from({ length: gw * gh }, () => rand());
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / cell, gy = y / cell;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = smooth(gx - x0), fy = smooth(gy - y0);
    const g = (i, j) => grid[(j) * gw + (i)];
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * fx;
    const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  };
}

// ---------- Охотничьи земли (за порталами) ----------
function huntMap(seed, W, H) {
  const rand = mulberry32(seed);
  const water = makeNoise(rand, 9, W, H), forest = makeNoise(rand, 5, W, H), detail = makeNoise(rand, 2, W, H);
  const tiles = new Array(W * H);
  const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy);
      let t = T.GRASS;
      const w = water(x, y), f = forest(x, y), r = detail(x, y);
      if (w > 0.72) t = T.WATER;
      else if (f > 0.66 && r > 0.35) t = T.TREE;
      else if (d > 24 && r > 0.8) t = T.ROCK;
      else if (d > 20) t = T.DIRT;
      else if (r > 0.82) t = T.FLOWERS;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) t = T.ROCK;
      // Поляна прибытия и дороги на 4 стороны
      const onRoad = (Math.abs(x - cx) < 1.5 || Math.abs(y - cy) < 1.5) && t !== T.ROCK;
      if (d < 4) t = T.PATH;
      else if (onRoad) t = T.PATH;
      tiles[y * W + x] = t;
    }
  }
  return { tiles, spawn: { tx: cx, ty: cy + 2 }, back: { tx: cx, ty: cy - 1 } };
}

// ---------- Город ----------
// Места города: id → подпись и иконка (содержимое окон — public/js/town.js)
const PLACES = {
  warehouse: { name: 'Склад', icon: '📦' },
  teleport: { name: 'Телепорт', icon: '🌀' },
  equip: { name: 'Оружие и доспехи', icon: '⚔️' },
  alchemy: { name: 'Эликсиры и свитки', icon: '🧪' },
  smith: { name: 'Кузница', icon: '🔨' },
  gacha: { name: 'Алтарь призыва', icon: '🎰' },
  runes: { name: 'Рунная мастерская', icon: '💠' },
  trainer: { name: 'Зал мастеров', icon: '📖' },
  auction: { name: 'Аукционный дом', icon: '🏛️' },
  market: { name: 'Рынок', icon: '🏪' },
  events: { name: 'Доска событий', icon: '📜' },
};
// Здания: левый верхний тайл, размер 4×3, дверь снизу посередине
const BUILDINGS = [
  ['warehouse', 3, 9], ['equip', 3, 15], ['alchemy', 3, 21], ['smith', 3, 27],
  ['auction', 41, 9], ['market', 41, 15], ['runes', 41, 21], ['trainer', 41, 27],
  ['gacha', 15, 31], ['events', 29, 31],
];
const TOWN_W = 48, TOWN_H = 40;

function townMap(seed, theme) {
  const W = TOWN_W, H = TOWN_H;
  const rand = mulberry32(seed);
  const deco = makeNoise(rand, 4, W, H), fine = makeNoise(rand, 2, W, H);
  const tiles = new Array(W * H).fill(T.GRASS);
  const reserved = new Uint8Array(W * H);
  const set = (x, y, t, keep) => { if (x >= 0 && y >= 0 && x < W && y < H) { tiles[y * W + x] = t; if (keep) reserved[y * W + x] = 1; } };
  const cx = 24, cy = 20;

  // Площадь с телепортом в центре
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - cx, (y - cy) * 1.1);
    if (d < 7) set(x, y, T.PLAZA, true);
  }
  // Дороги: кольцо и крест от площади
  for (let x = 2; x < W - 2; x++) { set(x, 7, T.PATH, true); set(x, 8, T.PATH, true); set(x, cy, T.PATH, true); set(x, 35, T.PATH, true); }
  for (let y = 7; y <= 36; y++) { set(9, y, T.PATH, true); set(10, y, T.PATH, true); set(38, y, T.PATH, true); set(39, y, T.PATH, true); set(cx, y, T.PATH, true); set(cx - 1, y, T.PATH, true); }
  // Аллея порталов на севере
  for (let x = 4; x < W - 4; x++) for (let y = 2; y <= 6; y++) set(x, y, T.PATH, true);

  // Здания (стены — сплошные тайлы, картинку рисует клиент) и дорожки к дверям
  for (const [, bx, by] of BUILDINGS) {
    for (let y = by - 1; y <= by + 4; y++) for (let x = bx - 1; x <= bx + 4; x++) set(x, y, T.PATH, true);
    for (let y = by; y < by + 3; y++) for (let x = bx; x < bx + 4; x++) set(x, y, T.WALL, true);
  }

  // Природа по теме, только на свободной земле
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (reserved[i]) continue;
    const n = deco(x, y), r = fine(x, y);
    if (theme === 'green') {
      if (n > 0.74) tiles[i] = T.WATER; // пруды
      else if (n < 0.22 && r > 0.4) tiles[i] = T.TREE;
      else if (r > 0.78) tiles[i] = T.FLOWERS;
    } else if (theme === 'abyss') {
      if (n > 0.7) tiles[i] = T.WATER; // бездна
      else if (n < 0.2 && r > 0.5) tiles[i] = T.TREE; // мёртвые деревья
      else if (r > 0.7) tiles[i] = T.DIRT; // пепел
      else if (r < 0.12) tiles[i] = T.FLOWERS; // светящиеся грибы
    } else {
      // Небеса: реки и облачные кущи
      const river = Math.abs(Math.sin(x * 0.35 + y * 0.12) * 4 - (y % 20) + 10);
      if ((y < 28 && y > 10 && river < 0.9) || n > 0.78) tiles[i] = T.WATER;
      else if (n < 0.2 && r > 0.45) tiles[i] = T.TREE; // золотые деревья
      else if (r > 0.75) tiles[i] = T.FLOWERS;
    }
  }
  // Граница
  for (let x = 0; x < W; x++) { set(x, 0, T.ROCK); set(x, H - 1, T.ROCK); }
  for (let y = 0; y < H; y++) { set(0, y, T.ROCK); set(W - 1, y, T.ROCK); }
  return { tiles, spawn: { tx: cx, ty: cy + 3 } };
}

// ---------- Описание миров ----------
const WORLDS = [
  { id: 'town1', name: 'Эльдмир', sub: 'Солнечная долина', theme: 'green', tier: 1, level: '1–15',
    portals: ['Лесная опушка', 'Волчья чаща', 'Старое кладбище', 'Орочий лагерь', 'Дикие холмы', 'Логово дракона'] },
  { id: 'town2', name: 'Морграт', sub: 'Город над Бездной', theme: 'abyss', tier: 2, level: '15–30',
    portals: ['Пепельные топи', 'Клыки Бездны', 'Склепы теней', 'Крепость падших', 'Разлом душ', 'Гнездо пепельного змея'] },
  { id: 'town3', name: 'Аэлион', sub: 'Небесная цитадель', theme: 'sky', tier: 3, level: '30+',
    portals: ['Облачные луга', 'Ветреные утёсы', 'Хрустальные руины', 'Бастион бурь', 'Звёздные острова', 'Трон небесного дракона'] },
];
// Состав монстров за порталами 1–6 (одинаковый для всех миров, сила растёт с уровнем мира)
const PORTAL_MONSTERS = [
  { slime: 1 },
  { slime: 0.35, wolf: 0.65 },
  { wolf: 0.3, skeleton: 0.7 },
  { skeleton: 0.3, orc: 0.7 },
  { wolf: 0.3, skeleton: 0.35, orc: 0.35 },
  { orc: 0.92, dragon: 0.08 },
];
const TIER_POWER = { 1: { hp: 1, dmg: 1, xp: 1 }, 2: { hp: 3.2, dmg: 2.6, xp: 3.5 }, 3: { hp: 8, dmg: 6, xp: 9 } };

function buildWorld() {
  const zones = [];
  const byId = new Map();
  const add = (z) => {
    z.idx = zones.length;
    z.ox = z.idx * ZONE_STRIDE; z.oy = 0;
    const abs = (tx, ty) => ({ x: z.ox + (tx + 0.5) * TILE, y: z.oy + (ty + 0.5) * TILE });
    z.abs = abs;
    z.spawn = abs(z.spawnTile.tx, z.spawnTile.ty);
    zones.push(z); byId.set(z.id, z);
    return z;
  };

  WORLDS.forEach((w, wi) => {
    const m = townMap(101 + wi * 17, w.theme);
    const town = add({ id: w.id, kind: 'town', name: w.name, sub: w.sub, theme: w.theme, tier: w.tier, level: w.level,
      w: TOWN_W, h: TOWN_H, tiles: m.tiles, spawnTile: m.spawn, town: w.id, objs: [] });
    const objs = town.objs;
    for (const [place, bx, by] of BUILDINGS) {
      const door = town.abs(bx + 1.5, by + 3.3);
      objs.push({ id: place, kind: 'place', place, ...PLACES[place], x: door.x, y: door.y,
        bx: town.ox + bx * TILE, by: town.oy + by * TILE, bw: 4 * TILE, bh: 3 * TILE });
    }
    const tp = town.abs(24, 20);
    objs.push({ id: 'teleport', kind: 'place', place: 'teleport', ...PLACES.teleport, x: tp.x, y: tp.y });
    w.portals.forEach((pname, i) => {
      const huntId = `${w.id}_p${i + 1}`;
      const pos = town.abs(7 + i * 6.8, 3.5);
      objs.push({ id: 'portal' + (i + 1), kind: 'portal', to: huntId, num: i + 1, name: pname, icon: '🌀', x: pos.x, y: pos.y });
    });
  });
  // Охотничьи земли за каждым порталом
  WORLDS.forEach((w, wi) => {
    w.portals.forEach((pname, i) => {
      const hm = huntMap(5000 + wi * 100 + i * 7, 64, 64);
      const hunt = add({ id: `${w.id}_p${i + 1}`, kind: 'hunt', name: pname, sub: `${w.name} · портал ${i + 1}`, theme: w.theme, tier: w.tier,
        w: 64, h: 64, tiles: hm.tiles, spawnTile: hm.spawn, town: w.id, objs: [],
        mix: PORTAL_MONSTERS[i], power: TIER_POWER[w.tier], monsterCount: 38 });
      const back = hunt.abs(hm.back.tx, hm.back.ty);
      hunt.objs.push({ id: 'back', kind: 'portal', to: w.id, name: `В город ${w.name}`, icon: '🏰', x: back.x, y: back.y });
    });
  });

  const zoneAtX = (px) => zones[Math.floor(px / ZONE_STRIDE)] || null;
  const isSolidAt = (px, py) => {
    const z = zoneAtX(px);
    if (!z) return true;
    const tx = Math.floor((px - z.ox) / TILE), ty = Math.floor((py - z.oy) / TILE);
    return tx < 0 || ty < 0 || tx >= z.w || ty >= z.h || SOLID.has(z.tiles[ty * z.w + tx]);
  };
  // Случайная свободная точка в кольце вокруг центра зоны
  const freeSpot = (z, minR, maxR) => {
    const cx = z.w / 2, cy = z.h / 2;
    for (let i = 0; i < 200; i++) {
      const a = Math.random() * Math.PI * 2, r = minR + Math.random() * (maxR - minR);
      const tx = Math.floor(cx + Math.cos(a) * r), ty = Math.floor(cy + Math.sin(a) * r);
      if (tx > 0 && ty > 0 && tx < z.w - 1 && ty < z.h - 1 && !SOLID.has(z.tiles[ty * z.w + tx])) return z.abs(tx, ty);
    }
    return { ...z.spawn };
  };
  // Данные зоны для клиента
  const payload = (z) => ({ id: z.id, idx: z.idx, kind: z.kind, name: z.name, sub: z.sub, theme: z.theme, tier: z.tier, level: z.level || null,
    town: z.town, w: z.w, h: z.h, ox: z.ox, oy: z.oy, tiles: z.tiles, objs: z.objs, solid: [...SOLID] });

  return { zones, byId, zoneAtX, isSolidAt, freeSpot, payload, towns: WORLDS.map((w) => ({ id: w.id, name: w.name, sub: w.sub, theme: w.theme, level: w.level })) };
}

module.exports = { buildWorld, T, SOLID: [...SOLID], ZONE_STRIDE, PLACES };
