// Уникальные умения героев. Каждое умение — функция (ctx, p, target, now) → строка ошибки или null.
// ctx: { monsters, players, pushFx, damageMonster, healPlayer, teleport, knockback, isSolidAt, addTotem }
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const inRadius = (ctx, x, y, r) => [...ctx.monsters.values()].filter((m) => Math.hypot(m.x - x, m.y - y) <= r);
const alive = (ctx, p, m) => ctx.players.has(p.id) && (!m || ctx.monsters.has(m.id));

const SKILLS = {
  // Торвальд: удар о землю — урон вокруг и оглушение
  quake(ctx, p, _t, now) {
    const r = 95;
    ctx.pushFx({ t: 'skill', s: 'quake', from: p.id, x: p.x, y: p.y, r });
    for (const m of inRadius(ctx, p.x, p.y, r)) {
      m.stunUntil = now + 1500;
      ctx.damageMonster(p, m, p.dmg * 1.6);
    }
    return null;
  },

  // Лира: дождь стрел по области вокруг цели
  arrowRain(ctx, p, t) {
    if (!t) return 'Нет цели';
    const r = 110, x = t.x, y = t.y;
    ctx.pushFx({ t: 'skill', s: 'arrowRain', from: p.id, x, y, r });
    setTimeout(() => {
      if (!alive(ctx, p)) return;
      for (const m of inRadius(ctx, x, y, r)) ctx.damageMonster(p, m, p.dmg * 1.4);
    }, 450);
    return null;
  },

  // Эльдрин: метеор — огромный урон по цели и ожог рядом
  meteor(ctx, p, t) {
    if (!t) return 'Нет цели';
    const x = t.x, y = t.y;
    ctx.pushFx({ t: 'skill', s: 'meteor', from: p.id, x, y, r: 85 });
    setTimeout(() => {
      if (!alive(ctx, p)) return;
      for (const m of inRadius(ctx, x, y, 85)) ctx.damageMonster(p, m, m.id === t.id ? p.dmg * 3.2 : p.dmg * 1.2);
    }, 650);
    return null;
  },

  // Мира: телепорт к цели и тройной удар
  shadowStep(ctx, p, t) {
    if (!t) return 'Нет цели';
    const side = t.x < p.x ? 1 : -1;
    const fromX = p.x, fromY = p.y;
    ctx.teleport(p, t.x + side * 22, t.y);
    p.dir = -side;
    ctx.pushFx({ t: 'skill', s: 'shadow', from: p.id, fx: fromX, fy: fromY, x: p.x, y: p.y });
    ctx.damageMonster(p, t, p.dmg * 3, { crit: true });
    return null;
  },

  // Ансельм: лечение себя и союзников
  heal(ctx, p) {
    const r = 160;
    ctx.pushFx({ t: 'skill', s: 'heal', from: p.id, x: p.x, y: p.y, r });
    ctx.healPlayer(p, p.maxHp * 0.4);
    for (const o of ctx.players.values()) {
      if (o !== p && !o.dead && dist(o, p) <= r) ctx.healPlayer(o, o.maxHp * 0.25);
    }
    return null;
  },

  // Вальгрим: ярость — больше урона и скорости атаки
  rage(ctx, p, _t, now) {
    p.rageUntil = now + 6000;
    ctx.pushFx({ t: 'skill', s: 'rage', from: p.id, x: p.x, y: p.y, dur: 6000 });
    return null;
  },

  // Сильвана: корни сковывают врагов вокруг и ранят их
  roots(ctx, p, _t, now) {
    const r = 150;
    const targets = inRadius(ctx, p.x, p.y, r);
    ctx.pushFx({ t: 'skill', s: 'roots', from: p.id, x: p.x, y: p.y, r, ids: targets.map((m) => m.id) });
    for (const m of targets) {
      m.rootUntil = now + 3000;
      m.dots = (m.dots || []).concat({ until: now + 3000, dps: p.dmg * 0.4, by: p.id });
      ctx.damageMonster(p, m, p.dmg * 0.5);
    }
    return null;
  },

  // Морвен: похищение жизни
  drain(ctx, p, t) {
    if (!t) return 'Нет цели';
    ctx.pushFx({ t: 'skill', s: 'drain', from: p.id, fx: t.x, fy: t.y, x: p.x, y: p.y });
    const dealt = ctx.damageMonster(p, t, p.dmg * 2);
    ctx.healPlayer(p, dealt);
    return null;
  },

  // Бохай: волна ци — поток энергии вперёд, урон и отбрасывание
  qiWave(ctx, p, t) {
    const len = 150, width = 46;
    // Направление: на цель, если она есть, иначе — куда смотрит герой
    let dx = t ? t.x - p.x : p.dir, dy = t ? t.y - p.y : 0;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    ctx.pushFx({ t: 'skill', s: 'qiWave', from: p.id, x: p.x, y: p.y, dx, dy, len });
    for (const m of ctx.monsters.values()) {
      const rx = m.x - p.x, ry = m.y - p.y;
      const along = rx * dx + ry * dy, across = Math.abs(rx * dy - ry * dx);
      if (along < -10 || along > len || across > width) continue;
      ctx.damageMonster(p, m, p.dmg * 1.5);
      ctx.knockback(m, dx, dy, 70);
    }
    return null;
  },

  // Бохай: удар просветления — добивает ослабленных врагов
  enlighten(ctx, p, t) {
    if (!t) return 'Нет цели рядом';
    const execute = t.hp / t.maxHp < 0.35;
    ctx.pushFx({ t: 'skill', s: 'enlighten', from: p.id, x: t.x, y: t.y, execute });
    ctx.damageMonster(p, t, p.dmg * 2.2 * (execute ? 2 : 1), { crit: execute });
    return null;
  },

  // Бохай: дыхание гармонии — лечение и усиление следующей атаки
  harmony(ctx, p, _t, now) {
    ctx.pushFx({ t: 'skill', s: 'harmony', from: p.id, x: p.x, y: p.y });
    ctx.healPlayer(p, p.maxHp * 0.25);
    p.empoweredUntil = now + 10000;
    return null;
  },

  // Вебранд: кровавый вихрь — три удара по всем вокруг
  bloodWhirl(ctx, p) {
    const r = 85;
    ctx.pushFx({ t: 'skill', s: 'bloodWhirl', from: p.id, x: p.x, y: p.y, r });
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        if (!alive(ctx, p) || p.dead) return;
        for (const m of inRadius(ctx, p.x, p.y, r)) ctx.damageMonster(p, m, p.dmg * 0.65);
      }, i * 220);
    }
    return null;
  },

  // Вебранд: рёв ярости — ослабляет врагов вокруг и усиливает себя
  furyRoar(ctx, p, _t, now) {
    const r = 160;
    const targets = inRadius(ctx, p.x, p.y, r);
    ctx.pushFx({ t: 'skill', s: 'furyRoar', from: p.id, x: p.x, y: p.y, r });
    for (const m of targets) { m.weakUntil = now + 6000; m.target = p.id; }
    p.roarUntil = now + 6000;
    return null;
  },

  // Вебранд: бросок камня — урон и оглушение дальней цели
  stoneThrow(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    ctx.pushFx({ t: 'skill', s: 'stoneThrow', from: p.id, fx: p.x, fy: p.y, x: t.x, y: t.y });
    const flight = Math.min(500, dist(p, t) * 1.6);
    setTimeout(() => {
      if (!alive(ctx, p, t)) return;
      t.stunUntil = Date.now() + 2000;
      ctx.damageMonster(p, t, p.dmg * 1.3);
    }, flight);
    return null;
  },

  // Вайалд: двойной разрез — четыре быстрых удара по цели
  twinSlash(ctx, p, t) {
    if (!t) return 'Нет цели рядом';
    ctx.pushFx({ t: 'skill', s: 'twinSlash', from: p.id, x: t.x, y: t.y });
    for (let i = 0; i < 4; i++) {
      setTimeout(() => { if (alive(ctx, p, t) && !p.dead) ctx.damageMonster(p, t, p.dmg * 0.7); }, i * 110);
    }
    return null;
  },

  // Вайалд: кровавое безумие — здоровье в обмен на урон и скорость (плата здоровьем — hpCost в конфиге)
  bloodFrenzy(ctx, p, _t, now) {
    p.frenzyUntil = now + 6000;
    ctx.pushFx({ t: 'skill', s: 'bloodFrenzy', from: p.id, x: p.x, y: p.y });
    return null;
  },

  // Вайалд: слепая ярость — рывок сквозь врагов
  blindRage(ctx, p, t) {
    let dx = t ? t.x - p.x : p.dir, dy = t ? t.y - p.y : 0;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    // Рывок до 170 px, останавливается у стены
    const fromX = p.x, fromY = p.y;
    let len = 0;
    while (len < 170 && !ctx.isSolidAt(fromX + dx * (len + 10), fromY + dy * (len + 10))) len += 10;
    const toX = fromX + dx * len, toY = fromY + dy * len;
    for (const m of ctx.monsters.values()) {
      const rx = m.x - fromX, ry = m.y - fromY;
      const along = rx * dx + ry * dy, across = Math.abs(rx * dy - ry * dx);
      if (along >= -10 && along <= len + 20 && across <= 36) ctx.damageMonster(p, m, p.dmg * 1.6);
    }
    ctx.teleport(p, toX, toY);
    p.dir = dx < 0 ? -1 : 1;
    ctx.pushFx({ t: 'skill', s: 'blindRage', from: p.id, fx: fromX, fy: fromY, x: toX, y: toY });
    return null;
  },

  // Аламариэль: гнев духов — три удара по области + проклятие
  spiritWrath(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    const pw = p.castPower || 1, r = 100, x = t.x, y = t.y;
    ctx.pushFx({ t: 'skill', s: 'spiritWrath', from: p.id, x, y, r });
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        if (!alive(ctx, p)) return;
        for (const m of inRadius(ctx, x, y, r)) { m.weakUntil = Math.max(m.weakUntil || 0, now + 4000); ctx.damageMonster(p, m, p.dmg * 0.9 * pw); }
      }, 250 + i * 300);
    }
    return null;
  },

  // Аламариэль: цепь молний — до 5 целей, −15% урона за прыжок
  chainLightning(ctx, p, t) {
    if (!t) return 'Нет цели';
    const pw = p.castPower || 1;
    const chain = [t];
    while (chain.length < 5) {
      const last = chain[chain.length - 1];
      let next = null, best = 140;
      for (const m of ctx.monsters.values()) {
        if (chain.includes(m)) continue;
        const dd = dist(m, last);
        if (dd < best) { best = dd; next = m; }
      }
      if (!next) break;
      chain.push(next);
    }
    ctx.pushFx({ t: 'skill', s: 'chainLightning', from: p.id, x: p.x, y: p.y, pts: chain.map((m) => [Math.round(m.x), Math.round(m.y)]) });
    chain.forEach((m, i) => ctx.damageMonster(p, m, p.dmg * 1.8 * pw * Math.pow(0.85, i)));
    return null;
  },

  // Аламариэль: тотем исцеления на 8 с
  healTotem(ctx, p, _t, now) {
    const pw = p.castPower || 1;
    const totem = ctx.addTotem({ owner: p.id, x: p.x, y: p.y + 6, r: 140, heal: 0.06 * pw, until: now + 8000 });
    ctx.pushFx({ t: 'skill', s: 'healTotem', from: p.id, x: totem.x, y: totem.y, r: totem.r });
    return null;
  },
};

