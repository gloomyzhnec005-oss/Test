// Запуск сервера: сначала хранилище (с DATABASE_URL — загрузка из Postgres), потом игра.
// При остановке (деплой, перезапуск на Railway) — дописать в базу всё несохранённое и только потом выйти.
require('dotenv').config();
const store = require('./store');

store.init().then(() => {
  require('./index');
}).catch((e) => {
  console.error(e.message || e);
  process.exit(1); // база недоступна — Railway перезапустит сервер; без базы не стартуем, чтобы не разойтись с ней
});

let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    try {
      if (global.__saveAll) global.__saveAll(); // свежие данные из памяти игры — в хранилище
      await store.flushNow(true);
      console.log('[store] данные сохранены перед остановкой');
    } catch (e) { console.error('[store] сохранение при остановке', e.message); }
    process.exit(0);
  });
}
