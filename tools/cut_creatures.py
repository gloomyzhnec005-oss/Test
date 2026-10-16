"""Нарезка листа существ: сетка рядов × 7 кадров (4 ходьба + 3 атака), существо смотрит вправо, фон зелёный или пурпурный.
python3 tools/cut_creatures.py лист.png имя1:рост,имя2:рост,... [out_dir] [cols]
Каждый ряд → <out>/<имя>.png: 7 кадров в ряд, ячейка W×H (W = H*1.3), существо внизу по центру, рост — высота в пикселях.
Куски каждого кадра собираются по центру в ячейке сетки (искры, вспышки выстрела остаются у своего кадра)."""
import sys, numpy as np
from PIL import Image
from scipy import ndimage

src, spec = sys.argv[1], [s.split(':') for s in sys.argv[2].split(',')]
out = sys.argv[3] if len(sys.argv) > 3 else 'public/assets/pets'
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 7
rows = len(spec)
im = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
H, W, _ = im.shape
bg = np.median(np.concatenate([im[:6, :6].reshape(-1, 3), im[-6:, -6:].reshape(-1, 3)]), axis=0)
dist = np.sqrt(((im - bg) ** 2).sum(2))
alpha = np.clip((dist - 70) / 70, 0, 1)
fg = alpha > 0.5
# снять подмес фона и кайму
a3 = np.maximum(alpha, 0.05)[..., None]
rgb = np.clip((im - (1 - a3) * bg) / a3, 0, 255)
if bg[1] > max(bg[0], bg[2]): rgb[..., 1] = np.minimum(rgb[..., 1], np.maximum(rgb[..., 0], rgb[..., 2]) + 30)
else:
    ex = np.clip(np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1] - 30, 0, None); rgb[..., 0] -= ex; rgb[..., 2] -= ex
lab, n = ndimage.label(fg)
cells = {}
for i, sl in enumerate(ndimage.find_objects(lab), 1):
    m = lab[sl] == i
    if m.sum() < 25: continue
    ys, xs = np.nonzero(m)
    cy, cx = ys.mean() + sl[0].start, xs.mean() + sl[1].start
    c = (min(rows - 1, int(cy / H * rows)), min(cols - 1, int(cx / W * cols)))
    cells.setdefault(c, []).append(i)
for r, (name, hpx) in enumerate(spec):
    hpx = int(hpx); CH = int(hpx * 1.15) + 4; CW = int(CH * 1.3)
    boxes = []
    for c in range(cols):
        m = np.isin(lab, cells.get((r, c), []))
        ys, xs = np.nonzero(m)
        boxes.append((m, ys.min(), ys.max() + 1, xs.min(), xs.max() + 1) if len(ys) else None)
    # общий масштаб ряда — по медиане высоты кадров ходьбы
    hs = [b[2] - b[1] for b in boxes[:4] if b]
    S = hpx / np.median(hs)
    sheet = Image.new('RGBA', (CW * cols, CH), (0, 0, 0, 0))
    for c, b in enumerate(boxes):
        if not b: continue
        m, y0, y1, x0, x1 = b
        tile = np.dstack([rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1] * m[y0:y1, x0:x1] * 255]).clip(0, 255).astype(np.uint8)
        t = Image.fromarray(tile, 'RGBA')
        w, h = max(1, round(t.width * S)), max(1, round(t.height * S))
        t = t.resize((w, h), Image.LANCZOS)
        # по центру тела (без вспышек справа): центр масс непрозрачных пикселей
        aa = np.array(t)[..., 3] > 100
        cxm = np.nonzero(aa.any(0))[0].mean() if aa.any() else w / 2
        legs = aa[int(h * 0.55):]
        if legs.any(): cxm = np.nonzero(legs.any(0))[0].mean()
        if w > CW or h > CH: t = t.crop((0, max(0, h - CH), min(w, CW), h)); w, h = t.size
        sheet.alpha_composite(t, (c * CW + max(0, min(CW - w, round(CW / 2 - cxm))), CH - 2 - h if h < CH - 2 else 0))
    sheet.save(f'{out}/{name}.png', optimize=True)
    print(name, 'cell', CW, CH, 'scale', round(S, 3))
