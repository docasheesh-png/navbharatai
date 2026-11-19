# Reusable racing-road library

`generate_game_3d` now emits `RACING_ROAD_MAPS` and `createRacingRoadPlan` from
`src/game/three/objects.ts`. The default `createTrackStream()` uses this catalog
only when the game has no explicit course. Preserve a user's specified circuit,
finite route, lengths and scenery rather than silently replacing their plan.

The shell also emits `src/game/RacingRoadGame.tsx`: render `<RacingRoadGame />`
for an actual starter using the default stream, vehicle controller, chase camera,
keyboard/touch controls, pause/resume and a throttled map/distance/lap/speed HUD.
It applies twelve distinct sky/fog colors and night illumination for map 12.
It cleans up its stream and Game on unmount. This is offered to builders for
racing without a user-specified course; it does not rewrite existing custom games.

Twelve maps run in order, then repeat map 1: Highway Straight (10 km), Left Sweep
(15), Right Sweep (20), S Bends (25), Ghat Crests (30), Valley Dips (35), City
Arterial (40), Underpasses (45), River Bridges (50), Desert Highway (60), Forest
Cut (80), Night Market (100). These are original catalog/geometry definitions,
not copied assets or implementation from the reference game.

Pass twelve finite lengths in the inclusive 10–100 km range to
`createRacingRoadPlan(lengthsKm)` to customize route lengths. Sparse, non-finite,
wrong-count and out-of-range input is rejected. This is a streamed journey,
not a physical closed circuit: the next map begins at the previous endpoint.

```ts
const stream = createTrackStream(createRacingRoadPlan(), { detail: 'lite' });
scene.add(stream.root);
// Start facing stream.startPose.heading; use the existing vehicle controller.
// In the game's update callback, after moving the car:
const status = stream.update(car, otherMovingObjects);
const piece = status.segment?.piece;
const map = piece?.mapId ? RACING_ROAD_MAPS[piece.mapId - 1] : undefined;
const mapMetres = piece && status.segment
  ? (piece.mapOffsetMetres ?? 0) + status.distance - status.segment.startDistance : 0;
// On map changes, update the HUD and atmosphere from map.name/map.lighting.
// Dispose on scene teardown:
// stream.dispose();
```

Map identity stays stable across short geometry chunks. A library loop is the
whole twelve-map journey, not one chunk; `status.lap` starts at zero. Map lighting
is metadata in the lower-level library; the generated RacingRoadGame starter
applies it explicitly on transitions. Forest/city themes supply ground palette and metadata,
not a claim of populated city assets. Existing bridge/tunnel and hill geometry
provide physical route variation.

Each mesh chunk is at most 200 m. At most 6000 small plan records describe the
maximum 1200 km journey; only current/ahead/behind chunks have geometry. The
existing floating origin rebases around 800 m, keeping coordinates near the
player; pass other moving objects to `update` so they rebase too. The caller must
apply the returned shift to any independent camera/controller state. Chunk-owned
materials are disposed on recycling; shared ground materials survive recycling
and are disposed once with the stream. No provider, network or paid asset fetch
is required.

Tests cover order, per-map distance, fractional lengths, invalid inputs, all map
joins including 12→1, actual rolling-window/rebase behavior, resource disposal,
custom finite/circuit behavior and generated code contracts. These CPU tests do
not prove mobile GPU frame rate, real-browser visuals, a complete 510 km drive,
or production deployment. Component tests execute emitted code with a mocked
WebGL host to verify all twelve HUD/theme transitions and 12→1, not screenshots. Required repository gates still apply before release.

## Editable course integration (main #4293 preserved)

The twelve-map loop is a starting default, not a restriction on the user's game.
`createTrackStream(customPlan)` still accepts any number/order of pieces and
finite, circuit or infinite courses. Its existing `setPlan(next, { now: true })`
keeps the road under the car and replaces only the upcoming pieces. Without
`now`, already-laid road ahead is retained. Width, land seed and stream window
remain those of construction, along with terrain amplitude/frequency and the
rebase threshold. Empty changes are refused. A terminal or circuit closure still
ahead can be replaced with `now`; a terminal already under the car cannot reopen.

The starter also accepts an initial custom plan and exposes its live stream:

```tsx
<RacingRoadGame plan={TRACK_PLAN} onReady={stream => { editableStream.current = stream; }} />
// A later track-picker action may call:
// editableStream.current?.setPlan(nextPlan, { now: true });
```

`plan` identity changes dispose and restart the whole game, applying all new
constructor settings. Keep its identity stable during ordinary React renders.
Use `setPlan` for seamless live changes and inspect its boolean result; pass a
new plan identity to restart an ended course. Custom segments use their own name/length in the HUD rather
than inventing a twelve-map identity. The build handoff preserves the separate
editable trackPlan.ts, and explicit straight-road requests keep their own plan.
The advisory scanner ignores the unused generated starter; mounting it in JSX
counts as using it, while a separate finite road still gets a note. This remains
a heuristic, not a hard proof of live playback or a build-blocking gate.
