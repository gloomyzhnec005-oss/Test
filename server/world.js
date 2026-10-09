// Мир: три города (зелёный, подземный, небесный) и охотничьи земли за порталами.
// Все зоны лежат в одном пространстве координат, сдвинутые по X на ZONE_STRIDE, —
// поэтому дальности умений и агро монстров сами собой не «перелетают» между зонами.
const { TILE } = require('./config');
const { DUNGEONS, WORLD_BOSSES, MOBS } = require('./mobs');

// Типы тайлов (вид зависит от темы мира, см. Gfx.tileset на клиенте)
// DECO — клетка под нарисованным украшением (статуя, фонтан, сундук): непроходима, закрывает обзор; земля под ним рисуется как трава/пол
const T = { GRASS: 0, WATER: 1, TREE: 2, PATH: 3, FLOWERS: 4, DIRT: 5, ROCK: 6, WALL: 7, PLAZA: 8, DECO: 16 };
const SOLID = new Set([T.WATER, T.TREE, T.ROCK, T.WALL, T.DECO]);
const BLOCKS_SIGHT = new Set([T.TREE, T.ROCK, T.WALL, T.DECO]); // через воду стрелять можно, через стены и деревья — нет
const ZONE_STRIDE = 8192; // px между началами зон

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Украшения миров (картинки — public/assets/world/<тема>/deco/<имя>.png).
// plaza — по углам центральной площади, big — крупные (2×2 клетки), small — мелкие (1×1), dungeon — препятствия в комнатах данжей
const DECO = {
  green: {
    plaza: ['fountain', 'deerStatue', 'dragonStatue2', 'hoodStatue'],
    big: ['chapel', 'vineArch', 'pond', 'dragonNest', 'amberCrystal', 'pillar', 'stall', 'forest_spiritTree', 'forest_crystalGrove', 'forest_crystalFountain'],
    small: ['chest', 'banner', 'signpost', 'cart', 'forest_runeStone', 'forest_crystalCluster', 'forest_banner'],
    dungeon: ['forest_crystalCluster', 'forest_runeStone', 'forest_orbTree', 'forest_reaperStatue', 'forest_crystalFountain', 'forest_crystalGrove', 'forest_chest', 'forest_banner', 'forest_spiritTree'],
    boss: ['forest_crystalArch', 'forest_runeCircle'],
  },
  abyss: {
    plaza: ['firePit', 'gargoyle', 'dragonDark', 'reaperStatue'],
    big: ['bloodSpire', 'bloodPortal', 'soulWell', 'cageArena', 'ritualCircle', 'stall', 'bloodPillar'],
    small: ['chest', 'banner', 'signpost'],
    dungeon: ['bloodPillar', 'firePit', 'gargoyle', 'reaperStatue', 'soulWell', 'chest', 'banner'],
    boss: ['bloodPortal', 'ritualCircle'],
  },
  sky: {
    plaza: ['fountain2', 'angelStatue', 'dragonGold', 'doveFountain'],
    big: ['chapel', 'shrine', 'ruins', 'crystalSpire', 'obelisk', 'stall', 'nest2'],
    small: ['chest', 'banner', 'signpost', 'bench', 'cart'],
    dungeon: ['crystalSpire', 'obelisk', 'angelStatue', 'chest', 'banner', 'nest2'],
    boss: ['shrine', 'ruins'],
  },
};

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

