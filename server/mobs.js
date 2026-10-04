// Монстры (75 видов + призываемые миньоны), их классы, умения и баланс по уровням.
// Модель баланса: монстр уровня L рассчитывается от ожидаемой силы героя того же уровня с типичной экипировкой.
//   PD(L) — урон обычной атаки героя, PH(L) — здоровье героя.
//   Здоровье монстра = PD(L) × hpK (сколько ударов героя он держит), урон удара = PH(L) × dmgK (доля здоровья героя).
//   Монстры ходят стаями по 3–5: dmgK подобран так, чтобы вся стая наносила ~6–8% здоровья героя в секунду,
//   а герой своего уровня зачищал стаю за 10–15 с, теряя 30–50% здоровья (умения и зелья решают исход).
// «Ход» в описаниях умений = 2 секунды.
const TURN = 2000;
// Ожидаемая сила героя: базовый рост от уровня × экипировка «редкого» уровня своего мира
const PD = (L) => 20 * (1 + 0.1 * (L - 1)) * (1 + 0.025 * (L - 1));
const PH = (L) => 140 * (1 + 0.12 * (L - 1)) * (1 + 0.022 * (L - 1));
const XP_LEVEL = (L) => Math.round(40 * Math.pow(L, 1.6)); // как xpForLevel на сервере
const KILLS_PER_LEVEL = (L) => 200 + 12 * L; // обычных убийств на уровень
const MAX_LEVEL = 50;

// Базовые параметры классов: hpK, dmgK, перезарядка атаки, скорость, дальность (0 — ближний бой)
const CLASS = {
  melee:    { hpK: 4,   dmgK: 0.015, cd: 1100, speed: 80,  range: 0 },
  ranged:   { hpK: 3,   dmgK: 0.014, cd: 1600, speed: 70,  range: 220, proj: 'arrow' },
  mage:     { hpK: 3,   dmgK: 0.022, cd: 2000, speed: 60,  range: 200, proj: 'arcane' },
  tank:     { hpK: 9,   dmgK: 0.015, cd: 1500, speed: 50,  range: 0 },
  assassin: { hpK: 3,   dmgK: 0.021, cd: 900,  speed: 115, range: 0 },
  summoner: { hpK: 4,   dmgK: 0.011, cd: 1800, speed: 55,  range: 180, proj: 'necro' },
  support:  { hpK: 3.5, dmgK: 0.009, cd: 1800, speed: 60,  range: 170, proj: 'holy' },
  minion:   { hpK: 2,   dmgK: 0.009, cd: 1100, speed: 90,  range: 0 },
};
// Ранги: множители к классу + награды (опыт в «обычных убийствах»)
const RANK = {
  normal: { hp: 1,   dmg: 1,   xp: 1,   size: 1 },
  magic:  { hp: 1.8, dmg: 1.3, xp: 3,   size: 1.1 }, // «усиленный» (синий)
  rare:   { hp: 3,   dmg: 1.6, xp: 6,   size: 1.2 }, // «редкий» (жёлтый), 1–2 свойства
  mini:   { hp: 1,   dmg: 1,   xp: 15,  size: 1.45 }, // полубосс: hpK/dmgK задаются отдельно
  boss:   { hp: 1,   dmg: 1,   xp: 40,  size: 1.8 },
  world:  { hp: 1,   dmg: 1,   xp: 100, size: 2.4 },
  summon: { hp: 0.6, dmg: 0.8, xp: 0.3, size: 0.9 },
};
// Полубосс ~20 с соло, босс ~40 с соло (герой теряет 40–70% здоровья, если уворачивается от половины телеграфов),
// мировой босс рассчитан на группу (здоровье растёт на 70% за каждого игрока на арене)
const MINI = { hpK: 30, dmgK: 0.023, cd: 1300, speed: 75 };
const BOSS = { hpK: 60, dmgK: 0.024, cd: 1500, speed: 70 };
const WORLD = { hpK: 600, dmgK: 0.035, cd: 1500, speed: 60 };

// Свойства редких монстров (как в Path of Exile)
const AFFIXES = {
  fast:     { name: 'Быстрый', speed: 1.35, cd: 0.8 },
  armored:  { name: 'Бронированный', taken: 0.7 },
  vampiric: { name: 'Вампирический', lifesteal: 0.2 },
  burning:  { name: 'Пылающий', aura: 0.015 }, // жжёт героев рядом: доля PH в секунду
  regen:    { name: 'Регенерирующий', regen: 0.02 },
  brutal:   { name: 'Жестокий', dmg: 1.3 },
};

const M = {};
function mob(id, name, cls, o = {}) {
  M[id] = { id, name, cls, rank: o.rank || 'normal', ...CLASS[cls], ...(o.rank === 'mini' ? MINI : o.rank === 'boss' ? BOSS : o.rank === 'world' ? WORLD : {}), ...o };
}

