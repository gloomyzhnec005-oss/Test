// Предметы: оружие, броня, бижутерия, руны.
// Редкость: обычный → редкий → эпический → легендарный → мифический.
// Базовые статы задаются шаблоном и растут с редкостью и уровнем мира (не суммируются при соединении).
// Случайные атрибуты выпадают при получении; соединение 5 → 1 берёт 3 случайных атрибута из пяти предметов.
// Дубликат (тот же шаблон, редкость и мир) усиливает оригинал на 5% за копию, до +50%.

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'];
const ITEM_RARITIES = {
  common:    { name: 'Обычный',     color: '#b8c4d6', mult: 1,   attrs: [1, 1], sockets: 1, sell: 15 },
  rare:      { name: 'Редкий',      color: '#4da3ff', mult: 1.6, attrs: [1, 2], sockets: 1, sell: 60 },
  epic:      { name: 'Эпический',   color: '#b86bff', mult: 2.5, attrs: [2, 3], sockets: 2, sell: 250 },
  legendary: { name: 'Легендарный', color: '#ffb340', mult: 4,   attrs: [3, 3], sockets: 2, sell: 1000 },
  mythic:    { name: 'Мифический',  color: '#ff4d6a', mult: 6.5, attrs: [3, 4], sockets: 3, sell: 4000 },
};
const TIER_MULT = { 1: 1, 2: 2.2, 3: 4.5 }; // базовые статы предметов из мира 1 / 2 / 3
const TIER_ATTR = { 1: 1, 2: 1.5, 3: 2.2 }; // сила случайных атрибутов
const TIER_NAME = { 1: '', 2: ' Бездны', 3: ' Небес' };
const DUPE_STEP = 0.05, DUPE_MAX = 10;

// Атрибуты: [название, единица, мин, макс] для обычного предмета первого мира
const ATTRS = {
  atkP:    ['Урон', '%', 2, 5],
  hpP:     ['Здоровье', '%', 2, 5],
  def:     ['Защита', '%', 1, 3],
  crit:    ['Шанс крита', '%', 1, 3],
  critDmg: ['Крит. урон', '%', 5, 12],
  aspd:    ['Скорость атаки', '%', 2, 5],
  ls:      ['Вампиризм', '%', 0.5, 1.5],
  skill:   ['Сила умений', '%', 2, 6],
  cdr:     ['Перезарядка', '−%', 1, 3],
  ms:      ['Скорость бега', '%', 1, 3],
  gold:    ['Золото', '%', 3, 8],
  xp:      ['Опыт', '%', 3, 8],
};
// Предел суммарных процентов с экипировки (чтобы топ-билды не ломали игру)
const CAPS = { def: 60, crit: 60, aspd: 80, ls: 25, cdr: 40, ms: 40 };

