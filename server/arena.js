// Режимы PvP-арены (бой в реальном времени, механика целей-двойников — в server/index.js, раздел «PvP-арена»):
//   duel     — дуэль 1×1 по очереди, рейтинг;
//   team     — команда на команду 2×2 (группа из двух встаёт в очередь вместе), рейтинг;
//   clone    — бой со своим клоном: копия героя с вашими здоровьем и уроном;
//   champion — бой с тенью чемпиона: копия героя лучшего по рейтингу игрока;
//   brawl    — свободная схватка всех против всех (общая арена мира, server/world.js pvp_<город>).
// Матч идёт на отдельной копии арены; павшие ждут конца боя; по времени побеждает сторона с большим запасом здоровья.

const MODES = {
  duel: { name: 'Дуэль 1×1', size: 1, rated: true, time: 120000 },
  team: { name: 'Команды 2×2', size: 2, rated: true, time: 180000 },
  clone: { name: 'Бой с клоном', solo: true, time: 120000, perDay: 5 },
  champion: { name: 'Тень чемпиона', solo: true, time: 150000, perDay: 3 },
};
const LEVELS = { town1: [1, 20], town2: [15, 35], town3: [30, 99] };
// Турнир недели: очки за бои на арене (победа в дуэли или командах — 3, поражение — 1, победа в свободной схватке — 1).
// В понедельник 00:00 UTC тройка лидеров прошлой недели получает награды
const TOUR_PTS = { win: 3, loss: 1, kill: 1 };
const TOUR_PRIZE = [{ gems: 1600, gold: 20000, title: '🥇' }, { gems: 960, gold: 12000, title: '🥈' }, { gems: 480, gold: 6000, title: '🥉' }];
const weekKey = (t = Date.now()) => { const x = new Date(t), dd = (x.getUTCDay() + 6) % 7; return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate() - dd)).toISOString().slice(0, 10); };
const weekEnd = (t = Date.now()) => Date.parse(weekKey(t)) + 7 * 864e5;
const T = 32;

