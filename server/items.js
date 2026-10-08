// Предметы: 7 слотов экипировки (оружие, шлем, доспех, перчатки, сапоги, кольцо, амулет) и руны.
// Редкость: обычный → редкий → эпический → легендарный → мифический.
// Базовые статы задаются шаблоном и растут с редкостью и уровнем мира (не суммируются при соединении).
// Случайные атрибуты выпадают при получении; соединение 5 → 1 берёт 3 случайных атрибута из пяти предметов.
// Дубликат (тот же шаблон, редкость и мир) усиливает оригинал на 5% за копию, до +50%.
//
// Комплекты: 8 классов героев × 3 мира = 24 комплекта по 7 предметов. Бонус комплекта (2 / 4 / 7 вещей)
// работает только у героев своего класса — комплект общий для 5–6 героев, а не личный.
// Материалы, свитки, чертежи и расходники — складываются в стопки (pr.mats), их можно продавать на рынке.

const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'];
const ITEM_RARITIES = {
  common:    { name: 'Обычный',     color: '#b8c4d6', mult: 1,   attrs: [1, 1], sockets: 1, sell: 15 },
  rare:      { name: 'Редкий',      color: '#4da3ff', mult: 1.6, attrs: [1, 2], sockets: 1, sell: 60 },
  epic:      { name: 'Эпический',   color: '#b86bff', mult: 2.5, attrs: [2, 3], sockets: 2, sell: 250 },
  legendary: { name: 'Легендарный', color: '#ffb340', mult: 4,   attrs: [3, 3], sockets: 2, sell: 1000 },
  mythic:    { name: 'Мифический',  color: '#ff4d6a', mult: 6.5, attrs: [3, 4], sockets: 3, sell: 4000 },
};
const TIER_MULT = { 1: 1, 2: 2.2, 3: 4.5 }; // базовые статы и цены предметов мира 1 / 2 / 3
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
// Предел суммарных процентов (экипировка + комплекты + эликсиры), чтобы топ-билды не ломали игру
const CAPS = { def: 60, crit: 60, aspd: 80, ls: 25, cdr: 40, ms: 40 };

// ---------- Классы героев (для комплектов) ----------
const CLASSES = {
  warrior:   { name: 'Воитель',   icon: '🪓', heroes: ['vebrand', 'vayald', 'caldero', 'emet', 'zefira', 'wugazh'] },
  knight:    { name: 'Рыцарь',    icon: '🛡️', heroes: ['brendan', 'valerian', 'kelto', 'morvenKnight', 'talmira', 'gardin'] },
  rogue:     { name: 'Тень',      icon: '🗡️', heroes: ['kira', 'kassian', 'nairi', 'malakor', 'tibor', 'bohai'] },
  hunter:    { name: 'Охотник',   icon: '🏹', heroes: ['faelin', 'ursus', 'medea', 'ingrid'] },
  elemental: { name: 'Стихийник', icon: '🔥', heroes: ['aurelius', 'ilyria', 'itilior', 'blaze', 'flare', 'sirocco', 'brilda', 'torden'] },
  dark:      { name: 'Чернокнижник', icon: '💀', heroes: ['orion', 'zukra', 'sanguine', 'gideon', 'elnaeris', 'leblanc'] },
  nature:    { name: 'Друид',     icon: '🌿', heroes: ['nimue', 'taliesin', 'alamariel', 'voldan'] },
  holy:      { name: 'Светоносец', icon: '✨', heroes: ['justina', 'selena', 'giacomo', 'galatea'] },
};
const CLASS_ORDER = Object.keys(CLASSES);
const classOf = (heroId) => CLASS_ORDER.find((c) => CLASSES[c].heroes.includes(heroId)) || null;

// ---------- Слоты и обычные шаблоны ----------
const SLOT_ORDER = ['weapon', 'helm', 'armor', 'gloves', 'boots', 'ring', 'amulet'];
const SLOTS = Object.fromEntries(SLOT_ORDER.map((s) => [s, s]));
const SLOT_NAMES = { weapon: 'Оружие', helm: 'Шлем', armor: 'Доспех', gloves: 'Перчатки', boots: 'Сапоги', ring: 'Кольцо', amulet: 'Амулет' };
const CATEGORIES = { ...SLOT_NAMES, rune: 'Руна' };

