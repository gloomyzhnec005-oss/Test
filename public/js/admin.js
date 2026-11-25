// Админ-панель: управление игроками, миром и настройками игры (API — server/admin.js)
(() => {
  const $ = (id) => document.getElementById(id);
  const tg = window.Telegram && Telegram.WebApp && Telegram.WebApp.initData ? Telegram.WebApp : null;
  if (tg) { tg.ready(); tg.expand(); }
  let key = '';
  try { key = localStorage.getItem('adminKey') || ''; } catch { /* приватный режим */ }
  let META = null, tab = 'overview', timer = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Что Telegram сообщил о посетителе (server/index.js → noteVisitor)
const PLAT = { ios: '📱 iPhone', android: '📱 Android', android_x: '📱 Android', tdesktop: '💻 Telegram Desktop', macos: '💻 macOS', weba: '🌐 Telegram Web', webk: '🌐 Telegram Web', web: '🌐 браузер', unigram: '💻 Unigram' };
const tgLine = (t) => [PLAT[t.plat] || t.plat || '', t.lang ? `язык ${t.lang}` : '', t.prem ? '⭐ Premium' : '', t.src ? `пришёл по ссылке «${t.src}»` : 'пришёл: напрямую в бота', t.firstAt ? `впервые ${new Date(t.firstAt).toLocaleString('ru-RU')}` : '', t.visits ? `заходов ${t.visits}` : ''].filter(Boolean).map((x) => esc(x)).join(' · ');
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
    $('via').textContent = `вход: ${me.via} · версия ${me.version}`;
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
    ({ overview: drawOverview, players: drawPlayers, world: drawWorld, econ: drawEcon, gram: drawGram, settings: drawSettings, log: drawLog })[t]();
    if (t === 'overview') timer = setInterval(drawOverview, 4000);
  }

  // ---------- Сохранения ----------
  function storageCard(s) {
    if (!s) return '';
    const warn = !s.persistent
      ? '<p style="color:var(--red)"><b>⚠️ Нет постоянного диска: сохранения игроков сотрутся при следующем деплое!</b><br>Railway → сервис → Settings → Volumes → подключить Volume с путём <code>/app/data</code>.</p>'
      : '';
    const last = s.lastBackup ? new Date(s.lastBackup).toLocaleString('ru-RU') : 'ещё не было';
    if (s.db) return `<div class="card"><h3>💾 Сохранения · база Postgres ✅</h3>
      ${s.lastError ? `<p style="color:var(--red)">⚠️ Последняя ошибка записи: ${esc(s.lastError)}</p>` : ''}
      <div class="row"><span class="grow"><small class="muted">Игроков в базе: ${fmtNum(s.players)} · последняя запись: ${s.lastFlush ? new Date(s.lastFlush).toLocaleTimeString('ru-RU') : '—'} (${s.flushMs} мс)<br>
        Запись — раз в ~1,5 с и при остановке сервера. Снимки базы — каждый час (24 шт.) и раз в сутки (14 шт.), ежедневный — ещё и вам в Telegram.<br>
        Последний снимок: ${s.snap && s.snap.last ? new Date(s.snap.last).toLocaleString('ru-RU') : 'ещё не было'}${s.snap && s.snap.lastError ? ` · <b style="color:var(--red)">ошибка: ${esc(s.snap.lastError)}</b>` : ''}</small></span>
        <button class="btn small primary" data-snaps="1">Снимки и восстановление</button></div></div>`;
    const dbWarn = s.dbUrlSet ? `<p style="color:var(--red)"><b>⚠️ DATABASE_URL задан, но база не подключилась</b> — игра работает на файлах.${s.dbError ? `<br>Причина: <code>${esc(s.dbError)}</code>` : ''}</p>` : '';
    return `<div class="card"><h3>💾 Сохранения</h3>${warn}${dbWarn}
      <div class="row"><span class="grow"><small class="muted">Папка: ${esc(s.dir)}${s.persistent ? ' · постоянный диск ✅' : ''}<br>
        Игроки: ${fmtNum(s.sizeKb)} КБ · бэкапов: ${s.backups} из ${s.keep} (раз в ${s.everyMin} мин) · последний: ${esc(last)}</small></span>
        <button class="btn small primary" data-snaps="1">Бэкапы и восстановление</button></div></div>`;
  }
  // ---------- Снимки и восстановление (отдельное окно поверх — обзор обновляется каждые 4 с) ----------
  const authHeaders = () => { const h = {}; if (key) h['x-admin-key'] = key; if (tg) h['x-tg-init'] = tg.initData; return h; };
  // Скачать снимок. В Telegram на телефоне обычное скачивание даёт чёрный экран — там просим у сервера одноразовую ссылку
  // и отдаём её Telegram (downloadFile) или внешнему браузеру; в обычном браузере — как раньше
  async function saveSnap(id) {
    const inTg = tg && tg.platform && tg.platform !== 'unknown';
    if (inTg) {
      const r = await api('snapLink', { id });
      if (!r.url) return;
      const url = location.origin + r.url, name = r.url.split('/').pop();
      if (tg.downloadFile && tg.isVersionAtLeast && tg.isVersionAtLeast('8.0')) {
        try { return tg.downloadFile({ url, file_name: name }); } catch { /* старый Telegram — откроем в браузере */ }
      }
      return tg.openLink(url);
    }
    toast('Готовлю файл…');
    const r = await fetch('/admin/api/snapDownload', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (!r.ok) return toast('Не удалось скачать', true);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob());
    a.download = `mystic-backup-${id ? 'snap' + id + '-' : ''}${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.json.gz`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  const KIND = { hour: 'час', day: 'сутки', manual: 'вручную', prerestore: 'перед восстановлением' };
  async function openSnaps() {
    let ov = document.getElementById('snapOv');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'snapOv';
      ov.style.cssText = 'position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.75);overflow:auto;padding:16px';
      document.body.append(ov);
    }
    const r = await api('snapshots');
    ov.innerHTML = `<div class="card" style="max-width:720px;margin:0 auto">
      <div class="row"><h3 class="grow" style="margin:0">💾 Бэкапы и восстановление</h3><button class="btn small" data-close="1">Закрыть</button></div>
      <p class="muted"><small>На телефоне удобнее «📩 Прислать в Telegram» — бот пришлёт файл в чат, там его можно сохранить («Сохранить в Файлы»).<br>Восстановление заменяет ВСЕ данные игры (игроки, рынок, кланы…) содержимым бэкапа. Текущее состояние перед этим сохраняется снимком «перед восстановлением» — им можно откатить. Игроков выкинет, сервер перезапустится примерно за минуту.</small></p>
      <div class="row" style="flex-wrap:wrap;gap:6px"><button class="btn primary" data-tg="0">📩 Прислать в Telegram</button><button class="btn" data-dl="0">Скачать текущее состояние</button>${r.db ? '<button class="btn" data-now="1">Сделать снимок сейчас</button>' : ''}</div>
      <div class="row" style="flex-wrap:wrap"><label class="grow" style="min-width:0;max-width:100%">Восстановить из файла (.json.gz из Telegram или «Скачать»)<input type="file" id="snapFile" style="max-width:100%;display:block" accept=".gz,.json,application/gzip,application/json"></label><button class="btn danger" data-file="1">Восстановить</button></div>
      ${r.db ? `<h3>Снимки в базе (${(r.list || []).length})</h3>
        ${(r.list || []).map((x) => `<div style="border-top:1px solid rgba(255,255,255,.08);padding:8px 0"><div><b>№${x.id}</b> · ${new Date(x.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${KIND[x.kind] || esc(x.kind)}<br><small class="muted">игроков ${fmtNum(x.players)} · ${x.size < 1048576 ? Math.max(1, Math.round(x.size / 1024)) + ' КБ' : (x.size / 1048576).toFixed(1) + ' МБ'}</small></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><button class="btn small" data-tg="${x.id}">📩 В Telegram</button><button class="btn small" data-dl="${x.id}">Скачать</button><button class="btn small danger" data-rs="${x.id}">Восстановить</button></div></div>`).join('')}` : '<p class="muted">Без базы снимки делаются файлами на диске (см. «Сохранения»).</p>'}
    </div>`;
    const confirmTyped = (what) => (prompt(`Восстановить ${what}? Все текущие данные игры будут заменены.\nНапишите ВОССТАНОВИТЬ для подтверждения:`) || '').trim().toUpperCase() === 'ВОССТАНОВИТЬ';
    const after = (res) => { if (res && res.restarting) { ov.innerHTML = `<div class="card" style="max-width:720px;margin:0 auto"><h3>✅ ${esc(res.text)}</h3></div>`; setTimeout(() => location.reload(), 30000); } };
    ov.onclick = async (e) => {
      const t = e.target;
      if (t === ov || t.closest('[data-close]')) return ov.remove();
      if (t.closest('[data-now]')) { await api('snapshotNow'); return openSnaps(); }
      const tgb = t.closest('[data-tg]'); if (tgb) return api('snapToTg', { id: Number(tgb.dataset.tg) || 0 });
      const dl = t.closest('[data-dl]'); if (dl) return saveSnap(Number(dl.dataset.dl) || 0);
      const rs = t.closest('[data-rs]');
      if (rs && confirmTyped(`снимок №${rs.dataset.rs}`)) return after(await api('restoreSnap', { id: Number(rs.dataset.rs), confirm: 'ВОССТАНОВИТЬ' }));
      if (t.closest('[data-file]')) {
        const f = document.getElementById('snapFile').files[0];
        if (!f) return toast('Выберите файл бэкапа', true);
        if (!confirmTyped(`из файла «${f.name}»`)) return;
        toast('Загружаю файл…');
        let res;
        try { res = await (await fetch('/admin/api/restoreFile', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/octet-stream', 'x-confirm': 'restore' }, body: await f.arrayBuffer() })).json(); } catch { return toast('Нет связи с сервером', true); }
        if (res.error) return toast(res.error, true);
        toast(res.text); after(res);
      }
    };
  }
  async function downloadBackup() {
    const r = await api('backup');
    if (!r.files) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(r.files)], { type: 'application/json' }));
    a.download = `saves-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- GRAM: заявки на вывод и журнал ----------
  const G = (n) => (Number(n || 0) / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  const GKIND = { deposit: 'пополнение', shop: 'Рынок', buy: 'покупка в ТД', sale: 'продажа в ТД', fee: 'комиссия ТД', withdraw: 'заявка на вывод', payout: 'выплачено', refund: 'возврат', admin: 'администрация' };
  async function drawGram() {
    const o = await api('gram');
    const box = $('tab-gram');
    if (o.error) { box.innerHTML = `<div class="card">${esc(o.error)}</div>`; return; }
    const t = o.totals;
    const msk = (ts) => new Date(ts + 3 * 36e5).toISOString().slice(5, 16).replace('T', ' ');
    box.innerHTML = `
      <div class="card"><small class="muted">Выплаты — вручную, ежедневно с 20:00 до 24:00 МСК: переведите «К выплате» на адрес из своего кошелька (Tonkeeper) и нажмите «Выплачено» (можно вставить хеш перевода). Сначала — заявки с орденами (⭐). «Отклонить» возвращает GRAM игроку к выводу.</small></div>
      <div class="tiles">
        <div class="tile"><b>${G(t.all)}</b><span>GRAM на балансах игроков всего</span></div>
        <div class="tile"><b>${G(t.dep)}</b><span>пополнено (вывести нельзя)</span></div>
        <div class="tile"><b>${G(t.free)} / ${G(t.hold)}</b><span>с продаж: доступно / удерживается 3 дня</span></div>
        <div class="tile"><b style="color:${t.waitNet ? 'var(--red)' : 'inherit'}">${G(t.waitNet)}</b><span>ждут выплаты (${o.wait.length} заявок)</span></div>
        <div class="tile"><b>${t.lots}</b><span>лотов в Торговом доме</span></div>
      </div>
      ${t.cash ? `<div class="card"><h3>💰 Касса</h3>
        <div class="tiles">
          <div class="tile"><b>${G(t.cash.in)}</b><span>пришло пополнений всего</span></div>
          <div class="tile"><b>${G(t.cash.out)}</b><span>выплачено игрокам всего</span></div>
          <div class="tile"><b>${G(t.cash.should)}</b><span>должно быть в кошельке игры (пополнения − выплаты)</span></div>
          <div class="tile"><b>${G(t.cash.owe)}</b><span>игра должна игрокам: балансы, заявки на вывод, заморожено в заявках ${G(t.cash.bids)}, лига и казна владык ${G(t.cash.extra)}</span></div>
          <div class="tile"><b style="color:${t.cash.profit < 0 ? 'var(--red)' : 'var(--green, #5fd38a)'}">${G(t.cash.profit)}</b><span>${t.cash.profit < 0 ? '⚠️ МИНУС — проверьте журнал и ручные начисления' : 'доход игры — можно забрать себе'}</span></div>
        </div>
        <small class="muted">Забирайте из кошелька игры не больше «дохода игры»: остальное — деньги игроков. Ручные начисления GRAM из админки уменьшают доход. Самоцветы и Stars сюда не входят.</small></div>` : ''}
      <div class="card"><h3>Заявки на вывод (${o.wait.length})</h3>
        ${o.wait.map((w) => `<div class="row"><span class="grow"><b>${w.prio ? '⭐ ' : ''}${esc(w.name)}</b> · №${w.id} · ${msk(w.at)}<br>
          <b>К выплате: ${G(w.net)} GRAM</b> <small class="muted">(заявка ${G(w.gross)}, комиссия ${G(w.fee)})</small><br>
          <code class="sel">${esc(w.address)}</code> <button class="btn small" data-copy="${esc(w.address)}">Копировать адрес</button></span>
          <button class="btn small primary" data-pay="${w.id}">Выплачено</button><button class="btn small danger" data-rej="${w.id}">Отклонить</button></div>`).join('') || '<p class="muted">Заявок нет</p>'}
      </div>
      <div class="card"><h3>Обработанные</h3><table><tr><th>№</th><th>Игрок</th><th>GRAM</th><th>Статус</th></tr>
        ${o.done.map((w) => `<tr><td>${w.id}</td><td>${esc(w.name)}</td><td>${G(w.net)}</td><td>${w.status === 'paid' ? '✅ выплачено' + (w.tx ? ' · ' + esc(w.tx.slice(0, 12)) + '…' : '') : '↩ отклонено' + (w.reason ? ': ' + esc(w.reason) : '')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">—</td></tr>'}</table></div>
      <div class="card"><h3>Корректировка баланса</h3><small class="muted">Плюс — начислить (как пополнение, вывести нельзя), минус — списать. Например, компенсация или возврат по обращению.</small>
        <div class="row"><input id="gAdjUid" placeholder="uid игрока (tg…)"><input id="gAdjSum" type="number" step="0.01" placeholder="GRAM, напр. 5 или -2"><input id="gAdjText" class="wide" placeholder="Причина"><button class="btn primary" id="gAdjGo">Применить</button></div></div>
      <div class="card"><h3>Журнал GRAM (последние 200)</h3><table><tr><th>Когда (МСК)</th><th>Игрок</th><th>Что</th><th>GRAM</th></tr>
        ${o.log.map((e) => `<tr><td>${msk(e.t)}</td><td>${esc(e.name)}</td><td>${esc(GKIND[e.kind] || e.kind)}<br><small class="muted">${esc(e.text)}</small></td><td style="color:${e.a < 0 ? 'var(--red)' : 'inherit'}">${e.a ? (e.a > 0 ? '+' : '') + G(e.a) : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Пока пусто</td></tr>'}</table></div>`;
    box.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.copy) { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Адрес скопирован'); } catch { prompt('Адрес:', b.dataset.copy); } return; }
      if (b.dataset.pay) { const tx = prompt('Хеш перевода (необязательно):', '') ?? null; if (tx === null) return; const r = await api('gramPay', { id: +b.dataset.pay, tx }); toast(r.error || r.text, !!r.error); drawGram(); }
      if (b.dataset.rej) { const reason = prompt('Причина отказа (игрок увидит):', ''); if (reason === null) return; const r = await api('gramReject', { id: +b.dataset.rej, reason }); toast(r.error || r.text, !!r.error); drawGram(); }
      if (b.id === 'gAdjGo') { const r = await api('gramAdjust', { uid: $('gAdjUid').value.trim(), gram: Number($('gAdjSum').value), text: $('gAdjText').value }); toast(r.error || r.text, !!r.error); if (!r.error) drawGram(); }
    };
  }

  // ---------- Экономика ----------
  const SRC = { kills: 'монстры', autosell: 'авто-продажа', sell: 'продажа вещей', sellMat: 'продажа материалов', buy: 'лавки', refund: 'возврат в лавку',
    quests: 'задания', npc: 'поручения НПС', clan: 'клан', craft: 'кузница', upgrade: 'улучшение', setCraft: 'комплекты', treeUp: 'Зал мастеров: характеристики',
    pasUp: 'Зал мастеров: пассивка', skillUp: 'умения', whUpgrade: 'склад', marketBuy: 'рынок: покупка', marketSell: 'рынок', auctionBid: 'аукцион: ставка',
    itemSpin: 'призыв снаряжения', heroSummon: 'призыв героев', loginClaim: 'награда за вход', passClaim: 'орден', cardClaim: 'карта месяца', cosmeticBuy: 'косметика',
    companionBuy: 'спутники', unsocket: 'извлечь руну', other: 'прочее (боссы, арена, рынок…)' };
  const sum = (o) => Object.values(o || {}).reduce((s, v) => s + v, 0);
  const top = (o, n = 6) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${esc(SRC[k] || k)} <b>${fmtNum(v)}</b>`).join(' · ') || '—';
  async function drawEcon() {
    const o = await api('econ');
    const box = $('tab-econ');
    if (o.error) { box.innerHTML = `<div class="card">${esc(o.error)}</div>`; return; }
    const it = (d, k) => d.items[k] || 0;
    box.innerHTML = `<div class="card"><small class="muted">По дням (МСК). Золото и самоцветы: сколько пришло игрокам и сколько они потратили. «Прочее» — всё, что не отмечено отдельно (боссы, арена, рынок между игроками, админка). Сводка обновляется раз в 10 минут и при открытии вкладки.</small></div>`
      + (o.days.length ? o.days.map((d) => {
        const p = Math.max(1, d.players), gi = sum(d.goldIn), go = sum(d.goldOut);
        return `<div class="card"><h3>${esc(d.day)} · игроков ${d.players} · пик онлайна ${d.peak}</h3>
        <div class="tiles">
          <div class="tile"><b>${fmtNum(gi)} / ${fmtNum(go)}</b><span>💰 пришло / потрачено (на игрока ${fmtNum(Math.round(gi / p))} / ${fmtNum(Math.round(go / p))})</span></div>
          <div class="tile"><b>${fmtNum(sum(d.gemsIn))} / ${fmtNum(sum(d.gemsOut))}</b><span>💎 пришло / потрачено</span></div>
          <div class="tile"><b>${d.stars.n} · ${fmtNum(d.stars.sum)} ⭐</b><span>покупок за Stars</span></div>
          <div class="tile"><b>${d.ton.n} · ${d.ton.sum}</b><span>покупок за TON (GRAM)</span></div>
          ${d.gram ? `<div class="tile"><b>${G(d.gram.deposit)} / ${G(d.gram.withdraw)}</b><span>GRAM: пополнено / заявлено к выводу</span></div><div class="tile"><b>${G(d.gram.shop)} / ${G(d.gram.buy)}</b><span>GRAM: Рынок и внешний вид / оборот Торгового дома</span></div><div class="tile"><b>${G(d.gram.fee)}</b><span>GRAM: комиссии Торгового дома (ваш доход)</span></div>` : ''}
          <div class="tile"><b>${it(d, 'mythic:drop')} / ${it(d, 'legendary:drop')}</b><span>мифик / легенд. вещей с монстров</span></div>
          <div class="tile"><b>${it(d, 'mythic:gearSummon')} / ${it(d, 'legendary:gearSummon')}</b><span>мифик / легенд. из призыва снаряжения</span></div>
          <div class="tile"><b>${it(d, 'mythic:hero')} / ${it(d, 'legendary:hero')}</b><span>мифических / легенд. героев из призыва</span></div>
        </div>
        <p><small class="muted">💰 откуда:</small> ${top(d.goldIn)}</p>
        <p><small class="muted">💰 куда:</small> ${top(d.goldOut)}</p>
        <p><small class="muted">💎 откуда:</small> ${top(d.gemsIn)} · <small class="muted">куда:</small> ${top(d.gemsOut)}</p>
        ${Object.keys(d.buys).length ? `<p><small class="muted">⭐ что покупали:</small> ${Object.entries(d.buys).map(([k, v]) => `${esc(k)} ×${v}`).join(' · ')}</p>` : ''}</div>`;
      }).join('') : '<div class="card"><p class="muted">Данных пока нет — появятся через несколько минут игры</p></div>');
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
        <div class="tile"><b style="color:${o.memLimitMb && o.memMb > o.memLimitMb * 0.8 ? 'var(--red)' : 'inherit'}">${o.memMb}${o.memLimitMb ? ' / ' + fmtNum(o.memLimitMb) : ''} МБ</b><span>память${o.memLimitMb ? ' · лимит тарифа' : ''}${o.memLimitMb && o.memMb > o.memLimitMb * 0.8 ? ' — почти кончилась, пора поднять тариф' : ''}</span></div>
        <div class="tile"><b>${dur(o.uptime)}</b><span>работает</span></div>
        ${o.perf ? `<div class="tile"><b style="color:${o.perf.cpu > 85 || o.perf.lagP99 > 60 ? 'var(--red)' : 'inherit'}">${o.perf.cpu}% · ${o.perf.lagP99} мс</b><span>процессор · задержка цикла</span></div>` : ''}
      </div>
      ${storageCard(o.storage)}
      ${o.settings.maintenance ? '<div class="card"><b style="color:var(--red)">🔧 Включены технические работы — игроки не могут войти</b></div>' : ''}
      <div class="card"><h3>Мировые боссы</h3>
        ${o.worldBosses.map((w) => `<div class="row"><span class="grow"><b>${esc(w.townName)}</b><br><small class="muted">${w.boss ? `👹 ${esc(w.boss.name)} · ${fmtNum(w.boss.hp)} / ${fmtNum(w.boss.maxHp)}` : `появится ${w.nextAt <= Date.now() ? 'сейчас' : 'через ' + Math.ceil((w.nextAt - Date.now()) / 60000) + ' мин'}`}</small></span>
          ${w.boss ? `<button class="btn small danger" data-wb="${w.town}" data-kill="1">Убрать</button>` : `<button class="btn small primary" data-wb="${w.town}">Вызвать сейчас</button>`}</div>`).join('')}
      </div>
      <div class="card"><h3>Боссы данжей</h3><div class="row"><span class="grow"><small class="muted">По расписанию — в 12:00, 18:00 и 23:00 МСК; ворота к боссу открыты, пока он жив, и 10 минут после победы</small></span>
          <button class="btn small primary" data-dgboss="1">Вызвать сейчас</button></div></div>
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
      if (e.target.closest('[data-backup]')) return downloadBackup();
      if (e.target.closest('[data-snaps]')) return openSnaps();
      if (e.target.closest('[data-dgboss]')) { await api('dungeonBosses', {}); setTimeout(drawOverview, 800); }
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
      <div class="main"><b>${esc(p.name || 'без имени')}${p.tg && p.tg.user ? ` <small>@${esc(p.tg.user)}</small>` : ''}</b><small>${esc(p.uid)} · героев ${p.heroes} · макс. ${p.maxLevel} ур. · 💰 ${fmtNum(p.gold)} · ${p.online ? 'в игре' : ago(p.lastSeen)}</small>${p.tg ? `<small>${tgLine(p.tg)}</small>` : ''}</div>
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
        ${p.refs && (p.refs.n || p.refs.by) ? `<div class="card"><h3>👥 Приглашения</h3>
          ${p.refs.by ? `<p class="muted">Сам пришёл по ссылке игрока <b>${esc(p.refs.by)}</b></p>` : ''}
          ${p.refs.n ? `<p>Пригласил: <b>${p.refs.n}</b> · заходили в мир: <b>${p.refs.played}</b> · дошли до 10 ур.: <b>${p.refs.l10}</b> · новые аккаунты Telegram: <b>${p.refs.newIds}</b> · получил 💎 ${p.refs.gems} и ${(p.refs.gram / 1e9).toFixed(2)} GRAM</p>
          ${p.refs.n >= 10 && p.refs.played / p.refs.n < 0.3 ? '<p style="color:var(--red)">⚠️ Большинство приглашённых не заходили в мир — похоже на накрутку (фейковые аккаунты)</p>' : ''}
          <div style="max-height:260px;overflow:auto">${p.refs.list.map((r) => `<div class="row"><small class="grow">${r.gone ? `${esc(r.uid)} — удалён` : `${esc(r.name || '—')}${r.user ? ` · <a href="https://t.me/${esc(r.user)}" target="_blank">@${esc(r.user)}</a>` : ''} · ${esc(r.uid)} · ур. ${r.lvl} · героев ${r.heroes} · ${r.played ? 'играл' : 'не входил в мир'}${r.newId ? ' · 🆕 новый аккаунт' : ''}${r.prem ? ' · ⭐' : ''}${r.plat ? ' · ' + esc(r.plat) : ''}`}</small></div>`).join('')}</div>
          <div class="row"><button class="btn danger" data-a="refRevoke">Снять все приглашения (накрутка)</button></div>` : ''}</div>` : ''}
        ${p.tgInfo ? `<div class="row"><small class="grow">👤 ${esc([p.tgInfo.first, p.tgInfo.last].filter(Boolean).join(' ') || '—')}${p.tgInfo.user ? ` · <a href="https://t.me/${esc(p.tgInfo.user)}" target="_blank">@${esc(p.tgInfo.user)}</a>` : ' · без @username'}<br>${tgLine(p.tgInfo)}</small></div>` : (p.uid.startsWith('tg') ? '<div class="row"><small class="muted grow">Данных Telegram пока нет — появятся, когда игрок снова откроет бота</small></div>' : '')}
        <div class="row"><span class="dot ${s ? 'on' : ''}"></span><b class="grow">${s ? `В игре: ${esc(s.heroName)} ${s.level} ур. · ${esc(s.zoneName)} · ❤️ ${s.hp}/${s.maxHp}` : 'Не в игре · ' + ago(p.lastSeen)}</b>
          ${p.banned ? `<span class="tag red">бан: ${esc(p.banned.reason)}</span>` : ''}</div>
      </div>

      <div class="card"><h3>🧪 Тесты</h3>
        <label class="switch"><input type="checkbox" data-flag="god" ${p.test.god ? 'checked' : ''}> Бессмертие (монстры не наносят урон)</label>
        <label class="switch"><input type="checkbox" data-flag="oneShot" ${p.test.oneShot ? 'checked' : ''}> Убийство монстров с одного удара</label>
        <label class="switch"><input type="checkbox" data-flag="tester" ${p.test.tester ? 'checked' : ''}> Может входить во время техработ</label>
        <label class="switch"><input type="checkbox" data-flag="wdTest" ${p.test.wdTest ? 'checked' : ''}> Тест вывода GRAM: без 30 ур., 7 дней и удержания, весь баланс (после проверки выключить!)</label>
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
        ${p.gram ? `<div class="row"><label>GRAM: <b>${G(p.gram.total)}</b> <small class="muted">(пополнено ${G(p.gram.dep)}, к выводу ${G(p.gram.free)}, удерживается ${G(p.gram.hold)})${p.tOrder ? ' · орден ' + esc(p.tOrder.id) + ' до ' + new Date(p.tOrder.until).toLocaleDateString('ru-RU') : ''}</small> — изменить во вкладке GRAM</label></div>` : ''}
        <div class="row"><label>Самоцветы: <b>${fmtNum(p.gems || 0)}</b></label><input id="gemsVal" type="number" value="1000"><button class="btn" data-a="gemsAdd">Добавить</button><button class="btn" data-a="gemsSet">Установить</button></div>
        <div class="row"><label>Крутки героев</label><input id="spinsVal" type="number" value="${p.paidSpins}"><button class="btn" data-a="spins">Сохранить</button>
          <button class="btn" data-a="freeSpin" ${p.freeSpinUsed ? '' : 'disabled'}>Вернуть бесплатную</button></div>
        <div class="row"><label>Крутки предметов</label><input id="iSpinsVal" type="number" value="${p.itemSpins}"><button class="btn" data-a="itemSpins">Сохранить</button></div>
      </div>
      <div class="card"><h3>⭐ Покупки</h3>${(p.payments || []).length ? p.payments.map((x) => `<div class="row"><small class="grow">${new Date(x.t).toLocaleString('ru')} · ${esc(x.kind)}${x.id ? ' ' + esc(x.id) : ''} · ${x.amount ?? '?'} ${esc(x.cur || '')}${x.refunded ? ' · <b>возврат</b>' : ''}</small>${x.charge && !x.refunded && x.cur === 'XTR' ? `<button class="btn small danger" data-a="refund" data-charge="${esc(x.charge)}" data-amount="${x.amount ?? ''}">↩️ Вернуть Stars</button>` : ''}</div>`).join('') : '<small>Покупок нет</small>'}</div>

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
        <div class="row"><label>Комплект</label><select id="itSet"><option value="">— без комплекта —</option>${opt(M.classes)}</select>
          <button class="btn" data-a="fullSet">Выдать полный комплект</button></div>
        <p class="muted">Если выбран комплект, «Выдать» даёт вещи этого комплекта (слот — из категории).</p>
        <div class="row"><label>Ресурс</label><select id="matId" class="wide">${opt(M.mats)}</select><input id="matN" type="number" value="10" min="1"><button class="btn" data-a="giveMat">Выдать</button></div>
        <div class="row"><button class="btn danger" data-a="clearItems">Удалить все предметы</button></div>
      </div>

      <div class="card"><h3>⭐ Подписка и пропуск</h3>
        <div class="row"><label>Подписка: ${p.subUntil > Date.now() ? 'до ' + new Date(p.subUntil).toLocaleDateString('ru-RU') : 'нет'}</label><input id="subDays" type="number" value="30"><label>дн.</label><button class="btn" data-a="sub">Выдать</button><button class="btn" data-a="subOff">Снять</button></div>
        <div class="row"><label>Орден сезона (уровень пропуска ${p.pass.level})</label><select id="passTier">${['🎖️ Странника (бесплатный)', '🥉 Бронзовый', '🥈 Серебряный', '🥇 Золотой (автобой)', '👑 Чемпиона', '🟢 Купца (торговый)', '🏦 Магната (торговый)'].map((n, i) => `<option value="${i}" ${p.pass.tier === i ? 'selected' : ''}>${n}</option>`).join('')}</select><button class="btn" data-a="passTier">Выдать</button></div>
        <div class="row"><label>Опыт пропуска</label><input id="passXp" type="number" value="100"><button class="btn" data-a="passXp">Добавить</button></div>
        <div class="row"><label>Личная цена ордена${p.passDeal ? ` (сейчас: ${['', 'Бронзовый', 'Серебряный', 'Золотой', 'Чемпиона', 'Купца', 'Магната'][p.passDeal.tier]} — ${p.passDeal.stars} ⭐)` : ''}</label>
          <select id="dealTier">${['🥉 Бронзовый', '🥈 Серебряный', '🥇 Золотой', '👑 Чемпиона', '🟢 Купца', '🏦 Магната'].map((n, i) => `<option value="${i + 1}" ${(p.passDeal ? p.passDeal.tier : 6) === i + 1 ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <input id="dealStars" type="number" min="0" placeholder="⭐" value="${p.passDeal ? p.passDeal.stars : ''}"><button class="btn" data-a="passDeal">Задать</button></div>
        <p class="muted">Разово: игрок увидит эту цену у выбранного ордена в окне орденов и заплатит её звёздами или GRAM (без скидки первой покупки). После оплаты цена сгорает. 0 — снять.</p>
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
        refRevoke: () => { if (confirm('Отвязать всех приглашённых этим игроком? Новые награды за них он не получит, а у приглашённых заберётся неистраченный бонус новичка.')) edit('refRevoke'); },
        teleport: () => edit('teleport', { zone: v('tpZone') }), xp: () => edit('xp', { value: v('xpVal') }),
        goldAdd: () => edit('gold', { value: v('goldVal') }), goldSet: () => edit('gold', { value: v('goldVal'), set: true }),
        gemsAdd: () => edit('gems', { value: v('gemsVal') }), gemsSet: () => edit('gems', { value: v('gemsVal'), set: true }),
        spins: () => edit('spins', { value: v('spinsVal') }), freeSpin: () => edit('freeSpin'), itemSpins: () => edit('itemSpins', { value: v('iSpinsVal') }),
        allHeroes: () => edit('allHeroes'), allLevel: () => edit('level', { value: v('allLvl') }), allDupes: () => edit('dupes', { value: v('allDup') }),
        allSkills: () => edit('skills', { value: 3 }), noSkills: () => edit('skills', { value: 0 }),
        giveItem: () => edit('giveItem', { cat: v('itCat'), rar: v('itRar'), tier: v('itTier'), count: v('itCount'), set: v('itSet') }),
        fullSet: () => edit('fullSet', { set: v('itSet'), rar: v('itRar'), tier: v('itTier') }),
        giveMat: () => edit('giveMat', { mat: v('matId'), count: v('matN') }),
        clearItems: () => confirm('Удалить все предметы игрока?') && edit('clearItems'),
        sub: () => edit('sub', { value: v('subDays') }), subOff: () => edit('sub', { value: 0 }), passXp: () => edit('passXp', { value: v('passXp') }), passTier: () => edit('passTier', { value: v('passTier') }), passDeal: () => edit('passDeal', { tier: v('dealTier'), stars: v('dealStars') }),
        ban: () => confirm('Забанить игрока?') && edit('ban', { reason: v('banReason') }), unban: () => edit('unban'), kick: () => edit('kick'),
        refund: async () => {
          if (!confirm(`Вернуть игроку ${b.dataset.amount || ''} ⭐ за эту покупку? Отменить возврат нельзя.`)) return;
          const r = await api('refund', { uid: cur.uid, charge: b.dataset.charge });
          if (r.player) { cur = r.player; drawPlayer(); }
        },
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
      <div class="card"><h3>🧪 Режим ЗБТ</h3><p class="muted">Включён — перед каждой покупкой (Stars и GRAM, в игре и в лобби) игрок видит предупреждение: идёт ЗБТ, будет вайп, покупки до вайпа вернём. Сохраняется кнопкой «Сохранить настройки» внизу.</p>
        <div class="row"><label><input type="checkbox" id="sZbt" ${s.zbt ? 'checked' : ''}> Предупреждать о ЗБТ перед покупкой</label></div>
        <div class="row"><label><input type="checkbox" id="sBal2" ${s.bal2 ? 'checked' : ''}> <b>Новый баланс</b> (ЗБТ, включён): прокачка по ступеням ~600–800 ч до 50, монстры крепче с 10 ур., опыт группы и клана, автобой ×0,6, добыча и золото реже</label></div></div>
      <div class="card"><h3>📨 Рассылка от бота</h3><p class="muted">Личное сообщение от бота всем игрокам Telegram (кто открывал игру, в том числе по реферальным ссылкам) и всем, кто нажимал /start в боте, — даже не нажимавшим «Напомнить». Кроме отключивших уведомления. Под сообщением — кнопка «⚔️ Играть». Не дойдёт тем, кто не разрешал боту писать (не нажимал /start и снял галочку при входе в игру). Сначала отправьте себе — проверить текст.</p>
        <textarea id="botcastText" class="wide" rows="4" placeholder="⏰ Уже сегодня в 21:00 по Москве — открытие Mystic Horizon! …"></textarea>
        <div class="row"><button class="btn" id="botcastTest">Сначала себе</button><button class="btn primary" id="botcastAll">Разослать всем</button></div>
        ${s.botcastLog ? `<p>Последняя рассылка${s.botcastLog.test ? ' (проба)' : ''}: ${new Date(s.botcastLog.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК — «${esc(s.botcastLog.text)}…»: получателей ${s.botcastLog.n}, доставлено ${s.botcastLog.ok}, не доставлено ${s.botcastLog.fail}</p>` : ''}</div>
      <div class="card"><h3>🏰 Открытие игры</h3>${s.launchLog ? `<p>📨 Сообщение об открытии разослано ${new Date(s.launchLog.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК (открытие на ${new Date(s.launchLog.openAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК): ${s.launchLog.n} игрокам, доставлено ${s.launchLog.ok}, не доставлено ${s.launchLog.fail}</p>` : '<p class="muted">📨 Сообщение об открытии ещё не рассылалось (с этой версии рассылка записывается здесь).</p>'}
        <p class="muted">${s.openAt && s.openAt > Date.now() ? `Открытие: <b>${new Date(s.openAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК</b> — до этого входят только админы и тестеры, в лобби — отсчёт и «Напомнить»` : 'Игра открыта. Задайте дату — в лобби появится отсчёт. Первые 3 дня после открытия каждый новый вход получает подарок основателя.'}</p>
        <div class="row"><input id="sOpen" type="datetime-local" value="${s.openAt ? new Date(s.openAt + 3 * 36e5).toISOString().slice(0, 16) : ''}"><span class="muted">время МОСКОВСКОЕ (МСК)</span><button class="btn" id="sOpenSet">Задать</button><button class="btn danger" id="sOpenNow">Открыть сейчас</button></div>
        <div class="row"><label class="grow">Показывать общий онлайн, когда игроков не меньше</label><input id="sOnMin" type="number" min="0" value="${s.onlineMin ?? 20}"></div>
        <p class="muted">Меньше — в лобби и городе пишется, сколько героев в данжах и у мирового босса (это тоже правда, но звучит живее).</p></div>
      <div class="card"><h3>🔧 Технический перерыв</h3>
        ${s.brk ? `<p>Запланирован: <b>${new Date(s.brk.at).toLocaleString('ru-RU')}</b> на ${s.brk.min} мин</p>` : '<p class="muted">Игроки сразу увидят плашку в игре и получат предупреждения в чат за 60, 30, 15, 5 и 1 минуту; в начале перерыва все, кроме тестеров, выйдут; по окончании вход откроется сам.</p>'}
        <div class="row"><label>В (МСК)</label><input id="sBrkAt" type="time" value="00:00"><label>или через (мин)</label><input id="sBrkIn" type="number" min="1" placeholder="—"><label>длительность (мин)</label><input id="sBrkLen" type="number" min="1" value="30"></div>
        <div class="row"><button class="btn primary" id="sBrkSet">Объявить перерыв</button>${s.brk ? '<button class="btn danger" id="sBrkOff">Отменить</button>' : ''}</div></div>
      <div class="card"><h3>📢 Канал и чат игры</h3><p class="muted">Ссылка вида @имя или t.me/имя. Когда заполнено — в игре (меню «Игра» и лобби) и в боте (/start) появятся кнопки. Пусто — кнопок нет.</p>
        <div class="row"><label>Канал</label><input id="sChannel" class="wide" placeholder="@mystichorizon_game" value="${esc(s.channel || '')}"></div>
        <div class="row"><label>Чат</label><input id="sChat" class="wide" placeholder="@mystichorizon_chat" value="${esc(s.chat || '')}"></div>
        <p class="muted">Особые задания «Подпишитесь на канал» / «Вступите в чат» — награда в самоцветах (0 — задания нет). Чтобы бот проверял подписку,
          добавьте бота администратором канала и участником чата; иначе награда выдаётся через 15 с после перехода — «на честность».</p>
        <div class="row"><label>💎 за канал</label><input id="sSpChannel" type="number" min="0" max="1000" value="${s.spChannel ?? 150}"><label>💎 за чат</label><input id="sSpChat" type="number" min="0" max="1000" value="${s.spChat ?? 50}"></div></div>
      <div class="card"><h3>⭐ Особые задания партнёров</h3><p class="muted">Блогеры, каналы, игры — задание в «Квестах» → «Особые», один раз на аккаунт. По одному на строку:
        <b>Название | описание | ссылка | самоцветы</b> (описание можно пропустить: «Название | ссылка | самоцветы»). До 10, награда 1–500 💎.
        Подписку бот проверит, только если он администратор того канала; иначе — через 15 с после перехода.</p>
        <textarea id="sSpecial" class="wide" rows="4" placeholder="Канал Игровые новости | Обзоры Telegram-игр | @gamenews | 30">${esc((s.special || []).map((x) => [x.name, x.desc, x.url, x.gems].filter((v) => v !== '' && v != null).join(' | ')).join('\n'))}</textarea></div>
      <div class="card"><h3>🤝 Партнёры</h3><p class="muted">Каналы и игры партнёров — в игре: меню «Игра» → «Партнёры» и кнопка в лобби. По одному на строку:
        <b>Название | описание | ссылка</b> (ссылка: @имя, t.me/… или https://…). Описание можно пропустить: «Название | ссылка». Пусто — раздела нет.</p>
        <textarea id="sPartners" class="wide" rows="5" placeholder="Канал Игровые новости | Обзоры Telegram-игр | @gamenews">${esc((s.partners || []).map((x) => [x.name, x.desc, x.url].filter(Boolean).join(' | ')).join('\n'))}</textarea></div>
      <div class="card"><h3>💬 Сообщение при входе</h3>
        <div class="row"><input id="sMotd" class="wide" placeholder="Показывается каждому игроку при входе в мир" value="${esc(s.motd)}"></div></div>
      <div class="card"><h3>🧹 Обнуление перед стартом</h3>
        <p class="muted">Удаляет всех игроков, кроме указанных: прогресс, предметы, лоты Торгового дома, кланы. <b>GRAM не трогает</b>: балансы, заявки на вывод и журнал сохраняются, замороженное в заявках на покупку возвращается на балансы, казна владык раздаётся участникам; право на вывод (30 ур., 7 дней) сохраняется. Перед удалением автоматически сохраняется снимок базы (Обзор → Снимки), из него можно восстановить. Игроки начнут заново при следующем входе.</p>
        <div class="row"><label>Оставить</label><input id="sWipeKeep" class="wide" placeholder="tg80769030 (через запятую)"></div>
        <div class="row"><button class="btn danger" id="sWipe">Обнулить всех, кроме указанных</button></div></div>
      <div class="row"><button id="sSave" class="btn primary">Сохранить настройки</button><button id="sDisk" class="btn">Записать данные игроков на диск</button></div>`;
    $('sSave').onclick = async () => {
      if ($('sMaint').checked && !s.maintenance && !confirm('Включить техработы? Все игроки, кроме тестеров, будут отключены.')) return;
      await api('settings', { set: { xpMult: $('sXp').value, goldMult: $('sGold').value, dropMult: $('sDrop').value, freeSpins: $('sFree').checked, maintenance: $('sMaint').checked, motd: $('sMotd').value, channel: $('sChannel').value, chat: $('sChat').value, partners: $('sPartners').value, zbt: $('sZbt').checked, bal2: $('sBal2').checked, spChannel: $('sSpChannel').value, spChat: $('sSpChat').value, special: $('sSpecial').value } });
      drawSettings();
    };
    $('sDisk').onclick = () => api('save');
    $('sWipe').onclick = async () => {
      const keep = $('sWipeKeep').value.split(/[\s,]+/).filter(Boolean);
      if (!keep.length) return toast('Укажите, кого оставить (например tg80769030)', true);
      const word = prompt(`Будут удалены ВСЕ игроки, кроме: ${keep.join(', ')}.\nДля подтверждения введите слово ОБНУЛИТЬ`);
      if (word === null) return;
      const r = await api('wipeAll', { keep, confirm: word.trim() });
      toast(r.error || r.text, !!r.error);
    };
    $('botcastTest').onclick = async () => { const t = $('botcastText').value.trim(); if (!t) return toast('Напишите текст', true); await api('botcast', { text: t, test: true }); };
    $('botcastAll').onclick = async () => { const t = $('botcastText').value.trim(); if (!t) return toast('Напишите текст', true); if (!confirm('Разослать это сообщение ВСЕМ игрокам от бота? Отменить будет нельзя.')) return; await api('botcast', { text: t }); setTimeout(drawSettings, 3000); };
    $('sOpenSet').onclick = async () => { const v = $('sOpen').value; if (!v) return toast('Выберите дату и время', true); const t = Date.parse(v + ':00+03:00'); if (!t) return toast('Неверная дата', true); if (!confirm(`Открытие: ${new Date(t).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} по Москве. Верно?`)) return; await api('settings', { set: { openAt: t } }); drawSettings(); };
    $('sOpenNow').onclick = async () => { if (!confirm('Открыть игру сейчас для всех?')) return; await api('settings', { set: { openAt: Date.now() } }); drawSettings(); };
    $('sOnMin').onchange = () => api('settings', { set: { onlineMin: $('sOnMin').value } });
    $('sBrkSet').onclick = async () => {
      // Время МСК (ближайшее такое: «00:00» вечером — это ближайшая полночь) или «через N минут», если заполнено
      const len = Number($('sBrkLen').value) || 30, inMin = Number($('sBrkIn').value) || 0;
      let at;
      if (inMin > 0) at = Date.now() + inMin * 60000;
      else {
        const [h, mi] = String($('sBrkAt').value || '').split(':').map(Number);
        if (!(h >= 0) || !(mi >= 0)) return toast('Укажите время или минуты', true);
        const msk = new Date(Date.now() + 3 * 36e5); at = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate(), h, mi) - 3 * 36e5;
        if (at <= Date.now()) at += 864e5;
      }
      const when = new Date(at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
      if (!confirm(`Перерыв ${when} МСК на ${len} мин? Игроки сразу увидят плашку, в чате — предупреждения за 60, 30, 15, 5 и 1 минуту.`)) return;
      await api('settings', { set: { brk: { at, min: len } } }); drawSettings();
    };
    if ($('sBrkOff')) $('sBrkOff').onclick = async () => { await api('settings', { set: { brk: null } }); drawSettings(); };
  }

  // ---------- Журнал ----------
  async function drawLog() {
    const r = await api('log');
    if (r.error) return;
    const KIND = { admin: '⚙️', join: '➡️', pay: '⭐' };
    const errs = r.errors || [];
    $('tab-log').innerHTML = `<div class="row"><button id="logRe" class="btn small">Обновить</button><span class="muted">Действия админов, входы игроков и оплаты с момента запуска сервера</span></div>
      <h3>⚠️ Ошибки сервера (${errs.length})</h3>
      ${errs.map((l) => `<details class="log-line err"><summary><time>${new Date(l.t).toLocaleString('ru-RU')}</time>${l.n > 1 ? `×${l.n} ` : ''}${esc(l.text.split('\n')[0].slice(0, 160))}</summary><pre>${esc(l.text)}</pre></details>`).join('') || '<p class="muted">Ошибок нет 👍</p>'}
      <h3>Журнал</h3>
      ${r.log.map((l) => `<div class="log-line"><time>${new Date(l.t).toLocaleString('ru-RU')}</time>${KIND[l.kind] || ''} ${esc(l.text)}</div>`).join('') || '<p class="muted">Пока пусто</p>'}`;
    $('logRe').onclick = drawLog;
  }

  if (key || tg) enter(); else showLogin();
})();
