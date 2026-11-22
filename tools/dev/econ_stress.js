// Нагрузочная проверка кассы GRAM (см. docs/HANDOFF.md → «Проверки»). Нужен socket.io-client: npm i --no-save socket.io-client
const io = require('socket.io-client');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'content-type': 'application/json', 'x-admin-key': 'testpass' };
const adm = (p, b) => fetch('http://localhost:3123/admin/api/' + p, { method: 'POST', headers: H, body: JSON.stringify(b || {}) }).then((r) => r.json());
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch('http://localhost:3123/'); break; } catch { await sleep(300); } }
  await adm('settings', { set: { openAt: Date.now() - 864e5 } });
  const S = [];
  for (let i = 0; i < 6; i++) S.push(await new Promise((res) => { const s = io('http://localhost:3123', { transports: ['websocket'] }); s.on('connect', () => s.emit('join', { hero: 'faelin', guestId: 'e' + i })); s.on('welcome', () => res(s)); }));
  const act = (s, d) => Promise.race([new Promise((r) => s.emit('act', d, r)), sleep(3000).then(() => ({ error: 'timeout:' + d.op }))]);
  const stat = {}; const inc = (k, r) => { const key = k + (r && r.error ? ':err' : ':ok'); stat[key] = (stat[key] || 0) + 1; };
  for (let step = 0; step < 250; step++) {
    if (step % 50 === 0) console.log('шаг', step);
    const s = rnd(S), op = rnd(['gm', 'ltd', 'sell', 'sellm', 'buy', 'bid', 'fill', 'bidc', 'cosm', 'wd', 'ench']);
    let r;
    try {
      if (op === 'gm') { const o = rnd((await act(s, { op: 'gmShop', cat: rnd(['weapon', 'gloves', 'rune', 'set']) })).offers); r = await act(s, { op: 'gmBuy', key: o.key }); }
      if (op === 'ltd') r = await act(s, { op: 'gmLtdBuy', cat: rnd(['gloves', 'helm', 'weapon']) });
      if (op === 'sell') { const inv = (await act(s, { op: 'inv' })).inv; const it = rnd(inv.items.filter((i) => ['epic', 'legendary', 'mythic'].includes(i.rar) && !Object.values(inv.equip).includes(i.id))); if (it) { const q = await act(s, { op: 'thQuote', id: it.id }); r = await act(s, { op: 'thSell', id: it.id, price: (q.min + Math.random() * (q.max - q.min) * 0.1) / 1e9 }); } }
      if (op === 'sellm') r = await act(s, { op: 'thSell', mat: 'core1', n: 1 + Math.floor(Math.random() * 3), price: 0.3 + Math.random() });
      if (op === 'buy') { const l = rnd((await act(s, { op: 'th' })).lots.filter((x) => !x.mine)); if (l) r = await act(s, { op: 'thBuy', id: l.id }); }
      if (op === 'bid') r = Math.random() < 0.5 ? await act(s, { op: 'thBid', mat: 'core1', n: 1 + Math.floor(Math.random() * 4), price: 0.2 + Math.random() }) : await act(s, { op: 'thBid', cat: 'gloves', rar: 'epic', tier: 1, price: 0.3 });
      if (op === 'fill') { const b = rnd((await act(s, { op: 'th' })).bids.filter((x) => !x.mine)); if (b) r = b.mat ? await act(s, { op: 'thFill', id: b.id, n: 2 }) : await (async () => { const inv = (await act(s, { op: 'inv' })).inv; const it = inv.items.find((i) => i.cat === b.cat && i.rar === b.rar && (i.tier || 1) === b.tier && !i.set); return it ? act(s, { op: 'thFill', id: b.id, item: it.id }) : null; })(); }
      if (op === 'bidc') { const b = rnd((await act(s, { op: 'th' })).bids.filter((x) => x.mine)); if (b) r = await act(s, { op: 'thBidCancel', id: b.id }); }
      if (op === 'cosm') r = await act(s, { op: 'cosmeticBuy', id: rnd(['frame:obsidian', 'frame:celestial', 'frame:dragon']) });
      if (op === 'wd') { const g = (await act(s, { op: 'gramInfo' })).gram; if (g.free > 1e9) r = await act(s, { op: 'gramWithdraw', address: 'UQBrFFvQfbtDT8MrwtFhP1dJKX5YH3dk-0K29H5Wy6hdmkaa', amount: Math.floor(g.free / 1e9) }); }
      if (op === 'ench') { const inv = (await act(s, { op: 'inv' })).inv; const it = rnd(inv.items.filter((i) => i.enchCost)); if (it) r = await act(s, { op: 'enchant', id: it.id, luck: true }); }
    } catch (e) { r = { error: e.message }; }
    if (r) inc(op, r);
    if (step % 50 === 49) { const g = await adm('gram'); for (const w of g.wait) await adm('gramPay', { id: w.id, tx: 'test' }); }
  }
  const g = await adm('gram'), c = g.totals.cash;
  console.log('операции:', JSON.stringify(stat));
  console.log('касса: пришло', c.in / 1e9, '| выплачено', (c.out / 1e9).toFixed(3), '| должно быть в кошельке', (c.should / 1e9).toFixed(3), '| должны игрокам', (c.owe / 1e9).toFixed(3), '(заявки', (c.bids / 1e9).toFixed(3), 'казна владык', (c.extra / 1e9).toFixed(3), ')');
  console.log('ДОХОД ИГРЫ:', (c.profit / 1e9).toFixed(4), c.profit >= -1 ? '✅ не в минусе' : '❌ МИНУС');
  process.exit(0);
})();
