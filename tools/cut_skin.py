# Нарезка скина героя из картинки ИИ-генератора.
# Вход: одна картинка — слева сетка 7 рядов × 5 кадров (вниз, вниз-вправо, вправо, вверх-вправо, вверх, вниз-влево, влево),
# справа портрет; фон — сплошной зелёный (хромакей) или нарисованная «шахматка» прозрачности.
# Выход: public/assets/heroes/<id>_sheet.png (8 направлений, 36×48, вверх-влево — зеркало вверх-вправо) и <id>_portrait.png.
# Запуск: pip install pillow numpy scipy
#         python3 tools/cut_skin.py картинка.png <id героя> public/assets/heroes [x границы сетки и портрета, по умолчанию 720]
# Если кадры слиплись (пламя, крылья) — GRID=7 режет сеткой рядов × 5 кадров. SCALE=0.28 — для широких героев.
# Затем добавить героя в public/js/skins.js.
import os, sys, numpy as np
from PIL import Image
from scipy import ndimage
src, hid, out = sys.argv[1], sys.argv[2], sys.argv[3]
im = np.array(Image.open(src).convert('RGB')).astype(int)
H, W, _ = im.shape
mx, mn = im.max(2), im.min(2)
split = int(sys.argv[4]) if len(sys.argv) > 4 else 720
r_, g_, b_ = im[..., 0], im[..., 1], im[..., 2]
corner = im[:8, :8].reshape(-1, 3).mean(0)
if corner[1] > 150 and corner[1] - max(corner[0], corner[2]) > 80:
  # хромакей: сплошной зелёный фон
  spill = g_ - np.maximum(r_, b_)
  # фон — по расстоянию до его цвета: зелёные герои (феи, орки) не вырезаются вместе с фоном
  dist = np.sqrt(((im - corner) ** 2).sum(2))
  bg = dist < 60
  edge = ndimage.binary_dilation(bg, iterations=2) & ~bg
  bg |= edge & (dist < 110) & (spill > 60)         # зелёная кайма по краю
  # остаток зелени на краях приглушаем до уровня красного/синего
  fix = ndimage.binary_dilation(bg, iterations=3) & ~bg & (spill > 0)
  im[..., 1] = np.where(fix, np.maximum(r_, b_), g_)
  if os.environ.get('DESPILL'):  # огненные/жёлтые герои: салатовый ореол по всему краю — зелёный не выше красного/синего
    im[..., 1] = np.minimum(im[..., 1], np.maximum(im[..., 0], im[..., 2]))
else:
  # нарисованная «шахматка» прозрачности
  bgc = (mn > 215) & (mx - mn < 14)
  lab, _ = ndimage.label(bgc)
  edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
  sizes = ndimage.sum(np.ones_like(lab), lab, range(lab.max() + 1))
  bg = np.isin(lab, list(edge)) | (sizes[lab] > 400) & bgc
  bg |= ndimage.binary_dilation(bg) & ~bg & (mn > 190) & (mx - mn < 30)  # светлая кайма
  bg |= (mn > 226) & (mx - mn < 6)                 # шахматка внутри силуэта
  # у портрета мягкое свечение поверх шахматки: срезаем светлую кайму глубже
  halo = ndimage.binary_dilation(bg, iterations=3) & ~bg & (mn > 190) & (mx - mn < 70)
  halo[:, :split] = False
  bg |= halo
alpha = (~bg).astype(np.uint8) * 255
rgba = np.dstack([im.astype(np.uint8), alpha])
fg = ~bg; fgL = fg.copy(); fgL[:, split:] = False
lab2, n = ndimage.label(ndimage.binary_dilation(fgL, iterations=3))
objs = [(s, i + 1) for i, s in enumerate(ndimage.find_objects(lab2)) if (s[0].stop - s[0].start) * (s[1].stop - s[1].start) > 1500]
# ряды — по низу кадра (ноги стоят на одной линии; верх бывает выше из-за рогов и клинков)
objs.sort(key=lambda o: o[0][0].stop)
rows = []
for o in objs:
  if rows and abs(rows[-1][0][0][0].stop - o[0][0].stop) < 40: rows[-1].append(o)
  else: rows.append([o])
rows = [sorted(r, key=lambda o: o[0][1].start) for r in rows]
# лишний кусок в ряду (оторвавшийся клинок) — к соседнему кадру, с которым он ближе всего по x
for r in rows:
  while len(r) > 5:
    sm = min(r, key=lambda o: (o[0][0].stop - o[0][0].start) * (o[0][1].stop - o[0][1].start))
    r.remove(sm)
    cx = (sm[0][1].start + sm[0][1].stop) / 2
    j = min(range(len(r)), key=lambda k: min(abs(r[k][0][1].start - cx), abs(r[k][0][1].stop - cx)))
    h = r[j]; lab2[lab2 == sm[1]] = h[1]
    r[j] = ((slice(min(sm[0][0].start, h[0][0].start), max(sm[0][0].stop, h[0][0].stop)), slice(min(sm[0][1].start, h[0][1].start), max(sm[0][1].stop, h[0][1].stop))), h[1])
