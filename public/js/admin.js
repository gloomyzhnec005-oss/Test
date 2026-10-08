// Админ-панель: управление игроками, миром и настройками игры (API — server/admin.js)
(() => {
  const $ = (id) => document.getElementById(id);
  const tg = window.Telegram && Telegram.WebApp && Telegram.WebApp.initData ? Telegram.WebApp : null;
  if (tg) { tg.ready(); tg.expand(); }
  let key = '';
  try { key = localStorage.getItem('adminKey') || ''; } catch { /* приватный режим */ }
  let META = null, tab = 'overview', timer = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtNum = (n) => Number(n || 0).toLocaleString('ru-RU');
  const ago = (t) => {
    if (!t) return 'никогда';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'только что';
    if (s < 3600) return `${Math.round(s / 60)} мин назад`;
    if (s < 86400) return `${Math.round(s / 3600)} ч назад`;
    return `${Math.round(s / 86400)} дн назад`;
  };
  const dur = (sec) => `${Math.floor(sec / 3600)} ч ${Math.floor((sec % 3600) / 60)} мин`;

  function toast(text, bad) {
    const t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (bad ? ' bad' : '');
    clearTimeout(toast.tm);
    toast.tm = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  async function api(op, body = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['x-admin-key'] = key;
    if (tg) headers['x-tg-init'] = tg.initData;
    let r;
    try { r = await fetch('/admin/api/' + op, { method: 'POST', headers, body: JSON.stringify(body) }); } catch { toast('Нет связи с сервером', true); return { error: 'net' }; }
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 429) { showLogin(data.error); return { error: data.error }; }
    if (data.error) toast(data.error, true);
    else if (data.text) toast(data.text);
    return data;
  }

  // ---------- Вход ----------
  function showLogin(err) {
    clearInterval(timer);
    $('app').classList.add('hidden');
    $('login').classList.remove('hidden');
    $('loginErr').textContent = err && key ? err : '';
  }
  async function enter() {
    const me = await api('me');
    if (!me.ok) return;
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('via').textContent = 'вход: ' + me.via;
    META = await api('meta');
    open(tab);
  }
  $('loginBtn').onclick = () => {
    key = $('pass').value.trim();
    try { localStorage.setItem('adminKey', key); } catch { /* приватный режим */ }
    enter();
  };
  $('pass').onkeydown = (e) => { if (e.key === 'Enter') $('loginBtn').click(); };
  $('logout').onclick = () => { key = ''; try { localStorage.removeItem('adminKey'); } catch { /* */ } showLogin(); };

  // ---------- Вкладки ----------
  $('tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) open(b.dataset.tab); };
  function open(t) {
    tab = t;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('main > section').forEach((s) => s.classList.toggle('hidden', s.id !== 'tab-' + t));
    clearInterval(timer);
    ({ overview: drawOverview, players: drawPlayers, world: drawWorld, settings: drawSettings, log: drawLog })[t]();
    if (t === 'overview') timer = setInterval(drawOverview, 4000);
  }

  // ---------- Обзор ----------
  async function drawOverview() {
    const o = await api('overview');
    if (o.error) return;
    const box = $('tab-overview');
    box.innerHTML = `
      <div class="tiles">
        <div class="tile"><b>${o.online}</b><span>в игре сейчас</span></div>
        <div class="tile"><b>${fmtNum(o.profiles)}</b><span>аккаунтов</span></div>
        <div class="tile"><b>${fmtNum(o.monsters)}</b><span>монстров</span></div>
        <div class="tile"><b>${o.dungeons} / ${o.survivals}</b><span>данжей / выживаний</span></div>
        <div class="tile"><b>${o.memMb} МБ</b><span>память</span></div>
        <div class="tile"><b>${dur(o.uptime)}</b><span>работает</span></div>
      </div>
      ${o.settings.maintenance ? '<div class="card"><b style="color:var(--red)">🔧 Включены технические работы — игроки не могут войти</b></div>' : ''}
      <div class="card"><h3>Мировые боссы</h3>
        ${o.worldBosses.map((w) => `<div class="row"><span class="grow"><b>${esc(w.townName)}</b><br><small class="muted">${w.boss ? `👹 ${esc(w.boss.name)} · ${fmtNum(w.boss.hp)} / ${fmtNum(w.boss.maxHp)}` : `появится ${w.nextAt <= Date.now() ? 'сейчас' : 'через ' + Math.ceil((w.nextAt - Date.now()) / 60000) + ' мин'}`}</small></span>
          ${w.boss ? `<button class="btn small danger" data-wb="${w.town}" data-kill="1">Убрать</button>` : `<button class="btn small primary" data-wb="${w.town}">Вызвать сейчас</button>`}</div>`).join('')}
      </div>
      <div class="card"><h3>В игре (${o.sessions.length})</h3>
        <div class="list">${o.sessions.map((s) => `<div class="item" data-uid="${esc(s.uid)}"><span class="dot on"></span>
          <div class="main"><b>${esc(s.name)} · ${esc(s.heroName)} ${s.level} ур.</b><small>${esc(s.zoneName)} · ❤️ ${s.hp}/${s.maxHp}${s.dead ? ' · мёртв' : ''}${s.god ? ' · 🛡 бессмертие' : ''}${s.oneShot ? ' · ⚡ ваншот' : ''}</small></div></div>`).join('') || '<p class="muted">Никого нет</p>'}</div>
      </div>
      <div class="card"><h3>Зоны</h3><table><tr><th>Зона</th><th>Игроки</th><th>Монстры</th><th></th></tr>
        ${o.zones.map((z) => `<tr><td>${esc(z.name)}</td><td>${z.players}</td><td>${z.monsters}</td><td>${z.monsters ? `<button class="btn small" data-clear="${esc(z.id)}">Очистить</button>` : ''}</td></tr>`).join('')}</table></div>`;
    box.onclick = async (e) => {
      const it = e.target.closest('[data-uid]');
      if (it) return openPlayer(it.dataset.uid);
      const wb = e.target.closest('[data-wb]');
      if (wb) { await api('worldBoss', { town: wb.dataset.wb, kill: !!wb.dataset.kill }); setTimeout(drawOverview, 800); }
      const cl = e.target.closest('[data-clear]');
      if (cl) { await api('clearZone', { zone: cl.dataset.clear }); drawOverview(); }
    };
  }

  // ---------- Игроки ----------
  let query = '';
  async function drawPlayers() {
    const box = $('tab-players');
    if (!box.firstChild) {
      box.innerHTML = '<div class="row"><input id="pq" class="wide" placeholder="Поиск по имени или ID"><button id="pqBtn" class="btn">Найти</button></div><p id="pTotal" class="muted"></p><div id="pList" class="list"></div>';
      $('pqBtn').onclick = () => { query = $('pq').value.trim(); drawPlayers(); };
      $('pq').onkeydown = (e) => { if (e.key === 'Enter') $('pqBtn').click(); };
      $('pList').onclick = (e) => { const it = e.target.closest('[data-uid]'); if (it) openPlayer(it.dataset.uid); };
    }
    const r = await api('players', { q: query });
    if (r.error) return;
    $('pTotal').textContent = `Найдено: ${r.total}${r.total > r.players.length ? ` (показаны ${r.players.length})` : ''}`;
    $('pList').innerHTML = r.players.map((p) => `<div class="item" data-uid="${esc(p.uid)}"><span class="dot ${p.online ? 'on' : ''}"></span>
      <div class="main"><b>${esc(p.name || 'без имени')}</b><small>${esc(p.uid)} · героев ${p.heroes} · макс. ${p.maxLevel} ур. · 💰 ${fmtNum(p.gold)} · ${p.online ? 'в игре' : ago(p.lastSeen)}</small></div>
      ${p.banned ? '<span class="tag red">бан</span>' : ''}</div>`).join('') || '<p class="muted">Никого не найдено</p>';
  }

  // Карточка игрока
  let cur = null;
  async function openPlayer(uid) {
    const p = await api('player', { uid });
    if (p.error) return;
    cur = p;
    $('sheet').classList.remove('hidden');
    drawPlayer();
  }
  $('sheetClose').onclick = () => { $('sheet').classList.add('hidden'); cur = null; if (tab === 'players') drawPlayers(); };

  const edit = async (action, extra = {}) => {
    const r = await api('edit', { uid: cur.uid, action, ...extra });
    if (r.deleted) { $('sheetClose').click(); return; }
    if (r.player) { cur = r.player; drawPlayer(); }
  };

  let openHero = null;
  // Блок героя в карточке игрока: уровень, опыт, дубликаты и умения
  function heroBlock(h) {
    const M = META;
    const skills = h.skills.map((k, i) => {
      const open = i < h.unlocked, byProg = i < h.byProgress, granted = open && !byProg;
      const btn = !h.owned ? '' : !open ? `<button class="btn small ok" data-h="skills" data-hero="${h.id}" data-val="${i + 1}">Выдать</button>`
        : granted ? `<button class="btn small" data-h="skills" data-hero="${h.id}" data-val="${i <= h.byProgress ? 0 : i}">Забрать</button>` : '';
      return `<div class="skill-row ${open ? 'open' : ''}"><span>${k.icon}</span><div class="grow"><b>${esc(k.name)}</b>
        <small>${open ? (byProg ? '✅ открыто по прогрессу' : '✅ выдано админом') : '🔒 закрыто'}</small></div>${btn}</div>`;
    }).join('');
    return `<details class="hero-block ${h.owned ? '' : 'not-owned'}" data-hero-block="${h.id}" ${openHero === h.id ? 'open' : ''}>
      <summary><input type="checkbox" data-own="${h.id}" ${h.owned ? 'checked' : ''} title="Есть у игрока">
        <span class="grow"><b>${esc(h.name)}</b> <small class="muted">${esc(h.title)}</small></span>
        ${h.owned ? `<span class="tag gold">${h.level} ур.</span><span class="tag">✨ ${h.unlocked}/${h.skills.length}</span>${h.dupes ? `<span class="tag">★${h.dupes}</span>` : ''}` : '<span class="tag">нет</span>'}</summary>
      ${h.owned ? `<div class="hero-body">
        <div class="row"><label>Уровень</label><button class="btn small" data-h="level+" data-hero="${h.id}" data-val="-1">−1</button>
          <input type="number" data-lvl="${h.id}" min="1" max="${M.maxLevel}" value="${h.level}">
          <button class="btn small" data-h="level+" data-hero="${h.id}" data-val="1">+1</button><button class="btn small" data-h="level+" data-hero="${h.id}" data-val="5">+5</button>
          <button class="btn small" data-h="level+" data-hero="${h.id}" data-val="100">Макс</button></div>
        <div class="row"><label>Опыт</label><input type="number" data-xp="${h.id}" min="0" value="${h.xp}"><span class="muted">из ${fmtNum(h.xpNext)} до след. уровня</span></div>
        <div class="row"><label>Дубликаты</label><input type="number" data-dup="${h.id}" min="0" max="${M.dupeMax}" value="${h.dupes}"><span class="muted">+${h.dupes * 5}% к силе · убийств ${fmtNum(h.kills)}</span></div>
        <div class="ic-sec">Умения</div>${skills}
        ${h.passive ? `<div class="skill-row open"><span>⭐</span><div class="grow"><b>${esc(h.passive)}</b><small>пассивный навык, всегда открыт</small></div></div>` : ''}
        <div class="row" style="margin-top:6px"><button class="btn small ok" data-h="skills" data-hero="${h.id}" data-val="${h.skills.length}">Выдать все умения</button>
          ${h.granted ? `<button class="btn small" data-h="skills" data-hero="${h.id}" data-val="0">Только по прогрессу</button>` : ''}</div>
      </div>` : ''}
    </details>`;
  }

  function drawPlayer() {
    const p = cur, M = META;
    const s = p.sessions[0];
    $('sheetTitle').textContent = `${p.name || 'Без имени'} · ${p.uid}`;
    const opt = (o, sel) => Object.entries(o).map(([k, v]) => `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
    $('sheetBody').innerHTML = `
      <div class="card">
        <div class="row"><span class="dot ${s ? 'on' : ''}"></span><b class="grow">${s ? `В игре: ${esc(s.heroName)} ${s.level} ур. · ${esc(s.zoneName)} · ❤️ ${s.hp}/${s.maxHp}` : 'Не в игре · ' + ago(p.lastSeen)}</b>
          ${p.banned ? `<span class="tag red">бан: ${esc(p.banned.reason)}</span>` : ''}</div>
      </div>

      <div class="card"><h3>🧪 Тесты</h3>
        <label class="switch"><input type="checkbox" data-flag="god" ${p.test.god ? 'checked' : ''}> Бессмертие (монстры не наносят урон)</label>
        <label class="switch"><input type="checkbox" data-flag="oneShot" ${p.test.oneShot ? 'checked' : ''}> Убийство монстров с одного удара</label>
        <label class="switch"><input type="checkbox" data-flag="tester" ${p.test.tester ? 'checked' : ''}> Может входить во время техработ</label>
        <div class="row" style="margin-top:8px">
          <button class="btn ok" data-a="heal">❤️ Вылечить и сбросить перезарядки</button>
          <button class="btn danger" data-a="kill">💀 Убить героя</button>
        </div>
        <div class="row"><label>Телепорт</label><select id="tpZone" class="wide">${M.zones.map((z) => `<option value="${esc(z.id)}">${esc(z.name)}</option>`).join('')}</select><button class="btn" data-a="teleport">Переместить</button></div>
        <div class="row"><label>Опыт активному герою</label><input id="xpVal" type="number" value="1000"><button class="btn" data-a="xp">Начислить</button></div>
        <div class="row"><button class="btn primary" data-a="maxTest">🚀 Тестовый набор: все герои 50 ур., всё открыто, много золота и круток</button></div>
        ${s ? '' : '<p class="muted">Лечение, убийство, телепорт и опыт работают, когда игрок в игре.</p>'}
      </div>

      <div class="card"><h3>💰 Ресурсы</h3>
        <div class="row"><label>Золото: <b>${fmtNum(p.gold)}</b></label><input id="goldVal" type="number" value="10000"><button class="btn" data-a="goldAdd">Добавить</button><button class="btn" data-a="goldSet">Установить</button></div>
        <div class="row"><label>Крутки героев</label><input id="spinsVal" type="number" value="${p.paidSpins}"><button class="btn" data-a="spins">Сохранить</button>
          <button class="btn" data-a="freeSpin" ${p.freeSpinUsed ? '' : 'disabled'}>Вернуть бесплатную</button></div>
        <div class="row"><label>Крутки предметов</label><input id="iSpinsVal" type="number" value="${p.itemSpins}"><button class="btn" data-a="itemSpins">Сохранить</button></div>
      </div>

      <div class="card"><h3>🦸 Герои (${p.heroes.filter((h) => h.owned).length} / ${p.heroes.length})</h3>
        <div class="row"><button class="btn" data-a="allHeroes">Выдать всех</button>
          <label>Всем: ур.</label><input id="allLvl" type="number" min="1" max="${M.maxLevel}" value="${M.maxLevel}"><button class="btn" data-a="allLevel">OK</button>
          <label>дубл.</label><input id="allDup" type="number" min="0" max="${M.dupeMax}" value="${M.dupeMax}"><button class="btn" data-a="allDupes">OK</button></div>
        <div class="row"><button class="btn" data-a="allSkills">✨ Открыть все умения всем героям</button><button class="btn" data-a="noSkills">Сбросить выданные умения</button></div>
        <p class="muted">Нажмите на героя, чтобы прокачать его и выдать умения.</p>
        <div class="heroes-list">${p.heroes.map(heroBlock).join('')}</div>
      </div>

      <div class="card"><h3>🎒 Предметы (${p.items})</h3>
        <p class="muted">${Object.entries(p.itemsByRar).map(([k, n]) => `${esc(M.rarities[k] || k)}: ${n}`).join(' · ') || 'Сумка пуста'}</p>
        <div class="row"><select id="itCat"><option value="">Любая категория</option>${opt(M.cats)}</select><select id="itRar">${opt(M.rarities, 'legendary')}</select>
          <select id="itTier"><option value="1">Мир I</option><option value="2">Мир II</option><option value="3">Мир III</option></select>
          <input id="itCount" type="number" value="1" min="1" max="50"><button class="btn" data-a="giveItem">Выдать</button></div>
        <div class="row"><button class="btn danger" data-a="clearItems">Удалить все предметы</button></div>
      </div>

      <div class="card"><h3>⭐ Подписка и пропуск</h3>
        <div class="row"><label>Подписка: ${p.subUntil > Date.now() ? 'до ' + new Date(p.subUntil).toLocaleDateString('ru-RU') : 'нет'}</label><input id="subDays" type="number" value="30"><label>дн.</label><button class="btn" data-a="sub">Выдать</button><button class="btn" data-a="subOff">Снять</button></div>
        <label class="switch"><input type="checkbox" data-pass ${p.pass.premium ? 'checked' : ''}> Премиум боевой пропуск (уровень ${p.pass.level})</label>
        <div class="row"><label>Опыт пропуска</label><input id="passXp" type="number" value="100"><button class="btn" data-a="passXp">Добавить</button></div>
      </div>

      <div class="card"><h3>🛡 Модерация</h3>
        <div class="row"><input id="banReason" class="wide" placeholder="Причина" value="${esc(p.banned ? p.banned.reason : '')}">
          ${p.banned ? '<button class="btn ok" data-a="unban">Разбанить</button>' : '<button class="btn danger" data-a="ban">Забанить</button>'}</div>
        <div class="row"><button class="btn" data-a="kick" ${s ? '' : 'disabled'}>Отключить из игры</button><button class="btn danger" data-a="reset">Удалить весь прогресс</button></div>
      </div>

      <div class="card"><h3>🧾 Профиль JSON</h3>
        <p class="muted">Ручная правка всего профиля. Игрок будет отключён при сохранении.</p>
        <div class="row"><button class="btn" data-a="rawLoad">Загрузить</button><button class="btn danger" data-a="rawSave">Сохранить</button></div>
        <textarea id="raw" class="hidden" spellcheck="false"></textarea>
      </div>`;

    const body = $('sheetBody');
    const v = (id) => $(id).value;
    body.onchange = (e) => {
      const t = e.target;
      if (t.dataset.flag) edit(t.dataset.flag, { value: t.checked });
      else if (t.dataset.own) edit(t.checked ? 'giveHero' : 'removeHero', { hero: t.dataset.own });
      else if (t.dataset.lvl) edit('level', { hero: t.dataset.lvl, value: t.value });
      else if (t.dataset.dup) edit('dupes', { hero: t.dataset.dup, value: t.value });
      else if (t.dataset.xp) edit('heroXp', { hero: t.dataset.xp, value: t.value });
      else if (t.dataset.pass !== undefined) edit('passPremium', { value: t.checked });
    };
    body.addEventListener('toggle', (e) => {
      const d = e.target.closest && e.target.closest('[data-hero-block]');
      if (d) openHero = d.open ? d.dataset.heroBlock : openHero === d.dataset.heroBlock ? null : openHero;
    }, true);
    body.onclick = async (e) => {
      if (e.target.matches('summary input')) e.stopPropagation(); // галочка «есть у игрока» не раскрывает блок
      const hb = e.target.closest('[data-h]');
      if (hb) { openHero = hb.dataset.hero; return edit(hb.dataset.h, { hero: hb.dataset.hero, value: Number(hb.dataset.val) }); }
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      const A = {
        heal: () => edit('heal'), kill: () => edit('kill'), maxTest: () => edit('maxTest'),
        teleport: () => edit('teleport', { zone: v('tpZone') }), xp: () => edit('xp', { value: v('xpVal') }),
        goldAdd: () => edit('gold', { value: v('goldVal') }), goldSet: () => edit('gold', { value: v('goldVal'), set: true }),
        spins: () => edit('spins', { value: v('spinsVal') }), freeSpin: () => edit('freeSpin'), itemSpins: () => edit('itemSpins', { value: v('iSpinsVal') }),
        allHeroes: () => edit('allHeroes'), allLevel: () => edit('level', { value: v('allLvl') }), allDupes: () => edit('dupes', { value: v('allDup') }),
        allSkills: () => edit('skills', { value: 3 }), noSkills: () => edit('skills', { value: 0 }),
        giveItem: () => edit('giveItem', { cat: v('itCat'), rar: v('itRar'), tier: v('itTier'), count: v('itCount') }),
        clearItems: () => confirm('Удалить все предметы игрока?') && edit('clearItems'),
        sub: () => edit('sub', { value: v('subDays') }), subOff: () => edit('sub', { value: 0 }), passXp: () => edit('passXp', { value: v('passXp') }),
        ban: () => confirm('Забанить игрока?') && edit('ban', { reason: v('banReason') }), unban: () => edit('unban'), kick: () => edit('kick'),
        reset: () => confirm('Удалить ВЕСЬ прогресс игрока? Это нельзя отменить.') && edit('reset'),
        rawLoad: async () => { const r = await api('raw', { uid: cur.uid }); if (r.json) { $('raw').value = JSON.stringify(r.json, null, 2); $('raw').classList.remove('hidden'); } },
        rawSave: async () => {
          if ($('raw').classList.contains('hidden')) return toast('Сначала загрузите профиль', true);
          let json;
          try { json = JSON.parse($('raw').value); } catch (err) { return toast('Ошибка в JSON: ' + err.message, true); }
          if (!confirm('Сохранить профиль? Игрок будет отключён.')) return;
          const r = await api('rawSave', { uid: cur.uid, json });
          if (r.player) { cur = r.player; drawPlayer(); }
        },
      };
      if (A[a]) A[a]();
    };
  }

  // ---------- Мир ----------
  async function drawWorld() {
    const box = $('tab-world');
    const o = await api('overview');
    if (o.error) return;
    const mobs = [...META.mobs].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const RANKS = { '': 'как задумано', normal: 'обычный', magic: 'усиленный', rare: 'редкий', mini: 'полубосс', boss: 'босс', world: 'мировой босс', summon: 'призванный' };
    box.innerHTML = `
      <div class="card"><h3>📢 Объявление всем игрокам</h3>
        <div class="row"><input id="bcText" class="wide" placeholder="Текст в чат всем, кто в игре"><button id="bcBtn" class="btn primary">Отправить</button></div></div>
      <div class="card"><h3>👾 Создать монстров</h3>
        <div class="row"><input id="mobQ" class="wide" placeholder="Поиск монстра"></div>
        <div class="row"><select id="mobType" class="wide" size="6">${mobs.map((m) => `<option value="${m.id}">${esc(m.name)} · ${esc(RANKS[m.rank] || m.rank)}</option>`).join('')}</select></div>
        <div class="row"><label>Ур.</label><input id="mobLvl" type="number" value="10" min="1" max="60"><label>Кол-во</label><input id="mobN" type="number" value="1" min="1" max="30">
          <select id="mobRank">${Object.entries(RANKS).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div>
        <div class="row"><label>Где</label><select id="mobAt" class="wide">
          ${o.sessions.map((s) => `<option value="u:${esc(s.uid)}">рядом с ${esc(s.name)} (${esc(s.zoneName)})</option>`).join('')}
          ${META.zones.map((z) => `<option value="z:${esc(z.id)}">${esc(z.name)} — у входа</option>`).join('')}</select>
          <button id="mobBtn" class="btn primary">Создать</button></div>
      </div>
      <div class="card"><h3>🧹 Очистка</h3>
        <div class="row"><button id="clearAll" class="btn danger">Удалить всех монстров во всех зонах</button></div>
        <p class="muted">Монстры в данжах появятся заново при следующем входе. Очистить отдельную зону можно на вкладке «Обзор».</p></div>`;
    $('bcBtn').onclick = async () => { const r = await api('broadcast', { text: $('bcText').value }); if (!r.error) $('bcText').value = ''; };
    $('mobQ').oninput = () => {
      const q = $('mobQ').value.toLowerCase();
      for (const o2 of $('mobType').options) o2.hidden = q && !o2.textContent.toLowerCase().includes(q);
    };
    $('mobBtn').onclick = () => {
      const type = $('mobType').value;
      if (!type) return toast('Выберите монстра', true);
      const at = $('mobAt').value;
      if (!at) return toast('Выберите место', true);
      api('spawn', { type, level: $('mobLvl').value, count: $('mobN').value, rank: $('mobRank').value || undefined, ...(at[0] === 'u' ? { uid: at.slice(2) } : { zone: at.slice(2) }) });
    };
    $('clearAll').onclick = () => confirm('Удалить всех монстров?') && api('clearZone', {});
  }

  // ---------- Настройки ----------
  async function drawSettings() {
    const r = await api('settings');
    if (r.error) return;
    const s = r.settings;
    $('tab-settings').innerHTML = `
      <div class="card"><h3>📈 Множители</h3>
        <div class="row"><label class="grow">Опыт</label><input id="sXp" type="number" step="0.1" value="${s.xpMult}"></div>
        <div class="row"><label class="grow">Золото</label><input id="sGold" type="number" step="0.1" value="${s.goldMult}"></div>
        <div class="row"><label class="grow">Шанс добычи с обычных монстров</label><input id="sDrop" type="number" step="0.1" value="${s.dropMult}"></div>
        <p class="muted">1 — обычно, 2 — вдвое больше. Удобно для событий «двойной опыт» и для тестов.</p></div>
      <div class="card"><h3>🎛 Режимы</h3>
        <label class="switch"><input id="sFree" type="checkbox" ${s.freeSpins ? 'checked' : ''}> Бесплатные крутки героев для всех</label>
        <label class="switch"><input id="sMaint" type="checkbox" ${s.maintenance ? 'checked' : ''}> Технические работы (вход только тестерам)</label></div>
      <div class="card"><h3>💬 Сообщение при входе</h3>
        <div class="row"><input id="sMotd" class="wide" placeholder="Показывается каждому игроку при входе в мир" value="${esc(s.motd)}"></div></div>
      <div class="row"><button id="sSave" class="btn primary">Сохранить настройки</button><button id="sDisk" class="btn">Записать данные игроков на диск</button></div>`;
    $('sSave').onclick = async () => {
      if ($('sMaint').checked && !s.maintenance && !confirm('Включить техработы? Все игроки, кроме тестеров, будут отключены.')) return;
      await api('settings', { set: { xpMult: $('sXp').value, goldMult: $('sGold').value, dropMult: $('sDrop').value, freeSpins: $('sFree').checked, maintenance: $('sMaint').checked, motd: $('sMotd').value } });
      drawSettings();
    };
    $('sDisk').onclick = () => api('save');
  }

  // ---------- Журнал ----------
  async function drawLog() {
    const r = await api('log');
    if (r.error) return;
    const KIND = { admin: '⚙️', join: '➡️', pay: '⭐' };
    $('tab-log').innerHTML = `<div class="row"><button id="logRe" class="btn small">Обновить</button><span class="muted">Действия админов, входы игроков и оплаты с момента запуска сервера</span></div>
      ${r.log.map((l) => `<div class="log-line"><time>${new Date(l.t).toLocaleString('ru-RU')}</time>${KIND[l.kind] || ''} ${esc(l.text)}</div>`).join('') || '<p class="muted">Пока пусто</p>'}`;
    $('logRe').onclick = drawLog;
  }

  if (key || tg) enter(); else showLogin();
})();