// base — статы обычного предмета первого мира. atk/hp растут с редкостью сильнее, проценты — мягче.
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
  helm: {
    cap:    { name: 'Кожаный капюшон', icon: '🎩', base: { hp: 10, ms: 1 } },
    helmet: { name: 'Железный шлем', icon: '⛑️', base: { hp: 14, def: 1.5 } },
    circlet:{ name: 'Обруч мага', icon: '👑', base: { hp: 8, skill: 2.5 } },
    hood:   { name: 'Капюшон тени', icon: '🥷', base: { hp: 9, crit: 1.5 } },
  },
  armor: {
    leather:{ name: 'Кожаная куртка', icon: '🦺', base: { hp: 25, def: 2 } },
    chain:  { name: 'Кольчуга', icon: '⛓️', base: { hp: 30, def: 3 } },
    plate:  { name: 'Латы', icon: '🛡️', base: { hp: 40, def: 4 } },
    robe:   { name: 'Мантия', icon: '🥻', base: { hp: 20, skill: 3 } },
    cloak:  { name: 'Плащ теней', icon: '🧥', base: { hp: 20, ms: 2 } },
    scale:  { name: 'Чешуйчатый доспех', icon: '🐉', base: { hp: 35, def: 3 } },
  },
  gloves: {
    bracers:{ name: 'Наручи', icon: '🧤', base: { atk: 2, def: 1 } },
    grips:  { name: 'Перчатки ловкача', icon: '🧤', base: { atk: 1.5, aspd: 2.5 } },
    gauntlet:{ name: 'Латные рукавицы', icon: '🥊', base: { atk: 2.5, critDmg: 3 } },
    silk:   { name: 'Шёлковые перчатки', icon: '🧤', base: { atk: 1, cdr: 1.5 } },
  },
  boots: {
    boots:  { name: 'Походные сапоги', icon: '🥾', base: { hp: 10, ms: 3 } },
    greaves:{ name: 'Латные поножи', icon: '🦿', base: { hp: 16, def: 1.5 } },
    sandals:{ name: 'Сандалии странника', icon: '🩴', base: { hp: 8, ms: 2, cdr: 1 } },
  },
  ring: {
    ringPow:{ name: 'Кольцо силы', icon: '💍', base: { atk: 2, critDmg: 3 } },
    ringAgi:{ name: 'Кольцо ловкости', icon: '💍', base: { crit: 2, aspd: 2 } },
    ringWind:{ name: 'Кольцо ветра', icon: '💍', base: { ms: 2, aspd: 2 } },
    bracer: { name: 'Браслет удачи', icon: '🧿', base: { gold: 4, xp: 4 } },
  },
  amulet: {
    amuLife:{ name: 'Амулет жизни', icon: '📿', base: { hp: 20 } },
    amuMind:{ name: 'Амулет мудрости', icon: '📿', base: { skill: 3, cdr: 1 } },
    amuBlood:{ name: 'Амулет крови', icon: '🩸', base: { hp: 10, ls: 1 } },
  },
  rune: {
    fury:   { name: 'Руна ярости', icon: '🔴', base: { atkP: 3 } },
    life:   { name: 'Руна жизни', icon: '🟢', base: { hpP: 3 } },
    edge:   { name: 'Руна остроты', icon: '🟠', base: { crit: 2 } },
    haste:  { name: 'Руна скорости', icon: '🟡', base: { aspd: 3 } },
    blood:  { name: 'Руна крови', icon: '🩸', base: { ls: 1 } },
    wisdom: { name: 'Руна мудрости', icon: '🔵', base: { skill: 4 } },
    time:   { name: 'Руна времени', icon: '⏳', base: { cdr: 2 } },
    stone:  { name: 'Руна стойкости', icon: '⚫', base: { def: 2 } },
    wind:   { name: 'Руна ветра', icon: '⚪', base: { ms: 2 } },
    fortune:{ name: 'Руна удачи', icon: '🟣', base: { gold: 5, xp: 3 } },
  },
};

