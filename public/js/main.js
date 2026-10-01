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
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  let guestId = store.get('guestId');
  if (!guestId) { guestId = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('guestId', guestId); }

  // ---------- Выбор героя ----------
  let selected = store.get('lastClass') || 'warrior';
  const nameInput = $('guestName');
  if (tgUser) nameInput.classList.add('hidden');
  else nameInput.value = store.get('guestName') || '';

  fetch('/api/config').then((r) => r.json()).then(({ classes }) => {
    const box = $('classes');
    Object.entries(classes).forEach(([key, c]) => {
      const card = document.createElement('div');
      card.className = 'class-card' + (key === selected ? ' active' : '');
      const preview = document.createElement('canvas');
      preview.width = 32; preview.height = 32;
      preview.getContext('2d').drawImage(Gfx.hero(key, c.color), 0, 0);
      card.appendChild(preview);
      const info = document.createElement('div');
      info.innerHTML = `<h3>${c.name}</h3><p>${c.desc}</p>
        <div class="meta">❤️ ${c.hp} &nbsp; 🗡 ${c.dmg} &nbsp; 🎯 ${c.range} &nbsp; 👟 ${c.speed}</div>`;
      card.appendChild(info);
      card.onclick = () => {
        selected = key;
        box.querySelectorAll('.class-card').forEach((el) => el.classList.remove('active'));
        card.classList.add('active');
        if (tg && tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
      };
      box.appendChild(card);
    });
    $('playBtn').disabled = false;
  }).catch(() => { $('status').textContent = 'Сервер недоступен'; });

  // ---------- Ввод ----------
  const input = { vec: { x: 0, y: 0 }, attack: false };

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
  const chatLog = $('chatLog');
  function addChat(msg) {
    const div = document.createElement('div');
    if (msg.sys) { div.className = 'sys'; div.textContent = msg.text; }
    else { const b = document.createElement('b'); b.textContent = msg.name + ': '; div.append(b, msg.text); }
    chatLog.appendChild(div);
    while (chatLog.children.length > 6) chatLog.removeChild(chatLog.firstChild);
    setTimeout(() => div.remove(), 15000);
  }
  $('chatBtn').onclick = () => {
    $('chatForm').classList.toggle('hidden');
    if (!$('chatForm').classList.contains('hidden')) $('chatInput').focus();
  };
  $('chatForm').onsubmit = (e) => {
    e.preventDefault();
    const v = $('chatInput').value.trim();
    if (v && socket) socket.emit('chat', v);
    $('chatInput').value = '';
    $('chatForm').classList.add('hidden');
    $('chatInput').blur();
  };

  // ---------- HUD ----------
  function setStats(s) {
    $('lvl').textContent = s.level;
    $('hpFill').style.width = (100 * s.hp / s.maxHp) + '%';
    $('hpText').textContent = `${s.hp} / ${s.maxHp}`;
    $('xpFill').style.width = (100 * s.xp / s.xpNext) + '%';
    $('xpText').textContent = `${s.xp} / ${s.xpNext} XP`;
    $('gold').textContent = s.gold;
    $('kills').textContent = s.kills;
    $('dmg').textContent = s.dmg;
  }

  let minimapBase = null;
  function buildMinimap(map) {
    const colors = ['#4e9a3a', '#2f6fb5', '#2d6b22', '#c9a66b', '#4e9a3a', '#6e5a44', '#3c3a38'];
    const c = document.createElement('canvas');
    c.width = map.w; c.height = map.h;
    const ctx = c.getContext('2d');
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      ctx.fillStyle = colors[map.tiles[y * map.w + x]] || '#000';
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
    for (const m of state.m) ctx.fillRect(m.x / tile * sx - 1, m.y / tile * sy - 1, 2, 2);
    for (const p of state.p) {
      ctx.fillStyle = p.id === myId ? '#ffff00' : '#ffffff';
      const s = p.id === myId ? 4 : 3;
      ctx.fillRect(p.x / tile * sx - s / 2, p.y / tile * sy - s / 2, s, s);
    }
  }

  const vibrate = (kind) => {
    const h = tg && tg.HapticFeedback;
    if (!h) return;
    if (kind === 'success') h.notificationOccurred('success');
    else h.impactOccurred(kind);
  };

  // ---------- Запуск ----------
  let socket = null, game = null;

  $('playBtn').onclick = () => {
    const name = nameInput.value.trim();
    if (!tgUser && !name) { $('status').textContent = 'Введите имя героя'; return; }
    store.set('lastClass', selected);
    if (name) store.set('guestName', name);
    $('playBtn').disabled = true;
    $('status').textContent = 'Подключение...';

    socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      socket.emit('join', { cls: selected, initData: tg ? tg.initData : '', guestId, guestName: name });
    });
    socket.on('error_msg', (m) => { $('status').textContent = m; $('playBtn').disabled = false; socket.disconnect(); });
    socket.on('chat', addChat);
    socket.on('stats', setStats);
    socket.on('disconnect', () => { if (game) addChat({ sys: true, text: 'Связь потеряна, переподключение...' }); });
    socket.on('welcome', (w) => {
      if (game) { location.reload(); return; } // переподключение после обрыва — начинаем заново
      $('select').classList.add('hidden');
      $('hud').classList.remove('hidden');
      $('heroName').textContent = tgUser ? (tgUser.first_name || 'Герой') : name;
      setStats(w.stats);
      buildMinimap(w.map);
      const ui = {
        onWorld: (s, myId) => drawMinimap(s, myId, w.tile, w.map),
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
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: 'game',
        backgroundColor: '#11151c',
        pixelArt: true,
        scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
        input: { activePointers: 3 },
        scene: [],
      });
      game.scene.add('Game', window.GameScene, true, { socket, welcome: w, ui, input });
    });
  };

  $('exitBtn').onclick = () => location.reload();
})();
