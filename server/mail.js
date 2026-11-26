// Почта между игроками: письмо по нику, к нему можно приложить до 5 вещей, один материал и золото.
// Получатель может быть не в игре — письмо ждёт 30 дней, вложения забираются кнопкой «Забрать».
// Плата (чтобы почта не обходила комиссию Торгового дома):
//  • письмо без вложений — бесплатно (не больше 20 писем в день);
//  • с вещами или материалом — в GRAM: 0,05 GRAM-эквивалента (3 ⭐) за письмо + 15% от минимальной цены вложений в Торговом доме;
//  • золото — 10% сверху сгорает. Вложения — с 10 уровня; привязанные и надетые вещи не отправляются.
// Не забранные за 30 дней вложения возвращаются отправителю.
module.exports = function createMail({ I, Trade, getProfile, profilesFn, notifyUid, nickUid, nameOf, save }) {
  const P = () => profilesFn();
  const DAY = 864e5, KEEP = 30 * DAY, MAX_BOX = 50, DAILY = 20, MIN_LVL = 10;
  const FEE = 0.15, GOLD_FEE = 0.1, BASE_STARS = 3;
  const isEquipped = (pr, id) => Object.values(pr.equip || {}).includes(id);
  const box = (pr) => (pr.mail ??= []);
  let seq = Date.now() % 1e8;
  const fmt = (n) => (Math.round(n / 1e9 * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

  // Стоимость отправки: { nano — GRAM, gold — золото сверху }
  function quote(pr, d) {
    const ids = [...new Set((Array.isArray(d.items) ? d.items : []).map(String))].slice(0, 6);
    if (ids.length > 5) return { error: 'Не больше 5 вещей в письме' };
    const items = [];
    for (const id of ids) {
      const it = I.findItem(pr, id);
      if (!it) return { error: 'Предмет не найден' };
      if (it.bound) return { error: 'Привязанную вещь нельзя отправить' };
      if (I.boundRune(it)) return { error: 'В оружии личная руна — извлеките её, чтобы отправить оружие' };
      if (I.inSack(pr, it)) return { error: I.SACK_MSG };
      if ((it.trophy || 0) > Date.now()) return { error: 'Трофей из опасного данжа — отправить можно через 7 дней после добычи' };
      if (isEquipped(pr, it.id)) return { error: 'Сначала снимите предмет' };
      items.push(it);
    }
    let mat = null;
    if (d.mat) {
      const n = Math.floor(Number(d.n) || 0);
      if (!I.MATS[d.mat] || !(n > 0)) return { error: 'Укажите материал и количество' };
      if (I.MATS[d.mat].personal) return { error: 'Осколки личные — их нельзя отправить' };
      if (I.sackMat(pr, d.mat)) return { error: I.SACK_MSG };
      if (((pr.mats || {})[d.mat] || 0) < n) return { error: 'Не хватает материалов' };
      mat = { id: d.mat, n };
    }
    const gold = Math.max(0, Math.floor(Number(d.gold) || 0));
    let value = 0;
    for (const it of items) { try { value += Trade.itemBounds(it).min || 0; } catch (e) { /* вещь без цены */ } }
    if (mat) { const ms = (Trade.CFG.matMinStars || {})[mat.id] || 0; value += ms ? Trade.nanoOf(ms * mat.n) : 0; }
    const attach = items.length || mat;
    const nano = attach ? Math.round(Trade.nanoOf(BASE_STARS) + value * FEE) : 0;
    return { items, mat, gold, goldFee: Math.ceil(gold * GOLD_FEE), nano };
  }

  function send(p, d) {
    const pr = getProfile(p.uid);
    const to = nickUid(String(d.to || '').trim());
    if (!to || !P()[to]) return { error: 'Игрок с таким ником не найден' };
    if (to === p.uid) return { error: 'Нельзя написать самому себе' };
    const text = String(d.text || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 300);
    const q = quote(pr, d);
    if (q.error) return q;
    if (!text && !q.items.length && !q.mat && !q.gold) return { error: 'Письмо пустое' };
    if ((q.items.length || q.mat || q.gold) && p.char.level < MIN_LVL) return { error: `Вложения — с ${MIN_LVL} уровня` };
    const day = new Date(Date.now() + 3 * 36e5).toISOString().slice(0, 10);
    if (pr.mailDay !== day) { pr.mailDay = day; pr.mailSent = 0; }
    if (pr.mailSent >= DAILY) return { error: `Не больше ${DAILY} писем в день` };
    const tp = getProfile(to);
    if (box(tp).length >= MAX_BOX) return { error: 'Почтовый ящик игрока переполнен' };
    if (q.gold + q.goldFee > (pr.gold || 0)) return { error: `Не хватает золота: нужно ${q.gold + q.goldFee} (с платой 10%)` };
    if (q.nano > 0 && !d.confirm) return { confirm: true, nano: q.nano, text: `Отправка стоит ${fmt(q.nano)} GRAM${q.gold ? ` и ${q.goldFee} 💰` : ''}` };
    if (q.nano > 0 && !Trade.spendGram(p.uid, q.nano, `Почта: письмо для ${nameOf(to)}`)) return { error: `Не хватает GRAM: нужно ${fmt(q.nano)}` };
    if (q.mat && !I.takeMats(pr, { [q.mat.id]: q.mat.n })) return { error: 'Не хватает материалов' };
    pr.gold -= q.gold + q.goldFee;
    pr.items = (pr.items || []).filter((it) => !q.items.includes(it));
    for (const it of q.items) delete it.loc;
    box(tp).unshift({ id: 'm' + (seq++).toString(36), from: p.uid, fromName: p.name, at: Date.now(), text, items: q.items, mat: q.mat, gold: q.gold });
    pr.mailSent++;
    (pr.mailTo ??= {})[to] = Date.now(); // для защиты от сговора в опасном данже
    save();
    const att = q.items.length || q.mat || q.gold;
    notifyUid(to, `✉️ Письмо от ${p.name}${att ? ' с вложением' : ''} — меню → Почта`);
    return { toast: `✉️ Письмо отправлено: ${nameOf(to)}${q.nano ? ` · −${fmt(q.nano)} GRAM` : ''}` };
  }

  // Вложения не забраны 30 дней — назад отправителю (если он ещё есть), письмо удаляется
  function expire(pr) {
    const t = Date.now();
    pr.mail = box(pr).filter((m) => {
      if (t - m.at < KEEP) return true;
      const has = (m.items || []).length || m.mat || m.gold;
      if (has && m.from && P()[m.from] && !m.back) {
        box(getProfile(m.from)).unshift({ id: 'm' + (seq++).toString(36), from: null, fromName: 'Почта', at: t, back: true, text: 'Письмо не забрали за 30 дней — вложения вернулись.', items: m.items, mat: m.mat, gold: m.gold });
      }
      return false;
    });
  }

  function view(it) { return I.itemView ? I.itemView(it) : it; }
  function list(p) {
    const pr = getProfile(p.uid);
    expire(pr);
    const matList = (m) => [...(m.mat ? [[m.mat.id, m.mat.n]] : []), ...Object.entries(m.mats || {})].map(([id, n]) => ({ id, n, name: (I.MATS[id] || {}).name || id, icon: (I.MATS[id] || {}).icon || '📦' }));
    return { mail: box(pr).map((m) => ({ id: m.id, from: m.fromName, sys: !!m.sys, title: m.title || null, at: m.at, text: m.text, read: !!m.read, items: (m.items || []).map(view), mats: matList(m), gold: m.gold || 0, gems: m.gems || 0, got: !!m.got })), unread: box(pr).filter((m) => !m.read).length };
  }

  function act(p, d, bagSize) {
    const pr = getProfile(p.uid);
    if (d.op === 'mailList') return list(p);
    if (d.op === 'mailSend') return send(p, d);
    if (d.op === 'mailQuote') { const q = quote(pr, d); if (q.error) return q; const bal = Trade.bal(pr).total; return { nano: q.nano, gram: fmt(q.nano), goldFee: q.goldFee, bal, balTxt: fmt(bal) }; }
    const m = box(pr).find((x) => x.id === d.id);
    if (!m) return { error: 'Письмо не найдено' };
    if (d.op === 'mailRead') { m.read = true; save(); return { ok: true }; }
    if (d.op === 'mailTake') {
      if (m.got) return { error: 'Уже забрано' };
      const bagN = (pr.items || []).filter((i) => i.loc !== 'wh').length;
      if ((m.items || []).length && bagN + m.items.length > bagSize(pr)) return { error: 'Освободите место в сумке' };
      for (const it of m.items || []) I.addItem(pr, it, bagSize(pr), false);
      if (m.mat) I.addMat(pr, m.mat.id, m.mat.n);
      for (const [id, n] of Object.entries(m.mats || {})) I.addMat(pr, id, n);
      if (m.gold) pr.gold = (pr.gold || 0) + m.gold;
      if (m.gems) pr.gems = (pr.gems || 0) + m.gems;
      m.got = true; m.read = true; m.items = []; m.mat = null; m.mats = null; m.gold = 0; m.gems = 0;
      save();
      return { toast: '📦 Вложения забраны', refresh: true, ...list(p) };
    }
    if (d.op === 'mailDel') {
      if (!m.got && ((m.items || []).length || m.mat || Object.keys(m.mats || {}).length || m.gold || m.gems)) return { error: 'Сначала заберите вложения' };
      pr.mail = box(pr).filter((x) => x !== m); save();
      return list(p);
    }
    return { error: 'Неизвестное действие' };
  }
  const unread = (pr) => box(pr).filter((m) => !m.read).length;
  // Письмо от игры (награды мирового босса и т.п.): вложения — вещи, материалы, золото, самоцветы; ящик не ограничен
  function system(uid, { fromName, title, text, items = [], mats = {}, gold = 0, gems = 0 }) {
    const pr = getProfile(uid);
    for (const it of items) delete it.loc;
    box(pr).unshift({ id: 'm' + (seq++).toString(36), from: null, sys: true, fromName: fromName || 'Игра', title, at: Date.now(), text: String(text || '').slice(0, 600), items, mats, gold, gems });
    save();
  }
  return { act, unread, system };
};