module.exports = function createArena(d) {
  const { C, world, players, monsters } = d;
  const fs = require('fs'), path = require('path');
  const TOUR_FILE = path.join(d.dataDir, 'tournament.json');
  let tour = { paid: weekKey(), last: [] };
  try { tour = { ...tour, ...JSON.parse(fs.readFileSync(TOUR_FILE, 'utf8')) }; } catch { /* первый запуск */ }
  const saveTour = () => { try { fs.mkdirSync(d.dataDir, { recursive: true }); fs.writeFileSync(TOUR_FILE, JSON.stringify(tour)); } catch (e) { console.error('tournament save', e.message); } };
  function addPoints(pr, n) {
    const wk = weekKey();
    if (!pr.tour || pr.tour.week !== wk) pr.tour = { week: wk, pts: 0 };
    pr.tour.pts += n;
  }
  const ranking = (wk) => Object.entries(d.profiles()).filter(([, o]) => o.tour && o.tour.week === wk && o.tour.pts > 0)
    .map(([uid, o]) => ({ uid, name: (o.arena && o.arena.name) || 'Герой', pts: o.tour.pts, hero: o.arena && C.HEROES[o.arena.hero] ? C.HEROES[o.arena.hero].name : '' }))
    .sort((a, b) => b.pts - a.pts);
  // Итоги прошлой недели — один раз, когда началась новая
  function settle() {
    const wk = weekKey();
    if (tour.paid === wk) return;
    const prev = weekKey(Date.parse(wk) - 864e5), top = ranking(prev).slice(0, 3);
    tour.last = top.map((t, i) => ({ place: i + 1, name: t.name, hero: t.hero, pts: t.pts }));
    top.forEach((t, i) => {
      const pr = d.profiles()[t.uid], P = TOUR_PRIZE[i];
      pr.gems = (pr.gems || 0) + P.gems; pr.gold += P.gold;
      (pr.titles ??= []).push(`${P.title} Турнир ${prev}`);
      d.notifyUid(t.uid, `${P.title} Турнир недели: ${i + 1} место (${t.pts} очков)! Награда: ${P.gems} 💎 и ${P.gold} 💰`);
    });
    if (top.length) d.broadcast(`🏆 Турнир недели завершён! ${top.map((t, i) => `${TOUR_PRIZE[i].title} ${t.name} (${t.pts})`).join(' · ')}`);
    tour.paid = wk;
    saveTour(); d.save();
  }
  setInterval(settle, 60000); setTimeout(settle, 5000);
  const queues = {}; // `${town}:${mode}` -> [{ ids: [player.id], at }]
  const matches = new Map();
  let seq = 1;
  const qKey = (town, mode) => `${town}:${mode}`;
  const arenaOf = (pr) => (pr.arena ??= { rating: 1000, wins: 0, losses: 0, fights: 0, fightsDay: '' });
  const dayKey = () => new Date().toISOString().slice(0, 10);
  const tries = (pr, mode) => { const a = arenaOf(pr); if (a.soloDay !== dayKey()) { a.soloDay = dayKey(); a.solo = {}; } return a.solo; };
  const inQueue = (p) => Object.entries(queues).find(([, q]) => q.some((e) => e.ids.includes(p.id)));

  function leave(p) {
    for (const q of Object.values(queues)) { const i = q.findIndex((e) => e.ids.includes(p.id)); if (i >= 0) q.splice(i, 1); }
    p.socket.emit('arenaQ', null);
  }

  // Вход в режим из окна арены (герой — в городе)
  function join(p, mode) {
    const M = MODES[mode];
    const town = world.byId.get(p.zone);
    if (!M || !town || town.kind !== 'town') return { error: 'Встать в очередь можно в городе' };
    if (p.match) return { error: 'Вы уже в бою' };
    const [lo, hi] = LEVELS[town.id] || [1, 99];
    if (p.char.level < lo || p.char.level > hi) return { error: `Арена ${town.name}: герои ${lo}–${hi} уровня` };
    leave(p);
    if (M.solo) {
      const pr = d.getProfile(p.uid), t = tries(pr, mode);
      if ((t[mode] || 0) >= M.perDay) return { error: `${M.name}: награды на сегодня получены (${M.perDay}/${M.perDay}). Бой без награды — завтра снова с наградой.`, soft: true };
      startSolo(p, town.id, mode);
      return { ok: true };
    }
    // Команда: группа (до 2 человек в этом городе) встаёт вместе
    const group = mode === 'team' ? d.partyMembers(p).filter((o) => o.zone === p.zone && !o.match).slice(0, M.size) : [p];
    const q = (queues[qKey(town.id, mode)] ??= []);
    q.push({ ids: group.map((o) => o.id), at: Date.now() });
    for (const o of group) o.socket.emit('arenaQ', { mode, name: M.name, waiting: q.reduce((s, e) => s + e.ids.length, 0), need: M.size * 2 });
    return { ok: true };
  }

  // ---------- Подбор соперников ----------
  function matchmake() {
    for (const [key, q] of Object.entries(queues)) {
      const [town, mode] = key.split(':'), M = MODES[mode];
      // Ушедшие из города или из игры выпадают из очереди
      for (let i = q.length - 1; i >= 0; i--) {
        q[i].ids = q[i].ids.filter((id) => { const o = players.get(id); return o && o.zone === town && !o.match; });
        if (!q[i].ids.length) q.splice(i, 1);
      }
      while (true) {
        const teams = [[], []];
        const used = [];
        for (const e of q) {
          const t = teams.find((tm) => tm.length + e.ids.length <= M.size);
          if (!t) continue;
          t.push(...e.ids); used.push(e);
          if (teams.every((tm) => tm.length === M.size)) break;
        }
        if (!teams.every((tm) => tm.length === M.size)) break;
        for (const e of used) q.splice(q.indexOf(e), 1);
        startMatch(town, mode, teams.map((tm) => tm.map((id) => players.get(id))));
      }
      const waiting = q.reduce((s, e) => s + e.ids.length, 0);
      for (const e of q) for (const id of e.ids) players.get(id)?.socket.emit('arenaQ', { mode, name: M.name, waiting, need: M.size * 2 });
    }
  }

  // ---------- Матч игроков ----------
  function place(z, side, i, n) {
    const x = z.ox + (side ? 15.5 : 8.5) * T, y = z.oy + (12 + (i - (n - 1) / 2) * 3) * T;
    return { x, y };
  }
  function prep(p) {
    d.revive(p);
    p.cc = null; p.pdots = []; p.slowUntil = 0;
  }
  function startMatch(town, mode, teams) {
    const z = world.addPvpInstance(town), M = MODES[mode];
    const m = { id: seq++, z, mode, town, teams, startAt: Date.now() + 3000, endAt: Date.now() + 3000 + M.time, over: false };
    matches.set(z.id, m);
    teams.forEach((tm, side) => tm.forEach((p, i) => {
      p.match = m.id; p.team = side; p.matchZone = z.id;
      d.moveToZone(p, z.id, place(z, side, i, tm.length));
      prep(p);
      const foes = teams[1 - side].map((o) => `${o.name} (${o.hero.name}, ${o.char.level})`).join(', ');
      p.socket.emit('chat', { sys: true, text: `⚔️ ${M.name}: против ${foes}. Бой через 3 секунды!` });
      p.socket.emit('arenaQ', null);
    }));
  }
  const alive = (p, m) => p && players.has(p.id) && p.match === m.id && p.zone === m.z.id && !p.dead;
  const hpShare = (tm) => { const all = tm.filter((p) => players.has(p.id)); return all.reduce((s, p) => s + (p.dead ? 0 : Math.max(0, p.hp) / p.maxHp), 0) / Math.max(1, tm.length); };

  function finish(m, winSide, why) {
    if (m.over) return;
    m.over = true;
    const M = MODES[m.mode];
    if (m.solo) return finishSolo(m, winSide === 0, why);
    const rating = (tm) => tm.reduce((s, p) => s + arenaOf(d.getProfile(p.uid)).rating, 0) / tm.length;
    const rA = rating(m.teams[0]), rB = rating(m.teams[1]);
    m.teams.forEach((tm, side) => {
      const win = side === winSide, draw = winSide == null;
      const exp = 1 / (1 + 10 ** (((side ? rA : rB) - (side ? rB : rA)) / 400));
      const delta = draw ? 0 : Math.round(28 * ((win ? 1 : 0) - exp));
      for (const p of tm) {
        if (!players.has(p.id)) continue;
        const pr = d.getProfile(p.uid), a = arenaOf(pr);
        a.rating = Math.max(0, a.rating + delta); if (!draw) { if (win) a.wins++; else a.losses++; }
        addPoints(pr, win ? TOUR_PTS.win : TOUR_PTS.loss);
        a.hero = p.heroId; a.name = p.name;
        const gold = win ? 40 * (world.byId.get(m.town).tier || 1) : draw ? 15 : 10;
        pr.gold += gold;
        d.addPassXp(pr, win ? 8 : 3);
        d.quest(p.uid, 'arena');
        p.socket.emit('matchEnd', { mode: M.name, win, draw, delta, rating: a.rating, gold, why });
        p.socket.emit('chat', { sys: true, text: `${draw ? '🤝 Ничья' : win ? '🏆 Победа' : '💀 Поражение'} · ${M.name}${why ? ` (${why})` : ''} · рейтинг ${delta >= 0 ? '+' : ''}${delta} → ${a.rating} · +${gold} 💰` });
      }
    });
    setTimeout(() => close(m), 3500);
  }
  function close(m) {
    for (const tm of m.teams) for (const p of tm) {
      if (!players.has(p.id) || p.match !== m.id) continue;
      p.match = null; p.team = null; p.matchZone = null;
      d.revive(p);
      d.moveToZone(p, m.town);
    }
    for (const mon of monsters.values()) if (mon.zone === m.z.id) monsters.delete(mon.id);
    matches.delete(m.z.id);
    world.removeZone(m.z);
  }

  // ---------- Клон и тень чемпиона ----------
  function copyFighter(z, pos, heroId, stats, name, lvl, mult) {
    const h = C.HEROES[heroId];
    const base = h.range > 100 ? 'darkHunter' : 'orcWarrior'; // поведение: стрелок или боец ближнего боя
    const mon = d.D.create(z, base, pos, lvl, { rank: 'normal', name, lootMult: 0, aggro: 2000 });
    mon.hp = mon.maxHp = Math.round(stats.maxHp * mult.hp);
    mon.dmg = stats.dmg * mult.dmg; mon.cd = h.cooldown * 1.1; mon.range = h.range > 100 ? h.range : 0;
    mon.speed = Math.round(h.speed * 0.95); mon.xp = 0; mon.size = 1.1;
    mon.heroSkin = heroId;
    return mon;
  }
  function startSolo(p, town, mode) {
    const z = world.addPvpInstance(town), M = MODES[mode];
    const m = { id: seq++, z, mode, town, teams: [[p], []], solo: true, startAt: Date.now() + 3000, endAt: Date.now() + 3000 + M.time, over: false };
    matches.set(z.id, m);
    p.match = m.id; p.team = 0; p.matchZone = z.id;
    d.moveToZone(p, z.id, place(z, 0, 0, 1));
    prep(p);
    let foe;
    if (mode === 'clone') {
      foe = copyFighter(z, place(z, 1, 0, 1), p.heroId, p, `Клон: ${p.hero.name}`, p.char.level, { hp: 1.5, dmg: 0.9 });
      p.socket.emit('chat', { sys: true, text: '🪞 Бой с клоном: перед вами ваша копия — то же здоровье (×1.5) и урон. Победите себя!' });
    } else {
      // Тень чемпиона: герой и сила лучшего игрока по рейтингу (не вы); если чемпиона нет — усиленный клон
      const pr = d.getProfile(p.uid);
      const top = Object.entries(d.profiles()).filter(([uid, o]) => uid !== p.uid && o.arena && o.arena.hero && C.HEROES[o.arena.hero])
        .sort((a, b) => b[1].arena.rating - a[1].arena.rating)[0];
      if (top) {
        const [uid, o] = top, lvl = (o.chars[o.arena.hero] || { level: 1 }).level, st = d.statsFor(o.arena.hero, lvl, o);
        // Сила тени подстраивается под ваш уровень, чтобы бой был честным
        const k = (d.statsFor(p.heroId, p.char.level, pr).maxHp / Math.max(1, st.maxHp)) ** 0.5;
        foe = copyFighter(z, place(z, 1, 0, 1), o.arena.hero, { maxHp: st.maxHp * k, dmg: st.dmg * k }, `Тень: ${o.arena.name || 'чемпион'} · ${C.HEROES[o.arena.hero].name}`, p.char.level, { hp: 1.7, dmg: 1 });
        p.socket.emit('chat', { sys: true, text: `👤 Тень чемпиона: ${o.arena.name || 'чемпион'} (рейтинг ${o.arena.rating}) — ${C.HEROES[o.arena.hero].name}. Уровень тени подстроен под ваш.` });
      } else {
        foe = copyFighter(z, place(z, 1, 0, 1), p.heroId, p, `Тень: ${p.hero.name}`, p.char.level, { hp: 1.9, dmg: 1.05 });
        p.socket.emit('chat', { sys: true, text: '👤 Чемпиона пока нет — сражайтесь с усиленной тенью себя.' });
      }
    }
    foe.arenaMatch = m.id;
    foe.stunUntil = m.startAt; // ждёт отсчёта
    m.foe = foe.id;
  }
  function finishSolo(m, win, why) {
    const p = m.teams[0][0], M = MODES[m.mode];
    if (players.has(p.id)) {
      const pr = d.getProfile(p.uid), t = tries(pr, m.mode);
      const rewarded = (t[m.mode] || 0) < M.perDay;
      let gold = 0;
      if (rewarded) {
        t[m.mode] = (t[m.mode] || 0) + 1;
        gold = (win ? (m.mode === 'champion' ? 120 : 60) : 15) * (world.byId.get(m.town).tier || 1);
        pr.gold += gold; d.addPassXp(pr, win ? 6 : 2); d.quest(p.uid, 'arena');
        if (win && m.mode === 'champion') { pr.gems = (pr.gems || 0) + 30; }
      }
      p.socket.emit('matchEnd', { mode: M.name, win, gold, why });
      p.socket.emit('chat', { sys: true, text: `${win ? '🏆 Победа' : '💀 Поражение'} · ${M.name}${why ? ` (${why})` : ''}${gold ? ` · +${gold} 💰` : ''}${win && m.mode === 'champion' && rewarded ? ' · +30 💎' : ''} · наград сегодня: ${t[m.mode] || 0}/${M.perDay}` });
    }
    setTimeout(() => close(m), 3000);
  }

  // ---------- Ход матчей ----------
  function tick(now) {
    for (const m of matches.values()) {
      if (m.over) continue;
      const M = MODES[m.mode];
      // До начала боя: оглушение на время отсчёта
      if (now < m.startAt) { for (const tm of m.teams) for (const p of tm) if (players.has(p.id)) p.cc = { type: 'stun', until: m.startAt }; continue; }
      if (m.solo) {
        const p = m.teams[0][0], foe = monsters.get(m.foe);
        if (!foe) finish(m, 0, 'соперник повержен');
        else if (!alive(p, m)) finish(m, 1, players.has(p.id) && p.zone === m.z.id ? 'герой пал' : 'вы покинули арену');
        else if (now >= m.endAt) finish(m, Math.max(0, p.hp) / p.maxHp > foe.hp / foe.maxHp ? 0 : 1, 'время вышло');
        else send(m, now, [[p.name, p.hp / p.maxHp]], [[foe.name, foe.hp / foe.maxHp]]);
        continue;
      }
      const A = m.teams[0].some((p) => alive(p, m)), B = m.teams[1].some((p) => alive(p, m));
      if (!A || !B) finish(m, A ? 0 : B ? 1 : null, 'соперники повержены');
      else if (now >= m.endAt) { const a = hpShare(m.teams[0]), b = hpShare(m.teams[1]); finish(m, Math.abs(a - b) < 0.02 ? null : a > b ? 0 : 1, 'время вышло'); }
      else send(m, now, m.teams[0].map((p) => [p.name, alive(p, m) ? p.hp / p.maxHp : 0]), m.teams[1].map((p) => [p.name, alive(p, m) ? p.hp / p.maxHp : 0]));
    }
  }
  function send(m, now, a, b) {
    if ((m.sentAt || 0) + 1000 > now) return;
    m.sentAt = now;
    for (const [side, tm] of m.teams.entries()) for (const p of tm) {
      if (!players.has(p.id) || p.match !== m.id) continue;
      p.socket.emit('match', { mode: MODES[m.mode].name, left: Math.max(0, m.endAt - now), me: side ? b : a, foe: side ? a : b });
    }
  }
  setInterval(() => { matchmake(); tick(Date.now()); }, 250);

  // Друзья по команде друг друга не бьют; павший в матче не возрождается до конца боя
  const sameTeam = (a, b) => a.match && a.match === b.match && a.team === b.team;
  const holdsDeath = (p) => !!p.match;
  const info = (p) => ({
    modes: Object.entries(MODES).map(([id, M]) => ({ id, name: M.name, solo: !!M.solo, perDay: M.perDay || 0,
      left: M.solo ? M.perDay - (tries(d.getProfile(p.uid), id)[id] || 0) : null,
      waiting: !M.solo && world.byId.get(p.zone)?.kind === 'town' ? (queues[qKey(p.zone, id)] || []).reduce((s, e) => s + e.ids.length, 0) : 0 })),
    queued: (inQueue(p) || [null])[0]?.split(':')[1] || null,
    tour: tourInfo(p),
  });
  function tourInfo(p) {
    const wk = weekKey(), list = ranking(wk), me = d.getProfile(p.uid);
    const place = list.findIndex((t) => t.uid === p.uid) + 1;
    return { ends: weekEnd(), my: me.tour && me.tour.week === wk ? me.tour.pts : 0, place, top: list.slice(0, 10).map(({ name, pts, hero }) => ({ name, pts, hero })),
      prizes: TOUR_PRIZE, pts: TOUR_PTS, last: tour.last };
  }
  return { join, leave, info, tourInfo, addPoints, sameTeam, holdsDeath, matches, MODES };
};
