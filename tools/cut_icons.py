"""Нарезка листа иконок умений: квадраты на чёрном фоне, сетка cols × rows.
python3 tools/cut_icons.py sheet.png cols rows name1,name2,... [out_dir] [size]
Имена по порядку слева направо, сверху вниз; '-' — пропустить ячейку."""
import sys, numpy as np
from PIL import Image

def bands(profile, n):
    # Отрезки, где яркость выше порога, затем берём n самых длинных
    on = profile > max(18, profile.max() * 0.12)
    segs, s = [], None
    for i, v in enumerate(on):
        if v and s is None: s = i
        if not v and s is not None: segs.append((s, i)); s = None
    if s is not None: segs.append((s, len(on)))
    segs = sorted(sorted(segs, key=lambda t: t[1] - t[0], reverse=True)[:n])
    if len(segs) != n: raise SystemExit(f'нашёл {len(segs)} полос вместо {n}')
    return segs

def main():
    src, cols, rows, names = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4].split(',')
    out = sys.argv[5] if len(sys.argv) > 5 else 'public/assets/skills'
    size = int(sys.argv[6]) if len(sys.argv) > 6 else 128
    im = Image.open(src).convert('RGB'); a = np.asarray(im).astype(float).max(axis=2)
    xs, ys = bands(a.mean(axis=0), cols), bands(a.mean(axis=1), rows)
    k = 0
    for y0, y1 in ys:
        for x0, x1 in xs:
            name = names[k] if k < len(names) else '-'; k += 1
            if name == '-': continue
            m = max(2, round((x1 - x0) * 0.015))  # срезаем тёмную кромку
            im.crop((x0 + m, y0 + m, x1 - m, y1 - m)).resize((size, size), Image.LANCZOS).save(f'{out}/{name}.webp', quality=86, method=6)
            print(name, (x0, y0, x1, y1))

main()
