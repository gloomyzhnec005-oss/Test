// Уникальные умения героев. Каждое умение — функция (ctx, p, target, now) → строка ошибки или null.
// ctx: { monsters, players, pushFx, damageMonster, healPlayer, teleport, knockback, isSolidAt, addTotem, addGround,
//        giveShield, takeCorpse, addPet, removePet, syncCooldowns, moveEntity }
const { petDmg, petsNear, createSummon, createDevice } = require('./pets');
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

  // Аурелиус: смена стихии по кругу
  elementSwap(ctx, p, _t, now) {
    const ORDER = ['fire', 'ice', 'lightning', 'earth'];
    p.form = ORDER[(ORDER.indexOf(p.form) + 1) % ORDER.length];
    const ps = ctx.passiveOf(p);
    if (ps && ps.onShift) ps.onShift(p, now, ctx);
    ctx.pushFx({ t: 'skill', s: 'elementSwap', from: p.id, x: p.x, y: p.y, el: p.form });
    return null;
  },

  // Аурелиус: стихийный снаряд — эффект зависит от стихии
  elementBolt(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    const pw = p.castPower || 1, el = p.form;
    const flight = Math.min(400, dist(p, t) * 1.3);
    const chain = [t];
    if (el === 'lightning') {
      while (chain.length < 3) {
        const last = chain[chain.length - 1];
        let next = null, best = 140;
        for (const m of ctx.monsters.values()) { if (chain.includes(m)) continue; const d = dist(m, last); if (d < best) { best = d; next = m; } }
        if (!next) break;
        chain.push(next);
      }
    }
    ctx.pushFx({ t: 'skill', s: 'elementBolt', from: p.id, fx: p.x, fy: p.y, x: t.x, y: t.y, el, flight,
      pts: chain.map((m) => [Math.round(m.x), Math.round(m.y)]) });
    setTimeout(() => {
      if (!alive(ctx, p)) return;
      chain.forEach((m, i) => {
        if (!ctx.monsters.has(m.id)) return;
        const tn = Date.now();
        if (el === 'fire') { m.burnUntil = tn + 4000; m.dots = (m.dots || []).concat({ until: tn + 4000, dps: p.dmg * 0.35 * pw, by: p.id }); }
        if (el === 'ice') m.slowUntil = Math.max(m.slowUntil || 0, tn + 4000);
        if (el === 'earth') m.stunUntil = Math.max(m.stunUntil || 0, tn + 1200);
        ctx.damageMonster(p, m, p.dmg * 1.6 * pw * [1, 0.8, 0.6][i]);
      });
    }, el === 'lightning' ? 0 : flight);
    return null;
  },

  // Аурелиус: стихийный шторм по области
  elementStorm(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    const pw = p.castPower || 1, el = p.form, r = 120, x = t.x, y = t.y;
    ctx.pushFx({ t: 'skill', s: 'elementStorm', from: p.id, x, y, r, el });
    const hit = (mult, fn) => { for (const m of inRadius(ctx, x, y, r)) { if (fn) fn(m, Date.now()); ctx.damageMonster(p, m, p.dmg * mult * pw); } };
    if (el === 'fire') setTimeout(() => alive(ctx, p) && hit(2, (m, tn) => { m.burnUntil = tn + 5000; m.dots = (m.dots || []).concat({ until: tn + 5000, dps: p.dmg * 0.4 * pw, by: p.id }); }), 300);
    if (el === 'ice') setTimeout(() => alive(ctx, p) && hit(1.5, (m, tn) => { m.stunUntil = Math.max(m.stunUntil || 0, tn + 2000); m.frozenUntil = tn + 2000; }), 300);
    if (el === 'lightning') for (let i = 0; i < 3; i++) setTimeout(() => alive(ctx, p) && hit(0.8), 200 + i * 300);
    if (el === 'earth') setTimeout(() => alive(ctx, p) && hit(2.2, (m, tn) => {
      m.stunUntil = Math.max(m.stunUntil || 0, tn + 1000);
      const dx = m.x - x, dy = m.y - y, d = Math.hypot(dx, dy) || 1;
      ctx.knockback(m, dx / d, dy / d, 60);
    }), 350);
    return null;
  },

  // Валериан: святой обет по кругу
  holyVow(ctx, p, _t, now) {
    const ORDER = ['protection', 'retribution', 'mercy'];
    p.form = ORDER[(ORDER.indexOf(p.form) + 1) % ORDER.length];
    p.vowSince = now; // верность обету начинается заново
    ctx.pushFx({ t: 'skill', s: 'holyVow', from: p.id, x: p.x, y: p.y, vow: p.form });
    return null;
  },

  // Валериан: небесный удар — эффект зависит от обета
  heavenStrike(ctx, p, t, now) {
    if (!t) return 'Нет цели рядом';
    const pw = p.castPower || 1, vow = p.form;
    ctx.pushFx({ t: 'skill', s: 'heavenStrike', from: p.id, x: t.x, y: t.y, vow });
    if (vow === 'retribution') {
      t.stunUntil = Math.max(t.stunUntil || 0, now + 1000);
      ctx.damageMonster(p, t, p.dmg * 2.7 * pw);
    } else {
      ctx.damageMonster(p, t, p.dmg * 1.8 * pw);
      if (vow === 'protection') ctx.giveShield(p, p.maxHp * 0.15 * pw, now + 8000);
      if (vow === 'mercy') for (const o of ctx.players.values()) if (!o.dead && dist(o, p) <= 150) ctx.healPlayer(o, o.maxHp * 0.1 * pw);
    }
    return null;
  },

  // Валериан: святая аура — освящённая земля на 6 с
  holyAura(ctx, p, _t, now) {
    const pw = (p.castPower || 1) * (1 + 0.1 * (p.zeal || 0)), vow = p.form, r = 130, x = p.x, y = p.y;
    ctx.addGround({
      kind: 'holyAura', owner: p.id, x, y: y + 6, r, until: now + 6000,
      tick(tnow) {
        if (!ctx.players.has(p.id)) return;
        for (const m of inRadius(ctx, x, y, r)) ctx.damageMonster(p, m, p.dmg * 0.5 * (vow === 'retribution' ? 1.8 : 1) * pw);
        for (const o of ctx.players.values()) {
          if (o.dead || Math.hypot(o.x - x, o.y - y) > r) continue;
          ctx.healPlayer(o, o.maxHp * (vow === 'mercy' ? 0.04 : 0.02) * pw);
          o.holyAuraUntil = tnow + 1100;
          o.holyAuraMult = vow === 'protection' ? 0.65 : 0.8;
        }
      },
    });
    ctx.pushFx({ t: 'skill', s: 'holyAuraCast', from: p.id, x, y, r, vow });
    return null;
  },

  // Юстина: молитва исцеления — лечение и снятие ослаблений
  healingPrayer(ctx, p, _t, now) {
    const pw = p.castPower || 1, r = 180;
    ctx.pushFx({ t: 'skill', s: 'healingPrayer', from: p.id, x: p.x, y: p.y, r });
    for (const o of ctx.players.values()) {
      if (o.dead || dist(o, p) > r) continue;
      ctx.healPlayer(o, o.maxHp * 0.25 * pw * (p.healBoost || 1));
      o.debuffs = []; // ослабления на игроках (задел: монстры пока их не накладывают)
    }
    return null;
  },

  // Юстина: изгнание тьмы — урон и отбрасывание, двойной против нежити
  banishDarkness(ctx, p, t) {
    if (!t) return 'Нет цели';
    const pw = p.castPower || 1, r = 90, x = t.x, y = t.y;
    ctx.pushFx({ t: 'skill', s: 'banishDarkness', from: p.id, x, y, r });
    for (const m of inRadius(ctx, x, y, r)) {
      ctx.damageMonster(p, m, p.dmg * 1.5 * pw * (ctx.isUndead(m) ? 2 : 1));
      const dx = m.x - x, dy = m.y - y, d = Math.hypot(dx, dy) || 1;
      ctx.knockback(m, dx / d, dy / d, 60);
    }
    return null;
  },

  // Юстина: благословение союзникам
  blessing(ctx, p, _t, now) {
    const pw = p.castPower || 1, r = 200;
    const ids = [];
    for (const o of ctx.players.values()) {
      if (o.dead || dist(o, p) > r) continue;
      o.blessUntil = now + 8000 * pw;
      ids.push(o.id);
    }
    ctx.pushFx({ t: 'skill', s: 'blessing', from: p.id, x: p.x, y: p.y, r, ids });
    return null;
  },

  // Джакомо: смена песни по кругу (вдохновение копится и тратится на усиление новой песни)
  songSwap(ctx, p, _t, now) {
    const ORDER = ['inspire', 'lullaby', 'mock'];
    p.form = ORDER[(ORDER.indexOf(p.form) + 1) % ORDER.length];
    p.songPower = 1 + (p.inspiration || 0) / 100;
    p.songPowerUntil = now + 10000;
    p.inspiration = 0;
    ctx.pushFx({ t: 'skill', s: 'songSwap', from: p.id, x: p.x, y: p.y, song: p.form });
    return null;
  },

  // Джакомо: звучный аккорд — урон и оглушение вокруг, усиливается вдохновением
  resonantChord(ctx, p, _t, now) {
    const pw = 1 + (p.inspiration || 0) / 100, r = 120;
    p.inspiration = 0;
    ctx.pushFx({ t: 'skill', s: 'resonantChord', from: p.id, x: p.x, y: p.y, r, pw });
    for (const m of inRadius(ctx, p.x, p.y, r)) {
      m.stunUntil = Math.max(m.stunUntil || 0, now + 1500);
      ctx.damageMonster(p, m, p.dmg * 1.6 * pw);
    }
    return null;
  },

  // Джакомо: овация — союзникам ускорение перезарядки и усиленная следующая атака
  ovation(ctx, p, _t, now) {
    const r = 200, ids = [];
    for (const o of ctx.players.values()) {
      if (o.dead || dist(o, p) > r) continue;
      for (const id of Object.keys(o.skillReadyAt || {})) o.skillReadyAt[id] = Math.max(now, o.skillReadyAt[id] - 3000);
      if (o !== p) ctx.syncCooldowns(o, now);
      o.nextAttackBoost = 1.5;
      ids.push(o.id);
    }
    ctx.pushFx({ t: 'skill', s: 'ovation', from: p.id, x: p.x, y: p.y, ids });
    return null;
  },

  // Орион: поднятие мертвеца — павший монстр становится слугой со своей силой
  raiseCorpse(ctx, p, _t, now) {
    const corpse = ctx.takeCorpse(p.x, p.y, 250, now);
    if (!corpse) return 'Нет павших монстров рядом';
    ctx.raiseMinion(p, corpse, now);
    return null;
  },

  // Орион: тёмная стрела — урон и ослабление
  darkArrow(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    const flight = Math.min(400, dist(p, t) * 1.3);
    ctx.pushFx({ t: 'skill', s: 'darkArrow', from: p.id, fx: p.x, fy: p.y, x: t.x, y: t.y, flight });
    setTimeout(() => {
      if (!alive(ctx, p, t)) return;
      t.weakUntil = Math.max(t.weakUntil || 0, Date.now() + 5000);
      ctx.damageMonster(p, t, p.dmg * 1.8);
    }, flight);
    return null;
  },

  // Орион: пожирание душ — урон вокруг, лечение себе и слугам
  soulDevour(ctx, p, _t, now) {
    const r = 150;
    const targets = inRadius(ctx, p.x, p.y, r);
    ctx.pushFx({ t: 'skill', s: 'soulDevour', from: p.id, x: p.x, y: p.y, r, ids: targets.map((m) => m.id) });
    let dealt = 0;
    for (const m of targets) dealt += ctx.damageMonster(p, m, p.dmg);
    if (dealt > 0) ctx.healPlayer(p, dealt / 3);
    for (const pet of p.pets) if (!pet.down) pet.hp = Math.min(pet.maxHp, pet.hp + pet.maxHp * 0.3);
    return null;
  },

  // Фаэлин: звёздный выстрел — урон и звёздная метка
  starShot(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    const flight = Math.min(400, dist(p, t) * 1.2);
    ctx.pushFx({ t: 'skill', s: 'starShot', from: p.id, fx: p.x, fy: p.y, x: t.x, y: t.y, flight });
    setTimeout(() => {
      if (!alive(ctx, p, t)) return;
      t.starBy = p.id; t.starUntil = Date.now() + 12000;
      t.fearUntil = 0; t.confusedUntil = 0; // метка не даёт скрыться
      ctx.damageMonster(p, t, p.dmg * 2);
    }, flight);
    return null;
  },

  // Фаэлин: град света — три волны по области
  lightHail(ctx, p, t) {
    if (!t) return 'Нет цели';
    const r = 110, x = t.x, y = t.y;
    ctx.pushFx({ t: 'skill', s: 'lightHail', from: p.id, x, y, r });
    for (let i = 0; i < 3; i++) setTimeout(() => { if (alive(ctx, p)) for (const m of inRadius(ctx, x, y, r)) ctx.damageMonster(p, m, p.dmg * 0.8); }, 300 + i * 350);
    return null;
  },

  // Фаэлин: свет ветра — ускорение себя и союзников
  windLight(ctx, p, _t, now) {
    const ids = [];
    for (const o of ctx.players.values()) {
      if (o.dead || dist(o, p) > 200) continue;
      o.hasteUntil = now + 7000; ids.push(o.id); o.dirty = true;
    }
    ctx.pushFx({ t: 'skill', s: 'windLight', from: p.id, x: p.x, y: p.y, ids });
    return null;
  },

  // Илирия: арканный залп — 5 снарядов после подготовки
  arcaneVolley(ctx, p, t) {
    if (!t) return 'Нет цели';
    const pw = p.castPower || 1;
    ctx.pushFx({ t: 'skill', s: 'casting', from: p.id, x: p.x, y: p.y, ms: 500 });
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        if (!alive(ctx, p, t) || p.dead) return;
        ctx.pushFx({ t: 'skill', s: 'arcaneMissile', from: p.id, fx: p.x, fy: p.y, x: t.x, y: t.y, quiet: true });
        ctx.damageMonster(p, t, p.dmg * 0.6 * pw);
        for (const m of inRadius(ctx, t.x, t.y, 60)) if (m !== t) ctx.damageMonster(p, m, p.dmg * 0.3 * pw);
      }, 500 + i * 130);
    }
    return null;
  },

  // Илирия: ледяная хватка — обездвиживание и урон со временем после подготовки
  iceGrip(ctx, p, t) {
    if (!t) return 'Нет цели';
    const pw = p.castPower || 1, r = 100, x = t.x, y = t.y;
    ctx.pushFx({ t: 'skill', s: 'casting', from: p.id, x: p.x, y: p.y, ms: 800 });
    setTimeout(() => {
      if (!alive(ctx, p) || p.dead) return;
      const tn = Date.now();
      ctx.pushFx({ t: 'skill', s: 'iceGrip', from: p.id, x, y, r, quiet: true });
      for (const m of inRadius(ctx, x, y, r)) {
        m.rootUntil = Math.max(m.rootUntil || 0, tn + 3000);
        m.frozenUntil = tn + 3000;
        m.dots = (m.dots || []).concat({ until: tn + 4000, dps: p.dmg * 0.5 * pw, by: p.id });
        ctx.damageMonster(p, m, p.dmg * 0.8 * pw);
      }
    }, 800);
    return null;
  },

  // Илирия: магический барьер с отражением
  magicBarrier(ctx, p, _t, now) {
    const pw = p.castPower || 1;
    ctx.giveShield(p, p.maxHp * 0.3 * pw, now + 8000);
    p.reflectShieldUntil = now + 8000;
    ctx.pushFx({ t: 'skill', s: 'magicBarrier', from: p.id, x: p.x, y: p.y });
    return null;
  },

  // Тибор: эликсир по очереди, повышает токсичность
  elixir(ctx, p, _t, now) {
    const ORDER = ['thunder', 'blizzard', 'swallow', 'oriole'];
    const potion = p.potion || 'thunder';
    p.potion = ORDER[(ORDER.indexOf(potion) + 1) % ORDER.length];
    p.potions = p.potions || {};
    p.potions[potion] = now + 15000;
    if (potion === 'blizzard') p.hasteUntil = now + 15000;
    if (potion === 'swallow') { p.regenUntil = now + 15000; p.regenRate = 0.03; }
    p.tox = (p.tox || 0) + 30;
    let poisoned = false;
    if (p.tox > 100) {
      poisoned = true;
      p.tox = 100;
      const dmg = Math.min(p.hp - 1, p.maxHp * 0.15);
      p.hp -= dmg;
      ctx.pushFx({ t: 'hit', kind: 'p', target: p.id, dmg: Math.round(dmg), from: null });
    }
    ctx.pushFx({ t: 'skill', s: 'elixir', from: p.id, x: p.x, y: p.y, potion, poisoned });
    return null;
  },

  // Тибор: знаки по очереди — Игни, Аард, Квен
  witcherSign(ctx, p, t, now) {
    const ORDER = ['igni', 'aard', 'quen'];
    const sign = p.sign || 'igni';
    if (sign !== 'quen' && !t) return 'Нет цели рядом';
    p.sign = ORDER[(ORDER.indexOf(sign) + 1) % ORDER.length];
    if (sign === 'quen') {
      ctx.giveShield(p, p.maxHp * 0.25, now + 10000);
      ctx.pushFx({ t: 'skill', s: 'witcherSign', from: p.id, x: p.x, y: p.y, sign });
      return null;
    }
    let dx = t.x - p.x, dy = t.y - p.y;
    const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    p.dir = dx < 0 ? -1 : 1;
    ctx.pushFx({ t: 'skill', s: 'witcherSign', from: p.id, x: p.x, y: p.y, dx, dy, sign });
    for (const m of ctx.monsters.values()) {
      const rx = m.x - p.x, ry = m.y - p.y, dist2 = Math.hypot(rx, ry);
      if (dist2 > 150 || (rx * dx + ry * dy) / (dist2 || 1) < 0.5) continue; // конус ~60°
      if (sign === 'igni') {
        m.burnUntil = now + 4000;
        m.dots = (m.dots || []).concat({ until: now + 4000, dps: p.dmg * 0.35, by: p.id });
        ctx.damageMonster(p, m, p.dmg * 1.6);
      } else {
        ctx.knockback(m, rx / (dist2 || 1), ry / (dist2 || 1), 80);
        m.stunUntil = Math.max(m.stunUntil || 0, now + 1000);
        ctx.damageMonster(p, m, p.dmg * 0.8);
      }
    }
    return null;
  },

  // Тибор: вихрь клинков — три удара вокруг
  bladeWhirl(ctx, p) {
    ctx.pushFx({ t: 'skill', s: 'bloodWhirl', from: p.id, x: p.x, y: p.y, r: 90, steel: true });
    for (let i = 0; i < 3; i++) {
      setTimeout(() => { if (alive(ctx, p) && !p.dead) for (const m of inRadius(ctx, p.x, p.y, 90)) ctx.damageMonster(p, m, p.dmg * 0.75); }, i * 200);
    }
    return null;
  },

  // Ингрид: турель (до 3), на максимуме — ремонт самой повреждённой
  buildTurret(ctx, p, _t, now) {
    const turrets = p.pets.filter((pet) => pet.kind === 'turret');
    if (turrets.length >= 3) {
      const worst = turrets.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      worst.down = false; worst.hp = worst.maxHp;
      ctx.pushFx({ t: 'skill', s: 'repair', from: p.id, x: worst.x, y: worst.y });
      return null;
    }
    const pet = createDevice(p, 'turret');
    pet.x = p.x + p.dir * 26; pet.y = p.y + 8;
    ctx.addPet(p, pet);
    ctx.pushFx({ t: 'skill', s: 'buildTurret', from: p.id, x: pet.x, y: pet.y });
    return null;
  },

  // Ингрид: бомба по области с отбрасыванием
  bomb(ctx, p, t) {
    if (!t) return 'Нет цели';
    const r = 90, x = t.x, y = t.y, flight = Math.min(500, dist(p, t) * 1.5);
    ctx.pushFx({ t: 'skill', s: 'bomb', from: p.id, fx: p.x, fy: p.y, x, y, r, flight });
    setTimeout(() => {
      if (!alive(ctx, p)) return;
      for (const m of inRadius(ctx, x, y, r)) {
        ctx.damageMonster(p, m, p.dmg * 2);
        const dx = m.x - x, dy = m.y - y, d = Math.hypot(dx, dy) || 1;
        ctx.knockback(m, dx / d, dy / d, 70);
      }
    }, flight);
    return null;
  },

  // Ингрид: ремонт и разгон механизмов
  overclock(ctx, p, _t, now) {
    const turrets = p.pets.filter((pet) => pet.kind === 'turret');
    if (!turrets.length) return 'Нет механизмов';
    for (const pet of turrets) { pet.down = false; pet.hp = pet.maxHp; pet.boostUntil = now + 8000; }
    ctx.pushFx({ t: 'skill', s: 'overclock', from: p.id, x: p.x, y: p.y, ids: turrets.map((pet) => pet.id) });
    return null;
  },

  // Талмира: небесное копьё — урон и пригвождение
  heavenSpear(ctx, p, t) {
    if (!t) return 'Нет цели';
    const flight = Math.min(350, dist(p, t) * 1.2);
    ctx.pushFx({ t: 'skill', s: 'heavenSpear', from: p.id, fx: p.x, fy: p.y, x: t.x, y: t.y, flight });
    setTimeout(() => {
      if (!alive(ctx, p, t)) return;
      t.rootUntil = Math.max(t.rootUntil || 0, Date.now() + 2500);
      ctx.damageMonster(p, t, p.dmg * 1.8);
    }, flight);
    return null;
  },

  // Талмира: взлёт на 5 с, при приземлении — удар сверху
  takeFlight(ctx, p, _t, now) {
    p.flyUntil = now + 5000;
    for (const m of ctx.monsters.values()) if (m.target === p.id) m.target = null;
    ctx.pushFx({ t: 'skill', s: 'takeFlight', from: p.id, x: p.x, y: p.y });
    setTimeout(() => {
      if (!ctx.players.has(p.id) || p.dead) return;
      ctx.pushFx({ t: 'skill', s: 'dive', from: p.id, x: p.x, y: p.y, r: 90 });
      for (const m of inRadius(ctx, p.x, p.y, 90)) ctx.damageMonster(p, m, p.dmg * 1.5);
    }, 5000);
    return null;
  },

  // Талмира: клич валькирии — бафф союзникам и страх монстрам
  valkyrieCry(ctx, p, _t, now) {
    for (const o of ctx.players.values()) if (!o.dead && dist(o, p) <= 200) o.cryUntil = now + 8000;
    for (const m of inRadius(ctx, p.x, p.y, 150)) { m.fearUntil = now + 2000; m.fearX = p.x; m.fearY = p.y; m.target = null; }
    ctx.pushFx({ t: 'skill', s: 'valkyrieCry', from: p.id, x: p.x, y: p.y, r: 200 });
    return null;
  },

  // Сангвейн: кровавый шип — урон и кровотечение (плата здоровьем — hpCost)
  bloodSpike(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    const flight = Math.min(350, dist(p, t) * 1.2);
    ctx.pushFx({ t: 'skill', s: 'bloodSpike', from: p.id, fx: p.x, fy: p.y, x: t.x, y: t.y, flight });
    setTimeout(() => {
      if (!alive(ctx, p, t)) return;
      t.bleedUntil = Date.now() + 5000;
      t.dots = (t.dots || []).concat({ until: Date.now() + 5000, dps: p.dmg * 0.4, by: p.id });
      ctx.damageMonster(p, t, p.dmg * 1.8);
    }, flight);
    return null;
  },

  // Сангвейн: ритуал крови — мощный урон вокруг
  bloodRitual(ctx, p) {
    const r = 130;
    ctx.pushFx({ t: 'skill', s: 'bloodRitual', from: p.id, x: p.x, y: p.y, r });
    setTimeout(() => { if (alive(ctx, p) && !p.dead) for (const m of inRadius(ctx, p.x, p.y, r)) ctx.damageMonster(p, m, p.dmg * 3); }, 300);
    return null;
  },

  // Сангвейн: кровавая связь — урон делится между связанными
  bloodBond(ctx, p, _t, now) {
    const targets = inRadius(ctx, p.x, p.y, 160);
    if (targets.length < 2) return 'Нужно хотя бы два монстра рядом';
    for (const m of targets) { m.bondBy = p.id; m.bondUntil = now + 8000; }
    ctx.pushFx({ t: 'skill', s: 'bloodBond', from: p.id, x: p.x, y: p.y, pts: targets.map((m) => [Math.round(m.x), Math.round(m.y)]) });
    return null;
  },

  // Зефира: дыхание дракона конусом; после выдоха аспект сменяется
  dragonBreath(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    const ORDER = ['fire', 'ice', 'poison', 'lightning'];
    const asp = p.form || 'fire', pw = p.castPower || 1;
    let dx = t.x - p.x, dy = t.y - p.y;
    const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    p.dir = dx < 0 ? -1 : 1;
    const hit = [];
    for (const m of ctx.monsters.values()) {
      const rx = m.x - p.x, ry = m.y - p.y, dd = Math.hypot(rx, ry);
      if (dd <= 170 && (rx * dx + ry * dy) / (dd || 1) >= 0.55) hit.push(m);
    }
    if (asp === 'lightning') {
      // Молния перескакивает ещё на 2 врагов от цели
      const chain = [t];
      while (chain.length < 3) {
        const last = chain[chain.length - 1];
        let next = null, best = 140;
        for (const m of ctx.monsters.values()) { if (chain.includes(m) || hit.includes(m)) continue; const q = dist(m, last); if (q < best) { best = q; next = m; } }
        if (!next) break;
        chain.push(next);
      }
      for (const m of chain) if (!hit.includes(m)) hit.push(m);
    }
    ctx.pushFx({ t: 'skill', s: 'dragonBreath', from: p.id, x: p.x, y: p.y, dx, dy, asp, pts: hit.map((m) => [Math.round(m.x), Math.round(m.y)]) });
    for (const m of hit) {
      if (asp === 'fire') { m.burnUntil = now + 4000; m.dots = (m.dots || []).concat({ until: now + 4000, dps: p.dmg * 0.4 * pw, by: p.id }); }
      if (asp === 'ice') { m.stunUntil = Math.max(m.stunUntil || 0, now + 1500); m.frozenUntil = now + 1500; }
      if (asp === 'poison') { m.poisonUntil = now + 6000; m.slowUntil = Math.max(m.slowUntil || 0, now + 6000); m.dots = (m.dots || []).concat({ until: now + 6000, dps: p.dmg * 0.55 * pw, by: p.id }); }
      ctx.damageMonster(p, m, p.dmg * 1.5 * pw);
    }
    p.form = ORDER[(ORDER.indexOf(asp) + 1) % ORDER.length];
    return null;
  },

  // Зефира: драконьи крылья — взлёт и падение на цель
  dragonWings(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    const asp = p.form || 'fire', pw = p.castPower || 1, x = t.x, y = t.y;
    p.flyUntil = now + 1000;
    for (const m of ctx.monsters.values()) if (m.target === p.id) m.target = null;
    ctx.pushFx({ t: 'skill', s: 'takeFlight', from: p.id, x: p.x, y: p.y, quiet: true });
    setTimeout(() => {
      if (!ctx.players.has(p.id) || p.dead) return;
      ctx.teleport(p, x, y + 4);
      const tn = Date.now();
      ctx.pushFx({ t: 'skill', s: 'dragonDive', from: p.id, x, y, r: 95, asp });
      for (const m of inRadius(ctx, x, y, 95)) {
        if (asp === 'fire') { m.burnUntil = tn + 3000; m.dots = (m.dots || []).concat({ until: tn + 3000, dps: p.dmg * 0.3 * pw, by: p.id }); }
        if (asp === 'ice') m.slowUntil = Math.max(m.slowUntil || 0, tn + 3000);
        if (asp === 'poison') { m.poisonUntil = tn + 4000; m.dots = (m.dots || []).concat({ until: tn + 4000, dps: p.dmg * 0.3 * pw, by: p.id }); }
        if (asp === 'lightning') m.stunUntil = Math.max(m.stunUntil || 0, tn + 800);
        ctx.damageMonster(p, m, p.dmg * 2 * pw);
      }
    }, 1000);
    return null;
  },

  // Зефира: звериная мощь
  beastMight(ctx, p, _t, now) {
    p.mightUntil = now + 8000;
    ctx.pushFx({ t: 'skill', s: 'beastMight', from: p.id, x: p.x, y: p.y });
    return null;
  },

  // Морвен: удар мрака — урон и страх (ослабление)
  gloomStrike(ctx, p, t, now) {
    if (!t) return 'Нет цели рядом';
    ctx.pushFx({ t: 'skill', s: 'gloomStrike', from: p.id, x: t.x, y: t.y });
    for (const m of inRadius(ctx, t.x, t.y, 70)) m.weakUntil = Math.max(m.weakUntil || 0, now + 5000);
    ctx.damageMonster(p, t, p.dmg * 1.8);
    return null;
  },

  // Морвен: тёмная вспышка — тратит весь мрак
  darkBurst(ctx, p) {
    const dark = p.res || 0;
    if (dark < 10) return 'Слишком мало мрака';
    p.res = 0;
    const mult = 1 + 0.04 * dark;
    ctx.pushFx({ t: 'skill', s: 'darkBurst', from: p.id, x: p.x, y: p.y, r: 130, power: mult });
    for (const m of inRadius(ctx, p.x, p.y, 130)) ctx.damageMonster(p, m, p.dmg * mult);
    return null;
  },

  // Морвен: печать тьмы
  darkSeal(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    t.darkSealBy = p.id; t.darkSealUntil = now + 12000;
    ctx.pushFx({ t: 'skill', s: 'darkSeal', from: p.id, x: t.x, y: t.y });
    return null;
  },

  // Эмет: каменный кулак
  stoneFist(ctx, p, t, now) {
    if (!t) return 'Нет цели рядом';
    t.stunUntil = Math.max(t.stunUntil || 0, now + 1500);
    ctx.pushFx({ t: 'skill', s: 'stoneFist', from: p.id, x: t.x, y: t.y });
    ctx.damageMonster(p, t, p.dmg * 2.2);
    return null;
  },

  // Эмет: землетрясение
  golemQuake(ctx, p, _t, now) {
    const r = 120;
    ctx.pushFx({ t: 'skill', s: 'golemQuake', from: p.id, x: p.x, y: p.y, r });
    for (const m of inRadius(ctx, p.x, p.y, r)) {
      m.stunUntil = Math.max(m.stunUntil || 0, now + 1200);
      ctx.damageMonster(p, m, p.dmg * 1.4);
    }
    return null;
  },

  // Эмет: каменная броня — защита ценой скорости
  stoneArmor(ctx, p, _t, now) {
    p.stoneArmorUntil = now + 8000;
    ctx.pushFx({ t: 'skill', s: 'stoneArmor', from: p.id, x: p.x, y: p.y });
    return null;
  },

  // ---------- Селена ----------
  moonBeam(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    const ph = p.form || 'waxing', pw = p.castPower || 1;
    ctx.pushFx({ t: 'skill', s: 'moonBeam', from: p.id, fx: p.x, fy: p.y, x: t.x, y: t.y, ph });
    if (ph === 'waxing') ctx.damageMonster(p, t, p.dmg * 2.2 * pw);
    else {
      if (ph === 'waning') t.slowUntil = Math.max(t.slowUntil || 0, now + 4000);
      if (ph === 'newmoon') { t.fearUntil = now + 2500; t.fearX = p.x; t.fearY = p.y; t.target = null; }
      if (ph === 'full') for (const o of ctx.players.values()) if (!o.dead && dist(o, p) <= 180) ctx.healPlayer(o, o.maxHp * 0.12 * pw);
      ctx.damageMonster(p, t, p.dmg * 1.4 * pw);
    }
    return null;
  },
  phaseShift(ctx, p, _t, now) {
    const ORDER = ['waxing', 'full', 'waning', 'newmoon'];
    p.form = ORDER[(ORDER.indexOf(p.form) + 1) % ORDER.length];
    ctx.pushFx({ t: 'skill', s: 'phaseShift', from: p.id, x: p.x, y: p.y, ph: p.form });
    return null;
  },
  moonVeil(ctx, p, _t, now) {
    const ph = p.form || 'waxing', ids = [];
    for (const o of ctx.players.values()) {
      if (o.dead || dist(o, p) > 200) continue;
      ids.push(o.id);
      if (ph === 'waxing') o.cryUntil = Math.max(o.cryUntil || 0, now + 6000);
      if (ph === 'full') { o.regenUntil = now + 6000; o.regenRate = 0.03; }
      if (ph === 'waning') ctx.giveShield(o, o.maxHp * 0.2, now + 8000);
      if (ph === 'newmoon') { o.stealthUntil = now + 4000; for (const m of ctx.monsters.values()) if (m.target === o.id) m.target = null; }
    }
    ctx.pushFx({ t: 'skill', s: 'moonVeil', from: p.id, x: p.x, y: p.y, ph, ids });
    return null;
  },

  // ---------- Сирокко ----------
  sandVortex(ctx, p, t, now) {
    if (!t) return 'Нет цели';
    const pw = p.castPower || 1, x = t.x, y = t.y;
    ctx.pushFx({ t: 'skill', s: 'sandVortex', from: p.id, x, y, r: 80 });
    for (const m of inRadius(ctx, x, y, 80)) { m.weakUntil = Math.max(m.weakUntil || 0, now + 4000); m.blindUntil = now + 4000; ctx.damageMonster(p, m, p.dmg * 1.4 * pw); }
    // Песчаная зона: ослепляет монстров внутри каждую секунду
    p.sandZones = (p.sandZones || []).filter((z) => z.until > now);
    if (p.sandZones.length >= 4) { p.sandZones[0].until = now; p.sandZones.shift(); }
    const zone = ctx.addGround({ kind: 'sand', owner: p.id, x, y, r: 90, until: now + 12000,
      tick(tn) { for (const m of inRadius(ctx, x, y, 90)) { m.weakUntil = Math.max(m.weakUntil || 0, tn + 1200); m.blindUntil = tn + 1200; } } });
    p.sandZones.push(zone);
    return null;
  },
  duneWave(ctx, p, t) {
    const pw = p.castPower || 1, len = 190, width = 50;
    let dx = t ? t.x - p.x : p.dir, dy = t ? t.y - p.y : 0;
    const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    ctx.pushFx({ t: 'skill', s: 'duneWave', from: p.id, x: p.x, y: p.y, dx, dy, len });
    for (const m of ctx.monsters.values()) {
      const rx = m.x - p.x, ry = m.y - p.y, along = rx * dx + ry * dy, across = Math.abs(rx * dy - ry * dx);
      if (along < -10 || along > len || across > width) continue;
      ctx.damageMonster(p, m, p.dmg * 1.6 * pw);
      ctx.knockback(m, dx, dy, 70);
    }
    return null;
  },
  desertBreath(ctx, p, _t, now) {
    const pw = p.castPower || 1;
    const zones = (p.sandZones || []).filter((z) => z.until > now);
    if (!zones.length) return 'Нет песчаных зон';
    const hit = new Set();
    for (const z of zones) for (const m of inRadius(ctx, z.x, z.y, z.r)) hit.add(m);
    for (const m of hit) {
      m.slowUntil = Math.max(m.slowUntil || 0, now + 5000);
      m.dots = (m.dots || []).concat({ until: now + 5000, dps: p.dmg * 0.5 * pw, by: p.id });
    }
    ctx.pushFx({ t: 'skill', s: 'desertBreath', from: p.id, x: p.x, y: p.y, zones: zones.map((z) => [Math.round(z.x), Math.round(z.y)]) });
    return null;
  },

  // ---------- Блейз ----------
  blazeBall(ctx, p, t) {
    if (!t) return 'Нет цели';
    const pw = p.castPower || 1, flight = Math.min(400, dist(p, t) * 1.3);
    p.heatGain = 15;
    ctx.pushFx({ t: 'skill', s: 'blazeBall', from: p.id, fx: p.x, fy: p.y, x: t.x, y: t.y, flight });
    setTimeout(() => {
      if (!alive(ctx, p, t)) return;
      const tn = Date.now();
      t.burnUntil = tn + 4000;
      t.dots = (t.dots || []).concat({ until: tn + 4000, dps: p.dmg * 0.4 * pw, by: p.id });
      ctx.damageMonster(p, t, p.dmg * 1.8 * pw);
    }, flight);
    return null;
  },
  flameWave(ctx, p, t) {
    const pw = p.castPower || 1;
    let dx = t ? t.x - p.x : p.dir, dy = t ? t.y - p.y : 0;
    const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    p.heatGain = 20;
    ctx.pushFx({ t: 'skill', s: 'flameWave', from: p.id, x: p.x, y: p.y, dx, dy });
    for (const m of ctx.monsters.values()) {
      const rx = m.x - p.x, ry = m.y - p.y, dd = Math.hypot(rx, ry);
      if (dd > 160 || (rx * dx + ry * dy) / (dd || 1) < 0.5) continue;
      ctx.damageMonster(p, m, p.dmg * 1.5 * pw);
      ctx.knockback(m, rx / (dd || 1), ry / (dd || 1), 60);
    }
    return null;
  },
  flashover(ctx, p) {
    const heat = p.heat || 0, mult = 1 + 0.04 * heat;
    p.heat = 0; p.heatGain = 0;
    ctx.pushFx({ t: 'skill', s: 'flashover', from: p.id, x: p.x, y: p.y, r: 120, power: mult });
    for (const m of inRadius(ctx, p.x, p.y, 120)) ctx.damageMonster(p, m, p.dmg * mult);
    return null;
  },

  // ---------- Гардин ----------
  carveRune(ctx, p, _t, now) {
    const ORDER = ['fire', 'ward', 'heal'];
    const type = p.rune || 'fire';
    p.rune = ORDER[(ORDER.indexOf(type) + 1) % ORDER.length];
    p.lastRune = type;
    p.runes = (p.runes || []).filter((r) => r.until > now);
    if (p.runes.length >= 4) { p.runes[0].until = now; p.runes.shift(); }
    const x = p.x, y = p.y + 6;
    const rune = ctx.addGround({ kind: 'rune', sub: type, owner: p.id, x, y, r: 45, until: now + 40000, period: 300,
      tick(tn) {
        if (!ctx.players.has(p.id)) return;
        if (inRadius(ctx, x, y, 45).length) { explodeRune(ctx, p, rune, 1); }
      } });
    p.runes.push(rune);
    ctx.pushFx({ t: 'skill', s: 'carveRune', from: p.id, x, y, type });
    return null;
  },
  activateRunes(ctx, p, _t, now) {
    const runes = (p.runes || []).filter((r) => r.until > now);
    if (!runes.length) return 'Нет установленных рун';
    for (const r of runes) explodeRune(ctx, p, r, 1.5);
    p.runeBuffUntil = now + 6000;
    ctx.giveShield(p, p.maxHp * 0.2, now + 8000);
    ctx.pushFx({ t: 'skill', s: 'activateRunes', from: p.id, x: p.x, y: p.y });
    return null;
  },
  weaponRune(ctx, p, _t, now) {
    p.weaponRuneUntil = now + 10000;
    p.weaponRuneType = p.lastRune || 'fire';
    ctx.pushFx({ t: 'skill', s: 'weaponRune', from: p.id, x: p.x, y: p.y, type: p.weaponRuneType });
    return null;
  },

  // ---------- Элнаэрис ----------
  gatherSouls(ctx, p, _t, now) {
    let n = 0, c;
    const pts = [];
    while ((c = ctx.takeCorpse(p.x, p.y, 260, now))) { n++; pts.push([Math.round(c.x), Math.round(c.y)]); }
    if (!n) return 'Рядом нет павших монстров';
    p.souls = Math.min(20, (p.souls || 0) + n);
    ctx.pushFx({ t: 'skill', s: 'gatherSouls', from: p.id, x: p.x, y: p.y, pts });
    return null;
  },
  soulWave(ctx, p, t, now) {
    if ((p.souls || 0) < 3) return 'Нужно хотя бы 3 души';
    const spend = Math.min(10, p.souls);
    p.souls -= spend;
    const len = 200, width = 55, mult = 1 + 0.25 * spend;
    let dx = t ? t.x - p.x : p.dir, dy = t ? t.y - p.y : 0;
    const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    ctx.pushFx({ t: 'skill', s: 'soulWave', from: p.id, x: p.x, y: p.y, dx, dy, len, spend });
    for (const m of ctx.monsters.values()) {
      const rx = m.x - p.x, ry = m.y - p.y, along = rx * dx + ry * dy, across = Math.abs(rx * dy - ry * dx);
      if (along < -10 || along > len || across > width) continue;
      m.fearUntil = now + 2000; m.fearX = p.x; m.fearY = p.y; m.target = null;
      ctx.damageMonster(p, m, p.dmg * mult);
    }
    return null;
  },
  guideCall(ctx, p, _t, now) {
    if ((p.souls || 0) < 5) return 'Нужно 5 душ';
    p.souls -= 5;
    const wisps = p.pets.filter((pet) => pet.kind === 'wisp');
    if (wisps.length >= 2) ctx.removePet(wisps[0]);
    const pet = createSummon(p, 'wisp', p.x + p.dir * 24, p.y, 25000, now);
    pet.dmgAbs = p.dmg * (0.6 + 0.05 * p.souls);
    ctx.addPet(p, pet);
    ctx.pushFx({ t: 'skill', s: 'guideCall', from: p.id, x: pet.x, y: pet.y });
    return null;
  },
};

