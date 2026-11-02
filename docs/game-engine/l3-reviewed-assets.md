# Reviewed L3 assets — 2026-11-02

Feature remains OFF. These four real models passed the unchanged geometry/texture validator and
Chromium software rendering. They are a small reviewed catalogue, not universal asset search.
Exact URLs, immutable revisions, source/resource/derived SHA-256 and licence evidence are in
`src/server/AgentV3/gameAssets/reviewedCatalogue.ts`. No model binaries are committed or hotlinked by games.

| Asset | Licence and author | Derived bytes | Triangles | Verified animation |
|---|---|---:|---:|---|
| KayKit Adventurers Knight | CC0, Kay Lousberg; exact free pack LICENSE.txt | 490,608 | 6,952 | Walking_A; Idle/Running_A also retained |
| KayKit City Bits sedan | CC0, Kay Lousberg; exact free pack LICENSE.txt | 69,484 | 1,222 | None; fixture moves actor with keyboard/button |
| KayKit City Bits building A | CC0, Kay Lousberg; exact free pack LICENSE.txt | 70,720 | 828 | None |
| Khronos sample Fox | Model: PixelMannen CC0; rig/animation: tomkranis CC BY 4.0; conversion: AsoboStudio/scurest CC BY 4.0 | 162,852 | 576 | Walk; Survey/Run available |

CC0 permits commercial use and redistribution, including source exports. Fox attribution retains all
three credited contributions, dates and the CC BY 4.0 link; generated games display the required
credit and ship the attribution text. These permissions come from each asset/pack's explicit licence,
not a repository software licence. Paid KayKit EXTRA packs were not used.

## Processing and proof

Knight's original 3,659,532-byte GLB contains 76 clips and exceeds the runtime metadata budget.
`animation-selection-v1` first requires the exact reviewed source SHA-256, then retains only explicitly
reviewed clip names, their accessors/views, mesh attributes/morph data, inverse bind matrices and images.
It copies retained binary data without resampling and compacts it. The resulting model must pass the
unchanged runtime validator, then browser rendering and requested animation proof. Unselected clips are
removed, not claimed preserved. Savings: 3,168,924 bytes (86.6%). Geometry simplification/LODs and texture
resizing are not implemented. The offline CLI refuses output overwrite:

```
node --experimental-strip-types scripts/gameAssetSelectAnimations.mjs source.glb output.glb REVIEWED_SHA Idle Walking_A Running_A
```

The sedan/building use the existing hash-checked glTF+BIN+PNG bundler and lossless compactor. Original
1024-square textures remain within the 2048-square individual texture budget.

`gameAssetReal.check.ts` exercises actual reviewed bytes, exact production cache format, fresh-process
local object-store restore, and a real Vite production artifact at `/published/`. Chromium at 390×844
loads four models (9,578 triangles, 22 draw calls), advances animation, moves the car by keyboard and
button, and reloads successfully. All gameplay URLs are same-origin and GLB hashes survive bundling.
This is one isolated fixture, not six complete generated games, physical-device performance, private
cloud-bucket acceptance, sandbox VM restart or live game publication.

The managed environment's ordinary HTTPS client successfully downloaded the official source files.
The production socket-level SSRF downloader fails direct DNS lookup with `EAI_AGAIN` for
`raw.githubusercontent.com` here. Its guard was not bypassed or changed. Therefore the successful
artifact harness used explicit `offline-reviewed` input, not live transport. The default harness mode
still invokes the real guarded downloader and fails honestly in this environment:

```
node_modules/.bin/tsx scripts/checks/gameAssetReal.check.ts EVIDENCE_DIR PLAYWRIGHT_MODULE CHROMIUM
# Explicit offline acceptance requires already-reviewed final GLBs named <SHA256>.glb:
node_modules/.bin/tsx scripts/checks/gameAssetReal.check.ts EVIDENCE_DIR PLAYWRIGHT_MODULE CHROMIUM offline-reviewed ADMITTED_DIR
```