// ---------- Данж-лабиринт ----------
// Сетка комнат, соединённых коридорами (остовное дерево + пара петель). Босс — в самой дальней комнате,
// полубоссы — на пути к нему. Возвращает тайлы и список комнат с глубиной и ролью.
function mazeMap(seed, theme, minis) {
  const rand = mulberry32(seed);
  const CW = 12, CC = 5, CR = 4, W = CC * CW + 2, H = CR * CW + 2;
  const tiles = new Array(W * H).fill(T.ROCK);
  const floor = theme === 'abyss' ? T.DIRT : T.GRASS;
  const cells = [];
  for (let r = 0; r < CR; r++) for (let c = 0; c < CC; c++) {
    const w = 6 + Math.floor(rand() * 4), h = 6 + Math.floor(rand() * 4);
    const x0 = 1 + c * CW + Math.floor((CW - w) / 2) + Math.floor(rand() * 2), y0 = 1 + r * CW + Math.floor((CW - h) / 2) + Math.floor(rand() * 2);
    cells.push({ c, r, x0, y0, x1: x0 + w - 1, y1: y0 + h - 1, cx: Math.floor(x0 + w / 2), cy: Math.floor(y0 + h / 2), links: [] });
  }
  const at = (c, r) => (c >= 0 && r >= 0 && c < CC && r < CR ? cells[r * CC + c] : null);
  // Остовное дерево обходом в глубину
  const start = at(0, Math.floor(rand() * CR));
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dc, dr]) => at(cur.c + dc, cur.r + dr)).filter((n) => n && !seen.has(n));
    if (!nb.length) { stack.pop(); continue; }
    const n = nb[Math.floor(rand() * nb.length)];
    cur.links.push(n); n.links.push(cur); seen.add(n); stack.push(n);
  }
  for (let i = 0; i < 2; i++) { // петли
    const a = cells[Math.floor(rand() * cells.length)], b = at(a.c + 1, a.r) || at(a.c, a.r + 1);
    if (b && !a.links.includes(b)) { a.links.push(b); b.links.push(a); }
  }
  const set = (x, y, t) => { if (x > 0 && y > 0 && x < W - 1 && y < H - 1) tiles[y * W + x] = t; };
  for (const cl of cells) for (let y = cl.y0; y <= cl.y1; y++) for (let x = cl.x0; x <= cl.x1; x++) set(x, y, rand() < 0.08 ? T.FLOWERS : floor);
  const corridor = (a, b) => {
    const mx = rand() < 0.5;
    const [ax, ay, bx, by] = [a.cx, a.cy, b.cx, b.cy];
    const hx = (y, x0, x1) => { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let k = -1; k <= 1; k++) if (tiles[(y + k) * W + x] === T.ROCK) set(x, y + k, T.PATH); };
    const vy = (x, y0, y1) => { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let k = -1; k <= 1; k++) if (tiles[y * W + x + k] === T.ROCK) set(x + k, y, T.PATH); };
    if (mx) { hx(ay, ax, bx); vy(bx, ay, by); } else { vy(ax, ay, by); hx(by, ax, bx); }
  };
  const done = new Set();
  for (const a of cells) for (const b of a.links) { const k = [a, b].sort((p, q) => cells.indexOf(p) - cells.indexOf(q)).map((x) => cells.indexOf(x)).join(); if (!done.has(k)) { done.add(k); corridor(a, b); } }
  // Препятствия в комнатах: нарисованные украшения мира (кристаллы, статуи, столбы), без набора — деревья
  const D = DECO[theme], deco = [];
  for (const cl of cells) if (cl !== start) for (let i = 0; i < 2; i++) {
    const x = cl.x0 + 1 + Math.floor(rand() * (cl.x1 - cl.x0 - 1)), y = cl.y0 + 1 + Math.floor(rand() * (cl.y1 - cl.y0 - 1));
    if (Math.abs(x - cl.cx) > 1 || Math.abs(y - cl.cy) > 1) {
      if (!D) { set(x, y, T.TREE); continue; }
      set(x, y, T.DECO);
      deco.push({ k: D.dungeon[Math.floor(rand() * D.dungeon.length)], tx: x, ty: y, s: 1 });
    }
  }
  // Глубина комнат и путь к боссу
  const depth = new Map([[start, 0]]), prev = new Map();
  const q = [start];
  while (q.length) { const c = q.shift(); for (const n of c.links) if (!depth.has(n)) { depth.set(n, depth.get(c) + 1); prev.set(n, c); q.push(n); } }
  const boss = [...depth.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const path = [];
  for (let c = boss; c; c = prev.get(c)) path.unshift(c);
  // Комната босса: два крупных украшения по углам
  if (D) [[boss.x0 + 1, boss.y0 + 1], [boss.x1 - 1, boss.y0 + 1]].forEach(([x, y], i) => {
    if (tiles[y * W + x] === T.DECO) return;
    set(x, y, T.DECO);
    deco.push({ k: D.boss[i % D.boss.length], tx: x, ty: y, s: 1 });
  });
  const rooms = cells.map((c) => ({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, cx: c.cx, cy: c.cy, depth: depth.get(c), role: c === start ? 'start' : c === boss ? 'boss' : 'normal' }));
  const maxD = depth.get(boss);
  const miniAt = minis === 1 ? [0.6] : [0.45, 0.75];
  miniAt.forEach((k) => { const c = path[Math.max(1, Math.min(path.length - 2, Math.round(k * (path.length - 1))))]; rooms[cells.indexOf(c)].role = 'mini'; });
  return { tiles, w: W, h: H, rooms, maxD, deco, spawn: { tx: start.cx, ty: start.cy } };
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
  arena: { name: 'PvP-арена', icon: '🏟️' },
  survival: { name: 'Данж выживания', icon: '💀' },
};
// Здания: левый верхний тайл, размер 4×3, дверь снизу посередине
const BUILDINGS = [
  ['warehouse', 3, 9], ['equip', 3, 15], ['alchemy', 3, 21], ['smith', 3, 27],
  ['auction', 41, 9], ['market', 41, 15], ['runes', 41, 21], ['trainer', 41, 27],
  ['gacha', 15, 31], ['events', 29, 31], ['arena', 13, 10], ['survival', 31, 10],
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
  // Площадка портала мирового босса на юге
  for (let x = 20; x <= 28; x++) for (let y = 36; y <= 38; y++) set(x, y, T.PATH, true);
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
  return { tiles, deco: townDeco(tiles, reserved, W, H, cx, cy, rand, theme), spawn: { tx: cx, ty: cy + 3 } };
}

