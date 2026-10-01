// Telegram-бот: открывает игру как Mini App
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const { BOT_TOKEN, WEBAPP_URL } = process.env;
if (!BOT_TOKEN || !WEBAPP_URL) {
  console.error('Укажите BOT_TOKEN и WEBAPP_URL (https) в .env');
  module.exports = null;
} else {
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

  // Кнопка меню рядом с полем ввода
  bot.telegram.setChatMenuButton({ menuButton: { type: 'web_app', text: 'Играть', web_app: { url: WEBAPP_URL } } })
    .catch((e) => console.error('setChatMenuButton:', e.message));

  bot.launch().then(() => {}).catch((e) => console.error('Ошибка запуска бота:', e.message));
  console.log('Telegram-бот запущен');
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
  module.exports = bot;
}
