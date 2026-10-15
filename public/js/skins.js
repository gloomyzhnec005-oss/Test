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
    faelin: {
      sheet: 'assets/heroes/faelin_sheet.png', portrait: 'assets/heroes/faelin_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 7 рядов — 5 направлений, второй выстрел и поза умения (последний)
      attack: { sheet: 'assets/heroes/faelin_attack.png', w: 72, h: 60, frames: 5, rows: 7, cast: 6 },
      // bolt — светящаяся стрела; starShot — звёздная стрела-прицел
      fx: { sheet: 'assets/heroes/faelin_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'starShot', 'lightHail', 'windLight', 'aura'] },
    },
    ilyria: {
      sheet: 'assets/heroes/ilyria_sheet.png', portrait: 'assets/heroes/ilyria_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 7 рядов — 5 направлений, второй каст и поза умения (последний)
      attack: { sheet: 'assets/heroes/ilyria_attack.png', w: 72, h: 60, frames: 5, rows: 7, cast: 6 },
      // bolt — сгусток арканы; volley — веер снарядов при начале залпа
      fx: { sheet: 'assets/heroes/ilyria_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'volley', 'iceGrip', 'magicBarrier', 'aura'] },
    },
    tibor: {
      sheet: 'assets/heroes/tibor_sheet.png', portrait: 'assets/heroes/tibor_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 7 рядов — 5 направлений, второй удар и поза умения (последний — выпивает эликсир)
      attack: { sheet: 'assets/heroes/tibor_attack.png', w: 72, h: 60, frames: 5, rows: 7, cast: 6 },
      // elixir_* — флакон каждого эликсира (poison — отравление токсинами), sign_* — знаки
      fx: { sheet: 'assets/heroes/tibor_fx.png', size: 72, frames: 6, rows: ['slash', 'hit', 'elixir_thunder', 'elixir_blizzard', 'elixir_swallow', 'elixir_oriole', 'elixir_poison',
        'sign_igni', 'sign_aard', 'sign_quen', 'bloodWhirl', 'aura'] },
    },
    ingrid: {
      sheet: 'assets/heroes/ingrid_sheet.png', portrait: 'assets/heroes/ingrid_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 7 рядов — 5 направлений, второй бросок и поза умения (последний)
      attack: { sheet: 'assets/heroes/ingrid_attack.png', w: 72, h: 60, frames: 5, rows: 7, cast: 6 },
      // bolt — ракета; turretFire — стреляющая турель; bomb — бомба и взрыв; buildTurret — сборка; aura — Ингрид в кольце энергии
      fx: { sheet: 'assets/heroes/ingrid_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'turretFire', 'bomb', 'buildTurret', 'aura'] },
      turret: 'assets/heroes/ingrid_turret.png', // нарисованная турель вместо процедурной
    },
    talmira: {
      sheet: 'assets/heroes/talmira_sheet.png', portrait: 'assets/heroes/talmira_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 7 рядов — 5 направлений, второй выпад и поза умения (раскрытые крылья)
      attack: { sheet: 'assets/heroes/talmira_attack.png', w: 72, h: 60, frames: 5, rows: 7, cast: 6 },
      fx: { sheet: 'assets/heroes/talmira_fx.png', size: 72, frames: 6, rows: ['slash', 'hit', 'heavenSpear', 'takeFlight', 'valkyrieCry', 'aura'] },
    },
    sanguine: {
      sheet: 'assets/heroes/sanguine_sheet.png', portrait: 'assets/heroes/sanguine_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 6 рядов — вниз, вниз-вправо, вправо (выпад посохом), вверх-вправо, вверх и поза умения
      attack: { sheet: 'assets/heroes/sanguine_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // bolt — кровавая сфера; bloodBond — кровавые цепи
      fx: { sheet: 'assets/heroes/sanguine_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'bloodSpike', 'bloodRitual', 'bloodBond', 'aura'] },
    },
    zefira: {
      sheet: 'assets/heroes/zefira_sheet.png', portrait: 'assets/heroes/zefira_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 6 рядов — вниз, вниз-вправо, вправо (выпад клинком), вверх-вправо, вверх и поза умения (раскинутые руки)
      attack: { sheet: 'assets/heroes/zefira_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // bolt — огненный шар; дыхание четырёх аспектов; dragonDive — удар с неба; takeFlight — крылья; beastMight — кольцо силы
      fx: { sheet: 'assets/heroes/zefira_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'breath_fire', 'breath_ice', 'breath_poison', 'breath_lightning', 'dragonDive', 'takeFlight', 'beastMight'] },
    },
    emet: {
      sheet: 'assets/heroes/emet_sheet.png', portrait: 'assets/heroes/emet_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 6 рядов — вниз, вниз-вправо, вправо (удар молотом-кулаком), вверх-вправо, вверх и поза умения
      attack: { sheet: 'assets/heroes/emet_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // slash — каменная дуга удара; stoneFist — шипы из земли; golemQuake — трещины кольцом; stoneArmor — каменная сфера
      fx: { sheet: 'assets/heroes/emet_fx.png', size: 72, frames: 6, rows: ['slash', 'hit', 'stoneFist', 'golemQuake', 'stoneArmor', 'aura'] },
    },
    selena: {
      sheet: 'assets/heroes/selena_sheet.png', portrait: 'assets/heroes/selena_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: вниз, вниз-вправо, вправо, вверх-вправо (= вверх), вверх и поза умения (посох поднят)
      attack: { sheet: 'assets/heroes/selena_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // bolt — летящая луна; moonBeam — луч; phaseShift — фазы луны; moonVeil — купол; aura — лунное кольцо
      fx: { sheet: 'assets/heroes/selena_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'moonBeam', 'phaseShift', 'moonVeil', 'aura'] },
    },
    sirocco: {
      sheet: 'assets/heroes/sirocco_sheet.png', portrait: 'assets/heroes/sirocco_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: вниз, вниз-вправо, вправо, вверх-вправо (= вверх), вверх и поза умения (посох вперёд)
      attack: { sheet: 'assets/heroes/sirocco_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // bolt — песчаный полумесяц; sandVortex — смерч; duneWave — волна бархана; desertBreath — песчаные шипы; aura — кольцо
      fx: { sheet: 'assets/heroes/sirocco_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'sandVortex', 'duneWave', 'desertBreath', 'aura'] },
    },
    blaze: {
      sheet: 'assets/heroes/blaze_sheet.png', portrait: 'assets/heroes/blaze_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: вниз, вниз-вправо, вправо, вверх-вправо (= вверх), вверх и поза умения (руки вверх)
      attack: { sheet: 'assets/heroes/blaze_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // bolt — огненный снаряд; blazeBall — огненный шар; flameWave — волна пламени; flashover — взрыв жара; aura — огненное кольцо
      fx: { sheet: 'assets/heroes/blaze_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'blazeBall', 'flameWave', 'flashover', 'aura'] },
    },
    elnaeris: {
      sheet: 'assets/heroes/elnaeris_sheet.png', portrait: 'assets/heroes/elnaeris_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: вниз, вниз-вправо, вправо, вверх-вправо, вверх и поза умения (руки разведены)
      attack: { sheet: 'assets/heroes/elnaeris_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // bolt — летящий череп; gatherSouls — души слетаются; soulWave — волна душ; guideCall — жнец-проводник; aura — кольцо
      fx: { sheet: 'assets/heroes/elnaeris_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'gatherSouls', 'soulWave', 'guideCall', 'aura'] },
    },
    voldan: {
      sheet: 'assets/heroes/voldan_sheet.png', portrait: 'assets/heroes/voldan_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: вниз, вниз-вправо, вправо (выпад трезубцем), вверх-вправо, вверх и поза умения
      attack: { sheet: 'assets/heroes/voldan_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // bolt — водяной трезубец; deepWave — волна; createDeep — фонтан и водоворот; seaSpirits — морской дух; aura — кольцо
      fx: { sheet: 'assets/heroes/voldan_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'deepWave', 'createDeep', 'seaSpirits', 'aura'] },
    },
    galatea: {
      sheet: 'assets/heroes/galatea_sheet.png', portrait: 'assets/heroes/galatea_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: вниз, вниз-вправо, вправо, вверх-вправо (зеркало бокового ряда), вверх (с трезубцем) и поза умения (руки раскрыты)
      attack: { sheet: 'assets/heroes/galatea_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // bolt — звуковая жемчужина; sirenSong — ноты песни; soundWave — звуковые круги; drownedCall — утопленница; aura — кольцо из ракушек
      fx: { sheet: 'assets/heroes/galatea_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'sirenSong', 'soundWave', 'drownedCall', 'aura'] },
    },
    itilior: {
      sheet: 'assets/heroes/itilior_sheet.png', portrait: 'assets/heroes/itilior_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: вниз, вниз-вправо, вправо (выпад посохом), вверх-вправо (зеркало бокового ряда), вверх и поза умения
      attack: { sheet: 'assets/heroes/itilior_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // bolt — ледяной осколок; iceArrow — ледяное копьё; iceWall — стена льда; frostBlast — морозный взрыв; aura — ледяное кольцо
      fx: { sheet: 'assets/heroes/itilior_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'iceArrow', 'iceWall', 'frostBlast', 'aura'] },
    },
    flare: {
      sheet: 'assets/heroes/flare_sheet.png', portrait: 'assets/heroes/flare_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: вниз, вниз-вправо, вправо (огненный выброс), вверх-вправо (зеркало бокового ряда), вверх и поза умения (руки вверх)
      attack: { sheet: 'assets/heroes/flare_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // bolt — огненный шар; flameShift — огненный вихрь смены формы; flameBurst — огненное копьё (лавина); incinerate — испепеление; aura — кольцо
      fx: { sheet: 'assets/heroes/flare_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'flameShift', 'flameBurst', 'incinerate', 'aura'] },
    },
    caldero: {
      sheet: 'assets/heroes/caldero_sheet.png', portrait: 'assets/heroes/caldero_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: вниз, вниз-вправо, вправо (лавовый кулак), вверх-вправо (зеркало бокового ряда), вверх и поза умения (кулаки вверх)
      attack: { sheet: 'assets/heroes/caldero_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // slash — огненная дуга удара; lavaStrike — лавовый выплеск; eruption — извержение; ashArmor — каменная корка; aura — кольцо
      fx: { sheet: 'assets/heroes/caldero_fx.png', size: 72, frames: 6, rows: ['slash', 'hit', 'lavaStrike', 'eruption', 'ashArmor', 'aura'] },
    },
    torden: {
      sheet: 'assets/heroes/torden_sheet.png', portrait: 'assets/heroes/torden_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: вниз, вниз-вправо, вправо (выпад посохом), вверх-вправо (= вниз-вправо), вверх и поза умения (руки вверх)
      attack: { sheet: 'assets/heroes/torden_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // bolt — каменный кристалл; stoneSpike — шипы из земли; rift — разлом; earthGrip — корни и камни; aura — каменное кольцо
      fx: { sheet: 'assets/heroes/torden_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'stoneSpike', 'rift', 'earthGrip', 'aura'] },
    },
    medea: {
      sheet: 'assets/heroes/medea_sheet.png', portrait: 'assets/heroes/medea_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: вниз, вниз-вправо, вправо (выстрел из лука), вверх-вправо (зеркало бокового ряда), вверх и поза умения
      attack: { sheet: 'assets/heroes/medea_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // bolt — змея-стрела; gorgonGaze — конус окаменения; snakeSwarm — змеиный рой; stoneBurst — каменные шипы; aura — кольцо
      fx: { sheet: 'assets/heroes/medea_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'gorgonGaze', 'snakeSwarm', 'stoneBurst', 'aura'] },
    },
    wugazh: {
      sheet: 'assets/heroes/wugazh_sheet.png', portrait: 'assets/heroes/wugazh_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: вниз, вниз-вправо, вправо (удар когтями), вверх-вправо (зеркало бокового ряда), вверх и поза умения (руки вверх)
      attack: { sheet: 'assets/heroes/wugazh_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // slash — дуга корней; rootLash — хлыст корней; rootDown — укоренение; bloom — цветение; aura — кольцо из лоз
      fx: { sheet: 'assets/heroes/wugazh_fx.png', size: 72, frames: 6, rows: ['slash', 'hit', 'rootLash', 'rootDown', 'bloom', 'aura'] },
    },
    brilda: {
      sheet: 'assets/heroes/brilda_sheet.png', portrait: 'assets/heroes/brilda_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: вниз, вниз-вправо, вправо (выпад посохом), вверх-вправо (зеркало бокового ряда), вверх и поза умения
      attack: { sheet: 'assets/heroes/brilda_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // bolt — кристалл; cutCrystal — кристаллы вокруг; crystalVolley — залп осколков; crystalBarrier — кристальная сфера; aura — кольцо
      fx: { sheet: 'assets/heroes/brilda_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'cutCrystal', 'crystalVolley', 'crystalBarrier', 'aura'] },
    },
    leblanc: {
      sheet: 'assets/heroes/leblanc_sheet.png', portrait: 'assets/heroes/leblanc_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: вниз, вниз-вправо, вправо, вверх-вправо (зеркало бокового ряда), вверх и поза умения
      attack: { sheet: 'assets/heroes/leblanc_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // bolt — розовый кристалл; decoy — двойники; mirage — маски морока; deceptionFlash — вспышка обмана; aura — кольцо
      fx: { sheet: 'assets/heroes/leblanc_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'decoy', 'mirage', 'deceptionFlash', 'aura'] },
    },
    gardin: {
      sheet: 'assets/heroes/gardin_sheet.png', portrait: 'assets/heroes/gardin_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: вниз, вниз-вправо, вправо, вверх-вправо (= вверх, со спины), вверх и поза умения
      attack: { sheet: 'assets/heroes/gardin_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // bolt — рунный снаряд; carveRune — руна на земле; activateRunes — взрыв рун; weaponRune — руна на молоте; aura — кольцо
      fx: { sheet: 'assets/heroes/gardin_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'carveRune', 'activateRunes', 'weaponRune', 'aura'] },
    },
    gideon: {
      sheet: 'assets/heroes/gideon_sheet.png', portrait: 'assets/heroes/gideon_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: вниз, вниз-вправо, вправо, вверх-вправо (= вверх, со спины), вверх и поза умения
      attack: { sheet: 'assets/heroes/gideon_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
      // bolt — тёмный кристалл; darkPrayer — проклятый круг; sacrifice — жертва; abyssWrath — кара бездны; aura — кольцо
      fx: { sheet: 'assets/heroes/gideon_fx.png', size: 72, frames: 6, rows: ['bolt', 'hit', 'darkPrayer', 'sacrifice', 'abyssWrath', 'aura'] },
    },
    morvenKnight: {
      sheet: 'assets/heroes/morvenKnight_sheet.png', portrait: 'assets/heroes/morvenKnight_portrait.png', w: 36, h: 48, frames: 5,
      // Атака: 6 рядов — вниз, вниз-вправо, вправо, вверх-вправо, вверх (= вверх-вправо) и поза умения; эффектов пока нет
      attack: { sheet: 'assets/heroes/morvenKnight_attack.png', w: 72, h: 60, frames: 5, rows: 6, cast: 5 },
    },
  };
  // Нарисованные монстры: лист кадров в ряд (монстр смотрит вправо), какие кадры — ходьба, какие — удар
  const MOBS = {};
  // Все монстры нарисованы генератором tools/gen_mobs.py (размеры — public/js/mobart.js): 4 кадра ходьбы, 3 кадра удара
  for (const [id, m] of Object.entries(window.MOB_ART || {})) MOBS[id] = { sheet: `assets/mobs/${id}.png`, w: m.w, h: m.h, body: m.body, scale: m.scale || 1, walk: [0, 1, 2, 3], attack: [4, 5, 6] };
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
