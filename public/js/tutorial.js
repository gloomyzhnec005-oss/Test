// Обучение при первом входе: подсветка элементов HUD и подсказка рядом. Tutorial.start(force)
window.Tutorial = (() => {
  const STEPS = [
    ['#joystick', '🕹️ Джойстик', 'Ведите пальцем — герой идёт в эту сторону. Можно и просто нажать на землю.'],
    ['#attackBtn', '⚔️ Атака', 'Нажмите или удерживайте — герой бьёт ближайшего врага. У каждого класса своя кнопка.'],
    ['#skills', '✨ Умения', 'Три умения героя. Открываются по уровню или дубликатам из призыва. Цифра — перезарядка.'],
    ['#potBtn', '🧪 Зелье', 'Быстрое лечение. Зелья продаются в лавке эликсиров.'],
    ['[data-nav="hero"]', '🧙 Герой', 'Снаряжение и гардероб: нажмите ячейку — увидите подходящие вещи и сравнение со надетым.'],
    ['[data-nav="bag"]', '🎒 Сумка', 'Все предметы, ресурсы и соединение 5 → 1.'],
    ['[data-nav="quests"]', '📜 Квесты', 'Ежедневные, еженедельные и месячные задания. Красная цифра — награда ждёт.'],
    ['[data-nav="play"]', '⚔️ Игра', 'Арена, боевой пропуск и группа. Порталы в данжи стоят в городе — подойдите и нажмите кнопку входа.'],
    ['#minimap', '🗺️ Карта', 'Жёлтые точки — порталы и здания, красные — монстры. Удачной охоты!'],
  ];
  let i = 0, box = null;
  function show() {
    const [sel, title, text] = STEPS[i];
    const el = document.querySelector(sel);
    if (!el || !el.getClientRects().length) { next(); return; }
    const r = el.getBoundingClientRect(), pad = 6;
    const hl = box.querySelector('.tut-hl'), tip = box.querySelector('.tut-tip');
    Object.assign(hl.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    tip.querySelector('b').textContent = title;
    tip.querySelector('p').textContent = text;
    tip.querySelector('.tut-n').textContent = `${i + 1} / ${STEPS.length}`;
    tip.querySelector('[data-a="next"]').textContent = i === STEPS.length - 1 ? 'Начать игру' : 'Далее';
    // Подсказка над или под элементом, внутри экрана
    const below = r.top < innerHeight / 2;
    tip.style.top = below ? Math.min(innerHeight - 170, r.bottom + 14) + 'px' : '';
    tip.style.bottom = below ? '' : Math.max(10, innerHeight - r.top + 14) + 'px';
  }
  function next() { i++; if (i >= STEPS.length) return end(); show(); }
  function end() { if (box) box.remove(); box = null; try { localStorage.setItem('tutDone', '1'); } catch (e) { /* без хранилища */ } }
  function start(force) {
    let done = false;
    try { done = localStorage.getItem('tutDone') === '1'; } catch (e) { /* без хранилища */ }
    if ((done && !force) || box) return;
    i = 0;
    box = document.createElement('div');
    box.className = 'tut';
    box.innerHTML = `<i class="tut-hl"></i><div class="tut-tip l2-panel"><b></b><p></p><div class="tut-btns"><span class="tut-n"></span>
      <button class="l2-btn ghost" data-a="skip">Пропустить</button><button class="l2-btn" data-a="next">Далее</button></div></div>`;
    box.onclick = (e) => { const a = e.target.closest('[data-a]'); if (!a) return; if (window.Sfx) Sfx.play('click'); a.dataset.a === 'skip' ? end() : next(); };
    document.body.append(box);
    show();
  }
  return { start };
})();
