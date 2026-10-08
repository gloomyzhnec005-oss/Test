// Нарисованная графика миров (public/assets/world/<тема>/): тайлы, деревья, здания, порталы, украшения.
// Миры без записи здесь рисуются процедурно (Gfx.tileset, Gfx.building).
// tiles.png — 16 тайлов 32×32: 0–9 как в Gfx.tileset, 10 трава-2, 11 мох, 12 стена руин, 13 пол данжа, 14 стена данжа, 15 трава.
window.WorldArt = (() => {
  const PLACES = ['warehouse', 'equip', 'alchemy', 'smith', 'auction', 'market', 'runes', 'trainer', 'gacha', 'events', 'arena', 'survival'];
  // Объекты своего набора у каждого мира; игра использует tree/goldTree/bush, lantern и dragonStatue
  const OBJECTS = {
    green: ['tree', 'goldTree', 'bush', 'stump', 'boulder', 'crystal', 'dragonStatue', 'lantern', 'fence', 'well', 'crates', 'flowers'],
    abyss: ['tree', 'goldTree', 'bush', 'crystal', 'boulder', 'lantern', 'banner', 'chainPost', 'cage', 'bones', 'dragonStatue', 'cauldron'],
  };
  const PORTALS = ['teleport', 'arch', 'boss', 'exit', 'sign', 'chest'];
  const THEMES = { green: true, abyss: true };
  const base = (th) => `assets/world/${th}`;
  // Загрузка в Phaser (вызывается из preload сцены)
  function preload(scene) {
    for (const th of Object.keys(THEMES)) {
      scene.load.image('tiles_' + th, `${base(th)}/tiles.png`);
      for (const p of PLACES) scene.load.image(`bld_${th}_${p}`, `${base(th)}/buildings/${p}.png`);
      for (const o of OBJECTS[th]) scene.load.image(`obj_${th}_${o}`, `${base(th)}/objects/${o}.png`);
      for (const o of PORTALS) scene.load.image(`ptl_${th}_${o}`, `${base(th)}/portals/${o}.png`);
    }
  }
  const has = (th) => !!THEMES[th];
  const hash = (x, y) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 100;
  // Тайл для отрисовки: разнообразие травы в городе, свои пол и стены в данжах (столкновения не меняются)
  function remap(t, x, y, dungeon) {
    const h = hash(x, y);
    if (dungeon) return t === 0 || t === 5 || t === 2 ? 13 : t === 6 ? 14 : t === 4 ? 11 : t;
    if (t === 0) return h < 18 ? 10 : h < 26 ? 11 : 0;
    return t;
  }
  // Какое дерево стоит на клетке леса
  const treeAt = (x, y) => { const h = hash(x + 7, y + 3); return h < 55 ? 'tree' : h < 72 ? 'goldTree' : 'bush'; };
  // Фоны лобби по городу, из которого игрок вышел (public/assets/lobby/<тема>_1..4.jpg)
  const LOBBY = { green: 4, abyss: 3, sky: 1 };
  const lobbyBgs = (th) => Array.from({ length: LOBBY[th] || 0 }, (_, i) => `assets/lobby/${th}_${i + 1}.jpg`);
  return { has, preload, remap, treeAt, hash, lobbyBgs };
})();
