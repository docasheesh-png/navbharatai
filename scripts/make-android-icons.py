#!/usr/bin/env python3
"""
Generate the Android launcher icons from the brand mark (same symbol as the iOS icon).

WHY: the admin asked for the real NavBharatAI icon on BOTH iOS and Android. iOS is handled by
ios-config/app-icon.png + the ios-ipa.yml step; this writes the committed Android res/ icons directly
(the android/ project IS committed, and `cap sync android` does not touch these files).

Android uses adaptive icons: the background layer is already the white @color/ic_launcher_background
(#FFFFFF), and the foreground is ic_launcher_foreground.png. We render the SYMBOL (brain + Ashoka Chakra)
centered on white at every density — legacy square/round at ~72% scale, and the adaptive foreground at
~58% (inside Android's 66dp safe zone so the launcher mask never clips it). Deterministic.

Usage: python3 scripts/make-android-icons.py <brand-art.png> [android/app/src/main/res]
"""
import sys, os
from PIL import Image

SRC = sys.argv[1]
RES = sys.argv[2] if len(sys.argv) > 2 else 'android/app/src/main/res'

im = Image.open(SRC).convert('RGB')
W, H = im.size
px = im.load()

def colored(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    return (mx - mn) > 40 or mx < 160

minx, miny, maxx, maxy = W, H, 0, 0
for y in range(0, 780):
    for x in range(0, W):
        r, g, b = px[x, y]
        if colored(r, g, b):
            minx = min(minx, x); maxx = max(maxx, x); miny = min(miny, y); maxy = max(maxy, y)
symbol = im.crop((minx, miny, maxx + 1, maxy + 1)).convert('RGBA')

def render(canvas_px, fraction):
    """Symbol centered on an opaque-white square canvas, occupying `fraction` of the side."""
    sw, sh = symbol.size
    target = int(canvas_px * fraction)
    scale = target / max(sw, sh)
    nw, nh = max(1, int(sw * scale)), max(1, int(sh * scale))
    sym = symbol.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('RGBA', (canvas_px, canvas_px), (255, 255, 255, 255))
    canvas.paste(sym, ((canvas_px - nw) // 2, (canvas_px - nh) // 2), sym)
    return canvas

LEGACY = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
FOREGROUND = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}

for dens, size in LEGACY.items():
    d = os.path.join(RES, f'mipmap-{dens}')
    render(size, 0.72).save(os.path.join(d, 'ic_launcher.png'), 'PNG')
    render(size, 0.72).save(os.path.join(d, 'ic_launcher_round.png'), 'PNG')
for dens, size in FOREGROUND.items():
    d = os.path.join(RES, f'mipmap-{dens}')
    render(size, 0.58).save(os.path.join(d, 'ic_launcher_foreground.png'), 'PNG')
print('Android launcher icons written to', RES)