## Remaining provider boundaries

The newly published environment has all four requested hosts enabled: api.github.com,
api.polyhaven.com, storage.googleapis.com and tuf-repo-cdn.sigstore.dev. Read-only API and TUF requests
returned HTTP 200. `npm audit signatures` passed: 1,375 signatures and 197 attestations.

Poly Haven official `/files/wooden_table_02` metadata identifies `https://dl.polyhaven.org` as its
asset host; this host is not allowed. No request to it was attempted. It requires separate owner
permission before any download. Other hosts are not inferred from it. Poly Haven reviewed-ID adapter
is implemented but no Poly Haven asset has been admitted. Kenney official starter-kit repository and
Quaternius test models were inspected for discovery; their exact model rights/admission were not
completed and no models from them were downloaded. Sketchfab remains disabled pending authorized
commercial download access. Train/station, flying bird, ship, dog/cow/horse/deer are not represented in
the four-entry catalogue; they retain procedural fallback rather than receiving unrelated models.

## Additional acceptance and final local gate

A separate real-model fixture drill subsequently built with the installed **Vite CLI**, then exercised
keyboard and on-screen movement, animation, 390×844 layout and reload in three isolated scenes:

| Local fixture | Actual sources | Rendered triangles / draw calls |
|---|---|---:|
| Walking human | Downloaded, selected Knight clips | 6,954 / 16 |
| Driving car | Downloaded sedan plus existing procedural road | 1,234 / 11 |
| Animals/environment | Downloaded animated Fox plus existing procedural dog/cow/horse/tree | 7,320 / 65 |

These are small controlled fixtures, not completed user games or a racing-game feature test. In the
animals fixture, only the Fox is a downloaded animal. Screenshots were visually checked. The transient
programmatic Vite invocation encountered a modulepreload-resolution error; the actual installed Vite
CLI built the same scene files successfully. The 608.57 kB raw / 157.08 kB gzip fixture JS chunk emitted
the normal 500 kB warning; the repository's own bundle gate separately passed. Physical-device frame
rate is not established. Train/station, flying bird and moving ship have no exact reviewed candidates:
acquisition returned procedural with zero unrelated downloads, but those scenes remain unrendered.

The real selected Knight also passed actual local Firestore inline save/read and separate-process
restore, plus private Storage-emulator cache write/read, CRC and oversize-read rejection. This does not
claim real Knight project spill: the selected file fits the inline path. The separate synthetic large
file drill verifies spill. These additional exploratory harnesses/results are in
`/workspace/asset-evidence/{scenarios.ts,scenarios.log,scenarios/,real-storage.log,missing-scenarios.log}`.

Environment diagnosis: independent Python system DNS lookups fail for api.github.com,
api.polyhaven.com, tuf-repo-cdn.sigstore.dev and raw.githubusercontent.com; managed ordinary HTTPS
requests succeed and the environment supplies HTTP(S) proxy configuration. This points to the local
direct-DNS path, not an established production downloader defect. No IP pinning, alternate resolver,
proxy dispatcher or SSRF exception was introduced. Actual automatic downloader remains unverified.

On source commit `80c1e4e0ceadb1aa14d3a6032fa6e02413c4f783`, full coverage completed with exit 0:
**3,189 files; 48,216 passing tests; 85 existing skips; 980.82 seconds**. Statements 75.54%, branches
71.47%, functions 78.16%, lines 77.51%; thresholds passed. All other CI-equivalent local gates and all
four database drills passed. Node 22.23.4/npm 11.18.0 match CI; local Java is Debian OpenJDK 21.0.12.1,
where CI requests Temurin 21. Signature audit passed (1,375 signatures, 197 attestations). Hosted CI,
production deployment, actual sandbox VM restart and release activation are not established by these
local results. No owned local verification process remains running.