import os
if os.environ.get('GRID') and not (len(rows) in (6, 7) and all(len(r) == 5 for r in rows)):
  # кадры слиплись (огонь, крылья): режем сеткой GRID рядов × 5 по самым пустым линиям
  nR = int(os.environ['GRID'])
  def cuts(prof, n):
    prof = np.convolve(prof.astype(float), np.ones(9) / 9, mode='same')
    nz = np.nonzero(prof > 0.5)[0]; a0, a1 = nz.min(), nz.max() + 1; st = (a1 - a0) / n
    c = [a0] + [int(a0 + st * k - st * 0.3) + int(np.argmin(prof[int(a0 + st * k - st * 0.3):int(a0 + st * k + st * 0.3)])) for k in range(1, n)] + [a1]
    return list(zip(c[:-1], c[1:]))
  lab2 = np.zeros(fgL.shape, int); rows = []; li = 0
  for (y0, y1) in cuts(fgL.sum(1), nR):
    row = []
    for (x0, x1) in cuts(fgL[y0:y1].sum(0), 5):
      li += 1
      cell = fgL[y0:y1, x0:x1]
      # в ячейке оставляем самый крупный кусок и всё, что рядом с ним (искры пламени)
      cl, cn = ndimage.label(ndimage.binary_dilation(cell, iterations=2))
      if cn:
        big = np.argmax(ndimage.sum(cell, cl, range(1, cn + 1))) + 1
        keep = ndimage.binary_dilation(cl == big, iterations=6) & cell
      else: keep = cell
      lab2[y0:y1, x0:x1][keep] = li
      ys, xs = np.nonzero(keep)
      row.append(((slice(y0 + ys.min(), y0 + ys.max() + 1), slice(x0 + xs.min(), x0 + xs.max() + 1)), li))
    rows.append(row)
print('rows', [len(r) for r in rows])
assert len(rows) in (6, 7) and all(len(r) == 5 for r in rows)
import os
S = float(os.environ.get("SCALE", 0.32)); CW, CH = 36, 48  # SCALE — для широких героев (големы), чтобы кадр влез в 36 px
# порядок в исходнике: вниз, вниз-вправо, вправо, вверх-вправо, вверх, вниз-влево, влево
# порядок в игре: down, down-right, right, up-right, up, up-left, left, down-left
order = [0, 1, 2, 3, 4, 'm3', 6, 5] if len(rows) == 7 else [0, 1, 2, 3, 4, 'm3', 'm2', 5]  # 6 рядов: «влево» — зеркало «вправо»
sheet = Image.new('RGBA', (CW * 5, CH * 8), (0, 0, 0, 0))
for oy, k in enumerate(order):
  mirror = isinstance(k, str); r = rows[int(k[1:]) if mirror else k]
  base = max(o[0][0].stop for o in r)
  for fx, (s, li) in enumerate(r):
    y0, x0 = s[0].start, s[1].start
    crop = rgba[y0:base, x0:s[1].stop].copy()
    m = lab2[y0:base, x0:s[1].stop] == li
    crop[..., 3] = crop[..., 3] * m
    a = crop[..., 3] > 0
    top = a[: max(1, a.shape[0] * 2 // 5)]                       # центр по голове/торсу
    cx = np.nonzero(top.any(0))[0].mean() if top.any() else crop.shape[1] / 2
    img = Image.fromarray(crop)
    if mirror: img = img.transpose(Image.FLIP_LEFT_RIGHT); cx = crop.shape[1] - 1 - cx
    w, h = max(1, round(img.width * S)), max(1, round(img.height * S))
    img = img.resize((w, h), Image.LANCZOS)
    arr = np.array(img); arr[..., 3] = np.where(arr[..., 3] > 110, 255, 0); img = Image.fromarray(arr)
    sheet.paste(img, (fx * CW + round(CW / 2 - cx * S), oy * CH + CH - 1 - h), img)
sheet.save(f'{out}/{hid}_sheet.png')
# портрет
fgR = fg.copy(); fgR[:, :split] = False
ys, xs = np.nonzero(fgR)
p = Image.fromarray(rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
if p.height > 600: p = p.resize((round(p.width * 600 / p.height), 600), Image.LANCZOS)
p.save(f'{out}/{hid}_portrait.png')
print(sheet.size, p.size)
