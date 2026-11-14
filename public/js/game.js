// Игровая сцена Phaser: карта, герои, монстры, бой
window.GameScene = class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  init(data) {
    this.net = data.socket;
    this.welcome = data.welcome;
    this.ui = data.ui; // колбэки HUD из main.js
    this.input_ = data.input; // { vec: {x,y}, attack: bool }
    this.myId = data.welcome.id;
    this.T = data.welcome.tile;
    this.heroes = data.welcome.heroes;
    this.myStats = data.welcome.stats;
    this.monsterDefs = data.welcome.monsters;
    this.players = new Map();
    this.monsters = new Map();
    this.targetId = null;
    this.lastSend = 0;
    this.lastAttack = 0;
    this.me = null;
  }

  preload() {
    // Нарисованные значки городских мест для подписей зданий (public/assets/ui/place_*.webp)
    for (const k of ['warehouse', 'equip', 'alchemy', 'smith', 'runes', 'trainer', 'auction', 'market', 'events', 'gacha', 'teleport', 'arena', 'survival']) this.load.image('place_' + k, `assets/ui/place_${k}.webp`);
    // Нарисованные эффекты монстров (tools/gen_mobs.py): снаряды, вспышка попадания, рунный круг
    this.MOB_PROJ = ['arrow', 'bolt', 'axe', 'feather', 'leaf', 'nature', 'fireball', 'frost', 'spark', 'holy', 'arcane', 'dark', 'necro', 'spirit', 'venom', 'illusion'];
    for (const k of this.MOB_PROJ) this.load.spritesheet('mproj_' + k, `assets/mobfx/proj_${k}.png`, { frameWidth: 28, frameHeight: 14 });
    this.load.spritesheet('mfx_burst', 'assets/mobfx/burst.png', { frameWidth: 40, frameHeight: 40 });
    this.load.image('mfx_rune', 'assets/mobfx/rune.png');
    WorldArt.preload(this); // общая графика миров (обстановка, добыча, значки)
    // Только то, что нужно сразу: свой герой, текущий мир и монстры текущей зоны.
    // Остальное (чужие герои, другие миры, монстры) догружается по мере появления — см. lazyLoad.
    this.queueZoneAssets(this.welcome.zone);
    this.queueHero(this.welcome.myHero);
    // Экран загрузки с настоящим процентом
    if (this.ui.onLoading) {
      this.ui.onLoading(0, this.welcome.zone);
      this.load.on('progress', (v) => this.ui.onLoading(v));
      this.load.once('complete', () => { this.load.off('progress'); this.ui.onLoading(null); });
    }
    for (const [k, [w, h]] of Object.entries(Skins.PETS)) this.load.spritesheet('psk_' + k, `assets/pets/${k}.png`, { frameWidth: w, frameHeight: h });
  }

  create() {
    // Тряска экрана в бою отключена: мешает целиться и читать бой (удары видны по вспышкам и цифрам)
    this.cameras.main.shake = function () { return this; };
    // Чёткий текст: высокое разрешение под зум камеры и сглаживание (а не «пиксельное» растяжение)
    const addText = this.add.text.bind(this.add);
    this.add.text = (...a) => {
      const t = addText(...a);
      t.setResolution(Math.min(5, Math.ceil(this.cameras.main.zoom) + 1));
      t.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      return t;
    };
    const T = this.T;
    // Анимации нарисованных монстров: ходьба (по кругу) и удар (один раз)
    for (const k of Object.keys(Skins.PETS)) {
      if (!this.textures.exists('psk_' + k)) continue;
      this.anims.create({ key: `pwalk_${k}`, frames: this.anims.generateFrameNumbers('psk_' + k, { start: 0, end: 3 }), frameRate: k === 'turret' ? 4 : 9, repeat: -1 });
      this.anims.create({ key: `patk_${k}`, frames: this.anims.generateFrameNumbers('psk_' + k, { start: 4, end: 6 }), frameRate: 12, repeat: 0 });
    }
    for (const k of this.MOB_PROJ || []) if (this.textures.exists('mproj_' + k)) this.anims.create({ key: 'mproj_' + k, frames: this.anims.generateFrameNumbers('mproj_' + k, { start: 0, end: 3 }), frameRate: 14, repeat: -1 });
    if (this.textures.exists('mfx_burst')) this.anims.create({ key: 'mfx_burst', frames: this.anims.generateFrameNumbers('mfx_burst', { start: 0, end: 5 }), frameRate: 22, repeat: 0 });
    for (const id of Object.keys(Skins.MOBS)) this.makeMobAnims(id);
    for (const id of Object.keys(Skins.LIST)) this.makeHeroAnims(id);
    // Догрузка по ходу игры: колбэки срабатывают, когда очередь загрузчика опустела
    this.lazyDone = [];
    this.load.on('complete', () => { const cbs = this.lazyDone; this.lazyDone = []; cbs.forEach((f) => f()); });
    this.load.on('loaderror', (f) => console.warn('asset load failed', f.key));

    // Текстуры
    const addTex = (key, cnv) => { if (!this.textures.exists(key)) this.textures.addCanvas(key, cnv); };
    ['green', 'abyss', 'sky'].forEach((th) => addTex('tiles_' + th, Gfx.tileset(th)));
    Object.entries(this.heroes).forEach(([k, h]) => {
      addTex('hero_' + k, Gfx.hero(h.look));
      if (h.forms) addTex('hero_' + k + '_beast', Gfx.werebeast(h.beastLook)); // звериный облик
    });
    Object.entries(this.monsterDefs).forEach(([k, def]) => addTex('mon_' + k, Gfx.mob(def.look)));
    this.explored = new Map(); // разведанные тайлы данжей: zoneId → Set
    addTex('totem', Gfx.totem());
    ['wolf', 'bear', 'hawk', 'skeleton', 'sprite', 'turret', 'wisp', 'seaSpirit'].forEach((k) => addTex('pet_' + k, Gfx.pet(k)));
    this.totems = new Map();
    this.pets = new Map();
    ['stone', 'spirit', 'spear', 'dagger', 'shadow', 'darkfire', 'leaf', 'illusion', 'fireball', 'frost', 'spark', 'holy', 'note', 'necro', 'arrow', 'arcane', 'bolt', 'blood', 'venom', 'moon', 'sand', 'rune', 'soul', 'water', 'sonic', 'crystal', 'axe', 'feather', 'web', 'trap', 'dark', 'nature'].forEach((k) => addTex('proj_' + k, Gfx.projectile(k)));
    addTex('particle', Gfx.particle());

    // Тайловая карта текущей зоны (город или охотничьи земли)
    this.zoneObjs = [];
    this.buildZone(this.welcome.zone);
    this.cameras.main.setRoundPixels(true);
    this.resize();
    this.scale.on('resize', () => this.resize());

    // Кольцо цели
    this.targetRing = this.add.ellipse(0, 0, 36, 16).setStrokeStyle(2, 0xffcc4d).setVisible(false).setDepth(1);

    // Тап по монстру — выбрать цель
    this.input.on('gameobjectdown', (pointer, obj) => {
      if (this.uiBlocked(pointer)) return;
      if (obj.getData('playerId')) { if (this.ui.onPlayer) this.ui.onPlayer(obj.getData('playerId')); return; }
      if (obj.getData('monsterId')) {
        this.targetId = obj.getData('monsterId');
        this.tryAttack(true);
      }
    });

    // Сеть
    // Кадры состояния применяем раз в кадр отрисовки: если после задержки сети пришло несколько сразу — берём последний,
    // эффекты (удары, лечение) складываем, чтобы ничего не потерять и не тормозить на пачке старых кадров
    this.net.on('state', (s) => {
      // Сервер не присылает у героев поля со значением по умолчанию (пакет меньше) — восстанавливаем их
      const PD = window.P_DEF;
      if (PD && s.p) for (const o of s.p) for (const k in PD) if (!(k in o)) o[k] = PD[k];
      if (this.pendingState) { const fx = this.pendingState.fx.concat(s.fx); s.fx = fx.length > 150 ? fx.slice(-150) : fx; }
      this.pendingState = s;
      if (this.zoneLoading || (window.appHidden ? window.appHidden() : document.hidden)) return;
    });
    // Позиции героев между тиками сервера
    this.net.on('pp', (list, ts) => { this.netClock(ts); for (const [id, x, y, dir] of list) { if (id === this.myId) continue; const e = this.players.get(id); if (e) { this.trackPos(e, x, y, ts); if (e.data) e.data.dir = dir; } } });
    this.net.on('stats', (st) => { const now = Date.now(); this.myStats = { ...st, ccEnd: st.cc ? now + (st.ccMs || 0) : 0, rootEnd: st.rooted ? now + (st.rootMs || 0) : 0 }; });
    // Ворота босса открылись или запечатались: клетки прохода и анимация створок
    this.net.on('gate', (g) => {
      if (!this.tiles) return;
      for (const k of g.idx) this.tiles[k] = g.tile;
      const img = this.gates && this.gates.get(g.i);
      if (!img || !img.active) return;
      img.gateState = g.state;
      const th = this.zone.theme, seq = g.state === 'open' ? ['closed', 'half', 'open'] : ['open', 'half', 'closed', 'seal'];
      const pre = img.gateSide ? `gate_${th}_side_` : `gate_${th}_`; // боковые ворота — свои кадры
      seq.forEach((st, n) => this.time.delayedCall(n * 280, () => { if (img.active && this.textures.exists(pre + st)) img.setTexture(pre + st); }));
      this.cameras.main.flash(250, 255, 230, 180);
      if (window.Sfx) Sfx.play('gate');
    });
    // Переход в другую зону: новая карта, прежние сущности исчезнут со следующим состоянием
    this.net.on('zone', (d) => {
      // Новый мир / арена / монстры данжа ещё не загружены — экран загрузки, затем карта
      if (this.queueZoneAssets(d.zone)) {
        this.zoneLoading = true;
        this.ui.onLoading && this.ui.onLoading(0, d.zone);
        this.lazyLoad(() => { this.zoneLoading = false; this.ui.onLoading && this.ui.onLoading(null); this.enterZone(d); });
      } else this.enterZone(d);
    });
    this.load.on('progress', (v) => { if (this.zoneLoading && this.ui.onLoading) this.ui.onLoading(v); });
    // Связь пропала надолго, сессию на сервере восстановить не удалось — заново вошли в мир (новый id, город).
    // Раньше страница перезагружалась целиком, и на плохом интернете зависала на загрузке
    this.rejoin = (w) => {
      const old = this.players.get(this.myId);
      if (old) { this.players.delete(this.myId); this.players.set(w.id, old); old.sprite && old.sprite.setData && old.sprite.setData('playerId', w.id); if (old.data) old.data.id = w.id; }
      this.myId = w.id;
      this.pendingState = null;
      this.net.listeners('zone')[0]({ zone: w.zone, x: w.x, y: w.y });
    };
    this.enterZone = (d) => {
      (d.zone.mobs || []).forEach((t) => this.makeMobAnims(t));
      this.buildZone(d.zone);
      for (const [id, e] of this.players) if (id !== this.myId) { e.c.destroy(); this.players.delete(id); }
      for (const e of this.monsters.values()) if (!e.pvp) e.c.destroy();
      this.monsters.clear();
      this.targetId = null; this.autoWalk = null;
      if (this.me) { this.me.x = d.x; this.me.y = d.y; this.me.e.c.setPosition(d.x, d.y); }
      this.cameras.main.flash(350, 255, 255, 255);
    };
    // Новые объекты зоны (выход из пройденного данжа)
    this.net.on('zoneObjs', (objs) => {
      if (!this.zone) return;
      const keepMe = this.me && { x: this.me.x, y: this.me.y };
      this.buildZone({ ...this.zone, objs });
      if (keepMe) { this.me.x = keepMe.x; this.me.y = keepMe.y; }
      this.cameras.main.flash(300, 120, 255, 140);
    });
    this.net.on('correct', (d) => {
      if (!this.me) return;
      this.me.x = d.x; this.me.y = d.y;
      if (d.respawn) this.ui.onRespawn();
    });

    window.gameScene = this; // для отладки из консоли
    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,Q,E,R');
  }

  // ---------- Загрузка по мере надобности (экономия трафика и видеопамяти на слабых телефонах) ----------
  // Поставить в очередь лист героя (ходьба, удары, эффекты, турель, звериный облик). true — если что-то добавлено
  queueHero(id) {
    const sk = id && Skins.LIST[id], L = this.load, has = (k) => this.textures.exists(k);
    if (!sk || has('skin_' + id) || (this.heroQueued || (this.heroQueued = new Set())).has(id)) return false;
    this.heroQueued.add(id);
    L.spritesheet('skin_' + id, sk.sheet, { frameWidth: sk.w, frameHeight: sk.h });
    if (sk.attack) L.spritesheet('atk_' + id, sk.attack.sheet, { frameWidth: sk.attack.w, frameHeight: sk.attack.h });
    if (sk.fx) L.spritesheet('fx_' + id, sk.fx.sheet, { frameWidth: sk.fx.size, frameHeight: sk.fx.size });
    if (sk.turret && !has('turret_' + id)) L.image('turret_' + id, sk.turret);
    if (sk.beast && !has('bskin_' + id)) L.spritesheet('bskin_' + id, sk.beast.sheet, { frameWidth: sk.beast.w, frameHeight: sk.beast.h });
    return true;
  }

  queueMob(type) {
    const m = Skins.MOBS[type];
    if (!m || this.textures.exists('mskin_' + type) || (this.mobQueued || (this.mobQueued = new Set())).has(type)) return false;
    this.mobQueued.add(type);
    this.load.spritesheet('mskin_' + type, m.sheet, { frameWidth: m.w, frameHeight: m.h });
    return true;
  }

  // Графика мира зоны, её арена и монстры, которые там водятся (список присылает сервер)
  queueZoneAssets(z) {
    let any = WorldArt.preloadTheme(this, z.theme);
    if (z.kind === 'worldboss' || z.kind === 'pvp') any = WorldArt.preloadArena(this, z.theme) || any;
    for (const t of z.mobs || []) any = this.queueMob(t) || any;
    return any;
  }

  // Запустить загрузчик для уже поставленных в очередь файлов; done — когда всё догрузится
  lazyLoad(done) {
    if (done) this.lazyDone.push(done);
    if (!this.load.isLoading()) this.load.start();
  }

  // Спутник героя: лист из 4 кадров (public/assets/pets/c_<id>.png), догружается при первом появлении
  attachComp(e, id) {
    const S = { dragon: [53, 38], fox: [49, 33], owl: [57, 38], golem: [48, 40], cat: [52, 33], wolf: [54, 36],
      phoenix: [60, 40], unicorn: [56, 40], shadow: [60, 38], griffin: [56, 40], fairy: [52, 40], beetle: [57, 36] }[id];
    if (!S) return;
    const key = 'cmp_' + id;
    if (!this.textures.exists(key)) {
      if (!this.cmpQueued) this.cmpQueued = new Set();
      if (!this.cmpQueued.has(id)) {
        this.cmpQueued.add(id);
        this.load.spritesheet(key, `assets/pets/c_${id}.png`, { frameWidth: S[0], frameHeight: S[1] });
        this.lazyLoad(() => { for (const o of this.players.values()) if (o.cpKey === id && !o.cmp) this.attachComp(o, id); });
      }
      return;
    }
    if (!this.anims.exists('cmpw_' + id)) this.anims.create({ key: 'cmpw_' + id, frames: this.anims.generateFrameNumbers(key, { start: 0, end: 3 }), frameRate: 7, repeat: -1 });
    e.cmp = this.add.sprite(-24, 10, key).setOrigin(0.5, 1);
    e.cmp.play('cmpw_' + id);
    e.c.addAt(e.cmp, 0); // позади героя
  }

  // Чужой герой появился рядом — догружаем его лист, затем переодеваем всех с этим героем
  needHero(id) {
    if (!this.queueHero(id)) return;
    this.lazyLoad(() => {
      this.makeHeroAnims(id);
      for (const e of this.players.values()) if (e.data && e.data.hero === id && !e.form) this.applySkin(e, id);
      for (const [mid, e] of this.monsters) if (e.heroClone && e.data && e.data.hs === id) { e.c.destroy(); this.monsters.delete(mid); } // пересоздастся со скином
    });
  }

  // Новый вид монстра — догружаем; уже стоящих на карте пересоздаём с нарисованным спрайтом
  needMob(type) {
    if (!this.queueMob(type)) return;
    this.lazyLoad(() => this.mobsLoaded([type]));
  }

  mobsLoaded(types) {
    const set = new Set(types);
    types.forEach((t) => this.makeMobAnims(t));
    for (const [mid, e] of this.monsters) {
      if (e.pvp || e.heroClone || e.mskin || !e.data || !set.has(e.data.type)) continue;
      if (this.targetId === mid) continue; // цель не трогаем, чтобы не сбить бой — обновится позже
      e.c.destroy(); this.monsters.delete(mid);
    }
  }

  makeHeroAnims(id) {
    const sk = Skins.LIST[id], A = this.anims;
    if (!sk) return;
    if (sk.beast && this.textures.exists('bskin_' + id) && !A.exists(`batk_${id}`)) { // звериный облик (Талиесин)
      for (const d of ['down', 'side', 'up']) A.create({ key: `bwalk_${id}_${d}`, frames: sk.beast[d].map((f) => ({ key: 'bskin_' + id, frame: f })), frameRate: 9, repeat: -1 });
      A.create({ key: `batk_${id}`, frames: sk.beast.attack.map((f) => ({ key: 'bskin_' + id, frame: f })), frameRate: 16, repeat: 0 });
    }
    if (!this.textures.exists('skin_' + id) || A.exists(`skin_${id}_0`)) return;
    for (let r = 0; r < 8; r++) {
      A.create({ key: `skin_${id}_${r}`, frames: A.generateFrameNumbers('skin_' + id, { start: r * sk.frames, end: r * sk.frames + sk.frames - 1 }), frameRate: 10, repeat: -1 });
    }
    // Кадры атаки и нарисованные эффекты (если есть)
    if (sk.attack && this.textures.exists('atk_' + id)) {
      for (let r = 0; r < (sk.attack.rows || 6); r++) A.create({ key: `atk_${id}_${r}`, frames: A.generateFrameNumbers('atk_' + id, { start: r * sk.attack.frames, end: r * sk.attack.frames + sk.attack.frames - 1 }), frameRate: 18, repeat: 0 });
    }
    if (sk.fx && this.textures.exists('fx_' + id)) {
      sk.fx.rows.forEach((name, r) => A.create({ key: `fx_${id}_${name}`, frames: A.generateFrameNumbers('fx_' + id, { start: r * sk.fx.frames, end: r * sk.fx.frames + sk.fx.frames - 1 }), frameRate: 16, repeat: name === 'aura' ? -1 : 0 }));
    }
  }

  // Анимации нарисованного монстра: ходьба (по кругу) и удар (один раз)
  makeMobAnims(id) {
    const m = Skins.MOBS[id];
    if (!m || !this.textures.exists('mskin_' + id) || this.anims.exists(`mwalk_${id}`)) return;
    this.anims.create({ key: `mwalk_${id}`, frames: m.walk.map((f) => ({ key: 'mskin_' + id, frame: f })), frameRate: 8, repeat: -1 });
    this.anims.create({ key: `matk_${id}`, frames: m.attack.map((f) => ({ key: 'mskin_' + id, frame: f })), frameRate: 9, repeat: 0 });
  }

  resize() {
    const w = this.scale.width, h = this.scale.height;
    // На телефоне показываем примерно 11-13 тайлов по короткой стороне
    const town = this.zone && this.zone.kind === 'town';
    const dpr = window.GAME_DPR || 1; // холст в физических пикселях — зум умножается на плотность экрана
    // Сколько плиток видно по короткой стороне: в городе — шире (17), в данже — ближе (12)
    const target = town ? 17 : 12, side = Math.min(w, h);
    const raw = Phaser.Math.Clamp(side / (target * this.T), (town ? 0.8 : 1) * dpr, 3 * dpr);
    // Холст в полном разрешении экрана — целый масштаб: каждый пиксель рисунка ровно N пикселей экрана, без «плывущих»
    // пикселей в движении. Если ради плавности разрешение снижено (авто-качество) — точный масштаб, чтобы вид не менялся
    let zoom = raw;
    const full = dpr >= Math.min(3, window.devicePixelRatio || 1) - 0.01;
    if (full) { const n = Math.round(raw); if (n >= 1 && Math.abs(side / (n * this.T) - target) / target <= 0.3) zoom = n; }
    this.cameras.main.setZoom(zoom);
  }

  // Туман: неразведанная часть данжа и всё, что за краем карты.
  // Маска — 1 пиксель на тайл (плюс поля M тайлов вокруг карты), растянута со сглаживанием, поэтому края мягкие.
  // Поверх маски плывут два слоя клубов дымки (только в WebGL — через маску).
  buildFog(z) {
    this.destroyFog();
    const T = this.T, M = 24, W = z.w + 2 * M, H = z.h + 2 * M;
    const pal = GameScene.FOG[z.theme] || GameScene.FOG.green;
    if (this.textures.exists('fogmask')) this.textures.remove('fogmask');
    const R = 4; // пикселей маски на тайл: маска размывается, край тумана мягкий (~1.5 тайла)
    const tex = this.textures.createCanvas('fogmask', W * R, H * R), ctx = tex.getContext();
    const img = ctx.createImageData(W * R, H * R), d = img.data;
    for (let o = 0; o < d.length; o += 4) { d[o] = pal.base[0]; d[o + 1] = pal.base[1]; d[o + 2] = pal.base[2]; }
    const grid = new Uint8Array(W * H), ex = z.fog ? this.explored.get(z.id) : null;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const mx = x - M, my = y - M, inside = mx >= 0 && my >= 0 && mx < z.w && my < z.h;
      grid[y * W + x] = !inside || (ex && !ex.has(my * z.w + mx)) ? 1 : 0;
    }
    const x0 = z.ox - M * T, y0 = z.oy - M * T;
    const objs = [this.add.image(x0, y0, 'fogmask').setOrigin(0, 0).setScale(T / R).setDepth(2400)];
    const clouds = [];
    if (this.sys.game.renderer.type === Phaser.WEBGL) {
      const maskImg = this.make.image({ x: x0, y: y0, key: 'fogmask', add: false }).setOrigin(0, 0).setScale(T / R);
      const mask = maskImg.createBitmapMask();
      objs.push(maskImg);
      [[0, 4, 0.75, 9, 3], [1, 2.5, 0.5, -6, 4]].forEach(([seed, sc, a, vx, vy]) => {
        const key = this.fogClouds(z.theme, seed, pal.cloud);
        const ts = this.add.tileSprite(x0, y0, W * T / sc, H * T / sc, key).setOrigin(0, 0).setScale(sc)
          .setAlpha(a).setDepth(2401).setMask(mask);
        ts.vx = vx; ts.vy = vy;
        objs.push(ts); clouds.push(ts);
      });
    }
    this.fog = { tex, ctx, img, grid, M, W, H, R, objs, clouds, tmp: new Uint8Array(W * R * H * R) };
    this.paintFog();
    this.cameras.main.setBackgroundColor(pal.hex); // дальше полей — ровный цвет тумана
  }

  // Перерисовать маску тумана: тайлы → пиксели, затем размытие по горизонтали и вертикали (скользящее окно)
  paintFog() {
    const f = this.fog, { grid, W, R } = f, w = W * R, h = f.H * R, a = f.tmp, d = f.img.data, r = 3, n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const row = ((y / R) | 0) * W;
      for (let x = 0; x < w; x++) a[y * w + x] = grid[row + ((x / R) | 0)] * 255;
    }
    const line = new Uint16Array(Math.max(w, h));
    for (let y = 0; y < h; y++) { // по горизонтали
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        line[x] = sum / n;
        sum += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
      }
      for (let x = 0; x < w; x++) a[y * w + x] = line[x];
    }
    for (let x = 0; x < w; x++) { // по вертикали — сразу в альфу картинки
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += a[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        d[(y * w + x) * 4 + 3] = sum / n;
        sum += a[Math.min(h - 1, y + r + 1) * w + x] - a[Math.max(0, y - r) * w + x];
      }
    }
    f.ctx.putImageData(f.img, 0, 0);
    f.tex.refresh();
    f.tex.setFilter(Phaser.Textures.FilterMode.LINEAR); // игра в pixelArt — без этого маска «лесенкой»
  }

  destroyFog() {
    if (!this.fog) return;
    this.fog.objs.forEach((o) => o.destroy());
    this.fog = null;
  }

  // Бесшовная текстура клубов тумана (фрактальный шум), 256×256, один раз на мир и слой
  fogClouds(theme, seed, col) {
    const key = `fogcloud_${theme}_${seed}`;
    if (this.textures.exists(key)) return key;
    const S = 256, c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d'), img = ctx.createImageData(S, S), d = img.data;
    let st = 1234567 + seed * 7919;
    const rnd = () => ((st = (st * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const octs = [[4, 0.5], [8, 0.27], [16, 0.15], [32, 0.08]].map(([n, amp]) => ({ n, amp, g: Array.from({ length: n * n }, rnd) }));
    const sm = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let v = 0;
      for (const { n, amp, g } of octs) {
        const fx = x / S * n, fy = y / S * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
        const x1 = (ix + 1) % n, y1 = (iy + 1) % n; // по модулю — текстура бесшовная
        const a = g[iy * n + ix], b = g[iy * n + x1], c2 = g[y1 * n + ix], e = g[y1 * n + x1];
        v += amp * ((a + (b - a) * tx) * (1 - ty) + (c2 + (e - c2) * tx) * ty);
      }
      const o = (y * S + x) * 4;
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2];
      d[o + 3] = Math.round(255 * Phaser.Math.Clamp((v - 0.42) * 2.6, 0, 1));
    }
    ctx.putImageData(img, 0, 0);
    this.textures.addCanvas(key, c).setFilter(Phaser.Textures.FilterMode.LINEAR);
    return key;
  }

  // Строит карту зоны: тайлы, здания, порталы, телепорт
  buildZone(z) {
    const T = this.T;
    if (this.layer) { this.layer.destroy(); this.tilemap.destroy(); }
    this.zoneObjs.forEach((o) => o.destroy());
    this.zoneObjs = [];
    this.zone = z;
    if (z.kind === 'town') { try { localStorage.setItem('lastTown', z.theme); } catch { /* приватный режим */ } } // фон лобби — по этому городу
    const data2d = [];
    const art = WorldArt.has(z.theme), dungeon = z.kind !== 'town' && z.kind !== 'worldboss' && z.kind !== 'pvp';
    for (let y = 0; y < z.h; y++) {
      const row = z.tiles.slice(y * z.w, (y + 1) * z.w);
      data2d.push(art ? row.map((t, x) => WorldArt.remap(t === 16 ? this.groundUnder(z, x, y) : t, x, y, dungeon)) : row);
    }
    this.tilemap = this.make.tilemap({ data: data2d, tileWidth: T, tileHeight: T });
    const ts = this.tilemap.addTilesetImage('tiles_' + z.theme, 'tiles_' + z.theme, T, T, 0, 0);
    this.layer = this.tilemap.createLayer(0, ts, z.ox, z.oy).setDepth(0);
    // Нарисованные миры: земля одной картинкой с плавными переходами (WorldArt.terrain), сетка тайлов скрыта
    if (this.terrainImg) { this.terrainImg.destroy(); if (this.textures.exists('terrain')) this.textures.remove('terrain'); this.terrainImg = null; }
    // Арена мирового босса — одна нарисованная картинка; внутренний край стен совпадает с краем проходимого круга
    if (art && (z.kind === 'worldboss' || z.kind === 'pvp') && this.textures.exists('arena_' + z.theme)) {
      const R = (Math.min(z.w, z.h) / 2 - 1) * T, size = R / 0.39;
      this.terrainImg = this.add.image(z.ox + z.w * T / 2, z.oy + z.h * T / 2, 'arena_' + z.theme).setDisplaySize(size, size).setDepth(0);
      this.layer.setVisible(false);
    } else if (art) {
      try {
        this.textures.addCanvas('terrain', WorldArt.terrain(this, z, data2d));
        this.terrainImg = this.add.image(z.ox, z.oy, 'terrain').setOrigin(0, 0).setDepth(0);
        this.layer.setVisible(false);
      } catch (e) { console.warn('terrain', e); }
    }
    this.solid = new Set(z.solid);
    this.mapW = z.w; this.mapH = z.h; this.tiles = z.tiles;
    // Туман войны: в данже карта открывается по мере прохождения
    this.fogTile = null;
    if (z.fog && !this.explored.has(z.id)) this.explored.set(z.id, new Set());
    this.buildFog(z); // туман в данже и за краем карты в любой зоне
    // Камера без границ карты: герой всегда в центре экрана, даже у края зоны
    this.cameras.main.removeBounds();
    // Нарисованные деревья на клетках леса (клетка остаётся непроходимой)
    if (art) {
      for (let y = 0; y < z.h; y++) for (let x = 0; x < z.w; x++) {
        if (z.tiles[y * z.w + x] !== 2) continue;
        const px = z.ox + x * T + T / 2, py = z.oy + y * T + T - 2;
        this.zoneObjs.push(this.add.image(px, py, `obj_${z.theme}_${WorldArt.treeAt(x, y, z.theme)}`).setOrigin(0.5, 1).setDepth(10 + py));
      }
    }
    // Пятна на полу данжей: решётки, кровь, руны, кости (под ногами, поверх земли)
    if (art && dungeon) {
      for (let y = 0; y < z.h; y++) for (let x = 0; x < z.w; x++) {
        const t = data2d[y][x], k = (t === 13 || t === 17) && WorldArt.decalAt(x, y), key = k && `dun_${z.theme}_${k}`;
        if (key && this.textures.exists(key)) this.zoneObjs.push(this.add.image(z.ox + x * T + T / 2, z.oy + y * T + T / 2, key).setDisplaySize(64, 64).setAngle((WorldArt.hash(x, y) % 4) * 90).setDepth(1));
      }
    }
    // Ворота комнаты босса (открываются, когда босс в комнате)
    this.gates = new Map();
    for (const g of z.gates || []) {
      const side = g.side === 'left' || g.side === 'right';
      const sideArt = side && this.textures.exists(`gate_${z.theme}_side_${g.state}`);
      const key = sideArt ? `gate_${z.theme}_side_${g.state}` : `gate_${z.theme}_${g.state}`;
      if (!this.textures.exists(key)) continue;
      const img = this.add.image(g.x, g.y, key).setOrigin(0.5, 1);
      const src = img.frame;
      if (side) {
        // Вход сбоку: ворота стоят вдоль стены — высота по проходу, узкие; без боковой картинки — сжатые обычные (в перспективе)
        const h = ((g.n || 3) + 1.5) * this.T;
        img.setDisplaySize(sideArt ? h * src.width / src.height : this.T * 1.4, h).setDepth(10 + g.y);
        if (sideArt && g.side === 'left') img.setFlipX(true); // проём смотрит в коридор, откуда идёт герой
        img.gateSide = sideArt ? g.side : null;
      } else img.setDisplaySize(g.w, g.w * src.height / src.width).setDepth(10 + g.y);
      img.gateState = g.state;
      this.zoneObjs.push(img); this.gates.set(g.i, img);
    }
    // Нарисованные украшения (статуи, фонтаны, сундуки): сервер ставит их на непроходимые клетки DECO
    for (const d of z.deco || []) {
      const key = d.k.startsWith('p_') ? `prop_${d.k.slice(2)}` : `deco_${z.theme}_${d.k}`;
      if (this.textures.exists(key)) this.zoneObjs.push(this.add.image(d.x, d.y, key).setOrigin(0.5, 1).setDepth(10 + d.y));
    }
    const keep = (o) => { this.zoneObjs.push(o); return o; };
    const labelStyle = { fontSize: '11px', fontFamily: 'Arial', color: '#fff6d8', stroke: '#000', strokeThickness: 3, resolution: 2 };
    // Подпись здания: нарисованный значок места + название
    const placeLabel = (o, x, y) => {
      const t = keep(this.add.text(x, y, o.name, labelStyle).setOrigin(0.5, 1).setDepth(3000));
      if (!this.textures.exists('place_' + o.place)) { t.setText(`${o.icon} ${o.name}`); return; }
      const ic = keep(this.add.image(0, y + 2, 'place_' + o.place).setOrigin(0.5, 1).setDepth(3000));
      ic.setScale(20 / ic.height);
      const w = ic.displayWidth + 2 + t.width;
      ic.x = x - w / 2 + ic.displayWidth / 2; t.x = x - w / 2 + ic.displayWidth + 2 + t.width / 2;
    };
    const PORTAL_COL = [0x5fd17a, 0x8ad3ff, 0xc890ff, 0xff8a5a, 0xffd84a, 0xff4a4a];
    for (const o of z.objs) {
      if (o.kind === 'place' && o.place !== 'teleport') {
        const key = `bld_${z.theme}_${o.place}`;
        if (!this.textures.exists(key)) this.textures.addCanvas(key, Gfx.building(o.place, z.theme));
        const img = keep(this.add.image(o.bx + o.bw / 2, o.by + o.bh + (art ? 6 : 0), key).setOrigin(0.5, 1).setDepth(10 + o.by + o.bh - 8));
        img.setInteractive().on('pointerdown', (ptr) => { if (!this.uiBlocked(ptr)) this.goTo(o); });
        placeLabel(o, o.bx + o.bw / 2, img.y - img.displayHeight + (art ? 6 : 0));
      } else if (o.place === 'teleport') {
        const col = { green: 0x5fd1c8, abyss: 0xb04aff, sky: 0xffd84a }[z.theme];
        if (art) {
          // Нарисованная платформа телепорта и фонари вокруг площади
          keep(this.add.image(o.x, o.y + 4, `ptl_${z.theme}_teleport`).setOrigin(0.5, 0.62).setDepth(1));
          for (const [dx, dy] of [[-120, -80], [120, -80], [-120, 90], [120, 90]]) keep(this.add.image(o.x + dx, o.y + dy, `obj_${z.theme}_lantern`).setOrigin(0.5, 1).setDepth(10 + o.y + dy));
        } else {
          keep(this.add.ellipse(o.x, o.y, 92, 46, 0x000000, 0.25).setDepth(1));
          keep(this.add.ellipse(o.x, o.y, 84, 40, 0x8a8f99).setStrokeStyle(3, 0x5a5f68).setDepth(1));
        }
        const ring = keep(this.add.ellipse(o.x, o.y, 64, 30).setStrokeStyle(3, col, 0.9).setDepth(2));
        const glow = keep(this.add.ellipse(o.x, o.y, 50, 22, col, 0.35).setDepth(2));
        glow.setInteractive().on('pointerdown', (ptr) => { if (!this.uiBlocked(ptr)) this.goTo(o); });
        this.tweens.add({ targets: ring, scaleX: 1.15, scaleY: 1.15, alpha: 0.4, duration: 900, yoyo: true, repeat: -1 });
        this.tweens.add({ targets: glow, alpha: 0.7, duration: 600, yoyo: true, repeat: -1 });
        const beam = keep(this.add.rectangle(o.x, o.y - 30, 30, 60, col, 0.15).setDepth(5));
        this.tweens.add({ targets: beam, alpha: 0.05, duration: 1200, yoyo: true, repeat: -1 });
        placeLabel(o, o.x, o.y - 30);
      } else if (o.kind === 'portal') {
        const col = o.world ? 0xff3a3a : o.id === 'exit' ? 0x7dff8a : !o.num ? 0xffd36a : PORTAL_COL[(o.num - 1) % 6];
        keep(this.add.ellipse(o.x, o.y + 22, 50, 14, 0x000000, 0.3).setDepth(1));
        let top = o.y - 32;
        if (art) {
          // Нарисованная арка: обычная, выход из данжа или драконьи врата мирового босса
          const kind = o.world ? 'boss' : o.id === 'exit' ? 'exit' : 'arch';
          // Возврат в город из данжа — алтарь с порталом
          const tex = z.kind === 'dungeon' && o.id === 'back' && this.textures.exists('prop_exitAltar') ? 'prop_exitAltar' : `ptl_${z.theme}_${kind}`;
          const arch = keep(this.add.image(o.x, o.y + 26, tex).setOrigin(0.5, 1).setDepth(10 + o.y + 20));
          top = arch.y - arch.displayHeight + 2;
          if (o.world) for (const dx of [-62, 62]) keep(this.add.image(o.x + dx, o.y + 26, `obj_${z.theme}_dragonStatue`).setOrigin(0.5, 1).setDepth(10 + o.y + 26));
        } else {
          // Каменная арка и вращающаяся воронка
          keep(this.add.rectangle(o.x - 24, o.y, 8, 50, 0x6a6560).setDepth(10 + o.y + 20));
          keep(this.add.rectangle(o.x + 24, o.y, 8, 50, 0x6a6560).setDepth(10 + o.y + 20));
          keep(this.add.rectangle(o.x, o.y - 26, 58, 8, 0x5a5550).setDepth(10 + o.y + 20));
        }
        const swirl = keep(this.add.ellipse(o.x, o.y + 2, 38, 46, col, 0.55).setStrokeStyle(3, 0xffffff, 0.7).setDepth(10 + o.y));
        swirl.setInteractive().on('pointerdown', (ptr) => { if (!this.uiBlocked(ptr)) this.goTo(o); });
        const core = keep(this.add.ellipse(o.x, o.y + 2, 18, 26, 0xffffff, 0.5).setDepth(10 + o.y + 1));
        this.tweens.add({ targets: swirl, scaleX: 0.8, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: core, alpha: 0.15, scale: 1.4, duration: 900, yoyo: true, repeat: -1 });
        const title = !o.num ? `${o.icon} ${o.name}${o.world ? ` · ур. ${o.lv[0]}` : ''}` : `${['I', 'II', 'III', 'IV', 'V', 'VI'][o.num - 1]} · ${o.name} · ур. ${o.lv[0]}–${o.lv[1]}`;
        keep(this.add.text(o.x, top, title, { ...labelStyle, fontSize: '10px' }).setOrigin(0.5, 1).setDepth(3000));
      }
    }
    this.nearObj = undefined;
    this.autoObj = undefined; // undefined — ещё не проверяли: объект рядом с точкой появления сам не срабатывает
    if (this.layer && this.scale) this.resize();
    this.ui.onZone(z);
  }

  // Земля под украшением (клетка 16): самый частый соседний проходимый тайл — площадь, трава или пепел
  groundUnder(z, x, y) {
    const cnt = {};
    for (let r = 1; r <= 2; r++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const t = z.tiles[(y + dy * r) * z.w + x + dx * r];
      if (t === 0 || t === 3 || t === 4 || t === 5 || t === 8) cnt[t] = (cnt[t] || 0) + 1;
    }
    const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    return best ? +best[0] : 0;
  }

  // Раскрыть туман вокруг героя (радиус 7 тайлов)
  revealFog() {
    const z = this.zone;
    if (!z || !z.fog || !this.fog || !this.me) return;
    const tx = Math.floor((this.me.x - z.ox) / this.T), ty = Math.floor((this.me.y - z.oy) / this.T);
    const key = tx * 1000 + ty;
    if (key === this.fogTile) return;
    this.fogTile = key;
    const set = this.explored.get(z.id), R = 7, f = this.fog;
    let changed = false;
    for (let y = ty - R; y <= ty + R; y++) for (let x = tx - R; x <= tx + R; x++) {
      if (x < 0 || y < 0 || x >= z.w || y >= z.h || (x - tx) ** 2 + (y - ty) ** 2 > R * R) continue;
      const i = y * z.w + x;
      if (set.has(i)) continue;
      set.add(i);
      f.grid[(y + f.M) * f.W + x + f.M] = 0;
      changed = true;
    }
    if (changed) this.paintFog();
  }

  // Тап по зданию/порталу: герой сам идёт к нему (если уже рядом — сразу действие)
  goTo(o) {
    if (!this.me) return;
    if (this.nearObj === o) { this.ui.onActivate(o, this.zone); return; }
    const path = this.findPath(this.me.x, this.me.y, o.x, o.y + (o.kind === 'portal' ? 20 : 4));
    this.walkTo = path && path.length ? { path, stuck: 0, target: o } : null;
    this.autoWalk = null;
  }

  // Поиск пути по тайлам (BFS, 8 направлений без срезания углов) → список точек
  findPath(fx, fy, tx, ty) {
    const T = this.T, z = this.zone, W = z.w, H = z.h;
    const toT = (x, y) => [Math.floor((x - z.ox) / T), Math.floor((y - z.oy) / T)];
    const [sx, sy] = toT(fx, fy);
    let [ex, ey] = toT(tx, ty);
    const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !this.solid.has(this.tiles[y * W + x]);
    if (!free(ex, ey)) { // цель внутри стены — ищем ближайший свободный тайл
      let best = null, bd = 1e9;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (free(ex + dx, ey + dy) && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = [ex + dx, ey + dy]; }
      if (!best) return null;
      [ex, ey] = best;
    }
    const prev = new Int32Array(W * H).fill(-1);
    const start = sy * W + sx, goal = ey * W + ex;
    prev[start] = start;
    const q = [start];
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let qi = 0; qi < q.length && prev[goal] < 0; qi++) {
      const c = q[qi], cx = c % W, cy = (c - cx) / W;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy, ni = ny * W + nx;
        if (!free(nx, ny) || prev[ni] >= 0) continue;
        if (dx && dy && (!free(cx + dx, cy) || !free(cx, cy + dy))) continue;
        prev[ni] = c; q.push(ni);
      }
    }
    if (prev[goal] < 0) return null;
    const pts = [{ x: tx, y: ty }];
    for (let c = prev[goal]; c !== start; c = prev[c]) { const cx = c % W; pts.push({ x: z.ox + (cx + 0.5) * T, y: z.oy + ((c - cx) / W + 0.5) * T }); }
    return pts.reverse();
  }

  // Ближайший объект зоны, с которым можно взаимодействовать
  checkNear() {
    if (!this.me || !this.zone) return;
    let best = null, bd = 64;
    for (const o of this.zone.objs) {
      const d = Math.hypot(o.x - this.me.x, o.y - this.me.y);
      if (d < (o.place === 'teleport' ? 56 : bd)) { best = o; bd = d; }
    }
    if (best !== this.nearObj) { this.nearObj = best; this.ui.onNear(best, this.zone); }
    // Вход без кнопки: шагнул к порталу или к двери здания — сразу телепорт / окно места.
    // Срабатывает только при входе в радиус (не повторяется, пока стоишь рядом) и не при появлении рядом
    let auto = null, ad = 1e9;
    for (const o of this.zone.objs) {
      const d = Math.hypot(o.x - this.me.x, o.y - this.me.y);
      // Телепорт стоит посреди города на пути — срабатывает, только если наступить на сам круг
      const R = o.kind === 'portal' ? 44 : o.place === 'teleport' ? 24 : 40;
      if (d < R && d < ad) { auto = o; ad = d; }
    }
    if (auto === this.autoObj) return;
    const first = this.autoObj === undefined;
    this.autoObj = auto;
    if (!auto || first || this.zoneLoading || (this.me.data && this.me.data.dead)) return;
    if (this.walkTo && this.walkTo.target && this.walkTo.target !== auto) return; // идём по тапу к другому месту — мимо
    if (this.autoFarm && !(this.walkTo && this.walkTo.target === auto)) return; // автобой не уводит из данжа через портал
    if (this.time.now < (this.autoAt || 0)) return;
    this.autoAt = this.time.now + 1200; // защита от двойного срабатывания
    this.walkTo = null; this.autoWalk = null;
    this.ui.onActivate(auto, this.zone);
  }

  isSolidAt(px, py) {
    const tx = Math.floor((px - this.zone.ox) / this.T), ty = Math.floor((py - this.zone.oy) / this.T);
    if (tx < 0 || ty < 0 || tx >= this.mapW || ty >= this.mapH) return true;
    return this.solid.has(this.tiles[ty * this.mapW + tx]);
  }

  // Прямая видимость (как на сервере): стены, скалы и деревья закрывают цель
  lineOfSight(ax, ay, bx, by) {
    const dist = Math.hypot(bx - ax, by - ay), n = Math.ceil(dist / 8);
    for (let i = 1; i < n; i++) {
      const k = i / n;
      if (k * dist < 12 || (1 - k) * dist < 12) continue;
      const tx = Math.floor((ax + (bx - ax) * k - this.zone.ox) / this.T), ty = Math.floor((ay + (by - ay) * k - this.zone.oy) / this.T);
      if (tx < 0 || ty < 0 || tx >= this.mapW || ty >= this.mapH) return false;
      const t = this.tiles[ty * this.mapW + tx];
      if (t === 2 || t === 6 || t === 7 || t === 16) return false;
    }
    return true;
  }

  // ---------- Сущности ----------
  makeEntity(texture, name, nameColor, interactiveId) {
    const sprite = this.add.sprite(0, 0, texture);
    const label = this.add.text(0, -26, name, {
      fontSize: '10px', fontFamily: 'Arial', color: nameColor, stroke: '#000', strokeThickness: 3, resolution: 2,
    }).setOrigin(0.5, 1).setVisible(Settings.get('names'));
    const barBg = this.add.rectangle(0, -22, 28, 4, 0x000000).setOrigin(0.5);
    const bar = this.add.rectangle(-14, -22, 28, 4, 0xe24c4c).setOrigin(0, 0.5);
    const c = this.add.container(0, 0, [sprite, barBg, bar, label]);
    if (interactiveId) {
      sprite.setInteractive(new Phaser.Geom.Rectangle(-8, -8, sprite.width + 16, sprite.height + 16), Phaser.Geom.Rectangle.Contains);
      sprite.setData('monsterId', interactiveId);
    }
    return { c, sprite, bar, label, tx: 0, ty: 0 };
  }

  // Нарисованный скин: анимированный лист 8 направлений вместо процедурного спрайта
  applySkin(e, heroId) {
    e.skin = this.textures.exists('skin_' + heroId) ? heroId : null;
    e.skinOn = !!e.skin;
    if (!e.skin) { e.sprite.stop(); e.sprite.setTexture('hero_' + heroId).setOrigin(0.5); return; }
    const sk = Skins.get(heroId);
    e.row = e.row || 0;
    e.sprite.setFlipX(false).setTexture('skin_' + heroId, e.row * sk.frames).setOrigin(0.5, (sk.h - 15) / sk.h);
    const top = -(sk.h - 15) - 2;
    e.label.y = top - 4; e.bar.y = top; e.c.list[1].y = top;
  }

  // Нарисованный звериный облик: шаг и поворот по направлению движения
  animBeast(e, vx, vy, moving) {
    if (!e.beast || e.attacking) return;
    const bs = Skins.get(e.beast).beast;
    if (moving && (Math.abs(vx) > 0.3 || Math.abs(vy) > 0.3)) {
      e.bdir = Math.abs(vy) > Math.abs(vx) * 1.2 ? (vy > 0 ? 'down' : 'up') : 'side';
      e.sprite.setFlipX(e.bdir === 'side' && vx < 0);
    }
    const key = `bwalk_${e.beast}_${e.bdir || 'down'}`;
    if (moving) { if (!e.sprite.anims.isPlaying || e.sprite.anims.currentAnim.key !== key) e.sprite.play(key, true); }
    else { if (e.sprite.anims.isPlaying) e.sprite.stop(); e.sprite.setFrame(bs[e.bdir || 'down'][0]); }
  }

  // Направление и шаг скина: (vx, vy) — куда идём; moving — идём ли сейчас
  animSkin(e, vx, vy, moving) {
    if (!e.skinOn || e.attacking) return; // во время удара играет анимация атаки (HeroFx)
    if (vx || vy) e.row = Skins.rowFor(vx, vy);
    const key = `skin_${e.skin}_${e.row}`;
    if (moving) {
      if (!e.sprite.anims.isPlaying || e.sprite.anims.currentAnim.key !== key) e.sprite.play(key, true);
    } else {
      if (e.sprite.anims.isPlaying) e.sprite.stop();
      const f = e.row * Skins.get(e.skin).frames;
      if (e.sprite.frame.name !== f) e.sprite.setFrame(f);
    }
  }

  setBar(e, hp, maxHp) {
    const k = Phaser.Math.Clamp(hp / maxHp, 0, 1);
    e.bar.width = (e.bigBar || 28) * k;
    e.bar.fillColor = k > 0.5 ? 0x5ad65a : k > 0.25 ? 0xffc040 : 0xe24c4c;
  }

  onState(s) {
    this.netClock(s.ts);
    // Игроки
    const seen = new Set();
    for (const p of s.p) {
      seen.add(p.id);
      let e = this.players.get(p.id);
      if (!e) {
        const isMe = p.id === this.myId;
        this.needHero(p.hero); // чужой герой — догрузить его нарисованный лист
        e = this.makeEntity('hero_' + p.hero, `${p.name} [${p.lvl}]`, isMe ? '#ffcc4d' : '#ffffff');
        if (!isMe) { // тап по чужому герою — его профиль (снаряжение, сила, приглашение в группу)
          e.sprite.setInteractive(new Phaser.Geom.Rectangle(-10, -10, e.sprite.width + 20, e.sprite.height + 20), Phaser.Geom.Rectangle.Contains);
          e.sprite.setData('playerId', p.id);
        }
        e.c.setPosition(p.x, p.y);
        this.applySkin(e, p.hero);
        this.players.set(p.id, e);
        if (isMe) {
          this.me = { x: p.x, y: p.y, e, data: p, dir: 1 };
          this.cameras.main.startFollow(e.c, true, 1, 1); // камера жёстко закреплена на герое, без запаздывания
        }
      }
      this.trackPos(e, p.x, p.y, s.ts);
      e.data = p;
      e.label.setText(`${p.tag ? `[${p.tag}] ` : ''}${p.name} [${p.lvl}]`); // тег клана перед именем
      // Спутник рядом с героем (виден всем)
      if ((e.cpKey || null) !== (p.cp || null)) { e.cpKey = p.cp || null; if (e.cmp) { e.cmp.destroy(); e.cmp = null; } if (p.cp) this.attachComp(e, p.cp); }
      if (e.cmp) { const dir = p.id === this.myId && this.me ? this.me.dir : p.dir || 1; e.cmp.setFlipX(dir < 0); e.cmp.x = -dir * 24; }
      // Внешний вид за самоцветы: цвет имени и сияние под героем
      const nc = p.nc || (p.id === this.myId ? '#ffcc4d' : '#ffffff');
      if (e.nc !== nc) { e.nc = nc; e.label.setColor(nc); }
      if ((e.auKey || null) !== (p.au || null)) {
        e.auKey = p.au || null;
        if (e.cosAura) { e.cosAura.destroy(); e.cosAura = null; }
        if (p.au) {
          e.cosAura = this.add.ellipse(0, 8, 36, 14, p.au, 0.3).setStrokeStyle(2, p.au, 0.9);
          e.c.addAt(e.cosAura, 0);
          this.tweens.add({ targets: e.cosAura, alpha: 0.45, scaleX: 1.12, scaleY: 1.12, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        }
      }
      this.setBar(e, p.hp, p.maxHp);
      e.c.setAlpha(p.dead ? 0.35 : 1);
      // Аура усиления (рёв ярости, кровавое безумие)
      if (p.rage && !e.aura && e.skinOn && HeroFx.hasFx(this, e.skin, 'aura')) {
        e.aura = HeroFx.auraSprite(this, e); // нарисованная аура ярости
      } else if (p.rage && !e.aura) {
        e.aura = this.add.circle(0, 4, 18, 0xff3020, 0.25).setStrokeStyle(2, 0xff6040, 0.8);
        e.c.addAt(e.aura, 0);
        this.tweens.add({ targets: e.aura, scale: 1.25, alpha: 0.5, duration: 300, yoyo: true, repeat: -1 });
      } else if (!p.rage && e.aura) { e.aura.destroy(); e.aura = null; }
      // Пакт с духом (Зу'кра) — цветная аура; Облик древа (Нимуэ) — зелёная
      // ...и стихия Аурелиуса
      const ELEM = { fire: 0xff6a1a, ice: 0x8ad3ff, lightning: 0xffe94a, earth: 0xa07a4a };
      const VOW = { protection: 0x8ad3ff, retribution: 0xffb030, mercy: 0xffd0e0 };
      const SONG = { inspire: 0xffb030, lullaby: 0x8a9aff, mock: 0xff6a9a };
      e.elem = p.elem || null; // текущая стихия Аурелиуса — для нарисованных снарядов
      const auraCol = p.pact ? { fury: 0xff3020, stone: 0x9aa3ad, wind: 0x8ad3ff }[p.pact] : p.tree ? 0x5fd17a : p.elem ? ELEM[p.elem]
        : p.bless ? 0xfff0a0 : p.vow ? VOW[p.vow] : p.song ? SONG[p.song]
        : p.asp ? { fire: 0xff6a1a, ice: 0x8ad3ff, poison: 0x7ad84a, lightning: 0xffe94a }[p.asp]
        : p.abyss ? 0x8a2a5a : p.rootSelf ? 0x5aa83a : p.ash ? 0x6a5a50
        : p.flame ? { spark: 0xfff0a0, bonfire: 0xffa020, avalanche: 0xff3a10 }[p.flame] : p.phase ? { waxing: 0xc8d0ff, full: 0xf4f6ff, waning: 0x8a9aff, newmoon: 0x4a3a8a }[p.phase]
        : p.wrune ? { fire: 0xff6a1a, ward: 0x5fb0ff, heal: 0x7dff8a }[p.wrune] : p.heat >= 70 ? 0xff6a1a
        : p.stoneArmor ? 0xa09a90 : p.might ? 0xd84a2a : null;
      // Песня барда: по кругу 180 разлетаются ноты
      if (p.song && (!e.nextNote || this.time.now > e.nextNote)) {
        e.nextNote = this.time.now + 450;
        const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 130;
        const n = this.add.text(e.c.x + Math.cos(a) * d, e.c.y + Math.sin(a) * d * 0.6, Math.random() < 0.5 ? '♪' : '♫',
          { fontSize: '13px', color: '#' + SONG[p.song].toString(16).padStart(6, '0') }).setOrigin(0.5).setDepth(900);
        this.tweens.add({ targets: n, y: n.y - 26, alpha: 0, duration: 1200, onComplete: () => n.destroy() });
      }
      if (auraCol !== (e.auraCol ?? null)) {
        if (e.extraAura) { e.extraAura.destroy(); e.extraAura = null; }
        e.auraCol = auraCol;
        if (auraCol !== null) {
          e.extraAura = this.add.circle(0, 4, 17, auraCol, 0.2).setStrokeStyle(2, auraCol, 0.9);
          e.c.addAt(e.extraAura, 0);
          this.tweens.add({ targets: e.extraAura, scale: 1.2, duration: 450, yoyo: true, repeat: -1 });
        }
      }
      // Кристаллы Брильды парят вокруг
      const cryKey = (p.cry || []).join(',');
      if (cryKey !== (e.cryKey || '')) {
        e.cryKey = cryKey;
        (e.cryObjs || []).forEach((o) => o.destroy());
        const COL = { atk: 0xff5a7a, def: 0x5ab8ff, heal: 0x7ad87a, spd: 0xffd84a };
        e.cryObjs = (p.cry || []).map((fc) => { const o = this.add.star(0, 0, 4, 2.5, 6, COL[fc]).setStrokeStyle(1, 0xffffff, 0.9); e.c.add(o); return o; });
      }
      if (e.cryObjs && e.cryObjs.length) {
        const tt = this.time.now / 600;
        e.cryObjs.forEach((o, i) => { const a = tt + (i / e.cryObjs.length) * Math.PI * 2; o.setPosition(Math.cos(a) * 20, -2 + Math.sin(a) * 9); });
      }
      // Состояния от монстров: контроль, яд, замедление, проклятие
      const pcc = { stun: 'stun', freeze: 'freeze', root: 'root', confuse: 'confuse' }[p.pcc];
      this.statusRow(e, [p.dm && 'deathmark', pcc, p.pdot, p.pslow && 'slow', p.pweak && 'weak', p.sh && 'shield']);
      if (!!p.tree !== !!e.tree) { e.tree = !!p.tree; if (p.tree) e.sprite.setTint(0xb8ffb8); else e.sprite.clearTint(); }
      // Полёт (Талмира): герой поднят над землёй
      const flyY = p.fly ? -16 : 0;
      if (e.flyY !== flyY) {
        e.flyY = flyY;
        this.tweens.add({ targets: e.sprite, y: flyY, duration: 250 });
        if (p.fly && !e.flyShadow) { e.flyShadow = this.add.ellipse(0, 12, 22, 7, 0x000000, 0.35); e.c.addAt(e.flyShadow, 0); }
        if (!p.fly && e.flyShadow) { e.flyShadow.destroy(); e.flyShadow = null; }
      }
      // Барьер (Брендан)
      if (p.sh && !e.bubble) {
        e.bubble = this.add.circle(0, -2, 20).setStrokeStyle(2, 0x8ad3ff, 1).setFillStyle(0x8ad3ff, 0.18);
        e.c.add(e.bubble);
        this.tweens.add({ targets: e.bubble, alpha: 0.6, duration: 500, yoyo: true, repeat: -1 });
      } else if (!p.sh && e.bubble) { e.bubble.destroy(); e.bubble = null; }
      // Дымовая завеса — полупрозрачность; невидимость (Кассиан) — почти не видно чужим
      e.sprite.setAlpha(p.stealth ? (p.id === this.myId ? 0.35 : 0.1) : p.smoke ? 0.45 : 1);
      e.label.setAlpha(p.stealth && p.id !== this.myId ? 0.1 : 1);
      // Щит «Зова стаи»
      if (p.guard && !e.guard) {
        e.guard = this.add.circle(0, 2, 19).setStrokeStyle(2, 0x8ad3ff, 0.9).setFillStyle(0x8ad3ff, 0.12);
        e.c.addAt(e.guard, 0);
      } else if (!p.guard && e.guard) { e.guard.destroy(); e.guard = null; }
      // Свечение усиленной атаки (Дыхание гармонии)
      if (p.emp && !e.emp && e.skinOn && HeroFx.hasFx(this, e.skin, 'aura')) {
        e.emp = HeroFx.auraSprite(this, e); // нарисованная аура усиления
      } else if (p.emp && !e.emp) {
        e.emp = this.add.circle(0, 4, 15).setStrokeStyle(2, 0xffd36a, 0.9);
        e.c.addAt(e.emp, 0);
        this.tweens.add({ targets: e.emp, scale: 1.2, duration: 400, yoyo: true, repeat: -1 });
      } else if (!p.emp && e.emp) { e.emp.destroy(); e.emp = null; }
      if (p.id === this.myId) { if (this.me) this.me.data = p; } else if (!e.skinOn) e.sprite.setFlipX(p.dir === -1);
      // Смена облика (Талиесин): другой спрайт
      if ((p.form || null) !== (e.form || null)) {
        e.form = p.form || null;
        e.beast = null;
        if (p.form === 'beast') {
          e.sprite.stop(); e.skinOn = false;
          const bs = this.textures.exists('bskin_' + p.hero) && Skins.get(p.hero).beast;
          if (bs) { e.beast = p.hero; e.bdir = 'down'; e.sprite.setTexture('bskin_' + p.hero, bs.down[0]).setOrigin(0.5, (bs.h - 15) / bs.h); } // нарисованный зверь
          else e.sprite.setTexture('hero_' + p.hero + '_beast').setOrigin(0.5);
        } else this.applySkin(e, p.hero);
      }
    }
    for (const [id, e] of this.players) if (!seen.has(id)) { e.c.destroy(); this.players.delete(id); }

    // Монстры
    const seenM = new Set();
    for (const m of s.m) {
      // Цель-двойник героя на PvP-арене: своей картинки нет — целимся в самого героя (свой двойник не цель)
      if (m.pv) {
        const pe = this.players.get(m.pv);
        if (!pe || m.pv === this.myId) continue;
        if (m.tm && this.me && m.tm === this.me.data.mt) continue; // союзник по команде — не цель
        seenM.add(m.id);
        this.monsters.set(m.id, { ...pe, data: m, pvp: true });
        continue;
      }
      seenM.add(m.id);
      let e = this.monsters.get(m.id);
      if (!e) {
        const def = this.monsterDefs[m.type];
        // Цвет имени по рангу: синий — усиленный, жёлтый — редкий, оранжевый — полубосс, красный — босс, фиолетовый — мировой
        const RC = { normal: '#ffd9a0', summon: '#c8c0b0', magic: '#8ab8ff', rare: '#ffe066', mini: '#ffa040', boss: '#ff5a5a', world: '#d080ff' };
        const prefix = { magic: 'Усиленный ', mini: '★ ', boss: '👑 ', world: '👹 ' }[m.rk] || '';
        // Клон героя или тень чемпиона на арене — рисуется героем
        if (m.hs) {
          this.needHero(m.hs);
          e = this.makeEntity('hero_' + m.hs, `${m.nm} · ${m.lv}`, '#ff9a6a', m.id);
          e.c.setPosition(m.x, m.y);
          this.applySkin(e, m.hs);
          e.heroClone = true;
          this.monsters.set(m.id, e);
        }
        const ms = !e && this.textures.exists('mskin_' + m.type) && Skins.MOBS[m.type];
        if (!e && !ms) this.needMob(m.type); // пока грузится — процедурный спрайт, потом заменится
        // Босс данжа или мировой босс появился рядом — рёв
        if (!e && (m.rk === 'boss' || m.rk === 'world') && window.Sfx) Sfx.play('roar', { pitch: 0.9 });
        if (!e) e = this.makeEntity(ms ? 'mskin_' + m.type : 'mon_' + m.type, `${prefix}${m.nm || def.name} · ${m.lv}`, RC[m.rk] || '#ffd9a0', m.id);
        e.c.setPosition(m.x, m.y);
        const sz = (m.sz || 1) * (ms ? ms.scale || 1 : 1);   // нарисованные листы крупнее процедурных — свой масштаб
        e.sprite.setScale(sz);
        if (ms) {
          // Нарисованный монстр: ноги на точке позиции, полоска здоровья и имя над головой
          e.mskin = m.type;
          e.sprite.setFrame(ms.walk[0]).setOrigin(0.5, (ms.h - 15) / ms.h);
          const top = -((ms.body || ms.h) - 15) * sz - 3;   // body — рост без запаса под поднятое оружие
          e.label.y = top - 4; e.bar.y = top; e.c.list[1].y = top;
        }
        if (sz > 1.05) { const up = 16 * (sz - 1); e.label.y -= up; e.bar.y -= up; e.c.list[1].y -= up; e.bar.width = 28 * Math.min(2.2, sz); e.c.list[1].width = 28 * Math.min(2.2, sz); e.bar.x = -e.bar.width / 2; e.c.list[1].x = 0; e.bigBar = e.bar.width; }
        if (m.rk === 'world' || m.rk === 'boss') e.label.setFontSize(12);
        if (m.rk === 'rare' || m.rk === 'magic') { const glow = this.add.circle(0, 6, 16 * sz, m.rk === 'rare' ? 0xffe066 : 0x8ab8ff, 0.18); e.c.addAt(glow, 0); }
        e.c.setAlpha(0);
        this.tweens.add({ targets: e.c, alpha: 1, duration: 400 });
        this.monsters.set(m.id, e);
      }
      if (m.x !== e.tx && !e.skinOn) e.sprite.setFlipX(m.x < e.tx);
      // Значки состояний: оглушение и ослабление
      // Нарисованные значки (assets/ui/status/<имя>.webp); у редких эффектов без значка — эмодзи
      const status = [m.st && 'stun', m.wk && 'weak', m.mk && 'mark', m.sl && 'seal', m.sw && 'slow', m.tn && 'taunt', m.ws && 'weakspot', m.br && 'weak', m.ps && 'poison', m.bn && 'burn',
        (m.bc || m.bl) && 'bleed', m.rt && 'root', m.cf && 'confuse', m.fr && 'fear', m.fz && 'freeze', m.mo && 'mock', m.st2 && 'star', m.ds && 'darkseal', m.bd && 'bond', m.ch && 'charm', m.cu && 'curse',
        m.fs && 'frost', (m.sn || m.pf) && 'petrify'];
      // Печать тьмы Морвена — вращающийся знак под монстром
      if (m.ds && !e.sealFx) e.sealFx = HeroFx.sealMark(this, e);
      else if (!m.ds && e.sealFx) { e.sealFx.destroy(); e.sealFx = null; }
      if (m.sn) e.sprite.setTint(0x8a8a88); else if (e.stone) e.sprite.clearTint();
      e.stone = !!m.sn;
      this.statusRow(e, status);
      e.tx = m.x; e.ty = m.y; e.data = m;
      if (s.ts) this.bufPush(e, m.x, m.y, s.ts);
      if (m.rk === 'world') e.sprite.setAlpha(m.ai ? 0.35 : 1); // дракон в небе — полупрозрачный
      this.setBar(e, m.hp, m.maxHp);
      e.c.setAlpha(m.inv ? 0.18 : 1); // тень в невидимости
      if (!!m.sh !== !!e.shRing) { if (m.sh) { e.shRing = this.add.circle(0, 2, 15 * (m.sz || 1)).setStrokeStyle(2, 0xbfe8ff, 0.9); e.c.add(e.shRing); } else { e.shRing.destroy(); e.shRing = null; } }
    }
    for (const [id, e] of this.monsters) {
      if (!seenM.has(id)) {
        this.monsters.delete(id);
        if (e.pvp) { if (this.targetId === id) this.targetId = null; continue; }
        this.tweens.add({ targets: e.c, alpha: 0, scale: 0.4, duration: 300, onComplete: () => e.c.destroy() });
        if (this.targetId === id) this.targetId = null;
      }
    }

    // Звери-спутники
    const seenP = new Set();
    for (const pt of s.pt || []) {
      seenP.add(pt.id);
      let e = this.pets.get(pt.id);
      if (!e) {
        const names = { wolf: 'Клык', bear: 'Бурый', hawk: 'Сокол', skeleton: 'Слуга', sprite: 'Дух леса', clone: 'Двойник', turret: 'Турель', wisp: 'Дух', seaSpirit: 'Морской дух' };
        // Двойник рисуется спрайтом героя (розовый, полупрозрачный), поднятый монстр — своим спрайтом (зелёный)
        const ownerSkin = pt.kind === 'turret' && this.players.get(pt.owner) && this.players.get(pt.owner).skin;
        const turretArt = ownerSkin && this.textures.exists('turret_' + ownerSkin) ? 'turret_' + ownerSkin : null; // нарисованная турель (Ингрид)
        // Нарисованный спутник (assets/pets): двойник — только если он двойник Ле Блан
        const ownerP = this.players.get(pt.owner);
        const pk = pt.drowned ? 'drowned' : pt.kind; // утопленник Галатеи — поднятый монстр, но со своим рисунком
        const psk = this.textures.exists('psk_' + pk) && (pk !== 'clone' || (ownerP && ownerP.skin === 'leblanc')) ? pk : null;
        e = this.makeEntity(psk ? 'psk_' + psk : pt.skin || turretArt || 'pet_' + pt.kind, pt.label || names[pt.kind], pt.owner === this.myId ? '#c8f0a0' : '#d8d0c0');
        if (psk) {
          e.psk = psk;
          const [, ph] = Skins.PETS[psk];
          e.sprite.setOrigin(0.5, (ph - 6) / ph);
          e.label.y = -ph + 10; e.bar.y = e.label.y + 4; e.c.list[1].y = e.bar.y;
        }
        e.skinTint = psk ? null : pt.kind === 'clone' ? 0xffb0e8 : pt.drowned ? 0x5a7aff : pt.kind === 'minion' ? 0x8affc0 : null;
        if (e.skinTint) e.sprite.setTint(e.skinTint);
        if (pt.kind === 'clone') e.sprite.setAlpha(psk ? 0.85 : 0.65);
        e.c.setPosition(pt.x, pt.y);
        e.label.setFontSize(8);
        e.c.setScale(0.85);
        this.pets.set(pt.id, e);
      }
      if (pt.x !== e.tx) e.sprite.setFlipX(pt.x < e.tx);
      e.tx = pt.x; e.ty = pt.y; e.data = pt;
      this.setBar(e, pt.hp, pt.maxHp);
      e.c.setAlpha(pt.down ? 0.45 : 1);
      e.label.setText(pt.down ? '💤' : pt.label || { wolf: 'Клык', bear: 'Бурый', hawk: 'Сокол', skeleton: 'Слуга', sprite: 'Дух леса', clone: 'Двойник', turret: 'Турель', wisp: 'Дух', seaSpirit: 'Морской дух' }[pt.kind]);
      if (pt.boost && !e.glow) {
        e.glow = this.add.circle(0, 4, 13).setStrokeStyle(2, 0xff7ab0, 0.9);
        e.c.addAt(e.glow, 0);
      } else if (!pt.boost && e.glow) { e.glow.destroy(); e.glow = null; }
    }
    for (const [id, e] of this.pets) if (!seenP.has(id)) { e.c.destroy(); this.pets.delete(id); }

    // Тотемы
    const seenT = new Set();
    for (const t of s.t || []) {
      seenT.add(t.id);
      if (!this.totems.has(t.id)) {
        // Святая аура (золотой круг) — отдельный вид эффекта на земле
        if (t.kind === 'holyAura') {
          const area = this.add.circle(t.x, t.y, t.r, 0xffe08a, 0.18).setStrokeStyle(3, 0xffe08a, 0.8).setDepth(1).setScale(1, 0.5);
          const img = this.add.text(t.x, t.y, '✝', { fontSize: '20px', color: '#fff6c0' }).setOrigin(0.5).setDepth(2).setAlpha(0.8);
          this.tweens.add({ targets: area, alpha: 0.5, duration: 600, yoyo: true, repeat: -1 });
          this.totems.set(t.id, { area, img });
          continue;
        }
        // Песчаная зона Сирокко
        if (t.kind === 'sand') {
          const area = this.add.circle(t.x, t.y, t.r, 0xe8c878, 0.28).setStrokeStyle(2, 0xc8a050, 0.7).setDepth(1).setScale(1, 0.5);
          const img = this.add.text(t.x, t.y, '🌪', { fontSize: '16px' }).setOrigin(0.5).setDepth(2).setAlpha(0.6);
          this.tweens.add({ targets: img, angle: 360, duration: 1500, repeat: -1 });
          this.tweens.add({ targets: area, alpha: 0.5, duration: 700, yoyo: true, repeat: -1 });
          this.totems.set(t.id, { area, img });
          continue;
        }
        // Вода Волдана
        if (t.kind === 'water') {
          const area = this.add.circle(t.x, t.y, t.r, 0x3a8ad8, 0.3).setStrokeStyle(2, 0x8ad3ff, 0.8).setDepth(1).setScale(1, 0.5);
          const img = this.add.circle(t.x, t.y, t.r * 0.5).setStrokeStyle(2, 0xd8f0ff, 0.6).setDepth(1).setScale(1, 0.5);
          this.tweens.add({ targets: img, scaleX: 2, scaleY: 1, alpha: 0, duration: 1400, repeat: -1 });
          this.tweens.add({ targets: area, alpha: 0.55, duration: 900, yoyo: true, repeat: -1 });
          this.totems.set(t.id, { area, img });
          continue;
        }
        // Лава Кальдеро
        if (t.kind === 'lava') {
          const area = this.add.circle(t.x, t.y, t.r, 0xff5a1a, 0.45).setStrokeStyle(3, 0x3a1a10, 0.9).setDepth(1).setScale(1, 0.5);
          const img = this.add.circle(t.x, t.y, t.r * 0.5, 0xffd03a, 0.5).setDepth(1).setScale(1, 0.5);
          this.tweens.add({ targets: img, alpha: 0.15, duration: 500, yoyo: true, repeat: -1 });
          this.totems.set(t.id, { area, img });
          continue;
        }
        // Разлом Тордена
        if (t.kind === 'rift') {
          const g = this.add.graphics().setDepth(1);
          const dx = Math.cos(t.ang), dy = Math.sin(t.ang), L = t.r;
          g.lineStyle(10, 0x2a1a0a, 0.85).beginPath();
          g.moveTo(t.x - dx * L, t.y - dy * L);
          for (let i = -3; i <= 4; i++) { const k = i / 4; g.lineTo(t.x + dx * L * k + (i % 2 ? 7 : -7) * -dy, t.y + dy * L * k + (i % 2 ? 7 : -7) * dx); }
          g.strokePath();
          g.lineStyle(3, 0xff8a3a, 0.6).beginPath().moveTo(t.x - dx * L * 0.8, t.y - dy * L * 0.8).lineTo(t.x + dx * L * 0.8, t.y + dy * L * 0.8).strokePath();
          const img = this.add.circle(t.x, t.y, 1, 0, 0);
          this.totems.set(t.id, { area: g, img });
          continue;
        }
        // Ледяная стена Итилиора
        if (t.kind === 'iceWall') {
          const area = this.add.rectangle(t.x, t.y, 22, 160, 0xbfe8ff, 0.75).setStrokeStyle(3, 0xffffff, 0.9).setRotation(t.ang || 0).setDepth(5 + t.y);
          const img = this.add.rectangle(t.x, t.y, 8, 150, 0xffffff, 0.5).setRotation(t.ang || 0).setDepth(6 + t.y);
          area.setScale(1, 0.1); this.tweens.add({ targets: area, scaleY: 1, duration: 250, ease: 'Back.easeOut' });
          this.totems.set(t.id, { area, img });
          continue;
        }
        // Руна Гардина: огонь / защита / лечение
        if (t.kind === 'rune') {
          const col = { fire: 0xff6a1a, ward: 0x5fb0ff, heal: 0x7dff8a }[t.sub] || 0x5fb0ff;
          const area = this.add.circle(t.x, t.y, 18, col, 0.15).setStrokeStyle(2, col, 0.9).setDepth(1).setScale(1, 0.5);
          const img = this.add.text(t.x, t.y - 2, { fire: 'ᚲ', ward: 'ᛉ', heal: 'ᛒ' }[t.sub] || 'ᚱ',
            { fontSize: '16px', color: '#' + col.toString(16).padStart(6, '0'), fontStyle: 'bold' }).setOrigin(0.5).setDepth(2);
          this.tweens.add({ targets: [area, img], alpha: 0.45, duration: 600, yoyo: true, repeat: -1 });
          this.totems.set(t.id, { area, img });
          continue;
        }
        // Тотем исцеления (зелёный круг + столб) или осквернённая земля (тёмное пятно)
        const dark = t.kind === 'desecrate';
        const area = this.add.circle(t.x, t.y, t.r, dark ? 0x1a3a24 : 0x3fe08a, dark ? 0.45 : 0.08)
          .setStrokeStyle(2, dark ? 0x3fbf7a : 0x3fe08a, 0.6).setDepth(1).setScale(1, 0.5);
        const img = dark ? this.add.text(t.x, t.y, '☠', { fontSize: '18px', color: '#5fffb0' }).setOrigin(0.5).setDepth(2).setAlpha(0.7)
          : this.add.image(t.x, t.y, 'totem').setOrigin(0.5, 0.95).setDepth(10 + t.y);
        this.tweens.add({ targets: area, alpha: 0.4, duration: 500, yoyo: true, repeat: -1 });
        this.totems.set(t.id, { area, img });
      }
    }
    for (const [id, o] of this.totems) if (!seenT.has(id)) { o.area.destroy(); o.img.destroy(); this.totems.delete(id); }

    for (const f of s.fx) this.playFx(f);
    this.ui.onWorld(s, this.myId);
  }

  // ---------- Эффекты ----------
  floatText(x, y, text, color, size = 14, hold = 0) {
    const t = this.add.text(x, y, text, {
      fontSize: size + 'px', fontFamily: 'Arial', fontStyle: 'bold', color, stroke: '#000', strokeThickness: 3, resolution: 2,
      ...(hold ? { wordWrap: { width: 220 }, align: 'center' } : {}),
    }).setOrigin(0.5).setDepth(1000);
    // hold — сколько мс надпись стоит на месте, прежде чем уплыть (подсказки, которые нужно успеть прочитать)
    this.tweens.add({ targets: t, y: y - 30, alpha: 0, delay: hold, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  burst(x, y, color, n = 10) {
    const em = this.add.particles(x, y, 'particle', {
      speed: { min: 40, max: 140 }, lifespan: 450, scale: { start: 1, end: 0 }, tint: color, quantity: n, emitting: false,
    }).setDepth(900);
    em.explode(n);
    this.time.delayedCall(600, () => em.destroy());
  }

  // Нарисованная вспышка удара монстра (белая, красится в цвет атаки)
  mobBurst(x, y, color, scale = 1) {
    if (!this.textures.exists('mfx_burst')) return;
    const b = this.add.sprite(x, y, 'mfx_burst').setTint(color).setScale(scale).setDepth(870).setBlendMode(Phaser.BlendModes.ADD);
    b.play('mfx_burst'); b.once('animationcomplete', () => b.destroy());
  }

  // Звуки событий, которые касаются своего героя (public/js/sfx.js)
  playSound(f) {
    if (!window.Sfx) return;
    const me = this.myId;
    if (f.t === 'hit' && f.kind === 'm' && f.from === me) Sfx.play(f.crit ? 'crit' : f.proj ? 'shoot' : 'hit', { pitch: 0.9 + Math.random() * 0.2 });
    else if (f.t === 'hit' && f.kind === 'p' && f.target === me) Sfx.play('hurt');
    else if (f.t === 'death' && f.by === me) { Sfx.play('kill'); Sfx.play('coin'); }
    else if (f.t === 'levelup' && f.id === me) Sfx.play('levelup');
    else if (f.t === 'loot' && f.to === me) Sfx.play('loot');
    else if (f.t === 'skill' && f.from === me && !f.quiet) Sfx.play(/lightning|thunder|spark|zap|bolt/i.test(f.s) && !/element/i.test(f.s) ? 'zap' : /flame|fire|blaze|lava|erupt|inciner|flashover|dragonBreath|bomb|ember|igni/i.test(f.s) ? 'fire' : /ice|frost|freez|cryo|glacier/i.test(f.s) ? 'ice' : /shield|barrier|armor|vowOfProtection/i.test(f.s) ? 'shield' : /burst|quake|eruption|storm|flashover|incinerate|wrath|blast|explo/i.test(f.s) ? 'boom' : 'skill', { pitch: 0.8 + ((f.s.length * 7) % 10) / 20 });
    else if (f.t === 'heal' && f.target === me) Sfx.play('heal');
    else if (f.t === 'pdeath' && f.target === me) Sfx.play('death');
  }

  // Нажатие пришло не на холст игры (поверх открыто окно, панель, кнопка) — по миру не кликаем
  uiBlocked(pointer) {
    const t = pointer && pointer.event && pointer.event.target;
    if (t && t !== this.game.canvas) return true;
    const open = (id) => { const e = document.getElementById(id); return e && !e.classList.contains('hidden'); };
    return open('sheet') || open('itemCard');
  }

  // Добыча подпрыгивает из точки, лежит и улетает к своему герою (или тает)
  dropSprite(x, y, key, size) {
    if (!this.textures.exists(key)) return;
    const dx = (Math.random() - 0.5) * 36, img = this.add.image(x, y, key).setDisplaySize(size, size).setDepth(10 + y + 2);
    const sx = img.scaleX, sy = img.scaleY;
    img.setScale(sx * 0.3, sy * 0.3);
    this.tweens.add({ targets: img, x: x + dx, scaleX: sx, scaleY: sy, duration: 420, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: img, y: y - 26, duration: 210, ease: 'Quad.easeOut', yoyo: true, onComplete: () => {
      this.time.delayedCall(900, () => {
        const me = this.players.get(this.myId);
        if (!img.active) return;
        if (me) this.tweens.add({ targets: img, x: me.c.x, y: me.c.y - 14, scaleX: sx * 0.4, scaleY: sy * 0.4, alpha: 0.2, duration: 380, ease: 'Quad.easeIn', onComplete: () => img.destroy() });
        else this.tweens.add({ targets: img, alpha: 0, duration: 400, onComplete: () => img.destroy() });
      });
    } });
  }

  // Ряд значков состояний над головой: имена — картинки из assets/ui/status, остальное — эмодзи
  statusRow(e, list) {
    const items = [...new Set(list.filter(Boolean))], key = items.join('|');
    if (key === (e.statusKey || '')) return;
    e.statusKey = key;
    if (e.statusBox) e.statusBox.destroy();
    e.statusBox = null;
    if (!items.length) return;
    const box = this.add.container(0, e.label.y - 13), S = 13;
    items.forEach((k, i) => {
      const x = (i - (items.length - 1) / 2) * (S + 1);
      if (this.textures.exists('st_' + k)) box.add(this.add.image(x, 0, 'st_' + k).setDisplaySize(S, S));
      else box.add(this.add.text(x, 0, k, { fontSize: '11px', resolution: 2 }).setOrigin(0.5));
    });
    e.c.add(box); e.statusBox = box;
  }

  // Кадры атаки нарисованного монстра (удар, выстрел, умение)
  mobSwing(m, tx) {
    if (!m || !m.mskin || m.attacking) return;
    if (tx != null) m.sprite.setFlipX(tx < m.c.x);
    m.attacking = true;
    m.sprite.play(`matk_${m.mskin}`);
    m.sprite.once('animationcomplete', () => { m.attacking = false; m.sprite.setFrame(Skins.MOBS[m.mskin].walk[0]); });
  }
  playFx(f) {
    // Свой обычный удар уже показан сразу по нажатию (predictAttack) — от сервера берём только урон, без повторной анимации и звука
    if (f.t === 'hit' && f.kind === 'm' && f.basic && !f.pet && f.from === this.myId && this.localAtk) {
      const now = performance.now(), i = this.localAtk.findIndex((x) => x.target === f.target && now - x.at < 1500);
      if (i >= 0) { this.localAtk.splice(i, 1); f.predicted = true; }
      else this.localAtk = this.localAtk.filter((x) => now - x.at < 1500);
    }
    if (f.t === 'skill' && f.from === this.myId && this.localSkill && this.localSkill.s === f.s && performance.now() - this.localSkill.at < 1500) { this.localSkill = null; f.predicted = true; }
    if (!f.predicted || (f.crit && f.t === 'hit')) this.playSound(f);
    // Умения монстров (круг на земле, призыв, рывок, бафф, лечение) — тоже с кадрами атаки
    if (f.from && /^(mswing|tele|teleHit|msum|mtext|mdash|mheal|mbuff|mrevive)$/.test(f.t)) this.mobSwing(this.monsters.get(f.from), f.t === 'tele' || f.t === 'mswing' ? f.x : null);
    if (f.t === 'hit' && f.kind === 'm') {
      const e = this.monsters.get(f.target);
      const doHit = () => {
        const tgt = this.monsters.get(f.target);
        const x = tgt ? tgt.c.x : f.tx, y = tgt ? tgt.c.y : f.ty;
        // Отражённый урон (возмездие Малакора) — фиолетовым
        if (Settings.get('dmgNums')) this.floatText(x, y - 20, (f.crit ? '💥' : '') + f.dmg, f.reflect ? '#c890ff' : f.crit ? '#ffde3a' : '#ffffff', f.crit ? 18 : 14);
        if (tgt) { tgt.sprite.setTintFill(0xffffff); this.time.delayedCall(80, () => tgt.sprite.clearTint()); }
        const col = f.reflect ? 0xb060ff : f.confused ? 0xff7ad0 : { venom: 0x7ad84a, bolt: 0xffc850, blood: 0xc0101a, arrow: 0xfff6c0, arcane: 0xc8a0ff, note: 0xffe08a, necro: 0x5fffb0, holy: 0xfff0a0, spirit: 0x9ff0ff, shadow: 0xb060ff, darkfire: 0x7a2ab0, leaf: 0x5fd17a,
          illusion: 0xff7ad0, fireball: 0xff8c1a, frost: 0x8ad3ff, spark: 0xffe94a, stone: 0xa07a4a, moon: 0xdfe4ff, water: 0x5ab8ff, sonic: 0x9ff0e0, dark: 0xb04aff, crystal: 0xd8b0ff, sand: 0xe8c878, rune: 0x5fb0ff, soul: 0xbfeaff }[f.proj] || 0xff4040;
        this.burst(x, y, col, 6);
      };
      if (f.predicted) { doHit(); return; } // анимация и снаряд уже были — только цифра урона и вспышка
      const attacker = f.pet ? this.pets.get(f.pet) : this.players.get(f.from);
      // Герои с нарисованным скином: свой удар (рывок, взмах оружием) — public/js/herofx.js
      const tx0 = e ? e.c.x : f.tx, ty0 = e ? e.c.y : f.ty;
      let ownSwing = !f.pet && f.basic && !f.proj && attacker && HeroFx.attack(this, attacker, f, tx0, ty0);
      if (!ownSwing && !f.pet && f.basic && attacker && attacker.beast) {
        // Удар лапами нарисованного зверя
        const bs = Skins.get(attacker.beast).beast;
        attacker.sprite.setFlipX(tx0 < attacker.c.x); attacker.attacking = true; attacker.bdir = 'side';
        attacker.sprite.play(`batk_${attacker.beast}`);
        // бросок к цели и обратно
        const dx = Math.sign(tx0 - attacker.c.x) * 10;
        this.tweens.add({ targets: attacker.sprite, x: dx, duration: 90, yoyo: true, onComplete: () => { attacker.sprite.x = 0; } });
        attacker.sprite.once('animationcomplete', () => { attacker.attacking = false; if (attacker.beast) attacker.sprite.setFrame(bs.side[0]); });
        HeroFx.fxPlay && HeroFx.fxPlay(this, attacker.beast, 'hit', tx0, ty0 - 8, { scale: f.crit ? 1 : 0.7 });
        ownSwing = true;
      }
      if (attacker && !ownSwing) this.tweens.add({ targets: attacker.sprite, scaleX: 1.2, scaleY: 0.9, duration: 70, yoyo: true });
      const petE = f.pet && this.pets.get(f.pet);
      // Нарисованный спутник: кадры удара в сторону цели
      if (petE && petE.psk) {
        petE.attacking = true;
        petE.sprite.setFlipX(f.tx < petE.c.x);
        petE.sprite.play(`patk_${petE.psk}`);
        petE.sprite.once('animationcomplete', () => { petE.attacking = false; });
      }
      if (petE && petE.psk === 'turret' && f.proj && f.pfx !== null && this.textures.exists('fx_ingrid')) {
        // Нарисованная турель: выстрел огнём Ингрид
        const r = HeroFx.fxPlay(this, 'ingrid', 'bolt', f.pfx + Math.sign(f.tx - f.pfx) * 20, f.pfy - 16, { rot: Math.atan2(f.ty - f.pfy, f.tx - f.pfx), scale: 0.6, to: { x: f.tx, y: f.ty - 6 }, dur: 170, flipY: f.tx < f.pfx });
        this.time.delayedCall(170, () => { if (r) r.destroy(); HeroFx.fxPlay(this, 'ingrid', 'hit', f.tx, f.ty - 8, { scale: 0.6 }); doHit(); });
      } else if (petE && petE.sprite.texture.key.startsWith('turret_') && f.proj && f.pfx !== null) {
        // Нарисованная турель: вспышка ствола и ракета
        const sk = petE.sprite.texture.key.slice(7);
        petE.sprite.setFlipX(f.tx < f.pfx);
        HeroFx.fxPlay(this, sk, 'hit', f.pfx + Math.sign(f.tx - f.pfx) * 14, f.pfy - 14, { scale: 0.4 });
        const r = HeroFx.fxPlay(this, sk, 'bolt', f.pfx, f.pfy - 12, { rot: Math.atan2(f.ty - f.pfy, f.tx - f.pfx), scale: 0.6, to: { x: f.tx, y: f.ty - 6 }, dur: 160, flipY: f.tx < f.pfx });
        this.time.delayedCall(160, () => { if (r) r.destroy(); HeroFx.fxPlay(this, sk, 'hit', f.tx, f.ty - 8, { scale: 0.6 }); doHit(); });
      } else if (f.pet && f.proj && f.pfx !== null) {
        // Выстрел турели
        const b = this.add.image(f.pfx, f.pfy - 6, 'proj_' + f.proj).setDepth(800);
        b.rotation = Phaser.Math.Angle.Between(f.pfx, f.pfy, f.tx, f.ty);
        this.tweens.add({ targets: b, x: f.tx, y: f.ty, duration: 160, onComplete: () => { b.destroy(); doHit(); } });
      } else if (!f.basic) {
        doHit();
      } else if (f.proj && !f.pet && attacker && HeroFx.shoot(this, attacker, f, e ? e.c.x : f.tx, e ? e.c.y : f.ty, doHit)) {
        // нарисованный снаряд героя (public/js/herofx.js)
      } else if (f.proj) {
        const p = this.add.image(f.fx, f.fy, 'proj_' + f.proj).setDepth(800);
        const tx = e ? e.c.x : f.tx, ty = e ? e.c.y : f.ty;
        p.rotation = Phaser.Math.Angle.Between(f.fx, f.fy, tx, ty);
        const dur = Phaser.Math.Distance.Between(f.fx, f.fy, tx, ty) * 1.4;
        this.tweens.add({ targets: p, x: tx, y: ty, duration: dur, onComplete: () => { p.destroy(); doHit(); } });
      } else if (ownSwing) {
        doHit();
      } else {
        // Взмах меча
        const slash = this.add.arc(f.tx, f.ty, 16, 200, 340, false).setStrokeStyle(3, 0xffffff).setDepth(800);
        this.tweens.add({ targets: slash, alpha: 0, scale: 1.6, duration: 200, onComplete: () => slash.destroy() });
        doHit();
      }
    } else if (f.t === 'hit' && f.kind === 'p') {
      const e = this.players.get(f.target);
      if (!e) return;
      if (Settings.get('dmgNums')) this.floatText(e.c.x, e.c.y - 20, '-' + f.dmg, '#ff5a5a');
      e.sprite.setTint(0xff6060); this.time.delayedCall(120, () => e.sprite.clearTint());
      const m = this.monsters.get(f.from);
      if (m && m.mskin) {
        // Удар нарисованного монстра: поворот к цели и кадры атаки
        this.mobSwing(m, e.c.x);
        this.time.delayedCall(180, () => this.mobBurst(e.c.x, e.c.y - 12, 0xff6a5a, 0.55));
      } else if (m) this.tweens.add({ targets: m.sprite, x: Math.sign(e.c.x - m.c.x) * 6, duration: 80, yoyo: true });
      if (f.target === this.myId) { this.cameras.main.shake(100, 0.004); this.ui.vibrate('light'); }
    } else if (f.t === 'death') {
      this.burst(f.x, f.y, 0xffe08a, 16);
      if (f.by === this.myId) {
        if (f.contract) this.floatText(f.x, f.y - 52, 'Контракт выполнен!', '#ffcc4d', 14);
        this.floatText(f.x, f.y - 34, `+${f.xp} XP`, '#8ad3ff', 13);
        this.floatText(f.x, f.y - 18, `+${f.gold} 💰`, '#ffcc4d', 12);
        if (f.gold) this.dropSprite(f.x, f.y, f.gold >= 100 ? 'loot_goldBag' : 'loot_coins', 26);
        this.ui.vibrate('medium');
      }
    } else if (f.t === 'levelup') {
      const ring = this.add.circle(f.x, f.y, 10).setStrokeStyle(4, 0xffcc4d).setDepth(900);
      this.tweens.add({ targets: ring, scale: 5, alpha: 0, duration: 800, onComplete: () => ring.destroy() });
      this.floatText(f.x, f.y - 40, `Уровень ${f.lvl}!`, '#ffcc4d', 18);
      this.burst(f.x, f.y, 0xffcc4d, 24);
      if (f.id === this.myId) { this.ui.vibrate('success'); if (this.ui.onLevelUp) this.ui.onLevelUp(f.lvl); }
    } else if (f.t === 'hit' && f.kind === 'pet') {
      const e = this.pets.get(f.target);
      if (e) {
        if (Settings.get('dmgNums')) this.floatText(e.c.x, e.c.y - 16, '-' + f.dmg, '#ff9a7a', 11);
        e.sprite.setTint(0xff6060);
        // У двойника возвращаем его розовый оттенок
        this.time.delayedCall(120, () => (e.skinTint ? e.sprite.setTint(e.skinTint) : e.sprite.clearTint()));
      }
    } else if (f.t === 'absorb') {
      const e = this.players.get(f.target);
      if (e) this.floatText(e.c.x, e.c.y - 22, '🛡 ' + f.amount, '#8ad3ff', 11);
    } else if (f.t === 'shield') {
      const e = this.players.get(f.target);
      if (e) { this.floatText(e.c.x, e.c.y - 30, '+🛡 ' + f.amount, '#8ad3ff', 12); this.ring(e.c.x, e.c.y, 26, 0x8ad3ff, 500, 3); }
    } else if (f.t === 'petGone') {
      this.burst(f.x, f.y, 0x5fffb0, 10);
    } else if (f.t === 'chest') {
      // Сундук на месте босса: падает, открывается — добыча вылетает из него
      if (!this.textures.exists('prop_chestClosed')) return;
      if (window.Sfx) this.time.delayedCall(450, () => Sfx.play('chest'));
      const s = f.big ? 1.25 : 1;
      const img = this.add.image(f.x, f.y - 60, 'prop_chestClosed').setOrigin(0.5, 1).setScale(s).setDepth(10 + f.y).setAlpha(0);
      this.zoneObjs.push(img);
      const chest = { x: f.x, y: f.y, openAt: performance.now() + 650, n: 0 };
      (this.chests = (this.chests || []).filter((c) => performance.now() - c.openAt < 60000)).push(chest);
      this.tweens.add({ targets: img, y: f.y, alpha: 1, duration: 380, ease: 'Bounce.easeOut' });
      this.time.delayedCall(650, () => {
        if (!img.active) return;
        img.setTexture('prop_chestOpen');
        this.burst(f.x, f.y - 16, 0xffd36a, 22);
        Sfx.play('reward');
      });
      this.time.delayedCall(60000, () => { if (img.active) this.tweens.add({ targets: img, alpha: 0, duration: 800, onComplete: () => img.destroy() }); });
    } else if (f.t === 'loot') {
      // Выпавший предмет: название цветом редкости. Если рядом сундук босса — вылетает из него после открытия
      const ch = (this.chests || []).find((c) => Math.hypot(c.x - f.x, c.y - f.y) < 60 && performance.now() - c.openAt < 3000);
      // Значок добычи на земле: сундучок цвета редкости, у материалов — свиток
      const LOOT = { '#b8c4d6': 'lootCommon', '#4da3ff': 'lootRare', '#b86bff': 'lootEpic', '#ffb340': 'lootLegend', '#ff4d6a': 'lootLegend' };
      const show = (x, y) => {
        this.dropSprite(x, y, 'loot_' + (LOOT[String(f.color).toLowerCase()] || 'scroll'), 30);
        this.floatText(x, y - 46, f.name, f.color, 13);
        this.burst(x, y, parseInt(f.color.slice(1), 16), 14);
      };
      if (ch) { const i = ch.n++, wait = Math.max(0, ch.openAt - performance.now()) + 60 + 220 * i; this.time.delayedCall(wait, () => show(ch.x + ((i % 3) - 1) * 14, ch.y - 18 - 14 * (i % 3))); }
      else show(f.x, f.y);
      if (f.to === this.myId) this.ui.vibrate('success');
    } else if (f.t === 'tele') {
      // Предупреждение об ударе по площади: круг наполняется, пока не ударит
      const ring = this.textures.exists('mfx_rune')
        ? this.add.image(f.x, f.y, 'mfx_rune').setTint(f.color).setAlpha(0.55).setDepth(5).setDisplaySize(f.r * 2, f.r * 1.1)
        : this.add.circle(f.x, f.y, f.r).setStrokeStyle(2, f.color, 0.9).setDepth(5).setScale(1, 0.55);
      if (ring.type === 'Image') this.tweens.add({ targets: ring, angle: 25, duration: f.ms });
      const fill = this.add.circle(f.x, f.y, f.r, f.color, 0.28).setDepth(5).setScale(0.05, 0.03);
      this.tweens.add({ targets: fill, scaleX: 1, scaleY: 0.55, duration: f.ms, onComplete: () => { ring.destroy(); fill.destroy(); } });
      if (f.label) this.floatText(f.x, f.y - f.r * 0.55 - 10, f.label, '#ffd0a0', 12);
    } else if (f.t === 'teleHit') {
      const fl = this.add.circle(f.x, f.y, f.r, f.color, 0.5).setDepth(830).setScale(1, 0.55);
      this.tweens.add({ targets: fl, alpha: 0, duration: 350, onComplete: () => fl.destroy() });
      this.mobBurst(f.x, f.y - 6, f.color, Math.max(1, f.r / 22));
      this.burst(f.x, f.y, f.color, 14);
      if (this.me && Math.hypot(this.me.x - f.x, this.me.y - f.y) < f.r) this.cameras.main.shake(140, 0.006);
    } else if (f.t === 'mshot') {
      const shooter = this.monsters.get(f.from);
      this.mobSwing(shooter, f.x); // нарисованный монстр: кадры удара (выстрел / заклинание)
      const art = this.textures.exists('mproj_' + f.proj) ? 'mproj_' + f.proj : null;
      const key = art || (this.textures.exists('proj_' + f.proj) ? 'proj_' + f.proj : 'proj_arrow');
      const pr = art ? this.add.sprite(f.fx, f.fy, art).play(art) : this.add.image(f.fx, f.fy, key);
      pr.setDepth(860).setScale(art ? 1 : 1.2);
      pr.rotation = Phaser.Math.Angle.Between(f.fx, f.fy, f.x, f.y);
      if (art === 'mproj_axe') pr.rotation = 0;
      if (!art && (key === 'proj_arrow' || key === 'proj_bolt')) pr.setTint(0xffa0a0);
      const PC = { fireball: 0xff8a1a, frost: 0x8ad3ff, dark: 0x9a4aff, arcane: 0xc8a0ff, necro: 0x5fffb0, holy: 0xffe8a0, venom: 0x8ad84a, spark: 0xffe94a, spirit: 0x9ff0ff, nature: 0x5fd17a, leaf: 0x7fd36b, illusion: 0xff7ad0 };
      this.tweens.add({ targets: pr, x: f.x, y: f.y, duration: f.ms, onComplete: () => { pr.destroy(); if (art) this.mobBurst(f.x, f.y - 4, PC[f.proj] || 0xffe0c0, 0.7); } });
      // Точка попадания — от снаряда можно увернуться
      const mark = this.add.circle(f.x, f.y + 4, 9).setStrokeStyle(1, 0xff6a5a, 0.6).setDepth(4).setScale(1, 0.5);
      this.tweens.add({ targets: mark, alpha: 0, duration: f.ms, onComplete: () => mark.destroy() });
    } else if (f.t === 'mtext') {
      this.floatText(f.x, f.y - 40, f.text, f.color || '#ffe08a', f.big ? 16 : 12);
    } else if (f.t === 'mdash') {
      this.burst(f.x, f.y, 0xd8d0c0, 12); this.ring(f.x, f.y, 26, 0xffffff, 300, 3);
      if (f.name) this.floatText(f.x, f.y - 40, f.name, '#ffb060', 12);
    } else if (f.t === 'msum') {
      this.ring(f.x, f.y, 40, 0x5fffb0, 500, 4); this.burst(f.x, f.y, 0x5fffb0, 10);
    } else if (f.t === 'mheal') {
      this.burst(f.x, f.y, 0x7dff8a, 10); this.floatText(f.x, f.y - 30, '+', '#7dff8a', 16);
      if (f.fx !== undefined) { const ln = this.add.line(0, 0, f.fx, f.fy, f.x, f.y, 0x7dff8a, 0.7).setOrigin(0, 0).setLineWidth(2).setDepth(840); this.tweens.add({ targets: ln, alpha: 0, duration: 500, onComplete: () => ln.destroy() }); }
    } else if (f.t === 'mbuff') {
      this.ring(f.x, f.y, f.r, f.kind === 'shield' ? 0xbfe8ff : f.kind === 'spd' ? 0xffd84a : 0xff6a5a, 600, 3);
    } else if (f.t === 'mrevive') {
      this.burst(f.x, f.y, 0x5fffb0, 16); this.floatText(f.x, f.y - 36, f.big ? 'Возрождение!' : 'Восстаёт!', '#5fffb0', f.big ? 16 : 12);
    } else if (f.t === 'pcc') {
      const e = this.players.get(f.target);
      const txt = { stun: '💫 Оглушение', freeze: '🧊 Заморозка', root: '🕸️ Обездвижен', confuse: '😵 Подчинение', weak: '💔 Слабость' }[f.cc];
      if (e && txt) this.floatText(e.c.x, e.c.y - 34, txt, '#ffb0b0', 12);
      if (f.target === this.myId) this.ui.vibrate('heavy');
    } else if (f.t === 'miss') {
      this.floatText(f.x, f.y - 30, 'Промах', '#e8d49a', 11);
    } else if (f.t === 'dodge') {
      const e = this.players.get(f.target);
      if (e) this.floatText(e.c.x, e.c.y - 22, f.text || 'Уклонение', '#c8d8e8', 11);
    } else if (f.t === 'petDown') {
      this.floatText(f.x, f.y - 26, `${f.name} отступает`, '#d8c8a8', 11);
    } else if (f.t === 'petUp') {
      this.floatText(f.x, f.y - 26, `${f.name} вернулся!`, '#c8f0a0', 11);
      this.burst(f.x, f.y, 0xc8f0a0, 8);
    } else if (f.t === 'skill') {
      this.playSkill(f);
    } else if (f.t === 'heal') {
      const e = this.players.get(f.target);
      if (e) { this.floatText(e.c.x, e.c.y - 24, '+' + f.amount, '#7dff8a'); this.burst(e.c.x, e.c.y, 0x7dff8a, 8); }
    } else if (f.t === 'pdeath' && f.target === this.myId) {
      this.ui.onDeath();
    }
  }

  // Визуальные эффекты умений героев
  ring(x, y, r, color, dur = 500, width = 4) {
    const c = this.add.circle(x, y, r).setStrokeStyle(width, color).setDepth(850).setScale(0.2);
    this.tweens.add({ targets: c, scale: 1, alpha: 0, duration: dur, ease: 'Cubic.easeOut', onComplete: () => c.destroy() });
  }

  playSkill(f) {
    const caster = this.players.get(f.from);
    const hero = caster && this.heroes[caster.data.hero];
    const sk = hero && hero.skills.find((k) => k.id === f.s);
    if (sk && !f.predicted) this.floatText(caster.c.x, caster.c.y - 44, sk.icon + ' ' + sk.name, '#ffe08a', 12);
    if (f.from === this.myId && !f.quiet && !f.predicted) this.ui.vibrate('medium');
    if (HeroFx.skill(this, f)) return; // усиленные эффекты (public/js/herofx.js)
    switch (f.s) {
      case 'qiWave': {
        // Полоса энергии по направлению удара
        const ang = Math.atan2(f.dy, f.dx);
        const wave = this.add.rectangle(f.x, f.y, 20, 44, 0x46d6c8, 0.55).setRotation(ang).setDepth(850).setStrokeStyle(2, 0xbffcf5);
        this.tweens.add({ targets: wave, x: f.x + f.dx * f.len, y: f.y + f.dy * f.len, scaleX: 2.4, alpha: 0, duration: 380,
          ease: 'Cubic.easeOut', onComplete: () => wave.destroy() });
        for (let i = 1; i <= 4; i++) this.time.delayedCall(i * 70, () => this.burst(f.x + f.dx * f.len * i / 4, f.y + f.dy * f.len * i / 4, 0x46d6c8, 5));
        break;
      }
      case 'enlighten':
        this.ring(f.x, f.y, f.execute ? 60 : 40, 0xffe08a, 450, f.execute ? 7 : 4);
        this.burst(f.x, f.y, 0xfff6c0, f.execute ? 28 : 14);
        if (f.execute) { this.cameras.main.shake(160, 0.007); this.floatText(f.x, f.y - 40, 'Просветление!', '#fff2a0', 15); }
        break;
      case 'harmony':
        this.ring(f.x, f.y, 55, 0x9cf0a0, 700, 3);
        this.ring(f.x, f.y, 35, 0xffe08a, 600, 3);
        this.burst(f.x, f.y, 0xbff7c0, 14);
        break;
      case 'counter':
        this.floatText(f.x, f.y - 30, 'Контрудар!', '#7fe6dc', 12);
        this.burst(f.x, f.y, 0x46d6c8, 8);
        break;
      case 'empHit':
        this.ring(f.x, f.y, 30, 0xffd36a, 300, 4);
        break;
      case 'bloodWhirl': {
        // Кровавое вращение: дуги вокруг героя
        const arcG = this.add.graphics().setDepth(850);
        const follow = this.players.get(f.from);
        let a = 0;
        const ev = this.time.addEvent({ delay: 16, repeat: 40, callback: () => {
          const x = follow ? follow.c.x : f.x, y = follow ? follow.c.y : f.y;
          a += 0.35;
          arcG.clear();
          arcG.lineStyle(5, f.steel ? 0xd8dde6 : 0xc0301e, 0.85).beginPath().arc(x, y, f.r * 0.8, a, a + 2.2).strokePath();
          arcG.lineStyle(3, f.steel ? 0xffffff : 0xffb0a0, 0.7).beginPath().arc(x, y, f.r * 0.6, a + Math.PI, a + Math.PI + 1.8).strokePath();
          if (ev.getRepeatCount() === 0) arcG.destroy();
        } });
        this.time.delayedCall(220, () => this.burst(f.x, f.y, f.steel ? 0xd8dde6 : 0xc0301e, 14));
        this.time.delayedCall(440, () => this.burst(f.x, f.y, f.steel ? 0xd8dde6 : 0xc0301e, 14));
        break;
      }
      case 'furyRoar':
        this.cameras.main.shake(220, 0.006);
        this.ring(f.x, f.y, f.r, 0xe0533a, 650, 5);
        this.ring(f.x, f.y, f.r * 0.6, 0xffa080, 500, 3);
        this.floatText(f.x, f.y - 56, 'РРРААА!', '#ff7a5a', 16);
        break;
      case 'stoneThrow': {
        const st = this.add.image(f.fx, f.fy, 'proj_stone').setDepth(850).setScale(1.4);
        const dur = Math.min(500, Phaser.Math.Distance.Between(f.fx, f.fy, f.x, f.y) * 1.6);
        this.tweens.add({ targets: st, x: f.x, y: f.y, angle: 540, duration: dur, onComplete: () => {
          st.destroy(); this.burst(f.x, f.y, 0x8f8a84, 12); this.ring(f.x, f.y, 26, 0xffe08a, 350, 3);
        } });
        // Дуга полёта: подпрыгивание камня
        this.tweens.add({ targets: st, scale: 2, duration: dur / 2, yoyo: true });
        break;
      }
      case 'undying':
        this.floatText(f.x, f.y - 50, 'НЕУКРОТИМ!', '#ffcc4d', 18);
        this.ring(f.x, f.y, 60, 0xffcc4d, 700, 6);
        this.burst(f.x, f.y, 0xffcc4d, 26);
        if (f.from === this.myId) { this.cameras.main.flash(250, 255, 200, 80); this.ui.vibrate('heavy'); }
        break;
      case 'twinSlash':
        for (let i = 0; i < 4; i++) {
          this.time.delayedCall(i * 110, () => {
            const sl = this.add.rectangle(f.x, f.y, 34, 3, i % 2 ? 0xffffff : 0xff4060).setRotation(i % 2 ? 0.8 : -0.8).setDepth(850);
            this.tweens.add({ targets: sl, scaleX: 1.6, alpha: 0, duration: 160, onComplete: () => sl.destroy() });
          });
        }
        break;
      case 'bloodFrenzy':
        this.ring(f.x, f.y, 45, 0xc01a3a, 500, 5);
        this.burst(f.x, f.y, 0xc01a3a, 22);
        this.floatText(f.x, f.y - 56, 'БЕЗУМИЕ!', '#ff4060', 15);
        break;
      case 'blindRage': {
        // Кровавый шлейф рывка
        const line = this.add.line(0, 0, f.fx, f.fy, f.x, f.y, 0xc01a3a, 0.8).setOrigin(0, 0).setLineWidth(8).setDepth(840);
        this.tweens.add({ targets: line, alpha: 0, duration: 400, onComplete: () => line.destroy() });
        for (let i = 0; i <= 5; i++) this.burst(f.fx + (f.x - f.fx) * i / 5, f.fy + (f.y - f.fy) * i / 5, 0xc01a3a, 4);
        if (f.from === this.myId && this.me) { this.me.x = f.x; this.me.y = f.y; }
        break;
      }
      case 'spiritWrath':
        this.ring(f.x, f.y, f.r, 0x9ff0ff, 900, 2);
        for (let i = 0; i < 3; i++) {
          this.time.delayedCall(250 + i * 300, () => {
            for (let k = 0; k < 4; k++) {
              const x = f.x + (Math.random() - 0.5) * f.r * 1.4, y = f.y + (Math.random() - 0.5) * f.r * 0.8;
              const sp = this.add.image(x, y - 120, 'proj_spirit').setScale(1.6).setDepth(860).setAlpha(0.2);
              this.tweens.add({ targets: sp, y, alpha: 1, duration: 260, ease: 'Quad.easeIn', onComplete: () => { this.burst(x, y, 0x9ff0ff, 5); sp.destroy(); } });
            }
          });
        }
        break;
      case 'chainLightning': {
        const g = this.add.graphics().setDepth(870);
        const pts = [[f.x, f.y], ...f.pts];
        const draw = () => {
          g.clear();
          g.lineStyle(3, 0xd8f4ff, 1);
          for (let i = 0; i < pts.length - 1; i++) {
            const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
            g.beginPath(); g.moveTo(x1, y1);
            for (let k = 1; k < 5; k++) g.lineTo(x1 + (x2 - x1) * k / 5 + (Math.random() - 0.5) * 14, y1 + (y2 - y1) * k / 5 + (Math.random() - 0.5) * 14);
            g.lineTo(x2, y2); g.strokePath();
          }
        };
        draw();
        this.time.addEvent({ delay: 60, repeat: 4, callback: draw });
        this.time.delayedCall(330, () => g.destroy());
        f.pts.forEach(([x, y]) => this.burst(x, y, 0xbfe8ff, 6));
        break;
      }
      // ---------- Флэйр ----------
      case 'flameShift': {
        const col = { spark: 0xfff0a0, bonfire: 0xffa020, avalanche: 0xff3a10 }[f.form];
        this.ring(f.x, f.y, f.r, col, 500, 6); this.burst(f.x, f.y, col, 18);
        this.floatText(f.x, f.y - 62, { spark: '✨ Искра', bonfire: '🔥 Костёр', avalanche: '🌋 Лавина' }[f.form], '#ffd890', 13);
        break;
      }
      case 'flameBurst':
        if (f.form === 'avalanche') {
          const ang = Math.atan2(f.dy, f.dx);
          const wave = this.add.rectangle(f.x, f.y, 30, 90, 0xff5a1a, 0.6).setRotation(ang).setDepth(850).setStrokeStyle(3, 0xffd03a);
          this.tweens.add({ targets: wave, x: f.x + f.dx * f.len, y: f.y + f.dy * f.len, scaleX: 2.2, alpha: 0, duration: 420, onComplete: () => wave.destroy() });
          for (let i = 1; i <= 5; i++) this.time.delayedCall(i * 60, () => this.burst(f.x + f.dx * f.len * i / 5, f.y + f.dy * f.len * i / 5, 0xff8a2a, 7));
        } else {
          const fb = this.add.image(f.fx, f.fy, 'proj_fireball').setScale(f.form === 'spark' ? 1.3 : 2.2).setDepth(860);
          if (f.form === 'spark') fb.setTint(0xfff0a0);
          this.tweens.add({ targets: fb, x: f.x, y: f.y, duration: f.form === 'spark' ? 150 : 320, onComplete: () => {
            fb.destroy(); this.burst(f.x, f.y, 0xffa020, 14);
            if (f.r) { this.ring(f.x, f.y, f.r, 0xff6a1a, 450, 6); this.cameras.main.shake(100, 0.005); }
          } });
        }
        break;
      case 'incinerate': {
        const fl = this.add.circle(f.x, f.y, f.r, 0xffa020, 0.6).setDepth(830).setScale(0.2);
        this.tweens.add({ targets: fl, scale: 1, alpha: 0, duration: 600, onComplete: () => fl.destroy() });
        this.ring(f.x, f.y, f.r, 0xfff0a0, 650, 8); this.ring(f.x, f.y, f.r * 0.6, 0xff3a10, 500, 5); this.burst(f.x, f.y, 0xff6a1a, 34);
        this.floatText(f.x, f.y - 66, `☀️ ×${f.power.toFixed(1)}`, '#ffd060', 15); this.cameras.main.shake(220, 0.011);
        break;
      }
      // ---------- Кальдеро ----------
      case 'lavaStrike':
        this.ring(f.x, f.y, 30, 0xff5a1a, 350, 6); this.burst(f.x, f.y, 0xff8a2a, 16); this.cameras.main.shake(110, 0.006);
        break;
      case 'eruption':
        this.ring(f.x, f.y, f.r, 0xff3a10, 600, 8); this.burst(f.x, f.y, 0xff6a1a, 30); this.burst(f.x, f.y, 0x4a3a3a, 16);
        this.cameras.main.shake(260, 0.012);
        break;
      case 'ashArmor':
        this.ring(f.x, f.y, 32, 0x6a5a50, 500, 7); this.floatText(f.x, f.y - 52, '🪨 Пепельная броня', '#e8b090', 13);
        break;
      // ---------- Торден ----------
      case 'stoneSpike': {
        const sp = this.add.triangle(f.x, f.y + 6, 0, 30, 8, 0, 16, 30, 0x8a7a5a).setStrokeStyle(2, 0x5a4a3a).setDepth(860).setScale(1, 0.1).setOrigin(0.5, 1);
        this.tweens.add({ targets: sp, scaleY: 1.2, duration: 120, yoyo: true, hold: 250, onComplete: () => sp.destroy() });
        this.burst(f.x, f.y, 0xa08a6a, 12);
        break;
      }
      case 'rift':
        this.cameras.main.shake(220, 0.01);
        for (let i = 1; i <= 6; i++) this.time.delayedCall(i * 40, () => this.burst(f.x + f.dx * f.len * i / 6, f.y + f.dy * f.len * i / 6, 0x6a5a3a, 8));
        break;
      case 'earthGrip':
        this.ring(f.x, f.y, f.r, 0x7a6a4a, 600, 6); this.burst(f.x, f.y, 0x5fbf5a, 18);
        break;
      // ---------- Медея ----------
      case 'gorgonGaze': {
        const ang = Math.atan2(f.dy, f.dx);
        const g = this.add.graphics().setDepth(860);
        g.fillStyle(0xffe040, 0.35).slice(f.x, f.y, 200, ang - 0.9, ang + 0.9).fillPath();
        this.tweens.add({ targets: g, alpha: 0, duration: 600, onComplete: () => g.destroy() });
        this.floatText(f.x, f.y - 56, '👁️', '#ffe040', 20);
        break;
      }
      case 'petrified':
        this.burst(f.x, f.y, 0x9a9a98, 14); this.floatText(f.x, f.y - 34, '🗿 Окаменел!', '#d8d8d0', 12);
        break;
      case 'snakeSwarm':
        (f.pts || []).forEach(([x, y], i) => {
          const sn = this.add.image(f.fx, f.fy, 'proj_venom').setDepth(860).setScale(1.3);
          this.tweens.add({ targets: sn, x, y, duration: 260 + i * 60, onComplete: () => { sn.destroy(); this.burst(x, y, 0x7ad84a, 10); } });
        });
        break;
      case 'stoneBurst':
        (f.pts || []).forEach(([x, y]) => { this.ring(x, y, 80, 0xb8b8b0, 500, 6); this.burst(x, y, 0x9a9a98, 22); });
        this.cameras.main.shake(200, 0.01);
        break;
      // ---------- Ву'гаж ----------
      case 'rootLash': {
        const ln = this.add.line(0, 0, f.fx, f.fy, f.x, f.y, 0x5a3a20, 1).setOrigin(0, 0).setLineWidth(5).setDepth(840);
        this.tweens.add({ targets: ln, alpha: 0, duration: 500, onComplete: () => ln.destroy() });
        this.burst(f.x, f.y, 0x7ac04a, 12);
        break;
      }
      case 'rootDown':
        this.ring(f.x, f.y, f.r, 0x5aa83a, 600, 6); this.floatText(f.x, f.y - 56, '🌳 Укоренение', '#a8e08a', 13);
        break;
      case 'rootPulse':
        this.ring(f.x, f.y, f.r, 0x7a5a30, 400, 5); this.burst(f.x, f.y + 6, 0x5a3a20, 10);
        break;
      case 'bloom':
        this.ring(f.x, f.y, f.r, 0xffb0d8, 800, 4);
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2, d = Math.random() * f.r;
          const n = this.add.text(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * 0.6, '🌸', { fontSize: '12px' }).setOrigin(0.5).setDepth(900);
          this.tweens.add({ targets: n, y: n.y - 20, alpha: 0, duration: 1000, onComplete: () => n.destroy() });
        }
        break;
      // ---------- Брильда ----------
      case 'cutCrystal': {
        const col = { atk: 0xff5a7a, def: 0x5ab8ff, heal: 0x7ad87a, spd: 0xffd84a }[f.facet];
        this.ring(f.x, f.y, 22, col, 350, 3);
        break;
      }
      case 'crystalVolley':
        (f.cr || []).forEach((fc, i) => {
          const col = { atk: 0xff5a7a, def: 0x5ab8ff, heal: 0x7ad87a, spd: 0xffd84a }[fc];
          const o = this.add.image(f.fx, f.fy, 'proj_crystal').setDepth(860).setTint(col).setScale(1.3);
          o.rotation = Phaser.Math.Angle.Between(f.fx, f.fy, f.x, f.y);
          this.tweens.add({ targets: o, x: f.x + (i - 2) * 6, y: f.y + (i % 3 - 1) * 8, duration: 200 + i * 50, onComplete: () => { o.destroy(); this.burst(f.x, f.y, col, 6); } });
        });
        break;
      case 'crystalBarrier':
        this.ring(f.x, f.y, 30, 0xc080ff, 600, 6); this.floatText(f.x, f.y - 56, '💎 Кристальный барьер', '#e0b0ff', 13);
        break;
      // ---------- Гидеон ----------
      case 'darkPrayer': {
        const orb = this.add.image(f.fx, f.fy, 'proj_dark').setScale(1.8).setDepth(860);
        this.tweens.add({ targets: orb, x: f.x, y: f.y, duration: 250, onComplete: () => {
          orb.destroy(); this.ring(f.x, f.y, 70, 0x8a2a5a, 500, 4); this.burst(f.x, f.y, 0xb04aff, 14);
        } });
        break;
      }
      case 'sacrifice': {
        const ln = this.add.line(0, 0, f.x, f.y, f.fx, f.fy, 0xc01a3a, 0.9).setOrigin(0, 0).setLineWidth(4).setDepth(840);
        this.tweens.add({ targets: ln, alpha: 0, duration: 700, onComplete: () => ln.destroy() });
        this.burst(f.x, f.y, 0xc01a3a, 22); this.ring(f.fx, f.fy, 34, 0x8a2a5a, 600, 5);
        this.floatText(f.x, f.y - 40, '🩸 Жертва принята', '#ff6a8a', 14); this.cameras.main.shake(140, 0.006);
        break;
      }
      case 'abyssWrath': {
        const fl = this.add.circle(f.x, f.y, f.r, 0x1a0a1a, 0.75).setDepth(830).setScale(0.2);
        this.tweens.add({ targets: fl, scale: 1, alpha: 0, duration: 650, onComplete: () => fl.destroy() });
        this.ring(f.x, f.y, f.r, 0x8a2a5a, 650, 7); this.burst(f.x, f.y, 0xb04aff, 26);
        this.floatText(f.x, f.y - 50, '👁️', '#ff4a6a', 22); this.cameras.main.shake(200, 0.009);
        break;
      }
      // ---------- Волдан ----------
      case 'deepWave': {
        const ang = Math.atan2(f.dy, f.dx);
        const wave = this.add.rectangle(f.x, f.y, 26, 100, 0x3a8ad8, 0.6).setRotation(ang).setDepth(850).setStrokeStyle(3, 0xd8f0ff);
        this.tweens.add({ targets: wave, x: f.x + f.dx * f.len, y: f.y + f.dy * f.len, scaleX: 2.2, alpha: 0, duration: 480,
          ease: 'Cubic.easeOut', onComplete: () => wave.destroy() });
        for (let i = 1; i <= 5; i++) this.time.delayedCall(i * 70, () => this.burst(f.x + f.dx * f.len * i / 5, f.y + f.dy * f.len * i / 5, 0x8ad3ff, 6));
        break;
      }
      case 'createDeep':
        this.ring(f.x, f.y, f.r, 0x8ad3ff, 600, 5); this.burst(f.x, f.y, 0x5ab8ff, 22);
        break;
      case 'seaSpirits':
        (f.pts || []).forEach(([x, y]) => { this.ring(x, y, 22, 0x5ab8ff, 500, 3); this.burst(x, y, 0xd8f0ff, 10); });
        break;
      // ---------- Галатея ----------
      case 'sirenSong': {
        this.ring(f.x, f.y, f.r, 0x6ad8c8, 900, 4); this.ring(f.x, f.y, f.r * 0.6, 0xffb0e8, 700, 3);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          const n = this.add.text(f.x, f.y, i % 2 ? '♪' : '♫', { fontSize: '15px', color: '#9ff0e0' }).setOrigin(0.5).setDepth(900);
          this.tweens.add({ targets: n, x: f.x + Math.cos(a) * f.r * 0.9, y: f.y + Math.sin(a) * f.r * 0.5, alpha: 0, duration: 900, onComplete: () => n.destroy() });
        }
        for (const id of f.ids || []) { const m = this.monsters.get(id); if (m) this.floatText(m.c.x, m.c.y - 30, f.brawl ? '😵' : '💘', '#ff9ad8', 14); }
        break;
      }
      case 'soundWave':
        for (let i = 0; i < 3; i++) this.time.delayedCall(i * 90, () => this.ring(f.x, f.y, f.r, 0x9ff0e0, 450, 4 - i));
        this.cameras.main.shake(140, 0.006);
        break;
      case 'drownedCall':
        this.ring(f.x, f.y, 60, 0x3a8ad8, 600, 4); this.floatText(f.x, f.y - 56, `🧜 Утопленники ×${f.n}`, '#8ad3ff', 13);
        break;
      // ---------- Итилиор ----------
      case 'iceArrow': {
        const sp = this.add.image(f.fx, f.fy, 'proj_frost').setScale(2).setDepth(860);
        sp.rotation = Phaser.Math.Angle.Between(f.fx, f.fy, f.x, f.y);
        this.tweens.add({ targets: sp, x: f.x, y: f.y, duration: f.flight, onComplete: () => { sp.destroy(); this.burst(f.x, f.y, 0xbfe8ff, 12); this.ring(f.x, f.y, 22, 0x8ad3ff, 350, 3); } });
        break;
      }
      case 'iceWall':
        this.burst(f.x, f.y, 0xbfe8ff, 20);
        break;
      case 'frostBlast': {
        const fl = this.add.circle(f.x, f.y, f.r, 0xbfe8ff, 0.5).setDepth(830).setScale(0.2);
        this.tweens.add({ targets: fl, scale: 1, alpha: 0, duration: 500, onComplete: () => fl.destroy() });
        this.ring(f.x, f.y, f.r, 0xffffff, 550, 6); this.burst(f.x, f.y, 0x8ad3ff, 28);
        break;
      }
      case 'shatter':
        this.burst(f.x, f.y, 0xffffff, 20); this.burst(f.x, f.y, 0x8ad3ff, 16); this.ring(f.x, f.y, f.r, 0xbfe8ff, 450, 5);
        this.floatText(f.x, f.y - 30, '💎 Разбит!', '#bfe8ff', 13); this.cameras.main.shake(120, 0.006);
        break;
      // ---------- Селена ----------
      case 'moonBeam': {
        const col = { waxing: 0xc8d0ff, full: 0xf4f6ff, waning: 0x8a9aff, newmoon: 0x6a4aaa }[f.ph];
        const ln = this.add.line(0, 0, f.fx, f.fy - 10, f.x, f.y, col, 0.9).setOrigin(0, 0).setLineWidth(6).setDepth(860);
        this.tweens.add({ targets: ln, alpha: 0, duration: 450, onComplete: () => ln.destroy() });
        this.burst(f.x, f.y, col, 14); this.ring(f.x, f.y, 26, col, 450, 4);
        if (f.ph === 'full') this.ring(f.fx, f.fy, 180, 0xf4f6ff, 700, 3);
        break;
      }
      case 'phaseShift': {
        const n = { waxing: '🌒 Растущая луна', full: '🌕 Полная луна', waning: '🌘 Убывающая луна', newmoon: '🌑 Новолуние' }[f.ph];
        this.floatText(f.x, f.y - 62, n, '#dfe4ff', 13); this.ring(f.x, f.y, 36, 0xc8d0ff, 500, 4);
        break;
      }
      case 'moonVeil': {
        const col = { waxing: 0xc8d0ff, full: 0xf4f6ff, waning: 0x8a9aff, newmoon: 0x4a3a8a }[f.ph];
        this.ring(f.x, f.y, 200, col, 800, 4);
        for (const id of f.ids || []) { const e = this.players.get(id); if (e) { this.ring(e.c.x, e.c.y, 24, col, 600, 3); this.burst(e.c.x, e.c.y, col, 6); } }
        break;
      }
      // ---------- Сирокко ----------
      case 'sandVortex':
        this.ring(f.x, f.y, f.r, 0xe8c878, 600, 6); this.burst(f.x, f.y, 0xe8c878, 26); this.burst(f.x, f.y, 0xc8a050, 12);
        break;
      case 'duneWave': {
        const ang = Math.atan2(f.dy, f.dx);
        const wave = this.add.rectangle(f.x, f.y, 24, 90, 0xd8b060, 0.6).setRotation(ang).setDepth(850).setStrokeStyle(2, 0xfff0c0);
        this.tweens.add({ targets: wave, x: f.x + f.dx * f.len, y: f.y + f.dy * f.len, scaleX: 2, alpha: 0, duration: 450,
          ease: 'Cubic.easeOut', onComplete: () => wave.destroy() });
        for (let i = 1; i <= 5; i++) this.time.delayedCall(i * 70, () => this.burst(f.x + f.dx * f.len * i / 5, f.y + f.dy * f.len * i / 5, 0xe8c878, 6));
        break;
      }
      case 'desertBreath':
        this.floatText(f.x, f.y - 56, '🏜 Дыхание пустыни', '#ffd890', 13);
        (f.zones || []).forEach(([x, y]) => { this.ring(x, y, 90, 0xffa040, 700, 5); this.burst(x, y, 0xffb060, 18); });
        break;
      // ---------- Блейз ----------
      case 'blazeBall': {
        const fb = this.add.image(f.fx, f.fy, 'proj_fireball').setScale(2.2).setDepth(860);
        this.tweens.add({ targets: fb, x: f.x, y: f.y, duration: f.flight, onComplete: () => {
          fb.destroy(); this.ring(f.x, f.y, 34, 0xff6a1a, 400, 5); this.burst(f.x, f.y, 0xffb030, 18);
        } });
        break;
      }
      case 'flameWave': {
        const ang = Math.atan2(f.dy, f.dx);
        const g = this.add.graphics().setDepth(860);
        g.fillStyle(0xff6a1a, 0.55).slice(f.x, f.y, 160, ang - 1.05, ang + 1.05).fillPath();
        g.fillStyle(0xffd03a, 0.5).slice(f.x, f.y, 90, ang - 0.8, ang + 0.8).fillPath();
        this.tweens.add({ targets: g, alpha: 0, duration: 500, onComplete: () => g.destroy() });
        for (let k = 1; k <= 4; k++) this.time.delayedCall(k * 40, () => this.burst(f.x + f.dx * 36 * k, f.y + f.dy * 36 * k, 0xff8a2a, 7));
        break;
      }
      case 'flashover': {
        const fl = this.add.circle(f.x, f.y, f.r, 0xff8a2a, 0.65).setDepth(830).setScale(0.2);
        this.tweens.add({ targets: fl, scale: 1, alpha: 0, duration: 500, onComplete: () => fl.destroy() });
        this.ring(f.x, f.y, f.r, 0xffd03a, 600, 7); this.burst(f.x, f.y, 0xff6a1a, 30);
        this.floatText(f.x, f.y - 60, `🔥 ×${f.power.toFixed(1)}`, '#ffb030', 15); this.cameras.main.shake(200, 0.01);
        break;
      }
      case 'selfIgnite':
        this.ring(f.x, f.y, f.r, 0xff3a10, 600, 8); this.burst(f.x, f.y, 0xff6a1a, 26);
        this.floatText(f.x, f.y - 70, '🔥 Самовозгорание!', '#ff8a3a', 14); this.cameras.main.shake(160, 0.008);
        break;
      // ---------- Гардин ----------
      case 'carveRune': {
        const col = { fire: 0xff6a1a, ward: 0x5fb0ff, heal: 0x7dff8a }[f.type];
        this.ring(f.x, f.y, 28, col, 450, 4); this.burst(f.x, f.y, col, 8);
        break;
      }
      case 'runeBurst': {
        const col = { fire: 0xff6a1a, ward: 0x5fb0ff, heal: 0x7dff8a }[f.type];
        const fl = this.add.circle(f.x, f.y, f.r, col, 0.4).setDepth(830).setScale(0.2, 0.1);
        this.tweens.add({ targets: fl, scaleX: 1, scaleY: 0.5, alpha: 0, duration: 450, onComplete: () => fl.destroy() });
        this.ring(f.x, f.y, f.r, col, 500, 5); this.burst(f.x, f.y, col, 18);
        if (f.type === 'fire') this.cameras.main.shake(120, 0.006);
        break;
      }
      case 'activateRunes':
        this.ring(f.x, f.y, 40, 0x5fb0ff, 600, 6); this.floatText(f.x, f.y - 62, 'ᚱ Руны пробуждены!', '#9fd0ff', 13);
        break;
      case 'weaponRune': {
        const col = { fire: 0xff6a1a, ward: 0x5fb0ff, heal: 0x7dff8a }[f.type];
        this.ring(f.x, f.y, 30, col, 500, 5); this.burst(f.x + 10, f.y - 4, col, 12);
        break;
      }
      // ---------- Элнаэрис ----------
      case 'gatherSouls':
        (f.pts || []).forEach(([x, y]) => {
          const o = this.add.image(x, y, 'proj_soul').setDepth(860);
          const tgt = this.players.get(f.from);
          this.tweens.add({ targets: o, x: tgt ? tgt.c.x : f.x, y: tgt ? tgt.c.y : f.y, duration: 600, ease: 'Cubic.easeIn', onComplete: () => o.destroy() });
        });
        this.time.delayedCall(600, () => this.ring(f.x, f.y, 30, 0x8ad8ff, 450, 4));
        break;
      case 'soulWave': {
        const ang = Math.atan2(f.dy, f.dx);
        for (let i = 0; i < Math.min(8, f.spend); i++) {
          const o = this.add.image(f.x, f.y + (i - 3.5) * 10, 'proj_soul').setDepth(860).setScale(1.4).setRotation(ang);
          this.tweens.add({ targets: o, x: f.x + f.dx * f.len, y: f.y + f.dy * f.len + (i - 3.5) * 12, alpha: 0, duration: 450 + i * 25, onComplete: () => o.destroy() });
        }
        this.floatText(f.x, f.y - 60, `👻 ×${f.spend}`, '#bfeaff', 14);
        break;
      }
      case 'guideCall':
        this.ring(f.x, f.y, 30, 0x8ad8ff, 600, 5); this.burst(f.x, f.y, 0xd8f4ff, 16);
        break;
      case 'healTotem':
        this.ring(f.x, f.y, f.r, 0x3fe08a, 600, 3);
        this.burst(f.x, f.y, 0x3fe08a, 14);
        break;
      case 'sic':
        this.floatText(f.x, f.y - 36, '❗', '#ff6040', 18);
        for (const id of f.pets || []) {
          const e = this.pets.get(id);
          if (!e) continue;
          const ln = this.add.line(0, 0, e.c.x, e.c.y, f.x, f.y, 0xff6040, 0.7).setOrigin(0, 0).setLineWidth(2).setDepth(840);
          this.tweens.add({ targets: ln, alpha: 0, duration: 450, onComplete: () => ln.destroy() });
        }
        this.ring(f.x, f.y, 30, 0xff6040, 400, 3);
        break;
      case 'packCall':
        this.ring(f.x, f.y, f.r, 0xc8a46a, 650, 5);
        this.ring(f.x, f.y, 24, 0x8ad3ff, 500, 3);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          this.floatText(f.x + Math.cos(a) * f.r * 0.7, f.y + Math.sin(a) * f.r * 0.5, '🐾', '#ffffff', 12);
        }
        break;
      case 'spiritLink': {
        const ln = this.add.line(0, 0, f.x, f.y, f.fx, f.fy, 0xff7ab0, 0.9).setOrigin(0, 0).setLineWidth(4).setDepth(840);
        this.tweens.add({ targets: ln, alpha: 0, duration: 700, onComplete: () => ln.destroy() });
        this.burst(f.fx, f.fy, 0xff7ab0, 14);
        this.burst(f.x, f.y, 0xff7ab0, 8);
        break;
      }
      case 'dragonBreath': {
        const col = { fire: 0xff6a1a, ice: 0x8ad3ff, poison: 0x7ad84a, lightning: 0xffe94a }[f.asp];
        const ang = Math.atan2(f.dy, f.dx);
        const g = this.add.graphics().setDepth(860);
        g.fillStyle(col, 0.5).slice(f.x, f.y, 170, ang - 0.55, ang + 0.55).fillPath();
        this.tweens.add({ targets: g, alpha: 0, duration: 500, onComplete: () => g.destroy() });
        for (let k = 1; k <= 5; k++) this.time.delayedCall(k * 40, () => this.burst(f.x + f.dx * 32 * k, f.y + f.dy * 32 * k, col, 6));
        (f.pts || []).forEach(([x, y]) => this.burst(x, y, col, 6));
        this.floatText(f.x, f.y - 50, '🐉 ' + { fire: 'Пламя', ice: 'Лёд', poison: 'Яд', lightning: 'Молния' }[f.asp], '#' + col.toString(16).padStart(6, '0'), 14);
        break;
      }
      case 'dragonDive': {
        const col = { fire: 0xff6a1a, ice: 0x8ad3ff, poison: 0x7ad84a, lightning: 0xffe94a }[f.asp];
        this.ring(f.x, f.y, f.r, col, 500, 7); this.burst(f.x, f.y, col, 26); this.cameras.main.shake(180, 0.01);
        if (f.from === this.myId && this.me) { this.me.x = f.x; this.me.y = f.y + 4; }
        break;
      }
      case 'beastMight':
        this.ring(f.x, f.y, 34, 0xd84a2a, 500, 5); this.floatText(f.x, f.y - 50, '🐲 Звериная мощь!', '#ff8a5a', 14);
        break;
      case 'gloomStrike':
        this.burst(f.x, f.y, 0x4a2a6a, 18); this.ring(f.x, f.y, 70, 0x6a3a9a, 450, 4);
        break;
      case 'darkBurst': {
        const fl = this.add.circle(f.x, f.y, f.r, 0x1a0a24, 0.7).setDepth(830).setScale(0.2);
        this.tweens.add({ targets: fl, scale: 1, alpha: 0, duration: 550, onComplete: () => fl.destroy() });
        this.ring(f.x, f.y, f.r, 0x9b4dff, 600, 6); this.burst(f.x, f.y, 0x6a3a9a, 28);
        this.floatText(f.x, f.y - 56, `💥 ×${f.power.toFixed(1)}`, '#c890ff', 15); this.cameras.main.shake(180, 0.008);
        break;
      }
      case 'darkSeal':
        this.ring(f.x, f.y, 30, 0x6a3a9a, 600, 4); this.floatText(f.x, f.y - 40, '🔯 Печать', '#c890ff', 12);
        break;
      case 'sealHeal':
        this.floatText(f.x, f.y - 56, '🖤 Душа поглощена', '#c890ff', 12);
        break;
      case 'stoneFist':
        this.ring(f.x, f.y, 30, 0xa09a90, 350, 6); this.burst(f.x, f.y, 0x8a8580, 16); this.cameras.main.shake(120, 0.007);
        break;
      case 'golemQuake':
        this.ring(f.x, f.y, f.r, 0x8a6a4a, 600, 8); this.ring(f.x, f.y, f.r * 0.6, 0xa09a90, 450, 5);
        this.burst(f.x, f.y, 0x6a5a4a, 30); this.cameras.main.shake(260, 0.012);
        break;
      case 'stoneArmor':
        this.ring(f.x, f.y, 30, 0xa09a90, 500, 6); this.floatText(f.x, f.y - 50, '🪨 Каменная броня', '#d8d0c0', 13);
        break;
      case 'cracksFull':
        this.floatText(f.x, f.y - 60, '💔 Трещины на пределе!', '#ffb08a', 13);
        break;
      case 'buildTurret':
        this.burst(f.x, f.y, 0xc9a64d, 14); this.floatText(f.x, f.y - 36, '🔧 Турель!', '#ffc850', 13);
        break;
      case 'repair':
        this.floatText(f.x, f.y - 36, '🔧 Починено', '#9aff9a', 12);
        break;
      case 'overclock':
        this.floatText(f.x, f.y - 50, '⚙️ Разгон!', '#ffc850', 14);
        for (const id of f.ids || []) { const e = this.pets.get(id); if (e) this.ring(e.c.x, e.c.y, 22, 0xffc850, 500, 3); }
        break;
      case 'bomb': {
        const bm = this.add.circle(f.fx, f.fy, 6, 0x2a2a2a).setStrokeStyle(2, 0xe86a2a).setDepth(860);
        this.tweens.add({ targets: bm, x: f.x, y: f.y, duration: f.flight, onComplete: () => {
          bm.destroy();
          const boom = this.add.circle(f.x, f.y, f.r, 0xff8a2a, 0.6).setDepth(870).setScale(0.2);
          this.tweens.add({ targets: boom, scale: 1, alpha: 0, duration: 400, onComplete: () => boom.destroy() });
          this.burst(f.x, f.y, 0xffb030, 24); this.burst(f.x, f.y, 0x3a3a3a, 12);
          this.cameras.main.shake(180, 0.009);
        } });
        this.tweens.add({ targets: bm, scale: 1.8, duration: f.flight / 2, yoyo: true });
        break;
      }
      case 'heavenSpear': {
        const sp = this.add.image(f.fx, f.fy, 'proj_spear').setScale(1.6).setDepth(860).setTint(0xfff6c0);
        sp.rotation = Phaser.Math.Angle.Between(f.fx, f.fy, f.x, f.y);
        this.tweens.add({ targets: sp, x: f.x, y: f.y, duration: f.flight, onComplete: () => { sp.destroy(); this.ring(f.x, f.y, 24, 0xfff6c0, 400, 4); this.burst(f.x, f.y, 0xfff6c0, 12); } });
        break;
      }
      case 'takeFlight':
        this.burst(f.x, f.y, 0xffffff, 18); this.floatText(f.x, f.y - 56, '🪽 Взлёт!', '#ffffff', 14);
        break;
      case 'dive':
        this.ring(f.x, f.y, f.r, 0xfff6c0, 450, 6); this.burst(f.x, f.y, 0xffffff, 22); this.cameras.main.shake(160, 0.008);
        break;
      case 'valkyrieCry':
        this.ring(f.x, f.y, f.r, 0xe8c26a, 650, 4); this.floatText(f.x, f.y - 56, '📯 За Вальхаллу!', '#ffe08a', 14);
        break;
      case 'avenge':
        this.floatText(f.x, f.y - 66, '⚔️ Месть за павших!', '#ff9a6a', 13);
        break;
      case 'bloodSpike': {
        const sp = this.add.image(f.fx, f.fy, 'proj_blood').setScale(1.6).setDepth(860);
        sp.rotation = Phaser.Math.Angle.Between(f.fx, f.fy, f.x, f.y);
        this.tweens.add({ targets: sp, x: f.x, y: f.y, duration: f.flight, onComplete: () => { sp.destroy(); this.burst(f.x, f.y, 0xc0101a, 12); } });
        break;
      }
      case 'bloodRitual': {
        const pool = this.add.circle(f.x, f.y, f.r, 0x7a0610, 0.5).setDepth(830).setScale(0.2, 0.1);
        this.tweens.add({ targets: pool, scaleX: 1, scaleY: 0.55, alpha: 0, duration: 700, onComplete: () => pool.destroy() });
        this.ring(f.x, f.y, f.r, 0xc0101a, 600, 6); this.burst(f.x, f.y, 0xc0101a, 26);
        this.floatText(f.x, f.y - 56, '🔴 Ритуал крови', '#ff5a6a', 14);
        break;
      }
      case 'bloodBond': {
        const g = this.add.graphics().setDepth(850);
        g.lineStyle(2, 0xc0101a, 0.9);
        for (let i = 0; i < f.pts.length; i++) for (let k = i + 1; k < f.pts.length; k++) g.lineBetween(f.pts[i][0], f.pts[i][1], f.pts[k][0], f.pts[k][1]);
        this.tweens.add({ targets: g, alpha: 0, duration: 900, onComplete: () => g.destroy() });
        break;
      }
      case 'elixir': {
        const P = { thunder: [0xff8a3a, '⚡ Гром'], blizzard: [0x8ad3ff, '🌨️ Пурга'], swallow: [0x9aff9a, '🕊️ Ласточка'], oriole: [0xffd03a, '🛡️ Иволга'] }[f.potion];
        this.ring(f.x, f.y, 28, P[0], 450, 4);
        this.floatText(f.x, f.y - 50, '🧪 ' + P[1], '#' + P[0].toString(16).padStart(6, '0'), 13);
        if (f.poisoned) { this.floatText(f.x, f.y - 68, '☠ Отравление!', '#9aff6a', 14); this.burst(f.x, f.y, 0x6ad84a, 16); }
        break;
      }
      case 'witcherSign': {
        if (f.sign === 'quen') { this.ring(f.x, f.y, 26, 0xffb030, 600, 5); this.floatText(f.x, f.y - 50, '🔶 Квен', '#ffb030', 13); break; }
        const igni = f.sign === 'igni', col = igni ? 0xff6a1a : 0x9ad8ff;
        const ang = Math.atan2(f.dy, f.dx);
        const g = this.add.graphics().setDepth(860);
        g.fillStyle(col, 0.45).slice(f.x, f.y, 150, ang - 0.5, ang + 0.5).fillPath();
        this.tweens.add({ targets: g, alpha: 0, duration: 400, onComplete: () => g.destroy() });
        for (let k = 1; k <= 4; k++) this.time.delayedCall(k * 50, () => this.burst(f.x + f.dx * 35 * k, f.y + f.dy * 35 * k, col, 5));
        this.floatText(f.x, f.y - 50, igni ? '🔥 Игни' : '💨 Аард', igni ? '#ff8a3a' : '#9ad8ff', 13);
        if (!igni) this.cameras.main.shake(120, 0.005);
        break;
      }
      case 'starShot': {
        const ar = this.add.image(f.fx, f.fy, 'proj_arrow').setScale(1.6).setDepth(860).setTint(0xfff6c0);
        ar.rotation = Phaser.Math.Angle.Between(f.fx, f.fy, f.x, f.y);
        this.tweens.add({ targets: ar, x: f.x, y: f.y, duration: f.flight, onComplete: () => {
          ar.destroy(); this.burst(f.x, f.y, 0xfff6c0, 16); this.floatText(f.x, f.y - 40, '⭐ Метка', '#fff6a0', 12);
        } });
        break;
      }
      case 'lightHail':
        this.ring(f.x, f.y, f.r, 0xfff6c0, 1300, 2);
        for (let w = 0; w < 3; w++) for (let i = 0; i < 7; i++) {
          this.time.delayedCall(w * 350 + i * 25, () => {
            const x = f.x + (Math.random() - 0.5) * f.r * 1.6, y = f.y + (Math.random() - 0.5) * f.r;
            const ar = this.add.image(x + 30, y - 170, 'proj_arrow').setRotation(Math.PI / 2 - 0.2).setDepth(860).setTint(0xfff6c0);
            this.tweens.add({ targets: ar, x, y, duration: 280, ease: 'Quad.easeIn', onComplete: () => { ar.destroy(); this.burst(x, y, 0xfff6c0, 3); } });
          });
        }
        break;
      case 'windLight':
        for (const id of f.ids || []) {
          const e = this.players.get(id);
          if (e) { this.ring(e.c.x, e.c.y, 26, 0xb8ffd8, 500, 3); this.floatText(e.c.x, e.c.y - 40, '🍃 Ускорение', '#b8ffd8', 12); }
        }
        break;
      case 'casting': {
        // Подготовка заклинания: сходящееся кольцо
        const c = this.add.circle(f.x, f.y, 34).setStrokeStyle(3, 0xc8a0ff, 1).setDepth(850);
        this.tweens.add({ targets: c, scale: 0.2, alpha: 0.3, duration: f.ms, onComplete: () => c.destroy() });
        this.floatText(f.x, f.y - 46, 'Подготовка…', '#c8a0ff', 11);
        break;
      }
      case 'arcaneMissile': {
        const o = this.add.image(f.fx, f.fy, 'proj_arcane').setDepth(860);
        this.tweens.add({ targets: o, x: f.x + (Math.random() - 0.5) * 16, y: f.y + (Math.random() - 0.5) * 16, duration: 220, onComplete: () => { o.destroy(); this.burst(f.x, f.y, 0xc8a0ff, 4); } });
        break;
      }
      case 'iceGrip':
        this.ring(f.x, f.y, f.r, 0x8ad3ff, 600, 5);
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * Math.PI * 2, d = Math.random() * f.r;
          const sh = this.add.triangle(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * 0.6, 0, 14, 5, 0, 10, 14, 0xbfe8ff, 0.9).setDepth(820).setScale(0.3);
          this.tweens.add({ targets: sh, scale: 1, duration: 150, delay: i * 20, yoyo: true, hold: 2600, onComplete: () => sh.destroy() });
        }
        break;
      case 'magicBarrier':
        this.ring(f.x, f.y, 30, 0xc8a0ff, 600, 5);
        this.floatText(f.x, f.y - 50, '🔰 Барьер', '#c8a0ff', 13);
        break;
      case 'resonanceReady':
        this.floatText(f.x, f.y - 66, '✴️ Резонанс!', '#e0c8ff', 13);
        break;
      case 'songSwap': {
        const S = { inspire: [0xffb030, '🎺 Вдохновение'], lullaby: [0x8a9aff, '🌙 Колыбельная'], mock: [0xff6a9a, '🤡 Насмешка'] }[f.song];
        this.ring(f.x, f.y, 180, S[0], 700, 3);
        this.floatText(f.x, f.y - 52, S[1], '#' + S[0].toString(16).padStart(6, '0'), 14);
        break;
      }
      case 'resonantChord':
        for (let i = 0; i < 3; i++) this.time.delayedCall(i * 90, () => this.ring(f.x, f.y, f.r, 0xffe08a, 450, 5 - i));
        this.floatText(f.x, f.y - 56, f.pw > 1.3 ? '🎸 БРАВО!' : '🎸 Аккорд!', '#ffe08a', 15);
        this.cameras.main.shake(140, 0.006);
        break;
      case 'ovation':
        for (const id of f.ids || []) {
          const e = this.players.get(id);
          if (e) { this.floatText(e.c.x, e.c.y - 40, '👏', '#fff', 15); this.ring(e.c.x, e.c.y, 26, 0xffb030, 500, 3); }
        }
        break;
      case 'raiseCorpse':
        this.ring(f.x, f.y, 28, 0x5fffb0, 600, 4);
        this.burst(f.x, f.y, 0x5fffb0, 16);
        this.floatText(f.x, f.y - 34, f.auto ? '💀 Восстал!' : '🧟 Встань!', '#5fffb0', 13);
        break;
      case 'darkArrow': {
        const orb = this.add.image(f.fx, f.fy, 'proj_necro').setScale(1.6).setDepth(860);
        this.tweens.add({ targets: orb, x: f.x, y: f.y, duration: f.flight, onComplete: () => { orb.destroy(); this.burst(f.x, f.y, 0x3fbf7a, 12); } });
        break;
      }
      case 'soulDevour':
        this.ring(f.x, f.y, f.r, 0x3fbf7a, 700, 4);
        for (const id of f.ids || []) {
          const m = this.monsters.get(id);
          if (!m) continue;
          const o = this.add.image(m.c.x, m.c.y, 'proj_necro').setDepth(860).setScale(0.8);
          this.tweens.add({ targets: o, x: f.x, y: f.y, duration: 500, onComplete: () => o.destroy() });
        }
        break;
      case 'holyVow': {
        const V = { protection: [0x8ad3ff, '🛡️ Обет защиты'], retribution: [0xffb030, '⚔️ Обет кары'], mercy: [0xffd0e0, '💛 Обет милосердия'] }[f.vow];
        this.ring(f.x, f.y, 38, V[0], 500, 4);
        this.floatText(f.x, f.y - 52, V[1], '#' + V[0].toString(16).padStart(6, '0'), 14);
        break;
      }
      case 'heavenStrike': {
        // Столп света с неба
        const beam = this.add.rectangle(f.x, f.y - 90, 18, 180, 0xfff6c0, 0.75).setDepth(870);
        this.tweens.add({ targets: beam, scaleX: 2.5, alpha: 0, duration: 450, onComplete: () => beam.destroy() });
        this.burst(f.x, f.y, f.vow === 'retribution' ? 0xffb030 : 0xfff0a0, 18);
        this.ring(f.x, f.y, 30, 0xffe08a, 400, 4);
        if (f.vow === 'retribution') this.cameras.main.shake(140, 0.006);
        break;
      }
      case 'holyAuraCast':
        this.ring(f.x, f.y, f.r, 0xffe08a, 700, 5);
        break;
      case 'healingPrayer':
        this.ring(f.x, f.y, f.r, 0xfff6c0, 800, 3);
        for (let i = 0; i < 10; i++) {
          const x = f.x + (Math.random() - 0.5) * 70, y = f.y + Math.random() * 10;
          const t = this.add.text(x, y, '✚', { fontSize: '13px', color: '#fff6c0' }).setOrigin(0.5).setDepth(900);
          this.tweens.add({ targets: t, y: y - 55, alpha: 0, delay: i * 40, duration: 850, onComplete: () => t.destroy() });
        }
        break;
      case 'banishDarkness': {
        const flash = this.add.circle(f.x, f.y, f.r, 0xffffff, 0.7).setDepth(880).setScale(0.3);
        this.tweens.add({ targets: flash, scale: 1, alpha: 0, duration: 420, onComplete: () => flash.destroy() });
        this.burst(f.x, f.y, 0xfff0a0, 20);
        this.floatText(f.x, f.y - 40, '✝ Изыди!', '#fff6c0', 14);
        break;
      }
      case 'blessing':
        for (const id of f.ids || []) {
          const e = this.players.get(id);
          if (e) { this.ring(e.c.x, e.c.y, 28, 0xfff0a0, 600, 3); this.floatText(e.c.x, e.c.y - 40, '😇', '#fff', 14); }
        }
        break;
      case 'faithRelease':
        this.floatText(f.x, f.y - 66, '🕯️ Сила веры!', '#fff0a0', 14);
        break;
      case 'elementSwap': {
        const C = { fire: [0xff6a1a, '🔥 Огонь'], ice: [0x8ad3ff, '❄️ Лёд'], lightning: [0xffe94a, '⚡ Молния'], earth: [0xa07a4a, '🪨 Земля'] }[f.el];
        this.ring(f.x, f.y, 36, C[0], 450, 4);
        this.burst(f.x, f.y, C[0], 14);
        this.floatText(f.x, f.y - 50, C[1], '#' + C[0].toString(16).padStart(6, '0'), 14);
        break;
      }
      case 'elementBolt': {
        const C = { fire: 0xff6a1a, ice: 0x8ad3ff, lightning: 0xffe94a, earth: 0xa07a4a }[f.el];
        if (f.el === 'lightning') {
          // Молния: мгновенная цепь от мага через цели
          const g = this.add.graphics().setDepth(870);
          const pts = [[f.fx, f.fy], ...f.pts];
          const draw = () => {
            g.clear(); g.lineStyle(3, 0xfff6a0, 1);
            for (let i = 0; i < pts.length - 1; i++) {
              const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
              g.beginPath(); g.moveTo(x1, y1);
              for (let k = 1; k < 5; k++) g.lineTo(x1 + (x2 - x1) * k / 5 + (Math.random() - 0.5) * 14, y1 + (y2 - y1) * k / 5 + (Math.random() - 0.5) * 14);
              g.lineTo(x2, y2); g.strokePath();
            }
          };
          draw(); this.time.addEvent({ delay: 60, repeat: 3, callback: draw }); this.time.delayedCall(260, () => g.destroy());
        } else {
          const tex = { fire: 'proj_fireball', ice: 'proj_frost', earth: 'proj_stone' }[f.el];
          const orb = this.add.image(f.fx, f.fy, tex).setScale(1.8).setDepth(860);
          orb.rotation = Phaser.Math.Angle.Between(f.fx, f.fy, f.x, f.y);
          this.tweens.add({ targets: orb, x: f.x, y: f.y, duration: f.flight, onComplete: () => { orb.destroy(); this.burst(f.x, f.y, C, 14); this.ring(f.x, f.y, 24, C, 350, 3); } });
        }
        break;
      }
      case 'elementStorm': {
        const C = { fire: 0xff6a1a, ice: 0x8ad3ff, lightning: 0xffe94a, earth: 0xa07a4a }[f.el];
        this.ring(f.x, f.y, f.r, C, 900, 4);
        const zone = this.add.circle(f.x, f.y, f.r, C, 0.18).setDepth(820).setScale(1, 0.55);
        this.tweens.add({ targets: zone, alpha: 0, duration: 1300, onComplete: () => zone.destroy() });
        const drops = f.el === 'lightning' ? 3 : 12;
        for (let i = 0; i < drops; i++) {
          const delay = f.el === 'lightning' ? 200 + i * 300 : i * 25;
          this.time.delayedCall(delay, () => {
            const x = f.x + (Math.random() - 0.5) * f.r * 1.4, y = f.y + (Math.random() - 0.5) * f.r * 0.8;
            if (f.el === 'lightning') {
              const bolt = this.add.line(0, 0, x, y - 200, x, y, 0xfff6a0, 1).setOrigin(0, 0).setLineWidth(4).setDepth(880);
              this.tweens.add({ targets: bolt, alpha: 0, duration: 200, onComplete: () => bolt.destroy() });
              this.burst(x, y, 0xffe94a, 10); this.cameras.main.shake(80, 0.004);
            } else {
              const tex = { fire: 'proj_fireball', ice: 'proj_frost', earth: 'proj_stone' }[f.el];
              const d = this.add.image(x + 40, y - 160, tex).setDepth(870).setScale(1.3).setRotation(Math.PI / 2);
              this.tweens.add({ targets: d, x, y, duration: 300, ease: 'Quad.easeIn', onComplete: () => { d.destroy(); this.burst(x, y, C, 5); } });
            }
          });
        }
        if (f.el === 'earth') this.time.delayedCall(350, () => this.cameras.main.shake(220, 0.01));
        break;
      }
      case 'shapeshift':
        this.burst(f.x, f.y, f.form === 'beast' ? 0x8a5a2a : 0x7fd36b, 22);
        this.ring(f.x, f.y, 34, f.form === 'beast' ? 0xc0601e : 0x7fd36b, 450, 4);
        this.floatText(f.x, f.y - 50, f.form === 'beast' ? '🐺 Облик зверя!' : '🧙 Облик друида', f.form === 'beast' ? '#ffb070' : '#9aff9a', 14);
        if (f.from === this.myId) this.cameras.main.shake(120, 0.004);
        break;
      case 'feralCharge': {
        const ln = this.add.line(0, 0, f.fx, f.fy, f.x, f.y, 0x8a5a2a, 0.8).setOrigin(0, 0).setLineWidth(7).setDepth(840);
        this.tweens.add({ targets: ln, alpha: 0, duration: 350, onComplete: () => ln.destroy() });
        this.ring(f.x, f.y, f.r, 0xc0601e, 500, 5);
        this.floatText(f.x, f.y - 56, 'АУУУ!', '#ffb070', 16);
        this.cameras.main.shake(150, 0.006);
        if (f.from === this.myId && this.me) { this.me.x = f.x; this.me.y = f.y; }
        break;
      }
      case 'feralThirst':
        this.ring(f.x, f.y, 36, 0xc01a3a, 500, 4);
        this.floatText(f.x, f.y - 50, '🩸 Жажда зверя', '#ff8a8a', 13);
        break;
      case 'decoy':
        this.burst(f.x, f.y, 0xff7ad0, 16);
        this.floatText(f.x, f.y - 40, '👯 Двойник', '#ffb0e8', 13);
        break;
      case 'mirage':
        this.ring(f.x, f.y, f.r, 0xd04aa0, 800, 4);
        this.ring(f.x, f.y, f.r * 0.6, 0x8a5cd6, 700, 3);
        this.floatText(f.x, f.y - 56, '🌀 Морок', '#e8a0ff', 14);
        break;
      case 'deceptionFlash': {
        const flash = this.add.circle(f.x, f.y, f.r, 0xffffff, 0.75).setDepth(880).setScale(0.3);
        this.tweens.add({ targets: flash, scale: 1, alpha: 0, duration: 450, ease: 'Cubic.easeOut', onComplete: () => flash.destroy() });
        this.burst(f.x, f.y, 0xffb0e8, 20);
        if (f.from === this.myId) this.cameras.main.flash(150, 255, 230, 245);
        break;
      }
      case 'illusionSwap':
        this.floatText(f.x, f.y - 46, '🎭 Подмена!', '#ffb0e8', 13);
        this.burst(f.x, f.y, 0xff7ad0, 12);
        break;
      case 'darkFlame': {
        const orb = this.add.image(f.fx, f.fy, 'proj_darkfire').setScale(2.2).setDepth(860);
        this.tweens.add({ targets: orb, x: f.x, y: f.y, duration: f.flight, onComplete: () => {
          orb.destroy();
          this.ring(f.x, f.y, f.r, 0x7a2ab0, 500, 6);
          this.burst(f.x, f.y, 0x1a0a20, 18); this.burst(f.x, f.y, 0xb06aff, 10);
        } });
        break;
      }
      case 'spiritPact': {
        const names = { fury: 'Демон ярости', stone: 'Дух камня', wind: 'Дух ветра' };
        const cols = { fury: 0xff3020, stone: 0x9aa3ad, wind: 0x8ad3ff };
        this.ring(f.x, f.y, 45, cols[f.pact], 600, 5);
        this.floatText(f.x, f.y - 58, `📜 Пакт: ${names[f.pact]}`, '#d8b0ff', 13);
        break;
      }
      case 'bloodCurse':
        this.ring(f.x, f.y, f.r, 0xa01020, 650, 4);
        for (const id of f.ids || []) { const m = this.monsters.get(id); if (m) this.burst(m.c.x, m.c.y, 0xa01020, 6); }
        break;
      case 'spiritGiftUsed':
        this.floatText(f.x, f.y - 66, '👹 Дар духов!', '#ffd03a', 13);
        break;
      case 'naturesThorns':
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * Math.PI * 2, d = Math.random() * f.r;
          const x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d * 0.6;
          const sp = this.add.triangle(x, y, 0, 12, 4, 0, 8, 12, 0x3f8a2f).setDepth(820).setScale(0.2, 0.2);
          this.tweens.add({ targets: sp, scaleX: 1, scaleY: 1.4, duration: 180, delay: i * 25, yoyo: true, hold: 1200, onComplete: () => sp.destroy() });
        }
        this.ring(f.x, f.y, f.r, 0x5fd17a, 500, 3);
        break;
      case 'forestBlessing':
        this.ring(f.x, f.y, f.r, 0x9aff9a, 700, 3);
        for (let i = 0; i < 12; i++) {
          const x = f.x + (Math.random() - 0.5) * 80, y = f.y + Math.random() * 20;
          const leaf = this.add.image(x, y, 'proj_leaf').setDepth(900);
          this.tweens.add({ targets: leaf, y: y - 60, angle: 180, alpha: 0, delay: i * 40, duration: 900, onComplete: () => leaf.destroy() });
        }
        break;
      case 'forestWrath':
        this.ring(f.x, f.y, 60, 0x5fd17a, 600, 4);
        this.floatText(f.x, f.y - 56, '🧚 Гнев леса!', '#9aff9a', 14);
        break;
      case 'exposeStrike':
        this.ring(f.x, f.y, 26, 0xffde3a, 350, 4);
        this.floatText(f.x, f.y - 44, 'Уязвимость!', '#ffde3a', 13);
        break;
      case 'poisonBlade':
        this.burst(f.x, f.y, 0x7ad84a, 14);
        this.floatText(f.x, f.y - 40, '🧪 Яд', '#9aff6a', 12);
        break;
      case 'weakSpots':
        if (f.from === this.myId) for (const id of f.ids || []) {
          const m = this.monsters.get(id);
          if (m) this.ring(m.c.x, m.c.y, 18, 0xffde3a, 500, 2);
        }
        break;
      case 'shadowStrike':
        this.burst(f.x, f.y, f.lethal ? 0xff2040 : 0x6a1a2a, f.lethal ? 26 : 12);
        this.floatText(f.x, f.y - 44, f.lethal ? 'Смертельный удар!' : 'Из тени!', f.lethal ? '#ff4050' : '#d8a0a8', f.lethal ? 15 : 12);
        if (f.lethal) this.cameras.main.shake(140, 0.006);
        break;
      case 'shadowCloak':
        for (let i = 0; i < 10; i++) {
          const puff = this.add.circle(f.x + (Math.random() - 0.5) * 40, f.y + (Math.random() - 0.5) * 24, 8, 0x1a1a22, 0.7).setDepth(900);
          this.tweens.add({ targets: puff, scale: 2, alpha: 0, duration: 700 + Math.random() * 400, onComplete: () => puff.destroy() });
        }
        break;
      case 'execution':
        this.floatText(f.x, f.y - 46, f.ok ? 'КАЗНЬ!' : 'Не добит', f.ok ? '#ff3040' : '#c8b8b8', f.ok ? 17 : 11);
        if (f.ok) { this.ring(f.x, f.y, 34, 0xff3040, 450, 5); this.cameras.main.shake(120, 0.006); }
        break;
      case 'lifeSteal':
        for (let i = 0; i < 8; i++) {
          const o = this.add.image(f.fx, f.fy, 'proj_shadow').setDepth(850).setScale(0.6).setTint(0xff4060);
          this.tweens.add({ targets: o, x: f.x, y: f.y, delay: i * 40, duration: 450, onComplete: () => o.destroy() });
        }
        break;
      case 'desecrate':
        this.ring(f.x, f.y, f.r, 0x3fbf7a, 600, 4);
        this.burst(f.x, f.y, 0x1a3a24, 16);
        break;
      case 'raiseDead':
        this.ring(f.x, f.y, 30, 0x5fffb0, 600, 4);
        this.burst(f.x, f.y, 0x5fffb0, 20);
        this.floatText(f.x, f.y - 36, 'Восстань!', '#5fffb0', 14);
        break;
      case 'shieldWall':
        this.ring(f.x, f.y, f.r, 0x8ad3ff, 700, 5);
        break;
      case 'taunt':
        this.ring(f.x, f.y, f.r, 0xff6040, 600, 4);
        this.floatText(f.x, f.y - 56, 'Ко мне!', '#ff9a6a', 16);
        for (const id of f.ids || []) {
          const m = this.monsters.get(id);
          if (m) this.floatText(m.c.x, m.c.y - 30, '❗', '#ff6040', 14);
        }
        break;
      case 'vow': {
        const ally = this.players.get(f.ally);
        const ln = this.add.line(0, 0, f.x, f.y, ally ? ally.c.x : f.ax, ally ? ally.c.y : f.ay, 0xffd36a, 0.9).setOrigin(0, 0).setLineWidth(3).setDepth(840);
        this.tweens.add({ targets: ln, alpha: 0, duration: 900, onComplete: () => ln.destroy() });
        this.floatText(f.x, f.y - 50, 'Клянусь защищать!', '#ffd36a', 12);
        break;
      }
      case 'autoShield':
        this.floatText(f.x, f.y - 50, 'Несокрушим!', '#8ad3ff', 15);
        this.ring(f.x, f.y, 40, 0x8ad3ff, 600, 5);
        break;
      case 'punishSeal':
        this.ring(f.x, f.y, 36, 0x9b4dff, 600, 4);
        this.ring(f.x, f.y, 22, 0x2a0a3a, 500, 6);
        this.floatText(f.x, f.y - 40, '⛓️ Приговор', '#c890ff', 12);
        break;
      case 'darkBlade': {
        const ln = this.add.line(0, 0, f.fx, f.fy, f.x, f.y, 0x3a0a5a, 0.8).setOrigin(0, 0).setLineWidth(7).setDepth(840);
        this.tweens.add({ targets: ln, alpha: 0, duration: 400, onComplete: () => ln.destroy() });
        this.burst(f.fx, f.fy, 0x3a0a5a, 12);
        this.burst(f.tx, f.ty, f.sealed ? 0xc070ff : 0x6a2a9a, f.sealed ? 20 : 10);
        if (f.sealed) this.floatText(f.tx, f.ty - 46, 'Кара!', '#c890ff', 15);
        if (f.from === this.myId && this.me) { this.me.x = f.x; this.me.y = f.y; }
        break;
      }
      case 'shadowJudgment': {
        const flash = this.add.circle(f.x, f.y, f.r, 0x1a0a24, 0.6).setDepth(830).setScale(0.2);
        this.tweens.add({ targets: flash, scale: 1, alpha: 0, duration: 600, ease: 'Cubic.easeOut', onComplete: () => flash.destroy() });
        this.ring(f.x, f.y, f.r, 0x9b4dff, 650, 5);
        this.burst(f.x, f.y, 0x6a2a9a, 24);
        this.cameras.main.shake(180, 0.006);
        break;
      }
      case 'markPrey':
        this.ring(f.x, f.y, 34, 0xffcc4d, 500, 3);
        this.floatText(f.x, f.y - 38, '🎯 Контракт', '#ffcc4d', 12);
        break;
      case 'shadowDash': {
        const ln = this.add.line(0, 0, f.fx, f.fy, f.x, f.y, 0x5a7aa0, 0.7).setOrigin(0, 0).setLineWidth(5).setDepth(840);
        this.tweens.add({ targets: ln, alpha: 0, duration: 350, onComplete: () => ln.destroy() });
        this.burst(f.fx, f.fy, 0x3a4a6a, 10);
        this.burst(f.tx, f.ty, 0xd8e0ea, 12);
        this.floatText(f.tx, f.ty - 44, 'Удар в спину!', '#d8e0ea', 13);
        if (f.from === this.myId && this.me) { this.me.x = f.x; this.me.y = f.y; }
        break;
      }
      case 'smokeScreen':
        for (let i = 0; i < 14; i++) {
          const x = f.x + (Math.random() - 0.5) * 70, y = f.y + (Math.random() - 0.5) * 40;
          const puff = this.add.circle(x, y, 10 + Math.random() * 10, 0x9aa0a8, 0.55).setDepth(900);
          this.tweens.add({ targets: puff, scale: 2.2, alpha: 0, y: y - 20, delay: i * 30, duration: 1400 + Math.random() * 800, onComplete: () => puff.destroy() });
        }
        break;
      case 'favorReady':
        this.floatText(f.x, f.y - 50, '🌀 Духи благосклонны!', '#9ff0ff', 13);
        this.ring(f.x, f.y, 40, 0x9ff0ff, 600, 3);
        break;
    }
  }

  // Параметры атаки и бега с учётом облика (Талиесин)
  prof() {
    const h = this.heroes[this.me.data.hero];
    return h.forms ? h.forms[this.myStats.form || 'human'] : h;
  }

  // ---------- Бой ----------
  findTarget() {
    const me = this.me;
    const range = this.prof().range;
    const cur = this.targetId && this.monsters.get(this.targetId);
    const seen = (e) => this.lineOfSight(me.x, me.y, e.c.x, e.c.y); // за стеной цель не выбирается
    const gone = (e) => e.killAt && performance.now() - e.killAt < 1200; // уже добит своим ударом, ждём подтверждения сервера
    if (cur && !gone(cur) && Phaser.Math.Distance.Between(me.x, me.y, cur.c.x, cur.c.y) <= range + 120 && seen(cur)) return cur;
    let best = null, bestD = range + 60;
    for (const [id, e] of this.monsters) {
      if (gone(e)) continue;
      const d = Phaser.Math.Distance.Between(me.x, me.y, e.c.x, e.c.y);
      if (d < bestD && seen(e)) { best = e; bestD = d; }
    }
    this.targetId = best ? best.data.id : null;
    return best;
  }

  tryAttack(force) {
    const me = this.me;
    if (!me || me.data.dead) return;
    const hero = this.prof();
    const now = this.time.now;
    if (now - this.lastAttack < (this.myStats.cd || hero.cooldown)) return;
    const t = this.findTarget();
    if (!t) return;
    const d = Phaser.Math.Distance.Between(me.x, me.y, t.c.x, t.c.y);
    if (d > hero.range) {
      // Подходим к цели, если она чуть дальше дальности атаки
      if (force || this.input_.attack) this.autoWalk = t.data.id;
      return;
    }
    this.autoWalk = null;
    this.lastAttack = now;
    me.dir = t.c.x < me.x ? -1 : 1;
    if (me.e.skinOn) me.e.row = Skins.rowFor(t.c.x - me.x, t.c.y - me.y); // лицом к цели
    this.net.emit('attack', { targetId: t.data.id });
    this.predictAttack(t, hero);
  }
  // Умение: название, звук, вибрация и вспышка — сразу по нажатию (сам эффект рисуется, когда придёт от сервера).
  // Только если умение, по нашим данным, готово и хватает ресурса — иначе сервер всё равно откажет
  predictSkill(id) {
    const me = this.me, list = this.heroes[me.data.hero].skills, idx = list.findIndex((k) => k.id === id), sk = list[idx];
    if (!sk || !me.e || idx >= (this.myStats.unlocked ?? 1)) return; // умение ещё закрыто — сервер откажет
    const now = performance.now(), last = (this.skillAt ??= {})[id] || 0;
    if (now - last < (sk.cooldown || 0) * 0.85 || (this.myStats.res ?? 1e9) < (sk.cost || 0)) return;
    this.skillAt[id] = now;
    this.localSkill = { s: id, at: now };
    this.floatText(me.e.c.x, me.e.c.y - 44, sk.icon + ' ' + sk.name, '#ffe08a', 12);
    this.ui.vibrate && this.ui.vibrate('medium');
    const ring = this.add.circle(me.e.c.x, me.e.c.y - 8, 10, 0xffe08a, 0.35).setDepth(860).setStrokeStyle(2, 0xfff3c0, 0.9);
    this.tweens.add({ targets: ring, scale: 3, alpha: 0, duration: 260, onComplete: () => ring.destroy() });
    this.playSound({ t: 'skill', s: id, from: this.myId });
  }
  // Свой удар — сразу на экране (взмах или выстрел, звук), не дожидаясь ответа сервера: при пинге 200–300 мс
  // иначе удар появлялся с заметной задержкой, а снаряд летел из старого места. Урон и цифры по-прежнему считает сервер.
  predictAttack(t, hero) {
    const me = this.me, a = me.e;
    if (!a) return;
    (this.localAtk ??= []).push({ target: t.data.id, at: performance.now() });
    // Удар точно добивает (урон больше остатка здоровья) — сразу переключаемся на следующего, не бьём «мёртвого», пока сервер подтверждает
    if ((this.myStats.dmg || 0) * 0.95 >= (t.data.hp || 0)) { t.killAt = performance.now(); if (this.targetId === t.data.id) this.targetId = null; }
    if (this.localAtk.length > 20) this.localAtk.shift();
    const tx = t.c.x, ty = t.c.y, proj = hero.projectile;
    const f = { t: 'hit', kind: 'm', from: this.myId, target: t.data.id, basic: true, proj, fx: me.x, fy: me.y, tx, ty, crit: false, local: true };
    const noop = () => {};
    try {
      if (proj) {
        if (!HeroFx.shoot(this, a, f, tx, ty, noop)) {
          const p = this.add.image(me.x, me.y, 'proj_' + proj).setDepth(800);
          p.rotation = Phaser.Math.Angle.Between(me.x, me.y, tx, ty);
          this.tweens.add({ targets: p, x: tx, y: ty, duration: Phaser.Math.Distance.Between(me.x, me.y, tx, ty) * 1.4, onComplete: () => p.destroy() });
        }
      } else if (!HeroFx.attack(this, a, f, tx, ty)) {
        if (a.beast) this.tweens.add({ targets: a.sprite, x: Math.sign(tx - a.c.x) * 10, duration: 90, yoyo: true, onComplete: () => { a.sprite.x = 0; } });
        else this.tweens.add({ targets: a.sprite, scaleX: 1.2, scaleY: 0.9, duration: 70, yoyo: true });
        const slash = this.add.arc(tx, ty, 16, 200, 340, false).setStrokeStyle(3, 0xffffff).setDepth(800);
        this.tweens.add({ targets: slash, alpha: 0, scale: 1.6, duration: 200, onComplete: () => slash.destroy() });
      }
    } catch (e) { /* анимация не обязательна */ }
    if (window.Sfx) Sfx.play(proj ? 'shoot' : 'hit', { pitch: 0.9 + Math.random() * 0.2 });
  }

  autoFarmTick(time) {
    const me = this.me, range = this.prof().range;
    const skip = this.afSkip || (this.afSkip = new Map()); // недостижимые цели (за стенами лабиринта): id → до какого времени не брать
    let t = this.targetId && this.monsters.get(this.targetId);
    const gone = (e) => e.killAt && performance.now() - e.killAt < 1200;
    if (t && (t.pvp || t.heroClone || gone(t) || skip.get(t.data.id) > time)) t = null;
    if (!t) { // ближайший монстр; видимые напрямую — в приоритете
      let bd = 1e9;
      for (const e of this.monsters.values()) {
        if (e.pvp || e.heroClone || gone(e) || skip.get(e.data.id) > time) continue;
        let d = Math.hypot(e.c.x - me.x, e.c.y - me.y);
        if (d > 1200) continue;
        if (!this.lineOfSight(me.x, me.y, e.c.x, e.c.y)) d += 400;
        if (d < bd) { bd = d; t = e; }
      }
      this.targetId = t ? t.data.id : null;
      if (skip.size > 200) for (const [id, until] of skip) if (until < time) skip.delete(id);
    }
    if (t) {
      const d = Math.hypot(t.c.x - me.x, t.c.y - me.y);
      if (d > range - 6) {
        if (this.lineOfSight(me.x, me.y, t.c.x, t.c.y)) { this.walkTo = null; this.autoWalk = t.data.id; }
        else if (time > (this.afPathAt || 0)) { // за стеной — обходим по пути
          this.afPathAt = time + 700;
          const path = this.findPath(me.x, me.y, t.c.x, t.c.y);
          this.walkTo = path && path.length ? { path, stuck: 0 } : null; this.autoWalk = null;
          if (!path) { skip.set(t.data.id, time + 20000); this.targetId = null; } // недостижим — возьмём другого
        }
      } else { this.autoWalk = null; this.walkTo = null; }
      // Умения: готовые по перезарядке и ресурсу; переключатели облика/стихии/обета не трогаем
      if (d <= range + 20 && time > (this.afSkillAt || 0) && this.lineOfSight(me.x, me.y, t.c.x, t.c.y)) {
        this.afSkillAt = time + 450;
        const skills = this.heroes[me.data.hero].skills, st = this.myStats || {};
        const sk = skills.find((s, i) => i < (st.unlocked ?? 1) && !(s.cost === 0 && s.costLabel === 'бесплатно')
          && (st.res === undefined || st.res >= (s.cost || 0)) && this.ui.skillReady && this.ui.skillReady(s.id));
        if (sk) this.input_.skill = sk.id;
      }
      return;
    }
    // Монстров рядом нет — идём исследовать: случайная свободная клетка, неразведанные в приоритете
    if (this.walkTo || time < (this.afWanderAt || 0)) return;
    this.afWanderAt = time + 3000;
    const z = this.zone, T = this.T, ex = this.explored.get(z.id);
    const mx = Math.floor((me.x - z.ox) / T), my = Math.floor((me.y - z.oy) / T);
    let goal = null;
    for (let i = 0; i < 60 && !goal; i++) {
      const x = mx + Math.round((Math.random() - 0.5) * 40), y = my + Math.round((Math.random() - 0.5) * 40);
      if (x < 1 || y < 1 || x >= z.w - 1 || y >= z.h - 1 || this.solid.has(this.tiles[y * z.w + x])) continue;
      if (Math.hypot(x - mx, y - my) < 5) continue;
      if (ex && ex.has(y * z.w + x) && i < 40) continue; // сначала ищем неразведанное
      goal = { x: z.ox + (x + 0.5) * T, y: z.oy + (y + 0.5) * T };
    }
    const path = goal && this.findPath(me.x, me.y, goal.x, goal.y);
    if (path && path.length) this.walkTo = { path, stuck: 0 };
  }

  // Новая позиция чужого героя: запоминаем скорость, чтобы предсказывать движение между пакетами
  // Часы сервера для плавного показа чужих героев. off — наименьшая разница «наше время − время сервера» (пакет, дошедший быстрее всех),
  // jit — насколько пакеты опаздывают сверх неё (неровная связь, VPN). Чужих героев рисуем «в прошлом» на задержку,
  // зависящую от jit: при ровной связи ~100 мс, при пинге 300 мс через VPN — больше, зато без рывков и прыжков.
  netClock(ts) {
    if (!ts) return;
    const now = performance.now(), sample = now - ts, c = (this.nc ??= { off: sample, jit: 30, at: now });
    c.off = Math.min(sample, c.off + (now - c.at) * 0.002); // медленно подстраиваемся, если часы «уплывают»
    c.jit += (Math.max(0, sample - c.off) - c.jit) * 0.08;
    c.at = now;
  }
  bufPush(e, x, y, ts) {
    const b = (e.buf ??= []), last = b[b.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) > 160) b.length = 0; // телепорт — без «проезда» через карту
    if (!last || ts > last.t) b.push({ t: ts, x, y });
    while (b.length > 2 && b[1].t < ts - 1500) b.shift();
  }
  // Позиция сущности на момент rt (время сервера) по буферу: между двумя известными — по прямой, после последней — чуть вперёд
  interpAt(b, rt) {
    const L = b[b.length - 1];
    if (rt >= L.t) {
      const p0 = b[b.length - 2], ext = p0 ? Math.min(150, rt - L.t) / Math.max(1, L.t - p0.t) : 0;
      return [L.x + (p0 ? (L.x - p0.x) * ext : 0), L.y + (p0 ? (L.y - p0.y) * ext : 0)];
    }
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > rt) i--;
    const a0 = b[i - 1], a1 = b[i];
    if (!a0) return [a1.x, a1.y];
    const f = (rt - a0.t) / Math.max(1, a1.t - a0.t);
    return [a0.x + (a1.x - a0.x) * f, a0.y + (a1.y - a0.y) * f];
  }
  interpDelay() { return this.nc ? Math.max(100, Math.min(450, 70 + this.nc.jit * 1.6)) : 100; }
  trackPos(e, x, y, ts) {
    const now = performance.now();
    if (ts) this.bufPush(e, x, y, ts);
    if (x !== e.tx || y !== e.ty) {
      const dts = e.moveT ? (now - e.moveT) / 1000 : 0; // скорость — между двумя разными позициями
      if (dts > 0.03 && dts < 0.4) { e.vx = Math.max(-400, Math.min(400, (x - e.tx) / dts)); e.vy = Math.max(-400, Math.min(400, (y - e.ty) / dts)); } else { e.vx = 0; e.vy = 0; }
      e.moveT = now; e.posT = now;
    } else if (!e.moveT || now - e.moveT > 160) { e.vx = 0; e.vy = 0; } // стоит на месте
    e.tx = x; e.ty = y;
  }
  // Указатель для новичка: маленькая золотая стрелка у героя — куда идти по текущему шагу сюжета (только в городе)
  guideArrow(time) {
    const GOAL = { s1: 'portal1', s4: 'alchemy', s6: 'gacha', s9: 'arena', s14: 'teleport', s17: 'teleport' };
    const id = GOAL[window.storyStep], me = this.me;
    const o = id && me && this.zone && this.zone.kind === 'town' && (this.zone.objs || []).find((x) => x.id === id);
    const d = o ? Math.hypot(o.x - me.x, o.y - me.y) : 0;
    if (!o || d < 110) { if (this.guide) this.guide.setVisible(false); return; }
    if (!this.guide) this.guide = this.add.triangle(0, 0, 0, -9, 18, 0, 0, 9, 0xffd36a).setStrokeStyle(2, 0x5a3a10).setDepth(950);
    const a = Math.atan2(o.y - me.y, o.x - me.x), r = 40 + Math.sin(time / 200) * 4;
    this.guide.setVisible(true).setPosition(me.x + Math.cos(a) * r, me.y - 12 + Math.sin(a) * r).setRotation(a).setAlpha(0.75 + Math.sin(time / 200) * 0.25);
  }

  update(time, delta) {
    if (this.zoneLoading) return;
    this.guideArrow(time);
    if (this.pendingState) { const s = this.pendingState; this.pendingState = null; this.onState(s); } // догружается новый мир — карта ещё старая, не двигаемся
    const dt = delta / 1000;
    // Подошёл к запечатанным воротам босса — когда они откроются
    if (Settings.get('hints') && this.me && this.gates && this.gates.size && time > (this.gateHintAt || 0)) {
      for (const img of this.gates.values()) {
        if (img.gateState === 'open' || Math.hypot(img.x - this.me.x, img.y - 20 - this.me.y) > 70) continue;
        const b = window.hallInfo && window.hallInfo.boss, t = b && new Date(b.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        this.floatText(img.x, img.y - img.displayHeight - 6, b ? `🔒 Откроются, когда придёт босс — в ${t}` : '🔒 Ворота запечатаны', '#ffd9a0', 12, 4000);
        this.gateHintAt = time + 6000; // надпись держится 4 с, потом плавно уходит
        break;
      }
    }
    // Интерполяция чужих сущностей
    const k = Math.min(1, dt * 12);
    // Чужие герои: цель — последняя позиция с сервера плюс небольшое предсказание по скорости (до 120 мс вперёд)
    const kp = Math.min(1, dt * 18), nowMs = performance.now();
    for (const [id, e] of this.players) {
      if (id === this.myId) continue;
      let gx, gy, mx, my;
      const b = e.buf;
      if (b && b.length && this.nc) {
        // Интерполяция между позициями с сервера на момент «сейчас − задержка»: движение ровное, даже если пакеты пришли пачкой
        [gx, gy] = this.interpAt(b, nowMs - this.nc.off - this.interpDelay());
        mx = gx - e.c.x; my = gy - e.c.y;
        if (Math.hypot(mx, my) > 160) { e.c.x = gx; e.c.y = gy; } else { const kk = Math.min(1, dt * 30); e.c.x += mx * kk; e.c.y += my * kk; }
        const sp = Math.hypot(mx, my) / Math.max(0.001, dt); // скорость на экране: идёт или стоит (для анимации шага)
        if (sp < 25) { mx = 0; my = 0; } else { mx *= 4; my *= 4; }
      } else {
        const ahead = e.posT ? Math.min(0.1, (nowMs - e.posT) / 1000) : 0;
        gx = e.tx + (e.vx || 0) * ahead; gy = e.ty + (e.vy || 0) * ahead;
        mx = gx - e.c.x; my = gy - e.c.y;
        if (Math.hypot(mx, my) > 160) { e.c.x = gx; e.c.y = gy; } // телепорт — сразу на место
        else { e.c.x += mx * kp; e.c.y += my * kp; }
      }
      if (e.skinOn) {
        const moving = Math.hypot(mx, my) > 1.5;
        this.animSkin(e, moving ? mx : 0, moving ? my : 0, moving);
      } else if (e.beast) this.animBeast(e, mx, my, Math.hypot(mx, my) > 1.5);
    }
    const mrt = this.nc ? nowMs - this.nc.off - this.interpDelay() : 0;
    for (const e of this.monsters.values()) {
      if (e.pvp) continue; // герой-соперник на арене движется вместе с героем
      let mx, my;
      if (e.buf && e.buf.length && this.nc) {
        // Монстры тоже по буферу времени сервера — без рывков при неровной связи
        const [gx, gy] = this.interpAt(e.buf, mrt);
        mx = gx - e.c.x; my = gy - e.c.y;
        const gap = Math.hypot(mx, my);
        // Рывок монстра (на сервере мгновенный, до ~300) — быстрый бросок за ~0,15 с, а не телепорт; дальше 600 — настоящий перенос
        if (gap > 600) { e.c.x = gx; e.c.y = gy; } else { const kk = Math.min(1, dt * (gap > 120 ? 14 : 30)); e.c.x += mx * kk; e.c.y += my * kk; }
        if (Math.hypot(mx, my) / Math.max(0.001, dt) < 20) { mx = 0; my = 0; } else { mx *= 4; my *= 4; }
      } else {
        mx = e.tx - e.c.x; my = e.ty - e.c.y;
        e.c.x += mx * k; e.c.y += my * k;
      }
      if (e.heroClone && e.skinOn) { const mv = Math.hypot(mx, my) > 1; this.animSkin(e, mv ? mx : 0, mv ? my : 0, mv); continue; }
      // Нарисованный монстр: шагает, пока движется, стоит — первый кадр ходьбы
      if (e.mskin && !e.attacking) {
        const moving = Math.hypot(mx, my) > 0.8;
        if (moving && !e.sprite.anims.isPlaying) e.sprite.play(`mwalk_${e.mskin}`);
        else if (!moving && e.sprite.anims.isPlaying) { e.sprite.stop(); e.sprite.setFrame(Skins.MOBS[e.mskin].walk[0]); }
      }
    }
    for (const e of this.pets.values()) {
      e.c.x += (e.tx - e.c.x) * k; e.c.y += (e.ty - e.c.y) * k;
      e.c.setDepth(10 + e.c.y);
      if (e.data && e.data.kind === 'hawk') e.sprite.y = -10 + Math.sin(time / 180) * 3; // сокол парит
      if (e.psk && !e.attacking) {
        const moving = Math.hypot(e.tx - e.c.x, e.ty - e.c.y) > 1.5 || ['hawk', 'turret', 'wisp', 'sprite'].includes(e.psk);
        if (moving && !e.sprite.anims.isPlaying) e.sprite.play(`pwalk_${e.psk}`);
        else if (!moving && e.sprite.anims.isPlaying) { e.sprite.stop(); e.sprite.setFrame(0); }
      }
    }

    const me = this.me;
    if (!me) return;

    // Автобой (Золотой орден): сам ищет цель, подходит, бьёт и применяет умения. Джойстик временно перехватывает управление
    if (this.autoFarm && !this.input_.vec.x && !this.input_.vec.y && !me.data.dead) this.autoFarmTick(time);
    // Управление
    let vx = this.input_.vec.x, vy = this.input_.vec.y;
    const K = this.keys;
    if (K.A.isDown || K.LEFT.isDown) vx = -1;
    if (K.D.isDown || K.RIGHT.isDown) vx = 1;
    if (K.W.isDown || K.UP.isDown) vy = -1;
    if (K.S.isDown || K.DOWN.isDown) vy = 1;
    if (vx || vy) { this.autoWalk = null; this.walkTo = null; }
    else if (this.walkTo) {
      const wp = this.walkTo.path[0];
      const dx = wp.x - me.x, dy = wp.y - me.y;
      // Точка пути достигнута — или герой упёрся в угол рядом с ней (стоит на месте) — берём следующую
      const near = Math.hypot(dx, dy), w = this.walkTo;
      if (near < 16 && Math.hypot(me.x - (w.lx || 0), me.y - (w.ly || 0)) < 0.5) w.idle = (w.idle || 0) + 1; else w.idle = 0;
      w.lx = me.x; w.ly = me.y;
      if (near < 12 || w.idle > 6) { w.path.shift(); w.idle = 0; if (!w.path.length) this.walkTo = null; }
      if (++(this.walkTo || {}).stuck > 1500) this.walkTo = null;
      if (this.walkTo) { vx = dx; vy = dy; }
    } else if (this.autoWalk) {
      const t = this.monsters.get(this.autoWalk);
      if (t) { vx = t.c.x - me.x; vy = t.c.y - me.y; } else this.autoWalk = null;
    }
    // Контроль от монстров: оглушение/заморозка/паутина — стоим; подчинение — управление наоборот
    // Контроль заканчивается по времени и без новой посылки статов (арена: оглушение отсчёта перед боем)
    const cc = this.myStats.cc && Date.now() < (this.myStats.ccEnd || Infinity) ? this.myStats.cc : null;
    if (cc === 'confuse') { vx = -vx; vy = -vy; }
    const held = cc === 'stun' || cc === 'freeze' || cc === 'root';
    const len = Math.hypot(vx, vy);
    const rooted = this.myStats.rooted && Date.now() < (this.myStats.rootEnd || Infinity);
    if (len > 0 && !me.data.dead && !rooted && !held) {
      const n = Math.min(1, len) / len;
      const speed = this.prof().speed * (this.myStats.haste ? 1.25 : 1) * (this.myStats.flyBoost || 1) * (this.myStats.slow ? 0.6 : 1); // свет ветра, полёт
      const dx = vx * n * speed * dt, dy = vy * n * speed * dt;
      const r = 10;
      if (!this.isSolidAt(me.x + dx + Math.sign(dx) * r, me.y)) me.x += dx;
      if (!this.isSolidAt(me.x, me.y + dy + Math.sign(dy) * r)) me.y += dy;
      if (Math.abs(vx) > 0.1) me.dir = vx < 0 ? -1 : 1;
    }
    me.e.c.setPosition(me.x, me.y);
    this.checkNear();
    this.revealFog();
    if (this.fog) for (const c of this.fog.clouds) { c.tilePositionX += c.vx * dt; c.tilePositionY += c.vy * dt; } // туман медленно плывёт
    const walking = len > 0 && !me.data.dead && !this.myStats.rooted && !held;
    // Шаги: по одному на шаг анимации, чередуются чуть разной высотой (левая/правая нога)
    if (walking && window.Sfx && time - (this.stepAt || 0) > 340 / (this.myStats.haste ? 1.25 : 1)) { this.stepAt = time; this.stepFoot = !this.stepFoot; Sfx.play('step', { pitch: this.stepFoot ? 1.06 : 0.94 }); }
    if (me.e.skinOn) this.animSkin(me.e, walking ? vx : 0, walking ? vy : 0, walking);
    else if (me.e.beast) this.animBeast(me.e, walking ? vx : 0, walking ? vy : 0, walking);
    else {
      me.e.sprite.setFlipX(me.dir === -1);
      // Лёгкая «походка»
      me.e.sprite.y = len > 0 ? Math.sin(time / 70) * 1.5 : 0;
    }

    if (time - this.lastSend > 66) {
      this.lastSend = time;
      if (me.sentX !== me.x || me.sentY !== me.y) {
        me.sentX = me.x; me.sentY = me.y;
        // volatile: без связи шаги не копятся (иначе после восстановления сервер получил бы пачку старых шагов и «откатил» героя)
        this.net.volatile.emit('move', { x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, dir: me.dir });
      }
    }

    if (this.input_.attack || this.keys.SPACE.isDown || this.autoWalk || this.autoFarm) this.tryAttack(false);
    // Умения: кнопки HUD или клавиши Q / E / R
    const skills = this.heroes[me.data.hero].skills;
    let skillId = this.input_.skill;
    ['Q', 'E', 'R'].forEach((k, i) => { if (skills[i] && Phaser.Input.Keyboard.JustDown(this.keys[k])) skillId = skills[i].id; });
    if (skillId) {
      this.input_.skill = null;
      if (!me.data.dead) {
        const t = this.findTarget();
        this.net.emit('skill', { id: skillId, targetId: t ? t.data.id : null });
        this.predictSkill(skillId);
      }
    }

    // Сортировка по глубине и кольцо цели
    for (const e of this.players.values()) e.c.setDepth(10 + e.c.y);
    for (const e of this.monsters.values()) e.c.setDepth(10 + e.c.y);
    const t = this.targetId && this.monsters.get(this.targetId);
    if (t) {
      this.targetRing.setVisible(true).setPosition(t.c.x, t.c.y + 12);
      this.ui.onTarget(`${t.data.nm || this.monsterDefs[t.data.type].name} · ур. ${t.data.lv}`, t.data.hp, t.data.maxHp);
    } else {
      this.targetRing.setVisible(false);
      this.ui.onTarget(null);
    }
  }
};
// Цвета тумана по мирам: base — плотная дымка (скрывает неразведанное), cloud — светлые клубы поверх
window.GameScene.FOG = {
  green: { hex: '#3a4744', base: [58, 71, 68], cloud: [176, 192, 186] },
  abyss: { hex: '#2a2234', base: [42, 34, 52], cloud: [128, 108, 160] },
  sky: { hex: '#d6e2ee', base: [214, 226, 238], cloud: [255, 255, 255] },
};
