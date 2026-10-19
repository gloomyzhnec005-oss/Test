"""Разделить слипшиеся кадры атаки по линиям наименьшего наложения.
python3 tools/boss_seams.py лист.png строка_ряда префикс_вывода 300-400,640-780,1130-1240
Пишет префикс0..3.png — в каждом во втором ряду оставлен только свой кадр."""
import sys, numpy as np
from PIL import Image
src, mid, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
bands = [tuple(int(v) for v in b.split('-')) for b in sys.argv[4].split(',')]
im = np.asarray(Image.open(src).convert('RGB')).copy()
bg = np.median(im[:8, :8].reshape(-1, 3), 0)
m = (np.sqrt(((im.astype(float) - bg) ** 2).sum(2)) > 70).astype(float)
H, W = m.shape
seams = []
for lo, hi in bands:
    c = m[mid:, lo:hi] + 1e-3; R, C = c.shape; acc = c.copy(); bk = np.zeros((R, C), int)
    for y in range(1, R):
        p = np.stack([np.r_[np.inf, acc[y-1, :-1]], acc[y-1], np.r_[acc[y-1, 1:], np.inf]])
        k = p.argmin(0); bk[y] = k - 1; acc[y] += p.min(0)
    x = int(acc[-1].argmin()); path = [0] * R
    for y in range(R - 1, -1, -1): path[y] = x + lo; x += bk[y, x] if y else 0
    seams.append(np.array(path)); print('seam', lo, hi, 'cost', acc[-1].min())
xs = np.arange(W)[None]
edges = [np.zeros(H - mid, int)] + seams + [np.full(H - mid, W)]
for f in range(4):
    o = im.copy(); keep = (xs >= edges[f][:, None]) & (xs < edges[f + 1][:, None])
    o[mid:][~keep] = bg; Image.fromarray(o).save(f'{out}{f}.png')
