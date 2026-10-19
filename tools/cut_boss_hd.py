"""Босс в высоком качестве (промты БХ): лист 2 ряда × 4 кадра на зелёном или пурпурном фоне.
python3 tools/cut_boss_hd.py лист.png id [рост=112] [ширина_кадра=240] [высота_кадра=152]
Кадры игры: 4 ходьбы + 3 атаки (замах, удар, попадание; «возврат» не нужен).
Лист в 2 раза крупнее обычного — в mobart.js у него вдвое меньше scale, на экране размер тот же, но чётче."""
import sys, numpy as np
from PIL import Image
from scipy import ndimage
src, name = sys.argv[1], sys.argv[2]
hp, Wc, Hc = (int(a) for a in (sys.argv[3:6] + ['112', '240', '152'][len(sys.argv[3:6]):]))
im = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
H, W, _ = im.shape
bg = np.median(np.concatenate([im[:8, :8].reshape(-1, 3), im[-8:, -8:].reshape(-1, 3)]), 0)
mag = bg[1] < 128
d = np.sqrt(((im - bg) ** 2).sum(2)); a = np.clip((d - 70) / 70, 0, 1)
a3 = np.maximum(a, 0.05)[..., None]; rgb = np.clip((im - (1 - a3) * bg) / a3, 0, 255)
prof = (a > 0.5).sum(1); mid = H // 3 + int(np.argmin(prof[H // 3: 2 * H // 3]))  # граница рядов — самая пустая строка
rows = [(0, mid), (mid, H)]
tiles = []
for r in range(2):
    for c in range(4):
        (y0, y1) = rows[r]
        pc = (a[y0:y1] > 0.5).sum(0)  # границы кадров — самые пустые столбцы около четвертей
        cut = lambda k: 0 if k == 0 else W if k == 4 else int(W * k / 4 - W / 10) + int(np.argmin(pc[int(W * k / 4 - W / 10):int(W * k / 4 + W / 10)]))
        x0, x1 = cut(c), cut(c + 1)
        aa = a[y0:y1, x0:x1]; m = aa > 0.5
        lab, n = ndimage.label(ndimage.binary_dilation(m, iterations=4)); sz = ndimage.sum(m, lab, range(1, n + 1))
        keep = ndimage.binary_dilation(np.isin(lab, [i + 1 for i, z in enumerate(sz) if z > 0.02 * sz.max()]) & m, iterations=2)
        aa = aa * keep; ys, xs = np.nonzero(aa > 0.05)
        tiles.append(np.dstack([rgb[y0:y1, x0:x1], aa * 255]).clip(0, 255).astype(np.uint8)[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
tiles = tiles[:4] + tiles[4:7]
Sc = hp / np.median([t.shape[0] for t in tiles[:4]])
out = Image.new('RGBA', (Wc * 7, Hc))
for f, t in enumerate(tiles):
    ti = Image.fromarray(t, 'RGBA'); ti = ti.resize((round(ti.width * Sc), round(ti.height * Sc)), Image.LANCZOS)
    if ti.width > Wc: ti = ti.crop(((ti.width - Wc) // 2, 0, (ti.width - Wc) // 2 + Wc, ti.height))
    if ti.height > Hc - 15: ti = ti.crop((0, ti.height - (Hc - 15), ti.width, ti.height))
    out.alpha_composite(ti, (f * Wc + (Wc - ti.width) // 2, Hc - 15 - ti.height))
q = np.array(out).astype(int)
if mag:  # пурпурный ореол по краям
    R, G, B = q[..., 0], q[..., 1], q[..., 2]; mg = (R > G + 30) & (B > G + 30) & (np.abs(R - B) < 90)
    q[..., 0] = np.where(mg, np.minimum(R, G + 40), R); q[..., 2] = np.where(mg, np.minimum(B, G + 20), B)
else:
    q[..., 1] = np.minimum(q[..., 1], np.maximum(q[..., 0], q[..., 2]))
Image.fromarray(q.astype(np.uint8)).save(f'public/assets/mobs/{name}.png', optimize=True)
al = q[..., 3]; top = min(int(np.nonzero(al[:, f * Wc:(f + 1) * Wc].any(1))[0].min()) for f in range(4))
print(name, out.size, 'body', Hc - top)
