// Нарисованная графика миров (public/assets/world/<тема>/): тайлы, деревья, здания, порталы, украшения.
// Миры без записи здесь рисуются процедурно (Gfx.tileset, Gfx.building).
// tiles.png — 16 тайлов 32×32: 0–9 как в Gfx.tileset, 10 трава-2, 11 мох, 12 стена руин, 13 пол данжа, 14 стена данжа, 15 трава.
window.WorldArt = (() => {
  const PLACES = ['warehouse', 'equip', 'alchemy', 'smith', 'auction', 'market', 'runes', 'trainer', 'gacha', 'events', 'arena', 'survival'];
  // Объекты своего набора у каждого мира; игра использует tree/goldTree/bush, lantern и dragonStatue
  const OBJECTS = {
    green: ['tree', 'goldTree', 'bush', 'stump', 'boulder', 'crystal', 'dragonStatue', 'lantern', 'fence', 'well', 'crates', 'flowers'],
    abyss: ['tree', 'goldTree', 'bush', 'crystal', 'boulder', 'lantern', 'banner', 'chainPost', 'cage', 'bones', 'dragonStatue', 'cauldron'],
    sky: ['tree', 'goldTree', 'bush', 'crystal', 'boulder', 'dragonStatue', 'nest', 'lantern', 'fountain', 'column', 'harp', 'floatStone'],
  };
  const PORTALS = ['teleport', 'arch', 'boss', 'exit', 'sign', 'chest'];
  // Украшения (assets/world/<тема>/deco/): какие где стоят — решает сервер (server/world.js, DECO)
  const DECO = {
    green: ['fountain', 'deerStatue', 'dragonStatue2', 'hoodStatue', 'chapel', 'vineArch', 'pond', 'dragonNest', 'amberCrystal', 'pillar', 'stall', 'chest', 'banner', 'signpost', 'cart',
      ...['spiritTree', 'orbTree', 'crystalFountain', 'crystalCluster', 'chest', 'banner', 'stall', 'signpost', 'crystalArch', 'reaperStatue', 'runeCircle', 'crystalGrove', 'runeStone'].map((k) => 'forest_' + k)],
    abyss: ['bloodSpire', 'gargoyle', 'firePit', 'dragonDark', 'chest', 'banner', 'stall', 'signpost', 'bloodPortal', 'reaperStatue', 'ritualCircle', 'soulWell', 'cageArena', 'bloodPillar'],
    sky: ['chapel', 'angelStatue', 'fountain2', 'dragonGold', 'chest', 'banner', 'stall', 'signpost', 'shrine', 'doveFountain', 'ruins', 'crystalSpire', 'nest2', 'bench', 'obelisk', 'cart'],
  };
  const THEMES = { green: true, abyss: true, sky: true };
  // Свои бесшовные текстуры земли (assets/world/<тема>/ground/<имя>.png, любой размер) заменяют тайл 32×32 —
  // повтор квадратов исчезает. Номер тайла → имя файла; в GROUND — какие файлы у мира уже есть
  const GROUND_NAMES = { 2: 'tree', 0: 'grass', 15: 'grass', 10: 'grass2', 11: 'moss', 1: 'water', 3: 'path', 4: 'flowers', 5: 'dirt', 6: 'rock', 7: 'wall', 8: 'plaza', 12: 'ruins', 13: 'floor', 14: 'dwall' };
  const GROUND = { green: ['grass', 'path', 'plaza', 'water', 'floor', 'dwall'], abyss: ['grass', 'path', 'plaza', 'water', 'floor', 'dwall'], sky: [] };
  // Нет своего файла — берём близкий: варианты травы, цветы и клетки под деревьями — трава, земля — дорога, скалы — стена данжа
  const GROUND_ALIAS = { grass2: 'grass', moss: 'grass', flowers: 'grass', tree: 'grass', dirt: 'path', rock: 'dwall', ruins: 'dwall', wall: 'dwall' };
  const base = (th) => `assets/world/${th}`;
  // Загрузка в Phaser (вызывается из preload сцены)
  function preload(scene) {
    for (const th of Object.keys(THEMES)) {
      scene.load.image('tiles_' + th, `${base(th)}/tiles.png`);
      for (const p of PLACES) scene.load.image(`bld_${th}_${p}`, `${base(th)}/buildings/${p}.png`);
      for (const o of OBJECTS[th]) scene.load.image(`obj_${th}_${o}`, `${base(th)}/objects/${o}.png`);
      for (const o of PORTALS) scene.load.image(`ptl_${th}_${o}`, `${base(th)}/portals/${o}.png`);
      for (const o of DECO[th] || []) scene.load.image(`deco_${th}_${o}`, `${base(th)}/deco/${o}.png`);
      for (const g of GROUND[th] || []) scene.load.image(`gnd_${th}_${g}`, `${base(th)}/ground/${g}.png`);
    }
  }
  const has = (th) => !!THEMES[th];
  const hash = (x, y) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 100;
  // Тайл для отрисовки: разнообразие травы в городе, свои пол и стены в данжах (столкновения не меняются)
  function remap(t, x, y, dungeon) {
    const h = hash(x, y);
    if (dungeon) return t === 0 || t === 3 || t === 5 || t === 2 || t === 16 ? 13 : t === 6 ? 14 : t === 4 ? 11 : t;
    if (t === 16) return 0; // под украшением — обычная земля
    if (t === 0) return h < 18 ? 10 : h < 26 ? 11 : 0;
    return t;
  }
  // Какое дерево стоит на клетке леса
  const treeAt = (x, y) => { const h = hash(x + 7, y + 3); return h < 55 ? 'tree' : h < 72 ? 'goldTree' : 'bush'; };
  // Фоны лобби по городу, из которого игрок вышел (public/assets/lobby/<тема>_1..4.jpg)
  // Только чёткие полноразмерные картинки; мелкие с общих листов убраны (были мыльными)
  const LOBBY = {
    green: ['assets/lobby/forest.jpg', 'assets/lobby/green_1.jpg', 'assets/lobby/green_2.jpg'],
    abyss: [1, 2, 3].map((i) => `assets/lobby/abyss_${i}.jpg`),
    sky: ['assets/lobby/sky_1.jpg'],
  };
  const lobbyBgs = (th) => LOBBY[th] || [];
  // ---------- Плавная земля ----------
  // Вместо сетки квадратов карта рисуется одной картинкой: каждый вид земли — своя текстура,
  // а границы между ними — мягкие и неровные (маска по клеткам, растянутая с интерполяцией, плюс шум).
  // Стены и скалы отбрасывают тень, у воды — тёмный берег. Столкновения по-прежнему по клеткам.
  const HIGH = new Set([6, 7, 12, 14]);          // скалы и стены: рисуются поверх, с тенью
  const ORDER = [0, 15, 10, 11, 2, 4, 5, 3, 8, 13, 1, 6, 12, 7, 14]; // снизу вверх
  const FLIP = new Set([0, 1, 2, 4, 5, 10, 11, 13, 15]); // природные тайлы можно отражать — меньше заметен повтор
  function pattern(ctx, src, id, rnd, scene, th) {
    const have = GROUND[th] || [];
    let name = GROUND_NAMES[id];
    if (!have.includes(name)) name = GROUND_ALIAS[name];
    const key = `gnd_${th}_${name}`;
    if (scene && have.includes(name) && scene.textures.exists(key)) return ctx.createPattern(scene.textures.get(key).getSourceImage(), 'repeat');
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const fx = FLIP.has(id) && rnd() < 0.5, fy = FLIP.has(id) && rnd() < 0.5;
      g.save(); g.translate(x * 32 + (fx ? 32 : 0), y * 32 + (fy ? 32 : 0)); g.scale(fx ? -1 : 1, fy ? -1 : 1);
      g.drawImage(src, id * 32, 0, 32, 32, 0, 0, 32, 32); g.restore();
    }
    return ctx.createPattern(c, 'repeat');
  }
  function terrain(scene, z, grid) {
    const T = 32, W = z.w, H = z.h, K = 16;          // маски — в половинном разрешении
    const src = scene.textures.get('tiles_' + z.theme).getSourceImage();
    let seed = 1234567 + W * 31 + H;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    // Шум для неровных краёв: две октавы value-noise
    const mw = W * K, mh = H * K, noise = new Float32Array(mw * mh);
    for (const [cell, amp] of [[7, 0.65], [23, 0.35]]) {
      const gw = Math.ceil(mw / cell) + 2, gr = Array.from({ length: gw * (Math.ceil(mh / cell) + 2) }, rnd);
      for (let y = 0; y < mh; y++) {
        const gy = y / cell, y0 = gy | 0, fy = gy - y0, sy = fy * fy * (3 - 2 * fy);
        for (let x = 0; x < mw; x++) {
          const gx = x / cell, x0 = gx | 0, fx = gx - x0, sx = fx * fx * (3 - 2 * fx);
          const a = gr[y0 * gw + x0], b = gr[y0 * gw + x0 + 1], c = gr[(y0 + 1) * gw + x0], d = gr[(y0 + 1) * gw + x0 + 1];
          noise[y * mw + x] += amp * (a + (b - a) * sx + (c - a + (d - c - b + a) * sx) * sy);
        }
      }
    }
    // Маска набора тайлов: 1 пиксель на клетку → растяжение → порог с шумом
    const small = document.createElement('canvas'); small.width = W; small.height = H;
    const sctx = small.getContext('2d');
    const mask = document.createElement('canvas'); mask.width = mw; mask.height = mh;
    const mctx = mask.getContext('2d', { willReadFrequently: true });
    function makeMask(test, soft = 0.12, grow = 0) {
      sctx.clearRect(0, 0, W, H); sctx.fillStyle = '#fff';
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (test(grid[y][x])) sctx.fillRect(x, y, 1, 1);
      mctx.clearRect(0, 0, mw, mh); mctx.imageSmoothingEnabled = true; mctx.imageSmoothingQuality = 'high';
      mctx.drawImage(small, 0, 0, mw, mh); // клетка x → [x·K, (x+1)·K], центр клетки — точно на месте
      const im = mctx.getImageData(0, 0, mw, mh), d = im.data, lo = 0.5 - soft - grow, hi = 0.5 + soft - grow;
      for (let i = 0, p = 0; p < noise.length; i += 4, p++) {
        const v = d[i + 3] / 255 + (noise[p] - 0.5) * 0.32;
        const t = v <= lo ? 0 : v >= hi ? 1 : (v - lo) / (hi - lo);
        d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = 255 * t * t * (3 - 2 * t);
      }
      mctx.putImageData(im, 0, 0);
      return mask;
    }
    const out = document.createElement('canvas'); out.width = W * T; out.height = H * T;
    const o = out.getContext('2d');
    const layer = document.createElement('canvas'); layer.width = out.width; layer.height = out.height;
    const l = layer.getContext('2d');
    const paintLayer = (fill, m, alpha = 1) => {
      l.globalCompositeOperation = 'source-over'; l.clearRect(0, 0, layer.width, layer.height);
      l.fillStyle = fill; l.fillRect(0, 0, layer.width, layer.height);
      l.globalCompositeOperation = 'destination-in'; l.imageSmoothingEnabled = true;
      l.drawImage(m, 0, 0, out.width, out.height);
      o.globalAlpha = alpha; o.drawImage(layer, 0, 0); o.globalAlpha = 1;
    };
    // Какие тайлы есть и сколько их
    const count = {};
    for (const row of grid) for (const t of row) count[t] = (count[t] || 0) + 1;
    const ids = ORDER.filter((t) => count[t]).concat(Object.keys(count).map(Number).filter((t) => !ORDER.includes(t)));
    const low = ids.filter((t) => !HIGH.has(t)), high = ids.filter((t) => HIGH.has(t));
    const base = low.length ? low.reduce((a, b) => (count[a] >= count[b] ? a : b)) : ids[0];
    o.fillStyle = pattern(o, src, base, rnd, scene, z.theme); o.fillRect(0, 0, out.width, out.height);
    for (const t of low) {
      if (t === base) continue;
      if (t === 1) paintLayer('rgba(0,0,0,1)', makeMask((v) => v === 1, 0.16, 0.12), 0.35); // тёмный берег
      paintLayer(pattern(o, src, t, rnd, scene, z.theme), makeMask((v) => v === t));
    }
    if (high.length) {
      // Тень стен и скал: та же маска, сдвинутая вниз
      const m = makeMask((v) => HIGH.has(v), 0.2, 0.05);
      o.save(); o.globalAlpha = 0.5;
      l.globalCompositeOperation = 'source-over'; l.clearRect(0, 0, layer.width, layer.height);
      l.fillStyle = '#000'; l.fillRect(0, 0, layer.width, layer.height);
      l.globalCompositeOperation = 'destination-in'; l.drawImage(m, 0, 0, out.width, out.height);
      o.drawImage(layer, 3, 10); o.restore();
      for (const t of high) paintLayer(pattern(o, src, t, rnd, scene, z.theme), makeMask((v) => v === t));
      // Стены темнее пола — сразу видно, где можно пройти
      paintLayer('#000', makeMask((v) => HIGH.has(v), 0.1, -0.08), 0.42);
    }
    return out;
  }

  return { has, preload, remap, treeAt, hash, lobbyBgs, terrain };
})();
