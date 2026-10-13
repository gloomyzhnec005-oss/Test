// Нарисованные иконки умений: public/assets/skills/<герой>_<0|1|2|p>.webp (нарезка — tools/cut_icons.py).
// Герой из списка — картинки вместо эмодзи на кнопках, в лобби, у мастера и на экране персонажа.
window.SkillArt = (() => {
  const HAS = new Set(['bohai', 'vebrand', 'vayald', 'alamariel', 'ursus', 'nairi', 'malakor', 'kelto', 'brendan', 'kira', 'kassian', 'zukra', 'nimue', 'leblanc', 'taliesin', 'aurelius', 'valerian', 'justina', 'giacomo', 'orion', 'faelin', 'ilyria', 'tibor', 'ingrid', 'talmira', 'sanguine', 'zefira', 'morvenKnight', 'emet', 'selena', 'sirocco', 'blaze', 'gardin', 'elnaeris', 'gideon', 'voldan', 'galatea', 'itilior', 'flare', 'caldero', 'torden', 'medea', 'wugazh', 'brilda']);
  const src = (hero, i) => `assets/skills/${hero}_${i}.webp`;
  // Класс героя → нарисованная кнопка атаки assets/ui/atk_<класс>.webp
  const CLASS = {vebrand: "warrior", vayald: "warrior", caldero: "warrior", emet: "warrior", zefira: "warrior", wugazh: "warrior", brendan: "knight", valerian: "knight", kelto: "knight", morvenKnight: "knight", talmira: "knight", gardin: "knight", kira: "rogue", kassian: "rogue", nairi: "rogue", malakor: "rogue", tibor: "rogue", bohai: "rogue", faelin: "hunter", ursus: "hunter", medea: "hunter", ingrid: "hunter", aurelius: "elemental", ilyria: "elemental", itilior: "elemental", blaze: "elemental", flare: "elemental", sirocco: "elemental", brilda: "elemental", torden: "elemental", orion: "dark", zukra: "dark", sanguine: "dark", gideon: "dark", elnaeris: "dark", leblanc: "dark", nimue: "nature", taliesin: "nature", alamariel: "nature", voldan: "nature", justina: "holy", selena: "holy", giacomo: "holy", galatea: "holy"};
  return {
    attack: (hero) => (CLASS[hero] ? `assets/ui/atk_${CLASS[hero]}.webp` : null),
    has: (hero) => HAS.has(hero),
    src,
    // i: 0..2 — умение, 'p' — пассивка; без картинки — эмодзи
    icon: (hero, i, emoji) => (HAS.has(hero) ? `<img class="sk-art" src="${src(hero, i)}" alt="" draggable="false">` : emoji),
  };
})();
