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
    // Нарисованные скины героев: листы 8 направлений
    for (const [id, sk] of Object.entries(Skins.LIST)) {
      if (this.heroes[id]) this.load.spritesheet('skin_' + id, sk.sheet, { frameWidth: sk.w, frameHeight: sk.h });
    }
  }

  create() {
    const T = this.T;
    for (const [id, sk] of Object.entries(Skins.LIST)) {
      if (!this.textures.exists('skin_' + id)) continue;
      for (let r = 0; r < 8; r++) {
        this.anims.create({ key: `skin_${id}_${r}`, frames: this.anims.generateFrameNumbers('skin_' + id, { start: r * sk.frames, end: r * sk.frames + sk.frames - 1 }), frameRate: 10, repeat: -1 });
      }
    }

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
      if (obj.getData('monsterId')) {
        this.targetId = obj.getData('monsterId');
        this.tryAttack(true);
      }
    });

    // Сеть
    this.net.on('state', (s) => this.onState(s));
    this.net.on('stats', (st) => { this.myStats = st; });
    // Переход в другую зону: новая карта, прежние сущности исчезнут со следующим состоянием
    this.net.on('zone', (d) => {
      this.buildZone(d.zone);
      for (const [id, e] of this.players) if (id !== this.myId) { e.c.destroy(); this.players.delete(id); }
      for (const e of this.monsters.values()) e.c.destroy();
      this.monsters.clear();
      this.targetId = null; this.autoWalk = null;
      if (this.me) { this.me.x = d.x; this.me.y = d.y; this.me.e.c.setPosition(d.x, d.y); }
      this.cameras.main.flash(350, 255, 255, 255);
    });
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

  resize() {
    const w = this.scale.width, h = this.scale.height;
    // На телефоне показываем примерно 11-13 тайлов по короткой стороне
    const town = this.zone && this.zone.kind === 'town';
    const zoom = Phaser.Math.Clamp(Math.min(w, h) / ((town ? 15 : 12) * this.T), town ? 0.8 : 1, 3); // в городе обзор шире
    this.cameras.main.setZoom(zoom);
  }

  // Строит карту зоны: тайлы, здания, порталы, телепорт
  buildZone(z) {
    const T = this.T;
    if (this.fogLayer) { this.fogLayer.destroy(); this.fogLayer = null; }
    if (this.layer) { this.layer.destroy(); this.tilemap.destroy(); }
    this.zoneObjs.forEach((o) => o.destroy());
    this.zoneObjs = [];
    this.zone = z;
    const data2d = [];
    for (let y = 0; y < z.h; y++) data2d.push(z.tiles.slice(y * z.w, (y + 1) * z.w));
    this.tilemap = this.make.tilemap({ data: data2d, tileWidth: T, tileHeight: T });
    const ts = this.tilemap.addTilesetImage('tiles_' + z.theme, 'tiles_' + z.theme, T, T, 0, 0);
    this.layer = this.tilemap.createLayer(0, ts, z.ox, z.oy).setDepth(0);
    this.solid = new Set(z.solid);
    this.mapW = z.w; this.mapH = z.h; this.tiles = z.tiles;
    // Туман войны: в данже карта открывается по мере прохождения
    this.fogTile = null;
    if (z.fog) {
      this.fogLayer = this.tilemap.createBlankLayer('fog', ts, z.ox, z.oy).setDepth(2400);
      this.fogLayer.fill(9);
      if (!this.explored.has(z.id)) this.explored.set(z.id, new Set());
      for (const i of this.explored.get(z.id)) this.fogLayer.removeTileAt(i % z.w, Math.floor(i / z.w));
    }
    this.cameras.main.setBounds(z.ox, z.oy, z.w * T, z.h * T);
    this.cameras.main.setBackgroundColor({ green: '#2f6a28', abyss: '#07040c', sky: '#bfe0ff' }[z.theme]);
    const keep = (o) => { this.zoneObjs.push(o); return o; };
    const labelStyle = { fontSize: '11px', fontFamily: 'Arial', color: '#fff6d8', stroke: '#000', strokeThickness: 3, resolution: 2 };
    const PORTAL_COL = [0x5fd17a, 0x8ad3ff, 0xc890ff, 0xff8a5a, 0xffd84a, 0xff4a4a];
    for (const o of z.objs) {
      if (o.kind === 'place' && o.place !== 'teleport') {
        const key = `bld_${z.theme}_${o.place}`;
        if (!this.textures.exists(key)) this.textures.addCanvas(key, Gfx.building(o.place, z.theme));
        const img = keep(this.add.image(o.bx + o.bw / 2, o.by + o.bh, key).setOrigin(0.5, 1).setDepth(10 + o.by + o.bh - 8));
        img.setInteractive().on('pointerdown', () => this.goTo(o));
        keep(this.add.text(o.bx + o.bw / 2, o.by + o.bh - 116, `${o.icon} ${o.name}`, labelStyle).setOrigin(0.5, 1).setDepth(3000));
      } else if (o.place === 'teleport') {
        const col = { green: 0x5fd1c8, abyss: 0xb04aff, sky: 0xffd84a }[z.theme];
        keep(this.add.ellipse(o.x, o.y, 92, 46, 0x000000, 0.25).setDepth(1));
        keep(this.add.ellipse(o.x, o.y, 84, 40, 0x8a8f99).setStrokeStyle(3, 0x5a5f68).setDepth(1));
        const ring = keep(this.add.ellipse(o.x, o.y, 64, 30).setStrokeStyle(3, col, 0.9).setDepth(2));
        const glow = keep(this.add.ellipse(o.x, o.y, 50, 22, col, 0.35).setDepth(2));
        glow.setInteractive().on('pointerdown', () => this.goTo(o));
        this.tweens.add({ targets: ring, scaleX: 1.15, scaleY: 1.15, alpha: 0.4, duration: 900, yoyo: true, repeat: -1 });
        this.tweens.add({ targets: glow, alpha: 0.7, duration: 600, yoyo: true, repeat: -1 });
        const beam = keep(this.add.rectangle(o.x, o.y - 30, 30, 60, col, 0.15).setDepth(5));
        this.tweens.add({ targets: beam, alpha: 0.05, duration: 1200, yoyo: true, repeat: -1 });
        keep(this.add.text(o.x, o.y - 30, `${o.icon} ${o.name}`, labelStyle).setOrigin(0.5, 1).setDepth(3000));
      } else if (o.kind === 'portal') {
        const col = o.world ? 0xff3a3a : o.id === 'exit' ? 0x7dff8a : !o.num ? 0xffd36a : PORTAL_COL[(o.num - 1) % 6];
        keep(this.add.ellipse(o.x, o.y + 22, 50, 14, 0x000000, 0.3).setDepth(1));
        // Каменная арка и вращающаяся воронка
        keep(this.add.rectangle(o.x - 24, o.y, 8, 50, 0x6a6560).setDepth(10 + o.y + 20));
        keep(this.add.rectangle(o.x + 24, o.y, 8, 50, 0x6a6560).setDepth(10 + o.y + 20));
        keep(this.add.rectangle(o.x, o.y - 26, 58, 8, 0x5a5550).setDepth(10 + o.y + 20));
        const swirl = keep(this.add.ellipse(o.x, o.y + 2, 38, 46, col, 0.55).setStrokeStyle(3, 0xffffff, 0.7).setDepth(10 + o.y));
        swirl.setInteractive().on('pointerdown', () => this.goTo(o));
        const core = keep(this.add.ellipse(o.x, o.y + 2, 18, 26, 0xffffff, 0.5).setDepth(10 + o.y + 1));
        this.tweens.add({ targets: swirl, scaleX: 0.8, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: core, alpha: 0.15, scale: 1.4, duration: 900, yoyo: true, repeat: -1 });
        const title = !o.num ? `${o.icon} ${o.name}${o.world ? ` · ур. ${o.lv[0]}` : ''}` : `${['I', 'II', 'III', 'IV', 'V', 'VI'][o.num - 1]} · ${o.name} · ур. ${o.lv[0]}–${o.lv[1]}`;
        keep(this.add.text(o.x, o.y - 32, title, { ...labelStyle, fontSize: '10px' }).setOrigin(0.5, 1).setDepth(3000));
      }
    }
    this.nearObj = undefined;
    if (this.layer && this.scale) this.resize();
    this.ui.onZone(z);
  }

  // Раскрыть туман вокруг героя (радиус 7 тайлов)
  revealFog() {
    const z = this.zone;
    if (!this.fogLayer || !this.me) return;
    const tx = Math.floor((this.me.x - z.ox) / this.T), ty = Math.floor((this.me.y - z.oy) / this.T);
    const key = tx * 1000 + ty;
    if (key === this.fogTile) return;
    this.fogTile = key;
    const set = this.explored.get(z.id), R = 7;
    for (let y = ty - R; y <= ty + R; y++) for (let x = tx - R; x <= tx + R; x++) {
      if (x < 0 || y < 0 || x >= z.w || y >= z.h || (x - tx) ** 2 + (y - ty) ** 2 > R * R) continue;
      const i = y * z.w + x;
      if (set.has(i)) continue;
      set.add(i);
      this.fogLayer.removeTileAt(x, y);
    }
  }

  // Тап по зданию/порталу: герой сам идёт к нему (если уже рядом — сразу действие)
  goTo(o) {
    if (!this.me) return;
    if (this.nearObj === o) { this.ui.onNear(o, this.zone, true); return; }
    const path = this.findPath(this.me.x, this.me.y, o.x, o.y + (o.kind === 'portal' ? 20 : 4));
    this.walkTo = path && path.length ? { path, stuck: 0 } : null;
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
  }

  isSolidAt(px, py) {
    const tx = Math.floor((px - this.zone.ox) / this.T), ty = Math.floor((py - this.zone.oy) / this.T);
    if (tx < 0 || ty < 0 || tx >= this.mapW || ty >= this.mapH) return true;
    return this.solid.has(this.tiles[ty * this.mapW + tx]);
  }

  // ---------- Сущности ----------
  makeEntity(texture, name, nameColor, interactiveId) {
    const sprite = this.add.sprite(0, 0, texture);
    const label = this.add.text(0, -26, name, {
      fontSize: '10px', fontFamily: 'Arial', color: nameColor, stroke: '#000', strokeThickness: 3, resolution: 2,
    }).setOrigin(0.5, 1);
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

  // Направление и шаг скина: (vx, vy) — куда идём; moving — идём ли сейчас
  animSkin(e, vx, vy, moving) {
    if (!e.skinOn) return;
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
    // Игроки
    const seen = new Set();
    for (const p of s.p) {
      seen.add(p.id);
      let e = this.players.get(p.id);
      if (!e) {
        const isMe = p.id === this.myId;
        e = this.makeEntity('hero_' + p.hero, `${p.name} [${p.lvl}]`, isMe ? '#ffcc4d' : '#ffffff');
        e.c.setPosition(p.x, p.y);
        this.applySkin(e, p.hero);
        this.players.set(p.id, e);
        if (isMe) {
          this.me = { x: p.x, y: p.y, e, data: p, dir: 1 };
          this.cameras.main.startFollow(e.c, true, 0.15, 0.15);
        }
      }
      e.tx = p.x; e.ty = p.y; e.data = p;
      e.label.setText(`${p.name} [${p.lvl}]`);
      this.setBar(e, p.hp, p.maxHp);
      e.c.setAlpha(p.dead ? 0.35 : 1);
      // Аура усиления (рёв ярости, кровавое безумие)
      if (p.rage && !e.aura) {
        e.aura = this.add.circle(0, 4, 18, 0xff3020, 0.25).setStrokeStyle(2, 0xff6040, 0.8);
        e.c.addAt(e.aura, 0);
        this.tweens.add({ targets: e.aura, scale: 1.25, alpha: 0.5, duration: 300, yoyo: true, repeat: -1 });
      } else if (!p.rage && e.aura) { e.aura.destroy(); e.aura = null; }
      // Пакт с духом (Зу'кра) — цветная аура; Облик древа (Нимуэ) — зелёная
      // ...и стихия Аурелиуса
      const ELEM = { fire: 0xff6a1a, ice: 0x8ad3ff, lightning: 0xffe94a, earth: 0xa07a4a };
      const VOW = { protection: 0x8ad3ff, retribution: 0xffb030, mercy: 0xffd0e0 };
      const SONG = { inspire: 0xffb030, lullaby: 0x8a9aff, mock: 0xff6a9a };
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
      const pst = ({ stun: '💫', freeze: '🧊', root: '🕸️', confuse: '😵' }[p.pcc] || '') + ({ poison: '🧪', bleed: '🩸', burn: '🔥' }[p.pdot] || '') + (p.pslow ? '🐌' : '') + (p.pweak ? '💔' : '');
      if (pst !== (e.pst || '')) {
        e.pst = pst;
        if (!e.pstText) { e.pstText = this.add.text(0, e.label.y - 12, '', { fontSize: '11px', resolution: 2 }).setOrigin(0.5, 1); e.c.add(e.pstText); }
        e.pstText.setText(pst);
      }
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
      if (p.emp && !e.emp) {
        e.emp = this.add.circle(0, 4, 15).setStrokeStyle(2, 0xffd36a, 0.9);
        e.c.addAt(e.emp, 0);
        this.tweens.add({ targets: e.emp, scale: 1.2, duration: 400, yoyo: true, repeat: -1 });
      } else if (!p.emp && e.emp) { e.emp.destroy(); e.emp = null; }
      if (p.id !== this.myId && !e.skinOn) e.sprite.setFlipX(p.dir === -1);
      else this.me.data = p;
      // Смена облика (Талиесин): другой спрайт
      if ((p.form || null) !== (e.form || null)) {
        e.form = p.form || null;
        if (p.form === 'beast') { e.sprite.stop(); e.sprite.setTexture('hero_' + p.hero + '_beast').setOrigin(0.5); e.skinOn = false; } else this.applySkin(e, p.hero);
      }
    }
    for (const [id, e] of this.players) if (!seen.has(id)) { e.c.destroy(); this.players.delete(id); }

    // Монстры
    const seenM = new Set();
    for (const m of s.m) {
      seenM.add(m.id);
      let e = this.monsters.get(m.id);
      if (!e) {
        const def = this.monsterDefs[m.type];
        // Цвет имени по рангу: синий — усиленный, жёлтый — редкий, оранжевый — полубосс, красный — босс, фиолетовый — мировой
        const RC = { normal: '#ffd9a0', summon: '#c8c0b0', magic: '#8ab8ff', rare: '#ffe066', mini: '#ffa040', boss: '#ff5a5a', world: '#d080ff' };
        const prefix = { magic: 'Усиленный ', mini: '★ ', boss: '👑 ', world: '👹 ' }[m.rk] || '';
        e = this.makeEntity('mon_' + m.type, `${prefix}${m.nm || def.name} · ${m.lv}`, RC[m.rk] || '#ffd9a0', m.id);
        e.c.setPosition(m.x, m.y);
        const sz = m.sz || 1;
        e.sprite.setScale(sz);
        if (sz > 1.05) { const up = 16 * (sz - 1); e.label.y -= up; e.bar.y -= up; e.c.list[1].y -= up; e.bar.width = 28 * Math.min(2.2, sz); e.c.list[1].width = 28 * Math.min(2.2, sz); e.bar.x = -e.bar.width / 2; e.c.list[1].x = 0; e.bigBar = e.bar.width; }
        if (m.rk === 'world' || m.rk === 'boss') e.label.setFontSize(12);
        if (m.rk === 'rare' || m.rk === 'magic') { const glow = this.add.circle(0, 6, 16 * sz, m.rk === 'rare' ? 0xffe066 : 0x8ab8ff, 0.18); e.c.addAt(glow, 0); }
        e.c.setAlpha(0);
        this.tweens.add({ targets: e.c, alpha: 1, duration: 400 });
        this.monsters.set(m.id, e);
      }
      if (m.x !== e.tx) e.sprite.setFlipX(m.x < e.tx);
      // Значки состояний: оглушение и ослабление
      const status = (m.st ? '💫' : '') + (m.wk ? '😨' : '') + (m.mk ? '🎯' : '') + (m.sl ? '⛓️' : '') + (m.sw ? '🐌' : '') + (m.tn ? '😡' : '')
        + (m.ws ? '✨' : '') + (m.br ? '💔' : '') + (m.ps ? '🧪' : '') + (m.bn ? '🔥' : '') + (m.bc ? '🩸' : '') + (m.rt ? '🌿' : '') + (m.cf ? '😵' : '') + (m.fr ? '😱' : '') + (m.fz ? '🧊' : '') + (m.mo ? '🤡' : '') + (m.st2 ? '⭐' : '') + (m.ds ? '🔯' : '') + (m.bd ? '⛓' : '') + (m.bl ? '🩸' : '') + (m.ch ? '💘' : '') + (m.cu ? '🕯️' : '') + (m.fs ? '❄️' + m.fs : '') + (m.sn ? '🗿' : m.pf ? '🪨' + m.pf : '');
      if (m.sn) e.sprite.setTint(0x8a8a88); else if (e.stone) e.sprite.clearTint();
      e.stone = !!m.sn;
      if (status !== (e.status || '')) {
        e.status = status;
        if (!e.statusText) {
          e.statusText = this.add.text(0, e.label.y - 12, '', { fontSize: '11px', resolution: 2 }).setOrigin(0.5, 1);
          e.c.add(e.statusText);
        }
        e.statusText.setText(status);
      }
      e.tx = m.x; e.ty = m.y; e.data = m;
      this.setBar(e, m.hp, m.maxHp);
      e.c.setAlpha(m.inv ? 0.18 : 1); // тень в невидимости
      if (!!m.sh !== !!e.shRing) { if (m.sh) { e.shRing = this.add.circle(0, 2, 15 * (m.sz || 1)).setStrokeStyle(2, 0xbfe8ff, 0.9); e.c.add(e.shRing); } else { e.shRing.destroy(); e.shRing = null; } }
    }
    for (const [id, e] of this.monsters) {
      if (!seenM.has(id)) {
        this.monsters.delete(id);
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
        e = this.makeEntity(pt.skin || 'pet_' + pt.kind, pt.label || names[pt.kind], pt.owner === this.myId ? '#c8f0a0' : '#d8d0c0');
        e.skinTint = pt.kind === 'clone' ? 0xffb0e8 : pt.drowned ? 0x5a7aff : pt.kind === 'minion' ? 0x8affc0 : null;
        if (e.skinTint) e.sprite.setTint(e.skinTint);
        if (pt.kind === 'clone') e.sprite.setAlpha(0.65);
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
  floatText(x, y, text, color, size = 14) {
    const t = this.add.text(x, y, text, {
      fontSize: size + 'px', fontFamily: 'Arial', fontStyle: 'bold', color, stroke: '#000', strokeThickness: 3, resolution: 2,
    }).setOrigin(0.5).setDepth(1000);
    this.tweens.add({ targets: t, y: y - 30, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  burst(x, y, color, n = 10) {
    const em = this.add.particles(x, y, 'particle', {
      speed: { min: 40, max: 140 }, lifespan: 450, scale: { start: 1, end: 0 }, tint: color, quantity: n, emitting: false,
    }).setDepth(900);
    em.explode(n);
    this.time.delayedCall(600, () => em.destroy());
  }

  playFx(f) {
    if (f.t === 'hit' && f.kind === 'm') {
      const e = this.monsters.get(f.target);
      const doHit = () => {
        const tgt = this.monsters.get(f.target);
        const x = tgt ? tgt.c.x : f.tx, y = tgt ? tgt.c.y : f.ty;
        // Отражённый урон (возмездие Малакора) — фиолетовым
        this.floatText(x, y - 20, (f.crit ? '💥' : '') + f.dmg, f.reflect ? '#c890ff' : f.crit ? '#ffde3a' : '#ffffff', f.crit ? 18 : 14);
        if (tgt) { tgt.sprite.setTintFill(0xffffff); this.time.delayedCall(80, () => tgt.sprite.clearTint()); }
        const col = f.reflect ? 0xb060ff : f.confused ? 0xff7ad0 : { venom: 0x7ad84a, bolt: 0xffc850, blood: 0xc0101a, arrow: 0xfff6c0, arcane: 0xc8a0ff, note: 0xffe08a, necro: 0x5fffb0, holy: 0xfff0a0, spirit: 0x9ff0ff, shadow: 0xb060ff, darkfire: 0x7a2ab0, leaf: 0x5fd17a,
          illusion: 0xff7ad0, fireball: 0xff8c1a, frost: 0x8ad3ff, spark: 0xffe94a, stone: 0xa07a4a, moon: 0xdfe4ff, water: 0x5ab8ff, sonic: 0x9ff0e0, dark: 0xb04aff, crystal: 0xd8b0ff, sand: 0xe8c878, rune: 0x5fb0ff, soul: 0xbfeaff }[f.proj] || 0xff4040;
        this.burst(x, y, col, 6);
      };
      const attacker = f.pet ? this.pets.get(f.pet) : this.players.get(f.from);
      if (attacker) this.tweens.add({ targets: attacker.sprite, scaleX: 1.2, scaleY: 0.9, duration: 70, yoyo: true });
      if (f.pet && f.proj && f.pfx !== null) {
        // Выстрел турели
        const b = this.add.image(f.pfx, f.pfy - 6, 'proj_' + f.proj).setDepth(800);
        b.rotation = Phaser.Math.Angle.Between(f.pfx, f.pfy, f.tx, f.ty);
        this.tweens.add({ targets: b, x: f.tx, y: f.ty, duration: 160, onComplete: () => { b.destroy(); doHit(); } });
      } else if (!f.basic) {
        doHit();
      } else if (f.proj) {
        const p = this.add.image(f.fx, f.fy, 'proj_' + f.proj).setDepth(800);
        const tx = e ? e.c.x : f.tx, ty = e ? e.c.y : f.ty;
        p.rotation = Phaser.Math.Angle.Between(f.fx, f.fy, tx, ty);
        const dur = Phaser.Math.Distance.Between(f.fx, f.fy, tx, ty) * 1.4;
        this.tweens.add({ targets: p, x: tx, y: ty, duration: dur, onComplete: () => { p.destroy(); doHit(); } });
      } else {
        // Взмах меча
        const slash = this.add.arc(f.tx, f.ty, 16, 200, 340, false).setStrokeStyle(3, 0xffffff).setDepth(800);
        this.tweens.add({ targets: slash, alpha: 0, scale: 1.6, duration: 200, onComplete: () => slash.destroy() });
        doHit();
      }
    } else if (f.t === 'hit' && f.kind === 'p') {
      const e = this.players.get(f.target);
      if (!e) return;
      this.floatText(e.c.x, e.c.y - 20, '-' + f.dmg, '#ff5a5a');
      e.sprite.setTint(0xff6060); this.time.delayedCall(120, () => e.sprite.clearTint());
      const m = this.monsters.get(f.from);
      if (m) this.tweens.add({ targets: m.sprite, x: Math.sign(e.c.x - m.c.x) * 6, duration: 80, yoyo: true });
      if (f.target === this.myId) { this.cameras.main.shake(100, 0.004); this.ui.vibrate('light'); }
    } else if (f.t === 'death') {
      this.burst(f.x, f.y, 0xffe08a, 16);
      if (f.by === this.myId) {
        if (f.contract) this.floatText(f.x, f.y - 52, 'Контракт выполнен!', '#ffcc4d', 14);
        this.floatText(f.x, f.y - 34, `+${f.xp} XP`, '#8ad3ff', 13);
        this.floatText(f.x, f.y - 18, `+${f.gold} 💰`, '#ffcc4d', 12);
        this.ui.vibrate('medium');
      }
    } else if (f.t === 'levelup') {
      const ring = this.add.circle(f.x, f.y, 10).setStrokeStyle(4, 0xffcc4d).setDepth(900);
      this.tweens.add({ targets: ring, scale: 5, alpha: 0, duration: 800, onComplete: () => ring.destroy() });
      this.floatText(f.x, f.y - 40, `Уровень ${f.lvl}!`, '#ffcc4d', 18);
      this.burst(f.x, f.y, 0xffcc4d, 24);
      if (f.id === this.myId) this.ui.vibrate('success');
    } else if (f.t === 'hit' && f.kind === 'pet') {
      const e = this.pets.get(f.target);
      if (e) {
        this.floatText(e.c.x, e.c.y - 16, '-' + f.dmg, '#ff9a7a', 11);
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
    } else if (f.t === 'loot') {
      // Выпавший предмет: название цветом редкости
      this.floatText(f.x, f.y - 46, f.name, f.color, 13);
      this.burst(f.x, f.y, parseInt(f.color.slice(1), 16), 14);
      if (f.to === this.myId) this.ui.vibrate('success');
    } else if (f.t === 'tele') {
      // Предупреждение об ударе по площади: круг наполняется, пока не ударит
      const ring = this.add.circle(f.x, f.y, f.r).setStrokeStyle(2, f.color, 0.9).setDepth(5).setScale(1, 0.55);
      const fill = this.add.circle(f.x, f.y, f.r, f.color, 0.28).setDepth(5).setScale(0.05, 0.03);
      this.tweens.add({ targets: fill, scaleX: 1, scaleY: 0.55, duration: f.ms, onComplete: () => { ring.destroy(); fill.destroy(); } });
      if (f.label) this.floatText(f.x, f.y - f.r * 0.55 - 10, f.label, '#ffd0a0', 12);
    } else if (f.t === 'teleHit') {
      const fl = this.add.circle(f.x, f.y, f.r, f.color, 0.5).setDepth(830).setScale(1, 0.55);
      this.tweens.add({ targets: fl, alpha: 0, duration: 350, onComplete: () => fl.destroy() });
      this.burst(f.x, f.y, f.color, 14);
      if (this.me && Math.hypot(this.me.x - f.x, this.me.y - f.y) < f.r) this.cameras.main.shake(140, 0.006);
    } else if (f.t === 'mshot') {
      const key = this.textures.exists('proj_' + f.proj) ? 'proj_' + f.proj : 'proj_arrow';
      const pr = this.add.image(f.fx, f.fy, key).setDepth(860).setScale(1.2);
      pr.rotation = Phaser.Math.Angle.Between(f.fx, f.fy, f.x, f.y);
      if (key === 'proj_arrow' || key === 'proj_bolt') pr.setTint(0xffa0a0);
      this.tweens.add({ targets: pr, x: f.x, y: f.y, duration: f.ms, onComplete: () => pr.destroy() });
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
    if (sk) this.floatText(caster.c.x, caster.c.y - 44, sk.icon + ' ' + sk.name, '#ffe08a', 12);
    if (f.from === this.myId && !f.quiet) this.ui.vibrate('medium');
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
    if (cur && Phaser.Math.Distance.Between(me.x, me.y, cur.c.x, cur.c.y) <= range + 120) return cur;
    let best = null, bestD = range + 60;
    for (const [id, e] of this.monsters) {
      const d = Phaser.Math.Distance.Between(me.x, me.y, e.c.x, e.c.y);
      if (d < bestD) { best = e; bestD = d; }
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
  }

  update(time, delta) {
    const dt = delta / 1000;
    // Интерполяция чужих сущностей
    const k = Math.min(1, dt * 12);
    for (const [id, e] of this.players) {
      if (id === this.myId) continue;
      const mx = e.tx - e.c.x, my = e.ty - e.c.y;
      e.c.x += mx * k; e.c.y += my * k;
      if (e.skinOn) {
        const moving = Math.hypot(mx, my) > 1.5;
        this.animSkin(e, moving ? mx : 0, moving ? my : 0, moving);
      }
    }
    for (const e of this.monsters.values()) { e.c.x += (e.tx - e.c.x) * k; e.c.y += (e.ty - e.c.y) * k; }
    for (const e of this.pets.values()) {
      e.c.x += (e.tx - e.c.x) * k; e.c.y += (e.ty - e.c.y) * k;
      e.c.setDepth(10 + e.c.y);
      if (e.data && e.data.kind === 'hawk') e.sprite.y = -10 + Math.sin(time / 180) * 3; // сокол парит
    }

    const me = this.me;
    if (!me) return;

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
      if (Math.hypot(dx, dy) < 8) { this.walkTo.path.shift(); if (!this.walkTo.path.length) this.walkTo = null; }
      if (++(this.walkTo || {}).stuck > 1500) this.walkTo = null;
      if (this.walkTo) { vx = dx; vy = dy; }
    } else if (this.autoWalk) {
      const t = this.monsters.get(this.autoWalk);
      if (t) { vx = t.c.x - me.x; vy = t.c.y - me.y; } else this.autoWalk = null;
    }
    // Контроль от монстров: оглушение/заморозка/паутина — стоим; подчинение — управление наоборот
    const cc = this.myStats.cc;
    if (cc === 'confuse') { vx = -vx; vy = -vy; }
    const held = cc === 'stun' || cc === 'freeze' || cc === 'root';
    const len = Math.hypot(vx, vy);
    if (len > 0 && !me.data.dead && !this.myStats.rooted && !held) {
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
    const walking = len > 0 && !me.data.dead && !this.myStats.rooted && !held;
    if (me.e.skinOn) this.animSkin(me.e, walking ? vx : 0, walking ? vy : 0, walking);
    else {
      me.e.sprite.setFlipX(me.dir === -1);
      // Лёгкая «походка»
      me.e.sprite.y = len > 0 ? Math.sin(time / 70) * 1.5 : 0;
    }

    if (time - this.lastSend > 66) {
      this.lastSend = time;
      if (me.sentX !== me.x || me.sentY !== me.y) {
        me.sentX = me.x; me.sentY = me.y;
        this.net.emit('move', { x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, dir: me.dir });
      }
    }

    if (this.input_.attack || this.keys.SPACE.isDown || this.autoWalk) this.tryAttack(false);
    // Умения: кнопки HUD или клавиши Q / E / R
    const skills = this.heroes[me.data.hero].skills;
    let skillId = this.input_.skill;
    ['Q', 'E', 'R'].forEach((k, i) => { if (skills[i] && Phaser.Input.Keyboard.JustDown(this.keys[k])) skillId = skills[i].id; });
    if (skillId) {
      this.input_.skill = null;
      if (!me.data.dead) {
        const t = this.findTarget();
        this.net.emit('skill', { id: skillId, targetId: t ? t.data.id : null });
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