// ---------- Комплекты ----------
// Предметы комплекта сильнее обычных: базовые статы ×1.2 и класс-специфичный упор.
// Бонусы: 2 / 4 / 7 надетых вещей (только герой своего класса); в мирах II и III бонусы ×1.3 / ×1.6.
const SET_KIT = {
  warrior: {
    names: ['Дикого вождя', 'Пепельного берсерка', 'Громовержца'],
    pieces: { weapon: ['Двуручная секира', '🪓', { atk: 8, critDmg: 5 }], helm: ['Рогатый шлем', '⛑️', { hp: 15, atkP: 1 }], armor: ['Доспех из шкур', '🦺', { hp: 34, def: 2.5 }],
      gloves: ['Боевые рукавицы', '🥊', { atk: 3, critDmg: 3 }], boots: ['Сапоги натиска', '🥾', { hp: 12, ms: 2.5 }], ring: ['Кольцо ярости', '💍', { atk: 2.5, ls: 0.5 }], amulet: ['Клык вожака', '🦷', { hp: 14, critDmg: 4 }] },
    bonus: [[2, { atkP: 8 }], [4, { ls: 4, hpP: 10 }], [7, { atkP: 20, critDmg: 30 }]],
  },
  knight: {
    names: ['Стального обета', 'Чёрного бастиона', 'Небесного легиона'],
    pieces: { weapon: ['Рыцарский меч', '⚔️', { atk: 7, hp: 10 }], helm: ['Закрытый шлем', '⛑️', { hp: 18, def: 2 }], armor: ['Полные латы', '🛡️', { hp: 48, def: 5 }],
      gloves: ['Латные перчатки', '🧤', { atk: 2, def: 1.5 }], boots: ['Поножи стража', '🦿', { hp: 18, def: 1.5 }], ring: ['Печать ордена', '💍', { hp: 10, def: 1 }], amulet: ['Знак обета', '🎖️', { hp: 20, atkP: 1 }] },
    bonus: [[2, { def: 6 }], [4, { hpP: 15 }], [7, { def: 10, atkP: 12, hpP: 15 }]],
  },
  rogue: {
    names: ['Ночного ветра', 'Безмолвной гильдии', 'Звёздного клинка'],
    pieces: { weapon: ['Парные клинки', '🔪', { atk: 5, aspd: 5, crit: 1 }], helm: ['Маска убийцы', '🎭', { hp: 10, crit: 2 }], armor: ['Кожаный плащ', '🧥', { hp: 24, ms: 2.5 }],
      gloves: ['Перчатки карманника', '🧤', { atk: 2, aspd: 3 }], boots: ['Бесшумные сапоги', '🥾', { hp: 10, ms: 3.5 }], ring: ['Кольцо тени', '💍', { crit: 2.5, critDmg: 3 }], amulet: ['Медальон гильдии', '📿', { hp: 10, crit: 2 }] },
    bonus: [[2, { crit: 6 }], [4, { aspd: 12 }], [7, { critDmg: 40, atkP: 12 }]],
  },
  hunter: {
    names: ['Лесного следопыта', 'Пепельного ловчего', 'Соколиного ока'],
    pieces: { weapon: ['Длинный лук', '🏹', { atk: 6, crit: 2.5 }], helm: ['Капюшон следопыта', '🎩', { hp: 11, crit: 1.5 }], armor: ['Куртка ловчего', '🦺', { hp: 28, ms: 2 }],
      gloves: ['Наручи лучника', '🧤', { atk: 2, aspd: 2.5 }], boots: ['Сапоги охотника', '🥾', { hp: 11, ms: 3 }], ring: ['Кольцо меткости', '💍', { crit: 2, atk: 1.5 }], amulet: ['Коготь зверя', '🦷', { hp: 12, aspd: 2 }] },
    bonus: [[2, { atkP: 8 }], [4, { crit: 6, ms: 6 }], [7, { aspd: 15, critDmg: 30 }]],
  },
  elemental: {
    names: ['Ученика стихий', 'Огненной Бездны', 'Архимага бурь'],
    pieces: { weapon: ['Посох стихий', '🪄', { atk: 6, skill: 5 }], helm: ['Обруч стихий', '👑', { hp: 9, skill: 3 }], armor: ['Мантия стихий', '🥻', { hp: 24, skill: 4 }],
      gloves: ['Перчатки чародея', '🧤', { atk: 1.5, cdr: 2 }], boots: ['Туфли левитации', '🩴', { hp: 9, ms: 2, cdr: 1 }], ring: ['Кольцо искр', '💍', { atk: 2, skill: 2 }], amulet: ['Сфера стихий', '🔮', { hp: 12, skill: 3 }] },
    bonus: [[2, { skill: 10 }], [4, { cdr: 8 }], [7, { skill: 25, atkP: 10 }]],
  },
  dark: {
    names: ['Могильщика', 'Кровавого ковена', 'Падшей звезды'],
    pieces: { weapon: ['Жезл костей', '☠️', { atk: 6, skill: 4, ls: 0.5 }], helm: ['Капюшон некроманта', '🥷', { hp: 10, skill: 3 }], armor: ['Роба ковена', '🥻', { hp: 26, ls: 1 }],
      gloves: ['Перчатки жнеца', '🧤', { atk: 2, ls: 0.8 }], boots: ['Сапоги склепа', '🥾', { hp: 11, ms: 2 }], ring: ['Перстень душ', '💍', { skill: 2.5, ls: 0.5 }], amulet: ['Череп-оберег', '💀', { hp: 14, skill: 2 }] },
    bonus: [[2, { skill: 8 }], [4, { ls: 5 }], [7, { skill: 20, hpP: 15, ls: 5 }]],
  },
  nature: {
    names: ['Древнего леса', 'Топей и корней', 'Небесной рощи'],
    pieces: { weapon: ['Посох друида', '🌿', { atk: 5, skill: 3, hp: 10 }], helm: ['Венец из ветвей', '🌱', { hp: 14, skill: 2 }], armor: ['Доспех из коры', '🌳', { hp: 38, def: 3 }],
      gloves: ['Перчатки травника', '🧤', { atk: 1.5, cdr: 1.5 }], boots: ['Сапоги из мха', '🥾', { hp: 14, ms: 2 }], ring: ['Кольцо семени', '💍', { hp: 10, skill: 2 }], amulet: ['Желудь жизни', '🌰', { hp: 22 }] },
    bonus: [[2, { hpP: 10 }], [4, { skill: 10, cdr: 5 }], [7, { hpP: 15, skill: 15, def: 6 }]],
  },
  holy: {
    names: ['Послушника', 'Пепельного пилигрима', 'Сияющего нимба'],
    pieces: { weapon: ['Скипетр света', '🔱', { atk: 5, skill: 4, cdr: 1 }], helm: ['Нимб-диадема', '😇', { hp: 12, cdr: 1.5 }], armor: ['Риза жреца', '🥻', { hp: 30, def: 2 }],
      gloves: ['Перчатки благословения', '🧤', { atk: 1.5, skill: 2 }], boots: ['Сандалии паломника', '🩴', { hp: 11, ms: 2.5 }], ring: ['Кольцо молитвы', '💍', { hp: 8, cdr: 1.5 }], amulet: ['Святой символ', '✝️', { hp: 18, skill: 2 }] },
    bonus: [[2, { hpP: 8 }], [4, { cdr: 8 }], [7, { skill: 20, def: 8, hpP: 12 }]],
  },
};
const SET_TIER_K = { 1: 1, 2: 1.3, 3: 1.6 };
const SETS = {}; // id → { id, cls, tier, name, bonus }
for (const cls of CLASS_ORDER) {
  const kit = SET_KIT[cls];
  for (const tier of [1, 2, 3]) {
    const id = `${cls}${tier}`;
    SETS[id] = { id, cls, tier, name: `Комплект ${kit.names[tier - 1]}`, short: kit.names[tier - 1],
      bonus: kit.bonus.map(([n, st]) => [n, Object.fromEntries(Object.entries(st).map(([k, v]) => [k, Math.round(v * SET_TIER_K[tier] * 10) / 10]))]) };
  }
  // Шаблоны предметов комплекта (по одному на слот и класс; мир задаёт предмет, а не шаблон)
  for (const slot of SLOT_ORDER) {
    const [name, icon, base] = kit.pieces[slot];
    TEMPLATES[slot][`set_${cls}`] = { name, icon, base, setCls: cls };
  }
}
const setIdOf = (it) => {
  const t = TEMPLATES[it.cat] && TEMPLATES[it.cat][it.tpl];
  return t && t.setCls ? `${t.setCls}${it.tier}` : null;
};
// Обычные шаблоны (без комплектов) — для случайной добычи и витрин
const plainTpls = (cat) => Object.keys(TEMPLATES[cat]).filter((k) => !TEMPLATES[cat][k].setCls);

