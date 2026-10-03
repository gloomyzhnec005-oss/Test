// Игровые константы, общие для сервера (клиент получает их при входе)
module.exports = {
  TILE: 32,
  MAP_W: 80,
  MAP_H: 80,
  TICK_MS: 100, // 10 тиков в секунду

  // Редкости героев: вес — относительный шанс выпадения в гаче
  RARITIES: {
    common:    { name: 'Обычный',     weight: 50, color: '#b8c4d6' },
    rare:      { name: 'Редкий',      weight: 30, color: '#4da3ff' },
    epic:      { name: 'Эпический',   weight: 15, color: '#b86bff' },
    legendary: { name: 'Легендарный', weight: 5,  color: '#ffb340' },
  },

  // Гача: первая крутка бесплатная, дальше — за Telegram Stars
  GACHA: { spinPrice: 25 },

  // Уникальные герои. У каждого своё имя, оружие, ресурс и умение (skill.id обрабатывается в server/skills.js).
  // look — параметры процедурного спрайта (public/js/textures.js)
  HEROES: {
    torvald: {
      name: 'Торвальд', title: 'Железный страж', rarity: 'common',
      desc: 'Ветеран крепостных стен. Принимает удары на щит и крушит врагов булавой.',
      hp: 180, dmg: 18, range: 56, cooldown: 700, speed: 140, projectile: null,
      color: 0x9aa3ad,
      resource: { name: 'Ярость', max: 100, regen: 6, color: '#e0533a' },
      skill: { id: 'quake', name: 'Землетряс', icon: '💥', cost: 40, cooldown: 9000,
        desc: 'Бьёт булавой о землю: урон всем врагам вокруг и оглушение на 1.5 с.' },
      look: { body: '#8a8f99', trim: '#c9a64d', legs: '#3b2a1a', head: 'helmet', headColor: '#a8b0b8', plume: '#d9534f', weapon: 'mace', offhand: 'shield' },
    },
    lira: {
      name: 'Лира', title: 'Звёздная охотница', rarity: 'common',
      desc: 'Следопыт северных лесов. Её стрелы не знают промаха даже ночью.',
      hp: 115, dmg: 15, range: 270, cooldown: 550, speed: 170, projectile: 'arrow',
      color: 0x3fa34d,
      resource: { name: 'Энергия', max: 110, regen: 8, color: '#f0b429' },
      skill: { id: 'arrowRain', name: 'Звёздный град', icon: '🌠', cost: 45, cooldown: 8000,
        desc: 'Дождь стрел над целью: урон всем врагам в области.' },
      look: { body: '#3fa34d', trim: '#6b4423', legs: '#3b2a1a', head: 'hood', headColor: '#2f6b2f', hair: '#e8c26a', weapon: 'bow', cape: '#24581b' },
    },
    eldrin: {
      name: 'Эльдрин', title: 'Пепельный маг', rarity: 'rare',
      desc: 'Изгнанник из Башни Огня. Говорят, он сжёг собственную тень.',
      hp: 95, dmg: 30, range: 230, cooldown: 1100, speed: 140, projectile: 'fireball',
      color: 0xd8562a,
      resource: { name: 'Мана', max: 150, regen: 7, color: '#4d8dff' },
      skill: { id: 'meteor', name: 'Метеор', icon: '☄️', cost: 60, cooldown: 10000,
        desc: 'Обрушивает метеор: огромный урон по цели и ожог всех рядом.' },
      look: { body: '#a8321e', trim: '#f0b429', legs: '#5a1a10', head: 'wizard', headColor: '#5a1a10', beard: '#cfcfcf', weapon: 'staff', gem: '#ff9a3a' },
    },
    mira: {
      name: 'Мира', title: 'Танцующая тень', rarity: 'rare',
      desc: 'Убийца из гильдии Безлунных. Появляется из ниоткуда и исчезает в никуда.',
      hp: 105, dmg: 17, range: 50, cooldown: 420, speed: 185, projectile: null,
      color: 0x8a5cd6,
      resource: { name: 'Энергия', max: 100, regen: 10, color: '#f0b429' },
      skill: { id: 'shadowStep', name: 'Шаг тени', icon: '🌑', cost: 35, cooldown: 7000,
        desc: 'Мгновенно переносится к цели и наносит тройной удар кинжалами.' },
      look: { body: '#3a2f4a', trim: '#8a5cd6', legs: '#1e1828', head: 'cowl', headColor: '#1e1828', eyes: '#c79bff', weapon: 'daggers' },
    },
    anselm: {
      name: 'Ансельм', title: 'Светлый брат', rarity: 'rare',
      desc: 'Монах ордена Рассвета. Его свет лечит союзников и опаляет нежить.',
      hp: 130, dmg: 16, range: 200, cooldown: 900, speed: 140, projectile: 'holy',
      color: 0xf2e6b8,
      resource: { name: 'Мана', max: 160, regen: 8, color: '#4d8dff' },
      skill: { id: 'heal', name: 'Свет исцеления', icon: '✨', cost: 50, cooldown: 12000,
        desc: 'Восстанавливает 40% здоровья себе и 25% союзникам рядом.' },
      look: { body: '#e9e2cf', trim: '#c9a64d', legs: '#8a7a5a', head: 'halo', headColor: '#ffe680', weapon: 'staff', gem: '#fff6c0' },
    },
    valgrim: {
      name: 'Вальгрим', title: 'Берсерк Севера', rarity: 'epic',
      desc: 'Сын ледяных фьордов. В бою впадает в ярость и не чувствует боли.',
      hp: 170, dmg: 24, range: 56, cooldown: 750, speed: 155, projectile: null,
      color: 0xd9752a,
      resource: { name: 'Ярость', max: 100, regen: 6, color: '#e0533a' },
      skill: { id: 'rage', name: 'Кровавая ярость', icon: '🩸', cost: 50, cooldown: 15000,
        desc: 'На 6 с: урон +60%, скорость атаки +40%.' },
      look: { body: '#6b4423', trim: '#d9d2c0', legs: '#3b2a1a', head: 'horns', headColor: '#9a9a9a', hair: '#d9752a', beard: '#d9752a', weapon: 'axe' },
    },
    sylvana: {
      name: 'Сильвана', title: 'Дочь леса', rarity: 'epic',
      desc: 'Хранительница древней рощи. Сам лес встаёт на её защиту.',
      hp: 110, dmg: 22, range: 240, cooldown: 900, speed: 160, projectile: 'nature',
      color: 0x5fd17a,
      resource: { name: 'Мана', max: 140, regen: 8, color: '#4d8dff' },
      skill: { id: 'roots', name: 'Цепкие корни', icon: '🌿', cost: 55, cooldown: 11000,
        desc: 'Корни сковывают всех врагов вокруг на 3 с и медленно их ранят.' },
      look: { body: '#2f7a4a', trim: '#a8e07a', legs: '#24402a', head: 'leafCrown', headColor: '#7fd36b', hair: '#5a3a1a', weapon: 'staff', gem: '#7fffd0' },
    },
    morven: {
      name: 'Морвен', title: 'Повелитель костей', rarity: 'legendary',
      desc: 'Некромант, обманувший смерть. Питается жизнью своих врагов.',
      hp: 125, dmg: 32, range: 220, cooldown: 1000, speed: 145, projectile: 'dark',
      color: 0x9b4dff,
      resource: { name: 'Мана', max: 170, regen: 8, color: '#4d8dff' },
      skill: { id: 'drain', name: 'Похищение жизни', icon: '💀', cost: 45, cooldown: 8000,
        desc: 'Высасывает жизнь цели: двойной урон и лечение на всю его величину.' },
      look: { body: '#1c1424', trim: '#7a2bb0', legs: '#120c18', head: 'hood', headColor: '#120c18', eyes: '#c070ff', skin: '#c9c2d6', weapon: 'scythe' },
    },
  },

  // Фоны лобби. price — цена в Telegram Stars (0 = бесплатно)
  LOBBY_BACKGROUNDS: [
    { id: 'throne', name: 'Тронный зал', price: 0 },
    { id: 'forest', name: 'Лесной алтарь', price: 0 },
    { id: 'dragon', name: 'Логово дракона', price: 50 },
    { id: 'ice', name: 'Ледяная цитадель', price: 75 },
  ],

  // Монстры. zone — минимальное расстояние от центра (в тайлах), где они появляются
  MONSTERS: {
    slime:    { name: 'Слизень',   hp: 40,  dmg: 5,  speed: 55,  xp: 12, aggro: 150, zone: 6,  color: 0x7ed957 },
    wolf:     { name: 'Волк',      hp: 75,  dmg: 9,  speed: 95,  xp: 25, aggro: 210, zone: 14, color: 0x8d8d8d },
    skeleton: { name: 'Скелет',    hp: 130, dmg: 14, speed: 75,  xp: 45, aggro: 220, zone: 22, color: 0xe8e2c8 },
    orc:      { name: 'Орк',       hp: 220, dmg: 22, speed: 70,  xp: 80, aggro: 230, zone: 30, color: 0x4f7a28 },
    dragon:   { name: 'Дракончик', hp: 600, dmg: 35, speed: 80,  xp: 300, aggro: 260, zone: 35, color: 0xb0302a, boss: true },
  },
  MONSTER_COUNT: 70,
  MONSTER_RESPAWN_MS: 12000,
  MONSTER_ATTACK_RANGE: 34,
  MONSTER_ATTACK_CD: 1100,
};
