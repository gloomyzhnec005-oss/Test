// Уникальные умения героев. Каждое умение — функция (ctx, p, target, now) → строка ошибки или null.
// ctx: { monsters, players, pushFx, damageMonster, healPlayer, teleport, knockback, isSolidAt, addTotem }
const { petDmg, petsNear } = require('./pets');
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const inRadius = (ctx, x, y, r) => [...ctx.monsters.values()].filter((m) => Math.hypot(m.x - x, m.y - y) <= r);
const isMarked = (p, m) => m.markedBy === p.id && m.markUntil > Date.now(); // метка Найри
const isSealed = (p, m, now = Date.now()) => m.sealedBy === p.id && m.sealUntil > now; // печать кары Малакора
const alive = (ctx, p, m) => ctx.players.has(p.id) && (!m || ctx.monsters.has(m.id));

const SKILLS = {
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

  // Урсус: натравливание — все звери на цель, первый укус с оглушением
  sic(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    const active = p.pets.filter((pet) => !pet.down);
    if (!active.length) return 'Все звери отступили';
    for (const pet of active) { pet.sicTarget = t; pet.sicUntil = now + 6000; pet.sicFirst = true; pet.target = t; }
    ctx.pushFx({ t: 'skill', s: 'sic', from: p.id, x: t.x, y: t.y, pets: active.map((pet) => pet.id) });
    return null;
  },

  // Урсус: зов стаи — звери к хозяину, удар по всем вокруг, защита хозяину
  packCall(ctx, p, _t, now) {
    const r = 110;
    p.packUntil = now + 6000;
    const active = p.pets.filter((pet) => !pet.down);
    active.forEach((pet, i) => {
      const a = (i / active.length) * Math.PI * 2;
      pet.x = p.x + Math.cos(a) * 28; pet.y = p.y + Math.sin(a) * 20;
      pet.sicTarget = null; pet.target = null;
    });
    ctx.pushFx({ t: 'skill', s: 'packCall', from: p.id, x: p.x, y: p.y, r });
    for (const m of inRadius(ctx, p.x, p.y, r)) {
      for (const pet of active) ctx.damageMonster(p, m, petDmg(pet, now) * 1.5, { pet: pet.id });
    }
    return null;
  },

  // Урсус: духовная связь — здоровье хозяина самому раненому зверю, усиление обоих
  spiritLink(ctx, p, _t, now) {
    const pet = [...p.pets].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (!pet) return 'Нет зверей';
    const cost = p.hp * 0.15;
    if (p.hp - cost < 1) return 'Слишком мало здоровья';
    p.hp -= cost;
    pet.down = false;
    pet.hp = pet.maxHp;
    pet.boostUntil = now + 8000;
    p.linkUntil = now + 8000;
    ctx.pushFx({ t: 'skill', s: 'spiritLink', from: p.id, x: p.x, y: p.y, pet: pet.id, fx: pet.x, fy: pet.y });
    return null;
  },

  // Найри: метка жертвы — одна цель на 15 с
  markPrey(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    for (const m of ctx.monsters.values()) if (m.markedBy === p.id) m.markedBy = null; // старая метка снимается
    t.markedBy = p.id;
    t.markUntil = now + 15000;
    ctx.pushFx({ t: 'skill', s: 'markPrey', from: p.id, x: t.x, y: t.y });
    return null;
  },

  // Найри: теневой рывок — за спину цели, удар в спину с критом
  shadowDash(ctx, p, t) {
    if (!t) return 'Нет цели';
    const fromX = p.x, fromY = p.y;
    // «За спиной» — с противоположной от Найри стороны цели
    const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1;
    ctx.teleport(p, t.x + (dx / d) * 24, t.y + (dy / d) * 24);
    p.dir = dx > 0 ? -1 : 1;
    ctx.pushFx({ t: 'skill', s: 'shadowDash', from: p.id, fx: fromX, fy: fromY, x: p.x, y: p.y, tx: t.x, ty: t.y });
    ctx.damageMonster(p, t, p.dmg * 1.6, { crit: true });
    return null;
  },

  // Найри: дымовая завеса — враги теряют её из виду, уклонение 50% на 6 с
  smokeScreen(ctx, p, _t, now) {
    p.dodgeUntil = now + 6000;
    for (const m of ctx.monsters.values()) if (m.target === p.id) { m.target = null; m.ignoreUntil = now + 2500; m.ignoreId = p.id; }
    ctx.pushFx({ t: 'skill', s: 'smokeScreen', from: p.id, x: p.x, y: p.y, dur: 6000 });
    return null;
  },

  // Малакор: печать кары — проклятие на 12 с, удары цели по Карателю отражаются
  punishSeal(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    t.sealedBy = p.id;
    t.sealUntil = now + 12000;
    ctx.pushFx({ t: 'skill', s: 'punishSeal', from: p.id, x: t.x, y: t.y });
    return null;
  },

  // Малакор: клинок тьмы — рывок к цели и удар, вдвое сильнее по проклятым
  darkBlade(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    const pw = p.castPower || 1;
    const fromX = p.x, fromY = p.y;
    const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1;
    ctx.teleport(p, t.x - (dx / d) * 26, t.y - (dy / d) * 26);
    p.dir = dx < 0 ? -1 : 1;
    const sealed = isSealed(p, t, now);
    ctx.pushFx({ t: 'skill', s: 'darkBlade', from: p.id, fx: fromX, fy: fromY, x: p.x, y: p.y, tx: t.x, ty: t.y, sealed });
    ctx.damageMonster(p, t, p.dmg * 1.8 * (sealed ? 2 : 1) * pw, { crit: sealed });
    return null;
  },

  // Малакор: суд тени — вспышка вокруг, плюс расплата за урон, нанесённый Карателю
  shadowJudgment(ctx, p, _t, now) {
    const pw = p.castPower || 1, r = 120;
    ctx.pushFx({ t: 'skill', s: 'shadowJudgment', from: p.id, x: p.x, y: p.y, r });
    for (const m of inRadius(ctx, p.x, p.y, r)) {
      const debt = m.debt && m.debt.by === p.id && now - m.debt.t < 10000 ? m.debt.sum : 0;
      ctx.damageMonster(p, m, p.dmg * 1.4 * pw);
      if (debt > 0 && ctx.monsters.has(m.id)) ctx.damageMonster(p, m, debt * pw, { fixed: true, reflect: true });
      m.debt = null;
    }
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

  // Урсус: единство со зверем — бонус за каждого зверя рядом
  beastUnity: {
    dmgMult: (p) => 1 + 0.08 * petsNear(p).length,
    speedMult: (p) => 1 + 0.06 * petsNear(p).length,
    note: (p) => `звери рядом: ${petsNear(p).length}/${(p.pets || []).length}`,
  },

  // Найри: охотница за головами — бонус по меткам и раненым, убийства сокращают перезарядку
  headhunter: {
    targetMult: (p, m) => (isMarked(p, m) ? 1.3 : 1) * (m.hp / m.maxHp < 0.35 ? 1.4 : 1),
    // Награда за выполненный «контракт» — убийство помеченной цели
    rewardMult: (p, m) => (isMarked(p, m) ? { xp: 1.5, gold: 2, contract: true } : { xp: 1, gold: 1 }),
    onKill(ctx, p, now, m) {
      for (const id of Object.keys(p.skillReadyAt)) p.skillReadyAt[id] = Math.max(now, p.skillReadyAt[id] - 1500);
      if (m && isMarked(p, m)) p.res = Math.min(p.resMax, p.res + 30);
      ctx.syncCooldowns(p, now);
    },
  },

  // Малакор: возмездие — гнев от ударов усиливает навыки и отражает урон
  retribution: {
    beforeCast: (p) => ({ free: false, power: 1 + 0.6 * (p.wrath || 0) / 100 }),
    onHurt(ctx, p, dmg, attacker) {
      const now = Date.now();
      p.wrath = Math.min(100, (p.wrath || 0) + 12);
      p.dirty = true;
      if (!attacker || !ctx.monsters.has(attacker.id)) return;
      // Враг копит «долг» — урон, нанесённый Карателю (для «Суда тени»)
      if (!attacker.debt || attacker.debt.by !== p.id || now - attacker.debt.t > 10000) attacker.debt = { by: p.id, sum: 0, t: now };
      attacker.debt.sum += dmg; attacker.debt.t = now;
      // Отражение: пассивка 10–30% + печать кары 50%
      const reflect = dmg * (0.1 + 0.2 * p.wrath / 100) + (isSealed(p, attacker, now) ? dmg * 0.5 : 0);
      ctx.damageMonster(p, attacker, reflect, { fixed: true, reflect: true });
    },
    onTick(p, now) {
      if (p.wrath > 0 && now - p.lastHurt > 6000) { p.wrath = Math.max(0, p.wrath - 1); p.dirty = true; }
    },
    note: (p) => `гнев кары ${Math.round(p.wrath || 0)}%`,
  },
};

// Умения, которым нужна цель в пределах дальности (для остальных цель не обязательна)
const NEEDS_TARGET = new Set(['punishSeal', 'darkBlade', 'markPrey', 'shadowDash', 'sic', 'enlighten', 'stoneThrow', 'twinSlash', 'spiritWrath', 'chainLightning']);
// Дальность умения (по умолчанию — дальность атаки героя, но не меньше 120)
const SKILL_RANGE = { punishSeal: 300, darkBlade: 260, markPrey: 320, shadowDash: 260, sic: 320, enlighten: 80, qiWave: 170, stoneThrow: 320, twinSlash: 80, blindRage: 200 };
const skillRange = (id, hero) => SKILL_RANGE[id] ?? Math.max(hero.range, 120) + 20;

module.exports = { SKILLS, PASSIVES, NEEDS_TARGET, skillRange };