// Подрыв руны Гардина (при контакте или активации)
function explodeRune(ctx, p, rune, power) {
  if (rune.until <= Date.now()) return;
  rune.until = Date.now();
  const r = 90, pw = power * (p.castPower || 1);
  ctx.pushFx({ t: 'skill', s: 'runeBurst', from: p.id, x: rune.x, y: rune.y, r, type: rune.sub, quiet: true });
  if (rune.sub === 'fire') for (const m of inRadius(ctx, rune.x, rune.y, r)) ctx.damageMonster(p, m, p.dmg * 2 * pw);
  if (rune.sub === 'ward') {
    for (const m of inRadius(ctx, rune.x, rune.y, r)) m.stunUntil = Math.max(m.stunUntil || 0, Date.now() + 1500 * pw);
    for (const o of ctx.players.values()) if (!o.dead && Math.hypot(o.x - rune.x, o.y - rune.y) <= r) ctx.giveShield(o, o.maxHp * 0.15 * pw, Date.now() + 8000);
  }
  if (rune.sub === 'heal') for (const o of ctx.players.values()) if (!o.dead && Math.hypot(o.x - rune.x, o.y - rune.y) <= r + 20) ctx.healPlayer(o, o.maxHp * 0.15 * pw);
  p.runes = (p.runes || []).filter((x) => x !== rune);
  p.dirty = true;
}

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

  // Аурелиус: власть над стихиями — бафф за смену стихии, сила за частую смену и за простой стихии
  elementalMastery: {
    onShift(p, now, ctx) {
      p.swapStacks = now - (p.lastSwap || 0) < 8000 ? Math.min(5, (p.swapStacks || 0) + 1) : 0;
      p.lastSwap = now;
      p.elemBuffUntil = now + 5000;
      if (p.form === 'earth') ctx.giveShield(p, p.maxHp * 0.15, now + 5000);
      p.dirty = true;
    },
    buff: (p, el) => p.elemBuffUntil > Date.now() && p.form === el,
    dmgMult(p) { return (this.buff(p, 'fire') ? 1.25 : 1) * (1 + 0.06 * (p.swapStacks || 0)); },
    speedMult(p) { return (this.buff(p, 'lightning') ? 1.3 : 1) * (1 + 0.05 * (p.swapStacks || 0)); },
    dmgTakenMult(p) { return this.buff(p, 'ice') ? 0.75 : 1; },
    // Перед навыком: сила за простой текущей стихии (смена стихии не считается)
    beforeCast(p, sk) {
      if (sk && sk.id === 'elementSwap') return { free: false, power: 1 };
      p.elemUsed = p.elemUsed || {};
      const idle = (Date.now() - (p.elemUsed[p.form] || p.joinedAt || Date.now())) / 1000;
      return { free: false, power: 1 + Math.min(0.5, 0.02 * idle) };
    },
    afterCast(ctx, p, _boosted, sk) { if (sk && sk.id !== 'elementSwap') { p.elemUsed = p.elemUsed || {}; p.elemUsed[p.form] = Date.now(); } },
    onTick(p, now) { if (p.swapStacks && now - p.lastSwap > 8000) { p.swapStacks = 0; p.dirty = true; } },
    note(p) {
      const names = { fire: 'Огонь', ice: 'Лёд', lightning: 'Молния', earth: 'Земля' };
      const idle = Math.min(50, Math.round(2 * (Date.now() - ((p.elemUsed || {})[p.form] || p.joinedAt || Date.now())) / 1000));
      return `стихия: ${names[p.form]} · чередование ${p.swapStacks || 0}/5 · застой +${idle}%`;
    },
  },

  // Валериан: кара нечестивых — урон по монстрам и нежити, рвение за убийства, верность обету
  smiteUnholy: {
    targetMult: (p, m) => 1.2 * (m.undead ? 1.25 : 1),
    loyalty: (p) => Math.min(5, Math.floor((Date.now() - (p.vowSince || p.joinedAt || Date.now())) / 5000)),
    beforeCast(p, sk) { return { free: false, power: sk && sk.id === 'holyVow' ? 1 : 1 + 0.08 * this.loyalty(p) }; },
    // Следующая обычная атака усилена рвением (заряды тратятся)
    basicMult(p) { const z = p.zeal || 0; if (!z) return 1; p.zeal = 0; p.dirty = true; return 1 + 0.15 * z; },
    onKill(ctx, p) { p.zeal = Math.min(5, (p.zeal || 0) + 1); p.dirty = true; },
    onTick(p) { const l = this.loyalty(p); if (l !== p.lastLoyalty) { p.lastLoyalty = l; p.dirty = true; } },
    note(p) {
      const names = { protection: 'Защита', retribution: 'Кара', mercy: 'Милосердие' };
      return `обет: ${names[p.form]} · верность ${this.loyalty(p)}/5 · рвение ${p.zeal || 0}/5`;
    },
  },

  // Юстина: сила веры — свет копится от заклинаний; на 100 следующее сильнее, лечение вдвое
  faithPower: {
    beforeCast(p) { const full = (p.light || 0) >= 100; p.healBoost = full ? 2 : 1; return { free: false, power: full ? 1.6 : 1 }; },
    afterCast(ctx, p, _b) {
      if ((p.light || 0) >= 100) { p.light = 0; ctx.pushFx({ t: 'skill', s: 'faithRelease', from: p.id, x: p.x, y: p.y, quiet: true }); }
      else p.light = Math.min(100, (p.light || 0) + 25);
      p.healBoost = 1;
      p.dirty = true;
    },
    note: (p) => ((p.light || 0) >= 100 ? 'свет 100 — следующее заклинание усилено!' : `свет ${p.light || 0}/100`),
  },

  // Джакомо: вдохновение — песня действует вокруг, бард копит вдохновение
  inspiration: {
    onTick(p, now, ctx) {
      const dt = Math.min(0.5, (now - (p.songTick || now)) / 1000);
      p.songTick = now;
      if (p.dead) return;
      const r = 180, pw = p.songPowerUntil > now ? p.songPower : 1;
      let affected = 0;
      if (p.form === 'inspire') {
        for (const o of ctx.players.values()) {
          if (o.dead || Math.hypot(o.x - p.x, o.y - p.y) > r) continue;
          o.songUntil = now + 600; o.songPw = pw; affected++;
        }
      } else {
        for (const m of ctx.monsters.values()) {
          if (Math.hypot(m.x - p.x, m.y - p.y) > r) continue;
          if (p.form === 'lullaby') m.slowUntil = Math.max(m.slowUntil || 0, now + 600);
          else { m.mockUntil = now + 600; m.mockPw = pw; }
          affected++;
        }
      }
      const before = p.inspiration || 0;
      p.inspiration = Math.min(100, before + (4 + 2 * Math.min(5, affected)) * dt);
      if (Math.floor(before / 5) !== Math.floor(p.inspiration / 5)) p.dirty = true;
    },
    note(p) {
      const names = { inspire: 'Вдохновение', lullaby: 'Колыбельная', mock: 'Насмешка' };
      return `песнь: ${names[p.form]}${p.songPowerUntil > Date.now() ? ' ×' + p.songPower.toFixed(1) : ''} · вдохновение ${Math.round(p.inspiration || 0)}%`;
    },
  },

  // Орион: власть над смертью — убитые с шансом восстают, слуги усиливают некроманта
  deathMastery: {
    dmgMult: (p) => 1 + 0.06 * Math.min(5, (p.pets || []).length),
    onKill(ctx, p, now, m) {
      if (!m || Math.random() >= 0.3) return;
      const corpse = ctx.takeCorpse(m.x, m.y, 5, now) || { x: m.x, y: m.y, type: m.type };
      ctx.raiseMinion(p, corpse, now, true);
    },
    note: (p) => `армия ${(p.pets || []).length}/5`,
  },

  // Фаэлин: соколиный глаз — точность копится на месте
  hawkEye: {
    targetMult: (p, m) => (1 + 0.4 * (p.accuracy || 0) / 100) * (m.starBy === p.id && m.starUntil > Date.now() ? 1.3 : 1),
    forceCrit: (p, m) => (p.accuracy || 0) >= 50 && m.starBy === p.id && m.starUntil > Date.now(),
    onTick(p, now) {
      const dt = Math.min(0.5, (now - (p.accTick || now)) / 1000);
      p.accTick = now;
      const before = p.accuracy || 0;
      const still = now - (p.movedAt || 0) > 600;
      p.accuracy = Math.max(0, Math.min(100, before + (still ? 15 : -30) * dt));
      if (Math.floor(before / 5) !== Math.floor(p.accuracy / 5)) p.dirty = true;
    },
    note: (p) => `точность ${Math.round(p.accuracy || 0)}%`,
  },

  // Илирия: арканный резонанс — мана за заклинания, на максимуме бесплатное усиленное
  arcaneResonance: {
    MAX: 4,
    beforeCast(p) { const ready = (p.resonance || 0) >= this.MAX; return { free: ready, power: ready ? 1.6 : 1 }; },
    afterCast(ctx, p, boosted) {
      p.res = Math.min(p.resMax, p.res + 10);
      p.resonance = boosted ? 0 : Math.min(this.MAX, (p.resonance || 0) + 1);
      if (p.resonance === this.MAX) ctx.pushFx({ t: 'skill', s: 'resonanceReady', from: p.id, x: p.x, y: p.y, quiet: true });
      p.dirty = true;
    },
    note(p) { return (p.resonance || 0) >= this.MAX ? 'резонанс: следующее заклинание усилено!' : `резонанс ${p.resonance || 0}/${this.MAX}`; },
  },

  // Тибор: ведьмачье чутьё — слабости монстров, токсичность как риск и награда
  witcherSense: {
    targetMult: (p, m) => (m.undead || m.boss ? 1.4 : 1.15),
    dmgMult: (p) => (p.potions && p.potions.thunder > Date.now() ? 1.3 : 1) * (1 + 0.4 * Math.max(0, (p.tox || 0) - 40) / 60),
    dmgTakenMult: (p) => (p.potions && p.potions.oriole > Date.now() ? 0.7 : 1),
    onTick(p, now) {
      const dt = Math.min(0.5, (now - (p.toxTick || now)) / 1000);
      p.toxTick = now;
      if (!p.tox) return;
      const before = p.tox;
      if (p.tox >= 70 && p.hp > 1) p.hp = Math.max(1, p.hp - p.maxHp * 0.015 * dt);
      p.tox = Math.max(0, p.tox - 4 * dt);
      p.dirty = true;
      if (Math.floor(before / 5) !== Math.floor(p.tox / 5)) p.dirty = true;
    },
    note(p) {
      const n = { thunder: 'Гром', blizzard: 'Пурга', swallow: 'Ласточка', oriole: 'Иволга' };
      const now = Date.now();
      const active = Object.entries(p.potions || {}).filter(([, u]) => u > now).map(([k]) => n[k]);
      const tox = Math.round(p.tox || 0);
      return `токсичность ${tox}%${tox >= 70 ? ' ☠' : ''}${active.length ? ' · ' + active.join(', ') : ''}`;
    },
  },

  // Ингрид: технарь — урон и защита за каждую турель
  tinker: {
    count: (p) => (p.pets || []).filter((pet) => pet.kind === 'turret' && !pet.down).length,
    dmgMult(p) { return 1 + 0.08 * this.count(p); },
    dmgTakenMult(p) { return 1 - 0.06 * this.count(p); },
    note(p) { return `турели ${(p.pets || []).filter((pet) => pet.kind === 'turret').length}/3`; },
  },

  // Талмира: избранница павших — благословения за убийства, ярость при гибели союзника
  chosenOfFallen: {
    dmgMult: (p) => (1 + 0.03 * (p.blessings || 0)) * (p.flyUntil > Date.now() ? 1.4 : 1) * (p.avengeUntil > Date.now() ? 1.4 : 1),
    onKill(ctx, p, now) { p.blessings = Math.min(10, (p.blessings || 0) + 1); p.lastBless = now; p.dirty = true; },
    onAllyDeath(ctx, p, now) { p.avengeUntil = now + 8000; ctx.pushFx({ t: 'skill', s: 'avenge', from: p.id, x: p.x, y: p.y, quiet: true }); p.dirty = true; },
    onTick(p, now) { if (p.blessings && now - p.lastBless > 12000) { p.blessings = 0; p.dirty = true; } },
    note: (p) => `благословения ${p.blessings || 0}/10${p.flyUntil > Date.now() ? ' · в полёте' : ''}${p.avengeUntil > Date.now() ? ' · месть' : ''}`,
  },

  // Сангвейн: жажда крови — урон растёт при низком здоровье, убийства лечат
  bloodHunger: {
    dmgMult: (p) => 1 + 0.8 * (1 - p.hp / p.maxHp),
    onKill(ctx, p) { ctx.healPlayer(p, p.maxHp * 0.06); },
  },

  // Зефира: драконье наследие — чешуя и аспекты сильнее при низком здоровье
  dragonLegacy: {
    dmgMult: (p) => (p.mightUntil > Date.now() ? 1.35 : 1),
    dmgTakenMult: (p) => (1 - 0.4 * (1 - p.hp / p.maxHp)) * (p.mightUntil > Date.now() ? 0.75 : 1),
    beforeCast: (p, sk) => ({ free: false, power: sk && sk.id !== 'beastMight' ? 1 + 0.5 * (1 - p.hp / p.maxHp) : 1 }),
    note(p) {
      const n = { fire: 'Пламя', ice: 'Лёд', poison: 'Яд', lightning: 'Молния' };
      const sc = Math.round(40 * (1 - p.hp / p.maxHp));
      return `аспект: ${n[p.form || 'fire']}${sc > 0 ? ` · чешуя −${sc}%` : ''}${p.mightUntil > Date.now() ? ' · звериная мощь' : ''}`;
    },
  },

  // Морвен: тьма внутри — мрак усиливает урон и защиту; печать тьмы лечит при убийстве
  innerDark: {
    dmgMult: (p) => 1 + 0.3 * (p.res || 0) / 100,
    dmgTakenMult: (p) => 1 - 0.25 * (p.res || 0) / 100,
    targetMult: (p, m) => (m.darkSealBy === p.id && m.darkSealUntil > Date.now() ? 1.35 : 1),
    onKill(ctx, p, now, m) {
      if (m && m.darkSealBy === p.id && m.darkSealUntil > now) { ctx.healPlayer(p, p.maxHp * 0.15); ctx.pushFx({ t: 'skill', s: 'sealHeal', from: p.id, x: p.x, y: p.y, quiet: true }); }
    },
    note: (p) => `мрак ${Math.round(p.res || 0)}%`,
  },

  // Эмет: трещины — урон растёт, защита падает; на 20 — двойной удар
  cracks: {
    dmgMult: (p) => 1 + 0.03 * (p.cracks || 0),
    dmgTakenMult: (p) => (1 + 0.02 * (p.cracks || 0)) * (p.stoneArmorUntil > Date.now() ? 0.5 : 1),
    onHurt(ctx, p) {
      p.cracks = Math.min(20, (p.cracks || 0) + 1);
      p.lastCrack = Date.now();
      if (p.cracks >= 20 && !p.crackReady) { p.crackReady = true; ctx.pushFx({ t: 'skill', s: 'cracksFull', from: p.id, x: p.x, y: p.y, quiet: true }); }
      p.dirty = true;
    },
    basicMult(p) { if (!p.crackReady) return 1; p.crackReady = false; p.cracks = 0; p.dirty = true; return 2; },
    onTick(p, now) { if (p.cracks && !p.crackReady && now - (p.lastCrack || 0) > 6000) { p.cracks = Math.max(0, p.cracks - 1); p.lastCrack = now - 5000; p.dirty = true; } },
    note: (p) => `трещины ${p.cracks || 0}/20${p.crackReady ? ' · следующий удар двойной!' : ''}${p.stoneArmorUntil > Date.now() ? ' · каменная броня' : ''}`,
  },

  // Селена: благословение луны — бонус фазы; в тени сильнее
  moonBlessing: {
    dmgMult: (p) => (p.form === 'waxing' ? 1.2 : 1) * (p.stealthUntil > Date.now() ? 1.3 : 1),
    dmgTakenMult: (p) => (p.form === 'waning' ? 0.8 : 1),
    speedMult: (p) => (p.form === 'newmoon' ? 1.2 : 1),
    onTick(p, now) { if (p.form === 'full' && p.hp < p.maxHp) { p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.001); } },
    note(p) { return `фаза: ${{ waxing: 'Растущая 🌒', full: 'Полная 🌕', waning: 'Убывающая 🌘', newmoon: 'Новолуние 🌑' }[p.form || 'waxing']}`; },
  },

  // Сирокко: сила барханов — сильнее в своей зоне; зоны усиливают следующее заклинание
  duneStrength: {
    inZone(p) { const now = Date.now(); return (p.sandZones || []).some((z) => z.until > now && Math.hypot(p.x - z.x, p.y - z.y) <= z.r); },
    zones(p) { const now = Date.now(); return (p.sandZones || []).filter((z) => z.until > now).length; },
    dmgMult(p) { return this.inZone(p) ? 1.3 : 1; },
    speedMult(p) { return this.inZone(p) ? 1.2 : 1; },
    beforeCast(p) { return { free: false, power: 1 + 0.15 * this.zones(p) }; },
    onTick(p) { const z = this.zones(p) * 10 + (this.inZone(p) ? 1 : 0); if (z !== p.lastZoneState) { p.lastZoneState = z; p.dirty = true; } },
    note(p) { return `песчаных зон ${this.zones(p)}/4${this.inZone(p) ? ' · в песке' : ''}`; },
  },

  // Блейз: жар — растёт от заклинаний, усиливает огонь и сжигает самого пироманта
  heat: {
    dmgMult: (p) => 1 + 0.5 * (p.heat || 0) / 100,
    basicMult(p) { if (!p.heatReady) return 1; p.heatReady = false; p.dirty = true; return 2; },
    afterCast(ctx, p) {
      if (!p.heatGain) return;
      p.heat = Math.min(100, (p.heat || 0) + p.heatGain);
      p.heatGain = 0;
      if (p.heat >= 100) {
        // Вспыхивает: урон вокруг, жар сбрасывается до 50, следующая атака двойная
        ctx.pushFx({ t: 'skill', s: 'selfIgnite', from: p.id, x: p.x, y: p.y, r: 100 });
        for (const m of inRadius(ctx, p.x, p.y, 100)) ctx.damageMonster(p, m, p.dmg * 1.5);
        p.heat = 50;
        p.heatReady = true;
      }
      p.dirty = true;
    },
    onTick(p, now) {
      const dt = Math.min(0.5, (now - (p.heatTick || now)) / 1000);
      p.heatTick = now;
      if (!p.heat) return;
      p.hp = Math.max(1, p.hp - p.maxHp * 0.015 * (p.heat / 100) * dt);
      p.heat = Math.max(0, p.heat - 3 * dt);
      p.dirty = true;
    },
    note: (p) => `жар ${Math.round(p.heat || 0)}%${p.heatReady ? ' · следующая атака двойная!' : ''}`,
  },

  // Гардин: слово творения — защита за руны, усиление при активации, руна на оружии
  wordOfCreation: {
    dmgMult: (p) => (p.runeBuffUntil > Date.now() ? 1.25 : 1) * (p.weaponRuneUntil > Date.now() ? 1.5 : 1),
    dmgTakenMult: (p) => (1 - 0.05 * Math.min(4, (p.runes || []).filter((r) => r.until > Date.now()).length))
      * (p.weaponRuneUntil > Date.now() && p.weaponRuneType === 'ward' ? 0.8 : 1),
    onDealt(ctx, p, dmg, now) {
      if (p.weaponRuneUntil > now && p.weaponRuneType === 'heal' && p.hp < p.maxHp) { p.hp = Math.min(p.maxHp, p.hp + dmg * 0.25); p.dirty = true; }
    },
    onTick(p, now) { const n = (p.runes || []).filter((r) => r.until > now).length; if (n !== p.lastRuneCount) { p.lastRuneCount = n; p.dirty = true; } },
    note(p) {
      const n = { fire: 'огня', ward: 'защиты', heal: 'лечения' };
      return `рун ${(p.runes || []).filter((r) => r.until > Date.now()).length}/4${p.weaponRuneUntil > Date.now() ? ' · оружие: руна ' + n[p.weaponRuneType] : ''}`;
    },
  },

  // Элнаэрис: грань жизни — души за убийства усиливают урон и защиту
  edgeOfLife: {
    dmgMult: (p) => 1 + 0.03 * (p.souls || 0),
    dmgTakenMult: (p) => 1 - 0.015 * (p.souls || 0),
    onKill(ctx, p) { p.souls = Math.min(20, (p.souls || 0) + 1); p.dirty = true; },
    note: (p) => `души ${p.souls || 0}/20`,
  },
};