// Пассивные навыки: модификаторы урона/скорости атаки и реакция на получение урона
const PASSIVES = {
  // Бохай: внутреннее равновесие — ци от полученного урона усиливает удары; шанс контратаки
  innerBalance: {
    dmgMult: (p) => 1 + 0.3 * (p.res / p.resMax),
    speedMult: (p) => 1 + 0.25 * (p.res / p.resMax),
    onHurt(ctx, p, dmg, attacker) {
      p.res = Math.min(p.resMax, p.res + dmg * 1.2);
      if (attacker && Math.random() < 0.25 && Math.hypot(attacker.x - p.x, attacker.y - p.y) < 70) {
        ctx.pushFx({ t: 'skill', s: 'counter', from: p.id, x: attacker.x, y: attacker.y, quiet: true });
        ctx.damageMonster(p, attacker, p.dmg * 0.8);
      }
    },
  },

  // Вебранд: неукротимая ярость — сила растёт с потерей здоровья; раз в бой переживает смертельный удар
  untamedFury: {
    dmgMult: (p) => 1 + 0.5 * (1 - p.hp / p.maxHp),
    speedMult: (p) => 1 + 0.35 * (1 - p.hp / p.maxHp),
    // «Бой» заканчивается через 15 с без получения урона — тогда выживание снова готово
    onTick(p, now) { if (p.cheatUsed && now - p.lastHurt > 15000) { p.cheatUsed = false; p.dirty = true; } },
    onLethal(ctx, p) {
      if (p.cheatUsed) return false;
      p.cheatUsed = true;
      p.hp = 1;
      ctx.pushFx({ t: 'skill', s: 'undying', from: p.id, x: p.x, y: p.y, quiet: true });
      return true;
    },
    note: (p) => (p.cheatUsed ? 'выживание использовано' : 'выживание готово'),
  },

  // Вайалд: жажда крови — убийства лечат, продлевают безумие и дают заряды урона
  bloodlust: {
    dmgMult: (p) => 1 + 0.04 * (p.bloodStacks || 0),
    onKill(ctx, p, now) {
      ctx.healPlayer(p, p.maxHp * 0.08);
      if (p.frenzyUntil > now) p.frenzyUntil += 2000;
      p.bloodStacks = Math.min(10, (p.bloodStacks || 0) + 1);
      p.lastKill = now;
    },
    onTick(p, now) { if (p.bloodStacks && now - p.lastKill > 10000) { p.bloodStacks = 0; p.dirty = true; } },
    note: (p) => `зарядов крови: ${p.bloodStacks || 0}`,
  },

  // Аламариэль: связь с духами — благосклонность за навыки; на максимуме навык бесплатный и усиленный
  spiritBond: {
    MAX: 4,
    // Вызывается перед применением навыка: возвращает { free, power }
    beforeCast(p) {
      const ready = (p.favor || 0) >= this.MAX;
      return { free: ready, power: ready ? 1.5 : 1 };
    },
    afterCast(ctx, p, boosted) {
      p.favor = boosted ? 0 : Math.min(this.MAX, (p.favor || 0) + 1);
      if (p.favor === this.MAX) ctx.pushFx({ t: 'skill', s: 'favorReady', from: p.id, x: p.x, y: p.y, quiet: true });
    },
    note(p) { return (p.favor || 0) >= this.MAX ? 'духи готовы: следующий навык усилен!' : `благосклонность ${p.favor || 0}/${this.MAX}`; },
  },
};

// Умения, которым нужна цель в пределах дальности (для остальных цель не обязательна)
const NEEDS_TARGET = new Set(['arrowRain', 'meteor', 'shadowStep', 'drain', 'enlighten', 'stoneThrow', 'twinSlash', 'spiritWrath', 'chainLightning']);
// Дальность умения: shadowStep прыгает дальше обычной атаки
const SKILL_RANGE = { shadowStep: 280, enlighten: 80, qiWave: 170, stoneThrow: 320, twinSlash: 80, blindRage: 200 };
const skillRange = (id, hero) => SKILL_RANGE[id] ?? Math.max(hero.range, 120) + 20;

module.exports = { SKILLS, PASSIVES, NEEDS_TARGET, skillRange };
