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
    const d = Math.hypot(dx, dy), M = R * 0.62; // самоцвет не выходит за внутреннее кольцо
    const sx = d > M ? dx / d * M : dx, sy = d > M ? dy / d * M : dy;
    stick.style.transform = `translate(${sx}px, ${sy}px)`;
    // Только направление: вне мёртвой зоны герой всегда идёт на полной скорости
    if (d < R * 0.15) { input.vec.x = input.vec.y = 0; return; }
    input.vec.x = dx / d; input.vec.y = dy / d;
  };
  const joyEnd = () => { joyId = null; input.vec.x = input.vec.y = 0; stick.style.transform = ''; joy.classList.remove('on'); };
  joy.addEventListener('pointerdown', (e) => { joyId = e.pointerId; joy.setPointerCapture(e.pointerId); joy.classList.add('on'); joyMove(e); e.preventDefault(); });
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
  let chatTab = 'talk', unread = 0, pmTo = null; // pmTo — кому пишем в «Личные»: { id, name }
  const CH_PH = { talk: 'Сообщение всем игрокам...', party: 'Сообщение группе...', clan: 'Сообщение клану...', pm: 'Личное сообщение...' };
  const chOf = (msg) => (msg.ch && msg.ch !== 'talk' ? msg.ch : msg.sys ? 'sys' : 'talk');
  const chatOpen = () => !chatWin.classList.contains('hidden');
  const hhmm = (t) => new Date(t || Date.now()).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  function chatLine(msg, full) {
    const div = document.createElement('div');
    const st = !msg.sys && /^\[st:(\w+)\]$/.exec(msg.text || '');
    div.className = msg.sys ? 'sys' : 'talk notr'; // текст игроков не переводится
    if (full) { div.dataset.ch = chOf(msg); if (msg.sid && socket && msg.sid === socket.id) div.classList.add('mine'); }
    if (msg.ch && msg.ch !== 'talk' && !msg.sys) div.classList.add('ch-' + msg.ch);
    if (full) { const t = document.createElement('small'); t.textContent = hhmm(msg.t); div.append(t); }
    if (msg.sys) { div.append(msg.text); return div; }
    const b = document.createElement('b');
    const tagP = !full && msg.ch === 'party' ? '[Группа] ' : !full && msg.ch === 'clan' ? `[${msg.tag || 'Клан'}] ` : '';
    b.textContent = msg.ch === 'pm' ? (msg.fromId === (socket && socket.id) ? `→ ${msg.to}: ` : `✉️ ${msg.name}: `) : `${tagP}${msg.name}: `;
    // Тап по имени — ответить лично
    if (!msg.sys && msg.sid && (!socket || msg.sid !== socket.id)) { b.classList.add('chat-who'); b.dataset.pm = msg.sid; b.dataset.name = msg.name; }
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
    if (quiet || (chatOpen() && chatTab === row.dataset.ch)) return;
    if (!msg.sys) { unread++; $('chatBadge').textContent = unread > 9 ? '9+' : unread; $('chatBadge').classList.remove('hidden'); markTab(row.dataset.ch); }
    if (chatOpen()) return;
    if (!Settings.get(msg.sys ? 'sysPop' : 'chatPop')) return; // события и сообщения игроков отключаются по отдельности
    // Окно закрыто: всплывающая строка над картой и счётчик (только сообщения игроков)
    const div = chatLine(msg, false);
    chatLog.appendChild(div);
    while (chatLog.children.length > 4) chatLog.removeChild(chatLog.firstChild);
    setTimeout(() => div.remove(), 12000);
  }
  function markTab(ch) { const b = chatWin.querySelector(`.chat-tabs [data-ch="${ch}"]`); if (b && ch !== chatTab) b.classList.add('new'); }
  function setPm(to) {
    pmTo = to;
    $('pmTo').classList.toggle('hidden', !(to && chatTab === 'pm'));
    if (to) $('pmTo').querySelector('span').textContent = `Кому: ${to.name}`;
  }
  // Написать игроку лично (из профиля или по тапу на имя в чате)
  window.openPm = (id, name) => { setPm({ id, name }); openChat(); setTab('pm'); chatInput.focus(); };
  function setTab(ch) {
    chatTab = ch;
    chatWin.querySelector(`.chat-tabs [data-ch="${ch}"]`)?.classList.remove('new');
    chatInput.placeholder = ch === 'pm' && !pmTo ? 'Выберите, кому писать: тап по имени в чате или «Написать» в профиле' : CH_PH[ch] || '';
    $('chatForm').classList.toggle('hidden', ch === 'sys');
    $('stickerBar').classList.toggle('hidden', ch === 'sys');
    setPm(pmTo);
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
  // Отправка в текущий канал вкладки
  const emitChat = (text) => {
    if (chatTab === 'pm') { if (!pmTo) { if (window.Town) Town.toast('Сначала выберите получателя: тап по имени в чате'); return false; } socket.emit('chat', { text, ch: 'pm', to: pmTo.id }); }
    else socket.emit('chat', chatTab === 'talk' || chatTab === 'sys' ? text : { text, ch: chatTab });
    return true;
  };
  $('stickerBar').onclick = (e) => {
    const b = e.target.closest('[data-st]');
    if (!b || !socket) return;
    if (chatTab === 'sys') setTab('talk');
    emitChat(`[st:${b.dataset.st}]`);
  };
  const sendChat = () => {
    const v = chatInput.value.trim();
    if (!v || !socket) return;
    if (chatTab === 'sys') setTab('talk');
    if (emitChat(v)) chatInput.value = '';
  };
  chatList.addEventListener('click', (e) => { const w = e.target.closest('.chat-who'); if (w) window.openPm(w.dataset.pm, w.dataset.name); });
  $('pmToClear').onclick = () => { setPm(null); setTab('pm'); };
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
  // ---------- Баффы и дебаффы под полоской здоровья: значок + секунды, тап — описание ----------
  let fxList = [];
  const fxIcon = (e) => `<img src="assets/${e.art ? 'items/' + e.art : 'ui/status/' + e.i}.webp" alt="${e.ic || ''}" onerror="this.replaceWith(document.createTextNode(this.alt))">`; // нет картинки — значок-эмодзи
  const fxLeft = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)} мин ${sec % 60} с` : `${sec} с`);
  const fxTime = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec}`);
  function drawFx() {
    const now = Date.now();
    fxList = fxList.filter((e) => !e.end || e.end > now);
    requestAnimationFrame(() => document.getElementById('hud').style.setProperty('--fxh', ($('fxBar').offsetHeight ? $('fxBar').offsetHeight + 4 : 0) + 'px')); // группа и кнопки слева — ниже баффов
    $('fxBar').innerHTML = fxList.map((e, i) => `<button class="fx ${e.b ? 'buff' : 'debuff'}" data-i="${i}">${fxIcon(e)}${e.end ? `<em>${fxTime(Math.ceil((e.end - now) / 1000))}</em>` : ''}</button>`).join('');
  }
  setInterval(() => { if (fxList.length) drawFx(); }, 1000);
  $('fxBar').addEventListener('pointerdown', (ev) => {
    const b = ev.target.closest('.fx');
    if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    const e = fxList[+b.dataset.i];
    if (!e) return;
    const box = $('fxTip');
    box.innerHTML = `<div class="fx-tip-h">${fxIcon(e)}<div><b></b><small>${e.b ? 'Положительный эффект' : 'Отрицательный эффект'}${e.end ? ` · ещё ${fxLeft(Math.ceil((e.end - Date.now()) / 1000))}` : ''}</small></div></div><p></p>`;
    box.querySelector('b').textContent = e.n; box.querySelector('p').textContent = e.d;
    box.className = 'fx-tip ' + (e.b ? 'buff' : 'debuff');
    clearTimeout(box.tm); box.tm = setTimeout(() => box.classList.add('hidden'), 3500);
  });
  let passReadyN = 0; // сколько наград сезона можно забрать
  function setStats(s) {
    if (s.passReady !== undefined) { passReadyN = s.passReady; const pb = document.querySelector('[data-nav="play"]'); if (pb) pb.classList.toggle('pass-ready', passReadyN > 0); }
    if (s.fx) { const now = Date.now(); fxList = s.fx.map((e) => ({ ...e, end: e.l > 0 ? now + e.l * 1000 : 0 })); drawFx(); }
    if (s.passTier !== undefined) passTier = s.passTier;
    $('lvl').textContent = s.level;
    const tier = s.frame || avaTier(s.level); // купленная рамка — вместо рамки по уровню
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
    if (s.gems !== undefined) $('gems').textContent = s.gems;
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

  // ---------- Навигационная карта ----------
  // Нарисованная местность (трава с крапинками, вода с бликами, кроны, дорожки, тени у стен) собирается один раз на зону;
  // поверх каждые 3 кадра — монстры, боссы, порталы, здания, игроки и стрелка героя. Нажатие — большая карта с легендой.
  let minimapBase = null, mmZone = null, mmBig = false;
  const MM_PAL = {
    green: { grass: [86, 142, 58], water: [52, 112, 176], tree: [38, 92, 40], path: [196, 168, 112], flowers: [104, 152, 66], dirt: [132, 108, 76], rock: [86, 84, 82], wall: [120, 60, 46], plaza: [206, 192, 156], deco: [170, 146, 100], edge: [24, 30, 18] },
    abyss: { grass: [52, 44, 60], water: [24, 14, 38], tree: [66, 40, 52], path: [92, 80, 100], flowers: [64, 50, 74], dirt: [70, 58, 64], rock: [40, 36, 46], wall: [104, 52, 140], plaza: [96, 88, 112], deco: [120, 100, 130], edge: [10, 6, 14] },
    sky: { grass: [214, 228, 246], water: [110, 186, 238], tree: [232, 196, 96], path: [244, 236, 214], flowers: [224, 232, 248], dirt: [208, 214, 230], rock: [184, 198, 222], wall: [222, 186, 102], plaza: [252, 248, 234], deco: [230, 210, 160], edge: [120, 130, 160] },
    dungeon: { grass: [92, 86, 78], water: [30, 40, 60], tree: [60, 56, 50], path: [104, 96, 86], flowers: [92, 86, 78], dirt: [84, 76, 66], rock: [26, 24, 26], wall: [22, 20, 22], plaza: [112, 104, 92], deco: [140, 120, 90], edge: [8, 8, 10] },
  };
  const TKEY = ['grass', 'water', 'tree', 'path', 'flowers', 'dirt', 'rock', 'wall', 'plaza'];
  const SOLID_T = new Set([1, 2, 6, 7, 16]);
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  function buildMinimap(map) {
    mmFar = null;
    const S = 4, W = map.w, H = map.h, pal = MM_PAL[map.kind === 'dungeon' ? 'dungeon' : map.theme] || MM_PAL.green;
    const c = document.createElement('canvas'); c.width = W * S; c.height = H * S;
    const ctx = c.getContext('2d'), img = ctx.createImageData(W * S, H * S), d = img.data;
    const tAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 6 : map.tiles[y * W + x]);
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
      const t = tAt(tx, ty), key = t === 16 ? 'deco' : TKEY[t] || 'rock', base = pal[key];
      const solid = SOLID_T.has(t);
      for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
        const X = tx * S + px, Y = ty * S + py, n = hash(X, Y);
        let k = 0.9 + n * 0.2, col = base;
        if (t === 2) { const dx = px - 1.5, dy = py - 1.5; if (dx * dx + dy * dy > 3.2) col = pal.grass; else k *= 0.8 + (py < 2 ? 0.35 : 0); } // кроны
        if (t === 1) { k = 0.85 + n * 0.1 + ((X + Y * 2) % 7 === 0 ? 0.35 : 0); } // блики на воде
        if (t === 4 && n > 0.9) col = [230, 200, 90]; // цветы
        // тень у края непроходимого (сверху светлее, снизу темнее — объём)
        if (solid && t !== 1) {
          if (py === 0 && !SOLID_T.has(tAt(tx, ty - 1))) k *= 1.25;
          if (py === S - 1 && !SOLID_T.has(tAt(tx, ty + 1))) k *= 0.55;
        } else if (!solid) {
          if (py === 0 && SOLID_T.has(tAt(tx, ty - 1)) && tAt(tx, ty - 1) !== 1) k *= 0.7;
          if ((px === 0 && SOLID_T.has(tAt(tx - 1, ty)) || px === S - 1 && SOLID_T.has(tAt(tx + 1, ty))) && tAt(tx, ty) !== 1) k *= 0.85;
        }
        if (t !== 1 && (tAt(tx, ty - 1) === 1 && py === 0 || tAt(tx, ty + 1) === 1 && py === S - 1)) col = [220, 210, 170]; // берег
        const i = (Y * W * S + X) * 4;
        d[i] = Math.min(255, col[0] * k); d[i + 1] = Math.min(255, col[1] * k); d[i + 2] = Math.min(255, col[2] * k); d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Виньетка: края темнее, как у старой карты
    const g = ctx.createRadialGradient(c.width / 2, c.height / 2, c.width * 0.25, c.width / 2, c.height / 2, c.width * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(10,6,2,.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
    minimapBase = c; mmZone = map;
    const lbl = $('mmName'); if (lbl) lbl.textContent = map.name || '';
  }
  let mmTick = 0, mmLast = null, mmDir = 0;
  // Значки поверх карты: k — масштаб (1 — мини-карта, больше — большая карта)
  function mmMarks(ctx, state, myId, tile, map, sx, sy, k, now) {
    const ox = map.ox || 0, oy = map.oy || 0, P = (o) => [(o.x - ox) / tile * sx, (o.y - oy) / tile * sy];
    const dot = (x, y, r, fill, line) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = Math.max(1, r * 0.45); ctx.strokeStyle = line || 'rgba(0,0,0,.75)'; ctx.stroke(); };
    // Здания (золотой ромб) и порталы (пульсирующее фиолетовое кольцо)
    for (const o of map.objs || []) {
      const [x, y] = P(o);
      if (o.kind === 'portal') {
        const r = (2.6 + Math.sin(now / 300) * 0.5) * k;
        ctx.beginPath(); ctx.arc(x, y, r + 1.4 * k, 0, 7); ctx.fillStyle = 'rgba(190,120,255,.25)'; ctx.fill();
        dot(x, y, r, '#b77dff', '#2a0a44');
        ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, 7); ctx.fillStyle = '#f2e6ff'; ctx.fill();
      } else if (o.kind === 'place') {
        const r = 2.4 * k; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
        ctx.fillStyle = '#ffd36a'; ctx.fill(); ctx.lineWidth = Math.max(1, k * 0.8); ctx.strokeStyle = '#3a2408'; ctx.stroke();
      }
    }
    // На большой карте — подписи зданий и порталов
    if (k >= 3) {
      ctx.font = `${Math.round(4.6 * k)}px Georgia, serif`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
      for (const o of map.objs || []) {
        if (o.kind !== 'place' && o.kind !== 'portal' || !o.name) continue;
        const [x0, y] = P(o), t = o.num ? ['I', 'II', 'III', 'IV', 'V', 'VI'][o.num - 1] : window.I18N ? I18N.tr(o.name) : o.name; // данжи — номером, как на порталах
        const half = ctx.measureText(t).width / 2 + 2, x = Math.max(half, Math.min(ctx.canvas.width - half, x0));
        ctx.lineWidth = 1.2 * k; ctx.strokeStyle = 'rgba(10,6,2,.9)'; ctx.strokeText(t, x, y + 7.5 * k);
        ctx.fillStyle = o.kind === 'portal' ? '#e6ccff' : '#ffe7a8'; ctx.fillText(t, x, y + 7.5 * k);
      }
    }
    // Монстры: обычные — красные точки, полубоссы и боссы — крупнее, с золотой каймой
    // Дальние монстры приходят точками (сервер шлёт их раз в 3 тика): [x/8, y/8, крупный]
    if (state.mm) mmFar = state.mm; else if (!state.m.length && !mmFar) mmFar = [];
    for (const [fx8, fy8, big] of mmFar || []) {
      const [x, y] = P({ x: fx8 * 8, y: fy8 * 8 });
      if (big) dot(x, y, 2.6 * k, '#ff3a2a', '#ffd36a'); else dot(x, y, 1.3 * k, '#ff5040', 'rgba(40,0,0,.8)');
    }
    for (const m of state.m) {
      const [x, y] = P(m), big = m.rk === 'boss' || m.rk === 'world' || m.rk === 'mini';
      if (big) { dot(x, y, (m.rk === 'mini' ? 2.6 : 3.4) * k, '#ff3a2a', '#ffd36a'); } else dot(x, y, 1.3 * k, '#ff5040', 'rgba(40,0,0,.8)');
    }
    // Другие игроки — белые точки, герой — жёлтая стрелка по направлению движения
    for (const p of state.p) {
      const [x, y] = P(p);
      if (p.id !== myId) { dot(x, y, 1.7 * k, '#ffffff', '#1a3050'); continue; }
      if (mmLast && Math.hypot(p.x - mmLast.x, p.y - mmLast.y) > 2) mmDir = Math.atan2(p.y - mmLast.y, p.x - mmLast.x);
      mmLast = { x: p.x, y: p.y };
      ctx.save(); ctx.translate(x, y); ctx.rotate(mmDir + Math.PI / 2);
      const r = 4 * k;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, 7); ctx.fillStyle = 'rgba(255,230,120,.22)'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.75, r * 0.8); ctx.lineTo(0, r * 0.35); ctx.lineTo(-r * 0.75, r * 0.8); ctx.closePath();
      ctx.fillStyle = '#ffe14a'; ctx.fill(); ctx.lineWidth = Math.max(1, k); ctx.strokeStyle = '#3a2400'; ctx.stroke();
      ctx.restore();
    }
  }
  function mmFog(ctx, state, map, tile, sx, sy) {
    const ex = map.fog && window.gameScene && window.gameScene.explored.get(map.id);
    if (!ex) return state;
    ctx.fillStyle = '#07080b';
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (!ex.has(y * map.w + x)) ctx.fillRect(Math.floor(x * sx), Math.floor(y * sy), Math.ceil(sx) + 1, Math.ceil(sy) + 1);
    const ox = map.ox || 0, oy = map.oy || 0;
    return { ...state, m: state.m.filter((m) => ex.has(Math.floor((m.y - oy) / tile) * map.w + Math.floor((m.x - ox) / tile))) };
  }
  let mmFar = null; // дальние монстры для мини-карты
  function drawMinimap(state, myId, tile, map) {
    if (state.mm) mmFar = state.mm; // запомнить, даже если этот кадр мини-карта пропустит
    if (++mmTick % 3 || !minimapBase) return;
    const now = performance.now();
    for (const [id, k] of [['minimap', 1], ...(mmBig ? [['mmBigCnv', 2.2]] : [])]) {
      const cnv = $(id); if (!cnv) continue;
      const dpr = Math.min(2, window.devicePixelRatio || 1), cw = Math.round(cnv.clientWidth * dpr), ch = Math.round(cnv.clientHeight * dpr);
      if (cnv.width !== cw || cnv.height !== ch) { cnv.width = cw; cnv.height = ch; }
      const ctx = cnv.getContext('2d');
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(minimapBase, 0, 0, cw, ch);
      const sx = cw / map.w, sy = ch / map.h;
      mmMarks(ctx, mmFog(ctx, state, map, tile, sx, sy), myId, tile, map, sx, sy, k * dpr, now);
    }
  }
  // Большая карта по нажатию: вся зона, легенда, закрытие тапом
  $('mmWrap').onclick = () => {
    mmBig = true;
    const box = document.createElement('div'); box.className = 'mm-big';
    box.innerHTML = `<canvas id="mmBigCnv"></canvas><div class="mm-legend">
      <span><i class="lg-me"></i>Вы</span><span><i class="lg-pl"></i>Игроки</span><span><i class="lg-mob"></i>Монстры</span>
      <span><i class="lg-boss"></i>Боссы</span><span><i class="lg-portal"></i>Порталы</span><span><i class="lg-place"></i>Здания</span></div>`;
    Town.open('🗺️ ' + ((mmZone && mmZone.name) || 'Карта'), box);
    const cnv = box.querySelector('canvas'), z = mmZone || { w: 1, h: 1 };
    const side = Math.min(box.clientWidth || 340, innerHeight * 0.62);
    cnv.style.width = side + 'px'; cnv.style.height = side * z.h / z.w + 'px';
    const stop = setInterval(() => { if ($('sheet').classList.contains('hidden') || !document.body.contains(cnv)) { mmBig = false; clearInterval(stop); } }, 300);
  };

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
  let passTier = 0, autoOn = false; // орден сезона (0 — нет) и включён ли автобой
  // Советы на экране загрузки мира
  const LOAD_TIPS = [
    'Совет: тапните по монстру — герой сам подойдёт и атакует.',
    'Совет: в данже карта открывается по мере продвижения — туман скрывает неразведанное.',
    'Совет: босс данжа приходит по расписанию — ворота его комнаты откроются сами.',
    'Совет: дубликаты героев делают его сильнее, а лишнее превращается в осколки душ.',
    'Совет: мировой босс — общая битва, награду получают все участники.',
    'Совет: если телефон греется, включите в настройках ограничение 30 кадров.',
  ];
  // Картинка экрана загрузки мира — если файл есть (без него остаётся тёмный фон)
  { const im = new Image(); im.onload = () => $('worldLoad').classList.add('has-art'); im.src = 'assets/ui/loading_world.webp'; }

  function startGame(selected, name) {
    Lobby.setBusy(true);
    Lobby.setStatus('Подключение...');

    socket = io({ transports: ['websocket', 'polling'], reconnectionDelay: 400, reconnectionDelayMax: 2000 });
    socket.on('connect', () => {
      $('netBadge').classList.add('hidden');
      if (socket.recovered) return; // связь вернулась, сессия цела — герой там же, заново входить не нужно
      socket.emit('join', { hero: selected, initData: tg ? tg.initData : '', guestId, guestName: name, lang: window.I18N && I18N.lang }); // язык — для уведомлений бота
    });
    socket.on('error_msg', (m) => { Lobby.setStatus(m); Lobby.setBusy(false); socket.disconnect(); });
    socket.on('chat', (m) => addChat(m));
    socket.on('chatHistory', (list) => { chatList.innerHTML = ''; for (const m of list || []) addChat(m, true); });
    socket.on('stats', setStats);
    socket.on('skillUsed', ({ id, cooldown }) => startSkillCd(id, cooldown));
    // ---------- Автобой (Золотой орден и выше) ----------
    socket.on('autofarm', (on) => {
      if (autoOn !== on) Town.toast(on ? '⚔️ Автобой включён — герой сражается сам' : 'Автобой выключен');
      autoOn = on;
      if (window.gameScene) { window.gameScene.autoFarm = on; if (!on) { window.gameScene.walkTo = null; window.gameScene.autoWalk = null; } }
      document.querySelector('[data-nav="play"]').classList.toggle('auto-on', on); // светится, пока идёт автобой
    });
    socket.on('passTier', (t) => { passTier = t; });
    // Сервер сократил перезарядку (убийство Найри) — обновляем таймеры кнопок
    socket.on('skillCds', (cds) => Object.entries(cds).forEach(([id, c]) => startSkillCd(id, c.left, c.total)));
    socket.on('skillFail', hudToast);
    // Обрыв связи: игра не останавливается, сверху — значок; через 2 минуты без связи сервер отпустит героя
    socket.on('disconnect', () => { if (game) $('netBadge').classList.remove('hidden'); });
    socket.on('resumed', (d) => { $('netBadge').classList.add('hidden'); if (window.gameScene && window.gameScene.me) { window.gameScene.me.x = d.x; window.gameScene.me.y = d.y; } });
    socket.on('welcome', (w) => {
      window.P_DEF = w.pDef || null;
      if (game) { // переподключение после долгого обрыва: входим заново без перезагрузки страницы
        $('netBadge').classList.add('hidden');
        try { if (window.gameScene && window.gameScene.rejoin && w.x !== undefined) { window.gameScene.rejoin(w); setStats(w.stats); return; } } catch (e) { console.error('rejoin', e); }
        location.reload(); return;
      }
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
      Town.setContext({ socket, towns: w.towns, hero, heroLevel: () => +$('lvl').textContent || 1, heroes: w.heroes, skillUnlock: w.skillUnlock, onGacha: () => Lobby.openGacha(), api: Lobby.api, tg });
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
      // Быстрое зелье: сначала большое, потом обычное. Перезарядка 8 с — кнопка тускнеет
      const NO_POT = 'Нет такого предмета';
      let potBusy = false, potCdTm = null;
      const potCooldown = (ms) => {
        $('potBtn').classList.add('cooling');
        clearTimeout(potCdTm);
        potCdTm = setTimeout(() => $('potBtn').classList.remove('cooling'), ms);
      };
      const drinkPotion = async (auto) => {
        if (potBusy) return null;
        potBusy = true;
        let r = await Bag.act('useMat', { mat: 'potHp2' });
        if (r.error === NO_POT) r = await Bag.act('useMat', { mat: 'potHp' });
        potBusy = false;
        if (!r.error) {
          potCooldown(8000);
          // Выпито — маленькая зелёная цифра над героем, без сообщения посреди экрана
          const sc = window.gameScene, me = sc && sc.me;
          if (me && r.healed) sc.floatText(me.e.c.x, me.e.c.y - 30, '+' + r.healed, '#5dff7a', 10);
        } else if (!auto) Town.toast(r.error === NO_POT ? 'Нет зелий — купите в лавке эликсиров' : r.error);
        return r;
      };
      // pointerdown, а не click: на iPhone click не приходит, пока другой палец держит джойстик или атаку
      $('potBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); vibrate('light'); drinkPotion(false); });
      // Автозелье (Настройки → Управление): здоровья меньше порога — пьём само
      let autoPotNext = 0, noPotWarned = false;
      setInterval(async () => {
        const sc = window.gameScene, d = sc && sc.me && sc.me.data;
        if (!Settings.get('autoPot') || !d || d.dead || !d.maxHp || Date.now() < autoPotNext) return;
        if (d.hp / d.maxHp * 100 >= Settings.get('autoPotAt')) { noPotWarned = false; return; }
        autoPotNext = Date.now() + 1000;
        const r = await drinkPotion(true);
        if (!r) return;
        if (!r.error) autoPotNext = Date.now() + 8000;
        else if (r.error === NO_POT) { autoPotNext = Date.now() + 20000; if (!noPotWarned) { noPotWarned = true; Town.toast('Автозелье: зелья закончились'); } }
      }, 250);
      // Профиль другого игрока: герой, сила, надетое снаряжение (тап — карточка вещи), приглашение в группу
      const openPlayer = async (id) => {
        if (!Bag.inv()) await Bag.refresh(); // справочники для карточек вещей
        const r = await Bag.act('inspect', { id });
        if (r.error || !r.player) { Town.toast(r.error || 'Не удалось открыть профиль'); return; }
        const pl = r.player, H = w.heroes[pl.hero] || {}, P = pl.power;
        const box = document.createElement('div');
        box.className = 'pp';
        const bySlot = Object.fromEntries(pl.worn.map((it) => [it.slot, it]));
        const inMyParty = pl.party && pl.party === pl.myParty;
        box.innerHTML = `<div class="pp-head"><div class="pp-art"></div><div class="pp-info">
            <b class="pp-name"></b><small>${H.name || pl.hero}${H.title ? ` · ${H.title}` : ''}</small>
            <small>Уровень ${pl.level} · ${'★'.repeat(Math.min(pl.dupes, 5)) || '☆'}${pl.dupes > 5 ? '+' + (pl.dupes - 5) : ''}${pl.rating ? ` · 🏟️ ${pl.rating}` : ''}</small></div></div>
          <div class="pd-power"><span class="pw">Сила <b>${P.power}</b></span><span>❤️ ${P.hp}</span><span>⚔️ ${P.dmg}</span><span>🎯 ${P.crit}%</span></div>
          <div class="ic-sec">Снаряжение</div>
          <div class="pp-gear">${pl.slots.map((s) => `<div class="pp-slot" data-s="${s}">${bySlot[s] ? Bag.cell(bySlot[s], 'other') : '<span class="pp-empty"></span>'}<em>${pl.slotNames[s]}</em></div>`).join('')}</div>
          ${pl.me ? '' : `<button class="l2-btn wide" id="ppInvite" ${pl.party ? 'disabled' : ''}>${inMyParty ? '✓ В вашей группе' : pl.party ? 'Уже в другой группе' : '👥 Пригласить в группу'}</button>
          <div class="btn-row"><button class="l2-btn" id="ppPm">✉️ Написать</button><button class="l2-btn" id="ppClan">🛡️ В клан</button></div>`}`;
        box.querySelector('.pp-name').textContent = pl.name;
        const art = window.Lobby && Lobby.heroCanvas(pl.hero, true);
        if (art) box.querySelector('.pp-art').append(art);
        box.querySelector('.pp-gear').onclick = (e) => { const s = e.target.closest('.pp-slot'); if (s && bySlot[s.dataset.s]) Bag.card(bySlot[s.dataset.s]); };
        const inv = box.querySelector('#ppInvite');
        if (inv) inv.onclick = () => { socket.emit('party', { op: 'invite', target: pl.id }); inv.disabled = true; inv.textContent = 'Приглашение отправлено'; };
        const pmB = box.querySelector('#ppPm'), clB = box.querySelector('#ppClan');
        if (pmB) pmB.onclick = () => { Town.close(); window.openPm(pl.id, pl.name); };
        if (clB) clB.onclick = async () => { const x = await clanAct({ op: 'invite', target: pl.id }); Town.toast(x.error || x.toast); };
        Town.open(`👤 ${pl.name}`, box);
      };
      // ---------- Рейтинги ----------
      const openRanks = (tab = 'lvl') => {
        const page = (t) => async () => {
          const r = await new Promise((res) => socket.emit('ranks', { tab: t }, res));
          const box = document.createElement('div');
          if (r.error) { box.textContent = r.error; return box; }
          const hint = { war: 'Очки клана за неделю: босс данжа +13, полубосс +3, мировой босс +8, бой на арене +1 — за каждого участника. Лучший клан недели — «Владыки»: всем участникам +100 💎 и +10% опыта и золота на следующую неделю', lvl: 'Самый прокачанный герой каждого игрока', pow: 'Сила лучшего героя: здоровье, урон, крит и скорость атаки с экипировкой', cl: 'Сила клана — сумма уровней лучших героев участников',
            wb: `Урон по мировым боссам за неделю. В понедельник тройка лидеров получит 🥇 ${r.prize[0]} 💎 · 🥈 ${r.prize[1]} 💎 · 🥉 ${r.prize[2]} 💎` }[t];
          box.innerHTML = `<p class="sheet-hint">${hint}</p>${r.me ? `<div class="top-row me"><span>${r.me.place}</span><b>Вы</b><em>${r.me.val}</em></div>` : '<small>Вас пока нет в этом рейтинге</small>'}
            <div class="tour-top">${r.list.map((x) => `<div class="top-row"><span>${x.place <= 3 ? ['🥇', '🥈', '🥉'][x.place - 1] : x.place}</span><b></b><em>${x.val}</em></div>`).join('') || '<small>Пока пусто</small>'}</div>`;
          box.querySelectorAll('.tour-top .top-row b').forEach((b, i) => { b.textContent = r.list[i].name; });
          return box;
        };
        const tabs = [['lvl', 'Уровень'], ['pow', 'Сила'], ['cl', 'Кланы'], ['war', 'Война кланов'], ['wb', 'Боссы недели']];
        Town.open('🏆 Рейтинги', Town.tabs(tabs.map(([t, n]) => [n, page(t)]), Math.max(0, tabs.findIndex(([t]) => t === tab))));
      };
      // ---------- Клан ----------
      const clanAct = (d) => new Promise((res) => socket.emit('clan', d, res));
      const openClan = async () => {
        const r = await clanAct({ op: 'info' });
        const box = document.createElement('div');
        if (!r.clan) {
          box.innerHTML = `<p class="sheet-hint">Вы не в клане. Создайте свой (${r.price.toLocaleString('ru-RU')} 💰) или вступите по приглашению — его присылают из профиля игрока.</p>
            <div class="clan-form"><input id="clName" maxlength="20" placeholder="Название клана"><input id="clTag" maxlength="4" placeholder="Тег (2–4)"><button class="l2-btn wide" id="clMake">🛡️ Создать клан · ${r.price.toLocaleString('ru-RU')} 💰</button></div>`;
          box.querySelector('#clMake').onclick = async () => { const x = await clanAct({ op: 'create', name: box.querySelector('#clName').value, tag: box.querySelector('#clTag').value }); Town.toast(x.error || x.toast); if (!x.error) openClan(); };
          box.querySelectorAll('input').forEach((i) => { i.addEventListener('keydown', (e) => e.stopPropagation()); i.addEventListener('focus', () => gameKeys(false)); i.addEventListener('blur', () => gameKeys(true)); });
          Town.open('🛡️ Клан', box); return;
        }
        const c = r.clan, me = Lobby.profile() && Lobby.profile().uid, lead = c.leader === me;
        const fmtT = (ms) => { const h = Math.max(0, Math.floor(ms / 3600e3)); return h >= 24 ? `${Math.floor(h / 24)} д ${h % 24} ч` : `${h} ч`; };
        const tabIdx = openClan.tab || 0; openClan.tab = 0;
        const reopen = (i) => { openClan.tab = i; openClan(); };
        const members = () => {
          const box = document.createElement('div');
          box.innerHTML = `<div class="pass-head"><b><img class="clan-emb" src="assets/ui/ic_clan.webp" alt="">${c.name} [${c.tag}]</b><small>Участников: ${c.members.length} / ${c.max} · в сети ${c.members.filter((m) => m.online).length} · тег [${c.tag}] виден над именами героев</small>
            <small>⚔️ Война кланов: ${c.war.pts} очков за неделю${c.war.reign ? ' · 👑 Владыки недели: +10% опыта и золота' : ''}${c.war.reigns ? ` · побед: ${c.war.reigns}` : ''}</small>
          <button class="l2-btn" id="clChat">💬 Клановый чат</button></div><div class="ic-sec">Участники</div>`;
          for (const m of c.members.sort((a, b) => b.online - a.online)) {
            const row = document.createElement('div'); row.className = 'tw-ev';
            row.innerHTML = `<div><b></b><small>${m.leader ? '👑 глава · ' : ''}${m.online ? '🟢 в сети' : '⚫ не в сети'}</small></div>${lead && !m.leader ? '<button class="l2-btn ghost">Исключить</button>' : ''}`;
            row.querySelector('b').textContent = m.name;
            const k = row.querySelector('button');
            if (k) k.onclick = async () => { const x = await clanAct({ op: 'kick', uid: m.uid }); Town.toast(x.error || x.toast); reopen(0); };
            box.append(row);
          }
          box.insertAdjacentHTML('beforeend', '<p class="sheet-hint">Пригласить: откройте профиль игрока (тап по герою на карте) → «В клан».</p><button class="l2-btn wide ghost" id="clLeave">Покинуть клан</button>');
          box.querySelector('#clChat').onclick = () => { Town.close(); openChat(); setTab('clan'); };
          box.querySelector('#clLeave').onclick = async () => { const x = await clanAct({ op: 'leave' }); Town.toast(x.error || x.toast); Town.close(); };
          return box;
        };
        const quests = () => {
          const box = document.createElement('div'), Q = r.quests;
          box.innerHTML = `<p class="sheet-hint">Общий прогресс всего клана · обновятся через ${fmtT(Q.endsIn)}. Награду получает каждый, кто внёс вклад.</p>`;
          for (const q of Q.list) {
            const done = q.prog >= q.goal;
            const row = document.createElement('div'); row.className = `tw-ev quest ${q.claimed ? 'claimed' : done && q.mine ? 'ready' : ''}`;
            row.innerHTML = `<span class="tw-ev-i q-ic"><img src="assets/ui/quests/${q.id}.webp" alt="${q.icon}" onerror="this.replaceWith(this.alt)"></span><div><b>${q.name}</b><small>${q.desc} · ваш вклад: ${q.mine}</small>
              <div class="tw-prog"><i style="width:${Math.round((100 * q.prog) / q.goal)}%"></i><em>${q.prog} / ${q.goal}</em></div><small class="q-rew">${q.reward}</small></div>
              <button class="l2-btn" ${done && q.mine && !q.claimed ? '' : 'disabled'}>${q.claimed ? '✔' : '🎁'}</button>`;
            row.querySelector('button').onclick = async () => { const x = await clanAct({ op: 'questClaim', id: q.id }); Town.toast(x.error || x.toast); if (window.Sfx) Sfx.play(x.error ? 'error' : 'reward'); reopen(1); };
            box.append(row);
          }
          return box;
        };
        const vault = () => {
          const box = document.createElement('div');
          box.innerHTML = `<p class="sheet-hint">Хранилище клана: ${c.vault.length} / ${c.vaultMax}. Положите ненужную вещь — соклановцы смогут её взять (до 3 в день, глава — без лимита).</p>
            <button class="l2-btn wide" id="clPut">📥 Положить из сумки</button><div class="ic-sec">Предметы</div>`;
          if (!c.vault.length) box.insertAdjacentHTML('beforeend', '<small>Пока пусто</small>');
          for (const it of c.vault) {
            const row = document.createElement('div'); row.className = 'tw-ev';
            row.innerHTML = `<span class="tw-ev-i">${Bag.art(it)}</span><div><b style="color:${it.color}"></b><small>${it.rarName} · положил ${it.by || '—'}</small></div><button class="l2-btn">Взять</button>`;
            row.querySelector('b').textContent = it.name;
            row.querySelector('button').onclick = async () => { const x = await clanAct({ op: 'vaultTake', id: it.id }); Town.toast(x.error || x.toast); if (!x.error) Bag.refresh(); reopen(2); };
            box.append(row);
          }
          box.querySelector('#clPut').onclick = async () => {
            const inv = await Bag.refresh();
            const list = (inv && inv.items || []).filter((it) => it.loc !== 'wh' && it.cat !== 'bag' && !Bag.isEquipped(it));
            const pick = document.createElement('div');
            pick.innerHTML = '<p class="sheet-hint">Выберите вещь из сумки — она перейдёт в хранилище клана.</p>';
            if (!list.length) pick.insertAdjacentHTML('beforeend', '<small>В сумке нет подходящих вещей (надетые сначала снимите)</small>');
            for (const it of list) {
              const row = document.createElement('div'); row.className = 'tw-ev';
              row.innerHTML = `<span class="tw-ev-i">${Bag.art(it)}</span><div><b style="color:${it.color}"></b><small>${it.rarName}</small></div><button class="l2-btn">Положить</button>`;
              row.querySelector('b').textContent = it.name;
              row.querySelector('button').onclick = async () => { const x = await clanAct({ op: 'vaultPut', id: it.id }); Town.toast(x.error || x.toast); if (!x.error) Bag.refresh(); reopen(2); };
              pick.append(row);
            }
            Town.open('📥 В хранилище клана', pick);
          };
          return box;
        };
        const ready = r.quests ? r.quests.list.filter((q) => q.prog >= q.goal && q.mine && !q.claimed).length : 0;
        Town.open('🛡️ Клан', Town.tabs([['Участники', members], ['Задания' + (ready ? ` (${ready})` : ''), quests], [`Хранилище (${c.vault.length})`, vault]], tabIdx));
      };
      socket.on('clanInvite', (d) => {
        const box = $('partyInvite');
        box.querySelector('b').textContent = `🛡️ ${d.from} приглашает вас в клан «${d.name}» [${d.tag}]`;
        box.classList.remove('hidden');
        $('piYes').onclick = async () => { box.classList.add('hidden'); const x = await clanAct({ op: 'accept', id: d.id }); Town.toast(x.error || x.toast); };
        $('piNo').onclick = () => box.classList.add('hidden');
        vibrate('medium');
      });
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
          row.innerHTML = `<div class="tw-link"><b>${d.name}</b><small>${w.heroes[d.hero].name} · ур. ${d.lvl} · профиль ›</small></div><button class="l2-btn" ${inParty ? 'disabled' : ''}>${inParty ? 'В группе' : 'Пригласить'}</button>`;
          row.querySelector('button').onclick = () => { socket.emit('party', { op: 'invite', target: d.id }); Town.close(); };
          row.querySelector('.tw-link').onclick = () => openPlayer(d.id);
          box.append(row);
        }
        const lv = box.querySelector('#pLeave');
        if (lv) lv.onclick = () => { socket.emit('party', { op: 'leave' }); Town.close(); };
        Town.open('👥 Группа', box);
      };
      // ---------- Данж выживания: номер волны ----------
      // Прогресс данжа-лабиринта
      // Мировой босс: рейтинг урона (топ-10 получат редкие ресурсы); тап — свернуть/развернуть
      // Полоска здоровья мирового босса: 10 слоёв разного цвета (как в больших MMO), ×N — сколько слоёв осталось
      let wbBossName = '', wbTask = '';
      const BB_COL = ['#7a7f88', '#d81b60', '#8e24aa', '#3949ab', '#1e88e5', '#00acc1', '#43a047', '#c0ca33', '#fdd835', '#fb8c00', '#e53935'];
      socket.on('state', (s) => {
        const bar = $('bossBar');
        const b = zone && zone.kind === 'worldboss' && s.m && s.m.find((m) => m.rk === 'world');
        if (!b) { if (!bar.classList.contains('hidden')) bar.classList.add('hidden'); return; }
        const LAYERS = 10, per = b.maxHp / LAYERS, L = Math.max(1, Math.ceil(b.hp / per));
        const fill = Math.max(0, Math.min(1, (b.hp - (L - 1) * per) / per));
        bar.classList.remove('hidden');
        bar.classList.toggle('shield', !!b.wsh); bar.classList.toggle('vuln', !!b.vu);
        bar.querySelector('b').textContent = `👹 ${b.nm || wbBossName || 'Мировой босс'} · ур. ${b.lv}`;
        bar.querySelector('.bb-cur').style.cssText = `width:${(fill * 100).toFixed(1)}%;background:${BB_COL[L]}`;
        bar.querySelector('.bb-next').style.background = BB_COL[L - 1];
        bar.querySelector('em').textContent = `×${L}`;
        bar.classList.toggle('task', !!wbTask);
        bar.querySelector('small').textContent = wbTask ? wbTask : b.ai ? '🐉 Босс в небе — его не достать' : b.wsh ? '💎 Босс под щитом — выполните задание!' : b.vu ? '✨ Босс уязвим: +50% урона' : `${Math.ceil(b.hp).toLocaleString('ru-RU')} / ${b.maxHp.toLocaleString('ru-RU')}`;
      });
      let wbOpen = true;
      $('wbRank').onclick = () => { wbOpen = !wbOpen; $('wbRank').classList.toggle('mini', !wbOpen); };
      socket.on('wbRank', (r) => {
        wbBossName = r.boss || wbBossName; wbTask = r.task || '';
        const box = $('wbRank');
        if (!zone || zone.kind !== 'worldboss') { box.classList.add('hidden'); return; }
        const fmt = (n) => (n >= 10000 ? Math.round(n / 1000) + 'k' : n);
        box.innerHTML = `<b>⚔️ Урон по боссу · ${r.hp}%</b><small>Топ-10 получат редкие ресурсы</small>`
          + r.top.map((t, i) => `<div class="${t.me ? 'me' : ''} ${i < 10 ? 'top' : ''}"><i>${i + 1}</i><span></span><em>${fmt(t.dmg)} · ${t.pct}%</em></div>`).join('')
          + (r.me && r.me.place > 10 ? `<div class="me"><i>${r.me.place}</i><span>Вы</span><em>${fmt(r.me.dmg)} · ${r.me.pct}%</em></div>` : '');
        [...box.querySelectorAll('div span')].forEach((s, i) => { if (r.top[i]) s.textContent = r.top[i].name; });
        box.classList.remove('hidden');
      });
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
      // Вход в портал / здание: сам при подходе (game.js checkNear) или тапом по объекту
      const activate = (o) => {
        if (!o) return;
        vibrate('light');
        if (o.kind === 'portal') socket.emit('travel', { via: o.id });
        else Town.openPlace(o.place);
      };
      $('actBtn').onclick = () => activate(near);
      // ---------- Нижнее меню ----------
      const menuRow = (icon, name, desc, fn) => {
        const r = document.createElement('button');
        r.className = 'nav-row';
        r.innerHTML = `<span>${/^[a-z]+$/.test(icon) ? `<img class="place-ic big" src="assets/ui/${icon === "chat" ? "nav_chat" : "place_" + icon}.webp" alt="">` : icon}</span><div><b>${name}</b><small>${desc}</small></div><i>›</i>`;
        r.onclick = fn;
        if (icon === 'pass' && passReadyN > 0) r.classList.add('nav-dot'); // есть награды пропуска
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
        row('Автозелье', 'Само пьёт зелье здоровья, когда его мало', opt('autoPot'));
        row('Порог автозелья', 'Пить, когда здоровья меньше, %', slider('autoPotAt', 20, 70));
        sec('🌐 Язык');
        const lg = document.createElement('div'); lg.className = 'set-langs notr';
        lg.innerHTML = Object.entries(I18N.LANGS).map(([k, n]) => `<button type="button" data-lang="${k}" class="${k === I18N.lang ? 'on' : ''}">${n}</button>`).join('');
        lg.onclick = (e) => { const b = e.target.closest('[data-lang]'); if (b && b.dataset.lang !== I18N.lang) I18N.set(b.dataset.lang); };
        box.append(lg);
        sec('🖥️ Экран');
        row('Цифры урона', 'Всплывающий урон над целями', opt('dmgNums'));
        row('Имена над героями', 'Имена игроков и монстров на карте', opt('names'));
        row('Чат над картой', 'Сообщения игроков коротко видны в игре', opt('chatPop'));
        row('События над картой', 'Системные сообщения (боссы, награды, вход игроков)', opt('sysPop'));
        row('Экономия батареи', '30 кадров в секунду вместо 60', opt('lowFps'));
        {
          const sel = document.createElement('select'); sel.className = 'set-sel';
          for (const [v, n] of [['auto', 'Авто'], ['high', 'Чёткая'], ['fast', 'Быстрая']]) { const o = document.createElement('option'); o.value = v; o.textContent = n; o.selected = Settings.get('gfx') === v; sel.append(o); }
          sel.onchange = () => Settings.set('gfx', sel.value);
          row('Качество картинки', 'Авто — игра сама снижает чёткость, если телефон не успевает; «Быстрая» — для слабых телефонов', sel);
        }
        {
          const sel = document.createElement('select'); sel.className = 'set-sel';
          for (const [v, n] of [['auto', 'Авто'], ['full', 'Полные'], ['lite', 'Упрощённые']]) { const o = document.createElement('option'); o.value = v; o.textContent = n; o.selected = Settings.get('fx') === v; sel.append(o); }
          sel.onchange = () => Settings.set('fx', sel.value);
          row('Эффекты', 'Авто — в больших боях игра сама убирает лишние частицы, тряску и чужие цифры; «Упрощённые» — всегда, для слабых телефонов', sel);
        }
        row('FPS и пинг', 'Маленькая строка сверху: кадры в секунду и задержка связи', opt('netInfo'));
        // Уведомления от бота в Telegram (настройка хранится на сервере — у героя, а не в браузере)
        {
          const tgl = toggle(true, async (v) => { const r = await Bag.act('notify', { on: v }); if (r.error) Town.toast(r.error); });
          const r0 = row('Уведомления в Telegram', 'Бот напишет, когда скоро боссы, появился мировой босс, продан ваш лот или выполнено задание клана — только когда вы не в игре', tgl);
          Bag.act('notify').then((r) => { if (!r.tg) r0.classList.add('hidden'); else tgl.classList.toggle('on', !!r.notify); });
        }
        sec('💡 Подсказки');
        row('Подсказки в игре', 'У ворот босса и пояснения в окнах', opt('hints'));
        row('Обучение', 'Показать знакомство с управлением заново', btn('Начать', () => { Town.close(); Tutorial.start(true); }));
        sec('👤 Аккаунт');
        const pr = Lobby.profile() || {};
        row('Игрок', `${Lobby.playerName()} · герой ${hero.name}`, btn('В лобби', () => location.reload()));
        const id = pr.tgId || pr.uid || '';
        if (id) row(pr.tgId ? 'Telegram ID' : 'ID игрока', String(id), btn('Копировать', () => { (navigator.clipboard ? navigator.clipboard.writeText(String(id)) : Promise.reject()).then(() => Town.toast('ID скопирован'), () => Town.toast(String(id))); }));
        row('Правила и конфиденциальность', 'Пользовательское соглашение, покупки и возвраты, какие данные хранятся', btn('Открыть', () => { const u = location.origin + '/terms.html?lang=' + ((window.I18N && I18N.lang) || 'ru'); const tw = window.Telegram && Telegram.WebApp; if (tw && tw.openLink) tw.openLink(u); else window.open(u, '_blank'); }));
        row('Помощь с покупками', 'Напишите боту игры команду /paysupport — ответит администратор', btn('Открыть бота', async () => { const tw = window.Telegram && Telegram.WebApp; let bot = ''; try { bot = (await (await fetch('/api/config')).json()).botName || ''; } catch { /* нет связи */ } if (tw && tw.openTelegramLink && bot) { tw.openTelegramLink('https://t.me/' + bot); } else Town.toast('Напишите боту игры /paysupport'); }, 'ghost'));
        row('Сбросить настройки', 'Вернуть всё как было по умолчанию', btn('Сбросить', () => { Settings.reset(); if (window.Sfx && !Sfx.isOn()) Sfx.toggle(); Town.toast('Настройки сброшены'); openSettings(); }, 'ghost'));
        Town.open('⚙️ Настройки', box);
      }
      // Автобой в меню «Игра»: включается только в данже, нужен Золотой орден
      const autofarmRow = () => {
        const inDg = zone && zone.kind === 'dungeon';
        const desc = passTier < 3 ? '🔒 Открывается Золотым орденом' : !inDg ? 'Включается только в данже' : autoOn ? 'Герой сражается сам · нажмите, чтобы выключить' : 'Герой будет сам искать монстров и сражаться';
        return ['⚔️', autoOn ? 'Автобой: включён' : 'Автобой: выключен', desc, () => {
          if (passTier < 3) { Town.toast('Автобой открывается Золотым орденом'); Town.openPlace('pass'); return; }
          if (!inDg) { Town.toast('Автобой включается только в данже'); return; }
          Town.close();
          socket.emit('autofarm', !autoOn);
        }];
      };
      // Смена героя прямо из игры: список своих героев → перезапуск с выбранным
      const openHeroSwitch = () => {
        const pr = Lobby.profile() || {}, list = (pr.heroes || []).filter((id) => w.heroes[id]);
        const box = document.createElement('div');
        box.innerHTML = '<p class="sheet-hint">Выберите героя — игра перезапустится с ним. Снаряжение и золото общие на аккаунт.</p>';
        const lv = (id) => ((pr.chars || {})[id] || {}).level || 1;
        for (const id of list.sort((a, b) => lv(b) - lv(a))) {
          const H = w.heroes[id], sk = window.Skins && Skins.get(id), cur = id === selected;
          const r = document.createElement('div'); r.className = 'tw-ev hero-sw' + (cur ? ' on' : '');
          r.innerHTML = `<span class="hs-ava">${sk && sk.portrait ? `<img src="${sk.portrait}" alt="">` : H.icon || '🧙'}</span><div><b></b><small>${H.title || ''} · ур. ${lv(id)}</small></div><button class="l2-btn" ${cur ? 'disabled' : ''}>${cur ? 'Сейчас' : 'Играть'}</button>`;
          r.querySelector('b').textContent = H.name;
          r.querySelector('button').onclick = () => { store.set('lastHero', id); store.set('autoStart', '1'); location.reload(); };
          box.append(r);
        }
        Town.open('👥 Сменить героя', box);
      };
      const NAV = {
        hero: () => Bag.open('hero'),
        bag: () => Bag.open('bag'),
        quests: () => Town.openPlace('events'),
        gacha: () => Town.openPlace('gacha'),
        store: () => Town.openPlace('store'),
        play: () => menuSheet('⚔️ Игра', [
          autofarmRow(),
          ...(zone && zone.kind === 'dungeon' ? [['teleport', 'В город', 'Выйти из данжа в город', () => {
            Town.close();
            if (autoOn) socket.emit('autofarm', false); // иначе герой не выходит из боя, а в бою телепорт запрещён
            socket.emit('recall');
          }]] : []),
          ['party', 'Сменить героя', 'Выбрать другого героя — без выхода через настройки', openHeroSwitch],
          ['arena', 'Рейтинг арены', 'Лучшие игроки и турнир недели · сражаться — в доме арены', () => Town.openPlace('arenaRank')],
          ['pass', 'Сезонные ордена', 'Награды сезона, бонусы и автобой', () => Town.openPlace('pass')],
          ['party', 'Группа', 'До 4 игроков: общий опыт, добыча и данжи', openParty],
          ['clan', 'Клан', 'Свой клан: участники, задания, хранилище, чат', openClan],
          ['trainer', 'Энциклопедия', 'Всё об игре: развитие, снаряжение, крафт, руны, призывы, данжи, боссы, расписание', () => Wiki.open()],
          ['arena', 'Рейтинги', 'Лучшие по уровню, силе, кланы и урону мировым боссам за неделю', () => openRanks()],
          ['events', 'Награда за вход', 'Заходите каждый день — 7 дней подряд, награда растёт', () => Town.openPlace('login')],
          ['chat', 'Чат', 'Общий чат всех игроков', () => { Town.close(); $('chatBtn').click(); }],
          ['smith', 'Соединение 5 → 1', 'Улучшить редкость предметов', () => Bag.open('merge')],
        ]),
        settings: () => openSettings(),
      };
      // Значок готовых наград на кнопке «Квесты»
      const questBadge = (n) => { const b = document.querySelector('[data-nav="quests"]'); b.dataset.badge = n > 0 ? n : ''; };
      // Подсказка текущего шага сюжета на экране: тап — открыть «Квесты»
      let storyCur = null;
      const showStory = (S) => {
        const h = $('storyHint'); storyCur = S && S.cur;
        window.storyStep = storyCur && storyCur.prog < storyCur.goal ? storyCur.id : null; // указатель к месту шага (game.js)
        h.classList.add('hidden'); return; // подсказка сюжета на экране убрана (мешала) — сюжет во вкладке «Квесты»
        if (!storyCur || (zone && (zone.kind === 'worldboss' || zone.kind === 'pvp'))) { h.classList.add('hidden'); return; }
        const q = storyCur, ok = q.prog >= q.goal;
        h.classList.toggle('ready', ok);
        h.innerHTML = `<b>📖 ${q.icon} ${q.name}</b><small>${ok ? '🎁 Выполнено — заберите награду' : q.desc}</small>${q.goal > 1 && !ok ? `<em>${q.prog} / ${q.goal}</em>` : ''}`;
        h.classList.remove('hidden');
      };
      const storyRefresh = () => Bag.act('quests').then((r) => { if (!r.quests) return; showStory(r.story);
        questBadge((r.story && r.story.cur && r.story.cur.prog >= r.story.cur.goal ? 1 : 0) + ['daily', 'weekly', 'monthly'].reduce((s, k) => s + r.quests[k].list.filter((q) => q.prog >= q.goal && !q.claimed).length, 0)); });
      let storyT = 0;
      const storyLater = () => { clearTimeout(storyT); storyT = setTimeout(storyRefresh, 600); };
      $('storyHint').onclick = () => NAV.quests();
      $('gemsBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); vibrate('light'); NAV.store(); }); // самоцветы → магазин
      Town.setContext({ onQuests: questBadge, onStory: showStory });
      socket.on('chat', (m) => {
        if (m.sys && /^📜 Задание выполнено/.test(m.text)) { const b = document.querySelector('[data-nav="quests"]'); questBadge((+b.dataset.badge || 0) + 1); if (window.Sfx) Sfx.play('quest'); }
        if (m.sys && /^📜 Сюжет/.test(m.text)) { storyLater(); if (window.Sfx) Sfx.play('quest'); }
      });
      // Шаги «убить N» обновляем по ходу боя — не чаще раза в 5 с
      setInterval(() => { if (storyCur && storyCur.goal > 1 && storyCur.prog < storyCur.goal && document.visibilityState === 'visible') storyRefresh(); }, 5000);
      storyRefresh();
      $('navBar').onclick = (e) => { const b = e.target.closest('button[data-nav]'); if (b) { vibrate('light'); if (window.Sfx) Sfx.play('click'); if (b.dataset.exit) { socket.emit('recall'); return; } NAV[b.dataset.nav](); } };
      const ui = {
        // Новый уровень: крупная надпись по центру — что стало доступно
        onLevelUp: (lvl) => {
          const U = (Town.skillUnlock() || []).findIndex((u) => u.lvl === lvl);
          const towns = (w.towns || []).filter((t) => (t.minLevel || 1) === lvl).map((t) => t.name);
          const extra = U >= 0 ? `Открыто ${U + 1}-е умение героя!` : towns.length ? `Открыт путь в ${towns.join(', ')} — телепорт в центре города` : lvl % 5 === 0 ? 'Новые вещи в лавках и кузнице' : 'Сила и здоровье выросли';
          const b = $('zoneBanner');
          b.querySelector('b').textContent = `⬆️ Уровень ${lvl}`;
          b.querySelector('small').textContent = extra;
          b.classList.add('hidden'); void b.offsetWidth; b.classList.remove('hidden');
          clearTimeout(ui.bannerTm); ui.bannerTm = setTimeout(() => b.classList.add('hidden'), 2900);
        },
        onWorld: (s, myId) => drawMinimap(s, myId, w.tile, zone),
        onZone: (z) => {
          // Музыка: логово мирового босса и города Эльдмир, Аэлион — свои треки; данжи и остальное — тихий фон по теме
          const TOWN_TRACK = { town1: 'eldmir', town2: 'morgrath', town3: 'aelion' };
          if (window.Sfx) { if (zone && zone.id !== z.id) Sfx.play('portal'); Sfx.music(z.kind === 'worldboss' || z.kind === 'pvp' ? 'worldboss' : z.kind === 'town' ? TOWN_TRACK[z.id] || z.theme : 'dungeon'); }
          zone = z;
          if (z.kind !== 'worldboss') $('wbRank').classList.add('hidden');
          if (typeof storyLater === 'function') storyLater();
          buildMinimap(z);
          Town.setContext({ zone: z });
          Town.close();
          // Вне города центральная кнопка меню — портал в город (выход из данжа, логова босса, общей арены)
          // В данже кнопка открывает меню «Игра» с автобоем и выходом в город, в логове босса и на арене — сразу выход
          const out = z.kind === 'pvp' && !z.inst; // из логова мирового босса и данжа выживания выхода нет
          const pb = document.querySelector('[data-nav="play"]');
          pb.dataset.exit = out ? '1' : '';
          pb.querySelector('img').src = out ? 'assets/ui/place_teleport.webp' : 'assets/ui/nav_play.webp';
          pb.querySelector('em').textContent = out ? 'В город' : 'Игра';
          if (z.kind !== 'survival' && z.kind !== 'dungeon') $('waveBadge').classList.add('hidden');
          const b = $('zoneBanner');
          b.querySelector('b').textContent = z.name;
          b.querySelector('small').textContent = z.kind === 'town' ? `${z.sub} · уровень ${z.level}` : z.sub;
          b.classList.add('hidden'); void b.offsetWidth; b.classList.remove('hidden');
          clearTimeout(ui.bannerTm); ui.bannerTm = setTimeout(() => b.classList.add('hidden'), 2900);
        },
        // Кнопки «Войти» больше нет — вход срабатывает сам, когда герой подходит к порталу или двери
        onNear: (o) => { near = o; },
        onActivate: (o) => activate(o),
        onPlayer: (id) => openPlayer(id),
        skillReady: (id) => { const b = skillBtns[id]; return !!b && !b.el.classList.contains('cooling') && !b.el.classList.contains('locked'); },
        onTarget: (name, hp, maxHp) => {
          if (!name) { $('target').classList.add('hidden'); return; }
          $('target').classList.remove('hidden');
          $('targetName').textContent = `${name} — ${hp}/${maxHp}`;
          $('targetFill').style.width = (100 * hp / maxHp) + '%';
        },
        // Экран загрузки мира: v — доля 0..1 (null — скрыть), zone — куда идём (название над полоской)
        onLoading: (v, zone) => {
          const el = $('worldLoad');
          if (v === null) { el.classList.add('hidden'); window.__shownAt = Date.now(); return; } // после загрузки мира — пару секунд не судим по FPS
          if (el.classList.contains('hidden')) {
            el.classList.remove('hidden');
            $('wlZone').textContent = zone ? zone.name || '' : '';
            $('wlTip').textContent = LOAD_TIPS[Math.floor(Math.random() * LOAD_TIPS.length)];
          }
          const pct = Math.round(v * 100);
          $('wlFill').style.width = pct + '%';
          $('wlText').textContent = `Загрузка… ${pct}%`;
        },
        onDeath: () => { $('deathScreen').classList.remove('hidden'); vibrate('heavy'); },
        onRespawn: () => $('deathScreen').classList.add('hidden'),
        vibrate,
      };
      // Рисуем в физических пикселях экрана (до ×2), иначе на телефоне картинка и текст растягиваются и мылятся
      // Холст — в настоящих пикселях экрана (раньше не больше 2×: на экранах 2,6–3× браузер растягивал картинку — мыло).
      // В режиме экономии батареи — до 2×
      // Разрешение холста. Полное (3× на iPhone) — самое чёткое, но в 2,25 раза больше пикселей, чем 2×: слабым телефонам
      // не хватает сил на 60 кадров, игра «тормозит». «Авто»: начинаем с 2× (или с того, что подошло этому телефону раньше),
      // следим за частотой кадров и сами переключаем разрешение
      const devDpr = window.devicePixelRatio || 1;
      // Нижняя граница чёткости в «Авто»: на плотных экранах (iPhone 3×) не ниже 2× — ниже картинка «зернистая», глазам больно;
      // на экранах 2× — не ниже 1,5×. Совсем грубое 1× — только в режиме «Быстрая» на слабых телефонах
      const AUTO_MIN = devDpr >= 2.5 ? 2 : devDpr >= 1.75 ? 1.5 : 1;
      const DPR_LEVELS = [...new Set([Math.min(3, devDpr), 2, 1.5, 1].filter((x) => x <= devDpr))].sort((a, b) => b - a);
      const AUTO_LEVELS = DPR_LEVELS.filter((x) => x >= Math.min(AUTO_MIN, 1.5)); // ниже AUTO_MIN — только в тяжёлом бою (FPS < 32), потом вернётся
      // Старые сохранённые «потолки» могли застрять на минимуме (снижали, пока игра была свёрнута) — сбрасываем один раз
      if (store.get('gfxVer') !== '2') { store.set('gfxVer', '2'); store.set('gfxCap', ''); store.set('gfxDpr', ''); }
      const gfxStart = () => {
        const g = Settings.get('gfx');
        if (g === 'high') return DPR_LEVELS[0];
        if (g === 'fast') return Math.min(1.5, DPR_LEVELS[0]);
        const saved = Number(store.get('gfxDpr'));
        return AUTO_LEVELS.includes(saved) ? saved : Math.min(2, DPR_LEVELS[0]);
      };
      const DPR = window.GAME_DPR = Settings.get('lowFps') ? Math.min(2, gfxStart()) : gfxStart();
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
      w.myHero = selected; // свой герой грузится сразу, остальные — по мере появления
      game.scene.add('Game', window.GameScene, true, { socket, welcome: w, ui, input });
      setTimeout(() => window.Tutorial && Tutorial.start(), 1800); // обучение при первом входе
      // Награда за вход: если сегодня ещё не забрана — окно само откроется (после обучения, когда окна свободны)
      let loginTries = 0;
      const loginCheck = async () => {
        if (++loginTries > 60) return;
        if (!$('sheet').classList.contains('hidden') || document.querySelector('.tut')) { setTimeout(loginCheck, 3000); return; } // ждём, пока закончится обучение и закроются окна
        const r = await Bag.act('login');
        if (r.login && (!r.login.done || r.login.card)) Town.openPlace('login');
      };
      setTimeout(loginCheck, 4000);
      let rt = 0;
      const applyDpr = (d) => { window.GAME_DPR = d; game.scale.resize(Math.round(window.innerWidth * d), Math.round(window.innerHeight * d)); game.scale.setZoom(1 / d); };
      window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => applyDpr(window.GAME_DPR), 100); });
      // Авто-качество: каждые 3 с смотрим частоту кадров. Не тянет (< 48) два раза подряд — ниже разрешение;
      // стабильно 58+ целых 15 с — пробуем выше, но не выше уровня, на котором уже тормозило
      let slow = 0, fast = 0;
      setInterval(() => {
        if (window.appHidden() || Date.now() - (window.__shownAt || 0) < 6000 || Settings.get('lowFps') || Settings.get('gfx') !== 'auto' || !window.gameScene || window.gameScene.zoneLoading) { slow = fast = 0; return; }
        // Снижаем только при стойкой просадке (< 42 кадров три замера подряд = 9 с) и не ниже AUTO_MIN.
        // «Потолок» (на каком разрешении тормозило) живёт 10 минут, потом снова пробуем чётче
        const fps = game.loop.actualFps, cur = window.GAME_DPR, i = AUTO_LEVELS.indexOf(cur);
        if (i < 0) { slow = fast = 0; return; }
        const capRaw = String(store.get('gfxCap') || '').split('@'), cap = Date.now() - (Number(capRaw[1]) || 0) < 600e3 ? Number(capRaw[0]) || 99 : 99;
        const lowAt = AUTO_LEVELS[i + 1] !== undefined && AUTO_LEVELS[i + 1] < AUTO_MIN ? 32 : 42; // ниже нормы чёткости — только при сильной просадке
        if (fps < lowAt) { fast = 0; if (++slow >= 3 && i < AUTO_LEVELS.length - 1) { slow = 0; store.set('gfxCap', cur + '@' + Date.now()); store.set('gfxDpr', String(AUTO_LEVELS[i + 1])); applyDpr(AUTO_LEVELS[i + 1]); } }
        else if (fps >= 57 || (cur < AUTO_MIN && fps >= 50)) { slow = 0; if (++fast >= 5 && i > 0 && (AUTO_LEVELS[i - 1] < cap || cur < AUTO_MIN)) { fast = 0; store.set('gfxDpr', String(AUTO_LEVELS[i - 1])); applyDpr(AUTO_LEVELS[i - 1]); } }
        else { slow = 0; fast = 0; }
      }, 3000);
      Settings.on((k, v) => { if (k === 'gfx') { store.set('gfxCap', ''); store.set('gfxDpr', ''); applyDpr(gfxStart()); } });
      // Свернули игру — не рисуем кадры (батарея, нагрев); вернулись — рисуем снова. Первые секунды после возврата
      // авто-качество не судит по FPS (браузер «разгоняется»), иначе зря снижало чёткость
      document.addEventListener('appvisibility', (e) => {
        if (e.detail.hidden) { if (game.loop.running) game.loop.sleep(); }
        else { window.__shownAt = Date.now(); if (!game.loop.running) game.loop.wake(true); }
      });
      // FPS и пинг (Настройки → Экран): понять, тормозит телефон или интернет
      let pingMs = 0;
      setInterval(() => { if (!socket.connected) return; const t0 = performance.now(); socket.volatile.emit('ping2', () => { pingMs = Math.round(performance.now() - t0); }); }, 3000);
      setInterval(() => {
        const el = $('netInfo');
        if (!Settings.get('netInfo')) { el.classList.add('hidden'); return; }
        el.classList.remove('hidden');
        const fps = Math.round(game.loop.actualFps);
        el.innerHTML = `<span class="${fps < 45 ? 'bad' : ''}">${fps} FPS</span> · <span class="${pingMs > 250 ? 'bad' : ''}">${pingMs} мс</span> · ${window.GAME_DPR}×`;
      }, 1000);
    });
  }

  Lobby.init({ tg, tgUser, store, guestId, onStart: startGame });

})();
