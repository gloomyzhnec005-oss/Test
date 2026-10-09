// Эффекты боя для героев с нарисованными скинами: анимация ударов и умений.
// Вызывается из GameScene: HeroFx.attack(...) на обычный удар, HeroFx.skill(...) на умение.
// Возвращает true, если эффект нарисован здесь (тогда стандартный эффект не рисуется).
window.HeroFx = (() => {
  const TAU = Math.PI * 2;

  // ---------- Общие приёмы ----------
  // Серп удара: дуга «прорисовывается» по ходу взмаха и гаснет с хвоста
  function slash(sc, x, y, ang, o = {}) {
    const r = o.r || 36, w = o.w || 7, sweep = o.sweep || 2.6, dur = o.dur || 220;
    const dir = o.flip ? -1 : 1;
    const a0 = ang - (sweep / 2) * dir;
    const g = sc.add.graphics({ x, y }).setDepth(o.depth || 9060).setScale(1, o.flat ?? 0.62);
    const draw = (t) => {
      g.clear();
      const head = a0 + sweep * dir * Math.min(1, t * 1.5);
      const tail = a0 + sweep * dir * Math.max(0, (t - 0.25) * 1.35);
      if (Math.abs(head - tail) < 0.02) return;
      const [s, e] = dir > 0 ? [tail, head] : [head, tail];
      const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      g.lineStyle(w * 2.6, o.glow ?? o.col, 0.18 * fade); g.beginPath(); g.arc(0, 0, r, s, e); g.strokePath();
      g.lineStyle(w, o.col, 0.9 * fade); g.beginPath(); g.arc(0, 0, r, s, e); g.strokePath();
      g.lineStyle(Math.max(1.5, w * 0.35), o.edge ?? 0xffffff, fade); g.beginPath(); g.arc(0, 0, r + w * 0.35, s, e); g.strokePath();
    };
    sc.tweens.addCounter({ from: 0, to: 1, duration: dur, onUpdate: (tw) => draw(tw.getValue()), onComplete: () => g.destroy() });
    return g;
  }
  // Кольцо на земле (в перспективе)
  function shock(sc, x, y, r, col, o = {}) {
    const c = sc.add.ellipse(x, y, r * 2, r * 2 * (o.flat ?? 0.5)).setStrokeStyle(o.w || 4, col, o.a ?? 0.95).setDepth(o.depth || 830).setScale(o.from ?? 0.15);
    if (o.fill !== undefined) c.setFillStyle(o.fill, o.fillA ?? 0.25);
    sc.tweens.add({ targets: c, scale: 1, alpha: 0, duration: o.dur || 450, ease: 'Cubic.easeOut', delay: o.delay || 0, onComplete: () => c.destroy() });
  }
  // Вспышка
  function flash(sc, x, y, r, col, dur = 260, a = 0.85) {
    const c = sc.add.circle(x, y, r, col, a).setDepth(9870).setScale(0.3).setBlendMode(Phaser.BlendModes.ADD);
    sc.tweens.add({ targets: c, scale: 1, alpha: 0, duration: dur, ease: 'Cubic.easeOut', onComplete: () => c.destroy() });
  }
  // Лучи из точки
  function rays(sc, x, y, n, len, col, o = {}) {
    const g = sc.add.graphics({ x, y }).setDepth(9865).setBlendMode(Phaser.BlendModes.ADD);
    const off = Math.random() * TAU;
    sc.tweens.addCounter({ from: 0, to: 1, duration: o.dur || 380, ease: 'Cubic.easeOut', onUpdate: (tw) => {
      const t = tw.getValue();
      g.clear();
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * TAU, l = len * (i % 2 ? 0.6 : 1);
        g.lineStyle(o.w || 3, col, 1 - t);
        g.lineBetween(Math.cos(a) * l * t * 0.3, Math.sin(a) * l * t * 0.3 * 0.7, Math.cos(a) * l * t, Math.sin(a) * l * t * 0.7);
      }
    }, onComplete: () => g.destroy() });
  }
  // Искры
  function sparks(sc, x, y, col, n = 12, o = {}) {
    const em = sc.add.particles(x, y, 'particle', {
      speed: { min: o.min || 60, max: o.max || 220 }, lifespan: o.life || 500, scale: { start: o.size || 1.4, end: 0 },
      tint: col, quantity: n, emitting: false, gravityY: o.gravity || 0, blendMode: 'ADD', angle: o.angle || { min: 0, max: 360 },
    }).setDepth(9880);
    em.explode(n);
    sc.time.delayedCall((o.life || 500) + 150, () => em.destroy());
  }
  // Рывок спрайта к цели и обратно
  function lunge(sc, e, dx, dy, dist = 9, dur = 75) {
    const l = Math.hypot(dx, dy) || 1;
    sc.tweens.killTweensOf(e.sprite);
    e.sprite.x = 0; e.sprite.y = 0;
    sc.tweens.add({ targets: e.sprite, x: (dx / l) * dist, y: (dy / l) * dist * 0.7, duration: dur, yoyo: true, ease: 'Quad.easeOut' });
  }
  // Остаточный образ героя (призрачная копия текущего кадра)
  function afterimage(sc, e, col, a = 0.55, dur = 300) {
    const s = e.sprite;
    const img = sc.add.image(e.c.x + s.x, e.c.y + s.y, s.texture.key, s.frame.name)
      .setOrigin(s.originX, s.originY).setScale(s.scaleX, s.scaleY).setFlipX(s.flipX).setTintFill(col).setAlpha(a).setDepth(e.c.depth - 1)
      .setBlendMode(Phaser.BlendModes.ADD);
    sc.tweens.add({ targets: img, alpha: 0, scale: s.scaleX * 1.15, duration: dur, onComplete: () => img.destroy() });
  }
  // Повернуть героя со скином лицом к точке
  function face(e, x, y) {
    if (!e.skinOn || !window.Skins) return;
    e.row = Skins.rowFor(x - e.c.x, y - e.c.y);
    if (!e.sprite.anims.isPlaying) e.sprite.setFrame(e.row * Skins.get(e.skin).frames);
  }
  // Знак на земле: вращается в своей плоскости, а сама плоскость сплюснута перспективой
  function groundSign(sc, x, y, depth) {
    const g = sc.add.graphics();
    const plane = sc.add.container(x, y, [g]).setDepth(depth).setScale(1, 0.5);
    return { g, plane };
  }
  // ---------- Нарисованные кадры атаки и эффекты (Skins.LIST[id].attack / .fx) ----------
  const hasFx = (sc, id, name) => sc.anims.exists(`fx_${id}_${name}`);
  const hasAttack = (sc, id) => sc.anims.exists(`atk_${id}_0`);
  // Проиграть кадры удара героя: по направлению к точке или позу умения (cast)
  function heroAnim(sc, e, x, y, cast = false) {
    if (!e || !e.skinOn || !hasAttack(sc, e.skin)) return false;
    const sk = Skins.get(e.skin), A = sk.attack;
    if (x !== undefined) e.row = Skins.rowFor(x - e.c.x, y - e.c.y);
    const [row, flip] = cast ? [A.cast ?? 5, false] : Skins.attackRow(e.row || 0);
    const s = e.sprite;
    sc.tweens.killTweensOf(s); s.x = 0; s.y = 0;
    e.attacking = true;
    s.stop();
    s.setTexture('atk_' + e.skin, row * A.frames).setOrigin(0.5, (A.h - 15) / A.h).setFlipX(flip);
    s.play(`atk_${e.skin}_${row}`);
    s.once('animationcomplete', () => {
      e.attacking = false;
      if (!e.skinOn) return;
      s.setTexture('skin_' + e.skin, (e.row || 0) * sk.frames).setOrigin(0.5, (sk.h - 15) / sk.h).setFlipX(false);
    });
    return true;
  }
  // Нарисованный эффект в точке: проигрывается один раз и исчезает
  function fxPlay(sc, id, name, x, y, o = {}) {
    if (!hasFx(sc, id, name)) return null;
    const sp = sc.add.sprite(x, y, 'fx_' + id).setDepth(o.depth || 9100).setScale(o.scale || 1).setRotation(o.rot || 0)
      .setFlipY(!!o.flipY).setBlendMode(o.solid ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD); // solid — камни и тёмные части видны
    if (o.origin) sp.setOrigin(...o.origin);
    sp.play({ key: `fx_${id}_${name}`, repeat: o.repeat || 0 });
    if (o.follow) sc.events.on('update', function follow() { if (!sp.active || !o.follow.c.active) return sc.events.off('update', follow); sp.setPosition(o.follow.c.x, o.follow.c.y + (o.dy || 0)); });
    sp.once('animationcomplete', () => sp.destroy());
    if (o.to) sc.tweens.add({ targets: sp, x: o.to.x, y: o.to.y, duration: o.dur || 380, ease: 'Cubic.easeOut' });
    return sp;
  }
  // Аура усиления под героем (зацикленная)
  function auraSprite(sc, e) {
    const sp = sc.add.sprite(0, -4, 'fx_' + e.skin).setScale(0.75).setAlpha(0.9).setBlendMode(Phaser.BlendModes.ADD);
    sp.play(`fx_${e.skin}_aura`);
    e.c.addAt(sp, 0);
    return sp;
  }

  const shake = (sc, f, ms, k) => { if (f.from === sc.myId) sc.cameras.main.shake(ms, k); };
  const casterOf = (sc, f) => sc.players.get(f.from);

  // ---------- Обычные удары ----------
  const ATTACK = {
    // Бохай: серия ударов посохом — два взмаха в разные стороны и третий тычок с вихрем ци
    bohai(sc, a, x, y, f) {
      a.combo = ((a.combo || 0) + 1) % 3;
      const ang = Math.atan2(y - a.c.y, x - a.c.x), dist = Math.hypot(x - a.c.x, y - a.c.y);
      // Нарисованный удар посохом: кадры атаки + серп удара + вспышка попадания
      if (heroAnim(sc, a, x, y)) {
        const k = Math.min(1, 26 / (dist || 1));
        sc.time.delayedCall(90, () => fxPlay(sc, 'bohai', 'slash', a.c.x + (x - a.c.x) * (1 - k) * 0.6, a.c.y - 10 + (y - a.c.y) * (1 - k) * 0.6,
          { rot: ang, scale: a.combo === 2 ? 1 : 0.8, flipY: a.combo === 1 }));
        sc.time.delayedCall(140, () => {
          fxPlay(sc, 'bohai', 'hit', x, y - 8, { scale: a.combo === 2 ? 1.1 : 0.75 });
          if (a.combo === 2) { shock(sc, x, y + 4, 30, 0xffc850, { w: 3, dur: 380 }); shake(sc, f, 70, 0.003); }
        });
        return true;
      }
      lunge(sc, a, x - a.c.x, y - a.c.y, a.combo === 2 ? 14 : 9);
      if (a.combo < 2) {
        slash(sc, a.c.x, a.c.y - 8, ang, { r: Math.max(32, Math.min(48, dist * 0.9)), w: 8, sweep: 2.7, col: 0xff9a2a, edge: 0xfff2c0, glow: 0xffc850, flip: a.combo === 1, dur: 200 });
        sparks(sc, x, y - 6, [0xffc850, 0xff8a1a], 8, { max: 160, life: 350 });
      } else {
        afterimage(sc, a, 0xffb040, 0.5, 260);
        const g = sc.add.graphics().setDepth(9862).setBlendMode(Phaser.BlendModes.ADD);
        g.lineStyle(10, 0xffc850, 0.35).lineBetween(a.c.x, a.c.y - 8, x, y - 6);
        g.lineStyle(4, 0xfff2c0, 1).lineBetween(a.c.x, a.c.y - 8, x, y - 6);
        sc.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });
        flash(sc, x, y - 6, 22, 0xffd36a, 240);
        shock(sc, x, y + 4, 30, 0xffc850, { w: 3, dur: 380 });
        sparks(sc, x, y - 6, [0xfff2c0, 0xffc850, 0x46d6c8], 14, { max: 240, life: 420 });
        shake(sc, f, 70, 0.003);
      }
      return true;
    },
    // Морвен: тяжёлый взмах тёмного меча — чёрно-багровый серп и тлеющие искры тьмы
    morvenKnight(sc, a, x, y, f) {
      a.combo = ((a.combo || 0) + 1) % 2;
      const ang = Math.atan2(y - a.c.y, x - a.c.x), dist = Math.hypot(x - a.c.x, y - a.c.y);
      lunge(sc, a, x - a.c.x, y - a.c.y, 11, 90);
      slash(sc, a.c.x, a.c.y - 10, ang, { r: Math.max(32, Math.min(50, dist * 0.9)), w: 9, sweep: 2.9, col: 0x2a0a1a, edge: 0xff3a4a, glow: 0x9b1a3a, flip: a.combo === 1, dur: 260 });
      sparks(sc, x, y - 6, [0xff3a4a, 0x9b4dff, 0x3a0a2a], 10, { max: 180, life: 420, gravity: -120 });
      flash(sc, x, y - 6, 16, 0xff3a4a, 200, 0.5);
      if (f.crit) { shock(sc, x, y + 4, 34, 0xff3a4a, { w: 4 }); shake(sc, f, 90, 0.005); }
      return true;
    },
  };
  // Удар по нарисованным листам для героев без собственной функции: кадры атаки + серп + вспышка
  function sheetAttack(sc, a, x, y, f) {
    if (!heroAnim(sc, a, x, y)) {
      if (!hasFx(sc, a.skin, 'slash')) return false;
      lunge(sc, a, x - a.c.x, y - a.c.y, 12, 80); // кадров атаки нет — рывок к цели
    }
    a.combo = ((a.combo || 0) + 1) % 2;
    const ang = Math.atan2(y - a.c.y, x - a.c.x);
    sc.time.delayedCall(90, () => fxPlay(sc, a.skin, 'slash', (a.c.x + x) / 2, (a.c.y + y) / 2 - 10, { rot: ang, scale: 0.9, flipY: a.combo === 1 }));
    sc.time.delayedCall(140, () => {
      fxPlay(sc, a.skin, 'hit', x, y - 8, { scale: f.crit ? 1.1 : 0.8 });
      if (f.crit) { shock(sc, x, y + 4, 32, 0xffa040, { w: 3 }); shake(sc, f, 80, 0.004); }
    });
    return true;
  }
  // Выстрел героя дальнего боя нарисованным снарядом (ряд bolt): кадры атаки, полёт, вспышка. onHit — урон по прилёту
  function shoot(sc, a, f, x, y, onHit) {
    if (!a || !a.skinOn || !hasFx(sc, a.skin, 'bolt')) return false;
    face(a, x, y);
    heroAnim(sc, a, x, y);
    const fx = a.c.x, fy = a.c.y - 14, ang = Math.atan2(y - 8 - fy, x - fx);
    const dur = Math.max(160, Math.hypot(x - fx, y - fy) * 1.4);
    sc.time.delayedCall(110, () => {
      const sp = fxPlay(sc, a.skin, 'bolt', fx, fy, { rot: ang, scale: 0.7, to: { x, y: y - 8 }, dur, flipY: x < fx });
      if (sp) sp.anims.msPerFrame = dur / 6;
      sc.time.delayedCall(dur, () => { fxPlay(sc, a.skin, 'hit', x, y - 8, { scale: f.crit ? 1.1 : 0.75 }); if (f.crit) shake(sc, f, 80, 0.004); onHit(); });
    });
    return true;
  }
  function attack(sc, a, f, x, y) {
    const fn = a && a.skin && (ATTACK[a.skin] || ((hasAttack(sc, a.skin) || hasFx(sc, a.skin, 'slash')) && sheetAttack));
    if (!fn) return false;
    face(a, x, y);
    return fn(sc, a, x, y, f);
  }

  // ---------- Умения ----------
  // Серп-волна, летящая вперёд
  function wave(sc, x, y, dx, dy, len, o) {
    const ang = Math.atan2(dy, dx);
    const g = sc.add.graphics({ x, y }).setDepth(9862).setRotation(ang).setBlendMode(Phaser.BlendModes.ADD);
    const R = o.r || 26;
    g.lineStyle(o.w * 2.4, o.glow, 0.25); g.beginPath(); g.arc(-R * 0.6, 0, R, -1.15, 1.15); g.strokePath();
    g.lineStyle(o.w, o.col, 0.95); g.beginPath(); g.arc(-R * 0.6, 0, R, -1.05, 1.05); g.strokePath();
    g.lineStyle(Math.max(2, o.w * 0.35), 0xffffff, 1); g.beginPath(); g.arc(-R * 0.6 + o.w * 0.3, 0, R, -0.9, 0.9); g.strokePath();
    g.setScale(0.5);
    sc.tweens.add({ targets: g, x: x + dx * len, y: y + dy * len, scale: o.grow || 1.6, duration: o.dur || 360, delay: o.delay || 0, ease: 'Cubic.easeOut' });
    sc.tweens.add({ targets: g, alpha: 0, duration: 160, delay: (o.delay || 0) + (o.dur || 360) - 120, onComplete: () => g.destroy() });
  }
  // Гексаграмма печати
  function drawSeal(g, r, col, a = 1) {
    g.lineStyle(2.5, col, a); g.strokeCircle(0, 0, r); g.strokeCircle(0, 0, r * 0.78);
    for (const off of [0, Math.PI / 3]) {
      g.beginPath();
      for (let i = 0; i <= 3; i++) { const t = off + (i / 3) * TAU - Math.PI / 2; const px = Math.cos(t) * r * 0.78, py = Math.sin(t) * r * 0.78; i ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.strokePath();
    }
    for (let i = 0; i < 6; i++) { const t = (i / 6) * TAU; g.fillStyle(col, a).fillCircle(Math.cos(t) * r, Math.sin(t) * r, 2.5); }
  }

  const SKILL = {
    // ---- Бохай ----
    qiWave(sc, f) {
      const c = casterOf(sc, f);
      if (hasFx(sc, 'bohai', 'qiWave')) {
        if (c) { heroAnim(sc, c, f.x + f.dx * 50, f.y + f.dy * 50); afterimage(sc, c, 0xffc850, 0.5, 300); }
        const ang = Math.atan2(f.dy, f.dx);
        fxPlay(sc, 'bohai', 'qiWave', f.x + f.dx * 24, f.y - 10 + f.dy * 24, { rot: ang, scale: 1.3, flipY: f.dx < 0, to: { x: f.x + f.dx * f.len, y: f.y - 10 + f.dy * f.len }, dur: 380 });
        for (let i = 2; i <= 6; i += 2) sc.time.delayedCall(i * 55, () => shock(sc, f.x + f.dx * f.len * i / 6, f.y + 4 + f.dy * f.len * i / 6, 22, 0xffc850, { w: 2, dur: 320 }));
        shake(sc, f, 120, 0.005);
        return true;
      }
      if (c) { face(c, f.x + f.dx * 50, f.y + f.dy * 50); lunge(sc, c, f.dx, f.dy, 14, 110); afterimage(sc, c, 0x46d6c8, 0.6, 320); }
      flash(sc, f.x + f.dx * 16, f.y - 8 + f.dy * 16, 26, 0x9ffcf0, 220);
      for (let i = 0; i < 3; i++) wave(sc, f.x + f.dx * 10, f.y - 8 + f.dy * 10, f.dx, f.dy, f.len, { col: i === 1 ? 0xffc850 : 0x46d6c8, glow: 0x46d6c8, w: 7 - i, r: 24 + i * 4, delay: i * 70, dur: 360, grow: 1.7 + i * 0.2 });
      for (let i = 1; i <= 6; i++) sc.time.delayedCall(i * 55, () => {
        const px = f.x + f.dx * f.len * i / 6, py = f.y + f.dy * f.len * i / 6;
        sparks(sc, px, py - 6, [0x46d6c8, 0xbffcf5, 0xffc850], 6, { max: 120, life: 380 });
        if (i % 2 === 0) shock(sc, px, py + 4, 22, 0x46d6c8, { w: 2, dur: 320 });
      });
      shock(sc, f.x, f.y + 4, 40, 0x46d6c8, { w: 4, dur: 420 });
      shake(sc, f, 120, 0.005);
      return true;
    },
    enlighten(sc, f) {
      const c = casterOf(sc, f);
      const big = f.execute;
      if (hasFx(sc, 'bohai', 'enlighten')) {
        if (c) { heroAnim(sc, c, f.x, f.y); afterimage(sc, c, 0xffd36a, 0.6, 320); }
        sc.time.delayedCall(80, () => {
          fxPlay(sc, 'bohai', 'enlighten', f.x, f.y - 22, { scale: big ? 1.9 : 1.35 });
          fxPlay(sc, 'bohai', 'hit', f.x, f.y - 8, { scale: big ? 1.6 : 1.1 });
          shock(sc, f.x, f.y + 4, big ? 80 : 50, 0xffd36a, { w: big ? 6 : 4, dur: 480 });
          if (big) { sc.floatText(f.x, f.y - 56, '☀️ Просветление!', '#fff2a0', 17); shake(sc, f, 260, 0.013); } else shake(sc, f, 140, 0.007);
        });
        return true;
      }
      if (c) { face(c, f.x, f.y); lunge(sc, c, f.x - c.c.x, f.y - c.c.y, 16, 100); afterimage(sc, c, 0xffd36a, 0.6, 320); }
      flash(sc, f.x, f.y - 8, big ? 60 : 40, 0xfff2c0, 300);
      rays(sc, f.x, f.y - 8, big ? 16 : 12, big ? 110 : 70, 0xffd36a, { w: big ? 4 : 3, dur: 420 });
      shock(sc, f.x, f.y + 4, big ? 90 : 55, 0xffd36a, { w: big ? 7 : 5, dur: 500 });
      shock(sc, f.x, f.y + 4, big ? 60 : 36, 0xffffff, { w: 3, dur: 380, delay: 60 });
      sparks(sc, f.x, f.y - 8, [0xfff2c0, 0xffd36a, 0xff9a2a], big ? 34 : 20, { max: big ? 320 : 240, life: 520 });
      if (big) {
        // Столп света с неба
        const col = sc.add.rectangle(f.x, f.y - 160, 46, 320, 0xfff2c0, 0.75).setDepth(9866).setBlendMode(Phaser.BlendModes.ADD).setScale(0.2, 1);
        const core = sc.add.rectangle(f.x, f.y - 160, 14, 320, 0xffffff, 1).setDepth(9867).setBlendMode(Phaser.BlendModes.ADD).setScale(0.2, 1);
        sc.tweens.add({ targets: [col, core], scaleX: 1, duration: 120, yoyo: true, hold: 160, onComplete: () => { col.destroy(); core.destroy(); } });
        sc.floatText(f.x, f.y - 46, '☀️ Просветление!', '#fff2a0', 17);
        shake(sc, f, 260, 0.013);
      } else shake(sc, f, 140, 0.007);
      return true;
    },
    harmony(sc, f) {
      const c = casterOf(sc, f);
      if (hasFx(sc, 'bohai', 'harmony')) {
        if (c) heroAnim(sc, c, undefined, undefined, true);
        const sp = fxPlay(sc, 'bohai', 'harmony', f.x, f.y - 14, { scale: 1.3, depth: 9100 });
        if (sp && c) sc.events.on('update', function follow() { if (!sp.active) return sc.events.off('update', follow); sp.setPosition(c.c.x, c.c.y - 14); });
        if (c) afterimage(sc, c, 0x9cf0a0, 0.5, 500);
        return true;
      }
      // Вращающийся знак инь-ян под ногами
      const { g, plane } = groundSign(sc, f.x, f.y + 6, 829);
      g.setScale(0.1);
      const R = 26;
      g.fillStyle(0xfff6e0, 0.85).fillCircle(0, 0, R);
      g.fillStyle(0x1a1a24, 0.85).slice(0, 0, R, Math.PI / 2, -Math.PI / 2, false).fillPath();
      g.fillStyle(0xfff6e0, 0.85).fillCircle(0, -R / 2, R / 2);
      g.fillStyle(0x1a1a24, 0.85).fillCircle(0, R / 2, R / 2);
      g.fillStyle(0x1a1a24, 1).fillCircle(0, -R / 2, R / 7);
      g.fillStyle(0xfff6e0, 1).fillCircle(0, R / 2, R / 7);
      g.lineStyle(3, 0xffd36a, 1).strokeCircle(0, 0, R);
      sc.tweens.add({ targets: g, scale: 1, duration: 260, ease: 'Back.easeOut' });
      sc.tweens.add({ targets: g, rotation: TAU * 1.5, duration: 1100 });
      sc.tweens.add({ targets: plane, alpha: 0, delay: 800, duration: 300, onComplete: () => plane.destroy() });
      // Лепестки лотоса и поднимающаяся энергия
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        const p = sc.add.ellipse(f.x, f.y + 6, 14, 26, i % 2 ? 0x9cf0a0 : 0xffd36a, 0.7).setDepth(831).setRotation(a + Math.PI / 2).setScale(0.2).setBlendMode(Phaser.BlendModes.ADD);
        sc.tweens.add({ targets: p, x: f.x + Math.cos(a) * 46, y: f.y + 6 + Math.sin(a) * 23, scale: 1, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => p.destroy() });
      }
      const em = sc.add.particles(0, 0, 'particle', {
        x: { min: -18, max: 18 }, y: { min: -4, max: 10 }, speedY: { min: -90, max: -40 }, speedX: { min: -12, max: 12 },
        lifespan: 700, scale: { start: 1.2, end: 0 }, tint: [0x9cf0a0, 0xffd36a, 0xfff6e0], frequency: 25, blendMode: 'ADD',
      }).setDepth(9880);
      if (c) em.startFollow(c.c); else em.setPosition(f.x, f.y);
      sc.time.delayedCall(900, () => em.stop());
      sc.time.delayedCall(1700, () => em.destroy());
      if (c) afterimage(sc, c, 0x9cf0a0, 0.5, 500);
      return true;
    },
    empHit(sc, f) {
      if (fxPlay(sc, 'bohai', 'hit', f.x, f.y - 8, { scale: 1.7 })) {
        shock(sc, f.x, f.y + 4, 52, 0xffd36a, { w: 6 });
        sc.floatText(f.x, f.y - 40, 'Гармония!', '#ffe08a', 14);
        shake(sc, f, 140, 0.008);
        return true;
      }
      flash(sc, f.x, f.y - 8, 42, 0xffd36a, 280);
      rays(sc, f.x, f.y - 8, 10, 70, 0xffc850, { w: 3 });
      shock(sc, f.x, f.y + 4, 52, 0xffd36a, { w: 6 });
      sparks(sc, f.x, f.y - 8, [0xfff2c0, 0xffc850], 22, { max: 280 });
      sc.floatText(f.x, f.y - 40, 'Гармония!', '#ffe08a', 14);
      shake(sc, f, 140, 0.008);
      return true;
    },

    // ---- Морвен ----
    gloomStrike(sc, f) {
      const c = casterOf(sc, f);
      if (c) { face(c, f.x, f.y); lunge(sc, c, f.x - c.c.x, f.y - c.c.y, 16, 110); afterimage(sc, c, 0x9b1a3a, 0.6, 320); }
      // Крест из двух тёмных серпов прямо по цели
      slash(sc, f.x, f.y - 8, -0.6, { r: 40, w: 10, sweep: 2.4, col: 0x1a0612, edge: 0xff3a4a, glow: 0x7a1a4a, dur: 240, flat: 0.8 });
      sc.time.delayedCall(90, () => slash(sc, f.x, f.y - 8, Math.PI + 0.6, { r: 40, w: 10, sweep: 2.4, col: 0x1a0612, edge: 0xb04aff, glow: 0x5a1a8a, dur: 240, flat: 0.8, flip: true }));
      flash(sc, f.x, f.y - 8, 34, 0x9b4dff, 300, 0.6);
      // Щупальца тьмы
      const g = sc.add.graphics({ x: f.x, y: f.y - 4 }).setDepth(9858);
      const arms = Array.from({ length: 9 }, (_, i) => ({ a: (i / 9) * TAU + Math.random() * 0.4, l: 50 + Math.random() * 40, k: Math.random() * 6 }));
      sc.tweens.addCounter({ from: 0, to: 1, duration: 600, onUpdate: (tw) => {
        const t = tw.getValue();
        g.clear();
        for (const arm of arms) {
          g.lineStyle(4 * (1 - t) + 1, 0x2a0a3a, 0.85 * (1 - t));
          g.beginPath(); g.moveTo(0, 0);
          for (let s = 1; s <= 6; s++) {
            const d = arm.l * Math.min(1, t * 2) * (s / 6), wob = Math.sin(s * 1.3 + arm.k + t * 8) * 6;
            g.lineTo(Math.cos(arm.a) * d - Math.sin(arm.a) * wob, (Math.sin(arm.a) * d + Math.cos(arm.a) * wob) * 0.6);
          }
          g.strokePath();
        }
      }, onComplete: () => g.destroy() });
      shock(sc, f.x, f.y + 4, 80, 0x6a3a9a, { w: 5, dur: 520 });
      sparks(sc, f.x, f.y - 8, [0xff3a4a, 0x9b4dff, 0x2a0a3a], 20, { max: 240, life: 560, gravity: -80 });
      sc.floatText(f.x, f.y - 48, '😱 Страх', '#c890ff', 13);
      shake(sc, f, 170, 0.009);
      return true;
    },
    darkBurst(sc, f) {
      const c = casterOf(sc, f);
      const R = f.r || 130, k = Math.min(1, ((f.power || 1) - 1) / 4); // 0 — пусто, 1 — полный мрак
      if (c) afterimage(sc, c, 0x9b4dff, 0.7, 400);
      // Сбор тьмы к герою
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU, d = R * 0.8;
        const o = sc.add.circle(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * 0.55, 5, i % 2 ? 0x9b4dff : 0x1a0a24, 0.9).setDepth(9861);
        sc.tweens.add({ targets: o, x: f.x, y: f.y - 6, scale: 0.3, duration: 200, ease: 'Quad.easeIn', onComplete: () => o.destroy() });
      }
      sc.time.delayedCall(200, () => {
        const fl = sc.add.ellipse(f.x, f.y, R * 2, R * 1.1, 0x12061c, 0.8).setDepth(829).setScale(0.15);
        sc.tweens.add({ targets: fl, scale: 1, alpha: 0, duration: 700, ease: 'Cubic.easeOut', onComplete: () => fl.destroy() });
        flash(sc, f.x, f.y - 8, 50 + 40 * k, 0xb04aff, 320);
        shock(sc, f.x, f.y + 2, R, 0x9b4dff, { w: 8, dur: 560 });
        shock(sc, f.x, f.y + 2, R * 0.7, 0xff3a4a, { w: 4, dur: 480, delay: 60 });
        shock(sc, f.x, f.y + 2, R * 1.15, 0x3a0a4a, { w: 3, dur: 700, delay: 120 });
        // Шипы тьмы и трещины земли
        const g = sc.add.graphics({ x: f.x, y: f.y }).setDepth(9857);
        const n = 10 + Math.round(6 * k);
        const spikes = Array.from({ length: n }, (_, i) => ({ a: (i / n) * TAU + Math.random() * 0.2, l: R * (0.55 + Math.random() * 0.45) }));
        sc.tweens.addCounter({ from: 0, to: 1, duration: 750, onUpdate: (tw) => {
          const t = tw.getValue(), grow = Math.min(1, t * 3), fade = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
          g.clear();
          for (const s of spikes) {
            const ex = Math.cos(s.a) * s.l * grow, ey = Math.sin(s.a) * s.l * grow * 0.55;
            const nx = -Math.sin(s.a) * 6, ny = Math.cos(s.a) * 6 * 0.55;
            g.fillStyle(0x1a0a24, 0.9 * fade).fillTriangle(nx, ny - 6, -nx, -ny - 6, ex, ey - 6);
            g.lineStyle(1.5, 0xb04aff, fade).lineBetween(0, -6, ex, ey - 6);
          }
        }, onComplete: () => g.destroy() });
        sparks(sc, f.x, f.y - 8, [0x9b4dff, 0xff3a4a, 0x1a0a24], 30 + Math.round(20 * k), { max: 300 + 120 * k, life: 650, gravity: -60 });
        shake(sc, f, 200 + 150 * k, 0.008 + 0.01 * k);
      });
      sc.floatText(f.x, f.y - 60, `💥 ×${(f.power || 1).toFixed(1)}`, '#d8a0ff', 17);
      return true;
    },
    darkSeal(sc, f) {
      const { g, plane } = groundSign(sc, f.x, f.y + 4, 831);
      drawSeal(g, 30, 0xb04aff);
      g.setScale(2.4); plane.setAlpha(0);
      sc.tweens.add({ targets: g, scale: 1, rotation: Math.PI, duration: 380, ease: 'Cubic.easeOut' });
      sc.tweens.add({ targets: plane, alpha: 1, duration: 200 });
      sc.tweens.add({ targets: plane, alpha: 0, delay: 500, duration: 300, onComplete: () => plane.destroy() });
      const c = casterOf(sc, f);
      if (c) {
        face(c, f.x, f.y);
        const ln = sc.add.graphics().setDepth(9862).setBlendMode(Phaser.BlendModes.ADD);
        ln.lineStyle(6, 0x9b4dff, 0.35).lineBetween(c.c.x, c.c.y - 14, f.x, f.y - 8);
        ln.lineStyle(2, 0xe0c0ff, 1).lineBetween(c.c.x, c.c.y - 14, f.x, f.y - 8);
        sc.tweens.add({ targets: ln, alpha: 0, duration: 300, onComplete: () => ln.destroy() });
      }
      flash(sc, f.x, f.y - 8, 26, 0xb04aff, 280);
      sparks(sc, f.x, f.y - 8, [0xb04aff, 0xe0c0ff], 14, { max: 160 });
      sc.floatText(f.x, f.y - 44, '🔯 Печать тьмы', '#d8a0ff', 13);
      return true;
    },
    sealHeal(sc, f) {
      const c = casterOf(sc, f);
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * TAU, d = 60 + Math.random() * 30;
        const o = sc.add.circle(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * 0.6 - 10, 4, i % 2 ? 0x7dff8a : 0xb04aff, 0.95).setDepth(9870).setBlendMode(Phaser.BlendModes.ADD);
        sc.tweens.add({ targets: o, x: c ? c.c.x : f.x, y: (c ? c.c.y : f.y) - 12, scale: 0.4, duration: 380 + i * 40, ease: 'Quad.easeIn', onComplete: () => o.destroy() });
      }
      sc.time.delayedCall(400, () => { shock(sc, c ? c.c.x : f.x, (c ? c.c.y : f.y) + 4, 34, 0x7dff8a, { w: 3 }); flash(sc, c ? c.c.x : f.x, (c ? c.c.y : f.y) - 10, 20, 0x7dff8a, 240, 0.6); });
      sc.floatText(f.x, f.y - 56, '🖤 Душа поглощена', '#c890ff', 13);
      return true;
    },
  };
  // Умения по нарисованным эффектам героя (ключ — id героя, затем id умения)
  const SHEET_SKILL = {
    alamariel: {
      spiritWrath(sc, f, c) {
        heroAnim(sc, c, undefined, undefined, true);
        // Три волны духов предков над целью — в такт ударам сервера
        for (let i = 0; i < 3; i++) sc.time.delayedCall(150 + i * 300, () => {
          fxPlay(sc, 'alamariel', 'spiritWrath', f.x + (Math.random() - 0.5) * f.r * 0.6, f.y - 18 + (Math.random() - 0.5) * f.r * 0.3, { scale: (f.r || 100) / 50 });
          shock(sc, f.x, f.y + 4, f.r || 100, 0x9ff0ff, { w: 3, dur: 400 });
          if (i === 2) shake(sc, f, 140, 0.005);
        });
        return true;
      },
      chainLightning(sc, f, c) {
        const pts = [[c.c.x, c.c.y - 16], ...f.pts.map(([x, y]) => [x, y - 10])];
        heroAnim(sc, c, f.pts[0][0], f.pts[0][1]);
        // Молния-эффект растягивается и поворачивается между соседними целями
        pts.slice(1).forEach(([x2, y2], i) => sc.time.delayedCall(i * 70, () => {
          const [x1, y1] = pts[i], d = Math.hypot(x2 - x1, y2 - y1);
          const sp = fxPlay(sc, 'alamariel', 'chainLightning', (x1 + x2) / 2, (y1 + y2) / 2, { rot: Math.atan2(y2 - y1, x2 - x1) - Math.PI / 4, scale: Math.max(0.8, d / 60) });
          if (sp) sp.anims.msPerFrame = 45;
          fxPlay(sc, 'alamariel', 'hit', x2, y2, { scale: 0.8 });
        }));
        shake(sc, f, 120, 0.005);
        return true;
      },
      healTotem(sc, f, c) {
        heroAnim(sc, c, undefined, undefined, true);
        fxPlay(sc, 'alamariel', 'healTotem', f.x, f.y - 20, { scale: 1.4 });
        shock(sc, f.x, f.y + 4, f.r || 140, 0x7dff8a, { w: 3, dur: 600 });
        return true;
      },
      favorReady(sc, f, c) {
        fxPlay(sc, 'alamariel', 'aura', c.c.x, c.c.y - 4, { scale: 1.2, follow: c, dy: -4 });
        sc.floatText(f.x, f.y - 50, '🌀 Духи благосклонны!', '#9ff0ff', 13);
        return true;
      },
    },
    vayald: {
      twinSlash(sc, f, c) {
        heroAnim(sc, c, f.x, f.y) || lunge(sc, c, f.x - c.c.x, f.y - c.c.y, 14, 90);
        afterimage(sc, c, 0xff2a3a, 0.6, 300);
        fxPlay(sc, 'vayald', 'twinSlash', f.x, f.y - 10, { scale: 1.4, repeat: 1 });
        for (let i = 0; i < 4; i++) sc.time.delayedCall(60 + i * 110, () => fxPlay(sc, 'vayald', 'hit', f.x + (Math.random() - 0.5) * 16, f.y - 10 + (Math.random() - 0.5) * 12, { scale: 0.9 }));
        shake(sc, f, 200, 0.006);
        return true;
      },
      bloodFrenzy(sc, f, c) {
        heroAnim(sc, c, undefined, undefined, true);
        fxPlay(sc, 'vayald', 'bloodFrenzy', c.c.x, c.c.y - 6, { scale: 1.7, follow: c, dy: -6 });
        afterimage(sc, c, 0xff2a3a, 0.7, 500);
        sc.floatText(c.c.x, c.c.y - 56, '🩸 Кровавое безумие!', '#ff5a5a', 14);
        shake(sc, f, 160, 0.006);
        return true;
      },
      blindRage(sc, f, c) {
        const ang = Math.atan2(f.y - f.fy, f.x - f.fx), dist = Math.hypot(f.x - f.fx, f.y - f.fy);
        fxPlay(sc, 'vayald', 'blindRage', (f.fx + f.x) / 2, (f.fy + f.y) / 2 - 10, { rot: ang, scale: Math.max(1.2, dist / 55), flipY: f.x < f.fx });
        for (let i = 0; i < 4; i++) sc.time.delayedCall(i * 50, () => afterimage(sc, c, 0xff2a3a, 0.5, 260));
        shake(sc, f, 180, 0.008);
        return true;
      },
    },
    vebrand: {
      bloodWhirl(sc, f, c) {
        heroAnim(sc, c, c.c.x, c.c.y + 20);
        fxPlay(sc, 'vebrand', 'bloodWhirl', c.c.x, c.c.y - 10, { scale: (f.r || 90) / 40, repeat: 2, follow: c, dy: -10 });
        shake(sc, f, 160, 0.006);
        return true;
      },
      furyRoar(sc, f, c) {
        heroAnim(sc, c, undefined, undefined, true);
        fxPlay(sc, 'vebrand', 'furyRoar', c.c.x, c.c.y - 22, { scale: 1.7, solid: true, follow: c, dy: -22 });
        shock(sc, f.x, f.y + 4, f.r || 120, 0xe0533a, { w: 5, dur: 650 });
        sc.floatText(f.x, f.y - 60, 'РРРААА!', '#ff7a5a', 17);
        shake(sc, f, 260, 0.01);
        return true;
      },
      stoneThrow(sc, f, c) {
        heroAnim(sc, c, f.x, f.y);
        const ang = Math.atan2(f.y - f.fy, f.x - f.fx);
        const dur = Math.min(520, Math.hypot(f.x - f.fx, f.y - f.fy) * 1.6);
        sc.time.delayedCall(120, () => {
          const sp = fxPlay(sc, 'vebrand', 'stoneThrow', f.fx, f.fy - 16, { rot: ang, scale: 1.1, solid: true, flipY: f.x < f.fx, to: { x: f.x, y: f.y - 8 }, dur });
          if (sp) sp.anims.msPerFrame = dur / 4; // полёт длится, пока камень летит
          sc.time.delayedCall(dur, () => { fxPlay(sc, 'vebrand', 'hit', f.x, f.y - 8, { scale: 1.2 }); shock(sc, f.x, f.y + 4, 34, 0xffc850, { w: 4 }); shake(sc, f, 120, 0.007); });
        });
        return true;
      },
    },
  };
  function skill(sc, f) {
    const c = casterOf(sc, f);
    const own = c && c.skinOn && SHEET_SKILL[c.skin] && SHEET_SKILL[c.skin][f.s];
    // Ряд эффекта обычно назван как умение; событие «духи благосклонны» играет ауру
    if (own && hasFx(sc, c.skin, { favorReady: 'aura' }[f.s] || f.s)) return own(sc, f, c);
    const fn = SKILL[f.s];
    return fn ? fn(sc, f) : false;
  }

  // Постоянная метка «Печати тьмы» под монстром (пока действует)
  function sealMark(sc, e) {
    const g = sc.add.graphics();
    drawSeal(g, 20 * Math.max(1, e.sprite.scaleX), 0xb04aff, 0.9);
    const plane = sc.add.container(0, 8, [g]).setScale(1, 0.5).setAlpha(0.85);
    e.c.addAt(plane, 0);
    sc.tweens.add({ targets: g, rotation: TAU, duration: 4000, repeat: -1 });
    return plane;
  }

  return { attack, shoot, skill, sealMark, hasFx, auraSprite };
})();
