// Окна городских мест: склад, магазины, кузница (соединение), руны, мастера, аукцион, рынок,
// события, телепорт, призыв, PvP-арена, данж выживания, батл-пасс и магазин (подписка, крутки, реклама).
window.Town = (() => {
  const $ = (id) => document.getElementById(id);
  let ctx = {}; // { socket, zone, towns, hero, heroes, skillUnlock, onGacha, api, tg }
  let lastTabIdx = 0;
  const TIER_LABEL = { 1: 'Ассортимент мира I', 2: 'Ассортимент мира II (продвинутый)', 3: 'Ассортимент мира III (небесный)' };
  const ROMAN = ['', 'I', 'II', 'III'];

  // Нарисованные значки мест в заголовке окна (по эмодзи в начале названия)
  const TITLE_ART = { '📚': 'trainer', '📦': 'warehouse', '⚔️': 'equip', '🧪': 'alchemy', '🔨': 'smith', '💠': 'runes', '📖': 'trainer', '🏛️': 'auction', '🏪': 'market',
    '📜': 'events', '🎰': 'gacha', '🌀': 'teleport', '🏟️': 'arena', '💀': 'survival', '🎟️': 'pass', '💎': 'store', '👥': 'party', '🛡️': 'clan' };
  // Нарисованный знак ордена сезона (assets/ui/order_<id>.webp), эмодзи — если картинки нет
  const orderIc = (t, sz = '') => (t ? `<img class="order-img ${sz}" src="assets/ui/order_${t.id}.webp" alt="${t.icon}" onerror="this.replaceWith(this.alt)">` : '');
  const placeImg = (id) => `<img class="place-ic" src="assets/ui/place_${id}.webp" alt="">`;
  const NAV_TITLE = { '⚔️ Игра': 'play', '⚙️ Настройки': 'more', '🧙 Персонаж': 'hero', '🎒 Инвентарь': 'bag' };
  const PANEL_BG = { '🏟️': 'arena', '💀': 'survival', '🔨': 'smith', '🏛️': 'auction', '📦': 'warehouse', '⚔️': 'equip', '🧪': 'alchemy', '💠': 'runes', '📖': 'trainer', '📜': 'quests', '🎰': 'gacha', '🌀': 'teleport', '💎': 'store', '🛡️': 'clan', '🎟️': 'pass' };
  function open(title, body, cls = '') {
    const em = Object.keys(TITLE_ART).find((e) => title.startsWith(e + ' '));
    if (NAV_TITLE[title]) $('sheetTitle').innerHTML = `<img class="place-ic" src="assets/ui/nav_${NAV_TITLE[title]}.webp" alt="">` + title.slice(title.indexOf(' ') + 1);
    else if (em) $('sheetTitle').innerHTML = placeImg(TITLE_ART[em]) + title.slice(em.length + 1).replace(/[<&]/g, '');
    else $('sheetTitle').textContent = title;
    // Нарисованный фон окна (assets/ui/bg_<имя>.webp) для арены, выживания и кузницы
    const bg = !NAV_TITLE[title] && Object.entries(PANEL_BG).find(([e]) => title.startsWith(e + ' '));
    $('sheet').querySelector('.sheet-card').className = 'sheet-card l2-panel ' + cls + (bg ? ' bg-' + bg[1] : '');
    const sb = $('sheetBody');
    sb.innerHTML = '';
    sb.append(body);
    $('sheet').classList.remove('hidden');
    if (window.Sfx) Sfx.play('open');
  }
  function close() { $('sheet').classList.add('hidden'); $('itemCard').classList.add('hidden'); }
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };
  const soon = (text) => `<div class="tw-soon">${text}</div>`;
  let toastTm = 0;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(toastTm);
    toastTm = setTimeout(() => t.classList.add('hidden'), 2200);
  }
  const fmtLeft = (ms) => { if (ms <= 0) return 'завершается'; const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60; return d ? `${d} д ${h} ч` : h ? `${h} ч ${m} мин` : `${m} мин`; };

  // Вкладки: [[подпись, html | () => Node]]
  function tabs(list, initial = 0) {
    const box = document.createElement('div');
    const bar = document.createElement('div');
    bar.className = 'tw-tabs';
    const page = document.createElement('div');
    page.className = 'tw-page';
    const show = async (i) => {
      lastTabIdx = i;
      [...bar.children].forEach((b, k) => b.classList.toggle('on', k === i));
      const c = list[i][1];
      page.innerHTML = '';
      const v = typeof c === 'function' ? await c() : c;
      if (typeof v === 'string') page.innerHTML = v; else if (v) page.append(v);
    };
    list.forEach(([label], i) => {
      const b = document.createElement('button');
      b.className = 'tw-tab';
      b.textContent = label;
      b.onclick = () => show(i);
      bar.append(b);
    });
    box.append(bar, page);
    show(initial);
    return box;
  }
  const slots = (n) => `<div class="tw-slots">${'<i></i>'.repeat(n)}</div>`;

  // Покупка за Telegram Stars (в тестовом режиме DEV_PAYMENTS зачисляется сразу)
  // Покупка за Stars или TON (окно выбора — public/js/pay.js)
  const buyStars = (item, after) => Pay.buy(item, { onPaid: after, toast });

  // Строка товара/лота: ячейка предмета + текст + кнопка
  function row(it, title, sub, btnLabel, onBtn, disabled = false) {
    const r = el(`<div class="tw-ev"><div class="row-it"></div><div><b style="color:${it ? it.color : '#ffe9b0'}">${title}</b><small>${sub}</small></div>
      ${btnLabel ? `<button class="l2-btn" ${disabled ? 'disabled' : ''}>${btnLabel}</button>` : ''}</div>`).firstElementChild;
    if (it) { r.querySelector('.row-it').innerHTML = Bag.cell(it); r.querySelector('.row-it').onclick = () => Bag.card(it); }
    if (btnLabel) r.querySelector('.l2-btn').onclick = onBtn; // именно кнопка цены: тап по картинке предмета открывает карточку, а не покупает
    return r;
  }

  // ---------- Магазины ----------
  // Строка товара-материала: кнопки ×1 / ×5 / ×10 (с учётом дневного лимита)
  function matRow(o, kind, reload) {
    const m = o.mat;
    const r = el(`<div class="tw-ev"><div class="row-it">${Bag.cell(m)}</div><div><b style="color:${m.color}">${m.icon} ${m.name}</b>
      <small>${o.price} 💰 за шт.${o.left !== null ? ` · осталось сегодня ${o.left}` : ''}</small><small>${m.desc}</small></div><div class="btn-col"></div></div>`).firstElementChild;
    r.querySelector('.row-it').onclick = () => Bag.card(m, []);
    // Количество — ползунком (до 50, лимита на сегодня и того, на что хватает золота), покупка — одной кнопкой
    const col = r.querySelector('.btn-col');
    const max = Math.max(0, Math.min(50, o.left !== null ? o.left : 50, Math.floor((o.gold || 0) / o.price)));
    const qty = el(`<div class="qty"><div class="qty-row"><button class="qty-pm" data-d="-1">−</button><input type="range" min="1" max="${Math.max(1, max)}" value="1"><button class="qty-pm" data-d="1">+</button></div>
      <button class="l2-btn qty-buy"></button></div>`).firstElementChild;
    const rng = qty.querySelector('input'), buy = qty.querySelector('.qty-buy');
    const upd = () => { const n = +rng.value; buy.textContent = max ? `Купить ×${n} · ${(o.price * n).toLocaleString('ru-RU')} 💰` : o.sold ? 'Лимит на сегодня' : 'Не хватает золота'; };
    rng.oninput = upd;
    qty.querySelectorAll('.qty-pm').forEach((b) => { b.onclick = () => { rng.value = Math.min(max, Math.max(1, +rng.value + +b.dataset.d)); upd(); }; });
    rng.disabled = buy.disabled = o.sold || max < 1;
    buy.onclick = async () => { buy.disabled = true; const res = await Bag.act('buy', { kind, oid: o.oid, n: +rng.value }); toast(res.error || res.toast); reload(); };
    upd();
    col.append(qty);
    return r;
  }
  async function shopList(kind) {
    const r = await Bag.act('shop', { kind });
    const box = document.createElement('div');
    const reload = async () => { const nb = await shopList(kind); box.replaceWith(nb); };
    box.innerHTML = `<p class="sheet-hint">${TIER_LABEL[ctx.zone.tier]} · ${kind === 'alchemy' || kind === 'smith' ? 'товары не кончаются (кроме отмеченных)' : 'витрина обновляется каждый день'} · 💰 ${r.gold}</p>`;
    for (const o of r.offers || []) {
      const it = o.item;
      if (o.mat) { box.append(matRow({ ...o, gold: r.gold }, kind, reload)); continue; }
      box.append(row(it, it.name, `${it.rarName} · ${Object.entries(it.stats).map(([k, v]) => Bag.statLine(k, v)).join(', ')}`,
        o.sold ? 'Куплено' : `${o.price} 💰`, async () => { const res = await Bag.act('buy', { kind, oid: o.oid }); toast(res.error || res.toast); reload(); }, o.sold));
    }
    return box;
  }
  // Возврат сегодняшних покупок из лавок — золото назад полностью
  async function refundTab() {
    const r = await Bag.act('buys');
    const wrap = el('<p class="sheet-hint">Случайно купили? Сегодняшние покупки в лавках можно вернуть — золото вернётся полностью. Предмет должен быть в сумке, не надет и не усилен.</p>');
    if (!(r.buys || []).length) { wrap.insertAdjacentHTML('beforeend', '<div class="tw-soon">Сегодня вы ничего не покупали в лавках</div>'); return wrap; }
    for (const b of r.buys) {
      const it = b.item || b.mat;
      const t = new Date(b.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const line = row(it, it ? `${it.name}${b.mat ? ` ×${b.n}` : ''}` : b.name || 'Покупка', `${t} · ${b.gold.toLocaleString('ru-RU')} 💰${b.ok ? '' : ` · ${b.why}`}`,
        `Вернуть · ${b.gold.toLocaleString('ru-RU')} 💰`, async () => { const res = await Bag.act('refund', { id: b.id }); toast(res.error || res.toast); wrap.replaceWith(await refundTab()); }, !b.ok);
      wrap.append(line);
    }
    return wrap;
  }
  async function shopPanel(kind, title) {
    const sellTab = async () => {
      const inv = await Bag.refresh();
      const box = el('<p class="sheet-hint">Продажа торговцу — тап по предмету. Дороже можно продать игрокам на рынке и аукционе.</p>');
      box.append(Bag.grid(inv.mats, (m) => Bag.card(m, Bag.matActions(m, () => shopPanel(kind, title))), { empty: 'Ресурсов нет', keepOrder: true }));
      return box;
    };
    open(title, tabs([['Купить', () => shopList(kind)], ['Продать', sellTab], ['Возврат', refundTab]]));
  }

  // ---------- Склад ----------
  async function warehousePanel() {
    const inv = await Bag.refresh();
    const box = document.createElement('div');
    const move = async (it) => { const r = await Bag.act('store', { id: it.id }); toast(r.error || r.toast); warehousePanel(); };
    const bag = inv.items.filter((i) => i.loc !== 'wh' && !Bag.isEquipped(i)), wh = inv.items.filter((i) => i.loc === 'wh');
    box.innerHTML = `<p class="sheet-hint">Общий склад аккаунта · тап по предмету — перенести</p><div class="ic-sec"><img class="ui-ic" src="assets/ui/nav_bag.webp" alt=""> <span>Сумка</span> ${inv.items.filter((i) => i.loc !== 'wh').length} / ${inv.bagSize}</div>`;
    box.append(Bag.grid(bag, move, { empty: 'Сумка пуста' }));
    box.insertAdjacentHTML('beforeend', `<div class="ic-sec"><img class="ui-ic" src="assets/ui/place_warehouse.webp" alt=""> <span>Склад</span> ${wh.length} / ${inv.whSize}</div>`);
    // Улучшение склада: +50 ячеек за уровень
    const nx = inv.whNext;
    box.insertAdjacentHTML('beforeend', nx
      ? `<div class="tw-ev wh-up"><div><b>⬆️ Улучшить склад · ур. ${inv.whLvl} → ${inv.whLvl + 1}</b><small>+${nx.slots} ячеек (станет ${inv.whSize + nx.slots}) · ${nx.stars ? `${nx.stars} ⭐` : `${nx.gold.toLocaleString('ru-RU')} 💰`}${nx.gems ? ` + ${nx.gems} 💎` : ''}</small></div><button class="l2-btn" id="whUp">${nx.stars ? `${nx.stars} ⭐` : 'Улучшить'}</button></div>`
      : `<div class="tw-ev wh-up"><div><b>📦 Склад улучшен до максимума</b><small>Уровень ${inv.whLvl} из ${inv.whMax}</small></div></div>`);
    const up = box.querySelector('#whUp');
    if (up) up.onclick = async () => {
      if (nx.stars) { buyStars(nx.kind, warehousePanel); return; } // последние уровни склада — за Stars
      const r = await Bag.act('whUpgrade'); toast(r.error || r.toast); if (!r.error) warehousePanel();
    };
    box.append(Bag.grid(wh, move, { empty: 'Склад пуст' }));
    open('📦 Склад', box);
  }

  // ---------- Рунная мастерская ----------
  async function runesBody(weaponId) {
    const inv = await Bag.refresh();
    const weapons = inv.items.filter((i) => i.cat === 'weapon');
    const box = document.createElement('div');
    if (!weapons.length) { box.innerHTML = soon('Нет оружия — руны вставляются в оружие'); return box; }
    const reload = async (id) => box.replaceWith(await runesBody(id));
    const w = weapons.find((i) => i.id === weaponId) || weapons.find((i) => Bag.isEquipped(i)) || weapons[0];
    box.innerHTML = `<div class="rune-how"><b>Как вставить руну</b><p class="sheet-hint">Вставка и извлечение стоят золота (дороже для редких рун и миров выше), легендарные и мифические руны извлекаются ещё и за 💎. Каждое следующее извлечение за день дороже.</p><ol><li>Выберите оружие ниже (надетое уже выбрано)</li><li>Тапните руну в разделе «Руны в сумке» — она встанет в свободное гнездо</li><li>Тап по вставленной руне — извлечь её (${50 * w.tier} 💰)</li></ol><small>Гнёзд: обычное и редкое оружие — 1, эпическое и легендарное — 2, мифическое — 3. Руны есть во вкладке «Купить руны» и падают с монстров.</small></div><div class="ic-sec">Оружие</div>`;
    box.append(Bag.grid(weapons, (it) => reload(it.id), { selected: new Set([w.id]) }));
    box.insertAdjacentHTML('beforeend', `<div class="ic-sec">Гнёзда «${w.name}»: ${w.runes.length} / ${w.sockets}</div>`);
    const sock = document.createElement('div');
    sock.className = 'merge-slots';
    sock.innerHTML = [...w.runes.map((r) => Bag.cell(r)), ...Array(Math.max(0, w.sockets - w.runes.length)).fill('<button class="it empty"><span>◇</span></button>')].join('');
    sock.onclick = async (e) => {
      const b = e.target.closest('.it');
      const idx = [...sock.children].indexOf(b);
      if (!b || idx < 0 || idx >= w.runes.length) return;
      const q = await Bag.act('unsocket', { weapon: w.id, idx, quote: 1 });
      if (!q.quote) return toast(q.error || 'Нет связи');
      if (!(await askGram(`Извлечь руну за ${q.quote.gold.toLocaleString('ru-RU')} 💰${q.quote.gems ? ` и ${q.quote.gems} 💎` : ''}?${q.quote.k > 1 ? `\nСегодня это ${q.quote.k}-е извлечение — цена ×${q.quote.k}.` : '\nКаждое следующее извлечение сегодня дороже.'}`))) return;
      const r = await Bag.act('unsocket', { weapon: w.id, idx }); toast(r.error || r.toast); reload(w.id);
    };
    box.append(sock);
    box.insertAdjacentHTML('beforeend', '<div class="ic-sec">Руны в сумке — тап, чтобы вставить</div>');
    box.append(Bag.grid(inv.items.filter((i) => i.cat === 'rune' && i.loc !== 'wh'), async (rn) => {
      const q = await Bag.act('socket', { weapon: w.id, rune: rn.id, quote: 1 });
      if (!q.quote) return toast(q.error || 'Нет связи');
      if (!(await askGram(`Вставить «${rn.name}» в «${w.name}» за ${q.quote.gold.toLocaleString('ru-RU')} 💰?\nИзвлечь руну потом будет дороже.`))) return;
      const r = await Bag.act('socket', { weapon: w.id, rune: rn.id }); toast(r.error || r.toast); reload(w.id);
    }, { empty: 'Рун нет — купите во вкладке «Купить руны» или выбейте с монстров' }));
    return box;
  }
  const runesPanel = (weaponId) => open('💠 Рунная мастерская', tabs([['Вставить руну', () => runesBody(weaponId)], ['Купить руны', () => shopList('runes')]]));

  // ---------- Торговля за GRAM (server/trade.js) ----------
  // Суммы приходят в нано-GRAM; показываем до сотых
  const gfmt = (n) => (Number(n || 0) / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  const WEAR_RU = { weapon: 'Оружие', helm: 'Шлем', armor: 'Доспех', cloak: 'Плащ', gloves: 'Перчатки', belt: 'Пояс', boots: 'Сапоги', ring: 'Кольцо', amulet: 'Амулет', earring: 'Серьги', rune: 'Руны' };
  // Подтверждение траты GRAM (в Telegram — родное окно)
  const askGram = (text) => new Promise((res) => {
    const W = window.Telegram && Telegram.WebApp;
    if (W && W.showConfirm) { try { W.showConfirm(text, (ok) => res(!!ok)); return; } catch { /* старый Telegram */ } }
    res(window.confirm(text));
  });
  const balLine = (b) => `<div class="gram-bal"><b>💎 ${gfmt(b.total)} GRAM</b><button class="l2-btn" data-wallet="1">Кошелёк</button></div>`;
  const bindWallet = (box) => box.querySelectorAll('[data-wallet]').forEach((b) => { b.onclick = () => walletPanel(0); });

  // Рынок: полный каталог вещей игры от эпических за GRAM — любой слот, все руны, комплекты любого класса
  // Лимитированный тираж: мифические вещи с номером, пока не распроданы
  async function ltdPanel() {
    const r = await Bag.act('gmLtd');
    if (r.error) return toast(r.error);
    const L = r.ltd;
    const box = el(`<div class="tw-banner pass"><b><img class="ui-ic" src="assets/ui/ic_limited.webp" alt=""> Тираж «${L.name}» · осталось ${L.left} из ${L.of}</b>
      <small>Мифические вещи с номером #N/${L.of}: +10% ко всем свойствам. Больше никогда не появятся — после распродажи только у игроков в Торговом доме. Не больше ${L.perUser} в одни руки (у вас ${L.mine}). Вещь — под класс вашего героя, мир ${ROMAN[L.tier] || L.tier}.</small></div>`);
    box.prepend(el('<button class="l2-btn wide ghost">‹ Весь Рынок</button>'));
    box.querySelector('button').onclick = () => gramMarketPanel();
    for (const o of L.offers) box.append(row(o.item, o.item.name, `Мифическая · тираж ${L.of}`, L.left > 0 ? `${gfmt(o.price)} GRAM` : 'Распродано', async () => {
      if (L.left <= 0) return toast('Тираж распродан — ищите в Торговом доме');
      if (!(await askGram(`Купить «${o.item.name}» за ${gfmt(o.price)} GRAM?`))) return;
      const res = await Bag.act('gmLtdBuy', { cat: o.cat });
      toast(res.error || res.toast);
      if (res.needGram) return walletPanel(0);
      ltdPanel();
    }, L.left <= 0));
    open('⭐ Лимитированный тираж', box);
  }
  async function gramMarketPanel(cat = 'weapon', cls = null) {
    if (cat === 'ltd') return ltdPanel();
    if (!Bag.inv || !Bag.inv()) await Bag.refresh(); // названия характеристик для бонусов комплекта
    const r = await Bag.act('gmShop', { cat, cls });
    if (r.error) return toast(r.error);
    const cats = { ltd: '<img class="ui-ic" src="assets/ui/ic_limited.webp" alt="">Тираж', set: 'Комплекты', ...WEAR_RU };
    const box = el(`${balLine(r.bal)}<p class="sheet-hint">Все вещи от эпических за GRAM — экипировка мира ${ROMAN[r.tier] || r.tier}. Выберите слот или комплект и класс героя, для которого покупаете.<br>Основные свойства — как на карточке, дополнительные выпадают случайно при покупке. Отборные вещи (свойства +25% и одно дополнительное) — только в призыве снаряжения.</p>
      <div class="gram-cats">${Object.entries(cats).map(([k, n]) => `<button class="l2-btn ${k === r.cat ? 'on' : ''}" data-cat="${k}">${n}</button>`).join('')}</div>
      ${r.cat !== 'rune' ? `<div class="gram-cats cls">${r.classes.map((c) => `<button class="l2-btn ${c.id === r.cls ? 'on' : ''}" data-cls="${c.id}"><img class="ui-ic" src="assets/ui/cls_${c.id}.webp" alt="">${c.name}${c.id === r.own ? ' · ваш' : ''}</button>`).join('')}</div>` : ''}
      ${r.set ? `<div class="tw-banner pass"><b>${r.set.name}</b><small>${r.set.bonus.map(([n, st]) => `${n} вещи: ${Object.entries(st).map(([k, v]) => (Bag.statLine ? Bag.statLine(k, v) : `${k} +${v}`)).join(', ')}`).join('<br>')}</small></div>` : ''}`);
    bindWallet(box);
    box.querySelectorAll('[data-cat]').forEach((b) => { b.onclick = () => gramMarketPanel(b.dataset.cat, r.cls); });
    box.querySelectorAll('[data-cls]').forEach((b) => { b.onclick = () => gramMarketPanel(r.cat, b.dataset.cls); });
    if (!r.offers.length) box.insertAdjacentHTML('beforeend', soon('Для этого класса в этом слоте вещей нет'));
    for (const o of r.offers) {
      const extra = o.item.attrsN ? ` · +${o.item.attrsN[0]}${o.item.attrsN[1] !== o.item.attrsN[0] ? '–' + o.item.attrsN[1] : ''} случайн. свойств` : '';
      box.append(row(o.item, o.item.name, `${o.item.rarName}${o.set ? ' · комплект' : ''}${extra}`, `${gfmt(o.price)} GRAM`, async () => {
        if (!(await askGram(`Купить «${o.item.name}» за ${gfmt(o.price)} GRAM?`))) return;
        const res = await Bag.act('gmBuy', { key: o.key });
        toast(res.error || res.toast);
        if (res.needGram) return walletPanel(0);
        gramMarketPanel(r.cat, r.cls);
      }));
    }
    open('🏪 Рынок', box);
  }

  // Торговый дом: продажа между игроками за GRAM
  const TRADE_RAR = ['epic', 'legendary', 'mythic'];
  const tradableItem = (it) => TRADE_RAR.includes(it.rar) && (it.cat === 'rune' || Object.hasOwn(WEAR_RU, it.cat));
  async function tradeHousePanel(tab = 0) {
    const r = await Bag.act('th');
    if (r.error) return toast(r.error);
    const badge = (l) => (l.badge === 'magnate' ? '👑 ' : l.badge === 'merchant' ? '🟢 ' : '');
    const buyTab = () => {
      const box = el(`${balLine(r.bal)}<p class="sheet-hint">Товары игроков за GRAM. Покупка — сразу с баланса, предмет приходит в сумку.</p>`);
      bindWallet(box);
      const lots = r.lots.filter((l) => !l.mine);
      if (!lots.length) box.insertAdjacentHTML('beforeend', soon('Лотов пока нет'));
      for (const l of lots) box.append(row(l.item, l.item.name, `${l.item.rarName || ''} · ${badge(l)}${l.seller}${histTxt(l.hist)}`, `${gfmt(l.price)} GRAM`, async () => {
        if (!(await askGram(`Купить «${l.item.name}» у ${l.seller} за ${gfmt(l.price)} GRAM?`))) return;
        const res = await Bag.act('thBuy', { id: l.id });
        toast(res.error || res.toast);
        if (res.needGram) return walletPanel(0);
        tradeHousePanel(0);
      }));
      return box;
    };
    const myTab = () => {
      const mine = r.lots.filter((l) => l.mine);
      const box = el(`<p class="sheet-hint">Ваши лоты ${mine.length} / ${r.slots} · комиссия ${Math.round(r.fee * 100)}% · деньги с продажи можно вывести через 3 дня.<br>Продаются вещи и руны от эпических (с заточкой и рунами — дороже) и ценные материалы. Минимальная цена считается от цен Рынка.</p>
        ${r.orderSave && r.orderSave.fees > 0 ? `<div class="tw-banner pass"><b>💡 Комиссия за 30 дней: ${gfmt(r.orderSave.fees)} GRAM</b><small>С Орденом Купца вы сэкономили бы ${gfmt(r.orderSave.merchant)} GRAM, с Орденом Магната — ${gfmt(r.orderSave.magnate)} GRAM. Ордена — в GRAM-кошельке.</small></div>` : ''}`);
      for (const l of mine) box.append(row(l.item, l.item.name, `за ${gfmt(l.price)} GRAM · до ${new Date(l.until).toLocaleDateString('ru-RU')}`, 'Снять', async () => { const res = await Bag.act('thCancel', { id: l.id }); toast(res.error || res.toast); tradeHousePanel(1); }));
      const add = document.createElement('button');
      add.className = 'l2-btn wide'; add.textContent = '＋ Выставить предмет';
      add.onclick = () => Bag.pick('Что продаём?', tradableItem, async (it) => {
        const q = await Bag.act('thQuote', { id: it.id });
        if (q.error) return toast(q.error);
        gramPriceForm(it, it.name, q, (price) => Bag.act('thSell', { id: it.id, price }), () => tradeHousePanel(1));
      });
      const addM = document.createElement('button');
      addM.className = 'l2-btn wide'; addM.textContent = '＋ Выставить материалы';
      addM.onclick = () => pickMat(async (m) => {
        const q = await Bag.act('thQuote', { mat: m.mat, n: m.n });
        if (q.error) return toast(q.error);
        gramPriceForm(m, `${m.name} ×${m.n}`, q, (price) => Bag.act('thSell', { mat: m.mat, n: m.n, price }), () => tradeHousePanel(1));
      });
      box.append(add, addM);
      return box;
    };
    // Заявки на покупку: чужие — «Продать», свои — «Снять» и «＋ Новая заявка»
    const bidRow = (b, label, on) => row(b.item || null, `${b.item ? '' : '<img class="ui-ic" src="assets/ui/ic_bids.webp" alt=""> '}${b.name}${b.mat ? ' ×' + b.n : ''}`, `${gfmt(b.price)} GRAM за шт. · ${b.buyer}${histTxt(b.hist)}`, label, on);
    const bidsTab = () => {
      const box = el(`${balLine(r.bal)}<p class="sheet-hint"><img class="ui-ic" src="assets/ui/ic_bids.webp" alt=""> Игроки заранее заморозили GRAM и ждут товар. Есть подходящая вещь или материалы — продайте сразу, оплата придёт мгновенно (к выводу через 3 дня), комиссия как у лотов.</p>`);
      bindWallet(box);
      const list = r.bids.filter((b) => !b.mine);
      if (!list.length) box.insertAdjacentHTML('beforeend', soon('Заявок пока нет'));
      for (const b of list) box.append(bidRow(b, 'Продать', async () => {
        if (b.mat) {
          const inv = await Bag.refresh(), have = ((inv.mats || []).find((m) => m.mat === b.mat) || {}).n || 0;
          if (!have) return toast('У вас нет этого материала');
          const n = Math.min(have, b.n);
          if (!confirm(`Продать ${b.name} ×${n} за ${gfmt(b.price * n)} GRAM?`)) return;
          const res = await Bag.act('thFill', { id: b.id, n }); toast(res.error || res.toast); tradeHousePanel(2);
        } else {
          Bag.pick('Какую вещь отдать?', (it) => it.cat === b.cat && it.rar === b.rar && (it.tier || 1) === b.tier && !!it.set === b.set, async (it) => {
            if (!confirm(`Продать «${it.name}» за ${gfmt(b.price)} GRAM?`)) return;
            const res = await Bag.act('thFill', { id: b.id, item: it.id }); toast(res.error || res.toast); tradeHousePanel(2);
          });
        }
      }));
      return box;
    };
    const myBidsTab = () => {
      const mine = r.bids.filter((b) => b.mine);
      const box = el(`<p class="sheet-hint">Ваши заявки ${mine.length} / ${r.slots}. GRAM замораживаются сразу; снятая или истёкшая заявка (${r.bidDays} дн.) возвращает их на баланс.</p>`);
      for (const b of mine) box.append(bidRow(b, 'Снять', async () => { const res = await Bag.act('thBidCancel', { id: b.id }); toast(res.error || res.toast); tradeHousePanel(3); }));
      const add = document.createElement('button');
      add.className = 'l2-btn wide'; add.textContent = '＋ Новая заявка';
      add.onclick = () => bidForm(r, () => tradeHousePanel(3));
      box.append(add);
      return box;
    };
    open('🏛️ Торговый дом', tabs([['Купить', buyTab], ['Мои лоты', myTab], ['Заявки', bidsTab], ['Мои заявки', myBidsTab]], tab));
  }
  const histTxt = (h) => (h && h.avg7 ? ` · ср. 7 дн. ${gfmt(h.avg7)}` : h && h.last ? ` · посл. ${gfmt(h.last)}` : '');
  // Форма заявки: материал или вещь (слот, редкость, мир, комплект), количество, цена за штуку (в пределах)
  function bidForm(r, done) {
    const RAR = { epic: 'Эпическая', legendary: 'Легендарная', mythic: 'Мифическая' };
    const box = el(`<div class="tw-form"><select data-k="kind"><option value="mat">Материалы</option><option value="item">Вещь</option></select></div>
      <div class="tw-form" data-show="mat"><select data-k="mat">${r.mats.map((m) => `<option value="${m.id}">${m.icon} ${m.name}</option>`).join('')}</select><input data-k="n" type="number" min="1" max="999" value="1" placeholder="Сколько"></div>
      <div class="tw-form" data-show="item" style="display:none"><select data-k="cat">${r.slotsList.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
        <select data-k="rar">${Object.entries(RAR).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <select data-k="tier"><option value="1">Мир I</option><option value="2">Мир II</option><option value="3">Мир III</option></select>
        <label class="switch"><input data-k="set" type="checkbox"> Вещь комплекта</label></div>
      <p class="sheet-hint" data-k="bounds">…</p>
      <div class="tw-form"><input data-k="price" type="number" step="0.01" inputmode="decimal" placeholder="Цена за штуку, GRAM"></div>
      <button class="l2-btn wide">Создать заявку</button>`);
    const q = (k) => box.querySelector(`[data-k="${k}"]`);
    const data = () => (q('kind').value === 'mat' ? { mat: q('mat').value, n: Number(q('n').value) || 1 } : { cat: q('cat').value, rar: q('rar').value, tier: Number(q('tier').value), set: q('set').checked });
    const upd = async () => {
      box.querySelectorAll('[data-show]').forEach((e) => { e.style.display = e.dataset.show === q('kind').value ? '' : 'none'; });
      const b = await Bag.act('thBidQuote', data());
      q('bounds').textContent = b.error ? b.error : `Цена за штуку: от ${gfmt(b.min)} до ${gfmt(b.max)} GRAM. GRAM замораживаются сразу, комиссию платит продавец.`;
      if (!b.error && !q('price').value) q('price').value = (Math.ceil(b.min / 1e7) / 100).toFixed(2);
    };
    box.querySelectorAll('select, input[type="checkbox"]').forEach((e) => { e.onchange = () => { q('price').value = ''; upd(); }; });
    box.querySelector('button.l2-btn.wide').onclick = async () => {
      const res = await Bag.act('thBid', { ...data(), price: Number(q('price').value) });
      toast(res.error || res.toast);
      if (res.needGram) return walletPanel(0);
      if (!res.error) done();
    };
    open('📜 Заявка на покупку', box);
    upd();
  }
  function gramPriceForm(it, name, q, submit, done) {
    const min = q.min / 1e9, max = q.max / 1e9;
    const box = el(`<div class="tw-form"><input type="number" min="${min}" max="${max}" step="0.01" inputmode="decimal" value="${(Math.ceil(min * 1.5 * 100) / 100).toFixed(2)}"></div>
      <p class="sheet-hint">Цена в GRAM: от ${gfmt(q.min)} до ${gfmt(q.max)}. После продажи вы получите цену минус комиссию.</p><button class="l2-btn wide">Выставить</button>`);
    box.prepend(row(it.cat ? it : it, name, it.rarName || '', null));
    box.querySelector('button.l2-btn.wide').onclick = async () => {
      const res = await submit(Number(box.querySelector('input').value));
      toast(res.error || res.toast);
      if (!res.error) done();
    };
    open('Цена в GRAM', box);
  }

  // GRAM-кошелёк: баланс, пополнение, вывод, торговые ордена, история
  async function walletPanel(tab = 0) {
    const r = await Bag.act('gramInfo');
    if (r.error) return toast(r.error);
    const g = r.gram;
    const balTab = () => {
      const box = el(`<div class="spin-wallet">
          <div><b>${gfmt(g.total)}</b><span>💎 GRAM всего</span></div>
          <div><b>${gfmt(g.dep)}</b><span>пополнено — только в игре</span></div>
          <div class="${g.free ? 'ok' : ''}"><b>${gfmt(g.free)}</b><span>с продаж — к выводу</span></div>
          <div><b>${gfmt(g.hold)}</b><span>удерживается${g.next ? ' до ' + new Date(g.next).toLocaleDateString('ru-RU') : ''}</span></div>
        </div>
        <p class="sheet-hint">Пополнение — переводом GRAM с вашего кошелька. Пополненные GRAM тратятся на Рынке и в Торговом доме; вывести можно только деньги с продаж — через ${g.holdDays} дня после продажи.</p>
        <div class="gram-cats">${[1, 5, 10, 25].map((v) => `<button class="l2-btn" data-dep="${v}">+${v} GRAM</button>`).join('')}</div>
        <div class="tw-form"><input type="number" min="${g.depMin}" step="0.1" inputmode="decimal" placeholder="Своя сумма, GRAM"></div>
        <button class="l2-btn wide" data-dep="custom">Пополнить</button>
        <button class="l2-btn wide" data-manual="1">Перевести вручную (адрес и комментарий)</button>`);
      const dep = async (v) => {
        if (!(v >= g.depMin)) return toast(`Минимум ${g.depMin} GRAM`);
        await Pay.deposit(v, { toast, onDone: () => walletPanel(0) });
      };
      box.querySelectorAll('[data-dep]').forEach((b) => { b.onclick = () => dep(b.dataset.dep === 'custom' ? Number(box.querySelector('input').value) : Number(b.dataset.dep)); });
      box.querySelector('[data-manual]').onclick = async () => {
        const d = await Pay.depositInfo();
        if (d.error) return toast(d.error);
        const m = el(`<p class="sheet-hint">Переведите любую сумму GRAM на адрес игры <b>с этим комментарием</b> — она зачислится на ваш баланс (обычно в течение нескольких минут). Без комментария перевод не найти!</p>
          <div class="tw-ev"><div><b>Адрес</b><small class="sel">${d.address}</small></div><button class="l2-btn" data-c="${d.address}">Копировать</button></div>
          <div class="tw-ev"><div><b>Комментарий</b><small class="sel">${d.comment}</small></div><button class="l2-btn" data-c="${d.comment}">Копировать</button></div>`);
        m.querySelectorAll('[data-c]').forEach((b) => { b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.c); toast('Скопировано'); } catch { toast(b.dataset.c); } }; });
        open('Пополнение вручную', m);
      };
      return box;
    };
    const wdTab = () => {
      const okLv = g.level >= g.wLevel, okAge = g.ageDays >= g.wAgeDays, okSum = g.free >= g.wMin;
      const req = (ok, t) => `<li class="${ok ? 'ok' : 'bad'}">${ok ? '✅' : '⛔'} ${t}</li>`;
      const box = el(`<ul class="gram-req">${req(okLv, `Герой ${g.wLevel}+ уровня (у вас ${g.level})`)}${req(okAge, `Аккаунту ${g.wAgeDays}+ дней (вам ${g.ageDays})`)}${req(okSum, `К выводу не меньше ${gfmt(g.wMin)} GRAM (у вас ${gfmt(g.free)})`)}</ul>
        <p class="sheet-hint">Комиссия вывода ${Math.round(g.wFee * 100)}%. Выплаты — вручную, ежедневно с 20:00 до 24:00 МСК. Одна заявка за раз.</p>
        <p class="sheet-hint">⚠️ Только личный кошелёк — Tonkeeper, MyTonWallet, Wallet в Telegram. Не указывайте адрес биржи: без комментария (memo) биржа не зачислит перевод и деньги потеряются.</p>
        <div class="tw-form"><input class="amt" type="number" min="${g.wMin / 1e9}" max="${g.free / 1e9}" step="0.01" inputmode="decimal" value="${(Math.floor(g.free / 1e7) / 100).toFixed(2)}" placeholder="Сумма, GRAM">
          <input class="addr" type="text" placeholder="Адрес кошелька (UQ… / EQ…)" value="${g.wallet || ''}"></div>
        <small class="gram-net"></small>
        <button class="l2-btn wide" data-w="1" ${okLv && okAge && okSum ? '' : 'disabled'}>Подать заявку на вывод</button>
        <div class="ic-sec">Мои заявки</div>`);
      const amt = box.querySelector('.amt'), net = box.querySelector('.gram-net');
      const upd = () => { const a = Number(amt.value) || 0; net.textContent = `Вы получите: ${(a * (1 - g.wFee)).toFixed(2)} GRAM (комиссия ${(a * g.wFee).toFixed(2)})`; };
      amt.oninput = upd; upd();
      if (!g.wallet) Pay.walletAddress().then((a) => { if (a && !box.querySelector('.addr').value) box.querySelector('.addr').value = a; }).catch(() => {});
      box.querySelector('[data-w]').onclick = async () => {
        const a = Number(amt.value), addr = box.querySelector('.addr').value.trim();
        if (!(await askGram(`Вывести ${a} GRAM на ${addr.slice(0, 6)}…${addr.slice(-4)}? Комиссия ${Math.round(g.wFee * 100)}%.`))) return;
        const res = await Bag.act('gramWithdraw', { amount: a, address: addr });
        toast(res.error || res.toast);
        if (!res.error) walletPanel(1);
      };
      const ST = { wait: '⏳ ждёт выплаты', paid: '✅ выплачено', rejected: '↩ отклонено' };
      for (const w of g.wd) box.insertAdjacentHTML('beforeend', `<div class="tw-ev"><div><b>№${w.id} · ${gfmt(w.net)} GRAM</b><small>${new Date(w.at).toLocaleString('ru-RU')} · ${ST[w.status] || w.status}${w.reason ? ': ' + w.reason : ''}</small></div></div>`);
      if (!g.wd.length) box.insertAdjacentHTML('beforeend', soon('Заявок пока нет'));
      return box;
    };
    const ordTab = () => {
      const box = el(`<p class="sheet-hint">Торговые ордена — высшие ступени сезонных орденов, после Ордена Чемпиона. В цену уже входят все предыдущие ордена (Бронзовый, Серебряный, Золотой и Чемпиона) со всеми их наградами и бонусами; если часть уже куплена — доплачиваете только разницу. Действуют до конца сезона.${g.order ? `<br><b class="ok">Активен: ${g.order.icon} ${g.order.name}${g.order.until ? ' до ' + new Date(g.order.until).toLocaleDateString('ru-RU') : ''}</b>` : ''}</p>`);
      for (const o of g.orders) box.insertAdjacentHTML('beforeend', `<div class="tw-banner pass"><b>${orderIc(o, 'sm')} ${o.name}</b><ul class="gram-perks">${o.perks.map((x) => `<li>${x}</li>`).join('')}</ul>
        ${o.owned ? '<small class="ok">Уже открыт в этом сезоне</small>' : `<button class="l2-btn" data-buy="${o.kind}">${o.cost < o.price ? `Доплатить ${o.cost} ⭐` : `${o.cost} ⭐`} / ${o.gram} GRAM</button>`}</div>`);
      box.querySelectorAll('[data-buy]').forEach((b) => { b.onclick = () => buyStars(b.dataset.buy, () => walletPanel(2)); });
      box.append(el('<button class="l2-btn wide" data-pass="1">Все сезонные ордена и награды</button>'));
      box.querySelector('[data-pass]').onclick = () => passPanel();
      return box;
    };
    const KIND = { deposit: 'Пополнение', shop: 'Рынок', buy: 'Покупка', sale: 'Продажа', fee: 'Комиссия', withdraw: 'Вывод', payout: 'Выплата', refund: 'Возврат', admin: 'Администрация' };
    const logTab = () => {
      const box = el('');
      for (const e of g.log) box.insertAdjacentHTML('beforeend', `<div class="tw-ev"><div><b>${KIND[e.kind] || e.kind}${e.a ? ` · ${e.a > 0 ? '+' : ''}${gfmt(e.a)} GRAM` : ''}</b><small>${new Date(e.t).toLocaleString('ru-RU')} · ${e.text}</small></div></div>`);
      if (!g.log.length) box.innerHTML = soon('Операций пока нет');
      return box;
    };
    open('💎 GRAM-кошелёк', tabs([['Баланс', balTab], ['Вывод', wdTab], ['Ордена', ordTab], ['История', logTab]], tab));
  }

  // Выбор материала для продажи
  async function pickMat(onPick) {
    const inv = await Bag.refresh();
    const box = el('<p class="sheet-hint">Какие материалы продаём? В Торговом доме продаются ценные: сердца, свитки мастера и выше, чертежи, камни удачи, пыль, кристаллы, ларцы и великие эликсиры.</p>');
    box.append(Bag.grid(inv.mats, onPick, { empty: 'Ресурсов нет', keepOrder: true }));
    open('Что продаём?', box);
  }


  // ---------- Призыв ----------
  async function gachaPanel() {
    const inv = await Bag.refresh();
    const box = el(`<p class="sheet-hint">Алтарь призыва · ${ctx.zone.name}</p>
      <div class="spin-wallet">
        <div><b>${inv.heroSpins || 0}</b><span>🔮 печати героев</span></div>
        <div><b>${inv.itemSpins}</b><span>🎁 печати снаряжения</span></div>
        <div class="${inv.freeItemSpins ? 'ok' : ''}"><b>${inv.freeItemSpins}</b><span>бесплатно сегодня</span></div>
        <div><b>${inv.gems}</b><span>💎 самоцветы · 100 = призыв</span></div>
      </div>
      <div class="tw-banner hero"><b>🔮 Призыв героев</b><small>Избранный недели и Зал героев · мифический герой гарантирован не позже 80-го призыва</small><button class="l2-btn" id="twHeroSpin">Открыть призыв</button></div>
      <div class="tw-banner items"><b>🎁 Призыв снаряжения</b>
        <small>Комплект недели: <b>${inv.gearBanner.name}</b> — половина легендарных и мифических вещей из него · экипировка мира ${ROMAN[ctx.zone.tier]}<br>
        эпический и выше — не реже раза в 10 призывов<br>
        <b class="ok">Отборные вещи: свойства на 25% сильнее и одно дополнительное — в лавке таких нет</b><br>
        Гарант легендарного: <b>${inv.pity} / ${inv.pityMax}</b></small>
        <div class="btn-row"><button class="l2-btn" data-n="1">Призвать ×1</button><button class="l2-btn" data-n="10">×10</button></div>
        <div class="btn-row"><button class="l2-btn" data-buy="ispin">+1 · 15 ⭐</button><button class="l2-btn" data-buy="ispin10">+10 · 135 ⭐</button></div></div>`);
    box.querySelector('#twHeroSpin').onclick = () => ctx.onGacha();
    box.querySelectorAll('[data-n]').forEach((b) => { b.onclick = async () => {
      const r = await Bag.act('itemSpin', { n: +b.dataset.n });
      if (r.error) return toast(r.needPayment ? 'Нет круток — купите за Stars' : r.error);
      const res = el(`<p class="sheet-hint">Результат призыва · ⇧ — дубликат усилил ваш предмет</p>`);
      res.append(Bag.grid(r.results, (it) => Bag.card(it)));
      // Карты лежат рубашкой вверх и переворачиваются от худшей к лучшей; перед легендарной — пауза и вспышка
      const RO = Bag.inv().rarOrder;
      const cells = [...res.querySelectorAll('.it')].map((c) => ({ c, it: r.results.find((x) => x.id === c.dataset.id) }));
      cells.forEach(({ c, it }) => { c.classList.add('face'); c.style.setProperty('--rc', it.color); if (it.dupe) c.insertAdjacentHTML('beforeend', '<u>⇧</u>'); });
      let t = 250;
      cells.slice().reverse().sort((a, b) => RO.indexOf(a.it.rar) - RO.indexOf(b.it.rar)).forEach(({ c, it }) => {
        const high = RO.indexOf(it.rar) >= RO.indexOf('legendary');
        if (high) { setTimeout(() => c.classList.add('tease'), t); t += 900; }
        setTimeout(() => { c.classList.remove('face', 'tease'); c.classList.add('flip', high ? 'flip-high' : 'flip-low'); }, t);
        t += high ? 500 : 110;
      });
      const again = document.createElement('button'); again.className = 'l2-btn wide'; again.textContent = 'Назад к алтарю'; again.onclick = gachaPanel;
      res.append(again);
      open('🎁 Призыв предметов', res);
    }; });
    box.querySelectorAll('[data-buy]').forEach((b) => { b.onclick = () => buyStars(b.dataset.buy, gachaPanel); });
    open('🎰 Алтарь призыва', box);
  }

  // ---------- Батл-пасс ----------
  const rwText = (r) => (r.gold ? `💰 ${r.gold}` : r.gems ? `💎 ${r.gems}` : r.heroSpins ? `🔮 печать призыва ×${r.heroSpins}` : r.itemSpins ? `🎁 печать снаряжения ×${r.itemSpins}` : r.item ? `🎁 ${{ rare: 'редкий', epic: 'эпический', legendary: 'легендарный', mythic: 'мифический' }[r.item]} предмет` : '');
  async function passPanel() {
    const { pass: ps } = await Bag.act('pass');
    const cur = ps.tiers.find((t) => t.tier === ps.tier);
    const box = el(`<div class="pass-head"><b>Сезон · уровень ${ps.level} / ${ps.rewards.length}</b>
      <div class="tw-prog"><i style="width:${(ps.xp % ps.xpPerLevel) / ps.xpPerLevel * 100}%"></i><em>${ps.xp % ps.xpPerLevel} / ${ps.xpPerLevel} XP пропуска</em></div>
      <small>Опыт пропуска: монстры, боссы, волны выживания, арена, призывы · сезон закончится через ${fmtLeft(ps.ends - Date.now())}</small>
      <small class="ok">${cur ? `${orderIc(cur, 'sm')} ${cur.name} активен` : `${orderIc(ps.freeOrder, 'sm')} ${ps.freeOrder.name} активен`}</small>
      ${cur ? '' : '<small>Платные ордена открывают премиум-награды и бонусы на весь сезон. Каждый следующий включает всё из предыдущих.</small>'}</div>
      <div class="orders"><div class="order o-free own">
        <div class="order-h"><span class="order-ic">${orderIc(ps.freeOrder)}</span><b>${ps.freeOrder.name}</b></div>
        <ul>${ps.freeOrder.perks.map((p) => `<li>${p}</li>`).join('')}</ul>
        <span class="order-ok">✓ Бесплатно для всех игроков</span>
      </div>${ps.tiers.map((t) => `<div class="order o-${t.id} ${t.owned ? 'own' : ''}">
        <div class="order-h"><span class="order-ic">${orderIc(t)}</span><b>${t.name}</b></div>
        <ul><li class="inc">Всё из «${t.tier > 1 ? ps.tiers[t.tier - 2].name : ps.freeOrder.name}»</li>${t.perks.map((p) => `<li>${p}</li>`).join('')}</ul>
        ${t.owned ? '<span class="order-ok">✓ Открыт</span>' : `<button class="l2-btn" data-order="${t.tier}">${ps.tier ? 'Улучшить' : 'Открыть'} · ${t.cost} ⭐</button>`}
      </div>`).join('')}</div>`);
    const list = document.createElement('div');
    for (const r of ps.rewards) {
      const reached = ps.level >= r.lvl;
      const cellBtn = (track, rw) => {
        const got = ps[track].includes(r.lvl), lockedPrem = track === 'prem' && ps.tier < 1;
        return `<button class="pass-rw ${track} ${got ? 'got' : ''}" data-l="${r.lvl}" data-t="${track}" ${!reached || got || lockedPrem ? 'disabled' : ''}>${got ? '✓ ' : lockedPrem ? '🔒 ' : ''}${rwText(rw)}</button>`;
      };
      list.insertAdjacentHTML('beforeend', `<div class="pass-row ${reached ? 'on' : ''}"><span>${r.lvl}</span>${cellBtn('free', r.free)}${cellBtn('prem', r.prem)}</div>`);
    }
    list.onclick = async (e) => {
      const b = e.target.closest('.pass-rw');
      if (!b || b.disabled) return;
      const res = await Bag.act('passClaim', { lvl: +b.dataset.l, track: b.dataset.t });
      toast(res.error || res.toast); passPanel();
    };
    box.append(el(`<div class="pass-cols"><span></span><b>Бесплатно</b><b>🏅 Орден${ps.tier >= 4 ? ' ×2' : ''}</b></div>`), list);
    box.querySelectorAll('[data-order]').forEach((b) => { b.onclick = () => buyStars('pass' + b.dataset.order, passPanel); });
    open('🎟️ Сезонные ордена', box);
  }

  // ---------- Магазин: подписка, крутки, реклама ----------
  // Нарисованные значки товаров магазина (assets/ui/shop/)
  const SHOP_ART = { chestSet: 'chestSet', chestSet5: 'chestSet5', chestLegend: 'chestLegend' };
  const shopArt = (c) => (c.bag ? `../../items/bag_${{ bagEpic: 'epic', bagLegend: 'legendary' }[c.id] || 'rare'}` : SHOP_ART[c.id]); // сумки — картинка сумки
  async function storePanel() {
    const s = await Bag.act('shopInfo');
    const hrs = (ms) => { const h = Math.max(0, Math.floor(ms / 36e5)); return h >= 24 ? `${Math.floor(h / 24)} д ${h % 24} ч` : `${h} ч ${Math.floor((ms % 36e5) / 6e4)} мин`; };
    const special = `${s.starter ? `<div class="tw-banner hero offer has-art"><img class="tw-art" src="assets/ui/shop/chestSet5.webp" alt=""><b>🎁 Набор новичка · только ${hrs(s.starter.left)}</b>
        <small>${s.starter.desc}</small><small class="ok">Выгода больше 70% — один раз на аккаунт</small><button class="l2-btn" data-buy="starter">${s.starter.amount} ⭐</button></div>` : ''}
      ${s.card ? `<div class="tw-banner hero offer has-art"><img class="tw-art" src="assets/ui/shop/gems4.webp" alt=""><b>📅 Карта месяца</b><small>${s.card.desc}</small>
        ${s.card.until ? `<small class="ok">Активна ещё ${hrs(s.card.until - Date.now())}</small><div class="btn-row"><button class="l2-btn" id="cardClaim" ${s.card.ready ? '' : 'disabled'}>${s.card.ready ? '💎 Забрать 100 сегодня' : 'Сегодня получено'}</button><button class="l2-btn" data-buy="card30">Продлить · ${s.card.amount} ⭐</button></div>`
          : `<button class="l2-btn" data-buy="card30">${s.card.amount} ⭐</button>`}</div>` : ''}`;
    const box = el(`${special}${s.firstBuy ? '<div class="first-buy">🎁 <b>−50% на первую покупку</b><small>Любой товар за ⭐ Stars или 💎 GRAM — за полцены. Скидка действует один раз.</small></div>' : ''}<div class="tw-banner hero has-art"><img class="tw-art" src="assets/ui/shop/sub.webp" alt=""><b>👑 Подписка «Покровитель» · 30 дней</b>
        <small>+25% опыта и золота · 2 бесплатных призыва предметов в день · комиссия рынка 5% вместо 10% · сумка 80 ячеек · 8 боёв на арене в день</small>
        ${s.sub ? `<small class="ok">Активна до ${new Date(s.sub).toLocaleDateString('ru-RU')}</small>` : ''}
        <button class="l2-btn" data-buy="sub">${s.sub ? 'Продлить' : 'Оформить'} · ${s.subPrice} ⭐</button></div>
      <div class="tw-banner hero"><b>✨ Внешний вид</b><small>Цвет имени и сияние под героем — видно всем игрокам; особые рамки портрета. За самоцветы</small><button class="l2-btn" id="openLooks">Открыть</button></div>
      <div class="tw-banner hero gems-row"><b>💎 Самоцветы · у вас ${s.gems || 0}</b><small>160 самоцветов = призыв героя, 100 = призыв снаряжения</small>
        <div class="gem-packs">${(s.gemPacks || []).map((g) => `<button class="gem-pack" data-buy="${g.id}"><img src="assets/ui/shop/${g.id}.webp" alt=""><b>${g.gems}</b><span>${g.amount} ⭐</span></button>`).join('')}</div></div>
      <div class="tw-banner hero has-art"><img class="tw-art" src="assets/ui/shop/gems4.webp" alt=""><b>🔮 Печати призыва</b><small>Призыв героев: Избранный недели и Зал героев</small>
        <div class="btn-row"><button class="l2-btn" data-buy="spin">+1 · 25 ⭐</button><button class="l2-btn" data-buy="spin10">+10 · 225 ⭐</button></div></div>
      <div class="tw-banner items has-art"><img class="tw-art" src="assets/ui/shop/gems3.webp" alt=""><b>🎁 Печати снаряжения</b><small>Гарантированный легендарный предмет каждые 50 круток</small>
        <div class="btn-row"><button class="l2-btn" data-buy="ispin">+1 · ${s.itemSpin.price} ⭐</button><button class="l2-btn" data-buy="ispin10">+10 · ${s.itemSpin.price10} ⭐</button></div></div>
      <div class="tw-banner pass has-art"><img class="tw-art" src="assets/ui/shop/pass.webp" alt=""><b>🎟️ Сезонные ордена</b>
        <small>${s.passTiers.map((t) => `${orderIc(t, 'sm')} ${t.name} · ${t.price} ⭐`).join('<br>')}<br>Мифический предмет на 30 уровне — в Ордене Чемпиона · автобой с Золотого ордена</small>
        ${s.passTier ? `<small class="ok">${orderIc(s.passTiers[s.passTier - 1], 'sm')} ${s.passTiers[s.passTier - 1].name} активен</small>` : ''}
        <button class="l2-btn" id="openOrders">${s.passTier >= 4 ? 'Награды сезона' : s.passTier ? 'Улучшить орден' : 'Выбрать орден'}</button></div>
      <div class="tw-banner items"><b>💎 GRAM-кошелёк · торговые ордена</b><small>Баланс для Рынка и Торгового дома, пополнение, вывод денег с продаж. Ордена Купца и Магната — меньше комиссии и больше лотов.</small>
        <button class="l2-btn" id="openWallet">Открыть кошелёк</button></div>
      <div class="tw-banner pass"><b>⚗️ Великие эликсиры · 1 час</b><small>Намного сильнее эликсиров из лавки и действуют вместе с ними. Попадают в сумку — выпейте, когда нужно. Сгорают при гибели героя.</small></div>
      ${(s.chests || []).filter((c) => c.elixir).map((c) => `<div class="tw-banner items elx has-art"><img class="tw-art" src="assets/items/mat_${c.id === 'elxXp2x5' ? 'elxXp2' : c.id}.webp" alt=""><b>${c.title}</b><small>${c.desc}</small>
        <button class="l2-btn" data-buy="${c.id}">${c.amount} ⭐</button></div>`).join('')}
      ${(s.chests || []).filter((c) => !c.elixir).map((c) => `<div class="tw-banner items ${shopArt(c) ? 'has-art' : ''}">${shopArt(c) ? `<img class="tw-art" src="assets/ui/shop/${shopArt(c)}.webp" alt="">` : ''}<b>${{ kitSmith: '🧰', chestSet: '🎁', chestSet5: '🎁', chestLegend: '👑', bagEpic: '🎒', bagLegend: '🎒' }[c.id] || '🎁'} ${c.title}</b><small>${c.desc}${c.bag ? ' · надевается в слот «Сумка» на герое' : ' · открывается в сумке, награда — мира, где вы его открыли'}</small>
        <button class="l2-btn" data-buy="${c.id}">${c.amount} ⭐</button></div>`).join('')}`);
    box.querySelectorAll('[data-buy]').forEach((b) => { b.onclick = () => buyStars(b.dataset.buy, storePanel); });
    box.querySelector('#openOrders').onclick = () => passPanel();
    box.querySelector('#openWallet').onclick = () => walletPanel(0);
    box.querySelector('#openLooks').onclick = () => looksPanel();
    const cc = box.querySelector('#cardClaim');
    if (cc) cc.onclick = async () => { const r = await Bag.act('cardClaim'); toast(r.error || r.toast); if (window.Sfx) Sfx.play(r.error ? 'error' : 'reward'); storePanel(); };
    open('💎 Магазин', box);
  }
  // Реклама: здесь подключается рекламная сеть Telegram Mini Apps (например, Adsgram: AdController.show()).
  // Пока — заглушка с таймером; награду начисляет сервер (op 'ad', лимит в день).
  function showAd(after) {
    const ov = $('adOverlay');
    ov.classList.remove('hidden');
    let left = 15;
    ov.querySelector('b').textContent = left;
    const tm = setInterval(async () => {
      ov.querySelector('b').textContent = --left;
      if (left > 0) return;
      clearInterval(tm);
      ov.classList.add('hidden');
      const r = await Bag.act('ad');
      toast(r.error || r.toast);
      if (after) after();
    }, 1000);
  }

  // ---------- Рейтинг арены (только просмотр; бои — в доме арены) ----------
  async function rankPanel() {
    const [{ arena: a }, info] = await Promise.all([Bag.act('arena'), new Promise((res) => ctx.socket.emit('arena', { op: 'info' }, res))]);
    if (!a) return toast('Рейтинг недоступен');
    const T = info && info.tour;
    const rows = (list, val) => list.length ? `<div class="tour-top">${list.map((t, i) => `<div class="top-row"><span>${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span><b>${t.name}</b><small>${t.hero}</small><em>${val(t)}</em></div>`).join('')}</div>`
      : '<p class="sheet-hint">Пока никто не сражался — станьте первым!</p>';
    const rating = () => el(`<p class="sheet-hint">Ваш рейтинг: <b>${a.rating}</b> · победы ${a.wins} · поражения ${a.losses}. Сражаться — в доме арены в городе.</p>${rows(a.top, (t) => t.rating)}`);
    const tour = () => {
      if (!T) return el('<p class="sheet-hint">Турнир недели скоро начнётся</p>');
      const left = Math.max(0, T.ends - Date.now()), dd = Math.floor(left / 864e5), hh = Math.floor((left % 864e5) / 36e5);
      return el(`<p class="sheet-hint">🏆 До итогов ${dd ? dd + ' д ' : ''}${hh} ч · ваши очки: <b>${T.my}</b>${T.place ? ` · место ${T.place}` : ''}<br>${T.prizes.map((p) => `${p.title} ${p.gems} 💎 + ${p.gold} 💰`).join(' · ')}</p>${rows(T.top, (t) => t.pts)}`);
    };
    open('🏆 Рейтинг арены', tabs([['Рейтинг', rating], ['Турнир недели', tour]]));
  }

  // ---------- PvP-арена ----------
  async function arenaPanel() {
    const { arena: a } = await Bag.act('arena');
    const info = await new Promise((res) => ctx.socket.emit('arena', { op: 'info' }, res));
    const DESC = {
      duel: 'Один на один с живым игроком. Победа — рейтинг и золото.',
      team: 'Двое на двое: вступите в группу с другом — встанете в очередь вместе, иначе подберём напарника.',
      clone: 'Ваша копия с тем же здоровьем и уроном. Победите самого себя!',
      champion: 'Тень лучшего игрока арены: его герой, сила подстроена под ваш уровень. За победу — самоцветы.',
    };
    const box = el(`<div class="pass-head"><b>🏟️ Рейтинг ${a.rating}</b><small>Победы ${a.wins} · поражения ${a.losses} · бои в реальном времени своими атаками и умениями. Арена этого мира — для героев ${{ town1: '1–20', town2: '15–35', town3: '30+' }[ctx.zone.id] || ''} уровня.</small></div>`);
    // Турнир недели: очки за бои, награды тройке лидеров в понедельник
    const T = info.tour;
    if (T) {
      const left = Math.max(0, T.ends - Date.now()), dd = Math.floor(left / 864e5), hh = Math.floor((left % 864e5) / 36e5);
      box.insertAdjacentHTML('beforeend', `<div class="tw-banner hero tour"><b>🏆 Турнир недели · до итогов ${dd ? dd + ' д ' : ''}${hh} ч</b>
        <small>Очки: победа в дуэли или командах — ${T.pts.win}, поражение — ${T.pts.loss}, победа в схватке — ${T.pts.kill}. Ваши очки: <b>${T.my}</b>${T.place ? ` · место ${T.place}` : ''}</small>
        <small>${T.prizes.map((p, i) => `${p.title} ${p.gems} 💎 + ${p.gold} 💰`).join(' · ')}</small>
        ${T.top.length ? `<div class="tour-top">${T.top.map((t, i) => `<div class="top-row"><span>${i < 3 ? T.prizes[i].title : i + 1}</span><b>${t.name}</b><small>${t.hero}</small><em>${t.pts}</em></div>`).join('')}</div>` : '<small>Пока никто не набрал очков — станьте первым!</small>'}
        ${T.last && T.last.length ? `<small>Прошлая неделя: ${T.last.map((t) => `${T.prizes[t.place - 1].title} ${t.name} (${t.pts})`).join(' · ')}</small>` : ''}</div>`);
      // GRAM-лига: взнос, призовой фонд 90%, тройке — 50/30/20%
      const G = T.gl;
      if (G) {
        const gl = el(`<div class="tw-banner hero tour"><b><img class="ui-ic" src="assets/ui/ic_gramleague.webp" alt=""> GRAM-лига · фонд ${G.pool.toFixed(2)} GRAM · участников ${G.n}</b>
          <small>Взнос ${G.fee} GRAM, с ${G.lvl} уровня. В зачёт — очки турнира после взноса. Призовой фонд — 90% взносов: 🥇 ${G.share[0] * 100}% · 🥈 ${G.share[1] * 100}% · 🥉 ${G.share[2] * 100}%. Если участников меньше ${G.min} — взносы вернутся. Призы можно вывести через 3 дня.</small>
          ${G.top.length ? `<div class="tour-top">${G.top.map((t, i) => `<div class="top-row"><span>${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span><b class="notr"></b><em>${t.pts}</em></div>`).join('')}</div>` : ''}
          ${G.last.length ? `<small>Прошлая неделя: ${G.last.map((w, i) => `${['🥇', '🥈', '🥉'][i]} ${w.name} +${w.gram} GRAM`).join(' · ')}</small>` : ''}
          ${G.joined ? '<small><b class="ok">✓ Вы участвуете</b></small>' : `<button class="l2-btn wide">Вступить за ${G.fee} GRAM</button>`}</div>`);
        gl.querySelectorAll('.tour-top .top-row b').forEach((b, i) => { b.textContent = G.top[i].name; });
        const jb = gl.querySelector('button');
        if (jb) jb.onclick = async () => {
          if (!(await askGram(`Вступить в GRAM-лигу за ${G.fee} GRAM?`))) return;
          const r = await new Promise((res) => ctx.socket.emit('arena', { op: 'glJoin' }, res));
          toast(r.error || r.toast);
          if (r.needGram) return walletPanel(0);
          if (!r.error) PANELS.arena();
        };
        box.append(gl);
      }
    }
    for (const m of info.modes) {
      const queued = info.queued === m.id;
      const sub = `${DESC[m.id] || ''}${m.solo ? ` · наград сегодня: ${m.perDay - m.left}/${m.perDay}` : ` · в очереди: ${m.waiting}`}`;
      const modeRow = row(null, m.name, sub, queued ? 'Выйти из очереди' : m.solo ? 'В бой' : 'В очередь', async () => {
        const r = await new Promise((res) => ctx.socket.emit('arena', { op: queued ? 'leave' : 'join', mode: m.id }, res));
        if (r.error) return toast(r.error);
        if (m.solo) close(); else { toast(queued ? 'Вы вышли из очереди' : 'Вы в очереди — бой начнётся, когда найдётся соперник'); arenaPanel(); }
      });
      modeRow.querySelector('.row-it').innerHTML = `<img class="mode-ic" src="assets/ui/ar_${m.id}.webp" alt="" onerror="this.remove()">`; // значок режима
      box.append(modeRow);
    }
    const ffa = row(null, 'Свободная схватка', 'Все против всех на общей арене мира: заходите и выходите когда угодно, возрождение на месте.', 'Войти', () => { ctx.socket.emit('travel', { via: 'arena' }); close(); });
    ffa.querySelector('.row-it').innerHTML = '<img class="mode-ic" src="assets/ui/ar_ffa.webp" alt="">';
    box.append(ffa);
    box.insertAdjacentHTML('beforeend', `<div class="ic-sec">Топ-10</div>${a.top.map((t, i) => `<div class="top-row"><span>${i + 1}</span><b>${t.name}</b><small>${t.hero}</small><em>${t.rating}</em></div>`).join('') || soon('Пока пусто')}`);
    open('🏟️ PvP-арена', box);
  }

  // ---------- Данж выживания ----------
  async function survivalPanel() {
    const box = el(`<div class="pass-head"><b>💀 Данж выживания</b>
      <small>Волны монстров этого мира становятся всё сильнее (уровень растёт каждые 2 волны), каждая 5-я — с полубоссом, каждая 10-я — с боссом. За каждую волну — золото, опыт пропуска и шанс предмета; на 5-й, 10-й, 15-й… — гарантированный редкий+ предмет.</small>
      <small>Идите соло или с группой (👥): все участники группы в этом городе войдут вместе. Смерть — возврат в город.</small></div>
      <button class="l2-btn wide" id="survGo">⚔️ Начать</button>`);
    box.querySelector('#survGo').onclick = () => { ctx.socket.emit('travel', { via: 'survival' }); close(); };
    // Испытание дня
    const T = await new Promise((res) => ctx.socket.emit('trialInfo', res));
    if (T) {
      const tb = el(`<div class="tw-banner hero trial"><b>🏅 Испытание дня: «${T.name}»</b><small>${T.desc}. Награда раз в день по числу пройденных волн: до 150 💎, волшебная пыль, с 20-й волны — кристалл мастерства.</small>
        ${T.done ? `<small class="ok">Сегодня пройдено: ${T.best} волн — новое испытание завтра</small>` : ''}
        ${T.top.length ? `<div class="tour-top">${T.top.map((t, i) => `<div class="top-row"><span>${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span><b></b><em>${t.wave}</em></div>`).join('')}</div>` : '<small>Сегодня ещё никто не проходил — станьте первым!</small>'}
        <button class="l2-btn wide" id="trialGo" ${T.done ? 'disabled' : ''}>🏅 Начать испытание</button></div>`);
      tb.querySelectorAll('.tour-top .top-row b').forEach((b, i) => { b.textContent = T.top[i].name; });
      tb.querySelector('#trialGo').onclick = () => { ctx.socket.emit('travel', { via: 'survival', trial: true }); close(); };
      box.append(tb);
    }
    open('💀 Данж выживания', box);
  }

  // ---------- Квесты (server/quests.js) ----------
  let questTab = 0;
  // Особые задания (server/special.js): подписка на канал/чат игры, партнёры → самоцветы. Горят, пока не выполнены
  const spHot = (list) => { const n = (list || []).filter((t) => !t.done).length; const b = document.querySelector('[data-nav="quests"]'); if (b) b.classList.toggle('sp-hot', n > 0); return n; };
  const openUrl = (u) => { const W = window.Telegram && window.Telegram.WebApp; if (W && /^https:\/\/t\.me\//.test(u) && W.openTelegramLink) W.openTelegramLink(u); else if (W && W.openLink) W.openLink(u); else window.open(u, '_blank'); };
  function specialPage(list, redraw) {
    return () => {
      const box = document.createElement('div');
      box.innerHTML = '<p class="sheet-hint">Разовые задания с наградой самоцветами: перейдите по ссылке, подпишитесь — и заберите награду.</p>';
      for (const t of list) {
        const row = el(`<div class="tw-ev quest sp-quest ${t.done ? 'claimed' : 'hot'}"><span class="tw-ev-i q-ic">${t.icon}</span><div><b></b><small></small><small class="q-rew">🎁 ${t.gems} 💎</small></div>
          <div class="sp-btns">${t.done ? '<button class="l2-btn" disabled>✔</button>' : `<button class="l2-btn sp-go">Перейти</button><button class="l2-btn sp-claim" ${t.went ? '' : 'disabled'}>Забрать</button>`}</div></div>`).firstElementChild;
        row.querySelector('b').textContent = t.name; row.querySelector('small').textContent = t.desc;
        const go = row.querySelector('.sp-go'), cl = row.querySelector('.sp-claim');
        if (go) go.onclick = async () => { openUrl(t.url); const res = await Bag.act('spGo', { id: t.id }); if (res.special) { t.went = true; cl.disabled = false; } };
        if (cl) cl.onclick = async () => {
          cl.disabled = true;
          const res = await Bag.act('spClaim', { id: t.id });
          toast(res.error || res.toast);
          if (window.Sfx) Sfx.play(res.error ? 'error' : 'reward');
          if (res.error) { cl.disabled = false; return; }
          redraw();
        };
        box.append(row);
      }
      return box;
    };
  }
  async function eventsPanel(r) {
    if (!r) r = await Bag.act('quests');
    if (!r.quests) return toast(r.error || 'Нет связи');
    const Q = r.quests;
    const spR = await Bag.act('spList'), SP = (spR && spR.special) || [], spN = spHot(SP);
    const page = (per) => () => {
      const box = document.createElement('div');
      const d = Q[per];
      box.innerHTML = `<p class="sheet-hint">Обновятся через ${fmtLeft(d.endsIn)} · ${per === 'monthly' ? 'награды месяца' : 'выполняйте задания — забирайте награды'}</p>`;
      for (const q of d.list) {
        const done = q.prog >= q.goal;
        const row = el(`<div class="tw-ev quest ${q.claimed ? 'claimed' : done ? 'ready' : ''}"><span class="tw-ev-i q-ic"><img src="assets/ui/quests/${q.id}.webp" alt="${q.icon}" onerror="this.replaceWith(this.alt)"></span><div><b>${q.name}</b><small>${q.desc}</small>
          <div class="tw-prog"><i style="width:${Math.round((100 * q.prog) / q.goal)}%"></i><em>${q.prog} / ${q.goal}</em></div>
          <small class="q-rew">${q.reward}${q.points ? ` · <img class="q-pt" src="assets/ui/quests/points.webp" alt="★"> ${q.points} очков` : ''}</small></div>
          <button class="l2-btn" ${done && !q.claimed ? '' : 'disabled'}>${q.claimed ? '✔' : '🎁'}</button></div>`).firstElementChild;
        row.querySelector('button').onclick = async () => {
          const res = await Bag.act('questClaim', { id: q.id });
          toast(res.error || res.toast);
          if (window.Sfx) Sfx.play(res.error ? 'error' : 'reward');
          questTab = lastTabIdx; eventsPanel(res);
        };
        box.append(row);
      }
      return box;
    };
    // Сюжет: один текущий шаг, пройденные — списком
    const S = r.story, sReady = S && S.cur && S.cur.prog >= S.cur.goal ? 1 : 0;
    const story = () => {
      const box = document.createElement('div');
      if (!S) return box;
      box.innerHTML = `<p class="sheet-hint">${S.chapter} · шаг ${Math.min(S.step + 1, S.total)} из ${S.total} — сюжет ведёт по всем местам игры</p>`;
      if (S.cur) {
        const q = S.cur;
        const row = el(`<div class="tw-ev quest story ${sReady ? 'ready' : ''}"><span class="tw-ev-i q-ic"><img src="assets/ui/quests/${q.id}.webp" alt="${q.icon}" onerror="this.replaceWith(this.alt)"></span><div><b>${q.name}</b><small>${q.desc}</small>
          <div class="tw-prog"><i style="width:${Math.round((100 * q.prog) / q.goal)}%"></i><em>${q.prog} / ${q.goal}</em></div>
          <small class="q-rew">${q.reward}</small></div>
          <button class="l2-btn" ${sReady ? '' : 'disabled'}>🎁</button></div>`).firstElementChild;
        row.querySelector('button').onclick = async () => {
          const res = await Bag.act('storyClaim');
          toast(res.error || res.toast);
          if (window.Sfx) Sfx.play(res.error ? 'error' : 'reward');
          if (ctx.onStory) ctx.onStory(res.story);
          questTab = 0; eventsPanel(res);
        };
        box.append(row);
      } else box.insertAdjacentHTML('beforeend', '<small>🌟 Вы прошли весь сюжет! Новые главы появятся с новыми мирами.</small>');
      if (S.done.length) box.insertAdjacentHTML('beforeend', `<div class="ic-sec">Пройдено</div><small class="story-done">${S.done.map((x) => `<span><img class="ui-ic" src="assets/ui/quests/${x.id}.webp" alt="${x.icon}" onerror="this.replaceWith(this.alt)">${x.name}</span>`).join(' ')}</small>`);
      return box;
    };
    const cnt = (per) => Q[per].list.filter((q) => q.prog >= q.goal && !q.claimed).length;
    if (ctx.onQuests) ctx.onQuests(sReady + cnt('daily') + cnt('weekly') + cnt('monthly') + spN);
    if (ctx.onStory) ctx.onStory(S);
    const lbl = (n, per) => n + (cnt(per) ? ` (${cnt(per)})` : '');
    const spTab = SP.length ? [[`Особые${spN ? ` (${spN})` : ''}`, specialPage(SP, () => { questTab = 0; eventsPanel(); })]] : [];
    open('📜 Квесты', tabs([['Сюжет' + (sReady ? ' (1)' : ''), story], ...(spN ? spTab : []), [lbl('Ежедневные', 'daily'), page('daily')], [lbl('Еженедельные', 'weekly'), page('weekly')], [lbl('Ежемесячные', 'monthly'), page('monthly')], ...(spN ? [] : spTab)], questTab));
    questTab = 0;
  }

  // ---------- Телепорт ----------
  function teleportPanel() {
    const box = document.createElement('div');
    box.innerHTML = '<p class="sheet-hint">Выберите город для путешествия</p>';
    for (const t of ctx.towns) {
      const here = t.id === ctx.zone.id, lv = (ctx.hero && ctx.heroLevel ? ctx.heroLevel() : 99), low = lv < (t.minLevel || 1);
      const r = el(`<div class="tw-town ${t.theme}"><div><b>${t.name}</b><small>${t.sub} · уровни ${t.level}</small></div>
        <button class="l2-btn" ${here || low ? 'disabled' : ''}>${here ? 'Вы здесь' : low ? `🔒 с ${t.minLevel} ур.` : 'Отправиться'}</button></div>`).firstElementChild;
      r.querySelector('button').onclick = () => { ctx.socket.emit('travel', { via: 'teleport', to: t.id }); close(); };
      box.append(r);
    }
    open('🌀 Телепорт', box);
  }

  // ---------- Зал мастеров ----------
  async function trainerPanel(tabIdx) {
    const inv = await Bag.refresh();
    const h = ctx.heroes[inv.hero.id], U = ctx.skillUnlock, hero = inv.hero;
    const fmt = (n) => Number(n).toLocaleString('ru-RU');
    const pct = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',');
    const again = (r, idx) => { toast(r.error || r.toast); if (window.Sfx) Sfx.play(r.error ? 'error' : 'reward'); if (!r.error) trainerPanel(idx); };
    const skills = () => {
      const P = hero.pas, maxed = P.lvl >= P.max, low = hero.level < P.req;
      const box = el(`<p class="sheet-hint">Умения открываются по уровню героя ИЛИ по числу дубликатов (призыв на алтаре). Сейчас: ур. ${hero.level}, дубликатов ${hero.dupes}. Силу открытых умений повышают в окне героя → «Умения».</p>`
        + `<div class="tw-ev tw-pas"><span class="tw-ev-i">${SkillArt.icon(hero.id, 'p', h.passive.icon)}</span><div><b>${h.passive.name} · пассивный · ур. ${P.lvl} / ${P.max}</b>
          <small>${h.passive.desc}</small>
          <small class="ok">Мастерство: эффект пассивки сильнее на ${P.pct}% · +${P.lvl - 1}% урона и здоровья</small>
          ${maxed ? '<small>Максимальный уровень</small>' : `<small>→ ур. ${P.lvl + 1}: эффект +${P.next}%, +1% урона и здоровья · ✨ ${P.cost.dust} пыли · 💰 ${fmt(P.cost.gold)}${low ? ` · нужен ${P.req} ур. героя` : ''}</small>
          <button class="l2-btn" id="pasUp" ${low ? 'disabled' : ''}>⬆️ Улучшить пассивку</button>`}</div></div>`
        + h.skills.map((sk, i) => `<div class="tw-ev"><span class="tw-ev-i ${i < hero.unlocked ? '' : 'lock'}">${SkillArt.icon(hero.id, i, i < hero.unlocked ? sk.icon : '🔒')}</span>
      <div><b>${sk.name}</b><small>${i < hero.unlocked ? 'Открыто' : `Откроется: ${U[i].lvl} уровень или ${U[i].dup} дубл.`}</small><small>${sk.desc}</small></div></div>`).join(''));
      const b = box.querySelector('#pasUp');
      if (b) b.onclick = async () => again(await Bag.act('pasUp'), 0);
      return box;
    };
    const STAT = { atkP: 'урона', hpP: 'здоровья', aspd: 'скорости атаки', skill: 'силы умений', crit: 'шанса крита', critDmg: 'крит. урона', def: 'защиты' };
    const per = (o, k = 1) => Object.entries(o).map(([s, v]) => `+${pct(v * k)}% ${STAT[s] || s}`).join(', ');
    const tree = () => {
      const T = hero.tree, spent = Object.values(T).reduce((a, n) => a + n.lvl, 0);
      const box = el(`<p class="sheet-hint">Уровень каждой характеристики — не выше половины уровня героя (до ${Object.values(T)[0].max} на 50 ур.). Каждое улучшение стоит золота, цена растёт. У каждого героя — своя ветка. Вложено уровней: ${spent} · 💰 ${fmt(inv.gold)}</p>
        <div class="tw-tree2">${Object.entries(T).map(([k, n]) => {
          const maxed = n.lvl >= n.max, low = hero.level < n.req;
          return `<div class="tw-node2"><span><img class="at-ic" src="assets/ui/at_${k}.webp" alt=""></span>
            <div class="tn-main"><b>${n.name} · ${n.lvl} / ${n.max}</b><small>${n.lvl ? `Сейчас: ${per(n.per, n.lvl)}` : `За уровень: ${per(n.per)}`}</small>
            <small>${maxed ? 'Максимум' : `→ ${n.lvl + 1}: 💰 ${fmt(n.cost)}${low ? ` · нужен ${n.req} ур. героя` : ''}`}</small></div>
            <button class="l2-btn" data-k="${k}" ${maxed || low ? 'disabled' : ''}>+</button></div>`;
        }).join('')}</div>`);
      box.querySelectorAll('[data-k]').forEach((b) => { b.onclick = async () => again(await Bag.act('treeUp', { k: b.dataset.k }), 1); });
      return box;
    };
    open('📖 Зал мастеров', tabs([['Умения и пассивка', skills], ['Ветка характеристик', tree]], tabIdx || 0));
  }

  // ---------- Кузница: рецепты мира. Слева — что получится, справа — слоты всего нужного: есть — светится, нет — тусклый ----------
  const WORLD_NAMES = { 1: 'Эльдмир', 2: 'Морграт', 3: 'Аэлион' }, WORLD_IN = { 1: 'Эльдмире', 2: 'Морграте', 3: 'Аэлионе' };
  let crStones = 0; // сколько камней удачи положено к ковке
  async function craftBody(tier, pickId, itemId) {
    const box = document.createElement('div');
    await Bag.refresh(); // ячейки предметов рисуются по данным сумки
    const r = await Bag.act('recipes', { tier });
    if (r.error) { box.innerHTML = soon(r.error); return box; }
    const reload = async (rid, iid) => box.replaceWith(await craftBody(r.tier, rid, iid));
    // Миры: свой — открыт, чужие — посмотреть рецепты
    const worlds = el(`<div class="cr-worlds">${[1, 2, 3].map((t) => `<button data-t="${t}" class="${t === r.tier ? 'on' : ''}">${ROMAN[t]} · ${WORLD_NAMES[t]}${t === ctx.zone.tier ? ' ✦' : ''}</button>`).join('')}</div>`).firstElementChild;
    worlds.onclick = async (e) => { const b = e.target.closest('[data-t]'); if (b) box.replaceWith(await craftBody(+b.dataset.t)); };
    box.append(worlds);
    box.insertAdjacentHTML('beforeend', `<p class="sheet-hint">${r.title}${r.here ? '' : ` · ковать можно только в ${WORLD_IN[r.tier]}`} · 💰 ${r.gold.toLocaleString('ru-RU')}</p>`);
    const rec = r.list.find((x) => x.id === pickId) || r.list[0];
    // Выбранный рецепт: результат → слоты
    const item = rec.items.find((i) => i.id === itemId) || rec.items[0];
    const slot = (inner, ok, label, cls = '') => `<div class="cr-slot ${ok ? 'ok' : 'no'} ${cls}"><div class="cr-cell">${inner}</div><small>${label}</small></div>`;
    const ghost = (cat) => `<img class="it-art slot-ghost" src="assets/items/slot_${cat}.webp" alt="">`;
    const need = [];
    if (rec.needItem) need.push(slot(item ? Bag.cell(item) : `<button class="it" style="--rc:${rec.needItem.color}"><span>${ghost(rec.slot)}</span></button>`, !!item,
      item ? `${item.name}${rec.items.length > 1 ? ` · ещё ${rec.items.length - 1} ⟳` : ''}` : `${rec.slotName} · ${rec.needItem.rarName.toLowerCase()}`, 'item'));
    for (const m of rec.mats) need.push(slot(Bag.cell({ ...m, n: 1 }), m.have >= m.need, `${m.name} <b>${m.have}/${m.need}</b>`));
    need.push(slot(`<button class="it" style="--rc:#d4a63c"><span><img class="it-art" src="assets/ui/ic_coin.webp" alt=""></span></button>`, r.gold >= rec.gold, `Золото <b>${rec.gold.toLocaleString('ru-RU')}</b>`));
    crStones = Math.max(0, Math.min(crStones, r.stones, r.stone.max));
    const chance = Math.min(r.stone.cap, rec.chance + crStones * r.stone.per);
    const res = item ? { ...item, rar: rec.rar, color: rec.color, dupes: 0 } : null;
    const view = el(`<div class="cr-view"><div class="cr-res"><div class="cr-cell big">${res ? Bag.cell(res) : `<button class="it" style="--rc:${rec.color}"><span>${ghost(rec.slot)}</span></button>`}</div>
        <b style="color:${rec.color}">${rec.kind === 'relic' ? `${rec.slotName} ${['cloak', 'belt', 'earring'].includes(rec.slot) ? 'вашего класса' : 'комплекта'}` : res ? res.name : rec.slotName}</b><small>${rec.rarName}${rec.kind === 'relic' ? ` · класс «${r.clsName || '—'}»` : ' · атрибуты выпадут заново'}</small>
        <em class="cr-chance ${chance < 0.5 ? 'low' : ''}">🎲 Шанс успеха ${Math.round(chance * 100)}%${crStones ? ` (+${Math.round(crStones * r.stone.per * 100)}%)` : ''}</em></div>
      <div class="cr-arrow">⟵</div><div class="cr-need">${need.join('')}</div></div>
      <div class="cr-stone ${r.stones ? '' : 'none'}"><div class="cr-cell">${Bag.cell({ ...r.stone, n: 1 })}</div>
        <div><b>Камень удачи</b><small>${r.stones ? `+${Math.round(r.stone.per * 100)}% за камень, до ${r.stone.max} · у вас ${r.stones}` : 'Нет камней — редко падают с полубоссов и боссов'}</small></div>
        <button type="button" data-st="-1" ${crStones ? '' : 'disabled'}>−</button><em>${crStones}</em><button type="button" data-st="1" ${crStones < Math.min(r.stones, r.stone.max) ? '' : 'disabled'}>+</button></div>
      <button class="l2-btn cr-go" ${rec.ok && r.here ? '' : 'disabled'}>⚒️ ${r.here ? (rec.ok ? 'Создать' : 'Не хватает того, что тусклое') : `Ковать можно только в ${WORLD_IN[r.tier]}`}</button>`);
    view.querySelector('.cr-slot.item') && (view.querySelector('.cr-slot.item').onclick = () => { // перебор подходящих вещей
      if (rec.items.length < 2) return; const i = rec.items.indexOf(item); reload(rec.id, rec.items[(i + 1) % rec.items.length].id); });
    view.querySelector('.cr-stone').onclick = (e) => { const b = e.target.closest('[data-st]'); if (!b || b.disabled) return; crStones += +b.dataset.st; reload(rec.id, item && item.id); };
    view.querySelector('.cr-go').onclick = async () => {
      const out = await Bag.act('craft', { id: rec.id, item: item && item.id, stones: crStones });
      crStones = 0;
      toast(out.error || out.toast); if (out.error) return;
      if (out.failed) { if (window.Sfx) Sfx.play('error'); return reload(rec.id, item && item.id); }
      if (window.Sfx) Sfx.play('reward');
      Bag.card(out.result, []); reload(rec.id);
    };
    box.append(view);
    // Список всего, что куётся в этом мире
    box.insertAdjacentHTML('beforeend', `<div class="ic-sec">Что куётся в ${WORLD_IN[r.tier]}</div>`);
    const list = el(`<div class="cr-list">${r.list.map((x) => `<button data-r="${x.id}" class="cr-row ${x.id === rec.id ? 'on' : ''} ${x.ok ? 'can' : ''}">
        <span class="it" style="--rc:${x.color}"><span>${ghost(x.slot)}</span></span><div><b>${x.kind === 'relic' ? '🌟 ' : ''}${x.name}</b>
        <small>${x.needItem ? `${x.needItem.rarName} → ` : ''}<i style="color:${x.color}">${x.rarName}</i> · 🎲 ${Math.round(x.chance * 100)}%${x.ok ? ' · ✔ можно создать' : ''}</small></div></button>`).join('')}</div>`).firstElementChild;
    list.onclick = async (e) => { const b = e.target.closest('[data-r]'); if (!b) return; await reload(b.dataset.r); $('sheetBody').scrollTo({ top: 0, behavior: 'smooth' }); };
    box.append(list);
    box.insertAdjacentHTML('beforeend', `<p class="sheet-hint">Ковка может не удаться — тогда материалы и золото сгорают, а вещь остаётся. Руда и эссенция — с монстров этого мира (в Морграте и Аэлионе падают реже и в лавке не продаются), сердца — с полубоссов и боссов, свитки — в лавке кузнеца и с боссов.</p>`);
    return box;
  }
  // Разбор: вещь → материалы её мира
  async function salvageBody() {
    const inv = await Bag.refresh();
    const box = document.createElement('div');
    box.innerHTML = '<p class="sheet-hint">Нажмите на вещь, чтобы разобрать её на материалы. Надетые вещи не показываются.</p>';
    box.append(Bag.grid(inv.items.filter((i) => i.loc !== 'wh' && i.cat !== 'rune' && !Bag.isEquipped(i)), (it) => Bag.card(it, [['♻️ Разобрать', async () => {
      const res = await Bag.act('salvage', { id: it.id }); toast(res.error || res.toast); box.replaceWith(await salvageBody()); }, 'warn']]), { empty: 'Нечего разбирать' }));
    return box;
  }
  function smithPanel(itemId) {
    // Из карточки вещи «В кузницу» — сразу рецепт для этой вещи
    const it = itemId && Bag.inv() && Bag.inv().items.find((i) => i.id === itemId);
    const rid = it && it.cat !== 'rune' ? `w${ctx.zone.tier}_${it.cat}` : null;
    open('🔨 Кузница', tabs([['Рецепты', () => craftBody(ctx.zone.tier, rid, itemId)], ['Соединение 5 → 1', () => Bag.mergeTab()], ['Разбор', salvageBody], ['Лавка кузнеца', () => shopList('smith')]]));
  }

  // ---------- Награда за вход: 7 дней подряд ----------
  async function loginPanel(r) {
    if (!r || !r.login) r = await Bag.act('login');
    if (!r.login) return toast(r.error || 'Нет связи');
    const L = r.login;
    const box = el(`<p class="sheet-hint">Заходите каждый день: награда растёт. Пропустите день — серия начнётся с первого дня. ${L.streak ? `Серия: <b>${L.streak}</b> дн. подряд` : ''}</p>
      <div class="login-grid">${L.days.map((d) => `<div class="login-day ${d.i < L.day || (L.done && d.i === L.day) ? 'got' : d.i === L.day ? 'today' : ''} ${d.big ? 'big' : ''}">
        <b>День ${d.i + 1}</b>${d.art ? `<img src="assets/items/mat_${d.art}.webp" alt="" onerror="this.remove()">` : `<img src="assets/ui/ic_gift.webp" alt="">`}
        <small>${d.items.join('<br>')}</small>${d.i < L.day || (L.done && d.i === L.day) ? '<i>✔</i>' : ''}</div>`).join('')}</div>
      ${L.card ? '<button class="l2-btn wide" id="loginCard">📅 Карта месяца: забрать 💎 100</button>' : ''}
      <button class="l2-btn wide" id="loginGo" ${L.done ? 'disabled' : ''}>${L.done ? 'Получено — приходите завтра' : `🎁 Забрать награду дня ${L.day + 1}`}</button>`);
    const lc = box.querySelector('#loginCard');
    if (lc) lc.onclick = async () => { const x = await Bag.act('cardClaim'); toast(x.error || x.toast); if (window.Sfx) Sfx.play(x.error ? 'error' : 'reward'); loginPanel(); };
    box.querySelector('#loginGo').onclick = async () => {
      const x = await Bag.act('loginClaim');
      toast(x.error || x.toast);
      if (window.Sfx) Sfx.play(x.error ? 'error' : 'reward');
      if (!x.error) Bag.refresh();
      loginPanel(x);
    };
    open('🎁 Награда за вход', box);
  }

  // ---------- Внешний вид: цвет имени, сияние, рамка аватара (за самоцветы) ----------
  async function looksPanel(r) {
    if (!r || !r.cosm) r = await Bag.act('cosmetics');
    if (!r.cosm) return toast(r.error || 'Нет связи');
    const C = r.cosm;
    const box = el(`<p class="sheet-hint">Видно всем игрокам: цвет имени и сияние под героем. Рамка — у вашего портрета. На силу не влияет. В каждом разделе две вещи за самоцветы (у вас ${C.gems} 💎), остальные — за GRAM из GRAM-кошелька.</p>`);
    const KIND = { name: 'Цвет имени', aura: 'Сияние под героем', frame: 'Рамка портрета' };
    for (const kind of ['name', 'aura', 'frame']) {
      box.append(el(`<div class="ic-sec">${KIND[kind]}</div>`));
      for (const it of C.list.filter((x) => x.kind === kind)) {
        const on = C.cur[kind] === it.key;
        const sw = kind === 'frame' ? `<img class="look-fr" src="assets/ui/ava/${it.key}.webp?v=2" alt="">` : `<i class="look-sw ${kind}" style="--c:${it.color}"></i>`;
        const row = el(`<div class="tw-ev"><span class="tw-ev-i">${sw}</span><div><b ${kind === 'name' ? `style="color:${it.color}"` : ''}>${it.name}</b><small>${it.owned ? (on ? '✔ Надето' : 'Куплено') : it.gram ? `${gfmt(it.gram)} GRAM` : `${it.price} 💎`}</small></div>
          <button class="l2-btn">${!it.owned ? 'Купить' : on ? 'Снять' : 'Надеть'}</button></div>`).firstElementChild;
        row.querySelector('button').onclick = async () => {
          if (!it.owned && it.gram && !(await askGram(`Купить «${it.name}» за ${gfmt(it.gram)} GRAM?`))) return;
          const x = !it.owned ? await Bag.act('cosmeticBuy', { id: it.id }) : await Bag.act('cosmeticSet', { kind, id: on ? null : it.key });
          toast(x.error || x.toast); if (window.Sfx) Sfx.play(x.error ? 'error' : 'reward');
          if (x.needGram) return walletPanel(0);
          if (x.cosm) looksPanel(x);
        };
        box.append(row);
      }
    }
    open('✨ Внешний вид', box);
  }

  // ---------- Поручители (задания у NPC) ----------
  async function npcPanel(id, view) {
    const v = view || await Bag.act('npcView', { npc: id });
    if (!v || v.error) { toast((v && v.error) || 'NPC недоступен'); return; }
    const sk = window.Skins && Skins.get(v.skin), q = v.quest;
    const pic = `assets/npc/portrait_${id}.webp?v=1`; // нарисованный портрет поручителя; нет — портрет героя
    const box = el(`<div class="npc-head"><img src="${pic}" alt="" onerror="${sk && sk.portrait ? `this.onerror=null;this.src='${sk.portrait}'` : 'this.remove()'}"><div><b>${v.name} ${v.title}</b><p>«${v.hello}»</p></div></div>
      ${q ? `<div class="npc-q ${q.ready ? 'ready' : ''}"><div class="npc-qt">${q.daily ? '🔁 Поручение дня' : `📜 Поручение ${v.step} из ${v.total}`}</div>
        <b>${q.name}</b><p>${q.desc}</p>
        ${q.acc || q.collect ? `<div class="tw-prog"><i style="width:${Math.min(100, q.prog / q.goal * 100)}%"></i><em>${q.prog} / ${q.goal}</em></div>` : ''}
        <div class="npc-rw"><small>Награда:</small> ${q.reward.map((r) => `<span>${r}</span>`).join('')}</div>
        ${q.minLv && v.lvl < q.minLv && !q.acc ? `<p class="npc-low">🔒 Нужен ${q.minLv} уровень героя (сейчас ${v.lvl})</p>` : ''}
        <button class="l2-btn wide" id="npcBtn" ${(q.minLv && v.lvl < q.minLv && !q.acc) || (q.acc && !q.ready) ? 'disabled' : ''}>${q.ready ? '✅ Сдать поручение' : q.acc ? 'Выполняется…' : '📜 Взять поручение'}</button></div>`
      : `<div class="npc-q"><b>На сегодня всё</b><p>Вы выполнили все мои поручения. Приходите завтра — будет новое поручение дня.</p></div>`}`);
    const b = box.querySelector('#npcBtn');
    if (b) b.onclick = async () => {
      const r = await Bag.act(q.ready ? 'npcTurnIn' : 'npcAccept', { npc: id });
      toast(r.error || r.toast);
      if (window.Sfx) Sfx.play(r.error ? 'error' : r.reward ? 'reward' : 'click');
      if (r.view) npcPanel(id, r.view);
      if (window.gameScene && window.gameScene.refreshNpcMarks) window.gameScene.refreshNpcMarks();
    };
    open(`📜 ${v.name}`, box);
  }

  const PANELS = {
    looks: looksPanel,
    login: loginPanel,
    warehouse: warehousePanel,
    equip: () => shopPanel('equip', '⚔️ Оружие и доспехи'),
    alchemy: () => shopPanel('alchemy', '🧪 Эликсиры и свитки'),
    smith: smithPanel,
    runes: runesPanel,
    trainer: trainerPanel,
    auction: () => tradeHousePanel(),
    market: () => gramMarketPanel(),
    wallet: (tab) => walletPanel(tab || 0),
    events: eventsPanel,
    gacha: gachaPanel,
    teleport: teleportPanel,
    arena: arenaPanel,
    arenaRank: rankPanel,
    survival: survivalPanel,
    pass: passPanel,
    store: storePanel,
  };

  return {
    setContext: (c) => { ctx = { ...ctx, ...c }; },
    placeImg,
    openPlace: (id, arg) => { if (!PANELS[id]) return; Promise.resolve().then(() => PANELS[id](arg)).catch((e) => { console.error(id, e); toast('Не удалось открыть — попробуйте ещё раз'); }); },
    open, close, tabs, toast, openNpc: (id) => npcPanel(id).catch((e) => { console.error('npc', e); toast('Не удалось открыть — попробуйте ещё раз'); }),
    lastTab: () => lastTabIdx,
    heroes: () => ctx.heroes,
    skillUnlock: () => ctx.skillUnlock,
    inTown: () => ctx.zone && ctx.zone.kind === 'town',
  };
})();
