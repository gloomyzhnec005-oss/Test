// Проверка баланса: node tools/balance_sim.js  (HEROES=kira,vebrand N=60 PVPK=0.3 — по желанию)
// Для каждой ступени: здоровье и урон героя, сколько живёт обычный монстр его уровня, сколько % здоровья в секунду
// снимает стая из 4, и за сколько секунд равный игрок убивает героя в PvP. Подробности — docs/BALANCE.md
// Баланс: герой по ступеням (уровень + типичная экипировка) против монстров своего уровня и против игрока
const R = require('path').join(__dirname, '../server/');
const C = require(R + 'config.js'), I = require(R + 'items.js'), M = require(R + 'mobs.js');
M.setBal2(true);
// ступени: уровень, редкость вещей, мир, заточка, дубликаты вещей, руны
const STAGES = [
  [5, 'common', 1, 0, 0, null], [10, 'rare', 1, 0, 0, null], [15, 'rare', 2, 1, 0, 'rare'], [20, 'epic', 2, 2, 1, 'rare'],
  [25, 'epic', 2, 3, 1, 'epic'], [30, 'legendary', 3, 4, 1, 'epic'], [35, 'legendary', 3, 5, 2, 'legendary'], [40, 'legendary', 3, 6, 2, 'legendary'],
  [45, 'mythic', 3, 7, 2, 'legendary'], [50, 'mythic', 3, 10, 3, 'mythic'],
];
const N = +process.env.N || 60;
function hero(id, L, rar, tier, ench, dupes, runeR, heroDupes = 0) {
  const acc = { hp: 0, dmg: 0, crit: 0, critDmg: 0, aspd: 0, def: 0, ls: 0, ms: 0, skill: 0 };
  for (let n = 0; n < N; n++) {
    const pr = { items: [], equip: {}, chars: {}, buffs: {}, heroes: [id], mats: {}, heroDupes: { [id]: heroDupes } };
    for (const slot of I.SLOT_ORDER) {
      const cat = slot === 'ring2' ? 'ring' : slot; if (cat === 'bag') continue;
      let it; try { it = I.createItem(cat, rar, tier, null, I.classOf(id)); } catch { continue; }
      it.ench = ench; it.dupes = dupes;
      if (cat === 'weapon' && runeR) it.runes = Array.from({ length: I.ITEM_RARITIES[rar].sockets }, () => I.createItem('rune', runeR, tier));
      pr.items.push(it); pr.equip[slot] = it.id;
    }
    const g = I.gearStats(pr, null), b = C.HEROES[id], Rr = C.RARITIES[b.rarity], dk = 1 + I.DUPE_STEP * heroDupes;
    const hp = (b.hp * Rr.base * (1 + 0.12 * Rr.grow * (L - 1)) + (g.hp || 0)) * (1 + (g.hpP || 0) / 100) * dk;
    const dmg = (b.dmg * Rr.base * (1 + 0.1 * Rr.grow * (L - 1)) + (g.atk || 0)) * (1 + (g.atkP || 0) / 100) * dk;
    acc.hp += hp; acc.dmg += dmg; for (const k of ['crit', 'critDmg', 'aspd', 'def', 'ls', 'ms', 'skill']) acc[k] += g[k] || 0;
  }
  for (const k of Object.keys(acc)) acc[k] /= N;
  const b = C.HEROES[id], hits = 1000 / (b.cooldown / (1 + acc.aspd / 100)); // ударов в секунду
  const critMul = 1 + (acc.crit / 100) * (1 + acc.critDmg / 100); // крит ×(2+critDmg)
  acc.dps = acc.dmg * hits * critMul * 1.5; // умения ≈ +50% к обычным ударам
  acc.pvpDps = acc.dmg * hits * (1 + (acc.crit / 100) * 0.6) * 1.5 * (+process.env.PVPK || 0.3);
  acc.hits = hits;
  return acc;
}
function mob(L, cls = 'melee', rank = 'normal') { const def = Object.values(M.MOBS).find((d) => d.cls === cls && (d.rank || 'normal') === 'normal'); return M.statsAt(def, L, rank); }
const ids = (process.env.HEROES || 'kira,vebrand,aurelius').split(',');
console.log('ур. | вещи              | герой: HP / DPS / крит / бег | обычный монстр: HP, удар | убить, с | стая(4) урон/с от HP героя | PvP (равные): убить, с');
for (const id of ids) {
  for (const [L, rar, tier, ench, dupes, rr] of STAGES) {
    const h = hero(id, L, rar, tier, ench, dupes, rr);
    const ms = mob(L, 'melee'), msC = M.CLASS.melee;
    const ttk = ms.hp / h.dps;
    const packDps = 4 * ms.dmg / (ms.cd / 1000) * (1 - Math.min(h.def, 90) / 100) * 0.6; // ~60% стаи бьёт одновременно
    const pvp = h.hp / (h.pvpDps * (1 - h.def / 100)) / (1 + h.ls / 100 * 0.45);
    console.log(`${String(L).padStart(3)} | ${(rar + ' ' + tier + ' +' + ench).padEnd(17)} | ${id.padEnd(8)} ${Math.round(h.hp)} / ${Math.round(h.dps)} / ${Math.round(h.crit)}% / +${Math.round(h.ms)}% | ${ms.hp}, ${ms.dmg} | ${ttk.toFixed(1)} | ${(packDps / h.hp * 100).toFixed(1)}% | ${pvp.toFixed(1)}`);
  }
  console.log('');
}
module.exports = { hero, mob };
