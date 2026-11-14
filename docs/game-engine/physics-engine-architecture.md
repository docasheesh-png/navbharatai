# Physics engine — architecture and honest status

Written 2026-11-13, updated 2026-11-14 for stage B (the character controller). This is the CURRENT state of the
`generate_game_physics` recipe. It supersedes nothing and is not a plan: each line says whether it is implemented, partial,
disabled or unverified.

## Package

| | |
|---|---|
| Package | `@dimforge/rapier3d-compat` (official Rapier 3D, WASM inlined as base64) |
| Version | `0.21.0`, pinned exactly (npm, published 2026-09-25) |
| Licence | Apache-2.0 |
| Size | `dist/rapier.mjs` 4.3 MB raw, about 1.65 MB gzip (3.1 MB WASM inside). Loaded only by a game that calls `PhysicsWorld.create()` |
| Why `-compat` | The plain `@dimforge/rapier3d` needs a bundler WASM plugin; `-compat` works in a stock Vite app with no plugin |
| Verified against | the package's own typings (`dist/*.d.ts`) and by running it under Node 22 in the test suite. No example from memory was relied on |

## Where it sits

Three.js draws. Rapier simulates. `src/game/physics/` (written into a user's game by the recipe) is the only code between them:

- `config.ts` — `PhysicsConfig` and `sanitizePhysicsConfig` (every number clamped, unknown keys dropped), `BodySpec` and
  `validateBodySpec` (native code never sees a spec that has not passed), `interactionGroups`.
- `character.ts` — `PhysicsCharacter`: a capsule on a kinematic body moved by Rapier's own `KinematicCharacterController`
  (stage B, below).
- `world.ts` — `PhysicsWorld`: lazy WASM load, bodies, colliders, characters, fixed timestep with bounded catch-up and
  interpolation, collision and sensor events (delivered after the step), raycasts, pause / resume / reset / dispose,
  snapshot / restore, stats, development-only debug lines.
- `sync.ts` — `PhysicsBinding`: writes each bound object's interpolated transform. Structural (`position`, `quaternion`), so it
  does not import three.js.

It is OPTIONAL. Nothing else in the kit imports it. The architect prompt (step 4f) says to use it only when the request needs
real rigid bodies, never "just in case", and not for a tycoon, card, puzzle or ordinary arcade game.

## Status

| Capability | Status | Evidence |
|---|---|---|
| Dynamic / static / kinematic bodies, mass, density, friction, restitution, damping, gravity scale, locks, CCD | IMPLEMENTED, TESTED | `GamePhysicsGenerator.test.ts`, real Rapier |
| Box, sphere, capsule, cylinder, convex hull; static triangle mesh | IMPLEMENTED, TESTED | same; a dynamic triangle mesh is refused with a reason |
| Collision groups and masks | IMPLEMENTED, TESTED | a body that masks out the floor falls through it |
| Collision events; trigger volumes (sensors) | IMPLEMENTED, TESTED | enter and exit events; a sensor blocks nothing |
| Raycasts (distance, point, normal, mask) | IMPLEMENTED, TESTED | |
| Fixed timestep, clamped frame, bounded catch-up, dropped time reported | IMPLEMENTED, TESTED | 30 / 60 / 144 fps land within one step; uneven frames equal the same number of even steps exactly |
| Interpolated drawing | IMPLEMENTED, TESTED | |
| Pause, resume, reset | IMPLEMENTED, TESTED | |
| Snapshot and restore (versioned; all-or-nothing) | IMPLEMENTED, TESTED | running on from a restore equals running on without it, to 9 decimals, in one process |
| WASM failure fallback (`available === false`, safe no-ops) | IMPLEMENTED, TESTED | a loader that throws; a module that is not Rapier |
| Native memory freed (remove / reset / dispose; bookkeeping maps emptied) | IMPLEMENTED, TESTED | 1,000 add and remove cycles; a disposed world is a no-op |
| Limits (bodies, colliders, extents, triangles, every number) | IMPLEMENTED, TESTED | 20 kinds of bad body refused with a reason |
| Debug lines | IMPLEMENTED, TESTED, OFF by default | `config.debug` must be true |
| Joints and constraints | NOT IMPLEMENTED | `maxJoints` is a config bound only |
| Character: walk, fall, land, stand | IMPLEMENTED, TESTED | `character: …` tests on real Rapier; a flat walk covers 5.8875 m in 2 s at 3 m/s (the exact figure), standing is stable and grounded every step |
| Character: slide along walls, stopped by walls | IMPLEMENTED, TESTED | |
| Character: climb slopes up to `maxSlopeClimbDeg`, blocked above it | IMPLEMENTED, TESTED | a 65 degree slope is blocked at the default 50 and climbed at 75 |
| Character: step over ledges up to `autostepHeight` | IMPLEMENTED, TESTED | a 0.25 m ledge is climbed, a 0.7 m one is not |
| Character: snap to the ground down a small drop | IMPLEMENTED, TESTED | with snapping on it never leaves the ground over a 0.2 m drop; with it off it falls |
| Character: jump (height v squared over 2 g; same at 30 / 60 / 144 fps), coyote time, jump buffer, no double jump, ceiling stops the rise | IMPLEMENTED, TESTED | apex 2.15 m at 6.5 m/s |
| Character: air control (0 = momentum, 1 = full) | IMPLEMENTED, TESTED | |
| Character: rides kinematic platforms and lifts; knows what it stands on | IMPLEMENTED, TESTED | |
| Character: pushes dynamic bodies, collision groups and masks, walks into trigger volumes | IMPLEMENTED, TESTED | a sensor is not an obstacle to it |
| Character: saved in a snapshot, input included | IMPLEMENTED, TESTED | running on from a restore equals running on without it |
| Character: validation, limits, teleport, free on remove / reset / dispose | IMPLEMENTED, TESTED | 19 kinds of bad spec refused |
| Vehicle controller (Rapier `DynamicRayCastVehicleController`) | NOT IMPLEMENTED — stage C | `driveVehicle` stays; a car is not "physical" because of this |
| Buoyancy / water | NOT IMPLEMENTED | no validated model exists; rigid bodies are not a fluid simulation |
| GameProject versioned physics config; AI inferring physics per prompt beyond the architect-prompt rule | NOT IMPLEMENTED | there is no GameProject store (declined: see PROGRESS 2026-11-13) |
| Auto-seeding the recipe | NOT IMPLEMENTED, deliberately | the builder calls it when the request needs it |
| Desktop Chromium browser run | UNVERIFIED | tests run in Node (86 tests on the real engine) |
| Mobile Chromium, Capacitor Android WebView, iOS WebKit | UNVERIFIED | no device or WebView was available; no mobile claim is made |
| Pause on app backgrounding | UNVERIFIED | the game must call `pause()`; not tested in a WebView |
| Determinism across devices | NOT CLAIMED | holds on one machine and one binary |

## Two behaviours of Rapier's character controller worth knowing (found by testing, 2026-11-14)

- **No constant downward bias while grounded.** Asking the controller to move a tiny fixed distance down every step (what a
  per-step gravity term does) makes it return zero horizontal movement for one step roughly every half second. The kit therefore
  applies gravity only in the air and lets the controller's own snap-to-ground hold the character on the floor. Do not "simplify"
  this back: a flat walk then covers about 3% less ground, and the walk-distance test fails.
- **A sensor is an obstacle to the controller unless it is excluded**, and a static sensor only sees a kinematic body if BOTH
  colliders allow it (`ActiveCollisionTypes.ALL`). The kit excludes sensors from the character's movement and ground query and
  sets that flag on every sensor and on the character's collider.

A character's own contacts (its collider touching the floor flickers on and off as it walks) are deliberately NOT reported as
`collision_started` / `collision_stopped`; sensors still are.

## Measurements (this machine only)

Node v22.23.4, linux x64, with the full test suite running on the same machine, so treat as an upper bound and not a benchmark.
One fixed step (1/60 s), a pile of boxes and spheres on a floor, 360 steps:

| Bodies | Median step | p95 | Worst | Asleep at the end |
|---|---|---|---|---|
| 50 | 0.06 ms | 0.8 ms | 61 ms (first step: includes warm-up) | 50 |
| 200 | 0.06 ms | 0.7 ms | 7.8 ms | 200 |
| 500 | 0.17 ms | 1.7 ms | 57 ms | 500 |
| 1,000 | 2.4 ms | 4.5 ms | 9.2 ms | 1,000 |

WASM initialisation: 44 ms in Node (the module is already in memory there; a browser also pays the download and compile). These are
NOT phone numbers. Everything went to sleep, which is the point of sleeping, but it means a pile that stays in motion costs more
than this. A physical-device measurement is still to be done.

## Commands

```bash
npx vitest run src/server/lib/GamePhysicsGenerator.test.ts
```

## Deployment requirements

`@dimforge/rapier3d-compat@0.21.0` is a `devDependency` of this repository only so the tests can run the real engine. A generated
game gets it as a normal dependency, installed by the recipe machinery (`recipeDependenciesNeeded`). No environment variable, no
feature flag and no server-side change is involved.

## Known limitations

- Triangle meshes are static only. Anything that moves uses a box, sphere, capsule, cylinder or convex hull.
- The snapshot is the engine's own byte format plus the kit's id map; it is not promised to load across package versions.
- Interpolation uses a shortest-path normalised lerp for rotation, which is indistinguishable from slerp over one 1/60 s step.
- The debug view returns line data; drawing it with three.js is the game's job.
