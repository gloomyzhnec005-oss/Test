# Вырезка объектов с пурпурного фона (#FF00FF) — по цвету, включая дыры внутри колец.
# python3 keycut.py sheet.png cols name1,name2,... outdir [size] [fill]
import sys, numpy as np
from PIL import Image
from scipy import ndimage

src, cols, names, out = sys.argv[1], int(sys.argv[2]), sys.argv[3].split(','), sys.argv[4]
size = int(sys.argv[5]) if len(sys.argv) > 5 else 128
fill = float(sys.argv[6]) if len(sys.argv) > 6 else 0.92  # доля кадра, которую занимает объект
im = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
r, g, b = im[..., 0], im[..., 1], im[..., 2]
# «Пурпурность»: много красного и синего, мало зелёного, красный≈синий
mag = np.clip(((np.minimum(r, b) - g) - 60) / 90, 0, 1) * np.clip(1 - np.abs(r - b) / 120, 0, 1)
alpha = 1 - mag
# Подавляем пурпурный отсвет на краях: убираем избыток красного и синего относительно зелёного
spill = np.clip(np.minimum(r, b) - np.maximum(g, 0) - 40, 0, None) * (mag > 0.05)
rgb = im.copy()
rgb[..., 0] -= spill * 0.6 * (1 - alpha)
rgb[..., 2] -= spill * 0.6 * (1 - alpha)
rgb = np.clip(rgb, 0, 255)
rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
solid = alpha > 0.5
# Колонки: по проекции непрозрачных пикселей
lab, n = ndimage.label(ndimage.binary_dilation(solid, iterations=6))
objs = ndimage.find_objects(lab)
sizes = ndimage.sum(solid, lab, range(1, n + 1))
big = sorted([(sizes[i], objs[i]) for i in range(n)], key=lambda t: -t[0])[:cols]
big = sorted(big, key=lambda t: t[1][1].start)
H, W = solid.shape
for (s, sl), name in zip(big, names):
    # собираем всё, что попадает в колонку объекта (искры, дым)
    x0, x1 = sl[1].start, sl[1].stop
    cx0 = max(0, x0 - 20); cx1 = min(W, x1 + 20)
    sub = rgba[:, cx0:cx1]
    ys, xs = np.nonzero(sub[..., 3] > 20)
    y0, y1, a0, a1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    crop = Image.fromarray(sub[y0:y1, a0:a1], 'RGBA')
    side = max(crop.size)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(crop, ((side - crop.size[0]) // 2, (side - crop.size[1]) // 2))
    inner = int(size * fill)
    sq = sq.resize((inner, inner), Image.LANCZOS)
    outim = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    outim.paste(sq, ((size - inner) // 2, (size - inner) // 2))
    outim.save(f'{out}/{name}.webp', 'WEBP', quality=92)
    print(name, crop.size)
