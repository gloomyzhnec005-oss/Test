"""Нарезка листа существ: сетка рядов × 7 кадров (4 ходьба + 3 атака), существо смотрит вправо, фон зелёный или пурпурный.
python3 tools/cut_creatures.py лист.png имя1:рост[:ширина],имя2:рост,... [out_dir] [cols]  (ширина — во сколько раз ячейка шире высоты, по умолчанию 1.3)
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
# Ряды — по пустым строкам; кадры в ряду — по фигурам слева направо (колонки бывают неровные из-за широких ударов).
prof = np.convolve(fg.sum(1).astype(float), np.ones(9) / 9, mode='same')
nz = np.nonzero(prof > 1)[0]; y0a, y1a = nz.min(), nz.max() + 1; st = (y1a - y0a) / rows
cuts = [y0a] + [int(y0a + st * k - st * 0.3) + int(np.argmin(prof[int(y0a + st * k - st * 0.3):int(y0a + st * k + st * 0.3)])) for k in range(1, rows)] + [y1a]
lab = np.zeros(fg.shape, np.int32)
cells = {}
for r in range(rows):
    band = np.zeros_like(fg); band[cuts[r]:cuts[r + 1]] = fg[cuts[r]:cuts[r + 1]]
    bl, bn = ndimage.label(ndimage.binary_dilation(band, iterations=5))
    sizes = ndimage.sum(band, bl, range(1, bn + 1))
    big = [i + 1 for i, z in enumerate(sizes) if z > 0.12 * sizes.max()]
    objs = ndimage.find_objects(bl)
    cx = {i: (objs[i - 1][1].start + objs[i - 1][1].stop) / 2 for i in range(1, bn + 1)}
    big.sort(key=lambda i: cx[i])
    # мелкие куски (искры, кончик хлыста) — к ближайшей фигуре по x
    owner = {i: min(big, key=lambda j: abs(cx[j] - cx[i])) for i in range(1, bn + 1)}
    # слиплись соседние кадры (хлыст, коса до соседа) — делим самую широкую фигуру по самому пустому столбцу
    nxt = bn + 1
    while len(big) < cols:
        j = max(big, key=lambda i: objs[i - 1][1].stop - objs[i - 1][1].start)
        sl = objs[j - 1]; m = (bl[sl] == j) & band[sl]
        col = np.convolve(m.sum(0).astype(float), np.ones(5) / 5, mode='same'); L = len(col)
        cut = int(L * 0.3) + int(np.argmin(col[int(L * 0.3):int(L * 0.7)]))
        right = np.zeros_like(bl, bool); right[sl][:, cut:] = (bl[sl] == j)[:, cut:]
        bl[right] = nxt; objs.append((sl[0], slice(sl[1].start + cut, sl[1].stop)))
        objs[j - 1] = (sl[0], slice(sl[1].start, sl[1].start + cut))
        cx[j] = (objs[j - 1][1].start + objs[j - 1][1].stop) / 2; cx[nxt] = (objs[nxt - 1][1].start + objs[nxt - 1][1].stop) / 2
        big.append(nxt); owner[nxt] = nxt; bn = nxt; nxt += 1
        big.sort(key=lambda i: cx[i])
    order = big if len(big) <= cols else big[:4] + big[-(cols - 4):]
    for c, j in enumerate(order):
        ids = [i for i in range(1, bn + 1) if owner[i] == j]
        m = np.isin(bl, ids) & band
        lab[m] = r * 100 + c + 1
        cells[(r, c)] = [r * 100 + c + 1]
    print('ряд', r + 1, 'фигур', len(big))
for r, (name, hpx, *wf) in enumerate(spec):
    hpx = int(hpx); CH = int(hpx * 1.15) + 4; CW = int(CH * float(wf[0] if wf else 1.3))
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
