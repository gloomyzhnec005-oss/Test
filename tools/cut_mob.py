# Нарезка кадров монстра из картинки ИИ-генератора (зелёный фон, кадры в ряд, монстр смотрит вправо).
# Кадры берутся слева направо (затем сверху вниз), выравниваются по ногам и масштабируются до роста H.
# Выход: public/assets/mobs/<id>.png — лист кадров в один ряд, ячейки W×H.
# Запуск: python3 tools/cut_mob.py картинка.png <id монстра> [рост в пикселях игры, по умолчанию 42]
# Затем впишите монстра в MOB_SKINS (public/js/skins.js): какие кадры — ходьба, какие — удар.
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage

src, mid = sys.argv[1], sys.argv[2]
H = int(sys.argv[3]) if len(sys.argv) > 3 else 42
out = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'mobs')
os.makedirs(out, exist_ok=True)
im = np.array(Image.open(src).convert('RGB')).astype(int)
r, g, b = im[..., 0], im[..., 1], im[..., 2]
# Фон — по расстоянию до цвета фона (угол картинки): зелёные монстры (гоблины, орки) не вырезаются вместе с фоном
key = np.median(im[:10, :10].reshape(-1, 3), axis=0)
dist = np.sqrt(((im - key) ** 2).sum(2))
bg = dist < 38
bg |= ndimage.binary_dilation(bg, iterations=1) & (dist < 50)      # мягкая кайма (кожа орков ≈60 от фона)

lab, _ = ndimage.label(ndimage.binary_dilation(~bg, iterations=3))
objs = [(s, i + 1) for i, s in enumerate(ndimage.find_objects(lab)) if s and (s[0].stop - s[0].start) > 40]
# ряды кадров, в ряду — слева направо
objs.sort(key=lambda o: o[0][0].stop)
rows = []
for o in objs:
    if rows and abs(rows[-1][0][0][0].stop - o[0][0].stop) < 80: rows[-1].append(o)
    else: rows.append([o])
frames = [o for row in rows for o in sorted(row, key=lambda o: o[0][1].start)]
rgba = np.dstack([im.clip(0, 255).astype(np.uint8), ((~bg) * 255).astype(np.uint8)])
base = max(s[0].stop for s, _ in frames)
# рост — по медиане кадров: высокий кадр замаха (оружие над головой) не уменьшает монстра
tall = float(np.median([s[0].stop - s[0].start for s, _ in frames]))
S = H / tall
crops = []
for s, i in frames:
    c = rgba[s].copy()
    c[..., 3] = np.where(lab[s] == i, c[..., 3], 0)
    a = c[..., 3] > 0
    feet = a[int(a.shape[0] * 0.8):]
    cx = np.nonzero(feet.any(0))[0].mean() if feet.any() else c.shape[1] / 2
    img = Image.fromarray(c)
    img = img.resize((max(1, round(img.width * S)), max(1, round(img.height * S))), Image.LANCZOS)
    arr = np.array(img); arr[..., 3] = np.where(arr[..., 3] > 110, 255, 0)
    crops.append((Image.fromarray(arr), cx * S, s[0].stop))
W = int(max(2 * max(cx, im_.width - cx) for im_, cx, _ in crops)) + 2
HH = max(H, max(im_.height for im_, _, _ in crops))
sheet = Image.new('RGBA', (W * len(crops), HH + 2), (0, 0, 0, 0))
for k, (img, cx, bottom) in enumerate(crops):
    sheet.paste(img, (k * W + round(W / 2 - cx), HH + 1 - img.height), img)
sheet.save(os.path.join(out, f'{mid}.png'))
print(f'{mid}: кадров {len(crops)}, ячейка {W}×{HH + 2}')
