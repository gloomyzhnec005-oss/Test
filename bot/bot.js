// Telegram-бот: открывает игру как Mini App и принимает оплату в Telegram Stars.
// Запускается из server/index.js: require('../bot/bot')({ onPaid, isValidPayload })
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

module.exports = function startBot({ onPaid, isValidPayload } = {}) {
  const { BOT_TOKEN, WEBAPP_URL } = process.env;
  if (!BOT_TOKEN || !WEBAPP_URL) {
    console.error('Укажите BOT_TOKEN и WEBAPP_URL (https) в .env');
    return null;
  }
  const bot = new Telegraf(BOT_TOKEN);
  const playButton = () => Markup.inlineKeyboard([Markup.button.webApp('⚔️ Играть', WEBAPP_URL)]);

  bot.start((ctx) =>
    ctx.reply(
      `Добро пожаловать в мир «Telegram Quest»!\n\n` +
      `Выбери одного из трёх героев — Воина, Мага или Лучника — ` +
      `и отправляйся охотиться на монстров вместе с другими игроками.`,
      playButton(),
    ));
  bot.command('play', (ctx) => ctx.reply('Открыть игру:', playButton()));
  bot.help((ctx) => ctx.reply('/play — открыть игру\nДжойстик слева — движение, кнопка справа — атака.'));

  // Оплата в Telegram Stars
  bot.on('pre_checkout_query', (ctx) => {
    const ok = !isValidPayload || isValidPayload(ctx.preCheckoutQuery.invoice_payload);
    return ctx.answerPreCheckoutQuery(ok, ok ? undefined : 'Товар недоступен');
  });
  bot.on('successful_payment', (ctx) => {
    const payload = ctx.message.successful_payment.invoice_payload;
    if (onPaid && onPaid(payload)) return ctx.reply('Покупка получена! Она уже доступна в игре.', playButton());
    console.error('Неизвестная оплата:', payload);
  });

  // Кнопка меню рядом с полем ввода
  bot.telegram.setChatMenuButton({ menuButton: { type: 'web_app', text: 'Играть', web_app: { url: WEBAPP_URL } } })
    .catch((e) => console.error('setChatMenuButton:', e.message));

  bot.launch().catch((e) => console.error('Ошибка запуска бота:', e.message));
  console.log('Telegram-бот запущен');
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
  return bot;
};
