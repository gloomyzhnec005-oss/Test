// Уникальные умения героев. Каждое умение — функция (ctx, p, target, now) → строка ошибки или null.
// ctx: { monsters, players, pushFx, damageMonster, healPlayer, teleport }
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
};

// Умения, которым нужна цель в пределах дальности (для остальных цель не обязательна)
const NEEDS_TARGET = new Set(['arrowRain', 'meteor', 'shadowStep', 'drain']);
// Дальность умения: shadowStep прыгает дальше обычной атаки
const skillRange = (id, hero) => (id === 'shadowStep' ? 280 : Math.max(hero.range, 120) + 20);

module.exports = { SKILLS, NEEDS_TARGET, skillRange };
