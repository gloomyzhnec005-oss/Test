# Промт: сундук босса — анимация открытия (СБ-1)

Сейчас в игре два кадра (закрыт / открыт) + эффекты кодом (свечение, дрожь, лучи, искры). Работает и так.
Если хотите плавное открытие — нужен лист из 6 кадров. Я подставлю его вместо двух кадров, эффекты останутся.

Приложите образец: `public/assets/world/props/chestClosed.png` (текущий сундук), чтобы стиль совпал.

```
Pixel art game sprite sheet, a treasure chest opening animation, matching the attached reference chest EXACTLY
(same chest, same dark wood, gold trim, same pixel-art style, Diablo / Lineage 2 inspired, dark outlines, 3/4 top-down view).
Layout: ONE row of 6 frames, perfectly even grid, every frame the same size and scale, the chest in the same place in every frame.
Frame 1 — closed, a faint golden glow leaking from the seams.
Frame 2 — the chest jolts, the lid lifts a tiny bit, bright golden light bursts from the gap.
Frame 3 — lid half open, strong golden light rays shooting upward.
Frame 4 — lid fully open, a pile of gold coins and gems glowing inside, light rays.
Frame 5 — fully open, a few sparkles flying out.
Frame 6 — fully open, calm glow inside (final resting frame).
Large empty space around the chest in every frame, nothing touches the cell border.
Flat solid pure magenta #FF00FF background everywhere, no shadows on the background, no grid lines, no text, no watermark.
```

Пришлите результат с кодом «СБ-1» (PNG, от 1200 px по ширине).

---

# Промты: врата опасных данжей (ОД-1 … ОД-3)

Один портал на город, на южной площадке рядом с мировым боссом. Должен сразу читаться как «опасно, PvP»:
багровый свет, черепа, шипы, но в стиле остальных порталов города.

Приложите образец — арку этого мира (`public/assets/world/<мир>/portals/arch.png`) и портал мирового босса
(`.../boss.png`), чтобы размер и стиль совпали.

**Общий промт:**
```
Pixel art game asset, a single dungeon portal gate, front view (slightly from above, 3/4 top-down like the attached references),
same pixel-art style, palette, outline thickness and scale as the attached reference portal (Diablo / Lineage 2 inspired, dark outlines).
The gate marks a DANGEROUS PvP dungeon: menacing and blood-red. The inner opening of the arch is EMPTY (fully transparent / magenta),
no swirl, no glow inside the opening — the game fills it with color itself.
Glowing crimson runes on the stones, small crimson flames, the whole gate standing on a cracked stone base.
Size: about 1.5× the attached normal arch (it is a special gate), the gate centered, wide margin around it.
Flat solid pure magenta #FF00FF background, no shadow on the background, no text, no watermark.
```

**Строка мира (добавьте после общего промта):**

| Код | Город | Данж | Строка |
|---|---|---|---|
| ОД-1 | Эльдмир | Долина проклятых костей | `Theme: green forest world. The arch is built from old grey stone overgrown with dead black vines, crowned with a large horned skull; piles of bones and rusty swords at its feet; crimson runes.` |
| ОД-2 | Морграт | Поле гнева Бездны | `Theme: abyss / volcanic world. The arch is made of black obsidian with jagged spikes and chains, molten red cracks, two demon horns on top, burning braziers on both sides.` |
| ОД-3 | Аэлион | Брань мёртвых небес | `Theme: sky world of white marble and gold. A broken, corrupted angelic arch: cracked white marble with tarnished gold, torn dark feathered wings on both sides, a cracked halo above, crimson light leaking from the cracks.` |

Файлы после обработки: `public/assets/world/<мир>/portals/pk.png` — я подключу их вместо общей арки (заливка проёма останется).
