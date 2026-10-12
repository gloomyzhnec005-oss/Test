// Нарисованные скины героев (листы 8 направлений + портрет для лобби).
// Герои без записи здесь рисуются процедурно (Gfx.hero).
// Лист: 8 рядов по направлениям (DIRS), в каждом ряду `frames` кадров ходьбы; кадр 0 — стойка.
window.Skins = (() => {
  const LIST = {
    bohai: {
      sheet: 'assets/heroes/bohai_sheet.png', portrait: 'assets/heroes/bohai_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 6 рядов по 5 кадров — вниз, вниз-вправо, вправо, вверх-вправо, вверх, поза умения
      attack: { sheet: 'assets/heroes/bohai_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // Эффекты: ряды по 6 кадров, имя ряда — что он изображает
      fx: { sheet: 'assets/heroes/bohai_fx.png', size: 72, frames: 6, rows: ['slash', 'hit', 'qiWave', 'enlighten', 'harmony', 'aura'] },
    },
    vebrand: {
      sheet: 'assets/heroes/vebrand_sheet.png', portrait: 'assets/heroes/vebrand_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 7 рядов — 5 направлений, второй удар вниз, поза умения (последний ряд)
      attack: { sheet: 'assets/heroes/vebrand_attack.png', w: 72, h: 60, frames: 5, rows: 7, cast: 6 },
      fx: { sheet: 'assets/heroes/vebrand_fx.png', size: 72, frames: 5, rows: ['slash', 'hit', 'bloodWhirl', 'furyRoar', 'stoneThrow', 'aura'] },
    },
    vayald: {
      sheet: 'assets/heroes/vayald_sheet.png', portrait: 'assets/heroes/vayald_portrait.png', w: 36, h: 48, frames: 5,
      attack: { sheet: 'assets/heroes/vayald_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      fx: { sheet: 'assets/heroes/vayald_fx.png', size: 72, frames: 6, rows: ['slash', 'hit', 'twinSlash', 'bloodFrenzy', 'blindRage', 'aura'] },
    },
    alamariel: {
      sheet: 'assets/heroes/alamariel_sheet.png', portrait: 'assets/heroes/alamariel_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 7 рядов — 5 направлений, второй выпад посохом, поза умения
      attack: { sheet: 'assets/heroes/alamariel_attack.png', w: 72, h: 60, frames: 5, rows: 7, cast: 6 },
      // bolt — летящий череп-дух (обычная атака издалека)
      fx: { sheet: 'assets/heroes/alamariel_fx.png', size: 72, frames: 7, rows: ['bolt', 'hit', 'spiritWrath', 'chainLightning', 'healTotem', 'aura'] },
    },
    ursus: {
      sheet: 'assets/heroes/ursus_sheet.png', portrait: 'assets/heroes/ursus_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 8 рядов — 5 направлений, два доп. ряда и поза умения (последний)
      attack: { sheet: 'assets/heroes/ursus_attack.png', w: 72, h: 60, frames: 5, rows: 8, cast: 7 },
      // bolt — летящее копьё
      fx: { sheet: 'assets/heroes/ursus_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'sic', 'packCall', 'spiritLink', 'aura'] },
    },
    nairi: {
      sheet: 'assets/heroes/nairi_sheet.png', portrait: 'assets/heroes/nairi_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 8 рядов — 5 направлений, два доп. ряда и поза умения (последний)
      attack: { sheet: 'assets/heroes/nairi_attack.png', w: 72, h: 60, frames: 5, rows: 8, cast: 7 },
      // bolt — летящий кинжал
      fx: { sheet: 'assets/heroes/nairi_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'markPrey', 'shadowDash', 'smokeScreen', 'aura'] },
    },
    malakor: {
      sheet: 'assets/heroes/malakor_sheet.png', portrait: 'assets/heroes/malakor_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 8 рядов — 5 направлений, два доп. ряда и поза умения (последний)
      attack: { sheet: 'assets/heroes/malakor_attack.png', w: 72, h: 60, frames: 5, rows: 8, cast: 7 },
      // bolt — теневой клинок (обычная атака издалека)
      fx: { sheet: 'assets/heroes/malakor_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'punishSeal', 'darkBlade', 'shadowJudgment', 'aura'] },
    },
    kelto: {
      sheet: 'assets/heroes/kelto_sheet.png', portrait: 'assets/heroes/kelto_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 6 рядов — 5 направлений и поза умения
      attack: { sheet: 'assets/heroes/kelto_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      fx: { sheet: 'assets/heroes/kelto_fx.png', size: 72, frames: 6, rows: ['slash', 'hit', 'lifeSteal', 'desecrate', 'raiseDead', 'aura'] },
    },
    brendan: {
      sheet: 'assets/heroes/brendan_sheet.png', portrait: 'assets/heroes/brendan_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 7 рядов — 5 направлений, второй удар и поза умения (щит вперёд)
      attack: { sheet: 'assets/heroes/brendan_attack.png', w: 72, h: 60, frames: 5, rows: 7, cast: 6 },
      fx: { sheet: 'assets/heroes/brendan_fx.png', size: 72, frames: 6, rows: ['slash', 'hit', 'shieldWall', 'taunt', 'vow', 'aura'] },
    },
    kira: {
      sheet: 'assets/heroes/kira_sheet.png', portrait: 'assets/heroes/kira_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 8 рядов — 5 направлений, два доп. ряда и поза умения (последний)
      attack: { sheet: 'assets/heroes/kira_attack.png', w: 72, h: 60, frames: 5, rows: 8, cast: 7 },
      // aura — золотое кольцо, vanish — фиолетовое (выход из дыма)
      fx: { sheet: 'assets/heroes/kira_fx.png', size: 72, frames: 6, rows: ['slash', 'hit', 'exposeStrike', 'smokeScreen', 'poisonBlade', 'aura', 'vanish'] },
    },
    kassian: {
      sheet: 'assets/heroes/kassian_sheet.png', portrait: 'assets/heroes/kassian_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 7 рядов — 5 направлений, второй удар и поза умения (последний)
      attack: { sheet: 'assets/heroes/kassian_attack.png', w: 72, h: 60, frames: 5, rows: 7, cast: 6 },
      fx: { sheet: 'assets/heroes/kassian_fx.png', size: 72, frames: 6, rows: ['slash', 'hit', 'shadowStrike', 'shadowCloak', 'execution', 'aura'] },
    },
    zukra: {
      sheet: 'assets/heroes/zukra_sheet.png', portrait: 'assets/heroes/zukra_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 7 рядов — 5 направлений, второй каст и поза умения (последний)
      attack: { sheet: 'assets/heroes/zukra_attack.png', w: 72, h: 60, frames: 5, rows: 7, cast: 6 },
      // bolt — сгусток тёмного огня; pact_* — духи «Пакта» (демон ярости, дух камня, дух ветра)
      fx: { sheet: 'assets/heroes/zukra_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'darkFlame', 'bloodCurse', 'aura', 'pact_fury', 'pact_stone', 'pact_wind'] },
    },
    nimue: {
      sheet: 'assets/heroes/nimue_sheet.png', portrait: 'assets/heroes/nimue_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 7 рядов — 5 направлений, второй каст и поза умения (последний)
      attack: { sheet: 'assets/heroes/nimue_attack.png', w: 72, h: 60, frames: 5, rows: 7, cast: 6 },
      // bolt — летящий лист-кристалл; forestWrath — лесной олень-дух
      fx: { sheet: 'assets/heroes/nimue_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'naturesThorns', 'forestBlessing', 'forestWrath', 'aura'] },
    },
    taliesin: {
      sheet: 'assets/heroes/taliesin_sheet.png', portrait: 'assets/heroes/taliesin_portrait.png', w: 36, h: 48, frames: 5,
      // Атака друида: 5 направлений и поза умения (последний ряд)
      attack: { sheet: 'assets/heroes/taliesin_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      fx: { sheet: 'assets/heroes/taliesin_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'shapeshift', 'feralCharge', 'forestBlessing', 'naturesThorns', 'aura'] },
      // Облик зверя: лист в ряд — шаг к нам, вбок (смотрит вправо, влево — зеркало), от нас; удар — прыжок с когтями
      beast: { sheet: 'assets/heroes/taliesin_beast.png', w: 60, h: 50, down: [0, 1, 2, 3, 4], side: [5, 6, 7, 8, 9], up: [10, 11, 12, 13, 14], attack: [15, 16, 17, 18, 19] },
    },
    aurelius: {
      sheet: 'assets/heroes/aurelius_sheet.png', portrait: 'assets/heroes/aurelius_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 7 рядов — 5 направлений, второй каст и поза умения (последний)
      attack: { sheet: 'assets/heroes/aurelius_attack.png', w: 72, h: 60, frames: 5, rows: 7, cast: 6 },
      // По стихиям (fire/ice/lightning/earth): снаряд, шторм, вспышка попадания и кольцо ауры
      fx: { sheet: 'assets/heroes/aurelius_fx.png', size: 72, frames: 6, rows: ['bolt_lightning', 'bolt_fire', 'bolt_ice', 'bolt_earth',
        'storm_fire', 'hit_fire', 'aura_fire', 'storm_ice', 'hit_ice', 'aura_ice', 'storm_lightning', 'hit_lightning', 'aura_lightning', 'storm_earth', 'hit_earth', 'aura_earth'] },
    },
    valerian: {
      sheet: 'assets/heroes/valerian_sheet.png', portrait: 'assets/heroes/valerian_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 6 рядов — 5 направлений и поза умения (меч в золотом сиянии)
      attack: { sheet: 'assets/heroes/valerian_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      fx: { sheet: 'assets/heroes/valerian_fx.png', size: 72, frames: 6, rows: ['slash', 'hit', 'holyVow', 'heavenStrike', 'holyAuraCast', 'aura'] },
    },
    justina: {
      sheet: 'assets/heroes/justina_sheet.png', portrait: 'assets/heroes/justina_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 7 рядов — 5 направлений, второй каст и поза умения (последний)
      attack: { sheet: 'assets/heroes/justina_attack.png', w: 72, h: 60, frames: 5, rows: 7, cast: 6 },
      // bolt — луч святого света; faith — столб с поднятыми душами (усиление веры)
      fx: { sheet: 'assets/heroes/justina_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'healingPrayer', 'banishDarkness', 'blessing', 'faith', 'aura'] },
    },
    giacomo: {
      sheet: 'assets/heroes/giacomo_sheet.png', portrait: 'assets/heroes/giacomo_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 7 рядов — 5 направлений, второй аккорд и поза умения (последний)
      attack: { sheet: 'assets/heroes/giacomo_attack.png', w: 72, h: 60, frames: 5, rows: 7, cast: 6 },
      // bolt — летящая мелодия; songSwap — купол песни (цвет меняется по ходу ряда)
      fx: { sheet: 'assets/heroes/giacomo_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'songSwap', 'resonantChord', 'ovation', 'aura'] },
    },
    orion: {
      sheet: 'assets/heroes/orion_sheet.png', portrait: 'assets/heroes/orion_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 7 рядов — 5 направлений, второй каст и поза умения (последний)
      attack: { sheet: 'assets/heroes/orion_attack.png', w: 72, h: 60, frames: 5, rows: 7, cast: 6 },
      // bolt — летящий череп; darkArrow — фиолетовая стрела тьмы; ritual — круг призыва с душами
      fx: { sheet: 'assets/heroes/orion_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'raiseCorpse', 'darkArrow', 'soulDevour', 'ritual', 'aura'] },
    },
    morvenKnight: { sheet: 'assets/heroes/morvenKnight_sheet.png', portrait: 'assets/heroes/morvenKnight_portrait.png', w: 36, h: 48, frames: 5 },
  };
  // Нарисованные монстры: лист кадров в ряд (монстр смотрит вправо), какие кадры — ходьба, какие — удар
  const MOBS = {
    goblinRaider: { sheet: 'assets/mobs/goblinRaider.png', w: 33, h: 38, walk: [0, 1, 2, 3], attack: [5, 4] },
    orcWarrior: { sheet: 'assets/mobs/orcWarrior.png', w: 44, h: 61, body: 48, walk: [0, 1, 2, 3], attack: [4, 5] },
    zombieBerserk: { sheet: 'assets/mobs/zombieBerserk.png', w: 53, h: 56, body: 48, walk: [0, 1, 2, 0], attack: [3, 4, 5] },
  };
  const DIRS = ['down', 'down-right', 'right', 'up-right', 'up', 'up-left', 'left', 'down-left'];
  // угол движения (0 = вправо, по часовой) → ряд листа
  const ROW_BY_OCTANT = [2, 1, 0, 7, 6, 5, 4, 3];
  const rowFor = (vx, vy) => ROW_BY_OCTANT[(Math.round(Math.atan2(vy, vx) / (Math.PI / 4)) + 8) % 8];

  const imgs = {};
  const load = (src) => imgs[src] || (imgs[src] = new Promise((res) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src;
  }));
  // Холст для лобби: портрет (big) или кадр «лицом вперёд»; null — скина нет
  function canvas(id, big) {
    const s = LIST[id];
    if (!s) return null;
    const c = document.createElement('canvas');
    c.className = big ? 'skin portrait' : 'skin';
    if (big) {
      c.width = 352; c.height = 600;
      load(s.portrait).then((i) => {
        if (!i) return;
        c.width = i.width; c.height = i.height;
        c.getContext('2d').drawImage(i, 0, 0);
      });
    } else {
      c.width = s.w; c.height = s.h;
      load(s.sheet).then((i) => i && c.getContext('2d').drawImage(i, 0, 0, s.w, s.h, 0, 0, s.w, s.h));
    }
    return c;
  }
  // Ряд листа атаки по направлению ходьбы: влево — зеркало правых рядов
  const ATTACK_ROW = [[0, false], [1, false], [2, false], [3, false], [4, false], [3, true], [2, true], [1, true]];
  const attackRow = (walkRow) => ATTACK_ROW[walkRow] || ATTACK_ROW[0];
  return { LIST, MOBS, DIRS, rowFor, attackRow, canvas, get: (id) => LIST[id] };
})();
