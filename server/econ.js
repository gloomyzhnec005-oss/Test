// Сводка экономики по дням (МСК) для админки → «Экономика».
// Золото и самоцветы: что пришло и ушло по источникам. Действия игрока (лавки, кузница, Зал мастеров, задания…)
// меряются до/после действия (measure), убийства и авто-продажа — отдельными вызовами. Остальное (боссы, арена,
// сундуки…) попадает в «прочее»: раз в 10 минут сравниваем сумму золота у всех игроков с учтённым.
// Плюс: выпавшие легендарные и мифические вещи, покупки за Stars и TON, игроки за день и пик онлайна.
const KEEP_DAYS = 45;

module.exports = function createEcon({ store, profiles }) {
  const mskDay = (t = Date.now()) => new Date(t + 3 * 36e5).toISOString().slice(0, 10);
  const st = store.readJSON('econ.json', null) || { days: {}, last: null };
  st.days ??= {};
  st.last = null; // после перезапуска (и восстановления бэкапа) первая сверка только запоминает суммы, без скачка в «прочее»
  const day = () => {
    const k = mskDay();
    if (!st.days[k]) {
      st.days[k] = { goldIn: {}, goldOut: {}, gemsIn: {}, gemsOut: {}, items: {}, stars: { n: 0, sum: 0 }, ton: { n: 0, sum: 0 }, buys: {}, players: {}, peak: 0 };
      for (const old of Object.keys(st.days).sort().slice(0, -KEEP_DAYS)) delete st.days[old];
    }
    return st.days[k];
  };
  let pend = { gold: 0, gems: 0 }; // учтено с последней сверки (приход − расход)
  const add = (map, k, v) => { map[k] = Math.round((map[k] || 0) + v); };
  function gold(src, v) { if (!v) return; const d = day(); add(v > 0 ? d.goldIn : d.goldOut, src, Math.abs(v)); pend.gold += v; }
  function gems(src, v) { if (!v) return; const d = day(); add(v > 0 ? d.gemsIn : d.gemsOut, src, Math.abs(v)); pend.gems += v; }
  // Действие игрока: разница золота и самоцветов до и после
  function measure(src, pr, fn) {
    if (!pr) return fn();
    const g0 = pr.gold || 0, s0 = pr.gems || 0;
    try { return fn(); } finally { gold(src, (pr.gold || 0) - g0); gems(src, (pr.gems || 0) - s0); }
  }
  function item(rar, src) { if (rar === 'legendary' || rar === 'mythic') add(day().items, `${rar}:${src}`, 1); }
  function paid(kind, amount, cur) {
    const d = day(), box = cur === 'GRAM' || cur === 'TON' ? d.ton : d.stars;
    box.n += 1; box.sum = Math.round((box.sum + (Number(amount) || 0)) * 100) / 100;
    add(d.buys, kind, 1);
  }
  function active(uid) { day().players[uid] = 1; }
  function online(n) { const d = day(); if (n > d.peak) d.peak = n; }
  // Сверка: изменение суммы у всех игроков минус учтённое = «прочее»
  const totals = () => { let g = 0, s = 0; for (const pr of Object.values(profiles())) { g += pr.gold || 0; s += pr.gems || 0; } return { g, s }; };
  function reconcile() {
    const t = totals();
    if (st.last) {
      const og = t.g - st.last.g - pend.gold, os = t.s - st.last.s - pend.gems, d = day();
      if (og) add(og > 0 ? d.goldIn : d.goldOut, 'other', Math.abs(og));
      if (os) add(os > 0 ? d.gemsIn : d.gemsOut, 'other', Math.abs(os));
    }
    st.last = t; pend = { gold: 0, gems: 0 };
    save();
  }
  const save = () => { try { store.writeJSON('econ.json', st); } catch (e) { console.error('econ save', e.message); } };
  setTimeout(reconcile, 30000).unref();
  setInterval(reconcile, 10 * 60000).unref();

  function view(days = 14) {
    const keys = Object.keys(st.days).sort().slice(-days).reverse();
    return keys.map((k) => { const d = st.days[k]; return { day: k, ...d, players: Object.keys(d.players).length }; });
  }
  return { gold, gems, measure, item, paid, active, online, reconcile, view };
};