// ---------- Материалы, свитки, чертежи, расходники (стопки в pr.mats) ----------
// price — цена в лавке (если продаётся), buy — сколько даёт торговец при продаже ему.
const MATS = {};
const TIER_TAG = { 1: 'I', 2: 'II', 3: 'III' };
const MAT_DEFS = [
  ['ore', ['Железная руда', 'Обсидиановый слиток', 'Небесное серебро'], ['⛏️', '🪨', '🥈'], '#c8b89a', 'Материал ковки мира {t}. Падает с монстров мира {t}.', 25, 5],
  ['ess', ['Пыль духов', 'Эссенция Бездны', 'Звёздная пыль'], ['✨', '🟣', '🌟'], '#8ad3ff', 'Магический материал мира {t}. Падает с монстров мира {t}, чаще с усиленных и редких.', 60, 12],
  ['core', ['Сердце леса', 'Демоническое сердце', 'Драконья чешуя'], ['💚', '❤️‍🔥', '🐉'], '#ffb340', 'Редкий материал мира {t}: полубоссы, боссы и мировые боссы. В лавках не продаётся.', 0, 300],
];
for (const [base, names, icons, color, desc, price, buy] of MAT_DEFS) {
  for (const t of [1, 2, 3]) {
    MATS[`${base}${t}`] = { name: names[t - 1], icon: icons[t - 1], color, tier: t, kind: 'mat', desc: desc.replaceAll('{t}', TIER_TAG[t]),
      price: price ? Math.round(price * TIER_MULT[t]) : 0, buy: Math.round(buy * TIER_MULT[t]) };
  }
}
// Свитки улучшения (для ковки на следующую редкость) — универсальные для всех миров
Object.assign(MATS, {
  scrollR: { name: 'Свиток подмастерья', icon: '📜', color: '#4da3ff', kind: 'scroll', to: 'rare', desc: 'Ковка: обычный → редкий. Падает с монстров везде.', price: 250, buy: 40 },
  scrollE: { name: 'Свиток мастера', icon: '📜', color: '#b86bff', kind: 'scroll', to: 'epic', desc: 'Ковка: редкий → эпический. Полубоссы и боссы, в мирах II–III — и обычные монстры.', price: 1800, buy: 250, limit: 2 },
  scrollL: { name: 'Свиток грандмастера', icon: '📜', color: '#ffb340', kind: 'scroll', to: 'legendary', desc: 'Ковка: эпический → легендарный. Боссы миров II–III и мировые боссы. В лавках не продаётся.', price: 0, buy: 1500 },
  scrollM: { name: 'Свиток легенды', icon: '📜', color: '#ff4d6a', kind: 'scroll', to: 'mythic', desc: 'Ковка: легендарный → мифический. Боссы мира III и мировые боссы. В лавках не продаётся.', price: 0, buy: 6000 },
});
// Чертежи комплектов: падают только в «своём» данже
for (const [id, s] of Object.entries(SETS)) {
  MATS[`bp_${id}`] = { name: `Чертёж: ${s.short}`, icon: '🗺️', color: '#ffd36a', kind: 'blueprint', set: id, tier: s.tier,
    desc: `Превращает эпический или лучший предмет мира ${TIER_TAG[s.tier]} в вещь «${s.name}» того же слота и редкости.`, price: 0, buy: 400 * TIER_MULT[s.tier] };
}
// Расходники
Object.assign(MATS, {
  potHp: { name: 'Зелье здоровья', icon: '🧪', color: '#ff6a6a', kind: 'potion', heal: 0.35, desc: 'Сразу восстанавливает 35% здоровья. Раз в 8 с.', price: 30, buy: 6 },
  potHp2: { name: 'Большое зелье здоровья', icon: '⚗️', color: '#ff3a3a', kind: 'potion', heal: 0.7, desc: 'Сразу восстанавливает 70% здоровья. Раз в 8 с.', price: 120, buy: 24 },
  potRes: { name: 'Зелье энергии', icon: '🫙', color: '#5a9aff', kind: 'potion', res: 0.5, desc: 'Восстанавливает 50% маны, энергии или ярости. Раз в 8 с.', price: 40, buy: 8 },
  elxAtk: { name: 'Эликсир силы', icon: '🍷', color: '#ff8a5a', kind: 'elixir', buff: 'atk', desc: '+10% урона на 30 минут.', price: 350, buy: 60 },
  elxDef: { name: 'Эликсир стойкости', icon: '🛡️', color: '#c8d8e8', kind: 'elixir', buff: 'def', desc: '+8% защиты и +10% здоровья на 30 минут.', price: 350, buy: 60 },
  elxAgi: { name: 'Эликсир ловкости', icon: '🌀', color: '#7ad8a0', kind: 'elixir', buff: 'agi', desc: '+10% скорости атаки и +5% шанса крита на 30 минут.', price: 350, buy: 60 },
  elxMind: { name: 'Эликсир мудрости', icon: '🔮', color: '#b88aff', kind: 'elixir', buff: 'mind', desc: '+12% силы умений и −5% перезарядки на 30 минут.', price: 350, buy: 60 },
  elxXp: { name: 'Эликсир опыта', icon: '📘', color: '#8ad3ff', kind: 'elixir', buff: 'xp', desc: '+50% опыта на 30 минут.', price: 400, buy: 70 },
  elxLuck: { name: 'Эликсир удачи', icon: '🍀', color: '#7dff8a', kind: 'elixir', buff: 'luck', desc: 'Предметы и материалы падают на 30% чаще 30 минут.', price: 500, buy: 80 },
  tpScroll: { name: 'Свиток возвращения', icon: '🌀', color: '#5fd1c8', kind: 'scrollTp', desc: 'Мгновенно переносит в город текущего мира.', price: 60, buy: 10 },
  // Платные ларцы (Telegram Stars) — открываются в сумке, мир берётся по месту открытия
  kitSmith: { name: 'Сундук кузнеца', icon: '🧰', color: '#ffd36a', kind: 'chest', desc: '30 руды, 15 эссенции и 2 свитка мастера мира, где вы его открыли.', price: 0, buy: 0 },
  chestSet: { name: 'Ларец комплекта', icon: '🎁', color: '#ffb340', kind: 'chest', desc: 'Вещь комплекта вашего класса мира, где вы открыли ларец: эпическая, 15% легендарная, 2% мифическая.', price: 0, buy: 0 },
  chestLegend: { name: 'Ларец грандмастера', icon: '👑', color: '#ff4d6a', kind: 'chest', desc: '2 свитка грандмастера и 1 редкий материал мира, где вы его открыли.', price: 0, buy: 0 },
});
// Бонусы эликсиров (добавляются к статам экипировки, пока действуют)
const BUFF_STATS = { atk: { atkP: 10 }, def: { def: 8, hpP: 10 }, agi: { aspd: 10, crit: 5 }, mind: { skill: 12, cdr: 5 } };

