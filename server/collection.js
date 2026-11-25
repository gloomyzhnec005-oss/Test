// «Память героев»: каждый герой в коллекции даёт небольшой бонус всему аккаунту — свой для каждого класса.
// Не про силу в лоб: золото, зелья, удача, прочность, штраф за гибель, эликсиры, опыт ордена; только у Воителя — чуть здоровья.
// Сколько даёт герой — по редкости (обычный 1, редкий 1,5, эпический 2, легендарный 3, мифический 4 «доли»). У каждого бонуса — предел.
const C = require('./config');
const I = require('./items');

const SHARE = { common: 1, rare: 1.5, epic: 2, legendary: 3, mythic: 4 };
// класс → бонус: за одну «долю», предел, как показать
const PERKS = {
  rogue:     { key: 'gold',    per: 1,   cap: 15, icon: '💰', name: 'Золото с монстров',             fmt: (v) => `+${v}%` },
  warrior:   { key: 'hpP',     per: 0.5, cap: 6,  icon: '❤️', name: 'Здоровье',                      fmt: (v) => `+${v}%` },
  nature:    { key: 'potion',  per: 3,   cap: 30, icon: '🧪', name: 'Сила зелий здоровья',           fmt: (v) => `+${v}%` },
  hunter:    { key: 'luck',    per: 1,   cap: 12, icon: '🍀', name: 'Удача: вещи и материалы',       fmt: (v) => `+${v}%` },
  knight:    { key: 'dur',     per: 4,   cap: 40, icon: '🛡️', name: 'Износ вещей при гибели',        fmt: (v) => `−${v}%` },
  dark:      { key: 'deathXp', per: 4,   cap: 40, icon: '💀', name: 'Потеря опыта при гибели',       fmt: (v) => `−${v}%` },
  elemental: { key: 'elixir',  per: 3,   cap: 30, icon: '⏳', name: 'Длительность эликсиров',        fmt: (v) => `+${v}%` },
  holy:      { key: 'passXp',  per: 2,   cap: 20, icon: '🎖️', name: 'Опыт сезонного ордена',        fmt: (v) => `+${v}%` },
};

const cache = new WeakMap();
// Итог по профилю: { gold: %, hpP: %, ... } — пересчёт, только когда меняется список героев
function perks(pr) {
  const sig = (pr.heroes || []).join(',');
  const c = cache.get(pr);
  if (c && c.sig === sig) return c.v;
  const v = {};
  for (const id of pr.heroes || []) {
    const h = C.HEROES[id], P = PERKS[I.classOf(id)];
    if (!h || !P) continue;
    v[P.key] = (v[P.key] || 0) + P.per * (SHARE[h.rarity] || 1);
  }
  for (const P of Object.values(PERKS)) if (v[P.key]) v[P.key] = Math.round(Math.min(P.cap, v[P.key]) * 10) / 10;
  cache.set(pr, { sig, v });
  return v;
}
const k = (pr, key) => (perks(pr)[key] || 0) / 100;
// Для окна героя: все бонусы, сколько набрано и предел
function view(pr) {
  const v = perks(pr);
  return Object.entries(PERKS).map(([cls, P]) => ({ cls, clsName: I.CLASSES[cls] ? I.CLASSES[cls].name : cls, icon: P.icon, name: P.name, value: v[P.key] || 0, cap: P.cap, text: P.fmt(v[P.key] || 0), capText: P.fmt(P.cap) }));
}
// Что даст конкретный герой (для призыва и коллекции)
function heroPerk(id) {
  const h = C.HEROES[id], P = PERKS[I.classOf(id)];
  return h && P ? `${P.icon} ${P.name} ${P.fmt(Math.round(P.per * (SHARE[h.rarity] || 1) * 10) / 10)}` : '';
}
module.exports = { perks, k, view, heroPerk, PERKS };
