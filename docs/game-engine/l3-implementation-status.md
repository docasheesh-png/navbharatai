# L3 asset engine — implementation checkpoint, 2026-11-01

**Default off; no reviewed production models yet; not end-to-end delivered.**
Base: `504b79298739d142117a31cc934fa6b65595f5fa` (billing PR #4063).
Branch: `feat/universal-3d-assets`. Existing L1/L2 generation remains available.

## Architecture and implementation

`routes/agentv3.ts` prepares optional external assets after a successful 3D kit recipe,
inside the existing new-build/non-import/untouched-starter guard. The opt-in flag uses the shared boolean parser; canonical activation is
`AGENTV3_EXTERNAL_GAME_ASSETS=on`. The production reviewed catalogue is deliberately empty;
therefore neither the default nor an empty-catalogue opt-in makes provider requests.

`gameAssets/assetPlan.ts` extracts bounded deterministic English subject/animation requirements.
This is inexpensive alias matching, not a universal multilingual semantic research model.
The engine checks reviewed cache entries first, then bounded provider candidates, validates hashes,
license metadata, budgets and actual browser rendering before acknowledging a usable model.
Failures retain the existing procedural fallback. Animation role mappings are curated per asset.

The provider registry accepts reviewed exact assets with source/license evidence, immutable hashes,
commercial and redistribution permissions, approved origins, animation names and orientation.
Poly Haven's adapter rechecks known reviewed IDs with `/info/{id}` and `/files/{id}`; it does not
perform unrestricted whole-catalog discovery. Curated pack adapters share the reviewed contract.
Sketchfab is disabled pending verified authorized API access and terms. No provider has a live
verified production catalogue entry yet. Never infer asset rights from a GitHub code license.

Transport uses existing socket-level SSRF protection, exact HTTPS origins, no redirects/credentials,
bounded streaming, timeouts, shared per-origin metadata/download rate limits and bounded shared in-flight downloads.
GLB validation rejects external references, unsupported extensions, malformed ranges, cyclic nodes,
unsafe numbers and excess geometry/texture budgets. Supported formats are self-contained GLB 2 and
reviewed relative-resource glTF + BIN + PNG deterministically bundled into GLB. Initial policy:
5 MiB, 60,000 triangles, 512 nodes, 128 meshes/animations, 2048-square textures with aggregate cap.
JPEG, archives, FBX/OBJ, compression codecs, geometry simplification, texture resizing and generated
LODs are not implemented. Reviewed `compact-v1` losslessly removes unused/duplicate buffer bytes;
it preserves exact buffer-view contents, accessor metadata, images and animations. Both source and
derived hashes must be pinned before admission. CPU work is bounded for overlapping views. An
offline admission tool (`scripts/gameAssetCompact.mjs`) writes without overwriting existing files
and reports hashes/savings; it does not infer licences or activate assets. Budget rejection is not optimization.

The durable content cache stores only reviewed public assets under content hashes in the existing
private bucket. Cache hits are rehashed and revalidated. At most 64 entries can be admitted in one
catalogue; historical-object garbage collection is not implemented, so this is not a lifetime
storage cap. `downloadedBytes` currently reports final acquired GLB bytes, not total HTTP traffic
for multi-resource glTF or pre-compaction sources. No external paid service or AI inference was used by these checks.

Project persistence uses existing workspace binary storage with exact hash read-back before
materialization. The source manifest, attribution file and runtime wrapper require durable text-save
acknowledgement. Existing restore and publish paths now recognize GLB and correct MIME types.
The existing binary limit is preserved; decoded-base64 accounting now handles padding exactly.

The generated Three.js runtime fetches same-origin hashed assets, verifies integrity, normalizes
height/ground/center/yaw, connects named animation clips and disposes resources. Required attribution
and live API service credit get a visible link to local attribution text. A bounded sandbox Chromium
proof verifies nonempty rendering and observable requested animation before seed delivery. This
per-asset proof does not replace testing the completed user's game.

## Sources and access requirements

| Source | Official evidence | Current state |
|---|---|---|
| Poly Haven | https://polyhaven.com/license ; https://github.com/Poly-Haven/Public-API/blob/master/ToS.md ; https://github.com/Poly-Haven/Public-API/blob/master/swagger.yml | CC0 assets. Free commercial API requires identifying User-Agent and visible provider credit when surfacing live API content. Reviewed-ID adapter implemented; API denied by environment. |
| Kenney | https://kenney.nl/assets | Curated adapter contract; exact packs and downloadable asset provenance pending. |
| Quaternius | https://quaternius.com/faq.html | FAQ states CC0; exact selected pack review still required. Curated adapter contract only. |
| KayKit | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 | Official free animated pack documents CC0. Paid EXTRA excluded. Immutable asset selection/download inspection pending. |
| GitHub | Publisher repositories with asset-level license evidence | Curated adapter contract; no blanket repository-license inference. Tree API denied. |
| Sketchfab | https://sketchfab.com/developers/download-api | Research fetch returned 403; authorized interface and terms unverified; disabled. |

The environment denied API requests to `api.polyhaven.com` and `api.github.com` with proxy 403.
These operations did not download assets. No alternate-host or proxy bypass was attempted.
Minimal currently evidenced API hosts are those two. Asset-download hosts must be determined from
verified official metadata before approval; they are not guessed here. Environment owners must
approve access; this implementation does not change network/security settings.

## Verification and release boundary

Evidence logs reside in `/workspace/navbharat-asset-verification` in the working environment.
Checks use CI's Node 22.23.4/npm 11.18.0; browser harnesses also passed with these versions.
Affected-suite run: 37 files, 657 tests passed. A subsequent four-file asset run passed 35 tests;
these overlap and must not be summed. Final targeted guards/assets: 10 files / 93 tests passed.
Full coverage on code commit `2e97244d61e7520f5d22ab8b629665dfa3ef288b` completed with exit 0:
3,188 files passed; 48,211 tests passed and 85 existing skips (956.14 seconds). Coverage thresholds
passed: statements 75.53%, branches 71.45%, functions 78.15%, lines 77.50%. Evidence:
`/workspace/navbharat-asset-verification/coverage-verified-tree.log`. No owned test remains running.
The required signature gate remains blocked, so this is not a claim of fully green required CI.

Real system Chromium with Playwright 1.49.1 and Three.js rendered a synthetic textured animated GLB:
SHA-256 `59838f141dcb34473eb380f97b4935545d26e036ceaf38dead0e710f54862d25`,
4 triangles, 1,856 changed pixels, observable animation. The generated loader passed normalization,
credits/cleanup, missing-file fallback and reload using owned local URLs. This is a synthetic fixture,
not a downloaded train/bird/ship/human/car/animal or a published user game. Six subject-selection
scenarios also use explicitly synthetic fixtures, not six realistic game builds.

Local CI-equivalent audit, license, SBOM, frontend/server/benchmark typechecks, unused/native guards,
OAuth check, build, bundle, boot and production dependency gate passed. All four existing Firestore
emulator drills passed. Required `npm audit signatures` failed on HTTP 403 from the Sigstore TUF
service (`tuf-repo-cdn.sigstore.dev`); the gate was not skipped or weakened. This is an additional
minimal access requirement for completing CI, separate from model-provider access.

Not yet proven: real provider downloads/licensing admission, six actual game builds, physical mobile
performance, private-bucket spill/restart in deployment, live publication and complete required CI.
No production feature activation, deployment or merge is authorized by these synthetic results alone.

### Reproducing explicit acceptance harnesses

- Policy/security smoke: `node --experimental-strip-types scripts/checks/gameAssetPolicy.check.mjs`.
- Browser: `node_modules/.bin/tsx scripts/checks/gameAssetBrowser.check.ts <existing-playwright-index.mjs> <existing-chromium-executable>`.
  Missing browser tooling is an error, not a skipped pass. This run used system Chromium and the
  sandbox's existing Playwright version, installed only in `/tmp`, with no repository dependency change.
- Persistence: start the verified Firestore emulator as in `.github/workflows/ci.yml`, then run
  `FIRESTORE_EMULATOR_HOST=127.0.0.1:18781 node scripts/checks/gameAssetPersistence.check.mjs`.
  The harness asserts loopback and a synthetic demo project, generates a throwaway local-only test
  credential, bundles the worker to the server's CJS format, saves, then restores in a separate process.
  It deletes synthetic documents. It cannot run against a production database. This proves the inline
  workspace asset path and provenance persistence, not Cloud Storage spill or deployment publishing.
- Production artifact/browser: `node_modules/.bin/tsx scripts/checks/gameAssetBuild.check.ts <existing-playwright-index.mjs> <existing-chromium-executable>`.
  Passed using the actual Vite production build at a nested `/published/` base: model hash and
  manifest preserved, rendering/animation/reload pass, only owned URLs requested. Synthetic fixture
  only. Browser and build harnesses also passed under CI-matching Node 22.23.4.

### Lossless optimization evidence

The optimized textured/animated synthetic fixture saved **65,672 bytes**. Source hash:
`2c273be6c44a70f2458eb898b93c4d73c407a05c780f7f601c80dfd3d2ce2978`; derived hash:
`3a7bfa6cf2fcf64e35ccaa7fab3fc799004fa2a8cd851586a941cf3722ca43fe`. Chromium still rendered
4 triangles / 1,856 changed pixels with observable animation. The optimized bytes passed actual Vite
build/reload and separate-process emulator persistence/restore, including source hash and processing
provenance. These are synthetic savings, not a claim about provider assets or production bandwidth.

The installed Three.js simplifier discards unsupported morph/skin attributes. It is not automatically
applied to game characters. Lossless packing is not mesh simplification or LOD generation; those
remain pending quality/animation-preserving implementation and real-asset acceptance.

The first completed full suite had one genuine failure: a synthetic fixture was located under
production source and the dead-code guard rejected it. It was moved to `tests/fixtures` without
changing the guard or adding an allowlist entry. That run had 48,200 passing tests, one failure and
85 existing skips; it was not a green coverage result. The corrected final tree subsequently passed
the complete coverage suite as recorded above; both earlier failure logs are retained.

### Local private-storage spill/cache evidence

The checked harness `scripts/checks/gameAssetStorage.check.mjs` runs the existing SDK against isolated
Firestore 1.22.0 and Storage 1.1.3 emulators on loopback, with a synthetic demo project/bucket and
throwaway test credentials. Both emulator jars are size/SHA-256 checked against installed Firebase
Tools metadata; automatic downloads are disabled in the harness. The storage runtime was obtained
from its verified official `storage.googleapis.com` test-artifact URL, not a model-provider bypass.

A synthetic GLB larger than the inline Firestore limit passed actual private-bucket spill/read-back,
content-addressed cache write/read with CRC32C enabled, oversize-read rejection, private cache metadata,
and fresh-process model+manifest restore. Run with:
`node scripts/checks/gameAssetStorage.check.mjs <verified-storage-emulator-cache-dir> <verified-firestore-jar>`.
This strengthens local SDK/storage evidence, but is not a production-cloud or live-publication test.

An immediate metadata request after deliberately aborting a read reproduced `ECONNRESET` in the
**unmodified SDK plus local HTTP emulator**, independently of the asset adapter. The harness allows
10 ms for local socket cleanup after deliberate aborts; size and CRC assertions are unchanged and no
request is retried. Same-tick connection recovery in production is not claimed. The diagnostic log is
`asset-storage-raw-sdk-diagnosis.log` in the verification directory.

### Flag and provider-backoff convention

Both the opt-in L3 flag and local storage-drill flag use the repository's shared boolean parser,
with OFF as the default. The second complete suite caught a direct string read in the newly added
harness; it was corrected without changing the guard. Provider metadata and binary downloads now
share bounded per-origin request spacing and Retry-After cooldowns. Numeric and HTTP-date intervals
are honored without the earlier five-minute truncation; concurrent responses cannot shorten an
existing cooldown. This is per-process throttling, not a claimed cross-instance global rate limit.
The initial licence policy accepts CC0-1.0 and CC-BY-4.0; other licences require further implementation
and review. No catalogue entry or live provider access has been enabled.
