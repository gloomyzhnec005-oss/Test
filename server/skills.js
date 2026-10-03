// Уникальные умения героев. Каждое умение — функция (ctx, p, target, now) → строка ошибки или null.
// ctx: { monsters, players, pushFx, damageMonster, healPlayer, teleport, knockback, isSolidAt, addTotem, addGround,
//        giveShield, takeCorpse, addPet, removePet, syncCooldowns, moveEntity }
const { petDmg, petsNear, createSummon } = require('./pets');
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

  // Кельт'о: похищение жизни — урон и лечение на его величину
  lifeSteal(ctx, p, t) {
    if (!t) return 'Нет цели';
    ctx.pushFx({ t: 'skill', s: 'lifeSteal', from: p.id, fx: t.x, fy: t.y, x: p.x, y: p.y });
    const dealt = ctx.damageMonster(p, t, p.dmg * 1.8);
    ctx.healPlayer(p, dealt);
    return null;
  },

  // Кельт'о: осквернённая земля — зона на 6 с: урон, замедление, лечение рыцаря
  desecrate(ctx, p, _t, now) {
    const r = 100, x = p.x, y = p.y;
    ctx.addGround({
      kind: 'desecrate', owner: p.id, x, y: y + 6, r, until: now + 6000,
      tick(tnow) {
        if (!ctx.players.has(p.id) || p.dead) return;
        let dealt = 0;
        for (const m of inRadius(ctx, x, y, r)) {
          m.slowUntil = Math.max(m.slowUntil || 0, tnow + 1200);
          dealt += ctx.damageMonster(p, m, p.dmg * 0.5);
        }
        if (dealt > 0) ctx.healPlayer(p, dealt * 0.5);
      },
    });
    ctx.pushFx({ t: 'skill', s: 'desecrate', from: p.id, x, y, r });
    return null;
  },

  // Кельт'о: восстание мёртвых — скелет-слуга из недавно павшего врага
  raiseDead(ctx, p, _t, now) {
    const corpse = ctx.takeCorpse(p.x, p.y, 220, now);
    if (!corpse) return 'Нет павших врагов рядом';
    // Не больше двух слуг: самый старый рассыпается
    const servants = p.pets.filter((pet) => pet.temp);
    if (servants.length >= 2) ctx.removePet(servants[0]);
    const pet = createSummon(p, 'skeleton', corpse.x, corpse.y, 20000, now);
    ctx.addPet(p, pet);
    ctx.pushFx({ t: 'skill', s: 'raiseDead', from: p.id, x: corpse.x, y: corpse.y });
    return null;
  },

  // Брендан: стена щитов — барьер себе и союзникам рядом
  shieldWall(ctx, p, _t, now) {
    const r = 150, amount = p.maxHp * 0.25;
    ctx.pushFx({ t: 'skill', s: 'shieldWall', from: p.id, x: p.x, y: p.y, r });
    for (const o of ctx.players.values()) {
      if (o.dead || dist(o, p) > r) continue;
      ctx.giveShield(o, amount, now + 8000);
    }
    return null;
  },

  // Брендан: провокация — враги вокруг атакуют только его
  taunt(ctx, p, _t, now) {
    const r = 180;
    const targets = inRadius(ctx, p.x, p.y, r);
    for (const m of targets) { m.tauntBy = p.id; m.tauntUntil = now + 5000; m.target = p.id; }
    ctx.pushFx({ t: 'skill', s: 'taunt', from: p.id, x: p.x, y: p.y, r, ids: targets.map((m) => m.id) });
    return null;
  },

  // Брендан: обет защиты — связь с ближайшим союзником
  vowOfProtection(ctx, p, _t, now) {
    let ally = null, best = 250;
    for (const o of ctx.players.values()) {
      if (o === p || o.dead) continue;
      const d = dist(o, p);
      if (d < best) { best = d; ally = o; }
    }
    if (!ally) return 'Нет союзника рядом';
    ally.vowBy = p.id;
    ally.vowUntil = now + 12000;
    ctx.pushFx({ t: 'skill', s: 'vow', from: p.id, x: p.x, y: p.y, ally: ally.id, ax: ally.x, ay: ally.y });
    return null;
  },

  // Кира: удар в уязвимость — гарантированный крит и пробитая защита
  exposeStrike(ctx, p, t, now) {
    if (!t) return 'Нет цели рядом';
    t.brokenUntil = now + 6000;
    ctx.pushFx({ t: 'skill', s: 'exposeStrike', from: p.id, x: t.x, y: t.y });
    ctx.damageMonster(p, t, p.dmg * 1.4, { crit: true });
    return null;
  },

  // Кира: дымовая шашка — уклонение, потеря агрессии, следующая атака критическая
  smokeBomb(ctx, p, _t, now) {
    p.dodgeUntil = now + 5000;
    p.dodgeChance = 0.6;
    p.nextCritUntil = now + 8000;
    for (const m of ctx.monsters.values()) if (m.target === p.id) { m.target = null; m.ignoreUntil = now + 2500; m.ignoreId = p.id; }
    ctx.pushFx({ t: 'skill', s: 'smokeScreen', from: p.id, x: p.x, y: p.y, dur: 5000 });
    return null;
  },

  // Кира: отравленный клинок — урон, яд и замедление
  poisonBlade(ctx, p, t, now) {
    if (!t) return 'Нет цели рядом';
    ctx.pushFx({ t: 'skill', s: 'poisonBlade', from: p.id, x: t.x, y: t.y });
    t.slowUntil = Math.max(t.slowUntil || 0, now + 6000);
    t.poisonUntil = now + 6000;
    t.dots = (t.dots || []).concat({ until: now + 6000, dps: p.dmg * 0.45, by: p.id });
    ctx.damageMonster(p, t, p.dmg);
    return null;
  },

  // Кассиан: удар из тени — множитель зависит от невидимости и того, заметил ли его монстр
  shadowStrike(ctx, p, t, now) {
    if (!t) return 'Нет цели рядом';
    const hidden = p.stealthUntil > now;
    const unaware = t.target !== p.id;
    const reap = 1 + 0.2 * (p.reapStacks || 0);
    p.reapStacks = 0;
    const lethal = hidden && unaware;
    ctx.pushFx({ t: 'skill', s: 'shadowStrike', from: p.id, x: t.x, y: t.y, lethal });
    if (lethal && !t.boss) ctx.damageMonster(p, t, t.hp + 1, { fixed: true, crit: true });
    else ctx.damageMonster(p, t, p.dmg * (lethal ? 6 : hidden || unaware ? 4 : 2) * reap, { crit: hidden || unaware });
    return null;
  },

  // Кассиан: плащ тени — невидимость, монстры теряют его
  shadowCloak(ctx, p, _t, now) {
    p.stealthUntil = now + 6000;
    for (const m of ctx.monsters.values()) if (m.target === p.id) m.target = null;
    ctx.pushFx({ t: 'skill', s: 'shadowCloak', from: p.id, x: p.x, y: p.y });
    return null;
  },

  // Кассиан: казнь — добивает раненого монстра, при успехе без перезарядки
  execution(ctx, p, t) {
    if (!t) return 'Нет цели рядом';
    const threshold = t.boss ? 0.15 : 0.3;
    if (t.hp / t.maxHp < threshold) {
      ctx.pushFx({ t: 'skill', s: 'execution', from: p.id, x: t.x, y: t.y, ok: true });
      ctx.damageMonster(p, t, t.hp + 1, { fixed: true, crit: true });
      p.skillNoCd = true; // успешная казнь — навык сразу готов снова
    } else {
      ctx.pushFx({ t: 'skill', s: 'execution', from: p.id, x: t.x, y: t.y, ok: false });
      ctx.damageMonster(p, t, p.dmg * 1.5);
    }
    return null;
  },

  // Зу'кра: тёмное пламя — сгусток по области + поджог
  darkFlame(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    const pw = p.castPower || 1, r = 80, x = t.x, y = t.y;
    const flight = Math.min(450, dist(p, t) * 1.5);
    ctx.pushFx({ t: 'skill', s: 'darkFlame', from: p.id, fx: p.x, fy: p.y, x, y, r, flight });
    setTimeout(() => {
      if (!alive(ctx, p)) return;
      for (const m of inRadius(ctx, x, y, r)) {
        m.burnUntil = Date.now() + 4000;
        m.dots = (m.dots || []).concat({ until: Date.now() + 4000, dps: p.dmg * 0.35 * pw, by: p.id });
        ctx.damageMonster(p, m, p.dmg * 1.6 * pw);
      }
    }, flight);
    return null;
  },

  // Зу'кра: пакт с духом — бафф по очереди, плата энергией или здоровьем
  spiritPact(ctx, p, _t, now) {
    const PACTS = ['fury', 'stone', 'wind'];
    if (!p.castFree) {
      if (p.res >= 30) p.res -= 30;
      else if (p.hp > p.maxHp * 0.15 + 1) { const cost = p.maxHp * 0.15; p.hp -= cost; ctx.pushFx({ t: 'hit', kind: 'p', target: p.id, dmg: Math.round(cost), from: null }); }
      else return 'Нечем платить духу';
    }
    const type = PACTS[(p.pactIndex || 0) % PACTS.length];
    p.pactIndex = (p.pactIndex || 0) + 1;
    p.pactType = type;
    p.pactUntil = now + 8000 * (p.castPower || 1);
    ctx.pushFx({ t: 'skill', s: 'spiritPact', from: p.id, x: p.x, y: p.y, pact: type });
    return null;
  },

  // Зу'кра: проклятие крови — урон со временем, половина урона возвращается ей
  bloodCurse(ctx, p, _t, now) {
    const pw = p.castPower || 1, r = 150;
    const targets = inRadius(ctx, p.x, p.y, r);
    for (const m of targets) {
      m.bloodCurseUntil = now + 6000;
      m.dots = (m.dots || []).concat({ until: now + 6000, dps: p.dmg * 0.4 * pw, by: p.id, leech: 0.5 });
    }
    ctx.pushFx({ t: 'skill', s: 'bloodCurse', from: p.id, x: p.x, y: p.y, r, ids: targets.map((m) => m.id) });
    return null;
  },

  // Нимуэ: шипы природы — урон по области и обездвиживание
  naturesThorns(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    const pw = p.castPower || 1, r = 90;
    ctx.pushFx({ t: 'skill', s: 'naturesThorns', from: p.id, x: t.x, y: t.y, r });
    for (const m of inRadius(ctx, t.x, t.y, r)) {
      m.rootUntil = Math.max(m.rootUntil || 0, now + 2000);
      ctx.damageMonster(p, m, p.dmg * 1.3 * pw);
    }
    return null;
  },

  // Нимуэ: лесное благословение — лечение и регенерация себе и союзникам
  forestBlessing(ctx, p, _t, now) {
    const pw = p.castPower || 1, r = 160;
    ctx.pushFx({ t: 'skill', s: 'forestBlessing', from: p.id, x: p.x, y: p.y, r });
    for (const o of ctx.players.values()) {
      if (o.dead || dist(o, p) > r) continue;
      ctx.healPlayer(o, o.maxHp * 0.2 * pw);
      o.regenUntil = now + 5000;
      o.regenRate = 0.03 * pw;
    }
    return null;
  },

  // Нимуэ: гнев леса — два духа природы отвлекают монстров на себя
  forestWrath(ctx, p, _t, now) {
    const pw = p.castPower || 1;
    for (const old of p.pets.filter((pet) => pet.kind === 'sprite')) ctx.removePet(old);
    const spirits = [-1, 1].map((side) => {
      const pet = createSummon(p, 'sprite', p.x + side * 30, p.y + 10, 12000, now);
      pet.maxHp = Math.round(pet.maxHp * pw); pet.hp = pet.maxHp;
      ctx.addPet(p, pet);
      return pet;
    });
    // Монстры вокруг переключаются на духов
    inRadius(ctx, p.x, p.y, 180).forEach((m, i) => { m.target = spirits[i % 2].id; });
    ctx.pushFx({ t: 'skill', s: 'forestWrath', from: p.id, x: p.x, y: p.y });
    return null;
  },

  // Ле Блан: двойник — иллюзия, которая отвлекает монстров на себя
  decoy(ctx, p, _t, now) {
    for (const old of p.pets.filter((pet) => pet.kind === 'clone')) ctx.removePet(old);
    const pet = createSummon(p, 'clone', p.x + p.dir * 24, p.y, 8000, now);
    ctx.addPet(p, pet);
    for (const m of inRadius(ctx, p.x, p.y, 200)) m.target = pet.id;
    ctx.pushFx({ t: 'skill', s: 'decoy', from: p.id, x: pet.x, y: pet.y });
    return null;
  },

  // Ле Блан: морок — монстры атакуют друг друга
  mirage(ctx, p, _t, now) {
    const r = 170;
    const targets = inRadius(ctx, p.x, p.y, r);
    for (const m of targets) { m.confusedUntil = now + 5000; m.confusedBy = p.id; m.target = null; }
    ctx.pushFx({ t: 'skill', s: 'mirage', from: p.id, x: p.x, y: p.y, r });
    return null;
  },

  // Ле Блан: вспышка обмана — урон вокруг и дезориентация
  deceptionFlash(ctx, p, _t, now) {
    const r = 130;
    ctx.pushFx({ t: 'skill', s: 'deceptionFlash', from: p.id, x: p.x, y: p.y, r });
    for (const m of inRadius(ctx, p.x, p.y, r)) {
      m.target = null;
      m.confusedUntil = Math.max(m.confusedUntil || 0, now + 2500);
      m.confusedBy = p.id;
      ctx.damageMonster(p, m, p.dmg * 1.5);
    }
    return null;
  },

  // Талиесин: перевоплощение — смена облика (бафф даёт пассивка «Двуликая суть»)
  shapeshift(ctx, p, _t, now) {
    p.form = p.form === 'beast' ? 'human' : 'beast';
    const ps = ctx.passiveOf(p);
    if (ps && ps.onShift) ps.onShift(p, now);
    ctx.pushFx({ t: 'skill', s: 'shapeshift', from: p.id, x: p.x, y: p.y, form: p.form });
    return null;
  },

  // Талиесин: зверь — рывок с рёвом и страхом; друид — шипы с обездвиживанием
  feralCharge(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    if (p.form === 'beast') {
      const fromX = p.x, fromY = p.y;
      const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1;
      ctx.teleport(p, t.x - (dx / d) * 26, t.y - (dy / d) * 26);
      p.dir = dx < 0 ? -1 : 1;
      ctx.pushFx({ t: 'skill', s: 'feralCharge', from: p.id, fx: fromX, fy: fromY, x: p.x, y: p.y, r: 100 });
      ctx.damageMonster(p, t, p.dmg * 1.8);
      for (const m of inRadius(ctx, p.x, p.y, 100)) {
        m.weakUntil = Math.max(m.weakUntil || 0, now + 4000);
        m.fearUntil = now + 1500; m.fearX = p.x; m.fearY = p.y; m.target = null;
      }
    } else {
      const r = 90;
      ctx.pushFx({ t: 'skill', s: 'naturesThorns', from: p.id, x: t.x, y: t.y, r });
      for (const m of inRadius(ctx, t.x, t.y, r)) {
        m.rootUntil = Math.max(m.rootUntil || 0, now + 2000);
        ctx.damageMonster(p, m, p.dmg * 1.2);
      }
    }
    return null;
  },

  // Талиесин: друид — лечение себя и союзников; зверь — вампиризм на 6 с
  forestBreath(ctx, p, _t, now) {
    if (p.form === 'beast') {
      p.feralLeechUntil = now + 6000;
      ctx.pushFx({ t: 'skill', s: 'feralThirst', from: p.id, x: p.x, y: p.y });
    } else {
      const r = 160;
      ctx.pushFx({ t: 'skill', s: 'forestBlessing', from: p.id, x: p.x, y: p.y, r });
      for (const o of ctx.players.values()) if (!o.dead && dist(o, p) <= r) ctx.healPlayer(o, o.maxHp * 0.2);
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

  // Кельт'о: проклятие нежити — вампиризм растёт за удары в бою; убийство лечит и усиливает атаку
  undeadCurse: {
    onDealt(ctx, p, dmg, now) {
      p.devour = Math.min(20, (p.devour || 0) + 1);
      p.lastDevour = now;
      const steal = dmg * (0.1 + 0.01 * p.devour);
      if (steal >= 1 && p.hp < p.maxHp) { p.hp = Math.min(p.maxHp, p.hp + steal); p.dirty = true; }
    },
    onKill(ctx, p, now) {
      ctx.healPlayer(p, p.maxHp * 0.08);
      p.empoweredUntil = now + 8000;
      p.empMult = 1.5;
    },
    onTick(p, now) { if (p.devour && now - p.lastDevour > 5000) { p.devour = 0; p.dirty = true; } },
    note: (p) => `вампиризм ${10 + (p.devour || 0)}%`,
  },

  // Брендан: несокрушимость — защита растёт от ударов, авто-щит при низком здоровье
  unbreakable: {
    dmgTakenMult: (p) => 1 - 0.03 * (p.bulwark || 0),
    onHurt(ctx, p) {
      const now = Date.now();
      p.bulwark = Math.min(10, (p.bulwark || 0) + 1);
      if (p.hp / p.maxHp < 0.3 && now >= (p.autoShieldAt || 0)) {
        p.autoShieldAt = now + 30000;
        ctx.giveShield(p, p.maxHp * 0.3, now + 8000);
        ctx.pushFx({ t: 'skill', s: 'autoShield', from: p.id, x: p.x, y: p.y, quiet: true });
      }
    },
    onTick(p, now) { if (p.bulwark && now - p.lastHurt > 5000) { p.bulwark = 0; p.dirty = true; } },
    note: (p) => `защита +${3 * (p.bulwark || 0)}% · щит ${Date.now() >= (p.autoShieldAt || 0) ? 'готов' : 'через ' + Math.ceil(((p.autoShieldAt || 0) - Date.now()) / 1000) + ' с'}`,
  },

  // Кира: чутьё на слабости — периодически подсвечивает уязвимые точки; убийства ускоряют навыки
  keenEye: {
    targetMult: (p, m) => (m.weakSpotBy === p.id && m.weakSpotUntil > Date.now() ? 1.5 : 1),
    onTick(p, now, ctx) {
      if (now < (p.nextWeakScan || 0)) return;
      p.nextWeakScan = now + 6000;
      const near = [...ctx.monsters.values()]
        .map((m) => [m, Math.hypot(m.x - p.x, m.y - p.y)]).filter(([, d]) => d < 250)
        .sort((a, b) => a[1] - b[1]).slice(0, 3);
      for (const [m] of near) { m.weakSpotBy = p.id; m.weakSpotUntil = now + 4000; }
      if (near.length) ctx.pushFx({ t: 'skill', s: 'weakSpots', from: p.id, x: p.x, y: p.y, quiet: true, ids: near.map(([m]) => m.id) });
    },
    onKill(ctx, p, now) {
      for (const id of Object.keys(p.skillReadyAt)) p.skillReadyAt[id] = Math.max(now, p.skillReadyAt[id] - 1000);
      ctx.syncCooldowns(p, now);
    },
  },

  // Кассиан: жнец — удары в спину и по не заметившему монстру сильнее; убийства заряжают «Удар из тени»
  reaper: {
    targetMult: (p, m) => (m.target !== p.id || (m.face && Math.sign(p.x - m.x) === -m.face) ? 1.5 : 1),
    onKill(ctx, p) { p.reapStacks = Math.min(5, (p.reapStacks || 0) + 1); p.dirty = true; },
    note: (p) => `жатва ${p.reapStacks || 0}/5${p.stealthUntil > Date.now() ? ' · в тени' : ''}`,
  },

  // Зу'кра: дар духов — убийства копят силу следующего заклинания; при нехватке энергии — бесплатный усиленный навык
  spiritGift: {
    beforeCast(p) {
      const free = p.res < p.resMax * 0.25 && Date.now() >= (p.giftReadyAt || 0);
      return { free, power: (1 + 0.15 * (p.giftStacks || 0)) * (free ? 1.5 : 1) };
    },
    afterCast(ctx, p, boosted) {
      p.giftStacks = 0;
      if (boosted) { p.giftReadyAt = Date.now() + 20000; ctx.pushFx({ t: 'skill', s: 'spiritGiftUsed', from: p.id, x: p.x, y: p.y, quiet: true }); }
    },
    onKill(ctx, p) { p.giftStacks = Math.min(5, (p.giftStacks || 0) + 1); p.dirty = true; },
    note(p) {
      const next = ['Демон ярости', 'Дух камня', 'Дух ветра'][(p.pactIndex || 0) % 3];
      const gift = Date.now() >= (p.giftReadyAt || 0) ? 'дар готов' : 'дар через ' + Math.ceil((p.giftReadyAt - Date.now()) / 1000) + ' с';
      return `сила +${15 * (p.giftStacks || 0)}% · ${gift} · след. пакт: ${next}`;
    },
  },

  // Нимуэ: корни жизни — сила природы копится, пока она стоит на месте
  rootsOfLife: {
    beforeCast: (p) => ({ free: false, power: 1 + 0.5 * (p.nature || 0) / 100 }),
    dmgTakenMult: (p) => ((p.nature || 0) >= 100 ? 0.75 : 1),
    onTick(p, now) {
      const dt = Math.min(0.5, (now - (p.natureTick || now)) / 1000);
      p.natureTick = now;
      const before = p.nature || 0;
      const still = now - (p.movedAt || 0) > 800;
      p.nature = Math.max(0, Math.min(100, before + (still ? 10 : -20) * dt));
      if (p.nature > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.015 * (p.nature / 100) * dt);
      if (Math.floor(before / 5) !== Math.floor(p.nature / 5)) p.dirty = true;
    },
    note: (p) => `сила природы ${Math.round(p.nature || 0)}%${(p.nature || 0) >= 100 ? ' · Облик древа' : ''}`,
  },

  // Ле Блан: маска иллюзий — подмена двойником при ударе; урон растёт от числа отвлечённых монстров
  maskOfIllusions: {
    dmgMult: (p) => 1 + 0.1 * Math.min(5, p.distracted || 0),
    // Вызывается до получения урона: true — удар достался иллюзии
    avoidHit(ctx, p, m, now) {
      if (now < (p.swapReadyAt || 0) || Math.random() >= 0.25) return false;
      p.swapReadyAt = now + 4000;
      const pet = createSummon(p, 'clone', p.x, p.y, 3000, now);
      ctx.addPet(p, pet);
      if (m) m.target = pet.id;
      ctx.pushFx({ t: 'skill', s: 'illusionSwap', from: p.id, x: p.x, y: p.y, quiet: true });
      return true;
    },
    onTick(p, now, ctx) {
      const clones = new Set(p.pets.filter((pet) => pet.kind === 'clone').map((pet) => pet.id));
      let n = 0;
      for (const m of ctx.monsters.values()) {
        if (clones.has(m.target) || (m.confusedBy === p.id && m.confusedUntil > now)) n++;
      }
      if (n !== p.distracted) { p.distracted = n; p.dirty = true; }
    },
    note: (p) => `отвлечено: ${p.distracted || 0}`,
  },

  // Талиесин: двуликая суть — бафф за смену облика, сильнее при частой смене
  dualNature: {
    onShift(p, now) {
      p.shiftStacks = now - (p.lastShift || 0) < 10000 ? Math.min(5, (p.shiftStacks || 0) + 1) : 0;
      p.lastShift = now;
      p.dualUntil = now + 6000;
      p.dirty = true;
    },
    power: (p) => 1 + 0.2 * (p.shiftStacks || 0),
    active: (p, form) => p.dualUntil > Date.now() && p.form === form,
    dmgMult(p) { return this.active(p, 'beast') ? 1 + 0.3 * this.power(p) : 1; },
    speedMult(p) { return this.active(p, 'beast') ? 1 + 0.25 * this.power(p) : 1; },
    dmgTakenMult(p) { return this.active(p, 'human') ? Math.max(0.4, 1 - 0.3 * this.power(p)) : 1; },
    onTick(p, now) {
      if (this.active(p, 'human') && p.hp < p.maxHp) { p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.02 * this.power(p) * 0.1); p.dirty = true; }
      if (p.shiftStacks && now - p.lastShift > 10000) { p.shiftStacks = 0; p.dirty = true; }
    },
    note(p) {
      const form = p.form === 'beast' ? 'облик зверя' : 'облик друида';
      return `${form}${p.dualUntil > Date.now() ? ' · бафф ×' + this.power(p).toFixed(1) : ''}`;
    },
  },
};

// Умения, которым нужна цель в пределах дальности (для остальных цель не обязательна)
const NEEDS_TARGET = new Set(['feralCharge', 'darkFlame', 'naturesThorns', 'exposeStrike', 'poisonBlade', 'shadowStrike', 'execution', 'lifeSteal', 'punishSeal', 'darkBlade', 'markPrey', 'shadowDash', 'sic', 'enlighten', 'stoneThrow', 'twinSlash', 'spiritWrath', 'chainLightning']);
// Дальность умения (по умолчанию — дальность атаки героя, но не меньше 120)
const SKILL_RANGE = { feralCharge: 230, exposeStrike: 75, poisonBlade: 75, shadowStrike: 85, execution: 80, lifeSteal: 200, punishSeal: 300, darkBlade: 260, markPrey: 320, shadowDash: 260, sic: 320, enlighten: 80, qiWave: 170, stoneThrow: 320, twinSlash: 80, blindRage: 200 };
const skillRange = (id, hero) => SKILL_RANGE[id] ?? Math.max(hero.range, 120) + 20;

module.exports = { SKILLS, PASSIVES, NEEDS_TARGET, skillRange };