// Цена вещи в лавке материалов с учётом мира
const matPrice = (id) => (MATS[id] ? MATS[id].price * (MATS[id].tier ? 1 : 1) : 0);
// Мат. стоимости: с учётом мира для свитков/расходников (они без мира — цену умножают по миру лавки)
const matView = (id, n = 1, tier = 1) => {
  const m = MATS[id];
  if (!m) return null;
  const scale = m.tier ? 1 : TIER_MULT[tier] || 1;
  return { id: 'mat:' + id, mat: id, cat: 'mat', kind: m.kind, name: m.name + (m.tier && m.kind === 'mat' ? '' : ''), icon: m.icon, color: m.color,
    rarName: { mat: 'Материал', scroll: 'Свиток', blueprint: 'Чертёж', potion: 'Зелье', elixir: 'Эликсир', scrollTp: 'Свиток', chest: 'Ларец' }[m.kind] || '',
    desc: m.desc, n, tier: m.tier || 0, dupes: 0, attrs: [], stats: {}, runes: [], sockets: 0, sell: Math.round(m.buy * scale),
    usable: ['potion', 'elixir', 'scrollTp', 'chest'].includes(m.kind) };
};
function addMat(pr, id, n = 1) {
  if (!MATS[id] || !(n > 0)) return 0;
  pr.mats ??= {};
  pr.mats[id] = (pr.mats[id] || 0) + Math.floor(n);
  return n;
}
function takeMats(pr, need) {
  pr.mats ??= {};
  for (const [id, n] of Object.entries(need)) if ((pr.mats[id] || 0) < n) return false;
  for (const [id, n] of Object.entries(need)) { pr.mats[id] -= n; if (!pr.mats[id]) delete pr.mats[id]; }
  return true;
}

