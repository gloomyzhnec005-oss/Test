"""Нарезка нового листа ходьбы героя (промты ХД-1…, docs/ART_PROMPTS_11.md).
Вход: картинка 8 рядов × 5 кадров на сплошном пурпурном фоне (#FF00FF), фигуры с отступами (не касаются соседей).
Ряды: 0 вниз, 1 вниз-вправо, 2 вправо, 3 вверх-вправо, 4 вверх, 5 вверх-влево, 6 влево, 7 вниз-влево.
Выход: public/assets/heroes/<id>_sheet.png — кадры 56×48 (как сейчас), один масштаб на весь лист, ноги внизу кадра.

python3 tools/cut_walk.py лист.png gideon            — перезаписать лист героя
python3 tools/cut_walk.py лист.png gideon out.png    — сохранить в другой файл (проверка)
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

FW, FH, ROWS, COLS = 56, 48, 8, 5
src, hero = sys.argv[1], sys.argv[2]
dst = sys.argv[3] if len(sys.argv) > 3 else f'public/assets/heroes/{hero}_sheet.png'

A = np.asarray(Image.open(src).convert('RGB')).astype(np.int32)
H, W = A.shape[:2]
r, g, b = A[..., 0], A[..., 1], A[..., 2]
# пурпурный фон (и его оттенки на краях): много красного и синего, мало зелёного
bgmask = (r > 150) & (b > 150) & (g < 110) & (np.abs(r - b) < 90)
alpha = np.where(bgmask, 0, 255).astype(np.uint8)
# убрать пурпурный ореол на краях фигуры: у полупрозрачных краевых пикселей — снизить пурпур
edge = (alpha == 255) & ndimage.binary_dilation(bgmask, iterations=1) & (r > 120) & (b > 120) & (g < r - 40)
rgb = A.astype(np.uint8).copy()
rgb[edge, 0] = np.minimum(rgb[edge, 0], rgb[edge, 1] + 40); rgb[edge, 2] = np.minimum(rgb[edge, 2], rgb[edge, 1] + 40)
img = np.dstack([rgb, alpha])

ch, cw = H / ROWS, W / COLS
cells, boxes = [], []
for ri in range(ROWS):
    for ci in range(COLS):
        y0, y1, x0, x1 = int(ri * ch), int((ri + 1) * ch), int(ci * cw), int((ci + 1) * cw)
        cell = img[y0:y1, x0:x1]
        m = cell[..., 3] > 0
        # самый крупный связный кусок и всё, что рядом с ним (посох, плащ), — остальное мусор
        lab, n = ndimage.label(ndimage.binary_dilation(m, iterations=3))
        if n:
            big = np.argmax(ndimage.sum(m, lab, range(1, n + 1))) + 1
            m = m & (lab == big)
        cell = cell.copy(); cell[~m, 3] = 0
        ys, xs = np.nonzero(m)
        boxes.append((ys.min(), ys.max(), xs.min(), xs.max()) if len(ys) else None)
        cells.append(cell)
# единый масштаб: самая высокая/широкая фигура листа влезает в кадр (2 px запаса)
hmax = max(b[1] - b[0] + 1 for b in boxes if b); wmax = max(b[3] - b[2] + 1 for b in boxes if b)
k = min((FH - 2) / hmax, (FW - 2) / wmax)
out = np.zeros((ROWS * FH, COLS * FW, 4), np.uint8)
for i, (cell, bx) in enumerate(zip(cells, boxes)):
    if not bx: continue
    y0, y1, x0, x1 = bx
    crop = Image.fromarray(cell[y0:y1 + 1, x0:x1 + 1])
    nw, nh = max(1, round(crop.width * k)), max(1, round(crop.height * k))
    crop = crop.resize((nw, nh), Image.LANCZOS)
    a = np.asarray(crop).copy(); a[..., 3] = np.where(a[..., 3] > 110, 255, 0)  # пиксель-арт: без полупрозрачности
    ri, ci = divmod(i, COLS)
    # по горизонтали — по «центру тяжести» фигуры, ноги — у нижнего края кадра
    cx = ndimage.center_of_mass(a[..., 3] > 0)[1] if (a[..., 3] > 0).any() else nw / 2
    ox = int(round(FW / 2 - cx)); ox = max(0, min(FW - nw, ox)); oy = FH - 1 - nh
    sub = out[ri * FH + oy: ri * FH + oy + nh, ci * FW + ox: ci * FW + ox + nw]
    sub[a[..., 3] > 0] = a[a[..., 3] > 0]
Image.fromarray(out).save(dst, optimize=True)
print(f'{hero}: лист {COLS * FW}×{ROWS * FH}, масштаб ×{k:.3f} →', dst)
