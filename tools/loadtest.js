// Нагрузочный тест: node tools/loadtest.js [ботов=100] [секунд=90] — на локальном сервере (PORT=3123, ADMIN_PASSWORD=testpass, ALLOW_GUESTS=1).
// Нужен socket.io-client, которого нет в зависимостях игры: npm i --no-save socket.io-client@4 (или установите в отдельной папке).
// Каждые 10 с печатает: онлайн, процессор сервера, задержку игрового цикла (p99 > ~50 мс — сервер не успевает), трафик.
const { io } = require('socket.io-client');
const URL = process.env.URL || 'http://localhost:3123', N = Number(process.argv[2] || 100), DUR = Number(process.argv[3] || 90) * 1000;
const H = { 'content-type': 'application/json', 'x-admin-key': process.env.ADMIN_PASSWORD || 'testpass' };
const adm = (op, b) => fetch(URL + '/admin/api/' + op, { method: 'POST', headers: H, body: JSON.stringify(b) }).then((r) => r.json());
const HEROES = ['bohai', 'vebrand', 'vayald', 'alamariel', 'ursus'];
const DG = ['dg_town1_0', 'dg_town1_1', 'dg_town1_2', 'dg_town1_3'];
const stat = { joined: 0, states: 0, bytes: 0, corrects: 0, errs: 0, disc: 0, rtt: [] };
async function bot(i) {
  const gid = 'ltbot' + i, uid = 'guest_' + gid, hero = HEROES[i % HEROES.length];
  await fetch(URL + '/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guestId: gid }) });
  await adm('edit', { uid, action: 'giveHero', hero }); await adm('edit', { uid, action: 'level', hero, value: 12 });
  const s = io(URL, { transports: ['websocket'] });
  const me = { x: 0, y: 0, mons: [] };
  s.on('connect', () => s.emit('join', { hero, guestId: gid, guestName: 'Bot' + i, lang: 'ru' }));
  s.on('welcome', async (w) => {
    stat.joined++;
    if (i % 5) { await adm('edit', { uid, action: 'teleport', zone: DG[i % 4] }); }
  });
  s.on('zone', (z) => { me.x = z.x; me.y = z.y; });
  s.on('correct', (c) => { me.x = c.x; me.y = c.y; stat.corrects++; });
  s.on('error_msg', (m) => { stat.errs++; if (stat.errs < 5) console.log('err', m); });
  s.on('disconnect', () => stat.disc++);
  s.on('state', (st) => {
    stat.states++; stat.bytes += JSON.stringify(st).length;
    const mine = (st.p || []).find((p) => p.id === s.id); if (mine && (Math.abs(mine.x - me.x) > 40 || Math.abs(mine.y - me.y) > 40)) { me.x = mine.x; me.y = mine.y; }
    me.mons = st.m || [];
  });
  let dir = Math.random() * 6.28;
  const mv = setInterval(() => {
    const t = me.mons.filter((m) => m.hp > 0).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
    let tx, ty;
    if (t && Math.hypot(t.x - me.x, t.y - me.y) < 400) {
      const d = Math.hypot(t.x - me.x, t.y - me.y);
      if (d < 60) { s.emit('attack', { targetId: t.id }); if (Math.random() < 0.05) s.emit('skill', { idx: Math.floor(Math.random() * 3) }); return; }
      tx = me.x + (t.x - me.x) / d * 9; ty = me.y + (t.y - me.y) / d * 9;
    } else { if (Math.random() < 0.05) dir = Math.random() * 6.28; tx = me.x + Math.cos(dir) * 9; ty = me.y + Math.sin(dir) * 9; }
    me.x = tx; me.y = ty; s.volatile.emit('move', { x: Math.round(tx * 10) / 10, y: Math.round(ty * 10) / 10, dir: tx < me.x ? -1 : 1 });
  }, 66);
  setTimeout(() => { clearInterval(mv); s.close(); }, DUR);
}
(async () => {
  const t0 = Date.now();
  for (let i = 0; i < N; i++) { bot(i); await new Promise((r) => setTimeout(r, 60)); }
  const iv = setInterval(async () => {
    const o = await adm('overview', {});
    console.log(`${Math.round((Date.now() - t0) / 1000)}s online=${o.online} monsters=${o.monsters} dungeons=${o.dungeons} mem=${o.memMb}MB cpu=${o.perf.cpu}% lag p50/p99/max=${o.perf.lagP50}/${o.perf.lagP99}/${o.perf.lagMax}ms | joined=${stat.joined} states/s=${Math.round(stat.states / 10)} KB/s=${Math.round(stat.bytes / 10240)} corrects=${stat.corrects} errs=${stat.errs} disc=${stat.disc}`);
    stat.states = 0; stat.bytes = 0; stat.corrects = 0;
  }, 10000);
  setTimeout(() => { clearInterval(iv); process.exit(0); }, DUR + 15000);
})();
