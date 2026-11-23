// Особые задания: подписаться на канал игры, вступить в чат, заглянуть к партнёрам/блогерам → самоцветы, один раз на аккаунт.
// Канал и чат — из админки (Настройки → «Канал и чат игры», награда — там же). Партнёрские задания — строки
// «Название | описание | ссылка | самоцветы» (Настройки → «Особые задания»).
// Проверка: если ссылка — публичный t.me/имя, бот спрашивает Telegram (getChatMember), подписан ли игрок.
// Для каналов это работает, когда бот — администратор канала; для чатов — когда бот в чате. Если Telegram ответить
// не может (бот не админ, ссылка-приглашение), награда выдаётся через 15 с после перехода по ссылке — «на честность».
// Только для аккаунтов Telegram (у гостей подписку не проверить).
const crypto = require('crypto');

module.exports = ({ S, getProfile, botToken, save }) => {
  const HONOR_MS = 15e3;
  const pid = (url) => 'p_' + crypto.createHash('md5').update(url).digest('hex').slice(0, 8);
  function list() {
    const out = [];
    if (S.channel && S.spChannel > 0) out.push({ id: 'channel', icon: '📢', name: 'Подпишитесь на канал игры', desc: 'Новости, мировые боссы, подарки — не пропустите', url: S.channel, gems: S.spChannel });
    if (S.chat && S.spChat > 0) out.push({ id: 'chat', icon: '💬', name: 'Вступите в чат игроков', desc: 'Советы, поиск группы, общение', url: S.chat, gems: S.spChat });
    for (const x of S.special || []) out.push({ id: pid(x.url), icon: '⭐', name: x.name, desc: x.desc || '', url: x.url, gems: x.gems });
    return out;
  }
  const state = (pr) => (pr.special ??= {});
  const tgId = (uid) => (/^tg\d+$/.test(uid) ? uid.slice(2) : null);
  const handle = (url) => { const m = /^https:\/\/t\.me\/([A-Za-z0-9_]{4,64})\/?$/.exec(url || ''); return m ? '@' + m[1] : null; };
  // true — подписан, false — нет, null — Telegram проверить не может
  async function member(url, id) {
    const chat = handle(url);
    if (!chat || !botToken) return null;
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(chat)}&user_id=${id}`, { signal: ctl.signal });
      clearTimeout(tm);
      const j = await r.json();
      if (!j.ok) return null; // бот не админ канала / не в чате — проверить нельзя
      const st = j.result && j.result.status;
      return st === 'creator' || st === 'administrator' || st === 'member' || (st === 'restricted' && !!j.result.is_member);
    } catch { return null; }
  }
  function view(pr) {
    const s = state(pr);
    return list().map((t) => ({ id: t.id, icon: t.icon, name: t.name, desc: t.desc, url: t.url, gems: t.gems, done: !!(s[t.id] && s[t.id].done), went: !!(s[t.id] && s[t.id].go) }));
  }
  const pending = (pr) => view(pr).filter((t) => !t.done).length;
  async function act(p, d) {
    const pr = getProfile(p.uid), s = state(pr), id = String((d && d.id) || '');
    if (d.op === 'spList') return { special: view(pr) };
    const t = list().find((x) => x.id === id);
    if (!t) return { error: 'Задание не найдено' };
    if (s[id] && s[id].done) return { error: 'Награда уже получена', special: view(pr) };
    if (d.op === 'spGo') { s[id] = { ...(s[id] || {}), go: Date.now() }; save(); return { special: view(pr) }; }
    if (d.op !== 'spClaim') return { error: 'Неизвестное действие' };
    const tid = tgId(p.uid);
    if (!tid) return { error: 'Особые задания доступны в игре через Telegram' };
    if (!s[id] || !s[id].go) return { error: 'Сначала перейдите по ссылке' };
    const ok = await member(t.url, tid);
    if (ok === false) return { error: t.id === 'chat' ? 'Вы ещё не в чате — вступите и нажмите снова' : 'Подписка не найдена — подпишитесь и нажмите снова', special: view(pr) };
    if (ok === null && Date.now() - s[id].go < HONOR_MS) return { error: 'Загляните по ссылке и вернитесь через несколько секунд', special: view(pr) };
    if (s[id].done) return { error: 'Награда уже получена', special: view(pr) }; // двойное нажатие во время проверки
    s[id].done = Date.now();
    pr.gems = (pr.gems || 0) + t.gems;
    save();
    return { toast: `🎁 +${t.gems} 💎 — спасибо!`, special: view(pr), gems: pr.gems };
  }
  return { act, view, pending, list };
};