// Умения, которым нужна цель в пределах дальности (для остальных цель не обязательна)
const NEEDS_TARGET = new Set(['moonBeam', 'sandVortex', 'blazeBall', 'dragonBreath', 'dragonWings', 'gloomStrike', 'darkSeal', 'stoneFist', 'bomb', 'heavenSpear', 'bloodSpike', 'starShot', 'lightHail', 'arcaneVolley', 'iceGrip', 'darkArrow', 'heavenStrike', 'banishDarkness', 'elementBolt', 'elementStorm', 'feralCharge', 'darkFlame', 'naturesThorns', 'exposeStrike', 'poisonBlade', 'shadowStrike', 'execution', 'lifeSteal', 'punishSeal', 'darkBlade', 'markPrey', 'shadowDash', 'sic', 'enlighten', 'stoneThrow', 'twinSlash', 'spiritWrath', 'chainLightning']);
// Дальность умения (по умолчанию — дальность атаки героя, но не меньше 120)
const SKILL_RANGE = { moonBeam: 280, sandVortex: 280, blazeBall: 260, flameWave: 170, duneWave: 200, soulWave: 210, dragonBreath: 170, dragonWings: 280, gloomStrike: 80, darkSeal: 260, stoneFist: 80, bomb: 280, heavenSpear: 300, bloodSpike: 260, witcherSign: 150, starShot: 360, lightHail: 360, arcaneVolley: 300, iceGrip: 300, darkArrow: 300, heavenStrike: 80, banishDarkness: 300, elementBolt: 300, elementStorm: 300, feralCharge: 230, exposeStrike: 75, poisonBlade: 75, shadowStrike: 85, execution: 80, lifeSteal: 200, punishSeal: 300, darkBlade: 260, markPrey: 320, shadowDash: 260, sic: 320, enlighten: 80, qiWave: 170, stoneThrow: 320, twinSlash: 80, blindRage: 200 };
const skillRange = (id, hero) => SKILL_RANGE[id] ?? Math.max(hero.range, 120) + 20;

module.exports = { SKILLS, PASSIVES, NEEDS_TARGET, skillRange };
