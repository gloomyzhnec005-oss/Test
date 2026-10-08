// Монстры в бою: создание по уровню и рангу, умения (рывки, выстрелы, телеграфируемые удары по площади,
// призыв, ауры, лечение, воскрешение, контроль героев), прохождение данжей-лабиринтов, данж выживания и мировые боссы.
const X = require('./mobs');
const { MOBS, AFFIXES, TURN } = X;

module.exports = function createDungeons(d) {
  const { C, world, monsters, players, pets } = d;
  const fx = (f) => d.pushFx(f);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const inZone = (zid) => [...players.values()].filter((p) => p.zone === zid);
  let seq = 1e6;

  // ---------- Создание монстра ----------
  function create(z, type, pos, level, opts = {}) {
    const def = MOBS[type];
    const rank = opts.rank || def.rank;
    const affixes = opts.affixes || [];
    const st = X.statsAt(def, level, rank, affixes);
    const hp = Math.round(st.hp * (opts.hpMult || 1));
    const m = {
      id: seq++, type, x: pos.x, y: pos.y, homeX: pos.x, homeY: pos.y, zone: z.id, tier: z.tier, level, rank, affixes,
      hp, maxHp: hp, dmg: st.dmg, cd: st.cd, speed: st.speed, xp: st.xp, range: def.range || 0,
      aggro: opts.aggro || (rank === 'boss' || rank === 'world' ? 340 : 250), size: (def.look && def.look.sz || 1) * X.RANK[rank].size,
      target: null, lastAttack: 0, abAt: Date.now() + 1500 + Math.random() * ((def.ab && def.ab.cd) || 4000),
      undead: !!def.undead, boss: rank === 'boss' || rank === 'world', mini: rank === 'mini',
      wander: null, nextWander: 0, stunUntil: 0, rootUntil: 0, dots: [], summons: 0,
      noclip: !!def.noclip, name: opts.name || null, extra: !!opts.extra, lootMult: opts.lootMult ?? 1, owner: opts.owner || null,
      inv: !!def.stealth, contrib: rank === 'world' ? {} : null,
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
    fx({ t: 'mshot', fx: m.x, fy: m.y - 8, x: tx, y: ty, ms, proj: o.proj || def.proj || 'arrow' });
    setTimeout(() => {
      if (!monsters.has(m.id) || target.dead || target.zone && target.zone !== m.zone) return;
      if (!world.lineOfSight(m.x, m.y, target.x, target.y)) { fx({ t: 'miss', x: target.x, y: target.y }); return; } // спрятался за стеной
      if (!(def.sure || o.sure) && Math.hypot(target.x - tx, target.y - ty) > 30) { fx({ t: 'miss', x: tx, y: ty }); return; }
      hit(m, target, mult, Date.now(), o);
    }, ms);
  }
  // Удар по площади с предупреждением: круг на земле, через delay — урон всем героям внутри
  function telegraph(m, x, y, r, delay, color, onHit, label) {
    fx({ t: 'tele', x, y, r, ms: delay, color, label });
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
    fx({ t: 'msum', x: m.x, y: m.y, n: k });
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
    fx({ t: 'msum', x: m.x, y: m.y, n: def.legion.n });
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
        if (ab.knock && !t.owner) d.knockPlayer(t, t.x - m.x, t.y - m.y, ab.knock);
        return true;
      }
      case 'stunHit': case 'critHit':
        if (dd > 60 + m.size * 10) return false;
        fx({ t: 'mtext', x: m.x, y: m.y, text: name, color: '#ffb060' });
        hit(m, t, ab.mult, now, ab.type === 'stunHit' ? { cc: 'stun', ms: ab.ms } : { crit: true });
        return true;
      case 'spin':
        if (dd > ab.r) return false;
        fx({ t: 'teleHit', x: m.x, y: m.y, r: ab.r, color: 0xece6cc });
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
        fx({ t: 'mtext', x: m.x, y: m.y, text: name, color: '#ffe08a' });
        for (let i = 0; i < ab.n; i++) setTimeout(() => { if (!monsters.has(m.id) || t.dead) return; if (m.range) shoot(m, t, ab.mult, Date.now()); else if (dist(m, t) < 70 + m.size * 10) hit(m, t, ab.mult, Date.now()); }, i * 220);
        if (ab.retreat) { const k = ab.retreat / (dd || 1); d.moveEntity(m, (m.x - t.x) * k, (m.y - t.y) * k); }
        return true;
      }
      case 'trap': case 'ccShot': case 'curse': {
        if (dd > (ab.range || m.range || 200)) return false;
        const o = ab.type === 'curse' ? { curse: ab.ms } : { cc: ab.type === 'ccShot' ? ab.cc : 'root', ms: ab.ms };
        fx({ t: 'mtext', x: m.x, y: m.y, text: name, color: '#c8b0ff' });
        shoot(m, t, ab.type === 'curse' ? 0.6 : 0.8, now, { ...o, proj: ab.web ? 'web' : ab.type === 'trap' ? 'trap' : def.proj });
        if (ab.heal) { m.hp = Math.min(m.maxHp, m.hp + m.maxHp * ab.heal); fx({ t: 'mheal', x: m.x, y: m.y }); }
        return true;
      }
      case 'summon':
        if (m.summons >= ab.cap) return false;
        fx({ t: 'mtext', x: m.x, y: m.y, text: name, color: '#5fffb0' });
        summon(m, ab.mob, ab.n, ab.cap, now);
        if (ab.resurrect) resurrect(m, ab.resurrect, 320, now);
        return true;
      case 'resurrect': {
        const k = resurrect(m, ab.n, ab.r, now);
        if (ab.heal) for (const o of monsters.values()) if (o.zone === m.zone && dist(o, m) < ab.r && o.hp < o.maxHp) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * ab.heal); }
        if (k) fx({ t: 'mtext', x: m.x, y: m.y, text: name, color: '#5fffb0' });
        return k > 0;
      }
      case 'heal': {
        let best = null;
        for (const o of monsters.values()) if (o.zone === m.zone && o !== m && dist(o, m) <= ab.r && o.hp < o.maxHp * 0.8 && (!best || o.hp / o.maxHp < best.hp / best.maxHp)) best = o;
        if (!best) return false;
        best.hp = Math.min(best.maxHp, best.hp + best.maxHp * ab.frac);
        fx({ t: 'mheal', x: best.x, y: best.y, fx: m.x, fy: m.y });
        return true;
      }
      case 'buff': case 'shieldAlly': {
        let n = 0;
        for (const o of monsters.values()) if (o.zone === m.zone && dist(o, m) <= ab.r) {
          if (ab.type === 'shieldAlly') o.shieldHp = Math.max(o.shieldHp || 0, o.maxHp * ab.frac);
          else if (ab.stat === 'atk') { o.atkBuff = ab.mult; o.atkBuffUntil = now + ab.ms; } else { o.spdBuff = ab.mult; o.spdBuffUntil = now + ab.ms; }
          n++;
        }
        fx({ t: 'mbuff', x: m.x, y: m.y, r: ab.r, kind: ab.type === 'shieldAlly' ? 'shield' : ab.stat });
        return n > 0;
      }
      case 'selfDef':
        m.defUntil = now + ab.ms; m.defMult = ab.mult; m.defPhysOnly = !!ab.physOnly;
        fx({ t: 'mtext', x: m.x, y: m.y, text: name, color: '#c8d0e0' });
        return true;
      case 'shield':
        m.shieldHp = m.maxHp * ab.frac;
        fx({ t: 'mbuff', x: m.x, y: m.y, r: 40, kind: 'shield' });
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
        fx({ t: 'mtext', x: m.x, y: m.y, text: m.form ? 'Звериная форма!' : 'Облик человека', color: '#9aff6a' });
        return false;
      case 'element': {
        const keys = ['fire', 'ice', 'lightning'], k = keys[Math.floor(Math.random() * keys.length)];
        fx({ t: 'mtext', x: m.x, y: m.y, text: `Стихия: ${ELEMENTS[k].name}`, color: '#ffe94a' });
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
      () => { fx({ t: 'mtext', x: m.x, y: m.y, text: 'Хаос: морок', color: '#ff6ad8' }); shoot(m, t, 0.8, now, { cc: 'confuse', ms: TURN, proj: 'illusion' }); },
      () => { fx({ t: 'mtext', x: m.x, y: m.y, text: 'Хаос: призыв', color: '#ff6ad8' }); summon(m, 'imp', big ? 2 : 1, big ? 6 : 2, now); },
      () => { fx({ t: 'mtext', x: m.x, y: m.y, text: 'Хаос: проклятие', color: '#ff6ad8' }); shoot(m, t, 0.6, now, { curse: 3 * TURN, proj: 'dark' }); },
      () => { m.hp = Math.min(m.maxHp, m.hp + m.maxHp * (big ? 0.03 : 0.1)); fx({ t: 'mheal', x: m.x, y: m.y }); },
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
  function passives(m, def, now, dt) {
    if (def.regen && m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * def.regen * dt);
    if (def.regenTurn && m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * def.regenTurn / 2 * dt);
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
      fx({ t: 'mtext', x: m.x, y: m.y - 30, text: `Вечность: ${ELEMENTS[m.element].name}`, color: '#bfe8ff', big: true });
    }
    // Титан хаоса: каждые 5 ходов — новая фаза
    if (def.phases && now > (m.phaseAt || 0)) {
      const P = { rage: 'Ярость', stone: 'Камень', storm: 'Буря', dark: 'Тьма' }, keys = Object.keys(P);
      m.phase = keys[Math.floor(Math.random() * keys.length)];
      m.phaseAt = now + def.phases;
      fx({ t: 'mtext', x: m.x, y: m.y - 30, text: `Фаза: ${P[m.phase]}`, color: '#ff6ad8', big: true });
    }
    // Пожиратель миров: поедает своих демонов рядом (+20% HP за каждого)
    if (def.devour) {
      if (now > (m.feedAt || 0)) { m.feedAt = now + 12000; summon(m, 'imp', 2, 6, now); }
      for (const o of monsters.values()) if (o.owner === m.id && o.zone === m.zone && dist(o, m) < 70 && now - (o.bornAt || (o.bornAt = now)) > 6000) {
        monsters.delete(o.id); m.summons--;
        m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.2);
        fx({ t: 'mtext', x: m.x, y: m.y, text: 'Поглощение! +20%', color: '#ff4a8a', big: true });
      }
    }
    // Тень: невидима, пока не подойдёт вплотную
    if (def.stealth && !m.inv && now > (m.revealUntil || 0) && !m.target) m.inv = true;
  }

  // ---------- Поведение в бою (вызывается из игрового цикла сервера) ----------
  // Возвращает true, если монстр уже действовал в этом тике
  function act(m, target, now, dt) {
    const def = MOBS[m.type];
    passives(m, def, now, dt);
    if (!target) return false;
    const dd = dist(m, target);
    const seen = world.lineOfSight(m.x, m.y, target.x, target.y);
    // Умение — только если цель видна (не через стену)
    if (def.ab && def.ab.type !== 'form' && now >= m.abAt && dd < 420 && seen) {
      if (useAbility(m, def, target, now)) { m.abAt = now + def.ab.cd * (m.phase === 'storm' ? 0.5 : 1); m.lastAttack = now; return true; }
      m.abAt = now + 1000;
    }
    // Тень: удар в спину из невидимости
    if (m.inv && dd < 46) { m.inv = false; m.revealUntil = now + 6000; fx({ t: 'mtext', x: m.x, y: m.y, text: 'Удар в спину!', color: '#c070ff' }); hit(m, target, def.backstab || 2, now); m.lastAttack = now; return true; }
    // Дальний бой: держит дистанцию и стреляет
    if (m.range > 0) {
      const speed = curSpeed(m, now);
      // Цель далеко или за стеной — подходит ближе, через стену не стреляет
      if (dd > m.range || !seen) { if (m.rootUntil <= now) step(m, target, speed * dt); return true; }
      if (def.kite && dd < m.range * 0.45 && m.rootUntil <= now) step(m, target, -speed * 0.8 * dt);
      if (now - m.lastAttack > m.cd * (m.phase === 'storm' ? 0.5 : 1)) { m.lastAttack = now; if (target.owner) hit(m, target, 1, now); else shoot(m, target, 1, now); }
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
  function melee(m, target, now) { hit(m, target, 1, now); }
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
      fx({ t: 'mrevive', x: m.x, y: m.y, big: m.boss });
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
    const run = runs.get(m.zone);
    if (run && !m.extra) {
      run.killed++;
      if (m.rank === 'mini') run.minisKilled++;
      if (m.rank === 'boss') finishRun(run, killer);
      sendRun(run);
    }
    if (m.rank === 'world') rewardWorldBoss(m);
  }
  function onMonsterHp(m, now) {
    const def = MOBS[m.type];
    if (def.enrage && def.enrage.allies && !m.alliesEnraged && m.hp < m.maxHp * def.enrage.below) {
      m.alliesEnraged = true;
      for (const o of monsters.values()) if (o.zone === m.zone) o.allEnraged = true;
      fx({ t: 'mtext', x: m.x, y: m.y - 30, text: 'Единая воля: +50% атаки!', color: '#5fffb0', big: true });
    }
    if (def.legion) m.legionArmed = true;
  }

  // ---------- Данжи-лабиринты ----------
  const runs = new Map();
  function rollRank(depthK) {
    const r = Math.random();
    if (r < 0.04 + 0.06 * depthK) return 'rare';
    if (r < 0.2 + 0.15 * depthK) return 'magic';
    return 'normal';
  }
  function startDungeon(p, townId, i) {
    const dg = X.DUNGEONS[townId][i];
    if (!dg) return;
    if (p.char.level < Math.max(1, dg.lv[0] - 2)) return p.socket.emit('skillFail', `Нужен ${Math.max(1, dg.lv[0] - 2)} уровень (данж ${dg.lv[0]}–${dg.lv[1]})`);
    const z = world.addDungeon(townId, i);
    const run = { z, dg, total: 0, killed: 0, minis: dg.minis.length, minisKilled: 0, boss: false, startedAt: Date.now(), members: new Set() };
    runs.set(z.id, run);
    const lvAt = (depth) => Math.round(dg.lv[0] + (dg.lv[1] - dg.lv[0]) * depth / Math.max(1, z.maxD));
    let mi = 0;
    for (const room of z.rooms) {
      if (room.role === 'start') continue;
      const c = z.abs(room.cx, room.cy), R = Math.min(room.x1 - room.x0, room.y1 - room.y0) * 16;
      const lv = lvAt(room.depth), depthK = room.depth / Math.max(1, z.maxD);
      const pick = () => dg.pool[Math.floor(Math.random() * dg.pool.length)];
      if (room.role === 'boss') {
        create(z, dg.boss, c, dg.lv[1] + 1, { rank: 'boss', name: dg.bossName });
        for (let k = 0; k < 2; k++) create(z, pick(), near(z, c, R), lv);
        run.total += 3;
        continue;
      }
      if (room.role === 'mini') {
        create(z, dg.minis[mi++ % dg.minis.length], c, lv + 1, { rank: 'mini' });
        for (let k = 0; k < 2; k++) create(z, pick(), near(z, c, R), lv);
        run.total += 3;
        continue;
      }
      // Стая: бойцы (ближний/дальний бой, маги, танки, ассасины) + не больше одного призывателя или лекаря
      const fighters = dg.pool.filter((t) => !['summoner', 'support'].includes(MOBS[t].cls));
      const helpers = dg.pool.filter((t) => ['summoner', 'support'].includes(MOBS[t].cls));
      const type = fighters[Math.floor(Math.random() * fighters.length)] || pick(), def = MOBS[type];
      const n = Math.round((3 + Math.floor(Math.random() * 2)) * (def.pack || 1)); // стая 3–4 (гоблины — больше)
      const withHelper = helpers.length && Math.random() < 0.5;
      for (let k = 0; k < n; k++) {
        const t = k === n - 1 && withHelper ? helpers[Math.floor(Math.random() * helpers.length)]
          : k === 0 || Math.random() < 0.6 ? type : fighters[Math.floor(Math.random() * fighters.length)] || type;
        const rank = rollRank(depthK);
        const affixes = rank === 'rare' ? Object.keys(AFFIXES).sort(() => Math.random() - 0.5).slice(0, 1 + (Math.random() < 0.5 ? 1 : 0)) : [];
        create(z, t, near(z, c, R), lv, { rank, affixes });
        run.total++;
      }
    }
    // Вход: игрок и его группа из этого города
    const group = d.partyMembers(p).filter((o) => o.zone === p.zone && !o.dead);
    for (const o of group) {
      d.moveToZone(o, z.id);
      run.members.add(o.uid);
      o.socket.emit('chat', { sys: true, text: `${dg.name} (ур. ${dg.lv[0]}–${dg.lv[1]}): пройдите лабиринт — полубоссы ждут на пути, босс в самой дальней комнате.` });
    }
    sendRun(run);
  }
  function sendRun(run) {
    const info = { name: run.dg.name, killed: run.killed, total: run.total, minis: run.minis, minisKilled: run.minisKilled, boss: run.boss, bossName: run.dg.bossName || MOBS[run.dg.boss].name };
    for (const p of inZone(run.z.id)) p.socket.emit('dungeon', info);
  }
  function finishRun(run, killer) {
    run.boss = true;
    const z = run.z;
    const bossRoom = z.rooms.find((r) => r.role === 'boss');
    const pos = z.abs(bossRoom.cx, bossRoom.cy + 2);
    const exit = { id: 'exit', kind: 'portal', to: z.town, name: 'Выход: данж пройден!', icon: '🏆', x: pos.x, y: pos.y };
    z.objs.push(exit);
    const secs = Math.round((Date.now() - run.startedAt) / 1000);
    for (const p of inZone(z.id)) {
      const pr = d.getProfile(p.uid);
      const gold = 60 * run.dg.lv[1];
      pr.gold += gold;
      d.addPassXp(pr, 25);
      pr.dungeonClears = pr.dungeonClears || {};
      const key = `${z.town}:${z.dgIndex}`;
      const first = !pr.dungeonClears[key];
      pr.dungeonClears[key] = (pr.dungeonClears[key] || 0) + 1;
      p.socket.emit('zoneObjs', z.objs);
      p.socket.emit('chat', { sys: true, text: `🏆 ${run.dg.name} пройден за ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}! +${gold} 💰${first ? ' · первое прохождение: награда' : ''}` });
      if (first) d.giveLoot(p, pr, d.rollItem(z.tier, C.DROPS.boss[z.tier]), p);
      d.markDirty(p);
    }
  }

  // ---------- Данж выживания: волны из монстров этого мира ----------
  const survivals = new Map();
  const TOWN_LV = { town1: [1, 15], town2: [15, 30], town3: [30, 45] };
  function startSurvival(p) {
    const town = world.byId.get(p.zone);
    const z = world.addSurvival(town.id);
    const group = d.partyMembers(p).filter((o) => o.zone === p.zone && !o.dead);
    const avgLv = Math.round(group.reduce((s, o) => s + o.char.level, 0) / group.length);
    survivals.set(z.id, { z, wave: 0, nextAt: Date.now() + 4000, cleared: true, lv: Math.max(TOWN_LV[town.id][0], Math.min(TOWN_LV[town.id][1], avgLv)) });
    for (const o of group) {
      d.moveToZone(o, z.id);
      o.socket.emit('chat', { sys: true, text: `Данж выживания${group.length > 1 ? ` (группа: ${group.length})` : ''}: держитесь как можно дольше! Первая волна через 4 с` });
    }
  }
  function spawnWave(s, inside) {
    const z = s.z, w = s.wave, dgs = X.DUNGEONS[z.town];
    const lv = s.lv + Math.floor(w / 2);
    const tierIdx = Math.min(dgs.length - 1, Math.floor((w - 1) / 2));
    const pool = dgs.slice(0, tierIdx + 1).flatMap((dg) => dg.pool);
    const n = Math.min(26, Math.round((3 + w * 1.5) * (1 + 0.35 * (inside - 1))));
    const c = z.abs(15, 15);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3, r = 10.5 * C.TILE;
      const rank = w >= 3 && Math.random() < 0.15 ? 'magic' : 'normal';
      create(z, pool[Math.floor(Math.random() * pool.length)], { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }, lv, { rank, aggro: 2000, lootMult: 0.5 });
    }
    if (w % 5 === 0) {
      const dg = dgs[Math.min(dgs.length - 1, w / 5 - 1)];
      const big = w % 10 === 0 ? dg.boss : dg.minis[0];
      create(z, big, { x: c.x, y: c.y - 9 * C.TILE }, lv + 1, { rank: w % 10 === 0 ? 'boss' : 'mini', aggro: 2000, hpMult: 1 + 0.5 * (inside - 1) });
    }
  }
  function rewardWave(s, inside) {
    const z = s.z;
    for (const o of inside) {
      if (o.dead) continue;
      const pr = d.getProfile(o.uid);
      const gold = 8 * s.wave * (s.lv + 4);
      pr.gold += gold;
      d.addPassXp(pr, 5);
      pr.survivalBest = Math.max(pr.survivalBest || 0, s.wave);
      o.socket.emit('chat', { sys: true, text: `Волна ${s.wave} пройдена! +${gold} 💰 · рекорд: ${pr.survivalBest}` });
      if (s.wave % 5 === 0 || Math.random() < 0.25) d.giveLoot(o, pr, d.rollItem(z.tier, s.wave % 5 === 0 ? C.DROPS.boss[z.tier] : C.DROPS.weights[z.tier]), o);
      d.markDirty(o);
    }
  }

  // ---------- Мировые боссы ----------
  const wbState = {};
  for (const [town, cfg] of Object.entries(X.WORLD_BOSSES)) wbState[town] = { cfg, idx: 0, bossId: null, nextAt: Date.now() + (Number(process.env.WB_FIRST_MS) || 90000) };
  function spawnWorldBoss(town, now) {
    const st = wbState[town], z = world.byId.get(`wb_${town}`);
    const type = st.cfg.list[st.idx++ % st.cfg.list.length];
    const n = Math.max(1, inZone(z.id).length);
    const m = create(z, type, z.abs(20, 17), st.cfg.lv, { rank: 'world', hpMult: 1 + 0.7 * (n - 1), aggro: 900 });
    m.scaledFor = n;
    st.bossId = m.id;
    d.broadcast(`👹 Мировой босс «${MOBS[type].name}» появился в мире ${world.byId.get(town).name}! Портал — на юге города.`);
  }
  function rewardWorldBoss(m) {
    const town = world.byId.get(m.zone)?.town;
    const st = wbState[town];
    if (st) { st.bossId = null; st.nextAt = Date.now() + X.WORLD_BOSS_RESPAWN; }
    const total = Object.values(m.contrib).reduce((s, v) => s + v, 0) || 1;
    for (const p of players.values()) {
      const part = (m.contrib[p.uid] || 0) / m.maxHp;
      if (part < 0.01) continue;
      const pr = d.getProfile(p.uid);
      const gold = Math.round(400 * m.tier * (0.5 + Math.min(1, part * 4)));
      pr.gold += gold;
      d.addPassXp(pr, 40);
      p.socket.emit('chat', { sys: true, text: `👹 Мировой босс повержен! Ваш вклад ${Math.round((m.contrib[p.uid] / total) * 100)}% · +${gold} 💰` });
      for (let i = 0; i < 2 + (part > 0.15 ? 1 : 0); i++) d.giveLoot(p, pr, d.rollItem(m.tier, C.DROPS.boss[m.tier]), m);
      d.markDirty(p);
    }
    d.broadcast(`👹 Мировой босс «${MOBS[m.type].name}» повержен! Следующий — через ${Math.round(X.WORLD_BOSS_RESPAWN / 60000)} минут.`);
  }
  function worldBossInfo(town) {
    const st = wbState[town];
    if (!st) return null;
    const b = st.bossId ? monsters.get(st.bossId) : null;
    return b ? `👹 ${MOBS[b.type].name} здесь! Здоровье ${Math.round((b.hp / b.maxHp) * 100)}%` : `👹 Мировой босс появится через ${Math.max(1, Math.round((st.nextAt - Date.now()) / 60000))} мин`;
  }

  // Периодические задачи: копии данжей, волны, мировые боссы
  setInterval(() => {
    const now = Date.now();
    for (const [id, run] of runs) {
      if (inZone(id).length) continue;
      for (const m of monsters.values()) if (m.zone === id) monsters.delete(m.id);
      runs.delete(id);
      world.removeZone(run.z);
    }
    for (const [id, s] of survivals) {
      const inside = inZone(id);
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
      if (st.bossId && !b) st.bossId = null;
      if (!st.bossId && now >= st.nextAt) spawnWorldBoss(town, now);
      // Здоровье мирового босса растёт, если пришли новые игроки
      if (b) {
        const n = Math.max(1, inZone(b.zone).length);
        if (n > b.scaledFor) { const k = (1 + 0.7 * (n - 1)) / (1 + 0.7 * (b.scaledFor - 1)); b.maxHp = Math.round(b.maxHp * k); b.hp = Math.round(b.hp * k); b.scaledFor = n; }
      }
    }
  }, 500);

  return {
    create, act, melee, meleeRange, curSpeed, takenMult, onHurt, preventDeath, onKilled, onMonsterHp,
    startDungeon, startSurvival, worldBossInfo, ccActive, ccPlayer, tickPlayer, runs, survivals, wbState,
  };
};
