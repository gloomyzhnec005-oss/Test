# Промты: новые листы ходьбы героев (ХД-1 … ХД-9) — без срезанных плащей

**Зачем:** у этих героев в листах ходьбы плащи, посохи, крылья и волосы срезаны ровной вертикальной линией. Исходные рисунки
были нарисованы вплотную, и при нарезке на кадры края фигур отрезались. Починить старые листы нельзя, нужны новые —
**такие же по облику**, но с большими отступами между фигурами.

## Как отправлять

1. В генератор приложите **картинку-образец героя** (`HD-N_<герой>_образец.jpg`, присылал в чате). Слева на ней 40 текущих кадров героя
   уже стоят в нужном порядке и с нужными отступами, справа — его портрет. Генератор должен повторить **того же героя** в том же стиле.
2. Вставьте общий промт ниже и строку героя.
3. Пришлите результат с кодом («ХД-2»). PNG без сжатия, лучше крупно (от 1500 px по ширине).
4. Я нарежу его (`tools/cut_walk.py`), покажу снимок из игры и только потом выложу.

Если генератор не держит 40 кадров за раз, можно двумя картинками: ряды 1–4 и ряды 5–8 (напишите «ХД-2, ряды 1–4»).

## Общий промт (одинаковый для всех)

```
Pixel art game sprite sheet of ONE hero character, a walking animation, matching the attached reference image EXACTLY:
the same character, the same outfit, colors, weapon, proportions and the same pixel-art style (Diablo / Lineage 2 inspired, chibi-proportioned hero, dark outlines).
Layout: exactly 8 rows × 5 columns, a perfectly even grid, every frame the same size and the same scale.
Row order (the direction the hero walks): row 1 — toward the viewer (down), row 2 — down-right, row 3 — right (side view),
row 4 — up-right, row 5 — away from the viewer (up, back visible), row 6 — up-left, row 7 — left (side view), row 8 — down-left.
Each row: a 5-frame walking loop (legs alternate, small up-down bob, the cloak/hair/wings sway slightly).
VERY IMPORTANT: large empty space around every figure — the whole figure INCLUDING the full cloak, staff, weapon, wings, tail and hair
must fit inside its own cell with a wide margin; nothing may touch or cross the cell border, nothing may overlap a neighbouring frame.
Feet at the same height in every frame of a row.
Flat solid pure magenta #FF00FF background everywhere, no shadows on the background, no grid lines, no text, no numbers, no watermark.
```

## Строка героя (добавьте после общего промта)

| Код | Герой | Строка |
|---|---|---|
| ХД-1 | Гардин | `Hero: Gardin, a dwarf rune keeper — stocky dwarf with a long braided red beard and a fur collar, dark steel-and-gold armor with glowing blue runes, a blue rune cape, a long rune mace-staff with blue crystals.` |
| ХД-2 | Гидеон | `Hero: Gideon, a dark priest — hooded figure in black-and-crimson robes with a long tattered crimson cloak, a golden staff topped with a glowing violet crystal.` |
| ХД-3 | Ле Блан | `Hero: LeBlanc, an illusionist — elegant sorceress with long dark hair, magenta feathers and a golden masquerade mask, a magenta-and-purple dress with flowing ribbons, a golden scepter-staff with a pink crystal.` |
| ХД-4 | Торден | `Hero: Torden, a dwarf geomancer — dwarf with a long red beard in a green hooded cloak, armor of stone plates and leather, a gnarled wooden staff with a large green crystal.` |
| ХД-5 | Медея | `Hero: Medea, a gorgon — green-skinned woman with living green snakes for hair, green-and-gold armored dress, a long tattered green cloak, a large ornate green-and-gold bow.` |
| ХД-6 | Волдан | `Hero: Voldan, a sea priest — triton with long white hair and beard, teal scaled armor with gold and sea-shell details, a flowing teal robe, a long golden trident.` |
| ХД-7 | Брильда | `Hero: Brilda, a crystal mage — dwarf woman with pink hair, armor grown with pink and violet crystals, a crystal staff topped with a large violet gem.` |
| ХД-8 | Зефира | `Hero: Zefira, a half-dragon woman — red-haired woman with red dragon horns, large red dragon wings and a dragon tail, red-and-gold armor; the wings must be fully visible in every frame.` |
| ХД-9 | Галатея | `Hero: Galatea, a siren — sea maiden with very long flowing turquoise hair, teal-and-gold scaled dress, pearls and a golden crown; the hair must be fully visible in every frame.` |

Файлы после нарезки: `public/assets/heroes/<герой>_sheet.png` (кадр 56×48, как сейчас — в игре ничего больше менять не надо).
