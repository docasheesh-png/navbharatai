# Eleven licensed library additions: local admission evidence

This admission supersedes the initial quarantine described in the acquisition batch. It does not establish deployment or production provider availability.

## What was actually checked
- Four animated characters (Barbarian, Mage, Rogue, Hooded Rogue), two cars (hatchback, station wagon), two road pieces (straight, corner), and three props (crate, fire hydrant, dumpster).
- The original source, each referenced resource and each official pack license were downloaded and hash-checked. Both official immutable KayKit pack licenses are CC0 and explicitly permit commercial use. No paid EXTRA assets are included. Exact pins, license links and attribution live with each catalogue entry.
- Existing lossless glTF bundling/compaction or selected-animation processing reproduced all eleven reviewed derived hashes, **2,038,360 bytes total**. Existing GLB validation passed.
- Each model passed the unchanged texture/geometry/render checker in official Chrome-for-Testing Headless Shell with SwiftShader. All four characters also proved observable Walking_A and Running_A motion. Idle is retained, not advertised as a separately verified motion.
- Acquisition engine and exact cache format passed first/cached loads, hash rechecks and fresh-process local cache restore. The actual builder seed ran two bounded batches spanning all eleven subjects with acknowledged local binary/text persistence and matching prepared-model handoffs.
- A Vite production artifact uses the normal generated asset runtime, serves models at `/published/` from same-origin paths, and verifies keyboard/touch-button movement, animation, reload, unchanged published hashes, no external requests and no page errors. Its scene uses one animated character and seven static models, not all four characters simultaneously. The all-eleven stress scene measured 27,268 triangles and 62 draw calls and failed the unchanged 32-draw-call ceiling; the bounded scene retains the original ceiling rather than relaxing it.

## Reproduce
Use existing repository dependencies, an official compatible Playwright module and Chromium headless-shell executable. Run only in a local review environment; no cloud account is required.

1. `node scripts/review-game-library-candidates.mjs /tmp/library-source` downloads only pinned public source/resource/license files and verifies hashes.
2. `node --import tsx scripts/checks/prepareGameLibrarySources.mts /tmp/library-source /tmp/library-derived` validates exact processing and writes non-overwriting hash-addressed GLBs.
3. `node --import tsx scripts/checks/gameLibraryAdmission.check.ts /tmp/library-proof /path/to/playwright/index.mjs /path/to/chrome-headless-shell offline-reviewed /tmp/library-derived` performs browser admission, actual seed, cache and production-artifact checks.

Append `all-eleven-stress` to the acceptance command to reproduce the intentionally failing all-eleven scene. Do not interpret individual asset admission as approval of that composition. The bounded scene measured 9,285 triangles and 28 draw calls.

The initial system Chromium could not create its Unix singleton socket. Official headless shell supplied a working permitted renderer; no validator or safety check was disabled to make assets pass.

## Remaining limits
The catalogue candidate expands from 36 to 47 models, but requires review, final CI and merge. External asset rollout flags are unchanged. The live guarded downloader, production object bucket and deployment have not been certified by this offline-reviewed run. Software rendering at a mobile-sized viewport is not FPS certification on a user's phone. Individual model admission and a bounded fixture are not complete generated-game gameplay/collision verification. Decorative assets remain decorative unless tested game logic supplies interactions. Road pieces are not finished maps; no new audio, weapons, building or nature packs are claimed here.
