"""把定稿图标写入 res/：mipmap、自适应前景、启动图、菜单 logo"""
import math
import os
import random
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
JSIMG = os.path.join(ROOT, 'src', 'resources', 'images')
ICONS = os.path.join(ROOT, 'assets')
S = 1024
INK = (14, 15, 18)
GOLD = (204, 166, 58)
PAPER = (246, 244, 237)

# 唱片细纹浓度基准（原 38/80 太淡）；与 gen_icon_final.py 保持一致
GROOVE_MIN = 60
GROOVE_MAX = 125
# 细纹线宽（相对画布 S），原 0.0032
GROOVE_W = 0.0042


def rounded_mask(size, ratio=0.22):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * ratio), fill=255)
    return m


def circle_mask(size):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).ellipse([0, 0, size - 1, size - 1], fill=255)
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


def ring(draw, cx, cy, r, thick, color, seed, dry=0.28, amin=170, amax=255, step=0.55,
         start=0, end=360, taper=False):
    rnd = random.Random(seed)
    ang = start
    span = max(end - start, 1)
    while ang < end:
        a = math.radians(ang)
        rr = r * (1 + 0.006 * math.sin(a * 5 + 0.6))
        x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr
        k = (0.45 + 1.0 * math.sin((ang - start) / span * math.pi)) if taper else 1.0
        n = rnd.random()
        if n < dry * 0.5:
            ang += 1.8
            continue
        w = thick * (0.6 + 0.75 * rnd.random()) * k * (0.45 if n < dry else 1.0)
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


def art(groove=1.0, arc=False, with_bg=True, pad=0.0, seal=True):
    """pad: 0~1，内容整体缩小的比例（自适应图标安全区用）"""
    k = 1 - pad
    bg = paper(S) if with_bg else Image.new('RGBA', (S, S), (0, 0, 0, 0))
    cx = cy = S / 2

    if with_bg:
        halo = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        ring(ImageDraw.Draw(halo), cx, cy, S * 0.335 * k, S * 0.030 * k, INK, 5, dry=0.42,
             start=20 if arc else 0, end=250 if arc else 360, taper=arc)
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
    ring(d, cx, cy, S * 0.305 * k, S * 0.040 * k, INK, 42, dry=0.28,
         start=20 if arc else 0, end=250 if arc else 360, taper=arc)
    splashes(d, cx, cy, S * 0.305 * k, INK, 77, count=20 if arc else 34)
    bg.alpha_composite(ink)

    note = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    off = (1 - k) / 2
    quaver(ImageDraw.Draw(note), S * (0.485 - off + (0.02 if arc else 0)),
           S * (0.545 - off), S * 0.40 * k, INK)
    bg.alpha_composite(note)

    if seal and not arc:
        sl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sl)
        sx, sy, sz = cx + S * 0.245 * k, cy + S * 0.215 * k, S * 0.030 * k
        sd.polygon([(sx, sy - sz), (sx + sz, sy), (sx, sy + sz), (sx - sz, sy)], fill=GOLD + (255,))
        bg.alpha_composite(sl)
    return bg


# ---------- 1) 普通图标 + 圆形图标 ----------
plan = [('mdpi', 48, 0.0), ('hdpi', 72, 0.35), ('xhdpi', 96, 0.62), ('xxhdpi', 144, 0.85), ('xxxhdpi', 192, 1.0)]
for name, size, gv in plan:
    master = art(groove=gv)
    sq = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sq.paste(master, (0, 0), rounded_mask(S))
    sq.resize((size, size), Image.LANCZOS).save(f'{RES}/mipmap-{name}/ic_launcher.png')

    rd = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    rd.paste(master, (0, 0), circle_mask(S))
    rd.resize((size, size), Image.LANCZOS).save(f'{RES}/mipmap-{name}/ic_launcher_round.png')

# ---------- 2) 自适应图标前景（透明，内容缩到安全区） ----------
fg_plan = [('mdpi', 108), ('hdpi', 162), ('xhdpi', 216), ('xxhdpi', 324), ('xxxhdpi', 432)]
fg_full = art(groove=1.0, with_bg=False, pad=0.0, seal=True)
for name, size in fg_plan:
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    inner = int(size * 0.66)
    scaled = fg_full.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    canvas.paste(scaled, (off, off), scaled)
    canvas.save(f'{RES}/drawable-{name}/ic_launcher_foreground.png')

# ---------- 3) 启动图（宣纸底 + 居中图标） ----------
splash_sizes = [('mdpi', (270, 480)), ('hdpi', (356, 634)), ('xhdpi', (540, 960)),
                ('xxhdpi', (810, 1440)), ('xxxhdpi', (1080, 1920))]
master = art(groove=1.0)
for name, wh in splash_sizes:
    w, h = wh
    canvas = Image.new('RGB', (w, h), PAPER)
    icon_px = int(w * 0.42)
    icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    icon.paste(master, (0, 0), rounded_mask(S))
    icon = icon.resize((icon_px, icon_px), Image.LANCZOS)
    canvas.paste(icon, ((w - icon_px) // 2, int(h * 0.36)), icon)
    canvas.save(f'{RES}/drawable-{name}/launch_screen.png')

# ---------- 4) 菜单 logo（A5：一笔弧 + 音符） ----------
a5 = art(groove=0.0, arc=True, pad=0.10)
a5r = Image.new('RGBA', (S, S), (0, 0, 0, 0))
a5r.paste(a5, (0, 0), rounded_mask(S))
a5r.resize((192, 192), Image.LANCZOS).save(f'{JSIMG}/mx_logo.png')

# 预览
prev = Image.new('RGB', (760, 300), (250, 250, 250))
d = ImageDraw.Draw(prev)
d.text((16, 10), 'ic_launcher  xxxhdpi 192', fill=(30, 30, 30))
prev.paste(Image.open(f'{RES}/mipmap-xxxhdpi/ic_launcher.png'), (16, 34), Image.open(f'{RES}/mipmap-xxxhdpi/ic_launcher.png'))
d.text((230, 10), 'round', fill=(30, 30, 30))
prev.paste(Image.open(f'{RES}/mipmap-xxxhdpi/ic_launcher_round.png'), (230, 34), Image.open(f'{RES}/mipmap-xxxhdpi/ic_launcher_round.png'))
d.text((444, 10), 'foreground (adaptive)', fill=(30, 30, 30))
fg = Image.open(f'{RES}/drawable-xxxhdpi/ic_launcher_foreground.png').resize((192, 192))
prev.paste(fg, (444, 34), fg)
d.text((652, 10), 'menu logo A5', fill=(30, 30, 30))
lg = Image.open(f'{JSIMG}/mx_logo.png').resize((96, 96))
prev.paste(lg, (652, 34), lg)
prev.save(f'{ICONS}/mx_assets_preview.png')
print('assets written')
