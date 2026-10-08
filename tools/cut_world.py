# Нарезка графики мира (тайлы, объекты, здания, порталы) из картинки ИИ-генератора на розовом фоне (#FF00FF).
# Картинка содержит блоки: тайлы земли 4×3, объекты 4×3, здания (3 блока по 4), порталы 3×2.
# Области блоков задаются в REGIONS (x0, y0, x1, y1 в пикселях исходника) — для новой картинки поправьте их.
# Выход: public/assets/world/<theme>/tiles.png (16 тайлов 32×32), buildings/<место>.png, objects/<имя>.png, portals/<имя>.png
# Запуск: python3 tools/cut_world.py картинка.png green public/assets/world
import sys, os, json, numpy as np
from PIL import Image
from scipy import ndimage

src, theme, out = sys.argv[1], sys.argv[2], sys.argv[3]
REGIONS = json.loads(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4].startswith('{') else {
    'tiles': [0, 40, 480, 470], 'objects': [480, 30, 1000, 510], 'b1': [1000, 0, 1470, 510],
    'b2': [0, 540, 380, 1000], 'b3': [380, 540, 725, 1000], 'portals': [725, 540, 1140, 1000], 'lobby': [1140, 560, 1470, 1000],
}
im = np.array(Image.open(src).convert('RGB')).astype(int)
r, g, b = im[..., 0], im[..., 1], im[..., 2]
key = np.minimum(r, b) - g                         # «розовость»
bg = key > 120
bg |= ndimage.binary_dilation(bg, iterations=1) & (key > 40)   # розовая кайма
fix = ndimage.binary_dilation(bg, iterations=2) & ~bg & (key > 0)
im[..., 0] = np.where(fix, np.minimum(r, g + 40), r)            # убираем розовый оттенок по краям
im[..., 2] = np.where(fix, np.minimum(b, g + 40), b)
rgba = np.dstack([im.clip(0, 255).astype(np.uint8), ((~bg) * 255).astype(np.uint8)])
lab, _ = ndimage.label(ndimage.binary_dilation(~bg, iterations=2))
objs = [(s, i + 1) for i, s in enumerate(ndimage.find_objects(lab)) if s and (s[0].stop - s[0].start) > 40 and (s[1].stop - s[1].start) > 40]


def items(region):
    x0, y0, x1, y1 = region
    found = [(s, i) for s, i in objs if x0 <= s[1].start < x1 and y0 <= s[0].start < y1]
    found.sort(key=lambda o: o[0][0].start)
    rows = []
    for o in found:                                   # ряды: близкие по высоте
        if rows and o[0][0].start - rows[-1][0][0][0].start < 60: rows[-1].append(o)
        else: rows.append([o])
    res = []
    for row in rows: res += sorted(row, key=lambda o: o[0][1].start)
    return [Image.fromarray(np.where((lab[s] == i)[..., None], rgba[s], 0).astype(np.uint8)) for s, i in res]


def fit(img, w):
    h = round(img.height * w / img.width)
    img = img.resize((w, h), Image.LANCZOS)
    a = np.array(img); a[..., 3] = np.where(a[..., 3] > 110, 255, 0)
    return Image.fromarray(a)


base = f'{out}/{theme}'
for d in ['buildings', 'objects', 'portals']: os.makedirs(f'{base}/{d}', exist_ok=True)

