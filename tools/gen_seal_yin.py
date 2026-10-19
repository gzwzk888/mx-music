"""「印」字白文印生成器 —— 已停用，仅作历史存档

⚠️ 当前关于页用的是**篆书「吴」**白文印（assets/seal_yin_master.png），
   来源是 b126 的成品 APK（res/1l.png），不是本脚本生成。
   本脚本只生成「印」字版，视觉上像单位公章，已弃用；改印章请直接替换图片。

原始说明：
「印」字白文印：真实字形方化 + 挖空 + 残边

白文关键：印面是红的，字的位置要**从红色里挖掉**（透明，透出纸色），
不是把白字盖在红底上——否则字一超出印面就露出白块。

输出：
  icons/seal_yin_master.png   1024 母版（透明背景）
  icons/seal_yin_384.png      App 资产尺寸
  icons/seal_yin_sizes.png    160/96/72/48/32 尺寸栅格
"""
import os
import random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets')
S = 1024
RED = (170, 45, 38)
RED_DARK = (134, 30, 26)
FONT = 'C:/Windows/Fonts/simhei.ttf'
GLYPH = '印'

PAD = int(S * 0.075)          # 印面留白
GLYPH_BOX = 0.60              # 字面占画布比例（留足边距，旋转也不溢出）
BOLD = 3                      # 膨胀次数 = 笔画加粗


def glyph_mask():
    font = ImageFont.truetype(FONT, int(S * 0.80))
    img = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(img)
    bbox = d.textbbox((0, 0), GLYPH, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((S - w) // 2 - bbox[0], (S - h) // 2 - bbox[1]), GLYPH, font=font, fill=255)

    img = img.point(lambda v: 255 if v > 110 else 0)
    for _ in range(BOLD):
        img = img.filter(ImageFilter.MaxFilter(3))

    # 裁到字身，再等比缩到字面框内（宽高都受限）
    box = img.getbbox()
    if box:
        img = img.crop(box)
    target = int(S * GLYPH_BOX)
    scale = min(target / img.width, target / img.height)
    tw, th = int(img.width * scale), int(img.height * scale)
    img = img.resize((tw, th), Image.LANCZOS)

    canvas = Image.new('L', (S, S), 0)
    canvas.paste(img, ((S - tw) // 2, (S - th) // 2))
    return canvas


def build():
    rnd = random.Random(11)
    radius = int(S * 0.009)
    box = [PAD, PAD, S - PAD, S - PAD]

    # 1) 红色印面
    face = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(face).rounded_rectangle(box, radius=radius, fill=RED + (255,))

    # 2) 白文：把字从红色里挖掉（alpha 置 0，透出纸色）
    mask = glyph_mask()
    r, g, b, a = face.split()
    a = Image.composite(Image.new('L', (S, S), 0), a, mask)
    face = Image.merge('RGBA', (r, g, b, a))

    # 3) 内沿暗红，模拟印泥边
    edge = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle(
        box, radius=radius, outline=RED_DARK + (90,), width=max(2, int(S * 0.003)))
    face = Image.alpha_composite(face, edge)

    # 4) 残边：少量、只打外沿
    chips = Image.new('L', (S, S), 0)
    cd = ImageDraw.Draw(chips)
    for _ in range(46):
        side = rnd.randint(0, 3)
        depth = rnd.uniform(0.003, 0.014) * S
        along = rnd.uniform(0.08, 0.92) * S
        w = rnd.uniform(0.010, 0.040) * S
        h = rnd.uniform(0.006, 0.016) * S
        if side == 0:
            cd.ellipse([along - w / 2, PAD - h / 2, along + w / 2, PAD + depth], fill=255)
        elif side == 1:
            cd.ellipse([along - w / 2, S - PAD - depth, along + w / 2, S - PAD + h / 2], fill=255)
        elif side == 2:
            cd.ellipse([PAD - h / 2, along - w / 2, PAD + depth, along + w / 2], fill=255)
        else:
            cd.ellipse([S - PAD - depth, along - w / 2, S - PAD + h / 2, along + w / 2], fill=255)
    face = Image.composite(Image.new('RGBA', (S, S), (0, 0, 0, 0)), face, chips)

    # 5) 不旋转：倾斜交给 About 页样式（-4deg），避免叠加成过度歪斜
    return face


master = build()
master.save(f'{OUT}/seal_yin_master.png')
master.resize((384, 384), Image.LANCZOS).save(f'{OUT}/seal_yin_384.png')

sizes = [160, 96, 72, 48, 32]
pad = 22
W = sum(sizes) + pad * (len(sizes) + 1)
H = max(sizes) + pad * 2
sheet = Image.new('RGB', (W, H), (246, 244, 237))
x = pad
for s in sizes:
    im = master.resize((s, s), Image.LANCZOS)
    sheet.paste(im, (x, (H - s) // 2), im)
    x += s + pad
sheet.save(f'{OUT}/seal_yin_sizes.png')
print('ok')
