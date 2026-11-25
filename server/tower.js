// Бесконечная башня: одиночное испытание силы героя. Этаж — комната с монстрами, 90 секунд на этаж.
// Каждый 5-й этаж — полубосс, каждый 10-й — босс. Монстры растут с этажом (уровень 3 + этаж до 60, дальше +7% за этаж).
// Без зелий и без автобоя (зона как у выживания). Погиб или не успел — попытка окончена.
// 3 попытки в день; новая попытка — с лучшего этажа недели минус 5 (кратно 5 + 1).
// Награды: за каждый новый (выше прежнего рекорда за всё время) этаж — золото и пыль, каждый 5-й — ядро мира,
// каждый 10-й — 30 💎. Неделя (с понедельника, МСК): топ-10 по лучшему этажу получают самоцветы.
module.exports = function createTower(dep) {
  const { world, players, monsters, D, X, store, getProfile, profilesFn, notifyUid, moveToZone, markDirty, I, evCast } = dep;
  const T = { floorMs: 90e3, tries: 3, back: 5, prize: [500, 300, 200, 100, 100, 100, 100, 100, 100, 100], startDelay: 3000 };
  const st = store.readJSON('tower.json', null) || { paidWk: null };
  const save = () => { try { store.writeJSON('tower.json', st); } catch (e) { console.error('tower save', e.message); } };
  const runs = new Map(); // zoneId → { uid, floor, endAt, nextAt, cleared }
  const msk = (t = Date.now()) => new Date(t + 3 * 36e5);
  const dayKey = () => msk().toISOString().slice(0, 10);
  const weekKey = (t = Date.now()) => { const d = msk(t); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); };
  const my = (pr) => { const t = (pr.tower ??= { max: 0, wk: null, wkBest: 0, day: null, tries: 0 }); if (t.wk !== weekKey()) { t.wk = weekKey(); t.wkBest = 0; } if (t.day !== dayKey()) { t.day = dayKey(); t.tries = 0; } return t; };
  const townFor = (lv) => (lv < 16 ? 'town1' : lv < 31 ? 'town2' : 'town3');

  function spawnFloor(R) {
    const z = R.z, f = R.floor, lv = Math.min(60, 3 + f), over = f > 57 ? Math.pow(1.07, f - 57) : 1;
    const town = townFor(lv), dgs = X.DUNGEONS[town];
    const dg = dgs[Math.min(dgs.length - 1, Math.floor(((f - 1) % 30) / 5))];
    const pool = dg.pool, c = z.abs(15, 15), boss = f % 10 === 0, mini = !boss && f % 5 === 0;
    const n = Math.min(12, (boss || mini ? 2 : 4) + Math.floor(f / 4));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, r = 8 * 32;
      const m = D.create(z, pool[Math.floor(Math.random() * pool.length)], { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }, lv,
        { rank: f >= 3 && Math.random() < 0.2 ? 'magic' : 'normal', aggro: 2000, lootMult: 0, xpMult: 0.3, hpMult: over, dmgMult: over });
      m.tower = true;
    }
    if (boss || mini) {
      const m = D.create(z, boss ? dg.boss : dg.minis[0], { x: c.x, y: c.y - 7 * 32 }, lv, { rank: boss ? 'boss' : 'mini', aggro: 2000, lootMult: 0, xpMult: 0.3, hpMult: over * (boss ? 0.6 : 1), dmgMult: over });
      m.tower = true; m.contrib = null;
    }
    R.endAt = Date.now() + T.floorMs; R.cleared = false;
    const o = players.get(R.pid);
    if (o) { o.socket.emit('chat', { sys: true, text: `🗼 Этаж ${f}${boss ? ' · БОСС' : mini ? ' · полубосс' : ''} — 90 секунд` }); o.socket.emit('tower', { floor: f, endAt: R.endAt }); }
  }
  function enter(p) {
    const pr = getProfile(p.uid), t = my(pr), z0 = world.byId.get(p.zone);
    if (!z0 || z0.kind !== 'town') return { error: 'Войти в башню можно из города' };
    if (p.party) return { error: 'Башня — одиночное испытание: выйдите из группы' };
    if (p.char.level < 5) return { error: 'Башня — с 5 уровня' };
    if (t.tries >= T.tries) return { error: 'Попытки на сегодня закончились — новые завтра' };
    if (p.autofarm) return { error: 'Выключите автобой' };
    t.tries++;
    const start = Math.max(1, Math.floor(Math.max(0, t.wkBest - T.back) / 5) * 5 + 1);
    const z = world.addSurvival(z0.id);
    z.name = 'Бесконечная башня'; z.sub = 'испытание силы'; z.tower = true;
    const R = { z, pid: p.id, uid: p.uid, floor: start, endAt: 0, nextAt: Date.now() + T.startDelay, cleared: true, startFloor: start };
    runs.set(z.id, R);
    moveToZone(p, z.id);
    p.socket.emit('chat', { sys: true, text: `🗼 Бесконечная башня: начинаете с ${start} этажа. Зелья и автобой здесь не работают. Попытка ${t.tries}/${T.tries}` });
    return { close: true };
  }
  function reward(o, pr, f) {
    const t = my(pr);
    t.wkBest = Math.max(t.wkBest, f);
    if (f <= t.max) return '';
    t.max = f;
    const tier = f >= 41 ? 3 : f >= 21 ? 2 : 1, gold = 20 * f;
    pr.gold = (pr.gold || 0) + gold;
    const got = [`${gold} 💰`];
    if (f % 2 === 0) { I.addMat(pr, 'dust', 1); got.push('1 пыль'); }
    if (f % 5 === 0) { I.addMat(pr, `core${tier}`, 1); got.push('ядро'); }
    if (f % 10 === 0) { pr.gems = (pr.gems || 0) + 30; got.push('30 💎'); }
    if (f % 25 === 0) evCast({ ev: 'boss', text: `🗼 ${o.name} поднялся на ${f} этаж Бесконечной башни!` });
    return ` Новый рекорд: ${got.join(', ')}`;
  }
  function end(R, why) {
    runs.delete(R.z.id);
    for (const m of [...monsters.values()]) if (m.zone === R.z.id) monsters.delete(m.id);
    const o = players.get(R.pid), pr = getProfile(R.uid), t = my(pr);
    const done = R.cleared ? R.floor : R.floor - 1;
    if (o) {
      if (o.zone === R.z.id && !o.dead) moveToZone(o, R.z.town);
      o.socket.emit('chat', { sys: true, text: `🗼 Попытка окончена (${why}). Пройдено этажей: ${Math.max(0, done - R.startFloor + 1)}, лучший за неделю: ${t.wkBest}, рекорд: ${t.max}` });
      o.socket.emit('tower', null);
      markDirty(o);
    }
    world.removeZone(R.z);
    dep.save();
  }
  // Недельные призы: в понедельник за прошлую неделю (один раз)
  function weekly() {
    const prev = weekKey(Date.now() - 7 * 864e5);
    if (st.paidWk === prev || weekKey() === prev) return;
    const list = Object.entries(profilesFn()).filter(([, pr]) => pr.tower && pr.tower.wk === prev && pr.tower.wkBest > 0)
      .sort((a, b) => b[1].tower.wkBest - a[1].tower.wkBest).slice(0, T.prize.length);
    list.forEach(([uid, pr], i) => { pr.gems = (pr.gems || 0) + T.prize[i]; notifyUid(uid, `🗼 Башня: ${i + 1} место за неделю (${pr.tower.wkBest} этаж) — +${T.prize[i]} 💎`); });
    st.paidWk = prev; save(); dep.save();
  }
  function tick(now = Date.now()) {
    for (const R of [...runs.values()]) {
      const o = players.get(R.pid);
      // Погиб — ждём, пока обычное возрождение вернёт героя в город (зону удаляем только пустой)
      if (o && o.dead && o.zone === R.z.id) { R.died = true; continue; }
      if (!o || o.zone !== R.z.id) { end(R, R.died ? 'герой погиб' : 'вы вышли'); continue; }
      const left = [...monsters.values()].some((m) => m.zone === R.z.id);
      if (!R.cleared && !left) {
        R.cleared = true; R.nextAt = now + 3000;
        const pr = getProfile(R.uid);
        o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.3); o.res = Math.min(o.resMax || o.res, (o.res || 0) + (o.resMax || 0) * 0.3); markDirty(o); // передышка: +30%
        o.socket.emit('chat', { sys: true, text: `✅ Этаж ${R.floor} пройден!${reward(o, pr, R.floor)}` });
        dep.save();
        continue;
      }
      if (!R.cleared && now > R.endAt) { end(R, 'время вышло'); continue; }
      if (R.cleared && now >= R.nextAt) { if (R.endAt) R.floor++; spawnFloor(R); }
    }
  }
  function top() {
    const wk = weekKey();
    return Object.values(profilesFn()).filter((pr) => pr.tower && pr.tower.wk === wk && pr.tower.wkBest > 0)
      .sort((a, b) => b.tower.wkBest - a.tower.wkBest).slice(0, 10).map((pr) => ({ name: pr.nick || pr.name || 'игрок', f: pr.tower.wkBest }));
  }
  function act(p, d) {
    if (d.op === 'towerEnter') return enter(p);
    const t = my(getProfile(p.uid));
    return { max: t.max, wkBest: t.wkBest, tries: T.tries - t.tries, triesMax: T.tries, start: Math.max(1, Math.floor(Math.max(0, t.wkBest - T.back) / 5) * 5 + 1), top: top(), prize: T.prize };
  }
  setInterval(() => { try { tick(); } catch (e) { console.error('tower tick', e); } }, 500);
  setInterval(() => { try { weekly(); } catch (e) { console.error('tower weekly', e); } }, 60e3);
  return { act, isTower: (zid) => runs.has(zid) };
};
