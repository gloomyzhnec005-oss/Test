// Фоны лобби в средневековом фэнтези-стиле. Рисуются процедурно на Canvas
// в любом размере (полный экран и миниатюры в меню).
// Каждая функция возвращает { lights: [{x, y, s}], particles } — точки для анимированных
// факелов и тип летающих частиц.
window.LobbyBg = (() => {
  const HORIZON = 0.47; // линия пола, на которой стоят герои заднего ряда

  function lin(ctx, x0, y0, x1, y1, stops) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    return g;
  }
  function rad(ctx, x, y, r, stops) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    return g;
  }
  function poly(ctx, pts, fill) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  function rng(seed) {
    return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  }
  function vignette(ctx, w, h, strength = 0.75) {
    ctx.fillStyle = rad(ctx, w / 2, h * 0.5, Math.max(w, h) * 0.75, [[0.45, 'rgba(0,0,0,0)'], [1, `rgba(0,0,0,${strength})`]]);
    ctx.fillRect(0, 0, w, h);
  }
  // Пол в перспективе: сходящиеся линии и горизонтальные швы
  function floorGrid(ctx, w, h, y0, color, n = 14) {
    const vx = w / 2, vy = y0 - h * 0.12;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, w / 500);
    for (let i = -n; i <= n; i++) {
      ctx.beginPath();
      const t = (y0 - vy) / (h - vy);
      ctx.moveTo(vx + (i * w / 4) * t, y0);
      ctx.lineTo(vx + i * w / 4, h);
      ctx.stroke();
    }
    for (let k = 1; k < 12; k++) {
      const y = y0 + (h - y0) * Math.pow(k / 12, 1.8);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
  }
  function goldEmblem(ctx, x, y, r) {
    ctx.fillStyle = '#d4a63c';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a - Math.PI / 2) * rr, y + Math.sin(a - Math.PI / 2) * rr);
    }
    ctx.fill();
  }

  // ---------- 1. Тронный зал ----------
  function throne(ctx, w, h) {
    const H = h * HORIZON, u = w / 400;
    const lights = [];
    // Стена
    ctx.fillStyle = lin(ctx, 0, 0, 0, H, [[0, '#0d0b0a'], [0.6, '#221b15'], [1, '#2e251c']]);
    ctx.fillRect(0, 0, w, H);
    // Каменная кладка
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = u;
    for (let y = H; y > 0; y -= 18 * u) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      for (let x = ((y / (18 * u)) % 2) * 20 * u; x < w; x += 40 * u) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 18 * u); ctx.stroke();
      }
    }
    // Готическое окно
    const ww = w * 0.2, wx = w / 2 - ww / 2, wt = h * 0.06, wb = H - h * 0.09;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(wx, wb); ctx.lineTo(wx, wt + ww * 0.6);
    ctx.quadraticCurveTo(wx, wt, w / 2, wt - ww * 0.15);
    ctx.quadraticCurveTo(wx + ww, wt, wx + ww, wt + ww * 0.6);
    ctx.lineTo(wx + ww, wb); ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, wt, 0, wb, [[0, '#cfe9c8'], [0.5, '#8fb37a'], [1, '#c9a24a']]);
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = '#2a2016'; ctx.lineWidth = 3 * u;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(wx + ww * i / 4, wt - ww); ctx.lineTo(wx + ww * i / 4, wb); ctx.stroke(); }
    for (let y = wt + ww * 0.5; y < wb; y += ww * 0.45) { ctx.beginPath(); ctx.moveTo(wx, y); ctx.lineTo(wx + ww, y); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = '#6b5530'; ctx.lineWidth = 4 * u;
    ctx.strokeRect(wx, wt + ww * 0.6, ww, wb - wt - ww * 0.6);
    // Трон и ступени
    for (let i = 0; i < 4; i++) {
      const sw = w * (0.34 - i * 0.05), sy = H - i * 6 * u;
      ctx.fillStyle = i % 2 ? '#3b3027' : '#4a3d31';
      ctx.fillRect(w / 2 - sw / 2, sy - 6 * u, sw, 6 * u);
    }
    const ty = H - 24 * u;
    poly(ctx, [[w / 2 - 18 * u, ty], [w / 2 - 18 * u, ty - 50 * u], [w / 2 - 10 * u, ty - 62 * u], [w / 2, ty - 70 * u],
      [w / 2 + 10 * u, ty - 62 * u], [w / 2 + 18 * u, ty - 50 * u], [w / 2 + 18 * u, ty]], '#3a1414');
    ctx.strokeStyle = '#d4a63c'; ctx.lineWidth = 2 * u; ctx.stroke();
    ctx.fillStyle = '#5a1a1a'; ctx.fillRect(w / 2 - 14 * u, ty - 18 * u, 28 * u, 18 * u);
    goldEmblem(ctx, w / 2, ty - 50 * u, 6 * u);

    // Пол
    ctx.fillStyle = lin(ctx, 0, H, 0, h, [[0, '#3a3129'], [1, '#17130f']]);
    ctx.fillRect(0, H, w, h - H);
    floorGrid(ctx, w, h, H, 'rgba(0,0,0,.35)');
    // Ковровая дорожка
    poly(ctx, [[w / 2 - w * 0.07, H], [w / 2 + w * 0.07, H], [w / 2 + w * 0.32, h], [w / 2 - w * 0.32, h]], '#6e1616');
    poly(ctx, [[w / 2 - w * 0.06, H], [w / 2 + w * 0.06, H], [w / 2 + w * 0.28, h], [w / 2 - w * 0.28, h]], '#8c1f1f');
    ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2 * u;
    ctx.beginPath(); ctx.moveTo(w / 2 - w * 0.065, H); ctx.lineTo(w / 2 - w * 0.3, h);
    ctx.moveTo(w / 2 + w * 0.065, H); ctx.lineTo(w / 2 + w * 0.3, h); ctx.stroke();

    // Лучи света из окна
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    poly(ctx, [[wx, wt + ww * 0.4], [wx + ww, wt + ww * 0.4], [w / 2 + w * 0.45, h], [w / 2 - w * 0.45, h]],
      lin(ctx, 0, wt, 0, h, [[0, 'rgba(255,240,190,.14)'], [1, 'rgba(255,240,190,0)']]));
    ctx.restore();

    // Колонны (3 с каждой стороны, в перспективе)
    const cols = [[0.04, 1.0], [0.16, 0.78], [0.25, 0.6]];
    for (const side of [-1, 1]) {
      for (let i = cols.length - 1; i >= 0; i--) {
        const [fx, sc] = cols[i];
        const cw = 34 * u * sc, cx = side < 0 ? w * fx : w * (1 - fx);
        const base = H + (h - H) * (sc - 0.55) * 0.9;
        const top = 0;
        ctx.fillStyle = lin(ctx, cx - cw / 2, 0, cx + cw / 2, 0, [[0, '#1b1612'], [0.35, '#5a4a3a'], [0.6, '#3e3328'], [1, '#14100d']]);
        ctx.fillRect(cx - cw / 2, top, cw, base - top);
        ctx.fillStyle = '#4c3f31';
        ctx.fillRect(cx - cw * 0.7, base - 10 * u * sc, cw * 1.4, 10 * u * sc);
        ctx.fillRect(cx - cw * 0.65, h * 0.05 * sc, cw * 1.3, 8 * u * sc);
        // Знамя
        if (i === 1) {
          const bx = cx + side * -cw * 1.2, bw = 22 * u * sc, by = h * 0.08, bh = h * 0.2 * sc;
          poly(ctx, [[bx - bw / 2, by], [bx + bw / 2, by], [bx + bw / 2, by + bh], [bx, by + bh - 10 * u * sc], [bx - bw / 2, by + bh]], '#7a1818');
          goldEmblem(ctx, bx, by + bh * 0.4, 6 * u * sc);
        }
        // Факел
        const fy = H - (H * 0.45) * sc;
        ctx.fillStyle = '#2a2016';
        ctx.fillRect(cx + side * -cw * 0.55 - 2 * u, fy, 4 * u, 14 * u * sc);
        lights.push({ x: cx + side * -cw * 0.55, y: fy - 2 * u, s: sc });
      }
    }
    vignette(ctx, w, h);
    return { lights, particles: 'embers' };
  }

  // ---------- 2. Лесной алтарь ----------
  function forest(ctx, w, h) {
    const H = h * HORIZON, u = w / 400, r = rng(11);
    const lights = [];
    ctx.fillStyle = lin(ctx, 0, 0, 0, H, [[0, '#060b1c'], [0.6, '#1a2347'], [1, '#3b3560']]);
    ctx.fillRect(0, 0, w, H);
    for (let i = 0; i < 90; i++) { ctx.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`; ctx.fillRect(r() * w, r() * H * 0.8, u * (r() < 0.1 ? 2 : 1), u * (r() < 0.1 ? 2 : 1)); }
    // Луна
    ctx.fillStyle = rad(ctx, w * 0.72, h * 0.12, 60 * u, [[0, 'rgba(230,235,255,.5)'], [1, 'rgba(230,235,255,0)']]);
    ctx.fillRect(0, 0, w, H);
    ctx.fillStyle = '#e8ecff'; ctx.beginPath(); ctx.arc(w * 0.72, h * 0.12, 18 * u, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(160,170,210,.5)'; ctx.beginPath(); ctx.arc(w * 0.715, h * 0.115, 4 * u, 0, Math.PI * 2); ctx.fill();
    // Слои ёлок
    const layers = [['#1b2340', 0.62, 60], ['#141a30', 0.78, 42], ['#0b1020', 0.95, 30]];
    for (const [col, k, n] of layers) {
      for (let i = 0; i < n; i++) {
        const x = r() * w * 1.1 - w * 0.05, th = (40 + r() * 60) * u * k, tw = th * 0.45, by = H - (1 - k) * 20 * u;
        poly(ctx, [[x, by - th], [x + tw / 2, by], [x - tw / 2, by]], col);
      }
    }
    // Руины-арка
    const aw = w * 0.3, ax = w / 2 - aw / 2, at = H - h * 0.2;
    ctx.fillStyle = '#4a4f5c';
    ctx.fillRect(ax, at, 14 * u, H - at); ctx.fillRect(ax + aw - 14 * u, at, 14 * u, H - at);
    ctx.beginPath(); ctx.arc(w / 2, at + 4 * u, aw / 2, Math.PI, 0); ctx.lineWidth = 12 * u; ctx.strokeStyle = '#4a4f5c'; ctx.stroke();
    ctx.fillStyle = rad(ctx, w / 2, at + 20 * u, aw * 0.5, [[0, 'rgba(120,255,200,.45)'], [1, 'rgba(120,255,200,0)']]);
    ctx.fillRect(ax, at - aw / 2, aw, H - at + aw / 2);
    ctx.fillStyle = '#7fffd0';
    for (let i = 0; i < 5; i++) ctx.fillRect(ax + 4 * u, at + 10 * u + i * 12 * u, 6 * u, 3 * u);
    for (let i = 0; i < 5; i++) ctx.fillRect(ax + aw - 10 * u, at + 10 * u + i * 12 * u, 6 * u, 3 * u);
    lights.push({ x: ax + 7 * u, y: at - 6 * u, s: 0.8 }, { x: ax + aw - 7 * u, y: at - 6 * u, s: 0.8 });
    // Земля
    ctx.fillStyle = lin(ctx, 0, H, 0, h, [[0, '#1d3320'], [1, '#08120a']]);
    ctx.fillRect(0, H, w, h - H);
    for (let i = 0; i < 260; i++) {
      const y = H + Math.pow(r(), 1.4) * (h - H), x = r() * w, s = (1 + (y - H) / (h - H) * 4) * u;
      ctx.fillStyle = r() < 0.5 ? '#2c4a2a' : '#15281a'; ctx.fillRect(x, y, s * 0.6, s * 2);
    }
    // Каменная тропа
    for (let k = 0; k < 9; k++) {
      const t = k / 9, y = H + (h - H) * Math.pow(t, 1.3), s = (6 + t * 40) * u;
      ctx.fillStyle = '#5b6170';
      ctx.beginPath(); ctx.ellipse(w / 2 + (k % 2 ? 1 : -1) * s * 0.4, y, s, s * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#717889';
      ctx.beginPath(); ctx.ellipse(w / 2 + (k % 2 ? 1 : -1) * s * 0.4, y - s * 0.06, s * 0.8, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    }
    // Туман
    ctx.fillStyle = lin(ctx, 0, H - 40 * u, 0, H + 50 * u, [[0, 'rgba(160,180,230,0)'], [0.5, 'rgba(160,180,230,.22)'], [1, 'rgba(160,180,230,0)']]);
    ctx.fillRect(0, H - 40 * u, w, 90 * u);
    // Крупные деревья по краям
    for (const side of [0, 1]) {
      const x = side ? w * 0.97 : w * 0.03, base = H + (h - H) * 0.12;
      ctx.fillStyle = '#04070d'; ctx.fillRect(x - 9 * u, base - h * 0.1, 18 * u, h * 0.1);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath(); ctx.ellipse(x, base, 60 * u, 10 * u, 0, 0, Math.PI * 2); ctx.fill();
      // Ель из нескольких ярусов
      const tiers = 6, top = h * 0.02;
      for (let i = 0; i < tiers; i++) {
        const t0 = top + (base - h * 0.08 - top) * (i / tiers);
        const t1 = top + (base - h * 0.08 - top) * ((i + 1.6) / tiers);
        const half = (25 + i * 15) * u;
        poly(ctx, [[x, t0], [x + half, t1], [x - half, t1]], i % 2 ? '#070c18' : '#0a1020');
      }
    }
    vignette(ctx, w, h, 0.7);
    return { lights, particles: 'fireflies' };
  }

  // ---------- 3. Логово дракона (платный) ----------
  function dragon(ctx, w, h) {
    const H = h * HORIZON, u = w / 400, r = rng(5);
    const lights = [];
    ctx.fillStyle = lin(ctx, 0, 0, 0, H, [[0, '#0a0303'], [1, '#3a0e06']]);
    ctx.fillRect(0, 0, w, H);
    // Проём пещеры с заревом
    ctx.fillStyle = rad(ctx, w / 2, H, w * 0.5, [[0, 'rgba(255,120,30,.75)'], [0.5, 'rgba(160,40,10,.35)'], [1, 'rgba(0,0,0,0)']]);
    ctx.fillRect(0, 0, w, H);
    // Сталактиты
    for (let i = 0; i < 26; i++) {
      const x = r() * w, len = (30 + r() * 90) * u, ww = (8 + r() * 18) * u;
      poly(ctx, [[x - ww, 0], [x + ww, 0], [x, len]], '#1a0705');
    }
    // Глаза дракона во тьме
    for (const dx of [-1, 1]) {
      ctx.fillStyle = rad(ctx, w / 2 + dx * 22 * u, h * 0.2, 16 * u, [[0, 'rgba(255,220,60,.9)'], [1, 'rgba(255,120,0,0)']]);
      ctx.fillRect(w / 2 + dx * 22 * u - 16 * u, h * 0.2 - 16 * u, 32 * u, 32 * u);
      ctx.fillStyle = '#ffe27a';
      ctx.beginPath(); ctx.ellipse(w / 2 + dx * 22 * u, h * 0.2, 7 * u, 3 * u, dx * 0.25, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#300'; ctx.fillRect(w / 2 + dx * 22 * u - 0.8 * u, h * 0.2 - 3 * u, 1.6 * u, 6 * u);
    }
    // Скалы
    poly(ctx, [[0, H], [0, h * 0.18], [w * 0.12, h * 0.25], [w * 0.22, h * 0.36], [w * 0.3, H]], '#170605');
    poly(ctx, [[w, H], [w, h * 0.15], [w * 0.86, h * 0.27], [w * 0.76, h * 0.38], [w * 0.7, H]], '#170605');
    // Лавовая река
    const ly = H - 6 * u;
    ctx.fillStyle = lin(ctx, 0, ly - 6 * u, 0, ly + 10 * u, [[0, '#ffdd55'], [0.5, '#ff6a00'], [1, '#8a1a00']]);
    ctx.beginPath(); ctx.moveTo(0, ly);
    for (let x = 0; x <= w; x += 10 * u) ctx.lineTo(x, ly + Math.sin(x / (18 * u)) * 3 * u);
    ctx.lineTo(w, ly + 12 * u); ctx.lineTo(0, ly + 12 * u); ctx.fill();
    for (let x = 0; x < w; x += 70 * u) lights.push({ x: x + r() * 40 * u, y: ly - 2 * u, s: 0.5 });
    // Пол
    ctx.fillStyle = lin(ctx, 0, H, 0, h, [[0, '#2a0f08'], [1, '#0b0302']]);
    ctx.fillRect(0, H + 6 * u, w, h - H);
    floorGrid(ctx, w, h, H + 6 * u, 'rgba(255,90,20,.12)', 10);
    // Груды золота
    for (const [gx, gs] of [[0.12, 1], [0.88, 1.1], [0.3, 0.6], [0.72, 0.65]]) {
      const x = w * gx, y = H + (h - H) * 0.35 * gs, R = 46 * u * gs;
      ctx.fillStyle = rad(ctx, x, y, R, [[0, '#ffe680'], [0.6, '#c8901e'], [1, '#6a4005']]);
      ctx.beginPath(); ctx.ellipse(x, y, R, R * 0.45, 0, Math.PI, 0); ctx.fill();
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle = r() < 0.5 ? '#fff4b0' : '#e0a52a';
        ctx.fillRect(x + (r() - 0.5) * R * 1.6, y - r() * R * 0.4, 3 * u, 2 * u);
      }
    }
    vignette(ctx, w, h, 0.8);
    return { lights, particles: 'embers' };
  }

  // ---------- 4. Ледяная цитадель (платный) ----------
  function ice(ctx, w, h) {
    const H = h * HORIZON, u = w / 400, r = rng(23);
    const lights = [];
    ctx.fillStyle = lin(ctx, 0, 0, 0, H, [[0, '#040a1e'], [1, '#1b3a5c']]);
    ctx.fillRect(0, 0, w, H);
    for (let i = 0; i < 70; i++) { ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(r() * w, r() * H * 0.6, u, u); }
    // Северное сияние
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const [col, oy] of [['rgba(80,255,170,.22)', 0.1], ['rgba(170,90,255,.18)', 0.16]]) {
      ctx.beginPath(); ctx.moveTo(0, h * oy);
      for (let x = 0; x <= w; x += 8 * u) ctx.lineTo(x, h * oy + Math.sin(x / (40 * u)) * 18 * u);
      for (let x = w; x >= 0; x -= 8 * u) ctx.lineTo(x, h * oy + 50 * u + Math.sin(x / (30 * u) + 1) * 14 * u);
      ctx.fillStyle = col; ctx.fill();
    }
    ctx.restore();
    // Цитадель
    const spires = [[0, 1], [-0.11, 0.7], [0.11, 0.7], [-0.2, 0.5], [0.2, 0.5]];
    for (const [dx, k] of spires) {
      const x = w / 2 + dx * w, sw = 26 * u * k, top = H - h * 0.32 * k;
      ctx.fillStyle = lin(ctx, x - sw, 0, x + sw, 0, [[0, '#7fb6dc'], [0.5, '#d8f1ff'], [1, '#5d93bd']]);
      ctx.fillRect(x - sw / 2, top, sw, H - top);
      poly(ctx, [[x - sw * 0.7, top], [x + sw * 0.7, top], [x, top - 34 * u * k]], '#e9f8ff');
      ctx.fillStyle = '#ffe9a0'; ctx.fillRect(x - 3 * u, top + 16 * u * k, 6 * u, 9 * u * k);
      lights.push({ x, y: top + 14 * u * k, s: 0.4 * k });
    }
    ctx.fillStyle = '#a9d6f2'; ctx.fillRect(w / 2 - w * 0.24, H - 26 * u, w * 0.48, 26 * u);
    ctx.fillStyle = '#2b4d6e'; ctx.beginPath(); ctx.arc(w / 2, H, 16 * u, Math.PI, 0); ctx.fill();
    // Ледяные кристаллы по бокам
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const x = side < 0 ? w * (0.02 + i * 0.07) : w * (0.98 - i * 0.07), ch = h * (0.42 - i * 0.07), cw = 30 * u * (1 - i * 0.15);
        poly(ctx, [[x - cw / 2, H + 20 * u], [x - cw / 3, H - ch], [x, H - ch - 26 * u], [x + cw / 3, H - ch], [x + cw / 2, H + 20 * u]],
          lin(ctx, x - cw, 0, x + cw, 0, [[0, 'rgba(120,190,230,.85)'], [0.5, 'rgba(230,250,255,.95)'], [1, 'rgba(90,150,200,.85)']]));
      }
    }
    // Снежный пол
    ctx.fillStyle = lin(ctx, 0, H, 0, h, [[0, '#cfe6f5'], [1, '#6f93b3']]);
    ctx.fillRect(0, H, w, h - H);
    floorGrid(ctx, w, h, H, 'rgba(60,110,160,.25)');
    vignette(ctx, w, h, 0.65);
    return { lights, particles: 'snow' };
  }

  const painters = { throne, forest, dragon, ice };

  // Нарисованный фон-картинка (фон города): «img:путь». Пока картинка грузится — тёмная заливка, затем onReady.
  const imgs = {};
  // Нарисованные фоны (заменяют процедурные с тем же id) и их частицы
  const IMAGES = { throne: 'assets/lobby/throne.jpg', forest: 'assets/lobby/forest.jpg', dragon: 'assets/lobby/dragon.jpg', ice: 'assets/lobby/ice.jpg' };
  const PARTICLES = { throne: 'embers', forest: 'fireflies', dragon: 'embers', ice: 'snow' };
  function paintImage(ctx, src, w, h, onReady, particles) {
    let im = imgs[src];
    if (!im) { im = imgs[src] = new Image(); im.src = src; }
    if (!im.complete || !im.naturalWidth) {
      ctx.fillStyle = '#0c0a10'; ctx.fillRect(0, 0, w, h);
      if (onReady) im.addEventListener('load', onReady, { once: true });
      return { lights: [], particles: particles || 'embers' };
    }
    const k = Math.max(w / im.naturalWidth, h / im.naturalHeight); // как object-fit: cover
    const dw = im.naturalWidth * k, dh = im.naturalHeight * k;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
    vignette(ctx, w, h, 0.45);
    const dark = /abyss/.test(src);
    return { lights: [], particles: particles || (dark ? 'embers' : 'fireflies') };
  }
  function paint(canvas, id, w, h, dpr = 1, onReady) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (String(id).startsWith('img:')) return paintImage(ctx, id.slice(4), w, h, onReady);
    if (IMAGES[id]) return paintImage(ctx, IMAGES[id], w, h, onReady, PARTICLES[id]);
    return (painters[id] || throne)(ctx, w, h);
  }

  return { paint, HORIZON, ids: Object.keys(painters) };
})();
