// Процедурная «пиксельная» графика: всё рисуется на Canvas, без внешних ассетов.
// Используется и в Phaser (textures.addCanvas), и в превью на экране выбора.
window.Gfx = (() => {
  const TILE = 32;

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return [c, ctx];
  }
  const rect = (ctx, x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
  const circle = (ctx, x, y, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');

  // Псевдослучайность для деталей тайлов
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  function speckle(ctx, ox, base, dots, n) {
    rect(ctx, ox, 0, TILE, TILE, base);
    for (let i = 0; i < n; i++) rect(ctx, ox + Math.floor(rnd() * 30), Math.floor(rnd() * 30), 2, 2, dots[i % dots.length]);
  }

  // Порядок совпадает с T в server/world.js: трава, вода, дерево, дорога, цветы, земля, скала, стена здания, площадь.
  // theme: green — солнечный мир, abyss — подземный мир над Бездной, sky — небесный мир
  const THEMES = {
    green: { grass: ['#4e9a3a', '#5fb046', '#3f8530'], water: ['#2f6fb5', '#5592d6'], trunk: '#6b4423', crown: ['#2d6b22', '#3f8a2f', '#24581b'],
      path: ['#c9a66b', '#b8935a', '#d8b87d'], flowers: ['#ff6b9a', '#ffe14d', '#ffffff', '#b38cff'], dirt: ['#6e5a44', '#5c4a37', '#7e6a52'],
      rock: ['#3c3a38', '#777270', '#9a9592'], plaza: ['#d8c8a0', '#c8b890', '#e8dcb8'] },
    abyss: { grass: ['#2a2430', '#3a3040', '#221c28'], water: ['#07040c', '#3a1a5a'], trunk: '#3a2a2a', crown: null,
      path: ['#4a4250', '#3a3440', '#5a5260'], flowers: ['#5fffd8', '#c070ff', '#5fffd8', '#ff5a8a'], dirt: ['#3a3438', '#2e2a2e', '#4a4448'],
      rock: ['#15121a', '#3a2a4a', '#6a3a9a'], plaza: ['#3a3448', '#2e2a3a', '#4a4258'] },
    sky: { grass: ['#e8f0ff', '#ffffff', '#d0e0f8'], water: ['#7ac8ff', '#d8f0ff'], trunk: '#c8a060', crown: ['#ffd84a', '#ffe88a', '#e8b830'],
      path: ['#f4eee0', '#e8dcc0', '#fffaf0'], flowers: ['#ffd84a', '#ffb0d8', '#ffffff', '#8ad8ff'], dirt: ['#d8e4f4', '#c8d8ec', '#e8f0fa'],
      rock: ['#c8d8f0', '#ffffff', '#f0f6ff'], plaza: ['#fffaf0', '#f0e6d0', '#ffffff'] },
  };
  function tileset(theme = 'green') {
    const P = THEMES[theme] || THEMES.green;
    seed = 7;
    const [c, ctx] = canvas(TILE * 9, TILE);
    // 0 трава / пепел / облака
    speckle(ctx, 0, P.grass[0], P.grass.slice(1), 26);
    // 1 вода / бездна / небесная река
    rect(ctx, 32, 0, TILE, TILE, P.water[0]);
    for (let i = 0; i < 5; i++) rect(ctx, 32 + 4 + Math.floor(rnd() * 20), 4 + i * 6, theme === 'abyss' ? 3 : 8, 2, P.water[1]);
    if (theme === 'abyss') for (let i = 0; i < 3; i++) rect(ctx, 32 + Math.floor(rnd() * 28), Math.floor(rnd() * 28), 2, 2, '#ff5a2a');
    // 2 дерево
    speckle(ctx, 64, P.grass[0], P.grass.slice(1), 14);
    if (theme === 'abyss') {
      // Мёртвое дерево
      rect(ctx, 64 + 14, 10, 4, 20, P.trunk); rect(ctx, 64 + 8, 12, 6, 2, P.trunk); rect(ctx, 64 + 18, 8, 7, 2, P.trunk);
      rect(ctx, 64 + 7, 8, 2, 4, P.trunk); rect(ctx, 64 + 24, 4, 2, 5, P.trunk); rect(ctx, 64 + 13, 4, 2, 6, P.trunk);
    } else {
      rect(ctx, 64 + 13, 20, 6, 10, P.trunk);
      circle(ctx, 64 + 16, 14, 12, P.crown[0]); circle(ctx, 64 + 12, 11, 6, P.crown[1]); circle(ctx, 64 + 20, 16, 5, P.crown[2]);
    }
    // 3 дорога
    speckle(ctx, 96, P.path[0], P.path.slice(1), 30);
    ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.strokeRect(96.5, 0.5, 31, 31);
    // 4 цветы / светящиеся грибы
    speckle(ctx, 128, P.grass[0], P.grass.slice(1), 18);
    [[0, 6, 8], [1, 20, 6], [2, 12, 20], [0, 24, 24], [3, 4, 26]].forEach(([ci, x, y]) => {
      const col = P.flowers[ci];
      if (theme === 'abyss') { rect(ctx, 128 + x, y + 2, 1, 3, '#8a8090'); rect(ctx, 128 + x - 1, y, 3, 2, col); }
      else { rect(ctx, 128 + x, y, 3, 3, col); rect(ctx, 128 + x + 1, y + 3, 1, 3, theme === 'sky' ? '#9ac8a0' : '#2d6b22'); }
    });
    // 5 земля / пепел
    speckle(ctx, 160, P.dirt[0], P.dirt.slice(1), 30);
    // 6 скала / обсидиан / облачная стена
    speckle(ctx, 192, P.rock[0], [P.rock[0]], 4);
    if (theme === 'sky') { circle(ctx, 200, 20, 10, P.rock[1]); circle(ctx, 214, 14, 12, P.rock[1]); circle(ctx, 222, 22, 9, P.rock[2]); }
    else {
      ctx.fillStyle = P.rock[1];
      ctx.beginPath(); ctx.moveTo(194, 30); ctx.lineTo(202, 6); ctx.lineTo(212, 12); ctx.lineTo(222, 4); ctx.lineTo(230, 30); ctx.fill();
      ctx.fillStyle = P.rock[2];
      ctx.beginPath(); ctx.moveTo(202, 6); ctx.lineTo(206, 18); ctx.lineTo(212, 12); ctx.fill();
    }
    // 7 основание здания (сверху рисуется само здание)
    speckle(ctx, 224, P.path[0], P.path.slice(1), 20);
    // 8 площадь: брусчатка
    rect(ctx, 256, 0, TILE, TILE, P.plaza[0]);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      rect(ctx, 256 + x * 8 + (y % 2) * 4, y * 8, 7, 7, P.plaza[(x + y) % 2 ? 1 : 2]);
    }
    if (theme === 'abyss') rect(ctx, 256 + 14, 14, 3, 3, '#b04aff');
    if (theme === 'sky') rect(ctx, 256 + 14, 14, 3, 3, '#e8c060');
    return c;
  }

  // Здания города (128×112): основание 4×3 тайла + крыша над ним. Вид зависит от места и мира.
  const ROOFS = { warehouse: '#8a5a2a', equip: '#a03a2a', alchemy: '#3a7a5a', smith: '#4a4a52', runes: '#3a5aa0', trainer: '#7a3a8a', auction: '#b08a2a', market: '#c0603a', arena: '#9a2a2a', survival: '#3a3a3a' };
  function building(place, theme = 'green') {
    const [c, ctx] = canvas(128, 112);
    const wall = { green: '#e8d8b0', abyss: '#3a3040', sky: '#fffaf0' }[theme];
    const beam = { green: '#7a5230', abyss: '#1a1420', sky: '#e8c060' }[theme];
    const glow = { green: '#ffe9a0', abyss: '#b04aff', sky: '#bfe8ff' }[theme];
    let roof = ROOFS[place] || '#8a5a2a';
    if (theme === 'abyss') roof = shade(roof, -0.55);
    if (theme === 'sky') roof = shade(roof, 0.35);
    if (place === 'gacha') {
      // Алтарь призыва: ступени, колонны и парящий кристалл
      rect(ctx, 8, 92, 112, 18, shade(wall, -0.2)); rect(ctx, 18, 82, 92, 12, shade(wall, -0.1));
      for (const x of [22, 96]) { rect(ctx, x, 30, 10, 54, wall); rect(ctx, x - 3, 26, 16, 6, beam); }
      rect(ctx, 19, 22, 90, 6, beam);
      ctx.fillStyle = '#c080ff'; ctx.beginPath(); ctx.moveTo(64, 34); ctx.lineTo(78, 56); ctx.lineTo(64, 80); ctx.lineTo(50, 56); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.moveTo(64, 38); ctx.lineTo(70, 56); ctx.lineTo(64, 60); ctx.fill();
      circle(ctx, 64, 56, 30, 'rgba(192,128,255,.18)');
      return c;
    }
    if (place === 'events') {
      // Доска событий: столбы и прибитые листы
      rect(ctx, 18, 40, 8, 70, beam); rect(ctx, 102, 40, 8, 70, beam);
      rect(ctx, 10, 30, 108, 56, shade(beam, 0.25)); rect(ctx, 10, 26, 108, 6, beam);
      [[18, 38, '#f4ecd0'], [48, 40, '#ffd8a0'], [80, 36, '#e0f0ff'], [24, 62, '#ffe0e8'], [62, 64, '#f4ecd0'], [92, 60, '#d8ffd8']]
        .forEach(([x, y, col]) => { rect(ctx, x, y, 22, 18, col); rect(ctx, x + 9, y + 1, 4, 3, '#c0301e'); rect(ctx, x + 3, y + 7, 16, 1, '#8a7a6a'); rect(ctx, x + 3, y + 11, 12, 1, '#8a7a6a'); });
      return c;
    }
    if (place === 'market') {
      // Торговые ряды с навесами
      for (let i = 0; i < 3; i++) {
        const x = 6 + i * 40;
        rect(ctx, x + 2, 70, 34, 30, shade(beam, 0.2)); rect(ctx, x + 2, 66, 34, 6, beam);
        for (let k = 0; k < 4; k++) rect(ctx, x + k * 9, 46, 9, 20, k % 2 ? '#ffffff' : roof);
        rect(ctx, x + 2, 46, 2, 54, beam); rect(ctx, x + 34, 46, 2, 54, beam);
        [['#e86a5a', 8], ['#ffd84a', 18], ['#7ad87a', 26]].forEach(([col, dx]) => circle(ctx, x + dx, 64, 3, col));
      }
      return c;
    }
    // Обычный дом: стены, балки, окна, дверь, крыша
    rect(ctx, 6, 44, 116, 66, wall);
    rect(ctx, 6, 44, 116, 4, beam); rect(ctx, 6, 106, 116, 4, beam);
    for (const x of [6, 40, 84, 118]) rect(ctx, x, 44, 4, 66, beam);
    if (place === 'auction') for (const x of [18, 54, 94]) { rect(ctx, x, 48, 8, 58, shade(wall, 0.15)); rect(ctx, x - 2, 48, 12, 4, beam); }
    rect(ctx, 54, 74, 20, 36, shade(beam, -0.2)); rect(ctx, 56, 76, 16, 34, shade(beam, 0.15)); circle(ctx, 69, 93, 1.5, glow);
    for (const x of [16, 92]) { rect(ctx, x, 60, 20, 16, beam); rect(ctx, x + 2, 62, 16, 12, glow); rect(ctx, x + 9, 62, 2, 12, beam); }
    // Крыша
    ctx.fillStyle = roof;
    ctx.beginPath(); ctx.moveTo(0, 48); ctx.lineTo(20, 8); ctx.lineTo(108, 8); ctx.lineTo(128, 48); ctx.fill();
    ctx.fillStyle = shade(roof, -0.25);
    for (let y = 16; y < 46; y += 8) ctx.fillRect(4 + (46 - y) * 0.2, y, 120 - (46 - y) * 0.4, 2);
    rect(ctx, 18, 6, 92, 4, shade(roof, -0.35));
    // Детали по месту
    if (place === 'smith') { rect(ctx, 96, 0, 12, 16, '#4a4448'); circle(ctx, 102, 0, 5, 'rgba(160,160,160,.5)'); rect(ctx, 100, 82, 18, 10, '#2a2a2e'); rect(ctx, 104, 78, 10, 4, '#3a3a40'); }
    if (place === 'alchemy') { circle(ctx, 30, 98, 5, '#7ad84a'); circle(ctx, 42, 100, 4, '#c070ff'); circle(ctx, 98, 98, 5, '#ff6a8a'); }
    if (place === 'runes') { rect(ctx, 61, 20, 6, 16, glow); rect(ctx, 56, 26, 16, 3, glow); }
    if (place === 'warehouse') { rect(ctx, 92, 90, 16, 16, '#8a6a3a'); rect(ctx, 92, 97, 16, 2, '#5a3a1a'); rect(ctx, 18, 92, 14, 14, '#8a6a3a'); }
    if (place === 'arena') { rect(ctx, 54, 18, 20, 4, '#e8d070'); rect(ctx, 50, 14, 4, 12, '#c0c8d0'); rect(ctx, 74, 14, 4, 12, '#c0c8d0'); }
    if (place === 'survival') { circle(ctx, 64, 26, 8, '#e8e2cc'); rect(ctx, 60, 24, 3, 3, '#1a1a1a'); rect(ctx, 66, 24, 3, 3, '#1a1a1a'); rect(ctx, 61, 30, 6, 2, '#1a1a1a'); }
    if (place === 'trainer') { circle(ctx, 64, 26, 9, glow); rect(ctx, 63, 18, 2, 16, beam); }
    return c;
  }
  function shade(hexCol, k) {
    const n = parseInt(hexCol.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
  }

  // Герои (32x32). Внешность задаётся параметрами look из server/config.js (HEROES[id].look)
  function hero(look = {}) {
    const [c, ctx] = canvas(32, 32);
    const L = Object.assign({ body: '#888', trim: '#5a3a1a', legs: '#3b2a1a', skin: '#f2c9a0', headColor: '#555' }, look);
    circle(ctx, 16, 29, 9, 'rgba(0,0,0,.25)'); // тень
    // Плащ за спиной
    if (L.cape) { rect(ctx, 8, 13, 12, 14, L.cape); }
    if (L.wings) {
      // Полупрозрачные крылья феи за спиной
      ctx.fillStyle = L.wingColor || 'rgba(180,255,220,.55)';
      ctx.beginPath(); ctx.ellipse(6, 15, 5, 8, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(26, 15, 5, 8, 0.4, 0, Math.PI * 2); ctx.fill();
    }
    // Оружие за спиной / в руке (рисуется до тела, если двуручное)
    if (L.weapon === 'scythe') {
      rect(ctx, 25, 2, 2, 27, '#3a2a1a');
      ctx.fillStyle = '#cfd6e0'; ctx.beginPath(); ctx.moveTo(26, 2); ctx.quadraticCurveTo(14, 0, 9, 8); ctx.lineTo(13, 6); ctx.quadraticCurveTo(20, 3, 26, 5); ctx.fill();
    }
    if (L.weapon === 'greatsword') {
      // Тяжёлый двуручный меч за спиной/в руке
      const gc = L.bladeColor || '#9aa3ad';
      rect(ctx, 23, 0, 5, 22, gc); rect(ctx, 24, 0, 2, 22, L.bladeColor ? '#8affc0' : '#d6dde6'); rect(ctx, 23, 0, 5, 1, '#6b7380');
      rect(ctx, 20, 21, 11, 2, '#5a3a1a'); rect(ctx, 24, 23, 3, 6, '#3a2a1a');
      if (!L.bladeColor) rect(ctx, 23, 8, 5, 2, '#8a1a10'); // кровь на клинке
    }
    if (L.weapon === 'totemStaff') {
      // Посох с черепом-тотемом и перьями
      rect(ctx, 25, 5, 2, 25, '#6b4423'); rect(ctx, 23, 1, 6, 5, '#e8e2cc'); rect(ctx, 24, 3, 1, 1, '#222'); rect(ctx, 27, 3, 1, 1, '#222');
      rect(ctx, 22, 6, 2, 5, '#c0301e'); rect(ctx, 28, 6, 2, 5, '#3a8fd8'); circle(ctx, 26, 8, 1.5, L.gem || '#9ff0ff');
    }
    if (L.weapon === 'spear') {
      rect(ctx, 25, 2, 2, 28, '#7a5230');
      ctx.fillStyle = '#c9d1e0'; ctx.beginPath(); ctx.moveTo(26, -1); ctx.lineTo(29, 5); ctx.lineTo(23, 5); ctx.fill();
      rect(ctx, 24, 6, 4, 2, '#c0301e'); // повязка
    }
    if (L.weapon === 'claws') {
      rect(ctx, 23, 18, 2, 4, '#f2ecd8'); rect(ctx, 25, 19, 2, 4, '#f2ecd8'); rect(ctx, 6, 18, 2, 4, '#f2ecd8'); rect(ctx, 4, 19, 2, 4, '#f2ecd8');
    }
    if (L.scales) { rect(ctx, 10, 15, 2, 2, L.scales); rect(ctx, 20, 17, 2, 2, L.scales); rect(ctx, 13, 22, 2, 1, L.scales); }
    if (L.weapon === 'fists') {
      // Массивные каменные руки голема
      rect(ctx, 3, 13, 6, 11, L.body); rect(ctx, 23, 13, 6, 11, L.body);
      rect(ctx, 2, 22, 8, 6, '#6a6560'); rect(ctx, 22, 22, 8, 6, '#6a6560');
      rect(ctx, 5, 16, 2, 2, L.trim); rect(ctx, 25, 16, 2, 2, L.trim); rect(ctx, 14, 17, 4, 2, L.trim); // руны
    }
    if (L.weapon === 'wrench') {
      // Огромный гаечный ключ
      rect(ctx, 24, 8, 3, 18, '#8a8f99'); rect(ctx, 22, 4, 7, 5, '#a8b0b8'); rect(ctx, 24, 4, 3, 2, '#3a3f48');
      rect(ctx, 5, 18, 5, 5, '#3a3a3a'); rect(ctx, 7, 16, 1, 2, '#e86a2a'); // бомба на поясе
    }
    if (L.weapon === 'lute') {
      // Лютня в руках
      ctx.fillStyle = '#b07a3a'; ctx.beginPath(); ctx.ellipse(20, 20, 5, 4, -0.5, 0, Math.PI * 2); ctx.fill();
      circle(ctx, 20, 20, 1.3, '#3a2a1a');
      rect(ctx, 23, 11, 2, 9, '#7a5230'); rect(ctx, 22, 10, 4, 2, '#5a3a1a');
      rect(ctx, 19, 18, 6, 1, '#f2ecd8');
    }
    if (L.weapon === 'pole') { rect(ctx, 26, 1, 2, 30, '#8a5a2a'); rect(ctx, 26, 1, 2, 2, '#c9a64d'); rect(ctx, 26, 29, 2, 2, '#c9a64d'); }
    if (L.weapon === 'axe') {
      rect(ctx, 25, 3, 2, 22, '#6b4423');
      ctx.fillStyle = '#b8c0c8';
      ctx.beginPath(); ctx.moveTo(26, 3); ctx.lineTo(31, 1); ctx.lineTo(31, 12); ctx.lineTo(26, 9); ctx.fill();
      ctx.beginPath(); ctx.moveTo(26, 3); ctx.lineTo(21, 1); ctx.lineTo(21, 11); ctx.lineTo(26, 9); ctx.fill();
    }
    // Ноги и тело
    if (L.fishTail) {
      // Рыбий хвост вместо ног (тритон, сирена)
      ctx.fillStyle = L.legs; ctx.beginPath(); ctx.moveTo(10, 23); ctx.lineTo(22, 23); ctx.quadraticCurveTo(20, 28, 17, 29); ctx.lineTo(15, 29); ctx.quadraticCurveTo(12, 27, 10, 23); ctx.fill();
      ctx.beginPath(); ctx.moveTo(16, 28); ctx.lineTo(10, 31); ctx.lineTo(13, 27); ctx.fill(); ctx.beginPath(); ctx.moveTo(16, 28); ctx.lineTo(22, 31); ctx.lineTo(19, 27); ctx.fill();
      rect(ctx, 13, 25, 2, 1, L.trim); rect(ctx, 17, 26, 2, 1, L.trim);
    } else if (L.flameBody) {
      // Джинн: вместо ног — огненный вихрь
      ctx.fillStyle = L.legs; ctx.beginPath(); ctx.moveTo(9, 23); ctx.lineTo(23, 23); ctx.quadraticCurveTo(20, 28, 14, 31); ctx.quadraticCurveTo(15, 27, 9, 23); ctx.fill();
      ctx.fillStyle = L.trim; ctx.beginPath(); ctx.moveTo(12, 23); ctx.lineTo(20, 23); ctx.quadraticCurveTo(17, 26, 15, 29); ctx.fill();
    } else { rect(ctx, 11, 24, 4, 6, L.legs); rect(ctx, 17, 24, 4, 6, L.legs); }
    rect(ctx, 9, 14, 14, 11, L.body);
    rect(ctx, 9, 21, 14, 2, L.trim); // пояс
    if (['wizard', 'halo', 'leafCrown'].includes(L.head) || L.weapon === 'scythe') rect(ctx, 9, 24, 14, 4, L.body); // мантия
    rect(ctx, 15, 14, 2, 7, L.trim); // застёжка
    // Голова
    rect(ctx, 11, 5, 10, 10, L.skin);
    if (L.hair) rect(ctx, 10, 4, 12, 3, L.hair);
    if (L.beard) { rect(ctx, 11, 11, 10, 4, L.beard); rect(ctx, 13, 15, 6, 2, L.beard); }
    rect(ctx, 17, 8, 2, 2, L.eyes || '#222');
    switch (L.head) {
      case 'helmet':
        rect(ctx, 10, 3, 12, 5, L.headColor); rect(ctx, 10, 7, 2, 5, L.headColor);
        if (L.plume) rect(ctx, 15, 0, 2, 4, L.plume);
        break;
      case 'hood':
        rect(ctx, 10, 3, 12, 4, L.headColor); rect(ctx, 9, 5, 2, 9, L.headColor); rect(ctx, 21, 4, 3, 2, L.headColor);
        if (L.eyes) { rect(ctx, 11, 7, 10, 4, '#0b0810'); rect(ctx, 13, 8, 2, 2, L.eyes); rect(ctx, 17, 8, 2, 2, L.eyes); }
        break;
      case 'wizard':
        if (L.longHair && L.hair) { rect(ctx, 9, 6, 2, 13, L.hair); rect(ctx, 21, 6, 2, 13, L.hair); }
        ctx.fillStyle = L.headColor;
        ctx.beginPath(); ctx.moveTo(7, 7); ctx.lineTo(25, 7); ctx.lineTo(19, -2); ctx.fill();
        rect(ctx, 8, 6, 16, 2, L.trim);
        break;
      case 'cowl':
        rect(ctx, 10, 3, 12, 5, L.headColor); rect(ctx, 11, 10, 10, 5, L.headColor);
        rect(ctx, 13, 8, 2, 2, L.eyes || '#fff'); rect(ctx, 17, 8, 2, 2, L.eyes || '#fff');
        break;
      case 'horns':
        rect(ctx, 10, 3, 12, 4, L.headColor);
        rect(ctx, 7, 1, 3, 4, '#efe6cf'); rect(ctx, 22, 1, 3, 4, '#efe6cf'); rect(ctx, 7, 0, 2, 2, '#efe6cf'); rect(ctx, 23, 0, 2, 2, '#efe6cf');
        break;
      case 'halo':
        if (L.longHair && L.hair) { rect(ctx, 9, 5, 2, 15, L.hair); rect(ctx, 21, 5, 2, 15, L.hair); }
        ctx.strokeStyle = L.headColor; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(16, 2.5, 6, 1.8, 0, 0, Math.PI * 2); ctx.stroke();
        break;
      case 'wild':
        // Растрёпанные волосы, боевая раскраска
        rect(ctx, 10, 2, 12, 4, L.hair); rect(ctx, 9, 4, 3, 11, L.hair); rect(ctx, 20, 4, 3, 9, L.hair);
        rect(ctx, 11, 1, 2, 2, L.hair); rect(ctx, 16, 0, 2, 3, L.hair); rect(ctx, 19, 1, 2, 2, L.hair);
        if (L.paint) rect(ctx, 12, 8, 9, 1, L.paint);
        break;
      case 'crazed':
        // Взъерошенные белые волосы, светящиеся глаза
        rect(ctx, 10, 3, 12, 3, L.hair);
        [[9, 1], [12, 0], [15, 1], [18, 0], [21, 2]].forEach(([x, y]) => rect(ctx, x, y, 2, 4, L.hair));
        rect(ctx, 13, 8, 2, 2, L.eyes); rect(ctx, 17, 8, 2, 2, L.eyes);
        ctx.fillStyle = 'rgba(255,30,30,.35)'; ctx.fillRect(12, 7, 8, 4);
        rect(ctx, 13, 12, 6, 1, '#7a1020'); // оскал
        break;
      case 'antlers':
        // Длинные светлые волосы и рогатый венец из ветвей с перьями
        rect(ctx, 10, 4, 12, 3, L.hair); rect(ctx, 9, 6, 2, 13, L.hair); rect(ctx, 21, 6, 2, 13, L.hair);
        rect(ctx, 9, 0, 2, 5, '#8a6a3a'); rect(ctx, 7, 0, 2, 2, '#8a6a3a'); rect(ctx, 21, 0, 2, 5, '#8a6a3a'); rect(ctx, 23, 0, 2, 2, '#8a6a3a');
        rect(ctx, 14, 2, 4, 2, '#c9a64d'); rect(ctx, 15, 1, 2, 1, '#9ff0ff');
        break;
      case 'dragonHorns':
        // Рыжие волосы, драконьи рога назад, чешуйки на скулах
        rect(ctx, 10, 3, 12, 3, L.hair); rect(ctx, 9, 5, 2, 13, L.hair); rect(ctx, 21, 5, 2, 13, L.hair);
        rect(ctx, 8, 1, 3, 2, '#3a2a20'); rect(ctx, 6, 0, 3, 2, '#3a2a20'); rect(ctx, 21, 1, 3, 2, '#3a2a20'); rect(ctx, 23, 0, 3, 2, '#3a2a20');
        rect(ctx, 13, 8, 2, 2, L.eyes); rect(ctx, 17, 8, 2, 2, L.eyes);
        rect(ctx, 11, 11, 2, 1, L.scales); rect(ctx, 19, 11, 2, 1, L.scales);
        break;
      case 'darkHelm':
        // Закрытый шлем с гребнем и фиолетовой прорезью
        rect(ctx, 10, 3, 12, 12, L.headColor); rect(ctx, 15, 0, 2, 4, '#4a3a5a'); rect(ctx, 14, 1, 4, 1, '#4a3a5a');
        rect(ctx, 11, 8, 10, 2, '#0a080c'); rect(ctx, 13, 8, 2, 2, L.eyes); rect(ctx, 17, 8, 2, 2, L.eyes);
        rect(ctx, 10, 13, 12, 2, '#3a3440');
        break;
      case 'golem':
        // Каменная голова без шеи, светящиеся руны
        rect(ctx, 9, 3, 14, 12, L.headColor); rect(ctx, 9, 3, 14, 2, '#7a7570'); rect(ctx, 11, 12, 10, 3, '#5a5550');
        rect(ctx, 12, 8, 3, 2, L.eyes); rect(ctx, 17, 8, 3, 2, L.eyes);
        rect(ctx, 15, 4, 2, 3, L.eyes); rect(ctx, 20, 6, 1, 4, '#4a4540'); rect(ctx, 11, 5, 1, 3, '#4a4540'); // руна и трещины
        break;
      case 'goggles':
        // Рыжие косички и очки-гогглы на лбу
        rect(ctx, 10, 3, 12, 4, L.hair); rect(ctx, 8, 6, 3, 9, L.hair); rect(ctx, 21, 6, 3, 9, L.hair);
        rect(ctx, 7, 14, 3, 3, L.hair); rect(ctx, 22, 14, 3, 3, L.hair);
        rect(ctx, 10, 4, 12, 2, '#5a3a1a'); circle(ctx, 13, 5, 2, '#9ad8ff'); circle(ctx, 19, 5, 2, '#9ad8ff');
        rect(ctx, 13, 12, 6, 1, '#a04a3a');
        break;
      case 'wingHelm':
        // Крылатый шлем валькирии и золотые косы
        rect(ctx, 10, 2, 12, 5, '#d8dde6'); rect(ctx, 15, 1, 2, 2, '#e8c26a');
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.moveTo(10, 4); ctx.lineTo(4, 0); ctx.lineTo(6, 6); ctx.fill();
        ctx.beginPath(); ctx.moveTo(22, 4); ctx.lineTo(28, 0); ctx.lineTo(26, 6); ctx.fill();
        if (L.hair) { rect(ctx, 9, 7, 2, 12, L.hair); rect(ctx, 21, 7, 2, 12, L.hair); }
        break;
      case 'bloodMask':
        // Капюшон и костяная маска с кровавыми полосами
        rect(ctx, 9, 2, 14, 4, '#2a060a'); rect(ctx, 9, 5, 2, 11, '#2a060a'); rect(ctx, 21, 5, 2, 11, '#2a060a');
        rect(ctx, 11, 6, 10, 8, '#e8dcc8'); rect(ctx, 13, 8, 2, 2, L.eyes); rect(ctx, 17, 8, 2, 2, L.eyes);
        rect(ctx, 12, 10, 1, 4, '#a0101a'); rect(ctx, 19, 10, 1, 4, '#a0101a'); rect(ctx, 15, 11, 2, 1, '#a0101a');
        break;
      case 'witcher':
        // Белые волосы в хвост, кошачьи жёлтые глаза, шрам, медальон
        rect(ctx, 10, 3, 12, 3, L.hair); rect(ctx, 9, 5, 2, 7, L.hair); rect(ctx, 6, 5, 4, 2, L.hair); rect(ctx, 5, 7, 2, 5, L.hair);
        rect(ctx, 13, 8, 2, 2, L.eyes); rect(ctx, 17, 8, 2, 2, L.eyes); rect(ctx, 14, 8, 1, 2, '#222'); rect(ctx, 18, 8, 1, 2, '#222');
        rect(ctx, 19, 6, 1, 5, '#a04a3a'); // шрам
        rect(ctx, 11, 12, 10, 2, '#bfb8b0'); // щетина
        rect(ctx, 15, 16, 2, 2, '#c0c8d0'); // медальон
        break;
      case 'featherCap':
        // Берет набок с длинным пером, кудри
        rect(ctx, 9, 3, 14, 3, L.headColor); rect(ctx, 19, 2, 5, 2, L.headColor);
        rect(ctx, 21, 0, 2, 3, '#e8c26a'); rect(ctx, 23, 0, 3, 1, '#e8c26a'); rect(ctx, 25, 1, 2, 1, '#c0301e');
        rect(ctx, 10, 6, 2, 5, L.hair); rect(ctx, 20, 6, 2, 4, L.hair);
        rect(ctx, 14, 12, 4, 1, '#8a3a2a'); // ухмылка
        break;
      case 'masquerade':
        // Тёмное каре и золотая маска-домино
        rect(ctx, 10, 3, 12, 4, L.hair); rect(ctx, 9, 5, 3, 9, L.hair); rect(ctx, 20, 5, 3, 9, L.hair);
        rect(ctx, 11, 7, 10, 3, L.headColor); rect(ctx, 13, 8, 2, 1, '#2a1a2a'); rect(ctx, 17, 8, 2, 1, '#2a1a2a');
        rect(ctx, 21, 6, 2, 2, '#ff7ad0'); // перо у маски
        rect(ctx, 14, 12, 4, 1, '#c03070'); // губы
        break;
      case 'orc':
        // Орчиха: чёрные косы, клыки, золотые глаза, серьги
        rect(ctx, 10, 3, 12, 3, L.hair); rect(ctx, 9, 5, 2, 12, L.hair); rect(ctx, 21, 5, 2, 12, L.hair);
        rect(ctx, 9, 16, 2, 2, '#c9a64d'); rect(ctx, 21, 16, 2, 2, '#c9a64d');
        rect(ctx, 13, 8, 2, 2, L.eyes); rect(ctx, 17, 8, 2, 2, L.eyes);
        rect(ctx, 13, 12, 1, 2, '#f2ecd8'); rect(ctx, 18, 12, 1, 2, '#f2ecd8'); // клыки
        rect(ctx, 15, 2, 2, 1, '#b06aff'); // руна на лбу
        break;
      case 'fae':
        // Полуфея: длинные каштановые волосы, венок из цветов
        rect(ctx, 10, 3, 12, 3, L.hair); rect(ctx, 9, 5, 2, 15, L.hair); rect(ctx, 21, 5, 2, 15, L.hair);
        [[10, 2], [14, 1], [18, 2]].forEach(([x, y]) => rect(ctx, x, y, 3, 2, L.headColor));
        rect(ctx, 12, 2, 2, 1, '#7fd36b'); rect(ctx, 16, 2, 2, 1, '#7fd36b');
        break;
      case 'bandana':
        // Рыжий хвост и тёмная повязка на голове
        rect(ctx, 10, 3, 12, 3, L.headColor); rect(ctx, 21, 4, 3, 2, L.headColor); rect(ctx, 23, 6, 2, 2, L.headColor);
        rect(ctx, 10, 6, 2, 4, L.hair); rect(ctx, 6, 5, 4, 3, L.hair); rect(ctx, 5, 8, 3, 6, L.hair); // хвост
        break;
      case 'deathHelm':
        // Закрытый шлем рыцаря смерти с рогами и светящимися глазами
        rect(ctx, 10, 3, 12, 12, L.headColor); rect(ctx, 11, 4, 10, 1, '#5a6460');
        rect(ctx, 12, 8, 8, 2, '#0a0e0c'); rect(ctx, 13, 8, 2, 2, L.eyes); rect(ctx, 17, 8, 2, 2, L.eyes);
        rect(ctx, 15, 11, 2, 4, '#0a0e0c');
        rect(ctx, 8, 2, 2, 5, '#c9c2b0'); rect(ctx, 7, 0, 2, 3, '#c9c2b0'); rect(ctx, 22, 2, 2, 5, '#c9c2b0'); rect(ctx, 23, 0, 2, 3, '#c9c2b0');
        break;
      case 'elf':
        // Длинные светлые волосы, острые уши, повязка на лице
        rect(ctx, 10, 3, 12, 3, L.hair); rect(ctx, 9, 5, 2, 14, L.hair); rect(ctx, 21, 5, 2, 9, L.hair);
        rect(ctx, 22, 7, 3, 2, L.skin); rect(ctx, 24, 6, 1, 1, L.skin); // ухо
        if (L.mask) rect(ctx, 12, 11, 9, 3, '#2a3a48'); // маска
        if (L.eyes && !L.mask) { rect(ctx, 17, 8, 2, 2, L.eyes); rect(ctx, 13, 8, 2, 2, L.eyes); }
        break;
      case 'bearHood':
        // Капюшон из медвежьей головы: уши, морда над лбом
        rect(ctx, 9, 2, 14, 5, L.headColor); rect(ctx, 9, 5, 2, 10, L.headColor); rect(ctx, 21, 5, 2, 10, L.headColor);
        rect(ctx, 9, 0, 3, 3, L.headColor); rect(ctx, 20, 0, 3, 3, L.headColor); rect(ctx, 10, 1, 1, 1, '#2a1a0e'); rect(ctx, 21, 1, 1, 1, '#2a1a0e');
        rect(ctx, 13, 3, 6, 3, '#7a5a3a'); rect(ctx, 15, 3, 2, 1, '#1a0e06');
        rect(ctx, 12, 6, 2, 1, '#fff'); rect(ctx, 18, 6, 2, 1, '#fff'); // клыки
        break;
      case 'monk':
        // Бритая голова с пучком на макушке
        rect(ctx, 11, 4, 10, 2, L.skin);
        rect(ctx, 14, 1, 4, 3, L.headColor); rect(ctx, 15, 3, 2, 2, L.headColor);
        rect(ctx, 12, 7, 3, 1, '#3a2a1a'); rect(ctx, 17, 7, 3, 1, '#3a2a1a');
        break;
      case 'elemental':
        // Чистое пламя: голова-костёр без лица, только глаза
        rect(ctx, 11, 5, 10, 10, L.legs); rect(ctx, 12, 6, 8, 8, L.body);
        ctx.fillStyle = L.trim; ctx.beginPath(); ctx.moveTo(10, 8); ctx.lineTo(12, 0); ctx.lineTo(15, 5); ctx.lineTo(17, -2); ctx.lineTo(20, 4); ctx.lineTo(22, 1); ctx.lineTo(22, 8); ctx.fill();
        rect(ctx, 13, 9, 2, 2, L.eyes); rect(ctx, 17, 9, 2, 2, L.eyes);
        rect(ctx, 7, 12, 2, 3, L.trim); rect(ctx, 24, 10, 2, 3, L.trim); // искры
        break;
      case 'lavaHead':
        // Голова из застывшей лавы с раскалёнными трещинами
        rect(ctx, 10, 3, 12, 12, L.skin); rect(ctx, 12, 2, 8, 2, L.skin);
        rect(ctx, 12, 5, 1, 4, L.trim); rect(ctx, 13, 8, 3, 1, L.trim); rect(ctx, 19, 4, 1, 3, L.trim); rect(ctx, 18, 12, 3, 1, L.trim);
        rect(ctx, 13, 9, 2, 2, L.eyes); rect(ctx, 17, 9, 2, 2, L.eyes); rect(ctx, 14, 13, 4, 1, '#ff8a2a');
        rect(ctx, 11, 0, 2, 2, 'rgba(120,120,120,.6)'); rect(ctx, 19, -1, 2, 2, 'rgba(120,120,120,.5)'); // пепел
        break;
      case 'stoneHood':
        // Каменный капюшон геоманта с кристаллом
        rect(ctx, 9, 2, 14, 5, L.headColor); rect(ctx, 9, 5, 2, 9, L.headColor); rect(ctx, 21, 5, 2, 9, L.headColor);
        rect(ctx, 14, 1, 4, 3, '#7ad87a'); rect(ctx, 15, 0, 2, 1, '#bff0bf');
        rect(ctx, 10, 3, 3, 2, '#8a7a5a'); rect(ctx, 19, 3, 2, 2, '#5a4a3a');
        break;
      case 'gorgon':
        // Волосы-змеи и светящиеся глаза
        rect(ctx, 10, 3, 12, 3, L.hair);
        [[8, 4], [10, 0], [14, -1], [18, 0], [22, 3], [23, 8], [7, 9]].forEach(([x, y]) => { rect(ctx, x, y, 2, 5, L.hair); rect(ctx, x, y, 2, 1, '#ffe040'); });
        rect(ctx, 9, 6, 2, 10, L.hair); rect(ctx, 21, 6, 2, 8, L.hair);
        rect(ctx, 13, 8, 2, 2, L.eyes); rect(ctx, 17, 8, 2, 2, L.eyes); rect(ctx, 15, 12, 2, 1, '#2a4a2a');
        break;
      case 'troll':
        // Тролль: длинный нос, клыки, листва вместо волос
        rect(ctx, 10, 3, 12, 3, L.hair); rect(ctx, 8, 2, 3, 3, L.hair); rect(ctx, 21, 1, 3, 3, L.hair); rect(ctx, 14, 0, 4, 3, '#7ac04a');
        rect(ctx, 20, 9, 4, 3, L.skin); rect(ctx, 22, 7, 2, 2, '#5a3a20');
        rect(ctx, 23, 4, 3, 2, L.skin); rect(ctx, 6, 6, 3, 2, L.skin); // уши
        rect(ctx, 13, 13, 1, 2, '#f2ecd8'); rect(ctx, 18, 13, 1, 2, '#f2ecd8');
        rect(ctx, 13, 8, 2, 2, L.eyes); rect(ctx, 17, 8, 2, 2, L.eyes);
        break;
      case 'crystalCrown':
        // Гномка с короной из самоцветов
        rect(ctx, 10, 3, 12, 3, L.hair); rect(ctx, 9, 5, 2, 9, L.hair); rect(ctx, 21, 5, 2, 9, L.hair);
        [[11, '#ff5a7a'], [15, '#5ab8ff'], [19, '#7ad87a']].forEach(([x, c]) => { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x + 1, -1); ctx.lineTo(x + 2, 4); ctx.fill(); });
        rect(ctx, 13, 8, 2, 2, '#5a3a8a'); rect(ctx, 17, 8, 2, 2, '#5a3a8a'); rect(ctx, 16, 10, 2, 2, '#e8b090');
        break;
      case 'triton':
        // Тритон: плавник-гребень, жабры, корона из кораллов
        rect(ctx, 11, 3, 10, 3, L.headColor); rect(ctx, 14, 0, 4, 4, L.headColor); rect(ctx, 15, -1, 2, 2, '#bfeee6');
        rect(ctx, 8, 6, 3, 5, L.headColor); rect(ctx, 21, 6, 3, 5, L.headColor); // плавники-уши
        rect(ctx, 12, 12, 1, 2, '#2a6a6a'); rect(ctx, 19, 12, 1, 2, '#2a6a6a');
        rect(ctx, 11, 2, 2, 2, '#e8d070'); rect(ctx, 19, 2, 2, 2, '#e8d070');
        rect(ctx, 13, 8, 2, 2, L.eyes); rect(ctx, 17, 8, 2, 2, L.eyes);
        break;
      case 'siren':
        // Сирена: длинные волосы цвета морской волны с ракушкой
        rect(ctx, 10, 3, 12, 3, L.hair); rect(ctx, 9, 5, 2, 17, L.hair); rect(ctx, 21, 5, 2, 17, L.hair); rect(ctx, 8, 14, 2, 8, L.hair);
        circle(ctx, 20, 4, 2.2, '#ffd0d8'); rect(ctx, 19, 3, 1, 3, '#e8a0b0');
        rect(ctx, 13, 8, 2, 2, L.eyes); rect(ctx, 17, 8, 2, 2, L.eyes); rect(ctx, 15, 12, 2, 1, '#c86a8a');
        rect(ctx, 11, 15, 4, 3, '#f0e0b0'); rect(ctx, 17, 15, 4, 3, '#f0e0b0'); // ракушки
        break;
      case 'moonCirclet':
        // Серебряный обруч с полумесяцем, длинные лунные волосы
        rect(ctx, 10, 3, 12, 3, L.hair); rect(ctx, 9, 5, 2, 15, L.hair); rect(ctx, 21, 5, 2, 15, L.hair);
        rect(ctx, 10, 5, 12, 1, '#c8d0ff');
        circle(ctx, 16, 2, 2.5, '#f4f6ff'); circle(ctx, 17, 1.5, 2, L.body);
        rect(ctx, 13, 8, 2, 2, '#8a9aff'); rect(ctx, 17, 8, 2, 2, '#8a9aff');
        break;
      case 'birdman':
        // Ааракоа: птичья голова, клюв, хохолок из перьев
        rect(ctx, 10, 3, 12, 11, L.headColor); rect(ctx, 21, 8, 5, 3, '#e8a030'); rect(ctx, 21, 10, 4, 1, '#b07020');
        rect(ctx, 17, 6, 2, 2, L.eyes); rect(ctx, 11, 1, 2, 4, '#c05a2a'); rect(ctx, 14, 0, 2, 4, '#e8a030'); rect(ctx, 8, 2, 3, 2, '#c05a2a');
        rect(ctx, 10, 12, 12, 2, '#c8a868');
        break;
      case 'djinn':
        // Огненный джинн: голова-пламя
        rect(ctx, 11, 5, 10, 10, '#ff8a2a'); rect(ctx, 12, 6, 8, 8, L.skin);
        ctx.fillStyle = '#ffd03a'; ctx.beginPath(); ctx.moveTo(10, 6); ctx.lineTo(13, 0); ctx.lineTo(16, 4); ctx.lineTo(19, -1); ctx.lineTo(22, 6); ctx.fill();
        rect(ctx, 13, 8, 2, 2, L.eyes); rect(ctx, 17, 8, 2, 2, L.eyes); rect(ctx, 14, 12, 4, 1, '#c03010');
        break;
      case 'runeHelm':
        // Шлем дварфа с горящей руной
        rect(ctx, 10, 2, 12, 6, L.headColor); rect(ctx, 9, 6, 14, 2, '#6a6f78'); rect(ctx, 15, 3, 2, 3, '#5fb0ff'); rect(ctx, 14, 4, 4, 1, '#5fb0ff');
        rect(ctx, 7, 3, 3, 2, '#e8e2cc'); rect(ctx, 22, 3, 3, 2, '#e8e2cc');
        break;
      case 'leafCrown':
        rect(ctx, 10, 3, 12, 2, L.headColor);
        [[10, 1], [14, 0], [18, 0], [21, 1]].forEach(([x, y]) => rect(ctx, x, y, 2, 3, L.headColor));
        if (L.hair) { rect(ctx, 9, 5, 2, 12, L.hair); rect(ctx, 21, 5, 2, 12, L.hair); }
        break;
    }
    // Оружие в руке
    switch (L.weapon) {
      case 'trident':
        rect(ctx, 25, 4, 2, 25, '#c9a64d'); rect(ctx, 22, 4, 8, 2, '#e8d070');
        rect(ctx, 22, 0, 2, 5, '#e8d070'); rect(ctx, 25, -1, 2, 5, '#fff0a0'); rect(ctx, 28, 0, 2, 5, '#e8d070');
        break;
      case 'sword': rect(ctx, 24, 6, 3, 16, '#dfe6ee'); rect(ctx, 22, 20, 7, 2, '#8a6a2a'); break;
      case 'mace':
        rect(ctx, 25, 10, 2, 14, '#6b4423'); circle(ctx, 26, 9, 4, '#9aa3ad');
        rect(ctx, 25, 4, 2, 2, '#c9ced6'); rect(ctx, 29, 8, 2, 2, '#c9ced6'); rect(ctx, 21, 8, 2, 2, '#c9ced6');
        break;
      case 'staff': rect(ctx, 25, 4, 2, 24, '#7a5230'); circle(ctx, 26, 4, 3, L.gem || '#7fe7ff'); break;
      case 'bow':
        ctx.strokeStyle = '#8a5a2a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(22, 17, 9, -1.2, 1.2); ctx.stroke();
        ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(25.5, 8.5); ctx.lineTo(25.5, 25.5); ctx.stroke();
        rect(ctx, 5, 12, 4, 12, '#6b4423');
        break;
      case 'daggers':
        rect(ctx, 24, 15, 2, 7, '#c9d1e0'); rect(ctx, 23, 21, 4, 2, L.trim);
        rect(ctx, 6, 15, 2, 7, '#c9d1e0'); rect(ctx, 5, 21, 4, 2, L.trim);
        break;
    }
    if (L.weapon === 'dualBlades') {
      // Два изогнутых клинка в обеих руках
      const bc = L.bladeColor || '#c9d1e0';
      rect(ctx, 24, 9, 2, 13, bc); rect(ctx, 26, 8, 1, 4, bc); rect(ctx, 23, 21, 4, 2, '#5a1a1a');
      rect(ctx, 6, 9, 2, 13, bc); rect(ctx, 5, 8, 1, 4, bc); rect(ctx, 5, 21, 4, 2, '#5a1a1a');
      if (L.bloodied) { rect(ctx, 24, 12, 2, 3, '#a01020'); rect(ctx, 6, 14, 2, 3, '#a01020'); }
    }
    if (L.chains) { for (let i = 0; i < 4; i++) rect(ctx, 10 + i * 3, 17 + (i % 2), 2, 1, L.chains); }
    if (L.fur) { rect(ctx, 8, 13, 16, 3, L.fur); rect(ctx, 9, 12, 3, 2, L.fur); rect(ctx, 20, 12, 3, 2, L.fur); } // меховой ворот
    if (L.beads) for (let i = 0; i < 5; i++) rect(ctx, 10 + i * 3, 14 + (i % 2), 2, 2, L.beads); // чётки
    if (L.weapon === 'greatsword') {
      // Тяжёлый двуручный меч за спиной/в руке
      const gc = L.bladeColor || '#9aa3ad';
      rect(ctx, 23, 0, 5, 22, gc); rect(ctx, 24, 0, 2, 22, L.bladeColor ? '#8affc0' : '#d6dde6'); rect(ctx, 23, 0, 5, 1, '#6b7380');
      rect(ctx, 20, 21, 11, 2, '#5a3a1a'); rect(ctx, 24, 23, 3, 6, '#3a2a1a');
      if (!L.bladeColor) rect(ctx, 23, 8, 5, 2, '#8a1a10'); // кровь на клинке
    }
    if (L.weapon === 'totemStaff') {
      // Посох с черепом-тотемом и перьями
      rect(ctx, 25, 5, 2, 25, '#6b4423'); rect(ctx, 23, 1, 6, 5, '#e8e2cc'); rect(ctx, 24, 3, 1, 1, '#222'); rect(ctx, 27, 3, 1, 1, '#222');
      rect(ctx, 22, 6, 2, 5, '#c0301e'); rect(ctx, 28, 6, 2, 5, '#3a8fd8'); circle(ctx, 26, 8, 1.5, L.gem || '#9ff0ff');
    }
    if (L.weapon === 'spear') {
      rect(ctx, 25, 2, 2, 28, '#7a5230');
      ctx.fillStyle = '#c9d1e0'; ctx.beginPath(); ctx.moveTo(26, -1); ctx.lineTo(29, 5); ctx.lineTo(23, 5); ctx.fill();
      rect(ctx, 24, 6, 4, 2, '#c0301e'); // повязка
    }
    if (L.weapon === 'lute') {
      // Лютня в руках
      ctx.fillStyle = '#b07a3a'; ctx.beginPath(); ctx.ellipse(20, 20, 5, 4, -0.5, 0, Math.PI * 2); ctx.fill();
      circle(ctx, 20, 20, 1.3, '#3a2a1a');
      rect(ctx, 23, 11, 2, 9, '#7a5230'); rect(ctx, 22, 10, 4, 2, '#5a3a1a');
      rect(ctx, 19, 18, 6, 1, '#f2ecd8');
    }
    if (L.weapon === 'pole') { rect(ctx, 23, 17, 3, 3, L.skin); rect(ctx, 6, 17, 3, 3, L.skin); } // кулаки
    if (L.offhand === 'shield') { rect(ctx, 4, 14, 7, 10, '#7a5230'); rect(ctx, 5, 15, 5, 8, L.trim); rect(ctx, 7, 16, 1, 6, '#7a5230'); }
    // Гномы: тот же спрайт, но ниже и шире
    if (L.short) { const [c2, ctx2] = canvas(32, 32); ctx2.drawImage(c, 0, 0, 32, 32, 1, 7, 30, 25); return c2; }
    return c;
  }

  // Монстры
  function monster(type) {
    const big = type === 'dragon';
    const S = big ? 48 : 32;
    const [c, ctx] = canvas(S, S);
    circle(ctx, S / 2, S - 4, S * 0.3, 'rgba(0,0,0,.25)');
    if (type === 'slime') {
      ctx.fillStyle = '#6fd24a';
      ctx.beginPath(); ctx.ellipse(16, 21, 12, 9, 0, Math.PI, 0); ctx.lineTo(28, 28); ctx.lineTo(4, 28); ctx.fill();
      rect(ctx, 4, 24, 24, 5, '#58b438');
      rect(ctx, 11, 17, 3, 4, '#fff'); rect(ctx, 18, 17, 3, 4, '#fff');
      rect(ctx, 12, 18, 2, 3, '#123'); rect(ctx, 19, 18, 2, 3, '#123');
      rect(ctx, 9, 15, 3, 2, '#b6f59a');
    } else if (type === 'wolf') {
      rect(ctx, 6, 14, 18, 9, '#8d8d8d'); // тело
      rect(ctx, 20, 9, 9, 8, '#9d9d9d'); rect(ctx, 27, 13, 4, 4, '#7d7d7d'); // голова
      rect(ctx, 21, 6, 3, 4, '#7d7d7d'); rect(ctx, 25, 6, 3, 4, '#7d7d7d'); // уши
      rect(ctx, 25, 11, 2, 2, '#ff3030');
      rect(ctx, 7, 23, 3, 6, '#6d6d6d'); rect(ctx, 19, 23, 3, 6, '#6d6d6d'); rect(ctx, 12, 23, 3, 5, '#6d6d6d');
      rect(ctx, 1, 12, 6, 3, '#7d7d7d'); // хвост
    } else if (type === 'skeleton') {
      rect(ctx, 11, 4, 10, 9, '#ece6cc'); rect(ctx, 13, 7, 2, 3, '#222'); rect(ctx, 17, 7, 2, 3, '#222');
      rect(ctx, 13, 11, 6, 1, '#555');
      rect(ctx, 15, 13, 2, 10, '#ece6cc');
      for (let i = 0; i < 3; i++) rect(ctx, 11, 14 + i * 3, 10, 1, '#ece6cc');
      rect(ctx, 12, 23, 2, 7, '#ece6cc'); rect(ctx, 18, 23, 2, 7, '#ece6cc');
      rect(ctx, 8, 14, 2, 8, '#ece6cc'); rect(ctx, 22, 14, 2, 8, '#ece6cc');
      rect(ctx, 24, 6, 2, 16, '#9aa'); // меч
    } else if (type === 'orc') {
      rect(ctx, 7, 12, 18, 13, '#4f7a28'); rect(ctx, 7, 20, 18, 3, '#5a3a1a');
      rect(ctx, 9, 2, 14, 11, '#5f8f30');
      rect(ctx, 12, 6, 2, 2, '#ff2'); rect(ctx, 18, 6, 2, 2, '#ff2');
      rect(ctx, 11, 10, 2, 3, '#fff'); rect(ctx, 19, 10, 2, 3, '#fff'); // клыки
      rect(ctx, 9, 25, 5, 5, '#3b2a1a'); rect(ctx, 18, 25, 5, 5, '#3b2a1a');
      rect(ctx, 25, 4, 3, 20, '#6b4423'); rect(ctx, 23, 3, 8, 6, '#999'); // топор
    } else if (type === 'dragon') {
      ctx.fillStyle = '#7a1c18';
      ctx.beginPath(); ctx.moveTo(10, 22); ctx.lineTo(2, 6); ctx.lineTo(20, 16); ctx.fill(); // крыло
      ctx.beginPath(); ctx.moveTo(38, 22); ctx.lineTo(46, 6); ctx.lineTo(28, 16); ctx.fill();
      ctx.fillStyle = '#b0302a';
      ctx.beginPath(); ctx.ellipse(24, 28, 13, 10, 0, 0, Math.PI * 2); ctx.fill();
      rect(ctx, 18, 10, 12, 10, '#c03a30');
      rect(ctx, 20, 13, 2, 2, '#ffde3a'); rect(ctx, 26, 13, 2, 2, '#ffde3a');
      rect(ctx, 19, 7, 2, 4, '#eee'); rect(ctx, 27, 7, 2, 4, '#eee');
      rect(ctx, 18, 35, 4, 7, '#7a1c18'); rect(ctx, 27, 35, 4, 7, '#7a1c18');
      rect(ctx, 20, 25, 8, 6, '#f0a05a');
    }
    return c;
  }

  function projectile(kind) {
    const [c, ctx] = canvas(16, 16);
    if (kind === 'fireball') {
      circle(ctx, 8, 8, 7, 'rgba(255,120,0,.5)'); circle(ctx, 8, 8, 5, '#ff8c1a'); circle(ctx, 8, 8, 2.5, '#fff27a');
    } else if (kind === 'venom') {
      circle(ctx, 8, 8, 7, 'rgba(120,220,60,.35)'); circle(ctx, 8, 8, 4, '#7ad84a'); circle(ctx, 6, 6, 1.5, '#d8ffb0');
    } else if (kind === 'bolt') {
      rect(ctx, 2, 7, 10, 2, '#c9a64d'); rect(ctx, 11, 6, 4, 4, '#e8e2cc'); circle(ctx, 8, 8, 6, 'rgba(255,200,80,.25)');
    } else if (kind === 'blood') {
      ctx.fillStyle = '#c0101a'; ctx.beginPath(); ctx.moveTo(15, 8); ctx.lineTo(3, 5); ctx.lineTo(1, 8); ctx.lineTo(3, 11); ctx.fill();
      circle(ctx, 4, 8, 3, '#7a0610');
    } else if (kind === 'arcane') {
      circle(ctx, 8, 8, 7, 'rgba(160,120,255,.35)'); circle(ctx, 8, 8, 4, '#c8a0ff'); circle(ctx, 8, 8, 1.8, '#ffffff');
    } else if (kind === 'note') {
      rect(ctx, 8, 3, 2, 9, '#ffe08a'); rect(ctx, 10, 3, 4, 2, '#ffe08a'); circle(ctx, 7, 12, 3, '#ffe08a');
      circle(ctx, 8, 9, 7, 'rgba(255,224,138,.25)');
    } else if (kind === 'necro') {
      circle(ctx, 8, 8, 7, 'rgba(60,200,120,.35)'); circle(ctx, 8, 8, 4.5, '#0e1610'); circle(ctx, 8, 8, 2, '#5fffb0');
    } else if (kind === 'frost') {
      ctx.fillStyle = '#bfe8ff'; ctx.beginPath(); ctx.moveTo(15, 8); ctx.lineTo(8, 4); ctx.lineTo(1, 8); ctx.lineTo(8, 12); ctx.fill();
      circle(ctx, 8, 8, 7, 'rgba(140,210,255,.3)'); rect(ctx, 6, 7, 6, 2, '#ffffff');
    } else if (kind === 'spark') {
      circle(ctx, 8, 8, 7, 'rgba(255,240,120,.35)');
      ctx.strokeStyle = '#fff6a0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(2, 4); ctx.lineTo(8, 8); ctx.lineTo(5, 10); ctx.lineTo(14, 13); ctx.stroke();
    } else if (kind === 'illusion') {
      circle(ctx, 8, 8, 7, 'rgba(255,120,210,.35)'); circle(ctx, 8, 8, 4, '#ffb0e8'); rect(ctx, 7, 3, 2, 10, 'rgba(255,255,255,.7)');
    } else if (kind === 'darkfire') {
      circle(ctx, 8, 8, 7, 'rgba(120,40,180,.45)'); circle(ctx, 8, 9, 5, '#1a0a20'); circle(ctx, 8, 7, 3, '#7a2ab0'); rect(ctx, 7, 2, 2, 3, '#b06aff');
    } else if (kind === 'leaf') {
      ctx.fillStyle = '#5fd17a'; ctx.beginPath(); ctx.ellipse(8, 8, 6, 3, -0.5, 0, Math.PI * 2); ctx.fill(); rect(ctx, 3, 10, 6, 1, '#2f7a4a');
    } else if (kind === 'shadow') {
      circle(ctx, 8, 8, 7, 'rgba(110,40,160,.45)'); circle(ctx, 8, 8, 4.5, '#1a0a24'); circle(ctx, 8, 8, 2, '#c070ff');
    } else if (kind === 'dagger') {
      rect(ctx, 2, 7, 4, 2, '#3a2a1a'); ctx.fillStyle = '#d8e0ea'; ctx.beginPath(); ctx.moveTo(15, 8); ctx.lineTo(6, 5); ctx.lineTo(6, 11); ctx.fill();
    } else if (kind === 'spear') {
      rect(ctx, 0, 7, 12, 2, '#7a5230'); ctx.fillStyle = '#c9d1e0'; ctx.beginPath(); ctx.moveTo(16, 8); ctx.lineTo(11, 5); ctx.lineTo(11, 11); ctx.fill();
    } else if (kind === 'spirit') {
      circle(ctx, 8, 8, 7, 'rgba(120,230,255,.35)'); circle(ctx, 8, 8, 4, '#bff6ff'); rect(ctx, 6, 7, 1, 1, '#2a6a80'); rect(ctx, 9, 7, 1, 1, '#2a6a80');
    } else if (kind === 'stone') {
      circle(ctx, 8, 8, 6, '#6e6a66'); circle(ctx, 7, 7, 4, '#8f8a84'); rect(ctx, 5, 5, 2, 2, '#b0aaa2');
    } else if (kind === 'holy') {
      circle(ctx, 8, 8, 7, 'rgba(255,240,150,.45)'); circle(ctx, 8, 8, 4, '#fff6c0'); rect(ctx, 7, 3, 2, 10, '#fff'); rect(ctx, 3, 7, 10, 2, '#fff');
    } else if (kind === 'nature') {
      circle(ctx, 8, 8, 7, 'rgba(120,255,160,.4)'); circle(ctx, 8, 8, 4, '#7fe08a'); rect(ctx, 6, 5, 4, 2, '#d8ffb0');
    } else if (kind === 'dark') {
      circle(ctx, 8, 8, 7, 'rgba(150,60,255,.45)'); circle(ctx, 8, 8, 5, '#3a0a5a'); circle(ctx, 8, 8, 2.5, '#d08cff');
    } else if (kind === 'crystal') {
      circle(ctx, 8, 8, 7, 'rgba(200,140,255,.35)');
      ctx.fillStyle = '#d8b0ff'; ctx.beginPath(); ctx.moveTo(15, 8); ctx.lineTo(8, 4); ctx.lineTo(2, 8); ctx.lineTo(8, 12); ctx.fill();
      rect(ctx, 6, 7, 4, 1, '#ffffff');
    } else if (kind === 'water') {
      circle(ctx, 8, 8, 7, 'rgba(80,170,255,.35)'); ctx.fillStyle = '#5ab8ff'; ctx.beginPath(); ctx.moveTo(15, 8); ctx.quadraticCurveTo(8, 2, 2, 8); ctx.quadraticCurveTo(8, 14, 15, 8); ctx.fill(); rect(ctx, 6, 6, 3, 2, '#d8f0ff');
    } else if (kind === 'sonic') {
      ctx.strokeStyle = '#9ff0e0'; ctx.lineWidth = 1.5;
      [3, 5.5, 8].forEach((r) => { ctx.beginPath(); ctx.arc(4, 8, r, -0.9, 0.9); ctx.stroke(); });
    } else if (kind === 'moon') {
      circle(ctx, 8, 8, 7, 'rgba(200,210,255,.4)'); circle(ctx, 8, 8, 5, '#f4f6ff'); circle(ctx, 10, 7, 4, 'rgba(60,70,140,.9)');
    } else if (kind === 'sand') {
      circle(ctx, 8, 8, 7, 'rgba(230,200,120,.35)'); [[5, 6], [9, 5], [7, 10], [11, 9], [4, 9]].forEach(([x, y]) => rect(ctx, x, y, 2, 2, '#e8c878'));
    } else if (kind === 'rune') {
      circle(ctx, 8, 8, 7, 'rgba(95,176,255,.35)'); rect(ctx, 7, 3, 2, 10, '#bfe0ff'); rect(ctx, 4, 5, 8, 2, '#bfe0ff'); rect(ctx, 9, 9, 3, 2, '#bfe0ff');
    } else if (kind === 'soul') {
      circle(ctx, 8, 8, 7, 'rgba(140,216,255,.35)'); circle(ctx, 9, 8, 4, '#d8f4ff'); rect(ctx, 1, 7, 5, 2, 'rgba(216,244,255,.6)'); rect(ctx, 8, 7, 1, 1, '#2a4a60'); rect(ctx, 10, 7, 1, 1, '#2a4a60');
    } else {
      rect(ctx, 1, 7, 12, 2, '#c8a46a'); rect(ctx, 12, 6, 3, 4, '#ddd'); rect(ctx, 0, 6, 2, 4, '#fff');
    }
    return c;
  }

  // Звериный облик оборотня (32x32): сгорбленный волк-человек
  function werebeast(L = {}) {
    const [c, ctx] = canvas(32, 32);
    const fur = L.fur || '#5a4a3a', light = L.furLight || '#8a7a5a';
    circle(ctx, 16, 29, 10, 'rgba(0,0,0,.25)');
    rect(ctx, 9, 23, 5, 7, fur); rect(ctx, 18, 23, 5, 7, fur); // лапы
    rect(ctx, 8, 12, 16, 12, fur); rect(ctx, 11, 15, 10, 8, light); // торс
    rect(ctx, 4, 13, 4, 10, fur); rect(ctx, 24, 13, 4, 10, fur); // руки
    rect(ctx, 3, 22, 2, 3, L.claws || '#eee'); rect(ctx, 27, 22, 2, 3, L.claws || '#eee'); // когти
    rect(ctx, 11, 3, 12, 10, fur); rect(ctx, 21, 7, 6, 5, light); // голова и морда
    rect(ctx, 11, 0, 3, 4, fur); rect(ctx, 18, 0, 3, 4, fur); // уши
    rect(ctx, 17, 6, 2, 2, L.eyes || '#9aff6a'); rect(ctx, 25, 8, 2, 1, '#1a1a1a');
    rect(ctx, 22, 11, 1, 2, '#fff'); rect(ctx, 25, 11, 1, 2, '#fff'); // клыки
    rect(ctx, 9, 9, 3, 4, light); // грива
    return c;
  }

  // Звери Урсуса (32x32): волк Клык, медведь Бурый, сокол Сокол
  function pet(kind) {
    const [c, ctx] = canvas(32, 32);
    if (kind === 'wolf') {
      circle(ctx, 16, 28, 9, 'rgba(0,0,0,.25)');
      rect(ctx, 6, 15, 18, 8, '#7a5a3a'); rect(ctx, 20, 10, 9, 8, '#8a6a46'); rect(ctx, 27, 14, 4, 3, '#6a4a2a');
      rect(ctx, 21, 7, 3, 4, '#6a4a2a'); rect(ctx, 25, 7, 3, 4, '#6a4a2a'); rect(ctx, 25, 12, 2, 2, '#ffd36a');
      rect(ctx, 19, 16, 3, 3, '#c0301e'); // ошейник
      rect(ctx, 7, 23, 3, 6, '#5a3e24'); rect(ctx, 19, 23, 3, 6, '#5a3e24'); rect(ctx, 12, 23, 3, 5, '#5a3e24');
      rect(ctx, 1, 13, 6, 3, '#6a4a2a');
    } else if (kind === 'bear') {
      circle(ctx, 16, 28, 11, 'rgba(0,0,0,.25)');
      ctx.fillStyle = '#5a3e24'; ctx.beginPath(); ctx.ellipse(15, 19, 12, 8, 0, 0, Math.PI * 2); ctx.fill();
      rect(ctx, 21, 8, 10, 10, '#6b4a2c'); rect(ctx, 21, 6, 3, 3, '#5a3e24'); rect(ctx, 28, 6, 3, 3, '#5a3e24');
      rect(ctx, 27, 13, 4, 4, '#a07a52'); rect(ctx, 29, 13, 2, 1, '#1a0e06'); rect(ctx, 25, 10, 2, 2, '#1a0e06');
      rect(ctx, 6, 24, 5, 6, '#4a3420'); rect(ctx, 19, 24, 5, 6, '#4a3420');
    } else if (kind === 'turret') {
      // Турель на треноге
      circle(ctx, 16, 28, 9, 'rgba(0,0,0,.3)');
      rect(ctx, 8, 22, 3, 7, '#5a4a3a'); rect(ctx, 21, 22, 3, 7, '#5a4a3a'); rect(ctx, 15, 20, 2, 9, '#5a4a3a');
      rect(ctx, 9, 13, 14, 9, '#8a8f99'); rect(ctx, 10, 14, 12, 2, '#c9a64d');
      rect(ctx, 22, 15, 9, 3, '#5a5f68'); rect(ctx, 29, 14, 2, 5, '#3a3f48');
      circle(ctx, 14, 17, 2, '#ff6a3a');
      rect(ctx, 12, 9, 8, 4, '#a8b0b8');
    } else if (kind === 'sprite') {
      // Дух леса: светящаяся дриада из листьев
      circle(ctx, 16, 28, 7, 'rgba(0,0,0,.2)');
      circle(ctx, 16, 16, 13, 'rgba(120,255,160,.22)');
      ctx.fillStyle = '#4fbf6a'; ctx.beginPath(); ctx.ellipse(16, 18, 6, 9, 0, 0, Math.PI * 2); ctx.fill();
      circle(ctx, 16, 8, 5, '#9aff9a'); rect(ctx, 14, 7, 1, 2, '#1a4a2a'); rect(ctx, 17, 7, 1, 2, '#1a4a2a');
      rect(ctx, 11, 3, 2, 4, '#3f8a4a'); rect(ctx, 19, 3, 2, 4, '#3f8a4a');
      rect(ctx, 8, 14, 4, 2, '#3f8a4a'); rect(ctx, 20, 14, 4, 2, '#3f8a4a');
    } else if (kind === 'seaSpirit') {
      // Морской дух: водяной сгусток с глазами и щупальцами
      circle(ctx, 16, 29, 5, 'rgba(0,0,0,.15)');
      circle(ctx, 16, 14, 12, 'rgba(80,170,255,.22)');
      ctx.fillStyle = '#5ab8ff'; ctx.beginPath(); ctx.ellipse(16, 13, 8, 7, 0, 0, Math.PI * 2); ctx.fill();
      [10, 14, 18, 22].forEach((x, i) => rect(ctx, x - 1, 18, 2, 5 + (i % 2) * 3, '#3a8ad8'));
      rect(ctx, 12, 11, 3, 3, '#ffffff'); rect(ctx, 18, 11, 3, 3, '#ffffff'); rect(ctx, 13, 12, 1, 1, '#0a2a4a'); rect(ctx, 19, 12, 1, 1, '#0a2a4a');
      rect(ctx, 13, 8, 4, 1, '#d8f0ff');
    } else if (kind === 'wisp') {
      // Дух-проводник Элнаэрис: светящаяся душа с хвостом
      circle(ctx, 16, 29, 5, 'rgba(0,0,0,.15)');
      circle(ctx, 16, 13, 12, 'rgba(140,216,255,.25)');
      ctx.fillStyle = '#bfeaff'; ctx.beginPath(); ctx.moveTo(10, 14); ctx.quadraticCurveTo(12, 26, 18, 27); ctx.quadraticCurveTo(15, 22, 22, 14); ctx.fill();
      circle(ctx, 16, 12, 6, '#e8f8ff'); rect(ctx, 13, 11, 2, 2, '#2a5a80'); rect(ctx, 18, 11, 2, 2, '#2a5a80');
    } else if (kind === 'skeleton') {
      // Скелет-слуга с зелёным некротическим свечением
      circle(ctx, 16, 28, 8, 'rgba(0,0,0,.25)');
      circle(ctx, 16, 16, 12, 'rgba(63,191,122,.18)');
      rect(ctx, 11, 4, 10, 9, '#d8e8d0'); rect(ctx, 13, 7, 2, 3, '#3fbf7a'); rect(ctx, 17, 7, 2, 3, '#3fbf7a');
      rect(ctx, 15, 13, 2, 9, '#d8e8d0');
      for (let i = 0; i < 3; i++) rect(ctx, 11, 14 + i * 3, 10, 1, '#d8e8d0');
      rect(ctx, 12, 22, 2, 7, '#d8e8d0'); rect(ctx, 18, 22, 2, 7, '#d8e8d0');
      rect(ctx, 22, 8, 2, 14, '#7a8a80');
    } else {
      // Сокол парит над землёй — тень отдельно внизу
      circle(ctx, 16, 29, 6, 'rgba(0,0,0,.2)');
      ctx.fillStyle = '#8a6a46';
      ctx.beginPath(); ctx.moveTo(16, 12); ctx.lineTo(2, 6); ctx.lineTo(8, 14); ctx.fill();
      ctx.beginPath(); ctx.moveTo(16, 12); ctx.lineTo(30, 6); ctx.lineTo(24, 14); ctx.fill();
      rect(ctx, 13, 9, 6, 9, '#a07a52'); rect(ctx, 14, 17, 4, 3, '#6a4a2a');
      rect(ctx, 14, 6, 4, 4, '#e8e2cc'); rect(ctx, 15, 7, 1, 1, '#222'); rect(ctx, 18, 8, 2, 1, '#f0b429');
    }
    return c;
  }

  // Тотем исцеления (16x28)
  function totem() {
    const [c, ctx] = canvas(16, 28);
    circle(ctx, 8, 26, 6, 'rgba(0,0,0,.3)');
    rect(ctx, 5, 6, 6, 21, '#7a5230'); rect(ctx, 4, 8, 8, 5, '#a8784a'); rect(ctx, 4, 16, 8, 4, '#a8784a');
    rect(ctx, 5, 9, 2, 2, '#3fe08a'); rect(ctx, 9, 9, 2, 2, '#3fe08a'); rect(ctx, 6, 17, 4, 1, '#222');
    rect(ctx, 2, 3, 3, 6, '#3a8fd8'); rect(ctx, 11, 3, 3, 6, '#c0301e'); rect(ctx, 6, 1, 4, 5, '#e8e2cc');
    return c;
  }

  function particle() {
    const [c, ctx] = canvas(6, 6);
    rect(ctx, 0, 0, 6, 6, '#ffffff');
    return c;
  }

  return { TILE, tileset, building, THEMES, hero, monster, projectile, particle, totem, pet, werebeast };
})();
