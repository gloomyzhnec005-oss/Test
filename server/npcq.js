// Задания у NPC: в каждом городе три поручителя (капитан стражи, травница, следопыт).
// У каждого — цепочка поручений по порядку (взять → выполнить → сдать), после неё — ежедневное поручение.
// Прогресс считается только по взятому заданию. Сбор материалов: при сдаче нужные материалы забираются.
// Состояние игрока: pr.npcq = { [giver]: { i, acc, prog, day, dacc, dprog, ddone } }.
const MSK = 3 * 36e5;
const dayKey = () => new Date(Date.now() + MSK).toISOString().slice(0, 10);

module.exports = function createNpcQuests({ X, I, getProfile, grantXp, refreshPlayer, notifyUid, save }) {
  const xpAt = (L) => Math.round(X.XP_NEED(Math.max(1, L)) * 0.12); // ~12% уровня за поручение
  const TOWN_TIER = { town1: 1, town2: 2, town3: 3 };
  const mobName = (id) => (X.MOBS[id] ? X.MOBS[id].name : id);

  // ---------- Поручители и цепочки ----------
  const GIVERS = {};
  const Q = {}; // id → задание
  const add = (giver, q) => { q.giver = giver; Q[q.id] = q; GIVERS[giver].chain.push(q.id); };
  for (const [town, list] of Object.entries(X.DUNGEONS)) {
    const t = TOWN_TIER[town];
    // У каждого города свои поручители (имена, внешность и характер — под мир)
    const P = {
      town1: { cap: ['Ольгерд', 'Монстры лезут из порталов всё чаще. Стража не справляется — нужна помощь героев.'],
        herb: ['Мирра', 'Для зелий и эликсиров мне вечно не хватает руды, эссенций и сердец чудовищ. Поможешь?'],
        track: ['Тейрон', 'Я выслеживаю самых опасных тварей этого мира. Докажи, что ты им ровня.'] },
      town2: { cap: ['Варгос', 'Бездна под городом не спит. Каждую ночь из разломов лезет новая нечисть — держи строй вместе со стражей.'],
        herb: ['Сайра', 'Пепел и тьма — лучшие ингредиенты, если знать, как с ними обращаться. Принеси, что найдёшь в топях.'],
        track: ['Кейл', 'Я охочусь на демонов с тех пор, как они сожгли мой дом. Хочешь в долю — докажи делом.'] },
      town3: { cap: ['Серафина', 'Небесная цитадель держится на клятве стражей. Помоги нам удержать облачные рубежи.'],
        herb: ['Лиора', 'Звёздная пыль и небесное серебро питают мой сад. Без них цветы цитадели увянут.'],
        track: ['Аэрин', 'Грифоны и драконы небес — достойная добыча. Посмотрим, сможешь ли ты угнаться за мной.'] },
    }[town];
    GIVERS[`${town}_cap`] = { id: `${town}_cap`, town, skin: 'valerian', name: 'Капитан стражи', title: P.cap[0], hello: P.cap[1], chain: [] };
    GIVERS[`${town}_herb`] = { id: `${town}_herb`, town, skin: 'nimue', name: 'Травница', title: P.herb[0], hello: P.herb[1], chain: [] };
    GIVERS[`${town}_track`] = { id: `${town}_track`, town, skin: 'faelin', name: 'Следопыт', title: P.track[0], hello: P.track[1], chain: [] };
    list.forEach((dg, i) => {
      const zone = `dg_${town}_${i}`, lv = dg.lv[0], top = dg.lv[1];
      add(`${town}_cap`, { id: `${zone}_clear`, name: `Зачистка: ${dg.name}`, desc: `Уничтожьте ${10 + i * 2} монстров в данже «${dg.name}».`,
        type: 'kill', zone, goal: 10 + i * 2, minLv: lv, reward: { gold: 40 * top, xp: xpAt(top), mats: { potHp: 3 } } });
      add(`${town}_cap`, { id: `${zone}_mini`, name: `Полубосс: ${dg.name}`, desc: `Победите полубосса данжа «${dg.name}» (${[...new Set(dg.minis.map(mobName))].join(' или ')}). Лучше идти группой.`,
        type: 'mini', zone, goal: 1, minLv: lv, reward: { gold: 90 * top, xp: xpAt(top) * 2, mats: { dust: 1 + Math.floor(i / 2) }, gems: 10 } });
    });
    // Травница: материалы своего мира
    const herb = [
      ['ore', `ore${t}`, 8, { gold: 300 * t, mats: { potHp: 5, potRes: 3 } }],
      ['ess', `ess${t}`, 5, { gold: 500 * t, mats: { elxAtk: 1, elxDef: 1 } }],
      ['ore2', `ore${t}`, 15, { gold: 700 * t, mats: { potHp2: 3, elxAgi: 1 } }],
      ['core', `core${t}`, 1, { gold: 900 * t, mats: { elxMind: 1, elxDef: 1 }, gems: 15 }],
      ['ess2', `ess${t}`, 12, { gold: 1200 * t, mats: { elxFury: 1, elxVamp: 1, luckStone: 1 }, gems: 20 }],
    ];
    herb.forEach(([k, mat, n, reward], i) => add(`${town}_herb`, { id: `${town}_herb_${k}`, name: `Сбор: ${I.MATS[mat].name}`,
      desc: `Принесите ${n} × ${I.MATS[mat].icon} ${I.MATS[mat].name}. Они падают с монстров и боссов этого мира и остаются при разборе вещей.`,
      type: 'collect', mat, goal: n, minLv: list[Math.min(i, list.length - 1)].lv[0], reward: { ...reward, xp: xpAt(list[Math.min(i * 1, 5)].lv[1]) } }));
    // Следопыт: элита, боссы, выживание, мировой босс
    const mid = list[2].lv[0], high = list[4].lv[0];
    [
      { k: 'rare', name: 'Жёлтая метка', desc: 'Выследите и победите 4 редких монстра (жёлтые имена) в данжах этого мира.', type: 'rare', goal: 4, minLv: list[0].lv[0], reward: { gold: 400 * t, xp: xpAt(list[1].lv[1]), mats: { elxWind: 1 } } },
      { k: 'surv', name: 'Испытание волнами', desc: 'Продержитесь 10 волн в Данже выживания (здание в городе).', type: 'survival', goal: 10, minLv: mid, reward: { gold: 800 * t, xp: xpAt(list[3].lv[1]), mats: { dust: 2 }, gems: 15 } },
      { k: 'boss', name: 'Свидетель бойни', desc: 'Примите участие в бою с боссом любого данжа этого мира (12:00, 18:00 или 23:00 МСК) — хватит 1% урона или 20 секунд в его комнате.', type: 'boss', goal: 1, minLv: mid, reward: { gold: 1500 * t, xp: xpAt(list[4].lv[1]) * 2, mats: { dust: 3, luckStone: 1 }, gems: 30 } },
      { k: 'rare2', name: 'Трофеи следопыта', desc: 'Победите 12 редких монстров (жёлтые имена) в данжах этого мира.', type: 'rare', goal: 12, minLv: high, reward: { gold: 1500 * t, xp: xpAt(list[5].lv[1]), mats: { skillCrystal: 1 }, gems: 20 } },
      { k: 'world', name: 'Против легенды', desc: 'Сразитесь с мировым боссом этого мира (каждый день в 21:00 МСК) и нанесите ему урон.', type: 'world', goal: 1, minLv: high, reward: { gold: 3000 * t, xp: xpAt(list[5].lv[1]) * 3, mats: { dust: 5, skillCrystal: 1 }, gems: 50 } },
    ].forEach((q) => add(`${town}_track`, { ...q, id: `${town}_track_${q.k}` }));
  }
  // Ежедневные поручения — после всей цепочки у этого поручителя
  const daily = (g) => {
    const t = TOWN_TIER[g.town], last = X.DUNGEONS[g.town][5];
    if (g.id.endsWith('_cap')) return { id: `${g.id}_daily`, name: 'Ночной дозор', desc: 'Уничтожьте 40 монстров в любых данжах этого мира.', type: 'kill', town: g.town, goal: 40, reward: { gold: 600 * t, xp: xpAt(last.lv[1]), gems: 10 } };
    if (g.id.endsWith('_herb')) return { id: `${g.id}_daily`, name: 'Пополнить кладовую', desc: `Принесите 10 × ${I.MATS[`ore${t}`].name}.`, type: 'collect', mat: `ore${t}`, goal: 10, reward: { gold: 500 * t, mats: { potHp2: 2, elxAtk: 1 }, gems: 10 } };
    return { id: `${g.id}_daily`, name: 'Свежий след', desc: 'Победите 2 редких монстра (жёлтые имена) в данжах этого мира.', type: 'rare', goal: 2, town: g.town, reward: { gold: 700 * t, xp: xpAt(last.lv[1]), mats: { dust: 1 }, gems: 10 } };
  };

  // ---------- Состояние ----------
  const st = (pr, g) => ((pr.npcq ??= {})[g] ??= { i: 0, acc: false, prog: 0 });
  // Текущее задание поручителя для игрока: { q, daily, acc, prog, ready, done (цепочка и дневное выполнены) }
  function current(pr, gid) {
    const g = GIVERS[gid], s = st(pr, gid);
    if (s.i < g.chain.length) {
      const q = Q[g.chain[s.i]], prog = q.type === 'collect' ? ((pr.mats || {})[q.mat] || 0) : s.prog;
      return { q, daily: false, acc: s.acc, prog: Math.min(prog, q.goal), ready: s.acc && prog >= q.goal };
    }
    const q = daily(g);
    if (s.day !== dayKey()) { s.day = dayKey(); s.dacc = false; s.dprog = 0; s.ddone = false; }
    if (s.ddone) return { q, daily: true, done: true };
    const prog = q.type === 'collect' ? ((pr.mats || {})[q.mat] || 0) : s.dprog || 0;
    return { q, daily: true, acc: s.dacc, prog: Math.min(prog, q.goal), ready: s.dacc && prog >= q.goal };
  }
  // Значок над поручителем: new — есть новое задание, ready — можно сдать, prog — в работе, low — нужен уровень, none — на сегодня всё
  function mark(pr, gid, lvl) {
    const c = current(pr, gid);
    if (c.done) return 'none';
    if (c.ready) return 'ready';
    if (c.acc) return 'prog';
    return c.q.minLv && lvl < c.q.minLv ? 'low' : 'new';
  }

  // ---------- Прогресс ----------
  // Событие из игры: kill {zone}, elite {zone}, mini {zone}, boss {zone}, survival {town, n — номер волны}, world {town}
  function track(uid, type, n = 1, info = {}) {
    const pr = getProfile(uid);
    if (!pr || !pr.npcq) return;
    const town = info.town || (info.zone && String(info.zone).match(/^(?:dg|wb)_(town\d)/) ? String(info.zone).match(/^(?:dg|wb)_(town\d)/)[1] : null);
    for (const [gid, s] of Object.entries(pr.npcq)) {
      const g = GIVERS[gid];
      if (!g) continue;
      const c = current(pr, gid);
      if (c.done || !c.acc || c.ready || c.q.type === 'collect' || c.q.type !== type) continue;
      const q = c.q;
      if (q.zone && q.zone !== info.zone) continue;
      if (!q.zone && town !== g.town) continue;
      const before = c.daily ? s.dprog || 0 : s.prog;
      const now = type === 'survival' ? Math.max(before, n) : before + n;
      if (c.daily) s.dprog = now; else s.prog = now;
      if (now >= q.goal && before < q.goal) notifyUid(uid, `📜 Поручение «${q.name}» выполнено — вернитесь к NPC «${g.name}» в городе за наградой`);
    }
  }

  // ---------- Действия игрока ----------
  const fmtReward = (r) => [r.gold ? `💰 ${r.gold}` : '', r.xp ? `📘 ${r.xp} опыта` : '', r.gems ? `💎 ${r.gems}` : '', ...Object.entries(r.mats || {}).map(([k, v]) => (I.MATS[k] ? `${I.MATS[k].icon} ${I.MATS[k].name}${v > 1 ? ' ×' + v : ''}` : ''))].filter(Boolean);
  function view(p, gid) {
    const g = GIVERS[gid], pr = getProfile(p.uid);
    if (!g) return { error: 'Нет такого NPC' };
    const c = current(pr, gid), s = st(pr, gid);
    return { id: gid, name: g.name, title: g.title, skin: g.skin, hello: g.hello, step: Math.min(s.i + 1, g.chain.length), total: g.chain.length,
      quest: c.done ? null : { name: c.q.name, desc: c.q.desc, goal: c.q.goal, prog: c.prog, acc: c.acc, ready: c.ready, daily: c.daily, minLv: c.q.minLv || 0, collect: c.q.type === 'collect', reward: fmtReward(c.q.reward) },
      done: !!c.done, lvl: p.char.level };
  }
  function act(p, d) {
    const gid = String(d.npc || ''), g = GIVERS[gid];
    if (!g) return { error: 'Нет такого NPC' };
    if (p.zone !== g.town) return { error: 'Подойдите к NPC в городе' };
    const pr = getProfile(p.uid), s = st(pr, gid), c = current(pr, gid);
    if (d.op === 'npcView') return view(p, gid);
    if (c.done) return { error: 'На сегодня поручений нет — приходите завтра' };
    if (d.op === 'npcAccept') {
      if (c.acc) return { error: 'Поручение уже взято' };
      if (c.q.minLv && p.char.level < c.q.minLv) return { error: `Нужен ${c.q.minLv} уровень героя` };
      if (c.daily) { s.dacc = true; s.dprog = 0; } else { s.acc = true; s.prog = 0; }
      save();
      return { toast: `📜 Взято поручение: «${c.q.name}»`, view: view(p, gid) };
    }
    if (d.op === 'npcTurnIn') {
      if (!c.ready) return { error: 'Поручение ещё не выполнено' };
      if (c.q.type === 'collect') {
        if (((pr.mats || {})[c.q.mat] || 0) < c.q.goal) return { error: 'Не хватает материалов' };
        I.takeMats(pr, { [c.q.mat]: c.q.goal });
      }
      const r = c.q.reward;
      if (r.gold) pr.gold += r.gold;
      if (r.gems) pr.gems = (pr.gems || 0) + r.gems;
      for (const [k, v] of Object.entries(r.mats || {})) if (I.MATS[k]) I.addMat(pr, k, v);
      if (r.xp) grantXp(p, r.xp, 0);
      if (c.daily) { s.ddone = true; s.dacc = false; } else { s.i++; s.acc = false; s.prog = 0; }
      refreshPlayer(p); save();
      return { toast: `✅ «${c.q.name}» сдано: ${fmtReward(r).join(', ')}`, view: view(p, gid), reward: true };
    }
    return { error: 'Неизвестное действие' };
  }
  // Значки всех поручителей города (для меток над головами)
  function marks(p, town) {
    const pr = getProfile(p.uid);
    return Object.fromEntries(Object.values(GIVERS).filter((g) => g.town === town).map((g) => [g.id, mark(pr, g.id, p.char.level)]));
  }
  return { GIVERS, track, act, marks };
};
