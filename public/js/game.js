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
    this.classes = data.welcome.classes;
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
    Object.entries(this.classes).forEach(([k, c]) => addTex('hero_' + k, Gfx.hero(k, c.color)));
    Object.keys(this.monsterDefs).forEach((k) => addTex('mon_' + k, Gfx.monster(k)));
    addTex('proj_fireball', Gfx.projectile('fireball'));
    addTex('proj_arrow', Gfx.projectile('arrow'));
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
    this.net.on('correct', (d) => {
      if (!this.me) return;
      this.me.x = d.x; this.me.y = d.y;
      if (d.respawn) this.ui.onRespawn();
    });

    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE');
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
        e = this.makeEntity('hero_' + p.cls, `${p.name} [${p.lvl}]`, isMe ? '#ffcc4d' : '#ffffff');
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
      if (p.id !== this.myId) e.sprite.setFlipX(p.dir === -1);
      else this.me.data = p;
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
        this.floatText(x, y - 20, (f.crit ? '💥' : '') + f.dmg, f.crit ? '#ffde3a' : '#ffffff', f.crit ? 18 : 14);
        if (tgt) { tgt.sprite.setTintFill(0xffffff); this.time.delayedCall(80, () => tgt.sprite.clearTint()); }
        this.burst(x, y, f.proj === 'fireball' ? 0xff8c1a : 0xff4040, 6);
      };
      const attacker = this.players.get(f.from);
      if (attacker) this.tweens.add({ targets: attacker.sprite, scaleX: 1.2, scaleY: 0.9, duration: 70, yoyo: true });
      if (f.proj) {
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
    } else if (f.t === 'pdeath' && f.target === this.myId) {
      this.ui.onDeath();
    }
  }

  // ---------- Бой ----------
  findTarget() {
    const me = this.me;
    const range = this.classes[me.data.cls].range;
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
    const cls = this.classes[me.data.cls];
    const now = this.time.now;
    if (now - this.lastAttack < cls.cooldown) return;
    const t = this.findTarget();
    if (!t) return;
    const d = Phaser.Math.Distance.Between(me.x, me.y, t.c.x, t.c.y);
    if (d > cls.range) {
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
      const speed = this.classes[me.data.cls].speed;
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
