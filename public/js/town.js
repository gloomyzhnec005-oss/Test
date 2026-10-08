// Окна городских мест: склад, магазины, кузница (соединение), руны, мастера, аукцион, рынок,
// события, телепорт, призыв, PvP-арена, данж выживания, батл-пасс и магазин (подписка, крутки, реклама).
window.Town = (() => {
  const $ = (id) => document.getElementById(id);
  let ctx = {}; // { socket, zone, towns, hero, heroes, skillUnlock, onGacha, api, tg }
  let lastTabIdx = 0;
  const TIER_LABEL = { 1: 'Ассортимент мира I', 2: 'Ассортимент мира II (продвинутый)', 3: 'Ассортимент мира III (небесный)' };
  const ROMAN = ['', 'I', 'II', 'III'];

  function open(title, body) {
    $('sheetTitle').textContent = title;
    const sb = $('sheetBody');
    sb.innerHTML = '';
    sb.append(body);
    $('sheet').classList.remove('hidden');
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
  async function buyStars(item, after) {
    const { ok, data } = await ctx.api('/api/invoice', { item });
    if (!ok) return toast(data.error || 'Оплата недоступна');
    if (data.devPaid) { toast('Покупка зачислена (тестовый режим)'); if (after) after(); return; }
    if (!ctx.tg || !ctx.tg.openInvoice) return toast('Покупки за Stars доступны в Telegram');
    ctx.tg.openInvoice(data.link, (status) => {
      if (status === 'paid') { toast('Оплата получена!'); setTimeout(() => after && after(), 1500); }
    });
  }

  // Строка товара/лота: ячейка предмета + текст + кнопка
  function row(it, title, sub, btnLabel, onBtn, disabled = false) {
    const r = el(`<div class="tw-ev"><div class="row-it"></div><div><b style="color:${it ? it.color : '#ffe9b0'}">${title}</b><small>${sub}</small></div>
      ${btnLabel ? `<button class="l2-btn" ${disabled ? 'disabled' : ''}>${btnLabel}</button>` : ''}</div>`).firstElementChild;
    if (it) { r.querySelector('.row-it').innerHTML = Bag.cell(it); r.querySelector('.row-it').onclick = () => Bag.card(it); }
    if (btnLabel) r.querySelector('button').onclick = onBtn;
    return r;
  }

  // ---------- Магазины ----------
  // Строка товара-материала: кнопки ×1 / ×5 / ×10 (с учётом дневного лимита)
  function matRow(o, kind, reload) {
    const m = o.mat;
    const r = el(`<div class="tw-ev"><div class="row-it">${Bag.cell(m)}</div><div><b style="color:${m.color}">${m.icon} ${m.name}</b>
      <small>${o.price} 💰 за шт.${o.left !== null ? ` · осталось сегодня ${o.left}` : ''}</small><small>${m.desc}</small></div><div class="btn-col"></div></div>`).firstElementChild;
    r.querySelector('.row-it').onclick = () => Bag.card(m, []);
    const col = r.querySelector('.btn-col');
    for (const n of o.left !== null ? [1, o.left].filter((x, i, a) => x > 0 && a.indexOf(x) === i) : [1, 5, 10]) {
      const b = document.createElement('button'); b.className = 'l2-btn'; b.textContent = `×${n} · ${o.price * n}`;
      b.disabled = o.sold;
      b.onclick = async () => { const res = await Bag.act('buy', { kind, oid: o.oid, n }); toast(res.error || res.toast); reload(); };
      col.append(b);
    }
    return r;
  }
  async function shopList(kind) {
    const r = await Bag.act('shop', { kind });
    const box = document.createElement('div');
    const reload = async () => { const nb = await shopList(kind); box.replaceWith(nb); };
    box.innerHTML = `<p class="sheet-hint">${TIER_LABEL[ctx.zone.tier]} · ${kind === 'alchemy' || kind === 'smith' ? 'товары не кончаются (кроме отмеченных)' : 'витрина обновляется каждый день'} · 💰 ${r.gold}</p>`;
    for (const o of r.offers || []) {
      const it = o.item;
      if (o.mat) { box.append(matRow(o, kind, reload)); continue; }
      box.append(row(it, it.name, `${it.rarName} · ${Object.entries(it.stats).map(([k, v]) => Bag.statLine(k, v)).join(', ')}`,
        o.sold ? 'Куплено' : `${o.price} 💰`, async () => { const res = await Bag.act('buy', { kind, oid: o.oid }); toast(res.error || res.toast); reload(); }, o.sold));
    }
    return box;
  }
  async function shopPanel(kind, title) {
    const sellTab = async () => {
      const inv = await Bag.refresh();
      const box = el('<p class="sheet-hint">Продажа торговцу — тап по предмету. Дороже можно продать игрокам на рынке и аукционе.</p>');
      box.append(Bag.grid(inv.mats, (m) => Bag.card(m, Bag.matActions(m, () => shopPanel(kind, title))), { empty: 'Ресурсов нет', keepOrder: true }));
      return box;
    };
    open(title, tabs([['Купить', () => shopList(kind)], ['Продать', sellTab]]));
  }

  // ---------- Склад ----------
  async function warehousePanel() {
    const inv = await Bag.refresh();
    const box = document.createElement('div');
    const move = async (it) => { const r = await Bag.act('store', { id: it.id }); toast(r.error || r.toast); warehousePanel(); };
    const bag = inv.items.filter((i) => i.loc !== 'wh' && !Bag.isEquipped(i)), wh = inv.items.filter((i) => i.loc === 'wh');
    box.innerHTML = `<p class="sheet-hint">Общий склад аккаунта · тап по предмету — перенести</p><div class="ic-sec">🎒 Сумка ${inv.items.filter((i) => i.loc !== 'wh').length} / ${inv.bagSize}</div>`;
    box.append(Bag.grid(bag, move, { empty: 'Сумка пуста' }));
    box.insertAdjacentHTML('beforeend', `<div class="ic-sec">📦 Склад ${wh.length} / ${inv.whSize}</div>`);
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
    box.innerHTML = `<p class="sheet-hint">Выберите оружие, затем руну из сумки. Гнёзд: обычное/редкое 1, эпическое/легендарное 2, мифическое 3. Извлечение руны — ${50 * w.tier} 💰</p><div class="ic-sec">Оружие</div>`;
    box.append(Bag.grid(weapons, (it) => reload(it.id), { selected: new Set([w.id]) }));
    box.insertAdjacentHTML('beforeend', `<div class="ic-sec">Гнёзда «${w.name}»: ${w.runes.length} / ${w.sockets}</div>`);
    const sock = document.createElement('div');
    sock.className = 'merge-slots';
    sock.innerHTML = [...w.runes.map((r) => Bag.cell(r)), ...Array(Math.max(0, w.sockets - w.runes.length)).fill('<button class="it empty"><span>◇</span></button>')].join('');
    sock.onclick = async (e) => {
      const b = e.target.closest('.it');
      const idx = [...sock.children].indexOf(b);
      if (!b || idx < 0 || idx >= w.runes.length) return;
      const r = await Bag.act('unsocket', { weapon: w.id, idx }); toast(r.error || r.toast); reload(w.id);
    };
    box.append(sock);
    box.insertAdjacentHTML('beforeend', '<div class="ic-sec">Руны в сумке — тап, чтобы вставить</div>');
    box.append(Bag.grid(inv.items.filter((i) => i.cat === 'rune' && i.loc !== 'wh'), async (rn) => {
      const r = await Bag.act('socket', { weapon: w.id, rune: rn.id }); toast(r.error || r.toast); reload(w.id);
    }, { empty: 'Рун нет — купите во вкладке «Купить руны» или выбейте с монстров' }));
    return box;
  }
  const runesPanel = () => open('💠 Рунная мастерская', tabs([['Вставить руну', () => runesBody()], ['Купить руны', () => shopList('runes')]]));

  // ---------- Рынок (фиксированная цена) ----------
  async function marketPanel(tab = 0) {
    const r = await Bag.act('market');
    const buyTab = () => {
      const box = el(`<p class="sheet-hint">Товары игроков · комиссия продавца ${Math.round(r.fee * 100)}% · 💰 ${r.gold}</p>`);
      const lots = r.lots.filter((l) => !l.mine);
      if (!lots.length) box.insertAdjacentHTML('beforeend', soon('Прилавки пусты'));
      for (const l of lots) box.append(row(l.item, l.item.name, `${l.item.rarName} · продавец ${l.seller}`, `${l.price} 💰`, async () => { const res = await Bag.act('marketBuy', { id: l.id }); toast(res.error || res.toast); marketPanel(0); }));
      return box;
    };
    const myTab = () => {
      const mine = r.lots.filter((l) => l.mine);
      const box = el(`<p class="sheet-hint">Ваши лоты ${mine.length} / ${r.slots} · деньги приходят даже когда вы не в игре</p>`);
      for (const l of mine) box.append(row(l.item, l.item.name, `за ${l.price} 💰`, 'Снять', async () => { const res = await Bag.act('marketCancel', { id: l.id }); toast(res.error || res.toast); marketPanel(1); }));
      const add = document.createElement('button');
      add.className = 'l2-btn wide'; add.textContent = '＋ Выставить предмет';
      add.onclick = () => Bag.pick('Что продаём?', () => true, (it) => priceForm(it, 'Цена', (price) => Bag.act('marketSell', { id: it.id, price }), () => marketPanel(1)));
      const addM = document.createElement('button');
      addM.className = 'l2-btn wide'; addM.textContent = '＋ Выставить материалы';
      addM.onclick = () => pickMat((m) => matForm(m, 'Цена за всю стопку', (price, n) => Bag.act('marketSell', { mat: m.mat, n, price }), () => marketPanel(1)));
      box.append(add, addM);
      return box;
    };
    open('🏪 Рынок', tabs([['Купить', buyTab], ['Мой прилавок', myTab]], tab));
  }
  function priceForm(it, label, submit, done, extra = '') {
    const box = el(`<div class="tw-form"><input type="number" min="10" inputmode="numeric" placeholder="${label}, 💰" value="${it.sell * 2}">${extra}</div><button class="l2-btn wide">Подтвердить</button>`);
    box.prepend(row(it, it.name, it.rarName, null));
    box.querySelector('button.l2-btn.wide').onclick = async () => {
      const v = box.querySelector('input').value, sel = box.querySelector('select');
      const res = await submit(Number(v), sel ? sel.value : null);
      toast(res.error || res.toast);
      if (!res.error) done();
    };
    open('Цена', box);
  }

  // Выбор материала и формы «количество + цена»
  async function pickMat(onPick) {
    const inv = await Bag.refresh();
    const box = el('<p class="sheet-hint">Какие материалы, свитки или зелья продаём?</p>');
    box.append(Bag.grid(inv.mats, onPick, { empty: 'Ресурсов нет', keepOrder: true }));
    open('Что продаём?', box);
  }
  function matForm(m, label, submit, done, extra = '') {
    const box = el(`<div class="tw-form"><input class="qty" type="number" min="1" max="${m.n}" inputmode="numeric" value="${m.n}" placeholder="Количество (до ${m.n})">
      <input class="price" type="number" min="10" inputmode="numeric" placeholder="${label}, 💰" value="${Math.max(10, m.sell * m.n * 2)}">${extra}</div>
      <p class="sheet-hint">Торговец купит за ${m.sell} 💰 штуку — ставьте цену выше, игроки покупают дешевле, чем в лавке</p><button class="l2-btn wide">Подтвердить</button>`);
    box.prepend(row(m, `${m.name}`, `в наличии ${m.n}`, null));
    box.querySelector('button.l2-btn.wide').onclick = async () => {
      const sel = box.querySelector('select');
      const res = await submit(Number(box.querySelector('.price').value), Number(box.querySelector('.qty').value), sel ? sel.value : null);
      toast(res.error || res.toast);
      if (!res.error) done();
    };
    open('Цена', box);
  }

  // ---------- Аукцион (ставки) ----------
  async function auctionPanel(tab = 0) {
    const r = await Bag.act('auction');
    const lotsTab = () => {
      const box = el(`<p class="sheet-hint">Ставка замораживает золото; если перебьют — оно вернётся. Комиссия продавца ${Math.round(r.fee * 100)}% · 💰 ${r.gold}</p>`);
      const lots = r.lots.filter((l) => !l.mine);
      if (!lots.length) box.insertAdjacentHTML('beforeend', soon('Лотов пока нет'));
      for (const l of lots) {
        const min = l.bid ? Math.ceil(l.bid * 1.05) : l.start;
        box.append(row(l.item, l.item.name, `${l.bid ? `ставка ${l.bid} (${l.mineBid ? 'ваша' : l.bidder})` : `старт ${l.start}`} · ${fmtLeft(l.left)}`,
          l.mineBid ? 'Лидер' : `${min} 💰`, async () => { const res = await Bag.act('auctionBid', { id: l.id, amount: min }); toast(res.error || res.toast); auctionPanel(0); }, l.mineBid));
      }
      return box;
    };
    const myTab = () => {
      const mine = r.lots.filter((l) => l.mine);
      const box = el('<p class="sheet-hint">Лот уходит лучшей ставке по окончании торгов</p>');
      for (const l of mine) box.append(row(l.item, l.item.name, `${l.bid ? `ставка ${l.bid} от ${l.bidder}` : `старт ${l.start}, ставок нет`} · ${fmtLeft(l.left)}`,
        l.bid ? null : 'Снять', async () => { const res = await Bag.act('auctionCancel', { id: l.id }); toast(res.error || res.toast); auctionPanel(1); }));
      const add = document.createElement('button');
      add.className = 'l2-btn wide'; add.textContent = '＋ Выставить лот';
      add.onclick = () => Bag.pick('Что выставляем?', () => true, (it) => priceForm(it, 'Стартовая цена',
        (start, hours) => Bag.act('auctionSell', { id: it.id, start, hours }), () => auctionPanel(1),
        '<select><option value="2">2 ч</option><option value="8" selected>8 ч</option><option value="24">24 ч</option></select>'));
      const addM = document.createElement('button');
      addM.className = 'l2-btn wide'; addM.textContent = '＋ Выставить материалы';
      addM.onclick = () => pickMat((m) => matForm(m, 'Стартовая цена за стопку', (start, n, hours) => Bag.act('auctionSell', { mat: m.mat, n, start, hours }), () => auctionPanel(1),
        '<select><option value="2">2 ч</option><option value="8" selected>8 ч</option><option value="24">24 ч</option></select>'));
      box.append(add, addM);
      return box;
    };
    open('🏛️ Аукционный дом', tabs([['Торги', lotsTab], ['Мои лоты', myTab]], tab));
  }

  // ---------- Призыв ----------
  async function gachaPanel() {
    const inv = await Bag.refresh();
    const box = el(`<p class="sheet-hint">Алтарь призыва · ${ctx.zone.name}</p>
      <div class="tw-banner hero"><b>✨ Призыв героя</b><small>Новый герой или дубликат: +5% к статам и раньше открытые умения</small><button class="l2-btn" id="twHeroSpin">Призвать</button></div>
      <div class="tw-banner items"><b>🎁 Призыв предметов</b>
        <small>Экипировка и руны мира ${ROMAN[ctx.zone.tier]} · редкий 62% · эпический 29% · легендарный 7.5% · мифический 1.5% · каждая эпическая и лучше — с шансом 25% вещь комплекта<br>
        Гарант легендарного: ${inv.pity} / ${inv.pityMax} · бесплатно сегодня: ${inv.freeItemSpins} · круток: ${inv.itemSpins}</small>
        <div class="btn-row"><button class="l2-btn" data-n="1">Призвать ×1</button><button class="l2-btn" data-n="10">×10</button></div>
        <div class="btn-row"><button class="l2-btn" data-buy="ispin">+1 · 15 ⭐</button><button class="l2-btn" data-buy="ispin10">+10 · 135 ⭐</button></div></div>`);
    box.querySelector('#twHeroSpin').onclick = () => ctx.onGacha();
    box.querySelectorAll('[data-n]').forEach((b) => { b.onclick = async () => {
      const r = await Bag.act('itemSpin', { n: +b.dataset.n });
      if (r.error) return toast(r.needPayment ? 'Нет круток — купите за Stars' : r.error);
      const res = el(`<p class="sheet-hint">Результат призыва · ⇧ — дубликат усилил ваш предмет</p>`);
      res.append(Bag.grid(r.results, (it) => Bag.card(it)));
      res.querySelectorAll('.it').forEach((c, i) => { if (r.results[i] && r.results[i].dupe) c.insertAdjacentHTML('beforeend', '<u>⇧</u>'); });
      const again = document.createElement('button'); again.className = 'l2-btn wide'; again.textContent = 'Назад к алтарю'; again.onclick = gachaPanel;
      res.append(again);
      open('🎁 Призыв предметов', res);
    }; });
    box.querySelectorAll('[data-buy]').forEach((b) => { b.onclick = () => buyStars(b.dataset.buy, gachaPanel); });
    open('🎰 Алтарь призыва', box);
  }

  // ---------- Батл-пасс ----------
  const rwText = (r) => (r.gold ? `💰 ${r.gold}` : r.itemSpins ? `🎁 крутка ×${r.itemSpins}` : r.item ? `🎁 ${{ rare: 'редкий', epic: 'эпический', legendary: 'легендарный', mythic: 'мифический' }[r.item]} предмет` : '');
  async function passPanel() {
    const { pass: ps } = await Bag.act('pass');
    const box = el(`<div class="pass-head"><b>Сезон · уровень ${ps.level} / ${ps.rewards.length}</b>
      <div class="tw-prog"><i style="width:${(ps.xp % ps.xpPerLevel) / ps.xpPerLevel * 100}%"></i><em>${ps.xp % ps.xpPerLevel} / ${ps.xpPerLevel} XP пропуска</em></div>
      <small>Опыт пропуска: монстры, боссы, волны выживания, арена, призывы · сезон закончится через ${fmtLeft(ps.ends - Date.now())}</small>
      ${ps.premium ? '<small class="ok">⭐ Премиум активен</small>' : `<button class="l2-btn" id="buyPass">⭐ Премиум-пропуск · ${ps.price} Stars</button>`}</div>`);
    const list = document.createElement('div');
    for (const r of ps.rewards) {
      const reached = ps.level >= r.lvl;
      const cellBtn = (track, rw) => {
        const got = ps[track].includes(r.lvl), lockedPrem = track === 'prem' && !ps.premium;
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
    box.append(el('<div class="pass-cols"><span></span><b>Бесплатно</b><b>⭐ Премиум</b></div>'), list);
    const bp = box.querySelector('#buyPass');
    if (bp) bp.onclick = () => buyStars('pass', passPanel);
    open('🎟️ Батл-пасс', box);
  }

  // ---------- Магазин: подписка, крутки, реклама ----------
  async function storePanel() {
    const s = await Bag.act('shopInfo');
    const box = el(`<div class="tw-banner hero"><b>👑 Подписка «Покровитель» · 30 дней</b>
        <small>+25% опыта и золота · 2 бесплатных призыва предметов в день · комиссия рынка 5% вместо 10% · сумка 80 ячеек · 8 боёв на арене в день</small>
        ${s.sub ? `<small class="ok">Активна до ${new Date(s.sub).toLocaleDateString('ru-RU')}</small>` : ''}
        <button class="l2-btn" data-buy="sub">${s.sub ? 'Продлить' : 'Оформить'} · ${s.subPrice} ⭐</button></div>
      <div class="tw-banner items"><b>🎁 Крутки призыва предметов</b><small>Гарантированный легендарный предмет каждые 50 круток</small>
        <div class="btn-row"><button class="l2-btn" data-buy="ispin">+1 · ${s.itemSpin.price} ⭐</button><button class="l2-btn" data-buy="ispin10">+10 · ${s.itemSpin.price10} ⭐</button></div></div>
      <div class="tw-banner pass"><b>🎟️ Премиум батл-пасс</b><small>Мифический предмет на 30 уровне, легендарные на 20 и 25</small>
        <button class="l2-btn" data-buy="pass" ${s.premium ? 'disabled' : ''}>${s.premium ? 'Уже куплен' : `${s.passPrice} ⭐`}</button></div>
      ${(s.chests || []).map((c) => `<div class="tw-banner items"><b>${{ kitSmith: '🧰', chestSet: '🎁', chestSet5: '🎁', chestLegend: '👑' }[c.id] || '🎁'} ${c.title}</b><small>${c.desc} · открывается в сумке, награда — мира, где вы его открыли</small>
        <button class="l2-btn" data-buy="${c.id}">${c.amount} ⭐</button></div>`).join('')}
      <div class="tw-banner ad"><b>📺 Награда за рекламу</b><small>Осталось сегодня: ${s.adsLeft} · золото, каждая 5-я — крутка предмета</small>
        <button class="l2-btn" id="watchAd" ${s.adsLeft > 0 ? '' : 'disabled'}>Смотреть</button></div>`);
    box.querySelectorAll('[data-buy]').forEach((b) => { b.onclick = () => buyStars(b.dataset.buy, storePanel); });
    box.querySelector('#watchAd').onclick = () => showAd(storePanel);
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

  // ---------- PvP-арена ----------
  async function arenaPanel() {
    const { arena: a } = await Bag.act('arena');
    const box = el(`<div class="pass-head"><b>🏟️ Рейтинг ${a.rating}</b><small>Победы ${a.wins} · поражения ${a.losses} · боёв сегодня осталось ${a.left} · сила героя ${a.power}</small>
      <small>Бой идёт со снимком героя другого игрока: экипировка, дубликаты и открытые умения решают исход. Ваш текущий герой защищает вашу позицию.</small></div>
      <div class="ic-sec">Соперники</div>`);
    for (const r of a.rivals) {
      box.append(row(null, `${r.name}${r.bot ? ' · тренировочный' : ''}`, `рейтинг ${r.rating}`, 'В бой ⚔️', async () => {
        const res = await Bag.act('arenaFight', { uid: r.uid });
        if (res.error) return toast(res.error);
        const f = res.fight;
        const rb = el(`<div class="fight ${f.win ? 'win' : 'lose'}"><b>${f.win ? '🏆 Победа!' : '💀 Поражение'}</b>
          <small>против ${f.foe} (${f.foeHero}) · ${Math.round(f.time / 1000)} с</small>
          <small>Рейтинг ${f.delta >= 0 ? '+' : ''}${f.delta} → ${f.rating} · +${f.gold} 💰</small></div>`);
        const back = document.createElement('button'); back.className = 'l2-btn wide'; back.textContent = 'Назад'; back.onclick = arenaPanel;
        rb.append(back);
        open('🏟️ Итог боя', rb);
      }, a.left <= 0));
    }
    box.insertAdjacentHTML('beforeend', `<div class="ic-sec">Топ-10</div>${a.top.map((t, i) => `<div class="top-row"><span>${i + 1}</span><b>${t.name}</b><small>${t.hero}</small><em>${t.rating}</em></div>`).join('') || soon('Пока пусто')}`);
    open('🏟️ PvP-арена', box);
  }

  // ---------- Данж выживания ----------
  function survivalPanel() {
    const box = el(`<div class="pass-head"><b>💀 Данж выживания</b>
      <small>Волны монстров этого мира становятся всё сильнее (уровень растёт каждые 2 волны), каждая 5-я — с полубоссом, каждая 10-я — с боссом. За каждую волну — золото, опыт пропуска и шанс предмета; на 5-й, 10-й, 15-й… — гарантированный редкий+ предмет.</small>
      <small>Идите соло или с группой (👥): все участники группы в этом городе войдут вместе. Смерть — возврат в город.</small></div>
      <button class="l2-btn wide" id="survGo">⚔️ Начать</button>`);
    box.querySelector('#survGo').onclick = () => { ctx.socket.emit('travel', { via: 'survival' }); close(); };
    open('💀 Данж выживания', box);
  }

  // ---------- События ----------
  const EVENTS = {
    1: { daily: [['🗡️', 'Охотник долины', 'Победите 30 монстров за порталами', 30], ['🌀', 'Путешественник', 'Посетите 3 разных портала', 3], ['🎰', 'Удача дня', 'Сделайте 1 призыв', 1]],
      weekly: [['🐉', 'Гроза дракона', 'Победите дракона в Логове дракона', 1], ['💀', 'Чистильщик кладбища', 'Победите 200 скелетов', 200]],
      monthly: [['🏆', 'Герой Эльдмира', 'Наберите 5000 очков событий за месяц', 5000], ['⭐', 'Коллекционер', 'Соберите 10 героев', 10]] },
    2: { daily: [['🔥', 'Пепельная жатва', 'Победите 50 монстров Бездны', 50], ['🕯️', 'Тёмный обет', 'Пройдите 2 портала Морграта', 2]],
      weekly: [['👁️', 'Взгляд в Бездну', 'Победите пепельного змея 3 раза', 3], ['⚔️', 'Крестовый поход', 'Победите 500 монстров Морграта', 500]],
      monthly: [['🌑', 'Владыка тьмы', 'Наберите 15000 очков событий', 15000]] },
    3: { daily: [['☁️', 'Небесный дозор', 'Победите 80 небесных монстров', 80], ['💎', 'Звёздная пыль', 'Соберите 20 осколков звёзд', 20]],
      weekly: [['⚡', 'Повелитель бурь', 'Пройдите Бастион бурь 5 раз', 5], ['🐲', 'Трон небес', 'Победите небесного дракона', 1]],
      monthly: [['👑', 'Вознесение', 'Наберите 40000 очков событий', 40000]] },
  };
  function untilReset(kind) {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    if (kind === 'weekly') next.setDate(next.getDate() + ((8 - next.getDay()) % 7));
    if (kind === 'monthly') { next.setDate(1); next.setMonth(now.getMonth() + 1); }
    return fmtLeft(next - now);
  }
  function eventsPanel() {
    const ev = EVENTS[ctx.zone.tier] || EVENTS[1];
    const list = (kind) => `<p class="sheet-hint">Сброс через ${untilReset(kind)} · события мира ${ctx.zone.name}</p>`
      + ev[kind].map(([icon, name, desc, goal]) => `<div class="tw-ev"><span class="tw-ev-i">${icon}</span><div><b>${name}</b><small>${desc}</small>
        <div class="tw-prog"><i style="width:0%"></i><em>0 / ${goal}</em></div></div><button class="l2-btn" disabled>🎁</button></div>`).join('');
    open('📜 События', tabs([['Ежедневные', list('daily')], ['Еженедельные', list('weekly')], ['Ежемесячные', list('monthly')]]));
  }

  // ---------- Телепорт ----------
  function teleportPanel() {
    const box = document.createElement('div');
    box.innerHTML = '<p class="sheet-hint">Выберите город для путешествия</p>';
    for (const t of ctx.towns) {
      const here = t.id === ctx.zone.id;
      const r = el(`<div class="tw-town ${t.theme}"><div><b>${t.name}</b><small>${t.sub} · рекомендуемый уровень ${t.level}</small></div>
        <button class="l2-btn" ${here ? 'disabled' : ''}>${here ? 'Вы здесь' : 'Отправиться'}</button></div>`).firstElementChild;
      r.querySelector('button').onclick = () => { ctx.socket.emit('travel', { via: 'teleport', to: t.id }); close(); };
      box.append(r);
    }
    open('🌀 Телепорт', box);
  }

  // ---------- Зал мастеров ----------
  async function trainerPanel() {
    const inv = await Bag.refresh();
    const h = ctx.heroes[inv.hero.id], U = ctx.skillUnlock;
    const skills = () => el(`<p class="sheet-hint">Умения открываются по уровню героя ИЛИ по числу дубликатов (призыв на алтаре). Сейчас: ур. ${inv.hero.level}, дубликатов ${inv.hero.dupes}</p>`
      + h.skills.map((sk, i) => `<div class="tw-ev"><span class="tw-ev-i">${i < inv.hero.unlocked ? sk.icon : '🔒'}</span>
      <div><b>${sk.name}</b><small>${i < inv.hero.unlocked ? 'Открыто' : `Откроется: ${U[i].lvl} уровень или ${U[i].dup} дубл.`}</small><small>${sk.desc}</small></div></div>`).join('')
      + `<div class="tw-ev"><span class="tw-ev-i">${h.passive.icon}</span><div><b>${h.passive.name} · пассивный</b><small>Всегда активен</small></div></div>`);
    const tree = () => el(`<p class="sheet-hint">Очки характеристик: 0 · даются за уровни героя</p><div class="tw-tree">${
      [['💪', 'Сила'], ['🏹', 'Ловкость'], ['🔮', 'Интеллект'], ['❤️', 'Выносливость'], ['🍀', 'Удача'], ['🛡️', 'Защита']]
        .map(([i, n]) => `<div class="tw-node"><span>${i}</span><b>${n}</b><em>0</em><button disabled>+</button></div>`).join('')}</div>
      ${soon('Ветка дополнительных характеристик откроется позже')}`);
    open('📖 Зал мастеров', tabs([['Умения', skills], ['Ветка характеристик', tree]]));
  }

  // ---------- Кузница: ковка (улучшение редкости), вещи комплектов, разбор, лавка кузнеца ----------
  const needList = (c) => Object.entries(c.need).map(([k, n]) => `<span class="${(c.have[k] || 0) >= n ? 'ok' : 'bad'}">${c.names[k]} ${c.have[k] || 0}/${n}</span>`).join(' ');
  async function forgeBody(itemId) {
    const inv = await Bag.refresh();
    const box = document.createElement('div');
    const reload = async (id) => box.replaceWith(await forgeBody(id));
    const items = inv.items.filter((i) => i.loc !== 'wh');
    const it = items.find((i) => i.id === itemId);
    box.innerHTML = `<p class="sheet-hint">Ковка поднимает редкость предмета на ступень: свиток + материалы мира предмета + золото. Атрибуты выпадают заново.
      Чертёж превращает эпический (и лучше) предмет в вещь комплекта того же слота. 💰 ${inv.gold}</p>`;
    if (it) {
      const r = await Bag.act('craftInfo', { id: it.id });
      const sec = el(`<div class="forge"><div class="row-it">${Bag.cell(it)}</div><div><b style="color:${it.color}">${it.name}</b><small>${it.rarName} · мир ${ROMAN[it.tier]}</small></div></div>`);
      sec.querySelector('.row-it').onclick = () => Bag.card(it, []);
      box.append(sec);
      if (r.up) {
        const u = el(`<div class="tw-ev"><div><b>⚒️ Улучшить до: ${inv.rarities[r.up.next].name}</b><small>${needList(r.up)}</small><small>${r.up.gold} 💰</small></div><button class="l2-btn">Ковать</button></div>`).firstElementChild;
        u.querySelector('button').onclick = async () => { const res = await Bag.act('upgrade', { id: it.id }); toast(res.error || res.toast); if (!res.error) Bag.card(res.result, []); reload(it.id); };
        box.append(u);
      } else box.insertAdjacentHTML('beforeend', soon('Мифический предмет — улучшать некуда. Усиливайте его дубликатами.'));
      for (const st of r.sets) {
        const u = el(`<div class="tw-ev"><div><b>🗺️ ${st.name}</b><small>${needList(st)}</small><small>${st.gold} 💰</small></div><button class="l2-btn">Создать</button></div>`).firstElementChild;
        u.querySelector('button').onclick = async () => { const res = await Bag.act('setCraft', { id: it.id, bp: st.bp }); toast(res.error || res.toast); if (!res.error) Bag.card(res.result, []); reload(it.id); };
        box.append(u);
      }
      if (!r.sets.length && !it.set && inv.rarOrder.indexOf(it.rar) >= 2) box.insertAdjacentHTML('beforeend', soon(`Нет чертежей мира ${ROMAN[it.tier]} — они падают с полубоссов и боссов данжей`));
      if (!Bag.isEquipped(it)) {
        const sv = el(`<div class="tw-ev"><div><b>♻️ Разобрать</b><small>Получите: ${r.salvage}</small></div><button class="l2-btn warn">Разобрать</button></div>`).firstElementChild;
        sv.querySelector('button').onclick = async () => { const res = await Bag.act('salvage', { id: it.id }); toast(res.error || res.toast); reload(); };
        box.append(sv);
      }
    }
    box.insertAdjacentHTML('beforeend', `<div class="ic-sec">${it ? 'Другой предмет' : 'Выберите предмет'}</div>`);
    box.append(Bag.grid(items.filter((i) => i.cat !== 'rune'), (x) => reload(x.id), { selected: new Set(it ? [it.id] : []), empty: 'Нет предметов' }));
    return box;
  }
  function recipesTab() {
    const R = [['Обычный → редкий', '📜 Свиток подмастерья · руда ×5 · 150 💰'], ['Редкий → эпический', '📜 Свиток мастера · руда ×12 · эссенция ×5 · 600 💰'],
      ['Эпический → легендарный', '📜 Свиток грандмастера · руда ×25 · эссенция ×15 · редкий материал ×1 · 2500 💰'],
      ['Легендарный → мифический', '📜 Свиток легенды · руда ×50 · эссенция ×30 · редкий материал ×3 · 8000 💰'],
      ['Вещь комплекта', '🗺️ Чертёж · эпический+ предмет того же мира · руда ×15 · эссенция ×10 · редкий материал ×1 · 1500 💰']];
    return el(`<p class="sheet-hint">Золото — для мира I; в мире II ×2.2, в мире III ×4.5. Материалы — того же мира, что и предмет.</p>`
      + R.map(([a, b]) => `<div class="tw-ev"><div><b>${a}</b><small>${b}</small></div></div>`).join('')
      + `<p class="sheet-hint">Где брать: руда и эссенция — с любых монстров мира; редкие материалы — полубоссы, боссы и мировые боссы; свитки мастера — полубоссы и боссы; свитки грандмастера и легенды — боссы миров II–III и мировые боссы; чертежи — только в «своём» данже (каждый данж отвечает за 2 комплекта).</p>`);
  }
  function smithPanel(itemId) {
    open('🔨 Кузница', tabs([['Ковка', () => forgeBody(itemId)], ['Соединение 5 → 1', () => Bag.mergeTab()], ['Рецепты', recipesTab], ['Лавка кузнеца', () => shopList('smith')]]));
  }

  const PANELS = {
    warehouse: warehousePanel,
    equip: () => shopPanel('equip', '⚔️ Оружие и доспехи'),
    alchemy: () => shopPanel('alchemy', '🧪 Эликсиры и свитки'),
    smith: smithPanel,
    runes: runesPanel,
    trainer: trainerPanel,
    auction: () => auctionPanel(),
    market: () => marketPanel(),
    events: eventsPanel,
    gacha: gachaPanel,
    teleport: teleportPanel,
    arena: arenaPanel,
    survival: survivalPanel,
    pass: passPanel,
    store: storePanel,
  };

  return {
    setContext: (c) => { ctx = { ...ctx, ...c }; },
    openPlace: (id, arg) => PANELS[id] && PANELS[id](arg),
    open, close, tabs, toast,
    lastTab: () => lastTabIdx,
    heroes: () => ctx.heroes,
    skillUnlock: () => ctx.skillUnlock,
    inTown: () => ctx.zone && ctx.zone.kind === 'town',
  };
})();