// ---------- БЛИЖНИЙ БОЙ ----------
mob('goblinRaider', 'Гоблин-рубака', 'melee', { hpK: 2.5, dmgK: 0.011, speed: 105, pack: 1.3, ab: { type: 'dash', mult: 1.3, range: 220, cd: 7000 }, look: { b: 'hum', skin: '#6aa040', cloth: '#7a5a3a', head: 'ears', wpn: 'sword', sz: 0.8 } });
mob('orcWarrior', 'Орк-воин', 'melee', { hpK: 6, dmgK: 0.0189, speed: 60, ab: { type: 'stunHit', mult: 1.5, ms: TURN / 2, cd: 8000 }, look: { b: 'hum', skin: '#5f8f30', cloth: '#5a3a1a', head: 'tusks', wpn: 'axe', sz: 1.1 } });
mob('skeletonSword', 'Скелет-мечник', 'melee', { undead: true, revive: 0.5, ab: { type: 'spin', r: 80, mult: 1.2, cd: 7000 }, look: { b: 'hum', skin: '#ece6cc', cloth: '#ece6cc', head: 'skull', wpn: 'sword', bones: true } });
mob('zombieBerserk', 'Зомби-берсерк', 'melee', { undead: true, speed: 45, dmgK: 0.0189, enrage: { below: 0.3, mult: 1.5 }, look: { b: 'hum', skin: '#7a9a6a', cloth: '#4a4a3a', head: 'none', wpn: 'none', torn: true } });
mob('alphaWolf', 'Волк-альфа', 'melee', { speed: 125, ab: { type: 'summon', mob: 'wolf', n: 2, cap: 4, cd: 12000 }, look: { b: 'beast', fur: '#6a6a72', eye: '#ffde3a', sz: 1.1 } });
mob('minotaur', 'Минотавр', 'tank', { hpK: 10, dmgK: 0.0205, speed: 65, ab: { type: 'dash', mult: 1.6, range: 260, knock: 80, cd: 8000 }, look: { b: 'hum', skin: '#7a4a2a', cloth: '#5a3a1a', head: 'bull', wpn: 'axe', sz: 1.3 } });
mob('vampireDuelist', 'Вампир-дуэлянт', 'melee', { speed: 115, lifesteal: 0.3, look: { b: 'hum', skin: '#e8e0f0', cloth: '#5a0a1a', head: 'collar', wpn: 'sword' } });
mob('stoneGolem', 'Каменный голем', 'tank', { hpK: 14, speed: 35, ab: { type: 'aoe', r: 120, mult: 1.6, delay: 900, cd: 9000, color: 0x8a6a4a }, look: { b: 'golem', col: '#8a8580', glow: '#c8a040', sz: 1.3 } });
mob('demonButcher', 'Демон-мясник', 'melee', { dmgK: 0.0189, speed: 95, fire: true, onHit: { dot: 0.012, ms: 3 * TURN, kind: 'bleed' }, look: { b: 'hum', skin: '#a02a2a', cloth: '#3a1a1a', head: 'horns', wpn: 'cleaver' } });
mob('lycanthrope', 'Ликантроп', 'melee', { ab: { type: 'form', every: 8000 }, look: { b: 'beast', fur: '#5a4a3a', eye: '#9aff6a', upright: true } });
// ---------- ДАЛЬНИЙ БОЙ ----------
mob('goblinArcher', 'Гоблин-лучник', 'ranged', { hpK: 2, dmgK: 0.0095, ab: { type: 'multi', n: 3, mult: 0.7, cd: 7000 }, look: { b: 'hum', skin: '#6aa040', cloth: '#4a6a2a', head: 'ears', wpn: 'bow', sz: 0.8 } });
mob('skeletonXbow', 'Скелет-арбалетчик', 'ranged', { undead: true, pierce: 0.3, proj: 'bolt', look: { b: 'hum', skin: '#ece6cc', cloth: '#ece6cc', head: 'skull', wpn: 'xbow', bones: true } });
mob('darkHunter', 'Тёмный охотник', 'ranged', { speed: 100, ab: { type: 'trap', ms: TURN / 2, cd: 9000 }, look: { b: 'hum', skin: '#c8a080', cloth: '#2a2a2a', head: 'hood', wpn: 'bow' } });
mob('orcThrower', 'Орк-метатель', 'ranged', { hpK: 4, dmgK: 0.0142, range: 180, proj: 'axe', ab: { type: 'multi', n: 2, mult: 1, cd: 6000 }, look: { b: 'hum', skin: '#5f8f30', cloth: '#5a3a1a', head: 'tusks', wpn: 'axe' } });
mob('phantomArcher', 'Призрачный стрелок', 'ranged', { undead: true, noclip: true, sure: true, proj: 'spirit', look: { b: 'ghost', col: '#9ad8ff', wpn: 'bow' } });
mob('banditXbow', 'Бандит-арбалетчик', 'ranged', { proj: 'venom', onHit: { dot: 0.008, ms: 4 * TURN, kind: 'poison' }, look: { b: 'hum', skin: '#d8a880', cloth: '#5a4a2a', head: 'bandana', wpn: 'xbow' } });
mob('harpy', 'Гарпия', 'ranged', { range: 150, speed: 110, fly: true, noclip: true, proj: 'feather', ab: { type: 'dash', mult: 1.5, range: 260, cd: 8000 }, look: { b: 'bird', col: '#a07a52', face: '#e8c8a8' } });
mob('centaurArcher', 'Кентавр-лучник', 'ranged', { speed: 120, kite: true, ab: { type: 'multi', n: 2, mult: 0.9, cd: 7000, retreat: 90 }, look: { b: 'centaur', fur: '#8a5a3a', skin: '#d8a880', wpn: 'bow' } });
// ---------- МАГИ ----------
mob('darkMage', 'Тёмный маг', 'mage', { hpK: 2.2, dmgK: 0.0221, proj: 'dark', look: { b: 'hum', skin: '#c8b8d8', cloth: '#2a1a3a', head: 'hood', wpn: 'staff', gem: '#b06aff' } });
mob('fireCultist', 'Культист огня', 'mage', { fire: true, proj: 'fireball', onHit: { dot: 0.01, ms: 3 * TURN, kind: 'burn' }, look: { b: 'hum', skin: '#d8a880', cloth: '#8a1a10', head: 'hood', wpn: 'staff', gem: '#ff8a1a' } });
mob('iceWarlock', 'Ледяной колдун', 'mage', { proj: 'frost', onHit: { slow: 3000 }, ab: { type: 'ccShot', cc: 'freeze', ms: TURN / 2, cd: 8000 }, look: { b: 'hum', skin: '#c8e0f0', cloth: '#2a5a8a', head: 'hood', wpn: 'staff', gem: '#8ad3ff' } });
mob('necromancer', 'Некромант', 'summoner', { undead: true, ab: { type: 'summon', mob: 'skeleton', n: 2, cap: 4, cd: 11000 }, look: { b: 'hum', skin: '#b8c8b0', cloth: '#1a2a1a', head: 'hood', wpn: 'staff', gem: '#5fffb0' } });
mob('elementalist', 'Элементалист', 'mage', { ab: { type: 'element', cd: 5000 }, proj: 'spark', look: { b: 'hum', skin: '#e0c8a8', cloth: '#3a6a8a', head: 'wizard', wpn: 'staff', gem: '#ffe94a' } });
mob('cursedPriest', 'Проклятый жрец', 'mage', { dmgK: 0.0126, ab: { type: 'curse', ms: 3 * TURN, cd: 10000 }, proj: 'dark', look: { b: 'hum', skin: '#a8a0a0', cloth: '#3a1a2a', head: 'hood', wpn: 'staff', gem: '#c0304a' } });
mob('chaosMage', 'Маг хаоса', 'mage', { ab: { type: 'chaos', cd: 6000 }, proj: 'illusion', look: { b: 'hum', skin: '#d8c8e8', cloth: '#5a1a6a', head: 'wizard', wpn: 'staff', gem: '#ff6ad8' } });
mob('druid', 'Друид-отступник', 'mage', { reflect: 0.2, proj: 'leaf', look: { b: 'hum', skin: '#c8a880', cloth: '#3a5a2a', head: 'antlers', wpn: 'staff', gem: '#7fe08a' } });
mob('pyromancer', 'Пиромант', 'mage', { fire: true, proj: 'fireball', ab: { type: 'aoe', r: 110, mult: 1.8, delay: 1000, cd: 9000, color: 0xff6a1a, dot: { dot: 0.01, ms: 3 * TURN, kind: 'burn' } }, look: { b: 'hum', skin: '#e8b080', cloth: '#c0401a', head: 'none', wpn: 'staff', gem: '#ffb030' } });
mob('cryomancer', 'Криомант', 'mage', { proj: 'frost', ab: { type: 'aoe', r: 160, mult: 0.8, delay: 1000, cd: 10000, color: 0x8ad3ff, slow: 4000 }, look: { b: 'hum', skin: '#d8f0ff', cloth: '#5a8ac0', head: 'wizard', wpn: 'staff', gem: '#bfe8ff' } });
// ---------- ТАНКИ ----------
mob('stoneGuard', 'Каменный страж', 'tank', { taken: 0.7, ab: { type: 'selfDef', mult: 0.5, ms: 2 * TURN, cd: 9000 }, look: { b: 'golem', col: '#9a9590', glow: '#5fb0ff' } });
mob('ironGolem', 'Железный голем', 'tank', { physImmune: 0.5, ab: { type: 'selfDef', mult: 0, ms: TURN, physOnly: true, cd: 8000 }, look: { b: 'golem', col: '#6a7080', glow: '#ff6a3a' } });
mob('ent', 'Древний энт', 'tank', { speed: 35, regen: 0.01, ab: { type: 'trap', ms: TURN, heal: 0.08, range: 200, cd: 9000 }, look: { b: 'tree', col: '#5a3a20', leaf: '#3f8a2f' } });
mob('boneTitan', 'Костяной титан', 'tank', { undead: true, hpK: 11, ab: { type: 'shield', frac: 0.25, cd: 10000 }, look: { b: 'golem', col: '#e8e2cc', glow: '#5fffb0', bones: true } });
mob('hellGuard', 'Демонический страж', 'tank', { fire: true, reflect: 0.25, look: { b: 'hum', skin: '#8a1a1a', cloth: '#2a2a2a', head: 'horns', wpn: 'shield', sz: 1.2 } });
mob('iceColossus', 'Ледяной колосс', 'tank', { hpK: 11, speed: 40, freezeOnHit: TURN / 2, look: { b: 'golem', col: '#a8d8f0', glow: '#ffffff' } });
mob('cursedKnight', 'Проклятый рыцарь', 'tank', { taken: 0.8, lifesteal: 0.25, dmgK: 0.0158, look: { b: 'hum', skin: '#2a2a32', cloth: '#3a3a48', head: 'helm', wpn: 'greatsword', eye: '#ff3a3a' } });
// ---------- АССАСИНЫ ----------
mob('shadow', 'Тень', 'assassin', { stealth: true, backstab: 2, noclip: false, look: { b: 'ghost', col: '#2a2a3a', eye: '#c070ff' } });
mob('nightBlade', 'Клинок ночи', 'assassin', { crit: 0.25, ab: { type: 'critHit', mult: 2.5, cd: 7000 }, look: { b: 'hum', skin: '#c8a090', cloth: '#1a1a2a', head: 'mask', wpn: 'daggers' } });
mob('poisonSpider', 'Ядовитый паук', 'assassin', { onHit: { dot: 0.008, ms: 3 * TURN, kind: 'poison' }, ab: { type: 'trap', ms: TURN, range: 200, cd: 9000, web: true }, look: { b: 'spider', col: '#3a5a2a', eye: '#ff3030' } });
mob('temptress', 'Демон-искуситель', 'assassin', { ab: { type: 'mind', ms: TURN, cd: 12000 }, look: { b: 'hum', skin: '#d87a9a', cloth: '#5a0a3a', head: 'horns', wpn: 'whip', wings: '#5a0a3a' } });
mob('phantomAssassin', 'Призрачный убийца', 'assassin', { undead: true, noclip: true, pierce: 1, look: { b: 'ghost', col: '#8a9ab8', wpn: 'daggers' } });
mob('bloodReaper', 'Кровавый жнец', 'assassin', { harvest: 0.1, look: { b: 'hum', skin: '#3a1a1a', cloth: '#5a0a0a', head: 'hood', wpn: 'scythe', eye: '#ff2a2a' } });
// ---------- ПРИЗЫВАТЕЛИ ----------
mob('skeletonLord', 'Повелитель скелетов', 'summoner', { undead: true, ab: { type: 'summon', mob: 'skeleton', n: 3, cap: 6, cd: 12000 }, look: { b: 'hum', skin: '#ece6cc', cloth: '#3a2a4a', head: 'crown', wpn: 'staff', gem: '#5fffb0', bones: true } });
mob('demonologist', 'Демонолог', 'summoner', { ab: { type: 'summon', mob: 'imp', n: 1, cap: 2, cd: 10000 }, look: { b: 'hum', skin: '#c8a080', cloth: '#4a0a0a', head: 'hood', wpn: 'book', gem: '#ff3a1a' } });
mob('spiderMatriarch', 'Паук-матриарх', 'summoner', { hpK: 6, range: 0, ab: { type: 'summon', mob: 'spiderling', n: 4, cap: 8, cd: 12000 }, look: { b: 'spider', col: '#4a2a3a', eye: '#ffde3a', sz: 1.3 } });
mob('goblinShaman', 'Гоблин-шаман', 'summoner', { ab: { type: 'summon', mob: 'goblin', n: 2, cap: 4, cd: 12000 }, totem: { atk: 1.3, r: 200, only: 'goblin' }, look: { b: 'hum', skin: '#6aa040', cloth: '#8a3a2a', head: 'feathers', wpn: 'staff', gem: '#9ff0ff', sz: 0.85 } });
mob('lich', 'Лич', 'summoner', { undead: true, ab: { type: 'summon', mob: 'zombie', n: 2, cap: 4, cd: 11000 }, look: { b: 'hum', skin: '#d8e8d0', cloth: '#1a1a2a', head: 'crown', wpn: 'staff', gem: '#5fffb0', bones: true } });
// ---------- ПОДДЕРЖКА ----------
mob('goblinHealer', 'Гоблин-знахарь', 'support', { hpK: 2.5, ab: { type: 'heal', frac: 0.2, r: 220, cd: 6000 }, look: { b: 'hum', skin: '#6aa040', cloth: '#3a6a3a', head: 'ears', wpn: 'staff', gem: '#7dff8a', sz: 0.8 } });
mob('darkPriest', 'Тёмный жрец', 'support', { ab: { type: 'buff', stat: 'atk', mult: 1.2, r: 220, ms: 8000, cd: 10000 }, look: { b: 'hum', skin: '#c8b0b0', cloth: '#2a0a1a', head: 'hood', wpn: 'staff', gem: '#c0304a' } });
mob('skeletonBanner', 'Скелет-знаменосец', 'support', { undead: true, range: 0, aura: { atk: 1.15, r: 220 }, look: { b: 'hum', skin: '#ece6cc', cloth: '#ece6cc', head: 'skull', wpn: 'banner', bones: true } });
mob('demonHerald', 'Демон-герольд', 'support', { fire: true, ab: { type: 'buff', stat: 'spd', mult: 1.3, r: 240, ms: 8000, cd: 10000 }, look: { b: 'hum', skin: '#c04a2a', cloth: '#2a0a0a', head: 'horns', wpn: 'horn' } });
mob('crystalGuardian', 'Кристальный страж', 'support', { hpK: 5, ab: { type: 'shieldAlly', frac: 0.3, r: 220, cd: 9000 }, look: { b: 'golem', col: '#b08ae0', glow: '#e0c0ff' } });
// ---------- ПОЛУБОССЫ ----------
mob('orcChief', 'Орк-вождь', 'melee', { rank: 'mini', enrage: { below: 0.4, mult: 1.5 }, ab: { type: 'stunHit', mult: 1.8, ms: TURN / 2, cd: 8000 }, look: { b: 'hum', skin: '#4f7a28', cloth: '#7a2a1a', head: 'tusksHelm', wpn: 'axe', sz: 1.2 } });
mob('necroPriest', 'Некро-жрец', 'summoner', { rank: 'mini', undead: true, range: 190, proj: 'necro', ab: { type: 'resurrect', n: 3, r: 300, cd: 12000, heal: 0.15 }, look: { b: 'hum', skin: '#b8c8b0', cloth: '#0a2a1a', head: 'crown', wpn: 'staff', gem: '#5fffb0' } });
mob('dragonWhelp', 'Дракон-детёныш', 'melee', { rank: 'mini', fire: true, fly: true, noclip: true, ab: { type: 'cone', r: 170, mult: 1.6, delay: 800, cd: 7000, color: 0xff6a1a, dot: { dot: 0.01, ms: 2 * TURN, kind: 'burn' } }, look: { b: 'dragon', col: '#c03a30', belly: '#f0a05a', sz: 0.8 } });
mob('skeletonKing', 'Король скелетов', 'melee', { rank: 'mini', undead: true, aura: { atk: 1.2, r: 260, only: 'undead' }, ab: { type: 'aoe', r: 140, mult: 1.6, delay: 900, cd: 8000, color: 0xece6cc }, look: { b: 'hum', skin: '#ece6cc', cloth: '#5a2a8a', head: 'crown', wpn: 'greatsword', bones: true } });
mob('demonExecutioner', 'Демон-палач', 'melee', { rank: 'mini', fire: true, execute: { below: 0.25, mult: 4 }, look: { b: 'hum', skin: '#7a1a1a', cloth: '#1a1a1a', head: 'hoodHorns', wpn: 'bigaxe' } });
mob('gryphon', 'Грифон', 'melee', { rank: 'mini', fly: true, noclip: true, speed: 110, ab: { type: 'dash', mult: 2, range: 320, knock: 90, cd: 7000 }, look: { b: 'bird', col: '#c8a060', face: '#f4ecd8', beak: true } });
mob('trollShaman', 'Тролль-шаман', 'mage', { rank: 'mini', range: 190, proj: 'nature', regenTurn: 0.05, ab: { type: 'curse', ms: 3 * TURN, cd: 9000 }, look: { b: 'hum', skin: '#6a8a5a', cloth: '#5a3a20', head: 'troll', wpn: 'staff', gem: '#9aff6a', sz: 1.2 } });
mob('vampireLord', 'Вампир-лорд', 'melee', { rank: 'mini', speed: 110, lifesteal: 0.3, ab: { type: 'aoe', r: 130, mult: 1.4, delay: 700, cd: 8000, color: 0xc0101a, drain: 0.5 }, look: { b: 'hum', skin: '#f0e8f4', cloth: '#3a0a1a', head: 'collar', wpn: 'sword', wings: '#3a0a1a' } });
mob('stoneTitan', 'Каменный титан', 'tank', { rank: 'mini', speed: 40, taken: 0.8, ab: { type: 'aoe', r: 200, mult: 1.2, delay: 1100, cd: 10000, color: 0x8a6a4a, cc: 'stun', ms: TURN / 2 }, look: { b: 'golem', col: '#7a756e', glow: '#e8c060' } });
// ---------- БОССЫ ДАНЖЕЙ ----------
mob('ancientDragon', 'Древний дракон', 'melee', { rank: 'boss', fire: true, fly: true, noclip: true, ab: { type: 'aoe', r: 230, mult: 2, delay: 1300, cd: 8000, color: 0xff6a1a, dot: { dot: 0.012, ms: 2 * TURN, kind: 'burn' } }, look: { b: 'dragon', col: '#8a1a14', belly: '#f0a05a' } });
mob('lichKing', 'Король личей', 'summoner', { rank: 'boss', undead: true, range: 210, proj: 'necro', ab: { type: 'summon', mob: 'skeleton', n: 5, cap: 10, cd: 14000, resurrect: 3 }, look: { b: 'hum', skin: '#d8e8d0', cloth: '#1a0a2a', head: 'crown', wpn: 'staff', gem: '#5fffb0', bones: true } });
mob('abyssTitan', 'Титан бездны', 'tank', { rank: 'boss', magicImmune: 0.3, ab: { type: 'aoe', r: 90, mult: 2.4, delay: 1000, cd: 7000, color: 0x6a1aaa, onTarget: true, pierce: 1 }, look: { b: 'golem', col: '#2a1a3a', glow: '#b06aff' } });
mob('demonLord', 'Демон-повелитель', 'melee', { rank: 'boss', fire: true, ab: { type: 'mind', ms: 1.5 * TURN, self: true, cd: 11000 }, look: { b: 'hum', skin: '#8a0a0a', cloth: '#1a0a0a', head: 'bigHorns', wpn: 'bigaxe', wings: '#3a0a0a' } });
mob('fallenAngel', 'Падший ангел', 'mage', { rank: 'boss', range: 220, proj: 'holy', ab: { type: 'aoe', r: 120, mult: 1.8, delay: 1000, cd: 8000, color: 0xfff0a0, onTarget: true, curse: 3 * TURN }, look: { b: 'hum', skin: '#f0e8e0', cloth: '#e8e0f0', head: 'halo', wpn: 'sword', wings: '#3a3a4a' } });
mob('kraken', 'Кракен', 'tank', { rank: 'boss', speed: 30, ab: { type: 'aoe', r: 420, mult: 0.8, delay: 1300, cd: 11000, color: 0x3a6a8a, cc: 'root', ms: TURN }, look: { b: 'kraken', col: '#5a2a5a' } });
mob('gorgonBoss', 'Горгона', 'mage', { rank: 'boss', range: 200, proj: 'venom', ab: { type: 'aoe', r: 260, mult: 0.6, delay: 1400, cd: 12000, color: 0xffe040, cc: 'stun', ms: 2 * TURN }, look: { b: 'hum', skin: '#b8d8a8', cloth: '#3a5a3a', head: 'snakes', wpn: 'bow', tail: true } });
mob('phoenix', 'Феникс', 'mage', { rank: 'boss', fire: true, fly: true, noclip: true, revive: 0.5, range: 200, proj: 'fireball', ab: { type: 'aoe', r: 150, mult: 1.6, delay: 1000, cd: 8000, color: 0xffa020, dot: { dot: 0.01, ms: 2 * TURN, kind: 'burn' } }, look: { b: 'bird', col: '#ff6a1a', face: '#ffd03a', fire: true } });
mob('cerberus', 'Цербер', 'melee', { rank: 'boss', fire: true, speed: 95, ab: { type: 'multi', n: 3, mult: 0.9, cd: 6000 }, look: { b: 'dog3', fur: '#3a2a2a', eye: '#ff6a1a' } });
mob('chaosLord', 'Повелитель хаоса', 'mage', { rank: 'boss', range: 210, proj: 'illusion', ab: { type: 'chaos', cd: TURN, big: true }, look: { b: 'hum', skin: '#c8a8e8', cloth: '#3a0a4a', head: 'bigHorns', wpn: 'staff', gem: '#ff6ad8', wings: '#2a0a3a' } });
// ---------- МИРОВЫЕ БОССЫ ----------
mob('legion', 'Проклятый легион', 'melee', { rank: 'world', undead: true, legion: { n: 3, cd: 5000 }, enrage: { below: 0.5, mult: 1.5, allies: true }, ab: { type: 'aoe', r: 200, mult: 1.5, delay: 1200, cd: 8000, color: 0x5fffb0 }, look: { b: 'blob', col: '#3a4a3a', glow: '#5fffb0' } });
mob('devourer', 'Пожиратель миров', 'tank', { rank: 'world', harvest: 0.2, devour: true, ab: { type: 'aoe', r: 220, mult: 1.6, delay: 1200, cd: 8000, color: 0x8a2a5a }, look: { b: 'kraken', col: '#2a0a1a', maw: true } });
mob('eternalDragon', 'Вечный дракон', 'melee', { rank: 'world', fly: true, noclip: true, eternity: 3 * TURN, ab: { type: 'aoe', r: 240, mult: 1.8, delay: 1200, cd: 7000, color: 0xffffff }, look: { b: 'dragon', col: '#2a6a8a', belly: '#bfe8ff' } });
mob('abyssAvatar', 'Аватар бездны', 'mage', { rank: 'world', range: 220, proj: 'dark', mirror: true, ab: { type: 'aoe', r: 150, mult: 1.6, delay: 1000, cd: 9000, color: 0xb06aff, onTarget: true }, look: { b: 'ghost', col: '#1a0a2a', eye: '#b06aff', sz: 1.4 } });
mob('chaosTitan', 'Титан хаоса', 'tank', { rank: 'world', phases: 5 * TURN, ab: { type: 'chaos', cd: TURN * 1.5, big: true }, look: { b: 'golem', col: '#4a1a5a', glow: '#ff6ad8' } });
// ---------- МИНЬОНЫ (призываются умениями) ----------
mob('wolf', 'Волк', 'minion', { rank: 'summon', speed: 120, look: { b: 'beast', fur: '#8d8d8d', eye: '#ff3030', sz: 0.85 } });
mob('skeleton', 'Скелет', 'minion', { rank: 'summon', undead: true, look: { b: 'hum', skin: '#ece6cc', cloth: '#ece6cc', head: 'skull', wpn: 'sword', bones: true, sz: 0.9 } });
mob('zombie', 'Зомби', 'minion', { rank: 'summon', undead: true, speed: 50, look: { b: 'hum', skin: '#7a9a6a', cloth: '#3a4a3a', head: 'none', wpn: 'none', torn: true, sz: 0.9 } });
mob('spiderling', 'Паучок', 'minion', { rank: 'summon', speed: 120, onHit: { dot: 0.004, ms: 2 * TURN, kind: 'poison' }, look: { b: 'spider', col: '#5a3a4a', eye: '#ffde3a', sz: 0.6 } });
mob('imp', 'Демон', 'minion', { rank: 'summon', hpK: 4, dmgK: 0.0158, fire: true, look: { b: 'hum', skin: '#c03a2a', cloth: '#2a0a0a', head: 'horns', wpn: 'claws', sz: 0.95 } });
mob('goblin', 'Гоблин', 'minion', { rank: 'summon', speed: 100, look: { b: 'hum', skin: '#6aa040', cloth: '#7a5a3a', head: 'ears', wpn: 'club', sz: 0.75 } });