# ---------- Тайлы: 12 квадратов → 16 тайлов игры ----------
T = items(REGIONS['tiles'])
assert len(T) == 12, f'тайлов {len(T)}, нужно 12'
def tile(img, part=None):
    # part = (x, y, размер) в долях квадрата: берём однородный кусок, если на тайле есть рисунок (полоса дороги, круг площади)
    a = np.array(img); w, h = img.width, img.height; s = min(w, h) - 8
    c = a[(h - s) // 2:(h - s) // 2 + s, (w - s) // 2:(w - s) // 2 + s].copy()
    hole = c[..., 3] < 128                                   # прозрачные дыры (фон внутри тайла) — средним цветом
    if hole.any(): c[hole, :3] = np.median(c[~hole, :3], axis=0)
    sq = Image.fromarray(c).convert('RGB')
    if part: fx, fy, fs = part; sq = sq.crop((int(fx * s), int(fy * s), int((fx + fs) * s), int((fy + fs) * s)))
    return sq.resize((32, 32), Image.LANCZOS)
PART = {5: (0.36, 0.36, 0.28), 7: (0.04, 0.04, 0.3)}   # дорога — середина полосы, площадь — угол без круга
if theme != 'green': PART = {7: (0.04, 0.04, 0.3)}       # в других мирах дорога — ровные плиты целиком
# порядок игры: 0 трава, 1 вода, 2 под деревом, 3 дорога, 4 цветы, 5 земля, 6 скала, 7 под зданием, 8 площадь, 9 туман,
# 10 трава-2, 11 мох, 12 стена руин, 13 пол данжа, 14 стена данжа, 15 трава
ORDER = [0, 4, 0, 5, 2, 6, 8, 6, 7, None, 1, 3, 9, 10, 11, 0]
if theme == 'abyss': ORDER[8] = 5
if theme == 'sky': ORDER[8], ORDER[11] = 3, 7      # мрамор площади стоит в первом ряду   # площадь с рунами слишком пёстрая при повторе — берём плиты дороги
sheet = Image.new('RGB', (32 * 16, 32), (0, 0, 0))
for i, k in enumerate(ORDER):
    if k is not None: sheet.paste(tile(T[k], PART.get(k)), (i * 32, 0))
sheet.save(f'{base}/tiles.png')

# ---------- Объекты ----------
# Имена объектов по порядку в блоке; игра использует tree/goldTree/bush (деревья), lantern (у телепорта), dragonStatue (у врат босса)
OBJ = {
    'green': ['tree', 'goldTree', 'bush', 'stump', 'boulder', 'crystal', 'dragonStatue', 'lantern', 'fence', 'well', 'crates', 'flowers'],
    'abyss': ['tree', 'goldTree', 'bush', 'crystal', 'boulder', 'lantern', 'banner', 'chainPost', 'cage', 'bones', 'dragonStatue', 'cauldron'],
    'sky': ['tree', 'goldTree', 'bush', 'crystal', 'boulder', 'dragonStatue', 'nest', 'lantern', 'fountain', 'column', 'harp', 'floatStone'],
}.get(theme, ['tree', 'goldTree', 'bush', 'stump', 'boulder', 'crystal', 'dragonStatue', 'lantern', 'fence', 'well', 'crates', 'flowers'])
O = items(REGIONS['objects'])
assert len(O) == 12, f'объектов {len(O)}, нужно 12'
WIDTH = {'nest': 44, 'fountain': 46, 'column': 30, 'harp': 30, 'floatStone': 30, 'banner': 30, 'chainPost': 30, 'cage': 32, 'bones': 40, 'cauldron': 36, 'tree': 64, 'goldTree': 60, 'bush': 40, 'stump': 30, 'boulder': 40, 'crystal': 34, 'dragonStatue': 48, 'lantern': 22, 'fence': 44, 'well': 40, 'crates': 44, 'flowers': 36}
for n, img in zip(OBJ, O): fit(img, WIDTH[n]).save(f'{base}/objects/{n}.png')

# ---------- Здания ----------
PLACES = ['warehouse', 'equip', 'alchemy', 'smith', 'auction', 'market', 'runes', 'trainer', 'gacha', 'events', 'arena', 'survival']
B = items(REGIONS['b1']) + items(REGIONS['b2']) + items(REGIONS['b3'])
assert len(B) == 12, f'зданий {len(B)}, нужно 12'
for n, img in zip(PLACES, B): fit(img, 150).save(f'{base}/buildings/{n}.png')

# ---------- Порталы ----------
PORT = ['teleport', 'arch', 'boss', 'exit', 'sign', 'chest']
P = items(REGIONS['portals'])
assert len(P) == 6, f'порталов {len(P)}, нужно 6'
PW = {'teleport': 110, 'arch': 64, 'boss': 92, 'exit': 64, 'sign': 36, 'chest': 32}
for n, img in zip(PORT, P): fit(img, PW[n]).save(f'{base}/portals/{n}.png')
# ---------- Фоны лобби (4 картинки справа внизу) ----------
if 'lobby' in REGIONS and '--lobby' in sys.argv:  # мелкие фоны с общего листа мылятся — только по запросу
    os.makedirs(f'{out}/../lobby', exist_ok=True)
    L = items(REGIONS['lobby'])
    for k, img in enumerate(L[:4]):
        a = np.array(img)
        a = a[3:-3, 3:-3]                                    # без рамки
        Image.fromarray(a).convert('RGB').resize((a.shape[1] * 3, a.shape[0] * 3), Image.LANCZOS).save(f'{out}/../lobby/{theme}_{k + 1}.jpg', quality=88)
    print('фонов лобби:', len(L[:4]))
print('готово:', base)
