// Окна городских мест: склад, магазины, кузница, руны, мастера, аукцион, рынок, события, телепорт, гача.
// Предметы и товары пока не наполнены — окна готовы к их появлению.
window.Town = (() => {
  const $ = (id) => document.getElementById(id);
  let ctx = null; // { socket, zone, towns, hero, onGacha }
  const TIER_LABEL = { 1: 'Ассортимент: обычный', 2: 'Ассортимент: продвинутый', 3: 'Ассортимент: небесный (элитный)' };

  function open(title, body) {
    $('sheetTitle').textContent = title;
    const sb = $('sheetBody');
    sb.innerHTML = '';
    sb.append(body);
    $('sheet').classList.remove('hidden');
  }
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };
  const soon = (text) => `<div class="tw-soon">${text}</div>`;

  // Вкладки: [[подпись, html | () => Node]]
  function tabs(list) {
    const box = document.createElement('div');
    const bar = document.createElement('div');
    bar.className = 'tw-tabs';
    const page = document.createElement('div');
    page.className = 'tw-page';
    const show = (i) => {
      [...bar.children].forEach((b, k) => b.classList.toggle('on', k === i));
      const c = list[i][1];
      page.innerHTML = '';
      if (typeof c === 'function') page.append(c()); else page.innerHTML = c;
    };
    list.forEach(([label], i) => {
      const b = document.createElement('button');
      b.className = 'tw-tab';
      b.textContent = label;
      b.onclick = () => show(i);
      bar.append(b);
    });
    box.append(bar, page);
    show(0);
    return box;
  }
  const slots = (n, cls = '') => `<div class="tw-slots ${cls}">${'<i></i>'.repeat(n)}</div>`;
  const shop = (cats) => tabs(cats.map(([label, icon]) => [label,
    `<p class="sheet-hint">${TIER_LABEL[ctx.zone.tier]} · ${ctx.zone.name}</p>${slots(8, 'goods')}${soon(`${icon} Товары появятся позже`)}`]));

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
    const ms = next - now, d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60;
    return d ? `${d} д ${h} ч` : `${h} ч ${m} мин`;
  }
  function eventsPanel() {
    const ev = EVENTS[ctx.zone.tier] || EVENTS[1];
    const list = (kind) => `<p class="sheet-hint">Сброс через ${untilReset(kind)} · события мира ${ctx.zone.name}</p>`
      + ev[kind].map(([icon, name, desc, goal]) => `<div class="tw-ev"><span class="tw-ev-i">${icon}</span><div><b>${name}</b><small>${desc}</small>
        <div class="tw-prog"><i style="width:0%"></i><em>0 / ${goal}</em></div></div><button class="l2-btn" disabled>🎁</button></div>`).join('');
    open('📜 События', tabs([['Ежедневные', list('daily')], ['Еженедельные', list('weekly')], ['Ежемесячные', list('monthly')]]));
  }

  // ---------- Гача ----------
  function gachaPanel() {
    const box = el(`<p class="sheet-hint">Алтарь призыва · ${ctx.zone.name}</p>
      <div class="tw-banner hero"><b>✨ Призыв героя</b><small>Новые уникальные герои со своими умениями</small><button class="l2-btn" id="twHeroSpin">Призвать</button></div>
      <div class="tw-banner items"><b>🎁 Призыв предметов</b><small>Оружие, одежда и бижутерия ${ctx.zone.tier > 1 ? 'продвинутого уровня' : ''}</small><button class="l2-btn" disabled>Скоро</button></div>`);
    box.querySelector('#twHeroSpin').onclick = () => ctx.onGacha();
    open('🎰 Алтарь призыва', box);
  }

  // ---------- Телепорт ----------
  function teleportPanel() {
    const box = document.createElement('div');
    box.innerHTML = '<p class="sheet-hint">Выберите город для путешествия</p>';
    for (const t of ctx.towns) {
      const here = t.id === ctx.zone.id;
      const row = el(`<div class="tw-town ${t.theme}"><div><b>${t.name}</b><small>${t.sub} · рекомендуемый уровень ${t.level}</small></div>
        <button class="l2-btn" ${here ? 'disabled' : ''}>${here ? 'Вы здесь' : 'Отправиться'}</button></div>`).firstElementChild;
      row.querySelector('button').onclick = () => { ctx.socket.emit('travel', { via: 'teleport', to: t.id }); close(); };
      box.append(row);
    }
    open('🌀 Телепорт', box);
  }

  // ---------- Зал мастеров ----------
  function trainerPanel() {
    const h = ctx.hero;
    const skills = () => el([...h.skills, { ...h.passive, passive: true }].map((sk) => `<div class="tw-ev"><span class="tw-ev-i">${sk.icon}</span>
      <div><b>${sk.name}${sk.passive ? ' · пассивный' : ''}</b><small>Уровень умения 1 / 10</small></div><button class="l2-btn" disabled>⬆️</button></div>`).join(''));
    const tree = () => el(`<p class="sheet-hint">Очки характеристик: 0 · даются за уровни героя</p><div class="tw-tree">${
      [['💪', 'Сила'], ['🏹', 'Ловкость'], ['🔮', 'Интеллект'], ['❤️', 'Выносливость'], ['🍀', 'Удача'], ['🛡️', 'Защита']]
        .map(([i, n]) => `<div class="tw-node"><span>${i}</span><b>${n}</b><em>0</em><button disabled>+</button></div>`).join('')}</div>
      ${soon('Ветка дополнительных характеристик откроется позже')}`);
    open('📖 Зал мастеров', tabs([['Умения', skills], ['Ветка характеристик', tree]]));
  }

  const PANELS = {
    warehouse: () => open('📦 Склад', tabs([
      ['Предметы', `<p class="sheet-hint">Общий склад аккаунта — доступен из любого города</p>${slots(30)}${soon('Склад пуст')}`],
      ['Ресурсы', `${slots(15)}${soon('Ресурсов пока нет')}`]])),
    equip: () => open('⚔️ Оружие и доспехи', shop([['Оружие', '🗡️'], ['Одежда', '🥋'], ['Бижутерия', '💍']])),
    alchemy: () => open('🧪 Эликсиры и свитки', shop([['Эликсиры', '🧪'], ['Свитки', '📜'], ['Рунные камни', '💠']])),
    smith: () => open('🔨 Кузница', tabs(['Оружие', 'Одежда', 'Бижутерия'].map((cat) => [cat,
      `<p class="sheet-hint">Создание и улучшение предметов · ${ctx.zone.name}</p>
       <div class="tw-craft"><i title="Предмет"></i><span>+</span><i title="Материалы"></i><span>+</span><i title="Материалы"></i><span>→</span><i class="res"></i></div>
       ${soon('Рецепты появятся позже')}`]))),
    runes: () => open('💠 Рунная мастерская', tabs([
      ['Создание рун', `<div class="tw-craft"><i></i><span>+</span><i></i><span>→</span><i class="res"></i></div>${soon('Рецепты рунных камней появятся позже')}`],
      ['Вставка в оружие', `<div class="tw-craft"><i title="Оружие"></i><span>+</span><i title="Руна"></i><span>→</span><i class="res"></i></div>${soon('Положите оружие и рунный камень')}`]])),
    trainer: trainerPanel,
    auction: () => open('🏛️ Аукционный дом', tabs([
      ['Торги', `<p class="sheet-hint">Ставки на лоты игроков — лот уходит тому, чья ставка выше к концу торгов</p>${soon('Лотов пока нет')}`],
      ['Мои лоты', soon('У вас нет лотов')],
      ['Выставить', `<div class="tw-craft"><i title="Предмет"></i></div><div class="tw-form"><input placeholder="Стартовая цена" disabled><input placeholder="Длительность" disabled></div>
        <button class="l2-btn" disabled>Выставить лот</button>`]])),
    market: () => open('🏪 Рынок', tabs([
      ['Купить', `<p class="sheet-hint">Товары игроков по фиксированной цене</p>${soon('Прилавки пусты')}`],
      ['Мой прилавок', `<div class="tw-craft"><i title="Предмет"></i></div><div class="tw-form"><input placeholder="Цена" disabled></div><button class="l2-btn" disabled>Выставить</button>`]])),
    events: eventsPanel,
    gacha: gachaPanel,
    teleport: teleportPanel,
  };

  function close() { $('sheet').classList.add('hidden'); }

  return {
    setContext: (c) => { ctx = { ...ctx, ...c }; },
    openPlace: (id) => PANELS[id] && PANELS[id](),
    close,
  };
})();