// Совместимость с остальным кодом: флаги босса и «опорные» статы для подсказок клиента (на 10 уровне)
for (const def of Object.values(M)) { def.boss = def.rank === 'boss' || def.rank === 'world'; }

// Классы для подсказок
const CLASS_NAMES = { melee: 'ближний бой', ranged: 'дальний бой', mage: 'маг', tank: 'танк', assassin: 'ассасин', summoner: 'призыватель', support: 'поддержка', minion: 'миньон' };

// ---------- Данжи: 3 города × 6 порталов ----------
// lv — диапазон уровней монстров (вход с lv[0] − 2), pool — обычные монстры, minis — полубоссы, boss — босс в конце
const DUNGEONS = {
  town1: [
    { name: 'Гоблинская опушка', lv: [1, 3], pool: ['goblinRaider', 'goblinArcher', 'goblinHealer', 'goblinShaman', 'darkMage'], minis: ['alphaWolf'], boss: 'trollShaman', bossName: 'Тролль-шаман, хозяин опушки' },
    { name: 'Волчья чаща', lv: [3, 5], pool: ['alphaWolf', 'darkHunter', 'poisonSpider', 'centaurArcher', 'druid'], minis: ['spiderMatriarch'], boss: 'gryphon', bossName: 'Грифон-вожак' },
    { name: 'Старое кладбище', lv: [5, 8], pool: ['skeletonSword', 'skeletonXbow', 'zombieBerserk', 'necromancer', 'skeletonBanner', 'skeletonLord', 'phantomArcher'], minis: ['necroPriest'], boss: 'skeletonKing' },
    { name: 'Орочий лагерь', lv: [8, 10], pool: ['orcWarrior', 'orcThrower', 'banditXbow', 'minotaur', 'darkPriest', 'goblinRaider'], minis: ['minotaur'], boss: 'orcChief' },
    { name: 'Дикие холмы', lv: [10, 13], pool: ['harpy', 'stoneGolem', 'lycanthrope', 'ent', 'stoneGuard', 'iceWarlock'], minis: ['stoneGolem'], boss: 'stoneTitan' },
    { name: 'Логово дракончика', lv: [13, 15], pool: ['fireCultist', 'pyromancer', 'orcWarrior', 'harpy', 'crystalGuardian'], minis: ['demonButcher'], boss: 'dragonWhelp', bossName: 'Огненный дракончик' },
  ],
  town2: [
    { name: 'Пепельные топи', lv: [15, 18], pool: ['zombieBerserk', 'poisonSpider', 'banditXbow', 'cursedPriest', 'lich', 'spiderMatriarch'], minis: ['trollShaman', 'vampireLord'], boss: 'kraken', bossName: 'Кракен топей' },
    { name: 'Клыки Бездны', lv: [18, 20], pool: ['demonButcher', 'demonHerald', 'demonologist', 'shadow', 'nightBlade', 'hellGuard'], minis: ['demonExecutioner', 'gryphon'], boss: 'cerberus' },
    { name: 'Склепы теней', lv: [20, 23], pool: ['boneTitan', 'phantomArcher', 'phantomAssassin', 'necromancer', 'skeletonLord', 'darkPriest'], minis: ['skeletonKing', 'necroPriest'], boss: 'lichKing' },
    { name: 'Крепость падших', lv: [23, 26], pool: ['cursedKnight', 'ironGolem', 'darkMage', 'vampireDuelist', 'bloodReaper', 'temptress'], minis: ['orcChief', 'demonExecutioner'], boss: 'demonLord' },
    { name: 'Разлом душ', lv: [26, 28], pool: ['chaosMage', 'elementalist', 'darkHunter', 'shadow', 'demonHerald', 'ironGolem'], minis: ['stoneTitan', 'vampireLord'], boss: 'abyssTitan' },
    { name: 'Гнездо пепельного змея', lv: [28, 30], pool: ['pyromancer', 'fireCultist', 'hellGuard', 'demonButcher', 'harpy', 'minotaur'], minis: ['dragonWhelp', 'dragonWhelp'], boss: 'ancientDragon', bossName: 'Пепельный змей' },
  ],
  town3: [
    { name: 'Облачные луга', lv: [30, 33], pool: ['harpy', 'centaurArcher', 'druid', 'ent', 'crystalGuardian'], minis: ['gryphon', 'dragonWhelp'], boss: 'phoenix' },
    { name: 'Ветреные утёсы', lv: [33, 35], pool: ['harpy', 'iceWarlock', 'cryomancer', 'iceColossus', 'nightBlade', 'centaurArcher'], minis: ['gryphon', 'vampireLord'], boss: 'fallenAngel' },
    { name: 'Хрустальные руины', lv: [35, 38], pool: ['crystalGuardian', 'stoneGuard', 'ironGolem', 'elementalist', 'phantomArcher', 'stoneGolem'], minis: ['stoneTitan', 'necroPriest'], boss: 'gorgonBoss' },
    { name: 'Бастион бурь', lv: [38, 40], pool: ['chaosMage', 'elementalist', 'cryomancer', 'pyromancer', 'cursedKnight', 'lycanthrope'], minis: ['demonExecutioner', 'trollShaman'], boss: 'chaosLord' },
    { name: 'Звёздные острова', lv: [40, 43], pool: ['phantomAssassin', 'nightBlade', 'temptress', 'bloodReaper', 'shadow', 'darkPriest'], minis: ['skeletonKing', 'orcChief'], boss: 'cerberus', bossName: 'Звёздный Цербер' },
    { name: 'Трон небесного дракона', lv: [43, 45], pool: ['iceColossus', 'crystalGuardian', 'pyromancer', 'cryomancer', 'cursedKnight', 'minotaur'], minis: ['dragonWhelp', 'vampireLord'], boss: 'ancientDragon', bossName: 'Небесный дракон' },
  ],
};
// Мировые боссы: в каждом городе своя арена, босс возрождается по таймеру
const WORLD_BOSSES = {
  town1: { lv: 17, list: ['legion'] },
  town2: { lv: 32, list: ['devourer', 'abyssAvatar'] },
  town3: { lv: 47, list: ['eternalDragon', 'chaosTitan'] },
};
const WORLD_BOSS_RESPAWN = 20 * 60000;

