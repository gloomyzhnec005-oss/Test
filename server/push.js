// Уведомления в Telegram от бота игры: только игрокам из Telegram, которые сейчас НЕ в игре.
// Каждый вид — со своей паузой (не чаще), плюс общий предел в сутки; отправка очередью не быстрее ~15 сообщений в секунду
// (ограничение Telegram — 30/с). Отключить: Настройки → «Уведомления в Telegram» или команда боту /notify.
const KINDS = {
  boss: 2 * 3600e3, // боссы данжей скоро появятся (3 раза в день)
  wb: 10 * 3600e3, // мировой босс появился (не чаще раза в 10 ч)
  login: 20 * 3600e3, // не прервите серию входов
  notify: 5 * 60e3, // личное: лот продан, исключили из клана и т. п.
  clan: 6 * 3600e3, // клановое задание выполнено
};
const DAY_MAX = 6, ACTIVE_DAYS = 14;
const translate = require('./tr');

module.exports = function createPush({ getBot, profiles, isOnline, webAppUrl, save }) {
  const queue = [];
  const day = () => new Date(Date.now() + 3 * 36e5).toISOString().slice(0, 10);
  function can(uid, kind) {
    if (!uid.startsWith('tg') || isOnline(uid)) return false;
    const pr = profiles()[uid];
    if (!pr || pr.notifyOff || pr.pushBlocked) return false;
    const P = (pr.push ??= { at: {}, day: '', n: 0 });
    if (P.day !== day()) { P.day = day(); P.n = 0; }
    if (P.n >= DAY_MAX || Date.now() - (P.at[kind] || 0) < KINDS[kind]) return false;
    return true;
  }
  function send(uid, kind, text) {
    if (!getBot() || !can(uid, kind)) return false;
    const pr = profiles()[uid], P = pr.push;
    P.at[kind] = Date.now(); P.n += 1;
    queue.push({ uid, text: translate(pr.lang, text), btn: translate(pr.lang, '⚔️ Играть') }); // на языке, который игрок выбрал в игре
    return true;
  }
  // Всем, кто играл за последние 2 недели (filter(pr) — например, по уровню героя)
  function sendAll(kind, text, filter = () => true) {
    const since = Date.now() - ACTIVE_DAYS * 864e5;
    let n = 0;
    for (const [uid, pr] of Object.entries(profiles())) if ((pr.lastSeen || 0) > since && filter(pr) && send(uid, kind, text)) n++;
    return n;
  }
  setInterval(() => {
    const bot = getBot();
    if (!bot) { queue.length = 0; return; }
    for (const m of queue.splice(0, 15)) {
      const url = webAppUrl();
      bot.telegram.sendMessage(m.uid.slice(2), m.text, url ? { reply_markup: { inline_keyboard: [[{ text: m.btn || '⚔️ Играть', web_app: { url } }]] } } : {})
        .catch((e) => {
          // Бот заблокирован или чат удалён — больше не пишем этому игроку
          if (e && (e.code === 403 || /blocked|deactivated|chat not found/i.test(e.message || ''))) { const pr = profiles()[m.uid]; if (pr) { pr.pushBlocked = true; save(); } }
          else console.error('push', e && e.message);
        });
    }
  }, 1000);
  return { send, sendAll, KINDS };
};
