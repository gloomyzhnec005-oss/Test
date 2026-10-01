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

  // Герои (32x32)
  function hero(cls, color) {
    const [c, ctx] = canvas(32, 32);
    const col = hex(color);
    circle(ctx, 16, 29, 9, 'rgba(0,0,0,.25)'); // тень
    rect(ctx, 11, 24, 4, 6, '#3b2a1a'); rect(ctx, 17, 24, 4, 6, '#3b2a1a'); // ноги
    rect(ctx, 9, 14, 14, 11, col); // тело
    rect(ctx, 9, 21, 14, 2, '#5a3a1a'); // пояс
    rect(ctx, 11, 5, 10, 10, '#f2c9a0'); // голова
    rect(ctx, 17, 8, 2, 2, '#222'); // глаз (смотрит вправо)
    if (cls === 'warrior') {
      rect(ctx, 10, 3, 12, 5, '#a8b0b8'); rect(ctx, 15, 1, 2, 3, '#d9534f'); // шлем
      rect(ctx, 24, 6, 3, 16, '#dfe6ee'); rect(ctx, 22, 20, 7, 2, '#8a6a2a'); // меч
      rect(ctx, 4, 14, 6, 9, '#7a5230'); rect(ctx, 5, 16, 4, 5, '#c9a64d'); // щит
    } else if (cls === 'mage') {
      ctx.fillStyle = '#3a4fbf';
      ctx.beginPath(); ctx.moveTo(8, 7); ctx.lineTo(24, 7); ctx.lineTo(17, -2); ctx.fill(); // шляпа
      rect(ctx, 9, 25, 14, 4, col); // мантия
      rect(ctx, 25, 4, 2, 24, '#7a5230'); circle(ctx, 26, 4, 3, '#7fe7ff'); // посох
      rect(ctx, 12, 14, 8, 6, '#cbd6ff');
    } else {
      rect(ctx, 10, 3, 12, 4, '#2f6b2f'); rect(ctx, 21, 4, 4, 2, '#2f6b2f'); // капюшон
      ctx.strokeStyle = '#8a5a2a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(22, 17, 9, -1.2, 1.2); ctx.stroke(); // лук
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(25.5, 8.5); ctx.lineTo(25.5, 25.5); ctx.stroke();
      rect(ctx, 5, 12, 4, 12, '#6b4423'); // колчан
    }
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
    } else {
      rect(ctx, 1, 7, 12, 2, '#c8a46a'); rect(ctx, 12, 6, 3, 4, '#ddd'); rect(ctx, 0, 6, 2, 4, '#fff');
    }
    return c;
  }

  function particle() {
    const [c, ctx] = canvas(6, 6);
    rect(ctx, 0, 0, 6, 6, '#ffffff');
    return c;
  }

  return { TILE, tileset, hero, monster, projectile, particle };
})();
