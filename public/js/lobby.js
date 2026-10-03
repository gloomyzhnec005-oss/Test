// Лобби в стиле Lineage 2: выбранный герой в центре на платформе (окно 2),
// остальные полученные герои позади (окна 3–6), инфо-панель (окно 1), «Начать» (окно 7), меню (окно 8).
// Герои получаются через гачу («Получить персонажа»): первая крутка бесплатная.
window.Lobby = (() => {
  const $ = (id) => document.getElementById(id);
  const BACK_SLOTS = [3, 4, 5, 6];
  const RES_KEYS = { 'Мана': 'MP', 'Энергия': 'EP', 'Ярость': 'RP', 'Ци': 'Ци', 'Безумие': 'BP', 'Детали': 'ДТ', 'Руны': 'RP', 'Вера': 'FP', 'Стойкость': 'SP', 'Мрак': 'DP', 'Сила камня': 'SP' };

  let opts, heroes = {}, rarities = {}, backgrounds = [];
  let profile = { heroes: [], chars: {}, bgs: ['throne', 'forest'], freeSpin: true, paidSpins: 0, spinPrice: 25 };
  let order = []; // полученные герои; order[0] — выбранный
  let bgId = 'throne';
  let fxType = 'embers';
  let running = false;
  let spinning = false;

  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  const haptic = (fn, arg) => { const h = opts.tg && opts.tg.HapticFeedback; if (h && h[fn]) h[fn](arg); };
  const rarityOf = (id) => rarities[heroes[id].rarity];

  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(toast.tm);
    toast.tm = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  function heroCanvas(id) {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    c.getContext('2d').drawImage(Gfx.hero(id ? heroes[id].look : { body: '#222', legs: '#111', skin: '#222', head: 'hood', headColor: '#111' }), 0, 0);
    return c;
  }

  async function api(url, body) {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: opts.tg ? opts.tg.initData : '', guestId: opts.guestId, ...body }),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
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
    $('lpName').textContent = playerName();
    const id = order[0];
    if (!id) {
      $('lpHero').textContent = 'Нет героя';
      $('lpTitle').textContent = '';
      $('lpLevel').textContent = '—';
      $('lpRarity').textContent = '';
      ['Hp', 'Res', 'Xp'].forEach((k) => { $('lp' + k).textContent = ''; $('lp' + k + 'Fill').style.width = '0%'; });
      $('lpResKey').textContent = 'MP';
      return;
    }
    const h = heroes[id], r = rarityOf(id);
    const ch = profile.chars[id] || { level: 1, xp: 0, xpNext: 40, maxHp: h.hp, resMax: h.resource.max };
    $('lpHero').textContent = h.name;
    $('lpTitle').textContent = h.title;
    $('lpLevel').textContent = ch.level;
    $('lpRarity').textContent = r.name;
    $('lpRarity').style.color = r.color;
    $('lpHp').textContent = `${ch.maxHp} / ${ch.maxHp}`;
    $('lpHpFill').style.width = '100%';
    $('lpResKey').textContent = RES_KEYS[h.resource.name] || 'MP';
    const resNow = Math.round((h.resource.start ?? 1) * ch.resMax);
    $('lpRes').textContent = `${h.resource.name}: ${resNow} / ${ch.resMax}`;
    $('lpResFill').style.width = (100 * resNow / ch.resMax) + '%';
    $('lpResFill').style.background = h.resource.color;
    const pct = Math.min(100, (100 * ch.xp) / ch.xpNext);
    $('lpXp').textContent = `${pct.toFixed(2)}%`;
    $('lpXpFill').style.width = pct + '%';
  }

  // ---------- Окна 2–6 ----------
  function heroEl(id, slot) {
    const el = document.createElement('div');
    el.className = 'hero' + (id ? '' : ' mystery');
    el.dataset.slot = slot;
    if (id) el.dataset.id = id;
    if (id) {
      const h = heroes[id], r = rarityOf(id);
      const lvl = (profile.chars[id] || {}).level || 1;
      el.style.setProperty('--hero', hex(h.color));
      el.style.setProperty('--rarity', r.color);
      el.innerHTML = `<div class="hero-name"><b>${h.name}</b><span>Ур. ${lvl}</span></div><div class="hero-shadow"></div>`;
      el.onclick = () => select(id);
    } else {
      el.innerHTML = `<div class="hero-name"><b>${slot === 2 ? 'Получите героя' : '?'}</b></div><div class="hero-shadow"></div><div class="mystery-mark">?</div>`;
      el.onclick = () => openGacha();
    }
    el.appendChild(heroCanvas(id));
    // Звери-спутники стоят у ног хозяина
    if (id && heroes[id].pets) {
      ['wolf', 'bear', 'hawk'].forEach((k) => {
        const pc = document.createElement('canvas');
        pc.width = 32; pc.height = 32;
        pc.className = 'lobby-pet pet-' + k;
        pc.getContext('2d').drawImage(Gfx.pet(k), 0, 0);
        el.appendChild(pc);
      });
    }
    el.classList.toggle('selected', slot === 2);
    el.classList.toggle('flip', slot === 4 || slot === 6);
    return el;
  }

  function buildStage() {
    const stage = $('stage');
    stage.innerHTML = '';
    stage.appendChild(heroEl(order[0] || null, 2));
    BACK_SLOTS.forEach((slot, i) => stage.appendChild(heroEl(order[i + 1] || null, slot)));
    renderPanel();
    const has = order.length > 0;
    $('playBtn').textContent = has ? 'Начать' : 'Получить персонажа';
    $('playBtn').classList.toggle('summon', !has);
  }

  // Перестановка без пересоздания: элементы плавно переезжают между слотами
  function select(id) {
    if (order[0] === id) return;
    order = [id, ...order.filter((k) => k !== id)];
    opts.store.set('lastHero', id);
    haptic('impactOccurred', 'medium');
    const byId = new Map([...$('stage').querySelectorAll('.hero[data-id]')].map((el) => [el.dataset.id, el]));
    // Если выбран герой, не стоявший на сцене (больше 5 героев), — пересобираем
    if (!byId.has(id)) { buildStage(); return; }
    const slots = [2, ...BACK_SLOTS];
    order.slice(0, slots.length).forEach((hid, i) => {
      const el = byId.get(hid);
      if (!el) return;
      el.dataset.slot = slots[i];
      el.classList.toggle('selected', i === 0);
      el.classList.toggle('flip', slots[i] === 4 || slots[i] === 6);
    });
    renderPanel();
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
  const closeSheet = () => { if (!spinning) $('sheet').classList.add('hidden'); };

  // ---------- Гача ----------
  function openGacha() { openSheet('Призыв героя', gachaSheet()); }

  function spinLabel() {
    const pool = Object.keys(heroes).filter((id) => !profile.heroes.includes(id));
    if (!pool.length) return ['Все герои получены', true];
    if (profile.freeSpin) return ['✨ Получить персонажа · бесплатно', false];
    if (profile.paidSpins > 0) return [`✨ Получить персонажа · круток: ${profile.paidSpins}`, false];
    return [`✨ Получить персонажа · ${profile.spinPrice} ⭐`, false];
  }

  function gachaSheet() {
    const box = document.createElement('div');
    box.className = 'gacha';
    // Реальные шансы: все герои, кроме собранных полностью (10 дубликатов)
    const dupes = (id) => (profile.chars[id] || {}).dupes || 0;
    const pool = Object.keys(heroes).filter((id) => !profile.heroes.includes(id) || dupes(id) < (profile.dupeMax || 10));
    const total = pool.reduce((s, id) => s + rarityOf(id).weight, 0);
    const chances = Object.entries(rarities)
      .map(([key, r]) => [r, pool.filter((id) => heroes[id].rarity === key).reduce((s, id) => s + r.weight, 0)])
      .filter(([, w]) => w > 0)
      .map(([r, w]) => `<span style="color:${r.color}">${r.name} ${Math.round((100 * w) / total)}%</span>`).join(' · ');
    const [label, disabled] = spinLabel();
    box.innerHTML = `
      <div class="reel-wrap"><div class="reel-marker"></div><div id="reel" class="reel"></div></div>
      <button id="spinBtn" class="l2-btn spin-btn" ${disabled ? 'disabled' : ''}>${label}</button>
      <p class="sheet-hint">Каждый герой уникален: своё имя, оружие и умения. Повторно выпавший герой — дубликат: +5% к здоровью и урону (до 10 копий) и раньше открытые умения.</p>
      <p class="chances">${chances}</p>
      <div class="sheet-sub">Все герои · получено ${profile.heroes.length} из ${Object.keys(heroes).length}</div>
      <div class="hero-grid"></div>`;
    // Барабан в покое: показываем случайные карточки
    fillReel(box.querySelector('#reel'), null);
    const grid = box.querySelector('.hero-grid');
    for (const id of Object.keys(heroes)) {
      const h = heroes[id], r = rarityOf(id), owned = profile.heroes.includes(id);
      const card = document.createElement('button');
      card.className = 'hero-card' + (owned ? ' owned' : '') + (order[0] === id ? ' active' : '');
      card.style.setProperty('--rarity', r.color);
      card.style.setProperty('--hero', hex(h.color));
      card.appendChild(heroCanvas(id));
      const lvl = owned ? `Ур. ${(profile.chars[id] || {}).level || 1}${dupes(id) ? ` ★${dupes(id)}` : ''}` : '🔒';
      card.insertAdjacentHTML('beforeend', `<b>${h.name}</b><span>${r.name}</span><em>${lvl}</em>`);
      card.onclick = () => (owned ? (select(id), closeSheet()) : showHeroInfo(id, false));
      grid.appendChild(card);
    }
    box.querySelector('#spinBtn').onclick = spin;
    return box;
  }

  function reelCard(id) {
    const card = document.createElement('div');
    card.className = 'reel-card';
    card.style.setProperty('--rarity', rarityOf(id).color);
    card.appendChild(heroCanvas(id));
    card.insertAdjacentHTML('beforeend', `<b>${heroes[id].name}</b>`);
    return card;
  }

  // Заполняет барабан карточками; если задан result — он окажется под маркером на позиции WIN_INDEX
  const WIN_INDEX = 36;
  function fillReel(reel, result) {
    reel.innerHTML = '';
    reel.style.transition = 'none';
    reel.style.transform = 'translateX(0)';
    const ids = Object.keys(heroes);
    const weight = (id) => rarityOf(id).weight;
    const total = ids.reduce((s, id) => s + weight(id), 0);
    const pick = () => { let r = Math.random() * total; for (const id of ids) { r -= weight(id); if (r < 0) return id; } return ids[0]; };
    const n = result ? WIN_INDEX + 4 : 8;
    for (let i = 0; i < n; i++) reel.appendChild(reelCard(result && i === WIN_INDEX ? result : pick()));
  }

  async function spin() {
    if (spinning) return;
    const btn = $('spinBtn');
    // Нужна оплата — открываем счёт в Telegram Stars
    if (!profile.freeSpin && profile.paidSpins <= 0) return buySpin();
    spinning = true;
    btn.disabled = true;
    btn.textContent = 'Призыв...';
    const { ok, data } = await api('/api/gacha/spin', {});
    if (!ok) {
      spinning = false;
      if (data.needPayment) { profile.freeSpin = false; profile.paidSpins = 0; return buySpin(); }
      toast(data.error || 'Ошибка призыва');
      btn.disabled = false;
      btn.textContent = spinLabel()[0];
      return;
    }
    const reel = $('reel');
    fillReel(reel, data.hero);
    const card = reel.children[WIN_INDEX];
    const wrap = reel.parentElement;
    // Небольшой случайный сдвиг внутри карточки, чтобы остановка выглядела живой
    const jitter = (Math.random() - 0.5) * card.offsetWidth * 0.6;
    const target = card.offsetLeft + card.offsetWidth / 2 - wrap.clientWidth / 2 + jitter;
    reel.getBoundingClientRect(); // применить сброс перед анимацией
    reel.style.transition = 'transform 4.2s cubic-bezier(.12,.75,.12,1)';
    reel.style.transform = `translateX(${-target}px)`;
    // Щелчки барабана (вибрация)
    let ticks = 0;
    const tickTimer = setInterval(() => { if (++ticks < 18) haptic('selectionChanged'); }, 160);
    setTimeout(() => {
      clearInterval(tickTimer);
      spinning = false;
      profile = data.profile;
      order = [data.hero, ...order.filter((k) => k !== data.hero)];
      opts.store.set('lastHero', data.hero);
      buildStage();
      haptic('notificationOccurred', 'success');
      showHeroInfo(data.hero, true, data.dupe);
    }, 4400);
  }

  async function buySpin() {
    const tg = opts.tg;
    if (!tg || !opts.tgUser || !tg.openInvoice) { toast('Крутки за Telegram Stars доступны только в Telegram'); return; }
    const { ok, data } = await api('/api/invoice', { item: 'spin' });
    if (!ok) { toast(data.error || 'Оплата недоступна'); return; }
    tg.openInvoice(data.link, async (status) => {
      if (status !== 'paid') return;
      for (let i = 0; i < 6 && profile.paidSpins <= 0; i++) {
        await new Promise((res) => setTimeout(res, 800));
        await loadProfile();
      }
      if (profile.paidSpins > 0) spin();
      else toast('Оплата получена, крутка появится через несколько секунд');
    });
  }

  // Карточка героя: после призыва (isNew) или при просмотре ещё не полученного
  function showHeroInfo(id, isNew, dupe = 0) {
    const h = heroes[id], r = rarityOf(id);
    const box = $('reveal');
    box.style.setProperty('--rarity', r.color);
    box.style.setProperty('--hero', hex(h.color));
    const stat = (icon, label, v, max) => `<div class="mini-stat"><span>${icon}</span><i><u style="width:${Math.min(100, (100 * v) / max)}%"></u></i><b>${v}</b></div>`;
    const rangeLabel = (r) => (r <= 80 ? 'ближний бой' : r <= 200 ? 'средняя дистанция' : 'дальний бой');
    // У оборотня тип боя свой в каждом облике
    const atk = h.forms ? Object.values(h.forms).map((f) => `${f.name.toLowerCase()}: ${rangeLabel(f.range)}`).join(', ') : rangeLabel(h.range);
    box.querySelector('.reveal-card').innerHTML = `
      ${dupe ? `<div class="reveal-new">Дубликат! ★${dupe} — +${dupe * 5}% к статам</div>` : isNew ? '<div class="reveal-new">Новый герой!</div>' : ''}
      <div class="reveal-rarity">${r.name}</div>
      <div class="reveal-art"></div>
      <h2>${h.name}</h2>
      <div class="reveal-title">«${h.title}»${h.race ? ' · ' + h.race : ''} · ${atk} · ${h.resource.name}</div>
      ${h.tagline ? `<div class="reveal-tagline">— ${h.tagline} —</div>` : ''}
      <p class="reveal-desc">${h.desc}</p>
      ${h.style ? `<p class="reveal-style"><b>Стиль боя:</b> ${h.style}</p>` : ''}
      ${h.skills.map((sk) => `<div class="reveal-skill"><span>${sk.icon}</span><div><b>${sk.name}</b>
        <small>${sk.costLabel || (sk.hpCost ? `${Math.round(sk.hpCost * 100)}% здоровья` : `${sk.cost} ${h.resource.name.toLowerCase()}`)} · перезарядка ${sk.cooldown / 1000} с</small>
        <p>${sk.desc}</p></div></div>`).join('')}
      ${h.passive ? `<div class="reveal-skill passive-skill"><span>${h.passive.icon}</span><div><b>${h.passive.name}</b>
        <small>Пассивный навык</small><p>${h.passive.desc}</p></div></div>` : ''}
      ${stat('❤️', 'HP', h.hp, 200)}${stat('🗡', 'Урон', h.dmg, 35)}${stat('🎯', 'Дальность', h.range, 300)}${stat('👟', 'Скорость', h.speed, 200)}
      <button class="l2-btn reveal-ok">${isNew ? 'Забрать' : 'Закрыть'}</button>`;
    box.querySelector('.reveal-art').appendChild(heroCanvas(id));
    // Второй облик героя-оборотня
    if (h.forms) {
      const bc = document.createElement('canvas');
      bc.width = 32; bc.height = 32;
      bc.getContext('2d').drawImage(Gfx.werebeast(h.beastLook), 0, 0);
      box.querySelector('.reveal-art').appendChild(bc);
    }
    box.classList.remove('hidden');
    box.classList.toggle('is-new', isNew);
    box.querySelector('.reveal-ok').onclick = () => {
      box.classList.add('hidden');
      if (isNew) $('sheet').classList.add('hidden');
    };
  }

  // ---------- Фоны ----------
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
      const { ok, data } = await api('/api/invoice', { item: 'bg', bgId: bg.id });
      if (!ok) { toast(data.error || 'Оплата недоступна'); return; }
      tg.openInvoice(data.link, async (status) => {
        if (status !== 'paid') return;
        for (let i = 0; i < 5 && !profile.bgs.includes(bg.id); i++) {
          await new Promise((res) => setTimeout(res, 800));
          await loadProfile();
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
      const { ok, data } = await api('/api/profile', {});
      if (ok) profile = data;
      else $('status').textContent = data.error || '';
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
      heroes = cfg.heroes;
      rarities = cfg.rarities;
      backgrounds = cfg.backgrounds;
    } catch {
      $('status').textContent = 'Сервер недоступен';
      return;
    }
    await loadProfile();

    const lastHero = opts.store.get('lastHero');
    order = profile.heroes.includes(lastHero) ? [lastHero, ...profile.heroes.filter((k) => k !== lastHero)] : [...profile.heroes];
    const savedBg = opts.store.get('lobbyBg');
    if (savedBg && profile.bgs.includes(savedBg) && savedBg !== bgId) applyBg(savedBg, false);
    buildStage();
    $('playBtn').disabled = false;

    $('menuHeroes').onclick = openGacha;
    $('menuBg').onclick = () => openSheet('Фон лобби', bgSheet());
    $('sheetClose').onclick = closeSheet;
    $('sheet').onclick = (e) => { if (e.target === $('sheet')) closeSheet(); };
    $('playBtn').onclick = () => (order[0] ? opts.onStart(order[0], playerName()) : openGacha());

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
    openGacha: () => openGacha(),
    api: (url, body) => api(url, body),
  };
})();