// ---------- Создание предметов ----------
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
const rollAttrs = (rar, tier) => {
  const [lo, hi] = ITEM_RARITIES[rar].attrs;
  const n = Math.round(rnd(lo, hi));
  const attrs = [];
  for (let i = 0; i < n; i++) attrs.push(rollAttr(rar, tier, attrs.map((a) => a.k)));
  return attrs;
};

function createItem(cat, rar, tier = 1, tpl = null) {
  tpl = tpl || pick(plainTpls(cat));
  const item = { id: newId(), cat, tpl, rar, tier, attrs: rollAttrs(rar, tier), dupes: 0 };
  if (cat === 'weapon') item.runes = [];
  return item;
}
// Вещь комплекта: класс (или случайный), слот (или случайный)
function createSetItem(cls, tier, rar = 'epic', slot = null) {
  cls = cls || pick(CLASS_ORDER);
  return createItem(slot || pick(SLOT_ORDER), rar, tier, `set_${cls}`);
}

// Случайная категория и редкость по весам
function rollRarity(weights) {
  let r = Math.random() * Object.values(weights).reduce((s, w) => s + w, 0);
  for (const k of RARITY_ORDER) { if (weights[k] && (r -= weights[k]) <= 0) return k; }
  return 'common';
}
const DROP_CATS = [...SLOT_ORDER, 'weapon', 'armor', 'rune']; // оружие и доспехи падают чаще
function rollItem(tier, weights, cat = null) {
  return createItem(cat || pick(DROP_CATS), rollRarity(weights), tier);
}

