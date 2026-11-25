"""Вырезать арт на пурпурном фоне (#FF00FF) и уменьшить до нужной ширины (пиксель-арт без полупрозрачности).
python3 tools/cut_prop.py вход.png выход.png ширина
python3 tools/cut_prop.py вход.png выход.png ширина --frames 6   — ряд из N кадров → лист кадров одной ширины (общий масштаб)
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

src, dst, width = sys.argv[1], sys.argv[2], int(sys.argv[3])
frames = int(sys.argv[sys.argv.index('--frames') + 1]) if '--frames' in sys.argv else 0
A = np.asarray(Image.open(src).convert('RGB')).astype(np.int32)
r, g, b = A[..., 0], A[..., 1], A[..., 2]
bg = (r > 150) & (b > 150) & (g < 110) & (np.abs(r - b) < 90)
rgb = A.astype(np.uint8).copy()
edge = ~bg & ndimage.binary_dilation(bg, iterations=1) & (r > 120) & (b > 120) & (g < r - 40)
rgb[edge, 0] = np.minimum(rgb[edge, 0], rgb[edge, 1] + 40); rgb[edge, 2] = np.minimum(rgb[edge, 2], rgb[edge, 1] + 40)
img = np.dstack([rgb, np.where(bg, 0, 255).astype(np.uint8)])

def crop(a):
    ys, xs = np.nonzero(a[..., 3] > 0)
    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

def shrink(a, k):
    im = Image.fromarray(a).resize((max(1, round(a.shape[1] * k)), max(1, round(a.shape[0] * k))), Image.LANCZOS)
    o = np.asarray(im).copy(); o[..., 3] = np.where(o[..., 3] > 110, 255, 0)
    return o

if not frames:
    a = crop(img)
    out = shrink(a, width / a.shape[1])
    Image.fromarray(out).save(dst, optimize=True)
    print(dst, out.shape[1], 'x', out.shape[0])
else:
    # кадры: столбцы фигур по пустым промежуткам
    cols = (img[..., 3] > 0).any(0)
    runs, s0 = [], None
    for i, v in enumerate(cols):
        if v and s0 is None: s0 = i
        if not v and s0 is not None: runs.append([s0, i]); s0 = None
    if s0 is not None: runs.append([s0, len(cols)])
    runs = [x for x in runs if x[1] - x[0] > 20]
    while len(runs) > frames:
        gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]; i = int(np.argmin(gaps)); runs[i][1] = runs[i + 1][1]; del runs[i + 1]
    parts = [img[:, x0:x1] for x0, x1 in runs]
    ys = np.nonzero(np.concatenate([p[..., 3] for p in parts], 1) > 0)[0]
    parts = [p[ys.min():ys.max() + 1] for p in parts]
    fw = max(p.shape[1] for p in parts); k = width / fw
    fh = round(parts[0].shape[0] * k); FW = width
    sheet = np.zeros((fh, FW * len(parts), 4), np.uint8)
    for i, p in enumerate(parts):
        s = shrink(p, k); h, w = s.shape[:2]
        ox = i * FW + (FW - w) // 2; oy = fh - h
        sheet[oy:oy + h, ox:ox + w][s[..., 3] > 0] = s[s[..., 3] > 0]
    Image.fromarray(sheet).save(dst, optimize=True)
    print(dst, 'кадров', len(parts), 'кадр', FW, 'x', fh)
