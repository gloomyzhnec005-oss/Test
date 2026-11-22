// Окно «Пригласить друга»: личная ссылка игрока, «Скопировать», «Поделиться», награды и кто пришёл.
// Одно и то же — в лобби (public/js/lobby.js, данные через /api/ref) и в игре (main.js, данные через act refInfo).
window.Invite = (() => {
  const t = (s) => (window.I18N ? I18N.tr(s) : s);
  function link(R) { return R.bot ? `https://t.me/${R.bot}/${R.app}?startapp=${R.code}` : ''; }
  function panel(R) {
    const url = link(R), C = R.cfg, box = document.createElement('div');
    box.innerHTML = `<p class="sheet-hint">Отправьте другу свою ссылку. Он начнёт игру с подарком, а вы получите награды, пока он растёт.</p>
      <div class="ic-sec">Ваша ссылка</div>
      <div class="tw-form"><input class="addr notr" type="text" readonly value="${url}"></div>
      <div class="btn-row"><button class="l2-btn" data-a="copy">📋 Скопировать</button><button class="l2-btn" data-a="share">📤 Поделиться</button></div>
      <div class="ic-sec">🎁 Другу — сразу</div><div class="tw-ev"><div><b>+${C.newGems} 💎 и ${C.newSpins} печать призыва героя</b><small>только новым игрокам, при первом входе по ссылке</small></div></div>
      <div class="ic-sec">🏆 Вам</div>
      <div class="tw-ev"><div><b>Друг достиг 10 уровня</b><small>+${C.l10.gems} 💎</small></div></div>
      <div class="tw-ev"><div><b>Друг достиг 20 уровня</b><small>+${C.l20.gems} 💎 и ${C.l20.itemSpins} призыва снаряжения</small></div></div>
      <div class="tw-ev"><div><b>Каждая покупка друга</b><small>${Math.round(C.share * 100)}% её стоимости — самоцветами, навсегда</small></div></div>
      ${R.gram ? `<div class="tw-ev"><div><b>💰 GRAM-покупки друга</b><small>${Math.round(R.gram.rate * 100)}% суммы в GRAM — можно вывести${R.gram.mine ? ` · за друзей, приглашённых до открытия, — ${Math.round(R.gram.early * 100)}%` : ''} · получено ${(R.gram.got / 1e9).toFixed(2)} GRAM</small></div></div>` : ''}
      <div class="ic-sec">Приглашено: ${R.n} · 10 ур.: ${R.l10} · 20 ур.: ${R.l20} · получено 💎 ${R.earned}</div>
      ${(R.list || []).map((f) => `<div class="tw-ev"><div><b class="notr">${String(f.name).replace(/[<>&]/g, '')}</b><small>ур. ${f.lvl}</small></div></div>`).join('') || '<div class="tw-soon">Пока никого — отправьте ссылку друзьям</div>'}`;
    const inp = box.querySelector('input'), copyBtn = box.querySelector('[data-a="copy"]');
    const done = (ok) => { copyBtn.textContent = ok ? t('✓ Скопировано') : t('Выделите ссылку и скопируйте'); setTimeout(() => { copyBtn.textContent = t('📋 Скопировать'); }, 2000); };
    copyBtn.onclick = async () => {
      try { await navigator.clipboard.writeText(url); done(true); } catch { inp.focus(); inp.select(); try { done(document.execCommand('copy')); } catch { done(false); } }
    };
    box.querySelector('[data-a="share"]').onclick = () => {
      const text = t('Заходи в Mystic Horizon — MMORPG прямо в Telegram! По моей ссылке — 100 💎 и призыв героя в подарок');
      const u = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
      const W = window.Telegram && window.Telegram.WebApp;
      if (W && W.openTelegramLink) W.openTelegramLink(u); else window.open(u, '_blank');
    };
    return box;
  }
  return { panel, link };
})();
