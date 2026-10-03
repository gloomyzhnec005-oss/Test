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

  create() {
    const { map } = this.welcome;
    const T = this.T;

    // Текстуры
    const addTex = (key, cnv) => { if (!this.textures.exists(key)) this.textures.addCanvas(key, cnv); };
    addTex('tiles', Gfx.tileset());
    Object.entries(this.heroes).forEach(([k, h]) => {
      addTex('hero_' + k, Gfx.hero(h.look));
      if (h.forms) addTex('hero_' + k + '_beast', Gfx.werebeast(h.beastLook)); // звериный облик
    });
    Object.keys(this.monsterDefs).forEach((k) => addTex('mon_' + k, Gfx.monster(k)));
    addTex('totem', Gfx.totem());
    ['wolf', 'bear', 'hawk', 'skeleton', 'sprite', 'turret'].forEach((k) => addTex('pet_' + k, Gfx.pet(k)));
    this.totems = new Map();
    this.pets = new Map();
    ['stone', 'spirit', 'spear', 'dagger', 'shadow', 'darkfire', 'leaf', 'illusion', 'fireball', 'frost', 'spark', 'holy', 'note', 'necro', 'arrow', 'arcane', 'bolt', 'blood'].forEach((k) => addTex('proj_' + k, Gfx.projectile(k)));
    addTex('particle', Gfx.particle());

    // Тайловая карта
    const data2d = [];
    for (let y = 0; y < map.h; y++) data2d.push(map.tiles.slice(y * map.w, (y + 1) * map.w));
    const tm = this.make.tilemap({ data: data2d, tileWidth: T, tileHeight: T });
    const ts = tm.addTilesetImage('tiles', 'tiles', T, T, 0, 0);
    tm.createLayer(0, ts, 0, 0).setDepth(0);
    this.solid = new Set(map.solid);
    this.mapW = map.w; this.mapH = map.h; this.tiles = map.tiles;

    this.cameras.main.setBounds(0, 0, map.w * T, map.h * T);
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
    this.net.on('correct', (d) => {
      if (!this.me) return;
      this.me.x = d.x; this.me.y = d.y;
      if (d.respawn) this.ui.onRespawn();
    });

    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,Q,E,R');
  }

  resize() {
    const w = this.scale.width, h = this.scale.height;
    // На телефоне показываем примерно 11-13 тайлов по короткой стороне
    const zoom = Phaser.Math.Clamp(Math.min(w, h) / (12 * this.T), 1, 3);
    this.cameras.main.setZoom(zoom);
  }

  isSolidAt(px, py) {
    const tx = Math.floor(px / this.T), ty = Math.floor(py / this.T);
    if (tx < 0 || ty < 0 || tx >= this.mapW || ty >= this.mapH) return true;
    return this.solid.has(this.tiles[ty * this.mapW + tx]);
  }

  // ---------- Сущности ----------
  makeEntity(texture, name, nameColor, interactiveId) {
    const sprite = this.add.image(0, 0, texture);
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

  setBar(e, hp, maxHp) {
    const k = Phaser.Math.Clamp(hp / maxHp, 0, 1);
    e.bar.width = 28 * k;
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
        : p.bless ? 0xfff0a0 : p.vow ? VOW[p.vow] : p.song ? SONG[p.song] : null;
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
      if (p.id !== this.myId) e.sprite.setFlipX(p.dir === -1);
      else this.me.data = p;
      // Смена облика (Талиесин): другой спрайт
      if ((p.form || null) !== (e.form || null)) {
        e.form = p.form || null;
        e.sprite.setTexture(p.form === 'beast' ? 'hero_' + p.hero + '_beast' : 'hero_' + p.hero);
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
        e = this.makeEntity('mon_' + m.type, def.name, def.boss ? '#ff6b6b' : '#ffd9a0', m.id);
        e.c.setPosition(m.x, m.y);
        if (def.boss) { e.label.y = -34; e.bar.y = e.bar.y - 8; e.c.list[1].y -= 8; }
        e.c.setAlpha(0);
        this.tweens.add({ targets: e.c, alpha: 1, duration: 400 });
        this.monsters.set(m.id, e);
      }
      if (m.x !== e.tx) e.sprite.setFlipX(m.x < e.tx);
      // Значки состояний: оглушение и ослабление
      const status = (m.st ? '💫' : '') + (m.wk ? '😨' : '') + (m.mk ? '🎯' : '') + (m.sl ? '⛓️' : '') + (m.sw ? '🐌' : '') + (m.tn ? '😡' : '')
        + (m.ws ? '✨' : '') + (m.br ? '💔' : '') + (m.ps ? '🧪' : '') + (m.bn ? '🔥' : '') + (m.bc ? '🩸' : '') + (m.rt ? '🌿' : '') + (m.cf ? '😵' : '') + (m.fr ? '😱' : '') + (m.fz ? '🧊' : '') + (m.mo ? '🤡' : '') + (m.st2 ? '⭐' : '') + (m.bd ? '⛓' : '') + (m.bl ? '🩸' : '');
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
        const names = { wolf: 'Клык', bear: 'Бурый', hawk: 'Сокол', skeleton: 'Слуга', sprite: 'Дух леса', clone: 'Двойник', turret: 'Турель' };
        // Двойник рисуется спрайтом героя (розовый, полупрозрачный), поднятый монстр — своим спрайтом (зелёный)
        e = this.makeEntity(pt.skin || 'pet_' + pt.kind, pt.label || names[pt.kind], pt.owner === this.myId ? '#c8f0a0' : '#d8d0c0');
        e.skinTint = pt.kind === 'clone' ? 0xffb0e8 : pt.kind === 'minion' ? 0x8affc0 : null;
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
      e.label.setText(pt.down ? '💤' : pt.label || { wolf: 'Клык', bear: 'Бурый', hawk: 'Сокол', skeleton: 'Слуга', sprite: 'Дух леса', clone: 'Двойник', turret: 'Турель' }[pt.kind]);
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
        const col = f.reflect ? 0xb060ff : f.confused ? 0xff7ad0 : { bolt: 0xffc850, blood: 0xc0101a, arrow: 0xfff6c0, arcane: 0xc8a0ff, note: 0xffe08a, necro: 0x5fffb0, holy: 0xfff0a0, spirit: 0x9ff0ff, shadow: 0xb060ff, darkfire: 0x7a2ab0, leaf: 0x5fd17a,
          illusion: 0xff7ad0, fireball: 0xff8c1a, frost: 0x8ad3ff, spark: 0xffe94a, stone: 0xa07a4a }[f.proj] || 0xff4040;
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
    } else if (f.t === 'dodge') {
      const e = this.players.get(f.target);
      if (e) this.floatText(e.c.x, e.c.y - 22, 'Уклонение', '#c8d8e8', 11);
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
    this.net.emit('attack', { targetId: t.data.id });
  }

  update(time, delta) {
    const dt = delta / 1000;
    // Интерполяция чужих сущностей
    const k = Math.min(1, dt * 12);
    for (const [id, e] of this.players) {
      if (id === this.myId) continue;
      e.c.x += (e.tx - e.c.x) * k; e.c.y += (e.ty - e.c.y) * k;
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
    if (vx || vy) this.autoWalk = null;
    else if (this.autoWalk) {
      const t = this.monsters.get(this.autoWalk);
      if (t) { vx = t.c.x - me.x; vy = t.c.y - me.y; } else this.autoWalk = null;
    }
    const len = Math.hypot(vx, vy);
    if (len > 0 && !me.data.dead) {
      const n = Math.min(1, len) / len;
      const speed = this.prof().speed * (this.myStats.haste ? 1.25 : 1) * (this.myStats.flyBoost || 1); // свет ветра, полёт
      const dx = vx * n * speed * dt, dy = vy * n * speed * dt;
      const r = 10;
      if (!this.isSolidAt(me.x + dx + Math.sign(dx) * r, me.y)) me.x += dx;
      if (!this.isSolidAt(me.x, me.y + dy + Math.sign(dy) * r)) me.y += dy;
      if (Math.abs(vx) > 0.1) me.dir = vx < 0 ? -1 : 1;
    }
    me.e.c.setPosition(me.x, me.y);
    me.e.sprite.setFlipX(me.dir === -1);
    // Лёгкая «походка»
    me.e.sprite.y = len > 0 ? Math.sin(time / 70) * 1.5 : 0;

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
      this.ui.onTarget(this.monsterDefs[t.data.type].name, t.data.hp, t.data.maxHp);
    } else {
      this.targetRing.setVisible(false);
      this.ui.onTarget(null);
    }
  }
};
