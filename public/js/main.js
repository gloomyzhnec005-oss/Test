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
      btn.el.querySelector('.sk-icon').textContent = v.icon;
      btn.el.querySelector('em').textContent = v.name;
    }
  }
  let passiveDef = null;
  function setStats(s) {
    $('lvl').textContent = s.level;
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
    if (passiveDef) {
      const parts = [];
      if (s.bonusDmg) parts.push(`+${s.bonusDmg}% урона`);
      if (s.bonusSpd) parts.push(`+${s.bonusSpd}% скор.`);
      if (s.passiveNote) parts.push(s.passiveNote);
      $('passive').textContent = `${passiveDef.icon} ${parts.join(' · ') || passiveDef.name}`;
    }
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

  // ---------- Умения (до трёх кнопок) ----------
  const skillBtns = {};
  function buildSkills(hero) {
    const box = $('skills');
    box.innerHTML = '';
    box.className = `skills n${hero.skills.length}`;
    hero.skills.forEach((sk, i) => {
      const b = document.createElement('button');
      b.className = `round skill s${i}`;
      b.innerHTML = `<span class="sk-icon">${sk.icon}</span><i class="sk-cd"></i><em>${sk.name}</em>`;
      b.addEventListener('pointerdown', (e) => { input.skill = sk.id; b.classList.add('pressed'); e.preventDefault(); });
      const up = () => b.classList.remove('pressed');
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
      box.appendChild(b);
      skillBtns[sk.id] = { el: b, cd: b.querySelector('.sk-cd'), timer: 0, sk };
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
    socket.on('chat', addChat);
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
      resName = hero.resource.name;
      $('resFill').style.background = hero.resource.color;
      buildSkills(hero);
      passiveDef = hero.passive || null;
      $('passive').classList.toggle('hidden', !passiveDef);
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
  }

  Lobby.init({ tg, tgUser, store, guestId, onStart: startGame });

  $('exitBtn').onclick = () => location.reload();
})();
