// Языки игры. Русский — исходный текст в коде; переводы лежат в i18n/<язык>.json ({ "русская фраза": "перевод" }).
// Перевод накладывается поверх: текст страницы (наблюдатель за DOM), подписи Phaser (setText), сообщения сервера.
// Фразы с подстановками («Нужен {0} уровень») сравниваются шаблоном, подставленные значения тоже переводятся.
window.I18N = (() => {
  const LANGS = { ru: 'Русский', en: 'English', es: 'Español', pt: 'Português', de: 'Deutsch', fr: 'Français', tr: 'Türkçe' };
  const CYR = /[А-Яа-яЁё]/;
  const auto = () => {
    const tgl = window.Telegram && Telegram.WebApp && Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user && Telegram.WebApp.initDataUnsafe.user.language_code;
    const l = String(tgl || navigator.language || 'ru').slice(0, 2).toLowerCase();
    return LANGS[l] ? l : l === 'uk' || l === 'be' || l === 'kk' ? 'ru' : 'en';
  };
  const lang = (window.Settings && Settings.get('lang')) || auto();
  const exact = new Map(), pats = [], cache = new Map();
  if (lang !== 'ru') {
    try {
      const x = new XMLHttpRequest(); x.open('GET', `i18n/${lang}.json?v=1`, false); x.send(); // до запуска игры, чтобы первый же экран был переведён
      const dict = JSON.parse(x.responseText);
      // Каждая фраза ещё и без значков и знаков по краям («🧙 Персонаж» → «Персонаж», «· в очереди: {0}» → «в очереди: {0}»):
      // так её найдут и в другом окружении
      const AFX = /^([^А-Яа-яЁёA-Za-z{]*)([\s\S]*?)([^А-Яа-яЁёA-Za-z}]*)$/, AFX_T = /^([^\p{L}{]*)([\s\S]*?)([^\p{L}}]*)$/u;
      const pairs = Object.entries(dict);
      for (const [ru, t] of Object.entries(dict)) {
        const m = AFX.exec(ru), n = AFX_T.exec(t);
        if (m && n && m[2] && m[2] !== ru && !(m[2] in dict) && CYR.test(m[2])) pairs.push([m[2], n[2]]);
      }
      const seen = new Set();
      for (const [ru, t] of pairs) {
        if (seen.has(ru)) continue;
        seen.add(ru);
        if (!/\{\d+\}/.test(ru)) { exact.set(ru, t); continue; }
        if (!CYR.test(ru.replace(/\{\d+\}/g, ''))) continue; // шаблон из одних подстановок совпал бы с чем угодно
        const idx = [];
        const src = ru.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\d+)\}/g, (m, a) => { idx.push(+a); return '([\\s\\S]*?)'; });
        pats.push({ re: new RegExp('^' + src + '$'), idx, t, len: ru.replace(/\{\d+\}/g, '').length });
      }
      pats.sort((a, b) => b.len - a.len);
    } catch (e) { /* нет файла — остаётся русский */ }
  }
  function core(s) {
    const e = exact.get(s);
    if (e !== undefined) return e;
    for (const p of pats) {
      const m = p.re.exec(s);
      if (m) return p.t.replace(/\{(\d+)\}/g, (_, n) => { const k = p.idx.indexOf(+n); return k < 0 ? '' : tr(m[k + 1]); });
    }
    return null;
  }
  // Перевод строки: целиком, затем без значков и знаков по краям («🏆 Победа!» → «Победа»)
  function tr(s) {
    if (lang === 'ru' || typeof s !== 'string' || !CYR.test(s)) return s;
    let r = cache.get(s);
    if (r !== undefined) return r;
    const t = s.trim();
    r = core(t);
    if (r !== null) r = s.replace(t, r);
    else {
      // значок спереди («✴️ резонанс 0/4»), затем знаки по обоим краям («🏆 Победа!»)
      const a = /^([^А-Яа-яЁёA-Za-z]*)([\s\S]*)$/.exec(s), b = /^([^А-Яа-яЁёA-Za-z]*)([\s\S]*?)([^А-Яа-яЁёA-Za-z]*)$/.exec(s);
      let c = core(a[2].trimEnd());
      if (c !== null) r = a[1] + a[2].replace(a[2].trimEnd(), c);
      else if ((c = core(b[2])) !== null) r = b[1] + c + b[3];
      // составная строка «часть · часть»
      else if (/ · |, /.test(t)) { const sep = / · /.test(t) ? ' · ' : ', '; const parts = s.split(sep); const tp = parts.map(tr); r = tp.some((x, i) => x !== parts[i]) ? tp.join(sep) : s; }
      else r = s;
    }
    if (cache.size > 5000) cache.clear();
    cache.set(s, r);
    return r;
  }
  // ---------- Страница ----------
  const done = new WeakMap();
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT']);
  function text(n) {
    const v = n.nodeValue;
    if (done.get(n) === v || !CYR.test(v)) return;
    const t = tr(v);
    if (t !== v) n.nodeValue = t;
    done.set(n, n.nodeValue);
  }
  function walk(n) {
    if (n.nodeType === 3) return text(n);
    if (n.nodeType !== 1 || SKIP.has(n.tagName) && n.tagName !== 'INPUT' || n.classList.contains('notr')) return;
    for (const a of ['placeholder', 'title', 'alt', 'aria-label']) { const v = n.getAttribute(a); if (v && CYR.test(v)) { const t = tr(v); if (t !== v) n.setAttribute(a, t); } }
    if (n.tagName === 'INPUT' && (n.type === 'button' || n.type === 'submit') && CYR.test(n.value)) n.value = tr(n.value);
    if (SKIP.has(n.tagName)) return;
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  }
  function start() {
    if (lang === 'ru') return;
    document.documentElement.lang = lang;
    document.title = tr(document.title);
    walk(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') { if (!m.target.parentElement || !m.target.parentElement.closest('.notr')) text(m.target); continue; }
        if (m.type === 'attributes') { if (!m.target.closest('.notr')) walk(m.target); continue; }
        for (const n of m.addedNodes) if (!(n.parentElement && n.parentElement.closest('.notr'))) walk(n);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'alt'] });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  // ---------- Подписи в игре (Phaser) ----------
  if (lang !== 'ru' && window.Phaser && Phaser.GameObjects && Phaser.GameObjects.Text) {
    const P = Phaser.GameObjects.Text.prototype, set = P.setText;
    P.setText = function (v) { return set.call(this, typeof v === 'string' ? tr(v) : Array.isArray(v) ? v.map(tr) : v); };
  }
  return { tr, lang, LANGS, set: (l) => { Settings.set('lang', l); location.reload(); } };
})();
