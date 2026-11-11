// Настройки игрока (хранятся в этом браузере): Settings.get(ключ), Settings.set(ключ, значение), Settings.on(fn)
window.Settings = (() => {
  const DEF = {
    sfxVol: 80, musicVol: 60, vibro: true, // звук и отдача (громкость в процентах; общий выключатель — Sfx.toggle)
    dmgNums: true, names: true, chatPop: true, sysPop: true, // цифры урона, имена над героями и монстрами, сообщения чата и события над картой
    hints: true, lowFps: false, // подсказки в игре и окнах, экономия батареи (30 кадров в секунду)
    gfx: 'auto', netInfo: false, // качество картинки: auto (по частоте кадров) / high / fast; показывать FPS и пинг
    ctrlSize: 100, ctrlOpacity: 100, leftHand: false, // размер и прозрачность кнопок управления (%), джойстик справа
    autoPot: true, autoPotAt: 35, // автозелье: пить само, когда здоровья меньше autoPotAt %
    lang: null, // язык; null — по языку Telegram или браузера
  };
  let cur = { ...DEF };
  try { Object.assign(cur, JSON.parse(localStorage.getItem('settings') || '{}')); } catch (e) { /* без хранилища */ }
  const subs = [];
  const save = () => { try { localStorage.setItem('settings', JSON.stringify(cur)); } catch (e) { /* без хранилища */ } };
  return {
    get: (k) => cur[k],
    set(k, v) { cur[k] = v; save(); subs.forEach((f) => f(k, v)); },
    reset() { cur = { ...DEF, lang: cur.lang }; save(); Object.keys(cur).forEach((k) => subs.forEach((f) => f(k, cur[k]))); },
    on: (f) => subs.push(f),
  };
})();
