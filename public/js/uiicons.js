// Нарисованные значки валют вместо эмодзи во всех окнах (assets/ui/ic_*.webp).
// Следит за окнами (#sheetBody, #itemCard, HUD) и заменяет символы в тексте на картинки.
(() => {
  const MAP = { '💰': 'coin', '⭐': 'star', '❤️': 'hp', '🗡️': 'atk', '🎯': 'crit', '🛡️': 'def', '⏳': 'cd' };
  const ONLY = new Set(['💰', '⭐']); // в остальных местах эти символы — часть названий; заменяем только валюты
  const re = new RegExp([...ONLY].join('|'), 'g'), has = new RegExp([...ONLY].join('|'));
  const img = (k) => { const i = document.createElement('img'); i.className = 'ui-ic'; i.src = `assets/ui/ic_${MAP[k]}.webp`; i.alt = k; return i; };
  function fix(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (has.test(n.nodeValue) && !n.parentElement.closest('input,textarea,option') ? 1 : 2) });
    const nodes = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) nodes.push(n);
    for (const n of nodes) {
      const parts = n.nodeValue.split(re), found = n.nodeValue.match(re);
      const frag = document.createDocumentFragment();
      parts.forEach((t, i) => { if (t) frag.append(t); if (found[i]) frag.append(img(found[i])); });
      n.replaceWith(frag);
    }
  }
  const watch = (el) => { if (!el) return; fix(el); new MutationObserver(() => fix(el)).observe(el, { childList: true, subtree: true, characterData: true }); };
  const start = () => ['sheetBody', 'itemCard', 'sheetTitle'].forEach((id) => watch(document.getElementById(id)));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
