// Покупки: Telegram Stars или TON (если на сервере задан TON_WALLET).
// Pay.buy(item, { bgId, onPaid, toast }) — окно выбора способа оплаты, затем счёт Stars или перевод TON из кошелька.
// TON: кошелёк подключается через TON Connect, сервер находит перевод по комментарию и сам выдаёт покупку.
window.Pay = (() => {
  let info = null, tc = null;
  const api = (url, body) => window.Lobby.api(url, body);
  const tg = () => window.Telegram && Telegram.WebApp;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function tonInfo() {
    if (info) return info;
    try { info = await (await fetch('/api/ton/info')).json(); } catch { info = { enabled: false }; }
    return info;
  }

  // ---------- Telegram Stars ----------
  async function payStars(item, bgId, onPaid, toast) {
    const { ok, data } = await api('/api/invoice', { item, bgId });
    if (!ok) return toast(data.error || 'Оплата недоступна');
    if (data.devPaid) { toast('Покупка зачислена (тестовый режим)'); if (onPaid) onPaid(); return; }
    const w = tg();
    if (!w || !w.openInvoice) return toast('Покупки за Stars доступны в Telegram');
    w.openInvoice(data.link, (status) => { if (status === 'paid') { toast('Оплата получена!'); if (onPaid) setTimeout(onPaid, 1200); } });
  }

  // ---------- TON ----------
  function loadTonConnect() {
    if (window.TON_CONNECT_UI) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = '/vendor/tonconnect-ui.min.js';
      s.onload = res; s.onerror = () => rej(new Error('Не удалось загрузить TON Connect'));
      document.head.append(s);
    });
  }
  async function tonConnect() {
    await loadTonConnect();
    if (!tc) {
      const ret = (await tonInfo()).returnUrl; // куда кошелёк вернёт игрока после подтверждения (ссылка на мини-приложение)
      tc = new TON_CONNECT_UI.TonConnectUI({
        manifestUrl: `${location.origin}/tonconnect-manifest.json`,
        language: window.I18N && I18N.lang === 'ru' ? 'ru' : 'en', // TON Connect знает только ru и en
        ...(ret ? { actionsConfiguration: { twaReturnUrl: ret } } : {}),
      });
      await tc.connectionRestored;
    }
    if (tc.connected) return tc;
    // Нет кошелька — показываем окно выбора кошелька и ждём подключения или закрытия
    const ok = await new Promise((res) => {
      let un2 = null;
      const un1 = tc.onStatusChange((w) => { if (w) { un1(); if (un2) un2(); res(true); } });
      if (tc.onModalStateChange) un2 = tc.onModalStateChange((st) => { if (st.status === 'closed' && !tc.connected) { un1(); un2(); res(false); } });
      tc.openModal();
    });
    return ok ? tc : null;
  }
  async function payTon(item, bgId, onPaid, toast) {
    let ui;
    try { ui = await tonConnect(); } catch (e) { return toast(e.message); }
    if (!ui) return toast('Кошелёк не подключён');
    const { ok, data } = await api('/api/ton/order', { item, bgId });
    if (!ok) return toast(data.error || 'Оплата в TON недоступна');
    try {
      await ui.sendTransaction({ validUntil: Math.floor(Date.now() / 1000) + 600, messages: [{ address: data.address, amount: data.amount, payload: data.payload }] });
    } catch { return toast('Оплата отменена'); }
    toast('Платёж отправлен — ждём подтверждение сети (обычно до минуты)…');
    for (let i = 0; i < 45; i++) { // до 3 минут
      await sleep(4000);
      const r = await api('/api/ton/status', { id: data.id });
      const st = r.data && r.data.status;
      if (st === 'paid') { toast(`Оплата ${data.ton} TON получена!`); if (onPaid) onPaid(); return; }
      if (st === 'underpaid') return toast('Пришло меньше нужной суммы — напишите в поддержку');
      if (st === 'error') return toast('Платёж получен, но покупка не зачислена — напишите в поддержку');
    }
    toast('Сеть ещё не подтвердила платёж — покупка придёт сама, как только он пройдёт');
  }

  // ---------- Выбор способа оплаты ----------
  function choose(title, stars, ton) {
    return new Promise((res) => {
      const m = document.createElement('div');
      m.className = 'pay-modal';
      m.innerHTML = `<div class="pay-box"><b class="pay-title"></b><small>Выберите способ оплаты</small>
        <button class="l2-btn pay-opt" data-m="stars">⭐ Telegram Stars · ${stars}</button>
        <button class="l2-btn pay-opt ton" data-m="ton">💎 TON · ${ton}</button>
        <button class="pay-cancel" data-m="">Отмена</button></div>`;
      m.querySelector('.pay-title').textContent = title;
      m.onclick = (e) => {
        const b = e.target.closest('[data-m]');
        if (!b && e.target !== m) return;
        m.remove();
        res(b ? b.dataset.m : '');
      };
      document.body.append(m);
    });
  }

  async function buy(item, { bgId, onPaid, toast = (t) => (window.Town ? Town.toast(t) : alert(t)) } = {}) {
    const ti = await tonInfo();
    if (!ti.enabled) return payStars(item, bgId, onPaid, toast);
    const q = await api('/api/ton/quote', { item, bgId });
    if (!q.ok) return payStars(item, bgId, onPaid, toast); // TON для этого товара недоступен — обычная оплата
    const how = await choose(q.data.title, q.data.stars, q.data.ton);
    if (how === 'stars') return payStars(item, bgId, onPaid, toast);
    if (how === 'ton') return payTon(item, bgId, onPaid, toast);
  }

  return { buy, tonInfo };
})();
