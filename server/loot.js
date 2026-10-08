// Добыча материалов, свитков, чертежей и вещей комплектов с монстров.
// Каждый данж «отвечает» за два комплекта своего мира: только там падают их чертежи и вещи.
const I = require('./items');

// Комплекты данжа: [класс по номеру данжа, класс со сдвигом на 6] — каждый комплект мира есть в 1–2 данжах
function dungeonSets(tier, index) {
  const C = I.CLASS_ORDER;
  return [...new Set([C[index % 8], C[(index + 6) % 8]])].map((c) => `${c}${tier}`);
}
// Какие данжи дают комплект (для подсказок в карточке предмета)
function setSources(sid) {
  const out = [];
  for (let i = 0; i < 6; i++) if (dungeonSets(+sid.slice(-1), i).includes(sid)) out.push(i);
  return out;
}

// Шансы за одно убийство. rank: normal / magic / rare / mini / boss / world
const RANK_K = { normal: 1, summon: 0.3, magic: 2, rare: 4 };
function rollMats(m, tier, dungeon, luck = 1) {
  const mats = {}, items = [];
  const add = (id, n = 1) => { if (n > 0) mats[id] = (mats[id] || 0) + n; };
  const chance = (p) => Math.random() < p * luck;
  const n = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const big = m.rank === 'mini' || m.rank === 'boss' || m.rank === 'world';
  if (!big) {
    const k = RANK_K[m.rank] || 1;
    if (chance(0.22 * k)) add(`ore${tier}`, 1);
    if (chance(0.08 * k)) add(`ess${tier}`, 1);
    if (chance(0.02 * k)) add('scrollR');
    if (chance([0.003, 0.01, 0.015][tier - 1] * k)) add('scrollE');
    if (tier === 3 && chance(0.0008 * k)) add('scrollL');
    if (chance(0.03 * k)) add('potHp');
    if (dungeon && chance(0.0015 * k)) items.push(I.createSetItem(pick(dungeon.sets).slice(0, -1), tier, 'epic'));
    return { mats, items };
  }
  if (m.rank === 'mini') {
    add(`ore${tier}`, n(2, 4)); add(`ess${tier}`, n(1, 2));
    if (chance(0.06)) add(`core${tier}`);
    if (chance(0.25)) add('scrollR');
    if (chance(0.12)) add('scrollE');
    if (tier >= 2 && chance(tier === 3 ? 0.04 : 0.02)) add('scrollL');
    if (dungeon && chance(0.05)) add(`bp_${pick(dungeon.sets)}`);
    if (dungeon && chance(0.02)) items.push(I.createSetItem(pick(dungeon.sets).slice(0, -1), tier, 'epic'));
    add('potHp', n(0, 1));
  } else if (m.rank === 'boss') {
    add(`ore${tier}`, n(5, 8)); add(`ess${tier}`, n(3, 5));
    if (chance(0.35)) add(`core${tier}`);
    if (chance(0.5)) add('scrollR');
    if (chance(0.3)) add('scrollE');
    if (tier >= 2 && chance(tier === 3 ? 0.12 : 0.08)) add('scrollL');
    if (tier === 3 && chance(0.02)) add('scrollM');
    if (dungeon && chance(0.15)) add(`bp_${pick(dungeon.sets)}`);
    if (dungeon && chance(0.06)) items.push(I.createSetItem(pick(dungeon.sets).slice(0, -1), tier, Math.random() < 0.15 ? 'legendary' : 'epic'));
    add('potHp2', 1);
  } else {
    // Мировой босс — награда каждому участнику (вызывается по вкладу)
    add(`ore${tier}`, n(10, 15)); add(`ess${tier}`, n(6, 10)); add(`core${tier}`, n(1, 3));
    add('scrollE', 1);
    if (chance(0.3)) add('scrollL');
    if (chance(tier === 3 ? 0.08 : 0.03)) add('scrollM');
    const sids = Object.keys(I.SETS).filter((s) => I.SETS[s].tier === tier);
    if (chance(0.25)) add(`bp_${pick(sids)}`);
  }
  return { mats, items };
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];

module.exports = { dungeonSets, setSources, rollMats };
