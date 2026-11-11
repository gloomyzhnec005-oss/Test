// Нарисованные значки вместо эмодзи во всех окнах (assets/ui/ic_*.webp).
// Следит за окнами (#sheetBody, #itemCard, заголовок, чат) и заменяет символы в тексте на картинки.
// Порядок важен: «🔮 Печати…» и «🎁 печать снаряжения» — печати призыва, остальные 🎁 — подарок (награда).
(() => {
  const VS = '\\uFE0F?';
  const SEAL = '(?=\\s*(?:печат|призыв|seal|summon|sell|selo|invoc|siegel|beschw|sceau|mühür|çağır|×))'; // слово «печать» на всех языках игры
  const TOKENS = [
    [`🔮${VS}${SEAL}`, 'sealHero'],
    [`🎁${VS}${SEAL}`, 'sealItem'],
    ['💰', 'coin'], ['⭐', 'star'], ['💎', 'gem'],
    [`🎟${VS}(?=\\s*\\+)`, 'passXp'], // «🎟️ +10» — опыт пропуска
    [`🎟${VS}`, 'pass'], ['🏆', 'cup'], ['🥇', 'medal1'], ['🥈', 'medal2'], ['🥉', 'medal3'],
    ['🎲', 'dice'], [`⚒${VS}`, 'craft'], [`♻${VS}`, 'salvage'], [`⬆${VS}`, 'up'], [`✔${VS}`, 'done'],
    ['📢', 'horn'], ['📜', 'scroll'], ['🎁', 'gift'],
  ];
  const re = new RegExp(TOKENS.map(([t]) => `(${t})`).join('|'), 'giu');
  const test = new RegExp(re.source, 'iu');
  const img = (file, alt) => { const i = document.createElement('img'); i.className = 'ui-ic'; i.src = `assets/ui/ic_${file}.webp`; i.alt = alt; return i; };
  function fix(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (test.test(n.nodeValue) && !n.parentElement.closest('input,textarea,option,select') ? 1 : 2) });
    const nodes = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) nodes.push(n);
    for (const n of nodes) {
      const s = n.nodeValue, frag = document.createDocumentFragment();
      let last = 0;
      re.lastIndex = 0;
      for (let m = re.exec(s); m; m = re.exec(s)) {
        if (m.index > last) frag.append(s.slice(last, m.index));
        const k = m.slice(1).findIndex((g) => g !== undefined);
        frag.append(img(TOKENS[k][1], m[0]));
        last = m.index + m[0].length;
      }
      if (last < s.length) frag.append(s.slice(last));
      n.replaceWith(frag);
    }
  }
  const watch = (el) => { if (!el) return; fix(el); new MutationObserver(() => fix(el)).observe(el, { childList: true, subtree: true, characterData: true }); };
  const start = () => ['sheetBody', 'itemCard', 'sheetTitle', 'chatList', 'chatLog', 'partyInvite'].forEach((id) => watch(document.getElementById(id)));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
