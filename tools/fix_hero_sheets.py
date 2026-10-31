"""Починка листов ходьбы героев (8 направлений × кадры, 36×48):
1) концы посохов и копий, вылезшие в соседний кадр, возвращаются «хозяину» — кадр расширяется на PAD с каждой стороны;
   мелкие оторванные обрезки у края без пары удаляются;
2) ряды, нарисованные не в ту сторону, заменяются зеркальной копией правильного ряда (план FLIPS ниже).
python3 tools/fix_hero_sheets.py  — перезаписывает public/assets/heroes/*_sheet.png и ширину w в public/js/skins.js"""
import re, numpy as np
from PIL import Image
from scipy import ndimage

PAD = 10
# ряд-получатель ← зеркало ряда-источника. 0 вниз, 1 вниз-вправо, 2 вправо, 3 вверх-вправо, 4 вверх, 5 вверх-влево, 6 влево, 7 вниз-влево
FLIPS = {}
for h in 'alamariel nairi zukra nimue taliesin giacomo orion faelin ilyria talmira sanguine elnaeris voldan itilior torden'.split(): FLIPS.setdefault(h, {})[7] = 1
for h in 'brendan nimue giacomo ilyria talmira elnaeris voldan itilior torden'.split(): FLIPS.setdefault(h, {})[6] = 2
for h in 'aurelius taliesin elnaeris nimue'.split(): FLIPS.setdefault(h, {})[3] = 5
for h in 'justina blaze'.split(): FLIPS.setdefault(h, {})[5] = 3

def fix_row(cells):
    """cells: кадры RGBA одного ряда. Ряд склеивается в полосу. Затравка каждой фигуры — пиксели в средней полосе
    своего кадра; от затравок одновременно идёт заливка по силуэту (8 соседей), каждый пиксель получает фигура,
    дошедшая до него первой. Так посох, вылезший за край, остаётся у хозяина, а чужой плащ уходит соседу.
    Оторванные кусочки — к ближайшей фигуре, если рядом; дальние — мусор. Выход — кадры шириной w + 2*PAD."""
    from collections import deque
    n = len(cells); h, w = cells[0].shape[:2]
    strip = np.concatenate(cells, axis=1); W = strip.shape[1]
    m = strip[..., 3] > 20
    own = np.full(m.shape, -1, np.int32); q = deque()
    lo, hi = int(w * 0.3), int(w * 0.7)
    for c in range(n):
        ys, xs = np.nonzero(m[:, c * w + lo:c * w + hi])
        for y, x in zip(ys, xs): own[y, c * w + lo + x] = c; q.append((y, c * w + lo + x))
    while q:
        y, x = q.popleft(); c = own[y, x]
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                Y, X = y + dy, x + dx
                if 0 <= Y < h and 0 <= X < W and m[Y, X] and own[Y, X] < 0: own[Y, X] = c; q.append((Y, X))
    # оторванные кусочки — к ближайшей фигуре (не дальше 4 px), иначе выбросить
    if (own >= 0).any():
        dist, (iy, ix) = ndimage.distance_transform_edt(own < 0, return_indices=True)
        lone = m & (own < 0) & (dist <= 4)
        own[lone] = own[iy[lone], ix[lone]]
    out = [np.zeros((h, w + 2 * PAD, 4), np.uint8) for _ in range(n)]
    ys, xs = np.nonzero(own >= 0)
    for y, x in zip(ys, xs):
        c = own[y, x]; X = x - c * w + PAD
        if 0 <= X < w + 2 * PAD: out[c][y, X] = strip[y, x]
    return out

src = open('public/js/skins.js').read()
H = re.findall(r"\n    (\w+): \{\n      sheet: '([^']+)'[^\n]*w: (\d+), h: (\d+), frames: (\d+)", src)
for name, sheet, w, h, fr in H:
    w, h, fr = int(w), int(h), int(fr)
    if w != 36: print(name, 'уже обработан, пропуск'); continue
    A = np.asarray(Image.open('public/' + sheet).convert('RGBA'))
    rows = [fix_row([A[r*h:(r+1)*h, c*w:(c+1)*w] for c in range(fr)]) for r in range(8)]
    for dst, srcr in FLIPS.get(name, {}).items(): rows[dst] = [f[:, ::-1].copy() for f in rows[srcr]]
    W2 = w + 2 * PAD
    sheet_img = np.zeros((8 * h, fr * W2, 4), np.uint8)
    for r in range(8):
        for c in range(fr): sheet_img[r*h:(r+1)*h, c*W2:(c+1)*W2] = rows[r][c]
    Image.fromarray(sheet_img).save('public/' + sheet, optimize=True)
    src = src.replace(f"sheet: '{sheet}', portrait:", f"sheet: '{sheet}', portrait:", 1)
    src = re.sub(rf"(\n    {name}: \{{\n      sheet: '[^']+'[^\n]*?)w: 36, h: {h}", rf"\1w: {W2}, h: {h}", src, count=1)
    print(name, 'OK', 'flip' if name in FLIPS else '')
open('public/js/skins.js', 'w').write(src)
