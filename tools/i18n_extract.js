// Собирает русские фразы игры для перевода: строки из клиента и сервера (кроме админки) и текст index.html.
// node tools/i18n_extract.js  →  public/i18n/strings.json (["фраза", ...]); подстановки ${...} записаны как {0}, {1}…
const fs = require('fs'), path = require('path'), ts = require('typescript');
const ROOT = path.join(__dirname, '..');
const FILES = [...fs.readdirSync(path.join(ROOT, 'public/js')).filter((f) => !/^(admin|i18n|mobart|skins|textures|worldart|skillart|itemart|backgrounds|sfx|settings)\.js$/.test(f)).map((f) => 'public/js/' + f),
  ...fs.readdirSync(path.join(ROOT, 'server')).filter((f) => f.endsWith('.js') && f !== 'admin.js').map((f) => 'server/' + f)];
const CYR = /[А-Яа-яЁё]/, out = new Set();
// Текст без HTML-тегов: каждая часть между тегами — отдельная фраза (так она окажется в узле страницы)
const add = (s) => { for (let part of s.split(/<[^>]*>/)) { part = part.replace(/&nbsp;/g, ' ').trim(); if (CYR.test(part)) out.add(part); } };
for (const f of FILES) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const walk = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) { if (CYR.test(n.text)) add(n.text); }
    else if (ts.isTemplateExpression(n)) {
      // `a ${x} b` → «a {} b»; вложенные шаблоны внутри ${} обходятся отдельно
      let s = n.head.text;
      n.templateSpans.forEach((sp, i) => { s += '{' + i + '}' + sp.literal.text; });
      if (CYR.test(s)) add(s);
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
}
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
for (const m of html.matchAll(/(?:placeholder|title|alt)="([^"]*)"/g)) add(m[1]);
for (const m of html.matchAll(/>([^<]+)</g)) add(m[1]);
const list = [...out].sort();
fs.writeFileSync(path.join(ROOT, 'public/i18n/strings.json'), JSON.stringify(list, null, 0).replace(/","/g, '",\n"'));
console.log(list.length, 'фраз');
