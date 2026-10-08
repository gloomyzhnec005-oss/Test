# Нарезка листа атаки и эффектов героя из картинки ИИ-генератора.
# Вход: одна картинка на чёрном (или зелёном) фоне — слева сетка героя R рядов × 5 кадров
# (ряды 1–5 — атака по направлениям, дальше — доп. атаки, последний ряд — поза умения),
# справа сетка эффектов N рядов × K кадров (K определяется сам, обычно 5–6).
# Выход: public/assets/heroes/<id>_attack.png (R × 5 кадров) и <id>_fx.png (N × K кадров) с прозрачностью.
# Число рядов и кадров печатается в конце — их нужно вписать в public/js/skins.js.
# Масштаб героя подгоняется под его лист ходьбы <id>_sheet.png, чтобы рост совпадал.
# Запуск: python3 tools/cut_fx.py картинка.png <id героя> public/assets/heroes [x границы героя и эффектов, 0 — только эффекты] [кадров в ряду эффектов]
import sys, numpy as np
from PIL import Image
from scipy import ndimage

src, hid, out = sys.argv[1], sys.argv[2], sys.argv[3]
im = np.array(Image.open(src).convert('RGB')).astype(int)
H, W, _ = im.shape
mx = im.max(2)
corner = im[:8, :8].reshape(-1, 3).mean(0)
green = corner[1] > 150 and corner[1] - max(corner[0], corner[2]) > 80


def bands(p, th=2, min_len=20):
    res, s = [], None
    for i, v in enumerate(list(p) + [0]):
        if v > th and s is None: s = i
        if v <= th and s is not None:
            if i - s > min_len: res.append((s, i))
            s = None
    return res


