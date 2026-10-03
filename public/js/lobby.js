// Лобби в стиле Lineage 2: выбранный герой в центре на платформе (окно 2),
// остальные позади (окна 3–6), инфо-панель (окно 1), «Начать» (окно 7), меню (окно 8).
window.Lobby = (() => {
  const $ = (id) => document.getElementById(id);
  // Слоты: выбранный — 2; остальные бесплатные — 3 и 4; 5 и 6 — закрытые места под будущих героев
  const BACK_SLOTS = [3, 4];
  const LOCKED_SLOTS = [5, 6];

  let opts, classes = {}, backgrounds = [], profile = { chars: {}, bgs: ['throne', 'forest'] };
  let order = []; // order[0] — выбранный герой
  let bgId = 'throne';
  let heroEls = {};
  let fxType = 'embers';
  let running = false;

  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  const haptic = (fn, arg) => { const h = opts.tg && opts.tg.HapticFeedback; if (h && h[fn]) h[fn](arg); };

  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(toast.tm);
    toast.tm = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  function heroCanvas(cls, color) {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    c.getContext('2d').drawImage(Gfx.hero(cls, color), 0, 0);
    return c;
  }

  // ---------- Имя игрока ----------
  function playerName() {
    if (profile.name) return profile.name;
    if (opts.tgUser) return opts.tgUser.username || opts.tgUser.first_name || 'Герой';
    let n = opts.store.get('guestName');
    if (!n) { n = 'Странник' + Math.floor(1000 + Math.random() * 9000); opts.store.set('guestName', n); }
    return n;
  }

  // ---------- Окно 1 ----------
  function renderPanel() {
    const cls = order[0];
    const c = classes[cls];
    if (!c) return;
    const ch = profile.chars[cls] || { level: 1, xp: 0, xpNext: 40, maxHp: c.hp, resMax: c.resource.max };
    $('lpName').textContent = playerName();
    $('lpLevel').textContent = ch.level;
    $('lpClass').textContent = c.name;
    $('lpHp').textContent = `${ch.maxHp} / ${ch.maxHp}`;
    $('lpHpFill').style.width = '100%';
    $('lpResKey').textContent = c.resource.name === 'Мана' ? 'MP' : 'EP';
    $('lpRes').textContent = `${c.resource.name}: ${ch.resMax} / ${ch.resMax}`;
    $('lpResFill').style.width = '100%';
    $('lpResFill').style.background = c.resource.color;
    const pct = Math.min(100, (100 * ch.xp) / ch.xpNext);
    $('lpXp').textContent = `${pct.toFixed(2)}%`;
    $('lpXpFill').style.width = pct + '%';
  }

  // ---------- Окна 2–6 ----------
  function buildStage() {
    const stage = $('stage');
    stage.innerHTML = '';
    heroEls = {};
    for (const key of Object.keys(classes)) {
      const c = classes[key];
      const el = document.createElement('div');
      el.className = 'hero';
      el.style.setProperty('--hero', hex(c.color));
      el.innerHTML = `<div class="hero-name"><b>${c.name}</b><span></span></div><div class="hero-shadow"></div>`;
      el.appendChild(heroCanvas(key, c.color));
      el.onclick = () => select(key);
      stage.appendChild(el);
      heroEls[key] = el;
    }
    // Закрытые места
    const ghosts = ['warrior', 'mage'];
    LOCKED_SLOTS.forEach((slot, i) => {
      const el = document.createElement('div');
      el.className = 'hero locked';
      el.dataset.slot = slot;
      el.innerHTML = `<div class="hero-name"><b>🔒 Скоро</b></div><div class="hero-shadow"></div>`;
      el.appendChild(heroCanvas(ghosts[i], 0x444444));
      el.onclick = () => { haptic('notificationOccurred', 'warning'); toast('Новые герои появятся в следующих обновлениях'); };
      stage.appendChild(el);
    });
    layoutStage();
  }

  function layoutStage() {
    order.forEach((key, i) => {
      const el = heroEls[key];
      const slot = i === 0 ? 2 : BACK_SLOTS[i - 1];
      el.dataset.slot = slot;
      el.classList.toggle('selected', i === 0);
      // Задний ряд смотрит в центр
      el.classList.toggle('flip', slot === 4 || slot === 6);
      const lvl = (profile.chars[key] || {}).level || 1;
      el.querySelector('.hero-name span').textContent = `Ур. ${lvl}`;
    });
    $('playBtn').textContent = 'Начать';
    renderPanel();
  }

  function select(key) {
    if (order[0] === key) return;
    order = [key, ...order.filter((k) => k !== key)];
    opts.store.set('lastClass', key);
    haptic('impactOccurred', 'medium');
    layoutStage();
  }

  // ---------- Фон ----------
  function applyBg(id, save = true) {
    bgId = id;
    if (save) opts.store.set('lobbyBg', id);
    paintBg();
  }

  function paintBg() {
    const cnv = $('lobbyBg');
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const res = LobbyBg.paint(cnv, bgId, w, h, dpr);
    cnv.style.width = w + 'px';
    cnv.style.height = h + 'px';
    fxType = res.particles;
    const box = $('lobbyLights');
    box.innerHTML = '';
    for (const l of res.lights) {
      const f = document.createElement('div');
      f.className = 'flame';
      f.style.left = l.x + 'px';
      f.style.top = l.y + 'px';
      f.style.setProperty('--s', l.s);
      f.style.animationDelay = (-Math.random() * 2).toFixed(2) + 's';
      box.appendChild(f);
    }
    resetParticles();
  }

  // ---------- Частицы (угольки / светлячки / снег) ----------
  let parts = [];
  function resetParticles() {
    const cnv = $('lobbyFx');
    cnv.width = window.innerWidth; cnv.height = window.innerHeight;
    parts = Array.from({ length: fxType === 'snow' ? 70 : 40 }, () => spawnPart(true));
  }
  function spawnPart(anywhere) {
    const w = window.innerWidth, h = window.innerHeight;
    const p = { x: Math.random() * w, y: anywhere ? Math.random() * h : 0, t: Math.random() * 100 };
    if (fxType === 'embers') { p.y = anywhere ? p.y : h + 5; p.vx = (Math.random() - 0.5) * 12; p.vy = -(15 + Math.random() * 35); p.r = 1 + Math.random() * 1.6; }
    if (fxType === 'snow') { p.y = anywhere ? p.y : -5; p.vx = (Math.random() - 0.5) * 10; p.vy = 18 + Math.random() * 30; p.r = 1 + Math.random() * 2; }
    if (fxType === 'fireflies') { p.y = h * (0.3 + Math.random() * 0.6); p.vx = (Math.random() - 0.5) * 16; p.vy = (Math.random() - 0.5) * 16; p.r = 1.4 + Math.random(); }
    return p;
  }
  let last = 0;
  function loop(ts) {
    if (!running) return;
    const dt = Math.min(0.05, (ts - last) / 1000 || 0);
    last = ts;
    const cnv = $('lobbyFx'), ctx = cnv.getContext('2d');
    const w = cnv.width, h = cnv.height;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.t += dt;
      p.x += (p.vx + Math.sin(p.t * 1.3) * 8) * dt;
      p.y += p.vy * dt;
      if (fxType === 'fireflies') { p.vx += (Math.random() - 0.5) * 20 * dt; p.vy += (Math.random() - 0.5) * 20 * dt; }
      if (p.y < -10 || p.y > h + 10 || p.x < -10 || p.x > w + 10) { parts[i] = spawnPart(false); continue; }
      let col;
      if (fxType === 'embers') col = `rgba(255,${120 + (i * 7) % 100},40,${0.5 + 0.5 * Math.sin(p.t * 4)})`;
      else if (fxType === 'snow') col = 'rgba(255,255,255,.85)';
      else col = `rgba(190,255,120,${Math.max(0, Math.sin(p.t * 2))})`;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    requestAnimationFrame(loop);
  }

  // ---------- Окно 8: списки ----------
  function openSheet(title, body) {
    $('sheetTitle').textContent = title;
    const b = $('sheetBody');
    b.innerHTML = '';
    b.appendChild(body);
    $('sheet').classList.remove('hidden');
    haptic('impactOccurred', 'light');
  }
  const closeSheet = () => $('sheet').classList.add('hidden');

  function heroesSheet() {
    const box = document.createElement('div');
    box.innerHTML = '<p class="sheet-hint">Бесплатно: выберите одного из трёх героев</p>';
    const max = { hp: 200, dmg: 35, range: 300, speed: 200 };
    for (const key of Object.keys(classes)) {
      const c = classes[key];
      const lvl = (profile.chars[key] || {}).level || 1;
      const row = document.createElement('button');
      row.className = 'pick-row' + (order[0] === key ? ' active' : '');
      row.style.setProperty('--hero', hex(c.color));
      const bar = (label, v, m) => `<div class="mini-stat"><span>${label}</span><i><u style="width:${Math.min(100, (100 * v) / m)}%"></u></i><b>${v}</b></div>`;
      row.innerHTML = `
        <div class="pick-info">
          <div class="pick-title"><b>${c.name}</b><span>Ур. ${lvl}</span><em>${order[0] === key ? '✓ Выбран' : 'Бесплатно'}</em></div>
          <div class="pick-role">${c.role} · ${c.resource.name}</div>
          ${bar('❤️', c.hp, max.hp)}${bar('🗡', c.dmg, max.dmg)}${bar('🎯', c.range, max.range)}${bar('👟', c.speed, max.speed)}
        </div>`;
      row.prepend(heroCanvas(key, c.color));
      row.onclick = () => { select(key); closeSheet(); };
      box.appendChild(row);
    }
    return box;
  }

  function bgSheet() {
    const box = document.createElement('div');
    box.className = 'bg-grid';
    const tw = 140, th = Math.round(tw * Math.min(2, window.innerHeight / window.innerWidth));
    for (const bg of backgrounds) {
      const owned = profile.bgs.includes(bg.id);
      const card = document.createElement('button');
      card.className = 'bg-card' + (bgId === bg.id ? ' active' : '') + (owned ? '' : ' paid');
      const thumb = document.createElement('canvas');
      LobbyBg.paint(thumb, bg.id, tw, th, 1);
      card.appendChild(thumb);
      const label = document.createElement('div');
      label.className = 'bg-label';
      const state = bgId === bg.id ? '✓ Выбран' : owned ? (bg.price ? 'Куплен' : 'Бесплатно') : `🔒 ${bg.price} ⭐`;
      label.innerHTML = `<b>${bg.name}</b><span>${state}</span>`;
      card.appendChild(label);
      card.onclick = () => (owned ? (applyBg(bg.id), closeSheet()) : buyBg(bg));
      box.appendChild(card);
    }
    return box;
  }

  async function buyBg(bg) {
    const tg = opts.tg;
    if (!tg || !opts.tgUser || !tg.openInvoice) { toast('Покупка за Telegram Stars доступна только в Telegram'); return; }
    try {
      const r = await fetch('/api/invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData, bgId: bg.id }),
      });
      const data = await r.json();
      if (!r.ok) { toast(data.error || 'Оплата недоступна'); return; }
      tg.openInvoice(data.link, async (status) => {
        if (status !== 'paid') return;
        // Ждём, пока бот получит successful_payment, и обновляем профиль
        for (let i = 0; i < 5; i++) {
          await new Promise((res) => setTimeout(res, 800));
          await loadProfile();
          if (profile.bgs.includes(bg.id)) break;
        }
        if (profile.bgs.includes(bg.id)) { applyBg(bg.id); toast(`Фон «${bg.name}» куплен!`); haptic('notificationOccurred', 'success'); }
        closeSheet();
      });
    } catch {
      toast('Ошибка соединения');
    }
  }

  async function loadProfile() {
    try {
      const r = await fetch('/api/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: opts.tg ? opts.tg.initData : '', guestId: opts.guestId }),
      });
      if (r.ok) profile = await r.json();
      else $('status').textContent = (await r.json()).error || '';
    } catch { /* офлайн — остаются значения по умолчанию */ }
  }

  // ---------- Инициализация ----------
  async function init(o) {
    opts = o;
    if (!opts.tgUser) $('lpRename').classList.remove('hidden');
    paintBg();
    running = true;
    requestAnimationFrame(loop);

    try {
      const cfg = await (await fetch('/api/config')).json();
      classes = cfg.classes;
      backgrounds = cfg.backgrounds;
    } catch {
      $('status').textContent = 'Сервер недоступен';
      return;
    }
    await loadProfile();

    const keys = Object.keys(classes);
    const last = opts.store.get('lastClass');
    order = keys.includes(last) ? [last, ...keys.filter((k) => k !== last)] : keys;
    const savedBg = opts.store.get('lobbyBg');
    if (savedBg && profile.bgs.includes(savedBg) && savedBg !== bgId) applyBg(savedBg, false);
    buildStage();
    $('playBtn').disabled = false;

    $('menuHeroes').onclick = () => openSheet('Выбор персонажа', heroesSheet());
    $('menuBg').onclick = () => openSheet('Фон лобби', bgSheet());
    $('sheetClose').onclick = closeSheet;
    $('sheet').onclick = (e) => { if (e.target === $('sheet')) closeSheet(); };
    $('playBtn').onclick = () => opts.onStart(order[0], playerName());

    $('lpRename').onclick = () => { $('guestName').value = playerName(); $('renameBox').classList.remove('hidden'); $('guestName').focus(); };
    $('renameBox').onclick = (e) => { if (e.target === $('renameBox')) $('renameBox').classList.add('hidden'); };
    $('renameForm').onsubmit = (e) => {
      e.preventDefault();
      const v = $('guestName').value.trim().slice(0, 16);
      if (v) { opts.store.set('guestName', v); renderPanel(); }
      $('renameBox').classList.add('hidden');
      $('guestName').blur();
    };

    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => running && paintBg(), 150); });
  }

  return {
    init,
    setStatus: (t) => { $('status').textContent = t; },
    setBusy: (b) => { $('playBtn').disabled = b; },
    hide: () => { running = false; $('lobby').classList.add('hidden'); },
  };
})();
