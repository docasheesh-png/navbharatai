# Optional declarative procedural object recipe

`run_recipe({name:"generate_procedural_object",input:{id,quality,plan_json}})` accepts a bounded original geometry plan from the existing admitted architect turn. It makes no extra provider call and does not alter admission, quota, billing, router selection or usage accounting. The prior object_spec lookup remains read-only and compatible.

Default disabled. `AGENTV3_PROCEDURAL_OBJECTS` must explicitly be `on`; this change does not configure production. Requires an existing reviewed Three.js 0.180.0 and @types/three 0.180.0 declarations. It does not install dependencies or replace customized/imported source. Invalid plans, unreadable project files and conflicts fail closed; partial additions are disclosed rather than called installed. Exact source readback is required.

The result is `source_installed`, NOT `scene_mounted` or visually accepted. It adds a fixed trusted runtime and a per-object factory in `src/game/generatedObjects/`. The architect must integrate factory invocation into the actual game lifecycle using existing guarded edits, one shared adapter with the remaining scene budget, world-relative placement and teardown. The recipe does not overwrite the game entrypoint automatically. Preview, safety checks and interaction/render verification remain required.

Version1 accepts flat box/sphere/cylinder/monotone-lathe parts with finite bounded transforms and simple PBR color/material values. It accepts no executable provider code, textures, URLs, shaders, imports or hierarchy. It neither supplies physics/animation nor guarantees arbitrary objects, believable humans or photorealism. Semantic correctness remains unverified until the actual result is checked against the request.

Validation in isolated staging: strict compiler tests, streaming/mount seam tests, real ToolDispatcher recipe tests and generated factory actual headless Three mount. Full current-main CI, independent integration review and browser/mobile acceptance are still release gates. No production activation, merge or deployment is implied.

Atomic creation is required. E2B uses a fixed sandbox Python helper to write/fsync an O_TMPFILE anonymous inode then publish it through a pinned /proc/self/fd descriptor using an exclusive hard link into a held no-follow parent directory. There is no replaceable staging pathname or cleanup unlink. Existing final paths are never replaced. Unsupported O_TMPFILE/filesystems/procfs fail closed, without fallback. This protects namespace races, not hostile debugger/kernel authority or later edits to published files. Live E2B capability has NOT been verified; production enablement remains blocked until a real dedicated sandbox test passes. Local Linux filesystem tests are not E2B acceptance.

## API-driven design, not a named preset collection

The existing admitted builder model/API turn can design a previously uncatalogued object by emitting an original plan through this tool. There is no object-name whitelist: the schema limits geometry operations and resource usage, not the names a user may request. The architect decomposes the requested silhouette and function into semantic parts, picks the target device budget, then requests validated source installation. Normal authorized guarded edits must integrate placement and any separately implemented gameplay behavior. No separate generation provider, credential, unaccounted side call, billing activation or runtime eval is added.

This is a first bounded generation route, not an unlimited asset API. Version1 supports primitives and monotone lathe surfaces; it does not generate arbitrary topology, scanned humans, rigs, textures, sound, skeletal animation or automatic physics. When a request requires unsupported geometry or behavior, report that gap and use the existing authorized builder workflow where appropriate rather than mislabelling a placeholder as the requested asset. Higher fidelity mesh/texture providers need a separately reviewed integration, licensing and quota/accounting before activation.

Publication note: testing was stopped at the owner's request. The final stacked draft, including this API-discoverability guidance, has not been retested. Prior isolated evidence does not establish final-head CI, E2B compatibility or browser/mobile acceptance. Keep disabled and do not merge on that evidence alone.

## 2026-11-18 reconciliation

The parent composition PR #4225 is now merged, so this PR targets main. Reconciliation retains main's current world sizing, intent exclusions, Forge, and exclusive-creation implementation, and applies only the procedural-object additions. An interrupted multi-file installation now explicitly reports possible earlier additions; it never rolls back paths that may contain a concurrent user edit. The exclusive-create race regression verifies that both the added runtime and the competing user's object survive without an installation claim.

Focused validation on Node 22.23.4: seven compiler, runtime, dispatcher, exclusive-creation/recording and composition suites passed (82 tests). Full combined-tree CI is coordinated separately; these focused results do not replace that gate. The feature remains default disabled. Dedicated real E2B and visual/mobile acceptance are still required before enabling it.
