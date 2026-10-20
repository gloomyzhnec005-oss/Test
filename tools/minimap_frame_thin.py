import sys, numpy as np
from PIL import Image
src = Image.open(sys.argv[1]).convert('RGBA'); t = float(sys.argv[2]); out = sys.argv[3]
A = np.asarray(src).astype(np.float32); N = A.shape[0]
L, R, T, B = 161, 1091, 188, 1067  # окно карты в исходнике
# 1) отдельно — компас (верх по центру) и табличка (низ по центру)
def cut(x0, y0, x1, y1): return src.crop((x0, y0, x1, y1))
comp = cut(468, 0, 788, 308); plate = cut(372, 985, 882, 1165)
# у компаса оставляем только медальон и четыре луча, у таблички — саму табличку без кусков полосы по бокам
def mask(im, keep):
    a = np.asarray(im).copy(); h, w = a.shape[:2]; yy, xx = np.mgrid[0:h, 0:w]
    a[..., 3] = (a[..., 3] * keep(xx, yy)).astype(np.uint8); return Image.fromarray(a, 'RGBA')
comp = mask(comp, lambda x, y: (np.hypot(x - 160, y - 165) < 112) | ((abs(x - 160) < 26) & (abs(y - 165) < 150)) | ((abs(y - 165) < 20) & (abs(x - 160) < 150)))
plate = mask(plate, lambda x, y: (x > 40) & (x < 470))
# 2) убираем их с основы: участок полосы между ними заменяем соседним куском той же полосы
base = A.copy()
def patch(dst_x0, dst_x1, y0, y1, src_x0):
    # ровная полоса: один гладкий столбец исходной рамки, повторённый по ширине
    base[y0:y1, dst_x0:dst_x1] = A[y0:y1, src_x0:src_x0 + 1]
patch(468, 788, 85, 200, 462); base[200:308, 468:788] = 0
patch(372, 882, 1040, 1140, 366); base[985:1040, 372:882] = 0; base[1140:1165, 372:882] = 0
# 3) сжимаем полосы по краям в t раз: новая координата → старая
def mapping(lo, hi):
    lo2, hi2 = lo * t, N - (N - hi) * t
    xs = np.arange(N, dtype=np.float32)
    old = np.where(xs < lo2, xs / t, np.where(xs > hi2, hi + (xs - hi2) / t, lo + (xs - lo2) * (hi - lo) / (hi2 - lo2)))
    return np.clip(old, 0, N - 1).astype(int), lo2, hi2
mx, L2, R2 = mapping(L, R); my, T2, B2 = mapping(T, B)
thin = base[my][:, mx]
img = Image.fromarray(thin.clip(0, 255).astype(np.uint8), 'RGBA')
# 4) компас и табличку — обратно, уменьшенными, по центру своих полос
k = 0.62
c2 = comp.resize((int(comp.width * k), int(comp.height * k)), Image.LANCZOS)
img.alpha_composite(c2, ((N - c2.width) // 2, max(0, int(T2 * 0.55 - c2.height * 0.55))))
# табличка — широкая, для названия зоны: края (с уголками) как есть, середина растянута
PW, PK = int(N * 0.86), 0.8
pc = plate.crop((40, 0, 470, plate.height)); cap = 95
ph = int(pc.height * PK)
left = pc.crop((0, 0, cap, pc.height)).resize((int(cap * PK), ph), Image.LANCZOS)
right = pc.crop((pc.width - cap, 0, pc.width, pc.height)).resize((int(cap * PK), ph), Image.LANCZOS)
mid = pc.crop((cap, 0, pc.width - cap, pc.height))
# середина: левая и правая половины без центрального украшения, растянуты; украшение — по центру
cw = mid.width; orn = 70
mL = mid.crop((0, 0, cw // 2 - orn // 2, mid.height)); mR = mid.crop((cw // 2 + orn // 2, 0, cw, mid.height)); mO = mid.crop((cw // 2 - orn // 2, 0, cw // 2 + orn // 2, mid.height))
inner = PW - left.width - right.width; ow = int(orn * PK); half = (inner - ow) // 2
p2 = Image.new('RGBA', (PW, ph))
p2.alpha_composite(left, (0, 0)); p2.alpha_composite(mL.resize((half, ph), Image.LANCZOS), (left.width, 0))
p2.alpha_composite(mO.resize((ow, ph), Image.LANCZOS), (left.width + half, 0)); p2.alpha_composite(mR.resize((inner - half - ow, ph), Image.LANCZOS), (left.width + half + ow, 0))
p2.alpha_composite(right, (PW - right.width, 0))
py = int(B2 + (N - B2) * 0.3 - p2.height * 0.5); py = min(py, N - p2.height)
img.alpha_composite(p2, ((N - p2.width) // 2, py))
img.save(out)
print('window', round(L2 / N * 100, 2), round(T2 / N * 100, 2), round((R2 - L2) / N * 100, 2), round((B2 - T2) / N * 100, 2), 'plate y', round((py + p2.height / 2) / N * 100, 2), 'plate w', round(PW / N * 100, 1), 'h', round(p2.height / N * 100, 1))
