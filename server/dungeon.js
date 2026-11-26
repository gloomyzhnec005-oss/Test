// Монстры в бою: создание по уровню и рангу, умения (рывки, выстрелы, телеграфируемые удары по площади,
// призыв, ауры, лечение, воскрешение, контроль героев), прохождение данжей-лабиринтов, данж выживания и мировые боссы.
const X = require('./mobs');
const { MOBS, AFFIXES, TURN } = X;
const I = require('./items');

module.exports = function createDungeons(d) {
  const BIG_RANK = new Set(['mini', 'boss', 'world']); // ранги, которых не лечат и не прикрывают щитом другие монстры
  const { C, world, monsters, players, pets } = d;
  const fx = (f) => d.pushFx(f);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const inZone = (zid) => [...players.values()].filter((p) => p.zone === zid);
  let seq = 1e6;

  // Полубоссы в залах данжей: втрое больше здоровья, вдвое больше урона и опыта (раньше падали слишком быстро)
  const MINI_K = { hp: 3, dmg: 2, xp: 2 };
  // ---------- Создание монстра ----------
  function create(z, type, pos, level, opts = {}) {
    const def = MOBS[type];
    const rank = opts.rank || def.rank;
    const affixes = opts.affixes || [];
    const st = X.statsAt(def, level, rank, affixes);
    const hp = Math.round(st.hp * (opts.hpMult || 1));
    const m = {
      id: seq++, type, x: pos.x, y: pos.y, homeX: pos.x, homeY: pos.y, zone: z.id, tier: z.tier, level, rank, affixes,
      hp, maxHp: hp, dmg: Math.max(1, Math.round(st.dmg * (opts.dmgMult || 1))), cd: st.cd, speed: st.speed, xp: Math.round(st.xp * (opts.xpMult || 1) * 10) / 10, range: def.range || 0,
      aggro: opts.aggro || (rank === 'boss' || rank === 'world' ? 340 : 250), size: (def.look && def.look.sz || 1) * X.RANK[rank].size,
      target: null, lastAttack: 0, abAt: Date.now() + 1500 + Math.random() * ((def.ab && def.ab.cd) || 4000),
      undead: !!def.undead, boss: rank === 'boss' || rank === 'world', mini: rank === 'mini',
      wander: null, nextWander: 0, stunUntil: 0, rootUntil: 0, dots: [], summons: 0,
      noclip: !!def.noclip, name: opts.name || null, extra: !!opts.extra, lootMult: opts.lootMult ?? 1, owner: opts.owner || null,
      inv: !!def.stealth, contrib: ['world', 'boss', 'mini'].includes(rank) ? {} : null,
    };
    if (rank === 'rare') m.name = `${def.name} · ${affixes.map((a) => AFFIXES[a].name).join(', ')}`;
    monsters.set(m.id, m);
    return m;
  }
  const near = (z, c, R) => {
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * R;
      const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r;
      if (!world.isSolidAt(x, y)) return { x, y };
    }
    return { x: c.x, y: c.y };
  };

  // ---------- Состояния героя от монстров ----------
  function ccPlayer(p, type, ms, now = Date.now()) {
    if (p.dead || (p.ccImmuneUntil || 0) > now || p.rootSelfUntil > now) return;
    p.cc = { type, until: now + ms };
    p.ccImmuneUntil = now + ms + 1500; // защита от бесконечного контроля
    fx({ t: 'pcc', target: p.id, cc: type, ms });
    d.markDirty(p);
  }
  function dotPlayer(p, dps, ms, kind, now = Date.now()) {
    p.pdots = (p.pdots || []).filter((x) => x.until > now);
    if (p.pdots.length >= 4) p.pdots.shift();
    p.pdots.push({ dps, until: now + ms, next: now + 1000, kind });
    d.markDirty(p);
  }
  const ccActive = (p, now = Date.now()) => (p.cc && p.cc.until > now ? p.cc.type : null);
  function tickPlayer(p, now) {
    if (!p.pdots || !p.pdots.length || p.dead) return;
    for (const x of p.pdots) if (now >= x.next && now <= x.until + 50) { x.next += 1000; d.hurtPlayer(p, x.dps, null, now, false, x.kind); }
    p.pdots = p.pdots.filter((x) => x.until > now);
  }

  // ---------- Урон монстров ----------
  function outDmg(m, def, mult, now) {
    let k = mult * (0.85 + Math.random() * 0.3);
    if (m.atkBuffUntil > now) k *= m.atkBuff;
    k *= m.auraMult || 1;
    if (def.enrage && m.hp < m.maxHp * def.enrage.below) k *= def.enrage.mult;
    if (m.allEnraged) k *= 1.5;
    if (m.form === 'beast') k *= 1.3;
    if (m.phase === 'rage') k *= 1.6;
    if (m.weakUntil > now) k *= 0.6; // ослабление от героев
    if (m.mockUntil > now) k *= Math.max(0.4, 1 - 0.25 * (m.mockPw || 1));
    for (const a of m.affixes) if (AFFIXES[a].dmg) k *= 1; // уже учтено в статах
    return m.dmg * k;
  }
  function hit(m, target, mult, now, o = {}) {
    if (!target || target.dead || target.down) return 0;
    const def = MOBS[m.type];
    if (m.blindUntil > now && Math.random() < 0.5) { fx({ t: 'miss', x: m.x, y: m.y }); return 0; }
    let dmg = outDmg(m, def, mult, now);
    if (def.crit && Math.random() < def.crit) { dmg *= 2; o.crit = true; }
    if (def.execute && target.hp < target.maxHp * def.execute.below) { dmg *= def.execute.mult; fx({ t: 'mtext', x: target.x, y: target.y, text: 'Казнь!', color: '#ff3040' }); }
    if (target.owner) { d.hurtPet(target, Math.round(dmg), now); return dmg; }
    m._pierce = Math.max(def.pierce || 0, o.pierce || 0);
    const before = target.hp;
    d.hurtPlayer(target, dmg, m, now);
    m._pierce = 0;
    const dealt = Math.max(0, before - target.hp);
    const ls = (def.lifesteal || 0) + (m.affixes.includes('vampiric') ? 0.2 : 0) + (m.phase === 'dark' ? 0.3 : 0) + (o.drain || 0);
    if (ls && dealt) { m.hp = Math.min(m.maxHp, m.hp + dealt * ls); }
    const oh = o.onHit || def.onHit;
    if (oh && dealt) {
      if (oh.dot) dotPlayer(target, X.PH(m.level) * oh.dot, oh.ms, oh.kind, now);
      if (oh.slow) { target.slowUntil = now + oh.slow; d.markDirty(target); }
    }
    if (o.cc && dealt !== undefined) ccPlayer(target, o.cc, o.ms, now);
    if (o.curse) { target.weakUntil = now + o.curse; d.markDirty(target); fx({ t: 'pcc', target: target.id, cc: 'weak', ms: o.curse }); }
    if (o.slow) { target.slowUntil = now + o.slow; d.markDirty(target); }
    if (m.legionArmed) legionSpawn(m, now);
    return dealt;
  }
  // Снаряд: от него можно увернуться, если уйти с точки попадания
  function shoot(m, target, mult, now, o = {}) {
    const def = MOBS[m.type];
    const tx = target.x, ty = target.y;
    const ms = Math.max(120, Math.hypot(tx - m.x, ty - m.y) / 0.42);
    fx({ t: 'mshot', from: m.id, fx: m.x, fy: m.y - 8, x: tx, y: ty, ms, proj: o.proj || def.proj || 'arrow' });
    setTimeout(() => {
      if (!monsters.has(m.id) || target.dead || target.zone && target.zone !== m.zone) return;
      if (!world.lineOfSight(m.x, m.y, target.x, target.y)) { fx({ t: 'miss', x: target.x, y: target.y }); return; } // спрятался за стеной
      if (!(def.sure || o.sure) && Math.hypot(target.x - tx, target.y - ty) > 30) { fx({ t: 'miss', x: tx, y: ty }); return; }
      hit(m, target, mult, Date.now(), o);
    }, ms);
  }
  // Удар по площади с предупреждением: круг на земле, через delay — урон всем героям внутри
  function telegraph(m, x, y, r, delay, color, onHit, label) {
    fx({ t: 'tele', from: m.id, x, y, r, ms: delay, color, label });
    setTimeout(() => {
      if (!monsters.has(m.id)) return;
      fx({ t: 'teleHit', x, y, r, color });
      for (const p of inZone(m.zone)) if (!p.dead && Math.hypot(p.x - x, p.y - y) <= r) onHit(p);
      for (const pet of pets.values()) if (!pet.down && Math.hypot(pet.x - x, pet.y - y) <= r && zoneIdx(pet) === zoneIdx(m)) d.hurtPet(pet, Math.round(m.dmg), Date.now());
    }, delay);
  }
  const zoneIdx = (e) => world.zoneAtX(e.x)?.idx;

  function summon(m, type, n, cap, now) {
    if (m.summons >= cap) return;
    const z = world.byId.get(m.zone);
    if (!z) return;
    const k = Math.min(n, cap - m.summons);
    for (let i = 0; i < k; i++) {
      const s = create(z, type, near(z, m, 50), m.level, { rank: 'summon', extra: true, lootMult: 0, owner: m.id, aggro: 400 });
      s.target = m.target;
      m.summons++;
    }
    fx({ t: 'msum', from: m.id, x: m.x, y: m.y, n: k });
  }
  function resurrect(m, n, r, now) {
    const corpses = d.corpses().filter((c) => c.zone === m.zone && Math.hypot(c.x - m.x, c.y - m.y) <= r && MOBS[c.type] && MOBS[c.type].rank === 'normal');
    const z = world.byId.get(m.zone);
    let k = 0;
    for (const c of corpses.slice(0, n)) {
      d.removeCorpse(c);
      const s = create(z, c.type, c, c.level || m.level, { extra: true, lootMult: 0, hpMult: 0.5 });
      s.target = m.target;
      fx({ t: 'mrevive', x: c.x, y: c.y });
      k++;
    }
    return k;
  }
  // Свиток призыва легиона: каждая атака вызывает 3 случайных монстра (с перезарядкой)
  function legionSpawn(m, now) {
    const def = MOBS[m.type];
    if (!def.legion || now < (m.legionAt || 0) || m.summons >= 12) return;
    m.legionAt = now + def.legion.cd;
    const pool = X.DUNGEONS[world.byId.get(m.zone)?.town || 'town1'].flatMap((dg) => dg.pool);
    for (let i = 0; i < def.legion.n; i++) {
      const s = create(world.byId.get(m.zone), pool[Math.floor(Math.random() * pool.length)], near(world.byId.get(m.zone), m, 90), m.level - 3, { extra: true, lootMult: 0, owner: m.id, aggro: 600 });
      s.target = m.target; m.summons++;
    }
    fx({ t: 'msum', from: m.id, x: m.x, y: m.y, n: def.legion.n });
  }

  // ---------- Умения ----------
  const ELEMENTS = {
    fire: { proj: 'fireball', o: { onHit: { dot: 0.012, ms: 2 * TURN, kind: 'burn' } }, color: 0xff6a1a, name: 'огонь' },
    ice: { proj: 'frost', o: { cc: 'freeze', ms: TURN / 2 }, color: 0x8ad3ff, name: 'лёд' },
    lightning: { proj: 'spark', o: { cc: 'stun', ms: 400 }, color: 0xffe94a, name: 'молния' },
    poison: { proj: 'venom', o: { onHit: { dot: 0.012, ms: 3 * TURN, kind: 'poison' } }, color: 0x7ad84a, name: 'яд' },
  };
  function useAbility(m, def, t, now) {
    const ab = def.ab, dd = dist(m, t);
    const name = abilityName(def);
    switch (ab.type) {
      case 'dash': {
        if (dd > ab.range || dd < 40) return false;
        const k = (dd - 26) / dd;
        m.x += (t.x - m.x) * k; m.y += (t.y - m.y) * k;
        fx({ t: 'mdash', from: m.id, x: m.x, y: m.y, name });
        hit(m, t, ab.mult, now);
        // Таран без отбрасывания (отброс на телефоне выглядел как лаг): короткое оглушение — герой стоит на месте
        if (ab.knock && !t.owner) ccPlayer(t, 'stun', 500, now);
        return true;
      }
      case 'stunHit': case 'critHit':
        if (dd > 60 + m.size * 10) return false;
        fx({ t: 'mtext', from: m.id, x: m.x, y: m.y, text: name, color: '#ffb060' });
        hit(m, t, ab.mult, now, ab.type === 'stunHit' ? { cc: 'stun', ms: ab.ms } : { crit: true });
        return true;
      case 'spin':
        if (dd > ab.r) return false;
        fx({ t: 'teleHit', from: m.id, x: m.x, y: m.y, r: ab.r, color: 0xece6cc });
        for (const p of inZone(m.zone)) if (!p.dead && dist(p, m) <= ab.r) hit(m, p, ab.mult, now);
        return true;
      case 'aoe': case 'cone': {
        if (dd > (ab.onTarget || ab.type === 'cone' ? 320 : ab.r + 40)) return false;
        let x = m.x, y = m.y, r = ab.r;
        if (ab.onTarget) { x = t.x; y = t.y; }
        if (ab.type === 'cone') { x = m.x + (t.x - m.x) * 0.6; y = m.y + (t.y - m.y) * 0.6; r = ab.r * 0.6; }
        let color = ab.color, o = { ...(ab.dot ? { onHit: ab.dot } : {}), cc: ab.cc, ms: ab.ms, slow: ab.slow, curse: ab.curse, pierce: ab.pierce, drain: ab.drain };
        if (m.element) { const E = ELEMENTS[m.element]; color = E.color; o = { ...o, ...E.o }; }
        telegraph(m, x, y, r, ab.delay, color, (p) => hit(m, p, ab.mult, Date.now(), o), m.mirrorName || name);
        return true;
      }
      case 'multi': {
        if (dd > (m.range || 60 + m.size * 10)) return false;
        fx({ t: 'mtext', from: m.id, x: m.x, y: m.y, text: name, color: '#ffe08a' });
        for (let i = 0; i < ab.n; i++) setTimeout(() => { if (!monsters.has(m.id) || t.dead) return; if (m.range) shoot(m, t, ab.mult, Date.now()); else if (dist(m, t) < 70 + m.size * 10) hit(m, t, ab.mult, Date.now()); }, i * 220);
        if (ab.retreat) { const k = ab.retreat / (dd || 1); d.moveEntity(m, (m.x - t.x) * k, (m.y - t.y) * k); }
        return true;
      }
      case 'trap': case 'ccShot': case 'curse': {
        if (dd > (ab.range || m.range || 200)) return false;
        const o = ab.type === 'curse' ? { curse: ab.ms } : { cc: ab.type === 'ccShot' ? ab.cc : 'root', ms: ab.ms };
        fx({ t: 'mtext', from: m.id, x: m.x, y: m.y, text: name, color: '#c8b0ff' });
        shoot(m, t, ab.type === 'curse' ? 0.6 : 0.8, now, { ...o, proj: ab.web ? 'web' : ab.type === 'trap' ? 'trap' : def.proj });
        if (ab.heal) { m.hp = Math.min(m.maxHp, m.hp + m.maxHp * ab.heal); fx({ t: 'mheal', from: m.id, x: m.x, y: m.y }); }
        return true;
      }
      case 'summon':
        if (m.summons >= ab.cap) return false;
        fx({ t: 'mtext', from: m.id, x: m.x, y: m.y, text: name, color: '#5fffb0' });
        summon(m, ab.mob, ab.n, ab.cap, now);
        if (ab.resurrect) resurrect(m, ab.resurrect, 320, now);
        return true;
      case 'resurrect': {
        const k = resurrect(m, ab.n, ab.r, now);
        if (ab.heal) for (const o of monsters.values()) if (o.zone === m.zone && dist(o, m) < ab.r && o.hp < o.maxHp) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * ab.heal); }
        if (k) fx({ t: 'mtext', from: m.id, x: m.x, y: m.y, text: name, color: '#5fffb0' });
        return k > 0;
      }
      case 'heal': {
        let best = null;
        // Боссов, полубоссов и мировых боссов знахари не лечат: процент от их огромного здоровья — слишком много
        for (const o of monsters.values()) if (o.zone === m.zone && o !== m && !BIG_RANK.has(o.rank) && !o.pvpOf && dist(o, m) <= ab.r && o.hp < o.maxHp * 0.8 && (!best || o.hp / o.maxHp < best.hp / best.maxHp)) best = o;
        if (!best) return false;
        best.hp = Math.min(best.maxHp, best.hp + best.maxHp * ab.frac);
        fx({ t: 'mheal', from: m.id, x: best.x, y: best.y, fx: m.x, fy: m.y });
        return true;
      }
      case 'buff': case 'shieldAlly': {
        let n = 0;
        for (const o of monsters.values()) if (o.zone === m.zone && dist(o, m) <= ab.r) {
          if (ab.type === 'shieldAlly') { if (!BIG_RANK.has(o.rank) || o === m) o.shieldHp = Math.max(o.shieldHp || 0, o.maxHp * ab.frac); } // чужой щит боссам не ставится
          else if (ab.stat === 'atk') { o.atkBuff = ab.mult; o.atkBuffUntil = now + ab.ms; } else { o.spdBuff = ab.mult; o.spdBuffUntil = now + ab.ms; }
          n++;
        }
        fx({ t: 'mbuff', from: m.id, x: m.x, y: m.y, r: ab.r, kind: ab.type === 'shieldAlly' ? 'shield' : ab.stat });
        return n > 0;
      }
      case 'selfDef':
        m.defUntil = now + ab.ms; m.defMult = ab.mult; m.defPhysOnly = !!ab.physOnly;
        fx({ t: 'mtext', from: m.id, x: m.x, y: m.y, text: name, color: '#c8d0e0' });
        return true;
      case 'shield':
        m.shieldHp = m.maxHp * ab.frac;
        fx({ t: 'mbuff', from: m.id, x: m.x, y: m.y, r: 40, kind: 'shield' });
        return true;
      case 'mind': {
        if (t.owner || dd > 260) return false;
        fx({ t: 'mtext', x: t.x, y: t.y, text: name, color: '#ff6ad8' });
        ccPlayer(t, 'confuse', ab.ms, now);
        if (ab.self) d.selfHit(t, 1.5); // герой бьёт сам себя
        else d.allyHit(t); // или ближайшего союзника
        return true;
      }
      case 'form':
        m.form = m.form === 'beast' ? null : 'beast';
        fx({ t: 'mtext', from: m.id, x: m.x, y: m.y, text: m.form ? 'Звериная форма!' : 'Облик человека', color: '#9aff6a' });
        return false;
      case 'element': {
        const keys = ['fire', 'ice', 'lightning'], k = keys[Math.floor(Math.random() * keys.length)];
        fx({ t: 'mtext', from: m.id, x: m.x, y: m.y, text: `Стихия: ${ELEMENTS[k].name}`, color: '#ffe94a' });
        shoot(m, t, 1.3, now, { ...ELEMENTS[k].o, proj: ELEMENTS[k].proj });
        return true;
      }
      case 'chaos': return chaos(m, def, t, now, !!ab.big);
      default: return false;
    }
  }
  function chaos(m, def, t, now, big) {
    const pw = big ? 1.5 : 1;
    const opts = [
      () => telegraph(m, t.x, t.y, 110 * pw, 900, 0xff6ad8, (p) => hit(m, p, 1.5 * pw, Date.now()), 'Хаос: взрыв'),
      () => { fx({ t: 'mtext', from: m.id, x: m.x, y: m.y, text: 'Хаос: морок', color: '#ff6ad8' }); shoot(m, t, 0.8, now, { cc: 'confuse', ms: TURN, proj: 'illusion' }); },
      () => { fx({ t: 'mtext', from: m.id, x: m.x, y: m.y, text: 'Хаос: призыв', color: '#ff6ad8' }); summon(m, 'imp', big ? 2 : 1, big ? 6 : 2, now); },
      () => { fx({ t: 'mtext', from: m.id, x: m.x, y: m.y, text: 'Хаос: проклятие', color: '#ff6ad8' }); shoot(m, t, 0.6, now, { curse: 3 * TURN, proj: 'dark' }); },
      () => { m.hp = Math.min(m.maxHp, m.hp + m.maxHp * (big ? 0.03 : 0.1)); fx({ t: 'mheal', from: m.id, x: m.x, y: m.y }); },
      () => { const p = near(world.byId.get(m.zone), t, 60); m.x = p.x; m.y = p.y; fx({ t: 'mdash', from: m.id, x: m.x, y: m.y, name: 'Хаос: скачок' }); },
    ];
    opts[Math.floor(Math.random() * opts.length)]();
    return true;
  }
  const abilityName = (def) => ({ goblinRaider: 'Рывок', orcWarrior: 'Тяжёлый удар', skeletonSword: 'Костяной вихрь', alphaWolf: 'Вой', minotaur: 'Таран', stoneGolem: 'Землетрясение',
    lycanthrope: 'Превращение', goblinArcher: 'Град стрел', darkHunter: 'Капкан', orcThrower: 'Двойной бросок', harpy: 'Пикирование', centaurArcher: 'Кавалерийский выстрел',
    iceWarlock: 'Ледяная стрела', necromancer: 'Поднятие мертвецов', elementalist: 'Смена элемента', cursedPriest: 'Проклятие слабости', chaosMage: 'Хаотический взрыв',
    pyromancer: 'Стена огня', cryomancer: 'Ледяная буря', stoneGuard: 'Каменная кожа', ironGolem: 'Железная броня', ent: 'Корни', boneTitan: 'Костяной щит',
    nightBlade: 'Смертельный удар', poisonSpider: 'Паутина', temptress: 'Подчинение', skeletonLord: 'Армия мёртвых', demonologist: 'Портал в ад', spiderMatriarch: 'Кладка',
    goblinShaman: 'Тотем', lich: 'Восстание', goblinHealer: 'Лечебный отвар', darkPriest: 'Тёмное благословение', demonHerald: 'Адский марш', crystalGuardian: 'Кристальный щит',
    orcChief: 'Ярость вождя', necroPriest: 'Тёмный ритуал', dragonWhelp: 'Огненное дыхание', skeletonKing: 'Костяной шторм', gryphon: 'Воздушный таран',
    trollShaman: 'Проклятие', vampireLord: 'Кровавая жатва', stoneTitan: 'Землетрясение', ancientDragon: 'Пламя дракона', lichKing: 'Армия мёртвых',
    abyssTitan: 'Удар бездны', demonLord: 'Подчинение', fallenAngel: 'Кара', kraken: 'Щупальца', gorgonBoss: 'Взгляд', phoenix: 'Огненный шторм',
    cerberus: 'Тройная атака', chaosLord: 'Хаос', legion: 'Легион', devourer: 'Поглощение', eternalDragon: 'Вечность', abyssAvatar: 'Зеркало', chaosTitan: 'Смена фазы' })[def.id] || '';

  // ---------- Пассивные механики (раз в тик) ----------
  // Регенерация в долях от здоровья рассчитана на полубосса (здоровье ×30 урона героя в секунду). У босса здоровья ×450,
  // у мирового ×6000 — та же доля лечила бы сильнее урона целой группы (Тролль-шаман в роли босса не терял ни капли).
  // Поэтому у них доля уменьшается во столько же раз: лечение в пересчёте на урон героев — как у полубосса
  const REGEN_K = { boss: 30 / 450, world: 30 / 6000 };
  function passives(m, def, now, dt) {
    const rk = REGEN_K[m.rank] || 1;
    if (def.regen && m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * def.regen * rk * dt);
    if (def.regenTurn && m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * def.regenTurn / 2 * rk * dt);
    if (m.affixes.includes('regen') && m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.02 * dt);
    if (now < (m.slowTick || 0)) return;
    m.slowTick = now + 1000;
    // Ауры поддержки: знаменосец, король скелетов, тотем шамана
    m.auraMult = 1;
    for (const o of monsters.values()) {
      if (o === m || o.zone !== m.zone) continue;
      const od = MOBS[o.type];
      const a = od.aura || od.totem;
      if (!a || dist(o, m) > a.r) continue;
      if (a.only === 'undead' && !m.undead) continue;
      if (a.only === 'goblin' && !/goblin/i.test(m.type)) continue;
      m.auraMult = Math.max(m.auraMult, a.atk);
    }
    if (m.affixes.includes('burning')) for (const p of inZone(m.zone)) if (!p.dead && dist(p, m) < 90) d.hurtPlayer(p, X.PH(m.level) * 0.015, m, now, false, 'burn');
    if (def.ab && def.ab.type === 'form' && now > (m.formAt || 0)) { m.formAt = now + def.ab.every; useAbility(m, def, m, now); }
    // Вечный дракон: каждые 3 хода — новая стихия
    if (def.eternity && now > (m.elemAt || 0)) {
      const keys = Object.keys(ELEMENTS);
      m.element = keys[(keys.indexOf(m.element) + 1) % keys.length];
      m.elemAt = now + def.eternity;
      fx({ t: 'mtext', from: m.id, x: m.x, y: m.y - 30, text: `Вечность: ${ELEMENTS[m.element].name}`, color: '#bfe8ff', big: true });
    }
    // Титан хаоса: каждые 5 ходов — новая фаза
    if (def.phases && now > (m.phaseAt || 0)) {
      const P = { rage: 'Ярость', stone: 'Камень', storm: 'Буря', dark: 'Тьма' }, keys = Object.keys(P);
      m.phase = keys[Math.floor(Math.random() * keys.length)];
      m.phaseAt = now + def.phases;
      fx({ t: 'mtext', from: m.id, x: m.x, y: m.y - 30, text: `Фаза: ${P[m.phase]}`, color: '#ff6ad8', big: true });
    }
    // Пожиратель миров: поедает своих демонов рядом (+20% HP за каждого)
    if (def.devour) {
      if (now > (m.feedAt || 0)) { m.feedAt = now + 12000; summon(m, 'imp', 2, 6, now); }
      for (const o of monsters.values()) if (o.owner === m.id && o.zone === m.zone && dist(o, m) < 70 && now - (o.bornAt || (o.bornAt = now)) > 6000) {
        monsters.delete(o.id); m.summons--;
        m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.2);
        fx({ t: 'mtext', from: m.id, x: m.x, y: m.y, text: 'Поглощение! +20%', color: '#ff4a8a', big: true });
      }
    }
    // Тень: невидима, пока не подойдёт вплотную
    if (def.stealth && !m.inv && now > (m.revealUntil || 0) && !m.target) m.inv = true;
  }

  // ---------- Поведение в бою (вызывается из игрового цикла сервера) ----------
  // Возвращает true, если монстр уже действовал в этом тике
  // ---------- Клон героя на арене (и «Тень чемпиона»): свои умения, движение, зелье ----------
  // Умения героя упрощены до трёх образов: 1-е — удар/выстрел по цели (рывок у бойцов ближнего боя),
  // 2-е — удар по площади с предупреждением (от него можно увернуться), 3-е — щит и усиление себя.
  function cloneAct(m, t, now, dt) {
    const c = m.clone, dd = dist(m, t), seen = world.lineOfSight(m.x, m.y, t.x, t.y), speed = curSpeed(m, now), rooted = m.rootUntil > now;
    const say = (text, color = '#ffe08a') => fx({ t: 'mtext', from: m.id, x: m.x, y: m.y, text, color });
    if (!c.hello) { c.hello = true; say('🪞 Я — это ты!', '#c8b0ff'); }
    // Зелье: один раз за бой, когда здоровья меньше трети
    if (!c.potUsed && m.hp < m.maxHp * 0.35) { c.potUsed = true; m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.25); fx({ t: 'mheal', from: m.id, x: m.x, y: m.y }); say('🧪 Зелье здоровья', '#7dff8a'); return true; }
    // Умения
    if (seen && now >= c.gcd) {
      for (const i of [2, 1, 0]) {
        const sk = c.skills[i];
        if (!sk || now < sk.next) continue;
        const label = `${sk.icon} ${sk.name}`;
        if (i === 2) {
          if (m.hp > m.maxHp * 0.8 && Math.random() < 0.6) continue; // щит бережёт, пока здоров
          m.shieldHp = Math.max(m.shieldHp || 0, m.maxHp * 0.15); m.atkBuff = 1.3; m.atkBuffUntil = now + 5000;
          fx({ t: 'mbuff', from: m.id, x: m.x, y: m.y, r: 40, kind: 'shield' }); say(label, '#9ad8ff');
        } else if (i === 1) {
          if (dd > 320) continue;
          telegraph(m, t.x, t.y, 85, 850, 0xff8a3a, (p) => hit(m, p, 2.2, Date.now()), label);
        } else {
          if (m.range > 0) { if (dd > m.range + 40) continue; say(label); shoot(m, t, 2, now, { proj: c.proj }); }
          else {
            if (dd > 220) continue;
            if (dd > 50 && !rooted) { const k = (dd - 30) / dd; d.moveEntity(m, (t.x - m.x) * k, (t.y - m.y) * k); fx({ t: 'mdash', from: m.id, x: m.x, y: m.y, name: label }); } else say(label);
            hit(m, t, 1.8, now);
          }
        }
        sk.next = now + sk.cd; c.gcd = now + 900; m.lastAttack = now;
        return true;
      }
    }
    if (now > c.flipAt) { c.dir = -c.dir; c.flipAt = now + 900 + Math.random() * 1300; }
    const px = -(t.y - m.y) / (dd || 1), py = (t.x - m.x) / (dd || 1); // поперёк направления на героя
    if (Math.abs(t.x - m.x) > 2) m.face = Math.sign(t.x - m.x);
    if (m.range > 0) {
      // Стрелок: держит дистанцию, уходит в сторону, отступает, если герой близко
      if (!rooted) {
        if (dd > m.range || !seen) step(m, t, speed * dt);
        else if (dd < m.range * 0.45) { step(m, t, -speed * 0.9 * dt); d.moveEntity(m, px * c.dir * speed * 0.3 * dt, py * c.dir * speed * 0.3 * dt); }
        else d.moveEntity(m, px * c.dir * speed * 0.55 * dt, py * c.dir * speed * 0.55 * dt);
      }
      if (seen && dd <= m.range && now - m.lastAttack > m.cd) { m.lastAttack = now; shoot(m, t, 1, now, { proj: c.proj }); }
      return true;
    }
    // Ближний бой: подходит зигзагом, после серии ударов отскакивает в сторону
    if (dd > meleeRange(m)) {
      if (!rooted) { step(m, t, speed * dt); d.moveEntity(m, px * c.dir * speed * 0.35 * dt, py * c.dir * speed * 0.35 * dt); }
    } else if (now < c.sideUntil) {
      if (!rooted) d.moveEntity(m, px * c.dir * speed * 0.8 * dt, py * c.dir * speed * 0.8 * dt);
    } else if (now - m.lastAttack > m.cd) {
      m.lastAttack = now; melee(m, t, now);
      if (++c.hits >= 3) { c.hits = 0; c.sideUntil = now + 450; }
    }
    return true;
  }

  function act(m, target, now, dt) {
    const def = MOBS[m.type];
    passives(m, def, now, dt);
    if (!target) return false;
    if (m.clone) return cloneAct(m, target, now, dt);
    const dd = dist(m, target);
    const seen = world.lineOfSight(m.x, m.y, target.x, target.y);
    // Умение — только если цель видна (не через стену)
    if (def.ab && def.ab.type !== 'form' && now >= m.abAt && dd < 420 && seen) {
      if (useAbility(m, def, target, now)) { m.abAt = now + def.ab.cd * (m.phase === 'storm' ? 0.5 : 1); m.lastAttack = now; return true; }
      m.abAt = now + 1000;
    }
    // Тень: удар в спину из невидимости
    if (m.inv && dd < 46) { m.inv = false; m.revealUntil = now + 6000; fx({ t: 'mtext', from: m.id, x: m.x, y: m.y, text: 'Удар в спину!', color: '#c070ff' }); hit(m, target, def.backstab || 2, now); m.lastAttack = now; return true; }
    // Дальний бой: держит дистанцию и стреляет
    if (m.range > 0) {
      const speed = curSpeed(m, now);
      // Цель далеко или за стеной — подходит ближе, через стену не стреляет
      if (dd > m.range || !seen) { if (m.rootUntil <= now) step(m, target, speed * dt); return true; }
      if (def.kite && dd < m.range * 0.45 && m.rootUntil <= now) step(m, target, -speed * 0.8 * dt);
      if (now - m.lastAttack > m.cd * (m.phase === 'storm' ? 0.5 : 1)) { m.lastAttack = now; if (target.owner) melee(m, target, now); else shoot(m, target, 1, now); }
      return true;
    }
    return false;
  }
  const curSpeed = (m, now) => m.speed * (m.spdBuffUntil > now ? m.spdBuff : 1) * (m.slowUntil > now ? 0.6 : 1) * (m.form === 'beast' ? 1.5 : 1) * (m.phase === 'rage' ? 1.3 : 1);
  function step(m, t, s) {
    const dx = t.x - m.x, dy = t.y - m.y, dd = Math.hypot(dx, dy) || 1;
    if (Math.abs(dx) > 2) m.face = Math.sign(dx);
    d.moveEntity(m, (dx / dd) * s, (dy / dd) * s);
  }
  // Ближняя атака (обычная)
  // Удар вблизи: «замах» уходит на клиент всегда — даже если удар принял щит, питомец или он промахнулся
  function melee(m, target, now) { if (target) fx({ t: 'mswing', from: m.id, x: target.x }); hit(m, target, 1, now); }
  const meleeRange = (m) => 30 + 10 * (m.size || 1);

  // Модификаторы получаемого урона (из damageMonster)
  function takenMult(m, opt, now) {
    const def = MOBS[m.type];
    let k = def.taken || 1;
    if (m.affixes.includes('armored')) k *= 0.7;
    if (m.defUntil > now && (!m.defPhysOnly || opt.basic || opt.pet)) k *= m.defMult;
    if (def.physImmune && (opt.basic || opt.pet)) k *= def.physImmune;
    if (def.magicImmune && !opt.basic && !opt.pet) k *= def.magicImmune;
    if (m.form === 'beast') k *= 1.2;
    if (m.phase === 'stone') k *= 0.4;
    if (m.wbShield) k *= 0.1; // щит задания мирового босса
    if (m.wbImmune) k = 0; // дракон в небе
    if (m.vulnUntil > now) k *= 1.5; // щит разбит — босс уязвим
    return k;
  }
  // Реакция на удар героя: отражение, заморозка атакующего, раскрытие тени, вклад в мирового босса
  function onHurt(m, p, dmg, opt, now) {
    const def = MOBS[m.type];
    if (m.inv) { m.inv = false; m.revealUntil = now + 6000; }
    if (m.contrib && p.uid) m.contrib[p.uid] = (m.contrib[p.uid] || 0) + dmg;
    if (opt.fixed || opt.pet || opt.reflect || !p.socket) return;
    if (def.reflect && dmg > 0) d.hurtPlayer(p, dmg * def.reflect, m, now, false, 'reflect');
    if (def.freezeOnHit && dist(p, m) < 90 && now > (m.freezeAt || 0)) { m.freezeAt = now + 4000; ccPlayer(p, 'freeze', def.freezeOnHit, now); }
    if (def.mirror && !opt.basic && p.lastSkill) m.mirrorName = `Зеркало: ${p.lastSkill}`;
  }
  // Смерть: воскрешение (скелет, феникс) — вернуть true, чтобы отменить смерть
  function preventDeath(m) {
    const def = MOBS[m.type];
    if (def.revive && !m.revived) {
      m.revived = true;
      m.hp = Math.round(m.maxHp * def.revive);
      m.dots = [];
      fx({ t: 'mrevive', from: m.id, x: m.x, y: m.y, big: m.boss });
      return true;
    }
    return false;
  }
  function onKilled(m, killer) {
    const def = MOBS[m.type];
    if (m.owner) { const o = monsters.get(m.owner); if (o) o.summons = Math.max(0, o.summons - 1); }
    // Кровавый жнец, пожиратель: лечатся за смерти рядом
    for (const o of monsters.values()) {
      const od = MOBS[o.type];
      if (od.harvest && o.zone === m.zone && dist(o, m) < 320 && !od.devour) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * od.harvest); fx({ t: 'mtext', x: o.x, y: o.y, text: 'Жатва!', color: '#ff3a3a' }); }
    }
    // Легион: при потере 50% все монстры зоны злее
    if (m.hall && (m.rank === 'boss' || m.rank === 'mini')) rewardHallBoss(m);
    if (m.rank === 'world') rewardWorldBoss(m);
  }
  function onMonsterHp(m, now) {
    const def = MOBS[m.type];
    if (def.enrage && def.enrage.allies && !m.alliesEnraged && m.hp < m.maxHp * def.enrage.below) {
      m.alliesEnraged = true;
      for (const o of monsters.values()) if (o.zone === m.zone) o.allEnraged = true;
      fx({ t: 'mtext', from: m.id, x: m.x, y: m.y - 30, text: 'Единая воля: +50% атаки!', color: '#5fffb0', big: true });
    }
    if (def.legion) m.legionArmed = true;
  }

  // ---------- Данжи: общие залы для всех игроков ----------
  // Каждый данж — один зал на сервер. В обычных комнатах убитые монстры возрождаются через 5–10 секунд (пока в зале есть люди),
  // полубоссы возрождаются через 15 минут после гибели, босс данжа — три раза в день: 12:00, 18:00 и 23:00 МСК (DUNGEON_BOSS_TIMES, часы по МСК через запятую).
  // Награду за полубосса и босса получают все, кто нанёс хотя бы 3% его здоровья.
  const halls = new Map(), announced = {};
  // Время появления боссов данжей (МСК = UTC+3): «12:00,18:00,23:00»
  const BOSS_TIMES = String(process.env.DUNGEON_BOSS_TIMES || '12:00,18:00,23:00').split(',').map((s) => s.trim().split(':').map(Number)).filter(([h]) => h >= 0 && h < 24);
  const RESPAWN = [8000, 8000], IDLE_MS = 5 * 60000, WARN_MS = 15 * 60000, GATE_OPEN_MS = 10 * 60000;
  const MINI_RESPAWN = 15 * 60e3; // полубосс возрождается через 15 минут после гибели
  const PK_BOSS_RESPAWN = 40 * 60e3; // боссы опасного данжа — через 40 минут
  const PK_MOB = { hp: 1.3, dmg: 1.3 }; // монстры опасного данжа крепче обычных
  // Обычные (безопасные) данжи — проще: здоровье ×0,8, урон ×0,75 (монстр ~2,4 с, стая ~4,5% здоровья в секунду).
  // Итог по расчёту: опасный данж даёт ~в 2 раза больше опыта и ~в 4 раза больше добычи в час, чем безопасный, —
  // монстры там в 1,6 раза крепче, но опыт ×3, добыча ×6
  const SAFE_MOB = { hp: 0.8, dmg: 0.75 };
  const nextHour = (t) => Math.floor(t / 36e5) * 36e5 + 36e5;
  function nextBossAt(t) {
    const x = new Date(t), day = Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
    let best = Infinity;
    for (const [h, mi = 0] of BOSS_TIMES) for (const dd of [-1, 0, 1]) {
      const at = day + dd * 864e5 + ((h - 3) * 60 + mi) * 60000; // МСК → UTC
      if (at > t && at < best) best = at;
    }
    return best;
  }
  const hhmm = (t) => new Date(t + 3 * 36e5).toISOString().slice(11, 16) + ' МСК';
  function rollRank(depthK) {
    const r = Math.random(), k = X.bal2() ? 1.5 : 1; // новый баланс: «синие» и «жёлтые» в полтора раза чаще
    if (r < (0.04 + 0.06 * depthK) * k) return 'rare';
    if (r < (0.2 + 0.15 * depthK) * k) return 'magic';
    return 'normal';
  }
  function initHall(z) {
    const dg = z.dg, now = Date.now();
    const lvAt = (depth) => Math.round(dg.lv[0] + (dg.lv[1] - dg.lv[0]) * depth / Math.max(1, z.maxD));
    const h = { z, dg, rooms: [], minis: [], boss: null, populated: false, lastPlayerAt: now };
    let mi = 0;
    for (const [ri, room] of z.rooms.entries()) {
      if (room.role === 'start') continue;
      const c = z.abs(room.cx, room.cy), R = Math.min(room.x1 - room.x0, room.y1 - room.y0) * 16;
      const lv = lvAt(room.depth), depthK = room.depth / Math.max(1, z.maxD);
      const fighters = dg.pool.filter((t) => !['summoner', 'support'].includes(MOBS[t].cls));
      const type = fighters[Math.floor(Math.random() * fighters.length)] || dg.pool[0];
      const target = room.role === 'normal' ? Math.round((3 + Math.floor(Math.random() * 2)) * (MOBS[type].pack || 1)) : 2; // у полубосса и босса — охрана
      // Опасный данж: «синие» и «жёлтые» чаще по всему лабиринту (глубина не ниже половины)
      h.rooms.push({ c, R, lv, depthK: dg.pk ? Math.max(0.5, depthK) : depthK, type, target, ids: new Set(), nextAt: 0, ri });
      if (dg.pk) continue; // полубоссы и боссы опасного данжа — ниже, по глубине комнат
      if (room.role === 'mini') h.minis.push({ c, type: dg.minis[mi++ % dg.minis.length], lv: lv + 1, id: null, at: now, ri });
      if (room.role === 'boss') h.boss = { c, type: dg.boss, lv: dg.lv[1] + 1, id: null, at: nextBossAt(now), warned: false, ri };
    }
    if (dg.pk) {
      // Самая дальняя комната и две следующие по глубине — боссы (возрождаются через PK_BOSS_RESPAWN), остальные — полубоссы
      const big = z.rooms.map((r, ri) => ({ r, ri })).filter(({ r }) => r.role === 'boss' || r.role === 'mini').sort((a, b) => (b.r.role === 'boss') - (a.r.role === 'boss') || b.r.depth - a.r.depth);
      big.forEach(({ r, ri }, k) => {
        const c = z.abs(r.cx, r.cy), lv = lvAt(r.depth) + 1;
        if (k < dg.bosses.length) h.minis.push({ c, type: dg.bosses[dg.bosses.length - 1 - k], name: dg.bossNames[dg.bosses.length - 1 - k], rank: 'boss', respawn: PK_BOSS_RESPAWN, lv: Math.max(lv, dg.lv[1] - k), id: null, at: now, ri });
        else h.minis.push({ c, type: dg.minis[(k - dg.bosses.length) % dg.minis.length], lv, id: null, at: now, ri });
      });
    }
    return h;
  }
  // ---------- Комнаты данжа: агр только в своей комнате, погоня — не дальше соседних ----------
  const T_ = C.TILE;
  function roomAt(z, x, y, nearest) {
    const tx = (x - z.ox) / T_, ty = (y - z.oy) / T_, rs = z.rooms;
    let best = -1, bd = 1e18;
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i];
      const dx = Math.max(r.x0 - tx, 0, tx - (r.x1 + 1)), dy = Math.max(r.y0 - ty, 0, ty - (r.y1 + 1));
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; if (d === 0) break; }
    }
    return bd === 0 || nearest ? best : -1; // в коридоре: точная комната — нет, ближайшая — да
  }
  // Комната героя/питомца с запоминанием: монстров в зоне много, а герой за тик стоит на месте —
  // без кеша roomAt считалась для каждой пары «монстр × герой» (это было ~15% времени сервера при 100 игроках)
  function roomOf(z, e, nearest) {
    const c = e._rc;
    if (c && c.z === z && c.x === e.x && c.y === e.y) return nearest ? c.n : c.e;
    const n = roomAt(z, e.x, e.y, true);
    const tx = (e.x - z.ox) / T_, ty = (e.y - z.oy) / T_, r = n >= 0 ? z.rooms[n] : null;
    const inside = r && tx >= r.x0 && tx <= r.x1 + 1 && ty >= r.y0 && ty <= r.y1 + 1;
    e._rc = { z, x: e.x, y: e.y, n, e: inside ? n : -1 };
    return nearest ? n : e._rc.e;
  }
  // Заметить героя: только если он в комнате монстра
  function canAggro(m, p) {
    const z = m.room == null ? null : world.byId.get(m.zone);
    if (!z || !z.rooms) return true;
    return roomOf(z, p, false) === m.room;
  }
  // Держать цель: пока она в комнате монстра, в соседней или в коридоре между ними
  // Боссы и полубоссы держат цель дальше: на две комнаты от своей (иначе в соседней комнате сбрасывали бой и лечились)
  function inLeash(m, p) {
    const z = m.room == null ? null : world.byId.get(m.zone);
    if (!z || !z.rooms) return true;
    const r = roomOf(z, p, true);
    const links = z.rooms[m.room].links || [];
    if (r === m.room || links.includes(r)) return true;
    return !!(m.boss || m.mini) && links.some((l) => (z.rooms[l].links || []).includes(r));
  }
  // Рядом для группы: в лабиринте — та же комната или соседняя (через коридор), иначе — по расстоянию
  function groupNear(a, b) {
    if (a.zone !== b.zone || Math.hypot(a.x - b.x, a.y - b.y) > 900) return false;
    const z = world.byId.get(a.zone);
    if (!z || !z.rooms) return true;
    const ra = roomOf(z, a, true), rb = roomOf(z, b, true);
    return ra === rb || (ra >= 0 && (z.rooms[ra].links || []).includes(rb));
  }
  const hallOf = (z) => { let h = halls.get(z.id); if (!h) { h = initHall(z); halls.set(z.id, h); } return h; };
  // Точка возрождения: в комнате, по возможности не рядом с героями
  function spawnPoint(z, r, heroes) {
    let best = null, bestD = -1;
    for (let i = 0; i < 8; i++) {
      const pt = near(z, r.c, r.R), d0 = heroes.reduce((m, p) => Math.min(m, Math.hypot(p.x - pt.x, p.y - pt.y)), 1e9);
      if (d0 > 160) return pt;
      if (d0 > bestD) { bestD = d0; best = pt; }
    }
    return best;
  }
  function spawnInRoom(h, r, heroes) {
    const dg = h.dg;
    const fighters = dg.pool.filter((t) => !['summoner', 'support'].includes(MOBS[t].cls));
    const helpers = dg.pool.filter((t) => ['summoner', 'support'].includes(MOBS[t].cls));
    const hasHelper = [...r.ids].some((id) => { const m = monsters.get(id); return m && ['summoner', 'support'].includes(MOBS[m.type].cls); });
    const t = helpers.length && !hasHelper && Math.random() < 0.2 ? helpers[Math.floor(Math.random() * helpers.length)]
      : Math.random() < 0.6 ? r.type : fighters[Math.floor(Math.random() * fighters.length)] || r.type;
    const rank = rollRank(r.depthK);
    const affixes = rank === 'rare' ? Object.keys(AFFIXES).sort(() => Math.random() - 0.5).slice(0, (X.bal2() ? 2 : 1) + (Math.random() < 0.5 ? 1 : 0)) : []; // новый баланс: 2–3 свойства
    const m = create(h.z, t, spawnPoint(h.z, r, heroes), r.lv, { rank, affixes, ...(dg.pk ? { hpMult: PK_MOB.hp, dmgMult: PK_MOB.dmg } : X.bal2() ? { hpMult: SAFE_MOB.hp, dmgMult: SAFE_MOB.dmg } : {}) });
    m.room = r.ri; // монстр «живёт» в своей комнате (агр и погоня — server/dungeon.js → canAggro/inLeash)
    r.ids.add(m.id);
    return m;
  }
  function setGates(h, state) {
    const z = h.z;
    for (const g of z.gates || []) {
      if (g.state === state) continue;
      g.state = state;
      for (const k of g.idx) z.tiles[k] = state === 'open' ? g.floor : 16;
      if (state === 'seal') {
        // Кто остался в комнате босса — переносится ко входу в данж
        const r = z.rooms.find((x) => x.role === 'boss');
        for (const p of inZone(z.id)) {
          const tx = Math.floor((p.x - z.ox) / C.TILE), ty = Math.floor((p.y - z.oy) / C.TILE);
          if (r && tx >= r.x0 - 1 && tx <= r.x1 + 1 && ty >= r.y0 - 1 && ty <= r.y1 + 1) { d.moveToZone(p, z.id); p.socket.emit('chat', { sys: true, text: '🚪 Ворота босса запечатаны — вы у входа в данж' }); }
        }
      }
      for (const p of inZone(z.id)) p.socket.emit('gate', { i: g.i, state, idx: g.idx, tile: state === 'open' ? g.floor : 16 });
    }
  }
  function tellHall(h, text) {
    const town = world.byId.get(h.z.town);
    for (const p of players.values()) if (p.zone === h.z.id || p.zone === h.z.town) p.socket.emit('chat', { sys: true, text: `${text} — ${h.dg.name} (${town.name})` });
  }
  function tickHall(h, now) {
    const heroes = inZone(h.z.id);
    if (heroes.length) {
      h.lastPlayerAt = now;
      if (!h.populated) { h.populated = true; for (const r of h.rooms) while (r.ids.size < r.target) spawnInRoom(h, r, heroes); }
    } else if (h.populated && now - h.lastPlayerAt > IDLE_MS) {
      // Зал пуст 5 минут: обычные монстры исчезают (полубоссы и босс остаются)
      for (const r of h.rooms) { for (const id of r.ids) monsters.delete(id); r.ids.clear(); r.nextAt = 0; }
      h.populated = false;
    }
    const bossRoomShut = h.boss && h.z.gates && h.z.gates.length && h.z.gates.every((g) => g.state === 'seal');
    if (h.populated) for (const r of h.rooms) {
      for (const id of r.ids) if (!monsters.has(id)) r.ids.delete(id);
      // Комната босса за запечатанными воротами пуста — охрана появляется вместе с боссом
      if (bossRoomShut && r.ri === h.boss.ri) { for (const id of r.ids) monsters.delete(id); r.ids.clear(); r.nextAt = 0; continue; }
      if (r.ids.size >= r.target) { r.nextAt = 0; continue; }
      if (!r.nextAt) r.nextAt = now + RESPAWN[0] + Math.random() * (RESPAWN[1] - RESPAWN[0]) + (X.bal2() ? 2000 + Math.random() * 1000 : 0); // новый баланс: +2–3 с
      else if (now >= r.nextAt && heroes.length) { spawnInRoom(h, r, heroes); r.nextAt = 0; }
    }
    for (const mi of h.minis) {
      if (mi.id && !monsters.has(mi.id)) { mi.id = null; mi.at = now + (mi.respawn || MINI_RESPAWN); }
      if (!mi.id && now >= mi.at) {
        const m = mi.rank === 'boss'
          ? create(h.z, mi.type, mi.c, mi.lv, { rank: 'boss', name: mi.name, hpMult: bossHpMult(3) * PK_MOB.hp, dmgMult: PK_MOB.dmg }) // рассчитан на группу из ~3
          : create(h.z, mi.type, mi.c, mi.lv, { rank: 'mini', hpMult: MINI_K.hp * (h.dg.pk ? PK_MOB.hp : 1), dmgMult: MINI_K.dmg * (h.dg.pk ? PK_MOB.dmg : 1), xpMult: MINI_K.xp }); // полубосс данжа — втрое крепче
        m.room = mi.ri;
        mi.id = m.id; m.hall = h.z.id;
        tellHall(h, mi.rank === 'boss' ? `👑 Босс «${m.name || MOBS[mi.type].name}» пробудился` : `⭐ Полубосс «${MOBS[mi.type].name}» появился`);
        h.sentAt = 0;
      }
    }
    // Кто был в бою с боссом/полубоссом: время в его комнате, пока он ранен (для награды за участие, даже если урона мало)
    if (h.populated) {
      const big = [h.boss && h.boss.id, ...h.minis.map((mi) => mi.id)].map((id) => id && monsters.get(id)).filter((m) => m && m.hp < m.maxHp);
      if (big.length) for (const p of inZone(h.z.id)) {
        if (p.dead) continue;
        const r = roomAt(h.z, p.x, p.y, true);
        for (const m of big) if (m.room === r) (m.present ??= {})[p.uid] = ((m.present || {})[p.uid] || 0) + (now - (h.presAt || now));
      }
      h.presAt = now;
      // Босс данжа крепнет, когда в его комнату приходит больше героев (считаем и тех, кто уже бил его)
      const bm = h.boss && h.boss.id && monsters.get(h.boss.id);
      if (bm) {
        const who = new Set(Object.keys(bm.contrib || {}));
        for (const p of inZone(h.z.id)) if (!p.dead && roomAt(h.z, p.x, p.y, true) === bm.room) who.add(p.uid);
        const n = Math.max(1, who.size);
        if (n > (bm.scaledFor || 1)) { const k = bossHpMult(n) / bossHpMult(bm.scaledFor || 1); bm.maxHp = Math.round(bm.maxHp * k); bm.hp = Math.round(bm.hp * k); bm.scaledFor = n; }
      }
    }
    const b = h.boss;
    if (b) {
      if (b.id && !monsters.has(b.id)) { b.id = null; b.at = nextBossAt(now); b.warned = false; b.openUntil = now + GATE_OPEN_MS; }
      // Ворота комнаты босса: открыты, пока босс жив, и ещё 10 минут после победы; потом запечатываются
      setGates(h, b.id || now < (b.openUntil || 0) ? 'open' : 'seal');
      // Объявления — одно на всех (боссы всех данжей появляются в одно время), плюс строка в своём городе
      if (!b.id && !b.warned && b.at - now <= WARN_MS) {
        b.warned = true;
        if (announced.warn !== b.at) {
          announced.warn = b.at;
          d.broadcast({ ev: 'boss', title: `👑 Боссы данжей — в ${hhmm(b.at)}`, text: `Через ${Math.max(1, Math.round((b.at - now) / 60000))} мин во всех данжах. Соберите группу: награда — каждому, кто бился` });
          if (d.push) d.push('boss', `👑 В ${hhmm(b.at)} в данжах появятся боссы! Соберите группу — награда всем, кто сражался.`);
        }
      }
      if (!b.id && now >= b.at) {
        const m = create(h.z, b.type, b.c, b.lv, { rank: 'boss', name: h.dg.bossName, hpMult: bossHpMult(1) });
        m.scaledFor = 1;
        m.room = b.ri;
        b.id = m.id; m.hall = h.z.id;
        if (announced.spawn !== b.at) { announced.spawn = b.at; d.broadcast({ ev: 'boss', title: '👑 Боссы данжей появились', text: 'Ворота боссов открыты во всех данжах — заходите в порталы своего мира' }); }
        tellHall(h, `👑 Босс «${m.name || MOBS[b.type].name}» ждёт`);
        h.sentAt = 0;
      }
    }
  }
  // Вход в данж — в общий зал; HUD: таймеры полубоссов и босса
  function startDungeon(p, townId, i) {
    const dg = X.DUNGEONS[townId][i];
    if (!dg) return;
    if (p.char.level < Math.max(1, dg.lv[0] - 2)) return p.socket.emit('skillFail', `Нужен ${Math.max(1, dg.lv[0] - 2)} уровень (данж ${dg.lv[0]}–${dg.lv[1]})`);
    const z = world.byId.get(`dg_${townId}_${i}`);
    const h = hallOf(z);
    const need = Math.max(1, dg.lv[0] - 2);
    const all = d.partyMembers(p).filter((o) => o.zone === p.zone && !o.dead);
    // Группа входит, только если подходит самый слабый участник: уровень считается по минимальному в группе
    const low = all.filter((o) => o.char.level < need);
    if (low.length) {
      const msg = `${dg.name}: нужен ${need} уровень у всей группы — не подходит: ${low.map((o) => `${o.name} (${o.char.level} ур.)`).join(', ')}`;
      for (const o of all) o.socket.emit('skillFail', msg);
      return;
    }
    const group = all;
    for (const o of group) {
      d.moveToZone(o, z.id);
      o.socket.emit('chat', { sys: true, text: `${dg.name} (ур. ${dg.lv[0]}–${dg.lv[1]}): общий зал — здесь охотятся все игроки. Монстры возрождаются, полубоссы — каждый час, босс — 3 раза в день (12:00, 18:00, 23:00 МСК), следующий в ${hhmm(nextBossAt(Date.now()))}.` });
    }
    tickHall(h, Date.now());
    sendHall(h);
  }
  // Вход в опасный данж: по уровню (с lv[0]−2, не выше maxLv — сильные из старших миров не охотятся на новичков), группой
  function startPk(p, townId) {
    const z = world.byId.get(`pk_${townId}`);
    if (!z) return;
    const dg = z.dg, need = Math.max(1, dg.lv[0] - 2);
    const all = d.partyMembers(p).filter((o) => o.zone === p.zone && !o.dead);
    const bad = all.filter((o) => o.char.level < need || (dg.maxLv && o.char.level > dg.maxLv));
    if (bad.length) {
      const msg = `${dg.name}: уровни ${need}–${dg.maxLv || '∞'} — не подходит: ${bad.map((o) => `${o.name} (${o.char.level} ур.)`).join(', ')}`;
      for (const o of all) o.socket.emit('skillFail', msg);
      return;
    }
    const h = hallOf(z);
    for (const o of all) {
      d.moveToZone(o, z.id);
      o.socket.emit('chat', { sys: true, text: `☠️ ${dg.name}: опасная зона! Опыт ×3, золото и добыча ×6 (в автобое вдвое меньше). Зелья на 70% слабее, у всех синий PvP-щит. Здесь убивают игроков: с мирного выпадает 25% сумки, с розового (напал, 60 с) — половина сумки, надетое у них не падает; с красного (убийца) — вся сумка и 1 надетая вещь; карма отмывается охотой на монстров (без автобоя) или смертью; бьёшь красного — становишься розовым. С пустой сумкой надетое при гибели изнашивается вдвое. Розовым и красным не выйти, пока флаг не спадёт. Группа друг друга не бьёт.` });
    }
    tickHall(h, Date.now());
    sendHall(h);
  }
  // Админка: боссы и полубоссы во всех данжах — сейчас, а не по расписанию (для проверки)
  function summonHallBosses() {
    const now = Date.now();
    let n = 0;
    for (const z of world.zones) {
      if (!z || z.kind !== 'dungeon') continue;
      const h = hallOf(z);
      if (h.boss && !h.boss.id) { h.boss.at = now; h.boss.warned = true; n++; }
      for (const mi of h.minis) if (!mi.id) mi.at = now;
      tickHall(h, now); sendHall(h);
    }
    return n;
  }
  function hallInfo(h) {
    const now = Date.now(), b = h.boss;
    return { name: h.dg.name, hall: true, pk: !!h.dg.pk, online: h.dg.pk ? null : inZone(h.z.id).length, // в опасном данже не видно, сколько там игроков
      minis: h.minis.map((mi) => ({ name: (mi.rank === 'boss' ? '👑 ' : '') + (mi.name || MOBS[mi.type].name), alive: !!mi.id, in: mi.id ? 0 : Math.max(0, mi.at - now) })),
      boss: b ? { name: h.dg.bossName || MOBS[b.type].name, alive: !!b.id, at: b.at, in: b.id ? 0 : Math.max(0, b.at - now) } : null };
  }
  function sendHall(h) { const info = hallInfo(h); for (const p of inZone(h.z.id)) p.socket.emit('dungeon', info); }
  // Награда за полубосса и босса — всем с вкладом от 3% здоровья
  // Порог силы: герой выше 15 уровня (может уйти во второй город) и выше верхнего уровня данжа больше чем на OVER_LV — по боссу и полубоссам этого данжа бьёт ×0,2 и без добычи
  // Герои до FREE_LV уровня — всегда полный урон и награда в любом данже (помогают новичкам с боссами первых данжей)
  const OVER_LV = 5, OVER_DMG = 0.2, FREE_LV = 15;
  const overLevel = (p, h) => !!(h && p.char && p.char.level > Math.max(FREE_LV, h.dg.lv[1] + OVER_LV));
  // Множитель урона героя по монстру (вызывается из боя): 1 — как обычно, OVER_DMG — если герой перерос данж
  const overFor = (p, m) => !!(m.hall && (m.boss || m.mini) && overLevel(p, halls.get(m.hall)));
  function overDmg(p, m) {
    if (!m.hall || !(m.boss || m.mini)) return 1;
    const h = halls.get(m.hall);
    if (!overLevel(p, h)) return 1;
    if (!(p.overWarn ??= {})[m.id]) { p.overWarn[m.id] = 1; p.socket.emit('skillFail', `Вы слишком сильны для этого данжа (ур. ${h.dg.lv[0]}–${h.dg.lv[1]}): урон по боссу ×${OVER_DMG}, добычи не будет`); }
    return OVER_DMG;
  }
  function rewardHallBoss(m) {
    const h = halls.get(m.hall);
    if (!h || !m.contrib) return;
    const boss = m.rank === 'boss';
    for (const p of players.values()) {
      const part = (m.contrib[p.uid] || 0) / m.maxHp, stayed = ((m.present || {})[p.uid] || 0) / 1000;
      // Участник: 1% урона ИЛИ 20 с в комнате во время боя — чтобы сильный игрок не «забирал» босса у пришедших слабых
      if ((part < 0.01 && stayed < 20) || p.zone !== m.zone) continue;
      const pr = d.getProfile(p.uid);
      // Задания (NPC, ежедневные, недельные) засчитываются всегда — даже если герой перерос данж
      d.quest(p.uid, 'dungeon', 1, { zone: m.zone, rank: m.rank });
      if (boss) d.quest(p.uid, 'boss', 1, { zone: m.zone });
      const over = overLevel(p, h); // герой намного сильнее данжа — только малая доля золота, без добычи
      if (over) { const g = Math.round((boss ? 60 : 20) * h.dg.lv[1] * 0.2); pr.gold += g; p.socket.emit('chat', { sys: true, text: `${boss ? '🏆 Босс' : '⭐ Полубосс'} повержен. Вы слишком сильны для этого данжа (ур. ${p.char.level} > ${h.dg.lv[1] + OVER_LV}) — только +${g} 💰, без добычи. Ищите данжи своего уровня.` }); d.markDirty(p); continue; }
      const gold = Math.round((boss ? 60 : 20) * h.dg.lv[1] * (0.6 + Math.min(1, Math.max(part, 0.1) * 3) * 0.4));
      pr.gold += gold;
      d.addPassXp(pr, boss ? 25 : 10);
      pr.dungeonClears = pr.dungeonClears || {};
      const key = `${h.z.town}:${h.z.dgIndex}`;
      const first = boss && !h.dg.pk && !pr.dungeonClears[key];
      if (boss) pr.dungeonClears[key] = (pr.dungeonClears[key] || 0) + 1;
      p.socket.emit('chat', { sys: true, text: `${boss ? '🏆 Босс' : '⭐ Полубосс'} «${m.name || MOBS[m.type].name}» повержен! Ваш вклад ${Math.round(part * 100)}% · +${gold} 💰${first ? ' · первая победа над боссом данжа' : ''}` });
      if (boss) d.giveLoot(p, pr, d.rollItem(h.z.tier, C.DROPS.boss[h.z.tier], null, p.heroId), m);
      if (first) { d.giveLoot(p, pr, d.rollItem(h.z.tier, C.DROPS.boss[h.z.tier], null, p.heroId), p); pr.gems = (pr.gems || 0) + 160; p.socket.emit('chat', { sys: true, text: '💎 Первая победа над боссом данжа: +160 самоцветов' }); }
      d.markDirty(p);
    }
    if (boss && !h.dg.pk) d.broadcast({ ev: 'boss', title: `🏆 ${m.name || MOBS[m.type].name} повержен`, text: `Данж «${h.dg.name}» · следующий босс в ${hhmm(nextBossAt(Date.now() + 60000))}` });
    if (boss && h.dg.pk) tellHall(h, `🏆 Босс «${m.name || MOBS[m.type].name}» повержен — вернётся через ${Math.round(PK_BOSS_RESPAWN / 60000)} мин`);
    setImmediate(() => { tickHall(h, Date.now()); sendHall(h); });
  }

  // ---------- Данж выживания: волны из монстров этого мира ----------
  const survivals = new Map();
  const TOWN_LV = { town1: [1, 15], town2: [15, 30], town3: [30, 45] };
  // ---------- Испытание дня: выживание с особым условием, награда — раз в день по достигнутой волне ----------
  const TRIAL_MODS = {
    swift: { name: 'Стремительные', desc: 'Монстры на 35% быстрее', apply: (m) => { m.speed = Math.round(m.speed * 1.35); } },
    giants: { name: 'Великаны', desc: 'У монстров вдвое больше здоровья, они крупнее и дают больше опыта', apply: (m) => { m.hp = m.maxHp = Math.round(m.maxHp * 2); m.size *= 1.25; m.xp = Math.round(m.xp * 1.5); } },
    glass: { name: 'Стеклянные пушки', desc: 'Монстры бьют на 60% сильнее, но здоровья у них на 40% меньше', apply: (m) => { m.dmg = Math.round(m.dmg * 1.6); m.hp = m.maxHp = Math.round(m.maxHp * 0.6); } },
    horde: { name: 'Орда', desc: 'Монстров в каждой волне в полтора раза больше', apply: () => {} },
    fury: { name: 'Ярость', desc: 'Монстры атакуют на 30% чаще', apply: (m) => { m.cd = Math.round(m.cd * 0.7); } },
  };
  const mskDayT = () => new Date(Date.now() + 3 * 36e5).toISOString().slice(0, 10);
  const trialMod = () => { const k = Object.keys(TRIAL_MODS), day = Math.floor((Date.now() + 3 * 36e5) / 864e5); return k[day % k.length]; };
  const trialTop = { day: '', list: [] }; // лучшие волны сегодня
  function trialInfo(pr) {
    const k = trialMod(), M = TRIAL_MODS[k];
    if (trialTop.day !== mskDayT()) { trialTop.day = mskDayT(); trialTop.list = []; }
    return { mod: k, name: M.name, desc: M.desc, done: pr.trialDay === mskDayT(), best: pr.trialDay === mskDayT() ? pr.trialWave || 0 : 0, top: trialTop.list.slice(0, 10) };
  }
  function rewardTrial(s, uid) {
    const pr = d.getProfile(uid), day = mskDayT();
    if (pr.trialDay === day) return; // награда — раз в день
    const w = Math.max(0, s.wave - 1); // пройдено волн
    if (!w) { d.notifyUid(uid, '🏅 Испытание дня: ни одной волны не пройдено — попытка не засчитана, можно попробовать ещё раз'); return; }
    pr.trialDay = day; pr.trialWave = w;
    const gems = Math.min(150, w * 6), dust = Math.floor(w / 4), crystal = w >= 20 ? 1 : 0;
    pr.gems = (pr.gems || 0) + gems;
    if (dust) I.addMat(pr, 'dust', dust);
    if (crystal) I.addMat(pr, 'skillCrystal', crystal);
    if (trialTop.day !== day) { trialTop.day = day; trialTop.list = []; }
    trialTop.list.push({ name: pr.name || 'Герой', wave: w }); trialTop.list.sort((a, b) => b.wave - a.wave); trialTop.list.length = Math.min(trialTop.list.length, 20);
    d.notifyUid(uid, `🏅 Испытание дня: пройдено волн — ${w}. Награда: 💎 ${gems}${dust ? ` · ✨ волшебная пыль ×${dust}` : ''}${crystal ? ' · 💠 кристалл мастерства' : ''}. Новое испытание — завтра`);
  }
  function startSurvival(p, trial = false) {
    const town = world.byId.get(p.zone);
    if (trial && d.getProfile(p.uid).trialDay === mskDayT()) return p.socket.emit('skillFail', 'Испытание дня уже пройдено — новое завтра');
    const z = world.addSurvival(town.id);
    // Обычное выживание — 3 захода в день на героя (испытание дня — отдельно, раз в день)
    const SURV_DAY = 3, runsOf = (o) => { const pr = d.getProfile(o.uid); if (pr.survDay !== mskDayT()) { pr.survDay = mskDayT(); pr.survRuns = 0; } return pr.survRuns || 0; };
    if (!trial && runsOf(p) >= SURV_DAY) return p.socket.emit('skillFail', `Данж выживания — ${SURV_DAY} раза в день, новые попытки завтра`);
    if (p.autofarm) return p.socket.emit('skillFail', 'Выключите автобой — в выживании он не работает');
    const group = d.partyMembers(p).filter((o) => o.zone === p.zone && !o.dead && !o.autofarm && (trial ? d.getProfile(o.uid).trialDay !== mskDayT() : runsOf(o) < SURV_DAY));
    if (!trial) for (const o of group) d.getProfile(o.uid).survRuns = runsOf(o) + 1;
    const avgLv = Math.round(group.reduce((s, o) => s + o.char.level, 0) / group.length);
    const mod = trial ? trialMod() : null;
    survivals.set(z.id, { z, wave: 0, nextAt: Date.now() + 4000, cleared: true, lv: Math.max(TOWN_LV[town.id][0], Math.min(TOWN_LV[town.id][1], avgLv)), mod, members: group.map((o) => o.uid), rewarded: new Set() });
    for (const o of group) {
      d.moveToZone(o, z.id);
      o.socket.emit('chat', { sys: true, text: mod ? `🏅 Испытание дня «${TRIAL_MODS[mod].name}»: ${TRIAL_MODS[mod].desc}. Держитесь как можно дольше — награда по числу волн! Первая волна через 4 с`
        : `Данж выживания${group.length > 1 ? ` (группа: ${group.length})` : ''}: держитесь как можно дольше! Первая волна через 4 с` });
    }
  }
  function spawnWave(s, inside) {
    const z = s.z, w = s.wave, dgs = X.DUNGEONS[z.town];
    const lv = s.lv + Math.floor(w / 2);
    const tierIdx = Math.min(dgs.length - 1, Math.floor((w - 1) / 2));
    const pool = dgs.slice(0, tierIdx + 1).flatMap((dg) => dg.pool);
    const n = Math.min(s.mod === 'horde' ? 36 : 26, Math.round((3 + w * 1.5) * (1 + 0.35 * (inside - 1)) * (s.mod === 'horde' ? 1.5 : 1)));
    const mod = s.mod && TRIAL_MODS[s.mod];
    const c = z.abs(15, 15);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3, r = 10.5 * C.TILE;
      const rank = w >= 3 && Math.random() < 0.15 ? 'magic' : 'normal';
      const m = create(z, pool[Math.floor(Math.random() * pool.length)], { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }, lv, { rank, aggro: 2000, lootMult: 0.25 });
      if (mod) mod.apply(m);
    }
    if (w % 5 === 0) {
      const dg = dgs[Math.min(dgs.length - 1, w / 5 - 1)];
      const big = w % 10 === 0 ? dg.boss : dg.minis[0];
      const bm = create(z, big, { x: c.x, y: c.y - 9 * C.TILE }, lv + 1, { rank: w % 10 === 0 ? 'boss' : 'mini', aggro: 2000, hpMult: (1 + 0.5 * (inside - 1)) * (w % 10 === 0 ? 1500 / 450 : 1) }); // босс выживания — прежней силы (боссы данжей ослаблены в mobs.js)
      if (mod) mod.apply(bm);
    }
  }
  function rewardWave(s, inside) {
    const z = s.z;
    for (const o of inside) {
      if (o.dead) continue;
      const pr = d.getProfile(o.uid);
      // Новый баланс: золото волны — как с монстров (×0,25), вещь — 10% за волну, на каждой 10-й — гарантированно и как с босса
      const gold = Math.round(8 * s.wave * (s.lv + 4) * (X.bal2() ? 0.25 : 1));
      pr.gold += gold;
      d.addPassXp(pr, 5);
      pr.survivalBest = Math.max(pr.survivalBest || 0, s.wave);
      d.quest(o.uid, 'survival', s.wave, { town: s.z.town });
      o.socket.emit('chat', { sys: true, text: `Волна ${s.wave} пройдена! +${gold} 💰 · рекорд: ${pr.survivalBest}` });
      if (s.wave % 10 === 0 || Math.random() < 0.1) d.giveLoot(o, pr, d.rollItem(z.tier, s.wave % 10 === 0 ? C.DROPS.boss[z.tier] : C.DROPS.weights[z.tier], null, o.heroId), o);
      d.markDirty(o);
    }
  }

  // ---------- Мировые боссы ----------
  // Мировые боссы — раз в день, вечером: в WB_TIME по Москве (по умолчанию 21:00). Не победили за WB_STAY — уходят до завтра
  const WB_TIME = String(process.env.WB_TIME || '21:00').split(':').map(Number);
  const WB_STAY = 3 * 3600e3, WB_WARN = 15 * 60e3;
  function nextWbAt(t) {
    const msk = new Date(t + 3 * 36e5);
    let at = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate(), WB_TIME[0] || 0, WB_TIME[1] || 0) - 3 * 36e5;
    if (at <= t) at += 864e5;
    return at;
  }
  const wbTimeText = () => `${String(WB_TIME[0] || 0).padStart(2, '0')}:${String(WB_TIME[1] || 0).padStart(2, '0')}`;
  let wbWarnedFor = 0;
  const wbState = {};
  for (const [town, cfg] of Object.entries(X.WORLD_BOSSES)) wbState[town] = { cfg, idx: 0, bossId: null, nextAt: process.env.WB_FIRST_MS ? Date.now() + Number(process.env.WB_FIRST_MS) : nextWbAt(Date.now()) };
  function spawnWorldBoss(town, now) {
    const st = wbState[town], z = world.byId.get(`wb_${town}`);
    const type = st.cfg.list[st.idx++ % st.cfg.list.length];
    const n = Math.max(1, inZone(z.id).length);
    const m = create(z, type, z.abs(20, 17), st.cfg.lv, { rank: 'world', hpMult: wbHpMult(n), aggro: 900 });
    m.wbPhase = 0; m.markAt = Date.now() + 20000;
    m.scaledFor = n;
    st.bossId = m.id; st.spawnAt = Date.now(); st.warned = false;
    d.broadcast({ ev: 'boss', title: `👹 Мировой босс: ${MOBS[type].name}`, text: `${world.byId.get(town).name} · портал на юге города · ${Math.round(WB_STAY / 3600e3)} ч на победу, награда — всем на почту` });
    if (d.push) d.push('wb', `👹 Мировой босс «${MOBS[type].name}» появился в мире ${world.byId.get(town).name}! Нужна команда — заходите.`, (pr) => d.maxHeroLevel(pr) >= st.cfg.lv - 5);
  }
  // Здоровье мирового босса: рассчитано на 10 героев своего уровня; больше 10 — ещё +8% за каждого
  // Здоровье мирового босса по числу героев в логове: на 10 — полное, меньше — пропорционально (не меньше 20%),
  // больше 10 — +8% за каждого. Растёт, когда приходят новые, и не падает, когда уходят (иначе можно схитрить)
  const wbHpMult = (n) => (n <= 10 ? Math.max(0.2, n / 10) : 1 + 0.08 * (n - 10));
  // Босс данжа рассчитан на 4–5 героев: один — 25%, двое — 44%, трое — 67%, четверо — 89%, пятеро — 100%, дальше +10% за каждого
  const bossHpMult = (n) => (n <= 5 ? Math.min(1, Math.max(0.25, n / 4.5)) : 1 + 0.1 * (n - 5));
  const WB_PHASES = [0.75, 0.5, 0.25];
  const zmsg = (zid, text) => { for (const o of inZone(zid)) o.socket.emit('chat', { sys: true, text }); };
  const secLeft = (t, now) => Math.max(0, Math.ceil((t - now) / 1000));
  const adds = (b) => [...monsters.values()].filter((o) => o.wbOf === b.id);
  // Объекты задания вокруг центра логова (кристаллы, знамёна, щупальца, яйца, разломы): стоят на месте
  function spawnObjs(b, type, n, hpFrac, rx = 190, ry = 130) {
    const z = world.byId.get(b.zone), c = z.abs(20, 17), out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / 4;
      const o = create(z, type, { x: c.x + Math.cos(a) * rx, y: c.y + Math.sin(a) * ry }, b.level, { rank: 'normal', lootMult: 0 });
      o.hp = o.maxHp = Math.round(b.maxHp * hpFrac); o.wbOf = b.id; o.still = true; o.xp = 1;
      out.push(o);
    }
    return out;
  }
  // Задание выполнено: босс оглушён и уязвим
  function taskDone(b, now, text) {
    b.wbTask = null; b.wbShield = false; b.wbImmune = false; b.still = false; b.vulnUntil = now + 10000; b.stunUntil = now + 3000;
    zmsg(b.zone, text || '✨ Задание выполнено! Босс оглушён и 10 секунд получает +50% урона — бейте!');
  }
  // Задание провалено: босс лечится и бьёт всех
  function taskFail(b, now, heal, mult, text) {
    b.wbTask = null; b.wbShield = false; b.wbImmune = false; b.still = false;
    for (const o of adds(b)) monsters.delete(o.id);
    b.hp = Math.min(b.maxHp, b.hp + b.maxHp * heal);
    fx({ t: 'teleHit', x: b.x, y: b.y, r: 600, color: 0xff5a3a });
    for (const p of inZone(b.zone)) if (!p.dead) hit(b, p, mult, now);
    zmsg(b.zone, text);
  }
  // Свои задания у каждого мирового босса (фазы на 75/50/25% здоровья) + общие: метка смерти и ярость
  const WB_TASKS = {
    // Проклятый легион: знамёна поднимают мертвецов и защищают легион
    legion: {
      start(b, now) {
        spawnObjs(b, 'wbBanner', 3, 0.025);
        b.wbShield = true; b.wbTask = { kind: 'banners', end: now + 35000, raiseAt: now + 6000 };
        zmsg(b.zone, '🚩 Легион поднял 3 знамени: урон по нему −90%, каждые 6 с из знамён встают скелеты. Сломайте знамёна за 35 секунд!');
      },
      tick(b, now, t) {
        const left = adds(b).filter((o) => o.type === 'wbBanner');
        if (!left.length) return taskDone(b, now, '🚩 Знамёна пали! Легион оглушён и 10 секунд получает +50% урона!');
        if (now >= t.raiseAt) {
          t.raiseAt = now + 6000;
          const z = world.byId.get(b.zone);
          for (const o of left) if ([...monsters.values()].filter((m) => m.zone === b.zone && m.type === 'skeletonSword').length < 12) {
            const sk = create(z, 'skeletonSword', { x: o.x + 20, y: o.y + 20 }, b.level, { rank: 'magic', lootMult: 0 }); sk.target = null;
          }
        }
        if (now >= t.end) return taskFail(b, now, 0.05 * left.length, 1.5 * left.length, `💥 Знамёна устояли (${left.length}): легион восстановил ${5 * left.length}% здоровья и ударил всех`);
        b.taskText = `🚩 Знамёна: осталось ${left.length} из 3 · ${secLeft(t.end, now)} с`;
      },
    },
    // Пожиратель миров: щупальца кормят его здоровьем, воронка затягивает героев к пасти
    devourer: {
      start(b, now) {
        spawnObjs(b, 'wbTentacle', 4, 0.02, 210, 140);
        b.wbTask = { kind: 'tentacles', end: now + 40000, healAt: now + 1000 };
        zmsg(b.zone, '🦑 Из глубин поднялись 4 щупальца: каждое кормит Пожирателя здоровьем. Отрубите их за 40 секунд!');
      },
      tick(b, now, t) {
        const left = adds(b).filter((o) => o.type === 'wbTentacle');
        if (!left.length) return taskDone(b, now, '🦑 Щупальца отрублены! Пожиратель оглушён и 10 секунд получает +50% урона!');
        if (now >= t.healAt) { t.healAt = now + 1000; b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.004 * left.length); }
        if (now >= t.end) return taskFail(b, now, 0.03 * left.length, 1.5 * left.length, `💥 Щупальца утащили добычу (${left.length}): Пожиратель восстановил силы и ударил всех`);
        b.taskText = `🦑 Щупальца: ${left.length} из 4 лечат босса · ${secLeft(t.end, now)} с`;
      },
      // Голодная воронка: всех тянет к пасти, через 2,5 с — удар вокруг босса (надо выбежать)
      extra(b, now) {
        if (now < (b.vortexAt ??= now + 25000)) return;
        b.vortexAt = now + 25000;
        for (const p of inZone(b.zone)) {
          if (p.dead) continue;
          const dx = b.x - p.x, dy = b.y - p.y, dd = Math.hypot(dx, dy) || 1, k = Math.min(0.6, Math.max(0, (dd - 90) / dd));
          const nx = p.x + dx * k, ny = p.y + dy * k;
          if (!world.isSolidAt(nx, ny)) { p.x = nx; p.y = ny; p.socket.emit('correct', { x: p.x, y: p.y }); }
        }
        telegraph(b, b.x, b.y, 210, 2500, 0x8a2a5a, (p) => hit(b, p, 3, Date.now()), 'Голодная воронка');
        zmsg(b.zone, '🌀 Пожиратель затягивает всех к пасти — выбегайте из круга!');
      },
    },
    // Аватар бездны: печати — четверо героев должны одновременно стоять на всех 4 печатях
    abyssAvatar: {
      start(b, now) {
        const z = world.byId.get(b.zone), c = z.abs(20, 17);
        const seals = [0, 1, 2, 3].map((i) => { const a = i * Math.PI / 2 + Math.PI / 4; return { x: c.x + Math.cos(a) * 200, y: c.y + Math.sin(a) * 140 }; });
        for (const sl of seals) fx({ t: 'tele', from: b.id, x: sl.x, y: sl.y, r: 45, ms: 30000, color: 0xb06aff, label: 'Печать' });
        b.wbShield = true; b.wbTask = { kind: 'seals', end: now + 30000, seals, held: 0, last: now };
        zmsg(b.zone, '🔮 Аватар закрылся щитом Бездны (урон −90%)! Встаньте одновременно на все 4 печати и продержитесь 3 секунды — за 30 секунд');
      },
      tick(b, now, t) {
        const alive = inZone(b.zone).filter((p) => !p.dead);
        const on = t.seals.filter((sl) => alive.some((p) => Math.hypot(p.x - sl.x, p.y - sl.y) <= 50)).length;
        const dt = now - t.last; t.last = now;
        t.held = on === 4 ? t.held + dt : Math.max(0, t.held - dt / 2);
        if (t.held >= 3000) return taskDone(b, now, '🔮 Печати замкнуты! Щит Бездны разбит — Аватар оглушён и 10 секунд получает +50% урона!');
        if (now >= t.end) return taskFail(b, now, 0.1, 3, '💥 Печати не удержаны: Бездна вырвалась — Аватар восстановил 10% здоровья и ударил всех');
        b.taskText = `🔮 Печати: занято ${on} из 4 · удержание ${(t.held / 1000).toFixed(1)}/3 с · ${secLeft(t.end, now)} с`;
      },
    },
    // Вечный дракон: взлетает (неуязвим), огненный дождь, яйца — если не разбить, вылупятся драконы
    eternalDragon: {
      start(b, now) {
        spawnObjs(b, 'wbEgg', 5, 0.012, 200, 140);
        b.wbImmune = true; b.still = true; b.wbAir = true;
        b.wbTask = { kind: 'flight', end: now + 22000, rainAt: now + 1500 };
        zmsg(b.zone, '🐉 Вечный дракон взлетел — его не достать! Уворачивайтесь от огненного дождя и разбейте 5 яиц, пока он не приземлился (22 с)');
      },
      tick(b, now, t) {
        const left = adds(b).filter((o) => o.type === 'wbEgg');
        if (now >= t.rainAt) {
          t.rainAt = now + 1300;
          const alive = inZone(b.zone).filter((p) => !p.dead);
          for (let i = 0; i < Math.min(3, alive.length); i++) {
            const p = alive[Math.floor(Math.random() * alive.length)];
            telegraph(b, p.x, p.y, 85, 1400, 0xff7a2a, (o) => hit(b, o, 1.8, Date.now()), 'Огненный дождь');
          }
        }
        if (now < t.end) { b.taskText = `🥚 Яйца: осталось ${left.length} из 5 · дракон приземлится через ${secLeft(t.end, now)} с`; return; }
        b.wbAir = false;
        if (!left.length) return taskDone(b, now, '🐉 Дракон приземлился, а кладка уничтожена! Он оглушён и 10 секунд получает +50% урона!');
        const z = world.byId.get(b.zone);
        for (const o of left) { monsters.delete(o.id); create(z, 'dragonWhelp', { x: o.x, y: o.y }, b.level, { rank: 'mini', lootMult: 0, hpMult: 0.6 }); }
        b.wbTask = null; b.wbImmune = false; b.still = false;
        zmsg(b.zone, `🐲 Из яиц вылупились драконы (${left.length})! Дракон приземлился — бейте его`);
      },
    },
    // Титан хаоса: разломы с каждой секундой делают его сильнее и бьют тех, кто рядом
    chaosTitan: {
      start(b, now) {
        spawnObjs(b, 'wbRift', 3, 0.03, 200, 140);
        b.wbTask = { kind: 'rifts', end: now + 30000, stackAt: now + 5000, pulseAt: now + 4000, baseDmg: b.dmg, stacks: 0 };
        zmsg(b.zone, '🌌 Открылись 3 разлома хаоса: каждые 5 с Титан сильнее на 15%, разломы бьют всех рядом. Закройте их за 30 секунд!');
      },
      tick(b, now, t) {
        const left = adds(b).filter((o) => o.type === 'wbRift');
        const reset = () => { b.dmg = t.baseDmg; };
        if (!left.length) { reset(); return taskDone(b, now, '🌌 Разломы закрыты! Титан оглушён и 10 секунд получает +50% урона!'); }
        if (now >= t.stackAt) { t.stackAt = now + 5000; t.stacks++; b.dmg = Math.round(t.baseDmg * (1 + 0.15 * t.stacks)); }
        if (now >= t.pulseAt) {
          t.pulseAt = now + 4000;
          for (const o of left) for (const p of inZone(b.zone)) if (!p.dead && Math.hypot(p.x - o.x, p.y - o.y) <= 110) hit(b, p, 0.8, now);
          for (const o of left) fx({ t: 'teleHit', x: o.x, y: o.y, r: 110, color: 0xff6ad8 });
        }
        if (now >= t.end) { reset(); return taskFail(b, now, 0.05, 3, `💥 Коллапс хаоса! Разломы (${left.length}) взорвались — Титан восстановил 5% здоровья и ударил всех`); }
        b.taskText = `🌌 Разломы: ${left.length} из 3 · сила Титана +${15 * t.stacks}% · ${secLeft(t.end, now)} с`;
      },
    },
  };
  function wbMechanics(b, now) {
    const T = WB_TASKS[b.type], frac = b.hp / b.maxHp;
    if (!T) return;
    b.taskText = '';
    if (!b.wbTask && b.wbPhase < WB_PHASES.length && frac <= WB_PHASES[b.wbPhase]) { b.wbPhase++; T.start(b, now); }
    if (b.wbTask) T.tick(b, now, b.wbTask);
    if (T.extra) T.extra(b, now);
    // Метка смерти: под случайным героем через 4 с взрыв — он должен отбежать от группы
    if (now >= b.markAt) {
      b.markAt = now + 18000 + Math.random() * 6000;
      const alive = inZone(b.zone).filter((p) => !p.dead);
      const t = alive[Math.floor(Math.random() * alive.length)];
      if (t) {
        telegraph(b, t.x, t.y, 130, 4000, 0xff3a3a, (p) => hit(b, p, 3.5, Date.now()), 'Метка смерти');
        t.deathMarkUntil = now + 4000; d.markDirty(t); // значок над героем — все видят, от кого отбегать
        t.socket.emit('chat', { sys: true, text: '☠️ На вас метка смерти! Отбегите от союзников — через 4 секунды взрыв' });
      }
    }
    if (!b.enraged && frac <= 0.2) { b.enraged = true; b.cd = Math.round(b.cd * 0.7); b.dmg = Math.round(b.dmg * 1.25); zmsg(b.zone, `🔥 ${MOBS[b.type].name} в ярости: бьёт чаще и сильнее!`); }
  }
  function rewardWorldBoss(m) {
    const town = world.byId.get(m.zone)?.town;
    const st = wbState[town];
    if (st) { st.bossId = null; st.nextAt = nextWbAt(Date.now() + 60000); }
    const total = Object.values(m.contrib).reduce((s, v) => s + v, 0) || 1;
    // Топ-10 по урону: редкие ресурсы (ядра мира, свитки грандмастера/легенды, камень удачи)
    const top = Object.entries(m.contrib).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([uid]) => uid);
    const core = `core${m.tier}`;
    const TOP_MATS = (place) => (place === 1 ? { [core]: 4, scrollM: 1, luckStone: 2, dust: 12, skillCrystal: 2 } : place <= 3 ? { [core]: 3, scrollL: 1, luckStone: 1, dust: 8, skillCrystal: 1 } : { [core]: 2, scrollL: place <= 5 ? 1 : 0, luckStone: 1, dust: 4 });
    for (const uid of Object.keys(m.contrib)) if (d.quest) d.quest(uid, 'worldPart', 1, { town }); // участие — для заданий у NPC
    // Рейтинг недели «Мировые боссы»: урон всех участников (server/index.js → рейтинги)
    if (d.wbWeek) for (const [uid, dmg] of Object.entries(m.contrib)) d.wbWeek(uid, dmg);
    // Награды — письмом на почту (меню → Почта → «Забрать»): видно, что и за что получено, ничего не теряется в чате,
    // и награду получают все участники с вкладом от 1%, даже если уже вышли из логова или из игры
    const bossName = MOBS[m.type].name;
    for (const [uid, dmg] of Object.entries(m.contrib)) {
      const part = dmg / m.maxHp;
      if (part < 0.01 || !/^(tg|guest)/.test(uid)) continue;
      const pr = d.getProfile(uid), p = [...players.values()].find((o) => o.uid === uid) || null;
      const heroId = p ? p.heroId : (pr.heroes || [])[0];
      const place = top.indexOf(uid) + 1, share = Math.round((dmg / total) * 100);
      const gold = Math.round(400 * m.tier * (0.5 + Math.min(1, part * 4)));
      const items = [];
      for (let i = 0; i < 2 + (part > 0.15 ? 1 : 0); i++) items.push(d.rollItem(m.tier, C.DROPS.boss[m.tier], null, heroId));
      // 3% — легендарная сумка, из них каждая 6-я — мифическая «Бездонная сума»
      if (d.createBag && Math.random() < 0.03) items.push(d.createBag(Math.random() < 0.15 ? 'mythic' : 'legendary', m.tier));
      const mats = {};
      const addM = (o) => { for (const [k, n] of Object.entries(o || {})) if (n > 0 && I.MATS[k]) mats[k] = (mats[k] || 0) + n; };
      addM(d.rollMats({ rank: 'world' }, m.tier, null).mats); // материалы, свитки и чертёж
      if (place) addM(TOP_MATS(place));
      d.addPassXp(pr, 40);
      if (p && d.companionDrop) { d.companionDrop(p, 0.01); d.companionDrop(p, 0.002, true); } // спутник — сразу (обычный 1%, редкий 0,2%)
      const lines = [`Ваш вклад: ${share}% урона${place ? ` · ${place} место${place <= 3 ? ' ' + ['🥇', '🥈', '🥉'][place - 1] : ''}` : ''}.`,
        place ? `За место в топ-10 — редкие ресурсы (ядра мира, свитки, камни удачи).` : 'Попадите в топ-10 по урону — получите ещё и редкие ресурсы.',
        'Заберите награду кнопкой «Забрать».'];
      if (d.mail) d.mail(uid, { fromName: `👹 ${bossName}`, title: `Награда за мирового босса`, text: lines.join('\n'), items, mats, gold });
      if (p) { p.socket.emit('chat', { sys: true, ev: 'mail', text: `📬 Награда за «${bossName}» — на почте: ${gold} 💰, ${items.length} вещи и ресурсы${place ? ` · ${place} место по урону` : ''}. Меню → Почта` }); d.markDirty(p); }
      else d.notifyUid(uid, `📬 Мировой босс «${bossName}» повержен — ваша награда ждёт на почте (${share}% урона)`);
    }
    d.broadcast({ ev: 'boss', title: `👹 ${MOBS[m.type].name} повержен!`, text: `${top.length ? top.slice(0, 3).map((uid, i) => `${['🥇', '🥈', '🥉'][i]} ${d.getProfile(uid).name || 'Герой'}`).join(' · ') + ' · ' : ''}награды — на почте у всех участников · следующий завтра в ${wbTimeText()} МСК` });
  }
  function worldBossInfo(town) {
    const st = wbState[town];
    if (!st) return null;
    const b = st.bossId ? monsters.get(st.bossId) : null;
    const left = st.nextAt - Date.now();
    return b ? `👹 ${MOBS[b.type].name} здесь! Здоровье ${Math.round((b.hp / b.maxHp) * 100)}%` : left < 3600e3 ? `👹 Мировой босс появится через ${Math.max(1, Math.round(left / 60000))} мин` : `👹 Мировой босс — каждый день в ${wbTimeText()} МСК`;
  }

  // Периодические задачи: копии данжей, волны, мировые боссы
  setInterval(() => {
    const now = Date.now();
    for (const z of world.zones) if (z && z.kind === 'dungeon') {
      const h = hallOf(z);
      tickHall(h, now);
      if ((h.sentAt || 0) + 5000 < now && inZone(z.id).length) { h.sentAt = now; sendHall(h); }
    }
    for (const [id, s] of survivals) {
      const inside = inZone(id);
      // Испытание дня: кто выбыл (погиб или вышел) — получает награду по достигнутой волне
      if (s.mod) for (const uid of s.members) if (!s.rewarded.has(uid) && !inside.some((o) => o.uid === uid)) { s.rewarded.add(uid); rewardTrial(s, uid); }
      if (!inside.length) {
        for (const m of monsters.values()) if (m.zone === id) monsters.delete(m.id);
        survivals.delete(id); world.removeZone(s.z); continue;
      }
      if ([...monsters.values()].some((m) => m.zone === id)) continue;
      if (!s.cleared) { s.cleared = true; s.nextAt = now + 4000; rewardWave(s, inside); }
      if (now < s.nextAt) continue;
      s.wave++; s.cleared = false;
      spawnWave(s, inside.length);
      for (const o of inside) o.socket.emit('survival', { wave: s.wave, boss: s.wave % 5 === 0 });
    }
    for (const [town, st] of Object.entries(wbState)) {
      const b = st.bossId ? monsters.get(st.bossId) : null;
      if (st.bossId && !b) { for (const o of monsters.values()) if (o.wbOf === st.bossId) monsters.delete(o.id); st.bossId = null; st.homeAt = now + 15000; } // босс повержен — через 15 с всех вернём в город
      if (!st.bossId && now >= (st.homeAt || 0)) {
        for (const o of inZone(`wb_${town}`)) { if (!o.dead) { d.moveToZone(o, town); o.socket.emit('chat', { sys: true, text: '🏰 Логово опустело — вы вернулись в город' }); } }
      }
      // Не победили за WB_STAY — босс уходит до следующего вечера
      if (b && st.spawnAt && now - st.spawnAt > WB_STAY) {
        for (const o of monsters.values()) if (o.wbOf === b.id) monsters.delete(o.id);
        monsters.delete(b.id); st.bossId = null; st.nextAt = nextWbAt(now); st.homeAt = now + 15000;
        d.broadcast({ ev: 'boss', title: `👹 ${MOBS[b.type].name} ушёл`, text: `${world.byId.get(town).name} · не успели победить · вернётся завтра в ${wbTimeText()} МСК` });
      }
      // Предупреждение за 15 минут (одно на все миры)
      if (!st.bossId && !st.warned && st.nextAt - now <= WB_WARN && st.nextAt > now) {
        st.warned = true;
        if (wbWarnedFor !== st.nextAt) { wbWarnedFor = st.nextAt; d.broadcast({ ev: 'boss', title: `👹 Мировые боссы — в ${wbTimeText()} МСК`, text: `Через ${Math.max(1, Math.round((st.nextAt - now) / 60000))} мин во всех мирах · порталы на юге городов · собирайте команду` }); }
      }
      if (!st.bossId && now >= st.nextAt) spawnWorldBoss(town, now);
      // Рейтинг урона — каждому в логове раз в секунду
      if (b && now - (st.rankAt || 0) > 1000) {
        st.rankAt = now;
        const list = Object.entries(b.contrib || {}).sort((x, y) => y[1] - x[1]);
        const tot = list.reduce((s2, [, v]) => s2 + v, 0) || 1;
        const top = list.slice(0, 10).map(([uid, v]) => ({ uid, name: d.getProfile(uid).name || 'Герой', dmg: Math.round(v), pct: Math.round(v / tot * 100) }));
        for (const o of inZone(b.zone)) {
          const i = list.findIndex(([uid]) => uid === o.uid);
          o.socket.emit('wbRank', { boss: MOBS[b.type].name, hp: Math.round(b.hp / b.maxHp * 100), top: top.map((t) => ({ ...t, me: t.uid === o.uid, uid: undefined })), me: i >= 0 ? { place: i + 1, dmg: Math.round(list[i][1]), pct: Math.round(list[i][1] / tot * 100) } : null, task: b.taskText || '' });
        }
      }
      // Здоровье мирового босса растёт, когда в логово приходят новые герои
      if (b) {
        const n = Math.max(1, inZone(b.zone).length);
        if (n > b.scaledFor) { const k = wbHpMult(n) / wbHpMult(b.scaledFor); b.maxHp = Math.round(b.maxHp * k); b.hp = Math.round(b.hp * k); b.scaledFor = n; }
        wbMechanics(b, now);
      }
    }
  }, 500);

  return {
    create, act, melee, meleeRange, canAggro, inLeash, curSpeed, takenMult, onHurt, preventDeath, onKilled, onMonsterHp,
    groupNear, startDungeon, startPk, startSurvival, trialInfo, summonHallBosses, worldBossInfo, ccActive, ccPlayer, tickPlayer, halls, hallInfo, survivals, wbState, overDmg, overFor, OVER_LV, nextWbAt, wbTimeText,
  };
};
