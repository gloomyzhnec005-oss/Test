// Нарисованные иконки умений: public/assets/skills/<герой>_<0|1|2|p>.webp (нарезка — tools/cut_icons.py).
// Герой из списка — картинки вместо эмодзи на кнопках, в лобби, у мастера и на экране персонажа.
window.SkillArt = (() => {
  const HAS = new Set(['bohai', 'vebrand', 'vayald', 'alamariel', 'ursus', 'nairi', 'malakor', 'kelto', 'brendan', 'kira', 'kassian', 'zukra', 'nimue', 'leblanc', 'taliesin', 'aurelius', 'valerian', 'justina', 'giacomo', 'orion', 'faelin', 'ilyria', 'tibor', 'ingrid', 'talmira', 'sanguine', 'zefira', 'morvenKnight', 'emet', 'selena', 'sirocco', 'blaze', 'gardin', 'elnaeris', 'gideon', 'voldan', 'galatea', 'itilior', 'flare', 'caldero', 'torden', 'medea']);
  const src = (hero, i) => `assets/skills/${hero}_${i}.webp`;
  return {
    has: (hero) => HAS.has(hero),
    src,
    // i: 0..2 — умение, 'p' — пассивка; без картинки — эмодзи
    icon: (hero, i, emoji) => (HAS.has(hero) ? `<img class="sk-art" src="${src(hero, i)}" alt="" draggable="false">` : emoji),
  };
})();
