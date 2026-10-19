"""按尺寸自适应渲染：小图标淡化唱片细纹，保证 48px 不糊"""
import math
import os
import random
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets')
S = 1024
INK = (14, 15, 18)
GOLD = (204, 166, 58)
PAPER = (246, 244, 237)

# 唱片细纹浓度基准（原 38/80 太淡）；与 gen_icon_final.py 保持一致
GROOVE_MIN = 60
GROOVE_MAX = 125
GROOVE_W = 0.0042


def rounded_mask(size, ratio=0.22):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * ratio), fill=255)
    return m


def paper(size):
    img = Image.new('RGB', (size, size), PAPER)
    px = img.load()
    rnd = random.Random(11)
    for y in range(0, size, 2):
        for x in range(0, size, 2):
            n = rnd.randint(-5, 5)
            r, g, b = px[x, y]
            px[x, y] = (r + n, g + n, b + n)
    return img.convert('RGBA').filter(ImageFilter.GaussianBlur(0.5))


def brush(draw, x, y, angle, length, width, color, alpha):
    pts = []
    for i in range(12):
        t = 2 * math.pi * i / 12
        ex, ey = math.cos(t) * length / 2, math.sin(t) * width / 2
        pts.append((x + ex * math.cos(angle) - ey * math.sin(angle),
                    y + ex * math.sin(angle) + ey * math.cos(angle)))
    draw.polygon(pts, fill=color + (max(0, min(255, alpha)),))


def ring(draw, cx, cy, r, thick, color, seed, dry=0.28, amin=170, amax=255, step=0.55):
    rnd = random.Random(seed)
    ang = 0.0
    while ang < 360:
        a = math.radians(ang)
        rr = r * (1 + 0.006 * math.sin(a * 5 + 0.6))
        x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr
        n = rnd.random()
        if n < dry * 0.5:
            ang += 1.8
            continue
        w = thick * (0.6 + 0.75 * rnd.random()) * (0.45 if n < dry else 1.0)
        length = thick * (1.5 + 1.1 * rnd.random())
        alpha = int(amin + (amax - amin) * rnd.random()) if n > dry else int(amin * 0.45)
        brush(draw, x, y, a + math.pi / 2 + rnd.uniform(-0.1, 0.1), length, w, color, alpha)
        ang += step


def splashes(draw, cx, cy, r, color, seed, count=34):
    rnd = random.Random(seed)
    for _ in range(count):
        a = rnd.uniform(0, 2 * math.pi)
        d = r * rnd.uniform(1.02, 1.18)
        x, y = cx + math.cos(a) * d, cy + math.sin(a) * d
        rr = rnd.uniform(1.0, r * 0.018)
        draw.ellipse([x - rr, y - rr, x + rr, y + rr], fill=color + (int(30 + 55 * rnd.random()),))


def quaver(draw, cx, cy, h, color):
    head_w, head_h = h * 0.44, h * 0.30
    rot = math.radians(-24)
    pts = []
    for i in range(28):
        t = 2 * math.pi * i / 28
        ex, ey = math.cos(t) * head_w / 2, math.sin(t) * head_h / 2
        pts.append((cx + ex * math.cos(rot) - ey * math.sin(rot),
                    cy + ex * math.sin(rot) + ey * math.cos(rot)))
    draw.polygon(pts, fill=color + (255,))
    sx = cx + head_w * 0.42
    sw = max(4, int(h * 0.075))
    top = cy - h * 0.70
    draw.polygon([(sx - sw / 2, cy + head_h * 0.05), (sx + sw / 2, cy + head_h * 0.05),
                  (sx + sw / 2, top), (sx - sw / 2, top)], fill=color + (255,))
    draw.polygon([(sx + sw / 2, top), (sx + h * 0.40, top + h * 0.12),
                  (sx + h * 0.30, top + h * 0.155), (sx + sw / 2, top + h * 0.075)], fill=color + (255,))
    draw.polygon([(sx + sw / 2, top + h * 0.20), (sx + h * 0.34, top + h * 0.31),
                  (sx + h * 0.25, top + h * 0.335), (sx + sw / 2, top + h * 0.26)], fill=color + (255,))


def build(groove=1.0, rounded=True, pad_ratio=0.0, bg_fill=True):
    bg = paper(S) if bg_fill else Image.new('RGBA', (S, S), (0, 0, 0, 0))
    cx = cy = S / 2
    k = 1 - pad_ratio

    if bg_fill:
        halo = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        ring(ImageDraw.Draw(halo), cx, cy, S * 0.335 * k, S * 0.030 * k, INK, 5, dry=0.42)
        halo = halo.filter(ImageFilter.GaussianBlur(S * 0.020))
        r, g, b, a = halo.split()
        bg.alpha_composite(Image.merge('RGBA', (r, g, b, a.point(lambda v: int(v * 0.30)))))

    ink = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(ink)

    if groove > 0:
        for i, g_ in enumerate([0.272, 0.252, 0.232, 0.212, 0.192, 0.172, 0.152]):
            fade = (1.0 - i / 10) * groove
            ring(d, cx, cy, S * g_ * k, S * GROOVE_W * k, INK, 100 + i,
                 dry=0.34, amin=int(GROOVE_MIN * fade), amax=int(GROOVE_MAX * fade), step=0.42)

    ring(d, cx, cy, S * 0.305 * k, S * 0.040 * k, INK, 42, dry=0.28)
    splashes(d, cx, cy, S * 0.305 * k, INK, 77)
    bg.alpha_composite(ink)

    note = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    quaver(ImageDraw.Draw(note), S * (0.485 - (1 - k) / 2), S * (0.545 - (1 - k) / 2), S * 0.40 * k, INK)
    bg.alpha_composite(note)

    sl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sl)
    sx = cx + S * 0.245 * k
    sy = cy + S * 0.215 * k
    sz = S * 0.030 * k
    sd.polygon([(sx, sy - sz), (sx + sz, sy), (sx, sy + sz), (sx - sz, sy)], fill=GOLD + (255,))
    bg.alpha_composite(sl)

    if rounded:
        out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        out.paste(bg, (0, 0), rounded_mask(S))
        return out
    return bg


# 各尺寸对应的细纹浓度
plan = [
    ('mdpi', 48, 0.0),
    ('hdpi', 72, 0.35),
    ('xhdpi', 96, 0.62),
    ('xxhdpi', 144, 0.85),
    ('xxxhdpi', 192, 1.0),
]

rendered = []
for name, size, gv in plan:
    master = build(groove=gv)
    im = master.resize((size, size), Image.LANCZOS)
    im.save(f'{OUT}/ic_launcher_{name}.png')
    rendered.append((name, size, im))

# 深底/白底预览条
pad = 22
W = sum(s for _, s, _ in rendered) + pad * (len(rendered) + 1)
H = max(s for _, s, _ in rendered) * 2 + pad * 3
sheet = Image.new('RGB', (W, H), (255, 255, 255))
d = ImageDraw.Draw(sheet)
for row, bgc in enumerate([(255, 255, 255), (30, 32, 38)]):
    y0 = pad + row * (max(s for _, s, _ in rendered) + pad)
    d.rectangle([0, y0 - 6, W, y0 + max(s for _, s, _ in rendered) + 6], fill=bgc)
    x = pad
    for name, size, im in rendered:
        sheet.paste(im, (x, y0 + (144 // 2)), im)
        x += size + pad
sheet.save(f'{OUT}/MX_icon_final_sizes.png')
print('ok')
