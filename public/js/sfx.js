// Звуки игры, синтезированные в браузере (Web Audio) — без звуковых файлов.
// Sfx.play(имя, {pitch}) · Sfx.toggle() — вкл/выкл (запоминается) · Sfx.music(theme) — тихий эмбиент города/данжа.
window.Sfx = (() => {
  let ac = null, master = null, musBus = null, on = true, musicNode = null, musicTheme = null;
  const vol = (k, d) => (window.Settings ? Settings.get(k) : d) / 100;
  try { on = localStorage.getItem('sfx') !== 'off'; } catch (e) { /* без хранилища */ }
  const last = {};
  function ctx() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    // Две шины: эффекты и музыка — своя громкость у каждой (Настройки)
    master = ac.createGain(); master.gain.value = 0.55 * vol('sfxVol', 80); master.connect(ac.destination);
    musBus = ac.createGain(); musBus.gain.value = 1.6 * vol('musicVol', 60); musBus.connect(ac.destination);
    return ac;
  }
  // Браузер разрешает звук только после касания. Safari на iPhone — только по отпусканию пальца (touchend/click),
  // а беззвучный режим телефона глушит Web Audio: просим у Safari режим «воспроизведение» (как у плеера),
  // в старых версиях — тихой зацикленной дорожкой <audio>, пока вкладка открыта.
  let keep = null;
  function silentWav() {
    const n = 4410, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 44100, true); v.setUint32(28, 88200, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  function playbackSession() {
    try { if (navigator.audioSession) { navigator.audioSession.type = 'playback'; return; } } catch (e) { /* нет API */ }
    if (!/iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) || !('ontouchend' in document)) return;
    if (!keep) { keep = new Audio(silentWav()); keep.loop = true; keep.setAttribute('playsinline', ''); keep.volume = 0.01; }
    if (on && !document.hidden) keep.play().catch(() => {});
  }
  const unlock = () => {
    const c = ctx();
    if (!c) return;
    playbackSession();
    if (c.state !== 'running') c.resume().catch(() => {});
    loadFiles();
    // Короткий пустой буфер: Safari считает звук «включённым пользователем»
    try { const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(0); } catch (e) { /* ничего */ }
  };
  ['pointerdown', 'touchstart', 'touchend', 'mousedown', 'click', 'keydown'].forEach((e) => document.addEventListener(e, unlock, { passive: true, capture: true }));
  // После сворачивания вкладки iPhone «прерывает» звук — возобновляем при возврате
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (keep) keep.pause(); return; }
    if (ac && ac.state !== 'running') ac.resume().catch(() => {});
    if (keep && on) keep.play().catch(() => {});
  });

  // Тон с огибающей: тип волны, частота от→до, длительность, громкость
  function tone(type, f0, f1, dur, vol, delay = 0, dest = master) {
    const c = ac, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
  // Шум (удар, взрыв, свист) через фильтр
  let noiseBuf = null;
  function noise(dur, vol, freq, q = 1, delay = 0, type = 'bandpass') {
    const c = ac, t = c.currentTime + delay;
    if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  const SOUNDS = {
    hit: (k) => { noise(0.08, 0.35, 1800 * k, 0.8); tone('square', 220 * k, 90, 0.07, 0.08); },
    crit: (k) => { noise(0.14, 0.5, 2600 * k, 0.7); tone('sawtooth', 520 * k, 120, 0.16, 0.12); tone('sine', 1200, 600, 0.12, 0.08, 0.02); },
    hurt: () => { noise(0.12, 0.3, 500, 1.2); tone('triangle', 180, 70, 0.14, 0.12); },
    kill: () => { tone('triangle', 660, 990, 0.09, 0.1); tone('triangle', 990, 1320, 0.1, 0.08, 0.06); },
    coin: () => { tone('square', 1320, 1320, 0.05, 0.05); tone('square', 1760, 1760, 0.08, 0.05, 0.05); },
    loot: () => { [784, 988, 1175, 1568].forEach((f, i) => tone('triangle', f, f, 0.14, 0.09, i * 0.06)); },
    levelup: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f * 1.01, 0.22, 0.12, i * 0.09)); noise(0.6, 0.08, 6000, 0.5, 0.3, 'highpass'); },
    skill: (k) => { tone('sine', 300 * k, 900 * k, 0.22, 0.12); noise(0.25, 0.12, 3000 * k, 1.5); },
    shoot: (k) => { tone('sine', 900 * k, 300 * k, 0.12, 0.07); },
    boom: () => { noise(0.5, 0.5, 300, 0.7, 0, 'lowpass'); tone('sine', 110, 40, 0.45, 0.25); },
    heal: () => { [660, 880, 1100].forEach((f, i) => tone('sine', f, f * 1.05, 0.25, 0.07, i * 0.07)); },
    click: () => tone('triangle', 900, 700, 0.05, 0.06),
    open: () => { tone('triangle', 500, 750, 0.08, 0.06); noise(0.08, 0.05, 4000, 1, 0.02); },
    reward: () => { [659, 831, 988, 1319].forEach((f, i) => tone('triangle', f, f, 0.18, 0.1, i * 0.07)); },
    quest: () => { [784, 1047, 1319].forEach((f, i) => tone('sine', f, f, 0.2, 0.1, i * 0.1)); },
    error: () => { tone('square', 220, 160, 0.16, 0.06); },
    portal: () => { tone('sine', 200, 1200, 0.6, 0.1); noise(0.6, 0.1, 1500, 2); },
    death: () => { [392, 330, 262, 196].forEach((f, i) => tone('triangle', f, f * 0.98, 0.3, 0.12, i * 0.16)); },
    gacha: () => { for (let i = 0; i < 8; i++) tone('triangle', 600 + i * 120, 600 + i * 120, 0.06, 0.05, i * 0.05); },
  };
  // Не чаще, чем раз в N мс (много ударов в одном тике)
  const GAP = { quest: 1500, portal: 800, chest: 1500, roar: 8000, heal: 1500, zap: 120, fire: 120, ice: 120, hit: 45, crit: 60, hurt: 250, coin: 200, kill: 60, shoot: 50, skill: 80, click: 30 };
  // Записанные звуки: assets/sfx/<имя>.mp3 — заменяют синтезированный звук с тем же именем (остальные синтезируются)
  const FILES = ['shoot', 'hit', 'crit', 'hurt', 'kill', 'zap', 'skill', 'fire', 'ice', 'heal', 'shield', 'roar', 'death', 'coin', 'chest', 'portal', 'quest', 'gate', 'step'];
  const FVOL = { hurt: 0.6, kill: 0.8, skill: 0.75, fire: 0.85, heal: 0.7, shield: 0.75, coin: 0.6, step: 0.3 }; // громкость записанного звука (частые звуки — тише)
  const buf = {};
  let loading = false;
  function loadFiles() {
    if (loading || !ac) return;
    loading = true;
    for (const n of FILES) fetch(`assets/sfx/${n}.mp3?v=18`).then((r) => r.arrayBuffer())
      .then((a) => new Promise((ok, no) => ac.decodeAudioData(a, ok, no))).then((b) => { buf[n] = b; }).catch(() => {});
  }
  function playFile(name, k) {
    const s = ac.createBufferSource(), g = ac.createGain();
    s.buffer = buf[name];
    s.playbackRate.value = Math.max(0.75, Math.min(1.25, k * (0.96 + Math.random() * 0.08))); // лёгкий разброс высоты — не звучит однообразно
    g.gain.value = 0.9 * (FVOL[name] ?? 1);
    s.connect(g); g.connect(master); s.start();
  }
  function play(name, o = {}) {
    if (!on || !(SOUNDS[name] || buf[name]) || !ctx() || ac.state !== 'running') return;
    loadFiles();
    const now = performance.now();
    if (now - (last[name] || 0) < (GAP[name] || 0)) return;
    last[name] = now;
    try { if (buf[name]) playFile(name, o.pitch || 1); else SOUNDS[name](o.pitch || 1); } catch (e) { /* звук не обязателен */ }
  }
  // Тихий фоновый эмбиент: аккорд из трёх тонов с медленной «волной»
  const CHORDS = { green: [196, 247, 294], abyss: [110, 131, 165], sky: [262, 330, 392], dungeon: [98, 117, 147] };
  function music(theme) {
    if (musicTheme === theme) return;
    musicTheme = theme;
    if (musicNode) { const n = musicNode; n.g.gain.setTargetAtTime(0.0001, ac.currentTime, 0.6); setTimeout(() => n.oscs.forEach((o) => o.stop()), 2500); musicNode = null; }
    if (!on || !theme || !ctx()) return;
    const g = ac.createGain(); g.gain.value = 0.0001; g.connect(musBus);
    const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.08; lg.gain.value = 0.012; lfo.connect(lg); lg.connect(g.gain); lfo.start();
    const oscs = [lfo, ...(CHORDS[theme] || CHORDS.green).map((f, i) => { const o = ac.createOscillator(); o.type = i ? 'sine' : 'triangle'; o.frequency.value = f; o.detune.value = (i - 1) * 4; o.connect(g); o.start(); return o; })];
    g.gain.setTargetAtTime(0.025, ac.currentTime, 2);
    musicNode = { g, oscs };
  }
  function toggle() {
    on = !on;
    try { localStorage.setItem('sfx', on ? 'on' : 'off'); } catch (e) { /* без хранилища */ }
    if (keep) { if (on) keep.play().catch(() => {}); else keep.pause(); }
    if (!on) { const t = musicTheme; music(null); musicTheme = t; } else { const t = musicTheme; musicTheme = null; music(t); play('click'); }
    return on;
  }
  if (window.Settings) Settings.on((k) => {
    if (!ac) return;
    if (k === 'sfxVol') master.gain.setTargetAtTime(0.55 * vol('sfxVol', 80), ac.currentTime, 0.05);
    if (k === 'musicVol') musBus.gain.setTargetAtTime(1.6 * vol('musicVol', 60), ac.currentTime, 0.05);
  });
  return { play, toggle, music, isOn: () => on };
})();
