"""Usage: python3 scripts/make_stage_bg.py SRC DST.webp PREVIEW.jpg [BRIGHT=196] [MAXSAT=22]

  guitarra: python3 scripts/make_stage_bg.py public/ardilla.jpg public/ardilla-guitarra.webp /tmp/g.jpg
  bateria:  python3 scripts/make_stage_bg.py public/ardilla_bateria.jpg public/ardilla-bateria.webp /tmp/b.jpg 236 12

Remove the white studio background (and watermark grid lines on it) from the squirrel photo.

Flood-fills from the image border over near-white, low-saturation pixels, then feathers the
mask so the fur edge blends into a dark stage. Writes an RGBA PNG.
"""
import sys
from collections import deque

from PIL import Image, ImageFilter

src, dst, preview = sys.argv[1], sys.argv[2], sys.argv[3]
BRIGHT = int(sys.argv[4]) if len(sys.argv) > 4 else 196
MAXSAT = int(sys.argv[5]) if len(sys.argv) > 5 else 22
im = Image.open(src).convert('RGB')
w, h = im.size
px = im.load()


def is_bg(rgb, bright):
    r, g, b = rgb
    return min(r, g, b) >= bright and max(r, g, b) - min(r, g, b) <= MAXSAT


mask = bytearray(w * h)  # 1 = background
q = deque()
for x in range(w):
    q.append((x, 0)); q.append((x, h - 1))
for y in range(h):
    q.append((0, y)); q.append((w - 1, y))
while q:
    x, y = q.popleft()
    i = y * w + x
    if mask[i] or not is_bg(px[x, y], BRIGHT):
        continue
    mask[i] = 1
    if x > 0: q.append((x - 1, y))
    if x < w - 1: q.append((x + 1, y))
    if y > 0: q.append((x, y - 1))
    if y < h - 1: q.append((x, y + 1))

alpha = Image.new('L', (w, h))
alpha.putdata([0 if m else 255 for m in mask])
# Close tiny holes, then feather the edge.
alpha = alpha.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(1.6))

out = im.convert('RGBA')
out.putalpha(alpha)
# Upscale a bit so it is not too soft on large screens.
out = out.resize((w * 2, h * 2), Image.LANCZOS)
out.save(dst, quality=88, method=6)  # .webp keeps alpha and stays small

bg = Image.new('RGBA', out.size, (12, 22, 38, 255))
bg.alpha_composite(out)
bg.convert('RGB').save(preview)
print('ok', out.size)
