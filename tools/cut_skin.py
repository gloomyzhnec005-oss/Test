# Нарезка скина героя из картинки ИИ-генератора.
# Вход: одна картинка — слева сетка 7 рядов × 5 кадров (вниз, вниз-вправо, вправо, вверх-вправо, вверх, вниз-влево, влево),
# справа портрет; фон — нарисованная «шахматка» прозрачности.
# Выход: public/assets/heroes/<id>_sheet.png (8 направлений, 36×48, вверх-влево — зеркало вверх-вправо) и <id>_portrait.png.
# Запуск: pip install pillow numpy scipy
#         python3 tools/cut_skin.py картинка.png <id героя> public/assets/heroes [x границы сетки и портрета, по умолчанию 720]
# Затем добавить героя в public/js/skins.js.
import sys, numpy as np
from PIL import Image
from scipy import ndimage
src, hid, out = sys.argv[1], sys.argv[2], sys.argv[3]
im = np.array(Image.open(src).convert('RGB')).astype(int)
H, W, _ = im.shape
mx, mn = im.max(2), im.min(2)
bgc = (mn > 215) & (mx - mn < 14)          # клетки «шахматки»
# фон = то, что связано с краем через светлые серые пиксели
lab, _ = ndimage.label(bgc)
edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
# + все крупные области шахматки (между спрайтами)
sizes = ndimage.sum(np.ones_like(lab), lab, range(lab.max() + 1))
bg = np.isin(lab, list(edge)) | (sizes[lab] > 400) & bgc
# убираем светлую кайму по краю
ring = ndimage.binary_dilation(bg) & ~bg & (mn > 190) & (mx - mn < 30)
bg |= ring
bg |= (mn > 226) & (mx - mn < 6)                 # чистая светло-серая шахматка внутри силуэта
# у портрета мягкое свечение поверх шахматки: срезаем светлую кайму глубже
near = ndimage.binary_dilation(bg, iterations=3)
halo = near & ~bg & (mn > 190) & (mx - mn < 70)
halo[:, :int(sys.argv[4]) if len(sys.argv) > 4 else 720] = False
bg |= halo
alpha = (~bg).astype(np.uint8) * 255
rgba = np.dstack([im.astype(np.uint8), alpha])
split = int(sys.argv[4]) if len(sys.argv) > 4 else 720
fg = ~bg; fgL = fg.copy(); fgL[:, split:] = False
lab2, n = ndimage.label(ndimage.binary_dilation(fgL, iterations=3))
objs = [(s, i + 1) for i, s in enumerate(ndimage.find_objects(lab2)) if (s[0].stop - s[0].start) * (s[1].stop - s[1].start) > 1500]
objs.sort(key=lambda o: o[0][0].start)
rows = []
for o in objs:
  if rows and abs(rows[-1][0][0][0].start - o[0][0].start) < 40: rows[-1].append(o)
  else: rows.append([o])
rows = [sorted(r, key=lambda o: o[0][1].start) for r in rows]
print('rows', [len(r) for r in rows])
assert len(rows) == 7 and all(len(r) == 5 for r in rows)
S = 0.32; CW, CH = 36, 48
# порядок в исходнике: вниз, вниз-вправо, вправо, вверх-вправо, вверх, вниз-влево, влево
# порядок в игре: down, down-right, right, up-right, up, up-left, left, down-left
order = [0, 1, 2, 3, 4, 'm3', 6, 5]
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
