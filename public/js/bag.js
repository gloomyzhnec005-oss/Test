// Сумка героя: экипировка, предметы, карточка предмета, соединение (merge) 5 → 1.
// Все действия идут на сервер: socket.emit('act', { op, ... }, ответ)
window.Bag = (() => {
  const $ = (id) => document.getElementById(id);
  let socket = null, inv = null, onChange = () => {};
  const ROMAN = ['', 'I', 'II', 'III'];
  const SLOT_ICONS = { weapon: '🗡️', helm: '⛑️', armor: '🛡️', gloves: '🧤', boots: '🥾', ring: '💍', amulet: '📿' };
  const ART = new Set(window.ITEM_ART || []);
  // Картинка предмета или эмодзи, если её ещё не нарисовали
  const art = (it) => {
    const k = it.cat === 'mat' ? 'mat_' + it.mat : it.cat + '_' + it.tpl;
    return ART.has(k) ? `<img class="it-art" src="assets/items/${k}.webp" alt="" draggable="false">` : it.icon;
  };
  const mini = (it) => (ART.has(it.cat + '_' + it.tpl) ? `<img class="it-mini" src="assets/items/${it.cat}_${it.tpl}.webp" alt="">` : it.icon);
  const SOCKET = '<img class="it-mini" src="assets/items/ui_socket.webp" alt="">';
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
  const cell = (it, extra = '') => `<button class="it ${extra} ${it.set ? 'set' : ''}" data-id="${it.id}" style="--rc:${it.color}">
      <span>${art(it)}</span>${it.dupes ? `<em>+${it.dupes}</em>` : it.n > 1 ? `<em>×${it.n}</em>` : ''}<i>${ROMAN[it.tier] || ''}</i>${it.runes && it.runes.length ? `<b>${it.runes.map(mini).join('')}</b>` : ''}${it.set ? '<s>◆</s>' : ''}</button>`;
  function grid(items, onTap, opts = {}) {
    const box = document.createElement('div');
    box.className = 'it-grid';
    const RO = inv ? inv.rarOrder : [];
    const sorted = opts.keepOrder ? items : [...items].sort((a, b) => RO.indexOf(b.rar) - RO.indexOf(a.rar) || a.cat.localeCompare(b.cat));
    const pad = opts.fill ? Math.max(0, opts.fill - sorted.length) : 0;
    box.innerHTML = (sorted.map((it) => cell(it, `${opts.selected && opts.selected.has(it.id) ? 'sel' : ''} ${isEquipped(it) ? 'eq' : ''}`)).join('')
      || (opts.fill ? '' : `<div class="tw-soon" style="grid-column:1/-1">${opts.empty || 'Пусто'}</div>`)) + '<i class="it-none"></i>'.repeat(pad);
    if (opts.fill) box.classList.add('filled');
    box.onclick = (e) => { const b = e.target.closest('.it'); if (b) onTap(items.find((i) => i.id === b.dataset.id), b); };
    return box;
  }
  const isEquipped = (it) => inv && Object.values(inv.equip || {}).includes(it.id);
  const slotOf = (it) => inv && Object.keys(inv.equip || {}).find((s) => inv.equip[s] === it.id);

  const diff = (d) => (d ? `<u class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(Math.round(d * 10) / 10)}</u>` : '<u>=</u>');
  // Карточка предмета: статы, атрибуты, руны и кнопки действий
  const heroName = (id) => (Town.heroes()[id] || {}).name || id;
  // Блок комплекта в карточке: класс, герои, бонусы (активные подсвечены)
  function setBlock(it) {
    const s = it.set;
    if (!s) return '';
    const worn = (inv && inv.sets.counts[s.id]) || 0, mine = inv && inv.sets.cls === s.cls;
    return `<div class="ic-sec">◆ ${s.name} · ${s.clsName} · надето ${worn} / 7</div>
      <div class="ic-attr">Для героев: ${s.heroes.map(heroName).join(', ')}</div>
      ${mine ? '' : `<div class="ic-attr warn">Бонусы комплекта работают только у героев класса «${s.clsName}»</div>`}
      ${s.bonus.map(([n, st]) => `<div class="ic-rune ${mine && worn >= n ? 'on' : ''}">${n} предм.: ${Object.entries(st).map(([k, v]) => statLine(k, v)).join(', ')}</div>`).join('')}`;
  }
  function matCard(m, actions) {
    const wrap = $('itemCard'), c = wrap.querySelector('.item-card');
    c.style.setProperty('--rc', m.color);
    c.innerHTML = `<div class="ic-head"><span class="ic-icon">${art(m)}</span><div><b>${m.name}</b><small>${m.rarName} · в наличии ${m.n}</small></div></div>
      <div class="ic-attr">${m.desc}</div><div class="ic-btns"></div>`;
    addBtns(c, wrap, actions);
    wrap.classList.remove('hidden');
  }
  function addBtns(c, wrap, actions) {
    const btns = c.querySelector('.ic-btns');
    for (const [label, fn, cls] of [...actions, ['Закрыть', null, 'ghost']]) {
      const b = document.createElement('button');
      b.className = 'l2-btn ' + (cls || '');
      b.textContent = label;
      b.onclick = async () => { if (fn && (await fn()) === false) return; wrap.classList.add('hidden'); };
      btns.append(b);
    }
  }
  function card(it, actions, cmp) {
    if (it.cat === 'mat') return matCard(it, actions || []);
    actions = actions || [];
    const wrap = $('itemCard');
    const c = wrap.querySelector('.item-card');
    const runes = it.cat === 'weapon' ? `<div class="ic-sec">Гнёзда для рун: ${it.runes.length} / ${it.sockets}</div>
      ${it.runes.map((r) => `<div class="ic-rune" style="color:${r.color}">${mini(r)} ${r.name} · ${Object.entries(r.stats).map(([k, v]) => statLine(k, v)).join(', ')}</div>`).join('')}
      ${`<div class="ic-rune empty">${SOCKET} пустое гнездо</div>`.repeat(Math.max(0, it.sockets - it.runes.length))}` : '';
    c.style.setProperty('--rc', it.color);
    c.innerHTML = `<div class="ic-head"><span class="ic-icon">${art(it)}</span><div><b>${it.name}</b>
        <small>${it.rarName} · ${inv.cats[it.cat]} · мир ${ROMAN[it.tier]}${it.dupes ? ` · дубликаты +${it.dupes * 5}%` : ''}</small></div></div>
      ${setBlock(it)}
      <div class="ic-sec">Итоговые статы</div>
      ${Object.entries(it.stats).map(([k, v]) => `<div class="ic-stat">${statLine(k, v)}${cmp ? diff(v - ((cmp.stats || {})[k] || 0)) : ''}</div>`).join('')}
      ${cmp ? `<div class="ic-attr">Сравнение с надетым: ${cmp.name}</div>` : ''}
      <div class="ic-sec">Случайные атрибуты (${it.attrs.length})</div>
      ${it.attrs.map((a) => `<div class="ic-attr">◆ ${statLine(a.k, a.v)}</div>`).join('') || '<div class="ic-attr">—</div>'}
      ${runes}
      <div class="ic-btns"></div>`;
    addBtns(c, wrap, actions);
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
      acts.push(['⚒️ В кузницу', () => { setTimeout(() => Town.openPlace('smith', it.id), 50); }]);
    }
    return acts;
  }

  // Действия с материалом/расходником: использовать, открыть ларец (с выбором класса), продать торговцу
  function matActions(m, after = () => rerender()) {
    const acts = [];
    const run = async (op, data) => { const r = await act(op, data); toast(r.error || r.toast || 'Готово'); await refresh(); after(); return !r.error; };
    if (m.mat === 'chestSet') {
      acts.push(['Открыть: мой класс', () => run('useMat', { mat: m.mat })]);
      acts.push(['Выбрать класс…', () => { chooseClass((cls) => run('useMat', { mat: m.mat, cls })); }]);
    } else if (m.usable) acts.push([m.kind === 'chest' ? 'Открыть' : 'Использовать', () => run('useMat', { mat: m.mat })]);
    if (Town.inTown() && m.sell) {
      acts.push([`Продать торговцу · ${m.sell} 💰`, () => run('sellMat', { mat: m.mat, n: 1 }), 'warn']);
      if (m.n > 1) acts.push([`Продать все ×${m.n} · ${m.sell * m.n} 💰`, () => run('sellMat', { mat: m.mat, n: m.n }), 'warn']);
    }
    return acts;
  }
  const CLASS_LIST = { warrior: '🪓 Воитель', knight: '🛡️ Рыцарь', rogue: '🗡️ Тень', hunter: '🏹 Охотник', elemental: '🔥 Стихийник', dark: '💀 Чернокнижник', nature: '🌿 Друид', holy: '✨ Светоносец' };
  function chooseClass(onPick) {
    const box = document.createElement('div');
    box.innerHTML = '<p class="sheet-hint">Вещь какого класса достать из ларца?</p>';
    for (const [k, n] of Object.entries(CLASS_LIST)) {
      const b = document.createElement('button'); b.className = 'l2-btn wide'; b.textContent = n;
      b.onclick = () => { onPick(k); Town.close(); };
      box.append(b);
    }
    setTimeout(() => Town.open('🎁 Ларец комплекта', box), 50);
  }

  // ---------- Персонаж: кукла героя с ячейками по бокам и гардероб ----------
  const SIDE = { left: ['helm', 'armor', 'gloves', 'boots'], right: ['weapon', 'amulet', 'ring'] };
  let heroSel = null;
  const worn = (s) => inv.items.find((i) => i.id === inv.equip[s]);
  const fits = (s) => inv.items.filter((i) => i.cat === s && i.loc !== 'wh' && !isEquipped(i));
  function slotBtn(s) {
    const it = worn(s), n = fits(s).length;
    return `<button class="pd-slot ${it ? 'full' : ''} ${s === heroSel ? 'on' : ''}" data-s="${s}" style="--rc:${it ? it.color : '#5a4830'}">
      ${it ? `<span>${art(it)}</span><i>${ROMAN[it.tier] || ''}</i>${it.set ? '<s>◆</s>' : ''}` : `<span class="ghost">${SLOT_ICONS[s]}</span>`}
      ${n ? `<b>${n}</b>` : ''}<em>${it ? it.name : inv.slotNames[s]}</em></button>`;
  }
  function heroTab() {
    const box = document.createElement('div');
    const h = inv.hero, H = Town.heroes()[h.id], P = inv.power || {};
    if (!heroSel) heroSel = inv.slots.find((s) => !worn(s) && fits(s).length) || 'weapon';
    box.innerHTML = `<div class="pd">
        <div class="pd-col">${SIDE.left.map(slotBtn).join('')}</div>
        <div class="pd-stage"><i class="pd-glow"></i><div class="pd-art"></div><i class="pd-ped"></i>
          <div class="pd-name"><b>${H.name}</b><small>ур. ${h.level} · ${'★'.repeat(Math.min(h.dupes, 5)) || '☆'}${h.dupes > 5 ? '+' + (h.dupes - 5) : ''}</small></div></div>
        <div class="pd-col">${SIDE.right.map(slotBtn).join('')}<button class="pd-slot pd-bag" data-go="bag"><span>🎒</span><em>Сумка</em></button></div>
      </div>
      <div class="pd-power"><span class="pw">⚜️ Сила <b>${P.power || '—'}</b></span><span>❤️ ${P.hp || '—'}</span><span>🗡️ ${P.dmg || '—'}</span><span>🎯 ${P.crit || 0}%</span></div>
      <div class="pd-ward"></div>`;
    const art = window.Lobby && Lobby.heroCanvas(h.id, true);
    if (art) box.querySelector('.pd-art').append(art);
    box.querySelector('.pd').onclick = (e) => {
      const b = e.target.closest('.pd-slot');
      if (!b) return;
      if (b.dataset.go) return openBag('bag');
      heroSel = b.dataset.s;
      box.querySelectorAll('.pd-slot').forEach((x) => x.classList.toggle('on', x.dataset.s === heroSel));
      drawWard();
    };
    const ward = box.querySelector('.pd-ward');
    const drawWard = () => {
      const s = heroSel, cur = worn(s), list = fits(s);
      ward.innerHTML = `<div class="ward-head"><b>👘 Гардероб · ${inv.slotNames[s]}</b><small>${list.length ? `в сумке ${list.length}` : 'в сумке нет'}</small></div>
        ${cur ? `<div class="ward-cur" style="--rc:${cur.color}">${cell(cur, 'eq')}<div><b style="color:${cur.color}">${cur.name}</b>
          <small>${Object.entries(cur.stats).map(([k, v]) => statLine(k, v)).join(' · ')}</small></div><button class="l2-btn" data-a="info">ⓘ</button><button class="l2-btn" data-a="off">Снять</button></div>`
        : '<div class="ward-cur none">Ячейка пуста — выберите вещь ниже</div>'}`;
      ward.append(grid(list, (it) => card(it, itemActions(it, { town: Town.inTown(), after: rerender }), cur), {
        fill: Math.max(6, Math.ceil(list.length / 6) * 6), empty: '' }));
      if (!list.length) ward.insertAdjacentHTML('beforeend', '<p class="sheet-hint">Вещи этого типа падают с монстров и продаются в лавке оружия и доспехов</p>');
      const ab = (a) => ward.querySelector(`[data-a="${a}"]`);
      if (cur) {
        ab('info').onclick = () => card(cur, itemActions(cur, { after: rerender }));
        ab('off').onclick = async () => { const r = await act('unequip', { slot: s }); toast(r.error || r.toast || 'Снято'); await refresh(); rerender(); };
        ward.querySelector('.ward-cur .it').onclick = () => ab('info').onclick();
      }
    };
    drawWard();
    return box;
  }
  function statsTab() {
    const box = document.createElement('div');
    const h = inv.hero, H = Town.heroes()[h.id], P = inv.power || {};
    const next = (Town.skillUnlock() || [])[h.unlocked];
    const g = Object.entries(inv.gear);
    const sets = Object.entries(inv.sets.counts);
    box.innerHTML = `<div class="st-grid">
        <div><small>Сила героя</small><b>${P.power || '—'}</b></div><div><small>Здоровье</small><b>${P.hp || '—'}</b></div>
        <div><small>Атака</small><b>${P.dmg || '—'}</b></div><div><small>Крит</small><b>${P.crit || 0}%</b></div>
        <div><small>Уровень</small><b>${h.level}</b></div><div><small>Дубликаты</small><b>${h.dupes}</b></div></div>
      <div class="ic-sec">Умения</div>
      <div class="st-skills">${H.skills.map((sk, i) => `<div class="${i < h.unlocked ? '' : 'lock'}"><span>${SkillArt.icon(h.id, i, i < h.unlocked ? sk.icon : '🔒')}</span><b>${sk.name}</b></div>`).join('')}</div>
      ${H.passive ? `<div class="st-skills"><div class="pas"><span>${SkillArt.icon(h.id, 'p', H.passive.icon)}</span><b>${H.passive.name} · пассивный</b></div></div>` : ''}
      ${next ? `<p class="sheet-hint">Следующее умение: ${next.lvl} уровень или ${next.dup} дубл.</p>` : ''}
      <div class="ic-sec">Бонусы экипировки</div>
      <div class="bag-gear">${g.length ? g.map(([k, v]) => `<span>${statLine(k, v)}</span>`).join('') : '<span>Наденьте предметы</span>'}</div>
      <div class="ic-sec">◆ Комплекты · ваш класс: ${inv.sets.clsName || '—'}</div>
      ${sets.length ? sets.map(([sid, n]) => {
        const it = inv.items.find((i) => i.set && i.set.id === sid);
        const on = inv.sets.active.filter((a) => a.set === sid);
        return `<div class="ic-rune ${on.length ? 'on' : ''}">${it ? it.set.name : sid} · ${n}/7 ${on.length ? '· ' + on.map((a) => `${a.need}: ${Object.entries(a.stats).map(([k, v]) => statLine(k, v)).join(', ')}`).join(' · ') : it && it.set.cls !== inv.sets.cls ? '· не ваш класс' : '· бонус с 2 вещей'}</div>`;
      }).join('') : '<div class="ic-attr">Соберите 2, 4 или все 7 вещей комплекта своего класса — бонусы растут</div>'}`;
    return box;
  }

  // ---------- Инвентарь: сетка ячеек, вкладки по типам, золото и вместимость внизу ----------
  const INV_TABS = [
    ['all', 'Все', () => true], ['wpn', '⚔️ Оружие', (c) => c === 'weapon'], ['arm', '🛡️ Броня', (c) => ['helm', 'armor', 'gloves', 'boots'].includes(c)],
    ['acc', '💍 Бижутерия', (c) => c === 'ring' || c === 'amulet'], ['rune', '🔮 Руны', (c) => c === 'rune'], ['mat', '🧪 Ресурсы', null],
  ];
  const SORTS = [['rar', 'по редкости'], ['type', 'по типу'], ['new', 'новые']];
  let invCat = 'all', invSort = 0;
  function bagTab() {
    const box = document.createElement('div');
    const draw = () => {
      const T = INV_TABS.find((t) => t[0] === invCat);
      const inBag = inv.items.filter((i) => i.loc !== 'wh');
      let items = invCat === 'mat' ? inv.mats : inBag.filter((i) => T[2](i.cat));
      const RO = inv.rarOrder, so = SORTS[invSort][0];
      if (invCat !== 'mat') items = so === 'new' ? [...items].reverse() : [...items].sort((a, b) => so === 'type'
        ? inv.slots.indexOf(a.cat) - inv.slots.indexOf(b.cat) || RO.indexOf(b.rar) - RO.indexOf(a.rar)
        : RO.indexOf(b.rar) - RO.indexOf(a.rar) || inv.slots.indexOf(a.cat) - inv.slots.indexOf(b.cat));
      const used = inBag.length, cap = inv.bagSize;
      const fill = invCat === 'all' ? Math.max(cap, Math.ceil(items.length / 6) * 6) : Math.max(18, Math.ceil(items.length / 6) * 6);
      box.innerHTML = `<div class="inv-tabs">${INV_TABS.map(([k, n]) => `<button data-c="${k}" class="${k === invCat ? 'on' : ''}">${n}</button>`).join('')}</div>`;
      box.append(grid(items, (it) => {
        if (it.cat === 'mat') return card(it, matActions(it));
        const cur = it.cat !== 'rune' && !isEquipped(it) ? worn(it.cat) : null;
        card(it, itemActions(it, { town: Town.inTown(), after: rerender }), cur);
      }, { keepOrder: true, fill }));
      if (!items.length) box.insertAdjacentHTML('beforeend', `<p class="sheet-hint">${invCat === 'mat' ? 'Материалы, свитки и зелья падают с монстров и продаются в лавках' : 'Пусто — побеждайте монстров за порталами'}</p>`);
      box.insertAdjacentHTML('beforeend', `<div class="inv-foot">
        <span class="gold">💰 ${inv.gold.toLocaleString('ru-RU')}</span>
        <span class="cap"><i style="width:${Math.min(100, (100 * used) / cap)}%" class="${used >= cap ? 'full' : ''}"></i><em>${used} / ${cap}</em></span>
        <button class="l2-btn" data-sort>⇅ ${SORTS[invSort][1]}</button></div>`);
      box.querySelector('.inv-tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) { invCat = b.dataset.c; draw(); } };
      box.querySelector('[data-sort]').onclick = () => { invSort = (invSort + 1) % SORTS.length; draw(); };
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
  async function openBag(tab = 'hero') {
    await refresh();
    if (!inv) return;
    const hero = tab === 'hero' || tab === 'equip';
    const tabsList = hero ? [['Снаряжение', heroTab], ['Характеристики', statsTab]] : [['Предметы', bagTab], ['Соединение 5 → 1', mergeTab]];
    const show = (i) => { Town.open(hero ? '🧙 Персонаж' : '🎒 Инвентарь', Town.tabs(tabsList, i), 'tall dark'); rerender = () => show(Town.lastTab()); };
    show(tab === 'merge' ? 1 : 0);
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
    act, refresh, art, open: openBag, grid, cell, card, pick, itemActions, matActions, mergeTab, statLine, isEquipped,
    inv: () => inv,
  };
})();