// Украшения города: четыре по углам площади и россыпь на свободной земле.
// Крупные занимают 2×2 клетки, мелкие — одну; вокруг каждого остаётся проход, дороги и двери не трогаются.
function townDeco(tiles, reserved, W, H, cx, cy, rand, theme) {
  const D = DECO[theme];
  if (!D) return [];
  const out = [];
  D.plaza.forEach((k, i) => {
    const tx = cx + (i % 2 ? 5 : -5), ty = cy + (i < 2 ? -4 : 4);
    tiles[ty * W + tx] = T.DECO;
    out.push({ k, tx, ty, s: 1 });
  });
  const ground = (x, y) => x > 1 && y > 1 && x < W - 2 && y < H - 2 && !reserved[y * W + x] && [T.GRASS, T.FLOWERS, T.DIRT].includes(tiles[y * W + x]);
  const far = (x, y) => out.every((o) => Math.max(Math.abs(o.tx - x), Math.abs(o.ty - y)) >= 3);
  const place = (list, n, s) => {
    let k = 0;
    for (let tries = 0; tries < 3000 && k < n; tries++) {
      const x = 2 + Math.floor(rand() * (W - 4)), y = 2 + Math.floor(rand() * (H - 4));
      let ok = far(x, y);
      // сами клетки — свободная земля, кольцо вокруг — любая проходимая клетка (можно дорогу)
      for (let dy = -1; ok && dy <= s; dy++) for (let dx = -1; ok && dx <= s; dx++) {
        const inside = dx >= 0 && dy >= 0 && dx < s && dy < s;
        ok = inside ? ground(x + dx, y + dy) : !SOLID.has(tiles[(y + dy) * W + x + dx]);
      }
      if (!ok) continue;
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) tiles[(y + dy) * W + x + dx] = T.DECO;
      out.push({ k: list[k % list.length], tx: x, ty: y, s });
      k++;
    }
  };
  place(D.big, D.big.length, 2);
  place(D.small, D.small.length + 3, 1);
  return out;
}

