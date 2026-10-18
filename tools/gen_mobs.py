# Генератор нарисованных монстров: пиксель-арт в стиле героев (объёмная светотень, тёмный контур).
# Каждый монстр рисуется в 4 раза крупнее, затем уменьшается — края мягкие, но пиксельные.
# Выход: public/assets/mobs/<id>.png — лист в один ряд (смотрит вправо): 4 кадра ходьбы, 3 кадра удара.
#        public/js/mobart.js — размеры листов для игры (Skins.MOBS).
# Запуск: python3 tools/gen_mobs.py [id ...]   (без аргументов — все монстры из server/mobs.js)
import sys, os, re, json, math
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'public', 'assets', 'mobs')
SS = 4                      # сглаживание: рисуем в SS раз крупнее
OUTLINE = (22, 14, 20)

# ---------- цвет ----------
def rgb(h):
    h = h.lstrip('#')
    if len(h) == 3: h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
def mix(a, b, k): return tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3))
def dark(c, k=0.42): return mix(c, (30, 18, 46), k)          # тень — в холодный фиолетовый
def light(c, k=0.3): return mix(c, (255, 244, 214), k)       # свет — в тёплый
def lum(c): return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]

# ---------- холст ----------
class Fig:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.parts = []   # (z, mask, color, shade)
    def _new(self):
        return Image.new('L', (self.w * SS, self.h * SS), 0)
    def _add(self, im, col, z, shade):
        self.parts.append((z, np.array(im) > 127, col, shade))
    def ell(self, cx, cy, rx, ry, col, z=0, shade=True):
        im = self._new(); d = ImageDraw.Draw(im)
        d.ellipse([(cx - rx) * SS, (cy - ry) * SS, (cx + rx) * SS, (cy + ry) * SS], 255)
        self._add(im, col, z, shade)
    def poly(self, pts, col, z=0, shade=True):
        im = self._new(); d = ImageDraw.Draw(im)
        d.polygon([(x * SS, y * SS) for x, y in pts], 255)
        self._add(im, col, z, shade)
    def cap(self, a, b, r, col, z=0, shade=True, r2=None):
        """Капсула (конечность) от a до b, радиус r → r2."""
        r2 = r if r2 is None else r2
        im = self._new(); d = ImageDraw.Draw(im)
        (x1, y1), (x2, y2) = a, b
        L = math.hypot(x2 - x1, y2 - y1) or 1e-3
        nx, ny = -(y2 - y1) / L, (x2 - x1) / L
        d.polygon([((x1 + nx * r) * SS, (y1 + ny * r) * SS), ((x2 + nx * r2) * SS, (y2 + ny * r2) * SS),
                   ((x2 - nx * r2) * SS, (y2 - ny * r2) * SS), ((x1 - nx * r) * SS, (y1 - ny * r) * SS)], 255)
        d.ellipse([(x1 - r) * SS, (y1 - r) * SS, (x1 + r) * SS, (y1 + r) * SS], 255)
        d.ellipse([(x2 - r2) * SS, (y2 - r2) * SS, (x2 + r2) * SS, (y2 + r2) * SS], 255)
        self._add(im, col, z, shade)
    def line(self, a, b, w, col, z=0, shade=False):
        im = self._new(); d = ImageDraw.Draw(im)
        d.line([(a[0] * SS, a[1] * SS), (b[0] * SS, b[1] * SS)], 255, max(1, int(w * SS)))
        self._add(im, col, z, shade)
    def dot(self, x, y, r, col, z=50):
        self.ell(x, y, r, r, col, z, False)

    def render(self, outline=OUTLINE, glow=None, tex=0.08):
        W, H = self.w * SS, self.h * SS
        img = np.zeros((H, W, 3), np.float32); alpha = np.zeros((H, W), bool)
        o1, o2 = int(1.0 * SS), int(2.0 * SS)
        yy = np.linspace(0, 1, H, dtype=np.float32)[:, None].repeat(W, 1)
        for z, m, col, shade in sorted(self.parts, key=lambda p: p[0]):
            c = np.array(col, np.float32)
            if shade:
                # объём: градиент сверху вниз внутри детали
                ys = np.nonzero(m.any(1))[0]
                if len(ys):
                    y0, y1 = ys.min(), ys.max() + 1
                    g = np.zeros((H, 1), np.float32); g[y0:y1, 0] = np.linspace(0, 1, y1 - y0)
                    lo, hi = np.array(light(col, .12), np.float32), np.array(dark(col, .22), np.float32)
                    fill = lo[None, None, :] * (1 - g[..., None]) + hi[None, None, :] * g[..., None]
                    fill = np.broadcast_to(fill, (H, W, 3))
                else:
                    fill = np.broadcast_to(c, (H, W, 3))
                # тень, которую деталь отбрасывает на то, что под ней
                drop = shift(m, o1, o2 // 2) & ~m & alpha
                img[drop] = img[drop] * 0.72
                img[m] = fill[m]
                sh = m & ~shift(m, -o2, -o2)
                hl = m & ~shift(m, o1, o1) & ~sh
                img[sh] = np.array(dark(col), np.float32)
                img[hl] = np.array(light(col), np.float32)
            else:
                img[m] = c
            alpha |= m
        im = Image.fromarray(np.dstack([img.clip(0, 255).astype(np.uint8), (alpha * 255).astype(np.uint8)]), 'RGBA')
        im = im.resize((self.w, self.h), Image.LANCZOS)
        a = np.array(im).astype(np.int16)
        A = a[..., 3] > 100
        A[0, :] = A[-1, :] = False; A[:, 0] = A[:, -1] = False
        # пиксельная фактура: лёгкий «шум» по сетке (ткань, камень, мех)
        rng = np.random.default_rng(self.w * 131 + self.h)
        nz = (rng.random((self.h, self.w)) - 0.5) * 2 * tex * 255 * 0.35
        a[..., :3] = np.clip(a[..., :3] + nz[..., None], 0, 255)
        a[..., 3] = np.where(A, 255, 0)
        # контур: тёмная версия соседнего цвета (мягче чёрного), снизу — плотнее
        rgbf = a[..., :3].astype(np.float32)
        acc = np.zeros((self.h, self.w, 3), np.float32); cnt = np.zeros((self.h, self.w), np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nm = shift(A, dy, dx)
            acc += np.where(nm[..., None], shift3(rgbf, dy, dx), 0); cnt += nm
        edge = (cnt > 0) & ~A
        base = np.array(outline if glow is None else glow, np.float32)
        oc = acc / np.maximum(cnt, 1)[..., None] * 0.28 + base * 0.72
        a[edge, :3] = oc[edge]; a[edge, 3] = 255
        return Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA')

def shift(m, dy, dx):
    """Сдвиг маски без переноса через край."""
    out = np.zeros_like(m)
    H, W = m.shape[:2]
    ys, yd = (slice(0, H - dy), slice(dy, H)) if dy >= 0 else (slice(-dy, H), slice(0, H + dy))
    xs, xd = (slice(0, W - dx), slice(dx, W)) if dx >= 0 else (slice(-dx, W), slice(0, W + dx))
    out[yd, xd] = m[ys, xs]
    return out
shift3 = shift

# ---------- позы ----------
def walk_ph(t): return t * math.pi / 2
def pol(p, ang, L): return (p[0] + math.cos(ang) * L, p[1] + math.sin(ang) * L)
D = math.radians

# ---------- оружие ----------
def weapon(f, kind, h, ang, L, z, metal=(196, 200, 212), wood=(122, 82, 48), gem=None, size=1.0):
    s = size
    if kind in ('sword', 'greatsword'):
        ln = (15 if kind == 'sword' else 21) * s
        tip = pol(h, ang, ln)
        f.cap(pol(h, ang, 2), tip, 1.5 * s if kind == 'sword' else 2.1 * s, metal, z, True, 0.5)
        f.line(pol(h, ang, 3), pol(h, ang, ln - 2), 0.6, light(metal, .5), z + 0.1)
        f.cap(pol(h, ang + math.pi / 2, 3.2 * s), pol(h, ang - math.pi / 2, 3.2 * s), 1.1 * s, (200, 160, 70), z + 0.2)
        f.cap(h, pol(h, ang + math.pi, 3 * s), 1.0 * s, (90, 50, 40), z + 0.2)
    elif kind in ('axe', 'bigaxe', 'cleaver'):
        ln = (14 if kind == 'axe' else 19 if kind == 'bigaxe' else 12) * s
        f.cap(pol(h, ang + math.pi, 3), pol(h, ang, ln), 1.1 * s, wood, z)
        hd = pol(h, ang, ln - 2)
        perp = ang - math.pi / 2
        bw = (6 if kind == 'axe' else 9 if kind == 'bigaxe' else 7) * s
        if kind == 'cleaver':
            f.poly([pol(hd, ang, 3), pol(pol(hd, ang, 3), perp, bw), pol(pol(hd, ang, -5), perp, bw), pol(hd, ang, -5)], metal, z + 0.1)
        else:
            f.poly([pol(hd, ang, 3), pol(pol(hd, ang, 5), perp, bw), pol(pol(hd, ang, -6), perp, bw), pol(hd, ang, -3)], metal, z + 0.1)
            if kind == 'bigaxe':
                f.poly([pol(hd, ang, 2), pol(pol(hd, ang, 4), perp + math.pi, bw * .7), pol(pol(hd, ang, -4), perp + math.pi, bw * .7), pol(hd, ang, -2)], metal, z + 0.1)
    elif kind == 'club':
        f.cap(pol(h, ang + math.pi, 2), pol(h, ang, 11 * s), 1.4, wood, z, True, 3.0 * s)
    elif kind == 'staff':
        top = pol(h, ang, 15 * s); bot = pol(h, ang + math.pi, 13 * s)
        f.cap(bot, top, 1.1 * s, wood, z)
        f.cap(pol(top, ang + 2.4, 3), pol(top, ang - 2.4, 3), 1.0, (90, 60, 40), z + 0.1)
        g = rgb(gem or '#9ff0ff')
        f.ell(top[0], top[1], 2.6 * s, 2.6 * s, g, z + 0.2)
        f.dot(top[0] - 0.7, top[1] - 0.7, 1.0 * s, light(g, .7), z + 0.3)
    elif kind == 'bow':
        c = pol(h, ang, 0.5)
        perp = ang - math.pi / 2
        a1, a2 = pol(c, perp, 10 * s), pol(c, perp + math.pi, 10 * s)
        mid = pol(c, ang, 4 * s)
        f.cap(a1, mid, 1.1, wood, z); f.cap(mid, a2, 1.1, wood, z)
        f.line(a1, a2, 0.5, (230, 225, 210), z - 0.1)
    elif kind == 'xbow':
        f.cap(pol(h, ang + math.pi, 3), pol(h, ang, 9), 1.5, wood, z)
        tip = pol(h, ang, 8); perp = ang - math.pi / 2
        f.cap(pol(tip, perp, 6), pol(tip, perp + math.pi, 6), 1.0, metal, z + 0.1)
    elif kind == 'daggers':
        f.cap(pol(h, ang, 1), pol(h, ang, 8 * s), 1.1, metal, z, True, 0.4)
    elif kind == 'scythe':
        top = pol(h, ang, 15 * s); bot = pol(h, ang + math.pi, 10 * s)
        f.cap(bot, top, 1.1, (60, 40, 40), z)
        perp = ang + math.pi / 2
        f.poly([top, pol(pol(top, perp, 11 * s), ang, -3), pol(pol(top, perp, 8 * s), ang, -6), pol(top, ang, -3)], (210, 210, 220), z + 0.1)
    elif kind == 'whip':
        p = h
        for i in range(5):
            q = pol(p, ang + math.sin(i * 1.3) * 0.5, 4.5)
            f.cap(p, q, 0.8, (90, 30, 40), z); p = q
    elif kind == 'shield':
        c = pol(h, ang, 1)
        f.ell(c[0] + 1, c[1], 5.5 * s, 7.5 * s, (110, 40, 40), z + 0.5)
        f.ell(c[0] + 1, c[1], 2.2, 2.2, (220, 170, 70), z + 0.6)
    elif kind == 'banner':
        top = pol(h, ang, 18); bot = pol(h, ang + math.pi, 10)
        f.cap(bot, top, 1.0, wood, z)
        f.poly([top, (top[0] + 11, top[1] + 2), (top[0] + 9, top[1] + 8), (top[0] + 11, top[1] + 13), (top[0], top[1] + 11)], (130, 30, 40), z - 0.2)
    elif kind == 'book':
        f.poly([(h[0] - 1, h[1] - 4), (h[0] + 6, h[1] - 3), (h[0] + 6, h[1] + 4), (h[0] - 1, h[1] + 3)], (90, 30, 30), z)
        f.line((h[0] + 0.5, h[1] - 2.5), (h[0] + 5, h[1] - 1.8), 0.6, (230, 200, 120), z + 0.1)
        if gem: f.dot(h[0] + 3, h[1] + 0.5, 1.2, rgb(gem), z + 0.2)
    elif kind == 'horn':
        f.cap(h, pol(h, ang - 0.6, 7), 1.0, (220, 200, 150), z, True, 2.4)
    elif kind == 'claws':
        for k in (-0.4, 0, 0.4):
            f.cap(h, pol(h, ang + k, 4.5), 0.6, (235, 230, 215), z, False, 0.2)

# ---------- головы ----------
def head(f, L, c, z, phase=0, attack=False):
    x, y = c
    skin = rgb(L.get('skin', '#d8a880')); cloth = rgb(L.get('cloth', '#5a4a3a'))
    eye = rgb(L.get('eye', '#ff3a3a')) if L.get('eye') else None
    hd = L.get('head', 'none'); bones = L.get('bones')
    r = 6.0
    if hd == 'bull':
        f.ell(x + 1, y, 6.5, 6, skin, z)
        f.ell(x + 6, y + 2.5, 3.6, 3.0, mix(skin, (230, 190, 170), .35), z + 0.1)
        f.dot(x + 7.5, y + 2, 0.6, (40, 20, 20), z + 0.2)
        f.cap((x - 2, y - 4), (x - 7, y - 10), 1.6, (230, 220, 190), z - 0.1, True, 0.6)
        f.cap((x + 3, y - 5), (x + 8, y - 11), 1.6, (230, 220, 190), z + 0.2, True, 0.6)
        f.dot(x + 4, y - 1.5, 0.9, rgb('#ff3a1a'), z + 0.3)
        return
    if hd == 'wolf':
        f.ell(x, y, 5.5, 5.5, skin, z)
        f.cap((x + 2, y + 1), (x + 9, y + 2.5), 3.0, skin, z + 0.1, True, 1.8)
        f.poly([(x - 3, y - 3), (x - 4, y - 10), (x + 1, y - 5)], skin, z + 0.2)
        f.dot(x + 9.5, y + 1.5, 0.9, (30, 20, 20), z + 0.3)
        f.dot(x + 3, y - 1.5, 0.9, eye or (255, 222, 58), z + 0.3)
        if attack: f.poly([(x + 3, y + 3), (x + 10, y + 3), (x + 4, y + 6)], (120, 20, 30), z + 0.25)
        return
    if bones or hd == 'skull':
        bone = rgb('#ece6cc')
        f.ell(x, y, 5.8, 5.6, bone, z)
        f.ell(x + 1.5, y + 3.2, 3.6, 2.6, bone, z + 0.1)
        f.ell(x + 2.4, y - 0.5, 1.5, 1.7, (25, 15, 20), z + 0.2, False)
        f.ell(x - 1.4, y - 0.4, 1.3, 1.6, (25, 15, 20), z + 0.2, False)
        g = rgb(L.get('gem') or L.get('eye') or '#ff5a3a')
        f.dot(x + 2.4, y - 0.4, 0.7, g, z + 0.3); f.dot(x - 1.4, y - 0.3, 0.6, g, z + 0.3)
        for k in range(3): f.line((x + 0.5 + k * 1.3, y + 3), (x + 0.5 + k * 1.3, y + 5), 0.5, (60, 50, 50), z + 0.3)
    else:
        f.ell(x, y, r, r, skin, z)
        f.ell(x + 4.5, y + 1, 2.2, 2, skin, z + 0.05)   # нос/лицо вперёд
        ec = eye or ((40, 25, 25) if lum(skin) > 90 else (255, 220, 120))
        f.dot(x + 3.2, y - 0.8, 0.9, ec, z + 0.3)
        f.dot(x + 0.6, y - 0.8, 0.75, ec, z + 0.3)
        if hd not in ('hood', 'helm', 'mask', 'wizard', 'hoodHorns', 'tusksHelm'):
            f.line((x + 1, y - 2.6), (x + 4.4, y - 2.4), 0.7, dark(skin, .6), z + 0.3)   # бровь
    # головные уборы
    if hd == 'ears':
        f.poly([(x - 2, y - 2), (x - 11, y - 6), (x - 3, y + 1.5)], skin, z - 0.1)
        f.poly([(x + 1, y - 4), (x + 4, y - 12), (x + 3, y - 3)], skin, z + 0.15)
    elif hd in ('tusks', 'tusksHelm', 'troll'):
        f.cap((x + 4, y + 4), (x + 5.5, y + 0.5), 0.8, (240, 230, 200), z + 0.4, False, 0.3)
        if hd == 'troll':
            f.ell(x + 6, y + 1.5, 2.6, 2.2, skin, z + 0.2)
            f.poly([(x - 3, y - 1), (x - 10, y - 4), (x - 4, y + 2)], skin, z - 0.1)
        if hd == 'tusksHelm':
            f.poly([(x - 7, y - 1), (x - 6, y - 7), (x, y - 9), (x + 6, y - 7), (x + 7, y - 2)], (110, 110, 120), z + 0.5)
            f.cap((x - 3, y - 7), (x - 7, y - 13), 1.2, (230, 220, 190), z + 0.4, True, 0.4)
            f.cap((x + 3, y - 7), (x + 7, y - 13), 1.2, (230, 220, 190), z + 0.6, True, 0.4)
    elif hd in ('horns', 'bigHorns', 'hoodHorns'):
        hl = 9 if hd == 'bigHorns' else 6
        hc = (60, 40, 40) if hd != 'horns' else (230, 215, 180)
        f.cap((x - 2, y - 4), (x - 5, y - 4 - hl), 1.6, hc, z + 0.2, True, 0.4)
        f.cap((x + 2, y - 5), (x + 4, y - 5 - hl), 1.6, hc, z + 0.5, True, 0.4)
        if hd == 'hoodHorns':
            f.poly([(x - 7.5, y + 4), (x - 7, y - 5), (x, y - 8), (x + 6, y - 5), (x + 5, y + 1), (x + 2, y - 2), (x - 2, y + 6)], dark(cloth, .2), z + 0.4)
            f.dot(x + 3, y - 0.6, 0.9, eye or (255, 60, 40), z + 0.6)
    elif hd in ('hood',):
        hc = dark(cloth, .15)
        f.poly([(x - 8, y + 6), (x - 7.5, y - 4), (x - 2, y - 8.5), (x + 4, y - 7.5), (x + 7, y - 3), (x + 6.5, y + 2), (x + 3, y - 2.5), (x - 1, y + 4), (x - 3, y + 7)], hc, z + 0.4)
        f.ell(x + 2.5, y + 0.5, 3, 3.4, (20, 12, 18), z + 0.45, False)
        g = eye or rgb(L.get('gem') or '#ffd36a')
        f.dot(x + 3.4, y - 0.4, 0.8, g, z + 0.5); f.dot(x + 1.6, y - 0.4, 0.7, g, z + 0.5)
    elif hd == 'wizard':
        hc = dark(cloth, .1)
        f.poly([(x - 9, y - 2.5), (x + 9, y - 2.5), (x + 6, y - 5)], hc, z + 0.5)
        f.poly([(x - 5, y - 4), (x + 5, y - 4), (x - 1, y - 16), (x - 5, y - 18)], hc, z + 0.45)
        f.line((x - 5, y - 4.5), (x + 5, y - 4.5), 0.8, (220, 180, 80), z + 0.55)
        if L.get('beard') or L.get('gem'):
            f.poly([(x + 1, y + 3), (x + 7, y + 3), (x + 4, y + 10)], (220, 220, 230), z + 0.4)
    elif hd == 'crown':
        f.poly([(x - 5, y - 4), (x - 5, y - 9), (x - 2.5, y - 6.5), (x, y - 10), (x + 2.5, y - 6.5), (x + 5, y - 9), (x + 5, y - 4)], (230, 180, 60), z + 0.5)
        f.dot(x, y - 6, 0.9, rgb(L.get('gem') or '#c0304a'), z + 0.6)
    elif hd == 'helm':
        hc = (60, 62, 74)
        f.ell(x, y - 0.5, 6.6, 6.6, hc, z + 0.4)
        f.poly([(x + 1, y - 1.5), (x + 7, y - 1.5), (x + 7, y + 0.5), (x + 1, y + 0.5)], (14, 10, 14), z + 0.45, False)
        f.dot(x + 4.5, y - 0.5, 0.7, eye or (255, 60, 60), z + 0.5)
        f.cap((x - 2, y - 6), (x - 6, y - 11), 1.4, (120, 30, 40), z + 0.3, True, 0.6)
    elif hd == 'collar':
        f.poly([(x - 6, y + 9), (x - 9, y - 1), (x - 4, y + 4)], dark(cloth, .1), z + 0.45)
        f.poly([(x - 4, y - 5), (x + 3, y - 7), (x + 6, y - 3), (x - 2, y - 3)], (30, 20, 30), z + 0.4)   # волосы
        f.dot(x + 3.2, y - 0.8, 0.9, (255, 40, 60), z + 0.5)
    elif hd == 'mask':
        f.poly([(x - 1, y - 2), (x + 7, y - 2), (x + 7, y + 4), (x - 1, y + 4)], (30, 30, 40), z + 0.45)
        f.poly([(x - 6, y - 3), (x - 3, y - 7), (x + 4, y - 7), (x + 6, y - 3)], (40, 40, 52), z + 0.4)
        f.dot(x + 3.4, y - 0.6, 0.8, (255, 220, 120), z + 0.5)
    elif hd == 'bandana':
        f.poly([(x - 6, y - 3), (x - 4, y - 7), (x + 4, y - 7), (x + 6, y - 3)], (140, 30, 30), z + 0.45)
        f.poly([(x - 6, y - 4), (x - 11, y - 1), (x - 6, y - 1)], (140, 30, 30), z + 0.44)
    elif hd == 'halo':
        f.poly([(x - 5, y - 4), (x + 3, y - 7), (x + 7, y - 2), (x - 1, y - 3)], (240, 220, 160), z + 0.4)
        im = f._new(); d = ImageDraw.Draw(im)
        d.ellipse([(x - 6) * SS, (y - 12) * SS, (x + 6) * SS, (y - 8) * SS], outline=255, width=int(1.3 * SS))
        f._add(im, (255, 230, 140), z + 0.6, False)
    elif hd == 'snakes':
        for i, (dx, ln) in enumerate(((-5, 7), (-2, 8), (2, 8), (5, 6))):
            a = (x + dx * 0.6, y - 4); b = (x + dx, y - 4 - ln)
            f.cap(a, b, 1.0, (90, 140, 70), z + 0.3 + i * 0.01)
            f.dot(b[0], b[1], 1.3, (110, 160, 80), z + 0.32 + i * 0.01)
    elif hd == 'antlers':
        for sx in (-1, 1):
            b = (x + sx * 2, y - 5)
            t = (x + sx * 7, y - 14)
            f.cap(b, t, 0.9, (150, 120, 80), z + 0.3)
            f.cap(pol(b, D(-90), 4), (x + sx * 7, y - 9), 0.7, (150, 120, 80), z + 0.3)
    elif hd == 'feathers':
        for i, c2 in enumerate(((220, 60, 40), (240, 200, 60), (60, 160, 200))):
            f.cap((x - 2 + i, y - 4), (x - 6 + i * 3, y - 13 + i), 1.0, c2, z + 0.3, True, 0.5)
    elif hd == 'none' and L.get('torn'):
        f.dot(x - 2, y - 3, 1.2, dark(skin, .3), z + 0.3)

# ---------- гуманоид ----------
ROBE_HEADS = ('hood', 'wizard', 'crown')
def humanoid(L, mode, t, size):
    W, H = size
    f = Fig(W, H)
    gy = H - 2
    skin = rgb(L.get('skin', '#d8a880')); cloth = rgb(L.get('cloth', '#5a4a3a'))
    bones, torn = L.get('bones'), L.get('torn')
    wpn = L.get('wpn', 'none'); hd = L.get('head', 'none')
    big = hd in ('tusks', 'bull', 'tusksHelm', 'bigHorns', 'troll') or wpn in ('bigaxe',)
    bw = 1.28 if big else 1.0
    melee = wpn in ('sword', 'axe', 'bigaxe', 'greatsword', 'cleaver', 'club', 'shield', 'scythe', 'daggers', 'whip')
    caped = hd in ('crown', 'collar', 'helm') or L.get('cape')
    cx = W / 2 - 2
    robe = not bones and (wpn in ('staff', 'book') or hd in ROBE_HEADS) and hd != 'antlers' or L.get('tail')
    mage = wpn in ('staff', 'book', 'horn')
    ph = walk_ph(t) if mode == 'walk' else 0
    sw = math.sin(ph)
    bob = -abs(math.cos(ph)) * 1.0 if mode == 'walk' else 0
    lean = 0
    if mode == 'atk':
        lean = (-1.5, 2.5, 1.0)[t] if not mage else (-0.5, 1.0, 0.3)[t]
    zomb = torn and not bones
    hipY = gy - 16 + bob; shY = gy - 30 + bob + (2 if zomb else 0)
    hip = (cx + lean * 0.3, hipY); sh = (cx + 1 + lean, shY)
    limb = 1.5 if bones else 2.3 * bw
    legc = (rgb('#ece6cc') if bones else dark(cloth, .25))
    boot = (60, 40, 34) if not bones else rgb('#ece6cc')
    # крылья (позади)
    if L.get('wings'):
        wc = rgb(L['wings'])
        flap = math.sin(ph * 2) * 2 if mode == 'walk' else (-3, 2, 0)[t]
        root = (sh[0] - 3, sh[1] + 3)
        feather = hd == 'halo'
        for k, z in ((0, -6), (1, -5.5)):
            ox = -3 * k
            pts = [root, (root[0] - 14 + ox, root[1] - 14 + flap), (root[0] - 19 + ox, root[1] - 4 + flap), (root[0] - 15 + ox, root[1] + 6),
                   (root[0] - 9 + ox, root[1] + 3), (root[0] - 6 + ox, root[1] + 10), root]
            f.poly(pts, wc if k else dark(wc, .25), z)
            if feather:
                for j in range(4):
                    f.line((root[0] - 4 - j * 3 + ox, root[1] + 2), (root[0] - 9 - j * 3 + ox, root[1] + 10 - j), 0.6, light(wc, .3), z + 0.1)
            else:
                for j in range(3):
                    f.line(root, (root[0] - 17 + ox + j * 2, root[1] - 10 + flap + j * 6), 0.6, dark(wc, .5), z + 0.1)
    if caped and not L.get('wings'):
        cc = dark(cloth, .15) if hd != 'collar' else rgb('#5a0a1a')
        sway = sw * 2 if mode == 'walk' else (-1, 3, 1)[t]
        f.poly([(sh[0] - 6, sh[1]), (sh[0] + 2, sh[1] - 1), (hip[0] - 2 - sway, gy - 2), (hip[0] - 9 - sway * 1.5, gy - 1), (hip[0] - 12 - sway * 2, gy - 4)], cc, 0.4)
        f.line((sh[0] - 3, sh[1] + 2), (hip[0] - 8 - sway * 1.5, gy - 3), 0.7, dark(cc, .4), 0.5)
    # ноги / хвост / ряса
    if L.get('tail'):
        sc = mix(skin, (80, 130, 60), .5)
        pts = [(cx - 5, hipY - 2), (cx + 6, hipY - 2), (cx + 7, gy - 4), (cx + 2, gy), (cx - 12, gy - 1), (cx - 16 + sw * 2, gy - 6), (cx - 9, gy - 3)]
        f.poly(pts, sc, 1)
        for k in range(4): f.line((cx - 2 - k * 3, gy - 3 + (k % 2)), (cx - 4 - k * 3, gy - 1), 0.6, dark(sc, .4), 1.1)
    else:
        for side, z in ((-1, 1), (1, 3)):
            off = side * sw * (5.5 if mode == 'walk' else 0)
            if mode == 'atk': off = side * (3.5, 5.0, 4.0)[t]
            lift = max(0, side * math.cos(ph)) * 2 if mode == 'walk' else 0
            foot = (hip[0] + off + (1 if side > 0 else -1), gy - 1 - lift)
            knee = ((hip[0] + foot[0]) / 2 + 1.2, (hipY + foot[1]) / 2)
            c = legc if side > 0 else dark(legc, .25)
            f.cap((hip[0] + side * 2.2, hipY), knee, limb, c, z)
            f.cap(knee, foot, limb * 0.92, c, z)
            if not robe:
                f.ell(foot[0] + 1.5, foot[1] - 0.5, 3.2 * bw, 1.9, boot if side > 0 else dark(boot, .2), z + 0.1)
    # торс
    tw = 6.2 * bw
    if bones:
        bone = rgb('#ece6cc')
        f.cap((sh[0] - 1, sh[1] + 1), (hip[0], hipY - 1), 1.3, bone, 4)   # позвоночник
        for k in range(4):
            yy = sh[1] + 3 + k * 2.6
            f.cap((sh[0] - 4.5 + k * .4, yy), (sh[0] + 4.5 - k * .5, yy + 0.6), 0.8, bone, 4.1)
        f.ell(hip[0], hipY, 4.5, 2.2, bone, 4.0)
        if L.get('cloth') and rgb(L['cloth']) != bone:
            f.poly([(sh[0] - 6, sh[1]), (sh[0] + 5, sh[1]), (hip[0] + 6, hipY + 6), (hip[0] - 7, hipY + 8)], cloth, 4.2)
    else:
        top = [(sh[0] - tw, sh[1] + 1), (sh[0] + tw - 0.5, sh[1]), (hip[0] + tw * 0.8, hipY + 1), (hip[0] - tw * 0.85, hipY + 1)]
        f.poly(top, cloth, 4)
        if robe:
            sway = sw * 1.5 if mode == 'walk' else (0, 1.5, .5)[t]
            rob = [(hip[0] - tw * 0.85, hipY - 1), (hip[0] + tw * 0.8, hipY - 1), (hip[0] + 8.5 + sway, gy), (hip[0] - 9 + sway * .5, gy)]
            f.poly(rob, cloth, 4.1)
            f.line((hip[0] + 2, hipY + 2), (hip[0] + 3 + sway, gy - 1), 0.7, dark(cloth, .45), 4.2)
            if not L.get('tail'):
                for side in (-1, 1):
                    f.ell(hip[0] + side * 3 + 2 + sway, gy - 0.5, 2.6, 1.4, (50, 34, 30), 4.3)
        if torn:
            for k in range(4):
                xx = hip[0] - tw + k * 3.2
                f.poly([(xx, hipY), (xx + 3, hipY), (xx + 1.4, hipY + 4.5 + (k % 2) * 2)], cloth, 4.15)
        else:
            f.line((hip[0] - tw * 0.85, hipY - 1.3), (hip[0] + tw * 0.8, hipY - 1.3), 1.2, (70, 44, 30), 4.3)   # пояс
            f.dot(hip[0] + 1, hipY - 1.3, 1.0, (210, 170, 70), 4.35)
        if not robe and not torn:
            if melee:
                steel = (92, 94, 108) if hd not in ('ears', 'bandana') else (110, 78, 50)
                f.poly([(sh[0] - tw + 1.5, sh[1] + 2), (sh[0] + tw - 1, sh[1] + 1.5), (hip[0] + tw * 0.7 - 0.5, hipY - 3), (hip[0] - tw * 0.7, hipY - 3)], steel, 4.22)
                f.line((sh[0] + 0.5, sh[1] + 3), (hip[0] + 1, hipY - 4), 0.6, light(steel, .4), 4.23)
                f.line((sh[0] - tw + 2, sh[1] + 6), (sh[0] + tw - 1.5, sh[1] + 5.5), 0.6, dark(steel, .4), 4.23)
                f.cap((sh[0] - tw + 1, sh[1] + 1), (hip[0] + tw * 0.7, hipY - 2), 0.8, (70, 44, 30), 4.24)   # перевязь
            else:
                f.line((sh[0] + 1, sh[1] + 2), (hip[0] + 1.5, hipY - 2), 0.7, light(cloth, .2), 4.25)
        if melee or hd in ('tusks', 'tusksHelm', 'bull', 'horns', 'bigHorns', 'hoodHorns'):
            pc = (104, 104, 118) if hd not in ('ears', 'bandana') else (120, 84, 54)
            if big: pc = (110, 70, 44)
            f.ell(sh[0] - tw + 2, sh[1] + 1.5, 3.0 * bw, 2.4, dark(pc, .3), 1.9)                 # дальний наплечник
            f.ell(sh[0] + tw - 2.5, sh[1] + 1.2, 3.4 * bw, 2.8, pc, 7.9)                           # ближний наплечник
            f.line((sh[0] + tw - 5, sh[1] + 2.5), (sh[0] + tw, sh[1] + 2.5), 0.6, dark(pc, .4), 7.95)
            if big:
                for k in range(3): f.poly([(sh[0] + tw - 5 + k * 2.2, sh[1]), (sh[0] + tw - 4 + k * 2.2, sh[1] - 3.5), (sh[0] + tw - 3 + k * 2.2, sh[1])], (230, 220, 190), 7.97)
                f.ell(sh[0] - 1, sh[1] - 0.5, 5.5, 2.2, (110, 90, 70), 7.8)                          # меховой ворот
    # руки
    # углы руки (рад): 0 — вперёд, pi/2 — вниз
    if mode == 'walk':
        fa, ba = D(70 - sw * 25), D(110 + sw * 25)
        wa = D(55)
    else:
        if mage:
            fa, wa = [(D(-40), D(-80)), (D(-10), D(-70)), (D(20), D(-60))][t]
        elif wpn in ('bow', 'xbow'):
            fa, wa = [(D(5), D(0)), (D(0), D(0)), (D(10), D(5))][t]
        elif wpn in ('claws', 'none', 'daggers'):
            fa, wa = [(D(-60), D(-60)), (D(5), D(10)), (D(35), D(40))][t]
        else:
            fa, wa = [(D(-115), D(-150)), (D(10), D(40)), (D(55), D(80))][t]
        ba = D(120) if not (wpn in ('bow', 'xbow')) else D(10)
    if zomb and mode == 'walk': fa = ba = D(10)
    arm_c = skin
    shF = (sh[0] + 2.5, sh[1] + 2); shB = (sh[0] - 3, sh[1] + 2)
    alen = 10.5
    elb = pol(shB, ba, alen * 0.5); handB = pol(elb, ba + D(-15), alen * 0.5)
    f.cap(shB, elb, limb * 0.85, dark(cloth if not bones else arm_c, .2), 2)
    f.cap(elb, handB, limb * 0.8, dark(arm_c, .2), 2)
    if wpn in ('bow', 'xbow') and mode == 'atk':
        handB = pol(shF, D(0), 5 + (0, -3, 0)[t])
    elbF = pol(shF, fa, alen * 0.5); hand = pol(elbF, fa + D(-20 if mode == 'walk' else 0), alen * 0.5)
    if wpn == 'shield':
        weapon(f, 'shield', pol(shF, D(30), 6), 0, 0, 8.5)
        weapon(f, 'sword', hand, wa, 0, 7.0)
    elif wpn == 'daggers':
        weapon(f, 'daggers', handB, ba - D(60), 0, 1.9)
    elif wpn not in ('none', 'claws', 'shield'):
        weapon(f, wpn, hand, wa, 0, 7.0, gem=L.get('gem'), size=1.15 if big else 1.0)
    f.cap(shF, elbF, limb * 0.85, cloth if not bones else arm_c, 7.5)
    f.cap(elbF, hand, limb * 0.8, arm_c, 7.6)
    f.dot(hand[0], hand[1], limb * 0.75, arm_c, 7.7)
    if wpn == 'daggers': weapon(f, 'daggers', hand, wa, 0, 7.8)
    if wpn == 'claws' or (zomb):
        weapon(f, 'claws', hand, fa, 0, 7.8)
    # магия в руке при касте
    if mage and mode == 'atk':
        g = rgb(L.get('gem') or '#9ff0ff')
        top = pol(hand, wa, 15)
        rr = (2.0, 4.2, 2.6)[t]
        f.ell(top[0], top[1], rr, rr, light(g, .4), 9, False)
        f.ell(top[0], top[1], rr * .5, rr * .5, (255, 255, 240), 9.1, False)
    # голова
    hc = (sh[0] + 1.5 + (2 if zomb else 0), sh[1] - 6.5)
    head(f, L, hc, 10, ph, mode == 'atk' and t == 1)
    return f

# ---------- звери ----------
def quadruped(L, mode, t, size, kind='wolf'):
    W, H = size
    f = Fig(W, H)
    gy = H - 2
    fur = rgb(L.get('fur') or L.get('col') or '#6a6a72')
    eye = rgb(L.get('eye') or '#ffde3a')
    belly = rgb(L['belly']) if L.get('belly') else light(fur, .25)
    ph = walk_ph(t) if mode == 'walk' else 0
    big = kind in ('dragon', 'gryphon', 'dog3', 'horse')
    s = 1.0
    bodyL = 17 if kind == 'wolf' else 21 if kind != 'dragon' else 28
    cx = W / 2 - 3
    lean = (-3, 5, 2)[t] if mode == 'atk' else 0
    bob = -abs(math.sin(ph)) * 1.2 if mode == 'walk' else 0
    by = gy - (13 if kind == 'wolf' else 16 if kind != 'dragon' else 17) + bob
    rear = (cx - bodyL / 2 + lean * .3, by); front = (cx + bodyL / 2 + lean, by - (1 if kind != 'dragon' else 3))
    legR = 2.4 if kind == 'wolf' else 3.0 if kind != 'dragon' else 4.3
    # хвост
    tail_c = fur
    if kind == 'dragon':
        pts = [rear, (rear[0] - 10, rear[1] + 2 + math.sin(ph) * 2), (rear[0] - 22, rear[1] + 8), (rear[0] - 25, rear[1] + 6), (rear[0] - 10, rear[1] - 2)]
        f.poly(pts, fur, 0)
        f.poly([(rear[0] - 23, rear[1] + 4), (rear[0] - 28, rear[1] + 2), (rear[0] - 25, rear[1] + 9)], dark(fur, .2), 0.1)
    elif kind in ('wolf', 'dog3'):
        f.cap(rear, (rear[0] - 8, rear[1] - 4 + math.sin(ph) * 2), 2.4, tail_c, 0, True, 1.2)
    elif kind == 'gryphon':
        f.cap(rear, (rear[0] - 9, rear[1] + 4), 1.3, fur, 0)
        f.ell(rear[0] - 10, rear[1] + 5, 2.4, 2, dark(fur, .2), 0.1)
    elif kind == 'horse':
        f.poly([rear, (rear[0] - 7, rear[1] + 2), (rear[0] - 9, rear[1] + 12), (rear[0] - 4, rear[1] + 8)], (50, 34, 26), 0)
    # крылья позади
    if kind in ('dragon', 'gryphon'):
        wc = dark(fur, .25) if kind == 'dragon' else light(fur, .1)
        flap = math.sin(ph * 2) * 4 if mode == 'walk' else (-7, 4, 0)[t]
        span = 34 if kind == 'dragon' else 17
        root = (cx + 1, by - 5)
        wrist = (root[0] - span * .25, root[1] - span * .85 + flap)
        tips = [(wrist[0] - span * .55, wrist[1] + span * .1), (wrist[0] - span * .75, wrist[1] + span * .45), (wrist[0] - span * .6, wrist[1] + span * .8)]
        mem = [root, wrist, tips[0]]
        for i in range(1, 3):
            mid = ((tips[i - 1][0] + tips[i][0]) / 2 + 2.5, (tips[i - 1][1] + tips[i][1]) / 2 + 1.5)
            mem += [mid, tips[i]]
        mem += [(root[0] - span * .3, root[1] + 3)]
        f.poly(mem, wc, 0.5)
        f.cap(root, wrist, 1.6, dark(wc, .3), 0.6)
        for tp in tips: f.cap(wrist, tp, 0.8, dark(wc, .35), 0.6, True, 0.4)
        f.poly([(wrist[0], wrist[1]), (wrist[0] + 2, wrist[1] - 4), (wrist[0] + 1.5, wrist[1] + 1)], (230, 215, 180), 0.65)
    # ноги (дальние)
    def legs(z, far):
        for i, base in enumerate((rear, front)):
            phase = ph + (math.pi if (i == 1) != far else 0)
            sw = math.sin(phase) * (4 if mode == 'walk' else 0)
            if mode == 'atk' and i == 1: sw = (-2, 5, 3)[t]
            hipp = (base[0] + (2 if i == 0 else -2), base[1] + 2)
            foot = (hipp[0] + sw, gy - 0.5 - max(0, math.cos(phase)) * (1.5 if mode == 'walk' else 0))
            knee = ((hipp[0] + foot[0]) / 2 + (-1.5 if i == 0 else 1), (hipp[1] + foot[1]) / 2)
            if kind == 'dragon': knee = ((hipp[0] + foot[0]) / 2 + (-4 if i == 0 else 3), (hipp[1] + foot[1]) / 2 - 1)
            c = dark(fur, .3) if far else fur
            f.cap(hipp, knee, legR, c, z); f.cap(knee, foot, legR * .8, c, z)
            claw = (230, 220, 200) if kind in ('dragon', 'gryphon') else dark(c, .4)
            f.ell(foot[0] + 1, foot[1] - .3, legR * .9, 1.2, claw, z + 0.1)
    legs(1, True)
    # тело
    f.cap(rear, front, 6.0 if kind == 'wolf' else 7.2 if kind != 'dragon' else 8.5, fur, 2, True, 6.5 if kind == 'wolf' else 7.6 if kind != 'dragon' else 9)
    if kind in ('dragon',):
        f.cap((rear[0] + 3, rear[1] + 4), (front[0] - 2, front[1] + 4.5), 4, belly, 2.1)
        for k in range(5): f.line((rear[0] + 4 + k * 4.5, rear[1] + 2), (rear[0] + 4.5 + k * 4.5, rear[1] + 7.5), 0.6, dark(belly, .3), 2.2)
        for k in range(5): f.poly([(rear[0] + 2 + k * 5, by - 7), (rear[0] + 4 + k * 5, by - 11), (rear[0] + 6 + k * 5, by - 7)], dark(fur, .3), 2.05)
    elif kind in ('wolf', 'dog3'):
        f.poly([(front[0] - 4, by - 6), (front[0] + 3, by - 7), (front[0] + 4, by + 2), (front[0] - 6, by + 2)], light(fur, .1), 2.1)   # грива
    legs(3, False)
    # голова/шея
    if kind == 'dragon':
        neck_top = (front[0] + 9 + lean * .6, front[1] - 15 + (0, 5, 2)[t] if mode == 'atk' else front[1] - 15 + bob)
        nmid = (front[0] + 2, front[1] - 8)
        f.cap(front, nmid, 5.2, fur, 4, True, 4.2); f.cap(nmid, neck_top, 4.2, fur, 4.05, True, 3.4)
        for k in range(3): f.poly([(nmid[0] - 3 + k * 3, nmid[1] - 6 + k * -2), (nmid[0] - 4 + k * 3, nmid[1] - 10 + k * -2), (nmid[0] - 1 + k * 3, nmid[1] - 6 + k * -2)], dark(fur, .3), 3.95)
        f.cap((front[0] + 1.5, front[1] + 2), (nmid[0] + 3.2, nmid[1] + 0.5), 1.8, belly, 4.06)
        hdp = (neck_top[0] + 4, neck_top[1])
        f.ell(hdp[0], hdp[1], 5.5, 4.2, fur, 5)
        jaw_open = mode == 'atk' and t == 1
        f.poly([(hdp[0] + 2, hdp[1] - 2), (hdp[0] + 12, hdp[1] + 0), (hdp[0] + 11, hdp[1] + 2.5), (hdp[0] + 2, hdp[1] + 2)], fur, 5.1)
        f.poly([(hdp[0] + 2, hdp[1] + 2), (hdp[0] + 11, hdp[1] + 3 + (4 if jaw_open else 0)), (hdp[0] + 2, hdp[1] + 5)], dark(fur, .15), 5.05)
        f.cap((hdp[0] - 2, hdp[1] - 3), (hdp[0] - 8, hdp[1] - 9), 1.4, (230, 215, 180), 5.2, True, 0.4)
        f.cap((hdp[0] + 1, hdp[1] - 3.5), (hdp[0] - 3, hdp[1] - 11), 1.4, (230, 215, 180), 5.3, True, 0.4)
        f.dot(hdp[0] + 3, hdp[1] - 1.5, 1.0, eye, 5.4)
        if jaw_open:
            fc = rgb('#ff8a1a') if lum(fur) < 120 or fur[0] > fur[2] else rgb('#9ff0ff')
            f.poly([(hdp[0] + 11, hdp[1] + 2), (hdp[0] + 22, hdp[1] - 2), (hdp[0] + 24, hdp[1] + 6), (hdp[0] + 11, hdp[1] + 5)], fc, 6, False)
            f.poly([(hdp[0] + 11, hdp[1] + 2.5), (hdp[0] + 18, hdp[1] + 1), (hdp[0] + 19, hdp[1] + 4.5)], (255, 240, 180), 6.1, False)
        return f
    heads = [(0, 0)] if kind != 'dog3' else [(-3, -3), (0, 0), (3, -1)]
    for k, (dx, dy) in enumerate(heads):
        hp_ = (front[0] + 4 + dx + lean * .5, front[1] - 5 + dy + (0, 3, 1)[t] if mode == 'atk' else front[1] - 5 + dy + bob)
        z = 4 + k * 0.3
        if kind == 'gryphon':
            f.ell(hp_[0], hp_[1], 4.5, 4.5, light(fur, .45), z)
            f.poly([(hp_[0] + 3, hp_[1] - 1.5), (hp_[0] + 9, hp_[1] + 1), (hp_[0] + 3, hp_[1] + 3)], (230, 180, 60), z + 0.1)
            f.dot(hp_[0] + 1.5, hp_[1] - 1, 0.8, (30, 20, 20), z + 0.2)
            continue
        if kind == 'horse':
            continue
        f.ell(hp_[0], hp_[1], 4.6, 4.2, fur, z)
        f.cap((hp_[0] + 2, hp_[1] + 1), (hp_[0] + 8, hp_[1] + 2), 2.4, fur, z + 0.05, True, 1.6)
        f.poly([(hp_[0] - 2, hp_[1] - 2), (hp_[0] - 3, hp_[1] - 8), (hp_[0] + 1, hp_[1] - 3.5)], dark(fur, .1), z + 0.1)
        f.dot(hp_[0] + 8.5, hp_[1] + 1.3, 0.8, (25, 18, 18), z + 0.2)
        f.dot(hp_[0] + 2.2, hp_[1] - 1, 0.8, eye, z + 0.2)
        if mode == 'atk' and t == 1:
            f.poly([(hp_[0] + 2, hp_[1] + 3), (hp_[0] + 9, hp_[1] + 3.5), (hp_[0] + 3, hp_[1] + 6)], (130, 20, 30), z + 0.15, False)
            f.line((hp_[0] + 3, hp_[1] + 3.2), (hp_[0] + 8.5, hp_[1] + 3.5), 0.5, (240, 240, 230), z + 0.16)
    return f

def centaur(L, mode, t, size):
    f = quadruped({'fur': L.get('fur')}, mode, t, size, 'horse')
    W, H = size
    gy = H - 2
    ph = walk_ph(t) if mode == 'walk' else 0
    bob = -abs(math.sin(ph)) * 1.2 if mode == 'walk' else 0
    cx = W / 2 - 3
    front = (cx + 10.5, gy - 17 + bob)
    skin = rgb(L.get('skin', '#d8a880'))
    hip = (front[0] - 1, front[1] - 3); sh = (front[0] + 1, front[1] - 15)
    f.poly([(hip[0] - 4, hip[1] + 2), (hip[0] + 5, hip[1] + 2), (sh[0] + 5, sh[1] + 1), (sh[0] - 5, sh[1] + 1)], skin, 4.5)
    f.poly([(sh[0] - 5, sh[1] + 1), (sh[0] + 5, sh[1] + 1), (sh[0] + 4, sh[1] + 6), (sh[0] - 4, sh[1] + 6)], (80, 60, 40), 4.6)
    fa, wa = (D(5), D(0)) if mode == 'atk' else (D(60), D(55))
    shF = (sh[0] + 2.5, sh[1] + 2)
    hand = pol(shF, fa, 10)
    weapon(f, L.get('wpn', 'bow'), hand, wa, 0, 6.5)
    f.cap(shF, hand, 1.9, skin, 7)
    head(f, {'skin': L.get('skin'), 'head': 'none'}, (sh[0] + 1.5, sh[1] - 6), 8)
    f.poly([(sh[0] - 4, sh[1] - 11), (sh[0] + 4, sh[1] - 12), (sh[0] - 2, sh[1] - 3), (sh[0] - 6, sh[1] - 2)], (80, 50, 30), 8.5)
    return f

def bird(L, mode, t, size):
    W, H = size
    f = Fig(W, H)
    col = rgb(L.get('col', '#a07a52')); face = rgb(L.get('face', '#e8c8a8'))
    fire = L.get('fire'); beak = L.get('beak')
    ph = walk_ph(t) if mode == 'walk' else 0
    flap = math.sin(ph) * 7 if mode == 'walk' else (-9, 6, 0)[t]
    cy = H - 20 + (math.cos(ph) * 1.5 if mode == 'walk' else 0)
    cx = W / 2 - 2
    lean = (-2, 4, 1)[t] if mode == 'atk' else 0
    wc = col if not fire else rgb('#ff8a1a')
    for k, (z, ox) in enumerate(((0, -2), (6, 1))):
        root = (cx + ox, cy - 4)
        pts = [root, (root[0] - 8, root[1] - 10 + flap), (root[0] - 20, root[1] - 14 + flap * 1.2), (root[0] - 17, root[1] - 7 + flap),
               (root[0] - 20, root[1] - 3 + flap * .8), (root[0] - 13, root[1] + 1), (root[0] - 15, root[1] + 5 + flap * .4), (root[0] - 4, root[1] + 3)]
        f.poly(pts, dark(wc, .2) if k == 0 else wc, z)
        for j in range(3): f.line(root, (root[0] - 13 - j * 2.5, root[1] - 9 + j * 4 + flap * (1 - j * .3)), 0.6, dark(wc, .45), z + 0.1)
    # хвост
    tc = rgb('#ffd03a') if fire else dark(col, .1)
    f.poly([(cx - 4, cy + 2), (cx - 16, cy + 9), (cx - 13, cy + 3), (cx - 17, cy + 1)], tc, 0.5)
    # тело
    f.ell(cx + lean * .5, cy, 6.5, 7.5, col, 2)
    f.ell(cx + 2 + lean * .5, cy + 1.5, 3.5, 5, light(col, .3) if not fire else rgb('#ffd03a'), 2.1)
    # ноги-когти
    for k in (-1, 1):
        a = (cx + k * 2 + lean * .5, cy + 6); b = (cx + k * 2.5 + 1 + lean * .5, H - 3)
        f.cap(a, b, 1.0, (200, 160, 70), 1.5)
        f.cap(b, (b[0] + 3, b[1] + 0.5), 0.7, (60, 40, 30), 1.6)
    # голова
    hp_ = (cx + 4 + lean, cy - 9)
    if beak or fire:
        hc = face if not fire else rgb('#ffb030')
        f.ell(hp_[0], hp_[1], 4.5, 4.2, hc, 5)
        f.poly([(hp_[0] + 3, hp_[1] - 1.5), (hp_[0] + 9, hp_[1] + 0.5), (hp_[0] + 3, hp_[1] + 2.5)], (230, 180, 60), 5.1)
        f.dot(hp_[0] + 1.5, hp_[1] - 1, 0.8, (30, 20, 20) if not fire else (255, 255, 220), 5.2)
        if fire:
            for j in range(3): f.poly([(hp_[0] - 3 + j * 2, hp_[1] - 3), (hp_[0] - 6 + j * 3, hp_[1] - 10 - j), (hp_[0] - 1 + j * 2, hp_[1] - 4)], rgb('#ff6a1a'), 4.9)
    else:   # гарпия — женское лицо и волосы
        f.ell(hp_[0], hp_[1], 4.6, 4.8, face, 5)
        f.poly([(hp_[0] - 5, hp_[1] + 4), (hp_[0] - 5, hp_[1] - 3), (hp_[0], hp_[1] - 6), (hp_[0] + 4, hp_[1] - 4.5), (hp_[0] - 1, hp_[1] - 2.5), (hp_[0] - 2, hp_[1] + 7)], dark(col, .35), 5.1)
        f.dot(hp_[0] + 2.5, hp_[1] - 0.5, 0.8, (200, 40, 40), 5.2)
        if mode == 'atk' and t == 1: f.dot(hp_[0] + 3.2, hp_[1] + 2.3, 0.8, (90, 20, 30), 5.2)
    return f

def ghost(L, mode, t, size):
    W, H = size
    f = Fig(W, H)
    col = rgb(L.get('col', '#9ad8ff')); eye = rgb(L.get('eye') or '#ffffff')
    ph = walk_ph(t) if mode == 'walk' else 0
    cx = W / 2 - 1; cy = H - 26 + math.sin(ph) * 1.5
    lean = (-2, 4, 1)[t] if mode == 'atk' else 0
    wav = math.sin(ph * 2) * 2
    body = [(cx - 7 + lean * .3, cy - 6), (cx + 7 + lean * .3, cy - 6), (cx + 9 + lean * .5, cy + 8), (cx + 4 + wav, cy + 16), (cx + 1, cy + 12),
            (cx - 3 - wav, cy + 22), (cx - 6, cy + 13), (cx - 11 + wav, cy + 17), (cx - 9, cy + 6)]
    f.poly(body, col, 2)
    for k in range(3): f.line((cx - 4 + k * 4, cy - 2), (cx - 6 + k * 3 + wav, cy + 14), 0.7, dark(col, .35), 2.1)
    f.ell(cx + 1 + lean * .6, cy - 11, 6.5, 6.5, light(col, .1), 3)
    f.poly([(cx - 7 + lean * .6, cy - 7), (cx - 6, cy - 16), (cx + 1, cy - 19), (cx + 8, cy - 15), (cx + 8 + lean * .6, cy - 8)], dark(col, .2), 3.1)
    f.ell(cx + 3 + lean * .6, cy - 10, 3.6, 4, (16, 10, 24), 3.2, False)
    f.dot(cx + 4.4 + lean * .6, cy - 10.5, 1.0, eye, 3.3); f.dot(cx + 2 + lean * .6, cy - 10.5, 0.9, eye, 3.3)
    wpn = L.get('wpn')
    fa = D(70) if mode == 'walk' else [D(-40), D(10), D(40)][t]
    shF = (cx + 4 + lean, cy - 4)
    hand = pol(shF, fa, 10)
    if wpn == 'bow':
        fa = D(60) if mode == 'walk' else D(5); hand = pol(shF, fa, 10)
        weapon(f, 'bow', hand, fa, 0, 4, wood=light(col, .3))
    elif wpn == 'daggers':
        weapon(f, 'daggers', hand, fa, 0, 4.5, metal=light(col, .5))
    f.cap(shF, hand, 1.8, col, 5, True, 1.3)
    return f

def golem(L, mode, t, size):
    W, H = size
    f = Fig(W, H)
    col = rgb(L.get('col', '#8a8580')); glow = rgb(L.get('glow', '#c8a040'))
    bones = L.get('bones')
    crystal = col[2] > col[0] + 30 and col[2] > 180 or 'b08a' in L.get('col', '')
    ph = walk_ph(t) if mode == 'walk' else 0
    sw = math.sin(ph)
    gy = H - 2; cx = W / 2 - 1
    bob = -abs(math.cos(ph)) * 1.2 if mode == 'walk' else 0
    lean = (-2, 4, 2)[t] if mode == 'atk' else 0
    hipY = gy - 13 + bob; shY = gy - 33 + bob
    for side, z in ((-1, 1), (1, 3)):
        off = side * sw * 4 if mode == 'walk' else side * 3
        c = col if side > 0 else dark(col, .3)
        f.cap((cx + side * 4, hipY), (cx + side * 4 + off, gy - 3), 4.2, c, z)
        f.ell(cx + side * 4 + off + 1, gy - 2, 5, 2.5, dark(c, .1), z + 0.1)
    # корпус
    tor = [(cx - 12 + lean, shY), (cx + 11 + lean, shY - 1), (cx + 9 + lean * .5, hipY + 2), (cx - 9 + lean * .3, hipY + 2)]
    f.poly(tor, col, 4)
    if bones:
        for k in range(4): f.cap((cx - 8 + lean, shY + 5 + k * 4), (cx + 8 + lean, shY + 5.5 + k * 4), 1.0, light(col, .1), 4.1)
    elif crystal:
        for k in range(3): f.poly([(cx - 9 + k * 7 + lean, shY + 1), (cx - 7 + k * 7 + lean, shY - 8 - k * 2), (cx - 4 + k * 7 + lean, shY + 1)], light(col, .25), 3.9)
    else:
        f.line((cx - 6 + lean, shY + 4), (cx - 1 + lean, shY + 11), 1.0, glow, 4.2)
        f.line((cx - 1 + lean, shY + 11), (cx + 4 + lean, shY + 9), 1.0, glow, 4.2)
        f.line((cx + 3 + lean, shY + 15), (cx + 6 + lean, shY + 19), 0.9, glow, 4.2)
    f.ell(cx + 2 + lean, shY + 9, 2.5, 2.5, glow, 4.3, False)
    # голова
    hp_ = (cx + 3 + lean, shY - 4)
    f.poly([(hp_[0] - 5, hp_[1] + 3), (hp_[0] - 4, hp_[1] - 5), (hp_[0] + 5, hp_[1] - 5.5), (hp_[0] + 6, hp_[1] + 3)], light(col, .05), 5)
    f.line((hp_[0], hp_[1] - 1.5), (hp_[0] + 5, hp_[1] - 1.5), 1.3, glow, 5.1)
    # руки
    if mode == 'walk': fa, ba = D(80 - sw * 15), D(100 + sw * 15)
    else: fa = [D(-110), D(30), D(70)][t]; ba = D(100)
    for side, ang, z in ((-1, ba, 2), (1, fa, 6)):
        s_ = (cx + side * 11 + lean, shY + 3)
        e_ = pol(s_, ang, 9); h_ = pol(e_, ang + D(-10), 8)
        c = col if side > 0 else dark(col, .3)
        f.cap(s_, e_, 4.0, c, z); f.cap(e_, h_, 3.6, c, z, True, 4.8)
        f.ell(s_[0], s_[1], 5, 4.5, c, z + 0.1)
    return f

def ent(L, mode, t, size):
    W, H = size
    f = Fig(W, H)
    bark = rgb(L.get('col', '#5a3a20')); leaf = rgb(L.get('leaf', '#3f8a2f'))
    ph = walk_ph(t) if mode == 'walk' else 0
    sw = math.sin(ph); gy = H - 2; cx = W / 2
    lean = (-2, 3, 1)[t] if mode == 'atk' else 0
    for side, z in ((-1, 1), (1, 3)):
        off = side * sw * 3
        f.cap((cx + side * 3, gy - 12), (cx + side * 5 + off, gy - 2), 3.2, bark if side > 0 else dark(bark, .3), z)
        for r in (-1, 1): f.cap((cx + side * 5 + off, gy - 2), (cx + side * 5 + off + r * 4, gy - 0.5), 1.2, dark(bark, .2), z)
    f.poly([(cx - 8 + lean * .3, gy - 12), (cx + 8 + lean * .3, gy - 12), (cx + 7 + lean, gy - 36), (cx - 7 + lean, gy - 36)], bark, 4)
    for k in range(4): f.line((cx - 5 + k * 3 + lean, gy - 33), (cx - 4 + k * 3 + lean * .3, gy - 14), 0.8, dark(bark, .4), 4.1)
    f.ell(cx + 2 + lean, gy - 28, 5, 3.5, (20, 14, 10), 4.2, False)
    f.dot(cx + 3.5 + lean, gy - 28.5, 1.0, (180, 255, 120), 4.3); f.dot(cx + 0.5 + lean, gy - 28.5, 0.9, (180, 255, 120), 4.3)
    fa = D(-30 + sw * 10) if mode == 'walk' else [D(-120), D(10), D(50)][t]
    for side, ang, z in ((-1, D(-140 - sw * 10), 2), (1, fa, 6)):
        s_ = (cx + side * 7 + lean, gy - 30)
        e_ = pol(s_, ang, 10); h_ = pol(e_, ang + D(20), 7)
        f.cap(s_, e_, 2.4, bark, z); f.cap(e_, h_, 1.8, bark, z, True, 0.8)
        f.ell(h_[0], h_[1], 4, 3.5, leaf, z + 0.1)
    for (dx, dy, r) in ((-8, -40, 8), (4, -44, 9), (12, -37, 7), (-2, -36, 7), (0, -48, 6)):
        f.ell(cx + dx + lean, gy + dy, r, r * .85, leaf, 5)
    for (dx, dy) in ((-4, -42), (6, -46), (10, -38)):
        f.dot(cx + dx + lean, gy + dy, 1.4, (230, 120, 160), 5.2)
    return f

def spider(L, mode, t, size):
    W, H = size
    f = Fig(W, H)
    col = rgb(L.get('col', '#3a5a2a')); eye = rgb(L.get('eye') or '#ff3030')
    ph = walk_ph(t) if mode == 'walk' else 0
    gy = H - 2; cx = W / 2
    lean = (-2, 4, 1)[t] if mode == 'atk' else 0
    by = gy - 9
    for i in range(4):
        for far in (True, False):
            p = ph + i * 0.9 + (math.pi if far else 0)
            base = (cx + 2 - i * 2.5 + lean * .5, by - 1)
            dirx = 1 if i < 2 else -1
            knee = (base[0] + dirx * (6 + i), by - 9 - math.sin(p) * 2)
            foot = (base[0] + dirx * (10 + i * 2) + math.sin(p) * 2, gy - 0.5)
            if mode == 'atk' and i == 0 and not far: knee = (base[0] + 8, by - 13 + (0, -4, 0)[t]); foot = (base[0] + 14 + (0, 4, 2)[t], by - 4)
            c = dark(col, .45) if far else dark(col, .1)
            f.cap(base, knee, 1.1, c, 1 if far else 4); f.cap(knee, foot, 0.9, c, 1 if far else 4, True, 0.5)
    f.ell(cx - 7 + lean * .3, by - 2, 8, 6.5, col, 2)
    for k in range(3): f.line((cx - 12 + k * 4, by - 5 + k), (cx - 9 + k * 4, by - 7 + k), 0.9, mix(col, (220, 40, 40), .6), 2.1)
    f.ell(cx + 3 + lean, by, 5, 4, dark(col, .1), 3)
    for k, (dx, dy) in enumerate(((5.5, -1.5), (6.8, 0), (4, -2.5), (6, 1.5))):
        f.dot(cx + dx + lean, by + dy, 0.7, eye, 3.2)
    f.cap((cx + 7 + lean, by + 1.5), (cx + 8.5 + lean, by + 4), 0.6, (230, 220, 200), 3.3)
    return f

def kraken(L, mode, t, size):
    W, H = size
    f = Fig(W, H)
    col = rgb(L.get('col', '#5a2a5a')); maw = L.get('maw')
    ph = walk_ph(t) if mode == 'walk' else 0
    gy = H - 2; cx = W / 2
    lean = (-2, 3, 1)[t] if mode == 'atk' else 0
    for i in range(7):
        p = ph + i * 0.8
        a = (cx - 12 + i * 4, gy - 10)
        seg = [a]
        for j in range(4):
            prev = seg[-1]
            seg.append((prev[0] + (i - 3) * 1.6 + math.sin(p + j) * 2, prev[1] + 2.5 if j < 2 else prev[1] - 1 + math.cos(p + j) * 2))
        if mode == 'atk' and i in (5, 6):
            seg = [a, (a[0] + 6, a[1] - 8 + (0, -6, 0)[t]), (a[0] + 14 + (0, 8, 4)[t], a[1] - 14 + (0, 4, 2)[t]), (a[0] + 20 + (0, 10, 5)[t], a[1] - 10)]
        c = dark(col, .3) if i % 2 else col
        for j in range(len(seg) - 1):
            f.cap(seg[j], seg[j + 1], max(0.8, 2.6 - j * 0.6), c, 1 + (i % 2) * 3)
            if j: f.dot(seg[j][0], seg[j][1] + 1, 0.6, light(col, .45), 1.2 + (i % 2) * 3)
    f.ell(cx + lean * .4, gy - 22, 15, 14, col, 2)
    f.ell(cx - 3 + lean * .4, gy - 28, 6, 5, light(col, .15), 2.1)
    if maw:
        f.ell(cx + 4 + lean, gy - 16, 7, 5.5 + (0, 2, 1)[t] if mode == 'atk' else 5.5, (30, 8, 14), 2.3, False)
        for k in range(6):
            x = cx - 2 + k * 2.2 + lean
            f.poly([(x, gy - 20.5), (x + 1, gy - 17.5), (x + 2, gy - 20.5)], (240, 230, 210), 2.4, False)
            f.poly([(x, gy - 11), (x + 1, gy - 14), (x + 2, gy - 11)], (240, 230, 210), 2.4, False)
        for k in range(5): f.dot(cx - 9 + k * 4 + lean, gy - 30 + (k % 2) * 3, 1.1, (255, 80, 60), 2.5)
    else:
        for dx in (-5, 5):
            f.ell(cx + dx + lean, gy - 20, 3, 3.2, (255, 220, 90), 2.3, False)
            f.ell(cx + dx + 0.6 + lean, gy - 20, 1, 2.4, (20, 10, 10), 2.4, False)
    return f

def blob(L, mode, t, size):
    W, H = size
    f = Fig(W, H)
    col = rgb(L.get('col', '#3a4a3a')); glow = rgb(L.get('glow', '#5fffb0'))
    ph = walk_ph(t) if mode == 'walk' else 0
    gy = H - 2; cx = W / 2
    lean = (-2, 4, 1)[t] if mode == 'atk' else 0
    sq = math.sin(ph) * 1.5
    f.ell(cx + lean * .3, gy - 13 - sq * .5, 19 + sq, 13 - sq * .5, col, 1)
    f.ell(cx - 6 + lean * .2, gy - 20, 9, 8, light(col, .08), 1.1)
    for (dx, dy, k) in ((-9, -14, 0), (2, -21, 1), (10, -12, 2), (-2, -8, 3)):
        x, y = cx + dx + lean * .5, gy + dy
        f.ell(x, y, 3.6, 3.4, rgb('#d8d0b8'), 2 + k * .1)
        f.dot(x + 1.2, y - 0.6, 0.8, glow, 2.5 + k * .1); f.dot(x - 1, y - 0.6, 0.7, glow, 2.5 + k * .1)
        f.line((x - 1, y + 2), (x + 1.5, y + 2), 0.6, (40, 30, 30), 2.5)
    for k in range(5):
        a = D(-160 + k * 35)
        root = (cx + math.cos(a) * 14 + lean * .4, gy - 14 + math.sin(a) * 10)
        tip = pol(root, a + (0.4 if mode == 'atk' and t == 1 else 0), 6 + (k % 2) * 2)
        f.cap(root, tip, 1.5, dark(col, .2), 0.5, True, 0.6)
    f.line((cx - 14, gy - 5), (cx + 14, gy - 6), 1.0, glow, 3)
    return f

# ---------- описание монстров ----------
def load_mobs():
    src = open(os.path.join(ROOT, 'server', 'mobs.js'), encoding='utf8').read()
    out = []
    for m in re.finditer(r"^mob\('(\w+)', '([^']*)', '(\w+)',.*?look: (\{[^}]*\})", src, re.M):
        js = m.group(4)
        js = re.sub(r"(\w+):", r'"\1":', js).replace("'", '"')
        L = json.loads(js)
        out.append((m.group(1), m.group(2), L))
    return out

SIZES = {'hum': (60, 58), 'beast': (64, 46), 'dog3': (72, 54), 'bird': (64, 56), 'centaur': (64, 60), 'dragon': (100, 74),
         'ghost': (56, 60), 'golem': (64, 62), 'tree': (64, 72), 'kraken': (80, 64), 'spider': (64, 42), 'spiderling': (64, 42), 'blob': (64, 52)}

def draw(L, mode, t):
    b = L.get('b', 'hum')
    if b == 'beast' and L.get('upright'):
        L2 = dict(L, b='hum', skin=L.get('fur'), cloth=L.get('fur'), head='wolf', wpn='claws', torn=True)
        return humanoid(L2, mode, t, SIZES['hum'])
    if b == 'beast': return quadruped(L, mode, t, SIZES['beast'], 'wolf')
    if b == 'dog3': return quadruped(L, mode, t, SIZES['dog3'], 'dog3')
    if b == 'dragon': return quadruped(L, mode, t, SIZES['dragon'], 'dragon')
    if b == 'bird' and L.get('beak'): return quadruped({'fur': L.get('col')}, mode, t, SIZES['bird'], 'gryphon')
    if b == 'bird': return bird(L, mode, t, SIZES['bird'])
    if b == 'centaur': return centaur(L, mode, t, SIZES['centaur'])
    if b == 'ghost': return ghost(L, mode, t, SIZES['ghost'])
    if b == 'golem': return golem(L, mode, t, SIZES['golem'])
    if b == 'tree': return ent(L, mode, t, SIZES['tree'])
    if b in ('spider', 'spiderling'): return spider(L, mode, t, SIZES['spider'])
    if b == 'kraken': return kraken(L, mode, t, SIZES['kraken'])
    if b == 'blob': return blob(L, mode, t, SIZES['blob'])
    return humanoid(L, mode, t, SIZES['hum'])

def sheet(mid, L):
    frames = [draw(L, 'walk', t) for t in range(4)] + [draw(L, 'atk', t) for t in range(3)]
    glow = None
    if L.get('b') == 'ghost': glow = dark(rgb(L.get('col', '#9ad8ff')), .55)
    ims = [fr.render(glow=glow) for fr in frames]
    w, h = ims[0].size
    sh = Image.new('RGBA', (w * len(ims), h))
    for i, im in enumerate(ims): sh.paste(im, (i * w, 0))
    # рост фигуры (без оружия над головой) — по первому кадру
    a = np.array(ims[0])[..., 3] > 0
    ys = np.nonzero(a.any(1))[0]
    body = int(h - ys.min()) if len(ys) else h
    sh.save(os.path.join(OUT, f'{mid}.png'))
    b = L.get('b', 'hum')
    scale = {'dragon': 0.72, 'kraken': 0.8, 'golem': 0.82, 'tree': 0.8, 'dog3': 0.85, 'blob': 0.85, 'centaur': 0.85}.get(b, 0.86)
    return {'w': w, 'h': h, 'body': body, 'scale': scale}

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    mobs = load_mobs()
    only = set(sys.argv[1:])
    meta_path = os.path.join(ROOT, 'public', 'js', 'mobart.js')
    meta = {}
    if os.path.exists(meta_path):
        txt = open(meta_path, encoding='utf8').read()
        mm = re.search(r'=\s*(\{.*\});', txt, re.S)
        if mm: meta = json.loads(mm.group(1))
    # Нарисованные вручную листы (присланные картинки боссов) генератор не трогает
    hand = {'ancientDragon', 'abyssTitan', 'demonLord', 'dragonWhelp', 'orcChief', 'stoneTitan', 'devourer', 'trollShaman', 'gryphon', 'skeletonKing', 'kraken', 'cerberus', 'lichKing', 'phoenix', 'fallenAngel', 'gorgonBoss', 'chaosLord', 'legion', 'abyssAvatar'}
    for mid, name, L in mobs:
        if only and mid not in only: continue
        if mid in hand and mid not in only: continue
        meta[mid] = sheet(mid, L)
        print(mid, meta[mid])
    with open(meta_path, 'w', encoding='utf8') as fo:
        fo.write('// Создано tools/gen_mobs.py: размеры нарисованных листов монстров (4 кадра ходьбы, 3 кадра удара, смотрят вправо).\n')
        fo.write('window.MOB_ART = ' + json.dumps(meta, ensure_ascii=False, sort_keys=True) + ';\n')

# ---------- эффекты монстров ----------
FX_OUT = os.path.join(ROOT, 'public', 'assets', 'mobfx')
PROJ = {   # вид снаряда: основной цвет, свечение, форма
    'arrow': ('#e8dcc0', '#ff9a7a', 'arrow'), 'bolt': ('#c8c8d0', '#ff9a7a', 'bolt'), 'axe': ('#b8bcc8', '#ffd0a0', 'axe'),
    'feather': ('#e8d8b8', '#ffe0a0', 'feather'), 'leaf': ('#7fd36b', '#c8ff9a', 'leaf'), 'nature': ('#5fd17a', '#c8ff9a', 'orb'),
    'fireball': ('#ff8a1a', '#ffe08a', 'flame'), 'frost': ('#8ad3ff', '#e8f8ff', 'shard'), 'spark': ('#ffe94a', '#ffffff', 'orb'),
    'holy': ('#ffe8a0', '#ffffff', 'orb'), 'arcane': ('#c8a0ff', '#f0e0ff', 'orb'), 'dark': ('#9a4aff', '#e0b0ff', 'orb'),
    'necro': ('#5fffb0', '#d0ffe8', 'skull'), 'spirit': ('#9ff0ff', '#ffffff', 'orb'), 'venom': ('#8ad84a', '#e0ff9a', 'blob'),
    'illusion': ('#ff7ad0', '#ffe0f4', 'orb'),
}
def proj_frames(kind):
    col, glow, form = PROJ[kind]
    c, g = rgb(col), rgb(glow)
    frames = []
    for k in range(4):
        f = Fig(28, 14)
        wob = math.sin(k * math.pi / 2)
        if form in ('arrow', 'bolt'):
            f.cap((3, 7), (21, 7), 0.8 if form == 'arrow' else 1.1, (120, 84, 50), 1)
            f.poly([(20, 4), (26, 7), (20, 10)], c, 2)
            f.poly([(2, 4), (7, 7), (2, 10), (4, 7)], (230, 220, 200) if form == 'arrow' else (90, 90, 100), 2)
        elif form == 'axe':
            ang = k * math.pi / 2
            ctr = (14, 7)
            f.cap(pol(ctr, ang, -6), pol(ctr, ang, 6), 1.0, (120, 84, 50), 1)
            h = pol(ctr, ang, 5)
            f.poly([pol(h, ang + 1.4, 1), pol(h, ang - 1.7, 6), pol(pol(h, ang, -4), ang - 1.6, 6)], c, 2)
        elif form == 'feather':
            f.poly([(3, 8 + wob), (14, 4), (25, 7), (14, 10)], c, 1)
            f.line((3, 8 + wob), (25, 7), 0.6, dark(c, .4), 2)
        elif form == 'leaf':
            f.poly([(4, 7), (14, 3 + wob), (24, 7), (14, 11 - wob)], c, 1)
            f.line((5, 7), (23, 7), 0.6, dark(c, .4), 2)
        elif form == 'shard':
            f.poly([(3, 7), (16, 3.5), (26, 7), (16, 10.5)], c, 1)
            f.poly([(10, 6), (22, 6.5), (16, 8)], g, 2, False)
            for j in range(2): f.dot(4 - j * 2 + k % 2, 4 + j * 6, 0.8, g, 3)
        elif form == 'skull':
            for j in range(3): f.ell(10 - j * 3.5, 7 + math.sin(k + j) * 1.2, 3 - j * .7, 2.4 - j * .5, dark(c, .2 + j * .1), 0.5 - j * .1, False)
            f.ell(18, 7, 5, 4.6, c, 1)
            f.ell(19.5, 6, 1.3, 1.5, (20, 30, 25), 2, False); f.ell(16.5, 6, 1.2, 1.4, (20, 30, 25), 2, False)
            f.line((16, 9.5), (21, 9.5), 0.6, dark(c, .5), 2)
        else:   # сфера/пламя/капля: ядро и хвост
            tail = 6 + k % 2
            for j in range(4):
                f.ell(17 - j * 3.6 - wob * .5, 7 + math.sin(k + j * 1.7) * 1.1, 4.2 - j * .8, 3.6 - j * .7, mix(c, (40, 20, 50), j * .18), 1 - j * .1, False)
            if form == 'flame':
                f.poly([(13, 3), (22, 7), (13, 11), (16, 7)], rgb('#ffcc40'), 1.5, False)
            f.ell(18, 7, 4.2, 4.0, c, 2, False)
            f.ell(18.6, 6.5, 2.4, 2.2, g, 3, False)
            f.dot(19.5, 5.6, 0.9, (255, 255, 255), 4)
        frames.append(f.render(outline=dark(c, .7), tex=0.03))
    sh = Image.new('RGBA', (28 * 4, 14))
    for i, im in enumerate(frames): sh.paste(im, (i * 28, 0))
    return sh

def burst_frames():
    """Вспышка попадания (белая, игра красит её в цвет атаки): 6 кадров 40×40."""
    out = Image.new('RGBA', (40 * 6, 40))
    for k in range(6):
        f = Fig(40, 40)
        r = 4 + k * 3.2
        a = 1 - k / 6
        n = 8
        for i in range(n):
            ang = i * 2 * math.pi / n + k * 0.15
            p1 = pol((20, 20), ang, r * .4); p2 = pol((20, 20), ang, r * (1.1 if i % 2 else .8))
            f.cap(p1, p2, max(0.4, 1.6 * a), (255, 255, 255), 1, False, 0.3)
        if k < 4: f.ell(20, 20, 5 - k, 5 - k, (255, 255, 255), 2, False)
        for i in range(5):
            ang = i * 1.3 + k * .4
            p = pol((20, 20), ang, r * 1.1 + 2)
            if k > 0: f.dot(p[0], p[1], max(0.5, 1.3 * a), (255, 255, 255), 3)
        out.paste(f.render(outline=(200, 200, 200), tex=0), (k * 40, 0))
    return out

def rune_circle():
    """Круг-предупреждение под атакой по области (белый, красится): 192×192, вид сверху."""
    f = Fig(96, 96)
    im = f._new(); d = ImageDraw.Draw(im)
    S = SS
    d.ellipse([4 * S, 4 * S, 92 * S, 92 * S], outline=255, width=int(2.4 * S))
    d.ellipse([12 * S, 12 * S, 84 * S, 84 * S], outline=255, width=int(1.2 * S))
    for i in range(12):
        a = i * math.pi / 6
        x, y = 48 + math.cos(a) * 41, 48 + math.sin(a) * 41
        d.regular_polygon((x * S, y * S, 2.4 * S), 3 + i % 2, rotation=i * 30, fill=255)
    pts = [(48 + math.cos(i * 4 * math.pi / 5 - math.pi / 2) * 34, 48 + math.sin(i * 4 * math.pi / 5 - math.pi / 2) * 34) for i in range(6)]
    d.line([(x * S, y * S) for x, y in pts], 255, int(1.2 * S))
    f._add(im, (255, 255, 255), 1, False)
    return f.render(outline=(190, 190, 190), tex=0).resize((192, 192), Image.NEAREST)

def gen_fx():
    os.makedirs(FX_OUT, exist_ok=True)
    for k in PROJ: proj_frames(k).save(os.path.join(FX_OUT, f'proj_{k}.png'))
    burst_frames().save(os.path.join(FX_OUT, 'burst.png'))
    rune_circle().save(os.path.join(FX_OUT, 'rune.png'))
    print('fx:', len(PROJ), 'снарядов, вспышка, круг')

if __name__ == '__main__' and (not sys.argv[1:] or 'fx' in sys.argv[1:]):
    gen_fx()
