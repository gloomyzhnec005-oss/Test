"""Нарезка листа предметов/кнопок: объекты на ровном фоне (зелёный #00FF00 или пурпурный #FF00FF), сетка cols × rows.
python3 tools/cut_items.py sheet.png cols rows name1,name2,... [out_dir] [size]
Каждый кусок (после слияния близких частей) относится к ячейке сетки по своему центру — так парные кинжалы,
искры и ореолы попадают к своему предмету. Имя '-' — пропустить ячейку; имя с '!' на конце — убрать цвет фона со всего предмета (сияние, окрашенное фоном); с '#' — залить дыры внутри контура исходным цветом (зелёное внутри круглого медальона)."""
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
    gy = np.minimum(rows - 1, (np.arange(H) / H * rows).astype(int))
    gx = np.minimum(cols - 1, (np.arange(W) / W * cols).astype(int))
    grid_cell = gy[:, None] * cols + gx[None, :]
    def spread(m):  # доля пикселей в самой заполненной ячейке
        v = np.bincount(grid_cell[m], minlength=cols * rows)
        return v.max() / max(1, v.sum())
    for i in range(1, n + 1):
        comp = (lab == i) & fg
        if comp.sum() < 30: continue
        ys, xs = np.nonzero(comp)
        c0 = cell_of(ys.mean(), xs.mean())
        sub = raw * comp
        ids = [k for k in np.unique(sub[ys, xs]) if k]
        cents = {k: cell_of(*np.argwhere(sub == k).mean(axis=0)) for k in ids}
        whole = lab == i
        if len(set(cents.values())) <= 1 and spread(comp) > 0.85:
            owner[whole] = c0
            continue
        for k in ids:
            m = sub == k
            if m.sum() > 2000 and spread(m) < 0.85:
                # предметы стоят вплотную и слиплись: ядра — части далеко от линий сетки,
                # остальное растёт от ядер по самому предмету (геодезически), так выступы уходят к своему хозяину
                ys, xs = np.nonzero(m)
                y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
                mm = m[y0:y1, x0:x1]; gc = grid_cell[y0:y1, x0:x1]
                line = np.zeros_like(mm)
                for gyv in range(1, rows): r = int(gyv * H / rows) - y0; line[max(0, r):max(0, r + 1)] = True if 0 <= r < line.shape[0] else line[0:0]
                for gxv in range(1, cols): q = int(gxv * W / cols) - x0; line[:, max(0, q):max(0, q + 1)] = True if 0 <= q < line.shape[1] else line[:, 0:0]
                far = mm & (ndimage.distance_transform_edt(~line) > 40)
                lb = np.where(far, gc, -1)
                st = ndimage.generate_binary_structure(2, 2)
                for _ in range(800):
                    todo = mm & (lb < 0)
                    if not todo.any(): break
                    grown = ndimage.grey_dilation(np.where(lb >= 0, lb + 1, 0), footprint=st) - 1
                    new = todo & (grown >= 0)
                    if not new.any(): lb[todo] = gc[todo]; break
                    lb[new] = grown[new]
                o = owner[y0:y1, x0:x1]; o[mm] = lb[mm]; owner[y0:y1, x0:x1] = o
            else:
                owner[m] = cents[k]
        # расширенная кромка (полупрозрачное сияние) — к ближайшему уже размеченному пикселю
        rest = whole & (owner < 0)
        if rest.any():
            idx = ndimage.distance_transform_edt(owner < 0, return_distances=False, return_indices=True)
            owner[rest] = owner[idx[0][rest], idx[1][rest]]
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
        full = name.endswith('!'); fill = name.endswith('#'); name = name.rstrip('!#')
        if c not in cells: print('пусто:', name); continue
        m = owner == c
        # одиночные искры далеко от предмета (чужие, прилетели из соседней ячейки) — убираем
        pl, pn = ndimage.label(m & fg)
        if pn > 1:
            sz = ndimage.sum(np.ones_like(pl), pl, range(1, pn + 1))
            main = (pl == (np.argmax(sz) + 1))
            near = ndimage.binary_dilation(main, iterations=25)
            for j, z in enumerate(sz, 1):
                pj = pl == j
                if z < 0.01 * sz.max() and not (pj & near).any(): m &= ~ndimage.binary_dilation(pj, iterations=6)
        ys, xs = np.nonzero(m & (alpha > 0.05))
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        a = (alpha * m)[y0:y1, x0:x1]
        part = rgb[y0:y1, x0:x1].copy()
        if fill:  # круглый медальон: всё внутри контура — непрозрачное, с исходным цветом (зелёное пламя/фон внутри)
            inside = ndimage.binary_fill_holes(ndimage.binary_closing(a > 0.5, iterations=4))
            hole = inside & (a < 0.98)
            part[hole] = im[y0:y1, x0:x1][hole] * 0.8
            a = np.where(inside, 1.0, a)
        if full and bg[1] > max(bg[0], bg[2]): part[..., 1] = np.minimum(part[..., 1], np.maximum(part[..., 0], part[..., 2]))
        elif full: ex = np.clip(np.minimum(part[..., 0], part[..., 2]) - part[..., 1], 0, None); part[..., 0] -= ex; part[..., 2] -= ex
        tile = np.dstack([part, a * 255]).clip(0, 255).astype(np.uint8)
        h, w = a.shape; s = int(max(h, w) * 1.08)
        sq = Image.new('RGBA', (s, s), (0, 0, 0, 0)); sq.paste(Image.fromarray(tile, 'RGBA'), ((s - w) // 2, (s - h) // 2))
        sq.resize((size, size), Image.LANCZOS).save(f'{out}/{name}.webp', quality=90, method=6)
        print(name, (int(x0), int(y0), int(x1), int(y1)))

main()