// Статы монстра уровня L заданного ранга
function statsAt(def, L, rank = def.rank, affixes = []) {
  const R = RANK[rank] || RANK.normal;
  let hpK = def.hpK, dmgK = def.dmgK, cd = def.cd, speed = def.speed;
  // Обычный монстр в роли полубосса/босса: берём параметры ранга с поправкой на его «крепость» в классе
  const T = { mini: MINI, boss: BOSS, world: WORLD }[rank];
  if (T && def.rank !== rank) {
    const base = CLASS[def.cls] || CLASS.melee, from = { mini: MINI, boss: BOSS, world: WORLD }[def.rank];
    const rel = from ? { hp: def.hpK / from.hpK, dmg: def.dmgK / from.dmgK } : { hp: def.hpK / base.hpK, dmg: def.dmgK / base.dmgK };
    hpK = T.hpK * Math.sqrt(rel.hp); dmgK = T.dmgK * Math.sqrt(rel.dmg); cd = T.cd;
  }
  let hp = PD(L) * hpK * R.hp, dmg = PH(L) * dmgK * R.dmg;
  if (L < 6) dmg *= 0.6 + 0.08 * (L - 1); // первые уровни мягче для новичков
  for (const a of affixes) { const A = AFFIXES[a]; if (A.dmg) dmg *= A.dmg; if (A.cd) cd *= A.cd; if (A.speed) speed *= A.speed; }
  // Опыт: доля уровня героя (KILLS_PER_LEVEL обычных убийств на уровень) × ранг (миньоны и призванные — меньше)
  const xp = XP_LEVEL(L) / KILLS_PER_LEVEL(L) * (R.xp + (def.cls === 'tank' && rank === 'normal' ? 0.5 : 0));
  return { hp: Math.round(hp), dmg: Math.max(1, Math.round(dmg)), cd: Math.round(cd), speed: Math.round(speed), xp: Math.max(1, Math.round(xp)) };
}

module.exports = { MOBS: M, CLASS, CLASS_NAMES, RANK, AFFIXES, DUNGEONS, WORLD_BOSSES, WORLD_BOSS_RESPAWN, TURN, PD, PH, XP_LEVEL, KILLS_PER_LEVEL, MAX_LEVEL, statsAt };