// Шаблоны: base — базовые статы обычного предмета первого мира
const TEMPLATES = {
  weapon: {
    sword:  { name: 'Меч', icon: '🗡️', base: { atk: 6 } },
    axe:    { name: 'Секира', icon: '🪓', base: { atk: 7, critDmg: 4 } },
    staff:  { name: 'Посох', icon: '🪄', base: { atk: 5, skill: 4 } },
    bow:    { name: 'Лук', icon: '🏹', base: { atk: 5, crit: 2 } },
    daggers:{ name: 'Кинжалы', icon: '🔪', base: { atk: 4, aspd: 4 } },
    hammer: { name: 'Молот', icon: '🔨', base: { atk: 8 } },
    spear:  { name: 'Копьё', icon: '🔱', base: { atk: 6, ls: 0.5 } },
    wand:   { name: 'Жезл', icon: '✨', base: { atk: 4, cdr: 2 } },
  },
  armor: {
    leather:{ name: 'Кожаная куртка', icon: '🦺', base: { hp: 25, def: 2 } },
    chain:  { name: 'Кольчуга', icon: '⛓️', base: { hp: 30, def: 3 } },
    plate:  { name: 'Латы', icon: '🛡️', base: { hp: 40, def: 4 } },
    robe:   { name: 'Мантия', icon: '🥻', base: { hp: 20, skill: 3 } },
    cloak:  { name: 'Плащ теней', icon: '🧥', base: { hp: 20, ms: 2 } },
    scale:  { name: 'Чешуйчатый доспех', icon: '🐉', base: { hp: 35, def: 3 } },
  },
  jewel: {
    ringPow:{ name: 'Кольцо силы', icon: '💍', base: { atk: 2, critDmg: 3 } },
    ringAgi:{ name: 'Кольцо ловкости', icon: '💍', base: { crit: 2, aspd: 2 } },
    amuLife:{ name: 'Амулет жизни', icon: '📿', base: { hp: 20 } },
    amuMind:{ name: 'Амулет мудрости', icon: '📿', base: { skill: 3, cdr: 1 } },
    earring:{ name: 'Серьги ветра', icon: '🦋', base: { ms: 2, aspd: 2 } },
    bracer: { name: 'Браслет удачи', icon: '🧿', base: { gold: 4, xp: 4 } },
  },
  rune: {
    fury:   { name: 'Руна ярости', icon: '🔴', base: { atkP: 3 } },
    life:   { name: 'Руна жизни', icon: '🟢', base: { hpP: 3 } },
    edge:   { name: 'Руна остроты', icon: '🟠', base: { crit: 2 } },
    haste:  { name: 'Руна скорости', icon: '🟡', base: { aspd: 3 } },
    blood:  { name: 'Руна крови', icon: '🩸', base: { ls: 1 } },
    wisdom: { name: 'Руна мудрости', icon: '🔵', base: { skill: 4 } },
    time:   { name: 'Руна времени', icon: '⏳', base: { cdr: 2 } },
  },
};
const CATEGORIES = { weapon: 'Оружие', armor: 'Броня', jewel: 'Бижутерия', rune: 'Руна' };
const SLOTS = { weapon: 'weapon', armor: 'armor', jewel1: 'jewel', jewel2: 'jewel' };

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const round1 = (v) => Math.round(v * 10) / 10;
let seq = Date.now() % 1e7;
const newId = () => 'i' + (seq++).toString(36) + Math.floor(Math.random() * 36 * 36).toString(36);

function rollAttr(rar, tier, exclude = []) {
  const keys = Object.keys(ATTRS).filter((k) => !exclude.includes(k));
  const k = pick(keys);
  const [, , lo, hi] = ATTRS[k];
  const r = RARITY_ORDER.indexOf(rar);
  return { k, v: round1(rnd(lo, hi) * (1 + 0.35 * r) * TIER_ATTR[tier]) };
}

function createItem(cat, rar, tier = 1, tpl = null) {
  tpl = tpl || pick(Object.keys(TEMPLATES[cat]));
  const [lo, hi] = ITEM_RARITIES[rar].attrs;
  const n = Math.round(rnd(lo, hi));
  const attrs = [];
  for (let i = 0; i < n; i++) attrs.push(rollAttr(rar, tier, attrs.map((a) => a.k)));
  const item = { id: newId(), cat, tpl, rar, tier, attrs, dupes: 0 };
  if (cat === 'weapon') item.runes = [];
  return item;
}

// Случайная категория и редкость по весам
function rollRarity(weights) {
  let r = Math.random() * Object.values(weights).reduce((s, w) => s + w, 0);
  for (const k of RARITY_ORDER) { if (weights[k] && (r -= weights[k]) <= 0) return k; }
  return 'common';
}
function rollItem(tier, weights, cat = null) {
  return createItem(cat || pick(Object.keys(TEMPLATES)), rollRarity(weights), tier);
}

// Итоговые статы одного предмета (база × редкость × мир + атрибуты, всё × бонус дубликатов)
function itemStats(it) {
  const t = TEMPLATES[it.cat][it.tpl];
  const k = 1 + DUPE_STEP * (it.dupes || 0);
  const out = {};
  const add = (key, v) => { out[key] = round1((out[key] || 0) + v); };
  for (const [key, v] of Object.entries(t.base)) {
    // Абсолютные статы (атака, здоровье) растут сильнее, проценты — мягче
    const flat = key === 'atk' || key === 'hp';
    add(key, v * (flat ? ITEM_RARITIES[it.rar].mult * TIER_MULT[it.tier] : 1 + 0.5 * RARITY_ORDER.indexOf(it.rar) + 0.4 * (it.tier - 1)) * k);
  }
  for (const a of it.attrs) add(a.k, a.v * k);
  return out;
}

