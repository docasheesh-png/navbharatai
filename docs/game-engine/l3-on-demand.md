# Demand-driven 3D asset admission — 2026-11-02

Source checkpoint: `d580c7fa355086af746de3cd5e5915da3499ed4b` (final local verification complete).
L3 remains OFF by default. No PR, merge, deployment or activation is authorized in this continuation.

## When downloads occur

There is no startup preload, scheduled crawler, bulk model sync or gameplay vendor hotlink. The seven
previously downloaded real models were verification fixtures and pinned optional candidates, not a
background library download. Merely importing the catalogue or discovery adapter makes no requests.

When the existing new-game build guard invokes `prepareGameAssets` and the flag is enabled:

1. Extract a bounded set of canonical requested objects and motion roles from the build prompt.
2. Try verified cached bytes first, including the private on-demand cache index. Recheck license policy,
   hashes, GLB structure, image decoding and browser rendering; acknowledge durable project storage.
3. If no usable cache hit exists, try exact compatible candidates in the curated catalogue.
4. If those miss, run the supported provider's bounded live discovery for that requested canonical
   object only. Verify subject, license policy, source URLs, publication state, sizes and revision.
5. Download only the selected model and declared dependencies during the build. Bundle a self-contained
   GLB, compact it, compute SHA-256 provenance, decode every texture and prove the render. Store the
   admitted public model in the private shared cache and persist it with the user's game.
6. The published game loads its own `game-assets/<sha256>.glb`; it does not query a provider while playing.
   On any failed admission/persistence step, keep the existing appropriate procedural Real/Lite fallback.

The catalogue can be empty and supported live discovery still works. Default-off builds, unsupported
subjects and required animation requests outside a reviewed animated candidate do not trigger live
model downloads. The build handoff must still be integrated and playtested by the normal game builder.

## Actual discovery scope and trust

**Poly Haven has genuine on-demand search; other providers remain curated exact-asset adapters.**
The supported canonical discovery subjects are `table`, `chair`, `bench`, `rock`, `tree`, and `plant`.
The adapter uses the official `/search?q=<canonical>&t=models`, then `/info/<id>` and `/files/<id>`.
It sends no raw prompt, project name, user identity or private context. Search similarity alone is not
accepted: the selected metadata must contain the exact category and named-object token. Unsupported
specialized senses (for example coffee table, table tennis, office chair or decision tree) retain the
procedural path instead of silently broadening to a generic asset. This is intentionally limited
semantic matching, not arbitrary multilingual understanding or unrestricted web discovery.

Only the first three ranked metadata candidates are inspected. Only one selected package is downloaded
per discovery call. Animated requirements are excluded from this static provider path. Search responses
are bounded to 1 MiB/1,024 results; requests share the existing rate/cooldown controls. At most four
in-flight canonical subjects are admitted per adapter instance; same-subject calls coalesce. A shared discovery transfer has its own 25-second deadline; callers observe cancellation before and
after the shared transfer. The existing preparation loop has a 60-second budget; a transfer already
in flight may finish before its waiting caller observes cancellation. No new transfer starts after
that caller is known to be cancelled.

