// Задания (окно «Квесты»): ежедневные, еженедельные и ежемесячные.
// Прогресс хранится в профиле: pr.quests[period] = { key, prog: { id: n }, claimed: { id: true } }.
// Новый период (день по UTC, неделя с понедельника, месяц) — прогресс обнуляется.
// track(uid, type, n, info) вызывается из боя и меты: kill, elite, boss, world, dungeon, survival (рекорд волны), summon, arena.
// Награда забирается вручную кнопкой; за каждое задание — очки событий для месячного задания.

const PERIODS = ['daily', 'weekly', 'monthly'];
const POINTS = { daily: 10, weekly: 40, monthly: 0 };

// [id, иконка, название, описание, тип, цель, мир (null — любой), награда]
// Награда: gems — самоцветы (160 = призыв); gold умножается на мир игрока (×1/×2/×3), mats ore/ess/core — материалы мира
const DEFS = {
  daily: [
    ['d_kill1', '🗡️', 'Охотник долины', 'Победите 30 монстров мира Эльдмира', 'kill', 30, 1, { gold: 150, gems: 20, passXp: 15 }],
    ['d_kill2', '🔥', 'Пепельная жатва', 'Победите 50 монстров мира Морграта', 'kill', 50, 2, { gold: 200, gems: 20, passXp: 15 }],
    ['d_kill3', '☁️', 'Небесный дозор', 'Победите 80 монстров мира Аэлиона', 'kill', 80, 3, { gold: 250, gems: 20, passXp: 15 }],
    ['d_elite', '⭐', 'Охота на сильных', 'Победите 5 усиленных, редких монстров или полубоссов', 'elite', 5, null, { gold: 120, gems: 20, mats: { ess: 3 }, passXp: 10 }],
    ['d_dungeon', '🗺️', 'Покоритель лабиринта', 'Победите полубосса или босса в данже', 'dungeon', 1, null, { gold: 200, gems: 20, mats: { ore: 5 }, passXp: 20 }],
    ['d_summon', '🎰', 'Удача дня', 'Сделайте 1 призыв героя или предмета', 'summon', 1, null, { gold: 100, gems: 20, passXp: 10 }],
    ['d_arena', '🏟️', 'Разминка на арене', 'Проведите 2 боя на PvP-арене', 'arena', 2, null, { gold: 120, gems: 20, passXp: 10 }],
  ],
  weekly: [
    ['w_kill', '⚔️', 'Крестовый поход', 'Победите 600 монстров в любых мирах', 'kill', 600, null, { gold: 800, gems: 120, mats: { ess: 10 }, passXp: 60 }],
    ['w_boss', '👑', 'Гроза боссов', 'Победите 5 боссов данжей', 'boss', 5, null, { gold: 900, gems: 120, itemSpins: 1, passXp: 60 }],
    ['w_dungeon', '🏰', 'Знаток подземелий', 'Победите 10 полубоссов или боссов данжей', 'dungeon', 10, null, { gold: 1000, gems: 120, mats: { core: 1 }, passXp: 70 }],
    ['w_survival', '💀', 'Несломленный', 'Дойдите до 10-й волны в данже выживания', 'survival', 10, null, { gold: 700, gems: 120, mats: { scrollE: 1 }, passXp: 50 }],
    ['w_world', '🐉', 'Победитель исполина', 'Победите мирового босса', 'world', 1, null, { gold: 1200, gems: 120, itemSpins: 1, passXp: 80 }],
  ],
  monthly: [
    ['m_points', '🏆', 'Герой месяца', 'Наберите 600 очков событий: 10 за ежедневное задание, 40 за еженедельное', 'points', 600, null, { gold: 3000, gems: 400, itemSpins: 3, mats: { scrollL: 1 }, passXp: 200 }],
    ['m_dungeon', '🗝️', 'Хозяин лабиринтов', 'Победите 40 полубоссов или боссов данжей', 'dungeon', 40, null, { gold: 2500, gems: 400, mats: { core: 3 }, passXp: 150 }],
    ['m_heroes', '🧙', 'Коллекционер', 'Соберите 15 разных героев', 'heroes', 15, null, { gold: 2000, gems: 400, itemSpins: 2, passXp: 120 }],
  ],
};
// ---------- Сюжет: цепочка шагов, ведущая по игре ----------
// [id, глава, иконка, название, подсказка (что сделать и где), тип, цель, награда]
// Типы: события (как у заданий) + dungeonEnter, equip, buy, socket, arena; level и town — по значению (уровень героя, номер мира)
const STORY = [
  ['s1', 1, '🌀', 'Путь в подземелье', 'Порталы в данжи стоят на севере Эльдмира. Подойдите к «Гоблинской опушке» — вход сработает сам.', 'dungeonEnter', 1, { gold: 100, gems: 20 }],
  ['s2', 1, '🗡️', 'Первая охота', 'Победите 10 монстров в данже. Тап по монстру — герой сам подойдёт и ударит.', 'kill', 10, { gold: 150, mats: { potHp: 3 } }],
  ['s3', 1, '🛡️', 'Снаряжение героя', 'Откройте «Герой» → тап по ячейке → наденьте подходящую вещь из гардероба.', 'equip', 1, { gold: 150, gems: 20 }],
  ['s4', 1, '🧪', 'Лавка эликсиров', 'Купите любой товар в лавке эликсиров в городе — зелья лечат в бою.', 'buy', 1, { gold: 200 }],
  ['s5', 1, '⬆️', 'Растущая сила', 'Достигните 5 уровня героя — охотьтесь в данжах.', 'level', 5, { gold: 300, gems: 40 }],
  ['s6', 1, '🎰', 'Алтарь призыва', 'Сделайте призыв героя или снаряжения («Призыв» внизу экрана).', 'summon', 1, { gems: 80 }],
  ['s7', 1, '⭐', 'Сильные противники', 'Победите 3 усиленных или редких монстра (синие и жёлтые имена).', 'elite', 3, { gold: 300, mats: { ess1: 3 } }],
  ['s8', 1, '💠', 'Сила рун', 'Вставьте руну в оружие: карточка руны → «Вставить», руны продаются в рунной мастерской.', 'socket', 1, { gold: 300, gems: 40 }],
  ['s9', 1, '🏟️', 'Испытание арены', 'Проведите бой на PvP-арене — например, с клоном (дом арены в городе).', 'arena', 1, { gold: 400, gems: 40 }],
  ['s10', 1, '⭐', 'Страж лабиринта', 'Победите полубосса в данже — они появляются каждый час.', 'dungeon', 1, { gold: 500, gems: 60, mats: { ore1: 10 } }],
  ['s11', 1, '⬆️', 'Закалённый боец', 'Достигните 10 уровня.', 'level', 10, { gold: 600, itemSpins: 1 }],
  ['s12', 1, '👑', 'Хозяин подземелья', 'Победите босса данжа вместе с группой — он приходит в 12:00, 18:00 и 23:00 МСК, ворота его комнаты откроются.', 'boss', 1, { gold: 800, gems: 100 }],
  ['s13', 2, '⬆️', 'Готов к Бездне', 'Достигните 15 уровня — откроется путь в Морграт.', 'level', 15, { gold: 1000, gems: 80 }],
  ['s14', 2, '🏰', 'Город над Бездной', 'Телепорт в центре Эльдмира → Морграт.', 'town', 2, { gold: 1500, gems: 100, mats: { core2: 1 } }],
  ['s15', 2, '👹', 'Победитель исполина', 'Победите мирового босса вместе с другими игроками (портал «Мировой босс» в городе).', 'world', 1, { gold: 2000, gems: 160, itemSpins: 1 }],
  ['s16', 2, '⬆️', 'Путь к небесам', 'Достигните 30 уровня.', 'level', 30, { gold: 3000, gems: 160 }],
  ['s17', 3, '☁️', 'Небесная цитадель', 'Телепорт → Аэлион.', 'town', 3, { gold: 4000, gems: 200, mats: { core3: 1 } }],
  ['s18', 3, '🌟', 'Легенда Аэлиона', 'Достигните 40 уровня и станьте легендой мира.', 'level', 40, { gold: 8000, gems: 400, itemSpins: 3 }],
].map(([id, ch, icon, name, desc, type, goal, reward]) => ({ id, ch, icon, name, desc, type, goal, reward }));
const CHAPTERS = { 1: 'Глава I · Солнечная долина', 2: 'Глава II · Город над Бездной', 3: 'Глава III · Небесная цитадель' };
const BY_ID = {};
for (const per of PERIODS) for (const d of DEFS[per]) BY_ID[d[0]] = { per, id: d[0], icon: d[1], name: d[2], desc: d[3], type: d[4], goal: d[5], tier: d[6], reward: d[7] };

