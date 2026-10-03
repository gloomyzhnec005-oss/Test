// Игровые константы, общие для сервера (клиент получает их при входе)
module.exports = {
  TILE: 32,
  MAP_W: 80,
  MAP_H: 80,
  TICK_MS: 100, // 10 тиков в секунду

  // Три стартовых персонажа
  CLASSES: {
    warrior: {
      name: 'Воин',
      role: 'Танк · ближний бой', difficulty: 1,
      desc: 'Закован в броню и не боится толпы монстров. Рубит мечом всех, кто подойдёт близко.',
      hp: 160, dmg: 20, range: 56, cooldown: 650, speed: 150,
      color: 0xd9534f, projectile: null,
      resource: { name: 'Энергия', max: 100, color: '#f0b429' },
    },
    mage: {
      name: 'Маг',
      role: 'Маг · дальний бой', difficulty: 3,
      desc: 'Сжигает врагов огненными шарами с большого расстояния. Мощный, но хрупкий.',
      hp: 95, dmg: 30, range: 230, cooldown: 1100, speed: 140,
      color: 0x5b7cfa, projectile: 'fireball',
      resource: { name: 'Мана', max: 150, color: '#4d8dff' },
    },
    archer: {
      name: 'Лучник',
      role: 'Стрелок · дальний бой', difficulty: 2,
      desc: 'Самый быстрый герой. Держит дистанцию и осыпает врагов градом стрел.',
      hp: 115, dmg: 15, range: 270, cooldown: 550, speed: 170,
      color: 0x3fa34d, projectile: 'arrow',
      resource: { name: 'Энергия', max: 110, color: '#f0b429' },
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
