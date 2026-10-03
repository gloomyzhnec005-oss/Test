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
    Object.entries(this.heroes).forEach(([k, h]) => addTex('hero_' + k, Gfx.hero(h.look)));
    Object.keys(this.monsterDefs).forEach((k) => addTex('mon_' + k, Gfx.monster(k)));
    addTex('totem', Gfx.totem());
    ['wolf', 'bear', 'hawk'].forEach((k) => addTex('pet_' + k, Gfx.pet(k)));
    this.totems = new Map();
    this.pets = new Map();
    ['stone', 'spirit', 'spear', 'dagger', 'shadow'].forEach((k) => addTex('proj_' + k, Gfx.projectile(k)));
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
      // Дымовая завеса: полупрозрачность
      e.sprite.setAlpha(p.smoke ? 0.45 : 1);
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
      const status = (m.st ? '💫' : '') + (m.wk ? '😨' : '') + (m.mk ? '🎯' : '') + (m.sl ? '⛓️' : '');
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
        const names = { wolf: 'Клык', bear: 'Бурый', hawk: 'Сокол' };
        e = this.makeEntity('pet_' + pt.kind, names[pt.kind], pt.owner === this.myId ? '#c8f0a0' : '#d8d0c0');
        e.c.setPosition(pt.x, pt.y);
        e.label.setFontSize(8);
        e.c.setScale(0.85);
        this.pets.set(pt.id, e);
      }
      if (pt.x !== e.tx) e.sprite.setFlipX(pt.x < e.tx);
      e.tx = pt.x; e.ty = pt.y; e.data = pt;
      this.setBar(e, pt.hp, pt.maxHp);
      e.c.setAlpha(pt.down ? 0.45 : 1);
      e.label.setText(pt.down ? '💤' : { wolf: 'Клык', bear: 'Бурый', hawk: 'Сокол' }[pt.kind]);
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
        const area = this.add.circle(t.x, t.y, t.r, 0x3fe08a, 0.08).setStrokeStyle(2, 0x3fe08a, 0.5).setDepth(1).setScale(1, 0.5);
        const img = this.add.image(t.x, t.y, 'totem').setOrigin(0.5, 0.95).setDepth(10 + t.y);
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
        const col = f.reflect ? 0xb060ff : { spirit: 0x9ff0ff, shadow: 0xb060ff }[f.proj] || 0xff4040;
        this.burst(x, y, col, 6);
      };
      const attacker = f.pet ? this.pets.get(f.pet) : this.players.get(f.from);
      if (attacker) this.tweens.add({ targets: attacker.sprite, scaleX: 1.2, scaleY: 0.9, duration: 70, yoyo: true });
      if (!f.basic) {
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
      if (e) { this.floatText(e.c.x, e.c.y - 16, '-' + f.dmg, '#ff9a7a', 11); e.sprite.setTint(0xff6060); this.time.delayedCall(120, () => e.sprite.clearTint()); }
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
          arcG.lineStyle(5, 0xc0301e, 0.85).beginPath().arc(x, y, f.r * 0.8, a, a + 2.2).strokePath();
          arcG.lineStyle(3, 0xffb0a0, 0.7).beginPath().arc(x, y, f.r * 0.6, a + Math.PI, a + Math.PI + 1.8).strokePath();
          if (ev.getRepeatCount() === 0) arcG.destroy();
        } });
        this.time.delayedCall(220, () => this.burst(f.x, f.y, 0xc0301e, 14));
        this.time.delayedCall(440, () => this.burst(f.x, f.y, 0xc0301e, 14));
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

  // ---------- Бой ----------
  findTarget() {
    const me = this.me;
    const range = this.heroes[me.data.hero].range;
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
    const hero = this.heroes[me.data.hero];
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
      const speed = this.heroes[me.data.hero].speed;
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