// Ключ и конец периода (UTC)
function periodKey(per, t = Date.now()) {
  const d = new Date(t);
  if (per === 'daily') return d.toISOString().slice(0, 10);
  if (per === 'monthly') return d.toISOString().slice(0, 7);
  const day = (d.getUTCDay() + 6) % 7; // понедельник = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}
function periodEnd(per, t = Date.now()) {
  const d = new Date(t);
  if (per === 'daily') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  if (per === 'monthly') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 7);
}

module.exports = function createQuests(deps) {
  // deps: { getProfile, notifyUid, reward(pr, r, tier), addPassXp(pr, n), save() }
  function state(pr, per) {
    pr.quests = pr.quests || {};
    const key = periodKey(per);
    if (!pr.quests[per] || pr.quests[per].key !== key) pr.quests[per] = { key, prog: {}, claimed: {} };
    return pr.quests[per];
  }
  // Сюжет: pr.story = { i — номер текущего шага, prog, done — шаг выполнен, награда ждёт }
  const storyOf = (pr) => (pr.story ??= { i: 0, prog: 0 });
  const maxLevel = (pr) => Math.max(1, ...Object.values(pr.chars || {}).map((c) => c.level || 1));
  function storyProg(pr) {
    const s = storyOf(pr), q = STORY[s.i];
    if (!q) return 0;
    if (q.type === 'level') return Math.min(q.goal, maxLevel(pr));
    if (q.type === 'town') return (pr.townMax || 1) >= q.goal ? q.goal : 0;
    return Math.min(q.goal, s.prog);
  }
  function storyTrack(uid, pr, type, n) {
    const s = storyOf(pr), q = STORY[s.i];
    if (!q || q.type !== type || type === 'level' || type === 'town' || s.prog >= q.goal) return;
    s.prog = Math.min(q.goal, s.prog + n);
    if (s.prog >= q.goal) deps.notifyUid(uid, `📜 Сюжет: «${q.name}» выполнено — заберите награду в «Квестах»`);
  }
  function storyView(pr, tier) {
    const s = storyOf(pr), q = STORY[s.i];
    return { step: s.i, total: STORY.length, chapter: q ? CHAPTERS[q.ch] : 'Сюжет пройден',
      cur: q ? { id: q.id, icon: q.icon, name: q.name, desc: q.desc, goal: q.goal, prog: storyProg(pr), reward: rewardText(q.reward, tier) } : null,
      done: STORY.slice(0, s.i).map((x) => ({ icon: x.icon, name: x.name })) };
  }
  function storyClaim(pr, tier) {
    const s = storyOf(pr), q = STORY[s.i];
    if (!q) return { error: 'Сюжет пройден' };
    if (storyProg(pr) < q.goal) return { error: 'Шаг ещё не выполнен' };
    const msg = deps.reward(pr, { gold: q.reward.gold, gems: q.reward.gems, itemSpins: q.reward.itemSpins, mats: q.reward.mats }, tier);
    s.i += 1; s.prog = 0;
    deps.save();
    const nx = STORY[s.i];
    return { toast: `📖 ${q.name}: ${msg}${nx ? ` · дальше: «${nx.name}»` : ' · сюжет пройден!'}` };
  }
  const progOf = (pr, q) => (q.type === 'heroes' ? (pr.heroes || []).length : state(pr, q.per).prog[q.id] || 0);

  // Засчитать действие; n — количество (для survival — номер волны, берётся максимум)
  function track(uid, type, n = 1, info = {}) {
    const pr = deps.getProfile(uid);
    if (!pr) return;
    if (type === 'town') pr.townMax = Math.max(pr.townMax || 1, n);
    storyTrack(uid, pr, type, type === 'town' ? 0 : n);
    if (type === 'level' || type === 'town') { const q = STORY[storyOf(pr).i]; if (q && q.type === type && storyProg(pr) >= q.goal && !storyOf(pr).told) { storyOf(pr).told = q.id; deps.notifyUid(uid, `📜 Сюжет: «${q.name}» выполнено — заберите награду в «Квестах»`); } }
    const done = [];
    for (const q of Object.values(BY_ID)) {
      if (q.type !== type || (q.tier && q.tier !== info.tier)) continue;
      const st = state(pr, q.per);
      const before = st.prog[q.id] || 0;
      if (before >= q.goal) continue;
      st.prog[q.id] = type === 'survival' ? Math.max(before, n) : before + n;
      if (st.prog[q.id] >= q.goal) { st.prog[q.id] = q.goal; done.push(q); }
    }
    for (const q of done) deps.notifyUid(uid, `📜 Задание выполнено: «${q.name}» — заберите награду в «Квестах»`);
  }

  function view(pr, tier) {
    const out = {};
    for (const per of PERIODS) {
      const st = state(pr, per);
      out[per] = {
        endsIn: periodEnd(per) - Date.now(),
        list: DEFS[per].map((d) => BY_ID[d[0]])
          .filter((q) => !q.tier || q.tier === tier || (st.prog[q.id] || 0) > 0)
          .map((q) => ({ id: q.id, icon: q.icon, name: q.name, desc: q.desc, goal: q.goal, prog: Math.min(q.goal, progOf(pr, q)), claimed: !!st.claimed[q.id],
            reward: rewardText(q.reward, tier), points: POINTS[per] })),
      };
    }
    return out;
  }
  function rewardText(r, tier) {
    const parts = [];
    if (r.gold) parts.push(`💰 ${r.gold * tier}`);
    if (r.gems) parts.push(`💎 ${r.gems}`);
    if (r.itemSpins) parts.push(`🎁 ×${r.itemSpins}`);
    if (r.mats) parts.push(...Object.entries(r.mats).map(([k, n]) => `${{ ore: '⛏️', ess: '✨', core: '💠', scrollE: '📜', scrollL: '📜' }[k] || '📦'} ×${n}`));
    if (r.passXp) parts.push(`🎟️ +${r.passXp}`);
    return parts.join(' · ');
  }

  function claim(pr, id, tier) {
    const q = BY_ID[id];
    if (!q) return { error: 'Нет такого задания' };
    const st = state(pr, q.per);
    if (st.claimed[id]) return { error: 'Награда уже получена' };
    if (progOf(pr, q) < q.goal) return { error: 'Задание ещё не выполнено' };
    st.claimed[id] = true;
    const r = q.reward;
    const msg = deps.reward(pr, { gold: (r.gold || 0) * tier, gems: r.gems, itemSpins: r.itemSpins, mats: r.mats }, tier);
    if (r.passXp) deps.addPassXp(pr, r.passXp);
    if (POINTS[q.per]) {
      const m = state(pr, 'monthly');
      const pq = BY_ID.m_points;
      m.prog.m_points = Math.min(pq.goal, (m.prog.m_points || 0) + POINTS[q.per]);
    }
    deps.save();
    return { toast: `Награда: ${msg}${r.passXp ? ` · опыт пропуска +${r.passXp}` : ''}`, gold: pr.gold };
  }

  // Операции окна: quests — список, questClaim — забрать награду
  function handle(p, d) {
    const pr = deps.getProfile(p.uid), tier = p.zoneTier || 1;
    if (d.op === 'questClaim') { const r = claim(pr, String(d.id || ''), tier); return { ...r, quests: view(pr, tier), story: storyView(pr, tier) }; }
    if (d.op === 'storyClaim') { const r = storyClaim(pr, tier); return { ...r, quests: view(pr, tier), story: storyView(pr, tier) }; }
    return { quests: view(pr, tier), story: storyView(pr, tier) };
  }
  // Сколько наград ждёт (для значка на кнопке «Квесты»)
  function ready(pr, tier) {
    let n = 0;
    for (const per of PERIODS) for (const q of view(pr, tier)[per].list) if (q.prog >= q.goal && !q.claimed) n++;
    const sc = STORY[storyOf(pr).i];
    if (sc && storyProg(pr) >= sc.goal) n++;
    return n;
  }

  // Текущий шаг сюжета — для подсказки на экране
  const storyNow = (pr, tier) => storyView(pr, tier).cur;
  return { track, handle, ready, storyNow, DEFS: BY_ID };
};
