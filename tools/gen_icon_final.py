"""A1 定稿：泼墨墨环 + 唱片细纹 + 剑意音符 + 金印"""
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

# 唱片细纹浓度（原来 38/80 太淡，几乎看不见）；可用环境变量出对比稿
GROOVE_MIN = int(os.environ.get('GROOVE_MIN', '60'))
GROOVE_MAX = int(os.environ.get('GROOVE_MAX', '125'))
# 细纹线宽（相对画布 S）：原来 0.0032 太细，可调
GROOVE_W = float(os.environ.get('GROOVE_W', '0.0042'))
SUFFIX = os.environ.get('OUT_SUFFIX', '')


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
    draw.polygon(pts, fill=color + (alpha,))


def ring(draw, cx, cy, r, thick, color, seed, dry=0.28, alpha_min=170, alpha_max=255, step=0.55):
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
        alpha = int(alpha_min + (alpha_max - alpha_min) * rnd.random()) if n > dry else int(alpha_min * 0.45)
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


def build():
    bg = paper(S)
    cx = cy = S / 2

    # 外洇
    halo = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ring(ImageDraw.Draw(halo), cx, cy, S * 0.335, S * 0.030, INK, 5, dry=0.42)
    halo = halo.filter(ImageFilter.GaussianBlur(S * 0.020))
    r, g, b, a = halo.split()
    bg.alpha_composite(Image.merge('RGBA', (r, g, b, a.point(lambda v: int(v * 0.30)))))

    ink = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(ink)

    # 唱片细纹：从内到外，越靠外越淡
    grooves = [0.272, 0.252, 0.232, 0.212, 0.192, 0.172, 0.152]
    for i, g_ in enumerate(grooves):
        fade = 1.0 - i / (len(grooves) + 3)
        ring(d, cx, cy, S * g_, S * GROOVE_W, INK, 100 + i,
             dry=0.34, alpha_min=int(GROOVE_MIN * fade), alpha_max=int(GROOVE_MAX * fade), step=0.42)

    # 主墨环
    ring(d, cx, cy, S * 0.305, S * 0.040, INK, 42, dry=0.28)
    splashes(d, cx, cy, S * 0.305, INK, 77)
    bg.alpha_composite(ink)

    # 音符
    note = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    quaver(ImageDraw.Draw(note), S * 0.485, S * 0.545, S * 0.40, INK)
    bg.alpha_composite(note)

    # 金印
    sl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sl)
    sx, sy, sz = cx + S * 0.245, cy + S * 0.215, S * 0.030
    sd.polygon([(sx, sy - sz), (sx + sz, sy), (sx, sy + sz), (sx - sz, sy)], fill=GOLD + (255,))
    bg.alpha_composite(sl)

    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    out.paste(bg, (0, 0), rounded_mask(S))
    return out


master = build()
master.resize((512, 512), Image.LANCZOS).save(f'{OUT}/MX_icon_512{SUFFIX}.png')
master.save(f'{OUT}/MX_icon_master{SUFFIX}.png')

# 尺寸预览条：192 / 144 / 96 / 72 / 48，白底与深底各一行
sizes = [192, 144, 96, 72, 48]
pad = 24
row_w = sum(sizes) + pad * (len(sizes) + 1)
row_h = max(sizes) + pad
sheet = Image.new('RGB', (row_w, row_h * 2 + 12), (255, 255, 255))
for row, bgcol in enumerate([(255, 255, 255), (32, 34, 40)]):
    y0 = row * (row_h + 6)
    ImageDraw.Draw(sheet).rectangle([0, y0, row_w, y0 + row_h], fill=bgcol)
    x = pad
    for s in sizes:
        im = master.resize((s, s), Image.LANCZOS)
        sheet.paste(im, (x, y0 + (row_h - s) // 2), im)
        x += s + pad
sheet.save(f'{OUT}/MX_icon_sizes{SUFFIX}.png')
print('ok')
