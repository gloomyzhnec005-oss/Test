// Сумка героя: экипировка, предметы, карточка предмета, соединение (merge) 5 → 1.
// Все действия идут на сервер: socket.emit('act', { op, ... }, ответ)
window.Bag = (() => {
  const $ = (id) => document.getElementById(id);
  let socket = null, inv = null, onChange = () => {};
  const ROMAN = ['', 'I', 'II', 'III'];
  const SLOT_NAMES = { weapon: '🗡️ Оружие', armor: '🛡️ Броня', jewel1: '💍 Бижутерия', jewel2: '💍 Бижутерия' };
  const BASE_NAMES = { atk: ['Атака', ''], hp: ['Здоровье', ''] };

  const act = (op, data = {}) => new Promise((res) => {
    if (!socket) return res({ error: 'Нет связи' });
    socket.emit('act', { op, ...data }, (r) => { if (r && r.gold !== undefined && inv) inv.gold = r.gold; res(r || {}); });
  });
  async function refresh() {
    const r = await act('inv');
    if (r.inv) { inv = r.inv; onChange(inv); }
    return inv;
  }
  function toast(t) { if (window.Town) Town.toast(t); }

  // ---------- Отрисовка ----------
  const statName = (k) => (BASE_NAMES[k] || (inv && inv.attrs[k]) || [k, ''])[0];
  const statUnit = (k) => { const u = (BASE_NAMES[k] || (inv && inv.attrs[k]) || ['', ''])[1]; return u === '−%' ? '%' : u; };
  const statLine = (k, v) => `${statName(k)} ${(inv && inv.attrs[k] && inv.attrs[k][1] === '−%') ? '−' : '+'}${v}${statUnit(k)}`;
  const cell = (it, extra = '') => `<button class="it ${extra}" data-id="${it.id}" style="--rc:${it.color}">
      <span>${it.icon}</span>${it.dupes ? `<em>+${it.dupes}</em>` : ''}<i>${ROMAN[it.tier]}</i>${it.runes && it.runes.length ? `<b>${it.runes.map((r) => r.icon).join('')}</b>` : ''}</button>`;
  function grid(items, onTap, opts = {}) {
    const box = document.createElement('div');
    box.className = 'it-grid';
    const RO = inv ? inv.rarOrder : [];
    const sorted = [...items].sort((a, b) => RO.indexOf(b.rar) - RO.indexOf(a.rar) || a.cat.localeCompare(b.cat));
    box.innerHTML = sorted.map((it) => cell(it, `${opts.selected && opts.selected.has(it.id) ? 'sel' : ''} ${isEquipped(it) ? 'eq' : ''}`)).join('')
      || `<div class="tw-soon" style="grid-column:1/-1">${opts.empty || 'Пусто'}</div>`;
    box.onclick = (e) => { const b = e.target.closest('.it'); if (b) onTap(items.find((i) => i.id === b.dataset.id), b); };
    return box;
  }
  const isEquipped = (it) => inv && Object.values(inv.equip || {}).includes(it.id);
  const slotOf = (it) => inv && Object.keys(inv.equip || {}).find((s) => inv.equip[s] === it.id);

  // Карточка предмета: статы, атрибуты, руны и кнопки действий
  function card(it, actions = []) {
    const wrap = $('itemCard');
    const c = wrap.querySelector('.item-card');
    const runes = it.cat === 'weapon' ? `<div class="ic-sec">Гнёзда для рун: ${it.runes.length} / ${it.sockets}</div>
      ${it.runes.map((r) => `<div class="ic-rune" style="color:${r.color}">${r.icon} ${r.name} · ${Object.entries(r.stats).map(([k, v]) => statLine(k, v)).join(', ')}</div>`).join('')}
      ${'<div class="ic-rune empty">◇ пустое гнездо</div>'.repeat(Math.max(0, it.sockets - it.runes.length))}` : '';
    c.style.setProperty('--rc', it.color);
    c.innerHTML = `<div class="ic-head"><span class="ic-icon">${it.icon}</span><div><b>${it.name}</b>
        <small>${it.rarName} · ${inv.cats[it.cat]} · мир ${ROMAN[it.tier]}${it.dupes ? ` · дубликаты +${it.dupes * 5}%` : ''}</small></div></div>
      <div class="ic-sec">Итоговые статы</div>
      ${Object.entries(it.stats).map(([k, v]) => `<div class="ic-stat">${statLine(k, v)}</div>`).join('')}
      <div class="ic-sec">Случайные атрибуты (${it.attrs.length})</div>
      ${it.attrs.map((a) => `<div class="ic-attr">◆ ${statLine(a.k, a.v)}</div>`).join('') || '<div class="ic-attr">—</div>'}
      ${runes}
      <div class="ic-btns"></div>`;
    const btns = c.querySelector('.ic-btns');
    for (const [label, fn, cls] of [...actions, ['Закрыть', null, 'ghost']]) {
      const b = document.createElement('button');
      b.className = 'l2-btn ' + (cls || '');
      b.textContent = label;
      b.onclick = async () => { if (fn && (await fn()) === false) return; wrap.classList.add('hidden'); };
      btns.append(b);
    }
    wrap.classList.remove('hidden');
  }
  $('itemCard').onclick = (e) => { if (e.target === $('itemCard')) $('itemCard').classList.add('hidden'); };

  // Стандартные действия с предметом
  function itemActions(it, ctx = {}) {
    const acts = [];
    const run = async (op, data, after) => { const r = await act(op, data); toast(r.error || r.toast || 'Готово'); await refresh(); if (after) after(r); return !r.error; };
    if (it.cat !== 'rune') {
      if (isEquipped(it)) acts.push(['Снять', () => run('unequip', { slot: slotOf(it) }, ctx.after)]);
      else acts.push(['Надеть', () => run('equip', { id: it.id }, ctx.after)]);
    }
    if (ctx.town && !isEquipped(it)) {
      acts.push([`Продать торговцу · ${it.sell} 💰`, () => run('sell', { id: it.id }, ctx.after), 'warn']);
    }
    return acts;
  }

  // ---------- Вкладки сумки ----------
  function equipTab() {
    const box = document.createElement('div');
    const h = inv.hero, H = Town.heroes()[h.id];
    const next = (Town.skillUnlock() || [])[h.unlocked];
    box.innerHTML = `<div class="bag-hero"><b>${H.name}</b> · ур. ${h.level} · ${'★'.repeat(Math.min(h.dupes, 10)) || '☆'} дубликаты ${h.dupes}
      <small>Умения: ${H.skills.map((s, i) => `<span class="${i < h.unlocked ? '' : 'lock'}">${i < h.unlocked ? s.icon : '🔒'} ${s.name}</span>`).join(' · ')}</small>
      ${next ? `<small class="hint">Следующее умение: ${next.lvl} уровень или ${next.dup} дубл.</small>` : ''}</div>
      <div class="bag-slots"></div><div class="ic-sec">Бонусы экипировки</div><div class="bag-gear"></div>`;
    const slots = box.querySelector('.bag-slots');
    for (const s of ['weapon', 'armor', 'jewel1', 'jewel2']) {
      const it = inv.items.find((i) => i.id === inv.equip[s]);
      const el = document.createElement('div');
      el.className = 'bag-slot';
      el.innerHTML = it ? `${cell(it)}<small style="color:${it.color}">${it.name}</small>` : `<button class="it empty"><span>＋</span></button><small>${SLOT_NAMES[s]}</small>`;
      el.querySelector('.it').onclick = () => (it ? card(it, itemActions(it, { after: rerender })) : openBag('bag'));
      slots.append(el);
    }
    const g = Object.entries(inv.gear);
    box.querySelector('.bag-gear').innerHTML = g.length ? g.map(([k, v]) => `<span>${statLine(k, v)}</span>`).join('') : '<span>Наденьте предметы</span>';
    return box;
  }
  function bagTab() {
    const box = document.createElement('div');
    let cat = 'all';
    const draw = () => {
      const items = inv.items.filter((i) => i.loc !== 'wh' && (cat === 'all' || i.cat === cat));
      box.innerHTML = `<div class="chips">${[['all', 'Все'], ...Object.entries(inv.cats)].map(([k, n]) => `<button data-c="${k}" class="${k === cat ? 'on' : ''}">${n}</button>`).join('')}</div>
        <p class="sheet-hint">Сумка ${inv.items.filter((i) => i.loc !== 'wh').length} / ${inv.bagSize} · 💰 ${inv.gold} · тап — подробнее</p>`;
      box.querySelector('.chips').onclick = (e) => { const b = e.target.closest('button'); if (b) { cat = b.dataset.c; draw(); } };
      box.append(grid(items, (it) => card(it, itemActions(it, { town: Town.inTown(), after: rerender })), { empty: 'Предметов нет — побеждайте монстров за порталами' }));
    };
    draw();
    return box;
  }
  // Соединение: 5 предметов одной категории и редкости → 1 следующей редкости, 3 случайных атрибута из пяти
  function mergeTab() {
    const box = document.createElement('div');
    const sel = new Set();
    const draw = () => {
      const first = inv.items.find((i) => sel.has(i.id));
      const items = inv.items.filter((i) => i.rar !== 'mythic' && (!first || (i.cat === first.cat && i.rar === first.rar)));
      const R = inv.rarities, RO = inv.rarOrder;
      box.innerHTML = `<p class="sheet-hint">Выберите 5 предметов одной категории и редкости → 1 предмет следующей редкости.
        Из всех атрибутов пяти предметов случайно останутся 3, остальные пропадут. Базовые статы — по новой редкости (не суммируются).</p>
        <div class="merge-slots">${[0, 1, 2, 3, 4].map((i) => { const it = inv.items.find((x) => x.id === [...sel][i]); return it ? cell(it) : '<button class="it empty"><span>·</span></button>'; }).join('')}
        <span class="arrow">→</span><button class="it empty res" ${first ? `style="--rc:${R[RO[RO.indexOf(first.rar) + 1]].color}"` : ''}><span>${first ? '?' : '·'}</span></button></div>
        <button class="l2-btn merge-go" ${sel.size === 5 ? '' : 'disabled'}>⚒️ Соединить (${sel.size}/5)${first ? ' → ' + R[RO[RO.indexOf(first.rar) + 1]].name : ''}</button>`;
      box.append(grid(items, (it) => { if (sel.has(it.id)) sel.delete(it.id); else if (sel.size < 5) sel.add(it.id); draw(); }, { selected: sel, empty: 'Нет предметов для соединения' }));
      box.querySelector('.merge-go').onclick = async () => {
        if (sel.size !== 5) return;
        const r = await act('merge', { ids: [...sel] });
        if (r.error) return toast(r.error);
        sel.clear();
        await refresh();
        draw();
        card(r.result, itemActions(r.result, { after: rerender }));
        toast(r.toast);
      };
    };
    draw();
    return box;
  }

  let rerender = () => {};
  async function openBag(tab = 'equip') {
    await refresh();
    if (!inv) return;
    const tabsList = [['Экипировка', equipTab], ['Сумка', bagTab], ['Соединение', mergeTab]];
    const show = (i) => { Town.open('🎒 Сумка', Town.tabs(tabsList, i)); rerender = () => show(Town.lastTab()); };
    show({ equip: 0, bag: 1, merge: 2 }[tab] || 0);
  }

  // Выбор предмета из сумки (для рынка, аукциона, рун)
  async function pick(title, filter, onPick) {
    await refresh();
    const items = inv.items.filter((i) => i.loc !== 'wh' && !isEquipped(i) && filter(i));
    const box = document.createElement('div');
    box.append(grid(items, (it) => onPick(it), { empty: 'Подходящих предметов нет' }));
    Town.open(title, box);
  }

  return {
    init: (o) => { socket = o.socket; onChange = o.onChange || onChange; },
    act, refresh, open: openBag, grid, cell, card, pick, itemActions, mergeTab, statLine, isEquipped,
    inv: () => inv,
  };
})();
