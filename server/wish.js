// Призыв героев: Избранный недели и Зал героев, гарант, ×10, история, осколки душ.
// Шансы игрокам не показываются — в окне только счётчики гаранта.
// Баннеры героев:
//   event    — «ивентовый»: неделя = один мифический герой и три легендарных с повышенным шансом;
//              выпал мифический не тот — следующий мифический гарантированно герой баннера (50/50), так же с легендарными.
//   standard — все герои поровну внутри редкости.
// Шансы за молитву: мифический 0.8% (с 66-й молитвы без мифического шанс растёт на 7% за каждую, на 80-й — гарант),
//   легендарный 5.5% (не реже раза в 10 молитв), эпический 14%, редкий 30%, остальное — обычный.
// Оплата одной молитвы: бесплатная первая → молитва героя (pr.paidSpins) → 160 кристаллов судьбы (pr.gems).
// Повторный герой — дубликат (+5% к силе, до 10) и звёздный блеск; сверх 10 дубликатов — двойной блеск.
// Блеск меняется на молитвы (GLITTER_PRICE).

const WEEK = 7 * 864e5;
const WEEK0 = Date.UTC(2024, 0, 1); // понедельник — начало отсчёта недель баннеров
const RATES = { mythic: 0.008, legendary: 0.055, epic: 0.14, rare: 0.3 };
const SOFT = 66, HARD = 80, LEG_EVERY = 10;
const GEMS_PER_WISH = 160;
const GLITTER = { common: 1, rare: 1, epic: 2, legendary: 5, mythic: 10 };
const GLITTER_PRICE = { hero: 20, gear: 15 }; // блеска за молитву героя / снаряжения
const HIST = 60;

