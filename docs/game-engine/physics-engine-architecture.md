# Physics engine — architecture and honest status

Written 2026-11-13. This is the CURRENT state of the `generate_game_physics` recipe, stage A. It supersedes nothing and is
not a plan: each line says whether it is implemented, partial, disabled or unverified.

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
- `world.ts` — `PhysicsWorld`: lazy WASM load, bodies, colliders, fixed timestep with bounded catch-up and interpolation,
  collision and sensor events (delivered after the step), raycasts, pause / resume / reset / dispose, snapshot / restore,
  stats, development-only debug lines.
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
| Character controller (Rapier `KinematicCharacterController`) | NOT IMPLEMENTED — stage B | the kit's own controller stays |
| Vehicle controller (Rapier `DynamicRayCastVehicleController`) | NOT IMPLEMENTED — stage C | `driveVehicle` stays; a car is not "physical" because of this |
| Buoyancy / water | NOT IMPLEMENTED | no validated model exists; rigid bodies are not a fluid simulation |
| GameProject versioned physics config; AI inferring physics per prompt beyond the architect-prompt rule | NOT IMPLEMENTED | there is no GameProject store (declined: see PROGRESS 2026-11-13) |
| Auto-seeding the recipe | NOT IMPLEMENTED, deliberately | the builder calls it when the request needs it |
| Desktop Chromium browser run | UNVERIFIED | tests run in Node |
| Mobile Chromium, Capacitor Android WebView, iOS WebKit | UNVERIFIED | no device or WebView was available; no mobile claim is made |
| Pause on app backgrounding | UNVERIFIED | the game must call `pause()`; not tested in a WebView |
| Determinism across devices | NOT CLAIMED | holds on one machine and one binary |

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
