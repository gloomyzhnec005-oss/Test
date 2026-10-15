"""Пересобрать один ряд листа атаки по связным кускам (когда выпад оружием слипся с соседним кадром).
python3 tools/recut_row.py картинка_героя.png <id> <ряд в картинке, с 0> <ряд в листе> [кадры, напр. 0,1,2,3,5] [рядов в картинке]
Масштаб берётся из уже нарезанного листа <id>_attack.png (по высоте кадра того же ряда)."""
import sys, numpy as np
from PIL import Image
from scipy import ndimage
src, hid, sr, dr = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
pick = [int(x) for x in sys.argv[5].split(',')] if len(sys.argv) > 5 else None
nrows = int(sys.argv[6]) if len(sys.argv) > 6 else 6
im = np.asarray(Image.open(src).convert('RGB')).astype(np.uint8); a = im.astype(int)
fg = ~((a[..., 1] > 120) & (a[..., 1] - np.maximum(a[..., 0], a[..., 2]) > 60))
lab, _ = ndimage.label(fg)
objs = [(i + 1, o) for i, o in enumerate(ndimage.find_objects(lab)) if o and (o[0].stop - o[0].start) * (o[1].stop - o[1].start) > 1500]
H0 = im.shape[0] / nrows
row = sorted([t for t in objs if int(((t[1][0].start + t[1][0].stop) / 2) // H0) == sr], key=lambda t: t[1][1].start)
if pick: row = [row[k] for k in pick if k < len(row)]
row = row[:5]
p = f'public/assets/heroes/{hid}_attack.png'; sh = Image.open(p).convert('RGBA'); W, H = 72, 60
old = np.array(sh)[dr * H:(dr + 1) * H, 0:W, 3] > 0
S = (np.ptp(np.nonzero(old.any(1))[0]) + 1) / (row[0][1][0].stop - row[0][1][0].start)
base = max(o[0].stop for _, o in row)
sh.paste(Image.new('RGBA', (W * 5, H), (0, 0, 0, 0)), (0, dr * H))
for f, (li, o) in enumerate(row):
    y0, x0, x1 = o[0].start, o[1].start, o[1].stop
    crop = np.dstack([im[y0:base, x0:x1], ((lab[y0:base, x0:x1] == li) * 255).astype(np.uint8)])
    legs = crop[..., 3][int(crop.shape[0] * .6):] > 0
    cx = np.nonzero(legs.any(0))[0].mean() if legs.any() else crop.shape[1] / 2
    img = Image.fromarray(crop); w, h = max(1, round(img.width * S)), max(1, round(img.height * S))
    img = img.resize((w, h), Image.LANCZOS)
    arr = np.array(img); arr[..., 3] = np.where(arr[..., 3] > 110, 255, 0); img = Image.fromarray(arr)
    sh.paste(img, (f * W + max(0, min(W - w, round(W / 2 - cx * S))), dr * H + H - 1 - h), img)
sh.save(p)
print('кадров', len(row), 'масштаб', round(S, 3))
