// Автобой без игрока: герой, оставленный в данже с включённым автобоем, фармит сам.
// Сервер вызывает обработчики настоящего сокета героя (move / attack / skill / act) — те же проверки, что у игрока
// (скорость, стены, перезарядки, ресурс), поэтому бот не сильнее живого игрока. Путь по лабиринту — поиск в ширину по клеткам.
module.exports = function createAfBot({ C, world, players, monsters, SOLID, getProfile }) {
  const deps = { getProfile };
  const TILE = C.TILE, solid = new Set(SOLID);
  const call = (p, ev, d, cb) => { const f = p.afBot && p.afBot.sock.listeners(ev)[0]; if (f) { try { f(d, cb || (() => {})); } catch (e) { console.error('afbot', ev, e.message); } } };
  const tileOf = (z, x, y) => [Math.floor((x - z.ox) / TILE), Math.floor((y - z.oy) / TILE)];
  const center = (z, tx, ty) => ({ x: z.ox + (tx + 0.5) * TILE, y: z.oy + (ty + 0.5) * TILE });
  // Поиск в ширину от героя: ближайший по пути монстр (не дальше maxSteps клеток) и путь к нему
  function plan(p, z, skip) {
    const W = z.w, H = z.h, [sx, sy] = tileOf(z, p.x, p.y), N = W * H;
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
    const prev = new Int32Array(N).fill(-1), dist = new Int16Array(N).fill(-1);
    const want = new Map();
    for (const m of monsters.values()) {
      if (m.zone !== p.zone || m.pvpOf || m.hp <= 0 || m.still || (skip.get(m.id) || 0) > Date.now()) continue;
      const [mx, my] = tileOf(z, m.x, m.y); const k = my * W + mx;
      if (!want.has(k)) want.set(k, m);
    }
    if (!want.size) return null;
    const q = new Int32Array(N); let h = 0, t = 0;
    const s = sy * W + sx; q[t++] = s; dist[s] = 0;
    while (h < t) {
      const c = q[h++];
      if (want.has(c)) {
        const path = []; for (let k = c; k !== s && k >= 0; k = prev[k]) path.push(k);
        return { m: want.get(c), path: path.reverse() };
      }
      if (dist[c] > 600) continue;
      const cx = c % W, cy = (c - cx) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (dist[n] >= 0 || (solid.has(z.tiles[n]) && !want.has(n))) continue;
        dist[n] = dist[c] + 1; prev[n] = c; q[t++] = n;
      }
    }
    return null;
  }
  // Рядом никого — путь к случайной проходимой клетке подальше (лабиринт большой, монстры появляются в других комнатах)
  function wander(p, z) {
    const W = z.w, H = z.h, [sx, sy] = tileOf(z, p.x, p.y), N = W * H;
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
    const prev = new Int32Array(N).fill(-1), dist = new Int16Array(N).fill(-1), q = new Int32Array(N);
    let h = 0, t = 0; const s = sy * W + sx; q[t++] = s; dist[s] = 0;
    const far = [];
    while (h < t) {
      const c = q[h++];
      if (dist[c] >= 25) far.push(c);
      if (dist[c] > 400) continue;
      const cx = c % W, cy = (c - cx) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (dist[n] >= 0 || solid.has(z.tiles[n])) continue;
        dist[n] = dist[c] + 1; prev[n] = c; q[t++] = n;
      }
    }
    if (!far.length) return null;
    const goal = far[Math.floor(Math.random() * far.length)], path = [];
    for (let k = goal; k !== s && k >= 0; k = prev[k]) path.push(k);
    return path.reverse();
  }
  // Один шаг бота (зовётся ~7 раз в секунду)
  function step(p, now) {
    const b = p.afBot, z = world.byId.get(p.zone);
    if (!z || z.kind !== 'dungeon') return 'stop';
    // Зелье: меньше 40% здоровья — большое (если есть), иначе обычное
    if (p.hp < p.maxHp * 0.4 && now >= (p.potionAt || 0) && now - (b.potAt || 0) > 1500) {
      b.potAt = now;
      const mats = (b.pr().mats || {});
      const pot = ['potHp2', 'potHp'].find((k) => mats[k] > 0);
      if (pot) call(p, 'act', { op: 'useMat', mat: pot });
    }
    let m = b.tgt && monsters.get(b.tgt);
    if (!m || m.hp <= 0) { m = null; b.tgt = null; b.path = null; }
    if (!m && now < b.nextPlan) { if (b.walk && b.walk.length) walkPath(p, z, b, b.walk, now); return; } // поиск — не чаще раза в 1,2 с
    if (!m || (!b.path && now >= b.nextPlan)) {
      b.nextPlan = now + 1200;
      const r = plan(p, z, b.skip);
      if (!r) { // монстров не видно — идём бродить по лабиринту, по пути цель найдётся
        if (!b.walk || !b.walk.length) { b.walk = wander(p, z); b.lastPos = [p.x, p.y]; b.movedAt = now; }
        if (b.walk && b.walk.length) walkPath(p, z, b, b.walk, now);
        return;
      }
      b.walk = null;
      m = r.m; b.tgt = m.id; b.path = r.path; b.since = now; b.lastPos = [p.x, p.y]; b.movedAt = now;
    }
    const range = (p.form ? p.hero.forms[p.form].range : p.hero.range) || 60;
    const d = Math.hypot(m.x - p.x, m.y - p.y);
    if (d <= range + 6 && world.lineOfSight(p.x, p.y, m.x, m.y)) {
      call(p, 'attack', { targetId: m.id });
      // Умения — по очереди, когда готовы (сервер сам откажет, если перезарядка или нет ресурса)
      if (now - (b.skAt || 0) > 900) {
        b.skAt = now;
        // Порядок и выбор умений — из настройки игрока (окно «Умения: авто и порядок»); переключатели не трогаем
        const open = p.hero.skills.slice(0, p.unlocked || 1).filter((x) => !(x.cost === 0 && x.costLabel === 'бесплатно'));
        const cfg = (deps.getProfile(p.uid).skillCfg || {})[p.heroId] || {}, off = new Set(cfg.off || []), ord = cfg.order || [];
        const rank = (x) => { const i = ord.indexOf(x.id); return i < 0 ? 100 + p.hero.skills.indexOf(x) : i; };
        const sk = open.filter((x) => !off.has(x.id)).sort((a, c) => rank(a) - rank(c));
        const s = sk.find((x) => now >= ((p.skillReadyAt || {})[x.id] || 0) && (p.res === undefined || p.res >= (x.cost || 0)));
        if (s) call(p, 'skill', { id: s.id, targetId: m.id, x: m.x, y: m.y });
      }
      b.movedAt = now; b.path = null;
      return;
    }
    // Идём по пути (монстр мог отойти — путь пересчитаем)
    if (!b.path || !b.path.length) { b.path = null; b.nextPlan = 0; return; }
    walkPath(p, z, b, b.path, now);
    if (now - b.movedAt > 3000) { b.skip.set(m.id, now + 20000); b.tgt = null; b.path = null; b.nextPlan = 0; } // застрял — другая цель
    if (now - b.since > 25000 && d > range + 6) { b.skip.set(m.id, now + 15000); b.tgt = null; b.path = null; b.nextPlan = 0; } // долго не дойти
  }
  // Шаг по пути клеток (как игрок: обработчик move проверяет скорость и стены)
  function walkPath(p, z, b, path, now) {
    const k = path[0], [tx, ty] = [k % z.w, Math.floor(k / z.w)], to = center(z, tx, ty);
    const speed = Math.max((p.form ? p.hero.forms[p.form].speed : 0) || 0, p.hero.speed) * (1 + ((p.gear && p.gear.ms) || 0) / 100);
    const stepLen = Math.min(speed * 0.14 * 1.25, Math.hypot(to.x - p.x, to.y - p.y));
    const a = Math.atan2(to.y - p.y, to.x - p.x);
    call(p, 'move', { x: p.x + Math.cos(a) * stepLen, y: p.y + Math.sin(a) * stepLen, dir: Math.cos(a) < 0 ? -1 : 1, tp: p.tpSeq });
    if (Math.hypot(to.x - p.x, to.y - p.y) < 6) path.shift();
    if (Math.hypot(p.x - b.lastPos[0], p.y - b.lastPos[1]) > 4) { b.lastPos = [p.x, p.y]; b.movedAt = now; }
    else if (path === b.walk && now - b.movedAt > 3000) b.walk = null; // застрял на прогулке — новая точка
  }
  return { step };
};
