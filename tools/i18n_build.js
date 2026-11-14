// Собирает переводы в public/i18n/<язык>.json из файлов вида { "русская фраза": { en, es, pt, de, fr, tr } }.
// node tools/i18n_build.js перевод1.json перевод2.json …  (уже собранные файлы языков дополняются, а не затираются)
// Без аргументов — только отчёт: сколько фраз из strings.json ещё без перевода.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '../public/i18n'), LANGS = ['en', 'es', 'pt', 'de', 'fr', 'tr'];
const cur = Object.fromEntries(LANGS.map((l) => { const f = path.join(DIR, l + '.json'); return [l, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}]; }));
const ph = (s) => (s.match(/\{\d+\}/g) || []).sort().join();
let bad = 0;
const added = Object.fromEntries(LANGS.map((l) => [l, new Set()])); // что пришло в этом запуске — это настоящий перевод
for (const f of process.argv.slice(2)) {
  for (const [ru, t] of Object.entries(JSON.parse(fs.readFileSync(f, 'utf8')))) {
    for (const l of LANGS) {
      if (typeof t[l] !== 'string' || !t[l].trim()) continue;
      if (ph(t[l]) !== ph(ru)) { bad++; console.log('подстановки не совпали:', l, ru, '→', t[l]); continue; }
      cur[l][ru] = t[l]; added[l].add(ru);
    }
  }
}
const all = JSON.parse(fs.readFileSync(path.join(DIR, 'strings.json'), 'utf8'));
// Запасной английский: фразы, которых нет на испанском, португальском, немецком, французском или турецком, берутся
// из английского — иностранный игрок увидит английский текст, а не русский. Свой перевод языка всегда главнее.
// Отдельно храним только собственные переводы (i18n/own/<язык>.json), чтобы запасные не считались переводом.
const OWN = path.join(__dirname, 'i18n_own'); // собственные переводы языков (без запасного английского)
fs.mkdirSync(OWN, { recursive: true });
for (const l of LANGS) {
  const f = path.join(OWN, l + '.json');
  if (fs.existsSync(f)) { const own = JSON.parse(fs.readFileSync(f, 'utf8')); for (const [k, v] of Object.entries(cur[l])) if (!(k in own) && !added[l].has(k) && v === cur.en[k] && l !== 'en') delete cur[l][k]; }
}
for (const l of LANGS) fs.writeFileSync(path.join(OWN, l + '.json'), JSON.stringify(Object.fromEntries(Object.keys(cur[l]).sort().map((k) => [k, cur[l][k]])), null, 0).replace(/","/g, '",\n"'));
for (const l of LANGS) {
  let fb = 0;
  if (l !== 'en') for (const [k, v] of Object.entries(cur.en)) if (!(k in cur[l])) { cur[l][k] = v; fb++; }
  if (fb) console.log(l, 'запасной английский:', fb);
  const sorted = Object.fromEntries(Object.keys(cur[l]).sort().map((k) => [k, cur[l][k]]));
  fs.writeFileSync(path.join(DIR, l + '.json'), JSON.stringify(sorted, null, 0).replace(/","/g, '",\n"'));
  console.log(l, Object.keys(sorted).length, 'фраз, без перевода:', all.filter((k) => !(k in sorted)).length);
}
if (bad) console.log('пропущено из-за подстановок:', bad);
