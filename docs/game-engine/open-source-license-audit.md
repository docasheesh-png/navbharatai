# Game graphics — what was taken from outside, and what was not (2026-10-05)

The admin forwarded an external plan to upgrade game graphics. It named three open-source projects to study. The external-suggestion rule says: adapt, never transcribe blindly.

## The three projects, as they actually are (read from their repositories)

| Project | What it is | Code licence | Runs on | Used in NavBharatAI? |
|---|---|---|---|---|
| OpenX Clay (`OpenX-Inc/clay`) | Python orchestrator for image/text → 3D mesh. A GPU backend runs TRELLIS-2 / Hunyuan3D / Hi3DGen, then remesh, UV and PBR packing | MIT | A CUDA GPU server | **No.** Architectural reference only |
| AiGameKit (`maikramer/AiGameKit`) | Monorepo of GPU tools: FLUX text-to-image, Hunyuan3D text-to-3D and painting, rigging, terrain, skymaps | MIT (code). Model weights carry their own terms; some FLUX variants are gated or non-commercial | Local CUDA GPUs (≈6 GB+ VRAM) | **No.** Architectural reference only |
| AssetForge (`InFaNsO/AssetForge`) | Blender add-on: a 13-stage asset pipeline (retopology, UV, bake, rig, LOD, collision) driving AI services | MIT | Blender + external AI APIs | **No.** Architectural reference only |

**No code from any of them was copied.** Nothing in NavBharatAI depends on them.

## Why none of them can be dropped in

1. **Hardware.** All three need a GPU (or Blender). A NavBharatAI build runs in a CPU-only sandbox (2 vCPU / 4 GB). Generating meshes would mean new GPU infrastructure, which is a money decision for the admin, not an engineering default. See the E2B cost audit of the same day.
2. **Model weights are not the code.** The code licences are MIT. The 3D and image models they call each have their own licence, and some of those restrict commercial use, regions, or scale. Any future use needs a per-model review before a single asset ships.
3. **The real defect was elsewhere.** NavBharatAI's 3D layer (`src/server/lib/Game3DGenerator.ts`) already builds cars, trees, roads, rivers, mountains, animals and people from code. Rendering it in a browser showed that what made games look cheap was **bugs in that layer**, not missing AI assets. Those bugs are fixed and locked by tests that execute the layer (`tests/the3DLayerDrawsWhatItPromises.test.ts`).

## If GPU-generated assets are wanted later

The safe order is:
1. the admin approves a GPU budget;
2. one model is chosen after a licence review of its weights;
3. generation runs as a separate service whose output (a GLB) is validated and cached;
4. the procedural objects remain the fallback, so a failed service never leaves a blank game.

Clay's split between orchestrator and GPU backend is the right shape to copy as a design, not as code.

## Phase 2 (2026-10-05): the redesigned car, human and animals

Nothing external was added in Phase 2. The new car body, human and animals are original code in `src/server/lib/Game3DGenerator.ts`. They are built at runtime from three.js's own geometry classes (`ExtrudeGeometry`, `LatheGeometry`, `SphereGeometry`, `CylinderGeometry`, `RingGeometry`).

- No model files, textures or code were copied from any project.
- No new dependency was added.
- No GPL or AGPL component is involved. `three` stays the only runtime dependency (MIT).

`docs/game-engine/asset-inventory.md` records what each object is now and what an L3 (authored or generated mesh) level would need.