# Граница героя и эффектов: самый широкий пустой столбец около середины
if len(sys.argv) > 4: split = int(sys.argv[4])
else:
    cols = (mx > 30).sum(0)
    mid = range(W // 3, W * 2 // 3)
    split = max(mid, key=lambda x: (cols[x] == 0, -abs(x - W // 2)))

# Разделительные линии между частями картинки (сплошные столбцы) убираем
def is_bg(px):
    if green:
        return (px[..., 1] > 120) & (px[..., 1] - np.maximum(px[..., 0], px[..., 2]) > 60)
    return px.max(2) <= 24
divider = (~is_bg(im)).mean(0) > 0.85
im[:, divider] = [0, 255, 0] if green else [0, 0, 0]
mx = im.max(2)

if split > 0:  # split = 0 — на картинке только эффекты
    # ---------- Герой ----------
    if green:
        spill = im[..., 1] - np.maximum(im[..., 0], im[..., 2])
        bg = (im[..., 1] > 120) & (spill > 60)
        bg |= ndimage.binary_dilation(bg, iterations=2) & (spill > 20)       # зелёная кайма
        fix = ndimage.binary_dilation(bg, iterations=3) & ~bg & (spill > 0)
        im[..., 1] = np.where(fix, np.maximum(im[..., 0], im[..., 2]), im[..., 1])
    else:
        # Чёрный фон: тёмные пиксели, связанные с пустым пространством вокруг кадров
        dark = mx <= 24
        lab, _ = ndimage.label(dark)
        sizes = ndimage.sum(np.ones_like(lab), lab, range(lab.max() + 1))
        bg = dark & (sizes[lab] > 3000)
    hero = ~bg
    hero[:, split:] = False
    rows = bands((hero & (mx > 30)).sum(1))
    assert len(rows) >= 6, f'ожидалось не меньше 6 рядов героя, найдено {len(rows)}'
    cells = []
    for (y0, y1) in rows:
        cs = bands((hero[y0:y1] & (mx[y0:y1] > 30)).sum(0), th=1, min_len=15)
        # слипшиеся соседние кадры делим поровну
        while len(cs) < 5:
            i = max(range(len(cs)), key=lambda k: cs[k][1] - cs[k][0])
            a, b = cs[i]; m = (a + b) // 2
            cs[i:i + 1] = [(a, m), (m, b)]
        cells.append([(y0, y1, x0, x1) for (x0, x1) in cs[:5]])

    # Масштаб: рост в позе умения (ряд 6) = рост в листе ходьбы
    try:
        walk = np.array(Image.open(f'{out}/{hid}_sheet.png'))[..., 3] > 0
        wh = np.median([np.ptp(np.nonzero(walk[r * 48:(r + 1) * 48, 0:36].any(1))[0]) + 1 for r in range(8)])
    except FileNotFoundError:
        wh = 45
    ch = np.median([y1 - y0 for (y0, y1, _, _) in cells[-1]])
    S = wh / ch
    CW, CH = 72, 60
    sheet = Image.new('RGBA', (CW * 5, CH * len(cells)), (0, 0, 0, 0))
    rgba = np.dstack([im.astype(np.uint8), (hero * 255).astype(np.uint8)])
    for r, row in enumerate(cells):
        base = max(c[1] for c in row)
        for f, (y0, y1, x0, x1) in enumerate(row):
            crop = rgba[y0:base, x0:x1].copy()
            a = crop[..., 3] > 0
            legs = a[int(a.shape[0] * 0.6):]                 # центр по ногам: посох не сдвигает героя
            cx = np.nonzero(legs.any(0))[0].mean() if legs.any() else crop.shape[1] / 2
            img = Image.fromarray(crop)
            w, h = max(1, round(img.width * S)), max(1, round(img.height * S))
            img = img.resize((w, h), Image.LANCZOS)
            arr = np.array(img); arr[..., 3] = np.where(arr[..., 3] > 110, 255, 0); img = Image.fromarray(arr)
            sheet.paste(img, (f * CW + round(CW / 2 - cx * S), r * CH + CH - 1 - h), img)
    sheet.save(f'{out}/{hid}_attack.png')


# ---------- Эффекты ----------
fx = np.where(is_bg(im), 0, mx); fx[:, :split] = 0
frows = bands((fx > 30).sum(1))
FS = 72
# число кадров в ряду эффектов — по первому ряду (след удара: отдельные пятна)
r0 = bands((fx > 30).sum(1))[0]
N = len(bands((fx[r0[0]:r0[1]] > 30).sum(0), th=1, min_len=15)) or 6
N = int(sys.argv[5]) if len(sys.argv) > 5 else N if 4 <= N <= 8 else 6
fsheet = Image.new('RGBA', (FS * N, FS * len(frows)), (0, 0, 0, 0))
ys, xs = np.nonzero(fx > 30)
fx0, fx1 = xs.min(), xs.max() + 1
step = (fx1 - fx0) / N
for r, (y0, y1) in enumerate(frows):
    # границы кадров: самые пустые столбцы около ожидаемых мест (кадры стоят неровно)
    prof = np.convolve(fx[y0:y1].sum(0).astype(float), np.ones(9) / 9, mode='same')
    cuts = [fx0]
    for k in range(1, N):
        b = int(fx0 + step * k); lo, hi = int(b - step * 0.35), int(b + step * 0.35)
        cuts.append(lo + int(np.argmin(prof[lo:hi])))
    cuts.append(fx1)
    for f in range(N):
        # ячейка ровно по своему кадру (без соседей), затем вписываем в квадрат
        box = [cuts[f], int(y0 - 2), cuts[f + 1], int(min(H, y1 + 2))]
        part = im[box[1]:box[3], max(box[0], split):box[2]].astype(float)
        if green:
            # хромакей: прозрачность по «зелёности», зелёную кайму убираем
            sp = part[..., 1] - np.maximum(part[..., 0], part[..., 2])
            a = np.clip(1 - (sp - 15) / 70, 0, 1) * 255
            part[..., 1] = np.where(sp > 0, np.maximum(part[..., 0], part[..., 2]), part[..., 1])
        else:
            # чёрный фон: альфа по яркости, цвет восстанавливаем
            a = part.max(2)
            part = np.where(a[..., None] > 0, part * 255 / np.maximum(a[..., None], 1), 0)
        a = np.where(a < 14, 0, a)
        side = max(part.shape[0], part.shape[1])
        rgb = np.zeros((side, side, 3)); alpha = np.zeros((side, side))
        oy, ox = (side - part.shape[0]) // 2, (side - part.shape[1]) // 2
        rgb[oy:oy + part.shape[0], ox:ox + part.shape[1]] = part
        alpha[oy:oy + part.shape[0], ox:ox + part.shape[1]] = a
        cell = Image.fromarray(np.dstack([rgb, alpha]).clip(0, 255).astype(np.uint8)).resize((FS, FS), Image.LANCZOS)
        fsheet.paste(cell, (f * FS, r * FS), cell)
fsheet.save(f'{out}/{hid}_fx.png')
print('split', split, 'hero rows', len(cells) if split > 0 else 0, 'fx rows', len(frows), 'fx frames', N)
