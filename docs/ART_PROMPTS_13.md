# Промты: всё, что ждёт картинок (27.11)

Пока картинок нет, в игре стоят заглушки: эмодзи, похожая рамка или общие арты. Присылайте по одной группе с кодом
(например «ОР-1…4») — я нарежу и подключу. Везде фон — **сплошной пурпурный #FF00FF**, его я вырезаю сам.

| Код | Что | Сейчас в игре | Куда встанет |
|---|---|---|---|
| ХД-4…9 | Листы ходьбы Тордена, Медеи, Волдана, Брильды, Зефиры, Галатеи | старые листы | промты — в `docs/ART_PROMPTS_11.md` |
| ОР-1…4 | Значки орденов Хранителя ✅, Архонта ✅, Дракона, Вечности | ОР-1, ОР-2 — в игре; 🐉 💠 — эмодзи | `public/assets/ui/order_<id>.webp` |
| ВТ-1 | Рамка «Ветеран ЗБТ» | перекрашенная рамка основателя | `public/assets/ui/ava/veteran.webp` |
| ЗМ-1 | Кристалл замка (4 кадра) | монстр «Кристальный страж» | спрайт кристалла осады |
| ЗМ-2 | Флаг клана-владельца у замка | нет | у ворот замка и в городе |
| ЗМ-3 | Двор замка ×3 мира | клетки (камень, стена, колонны) | `public/assets/world/castle/<мир>.webp` |
| БШ-1 | Зал Бесконечной башни | арена выживания | фон этажа башни |
| МН-1…6 | Иконки меню: почта, друзья, карта мира, осада, башня, автоумения | общие иконки | `public/assets/ui/place_<id>.webp` |

---

## ОР-1…4 — значки новых орденов

Приложите образцы: `public/assets/ui/order_magnate.webp` и `order_champion.webp`.

```
Game UI icon, a single heraldic order medal, matching the attached reference order icons EXACTLY in style, size, framing,
lighting and level of detail (painted fantasy style, Diablo / Lineage 2 inspired, rich metal and gems, soft glow).
The medal is centered, fills about 85% of the square, nothing touches the border.
Square image, 1024×1024. Flat solid pure magenta #FF00FF background, no shadow on the background, no text, no letters, no watermark.
```

| Код | Орден | Строка (добавьте после общего промта) |
|---|---|---|
| ОР-1 | Хранитель | `A steel-and-silver kite shield medal with a glowing blue sapphire in the center, crossed spears behind it, blue enamel ribbon.` |
| ОР-2 | Архонт | `An ornate golden fleur-de-lis medal on a dark purple enamel disc, amethyst gems, small laurel wreath, royal and solemn.` |
| ОР-3 | Дракон | `A dark crimson medal with a coiled golden dragon biting its tail around a glowing ruby, scales and tiny flames.` |
| ОР-4 | Вечность | `The highest order: a radiant prismatic diamond star medal, white gold rays, a hovering cyan crystal in the center, cosmic sparkles, halo of light — clearly more precious than all the others.` |

---

## ВТ-1 — рамка «Ветеран ЗБТ»

Приложите образец: `public/assets/ui/ava/founder.webp` (рамка аватара основателя).

```
Game UI avatar frame, a round portrait frame, matching the attached reference frame EXACTLY in size, shape, thickness and style
(painted fantasy, Diablo / Lineage 2 inspired). The CENTER of the frame is EMPTY (pure magenta) — the hero portrait goes there.
Theme: honored veteran of the closed beta test — dark steel and old silver, a laurel wreath, two crossed swords at the bottom,
a small ribbon banner at the bottom (no letters on it), worn battle scratches, a single glowing blue star at the top.
Square image, 1024×1024, the frame centered and filling the square like the reference.
Flat solid pure magenta #FF00FF background and center, no shadow, no text, no watermark.
```

---

## ЗМ-1 — кристалл замка (4 кадра)

Сейчас кристалл — это монстр «Кристальный страж» (существо). Нужен сам кристалл на постаменте.
Приложите образец: любой спрайт босса (например `public/assets/mobs/` — дракон или голем), чтобы размер и стиль совпали.

```
Pixel art game sprite sheet, a huge magic castle crystal on a carved stone pedestal, 3/4 top-down view,
same pixel-art style, palette and outline thickness as the attached reference sprite (Diablo / Lineage 2 inspired, dark outlines).
The crystal is tall and faceted, floating slightly above the pedestal, glowing from inside, small runes orbiting it.
Layout: ONE row of 4 frames, perfectly even grid, same size and position in every frame —
an idle loop: the crystal slowly pulses (glow brighter → dimmer), the runes rotate a little each frame.
Large empty space around the crystal in every frame, nothing touches the cell border.
Flat solid pure magenta #FF00FF background, no shadow on the background, no text, no watermark.
```

Строка мира (после промта): Эльдмир — `emerald green crystal, mossy pedestal`; Морграт — `blood-red crystal, black obsidian pedestal with lava cracks`; Аэлион — `pale gold crystal, white marble pedestal with gold trim`.

