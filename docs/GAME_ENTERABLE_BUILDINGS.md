# Enterable house kit

Opt-in: `createHouse({ enterable: true })` from `three/objects`, or
`createEnterableHouse()` from `three/buildings`. Existing scenery factories and
saved user source are not converted silently.

The factory creates one/two storeys, a real 1.5 m doorway, hinged door, separate
walls, floors and roof, and stairs plus an upper landing. The shape is procedural,
not a photorealistic purchased asset. Its origin is ground centre, entrance +Z.
Two-storey footprints require at least 8 m depth; actual bounded dimensions are
available in `root.userData.enterableHouse`.

The generated `Game` shell wires E / default mobile Use to the nearest visible
door and advances door state before player movement. Custom loops must call
`interactHouseDoor(scene, actor)` and `updateHouseDoors(scene, dt, occupants)`.
Occupants use world-space feet, radius and height. Supply NPC/remote bodies via
`GameOptions.doorOccupants`; default wiring covers the player only. Door sweeps
stop when an occupant intersects the swept leaf, then resume when clear.

Limitations: door sweep occupancy is conservative axis-aligned bounding boxes;
static props must be kept out of the swing. Cloning or scene-JSON round trips do
not preserve WeakMap interaction state: rebuild using the factory. No save/network
synchronization is supplied. Existing games and edited kit files need deliberate
upgrades, not replacement. Materials default to the existing shared cache; caller
materials remain caller-owned.

Local tests exercise collision entry/exit, stairs, occupied swings, isolated house
instances, line of sight/range, indoor camera, exact fractional floor triangles,
mirrored floor edges, support release and legacy compatibility. Full repository
CI and real browser/device playtesting remain separate release gates.
