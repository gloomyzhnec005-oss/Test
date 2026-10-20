// Точка входа: Telegram WebApp, выбор героя, HUD, джойстик
(() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  const tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
  if (tg) {
    tg.ready();
    tg.expand();
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    if (tg.setHeaderColor) tg.setHeaderColor('#11151c');
  }

  const $ = (id) => document.getElementById(id);
  document.body.classList.toggle('no-hints', !Settings.get('hints'));
  // Размер и прозрачность кнопок управления, джойстик справа для левши
  const applyCtrl = () => {
    const r = document.documentElement.style;
    r.setProperty('--cs', Settings.get('ctrlSize') / 100); r.setProperty('--co', Settings.get('ctrlOpacity') / 100);
    document.body.classList.toggle('lefty', !!Settings.get('leftHand'));
  };
  applyCtrl();
  Settings.on((k) => { if (/^ctrl|^leftHand$/.test(k)) applyCtrl(); });

  // ---------- Защита от приближения страницы (iOS Safari игнорирует user-scalable=no) ----------
  const block = (e) => e.preventDefault();
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((ev) => document.addEventListener(ev, block, { passive: false }));
  document.addEventListener('dblclick', block, { passive: false });
  // Двойной тап: второй тап быстрее 350 мс не должен приближать (кроме полей ввода)
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 350 && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
  // Щипок двумя пальцами вне игрового поля
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 && !e.target.closest('#game')) e.preventDefault(); }, { passive: false });
  // Если страница всё же приблизилась (например, после фокуса на поле) — возвращаем масштаб 1
  const vpMeta = document.querySelector('meta[name=viewport]');
  const VP = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  const resetZoom = () => {
    const vv = window.visualViewport;
    if (!vv || vv.scale <= 1.01 || /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName)) return;
    vpMeta.setAttribute('content', VP + ', minimum-scale=1');
    setTimeout(() => vpMeta.setAttribute('content', VP), 50);
    window.scrollTo(0, 0);
  };
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => setTimeout(resetZoom, 300));
  document.addEventListener('focusout', () => setTimeout(resetZoom, 300));
  window.addEventListener('pageshow', resetZoom);
  setInterval(resetZoom, 2000);
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  let guestId = store.get('guestId');
  if (!guestId) { guestId = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('guestId', guestId); }

  // ---------- Ввод ----------
  const input = { vec: { x: 0, y: 0 }, attack: false, skill: false };

  const joy = $('joystick'), stick = $('stick');
  let joyId = null;
  const joyMove = (t) => {
    const r = joy.getBoundingClientRect();
    const R = r.width / 2;
    let dx = t.clientX - (r.left + R), dy = t.clientY - (r.top + R);
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    stick.style.transform = `translate(${dx}px, ${dy}px)`;
    const k = Math.min(1, d / R);
    input.vec.x = d > 6 ? (dx / R) : 0;
    input.vec.y = d > 6 ? (dy / R) : 0;
    if (k < 0.15) input.vec.x = input.vec.y = 0;
  };
  const joyEnd = () => { joyId = null; input.vec.x = input.vec.y = 0; stick.style.transform = ''; };
  joy.addEventListener('pointerdown', (e) => { joyId = e.pointerId; joy.setPointerCapture(e.pointerId); joyMove(e); e.preventDefault(); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
  joy.addEventListener('pointerup', joyEnd);
  joy.addEventListener('pointercancel', joyEnd);

  const atk = $('attackBtn');
  atk.addEventListener('pointerdown', (e) => { input.attack = true; atk.classList.add('pressed'); e.preventDefault(); });
  const atkUp = () => { input.attack = false; atk.classList.remove('pressed'); };
  atk.addEventListener('pointerup', atkUp);
  atk.addEventListener('pointercancel', atkUp);
  atk.addEventListener('pointerleave', atkUp);

  // ---------- Чат ----------
  // Отдельное окно: вкладки «Игроки» (сообщения и стикеры) и «События» (системные), история с сервера.
  // Пока окно закрыто, свежие сообщения коротко всплывают над картой, на кнопке — счётчик непрочитанных.
  const chatLog = $('chatLog'), chatList = $('chatList'), chatWin = $('chatWin'), chatInput = $('chatInput');
  // Стикеры (assets/ui/stickers/<имя>.webp): сообщение вида [st:имя] рисуется картинкой
  const STICKERS = ['gg', 'lol', 'cry', 'angry', 'greedy', 'help', 'sleep', 'love'];
  let chatTab = 'talk', unread = 0;
  const chatOpen = () => !chatWin.classList.contains('hidden');
  const hhmm = (t) => new Date(t || Date.now()).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  function chatLine(msg, full) {
    const div = document.createElement('div');
    const st = !msg.sys && /^\[st:(\w+)\]$/.exec(msg.text || '');
    div.className = msg.sys ? 'sys' : 'talk notr'; // текст игроков не переводится
    if (full) { div.dataset.ch = msg.sys ? 'sys' : 'talk'; if (msg.sid && socket && msg.sid === socket.id) div.classList.add('mine'); }
    if (full) { const t = document.createElement('small'); t.textContent = hhmm(msg.t); div.append(t); }
    if (msg.sys) { div.append(msg.text); return div; }
    const b = document.createElement('b'); b.textContent = msg.name + ': ';
    if (st && STICKERS.includes(st[1])) {
      const im = document.createElement('img'); im.className = 'chat-sticker'; im.src = `assets/ui/stickers/${st[1]}.webp`; im.alt = st[1];
      div.classList.add('stk'); div.append(b, im);
    } else div.append(b, msg.text);
    return div;
  }
  function addChat(msg, quiet) {
    const atBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 40;
    const row = chatLine(msg, true);
    row.classList.toggle('hidden', row.dataset.ch !== chatTab);
    chatList.appendChild(row);
    while (chatList.children.length > 150) chatList.removeChild(chatList.firstChild);
    if (atBottom || row.classList.contains('mine')) chatList.scrollTop = chatList.scrollHeight;
    if (quiet || chatOpen()) return;
    if (!msg.sys) { unread++; $('chatBadge').textContent = unread > 9 ? '9+' : unread; $('chatBadge').classList.remove('hidden'); }
    if (!Settings.get('chatPop')) return;
    // Окно закрыто: всплывающая строка над картой и счётчик (только сообщения игроков)
    const div = chatLine(msg, false);
    chatLog.appendChild(div);
    while (chatLog.children.length > 4) chatLog.removeChild(chatLog.firstChild);
    setTimeout(() => div.remove(), 12000);
  }
  function setTab(ch) {
    chatTab = ch;
    chatWin.querySelectorAll('[data-ch]').forEach((b) => b.tagName === 'BUTTON' && b.classList.toggle('on', b.dataset.ch === ch));
    for (const r of chatList.children) r.classList.toggle('hidden', r.dataset.ch !== ch);
    chatList.scrollTop = chatList.scrollHeight;
  }
  // Клавиатура телефона: окно подстраивается под видимую часть экрана, игра не перехватывает клавиши
  function fitChat() {
    const vv = window.visualViewport;
    chatWin.style.height = vv ? vv.height + 'px' : '';
    chatWin.style.top = vv ? vv.offsetTop + 'px' : '';
  }
  if (window.visualViewport) { visualViewport.addEventListener('resize', () => chatOpen() && fitChat()); visualViewport.addEventListener('scroll', () => chatOpen() && fitChat()); }
  const gameKeys = (on) => { const kb = window.gameScene && gameScene.input && gameScene.input.keyboard; if (!kb) return; kb.enabled = on; if (on) kb.enableGlobalCapture(); else { kb.disableGlobalCapture(); kb.resetKeys(); } };
  function openChat() {
    chatWin.classList.remove('hidden'); chatLog.innerHTML = '';
    unread = 0; $('chatBadge').classList.add('hidden');
    fitChat(); gameKeys(false);
    chatList.scrollTop = chatList.scrollHeight;
  }
  function closeChat() { chatInput.blur(); chatWin.classList.add('hidden'); chatWin.style.height = chatWin.style.top = ''; gameKeys(true); }
  $('chatBtn').onclick = () => (chatOpen() ? closeChat() : openChat());
  $('chatClose').onclick = closeChat;
  chatWin.onclick = (e) => { if (e.target === chatWin) closeChat(); };
  chatWin.querySelector('.chat-tabs').onclick = (e) => { const b = e.target.closest('[data-ch]'); if (b) setTab(b.dataset.ch); };
  $('stickerBar').innerHTML = STICKERS.map((k) => `<button type="button" data-st="${k}"><img src="assets/ui/stickers/${k}.webp" alt="${k}"></button>`).join('');
  $('stickerBar').onclick = (e) => {
    const b = e.target.closest('[data-st]');
    if (!b || !socket) return;
    socket.emit('chat', `[st:${b.dataset.st}]`);
    setTab('talk');
  };
  const sendChat = () => {
    const v = chatInput.value.trim();
    if (!v || !socket) return;
    socket.emit('chat', v);
    chatInput.value = '';
    setTab('talk');
  };
  $('chatForm').onsubmit = (e) => { e.preventDefault(); sendChat(); };
  // Кнопка отправки не забирает фокус у поля — клавиатура остаётся открытой
  $('chatSend').addEventListener('pointerdown', (e) => e.preventDefault());
  chatInput.addEventListener('keydown', (e) => e.stopPropagation());
  chatInput.addEventListener('focus', () => gameKeys(false));

  // ---------- HUD ----------
  let resName = '';
  let shownForm; // undefined — подписи ещё не выставлены
  // Подписи кнопок под текущий облик (Талиесин)
  // Подписи кнопок под текущее состояние героя: облик/стихия/обет (s.form) или своё поле кнопки (sk.formKey)
  function applyForm(s) {
    const key = JSON.stringify([s.form, s.formKeys]);
    if (key === shownForm) return;
    shownForm = key;
    for (const btn of Object.values(skillBtns)) {
      if (!btn.sk.forms) continue;
      const state = btn.sk.formKey ? (s.formKeys || {})[btn.sk.formKey] : s.form;
      const v = btn.sk.forms[state || 'human'];
      if (!v) continue;
      if (!btn.el.classList.contains('art')) btn.el.querySelector('.sk-icon').textContent = v.icon;
      btn.el.querySelector('em').textContent = v.name;
    }
  }
  let passiveDef = null;
  // Рамка аватара по уровню героя: бронза, серебро, золото, платина, бриллиант, легенда (50)
  const avaTier = (l) => (l >= 50 ? 'legend' : l >= 40 ? 'diamond' : l >= 30 ? 'platinum' : l >= 20 ? 'gold' : l >= 10 ? 'silver' : 'bronze');
  function setStats(s) {
    $('lvl').textContent = s.level;
    const tier = avaTier(s.level);
    if ($('hudAvaFrame').dataset.t !== tier) { $('hudAvaFrame').dataset.t = tier; $('hudAvaFrame').style.backgroundImage = `url(assets/ui/ava/${tier}.webp)`; }
    $('hpFill').style.width = (100 * s.hp / s.maxHp) + '%';
    $('hpText').textContent = `${s.hp} / ${s.maxHp}${s.shield ? ` +🛡${s.shield}` : ''}`;
    if (s.resMax) {
      $('resFill').style.width = (100 * s.res / s.resMax) + '%';
      $('resText').textContent = `${resName}: ${s.res} / ${s.resMax}`;
    }
    $('xpFill').style.width = (100 * s.xp / s.xpNext) + '%';
    $('xpText').textContent = `${s.xp} / ${s.xpNext} XP`;
    $('gold').textContent = s.gold;
    $('kills').textContent = s.kills;
    $('dmg').textContent = s.dmg;
    if (s.form !== undefined || s.formKeys) applyForm(s);
    // Закрытые умения (откроются с уровнем или дубликатами)
    if (s.unlocked !== undefined) for (const btn of Object.values(skillBtns)) btn.el.classList.toggle('locked', btn.idx >= s.unlocked);
    if (passiveDef) {
      const parts = [];
      const sg = (v) => (v > 0 ? '+' + v : '−' + Math.abs(v));
      if (s.bonusDmg) parts.push(`${sg(s.bonusDmg)}% урона`);
      if (s.bonusSpd) parts.push(`${sg(s.bonusSpd)}% скор.`);
      if (s.passiveNote) parts.push(s.passiveNote);
      $('passive').textContent = `${passiveDef.icon} ${parts.join(' · ') || passiveDef.name}`;
    }
  }

  let minimapBase = null;
  const MM_COLORS = {
    green: ['#4e9a3a', '#2f6fb5', '#2d6b22', '#c9a66b', '#4e9a3a', '#6e5a44', '#3c3a38', '#a03a2a', '#d8c8a0'],
    abyss: ['#2a2430', '#07040c', '#3a2a2a', '#4a4250', '#2a2430', '#3a3438', '#15121a', '#6a3a9a', '#3a3448'],
    sky: ['#e8f0ff', '#7ac8ff', '#ffd84a', '#f4eee0', '#e8f0ff', '#d8e4f4', '#c8d8f0', '#e8c060', '#fffaf0'],
  };
  function buildMinimap(map) {
    const colors = MM_COLORS[map.theme] || MM_COLORS.green;
    const c = document.createElement('canvas');
    c.width = map.w; c.height = map.h;
    const ctx = c.getContext('2d');
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const t = map.tiles[y * map.w + x];
      ctx.fillStyle = t === 16 ? '#a08a60' : colors[t] || '#000'; // 16 — украшение
      ctx.fillRect(x, y, 1, 1);
    }
    minimapBase = c;
  }
  let mmTick = 0;
  function drawMinimap(state, myId, tile, map) {
    if (++mmTick % 3 || !minimapBase) return;
    const cnv = $('minimap'), ctx = cnv.getContext('2d');
    const sx = cnv.width / map.w, sy = cnv.height / map.h;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(minimapBase, 0, 0, cnv.width, cnv.height);
    ctx.fillStyle = '#ff4040';
    const ox = map.ox || 0, oy = map.oy || 0;
    // В данже мини-карта показывает только разведанное
    const ex = map.fog && window.gameScene && window.gameScene.explored.get(map.id);
    if (ex) {
      ctx.fillStyle = '#050608';
      const k = Math.ceil(sx) + 1;
      for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (!ex.has(y * map.w + x)) ctx.fillRect(Math.floor(x * sx), Math.floor(y * sy), k, Math.ceil(sy) + 1);
      ctx.fillStyle = '#ff4040';
      for (const m of state.m) if (ex.has(Math.floor((m.y - oy) / tile) * map.w + Math.floor((m.x - ox) / tile))) ctx.fillRect((m.x - ox) / tile * sx - 1, (m.y - oy) / tile * sy - 1, 2, 2);
      state = { ...state, m: [] };
    }
    for (const m of state.m) ctx.fillRect((m.x - ox) / tile * sx - 1, (m.y - oy) / tile * sy - 1, 2, 2);
    ctx.fillStyle = '#c890ff';
    for (const o of map.objs || []) if (o.kind === 'portal') ctx.fillRect((o.x - ox) / tile * sx - 2, (o.y - oy) / tile * sy - 2, 4, 4);
    for (const p of state.p) {
      ctx.fillStyle = p.id === myId ? '#ffff00' : '#ffffff';
      const s = p.id === myId ? 4 : 3;
      ctx.fillRect((p.x - ox) / tile * sx - s / 2, (p.y - oy) / tile * sy - s / 2, s, s);
    }
  }

  const vibrate = (kind) => {
    if (!Settings.get('vibro')) return;
    const h = tg && tg.HapticFeedback;
    if (!h) { if (navigator.vibrate) navigator.vibrate(kind === 'heavy' ? 40 : kind === 'medium' ? 25 : 12); return; }
    if (kind === 'success') h.notificationOccurred('success');
    else h.impactOccurred(kind);
  };

  // ---------- Умения (до трёх кнопок) ----------
  const skillBtns = {};
  function buildSkills(hero) {
    const box = $('skills');
    box.innerHTML = '';
    box.className = `skills n${hero.skills.length}`;
    hero.skills.forEach((sk, i) => {
      const b = document.createElement('button');
      b.className = `round skill s${i}${SkillArt.has(hero.id) ? ' art' : ''}`;
      b.innerHTML = `<span class="sk-icon">${SkillArt.icon(hero.id, i, sk.icon)}</span><i class="sk-cd"></i><em>${sk.name}</em>`;
      b.addEventListener('pointerdown', (e) => { input.skill = sk.id; b.classList.add('pressed'); e.preventDefault(); });
      const up = () => b.classList.remove('pressed');
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
      box.appendChild(b);
      skillBtns[sk.id] = { el: b, cd: b.querySelector('.sk-cd'), timer: 0, sk, idx: i };
    });
  }
  function startSkillCd(id, ms, total = ms) {
    const btn = skillBtns[id];
    if (!btn) return;
    const until = performance.now() + ms;
    if (ms <= 0) { cancelAnimationFrame(btn.timer); btn.el.classList.remove('cooling'); btn.cd.style.background = ''; btn.cd.textContent = ''; return; }
    btn.el.classList.add('cooling');
    cancelAnimationFrame(btn.timer);
    const tick = () => {
      const left = until - performance.now();
      if (left <= 0) { btn.el.classList.remove('cooling'); btn.cd.style.background = ''; btn.cd.textContent = ''; return; }
      btn.cd.style.background = `conic-gradient(rgba(0,0,0,.7) ${360 * (left / total)}deg, transparent 0)`;
      btn.cd.textContent = Math.ceil(left / 1000);
      btn.timer = requestAnimationFrame(tick);
    };
    tick();
  }
  function hudToast(text) {
    const t = $('hudToast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(hudToast.tm);
    hudToast.tm = setTimeout(() => t.classList.add('hidden'), 1500);
    vibrate('light');
  }

  // ---------- Запуск ----------
  let socket = null, game = null;

  function startGame(selected, name) {
    Lobby.setBusy(true);
    Lobby.setStatus('Подключение...');

    socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      socket.emit('join', { hero: selected, initData: tg ? tg.initData : '', guestId, guestName: name });
    });
    socket.on('error_msg', (m) => { Lobby.setStatus(m); Lobby.setBusy(false); socket.disconnect(); });
    socket.on('chat', (m) => addChat(m));
    socket.on('chatHistory', (list) => { chatList.innerHTML = ''; for (const m of list || []) addChat(m, true); });
    socket.on('stats', setStats);
    socket.on('skillUsed', ({ id, cooldown }) => startSkillCd(id, cooldown));
    // Сервер сократил перезарядку (убийство Найри) — обновляем таймеры кнопок
    socket.on('skillCds', (cds) => Object.entries(cds).forEach(([id, c]) => startSkillCd(id, c.left, c.total)));
    socket.on('skillFail', hudToast);
    socket.on('disconnect', () => { if (game) addChat({ sys: true, text: 'Связь потеряна, переподключение...' }); });
    socket.on('welcome', (w) => {
      if (game) { location.reload(); return; } // переподключение после обрыва — начинаем заново
      Lobby.hide();
      $('hud').classList.remove('hidden');
      const hero = w.heroes[selected];
      $('heroName').textContent = `${name} · ${hero.name}`;
      const sk = window.Skins && Skins.get(selected);
      if (sk && sk.portrait) $('hudAvaImg').src = sk.portrait; else $('hudAva').classList.add('hidden');
      resName = hero.resource.name;
      $('resFill').style.background = hero.resource.color;
      buildSkills({ ...hero, id: selected });
      const atkArt = SkillArt.attack(selected);
      $('attackBtn').classList.toggle('art', !!atkArt);
      $('attackBtn').innerHTML = atkArt ? `<img src="${atkArt}" alt="⚔️" draggable="false">` : '⚔️';
      passiveDef = hero.passive || null;
      $('passive').classList.toggle('hidden', !passiveDef);
      setStats(w.stats);
      let zone = w.zone;
      buildMinimap(zone);
      Town.setContext({ socket, towns: w.towns, hero, heroes: w.heroes, skillUnlock: w.skillUnlock, onGacha: () => Lobby.openGacha(), api: Lobby.api, tg });
      Bag.init({ socket });
      // ---------- Группа ----------
      let party = null, inviteId = null;
      const renderParty = () => {
        const f = $('partyFrame');
        f.classList.toggle('hidden', !party);
        if (party) f.innerHTML = party.members.map((m) => `<div>${m.id === party.leader ? '<img class="ui-ic" src="assets/ui/ic_crown.webp" alt="👑">' : ''}${m.name} <small>${m.hero} · ${m.lvl} · ${m.zone}</small></div>`).join('');
      };
      socket.on('party', (p) => { party = p; renderParty(); });
      socket.on('partyInvite', (d) => {
        inviteId = d.id;
        const box = $('partyInvite');
        box.querySelector('b').textContent = `👥 ${d.from} приглашает вас в группу`;
        box.classList.remove('hidden');
        vibrate('medium');
      });
      $('piYes').onclick = () => { socket.emit('party', { op: 'accept', id: inviteId }); $('partyInvite').classList.add('hidden'); };
      $('piNo').onclick = () => $('partyInvite').classList.add('hidden');
      // Быстрое зелье: сначала большое, потом обычное
      $('potBtn').onclick = async () => {
        let r = await Bag.act('useMat', { mat: 'potHp2' });
        if (r.error === 'Нет такого предмета') r = await Bag.act('useMat', { mat: 'potHp' });
        Town.toast(r.error === 'Нет такого предмета' ? 'Нет зелий — купите в лавке эликсиров' : r.error || r.toast);
      };
      const openParty = () => {
        const box = document.createElement('div');
        const me = socket.id;
        box.innerHTML = `<p class="sheet-hint">Группа до 4 игроков: общий опыт (70% каждому рядом), добыча с боссов — каждому, данж выживания — вместе.</p>
          ${party ? `<div class="ic-sec">Ваша группа</div>${party.members.map((m) => `<div class="tw-ev"><div><b>${m.id === party.leader ? '<img class="ui-ic" src="assets/ui/ic_crown.webp" alt="👑">' : ''}${m.name}</b><small>${m.hero} · ур. ${m.lvl} · ${m.zone}</small></div></div>`).join('')}
            <button class="l2-btn wide" id="pLeave">Покинуть группу</button>` : ''}
          <div class="ic-sec">Игроки рядом</div>`;
        const near = window.gameScene ? [...window.gameScene.players.values()].map((e) => e.data).filter((d) => d && d.id !== me) : [];
        if (!near.length) box.insertAdjacentHTML('beforeend', '<div class="tw-soon">В этой зоне больше никого нет</div>');
        for (const d of near) {
          const inParty = party && party.members.some((m) => m.id === d.id);
          const row = document.createElement('div');
          row.className = 'tw-ev';
          row.innerHTML = `<div><b>${d.name}</b><small>${w.heroes[d.hero].name} · ур. ${d.lvl}</small></div><button class="l2-btn" ${inParty ? 'disabled' : ''}>${inParty ? 'В группе' : 'Пригласить'}</button>`;
          row.querySelector('button').onclick = () => { socket.emit('party', { op: 'invite', target: d.id }); Town.close(); };
          box.append(row);
        }
        const lv = box.querySelector('#pLeave');
        if (lv) lv.onclick = () => { socket.emit('party', { op: 'leave' }); Town.close(); };
        Town.open('👥 Группа', box);
      };
      // ---------- Данж выживания: номер волны ----------
      // Прогресс данжа-лабиринта
      socket.on('dungeon', (d) => {
        window.hallInfo = d; // для подсказки у запечатанных ворот босса
        const b = $('waveBadge');
        // Общий зал: сколько игроков, полубоссы (здесь / через N мин) и босс (здесь / время появления)
        const mins = (ms) => Math.max(1, Math.ceil(ms / 60000));
        const at = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const mi = (d.minis || []).map((m) => (m.alive ? '⭐ здесь' : `⭐ ${mins(m.in)} мин`)).join(' ');
        const bs = d.boss ? (d.boss.alive ? '👑 здесь!' : d.boss.in < 36e5 ? `👑 ${mins(d.boss.in)} мин` : `👑 в ${at(d.boss.at)}`) : '';
        b.textContent = `👥 ${d.online} · ${mi} · ${bs}`;
        b.classList.remove('hidden');
      });
      // Арена: очередь, ход боя и итог
      socket.on('arenaQ', (q) => {
        const b = $('waveBadge');
        if (!q) { if (b.dataset.q) { b.classList.add('hidden'); delete b.dataset.q; } return; }
        b.dataset.q = 1;
        b.textContent = `⏳ ${q.name}: поиск соперников · ${q.waiting}/${q.need}`;
        b.classList.remove('hidden');
      });
      socket.on('match', (d) => {
        const b = $('waveBadge'), t = Math.ceil(d.left / 1000), bar = (x) => `${x[0]} ${Math.round(x[1] * 100)}%`;
        delete b.dataset.q;
        if (!b.dataset.m) { b.dataset.m = 1; Town.close(); } // окно арены закрывается один раз — в начале боя
        b.textContent = `⚔️ ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} · ${d.me.map(bar).join(', ')} ⟷ ${d.foe.map(bar).join(', ')}`;
        b.classList.remove('hidden');
      });
      socket.on('matchEnd', (d) => {
        hudToast(d.draw ? '🤝 Ничья' : d.win ? '🏆 Победа!' : '💀 Поражение');
        if (window.Sfx) Sfx.play(d.win ? 'reward' : 'death');
        setTimeout(() => { $('waveBadge').classList.add('hidden'); delete $('waveBadge').dataset.m; }, 3000);
      });
      socket.on('survival', (d) => {
        const b = $('waveBadge');
        b.textContent = `💀 Волна ${d.wave}${d.boss ? ' · ДРАКОН!' : ''}`;
        b.classList.remove('hidden');
        hudToast(`Волна ${d.wave}!`);
      });
      // Кнопка действия рядом со зданием, порталом или телепортом
      let near = null;
      $('actBtn').onclick = () => {
        if (!near) return;
        if (near.kind === 'portal') socket.emit('travel', { via: near.id });
        else Town.openPlace(near.place);
      };
      // ---------- Нижнее меню ----------
      const menuRow = (icon, name, desc, fn) => {
        const r = document.createElement('button');
        r.className = 'nav-row';
        r.innerHTML = `<span>${/^[a-z]+$/.test(icon) ? `<img class="place-ic big" src="assets/ui/${icon === "chat" ? "nav_chat" : "place_" + icon}.webp" alt="">` : icon}</span><div><b>${name}</b><small>${desc}</small></div><i>›</i>`;
        r.onclick = fn;
        return r;
      };
      const menuSheet = (title, rows) => { const box = document.createElement('div'); box.className = 'nav-menu'; rows.forEach((r) => box.append(menuRow(...r))); Town.open(title, box); };
      // ---------- Настройки ----------
      // Звук (вкл/выкл, громкость эффектов и музыки, вибрация), экран, подсказки, экономия батареи, аккаунт
      function openSettings() {
        const box = document.createElement('div'); box.className = 'set-box';
        const sec = (t) => { const h = document.createElement('h4'); h.className = 'set-h'; h.textContent = t; box.append(h); };
        const row = (name, desc, ctl) => { const r = document.createElement('div'); r.className = 'set-row'; r.innerHTML = `<div><b>${name}</b>${desc ? `<small>${desc}</small>` : ''}</div>`; r.append(ctl); box.append(r); return r; };
        const toggle = (val, fn) => { const b = document.createElement('button'); b.className = 'set-tg' + (val ? ' on' : ''); b.innerHTML = '<i></i>'; b.onclick = () => { const v = !b.classList.contains('on'); b.classList.toggle('on', v); fn(v); if (window.Sfx) Sfx.play('click'); }; return b; };
        const opt = (key) => toggle(Settings.get(key), (v) => Settings.set(key, v));
        const slider = (key, min = 0, max = 100) => {
          const w = document.createElement('label'); w.className = 'set-sl';
          w.innerHTML = `<input type="range" min="${min}" max="${max}" step="5" value="${Settings.get(key)}"><span>${Settings.get(key)}%</span>`;
          const inp = w.querySelector('input'), out = w.querySelector('span');
          inp.oninput = () => { out.textContent = inp.value + '%'; Settings.set(key, +inp.value); };
          inp.onchange = () => { if (key === 'sfxVol' && window.Sfx) Sfx.play('coin'); };
          return w;
        };
        const btn = (text, fn, cls = '') => { const b = document.createElement('button'); b.className = 'l2-btn small ' + cls; b.textContent = text; b.onclick = fn; return b; };
        sec('🔊 Звук');
        row('Звук в игре', 'Общий выключатель эффектов и музыки', toggle(window.Sfx && Sfx.isOn(), (v) => { if (window.Sfx && Sfx.isOn() !== v) Sfx.toggle(); }));
        row('Эффекты', 'Удары, умения, добыча', slider('sfxVol'));
        row('Музыка', 'Фоновая мелодия города и данжей', slider('musicVol'));
        row('Вибрация', tg && tg.HapticFeedback ? 'Отдача при ударах и наградах' : 'Работает в Telegram и на Android', opt('vibro'));
        sec('🎮 Управление');
        row('Размер кнопок', 'Джойстик, атака, умения и зелье', slider('ctrlSize', 80, 130));
        row('Прозрачность кнопок', 'Меньше — лучше видно карту', slider('ctrlOpacity', 40, 100));
        row('Джойстик справа', 'Для левой руки: атака и умения слева', opt('leftHand'));
        sec('🌐 Язык');
        const lg = document.createElement('div'); lg.className = 'set-langs notr';
        lg.innerHTML = Object.entries(I18N.LANGS).map(([k, n]) => `<button type="button" data-lang="${k}" class="${k === I18N.lang ? 'on' : ''}">${n}</button>`).join('');
        lg.onclick = (e) => { const b = e.target.closest('[data-lang]'); if (b && b.dataset.lang !== I18N.lang) I18N.set(b.dataset.lang); };
        box.append(lg);
        sec('🖥️ Экран');
        row('Цифры урона', 'Всплывающий урон над целями', opt('dmgNums'));
        row('Имена над героями', 'Имена игроков и монстров на карте', opt('names'));
        row('Чат над картой', 'Новые сообщения коротко видны в игре', opt('chatPop'));
        row('Экономия батареи', '30 кадров в секунду вместо 60', opt('lowFps'));
        sec('💡 Подсказки');
        row('Подсказки в игре', 'У ворот босса и пояснения в окнах', opt('hints'));
        row('Обучение', 'Показать знакомство с управлением заново', btn('Начать', () => { Town.close(); Tutorial.start(true); }));
        sec('👤 Аккаунт');
        const pr = Lobby.profile() || {};
        row('Игрок', `${Lobby.playerName()} · герой ${hero.name}`, btn('В лобби', () => location.reload()));
        const id = pr.tgId || pr.uid || '';
        if (id) row(pr.tgId ? 'Telegram ID' : 'ID игрока', String(id), btn('Копировать', () => { (navigator.clipboard ? navigator.clipboard.writeText(String(id)) : Promise.reject()).then(() => Town.toast('ID скопирован'), () => Town.toast(String(id))); }));
        row('Сбросить настройки', 'Вернуть всё как было по умолчанию', btn('Сбросить', () => { Settings.reset(); if (window.Sfx && !Sfx.isOn()) Sfx.toggle(); Town.toast('Настройки сброшены'); openSettings(); }, 'ghost'));
        Town.open('⚙️ Настройки', box);
      }
      const NAV = {
        hero: () => Bag.open('hero'),
        bag: () => Bag.open('bag'),
        quests: () => Town.openPlace('events'),
        gacha: () => Town.openPlace('gacha'),
        store: () => Town.openPlace('store'),
        play: () => menuSheet('⚔️ Игра', [
          ['arena', 'Арена', 'PvP со снимками героев других игроков · рейтинг и награды', () => Town.openPlace('arena')],
          ['pass', 'Боевой пропуск', 'Задания сезона и награды за уровни', () => Town.openPlace('pass')],
          ['party', 'Группа', 'До 4 игроков: общий опыт, добыча и данжи', openParty],
          ['chat', 'Чат', 'Общий чат всех игроков', () => { Town.close(); $('chatBtn').click(); }],
          ['smith', 'Соединение 5 → 1', 'Улучшить редкость предметов', () => Bag.open('merge')],
          ['survival', 'Данжи и порталы', zone.kind === 'town' ? 'Порталы данжей, выживание и телепорт стоят в городе — подойдите к ним' : 'Вы за порталом: победите босса или вернитесь в город', () => Town.close()],
        ]),
        settings: () => openSettings(),
      };
      // Значок готовых наград на кнопке «Квесты»
      const questBadge = (n) => { const b = document.querySelector('[data-nav="quests"]'); b.dataset.badge = n > 0 ? n : ''; };
      Town.setContext({ onQuests: questBadge });
      socket.on('chat', (m) => { if (m.sys && /^📜 Задание выполнено/.test(m.text)) { const b = document.querySelector('[data-nav="quests"]'); questBadge((+b.dataset.badge || 0) + 1); if (window.Sfx) Sfx.play('quest'); } });
      Bag.act('quests').then((r) => r.quests && questBadge(['daily', 'weekly', 'monthly'].reduce((s, k) => s + r.quests[k].list.filter((q) => q.prog >= q.goal && !q.claimed).length, 0)));
      $('navBar').onclick = (e) => { const b = e.target.closest('button[data-nav]'); if (b) { vibrate('light'); if (window.Sfx) Sfx.play('click'); NAV[b.dataset.nav](); } };
      const ui = {
        onWorld: (s, myId) => drawMinimap(s, myId, w.tile, zone),
        onZone: (z) => {
          if (window.Sfx) { if (zone && zone.id !== z.id) Sfx.play('portal'); Sfx.music(z.kind === 'town' ? z.theme : 'dungeon'); }
          zone = z;
          buildMinimap(z);
          Town.setContext({ zone: z });
          Town.close();
          if (z.kind !== 'survival' && z.kind !== 'dungeon') $('waveBadge').classList.add('hidden');
          const b = $('zoneBanner');
          b.querySelector('b').textContent = z.name;
          b.querySelector('small').textContent = z.kind === 'town' ? `${z.sub} · уровень ${z.level}` : z.sub;
          b.classList.add('hidden'); void b.offsetWidth; b.classList.remove('hidden');
          clearTimeout(ui.bannerTm); ui.bannerTm = setTimeout(() => b.classList.add('hidden'), 2900);
        },
        onNear: (o, z, activate) => {
          if (activate) { $('actBtn').click(); return; }
          near = o;
          const btn = $('actBtn');
          btn.classList.toggle('hidden', !o);
          if (!o) return;
          btn.textContent = o.kind === 'portal' ? (o.id === 'back' ? `🏰 ${o.name}` : `🌀 Войти: ${o.name}`) : `${o.icon} ${o.name}`;
          if (o.place) btn.innerHTML = Town.placeImg(o.place) + btn.textContent.slice(o.icon.length + 1).replace(/[<&]/g, '');
          vibrate('light');
        },
        onTarget: (name, hp, maxHp) => {
          if (!name) { $('target').classList.add('hidden'); return; }
          $('target').classList.remove('hidden');
          $('targetName').textContent = `${name} — ${hp}/${maxHp}`;
          $('targetFill').style.width = (100 * hp / maxHp) + '%';
        },
        onDeath: () => { $('deathScreen').classList.remove('hidden'); vibrate('heavy'); },
        onRespawn: () => $('deathScreen').classList.add('hidden'),
        vibrate,
      };
      // Рисуем в физических пикселях экрана (до ×2), иначе на телефоне картинка и текст растягиваются и мылятся
      const DPR = window.GAME_DPR = Math.min(2, window.devicePixelRatio || 1);
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: 'game',
        backgroundColor: '#11151c',
        pixelArt: true,
        scale: { mode: Phaser.Scale.NONE, width: Math.round(window.innerWidth * DPR), height: Math.round(window.innerHeight * DPR), zoom: 1 / DPR },
        input: { activePointers: 3, windowEvents: false }, // касания поверх окон и кнопок не доходят до мира
        scene: [],
        fps: { limit: Settings.get('lowFps') ? 30 : 0 },
      });
      // Настройки, которые меняются прямо в игре: имена над героями, частота кадров, подсказки
      Settings.on((k, v) => {
        const sc = window.gameScene;
        if (k === 'names' && sc) for (const m of [sc.players, sc.monsters, sc.pets]) if (m) for (const e of m.values()) if (e.label) e.label.setVisible(v);
        if (k === 'lowFps') { const L = game.loop; L.sleep(); L.fpsLimit = v ? 30 : 0; L.hasFpsLimit = !!v; L._limitRate = v ? 1000 / 30 : 0; L.wake(true); }
        if (k === 'hints') document.body.classList.toggle('no-hints', !v);
      });
      game.scene.add('Game', window.GameScene, true, { socket, welcome: w, ui, input });
      setTimeout(() => window.Tutorial && Tutorial.start(), 1800); // обучение при первом входе
      let rt = 0;
      window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { game.scale.resize(Math.round(window.innerWidth * DPR), Math.round(window.innerHeight * DPR)); game.scale.setZoom(1 / DPR); }, 100); });
    });
  }

  Lobby.init({ tg, tgUser, store, guestId, onStart: startGame });

})();
