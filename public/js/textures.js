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

  // Порядок совпадает с T в server/world.js
  function tileset() {
    const [c, ctx] = canvas(TILE * 7, TILE);
    // 0 трава
    speckle(ctx, 0, '#4e9a3a', ['#5fb046', '#3f8530'], 26);
    // 1 вода
    rect(ctx, 32, 0, TILE, TILE, '#2f6fb5');
    for (let i = 0; i < 5; i++) rect(ctx, 32 + 4 + Math.floor(rnd() * 20), 4 + i * 6, 8, 2, '#5592d6');
    // 2 дерево
    speckle(ctx, 64, '#4e9a3a', ['#5fb046', '#3f8530'], 14);
    rect(ctx, 64 + 13, 20, 6, 10, '#6b4423');
    circle(ctx, 64 + 16, 14, 12, '#2d6b22');
    circle(ctx, 64 + 12, 11, 6, '#3f8a2f');
    circle(ctx, 64 + 20, 16, 5, '#24581b');
    // 3 дорога / город
    speckle(ctx, 96, '#c9a66b', ['#b8935a', '#d8b87d'], 30);
    ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.strokeRect(96.5, 0.5, 31, 31);
    // 4 цветы
    speckle(ctx, 128, '#4e9a3a', ['#5fb046', '#3f8530'], 18);
    [['#ff6b9a', 6, 8], ['#ffe14d', 20, 6], ['#ffffff', 12, 20], ['#ff6b9a', 24, 24], ['#b38cff', 4, 26]]
      .forEach(([col, x, y]) => { rect(ctx, 128 + x, y, 3, 3, col); rect(ctx, 128 + x + 1, y + 3, 1, 3, '#2d6b22'); });
    // 5 мёртвая земля
    speckle(ctx, 160, '#6e5a44', ['#5c4a37', '#7e6a52', '#4c5a3a'], 30);
    // 6 скала
    speckle(ctx, 192, '#3c3a38', ['#2c2a28'], 10);
    ctx.fillStyle = '#777270';
    ctx.beginPath(); ctx.moveTo(194, 30); ctx.lineTo(202, 6); ctx.lineTo(212, 12); ctx.lineTo(222, 4); ctx.lineTo(230, 30); ctx.fill();
    ctx.fillStyle = '#9a9592';
    ctx.beginPath(); ctx.moveTo(202, 6); ctx.lineTo(206, 18); ctx.lineTo(212, 12); ctx.fill();
    return c;
  }

  // Герои (32x32). Внешность задаётся параметрами look из server/config.js (HEROES[id].look)
  function hero(look = {}) {
    const [c, ctx] = canvas(32, 32);
    const L = Object.assign({ body: '#888', trim: '#5a3a1a', legs: '#3b2a1a', skin: '#f2c9a0', headColor: '#555' }, look);
    circle(ctx, 16, 29, 9, 'rgba(0,0,0,.25)'); // тень
    // Плащ за спиной
    if (L.cape) { rect(ctx, 8, 13, 12, 14, L.cape); }
    // Оружие за спиной / в руке (рисуется до тела, если двуручное)
    if (L.weapon === 'scythe') {
      rect(ctx, 25, 2, 2, 27, '#3a2a1a');
      ctx.fillStyle = '#cfd6e0'; ctx.beginPath(); ctx.moveTo(26, 2); ctx.quadraticCurveTo(14, 0, 9, 8); ctx.lineTo(13, 6); ctx.quadraticCurveTo(20, 3, 26, 5); ctx.fill();
    }
    if (L.weapon === 'greatsword') {
      // Тяжёлый двуручный меч за спиной/в руке
      rect(ctx, 23, 0, 5, 22, '#9aa3ad'); rect(ctx, 24, 0, 2, 22, '#d6dde6'); rect(ctx, 23, 0, 5, 1, '#6b7380');
      rect(ctx, 20, 21, 11, 2, '#5a3a1a'); rect(ctx, 24, 23, 3, 6, '#3a2a1a');
      rect(ctx, 23, 8, 5, 2, '#8a1a10'); // кровь на клинке
    }
    if (L.weapon === 'totemStaff') {
      // Посох с черепом-тотемом и перьями
      rect(ctx, 25, 5, 2, 25, '#6b4423'); rect(ctx, 23, 1, 6, 5, '#e8e2cc'); rect(ctx, 24, 3, 1, 1, '#222'); rect(ctx, 27, 3, 1, 1, '#222');
      rect(ctx, 22, 6, 2, 5, '#c0301e'); rect(ctx, 28, 6, 2, 5, '#3a8fd8'); circle(ctx, 26, 8, 1.5, L.gem || '#9ff0ff');
    }
    if (L.weapon === 'pole') { rect(ctx, 26, 1, 2, 30, '#8a5a2a'); rect(ctx, 26, 1, 2, 2, '#c9a64d'); rect(ctx, 26, 29, 2, 2, '#c9a64d'); }
    if (L.weapon === 'axe') {
      rect(ctx, 25, 3, 2, 22, '#6b4423');
      ctx.fillStyle = '#b8c0c8';
      ctx.beginPath(); ctx.moveTo(26, 3); ctx.lineTo(31, 1); ctx.lineTo(31, 12); ctx.lineTo(26, 9); ctx.fill();
      ctx.beginPath(); ctx.moveTo(26, 3); ctx.lineTo(21, 1); ctx.lineTo(21, 11); ctx.lineTo(26, 9); ctx.fill();
    }
    // Ноги и тело
    rect(ctx, 11, 24, 4, 6, L.legs); rect(ctx, 17, 24, 4, 6, L.legs);
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
      case 'monk':
        // Бритая голова с пучком на макушке
        rect(ctx, 11, 4, 10, 2, L.skin);
        rect(ctx, 14, 1, 4, 3, L.headColor); rect(ctx, 15, 3, 2, 2, L.headColor);
        rect(ctx, 12, 7, 3, 1, '#3a2a1a'); rect(ctx, 17, 7, 3, 1, '#3a2a1a');
        break;
      case 'leafCrown':
        rect(ctx, 10, 3, 12, 2, L.headColor);
        [[10, 1], [14, 0], [18, 0], [21, 1]].forEach(([x, y]) => rect(ctx, x, y, 2, 3, L.headColor));
        if (L.hair) { rect(ctx, 9, 5, 2, 12, L.hair); rect(ctx, 21, 5, 2, 12, L.hair); }
        break;
    }
    // Оружие в руке
    switch (L.weapon) {
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
      rect(ctx, 24, 9, 2, 13, '#c9d1e0'); rect(ctx, 26, 8, 1, 4, '#c9d1e0'); rect(ctx, 23, 21, 4, 2, '#5a1a1a');
      rect(ctx, 6, 9, 2, 13, '#c9d1e0'); rect(ctx, 5, 8, 1, 4, '#c9d1e0'); rect(ctx, 5, 21, 4, 2, '#5a1a1a');
      rect(ctx, 24, 12, 2, 3, '#a01020'); rect(ctx, 6, 14, 2, 3, '#a01020');
    }
    if (L.chains) { for (let i = 0; i < 4; i++) rect(ctx, 10 + i * 3, 17 + (i % 2), 2, 1, L.chains); }
    if (L.fur) { rect(ctx, 8, 13, 16, 3, L.fur); rect(ctx, 9, 12, 3, 2, L.fur); rect(ctx, 20, 12, 3, 2, L.fur); } // меховой ворот
    if (L.beads) for (let i = 0; i < 5; i++) rect(ctx, 10 + i * 3, 14 + (i % 2), 2, 2, L.beads); // чётки
    if (L.weapon === 'greatsword') {
      // Тяжёлый двуручный меч за спиной/в руке
      rect(ctx, 23, 0, 5, 22, '#9aa3ad'); rect(ctx, 24, 0, 2, 22, '#d6dde6'); rect(ctx, 23, 0, 5, 1, '#6b7380');
      rect(ctx, 20, 21, 11, 2, '#5a3a1a'); rect(ctx, 24, 23, 3, 6, '#3a2a1a');
      rect(ctx, 23, 8, 5, 2, '#8a1a10'); // кровь на клинке
    }
    if (L.weapon === 'totemStaff') {
      // Посох с черепом-тотемом и перьями
      rect(ctx, 25, 5, 2, 25, '#6b4423'); rect(ctx, 23, 1, 6, 5, '#e8e2cc'); rect(ctx, 24, 3, 1, 1, '#222'); rect(ctx, 27, 3, 1, 1, '#222');
      rect(ctx, 22, 6, 2, 5, '#c0301e'); rect(ctx, 28, 6, 2, 5, '#3a8fd8'); circle(ctx, 26, 8, 1.5, L.gem || '#9ff0ff');
    }
    if (L.weapon === 'pole') { rect(ctx, 23, 17, 3, 3, L.skin); rect(ctx, 6, 17, 3, 3, L.skin); } // кулаки
    if (L.offhand === 'shield') { rect(ctx, 4, 14, 7, 10, '#7a5230'); rect(ctx, 5, 15, 5, 8, L.trim); rect(ctx, 7, 16, 1, 6, '#7a5230'); }
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
    } else {
      rect(ctx, 1, 7, 12, 2, '#c8a46a'); rect(ctx, 12, 6, 3, 4, '#ddd'); rect(ctx, 0, 6, 2, 4, '#fff');
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

  return { TILE, tileset, hero, monster, projectile, particle, totem };
})();
