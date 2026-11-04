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

## Additional reviewed fixtures (2026-11-02, second continuation)

The catalogue now has seven assets. Added:

| Asset | License evidence | Final GLB | Triangles | Processing |
| --- | --- | ---: | ---: | --- |
| Kenney Train Kit 1.1 diesel locomotive | [Exact pack License.txt](https://github.com/Zalamancer/train-game/blob/b593073ea756efa2bba003b9cd2d1ebd3a7488e6/assets/kenney_train-kit/License.txt), CC0 | 141,564 bytes | 1,742 | Embed hash-pinned colormap PNG, remove strictly identity UV extension only, compact |
| Quaternius cruise ship | [Pack-specific CC0 mapping and provenance](https://github.com/trebeljahr/quaternius-showcase/blob/c664c6f231d3dd522b38ba52fc39ec33028624e2/LICENSES.md), corroborated by original ships pack page | 61,856 bytes | 858 | Direct GLB |
| Quaternius Eagle, Animal Pack Vol.2 July 2017 | [Scoped original CC0 license](https://github.com/beep2bleep/FreeAssetsByKenneyNLandQuaternius/blob/dea756baf3b3a4889d8c245e456a4791f961578a/FreeModels%20by%20Quaternius%5BPatreon%5D/License.txt) | 2,064,220 bytes | 24,800 | Offline Blender 4.3.2 conversion; Flying clip; adjusted materials; four joint influences |

The eagle derivative and source/hash/license details are in `assets/game-models/README.md`. `scripts/gameAssetConvertEagle.py` requires the pinned source hash and Blender version. Invoke Blender with `--background --factory-startup --disable-autoexec --python scripts/gameAssetConvertEagle.py -- SOURCE.fbx OUTPUT.glb`. FBX is never parsed at runtime. Conversion is not lossless: export reduces/normalizes joint influences to four. No textures are present. The catalogue pins the derivative to its immutable repository commit.

`glbResourceBundle.ts` supports a reviewed GLB's explicit, hash-pinned PNG dependencies without following model-supplied URLs. All previous size, resource-path and final structural checks apply. Only exact identity `KHR_texture_transform` on UV channel zero is removed; unknown extensions, nonidentity transforms and other UV channels fail closed. Source and final hashes remain distinct. Eight tests cover successful embedding, invalid transforms/headers/resources and transport hash enforcement.

Semantic extraction no longer treats horse racing as a car, a train station as a locomotive, or a bird character as a human. Named parrot requests cannot select the eagle. Motion is scoped to conjunction/punctuation clauses. This remains bounded deterministic vocabulary matching, not universal language understanding; negation, complex multi-subject grammar and Hindi extraction are unfinished.

### Repeatable local acceptance

`scripts/checks/gameAssetReal.check.ts` admits all seven reviewed final files in explicit `offline-reviewed` mode, proves each model independently in Chromium (including Knight/Fox/Eagle animation), reuses the content-addressed cache with zero second-download bytes, restores that cache in a fresh Node process, and checks production artifact asset hashes and reload. The combined overview can frustum-cull objects: individual proof and the separate scenario fixtures establish visibility, not the overview's triangle count.

Run the separate scenarios with:

```sh
npx tsx scripts/checks/gameAssetScenarios.check.ts OUTPUT_DIR ADMITTED_GLB_DIR PLAYWRIGHT_MODULE CHROMIUM_EXECUTABLE
```

This produces six isolated locally built interactive fixtures at a 390×844 viewport, each tested twice with keyboard/button movement, local assets, no vendor requests, no page errors, and production-artifact reload:

| Scenario | Actual downloaded model | Procedural elements | Rendered triangles / draw calls |
| --- | --- | --- | --- |
| Walking human | KayKit Knight, Walking_A | Ground | 6,954 / 16 |
| Racing/driving car | KayKit sedan | Road/ground | 1,234 / 11 |
| Multiple animals/environment | Khronos Fox, Walk | Existing dog/cow/horse/tree/ground | 7,320 / 65 |
| Train and railway station | Kenney diesel | Fixture-built station platform/canopy/rails/ground | 2,128 / 36 |
| Moving ship | Quaternius cruise ship | Water-colored ground | 860 / 5 |
| Flying bird | Quaternius Eagle, Flying | Ground | 24,802 / 5 |

These are deterministic local integration fixtures, not six AI-generated games, a cloud publication, a full sandbox restart, or physical mobile tests. The train station is explicitly procedural; no city building is misrepresented as a railway station. Mobile layout and geometry checks do not establish device frame rate or thermal performance. Large Three.js fixture bundles emit Vite's size warning; no warning limit was changed.

### Network and rejected sources

System `getaddrinfo` fails with EAI_AGAIN for the allowed GitHub, Poly Haven, Google Storage and Sigstore hosts while the environment-managed HTTPS client can reach allowed services. The production downloader deliberately retains connection-level DNS/SSRF checks. Its automatic network path remains unverified here; no proxy-resolution workaround, alternate DNS or fixed IP bypass was added. Platform action is needed to provide direct DNS/HTTPS compatible with the guarded downloader, or a separately designed and reviewed safe transport contract.

Poly Haven's exact `wooden_table_02` API metadata identifies `dl.polyhaven.org`. That host has not been requested because it is not on the effective allowlist; owner allowance is pending. No new host is needed for the seven reviewed catalogue assets beyond the existing raw GitHub origin. `npm audit signatures` passed after the user's Sigstore allowlist change (1,375 registry signatures; 197 attestations).

The Rome Parrot/Flamingo candidates were rejected because the original model license is CC BY-NC-SA 3.0 despite their location in a software repository with permissive code licensing. A railway station candidate without asset-level redistribution permission was rejected. Newer Quaternius QAL terms must not be inferred to grant standalone redistribution; this admission is limited to the exact older CC0 packs and pinned evidence above.

Broad live search, generated LODs, texture resampling and additional animated animal models remain unfinished. Feature activation stays OFF. Draft PR creation remains paused after automatic approval review denied that action; no PR, merge or deployment is implied by these local checks.

The seven admitted final GLBs total 3,061,304 bytes. The explicit offline admission run read each once;
second acquisition used the cache with zero downloaded bytes. This measures fixture/cache behavior,
not network latency or API production cost. No paid asset API or paid AI build was used.
The real 2,064,220-byte eagle also passed Firestore + private Storage spill acknowledgement, bounded
CRC-checked cache reads, and exact fresh-process model/manifest restore in local emulators. The
conversion script reproduced SHA-256 `4e8915ef238773ca0b11576fd71dddb49449ce0aa6b575f0fce9e65e79e03f75`.

### Published configuration handoff (2026-11-02 04:58 UTC)

The owner explicitly added `dl.polyhaven.org` and confirmed Publish. The parent reports catalog version
`b82effea-ed47-4085-b463-7cd21d5dd1c3~cecfgver_6ae8177f7f9881a283d07ad40c0e7574`.
The existing executor still reports its original version ending
`6ae80b27205c81a2917a4210d73f511a`, observations current, restricted policy enforced, only the four
additional hosts `api.github.com`, `api.polyhaven.com`, `storage.googleapis.com`, and
`tuf-repo-cdn.sigstore.dev`. `dl.polyhaven.org` is absent from effective hosts. No CDN request was made.
A fresh executor must verify its actual policy before trying the exact Poly Haven metadata URL.
Adding this hostname does not itself establish that direct DNS required by the guarded downloader works.
The setting publication grants no new PR authorization; the denied draft-PR operation remains paused.

Source checkpoint `66d021504` is pushed. Its immutable eagle derivative URL was independently fetched
with the allowed managed HTTPS client: HTTP 200, 2,064,220 bytes, expected SHA-256. This confirms source
availability on GitHub, not a game deployment or production guarded-download success.

At this handoff, 61 targeted tests and all non-coverage CI-equivalent gates, signature verification,
four database drills, synthetic asset persistence/storage and real Eagle storage spill have passed.
The final full coverage run is still owned by the original executor and pending; do not claim it passed
or launch a duplicate until the final outcome is recorded. Earlier full coverage belongs to source
`80c1e4e0c`, not this source checkpoint.

### Terminal verification and fresh-runtime findings (2026-11-02)

The full suite against source **66d0215041bdbb24ab19e7d775b5ddfd0dd52e91** completed successfully:
3,191 test files; 48,227 passing tests; 85 existing skips; 1,085.11 seconds. Coverage thresholds passed:
statements 75.55%, branches 71.49%, functions 78.17%, lines 77.53%. No skips/assertions or thresholds
were weakened. All owned verification processes reached terminal success. Local CI-equivalent gates
and emulator drills pass; remote PR CI has not run because no PR exists. Node 22.23.4 and npm 11.18.0
match the configured versions; Java is Debian OpenJDK 21.0.12.1 rather than CI's Temurin 21.

The parent's fresh executor independently verified **all five hosts effectively allowed**, including
`dl.polyhaven.org`. At the same source checkpoint with Node 22.23.4, the **actual guarded downloader**
still failed with `EAI_AGAIN` for both the official Poly Haven selection and reviewed Fox URL. It
returned **zero bytes**: no successful content/hash validation or production acquisition is claimed.
No bypass or transport change occurred. Additional hostname allowances are not a remedy for this
observed DNS failure. The precise remaining action is platform/runtime support for direct DNS and
HTTPS compatible with connection-level SSRF validation, or a separately reviewed safe transport design.
The former need for a fresh executor to observe the fifth host is now resolved; the downloader blocker
is not. Existing managed-client and offline-fixture success must remain distinguished from this result.

The selected Poly Haven table also references JPEG textures. Current admission deliberately accepts
PNG only. Review found that changing the MIME whitelist alone is insufficient: JPEG needs bounded
format/dimension validation and explicit decode failure checks before acceptance. A model render alone
does not prove every referenced texture decoded. JPEG support and this specific Poly Haven model remain
unimplemented/unadmitted; none of the seven admitted assets depends on JPEG support. Generated LODs,
broad live discovery/multilingual semantics and device/cloud acceptance likewise remain outstanding.

Final status: source branch checkpoint preserved, billing base intact, feature OFF. Draft PR creation
is still paused after automatic approval review denied it for lack of explicit user authorization for
that external action. Publishing environment settings did not grant PR permission. No PR, merge,
deployment, cloud game publication or activation has occurred.

## 2026-11-04 — Step 2: catalogue 7 → 35 (L3 still OFF)

28 CC0 models from three official KayKit packs, each pack's `LICENSE.txt` read at the pinned revision ("License:
(Creative Commons Zero, CC0) … free to use in personal, educational and commercial projects"):
KayKit City Builder Bits `63976910` (buildings B–H, bush, streetlight, traffic light A, water tower, taxi, police car),
Medieval Hexagon Pack `84fa4e91` (two trees, two rocks, hills with trees, mountain, two houses, well, windmill) and
Prototype Bits `bb159596` (target, target stand, barrel, wall, wall with target). Admitted with
`scripts/gameAssetAdmitGltf.mjs`, which uses the production `bundleGltf` → `compactGlb` → `validateGlb` and
reproduced the existing `city-building_A` entry exactly (source `d9d21afb…`, derived `364ebc76…`, 70,720 B, 828 tris).
Derived sizes 18–161 KB, 18–2,653 triangles. Building heights are proportional to building_A (8 m) from the
POSITION accessor extents.

**Real check, this container, live guarded downloader:** `scripts/checks/gameAssetReal.check.ts` — all 35 models
`rendered:true` in Chromium, cache reuse with zero downloads, fresh-process restore, production build, keyboard/touch
movement, animation and reload: PASS. The harness now scopes providers and cache to the model under test (several
models now share a subject; the engine correctly downloads only the first match).

New prompt vocabulary (English/Hindi/Spanish): bush, streetlight, traffic light, water tower, taxi, police car, hill,
mountain, house, well, windmill, target, barrel, wall. Bare English "well" and "home" are deliberately NOT aliases.
Not in these packs: a boxing ring (stays procedural) and animated boxers (Knight punch clips to be reviewed next).
