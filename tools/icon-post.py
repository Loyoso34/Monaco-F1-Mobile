# Finishing pass for the app icon (called by tools/make-icons.mjs):
#   python3 icon-post.py raw.png outdir
# 2048 px studio render -> cinematic grade (red / blue atmosphere behind the car, vignette),
# a small F1-27 mark, then high-quality downsampling to every size. Always opaque RGB.
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops

raw, out = sys.argv[1], sys.argv[2]
im = Image.open(raw).convert('RGB')
S = im.width

# atmosphere: soft red glow upper-left, blue glow upper-right, added behind / over the dark set
glow = Image.new('RGB', (S, S), (0, 0, 0))
d = ImageDraw.Draw(glow)
d.ellipse((-0.35 * S, -0.30 * S, 0.55 * S, 0.55 * S), fill=(70, 4, 14))
d.ellipse((0.50 * S, -0.30 * S, 1.35 * S, 0.50 * S), fill=(6, 20, 78))
glow = glow.filter(ImageFilter.GaussianBlur(S * 0.13))
# only where the frame is dark (the background), so the car keeps its own colours
lum = im.convert('L').point(lambda v: 255 if v < 14 else (0 if v > 60 else int(255 * (60 - v) / 46)))
im = Image.composite(ImageChops.add(im, glow), im, lum)

# vignette
vig = Image.new('L', (S, S), 0)
ImageDraw.Draw(vig).ellipse((-0.18 * S, -0.12 * S, 1.18 * S, 1.22 * S), fill=255)
vig = vig.filter(ImageFilter.GaussianBlur(S * 0.12))
im = Image.composite(im, Image.new('RGB', (S, S), (0, 0, 0)), vig)

# small F1-27 mark, top-left inside the iOS safe area, red dash between
font = None
for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf']:
    try:
        font = ImageFont.truetype(f, int(S * 0.078)); break
    except Exception:
        pass
if font:
    d = ImageDraw.Draw(im)
    parts = [('F1', (255, 255, 255)), ('-', (225, 11, 42)), ('27', (255, 255, 255))]
    tw = sum(d.textlength(t, font=font) for t, _ in parts)
    x, y = (S - tw) / 2, int(S * 0.10)
    for t, c in parts:
        d.text((x + S * 0.004, y + S * 0.005), t, font=font, fill=(0, 0, 0))
        d.text((x, y), t, font=font, fill=c)
        x += d.textlength(t, font=font)
    by, bx = y + int(S * 0.108), S / 2 - S * 0.06
    d.polygon([(bx + S * 0.004, by), (bx + S * 0.088, by), (bx + S * 0.083, by + S * 0.011), (bx - S * 0.001, by + S * 0.011)], fill=(225, 11, 42))
    d.polygon([(bx + S * 0.088, by), (bx + S * 0.124, by), (bx + S * 0.119, by + S * 0.011), (bx + S * 0.083, by + S * 0.011)], fill=(255, 194, 14))

master = im.resize((1024, 1024), Image.LANCZOS)
master.save(f'{out}/icon-1024.png', optimize=True)
for n in (512, 192, 180, 32):
    r = master.resize((n, n), Image.LANCZOS)
    if n <= 192:
        r = r.filter(ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=1))
    r.save(f'{out}/icon-{n}.png', optimize=True)
print('icons written', out)
