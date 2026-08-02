#!/usr/bin/env python3
"""
Generate the NavBharatAI app-icon source (assets/icon.png) from the brand mark.

WHY: Apple App Review flagged the iOS build's app icon as a PLACEHOLDER (Guideline 2.3.8, 2026-08-02).
`cap add ios` scaffolds the iOS project with Capacitor's default placeholder icon and nothing replaced it.
This produces the real, 1024x1024, square, NO-ALPHA icon the iOS build injects into the AppIcon set
(.github/workflows/ios-ipa.yml). We use the SYMBOL ONLY (brain + Ashoka Chakra) — the full text lockup is
illegible at icon size. The committed output is ios-config/app-icon.png.

Deterministic: re-running yields the same bytes. Usage:
  python3 scripts/make-app-icon.py <brand-art.png> [ios-config/app-icon.png]
"""
import sys
from PIL import Image

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else 'ios-config/app-icon.png'
SIZE = 1024

im = Image.open(SRC).convert('RGB')
W, H = im.size
px = im.load()

def colored(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    return (mx - mn) > 40 or mx < 160  # saturated stroke OR dark — excludes the near-white background

# The symbol occupies the TOP region; the text lockup sits below ~y=780 and is deliberately excluded.
minx, miny, maxx, maxy = W, H, 0, 0
for y in range(0, 780):
    for x in range(0, W):
        r, g, b = px[x, y]
        if colored(r, g, b):
            minx = min(minx, x); maxx = max(maxx, x); miny = min(miny, y); maxy = max(maxy, y)

symbol = im.crop((minx, miny, maxx + 1, maxy + 1))
sw, sh = symbol.size

# Center the symbol on a white square with ~13% margin per side (safe under iOS's rounded-rect mask).
side = int(max(sw, sh) * 1.30)
canvas = Image.new('RGB', (side, side), (255, 255, 255))
canvas.paste(symbol, ((side - sw) // 2, (side - sh) // 2))

icon = canvas.resize((SIZE, SIZE), Image.LANCZOS)
icon.save(OUT, 'PNG')
print(f'symbol bbox=({minx},{miny},{maxx},{maxy}) size=({sw}x{sh}) canvas={side} -> {OUT} {SIZE}x{SIZE} RGB')
