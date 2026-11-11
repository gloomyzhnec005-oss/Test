// Telegram-бот: открывает игру как Mini App и принимает оплату в Telegram Stars.
// Запускается из server/index.js: require('../bot/bot')({ onPaid, isValidPayload })
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

module.exports = function startBot({ onPaid, isValidPayload, onNotify, profiles, save } = {}) {
  const { BOT_TOKEN, WEBAPP_URL } = process.env;
  if (!BOT_TOKEN || !WEBAPP_URL) {
    console.error('Укажите BOT_TOKEN и WEBAPP_URL (https) в .env');
    return null;
  }
  const bot = new Telegraf(BOT_TOKEN);
  const playButton = () => Markup.inlineKeyboard([Markup.button.webApp('⚔️ Играть', WEBAPP_URL)]);

  bot.start((ctx) =>
    ctx.reply(
      `Добро пожаловать в мир «Mystic Horizon»!\n\n` +
      `Призывай героев, проходи данжи, побеждай боссов и сражайся на арене вместе с другими игроками.\n` +
      `Нажми «⚔️ Играть», чтобы начать.`,
      playButton(),
    ));
  bot.command('play', (ctx) => ctx.reply('Открыть игру:', playButton()));
  // Админ-панель: только для Telegram ID из ADMIN_TG_IDS, вход без пароля
  const admins = String(process.env.ADMIN_TG_IDS || '').split(/[\s,]+/).filter(Boolean);
  bot.command('admin', (ctx) => {
    if (!admins.includes(String(ctx.from.id))) return ctx.reply(`Нет доступа. Ваш Telegram ID: ${ctx.from.id}`);
    return ctx.reply('Админ-панель:', Markup.inlineKeyboard([Markup.button.webApp('⚙️ Открыть админку', WEBAPP_URL.replace(/\/$/, '') + '/admin.html')]));
  });
  const ru = (ctx) => /^(ru|uk|be|kk)/.test((ctx.from && ctx.from.language_code) || 'ru');
  const site = WEBAPP_URL.replace(/\/$/, '');
  bot.help((ctx) => ctx.reply(ru(ctx)
    ? '/play — открыть игру\n/notify — включить или выключить уведомления (боссы, продажи, клан)\n/paysupport — помощь с покупками\n/terms — правила и конфиденциальность\nДжойстик слева — движение, кнопка справа — атака.'
    : '/play — open the game\n/notify — turn notifications on/off\n/paysupport — help with purchases\n/terms — terms and privacy\nJoystick on the left — move, button on the right — attack.'));

  // Правила и политика конфиденциальности (страница terms.html в игре) — Telegram требует их для оплаты в Stars
  const terms = (ctx, anchor = '') => ctx.reply(ru(ctx) ? 'Пользовательское соглашение и политика конфиденциальности:' : 'Terms of Service and Privacy Policy:',
    Markup.inlineKeyboard([Markup.button.url(ru(ctx) ? '📄 Открыть' : '📄 Open', `${site}/terms.html${ru(ctx) ? '' : '?lang=en'}${anchor}`)]));
  bot.command('terms', (ctx) => terms(ctx));
  bot.command('privacy', (ctx) => terms(ctx, '#privacy'));

  // Поддержка по покупкам: /paysupport → следующее сообщение игрока уходит администраторам (ADMIN_TG_IDS),
  // админ отвечает командой /reply <id> <текст>, возврат Stars — /refund <id> <charge_id>
  const waiting = new Map(); // tg id → до какого времени ждём текст обращения
  const purchases = (id) => {
    const pr = profiles && profiles()['tg' + id];
    const list = (pr && pr.payments) || [];
    return list.length ? list.slice(-5).map((x) => `• ${new Date(x.t).toISOString().slice(0, 16).replace('T', ' ')} ${x.kind}${x.id ? ' ' + x.id : ''} · ${x.amount ?? '?'} ${x.cur || ''}${x.refunded ? ' · ВОЗВРАТ' : ''}${x.charge ? '\n  charge: ' + x.charge : ''}`).join('\n') : 'покупок в Stars нет';
  };
  bot.command(['paysupport', 'support'], (ctx) => {
    if (!admins.length) return ctx.reply(ru(ctx) ? 'Поддержка временно недоступна, попробуйте позже.' : 'Support is temporarily unavailable, please try later.');
    waiting.set(ctx.from.id, Date.now() + 15 * 60e3);
    return ctx.reply(ru(ctx)
      ? '🆘 Поддержка по покупкам\n\nОпишите проблему одним сообщением: что покупали, когда и что пошло не так. Сообщение получит администратор, ответ придёт сюда же.\n\nВозврат Stars возможен, если покупка не пришла в игру из-за ошибки.'
      : '🆘 Purchase support\n\nDescribe the problem in one message: what you bought, when, and what went wrong. An administrator will reply here.\n\nStars can be refunded if a purchase did not arrive in the game due to an error.');
  });
  const isAdmin = (ctx) => admins.includes(String(ctx.from.id));
  bot.command('reply', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const m = ctx.message.text.match(/^\/reply(?:@\w+)?\s+(\d+)\s+([\s\S]+)/);
    if (!m) return ctx.reply('Формат: /reply <id игрока> <текст ответа>');
    try { await bot.telegram.sendMessage(m[1], `💬 Поддержка Mystic Horizon:\n\n${m[2]}`); return ctx.reply('✅ Ответ отправлен'); } catch (e) { return ctx.reply('Не удалось отправить: ' + e.message); }
  });
  bot.command('refund', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const m = ctx.message.text.match(/^\/refund(?:@\w+)?\s+(\d+)\s+(\S+)/);
    if (!m) return ctx.reply('Формат: /refund <id игрока> <charge_id>\n(charge_id — в сообщении обращения или в админке)');
    try {
      await bot.telegram.callApi('refundStarPayment', { user_id: Number(m[1]), telegram_payment_charge_id: m[2] });
      const pr = profiles && profiles()['tg' + m[1]], pay = pr && (pr.payments || []).find((x) => x.charge === m[2]);
      if (pay) { pay.refunded = Date.now(); if (save) save(); }
      bot.telegram.sendMessage(m[1], '💫 Stars за покупку возвращены. / Your Stars have been refunded.').catch(() => {});
      return ctx.reply('✅ Stars возвращены. Если товар уже пришёл в игру — заберите его в админке.');
    } catch (e) { return ctx.reply('Возврат не прошёл: ' + e.message); }
  });
  bot.command('payments', (ctx) => {
    if (!isAdmin(ctx)) return;
    const id = (ctx.message.text.match(/\s(\d+)/) || [])[1];
    return ctx.reply(id ? `Покупки ${id}:\n${purchases(id)}` : 'Формат: /payments <id игрока>');
  });
  // Текст после /paysupport — администраторам
  bot.on('text', (ctx, next) => {
    const until = waiting.get(ctx.from.id);
    if (!until || until < Date.now() || ctx.message.text.startsWith('/')) return next();
    waiting.delete(ctx.from.id);
    const u = ctx.from, name = [u.first_name, u.last_name].filter(Boolean).join(' ');
    const pr = profiles && profiles()['tg' + u.id];
    const msg = `🆘 Обращение в поддержку\nОт: ${name}${u.username ? ' @' + u.username : ''} (id ${u.id})${pr && pr.name ? ' · герой ' + pr.name : ''}\n\n${ctx.message.text.slice(0, 3000)}\n\nПоследние покупки:\n${purchases(u.id)}\n\nОтветить: /reply ${u.id} текст`;
    for (const a of admins) bot.telegram.sendMessage(a, msg).catch((e) => console.error('support →', a, e.message));
    return ctx.reply(ru(ctx) ? '✅ Сообщение передано администратору. Ответ придёт в этот чат.' : '✅ Your message has been sent. You will get a reply in this chat.');
  });
  // Уведомления игры: включить/выключить
  bot.command('notify', (ctx) => {
    const on = onNotify ? onNotify(String(ctx.from.id)) : null;
    if (on === null) return ctx.reply('Сначала зайдите в игру — уведомления настраиваются для вашего героя.', playButton());
    return ctx.reply(on ? '🔔 Уведомления включены: боссы, продажи на рынке, клан, серия входов. Выключить — снова /notify.' : '🔕 Уведомления выключены. Включить — снова /notify.');
  });

  // Оплата в Telegram Stars
  bot.on('pre_checkout_query', (ctx) => {
    const ok = !isValidPayload || isValidPayload(ctx.preCheckoutQuery.invoice_payload);
    return ctx.answerPreCheckoutQuery(ok, ok ? undefined : 'Товар недоступен');
  });
  bot.on('successful_payment', (ctx) => {
    const sp = ctx.message.successful_payment, payload = sp.invoice_payload;
    if (onPaid && onPaid(payload, { charge: sp.telegram_payment_charge_id, amount: sp.total_amount, currency: sp.currency })) return ctx.reply('Покупка получена! Она уже доступна в игре.', playButton());
    console.error('Неизвестная оплата:', payload);
  });

  // Список команд в меню бота (русский — по умолчанию, английский — для остальных языков)
  const cmds = (r) => [['play', r ? 'Открыть игру' : 'Open the game'], ['notify', r ? 'Уведомления вкл/выкл' : 'Notifications on/off'], ['paysupport', r ? 'Помощь с покупками' : 'Purchase support'], ['terms', r ? 'Правила и конфиденциальность' : 'Terms and privacy'], ['help', r ? 'Помощь' : 'Help']].map(([command, description]) => ({ command, description }));
  bot.telegram.setMyCommands(cmds(false)).catch((e) => console.error('setMyCommands:', e.message));
  bot.telegram.setMyCommands(cmds(true), { language_code: 'ru' }).catch(() => {});
  bot.telegram.setMyCommands(cmds(true), { language_code: 'uk' }).catch(() => {});

  // Кнопка меню рядом с полем ввода
  bot.telegram.setChatMenuButton({ menuButton: { type: 'web_app', text: 'Играть', web_app: { url: WEBAPP_URL } } })
    .catch((e) => console.error('setChatMenuButton:', e.message));

  bot.launch().catch((e) => console.error('Ошибка запуска бота:', e.message));
  console.log('Telegram-бот запущен');
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
  return bot;
};