// Сумма статов надетой экипировки (+ руны в оружии)
function gearStats(pr) {
  const total = {};
  const add = (st) => { for (const [k, v] of Object.entries(st)) total[k] = (total[k] || 0) + v; };
  for (const slot of Object.keys(SLOTS)) {
    const it = findItem(pr, pr.equip?.[slot]);
    if (!it) continue;
    add(itemStats(it));
    for (const r of it.runes || []) add(itemStats(r));
  }
  for (const [k, cap] of Object.entries(CAPS)) if (total[k] > cap) total[k] = cap;
  for (const k of Object.keys(total)) total[k] = round1(total[k]);
  return total;
}

function findItem(pr, id) {
  if (!id) return null;
  return (pr.items || []).find((i) => i.id === id) || null;
}

// Добавить предмет: дубликат усиливает оригинал, иначе — в сумку (если сумка полна — на склад)
function addItem(pr, item, bagSize, allowDupe = true) {
  pr.items ??= [];
  const orig = allowDupe && pr.items.find((i) => i.cat === item.cat && i.tpl === item.tpl && i.rar === item.rar && i.tier === item.tier && (i.dupes || 0) < DUPE_MAX);
  if (orig) { orig.dupes = (orig.dupes || 0) + 1; return { dupe: true, item: orig }; }
  const inBag = pr.items.filter((i) => i.loc !== 'wh').length;
  item.loc = inBag < bagSize ? 'bag' : 'wh';
  pr.items.push(item);
  return { dupe: false, item };
}

// Соединение: 5 предметов одной категории и редкости → 1 предмет следующей редкости
function mergeItems(pr, ids) {
  const uniq = [...new Set(ids)];
  if (uniq.length !== 5) return { error: 'Нужно ровно 5 предметов' };
  const items = uniq.map((id) => findItem(pr, id));
  if (items.some((i) => !i)) return { error: 'Предмет не найден' };
  const { cat, rar } = items[0];
  if (items.some((i) => i.cat !== cat || i.rar !== rar)) return { error: 'Все 5 предметов должны быть одной категории и редкости' };
  const next = RARITY_ORDER[RARITY_ORDER.indexOf(rar) + 1];
  if (!next) return { error: 'Мифические предметы нельзя соединить' };
  // Руны из оружия возвращаются в сумку, надетые предметы снимаются
  for (const it of items) {
    for (const r of it.runes || []) { r.loc = 'bag'; pr.items.push(r); }
    it.runes = [];
    for (const s of Object.keys(pr.equip || {})) if (pr.equip[s] === it.id) pr.equip[s] = null;
  }
  // 3 случайных атрибута из всех атрибутов пяти предметов
  const pool = items.flatMap((i) => i.attrs).sort(() => Math.random() - 0.5);
  const attrs = [];
  for (const a of pool) { if (attrs.length >= 3) break; if (!attrs.some((x) => x.k === a.k)) attrs.push({ ...a }); }
  const tier = Math.round(items.reduce((s, i) => s + i.tier, 0) / 5);
  const result = { id: newId(), cat, tpl: pick(items).tpl, rar: next, tier, attrs, dupes: 0, loc: 'bag' };
  if (cat === 'weapon') result.runes = [];
  pr.items = pr.items.filter((i) => !uniq.includes(i.id));
  pr.items.push(result);
  return { item: result, lost: pool.length - attrs.length };
}

// Описание предмета для клиента
function itemView(it) {
  const t = TEMPLATES[it.cat][it.tpl];
  const R = ITEM_RARITIES[it.rar];
  return {
    id: it.id, cat: it.cat, tpl: it.tpl, rar: it.rar, tier: it.tier, dupes: it.dupes || 0, loc: it.loc || 'bag',
    name: t.name + TIER_NAME[it.tier] + (it.dupes ? ` +${it.dupes}` : ''), icon: t.icon, color: R.color, rarName: R.name,
    attrs: it.attrs, stats: itemStats(it), sockets: it.cat === 'weapon' ? R.sockets : 0,
    runes: (it.runes || []).map(itemView), sell: Math.round(R.sell * TIER_MULT[it.tier] * (1 + 0.2 * (it.dupes || 0))),
  };
}

module.exports = {
  RARITY_ORDER, ITEM_RARITIES, TEMPLATES, ATTRS, CATEGORIES, SLOTS, TIER_MULT, DUPE_MAX, DUPE_STEP,
  createItem, rollItem, rollRarity, itemStats, gearStats, findItem, addItem, mergeItems, itemView,
};
