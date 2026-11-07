// Оплата в TON (дополнительно к Telegram Stars).
//
// Как работает:
//   1. Игрок выбирает «Оплатить TON» → сервер создаёт заказ с уникальным комментарием (MH-xxxx) и ценой в TON.
//   2. Кошелёк игрока (TON Connect) отправляет перевод на TON_WALLET с этим комментарием.
//   3. Сервер раз в 15 с (и по запросу клиента) читает входящие переводы кошелька через TonCenter API,
//      находит перевод по комментарию, проверяет сумму и выдаёт покупку тем же путём, что и Stars (onPaid).
//
// Переменные окружения:
//   TON_WALLET          — ваш адрес кошелька для приёма оплаты (без него оплата в TON выключена)
//   TON_PER_STAR        — курс: сколько TON стоит 1 ⭐ (по умолчанию 0.004); цена в TON = цена в Stars × курс
//   TONCENTER_API_KEY   — ключ TonCenter (необязательно; без ключа — не чаще 1 запроса в секунду)
//   TON_TESTNET=true    — тестовая сеть (testnet.toncenter.com) для проверки без настоящих денег
//   TON_TWA_RETURN_URL  — ссылка на мини-приложение (https://t.me/<бот>/<app>), куда кошелёк вернёт игрока
//   TON_DISABLED=true   — быстро выключить оплату в TON, не удаляя адрес
const crypto = require('crypto');
const { Address, beginCell } = require('@ton/core');

module.exports = function createTon({ store, onPaid, log }) {
  const TESTNET = process.env.TON_TESTNET === 'true';
  const API = TESTNET ? 'https://testnet.toncenter.com/api/v2' : 'https://toncenter.com/api/v2';
  const KEY = process.env.TONCENTER_API_KEY || '';
  const RATE = Number(process.env.TON_PER_STAR) || 0.004;
  const ORDER_TTL = 2 * 3600e3; // заказ ждёт оплату 2 часа
  let wallet = null;
  try { if (process.env.TON_WALLET) wallet = Address.parse(process.env.TON_WALLET.trim()); } catch (e) { console.error('[ton] неверный TON_WALLET:', e.message); }
  const enabled = () => !!wallet && process.env.TON_DISABLED !== 'true';
  const walletStr = () => wallet.toString({ bounceable: false, testOnly: TESTNET });

  const state = store.readJSON('ton.json', { orders: {}, seen: [] });
  const seen = new Set(state.seen);
  const save = () => {
    state.seen = [...seen].slice(-3000); // хеши уже обработанных переводов — чтобы не выдать покупку дважды
    try { store.writeJSON('ton.json', state); } catch (e) { console.error('[ton] сохранение', e.message); }
  };

  // Цена в TON: из цены в Stars по курсу, вверх до сотых, не меньше 0.05 TON
  const tonPrice = (stars) => Math.max(0.05, Math.ceil(stars * RATE * 100) / 100);
  const toNano = (ton) => (BigInt(Math.round(ton * 100)) * 10000000n).toString();

  function createOrder(uid, payload, stars, title) {
    const id = crypto.randomBytes(4).toString('hex');
    const comment = `MH-${id}`;
    const ton = tonPrice(stars);
    state.orders[id] = { id, uid, payload, title, stars, ton, nano: toNano(ton), comment, at: Date.now(), status: 'wait' };
    // старые неоплаченные заказы — убираем
    for (const [k, o] of Object.entries(state.orders)) if (Date.now() - o.at > 7 * 86400e3) delete state.orders[k];
    save();
    const body = beginCell().storeUint(0, 32).storeStringTail(comment).endCell().toBoc().toString('base64'); // текстовый комментарий
    return { id, address: walletStr(), amount: state.orders[id].nano, payload: body, ton, comment, title };
  }

  // Входящий перевод → заказ. Возвращает, что сделали (для журнала и тестов)
  function applyTx(tx) {
    const hash = tx.transaction_id && tx.transaction_id.hash, m = tx.in_msg;
    if (!hash || seen.has(hash) || !m || !m.source) return null;
    seen.add(hash);
    const text = String(m.message || '').trim();
    const o = Object.values(state.orders).find((x) => x.comment === text);
    if (!o || o.status === 'paid') return null;
    const value = BigInt(m.value || '0');
    if (value < BigInt(o.nano)) {
      o.status = 'underpaid'; o.got = value.toString();
      log('pay', `TON: недоплата по заказу ${o.id} (${o.payload}): ${Number(value) / 1e9} из ${o.ton} GRAM`);
      return 'underpaid';
    }
    o.status = 'paid'; o.paidAt = Date.now(); o.tx = hash; o.from = m.source;
    const ok = onPaid(o.payload);
    log('pay', `TON: оплата ${o.ton} GRAM · ${o.payload}${ok ? '' : ' — НЕ ЗАЧИСЛЕНО (неизвестный товар)'}`);
    return ok ? 'paid' : 'error';
  }

  let polling = false, lastPoll = 0;
  async function poll() {
    if (!enabled() || polling || Date.now() - lastPoll < 3000) return;
    if (!Object.values(state.orders).some((o) => o.status === 'wait' && Date.now() - o.at < ORDER_TTL)) return; // ждать нечего
    polling = true; lastPoll = Date.now();
    try {
      const url = `${API}/getTransactions?address=${encodeURIComponent(walletStr())}&limit=50&archival=true${KEY ? `&api_key=${KEY}` : ''}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || r.status);
      const before = seen.size;
      for (const tx of j.result || []) applyTx(tx);
      if (seen.size !== before) save();
    } catch (e) { console.error('[ton] проверка платежей:', e.message); }
    polling = false;
  }
  setInterval(poll, 15000).unref();

  const status = (id, uid) => {
    const o = state.orders[id];
    if (!o || o.uid !== uid) return { error: 'Заказ не найден' };
    if (o.status === 'wait' && Date.now() - o.at > ORDER_TTL) o.status = 'expired';
    return { status: o.status, ton: o.ton, title: o.title };
  };

  return {
    enabled, tonPrice, createOrder, poll, status, applyTx,
    info: () => ({ enabled: enabled(), testnet: TESTNET, rate: RATE, returnUrl: process.env.TON_TWA_RETURN_URL || null }),
    orders: () => Object.values(state.orders),
  };
};
