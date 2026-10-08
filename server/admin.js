// Админ-панель: HTTP API для управления игрой и тестов (страница public/admin.html).
// Вход: пароль ADMIN_PASSWORD (заголовок x-admin-key) или Telegram-аккаунт из ADMIN_TG_IDS (заголовок x-tg-init).
// Если ADMIN_PASSWORD не задан, пароль генерируется и сохраняется в data/admin_password.txt.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

module.exports = function createAdmin(ctx) {
  const { C, I, MOBX, dataDir, verifyInitData } = ctx;
  const SETTINGS_FILE = path.join(dataDir, 'admin.json');
  const PASS_FILE = path.join(dataDir, 'admin_password.txt');
  const TG_IDS = String(process.env.ADMIN_TG_IDS || '').split(/[\s,]+/).filter(Boolean);

  // ---------- Пароль ----------
  let password = process.env.ADMIN_PASSWORD || '';
  if (!password) {
    try { password = fs.readFileSync(PASS_FILE, 'utf8').trim(); } catch { /* ещё нет */ }
    if (!password) {
      password = crypto.randomBytes(9).toString('base64url');
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(PASS_FILE, password + '\n');
    }
    console.log(`Админ-панель: /admin.html · пароль ${password} (задайте свой в ADMIN_PASSWORD)`);
  }

  // ---------- Настройки игры, меняются на лету ----------
  const DEFAULTS = { xpMult: 1, goldMult: 1, dropMult: 1, freeSpins: false, maintenance: false, motd: '' };
  const settings = { ...DEFAULTS };
  try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); } catch { /* по умолчанию */ }
  const saveSettings = () => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  };

  // ---------- Журнал ----------
  const journal = [];
  function log(kind, text) {
    journal.push({ t: Date.now(), kind, text });
    if (journal.length > 500) journal.shift();
  }

  // ---------- Проверка доступа ----------
  const fails = new Map(); // ip → { n, until }
  const same = (a, b) => {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  function who(req) {
    const key = req.get('x-admin-key');
    if (key && same(key, password)) return 'пароль';
    const init = req.get('x-tg-init');
    if (init && TG_IDS.length) {
      const u = verifyInitData(init, process.env.BOT_TOKEN || '');
      if (u && TG_IDS.includes(String(u.id))) return '@' + (u.username || u.id);
    }
    return null;
  }

  // ---------- Помощники ----------
  const online = (uid) => [...ctx.players.values()].filter((p) => p.uid === uid);
  const num = (v, lo, hi, def = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
  };
  const zoneName = (id) => {
    const z = ctx.world.byId.get(id);
    if (!z) return id;
    const town = z.town && z.town !== z.id ? ctx.world.byId.get(z.town) : null;
    return town ? `${z.name || z.id} (${town.name})` : z.name || z.id;
  };
  function sessionView(p) {
    return {
      id: p.id, hero: p.heroId, heroName: p.hero.name, level: p.char.level, zone: p.zone, zoneName: zoneName(p.zone),
      hp: Math.ceil(p.hp), maxHp: p.maxHp, dmg: p.dmg, x: Math.round(p.x), y: Math.round(p.y), dead: !!p.dead, god: !!p.god, oneShot: !!p.oneShot,
    };
  }
  function kick(uid, text) {
    for (const p of online(uid)) {
      p.socket.emit('error_msg', text);
      p.socket.disconnect(true);
    }
  }
  function playerView(uid) {
    const pr = ctx.getProfile(uid);
    const heroes = Object.entries(C.HEROES).map(([id, h]) => {
      const ch = pr.chars[id] || {};
      return {
        id, name: h.name, title: h.title, rarity: h.rarity, owned: pr.heroes.includes(id),
        level: ch.level || 0, xp: Math.floor(ch.xp || 0), xpNext: ctx.xpForLevel(ch.level || 1), kills: ch.kills || 0, dupes: pr.heroDupes[id] || 0,
        skills: h.skills.map((k) => ({ icon: k.icon, name: k.name })), passive: h.passive ? `${h.passive.icon} ${h.passive.name}` : null,
        unlocked: ctx.unlockedSkills(pr, id), byProgress: ctx.unlockedSkills(pr, id, true), granted: (pr.skillGrant || {})[id] || 0,
      };
    });
    const byRar = {};
    for (const it of pr.items) byRar[it.rar] = (byRar[it.rar] || 0) + 1;
    const pass = ctx.meta.passOf(pr);
    return {
      uid, name: pr.name || null, lastSeen: pr.lastSeen || 0, gold: pr.gold, paidSpins: pr.paidSpins, itemSpins: pr.itemSpins || 0,
      freeSpinUsed: !!pr.freeSpinUsed, heroes, items: pr.items.length, itemsByRar: byRar, subUntil: pr.subUntil || 0,
      pass: { premium: !!pass.premium, xp: pass.xp, level: Math.floor(pass.xp / ctx.meta.SHOP.pass.xpPerLevel) },
      arena: pr.arena ? pr.arena.rating : 1000, banned: pr.banned || null, test: pr.test || {},
      sessions: online(uid).map(sessionView),
    };
  }

  // Действия над игроком
  function editPlayer(uid, d) {
    if (!ctx.profiles[uid]) return { error: 'Игрок не найден' };
    const pr = ctx.getProfile(uid);
    const hero = d.hero && C.HEROES[d.hero] ? d.hero : null;
    const live = online(uid);
    const refresh = () => ctx.refreshUid(uid);
    switch (d.action) {
      case 'gold': pr.gold = Math.max(0, Math.round(d.set ? num(d.value, 0, 1e12) : pr.gold + num(d.value, -1e12, 1e12))); return { text: `Золото: ${pr.gold}` };
      case 'spins': pr.paidSpins = Math.round(num(d.value, 0, 1e6)); return { text: `Крутки героев: ${pr.paidSpins}` };
      case 'itemSpins': pr.itemSpins = Math.round(num(d.value, 0, 1e6)); return { text: `Крутки предметов: ${pr.itemSpins}` };
      case 'freeSpin': pr.freeSpinUsed = false; return { text: 'Бесплатная крутка возвращена' };
      case 'giveHero': {
        if (!hero) return { error: 'Нет такого героя' };
        if (!pr.heroes.includes(hero)) pr.heroes.push(hero);
        ctx.getChar(uid, hero);
        return { text: `Выдан герой ${C.HEROES[hero].name}` };
      }
      case 'removeHero': {
        if (!hero) return { error: 'Нет такого героя' };
        if (live.some((p) => p.heroId === hero)) return { error: 'Игрок сейчас играет этим героем' };
        pr.heroes = pr.heroes.filter((h) => h !== hero);
        return { text: `Герой ${C.HEROES[hero].name} забран` };
      }
      case 'allHeroes':
        for (const id of Object.keys(C.HEROES)) { if (!pr.heroes.includes(id)) pr.heroes.push(id); ctx.getChar(uid, id); }
        return { text: 'Выданы все герои' };
      case 'level': {
        const ids = hero ? [hero] : pr.heroes;
        const lvl = Math.round(num(d.value, 1, MOBX.MAX_LEVEL, 1));
        for (const id of ids) { const ch = ctx.getChar(uid, id); ch.level = lvl; ch.xp = 0; }
        refresh();
        return { text: `Уровень ${lvl}: ${hero ? C.HEROES[hero].name : 'все герои'}` };
      }
      case 'dupes': {
        const ids = hero ? [hero] : pr.heroes;
        const n = Math.round(num(d.value, 0, C.GACHA.heroDupeMax));
        for (const id of ids) pr.heroDupes[id] = n;
        refresh();
        return { text: `Дубликаты ${n}: ${hero ? C.HEROES[hero].name : 'все герои'}` };
      }
      case 'level+': {
        if (!hero) return { error: 'Нет такого героя' };
        const ch = ctx.getChar(uid, hero);
        ch.level = Math.round(num(ch.level + num(d.value, -100, 100), 1, MOBX.MAX_LEVEL, 1)); ch.xp = 0;
        refresh();
        return { text: `${C.HEROES[hero].name}: ${ch.level} уровень` };
      }
      case 'heroXp': {
        if (!hero) return { error: 'Нет такого героя' };
        const ch = ctx.getChar(uid, hero);
        ch.xp = Math.round(num(d.value, 0, ctx.xpForLevel(ch.level) - 1));
        refresh();
        return { text: `${C.HEROES[hero].name}: опыт ${ch.xp} / ${ctx.xpForLevel(ch.level)}` };
      }
      // Умения открываются по порядку: value — сколько первых умений открыть принудительно (0 — только по прогрессу)
      case 'skills': {
        const ids = hero ? [hero] : pr.heroes;
        pr.skillGrant ??= {};
        for (const id of ids) {
          const n = Math.round(num(d.value, 0, C.HEROES[id].skills.length));
          if (n > 0) pr.skillGrant[id] = n; else delete pr.skillGrant[id];
        }
        refresh();
        for (const p of live) if (ids.includes(p.heroId)) p.socket.emit('chat', { sys: true, text: `⚙️ Администратор изменил умения: открыто ${p.unlocked} из ${p.hero.skills.length}` });
        const n = Math.round(num(d.value, 0, 3));
        return { text: hero ? `${C.HEROES[hero].name}: ${n ? 'выдано умений — ' + n : 'умения только по прогрессу'}` : n ? 'Все умения выданы всем героям' : 'Выданные умения сброшены' };
      }
      case 'giveItem': {
        const cat = I.CATEGORIES[d.cat] ? d.cat : null;
        const rar = I.ITEM_RARITIES[d.rar] ? d.rar : 'epic';
        const tier = Math.round(num(d.tier, 1, 3, 1));
        const n = Math.round(num(d.count, 1, 50, 1));
        let got = 0;
        for (let i = 0; i < n; i++) {
          const item = I.CLASSES[d.set] ? I.createSetItem(d.set, tier, rar, cat && I.SLOTS[cat] ? cat : null) : cat ? I.createItem(cat, rar, tier) : I.rollItem(tier, { [rar]: 1 });
          const res = ctx.meta.grant(pr, item);
          if (res && res.error) break;
          got++;
        }
        refresh();
        return { text: `Выдано предметов: ${got}${got < n ? ' (сумка заполнена)' : ''}` };
      }
      case 'giveMat': {
        if (!I.MATS[d.mat]) return { error: 'Нет такого ресурса' };
        const n = Math.round(num(d.count, 1, 9999, 1));
        I.addMat(pr, d.mat, n);
        return { text: `Выдано: ${I.MATS[d.mat].name} ×${n}` };
      }
      case 'fullSet': {
        const cls = I.CLASSES[d.set] ? d.set : null;
        if (!cls) return { error: 'Выберите класс комплекта' };
        const tier = Math.round(num(d.tier, 1, 3, 1)), rar = I.ITEM_RARITIES[d.rar] ? d.rar : 'epic';
        for (const slot of I.SLOT_ORDER) ctx.meta.grant(pr, I.createSetItem(cls, tier, rar, slot));
        refresh();
        return { text: `Выдан полный комплект: ${I.SETS[cls + tier].name}` };
      }
      case 'clearItems': pr.items = []; pr.equip = {}; refresh(); return { text: 'Предметы и экипировка удалены' };
      case 'sub': {
        const days = num(d.value, 0, 3650);
        pr.subUntil = days > 0 ? Date.now() + days * 86400000 : 0;
        refresh();
        return { text: days > 0 ? `Подписка на ${days} дн.` : 'Подписка снята' };
      }
      case 'passPremium': ctx.meta.passOf(pr).premium = !!d.value; return { text: d.value ? 'Премиум-пропуск выдан' : 'Премиум-пропуск снят' };
      case 'passXp': ctx.meta.addPassXp(pr, Math.round(num(d.value, 0, 1e6))); return { text: 'Опыт пропуска добавлен' };
      case 'ban': {
        pr.banned = { reason: String(d.reason || 'Нарушение правил').slice(0, 200), at: Date.now() };
        kick(uid, `Вы заблокированы: ${pr.banned.reason}`);
        return { text: 'Игрок заблокирован' };
      }
      case 'unban': delete pr.banned; return { text: 'Блокировка снята' };
      case 'kick': kick(uid, String(d.reason || 'Вас отключил администратор')); return { text: `Отключено сессий: ${live.length}` };
      case 'god': case 'oneShot': case 'tester': {
        pr.test ??= {};
        pr.test[d.action] = !!d.value;
        for (const p of live) p[d.action] = !!d.value;
        const label = { god: 'Бессмертие', oneShot: 'Убийство с одного удара', tester: 'Вход во время техработ' }[d.action];
        return { text: `${label}: ${d.value ? 'вкл' : 'выкл'}` };
      }
      case 'heal':
        for (const p of live) {
          if (p.dead) continue;
          p.hp = p.maxHp; p.res = p.resMax; p.cc = null; p.pdots = []; p.skillReadyAt = {};
          ctx.syncCooldowns(p, Date.now());
          ctx.markDirty(p);
        }
        return { text: 'Здоровье, ресурс и перезарядки восстановлены' };
      case 'kill':
        for (const p of live) { const g = p.god; p.god = false; p.dodgeUntil = 0; p.shieldHp = 0; ctx.hurtPlayer(p, 1e9, null, Date.now(), true); p.god = g; }
        return { text: 'Герой убит' };
      case 'teleport': {
        if (!ctx.world.byId.get(d.zone)) return { error: 'Нет такой зоны' };
        for (const p of live) ctx.moveToZone(p, d.zone);
        return { text: `Перемещён: ${zoneName(d.zone)}` };
      }
      case 'xp': {
        for (const p of live) ctx.grantXp(p, Math.round(num(d.value, 0, 1e9)), 0, true);
        return { text: 'Опыт начислен активному герою' };
      }
      case 'maxTest':
        for (const id of Object.keys(C.HEROES)) {
          if (!pr.heroes.includes(id)) pr.heroes.push(id);
          const ch = ctx.getChar(uid, id); ch.level = MOBX.MAX_LEVEL; ch.xp = 0;
          pr.heroDupes[id] = C.GACHA.heroDupeMax;
        }
        pr.gold += 1e6; pr.paidSpins += 100; pr.itemSpins = (pr.itemSpins || 0) + 100;
        pr.skillGrant = Object.fromEntries(Object.keys(C.HEROES).map((id) => [id, C.HEROES[id].skills.length]));
        refresh();
        return { text: 'Тестовый набор: все герои 50 ур., все дубликаты, 1 000 000 золота, по 100 круток' };
      case 'reset':
        kick(uid, 'Прогресс сброшен администратором');
        delete ctx.profiles[uid];
        return { text: 'Профиль удалён', deleted: true };
      default: return { error: 'Неизвестное действие' };
    }
  }

  // Монстры
  const mobList = () => Object.entries(MOBX.MOBS).map(([id, m]) => ({ id, name: m.name, rank: m.rank, cls: m.cls }));
  function spawn(d) {
    const def = MOBX.MOBS[d.type];
    if (!def) return { error: 'Нет такого монстра' };
    let z = null, at = null;
    if (d.uid) {
      const p = online(d.uid)[0];
      if (!p) return { error: 'Игрок не в игре' };
      z = ctx.world.byId.get(p.zone); at = { x: p.x, y: p.y };
    } else {
      z = ctx.world.byId.get(d.zone);
      if (z) at = z.spawn;
    }
    if (!z || !at) return { error: 'Нет такой зоны' };
    const rank = MOBX.RANK[d.rank] ? d.rank : def.rank;
    const level = Math.round(num(d.level, 1, 60, 1));
    const n = Math.round(num(d.count, 1, 30, 1));
    const affixKeys = Object.keys(MOBX.AFFIXES);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 60;
      let pos = { x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r };
      if (ctx.world.isSolidAt(pos.x, pos.y)) pos = { x: at.x, y: at.y };
      const affixes = rank === 'rare' ? affixKeys.sort(() => Math.random() - 0.5).slice(0, 2) : [];
      ctx.D.create(z, d.type, pos, level, { rank, affixes });
    }
    return { text: `Создано: ${def.name} ×${n}, ур. ${level} (${zoneName(z.id)})` };
  }
  function clearZone(zoneId) {
    let n = 0;
    for (const m of ctx.monsters.values()) if (!zoneId || m.zone === zoneId) { ctx.monsters.delete(m.id); n++; }
    return { text: `Удалено монстров: ${n}` };
  }

  function overview() {
    const zones = new Map();
    for (const p of ctx.players.values()) zones.set(p.zone, (zones.get(p.zone) || 0) + 1);
    const mz = new Map();
    for (const m of ctx.monsters.values()) mz.set(m.zone, (mz.get(m.zone) || 0) + 1);
    const wb = Object.entries(ctx.D.wbState).map(([town, st]) => {
      const b = st.bossId ? ctx.monsters.get(st.bossId) : null;
      return { town, townName: zoneName(town), boss: b ? { name: MOBX.MOBS[b.type].name, hp: Math.ceil(b.hp), maxHp: b.maxHp } : null, nextAt: st.nextAt };
    });
    return {
      uptime: Math.round(process.uptime()), memMb: Math.round(process.memoryUsage().rss / 1048576),
      online: ctx.players.size, profiles: Object.keys(ctx.profiles).length, monsters: ctx.monsters.size,
      dungeons: ctx.D.runs.size, survivals: ctx.D.survivals.size, worldBosses: wb, settings,
      zones: [...ctx.world.byId.values()].filter((z) => z.kind === 'town' || zones.has(z.id) || mz.has(z.id))
        .map((z) => ({ id: z.id, name: zoneName(z.id), kind: z.kind, players: zones.get(z.id) || 0, monsters: mz.get(z.id) || 0 })),
      sessions: [...ctx.players.values()].map((p) => ({ uid: p.uid, name: p.name, ...sessionView(p) })),
    };
  }

  // ---------- Маршруты ----------
  const r = express.Router();
  r.use(express.json({ limit: '2mb' }));
  r.use((req, res, next) => {
    const ip = req.ip, f = fails.get(ip);
    if (f && f.until > Date.now()) return res.status(429).json({ error: 'Слишком много попыток, подождите 10 минут' });
    req.admin = who(req);
    if (!req.admin) {
      const n = (f && f.until > Date.now() - 600000 ? f.n : 0) + 1;
      fails.set(ip, { n, until: n >= 10 ? Date.now() + 600000 : 0 });
      return res.status(401).json({ error: 'Неверный пароль' });
    }
    fails.delete(ip);
    next();
  });
  const act = (fn, label) => (req, res) => {
    try {
      const out = fn(req.body || {}, req);
      if (out && out.text && label) log('admin', `${req.admin}: ${label(req.body || {})} — ${out.text}`);
      if (out && out.text) ctx.saveProfiles();
      res.status(out && out.error ? 400 : 200).json(out || {});
    } catch (e) {
      console.error('admin', e);
      res.status(500).json({ error: 'Ошибка сервера: ' + e.message });
    }
  };

  r.post('/me', (req, res) => res.json({ ok: true, via: req.admin, version: ctx.version() }));
  r.post('/overview', act(overview));
  r.post('/meta', act(() => ({
    heroes: Object.entries(C.HEROES).map(([id, h]) => ({ id, name: h.name, title: h.title, rarity: h.rarity })),
    mobs: mobList(), ranks: Object.keys(MOBX.RANK),
    zones: [...ctx.world.byId.values()].filter((z) => z.kind === 'town' || String(z.id).startsWith('wb_')).map((z) => ({ id: z.id, name: zoneName(z.id) })),
    cats: I.CATEGORIES, classes: Object.fromEntries(Object.entries(I.CLASSES).map(([k, c]) => [k, c.name])),
    mats: Object.fromEntries(Object.entries(I.MATS).map(([k, m]) => [k, `${m.icon} ${m.name}`])), rarities: Object.fromEntries(Object.entries(I.ITEM_RARITIES).map(([k, v]) => [k, v.name])), maxLevel: MOBX.MAX_LEVEL, dupeMax: C.GACHA.heroDupeMax,
  })));
  r.post('/players', act((d) => {
    const q = String(d.q || '').toLowerCase();
    const live = new Set([...ctx.players.values()].map((p) => p.uid));
    const list = Object.entries(ctx.profiles).map(([uid, pr]) => ({
      uid, name: pr.name || null, online: live.has(uid), lastSeen: pr.lastSeen || 0, gold: pr.gold || 0, banned: !!pr.banned,
      heroes: (pr.heroes || []).length, maxLevel: Math.max(0, ...Object.values(pr.chars || {}).map((c) => c.level || 0)),
    })).filter((p) => !q || p.uid.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q));
    list.sort((a, b) => b.online - a.online || b.lastSeen - a.lastSeen);
    return { total: list.length, players: list.slice(0, 300) };
  }));
  r.post('/player', act((d) => (ctx.profiles[d.uid] ? playerView(d.uid) : { error: 'Игрок не найден' })));
  r.post('/edit', act((d) => {
    const out = editPlayer(d.uid, d);
    return out.error || out.deleted ? out : { ...out, player: playerView(d.uid) };
  }, (d) => `${d.uid} · ${d.action}${d.hero ? ' ' + d.hero : ''}${d.value !== undefined ? ' = ' + d.value : ''}`));
  r.post('/raw', act((d) => (ctx.profiles[d.uid] ? { json: ctx.profiles[d.uid] } : { error: 'Игрок не найден' })));
  r.post('/rawSave', act((d) => {
    if (!ctx.profiles[d.uid]) return { error: 'Игрок не найден' };
    if (!d.json || typeof d.json !== 'object' || Array.isArray(d.json)) return { error: 'Нужен JSON-объект' };
    kick(d.uid, 'Профиль изменён администратором, войдите заново');
    ctx.profiles[d.uid] = d.json;
    ctx.getProfile(d.uid);
    return { text: 'Профиль сохранён', player: playerView(d.uid) };
  }, (d) => `${d.uid} · ручная правка профиля`));
  r.post('/broadcast', act((d) => {
    const text = String(d.text || '').trim().slice(0, 300);
    if (!text) return { error: 'Пустое сообщение' };
    ctx.io.emit('chat', { sys: true, text: `📢 ${text}` });
    return { text: 'Объявление отправлено' };
  }, (d) => `объявление «${String(d.text || '').slice(0, 60)}»`));
  r.post('/spawn', act(spawn, (d) => `монстр ${d.type}`));
  r.post('/clearZone', act((d) => clearZone(d.zone), (d) => `очистка ${d.zone || 'всех зон'}`));
  r.post('/worldBoss', act((d) => {
    const st = ctx.D.wbState[d.town];
    if (!st) return { error: 'Нет такого города' };
    if (d.kill) {
      const b = st.bossId && ctx.monsters.get(st.bossId);
      if (!b) return { error: 'Босса сейчас нет' };
      ctx.monsters.delete(b.id); st.bossId = null; st.nextAt = Date.now() + MOBX.WORLD_BOSS_RESPAWN;
      return { text: 'Мировой босс удалён' };
    }
    if (st.bossId && ctx.monsters.get(st.bossId)) return { error: 'Босс уже в мире' };
    st.nextAt = 0;
    return { text: 'Мировой босс появится через секунду' };
  }, (d) => `мировой босс ${d.town}${d.kill ? ' (удалить)' : ''}`));
  r.post('/settings', act((d) => {
    if (d.set) {
      for (const k of ['xpMult', 'goldMult', 'dropMult']) if (d.set[k] !== undefined) settings[k] = num(d.set[k], 0, 100, 1);
      for (const k of ['freeSpins', 'maintenance']) if (d.set[k] !== undefined) settings[k] = !!d.set[k];
      if (d.set.motd !== undefined) settings.motd = String(d.set.motd).slice(0, 300);
      saveSettings();
      if (d.set.maintenance) for (const p of [...ctx.players.values()]) if (!(ctx.getProfile(p.uid).test || {}).tester) { p.socket.emit('error_msg', 'Технические работы, зайдите позже'); p.socket.disconnect(true); }
      return { text: 'Настройки сохранены', settings };
    }
    return { settings };
  }, () => 'настройки'));
  r.post('/log', act(() => ({ log: journal.slice(-300).reverse() })));
  r.post('/save', act(() => ({ text: 'Данные записаны на диск' }), () => 'сохранение'));

  // Администратор ли этот игрок (Telegram ID в ADMIN_TG_IDS) — для кнопки админки в лобби
  const isAdminUid = (uid) => String(uid).startsWith('tg') && TG_IDS.includes(String(uid).slice(2));
  return { router: r, settings, log, ctx, isAdminUid };
};
