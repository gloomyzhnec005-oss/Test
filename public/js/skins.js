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