This provider-policy admission relies on the reviewed official [CC0 asset license](https://polyhaven.com/license)
and [public API terms](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md). It rejects future,
staged, explicitly non-CC0 and oversized metadata. Requests retain the identifying User-Agent;
`Powered by Poly Haven` is visibly preserved through generated runtime configuration. No API key,
paid asset tier, blanket GitHub license inference, website scraping or terms-acceptance mutation is used.

First admission obtains metadata and bytes from the approved HTTPS origins. Poly Haven's supplied MD5
is checked **only for transfer consistency, not cryptographic authenticity**. Source SHA-256 values
and the final derived GLB SHA-256 are then computed and retained with the opaque provider revision,
source paths, sizes, attribution and license evidence. The revision is rechecked before admission.
These are newly pinned observed bytes, distinct from curated entries whose expected SHA-256 was known
before download. No claim of a signed provider provenance attestation is made.

The discovered cache is a **private, server-written trust boundary**, not an index supplied by users.
It has six fixed canonical JSON pointer keys, each capped at 64 KiB, with `private, no-store` metadata.
Content-addressed model objects remain private/immutable. Restored records must satisfy the exact
provider-policy schema, approved origins, supported subject, license, resource and hash constraints;
all bytes and rendering are revalidated. Arbitrary project uploads never enter this shared public-model
cache. Corrupt metadata/bytes are cache misses. No unbounded bucket listing occurs.

## JPEG, semantics and LOD

- JPEG admission supports bounded 8-bit baseline/progressive Huffman images. Marker lengths, dimensions,
  component/scan/segment limits, end-of-image and source bounds are inspected before browser decoding.
  Arithmetic/lossless/hierarchical JPEG, DNL, additional frames, unsupported dimensions and trailing data
  fail closed. PNG remains supported. Both codecs share the existing 2,048-pixel axis, per-image,
  aggregate-texture and 5 MiB GLB/package limits. No archive extraction or new native runtime codec.
- Every embedded texture, including unused ones, is explicitly decoded in the isolated browser verifier
  and runtime loader. Failed textures cannot silently produce a successful untextured model. Temporary
  decoder bitmaps are closed. External references, redirects and encoded HTTP-body restrictions remain.
- Canonical aliases now include bounded English, Hindi and Spanish vocabulary and local motion words.
  Unicode normalization preserves Devanagari marks. Negated clauses are conservatively excluded, which
  can cause false negatives for complex grammar; no speculative substitute is downloaded. Work is
  capped at 16,000 characters, 128 clauses and six output requirements.
- Static LOD uses the already-installed Three.js `SimplifyModifier` and `LOD`. It skips all animated
  assets, skinned/instanced meshes, morphs, hidden meshes, multi-material/groups and unsupported attributes.
  Work is capped at 2,000 source vertices per eligible mesh, 6,000 total, eight levels, and an 80 ms
  **between-mesh** stopping check (not a hard preemption guarantee for one simplification). A reduction
  must save at least 20% of triangles and preserve finite positions and silhouette bounds within 10%.
  Original geometry is retained nearby, with distance hysteresis; unsuitable reductions leave it intact.
  `lod:false` disables this optional runtime reduction. No additional LOD download is performed.
- Real train geometry switches from 1,742 to 1,388 rendered triangles at distance; ship from 858 to 472.
  Knight/Fox/Eagle remain animated and unsimplified. These are local software-renderer measurements,
  not physical-device FPS, power, thermal or quality guarantees. Static LOD changes are disclosed in
  generated attribution text. Decimating rigs and offline authored LOD packages remain out of scope here.

Technical references: [ITU T.81 JPEG structure](https://www.w3.org/Graphics/JPEG/itu-t81.pdf),
[Three.js LOD](https://threejs.org/docs/pages/LOD.html), and the installed Three.js 0.180.0 modifier source.

## Verification and precise limitations

At source freeze, 90 targeted regressions pass, including the existing history-command integration test. Tests cover demand-only execution, empty catalogue,
cache hit/miss and coalescing, zero provider calls after fresh-cache restoration, no private prompt
leakage, exact semantic/category checks, future assets, changed revisions, hash mismatch, foreign URLs,
external model references, decoder failure, persistence failure, and corrupt cache records/bytes.

Repeatable checks (use local reviewed fixtures and already-installed browser/emulators):

```sh
npx tsx scripts/checks/gameAssetTexture.check.ts OUTPUT PLAYWRIGHT_MODULE CHROMIUM
npx tsx scripts/checks/gameAssetDemand.check.ts OUTPUT PLAYWRIGHT_MODULE CHROMIUM
npx tsx scripts/checks/gameAssetScenarios.check.ts OUTPUT ADMITTED_GLB_DIRECTORY PLAYWRIGHT_MODULE CHROMIUM
node scripts/checks/gameAssetStorage.check.mjs EMULATOR_DIRECTORY FIRESTORE_JAR --discovery
```

Actual browser JPEG baseline/progressive decode passes. A corrupt unused JPEG is rejected. The new
check also exposed an existing synthetic PNG with a bad IDAT checksum; it was replaced by an original
valid generated PNG. The earlier in-progress full suite was stopped (exit 130), then restarted for the
corrected tree. No assertion, decoder rule or coverage threshold was relaxed. Initial CLI failures from
an extensionless native-TypeScript import and unpadded test bytes were corrected and affected tests rerun.

The synthetic demand integration passes the real seed, provider-policy admission, GLB bundler, browser
verifier, durable project acknowledgement, disk cache, fresh-process cache hit, generated runtime,
Vite production artifact/reload and visible service credit. It makes **zero actual provider calls**:
metadata and binary responses are synthetic test adapters. A separate real private Storage emulator
check confirms JSON pointer + model persistence and a fresh-process cache hit without provider calls.
The seven real reviewed assets and six scenario fixtures are separately tested with offline admitted
bytes; the train station and several animals remain procedural. No additional third-party models were
downloaded in this continuation. Generated runtime strict TypeScript passes with the recipe-equivalent
Three.js 0.180.0 declarations installed only in an isolated verification prefix.

**Live transport remains blocked/unverified.** The parent's fresh executor confirms all five domains
allowed, yet actual guarded downloads fail `EAI_AGAIN` for both Poly Haven and Fox with zero bytes.
This continuation audited server transport use and found no approved proxy-aware replacement preserving
the connection-level SSRF guarantee. It did not add a proxy, alternate DNS, pinned IP or security-setting
change. Managed HTTPS metadata reads confirmed the official API response shape; they are not guarded
production transport proof. Do not ask for additional domains to fix this observed DNS failure.

Full coverage and all required local final gates passed against the source checkpoint above; terminal
results follow below. Physical devices, actual live discovery/download/render in a compatible
production network, full sandbox restart and cloud-published game acceptance remain unverified. L3 OFF;
PR creation paused; no merge/deployment. Broader provider discovery requires each provider's legitimate
interface and asset-level rights, not a blanket "free model" assumption.

The full-suite history-command test exposed a fixture that copied only the former fixed generator
dependency list. Its fixture now copies the two new helper modules too; all original hash-preservation
assertions remain. That incomplete suite was stopped and restarted after the correction. Common
English contractions and Hindi न are also covered by explicit no-download semantic regressions.

One initial Phase 2 concurrency drill observed an unconfirmed consumer outcome
(`QUEUE_STORE_UNAVAILABLE`) where its unchanged assertion required `QUEUE_CLAIM_CONFLICT`. Read-only
snapshots showed a paused queue and stopped successor lease; they are not a final transaction verdict.
The same unchanged drill was rerun separately after concurrent browser/build checks finished and
passed all 21 cases. No deadline, queue/billing logic or assertion was altered. Contention is a plausible
explanation, not an established root-cause diagnosis; the initial failure is retained in the evidence.

## Terminal verification — source d580c7fa3

- Full coverage exit 0: **3,195 files, 48,253 tests passed, 85 existing skips**, 1,051.29 seconds.
  Statements 75.60%, branches 71.54%, functions 78.21%, lines 77.58%; configured thresholds passed.
  Log: `/workspace/asset-evidence/demand-complete-coverage.log`. Metadata-server 403 warnings occurred
  during tests; they did not fail the suite and are retained in the log.
- All final local gates exit 0: audit, license, SBOM, three typechecks, native guard, build, bundle,
  boot, server dependencies, unused imports, OAuth failed-report and game-asset policy checks.
  Package verification: 1,375 registry signatures and 197 attestations verified.
- All final emulator/drill groups exit 0: Phase 2 Firestore, failed-report autopsy, DeepInfra comparison,
  session revocation, durable asset persistence and private Storage. The earlier Phase 2 race failure
  above remains disclosed; the final whole drill run passed with unchanged assertions.
- 90 targeted tests, actual browser texture checks, generated-runtime strict TypeScript, seven reviewed
  asset fixtures, six local scenarios, synthetic demand integration and fresh-process discovery Storage
  restoration passed. Synthetic discovery responses are not evidence of a live provider transfer.
- Node 22.23.4/npm 11.18.0 match the CI versions used here. Java is Debian OpenJDK 21.0.12.1 rather than
  CI's Temurin 21. Local checks do not establish remote PR CI, hosted deployment or physical-phone results.
- All owned verification runs are terminal. No new third-party model download, paid AI build, PR,
  merge, deployment or activation occurred. Earlier billing base 504b79298 remains an ancestor.

Remaining acceptance: actual guarded live transfer in a compatible approved network; physical-device
budgets/quality; six complete generated games; sandbox restart and cloud-published asset availability.
The fresh worker's zero-byte EAI_AGAIN remains the transport blocker. This worker still has the older
four-host custom allowlist, confirmed through the environment skill; it was not used to retry the CDN.
No additional domain request or proxy bypass is proposed. Broader provider discovery and animated LOD
are not implemented. PR creation remains paused after the earlier automatic approval-review denial;
only branch checkpoint pushes were performed.
