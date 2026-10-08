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
      let zone = w.zone;
      buildMinimap(zone);
      Town.setContext({ socket, towns: w.towns, hero, heroes: w.heroes, skillUnlock: w.skillUnlock, onGacha: () => Lobby.openGacha(), api: Lobby.api, tg });
      Bag.init({ socket });
      $('bagBtn').onclick = () => Bag.open();
      $('passBtn').onclick = () => Town.openPlace('pass');
      $('storeBtn').onclick = () => Town.openPlace('store');
      // ---------- Группа ----------
      let party = null, inviteId = null;
      const renderParty = () => {
        const f = $('partyFrame');
        f.classList.toggle('hidden', !party);
        if (party) f.innerHTML = party.members.map((m) => `<div>${m.id === party.leader ? '👑 ' : ''}${m.name} <small>${m.hero} · ${m.lvl} · ${m.zone}</small></div>`).join('');
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
      $('partyBtn').onclick = () => {
        const box = document.createElement('div');
        const me = socket.id;
        box.innerHTML = `<p class="sheet-hint">Группа до 4 игроков: общий опыт (70% каждому рядом), добыча с боссов — каждому, данж выживания — вместе.</p>
          ${party ? `<div class="ic-sec">Ваша группа</div>${party.members.map((m) => `<div class="tw-ev"><div><b>${m.id === party.leader ? '👑 ' : ''}${m.name}</b><small>${m.hero} · ур. ${m.lvl} · ${m.zone}</small></div></div>`).join('')}
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
        const b = $('waveBadge');
        b.textContent = `🗺️ ${d.killed}/${d.total} · ★ ${d.minisKilled}/${d.minis} · ${d.boss ? '🏆 пройден!' : '👑 ' + d.bossName}`;
        b.classList.remove('hidden');
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
      $('evBtn').onclick = () => Town.openPlace('events');
      $('gachaBtn').onclick = () => Town.openPlace('gacha');
      const ui = {
        onWorld: (s, myId) => drawMinimap(s, myId, w.tile, zone),
        onZone: (z) => {
          zone = z;
          buildMinimap(z);
          Town.setContext({ zone: z });
          Town.close();
          $('townBar').classList.toggle('hidden', z.kind !== 'town'); // события, призыв, пропуск, магазин — только в городе
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
        input: { activePointers: 3 },
        scene: [],
      });
      game.scene.add('Game', window.GameScene, true, { socket, welcome: w, ui, input });
      let rt = 0;
      window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { game.scale.resize(Math.round(window.innerWidth * DPR), Math.round(window.innerHeight * DPR)); game.scale.setZoom(1 / DPR); }, 100); });
    });
  }

  Lobby.init({ tg, tgUser, store, guestId, onStart: startGame });

  $('exitBtn').onclick = () => location.reload();
})();
