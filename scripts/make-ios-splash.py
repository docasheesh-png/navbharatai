#!/usr/bin/env python3
"""
Generate the iOS launch-screen image (ios-config/splash.png) from the SHIPPING Android splash.

WHY THIS EXISTS (admin 2026-08-16: "app open karte hai to 0.5 second ke liye Capacitor logo screen par
aata hai"):

The iOS project is NOT committed — it is generated in CI by `cap add ios`, which scaffolds Capacitor's
DEFAULT `Splash.imageset` (the stock Capacitor artwork). The workflow already replaces the app ICON for
exactly this reason (Apple flagged it as a placeholder, Guideline 2.3.8) — but nothing ever replaced the
SPLASH, so every iOS launch flashed someone else's logo before the app appeared.

Android was fixed on 2026-08-11 by committing real `drawable*/splash.png` files, which is why this was
only ever visible on iPhone.

🔒 THE SOURCE IS THE ANDROID SPLASH, NOT THE APP ICON — deliberately. Both were available, and the icon
was the tempting choice because it is already square. But the icon is SYMBOL-ONLY by design (see
make-app-icon.py: "the full text lockup is illegible at icon size"), while the Android splash carries
the full lockup — mark plus "navBharatAI". Deriving iOS from the icon would have shipped two different
launch screens on two platforms and called it done. Deriving it from the artwork Android is ALREADY
SHOWING means both phones show the same thing, and it stays that way if the Android splash is ever
redrawn.

DESIGN, and each choice has a reason:
  • 2732x2732 — the size Capacitor's iOS launch storyboard expects. SQUARE and oversized on purpose:
    the storyboard scales-to-fill, so one image covers every device and both orientations with no
    stretched pixels.
  • Background #0d1117 — the app's own dark surface, and the SAME value `capacitor.config.ts` gives
    SplashScreen.backgroundColor. If the image and the config disagreed, the hand-off from splash to
    app would flash a seam, which is exactly the "this is a web page loading" moment the whole
    native-polish effort exists to remove. Asserted at generation time rather than trusted.
  • The lockup occupies ~34% of the width, centred. A launch image is not a poster: iOS shows it for a
    few hundred milliseconds, and an oversized mark reads as a mistake while a modest one reads as a
    brand. It also matches the proportion the Android splash already uses.

Deterministic: re-running yields the same bytes, so a rebuild never produces a spurious diff.

Usage:
  python3 scripts/make-ios-splash.py [android-portrait-splash.png] [ios-config/splash.png]
"""
import sys
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else 'android/app/src/main/res/drawable-port-xxxhdpi/splash.png'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'ios-config/splash.png'

CANVAS = 2732
BG = (0x0d, 0x11, 0x17)   # #0d1117 — must equal SplashScreen.backgroundColor in capacitor.config.ts
LOCKUP_FRACTION = 0.34    # lockup width as a fraction of the canvas

src = Image.open(SRC).convert('RGB')

# The Android splash is the lockup centred on the app's dark surface. Verify that surface IS our colour
# before building on it — if the two ever diverge, a silently-mismatched splash is precisely the seam
# this file exists to prevent, and a loud failure here is far cheaper than finding it on a device.
corner = src.getpixel((2, 2))
if corner != BG:
    raise SystemExit(f'{SRC} background is {corner}, expected {BG} (#0d1117). '
                     f'Update BG here AND SplashScreen.backgroundColor in capacitor.config.ts together.')

# Find the lockup: every pixel that is not the flat background. A small tolerance absorbs PNG rounding
# without swallowing the dark navy inside the Ashoka Chakra.
w, h = src.size
px = src.load()
minx, miny, maxx, maxy = w, h, -1, -1
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        if abs(r - BG[0]) > 6 or abs(g - BG[1]) > 6 or abs(b - BG[2]) > 6:
            if x < minx: minx = x
            if x > maxx: maxx = x
            if y < miny: miny = y
            if y > maxy: maxy = y
if maxx < 0:
    raise SystemExit(f'{SRC} appears to be a blank background — no artwork found to place.')

lockup = src.crop((minx, miny, maxx + 1, maxy + 1))
lw, lh = lockup.size
scale = (CANVAS * LOCKUP_FRACTION) / lw
lockup = lockup.resize((max(1, round(lw * scale)), max(1, round(lh * scale))), Image.LANCZOS)

canvas = Image.new('RGB', (CANVAS, CANVAS), BG)
nw, nh = lockup.size
canvas.paste(lockup, ((CANVAS - nw) // 2, (CANVAS - nh) // 2))

canvas.save(OUT, 'PNG', optimize=True)
print(f'{OUT}: {CANVAS}x{CANVAS} — lockup {nw}x{nh} from {SRC} on #{BG[0]:02x}{BG[1]:02x}{BG[2]:02x}')
