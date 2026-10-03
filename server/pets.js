// Звери-спутники (Урсус, Повелитель зверей). Звери живут на сервере как отдельные сущности:
// следуют за хозяином, сами атакуют ближайших врагов, убегают вместе с хозяином,
// а «упав» — не погибают, а отступают к хозяину и возвращаются через несколько секунд.

// Характеристики зверей — доли от характеристик хозяина
const PET_KINDS = {
  wolf: { name: 'Клык', hp: 0.5, dmg: 0.45, cooldown: 900, speed: 190, reach: 30 },
  bear: { name: 'Бурый', hp: 0.85, dmg: 0.6, cooldown: 1300, speed: 150, reach: 34 },
  hawk: { name: 'Сокол', hp: 0.35, dmg: 0.3, cooldown: 700, speed: 230, reach: 26 },
  // Скелет-слуга Кельт'о: временный, при «падении» рассыпается
  skeleton: { name: 'Слуга', hp: 0.45, dmg: 0.55, cooldown: 1000, speed: 155, reach: 30 },
  // Дух природы Нимуэ: временный, крепкий, отвлекает монстров на себя
  sprite: { name: 'Дух леса', hp: 0.7, dmg: 0.4, cooldown: 900, speed: 170, reach: 30 },
  // Двойник Ле Блан: иллюзия, почти не наносит урона, принимает удары на себя
  // Турель Ингрид: стреляет издалека, следует за хозяйкой, «ломается» и чинится вместо гибели
  turret: { name: 'Турель', hp: 0.5, dmg: 0.45, cooldown: 800, speed: 150, reach: 190, ranged: true },
  clone: { name: 'Двойник', hp: 0.6, dmg: 0.2, cooldown: 1200, speed: 160, reach: 30 },
  // Поднятый монстр Ориона: здоровье и урон задаются от самого монстра (maxHp, dmgAbs)
  minion: { name: 'Слуга', hp: 0.5, dmg: 0.5, cooldown: 1100, speed: 140, reach: 32 },
};
const PET_ORDER = ['wolf', 'bear', 'hawk'];
const LEASH = 230; // дальше этого от хозяина звери бросают бой и бегут к нему
const AGGRO = 170; // радиус вокруг хозяина, в котором звери сами ищут врагов
const DOWN_MS = 6000; // столько «упавший» зверь восстанавливается

let petSeq = 1;

function createPets(owner) {
  return PET_ORDER.map((kind, i) => {
    const k = PET_KINDS[kind];
    const maxHp = Math.round(owner.maxHp * k.hp);
    return {
      id: 'pet' + petSeq++, kind, slot: i, owner,
      x: owner.x + (i - 1) * 24, y: owner.y + 20,
      hp: maxHp, maxHp, down: false, downUntil: 0, target: null, lastAttack: 0,
      sicTarget: null, sicUntil: 0, sicFirst: false, boostUntil: 0,
    };
  });
}

// Временный слуга (Восстание мёртвых): появляется в точке павшего врага и живёт lifeMs
function createSummon(owner, kind, x, y, lifeMs, now) {
  const maxHp = Math.round(owner.maxHp * PET_KINDS[kind].hp);
  return {
    id: 'pet' + petSeq++, kind, slot: owner.pets.length, owner, temp: true, expires: now + lifeMs,
    x, y, hp: maxHp, maxHp, down: false, downUntil: 0, target: null, lastAttack: 0,
    sicTarget: null, sicUntil: 0, sicFirst: false, boostUntil: 0,
  };
}

// Пересчитывает здоровье зверей при повышении уровня хозяина
function rescalePets(owner) {
  for (const pet of owner.pets || []) {
    const maxHp = Math.round(owner.maxHp * PET_KINDS[pet.kind].hp);
    pet.hp = pet.down ? 0 : maxHp;
    pet.maxHp = maxHp;
  }
}

function petDmg(pet, now) {
  const base = pet.dmgAbs ?? pet.owner.dmg * PET_KINDS[pet.kind].dmg;
  return base * (pet.boostUntil > now ? 1.5 : 1);
}

// «Падение» зверя: не смерть, а временное отступление
function knockDown(ctx, pet, now) {
  if (pet.temp) { ctx.pushFx({ t: 'petGone', id: pet.id, x: pet.x, y: pet.y }); ctx.removePet(pet); return; }
  pet.hp = 0;
  pet.down = true;
  pet.downUntil = now + DOWN_MS;
  pet.target = null;
  pet.sicTarget = null;
  ctx.pushFx({ t: 'petDown', id: pet.id, x: pet.x, y: pet.y, name: PET_KINDS[pet.kind].name });
}

function hurtPet(ctx, pet, dmg, now) {
  if (pet.down) return;
  pet.hp -= dmg;
  ctx.pushFx({ t: 'hit', kind: 'pet', target: pet.id, dmg });
  if (pet.hp <= 0) knockDown(ctx, pet, now);
}

