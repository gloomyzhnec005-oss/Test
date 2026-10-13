// Нарисованные предметы: public/assets/items/<категория>_<шаблон>.webp и mat_<ресурс>.webp (нарезка — tools/cut_items.py).
// Чего нет в списке — показывается эмодзи.
window.ITEM_ART = [
  'weapon_sword', 'weapon_axe', 'weapon_staff', 'weapon_bow', 'weapon_daggers', 'weapon_hammer', 'weapon_spear', 'weapon_wand',
  'helm_cap', 'helm_helmet', 'helm_circlet', 'helm_hood', 'gloves_bracers', 'gloves_grips', 'gloves_gauntlet', 'gloves_silk',
  'ring_ringPow', 'ring_ringAgi', 'ring_ringWind', 'ring_bracer', 'amulet_amuLife', 'amulet_amuMind', 'amulet_amuBlood',
  'armor_leather', 'armor_chain', 'armor_plate', 'armor_robe', 'armor_cloak', 'armor_scale', 'boots_boots', 'boots_greaves', 'boots_sandals',
  'rune_fury', 'rune_life', 'rune_edge', 'rune_haste', 'rune_blood', 'rune_wisdom', 'rune_time', 'rune_stone', 'rune_wind', 'rune_fortune',
  'mat_ore1', 'mat_ore2', 'mat_ore3', 'mat_ess1', 'mat_ess2', 'mat_ess3', 'mat_core1', 'mat_core2', 'mat_core3',
  'mat_scrollR', 'mat_scrollE', 'mat_scrollL', 'mat_scrollM', 'mat_bp', 'mat_tpScroll', 'mat_kitSmith', 'mat_chestSet', 'mat_chestLegend',
  'mat_potHp', 'mat_potHp2', 'mat_potRes', 'mat_elxAtk', 'mat_elxDef', 'mat_elxAgi', 'mat_elxMind', 'mat_elxXp', 'mat_elxLuck',
];
// Комплекты классов: 7 вещей <слот>_set_<класс> и герб crest_<класс>
const SET_ART = ['warrior', 'knight', 'rogue', 'hunter', 'elemental', 'dark', 'nature', 'holy'];
for (const c of SET_ART) {
  for (const s of ['weapon', 'helm', 'armor', 'gloves', 'boots', 'ring', 'amulet']) window.ITEM_ART.push(`${s}_set_${c}`);
  window.ITEM_ART.push('crest_' + c);
}