// Итоговые статы одного предмета (база × редкость × мир + атрибуты, всё × бонус дубликатов)
function itemStats(it) {
  const t = TEMPLATES[it.cat][it.tpl];
  const k = (1 + DUPE_STEP * (it.dupes || 0)) * (t.setCls ? 1.2 : 1);
  const out = {};
  const add = (key, v) => { out[key] = round1((out[key] || 0) + v); };
  for (const [key, v] of Object.entries(t.base)) {
    // Абсолютные статы (атака, здоровье) растут сильнее, проценты — мягче
    const flat = key === 'atk' || key === 'hp';
    add(key, v * (flat ? ITEM_RARITIES[it.rar].mult * TIER_MULT[it.tier] : 1 + 0.5 * RARITY_ORDER.indexOf(it.rar) + 0.4 * (it.tier - 1)) * k);
  }
  for (const a of it.attrs) add(a.k, a.v * (1 + DUPE_STEP * (it.dupes || 0)));
  return out;
}

// Сколько вещей каждого комплекта надето и какие бонусы активны для героя
function setState(pr, heroId) {
  const cls = classOf(heroId);
  const counts = {};
  for (const slot of SLOT_ORDER) {
    const it = findItem(pr, pr.equip?.[slot]);
    const sid = it && setIdOf(it);
    if (sid) counts[sid] = (counts[sid] || 0) + 1;
  }
  const active = [];
  for (const [sid, n] of Object.entries(counts)) {
    const s = SETS[sid];
    for (const [need, st] of s.bonus) if (n >= need && s.cls === cls) active.push({ set: sid, need, stats: st });
  }
  return { counts, active, cls };
}

