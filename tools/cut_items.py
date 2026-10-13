"""Нарезка листа предметов/кнопок: объекты на ровном фоне (зелёный #00FF00 или пурпурный #FF00FF), сетка cols × rows.
python3 tools/cut_items.py sheet.png cols rows name1,name2,... [out_dir] [size]
Каждый кусок (после слияния близких частей) относится к ячейке сетки по своему центру — так парные кинжалы,
искры и ореолы попадают к своему предмету. Имя '-' — пропустить ячейку; имя с '!' на конце — убрать цвет фона со всего предмета (сияние, окрашенное фоном)."""
import sys, numpy as np
from PIL import Image
from scipy import ndimage

def main():
    src, cols, rows, names = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4].split(',')
    out = sys.argv[5] if len(sys.argv) > 5 else 'public/assets/items'
    size = int(sys.argv[6]) if len(sys.argv) > 6 else 96
    im = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
    H, W, _ = im.shape
    corners = np.concatenate([im[:8, :8].reshape(-1, 3), im[:8, -8:].reshape(-1, 3), im[-8:, :8].reshape(-1, 3), im[-8:, -8:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    dist = np.sqrt(((im - bg) ** 2).sum(axis=2))
    alpha = np.clip((dist - 60) / 90, 0, 1)            # мягкий край
    fg = alpha > 0.5
    lab, n = ndimage.label(ndimage.binary_dilation(fg, iterations=6))
    raw, _ = ndimage.label(fg)
    cell_of = lambda cy, cx: min(rows - 1, int(cy / H * rows)) * cols + min(cols - 1, int(cx / W * cols))
    # Каждому пикселю предмета — номер ячейки. Близкие куски (искры, парные клинки) идут к ячейке своего общего центра;
    # если в слипшемся куске части лежат в разных ячейках (предметы стоят вплотную) — делим по частям без расширения.
    owner = np.full(lab.shape, -1, np.int32)
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        part = (lab[sl] == i) & fg[sl]
        if part.sum() < 30: continue
        ys, xs = np.nonzero(part)
        c0 = cell_of(ys.mean() + sl[0].start, xs.mean() + sl[1].start)
        sub = raw[sl] * part
        ids = [k for k in np.unique(sub) if k]
        cent = {k: cell_of(*(np.argwhere(sub == k).mean(axis=0) + (sl[0].start, sl[1].start))) for k in ids}
        if len(set(cent.values())) <= 1:
            owner[sl][lab[sl] == i] = c0
            continue
        big = [k for k in ids if (sub == k).sum() > 2000]
        for k in ids:
            m = sub == k
            if (sub == k).sum() > 2000 and len({cent[k]}) == 1:
                ys, xs = np.nonzero(m)
                # огромная часть, накрывающая несколько ячеек — режем по пикселям
                cells = np.array([cell_of(y + sl[0].start, x + sl[1].start) for y, x in zip(ys[::1], xs[::1])])
                vals, cnt = np.unique(cells, return_counts=True)
                if (cnt > 0.15 * cnt.sum()).sum() > 1:
                    o = owner[sl]; o[ys, xs] = cells; owner[sl] = o; continue
            o = owner[sl]; o[m] = cent[k]; owner[sl] = o
    cells = {c: True for c in np.unique(owner) if c >= 0}
    # Убираем ореол цвета фона только у края (внутри предмета свои зелёные/розовые камни не трогаем)
    a3 = np.maximum(alpha, 0.05)[..., None]
    rgb = np.clip((im - (1 - a3) * bg) / a3, 0, 255)  # снимаем подмес фона с полупрозрачных пикселей (сияние, искры)
    edge = ndimage.binary_dilation(~fg, iterations=3)
    if bg[1] > max(bg[0], bg[2]):  # зелёный фон
        lim = np.maximum(rgb[..., 0], rgb[..., 2]) + 8
        rgb[..., 1] = np.where(edge, np.minimum(rgb[..., 1], lim), rgb[..., 1])
    else:                          # пурпурный фон
        ex = np.clip(np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1] - 8, 0, None) * edge
        rgb[..., 0] -= ex; rgb[..., 2] -= ex
    for c in range(cols * rows):
        name = names[c] if c < len(names) else '-'
        if name == '-': continue
        full = name.endswith('!'); name = name.rstrip('!')
        if c not in cells: print('пусто:', name); continue
        m = owner == c
        ys, xs = np.nonzero(m & (alpha > 0.05))
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        a = (alpha * m)[y0:y1, x0:x1]
        part = rgb[y0:y1, x0:x1].copy()
        if full and bg[1] > max(bg[0], bg[2]): part[..., 1] = np.minimum(part[..., 1], np.maximum(part[..., 0], part[..., 2]))
        elif full: ex = np.clip(np.minimum(part[..., 0], part[..., 2]) - part[..., 1], 0, None); part[..., 0] -= ex; part[..., 2] -= ex
        tile = np.dstack([part, a * 255]).clip(0, 255).astype(np.uint8)
        h, w = a.shape; s = int(max(h, w) * 1.08)
        sq = Image.new('RGBA', (s, s), (0, 0, 0, 0)); sq.paste(Image.fromarray(tile, 'RGBA'), ((s - w) // 2, (s - h) // 2))
        sq.resize((size, size), Image.LANCZOS).save(f'{out}/{name}.webp', quality=90, method=6)
        print(name, (int(x0), int(y0), int(x1), int(y1)))

main()