---

## ЗМ-2 — флаг клана-владельца

```
Pixel art game asset, a tall war banner on a wooden pole with a gilded spear tip, 3/4 top-down view, Diablo / Lineage 2 inspired,
dark outlines, matching the attached reference prop style. The cloth is PLAIN WHITE with a simple dark border and NO emblem —
the game will tint it in the clan color and draw the clan tag itself.
Layout: ONE row of 4 frames, the cloth waving in the wind (idle loop), same size and position in every frame.
Flat solid pure magenta #FF00FF background, no shadow, no text, no watermark.
```

Приложите образец: `public/assets/world/props/` — любой стяг или фонарь.

---

## ЗМ-3 — двор замка (по одному на мир)

Карта замка — прямоугольник **36 × 44 клетки** (ширина × высота), вид сверху. Картинку я растяну ровно на карту,
поэтому важны пропорции и места стен.

```
Top-down 2D game map background, a castle courtyard for a clan siege battle, painted pixel-art style matching the attached
reference arena image (same top-down angle, same lighting and level of detail, Diablo / Lineage 2 inspired).
Portrait image, aspect ratio exactly 36:44 (for example 1440×1760). Layout, measured from the top of the image:
- the whole image is framed by a thick castle wall on all four sides (about 2.5% of the width/height);
- top 0–36%: the inner castle yard, paved with large stone slabs; at the top center (about 12% from the top) a round raised
  stone dais for a big magic crystal (leave the dais EMPTY — the crystal is drawn separately);
- at 36–39% from the top: a horizontal inner fortress wall across the whole width, with ONE open gateway in the exact center
  (the opening is about 17% of the image width), broken wooden gate doors pushed aside;
- 39–70%: the outer yard, stone slabs with cracks, a few barricades;
- bottom 70–100%: the attackers' camp on dirt ground: tents, siege ladders, campfires along the sides (keep the center free);
- square stone pillars (each about 5% of the width) at: (25%, 19%), (78%, 19%), (30%, 55%), (72%, 55%), (49%, 62%), (18%, 78%), (83%, 78%).
No characters, no text, no UI, no watermark.
```

| Код | Мир | Строка |
|---|---|---|
| ЗМ-3а | Эльдмир | `Theme: green forest castle — grey stone, moss, ivy on the walls, green banners.` |
| ЗМ-3б | Морграт | `Theme: abyss fortress — black volcanic stone, lava cracks glowing red, iron spikes, red banners.` |
| ЗМ-3в | Аэлион | `Theme: sky citadel — white marble and gold, blue sky glimpses between merlons, white-and-gold banners.` |

Приложите образец: `public/assets/world/arena/<мир>.webp`.

---

## БШ-1 — зал Бесконечной башни

Этаж башни — круглая площадка, как арена выживания. Одна картинка на все этажи.
Приложите образец: `public/assets/world/arena/green.webp` (размер и угол обзора).

```
Top-down 2D game map background, a round hall on a floor of an endless magic tower, painted pixel-art style matching the attached
reference arena EXACTLY in angle, size, framing and the position of the inner wall edge (the walkable round floor must have the same
radius as in the reference). Dark blue-grey stone floor with a large glowing arcane circle in the center, carved runes,
eight tall windows in the round wall showing a night sky and clouds far below, floating candles, a spiral staircase going up
behind the wall at the top. Mysterious, slightly ominous. Square image, same size as the reference.
No characters, no text, no UI, no watermark.
```

---

## МН-1…6 — иконки меню

Приложите образцы: `public/assets/ui/place_arena.webp` и `place_pass.webp`.

```
Game UI icon, a single object, matching the attached reference icons EXACTLY in style, framing, lighting and level of detail
(painted fantasy, Diablo / Lineage 2 inspired). The object is centered, fills about 80% of the square, nothing touches the border.
Square image, 1024×1024. Flat solid pure magenta #FF00FF background, no shadow on the background, no text, no watermark.
```

| Код | Пункт меню | Строка |
|---|---|---|
| МН-1 | Почта | `A sealed parchment letter with a red wax seal and a small leather parcel tied with string.` |
| МН-2 | Друзья | `Two gauntlets clasping hands in a firm handshake, a soft golden glow around them.` |
| МН-3 | Карта мира | `A rolled-open old parchment world map with three tiny castles and a red route line, a compass on the corner.` |
| МН-4 | Осада замков | `A small stone castle tower with a clan war banner on top and a siege ladder leaning against it, sparks of battle.` |
| МН-5 | Бесконечная башня | `A tall slender magic tower spiraling into the clouds, glowing windows, stars around the top.` |
| МН-6 | Автоумения | `A glowing spell rune inside a circular golden clockwork gear, small lightning sparks — magic that casts by itself.` |

Файлы: `place_mail`, `place_friends`, `place_map`, `place_castle`, `place_tower`, `place_autoskill`.