function stepTo(ctx, pet, x, y, speed, dt) {
  const dx = x - pet.x, dy = y - pet.y, d = Math.hypot(dx, dy);
  if (d < 2) return d;
  const s = Math.min(d, speed * dt);
  ctx.moveEntity(pet, (dx / d) * s, (dy / d) * s);
  return d;
}

function nearestMonster(ctx, x, y, r) {
  let best = null, bd = r;
  for (const m of ctx.monsters.values()) {
    const d = Math.hypot(m.x - x, m.y - y);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

function updatePets(ctx, owner, now, dt) {
  for (const pet of [...owner.pets]) {
    const k = { ...PET_KINDS[pet.kind], ...(pet.speedAbs ? { speed: pet.speedAbs } : {}) };
    if (pet.temp && now >= pet.expires) { ctx.pushFx({ t: 'petGone', id: pet.id, x: pet.x, y: pet.y }); ctx.removePet(pet); continue; }
    // Позиция «у ног» хозяина: звери расходятся веером вокруг него
    const ang = (owner.pets.indexOf(pet) / owner.pets.length) * Math.PI * 2 + 0.6;
    const homeX = owner.x + Math.cos(ang) * 30, homeY = owner.y + Math.sin(ang) * 22;
    const fromOwner = Math.hypot(pet.x - owner.x, pet.y - owner.y);

    // Слишком далеко (хозяин отступил или телепортировался) — догоняем, при отрыве — подтягиваем
    if (fromOwner > 600) { pet.x = homeX; pet.y = homeY; }

    if (pet.down) {
      stepTo(ctx, pet, homeX, homeY, k.speed, dt);
      if (now >= pet.downUntil) {
        pet.down = false;
        pet.hp = pet.maxHp;
        ctx.pushFx({ t: 'petUp', id: pet.id, x: pet.x, y: pet.y, name: k.name });
      }
      continue;
    }
    if (owner.dead) { stepTo(ctx, pet, homeX, homeY, k.speed, dt); pet.target = null; continue; }

    // Выбор цели: приказ «Натравливание» → текущая цель → ближайший враг около хозяина
    let target = null;
    if (pet.sicTarget && now < pet.sicUntil && ctx.monsters.has(pet.sicTarget.id)) target = pet.sicTarget;
    else {
      pet.sicTarget = null;
      if (pet.target && ctx.monsters.has(pet.target.id) && Math.hypot(pet.target.x - owner.x, pet.target.y - owner.y) < LEASH) target = pet.target;
      else target = nearestMonster(ctx, owner.x, owner.y, AGGRO);
    }
    // Хозяин отступает — звери бросают бой и бегут за ним (приказ натравливания держит дольше)
    if (target && fromOwner > (pet.sicTarget ? LEASH * 1.5 : LEASH)) target = null;
    pet.target = target;

    if (!target) { stepTo(ctx, pet, homeX, homeY, k.speed * (fromOwner > 80 ? 1.3 : 1), dt); continue; }

    const sic = pet.sicTarget === target;
    // Стрелковые механизмы (турели) не подходят вплотную — бьют с дистанции
    const far = Math.hypot(target.x - pet.x, target.y - pet.y);
    const d = k.ranged && far <= k.reach ? far : stepTo(ctx, pet, target.x + (pet.slot - 1) * 10, target.y + 6, k.speed * (sic ? 1.6 : 1), dt);
    if (d <= k.reach + 8 && now - pet.lastAttack >= k.cooldown * (pet.boostUntil > now ? 0.6 : 1)) {
      pet.lastAttack = now;
      let raw = petDmg(pet, now);
      if (sic && pet.sicFirst) {
        // Первый укус по натравленной цели — мощный удар с оглушением
        pet.sicFirst = false;
        raw *= 2.5;
        target.stunUntil = Math.max(target.stunUntil || 0, now + 1500);
      }
      ctx.damageMonster(owner, target, raw, { pet: pet.id, proj: k.ranged ? 'bolt' : null, fromX: pet.x, fromY: pet.y });
    }
  }
}

// Звери в радиусе от хозяина (для пассивки)
const petsNear = (owner, r = 200) => (owner.pets || []).filter((pet) => !pet.temp && !pet.down && Math.hypot(pet.x - owner.x, pet.y - owner.y) <= r);

// Постоянный механизм (турель Ингрид): не исчезает со временем
function createDevice(owner, kind) {
  const k = PET_KINDS[kind];
  const maxHp = Math.round(owner.maxHp * k.hp);
  return {
    id: 'pet' + petSeq++, kind, slot: owner.pets.length, owner,
    x: owner.x + 20, y: owner.y + 10, hp: maxHp, maxHp, down: false, downUntil: 0, target: null, lastAttack: 0,
    sicTarget: null, sicUntil: 0, sicFirst: false, boostUntil: 0,
  };
}

module.exports = { createDevice, PET_KINDS, createPets, createSummon, rescalePets, updatePets, hurtPet, knockDown, petDmg, petsNear };
