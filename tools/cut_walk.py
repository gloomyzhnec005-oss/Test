"""Нарезка нового листа ходьбы героя (промты ХД-1…, docs/ART_PROMPTS_11.md).
Вход: картинка с рядами по 5 кадров на сплошном пурпурном фоне (#FF00FF), фигуры с отступами (не касаются соседей).
Ряды и колонки ищутся сами (по пустым полосам фона), так что лишний ряд или неровная сетка не мешают.
Выход: public/assets/heroes/<id>_sheet.png — кадры 56×48 (как сейчас), один масштаб на весь лист, ноги внизу кадра.
Ряды игры: 0 вниз, 1 вниз-вправо, 2 вправо, 3 вверх-вправо, 4 вверх, 5 вверх-влево, 6 влево, 7 вниз-влево.

python3 tools/cut_walk.py лист.png gideon                     — ряды картинки 1…8 = ряды игры по порядку
python3 tools/cut_walk.py лист.png gideon --map 1,2,3,4,5     — взять ряды картинки для «вниз, вниз-вправо, вправо,
                                                                вверх-вправо, вверх», а левые — зеркалом правых
python3 tools/cut_walk.py лист.png gideon --map 1,2,3,4,5 --out проверка.png
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

FW, FH, ROWS, COLS = 56, 48, 8, 5
args = sys.argv[1:]
opt = {}
while any(a.startswith('--') for a in args):
    i = next(i for i, a in enumerate(args) if a.startswith('--'))
    opt[args[i][2:]] = args[i + 1]; del args[i:i + 2]
src, hero = args[0], args[1]
dst = opt.get('out') or f'public/assets/heroes/{hero}_sheet.png'

A = np.asarray(Image.open(src).convert('RGB')).astype(np.int32)
H, W = A.shape[:2]
r, g, b = A[..., 0], A[..., 1], A[..., 2]
# пурпурный фон (и его оттенки на краях): много красного и синего, мало зелёного
bgmask = (r > 150) & (b > 150) & (g < 110) & (np.abs(r - b) < 90)
alpha = np.where(bgmask, 0, 255).astype(np.uint8)
# убрать пурпурный ореол на краях фигуры
edge = (alpha == 255) & ndimage.binary_dilation(bgmask, iterations=1) & (r > 120) & (b > 120) & (g < r - 40)
rgb = A.astype(np.uint8).copy()
rgb[edge, 0] = np.minimum(rgb[edge, 0], rgb[edge, 1] + 40); rgb[edge, 2] = np.minimum(rgb[edge, 2], rgb[edge, 1] + 40)
img = np.dstack([rgb, alpha])
fg = alpha > 0


def bands(v, n):
    """Полосы с фигурами вдоль оси; если их больше n — склеить самые близкие, если меньше — делить поровну."""
    runs, s = [], None
    for i, x in enumerate(v):
        if x and s is None: s = i
        if not x and s is not None: runs.append([s, i]); s = None
    if s is not None: runs.append([s, len(v)])
    runs = [x for x in runs if x[1] - x[0] > 6]
    while n and len(runs) > n:
        gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]
        i = int(np.argmin(gaps)); runs[i][1] = runs[i + 1][1]; del runs[i + 1]
    return runs


rb = bands(fg.sum(1) > 2, None)
cb = bands(fg.sum(0) > 2, COLS)
if len(cb) != COLS:
    sys.exit(f'колонок найдено {len(cb)}, а нужно {COLS} — фигуры касаются друг друга?')
print('рядов на картинке:', len(rb), ' колонок:', len(cb))
# границы ячеек — посередине пустых промежутков
def cuts(runs, size):
    edges = [0] + [(runs[i][1] + runs[i + 1][0]) // 2 for i in range(len(runs) - 1)] + [size]
    return list(zip(edges[:-1], edges[1:]))
rc, cc = cuts(rb, H), cuts(cb, W)

if 'map' in opt:
    m = [int(x) - 1 for x in opt['map'].split(',')]
    plan = [(m[0], False), (m[1], False), (m[2], False), (m[3], False), (m[4], False), (m[3], True), (m[2], True), (m[1], True)]
else:
    if len(rc) < ROWS: sys.exit(f'рядов {len(rc)}, нужно {ROWS} — укажите --map')
    plan = [(i, False) for i in range(ROWS)]

cells, boxes = [], []
for src_row, flip in plan:
    y0, y1 = rc[src_row]
    for x0, x1 in cc:
        cell = img[y0:y1, x0:x1].copy()
        m = cell[..., 3] > 0
        # самый крупный связный кусок и всё, что рядом с ним (посох, плащ), — остальное мусор
        lab, n = ndimage.label(ndimage.binary_dilation(m, iterations=3))
        if n:
            big = np.argmax(ndimage.sum(m, lab, range(1, n + 1))) + 1
            m = m & (lab == big)
        cell[~m, 3] = 0
        if flip: cell = cell[:, ::-1]; m = m[:, ::-1]
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
    crop = Image.fromarray(np.ascontiguousarray(cell[y0:y1 + 1, x0:x1 + 1]))
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
