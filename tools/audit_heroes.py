"""Проверка листов героев: обрезки соседних кадров у края, пустые кадры, «застывшая» ходьба (кадры одинаковые).
python3 tools/audit_heroes.py [герой ...]"""
import sys, re, json, numpy as np
from PIL import Image
src = open('public/js/skins.js').read()
heroes = re.findall(r"\n    (\w+): \{\n      sheet: '([^']+)'[^\n]*w: (\d+), h: (\d+), frames: (\d+)", src)
att = {m[0]: m[1:] for m in re.findall(r"\n    (\w+): \{\n      sheet:[^\n]*\n(?:[^\n]*\n)*?      attack: \{ sheet: '([^']+)', w: (\d+), h: (\d+), frames: (\d+), rows: (\d+)", src)}
only = set(sys.argv[1:])
DIRS = ['down', 'down-right', 'right', 'up-right', 'up', 'up-left', 'left', 'down-left']
def frames(path, w, h, fr, rows):
    a = np.asarray(Image.open('public/' + path).convert('RGBA'))[..., 3]
    return [[a[r*h:(r+1)*h, c*w:(c+1)*w] for c in range(fr)] for r in range(rows)]
def check(f):
    out = []
    m = f > 40
    if m.sum() < 30: return ['пусто']
    from scipy import ndimage
    lab, n = ndimage.label(m); sz = ndimage.sum(m, lab, range(1, n + 1)); big = sz.argmax() + 1
    for i in range(1, n + 1):
        if i == big or sz[i-1] < 3: continue
        ys, xs = np.nonzero(lab == i)
        if xs.min() == 0 or xs.max() == f.shape[1] - 1 or ys.min() == 0: out.append(f'обрезок {int(sz[i-1])}px у края')
        elif sz[i-1] > 0.02 * sz.max(): pass
    return out
for name, sheet, w, h, fr in heroes:
    if only and name not in only: continue
    w, h, fr = int(w), int(h), int(fr)
    F = frames(sheet, w, h, fr, 8); probs = []
    for r in range(8):
        for c in range(fr):
            for p in check(F[r][c]): probs.append(f'{DIRS[r]}#{c}: {p}')
        diffs = [np.abs(F[r][c].astype(int) - F[r][0].astype(int)).mean() for c in range(1, fr)]
        if max(diffs) < 1.0: probs.append(f'{DIRS[r]}: ходьба без движения (кадры одинаковые)')
    if name in att:
        s, aw, ah, af, ar = att[name]; aw, ah, af, ar = int(aw), int(ah), int(af), int(ar)
        A = frames(s, aw, ah, af, ar)
        for r in range(ar):
            for c in range(af):
                for p in check(A[r][c]): probs.append(f'атака ряд {r}#{c}: {p}')
    print(name, 'OK' if not probs else '\n  ' + '\n  '.join(probs[:12]) + (f'\n  …ещё {len(probs)-12}' if len(probs) > 12 else ''))
