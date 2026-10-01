// Генерация карты мира (детерминированная по seed)
const { MAP_W, MAP_H, TILE } = require('./config');

// Типы тайлов
const T = { GRASS: 0, WATER: 1, TREE: 2, PATH: 3, FLOWERS: 4, DIRT: 5, ROCK: 6 };
const SOLID = new Set([T.WATER, T.TREE, T.ROCK]);

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Простой value-noise
function makeNoise(rand, cell) {
  const gw = Math.ceil(MAP_W / cell) + 2, gh = Math.ceil(MAP_H / cell) + 2;
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

function generateMap(seed = 1337) {
  const rand = mulberry32(seed);
  const water = makeNoise(rand, 9);
  const forest = makeNoise(rand, 5);
  const detail = makeNoise(rand, 2);
  const tiles = new Array(MAP_W * MAP_H);
  const cx = MAP_W / 2, cy = MAP_H / 2;

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const d = Math.hypot(x - cx, y - cy);
      let t = T.GRASS;
      const w = water(x, y), f = forest(x, y), r = detail(x, y);
      if (w > 0.72) t = T.WATER;
      else if (f > 0.66 && r > 0.35) t = T.TREE;
      else if (d > 30 && r > 0.8) t = T.ROCK;
      else if (d > 26) t = T.DIRT;
      else if (r > 0.82) t = T.FLOWERS;
      // Граница мира — скалы
      if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1) t = T.ROCK;
      tiles[y * MAP_W + x] = t;
    }
  }

  // Стартовый город в центре + дороги на 4 стороны
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const onRoad = (Math.abs(x - cx) < 1.5 || Math.abs(y - cy) < 1.5) && x > 0 && y > 0 && x < MAP_W - 1 && y < MAP_H - 1;
      if (d < 5) tiles[y * MAP_W + x] = T.PATH;
      else if (onRoad && tiles[y * MAP_W + x] !== T.ROCK) tiles[y * MAP_W + x] = T.PATH;
    }
  }

  const isSolidTile = (tx, ty) => tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H || SOLID.has(tiles[ty * MAP_W + tx]);
  const isSolidAt = (px, py) => isSolidTile(Math.floor(px / TILE), Math.floor(py / TILE));

  return {
    tiles,
    width: MAP_W,
    height: MAP_H,
    spawn: { x: cx * TILE, y: cy * TILE },
    isSolidTile,
    isSolidAt,
  };
}

module.exports = { generateMap, T, SOLID: [...SOLID] };
