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