module.exports = function createWish({ C, getChar, refreshUid, addPassXp, quest }) {
  const byRar = (r) => Object.keys(C.HEROES).filter((id) => C.HEROES[id].rarity === r);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // Баннер текущей недели: мифический и три легендарных героя по кругу
  function eventBanner(t = Date.now()) {
    const week = Math.floor((t - WEEK0) / WEEK), M = byRar('mythic'), L = byRar('legendary');
    return { week, mythic: M[week % M.length], legendary: [0, 1, 2].map((k) => L[(week * 3 + k) % L.length]), ends: WEEK0 + (week + 1) * WEEK };
  }

  function state(pr) {
    if (!pr.wish) pr.wish = { event: { m: 0, l: 0, gm: false, gl: false }, standard: { m: 0, l: 0 }, hist: [] };
    // Старый счётчик гаранта героя (объект) жил в pr.pity, где у снаряжения число — разводим
    if (pr.pity && typeof pr.pity === 'object') { pr.wish.standard.l = pr.pity.l || 0; pr.pity = 0; }
    pr.gems = pr.gems || 0;
    pr.glitter = pr.glitter || 0;
    return pr.wish;
  }

  function rollRarity(s, first) {
    const c = s.m + 1;
    const pM = c >= HARD ? 1 : c >= SOFT ? RATES.mythic + 0.07 * (c - SOFT + 1) : RATES.mythic;
    const r = Math.random();
    if (r < pM) return 'mythic';
    if (s.l + 1 >= LEG_EVERY || r < pM + RATES.legendary) return 'legendary';
    if (r < pM + RATES.legendary + RATES.epic) return 'epic';
    if (r < pM + RATES.legendary + RATES.epic + RATES.rare || first) return 'rare'; // первый герой — не ниже редкого
    return 'common';
  }

  function rollOne(pr, banner, ev) {
    const s = pr.wish[banner];
    const rar = rollRarity(s, !pr.heroes.length);
    let hero, featured = false;
    if (banner === 'event' && rar === 'mythic') {
      featured = s.gm || Math.random() < 0.5;
      hero = featured ? ev.mythic : pick(byRar('mythic').filter((id) => id !== ev.mythic));
      s.gm = !featured;
    } else if (banner === 'event' && rar === 'legendary') {
      featured = s.gl || Math.random() < 0.5;
      hero = featured ? pick(ev.legendary) : pick(byRar('legendary').filter((id) => !ev.legendary.includes(id)));
      s.gl = !featured;
    } else hero = pick(byRar(rar));
    s.m = rar === 'mythic' ? 0 : s.m + 1;
    s.l = rar === 'mythic' || rar === 'legendary' ? 0 : s.l + 1;
    // Герой или дубликат; блеск — за каждый повтор, вдвое — когда дубликатов уже максимум
    let dupe = 0, glitter = 0;
    if (pr.heroes.includes(hero)) {
      const max = (pr.heroDupes[hero] || 0) >= C.GACHA.heroDupeMax;
      if (!max) dupe = pr.heroDupes[hero] = (pr.heroDupes[hero] || 0) + 1;
      glitter = GLITTER[rar] * (max ? 2 : 1);
      pr.glitter += glitter;
    } else pr.heroes.push(hero);
    pr.wish.hist.unshift({ t: Date.now(), b: banner, h: hero, r: rar, f: featured ? 1 : 0 });
    return { hero, rar, dupe, glitter, featured, isNew: !dupe && !glitter };
  }

  // Списать оплату n молитв: бесплатная (только одиночная) → молитвы героя → кристаллы
  function pay(pr, n, freeAll) {
    if (freeAll) return true;
    if (n === 1 && !pr.freeSpinUsed) { pr.freeSpinUsed = true; return true; }
    const tickets = Math.min(pr.paidSpins || 0, n), gems = (n - tickets) * GEMS_PER_WISH;
    if (pr.gems < gems) return false;
    pr.paidSpins -= tickets; pr.gems -= gems;
    return true;
  }

  function pull(uid, pr, banner, n, freeAll) {
    if (!['event', 'standard'].includes(banner)) banner = 'event';
    n = n === 10 ? 10 : 1;
    state(pr);
    if (!pay(pr, n, freeAll)) return { error: 'Не хватает печатей или самоцветов', needPayment: true };
    const ev = eventBanner(), results = [];
    for (let i = 0; i < n; i++) results.push(rollOne(pr, banner, ev));
    pr.wish.hist.length = Math.min(pr.wish.hist.length, HIST);
    for (const r of results) getChar(uid, r.hero);
    if (results.some((r) => r.dupe)) refreshUid(uid);
    addPassXp(pr, 10 * n);
    quest(uid, 'summon', n);
    return { results };
  }

  // Обмен звёздного блеска на молитвы
  function exchange(pr, what, n) {
    state(pr);
    const price = GLITTER_PRICE[what];
    n = Math.max(1, Math.min(50, Math.floor(n) || 1));
    if (!price) return { error: 'Неизвестный обмен' };
    if (pr.glitter < price * n) return { error: `Нужно ${price * n} ✨ осколков душ` };
    pr.glitter -= price * n;
    if (what === 'hero') pr.paidSpins = (pr.paidSpins || 0) + n; else pr.itemSpins = (pr.itemSpins || 0) + n;
    return { ok: true };
  }

  // Что показывает клиент
  function view(pr) {
    const s = state(pr), ev = eventBanner();
    return {
      gems: pr.gems, glitter: pr.glitter, gemsPerWish: GEMS_PER_WISH, glitterPrice: GLITTER_PRICE,
      rates: RATES, soft: SOFT, hard: HARD, legEvery: LEG_EVERY,
      event: { ...ev, mythicIn: HARD - s.event.m, legIn: LEG_EVERY - s.event.l, guarM: s.event.gm, guarL: s.event.gl },
      standard: { mythicIn: HARD - s.standard.m, legIn: LEG_EVERY - s.standard.l },
      hist: s.hist.slice(0, HIST),
    };
  }

  return { pull, exchange, view, state, eventBanner, GEMS_PER_WISH, GLITTER, RATES, SOFT, HARD, LEG_EVERY };
};
