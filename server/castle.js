// Осада замков: по замку в каждом мире (Эльдмир, Морграт, Аэлион). Один клан держит не больше одного замка.
//
// Расписание: каждую субботу в 20:00 МСК, все три замка одновременно. Заявки — до 19:55 субботы, взнос в GRAM
// (SIEGE.feeStars ⭐ по курсу) платит глава клана; заявку на замок, который клан уже держит, подавать не нужно — он защищается.
// Нападающие кланы идут по очереди (в порядке заявок), у каждого — свой «ход» SIEGE.slotMin минут:
//  • первая минута — сбор (кристалл неуязвим), дальше бой;
//  • нападающие должны разбить кристалл замка; пока рядом с кристаллом стоит живой защитник, урон по нему вдвое меньше;
//  • у каждого героя на ход SIEGE.lives жизней (у обеих сторон), возрождение через 10 с у своего лагеря;
//    жизни кончились — герой выходит в город до конца хода;
//  • кристалл разбит — замок переходит к нападающим, и они защищают его в следующих ходах; не разбит — замок держится.
// Ничейный замок охраняют стражи (монстры). Своих и союзников по стороне бить нельзя.
//
// Доход владельцев: у каждого города свой Торговый дом. С каждой сделки игра оставляет себе 15% цены, всё сверх
// (при полной комиссии 20% — это 5%) идёт в казну замка этого города. Казна делится в субботу перед осадой между участниками
// клана-владельца, заходившими за неделю: глава получает две доли, остальные — по одной. Вывод GRAM остаётся 10%.
module.exports = function createCastle(dep) {
  const { world, players, monsters, D, MOBX, store, Trade, getProfile, clansFn, clanOf, saveClans, moveToZone, notifyUid, evCast, markDirty, profilesFn } = dep;
  const SIEGE = { feeStars: 150, slotMin: 12, prepMs: 60e3, lives: 3, respawnMs: 10e3, maxAtk: 5, keep: 0.15, regCloseMin: 5, minMembers: 3, minLevel: 10,
    crystal: { town1: 18, town2: 33, town3: 50 }, guards: 6 };
  const TOWNS = ['town1', 'town2', 'town3'];
  const st = store.readJSON('castles.json', null) || {};
  for (const t of TOWNS) st[t] ??= { owner: null, since: 0, pool: 0, reg: [], log: [] };
  let saveTm = null;
  const save = () => { clearTimeout(saveTm); saveTm = setTimeout(() => { try { store.writeJSON('castles.json', st); } catch (e) { console.error('castle save', e.message); } }, 300); };
  const clans = () => clansFn();
  const tag = (id) => (clans()[id] ? `[${clans()[id].tag}] ${clans()[id].name}` : 'стражи');
  const fmt = (n) => (Math.round(n / 1e9 * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

  // Ближайшая суббота 20:00 МСК (17:00 UTC); если осада уже идёт — её начало
  function nextStart(now = Date.now()) {
    const d = new Date(now); d.setUTCHours(17, 0, 0, 0);
    let add = (6 - d.getUTCDay() + 7) % 7;
    let t = d.getTime() + add * 864e5;
    if (t + 3 * 3600e3 < now) t += 7 * 864e5; // прошла (с запасом на ходы) — следующая неделя
    return t;
  }
  let run = null; // { start, towns: { town1: { queue, i, slotStart, side: {uid: 'atk'|'def'}, lives: {uid:n}, crystal, guards:[], defender, done } } }

  // ---------- Доход ----------
  // Из сделки Торгового дома: price — цена, house — комиссия, которую взяла игра. Всё сверх 15% цены — в казну замков
  // Сделка Торгового дома города t: всё сверх 15% цены (при полной комиссии 20% — 5%) — в казну замка этого города
  function onDeal(price, house, t) {
    const extra = Math.max(0, house - price * SIEGE.keep);
    if (!(extra > 0) || !TOWNS.includes(t)) return 0;
    st[t].wk = (st[t].wk || 0) + extra; // «сколько стоит замок за неделю» — для взноса, даже если владельца нет
    let given = 0;
    if (st[t].owner && clans()[st[t].owner]) { st[t].pool += extra; given = extra; }
    save();
    return given;
  }
  // Раздача казны: глава ×2, остальные ×1 — только заходившие за 7 дней
  function payout(t) {
    const c = st[t], cl = c.owner && clans()[c.owner];
    const pool = Math.floor(c.pool);
    if (!cl || pool < 1e7) return;
    const since = Date.now() - 7 * 864e5, P = profilesFn();
    const act = cl.members.filter((u) => P[u] && (P[u].lastSeen || 0) > since);
    if (!act.length) return;
    const w = (u) => (u === cl.leader ? 2 : 1), sum = act.reduce((s, u) => s + w(u), 0), one = Math.floor(pool / sum);
    for (const u of act) {
      Trade.grant(u, one * w(u), 'castle', `Казна замка ${world.byId.get(t).name}: ${u === cl.leader ? 'доля главы (×2)' : 'ваша доля'}`);
      notifyUid(u, `🏰 Казна замка ${world.byId.get(t).name}: +${fmt(one * w(u))} GRAM${u === cl.leader ? ' (доля главы ×2)' : ''}`);
    }
    c.pool -= one * sum;
    c.log.unshift({ at: Date.now(), text: `Казна ${fmt(one * sum)} GRAM → ${act.length} участникам ${tag(c.owner)}` }); c.log = c.log.slice(0, 20);
    save();
  }
  const liab = () => TOWNS.reduce((s, t) => s + (st[t].pool || 0), 0);

  // ---------- Взнос за заявку ----------
  // Взнос = max(150 ⭐, 50% средней недельной казны этого замка за 4 последние недели). Пока Торговый дом маленький,
  // взнос — минимальный; растёт вместе с тем, сколько замок реально приносит. При 2+ заявках на замок взносы
  // покрывают выплату владельцу целиком — игра в плюсе; при одной — окупают половину, остальное окупает рост торговли.
  const FEE_SHARE = 0.5, FEE_WEEKS = 4;
  function feeNano(t) {
    const h = (st[t].hist || []).slice(0, FEE_WEEKS), avg = h.length ? h.reduce((a, x) => a + x, 0) / h.length : 0;
    return Math.max(Trade.nanoOf(SIEGE.feeStars), Math.round(avg * FEE_SHARE / 1e7) * 1e7);
  }
  // Неделя закрыта (суббота, перед осадой): запоминаем, сколько замок принёс за неделю
  function closeWeek(t) { st[t].hist = [st[t].wk || 0, ...(st[t].hist || [])].slice(0, 8); st[t].wk = 0; }

  // ---------- Заявки ----------
  function ownedBy(clanId) { return TOWNS.find((t) => st[t].owner === clanId) || null; }
  function register(p, t) {
    const cl = clanOf(p.uid);
    if (!TOWNS.includes(t)) return { error: 'Нет такого замка' };
    if (!cl || cl.system) return { error: 'Нужен свой клан' };
    if (cl.leader !== p.uid) return { error: 'Заявку подаёт глава клана' };
    if (cl.members.length < SIEGE.minMembers) return { error: `В клане нужно не меньше ${SIEGE.minMembers} участников` };
    const own = ownedBy(cl.id);
    if (own) return { error: own === t ? 'Этот замок ваш — вы защищаете его автоматически' : `Ваш клан уже держит замок ${world.byId.get(own).name} — один клан, один замок` };
    if (TOWNS.some((x) => st[x].reg.some((r) => r.clan === cl.id))) return { error: 'Ваш клан уже подал заявку на осаду' };
    const start = nextStart();
    if (run || Date.now() > start - SIEGE.regCloseMin * 60e3) return { error: 'Заявки на эту осаду закрыты' };
    if (st[t].reg.length >= SIEGE.maxAtk) return { error: `На этот замок уже ${SIEGE.maxAtk} заявок` };
    const nano = feeNano(t);
    const parts = Trade.spendGram(p.uid, nano, `Взнос за осаду замка ${world.byId.get(t).name}`);
    if (!parts) return { error: `Не хватает GRAM: взнос ${fmt(nano)}` };
    st[t].reg.push({ clan: cl.id, at: Date.now(), by: p.uid, parts }); save(); // parts — чтобы вернуть взнос при обнулении
    for (const u of cl.members) notifyUid(u, `🏰 Клан подал заявку на осаду замка ${world.byId.get(t).name} — суббота, 20:00 МСК. Ваш ход — ${st[t].reg.length}-й`);
    return { toast: `🏰 Заявка подана: ${world.byId.get(t).name}, ход ${st[t].reg.length}` };
  }

  // ---------- Осада ----------
  const zoneOf = (t) => world.byId.get(`castle_${t}`);
  const inZone = (t) => [...players.values()].filter((o) => o.zone === `castle_${t}`);
  function crystalLevel(t) { return SIEGE.crystal[t] || 20; }
  function spawnCrystal(t, R) {
    const z = zoneOf(t);
    if (R.crystal && monsters.has(R.crystal)) monsters.delete(R.crystal);
    const nAtk = Math.max(1, Object.values(R.side).filter((s) => s === 'atk').length);
    const m = D.create(z, 'crystalGuardian', z.crystalAt, crystalLevel(t), { rank: 'boss', name: `Кристалл замка ${world.byId.get(t).name}`, hpMult: Math.max(3, 1.2 * nAtk) });
    Object.assign(m, { dmg: 0, speed: 0, aggro: 0, cd: 1e12, xp: 0, castleCrystal: t, lootMult: 0, abAt: 1e15, contrib: null, boss: false });
    R.crystal = m.id;
  }
  function spawnGuards(t, R) {
    const z = zoneOf(t);
    for (const id of R.guards || []) monsters.delete(id);
    R.guards = [];
    if (R.defender) return;
    for (let i = 0; i < SIEGE.guards; i++) {
      const a = (i / SIEGE.guards) * Math.PI * 2, pos = { x: z.crystalAt.x + Math.cos(a) * 110, y: z.crystalAt.y + 90 + Math.sin(a) * 50 };
      const m = D.create(z, 'stoneGuard', pos, crystalLevel(t), { rank: 'mini', name: 'Страж замка', aggro: 300, xpMult: 0 });
      m.lootMult = 0; m.castleGuard = t; R.guards.push(m.id);
    }
  }
  function say(t, text) { for (const o of inZone(t)) o.socket.emit('chat', { sys: true, text }); }
  function clanSay(clanId, text) { const c = clans()[clanId]; if (!c) return; for (const o of players.values()) if (c.members.includes(o.uid)) o.socket.emit('chat', { sys: true, text }); }
  function kick(o, text) {
    if (!o || !o.zone || !o.zone.startsWith('castle_')) return;
    const t = o.zone.slice(7);
    o.dead = false; o.hp = o.maxHp; o.castleOut = true;
    moveToZone(o, t);
    if (text) o.socket.emit('chat', { sys: true, text });
    markDirty(o);
  }
  function startSiege(now = Date.now()) {
    run = { start: now, towns: {} };
    for (const t of TOWNS) {
      try { payout(t); closeWeek(t); } catch (e) { console.error('castle payout', e); }
      const queue = st[t].reg.map((r) => r.clan).filter((id) => clans()[id]);
      st[t].reg = [];
      run.towns[t] = { queue, i: -1, slotStart: 0, side: {}, lives: {}, crystal: null, guards: [], defender: st[t].owner && clans()[st[t].owner] ? st[t].owner : null, done: !queue.length };
      if (queue.length) evCast({ ev: 'castle', title: `🏰 Осада замка ${world.byId.get(t).name}`, text: `Защищает ${tag(run.towns[t].defender)} · кланов в очереди: ${queue.length}` });
    }
    for (const t of TOWNS) if (!run.towns[t].done) nextSlot(t, now);
    if (TOWNS.every((x) => run.towns[x].done)) run = null;
    save();
  }
  function nextSlot(t, now) {
    const R = run.towns[t];
    for (const o of inZone(t)) kick(o, null);
    R.i++;
    if (R.i >= R.queue.length) { finish(t); return; }
    R.slotStart = now; R.side = {}; R.lives = {}; R.won = false;
    spawnCrystal(t, R); spawnGuards(t, R);
    const atk = R.queue[R.i];
    clanSay(atk, `⚔️ Ваш ход осады замка ${world.byId.get(t).name}! Меню → Осада замков → «В бой». ${SIEGE.slotMin} мин, у каждого ${SIEGE.lives} жизни`);
    if (R.defender) clanSay(R.defender, `🛡️ Замок ${world.byId.get(t).name} атакует ${tag(atk)}! Меню → Осада замков → «На защиту»`);
  }
  function finish(t) {
    const R = run.towns[t];
    R.done = true;
    if (R.crystal) monsters.delete(R.crystal);
    for (const id of R.guards || []) monsters.delete(id);
    for (const o of inZone(t)) kick(o, null);
    if (R.queue.length) evCast({ ev: 'castle', title: `🏰 Осада ${world.byId.get(t).name} окончена`, text: `Замок держит ${tag(st[t].owner)} — казна замка его клану до следующей субботы` });
    if (TOWNS.every((x) => run.towns[x] && run.towns[x].done)) run = null;
  }
  // Кристалл разбит: замок — нападающим, они встают на защиту
  function crystalDown(t) {
    if (!run || !run.towns[t]) return;
    const R = run.towns[t], atk = R.queue[R.i];
    if (!atk || R.won) return;
    R.won = true;
    st[t].owner = atk; st[t].since = Date.now();
    st[t].log.unshift({ at: Date.now(), text: `${tag(atk)} взял замок` }); st[t].log = st[t].log.slice(0, 20);
    R.defender = atk; save();
    evCast({ ev: 'castle', title: `🏰 Замок ${world.byId.get(t).name} взят!`, text: `${tag(atk)} разбил кристалл и теперь защищает замок` });
    nextSlot(t, Date.now());
  }
  function tick(now = Date.now()) {
    const ns = nextStart(now);
    if (!run && now >= ns && now < ns + 60e3 && st.lastStart !== ns) { st.lastStart = ns; startSiege(now); }
    if (!run) return;
    for (const t of TOWNS) {
      if (!run) return;
      const R = run.towns[t];
      if (!R || R.done) continue;
      const slotEnd = R.slotStart + SIEGE.slotMin * 60e3;
      // Нападающие кончились (все без жизней и вне замка после боя) — ход окончен досрочно
      const atkIn = inZone(t).filter((o) => R.side[o.uid] === 'atk');
      const anyAtkLives = Object.entries(R.side).some(([u, s]) => s === 'atk' && (R.lives[u] || 0) > 0);
      if (now > slotEnd || (now > R.slotStart + SIEGE.prepMs + 60e3 && Object.keys(R.side).some((u) => R.side[u] === 'atk') && !atkIn.length && !anyAtkLives)) {
        if (!R.won) evCast({ ev: 'castle', title: `🛡️ Замок ${world.byId.get(t).name} устоял`, text: `Атака ${tag(R.queue[R.i])} отбита` });
        nextSlot(t, now);
        continue;
      }
      // Кристалл неуязвим на сборе; рядом защитник — урон вдвое меньше (см. crystalK)
      const m = monsters.get(R.crystal);
      if (m) m.invuln = now < R.slotStart + SIEGE.prepMs;
    }
  }
  // Множитель урона по кристаллу (из damageMonster): 0 — нельзя, 0.5 — рядом защитник
  function crystalK(p, m) {
    const t = m.castleCrystal; if (!run || !run.towns[t]) return 0;
    const R = run.towns[t];
    if (R.side[p.uid] !== 'atk') return 0;
    if (m.invuln) return 0;
    const guard = inZone(t).some((o) => !o.dead && R.side[o.uid] === 'def' && Math.hypot(o.x - m.x, o.y - m.y) < 220)
      || (R.guards || []).some((id) => { const g = monsters.get(id); return g && Math.hypot(g.x - m.x, g.y - m.y) < 220; });
    return guard ? 0.5 : 1;
  }
  // Войти в бой: свой клан — нападающий в этом ходе или защитник
  function join(p, t) {
    if (!run || !run.towns[t] || run.towns[t].done) return { error: 'Сейчас осады этого замка нет' };
    const R = run.towns[t], cl = clanOf(p.uid);
    if (!cl) return { error: 'Нужен клан' };
    const side = cl.id === R.queue[R.i] ? 'atk' : cl.id === R.defender ? 'def' : null;
    if (!side) return { error: 'Ваш клан сейчас не участвует в этом ходе' };
    if (p.char.level < SIEGE.minLevel) return { error: `Осада — с ${SIEGE.minLevel} уровня` };
    if (p.dead) return { error: 'Вы погибли' };
    if (R.lives[p.uid] === 0) return { error: 'Ваши жизни в этом ходе закончились' };
    if (R.lives[p.uid] === undefined) R.lives[p.uid] = SIEGE.lives;
    R.side[p.uid] = side;
    const z = zoneOf(t), at = side === 'atk' ? z.atkSpawn : z.defSpawn;
    p.castleOut = false;
    moveToZone(p, z.id, { x: at.x + (Math.random() - 0.5) * 80, y: at.y + (Math.random() - 0.5) * 30 });
    p.socket.emit('chat', { sys: true, text: side === 'atk' ? `⚔️ Разбейте кристалл замка! Жизней: ${R.lives[p.uid]}. Рядом с защитником кристалл получает вдвое меньше урона` : `🛡️ Защитите кристалл! Жизней: ${R.lives[p.uid]}` });
    return { close: true };
  }
  const sideOf = (p) => { if (!run || !p.zone || !p.zone.startsWith('castle_')) return null; const R = run.towns[p.zone.slice(7)]; return R ? R.side[p.uid] || null : null; };
  const sameSide = (a, b) => { const sa = sideOf(a); return !!sa && sa === sideOf(b); };
  // Гибель в замке: жизнь −1, возрождение у своего лагеря через 10 с; жизней нет — в город
  function onDeath(v) {
    const t = v.zone.slice(7), R = run && run.towns[t];
    if (!R) return { town: true };
    R.lives[v.uid] = Math.max(0, (R.lives[v.uid] ?? SIEGE.lives) - 1);
    if (R.lives[v.uid] <= 0) return { town: true, text: '💀 Жизни в этом ходе закончились — вы в городе' };
    const z = zoneOf(t), at = R.side[v.uid] === 'def' ? z.defSpawn : z.atkSpawn;
    return { at: { x: at.x + (Math.random() - 0.5) * 80, y: at.y }, text: `💀 Осталось жизней: ${R.lives[v.uid]}` };
  }

  function view(p) {
    const cl = clanOf(p.uid), now = Date.now(), start = run ? run.start : nextStart();
    return {
      start, now, running: !!run, fee: fmt(Trade.nanoOf(SIEGE.feeStars)), slotMin: SIEGE.slotMin, lives: SIEGE.lives, regOpen: !run && now < nextStart() - SIEGE.regCloseMin * 60e3,
      myClan: cl ? { id: cl.id, tag: cl.tag, leader: cl.leader === p.uid } : null,
      castles: TOWNS.map((t) => {
        const c = st[t], R = run && run.towns[t];
        const mine = R && cl && !R.done && (cl.id === R.queue[R.i] ? 'atk' : cl.id === R.defender ? 'def' : null);
        return { id: t, fee: fmt(feeNano(t)), week: fmt((st[t].hist || [])[0] || 0), name: world.byId.get(t).name, owner: c.owner && clans()[c.owner] ? tag(c.owner) : null, mineOwn: !!(cl && c.owner === cl.id), pool: fmt(c.pool || 0),
          reg: (R ? R.queue : c.reg.map((r) => r.clan)).map(tag), cur: R && !R.done ? { i: R.i + 1, n: R.queue.length, atk: tag(R.queue[R.i]), left: Math.max(0, R.slotStart + SIEGE.slotMin * 60e3 - now), prep: now < R.slotStart + SIEGE.prepMs } : null,
          join: mine || null, lives: R && R.lives[p.uid] !== undefined ? R.lives[p.uid] : null, log: c.log.slice(0, 5) };
      }),
    };
  }
  function act(p, d) {
    if (d.op === 'castleInfo') return view(p);
    if (d.op === 'castleReg') return { ...register(p, String(d.t || '')), ...view(p) };
    if (d.op === 'castleJoin') return join(p, String(d.t || ''));
    return { error: 'Неизвестное действие' };
  }
  setInterval(() => { try { tick(); } catch (e) { console.error('castle tick', e); } }, 1000);
  // Обнуление игры: казну раздать клану-владельцу (как в субботу), заявки снять со взносом обратно, замки — ничьи
  function wipe(keep) {
    for (const t of TOWNS) {
      const c = st[t];
      try { payout(t); } catch (e) { console.error('castle wipe payout', e); }
      for (const r of c.reg) if (r.by && r.parts) Trade.giveBack(r.by, r.parts, `Обнуление игры: заявка на осаду замка ${world.byId.get(t).name} снята — взнос возвращён`);
      c.reg = [];
      const cl = c.owner && clans()[c.owner];
      if (!cl || !cl.members.some((u) => keep.has(u))) { c.owner = null; c.since = 0; }
    }
    run = null; save();
  }
  return { wipe, act, onDeal, crystalK, crystalDown, onDeath, sameSide, sideOf, liab, startSiege, SIEGE, st, isCastle: (zid) => !!(zid && zid.startsWith('castle_')) };
};
