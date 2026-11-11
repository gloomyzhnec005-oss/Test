// Перевод готовых русских сообщений на язык игрока (уведомления бота) — та же логика и словари, что в игре (public/js/i18n.js):
// точное совпадение, шаблоны с подстановками {0}, затем без значков по краям и по частям «а · б».
const fs = require('fs');
const path = require('path');
const CYR = /[А-Яа-яЁё]/;
const cache = new Map(); // язык → переводчик

function make(lang) {
  const exact = new Map(), pats = [], memo = new Map();
  let dict = {};
  try { dict = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', `${lang}.json`), 'utf8')); } catch { return (s) => s; }
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
    if (!CYR.test(ru.replace(/\{\d+\}/g, ''))) continue;
    const idx = [];
    const src = ru.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\d+)\}/g, (m, a) => { idx.push(+a); return '([\\s\\S]*?)'; });
    pats.push({ re: new RegExp('^' + src + '$'), idx, t, len: ru.replace(/\{\d+\}/g, '').length });
  }
  pats.sort((a, b) => b.len - a.len);
  function core(s) {
    const e = exact.get(s);
    if (e !== undefined) return e;
    for (const p of pats) {
      const m = p.re.exec(s);
      if (m) return p.t.replace(/\{(\d+)\}/g, (_, n) => { const k = p.idx.indexOf(+n); return k < 0 ? '' : tr(m[k + 1]); });
    }
    return null;
  }
  function tr(s) {
    if (typeof s !== 'string' || !CYR.test(s)) return s;
    let r = memo.get(s);
    if (r !== undefined) return r;
    const t = s.trim();
    r = core(t);
    if (r !== null) r = s.replace(t, r);
    else {
      const a = /^([^А-Яа-яЁёA-Za-z]*)([\s\S]*)$/.exec(s), b = /^([^А-Яа-яЁёA-Za-z]*)([\s\S]*?)([^А-Яа-яЁёA-Za-z]*)$/.exec(s);
      let c = core(a[2].trimEnd());
      if (c !== null) r = a[1] + a[2].replace(a[2].trimEnd(), c);
      else if ((c = core(b[2])) !== null) r = b[1] + c + b[3];
      else if (/ · |, |: /.test(t)) { const sep = / · /.test(t) ? ' · ' : /, /.test(t) ? ', ' : ': '; const parts = s.split(sep); const tp = parts.map(tr); r = tp.some((x, i) => x !== parts[i]) ? tp.join(sep) : s; }
      else r = s;
    }
    if (memo.size > 3000) memo.clear();
    memo.set(s, r);
    return r;
  }
  return tr;
}

// translate('en', 'Рынок: продано …') → английский текст; неизвестный язык или русский — как есть
module.exports = function translate(lang, text) {
  if (!lang || lang === 'ru') return text;
  if (!cache.has(lang)) cache.set(lang, make(lang));
  try { return cache.get(lang)(text); } catch { return text; }
};
