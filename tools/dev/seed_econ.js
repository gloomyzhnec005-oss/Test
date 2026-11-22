// Подготовка данных для tools/dev/econ_stress.js: 6 игроков guest_e0…e5 с пополнениями, вещами, приглашениями и кланом-владыкой.
// node tools/dev/seed_econ.js <DATA_DIR>   (DATA_DIR — копия данных, где уже есть guest_zeftest1 — любой профиль-образец с героями)
const fs = require('fs'), path = require('path'), I = require('../../server/items.js');
const D = process.argv[2]; if (!D) { console.error('Укажите папку данных'); process.exit(1); }
const p = JSON.parse(fs.readFileSync(path.join(D, 'players.json'))); const base = Object.values(p).find((x) => (x.heroes || []).length > 5); let sum = 0;
for (let i = 0; i < 6; i++) {
  const x = JSON.parse(JSON.stringify(base)), dep = (20 + i * 10) * 1e9; sum += dep;
  x.gram = { dep, earn: [], log: [] }; x.items = []; x.equip = {}; x.mats = { core1: 30, luckStone: 5, dust: 20 }; x.created = Date.now() - 30 * 864e5; x.clan = 'c1'; x.lastSeen = Date.now();
  for (const k of Object.keys(x.chars)) x.chars[k].level = 35;
  for (let j = 0; j < 6; j++) { const it = I.createItem(['gloves', 'helm', 'boots', 'ring', 'amulet', 'belt'][j], ['epic', 'legendary', 'mythic'][j % 3], 1); it.loc = 'bag'; x.items.push(it); }
  if (i > 0) { x.refBy = 'guest_e0'; x.refAt = i % 2 ? Date.now() - 3 * 864e5 : Date.now(); }
  p['guest_e' + i] = x;
}
fs.writeFileSync(path.join(D, 'players.json'), JSON.stringify(p));
fs.writeFileSync(path.join(D, 'gram.json'), JSON.stringify({ lots: [], seq: 1, wd: [], log: [], cash: { in: sum, out: 0 } }));
fs.writeFileSync(path.join(D, 'clans.json'), JSON.stringify({ c1: { id: 'c1', name: 'T', tag: 'T', leader: 'guest_e0', members: ['guest_e0', 'guest_e1', 'guest_e2'], reignUntil: Date.now() + 864e5, log: [], vault: [] } }));
console.log('Готово: пополнений', sum / 1e9, 'GRAM');
