// Собирает переводы в public/i18n/<язык>.json из файлов вида { "русская фраза": { en, es, pt, de, fr, tr } }.
// node tools/i18n_build.js перевод1.json перевод2.json …  (уже собранные файлы языков дополняются, а не затираются)
// Без аргументов — только отчёт: сколько фраз из strings.json ещё без перевода.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '../public/i18n'), LANGS = ['en', 'es', 'pt', 'de', 'fr', 'tr'];
const cur = Object.fromEntries(LANGS.map((l) => { const f = path.join(DIR, l + '.json'); return [l, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}]; }));
const ph = (s) => (s.match(/\{\d+\}/g) || []).sort().join();
let bad = 0;
for (const f of process.argv.slice(2)) {
  for (const [ru, t] of Object.entries(JSON.parse(fs.readFileSync(f, 'utf8')))) {
    for (const l of LANGS) {
      if (typeof t[l] !== 'string' || !t[l].trim()) continue;
      if (ph(t[l]) !== ph(ru)) { bad++; console.log('подстановки не совпали:', l, ru, '→', t[l]); continue; }
      cur[l][ru] = t[l];
    }
  }
}
const all = JSON.parse(fs.readFileSync(path.join(DIR, 'strings.json'), 'utf8'));
for (const l of LANGS) {
  const sorted = Object.fromEntries(Object.keys(cur[l]).sort().map((k) => [k, cur[l][k]]));
  fs.writeFileSync(path.join(DIR, l + '.json'), JSON.stringify(sorted, null, 0).replace(/","/g, '",\n"'));
  console.log(l, Object.keys(sorted).length, 'фраз, без перевода:', all.filter((k) => !(k in sorted)).length);
}
if (bad) console.log('пропущено из-за подстановок:', bad);