// Сумма статов: экипировка + руны + бонусы комплектов (для героя heroId) + действующие эликсиры
function gearStats(pr, heroId = null) {
  const total = {};
  const add = (st) => { for (const [k, v] of Object.entries(st)) total[k] = (total[k] || 0) + v; };
  for (const slot of SLOT_ORDER) {
    const it = findItem(pr, pr.equip?.[slot]);
    if (!it) continue;
    add(itemStats(it));
    for (const r of it.runes || []) add(itemStats(r));
  }
  if (heroId) for (const b of setState(pr, heroId).active) add(b.stats);
  const now = Date.now();
  for (const [k, st] of Object.entries(BUFF_STATS)) if ((pr.buffs || {})[k] > now) add(st);
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

// Снять предмет отовсюду (экипировка) и вернуть руны в сумку
function detach(pr, it) {
  for (const r of it.runes || []) { r.loc = 'bag'; pr.items.push(r); }
  it.runes = it.cat === 'weapon' ? [] : undefined;
  for (const s of Object.keys(pr.equip || {})) if (pr.equip[s] === it.id) pr.equip[s] = null;
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
  for (const it of items) detach(pr, it);
  // 3 случайных атрибута из всех атрибутов пяти предметов
  const pool = items.flatMap((i) => i.attrs).sort(() => Math.random() - 0.5);
  const attrs = [];
  for (const a of pool) { if (attrs.length >= 3) break; if (!attrs.some((x) => x.k === a.k)) attrs.push({ ...a }); }
  const tier = Math.round(items.reduce((s, i) => s + i.tier, 0) / 5);
  // Комплектная вещь получается, только если все пять — вещи одного комплекта
  const sameSet = items.every((i) => setIdOf(i) && setIdOf(i) === setIdOf(items[0]));
  const tpl = sameSet ? items[0].tpl : pick(items.filter((i) => !setIdOf(i)).map((i) => i.tpl).concat(plainTpls(cat)).slice(0, 5));
  const result = { id: newId(), cat, tpl: TEMPLATES[cat][tpl] ? tpl : pick(plainTpls(cat)), rar: next, tier, attrs, dupes: 0, loc: 'bag' };
  if (cat === 'weapon') result.runes = [];
  pr.items = pr.items.filter((i) => !uniq.includes(i.id));
  pr.items.push(result);
  return { item: result, lost: pool.length - attrs.length };
}

// ---------- Ковка ----------
// Стоимость улучшения предмета до следующей редкости: свиток + материалы мира предмета + золото
const UPGRADE = {
  rare:      { scroll: 'scrollR', ore: 5,  ess: 0,  core: 0, gold: 150 },
  epic:      { scroll: 'scrollE', ore: 12, ess: 5,  core: 0, gold: 600 },
  legendary: { scroll: 'scrollL', ore: 25, ess: 15, core: 1, gold: 2500 },
  mythic:    { scroll: 'scrollM', ore: 50, ess: 30, core: 3, gold: 8000 },
};
const SET_CRAFT = { ore: 15, ess: 10, core: 1, gold: 1500 };
function upgradeCost(it) {
  const next = RARITY_ORDER[RARITY_ORDER.indexOf(it.rar) + 1];
  if (!next || it.cat === 'rune') return null;
  const u = UPGRADE[next], t = it.tier;
  const need = { [u.scroll]: 1, [`ore${t}`]: u.ore };
  if (u.ess) need[`ess${t}`] = u.ess;
  if (u.core) need[`core${t}`] = u.core;
  return { next, need, gold: Math.round(u.gold * TIER_MULT[t]) };
}
function setCraftCost(it, sid) {
  const t = it.tier;
  return { need: { [`bp_${sid}`]: 1, [`ore${t}`]: SET_CRAFT.ore, [`ess${t}`]: SET_CRAFT.ess, [`core${t}`]: SET_CRAFT.core }, gold: Math.round(SET_CRAFT.gold * TIER_MULT[t]) };
}
// Разбор: материалы мира предмета
function salvage(it) {
  const t = it.tier, r = RARITY_ORDER.indexOf(it.rar);
  const out = { [`ore${t}`]: [1, 3, 6, 12, 25][r] };
  const ess = [0, 0, 3, 8, 20][r];
  if (ess) out[`ess${t}`] = ess;
  if (r === 4 || (r === 3 && Math.random() < 0.3)) out[`core${t}`] = 1;
  if (it.cat === 'rune') { out[`ess${t}`] = (out[`ess${t}`] || 0) + 1 + r; delete out[`ore${t}`]; }
  return out;
}

// ---------- Совместимость со старыми профилями (слоты jewel1/jewel2) ----------
const OLD_JEWEL = { ringPow: 'ring', ringAgi: 'ring', bracer: 'ring', earring: 'ring', amuLife: 'amulet', amuMind: 'amulet' };
function migrate(pr) {
  for (const it of pr.items || []) {
    if (it.cat === 'jewel') { it.cat = OLD_JEWEL[it.tpl] || 'ring'; if (it.tpl === 'earring') it.tpl = 'ringWind'; }
    if (!TEMPLATES[it.cat] || !TEMPLATES[it.cat][it.tpl]) { it.tpl = plainTpls(TEMPLATES[it.cat] ? it.cat : (it.cat = 'ring'))[0]; }
  }
  const eq = pr.equip || {};
  if ('jewel1' in eq || 'jewel2' in eq) {
    for (const s of ['jewel1', 'jewel2']) {
      const it = findItem(pr, eq[s]);
      if (it && !eq[it.cat]) eq[it.cat] = it.id;
      delete eq[s];
    }
  }
  pr.mats ??= {};
}

// Описание предмета для клиента
function itemView(it) {
  const t = TEMPLATES[it.cat][it.tpl];
  const R = ITEM_RARITIES[it.rar];
  const sid = setIdOf(it);
  const set = sid ? { id: sid, name: SETS[sid].name, cls: SETS[sid].cls, clsName: CLASSES[SETS[sid].cls].name, heroes: CLASSES[SETS[sid].cls].heroes, bonus: SETS[sid].bonus } : null;
  return {
    id: it.id, cat: it.cat, tpl: it.tpl, rar: it.rar, tier: it.tier, dupes: it.dupes || 0, loc: it.loc || 'bag',
    name: t.name + (set ? ` ${SETS[sid].short}` : TIER_NAME[it.tier]) + (it.dupes ? ` +${it.dupes}` : ''), icon: t.icon, color: R.color, rarName: R.name,
    attrs: it.attrs, stats: itemStats(it), sockets: it.cat === 'weapon' ? R.sockets : 0, set,
    runes: (it.runes || []).map(itemView), sell: Math.round(R.sell * TIER_MULT[it.tier] * (1 + 0.2 * (it.dupes || 0)) * (set ? 1.5 : 1)),
  };
}

module.exports = {
  RARITY_ORDER, ITEM_RARITIES, TEMPLATES, ATTRS, CATEGORIES, SLOTS, SLOT_ORDER, SLOT_NAMES, TIER_MULT, DUPE_MAX, DUPE_STEP,
  CLASSES, CLASS_ORDER, classOf, SETS, setIdOf, MATS, BUFF_STATS, UPGRADE, SET_CRAFT,
  createItem, createSetItem, rollItem, rollRarity, rollAttrs, itemStats, gearStats, setState, findItem, addItem, detach, mergeItems,
  upgradeCost, setCraftCost, salvage, addMat, takeMats, matView, matPrice, migrate, itemView, plainTpls,
};
