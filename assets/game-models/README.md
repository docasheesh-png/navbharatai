# Reviewed derived models

`4e8915ef238773ca0b11576fd71dddb49449ce0aa6b575f0fce9e65e79e03f75.glb` is the Quaternius Eagle from Animal Pack Vol.2 (July 2017), CC0 1.0, converted offline with Blender 4.3.2. The adjacent Eagle-LICENSE.txt is the pack's license text.

Pinned source: https://github.com/beep2bleep/FreeAssetsByKenneyNLandQuaternius/blob/dea756baf3b3a4889d8c245e456a4791f961578a/FreeModels%20by%20Quaternius%5BPatreon%5D/Characters%20and%20Animals/Animal%20Pack%20Vol.2%20-%20Jul%202017/FBX/Eagle.fbx

Source SHA-256: `c3504c8e0904eab7b14e695609a861417f089cf724b94bda821ea4a3bbc6f505`.
License evidence: https://github.com/beep2bleep/FreeAssetsByKenneyNLandQuaternius/blob/dea756baf3b3a4889d8c245e456a4791f961578a/FreeModels%20by%20Quaternius%5BPatreon%5D/License.txt

Conversion used factory settings, disabled Python auto-execution and disabled image discovery. GLB retains the active Flying action and 24,800 triangles; no external image or buffer references. Materials use metallic 0, roughness 0.8, specular IOR level 0.5. Export normalized and limited vertex joint weights to four influences: this conversion is **not lossless**. Browser evidence confirmed render and changing animated pose; it does not establish physical mobile performance. No runtime FBX import is enabled. This reviewed derivative may be redistributed under CC0, independently of newer Quaternius packs' different license terms.

The server image includes this directory privately. The Eagle is loaded only on demand and checked
against its exact byte size and SHA-256; it is not fetched from this private repository at runtime.
The original public FBX URL remains provenance only. No user prompt can select a filesystem path.

## thumbs/

`thumbs/<sha256>.webp` — one 160×160 picture per reviewed library model, shown by the in-app Game library
(`GET /api/agentv3/game-library/thumb/:hash`, which serves only a file named by a catalogue hash). Rendered by
`node --import tsx scripts/library/renderLibraryThumbnails.mts <work dir> <playwright index.mjs>`; re-run it after
adding a library batch (it renders only the missing ones). Pictures exist only for CC0 and MIT models: a CC BY
picture would need an on-screen credit, and users never see a source name. `tests/theGameLibraryIsOnScreen.test.ts`
fails when a picture is missing or orphaned.