// ---------- Описание миров ----------
const WORLDS = [
  { id: 'town1', name: 'Эльдмир', sub: 'Солнечная долина', theme: 'green', tier: 1, level: '1–15',
},
  { id: 'town2', name: 'Морграт', sub: 'Город над Бездной', theme: 'abyss', tier: 2, level: '15–30',
},
  { id: 'town3', name: 'Аэлион', sub: 'Небесная цитадель', theme: 'sky', tier: 3, level: '30+',
},
];
function buildWorld() {
  const zones = [];
  const byId = new Map();
  const FIXED = WORLDS.length * 2; // города и арены мировых боссов; дальше — временные копии данжей
  const add = (z) => {
    let idx = zones.length;
    for (let i = FIXED; i < zones.length; i++) if (!zones[i]) { idx = i; break; } // занимаем место удалённой копии
    z.idx = idx;
    z.ox = z.idx * ZONE_STRIDE; z.oy = 0;
    const abs = (tx, ty) => ({ x: z.ox + (tx + 0.5) * TILE, y: z.oy + (ty + 0.5) * TILE });
    z.abs = abs;
    z.spawn = abs(z.spawnTile.tx, z.spawnTile.ty);
    // Украшения: точка — низ картинки посередине занятых клеток
    z.deco = (z.decoTiles || []).map((d) => ({ k: d.k, x: z.ox + (d.tx + d.s / 2) * TILE, y: z.oy + (d.ty + d.s) * TILE - 3 }));
    delete z.decoTiles;
    zones[idx] = z; byId.set(z.id, z);
    return z;
  };

  WORLDS.forEach((w, wi) => {
    const m = townMap(101 + wi * 17, w.theme);
    const town = add({ id: w.id, kind: 'town', name: w.name, sub: w.sub, theme: w.theme, tier: w.tier, level: w.level,
      w: TOWN_W, h: TOWN_H, tiles: m.tiles, spawnTile: m.spawn, town: w.id, objs: [], decoTiles: m.deco });
    const objs = town.objs;
    for (const [place, bx, by] of BUILDINGS) {
      const door = town.abs(bx + 1.5, by + 3.3);
      objs.push({ id: place, kind: 'place', place, ...PLACES[place], x: door.x, y: door.y,
        bx: town.ox + bx * TILE, by: town.oy + by * TILE, bw: 4 * TILE, bh: 3 * TILE });
    }
    const tp = town.abs(24, 20);
    objs.push({ id: 'teleport', kind: 'place', place: 'teleport', ...PLACES.teleport, x: tp.x, y: tp.y });
    DUNGEONS[w.id].forEach((dg, i) => {
      const pos = town.abs(7 + i * 6.8, 3.5);
      objs.push({ id: 'portal' + (i + 1), kind: 'portal', dungeon: i, num: i + 1, name: dg.name, lv: dg.lv, icon: '🌀', x: pos.x, y: pos.y });
    });
    const wb = town.abs(24, 37.2);
    objs.push({ id: 'worldboss', kind: 'portal', to: `wb_${w.id}`, name: 'Мировой босс', lv: [WORLD_BOSSES[w.id].lv, WORLD_BOSSES[w.id].lv], icon: '👹', x: wb.x, y: wb.y, world: true });
  });
  // Арены мировых боссов: общие для всех игроков мира
  const arenaTiles = (W, H, rand) => {
    const tiles = new Array(W * H).fill(T.PLAZA);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - (W - 1) / 2, y - (H - 1) / 2);
      if (d > W / 2 - 1) tiles[y * W + x] = T.ROCK;
      else if (d > W / 2 - 3.5) tiles[y * W + x] = T.DIRT;
      else if (d > 5 && rand && rand() < 0.03) tiles[y * W + x] = T.ROCK;
    }
    return tiles;
  };
  WORLDS.forEach((w) => {
    const z = add({ id: `wb_${w.id}`, kind: 'worldboss', name: 'Логово мирового босса', sub: `${w.name} · общая битва`, theme: w.theme, tier: w.tier,
      w: 40, h: 40, tiles: arenaTiles(40, 40), spawnTile: { tx: 20, ty: 33 }, town: w.id, objs: [] });
    const back = z.abs(20, 35);
    z.objs.push({ id: 'back', kind: 'portal', to: w.id, name: `В город ${w.name}`, icon: '🏰', x: back.x, y: back.y });
  });

  // Данж-лабиринт: отдельная копия на игрока или группу
  let dunSeq = 1;
  const addDungeon = (townId, i) => {
    const town = byId.get(townId), dg = DUNGEONS[townId][i];
    const m = mazeMap(9000 + dunSeq * 13 + i * 101, town.theme, dg.minis.length);
    const z = add({ id: `dun${dunSeq++}`, kind: 'dungeon', name: dg.name, sub: `${town.name} · портал ${i + 1} · ур. ${dg.lv[0]}–${dg.lv[1]}`, theme: town.theme, tier: town.tier,
      w: m.w, h: m.h, tiles: m.tiles, spawnTile: m.spawn, town: townId, objs: [], rooms: m.rooms, maxD: m.maxD, dg, dgIndex: i, decoTiles: m.deco });
    const back = z.abs(m.spawn.tx, m.spawn.ty - 2);
    z.objs.push({ id: 'back', kind: 'portal', to: townId, name: `В город ${town.name}`, icon: '🏰', x: back.x, y: back.y });
    return z;
  };

  // Данж выживания: отдельная копия арены на каждый заход (игрок или группа)
  let instSeq = 1;
  const addSurvival = (townId) => {
    const town = byId.get(townId);
    const W = 30, H = 30, tiles = arenaTiles(W, H, mulberry32(instSeq * 31));
    const z = add({ id: `surv${instSeq++}`, kind: 'survival', name: 'Данж выживания', sub: `${town.name} · волны монстров`, theme: town.theme, tier: town.tier,
      w: W, h: H, tiles, spawnTile: { tx: 15, ty: 15 }, town: townId, objs: [] });
    const back = z.abs(15, 13);
    z.objs.push({ id: 'back', kind: 'portal', to: townId, name: `Выйти в ${town.name}`, icon: '🏰', x: back.x, y: back.y });
    return z;
  };
  const removeZone = (z) => { byId.delete(z.id); if (zones[z.idx] === z) zones[z.idx] = null; };

  const zoneAtX = (px) => zones[Math.floor(px / ZONE_STRIDE)] || null;
  const isSolidAt = (px, py) => {
    const z = zoneAtX(px);
    if (!z) return true;
    const tx = Math.floor((px - z.ox) / TILE), ty = Math.floor((py - z.oy) / TILE);
    return tx < 0 || ty < 0 || tx >= z.w || ty >= z.h || SOLID.has(z.tiles[ty * z.w + tx]);
  };
  // Прямая видимость между точками: стены, скалы и деревья закрывают выстрелы и умения
  const lineOfSight = (ax, ay, bx, by) => {
    const z = zoneAtX(ax);
    if (!z || z !== zoneAtX(bx)) return false;
    const dist = Math.hypot(bx - ax, by - ay), n = Math.ceil(dist / 8);
    for (let i = 1; i < n; i++) {
      const k = i / n;
      if (k * dist < 12 || (1 - k) * dist < 12) continue; // края: стоящий вплотную к стене не «прячется» в ней
      const tx = Math.floor((ax + (bx - ax) * k - z.ox) / TILE), ty = Math.floor((ay + (by - ay) * k - z.oy) / TILE);
      if (tx < 0 || ty < 0 || tx >= z.w || ty >= z.h || BLOCKS_SIGHT.has(z.tiles[ty * z.w + tx])) return false;
    }
    return true;
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
    town: z.town, w: z.w, h: z.h, ox: z.ox, oy: z.oy, tiles: z.tiles, objs: z.objs, deco: z.deco || [], solid: [...SOLID], fog: z.kind === 'dungeon' });

  return { zones, byId, zoneAtX, isSolidAt, lineOfSight, freeSpot, payload, addSurvival, addDungeon, removeZone, towns: WORLDS.map((w) => ({ id: w.id, name: w.name, sub: w.sub, theme: w.theme, level: w.level })) };
}

module.exports = { buildWorld, T, SOLID: [...SOLID], ZONE_STRIDE, PLACES, DECO };
