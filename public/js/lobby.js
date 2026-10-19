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
  let bgId = 'city'; // 'city' — фон города, из которого игрок вышел; иначе выбранный фон
  let cityPick = null;
  // Фон города: картинки мира последнего города (WorldArt.lobbyBgs), одна случайная на сессию
  function cityBg() {
    let th = 'green';
    try { th = localStorage.getItem('lastTown') || 'green'; } catch { /* */ }
    const list = window.WorldArt ? WorldArt.lobbyBgs(th) : [];
    if (!list.length) return null;
    if (!cityPick || !list.includes(cityPick)) cityPick = list[Math.floor(Math.random() * list.length)];
    return 'img:' + cityPick;
  }
  const realBg = (id) => (id === 'city' ? cityBg() || 'throne' : id);
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

  function heroCanvas(id, big) {
    const sk = id && window.Skins && Skins.canvas(id, big);
    if (sk) return sk;
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
      // Пустое место: в центре — светящийся круг призыва, по бокам — ничего (без тёмных силуэтов)
      if (slot !== 2) { el.classList.add('empty'); return el; }
      el.innerHTML = '<div class="summon-glow"><i></i><i></i><i></i></div>';
      el.onclick = () => openGacha();
      el.classList.add('selected');
      return el;
    }
    el.appendChild(heroCanvas(id, true));
    // Звери-спутники стоят у ног хозяина (на нарисованном портрете они уже есть)
    if (id && heroes[id].pets && !(window.Skins && Skins.get(id) && Skins.get(id).portrait)) {
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
    $('playBtn').textContent = has ? 'Начать' : '✨ Призвать героя';
    $('playBtn').classList.toggle('summon', !has);
    renderRoster();
  }

  // ---------- Все свои герои: лента, стрелки, свайп, окно «Мои герои» ----------
  // Постоянный порядок: редкость (лучшие первыми), затем уровень, затем имя
  const lvlOf = (id) => (profile.chars[id] || {}).level || 1;
  const rosterSort = {
    rarity: (a, b) => rankOf(heroes[b].rarity) - rankOf(heroes[a].rarity) || lvlOf(b) - lvlOf(a) || heroes[a].name.localeCompare(heroes[b].name),
    level: (a, b) => lvlOf(b) - lvlOf(a) || rankOf(heroes[b].rarity) - rankOf(heroes[a].rarity),
    name: (a, b) => heroes[a].name.localeCompare(heroes[b].name),
  };
  const roster = (sort = 'rarity') => profile.heroes.filter((id) => heroes[id]).sort(rosterSort[sort]);
  function chip(id) {
    const c = document.createElement('button');
    c.className = 'r-chip';
    c.dataset.id = id;
    c.style.setProperty('--rarity', rarityOf(id).color);
    c.appendChild(heroCanvas(id));
    c.insertAdjacentHTML('beforeend', `<em>${lvlOf(id)}</em>`);
    return c;
  }
  function renderRoster() {
    const box = $('roster'), list = roster();
    box.classList.toggle('hidden', list.length < 2);
    $('heroPrev').classList.toggle('hidden', list.length < 2);
    $('heroNext').classList.toggle('hidden', list.length < 2);
    $('menuRoster').classList.toggle('hidden', list.length < 2);
    $('menuRoster').textContent = `👥 Герои · ${list.length}`;
    box.innerHTML = '';
    list.forEach((id) => box.appendChild(chip(id)));
    markRoster();
  }
  function markRoster() {
    const box = $('roster');
    box.querySelectorAll('.r-chip').forEach((c) => c.classList.toggle('active', c.dataset.id === order[0]));
    const a = box.querySelector('.r-chip.active');
    if (a) box.scrollTo({ left: a.offsetLeft - box.clientWidth / 2 + a.offsetWidth / 2, behavior: 'smooth' });
  }
  function cycle(dir) {
    const list = roster();
    if (list.length < 2) return;
    const i = list.indexOf(order[0]);
    select(list[(i + dir + list.length) % list.length]);
  }
  function rosterSheet() {
    const box = document.createElement('div');
    const rk = [['all', 'Все']].concat(RANK().slice().reverse().map((k) => [k, rarities[k].name]));
    box.innerHTML = `<input class="r-search" placeholder="Поиск по имени" maxlength="20" />
      <div class="r-filter">${rk.map(([k, n]) => `<button class="tw-tab${k === 'all' ? ' on' : ''}" data-rk="${k}" ${k !== 'all' ? `style="color:${rarities[k].color}"` : ''}>${n}</button>`).join('')}</div>
      <div class="r-filter r-sort"><span>Сортировка:</span><button class="tw-tab on" data-sort="rarity">редкость</button><button class="tw-tab" data-sort="level">уровень</button><button class="tw-tab" data-sort="name">имя</button></div>
      <div class="hero-grid"></div>`;
    let f = 'all', sort = 'rarity', q = '';
    const grid = box.querySelector('.hero-grid');
    const draw = () => {
      grid.innerHTML = '';
      const list = roster(sort).filter((id) => (f === 'all' || heroes[id].rarity === f) && (!q || heroes[id].name.toLowerCase().includes(q)));
      for (const id of list) {
        const h = heroes[id], r = rarityOf(id), d = (profile.chars[id] || {}).dupes || 0;
        const card = document.createElement('button');
        card.className = 'hero-card owned' + (order[0] === id ? ' active' : '');
        card.style.setProperty('--rarity', r.color);
        card.appendChild(heroCanvas(id));
        card.insertAdjacentHTML('beforeend', `<b>${h.name}</b><span>${r.name}</span><em>Ур. ${lvlOf(id)}${d ? ` ★${d}` : ''}</em>`);
        card.onclick = () => { select(id); closeSheet(); };
        grid.appendChild(card);
      }
      if (!list.length) grid.innerHTML = '<p class="sheet-hint" style="grid-column:1/-1">Никого не найдено</p>';
    };
    box.querySelectorAll('[data-rk]').forEach((b) => { b.onclick = () => { f = b.dataset.rk; box.querySelectorAll('[data-rk]').forEach((x) => x.classList.toggle('on', x === b)); draw(); }; });
    box.querySelectorAll('[data-sort]').forEach((b) => { b.onclick = () => { sort = b.dataset.sort; box.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('on', x === b)); draw(); }; });
    box.querySelector('.r-search').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
    draw();
    return box;
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
    markRoster();
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
    const res = LobbyBg.paint(cnv, realBg(bgId), w, h, dpr, () => running && paintBg());
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

  // ---------- Призыв героев (баннеры) ----------
  let banner = 'event';
  const W = () => profile.wish || {};
  const wishes = () => (profile.paidSpins || 0) + Math.floor((W().gems || 0) / (W().gemsPerWish || 160));
  const canPay = (n) => (n === 1 && profile.freeSpin) || wishes() >= n;
  function costLabel(n) {
    if (n === 1 && profile.freeSpin) return 'бесплатно';
    const t = Math.min(profile.paidSpins || 0, n), g = (n - t) * (W().gemsPerWish || 160);
    return [t ? `🌟${t}` : '', g ? `💎${g}` : ''].filter(Boolean).join(' + ');
  }
  const plural = (n, a, b, c) => (n % 10 === 1 && n % 100 !== 11 ? a : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? b : c);
  const left = (t) => { const ms = Math.max(0, t - Date.now()), d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5); return d ? `${d} д ${h} ч` : `${h} ч`; };
  const portrait = (id, cls) => { const sk = window.Skins && Skins.get(id); return sk && sk.portrait ? `<img class="${cls}" src="${sk.portrait}" alt="${heroes[id].name}">` : ''; };
  const nameC = (id) => `<b style="color:${rarityOf(id).color}">${heroes[id].name}</b>`;

  function gachaSheet() {
    const box = document.createElement('div');
    box.className = 'gacha';
    const w = W(), ev = w.event || {}, st = banner === 'event' ? ev : w.standard || {};
    const dupes = (id) => (profile.chars[id] || {}).dupes || 0;
    const head = banner === 'event' && ev.mythic
      ? `<div class="wb-banner event">${portrait(ev.mythic, 'wb-main')}
          <div class="wb-info"><small>Избранный недели · ещё ${left(ev.ends)}</small><b>${heroes[ev.mythic].name}</b><em>«${heroes[ev.mythic].title}» · мифический</em>
          <div class="wb-sub">${ev.legendary.map((id) => `<span>${portrait(id, 'wb-mini')}${nameC(id)}</span>`).join('')}</div>
          <small>Избранный и его спутники призываются чаще. Если пришёл другой мифический — следующим точно будет ${heroes[ev.mythic].name}.</small></div></div>`
      : `<div class="wb-banner standard"><div class="wb-info"><small>Постоянный призыв</small><b>Зал героев</b><em>Все ${Object.keys(heroes).length} героев</em></div></div>`;
    box.innerHTML = `
      <div class="tw-tabs wb-tabs"><button class="tw-tab ${banner === 'event' ? 'on' : ''}" data-b="event">🌟 Избранный${ev.mythic ? ': ' + heroes[ev.mythic].name : ''}</button><button class="tw-tab ${banner === 'standard' ? 'on' : ''}" data-b="standard">⭐ Зал героев</button></div>
      ${head}
      <div class="reel-wrap"><div class="reel-marker"></div><div id="reel" class="reel"></div></div>
      <div class="wb-wallet"><span title="Самоцветы">💎 ${w.gems || 0}</span><span title="Печати призыва">🔮 ${profile.paidSpins || 0}</span><span title="Осколки душ">✨ ${w.glitter || 0}</span></div>
      <div class="btn-row wb-btns"><button id="spinBtn" class="l2-btn spin-btn" data-n="1">Призыв ×1<small>${costLabel(1)}</small></button><button class="l2-btn spin-btn" data-n="10">Призыв ×10<small>${costLabel(10)}</small></button></div>
      <p class="chances">Мифический герой — не позже чем через ${st.mythicIn} · легендарный или выше — через ${st.legIn}${banner === 'event' && ev.guarM ? ' · <b class="ok">следующий мифический — избранный недели</b>' : ''}${banner === 'event' && ev.guarL ? ' · <b class="ok">следующий легендарный — спутник недели</b>' : ''}</p>
      <div class="btn-row wb-links"><button class="l2-btn" data-a="hist">📜 История</button><button class="l2-btn" data-a="glitter">✨ Обмен осколков</button><button class="l2-btn" data-a="buy">🔮 Печати</button></div>
      <p class="sheet-hint">Повторный герой — дубликат (сильнее, до 10 копий) и осколки душ. 160 💎 = один призыв. Чем выше редкость, тем сильнее герой и быстрее растёт.</p>
      <div class="sheet-sub">Все герои · получено ${profile.heroes.length} из ${Object.keys(heroes).length}</div>
      <div class="hero-grid"></div>`;
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
    box.querySelectorAll('[data-b]').forEach((b) => { b.onclick = () => { banner = b.dataset.b; openGacha(); }; });
    box.querySelectorAll('.wb-btns [data-n]').forEach((b) => { b.onclick = () => spin(+b.dataset.n); });
    box.querySelector('[data-a="hist"]').onclick = () => openSheet('📜 История призывов', histSheet());
    box.querySelector('[data-a="glitter"]').onclick = () => openSheet('✨ Обмен осколков душ', glitterSheet());
    box.querySelector('[data-a="buy"]').onclick = () => buySpin('spin10');
    return box;
  }

  function histSheet() {
    const box = document.createElement('div');
    const h = W().hist || [];
    box.innerHTML = `<p class="sheet-hint">Последние ${h.length} призывов героев</p><div class="wb-hist">${h.map((x) => heroes[x.h] ? `<div><span>${new Date(x.t).toLocaleDateString('ru-RU')}</span>${nameC(x.h)}<em style="color:${rarities[x.r].color}">${rarities[x.r].name}</em><small>${x.b === 'event' ? '🌟 избранный' : '⭐ зал героев'}${x.f ? ' · избранный недели' : ''}</small></div>` : '').join('') || '<p class="sheet-hint">Пока пусто</p>'}</div>`;
    const back = document.createElement('button'); back.className = 'l2-btn wide'; back.textContent = 'Назад'; back.onclick = openGacha;
    box.append(back);
    return box;
  }

  function glitterSheet() {
    const box = document.createElement('div'), w = W(), pr = w.glitterPrice || { hero: 10, gear: 8 };
    box.innerHTML = `<p class="sheet-hint">Осколки душ даются за повторных героев (больше — за редких, вдвое — если дубликатов уже 10). У вас ✨ ${w.glitter || 0}</p>
      <div class="tw-ev"><div><b>🔮 Печать призыва</b><small>${pr.hero} ✨</small></div><div class="btn-row"><button class="l2-btn" data-w="hero" data-n="1">×1</button><button class="l2-btn" data-w="hero" data-n="10">×10</button></div></div>
      <div class="tw-ev"><div><b>🎁 Печать снаряжения</b><small>${pr.gear} ✨</small></div><div class="btn-row"><button class="l2-btn" data-w="gear" data-n="1">×1</button><button class="l2-btn" data-w="gear" data-n="10">×10</button></div></div>`;
    box.querySelectorAll('[data-w]').forEach((b) => { b.onclick = async () => {
      const { ok, data } = await api('/api/gacha/exchange', { what: b.dataset.w, n: +b.dataset.n });
      if (!ok) return toast(data.error || 'Не получилось');
      profile = data.profile; toast('Обмен выполнен'); openSheet('✨ Обмен осколков душ', glitterSheet());
    }; });
    const back = document.createElement('button'); back.className = 'l2-btn wide'; back.textContent = 'Назад'; back.onclick = openGacha;
    box.append(back);
    return box;
  }

  // ---------- Барабан: рубашки карт по редкости ----------
  // На барабане видна только редкость (цвет и звёзды), герой скрыт до раскрытия печати
  // Только редкости, у которых есть герои, от низшей к высшей
  const RANK = () => Object.keys(rarities).filter((k) => Object.values(heroes).some((h) => h.rarity === k));
  const rankOf = (rk) => RANK().indexOf(rk);
  const gRank = (rk) => Object.keys(rarities).indexOf(rk);    // место среди всех редкостей
  const STARS = (rk) => '✦'.repeat(gRank(rk) + 1);
  // Нарисованные рубашки: assets/gacha/back_<редкость>.webp (если файла нет — рисуется CSS)
  const backArt = {};
  function loadBackArt() {
    for (const rk of RANK()) {
      const im = new Image();
      im.onload = () => { backArt[rk] = `url("${im.src}")`; };
      im.src = `assets/gacha/back_${rk}.webp`;
    }
  }
  function reelCard(rk) {
    const r = rarities[rk];
    const card = document.createElement('div');
    card.className = 'reel-card back rk-' + rk;
    card.dataset.rk = rk;
    card.style.setProperty('--rarity', r.color);
    if (backArt[rk]) { card.style.setProperty('--art', backArt[rk]); card.classList.add('has-art'); }
    card.innerHTML = `<div class="rc-seal">◈</div><b>${STARS(rk)}</b><small>${r.name}</small>`;
    return card;
  }

  // Заполняет барабан; если задан result — его редкость окажется под маркером на позиции WIN_INDEX.
  // Рядом с выигрышем иногда кладётся карта выше рангом — барабан «чуть-чуть не докрутил».
  const WIN_INDEX = 40;
  function fillReel(reel, result) {
    reel.innerHTML = '';
    reel.style.transition = 'none';
    reel.style.transform = 'translateX(0)';
    const ids = Object.keys(heroes);
    const tiers = RANK(), total = tiers.reduce((s, k) => s + rarities[k].weight, 0);
    const pick = () => { let r = Math.random() * total; for (const k of tiers) { r -= rarities[k].weight; if (r < 0) return k; } return tiers[0]; };
    const n = result ? WIN_INDEX + 5 : 9;
    const cards = Array.from({ length: n }, pick);
    let near = false;
    if (result) {
      const rk = heroes[result].rarity, top = RANK()[RANK().length - 1];
      cards[WIN_INDEX] = rk;
      if (rk !== top && Math.random() < 0.55) { cards[WIN_INDEX + 1] = top; near = true; }
      // На подходе к финишу — побольше ярких карт, чтобы держать интригу
      for (const k of [WIN_INDEX - 3, WIN_INDEX - 6]) if (Math.random() < 0.6) cards[k] = RANK()[Math.max(2, rankOf(rk))] || top;
    }
    cards.forEach((rk) => reel.appendChild(reelCard(rk)));
    return near;
  }

  async function spin(n = 1) {
    if (spinning) return;
    const btn = $('spinBtn');
    // Не хватает печатей и самоцветов — открываем счёт в Telegram Stars
    if (!canPay(n)) return buySpin(n === 10 ? 'spin10' : 'spin');
    spinning = true;
    document.querySelectorAll('.wb-btns button').forEach((b) => { b.disabled = true; });
    btn.textContent = 'Призыв...';
    const { ok, data } = await api('/api/gacha/spin', { banner, n });
    if (!ok) {
      spinning = false;
      if (data.needPayment) return buySpin(n === 10 ? 'spin10' : 'spin');
      toast(data.error || 'Ошибка призыва');
      openGacha();
      return;
    }
    if (n === 10) return wish10(data);
    const rk = heroes[data.hero].rarity, high = rankOf(rk) >= RANK().length - 1;
    const reel = $('reel');
    const near = fillReel(reel, data.hero);
    const card = reel.children[WIN_INDEX];
    const wrap = reel.parentElement;
    wrap.classList.add('spinning');
    // Остановка: при «почти» — у самого края, вплотную к карте выше рангом
    const jitter = near ? card.offsetWidth * 0.4 : (Math.random() - 0.5) * card.offsetWidth * 0.6;
    const target = card.offsetLeft + card.offsetWidth / 2 - wrap.clientWidth / 2 + jitter;
    const dur = high ? 6200 : 5000;
    reel.getBoundingClientRect(); // применить сброс перед анимацией
    reel.style.transition = `transform ${dur}ms cubic-bezier(.08,.8,.1,1)`;
    reel.style.transform = `translateX(${-target}px)`;
    // Карта под маркером подсвечивается, каждая смена — щелчок (вибрация)
    let hot = null, alive = true;
    const step = card.offsetWidth + 6;
    const track = () => {
      if (!alive) return;
      const m = new DOMMatrix(getComputedStyle(reel).transform);
      const i = Math.floor((-m.m41 + wrap.clientWidth / 2 - 6) / step);
      const c = reel.children[i];
      if (c && c !== hot) { if (hot) hot.classList.remove('hot'); c.classList.add('hot'); hot = c; haptic('selectionChanged'); }
      requestAnimationFrame(track);
    };
    requestAnimationFrame(track);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true; alive = false;
      wrap.classList.remove('spinning');
      card.classList.add('win');
      if (near) reel.children[WIN_INDEX + 1].classList.add('miss');
      profile = data.profile;
      order = [data.hero, ...order.filter((k) => k !== data.hero)];
      opts.store.set('lastHero', data.hero);
      buildStage();
      setTimeout(() => summon(data.hero, data.dupe), near ? 700 : 350);
    };
    setTimeout(finish, dur + 150);
    wrap.onclick = () => { reel.style.transition = 'none'; reel.style.transform = `translateX(${-target}px)`; finish(); };
  }

  // ---------- Раскрытие печати ----------
  // Печать загорается редкостями по очереди — от обычной до выпавшей, затем трескается и показывает силуэт героя
  function summon(id, dupe, onEnd) {
    const h = heroes[id], rk = h.rarity, steps = RANK().slice(0, rankOf(rk) + 1);
    const box = document.createElement('div');
    box.className = 'sm-overlay';
    box.innerHTML = `<div class="sm-rays"></div><div class="sm-seal"><i></i><i></i><i></i><span>◈</span></div>
      <div class="sm-art"></div><div class="sm-text"></div><div class="sm-name"></div><div class="sm-skip">нажмите, чтобы пропустить</div>`;
    $('reveal').parentElement.appendChild(box);
    const art = box.querySelector('.sm-art');
    art.appendChild(heroCanvas(id, true));
    const text = box.querySelector('.sm-text');
    const timers = [];
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));
    let t = 200;
    steps.forEach((k, i) => {
      at(t, () => {
        const r = rarities[k];
        box.style.setProperty('--c', r.color);
        box.dataset.rk = k;
        box.classList.remove('pulse'); void box.offsetWidth; box.classList.add('pulse');
        text.innerHTML = `<b>${r.name}${'!'.repeat(Math.max(0, gRank(k) - 1))}</b><small>${STARS(k)}</small>`;
        haptic('impactOccurred', gRank(k) >= 3 ? 'heavy' : gRank(k) >= 2 ? 'medium' : 'light');
      });
      t += i === steps.length - 2 ? 1100 : 750;          // перед последней ступенью — пауза подольше
    });
    const top = steps.length === RANK().length;
    at(t, () => {
      box.classList.add('burst');
      if (top) { box.classList.add('shake'); haptic('notificationOccurred', 'success'); }
      burst(box, rarities[rk].color, [10, 16, 26, 40, 64][gRank(rk)] || 20);
    });
    at(t + 500, () => { box.classList.add('shown'); box.querySelector('.sm-name').innerHTML = `${dupe ? `<small>Дубликат ★${dupe}</small>` : '<small>Новый герой</small>'}<b>${h.name}</b><em>«${h.title}»</em>`; });
    at(t + 1500, () => box.classList.add('lit'));
    const end = () => { timers.forEach(clearTimeout); box.remove(); if (onEnd) onEnd(); else showHeroInfo(id, true, dupe); };
    at(t + 3200, end);
    box.onclick = () => (box.classList.contains('lit') ? end() : (timers.forEach(clearTimeout), timers.length = 0,
      box.style.setProperty('--c', rarities[rk].color), box.classList.add('burst', 'shown', 'lit'),
      box.querySelector('.sm-name').innerHTML = `<b>${h.name}</b><em>«${h.title}»</em>`, text.innerHTML = `<b>${rarities[rk].name}</b>`, at(900, end)));
    spinning = false;
  }
  function burst(box, color, n) {
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.className = 'sm-spark';
      const a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 180;
      p.style.cssText = `--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;--s:${0.5 + Math.random()};background:${Math.random() < 0.3 ? '#fff' : color};animation-delay:${Math.random() * 0.15}s`;
      box.appendChild(p);
    }
  }

  // ×10: если среди результатов есть легендарный или выше — сначала раскрытие лучшего, затем все десять карт
  function wish10(data) {
    profile = data.profile;
    const res = data.results, RO = Object.keys(rarities);
    const best = res.slice().sort((a, b) => RO.indexOf(b.rar) - RO.indexOf(a.rar))[0];
    order = [best.hero, ...order.filter((k) => k !== best.hero)];
    opts.store.set('lastHero', best.hero);
    buildStage();
    spinning = false;
    const grid = () => {
      const box = document.createElement('div');
      box.className = 'sm-overlay wish10';
      box.innerHTML = `<div class="w10-grid">${res.map((r, i) => `<div class="w10-card" style="--rarity:${rarities[r.rar].color};--d:${i * 0.12}s" data-i="${i}"><b>${heroes[r.hero].name}</b><span>${rarities[r.rar].name}</span><em>${r.isNew ? 'Новый!' : r.dupe ? `Дубликат ★${r.dupe}` : 'Максимум'}${r.glitter ? ` · ✨${r.glitter}` : ''}</em></div>`).join('')}</div>
        <button class="l2-btn spin-btn w10-ok">Готово</button>`;
      box.querySelectorAll('.w10-card').forEach((c) => c.prepend(heroCanvas(res[+c.dataset.i].hero, true)));
      $('reveal').parentElement.appendChild(box);
      box.querySelector('.w10-ok').onclick = () => { box.remove(); openGacha(); };
    };
    if (RO.indexOf(best.rar) >= RO.indexOf('legendary')) summon(best.hero, best.dupe, grid);
    else grid();
  }

  async function buySpin(item = 'spin') {
    const tg = opts.tg;
    if (!tg || !opts.tgUser || !tg.openInvoice) { toast('Нет печатей: 💎 самоцветы — за задания и в магазине, печати за Stars — в Telegram'); return; }
    const { ok, data } = await api('/api/invoice', { item });
    if (!ok) { toast(data.error || 'Оплата недоступна'); return; }
    tg.openInvoice(data.link, async (status) => {
      if (status !== 'paid') return;
      for (let i = 0; i < 6 && profile.paidSpins <= 0; i++) {
        await new Promise((res) => setTimeout(res, 800));
        await loadProfile();
      }
      if (profile.paidSpins > 0) openGacha();
      else toast('Оплата получена, печати появятся через несколько секунд');
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
      ${h.skills.map((sk, i) => `<div class="reveal-skill"><span>${SkillArt.icon(id, i, sk.icon)}</span><div><b>${sk.name}</b>
        <small>${sk.costLabel || (sk.hpCost ? `${Math.round(sk.hpCost * 100)}% здоровья` : `${sk.cost} ${h.resource.name.toLowerCase()}`)} · перезарядка ${sk.cooldown / 1000} с</small>
        <p>${sk.desc}</p></div></div>`).join('')}
      ${h.passive ? `<div class="reveal-skill passive-skill"><span>${SkillArt.icon(id, 'p', h.passive.icon)}</span><div><b>${h.passive.name}</b>
        <small>Пассивный навык</small><p>${h.passive.desc}</p></div></div>` : ''}
      ${stat('❤️', 'HP', h.hp, 200)}${stat('🗡', 'Урон', h.dmg, 35)}${stat('🎯', 'Дальность', h.range, 300)}${stat('👟', 'Скорость', h.speed, 200)}
      <button class="l2-btn reveal-ok">${isNew ? 'Забрать' : 'Закрыть'}</button>`;
    box.querySelector('.reveal-art').appendChild(heroCanvas(id, true));
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
    // Фон города — по умолчанию: меняется вместе с городом, из которого вы вышли
    if (cityBg()) {
      const card = document.createElement('button');
      card.className = 'bg-card' + (bgId === 'city' ? ' active' : '');
      const thumb = document.createElement('canvas');
      const paintThumb = () => LobbyBg.paint(thumb, cityBg(), tw, th, 1, paintThumb);
      paintThumb();
      card.appendChild(thumb);
      card.insertAdjacentHTML('beforeend', `<div class="bg-label"><b>🏙 Фон города</b><span>${bgId === 'city' ? '✓ Выбран' : 'Меняется с городом'}</span></div>`);
      card.onclick = () => { cityPick = null; applyBg('city'); closeSheet(); };
      box.appendChild(card);
    }
    for (const bg of backgrounds) {
      const owned = profile.bgs.includes(bg.id);
      const card = document.createElement('button');
      card.className = 'bg-card' + (bgId === bg.id ? ' active' : '') + (owned ? '' : ' paid');
      const thumb = document.createElement('canvas');
      const paintThumb = () => LobbyBg.paint(thumb, bg.id, tw, th, 1, paintThumb);
      paintThumb();
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
      // Кнопка админки: Telegram ID из ADMIN_TG_IDS или в этом браузере уже был вход в админку по паролю
      $('menuAdmin').classList.toggle('hidden', !profile.isAdmin);
      let key = '';
      try { key = localStorage.getItem('adminKey') || ''; } catch { /* приватный режим */ }
      if (!profile.isAdmin && key) {
        fetch('/admin/api/me', { method: 'POST', headers: { 'x-admin-key': key } })
          .then((r) => { if (r.ok) $('menuAdmin').classList.remove('hidden'); }).catch(() => {});
      }
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
      window.splashDone?.('Сервер недоступен');
      return;
    }
    await loadProfile();
    loadBackArt();

    const lastHero = opts.store.get('lastHero');
    order = profile.heroes.includes(lastHero) ? [lastHero, ...profile.heroes.filter((k) => k !== lastHero)] : [...profile.heroes];
    const savedBg = opts.store.get('lobbyBg');
    if (savedBg && (savedBg === 'city' || profile.bgs.includes(savedBg)) && savedBg !== bgId) applyBg(savedBg, false);
    buildStage();
    $('playBtn').disabled = false;
    window.splashDone?.();

    $('menuHeroes').onclick = openGacha;
    $('menuBg').onclick = () => openSheet('Фон лобби', bgSheet());
    $('menuRoster').onclick = () => openSheet('Мои герои', rosterSheet());
    $('heroPrev').onclick = () => cycle(-1);
    $('heroNext').onclick = () => cycle(1);
    $('roster').onclick = (e) => { const c = e.target.closest('.r-chip'); if (c) select(c.dataset.id); };
    // Свайп по сцене влево/вправо — следующий/предыдущий герой
    let sx = null, sy = 0;
    $('stage').addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    $('stage').addEventListener('touchend', (e) => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      sx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) cycle(dx < 0 ? 1 : -1);
    }, { passive: true });
    $('menuAdmin').onclick = () => { location.href = '/admin.html'; };
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
    heroCanvas: (id, big) => heroCanvas(id, big),
  };
})();
