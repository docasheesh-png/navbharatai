// OBJECT FORGE — the recipe side: the kit file a game needs once (src/game/forge/forge.ts), the guide the builder reads, and the switch.
//
// The point (admin 2026-11-15): "NavBharatAI should be able to make ANY object or subject, not depend on the modules somebody built".
// The library and the Athree modules are things already made. This is the other half: when a game needs something nobody made — a
// dragon, a lighthouse, a samosa cart — the builder DESCRIBES it as a small spec (primitives, a transform tree, materials, mirrors,
// pivots, animation clips), the Forge checks and measures it and draws it back as text, and the builder fixes what the drawing shows.
// The same engine then builds it inside the game.
import type { RecipeOutput } from '../gameRecipeLayers';
import { FORGE_ENGINE } from './forgeEngineSource';
import { FORGE_CUSTOMISE } from './forgeCustomiseKitSource';
import { FORGE_DIR } from './forgePaths';
import { FORGE_EXAMPLE_IDS } from './forgeExamples';

/** On by default (a kill switch, not a gate): AGENTV3_OBJECT_FORGE=off removes the tool's effect without a deploy. */
export function objectForgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !['off', '0', 'false', 'no'].includes(String(env.AGENTV3_OBJECT_FORGE ?? '').trim().toLowerCase());
}

/** The kit file, and a compiled usage example (tests/aRecipeExampleCompiles.test.ts typechecks it against the real forge.ts). */
export function generateObjectForge(): RecipeOutput & { instructions: string } {
  const fence = '```';
  return {
    files: { [FORGE_DIR + 'forge.ts']: FORGE_ENGINE, [FORGE_DIR + 'customise.ts']: FORGE_CUSTOMISE },
    instructions: [
      'The Object Forge engine is src/game/forge/forge.ts. Objects are written to src/game/objects/<id>.ts by author_object; use one like this:',
      '',
      fence + 'ts',
      "import * as THREE from 'three';",
      "import { createObject, type ObjectSpec } from './game/forge/forge';",
      '',
      "const spec: ObjectSpec = { id: 'crate', name: 'Crate', materials: { wood: { color: '#8a5a2b' } }, nodes: [{ name: 'box', shape: { type: 'box', size: [1, 1, 1] }, material: 'wood', position: [0, 0.5, 0], clips: { spin: [{ property: 'rotation', axis: 'y', amplitude: 40, speed: 0.5 }] } }] };",
      '',
      'export function addCrate(scene: { add(o: unknown): void }): (dt: number) => void {',
      '  const crate = createObject(THREE, spec);',
      '  scene.add(crate.group);',
      "  crate.play('spin');",
      '  return (dt: number) => crate.update(dt);',
      '}',
      fence,
    ].join('\n'),
  };
}

/** What the builder reads when it calls author_object with no spec. Short enough to keep in mind, complete enough to write a spec from. */
export const FORGE_GUIDE = [
  'OBJECT FORGE — describe ANY object as a spec; it is checked, measured and drawn back to you as text before it reaches the game.',
  '',
  'Use it for anything the game library does not have (a creature, a vehicle, a building, a prop, a person). Look in the library first; for',
  'the rest, do not hand-write vertices or boxes inside game code: author it here, once, and use it by name.',
  '',
  'CONVENTIONS: metres. +Y is up. The object FACES +Z. Its base sits on y = 0, centred on x = 0, z = 0. A person is about 1.75 m, a car 4.5 m.',
  '',
  'SPEC: { "id": "red-dragon", "name": "Red dragon", "materials": { "scale": { "color": "#a3201a", "roughness": 0.6 } }, "nodes": [ NODE, ... ] }',
  'NODE: { "name": "head", "shape": SHAPE, "material": "scale", "position": [x,y,z], "rotation": [degX,degY,degZ], "scale": [x,y,z],',
  '        "mirror": "x", "mirrorPhase": 0.5, "repeat": { "count": 6, "step": [1,0,0] } or { "count": 8, "around": { "axis": "y" } },',
  '        "clips": { "walk": [ TRACK ] }, "children": [ NODE ] }',
  '  - A node with no shape is a PIVOT: put a joint there and hang the limb under it, so the limb swings from the joint.',
  '  - position is the CENTRE of the shape, relative to the parent. Children move, turn and scale with their parent.',
  '  - mirror adds a reflected copy of the node and everything under it (name + _mirror): build the left side, get the right for free.',
  '  - repeat makes copies (name_1, name_2, ...): a fence (step) or the spokes of a wheel (around).',
  'SHAPE (all centred on their own origin):',
  '  box { size:[x,y,z] }                              sphere { radius: r or [rx,ry,rz], seg }   (an ellipsoid when radius is a list)',
  '  cylinder { radiusTop, radiusBottom, height, seg } (radius 0 at one end is a cone)            capsule { radius, length, seg } (the middle length)',
  '  torus { radius, tube }                            lathe { profile:[[radius,y],...], seg }   (a vase, a bottle, a column, a bowl)',
  '  loft { length, sections:[{t:0..1, halfWidth, top, bottom, power}], stations, ring }  (a body along z: fuselage, hull, torso, animal trunk)',
  '  extrude { polygon:[[x,y],...], depth }            (any outline pushed to a thickness: blade, wing, roof gable, gear; list points in order)',
  '  tube { path:[[x,y,z],...], radius: r or [r per point] }  (tail, branch, rope, tentacle, pipe; a radius of 0 at the end makes a point)',
  '  plane { size:[w,d] }',
  'TRACK: { "property": "rotation"|"position"|"scale", "axis": "x"|"y"|"z", "amplitude": 30, "speed": 1, "phase": 0, "offset": 0 }',
  '  Add "spin": true to a rotation and it TURNS FOR EVER at speed turns per second (a wheel, a propeller, a fan, a windmill; no amplitude);',
  '  a wheel whose axle runs along x spins about x. A negative speed turns the other way.',
  '  value = offset + amplitude * sin(2*pi*(speed*time + phase)). Rotation is in DEGREES, position in metres. A rotation about x swings a',
  '  hanging limb forward/back (positive = backward, the object faces +z). mirrorPhase 0.5 makes the mirrored limb swing the opposite way.',
  '',
  'HOW TO MAKE IT GOOD:',
  '  1. Block the biggest masses first with the right PROPORTIONS (a head is 1/7 to 1/8 of a person; a dog is longer than it is tall).',
  '  2. Make every part touch its neighbour: a limb ends INSIDE the body, not next to it. The report warns about parts that float free.',
  '  3. Give living things pivots at the joints (shoulder, elbow, hip, knee, neck, tail root) and one "walk" clip; add "idle".',
  '  4. Fewer, well-placed shapes beat many: a phone game wants under 3000 triangles per object (seg 8 to 14 is plenty).',
  '  5. Call author_object, LOOK at the FRONT / SIDE / TOP drawings and the warnings, fix them, call again with the same id.',
  '',
  'HONEST CEILING: this builds stylised, low-poly figures from primitives. It does not make photoreal faces, clothing folds, fur or a',
  'scanned model. Describe the result to the user as stylised; never call it realistic. A real sculpted model is a library asset, not this.',
  '',
  'EASIEST: author_object({ describe: "a lighthouse with a spiral stair" }) — the Forge makes the object itself from your words (no spec needed).',
  'EXAMPLES you can fetch and adapt: ' + FORGE_EXAMPLE_IDS.join(', ') + ' — author_object({ example: "person" }) returns the full spec and its drawing.',
].join('\n');

export function forgeUsage(id: string, create: string): string {
  return [
    'Use it in the game:',
    '  import { ' + create + " } from './objects/" + id + "';",
    '  const obj = ' + create + '(THREE);          // THREE is your three.js import',
    '  scene.add(obj.group);                       // obj.group.position / rotation.y place and turn it',
    "  obj.play('walk');                           // a clip name from the list above; obj.play(null) stops",
    '  // each frame: obj.update(dt);              // dt in seconds',
    '  // obj.nodes.head is the named node (attach a weapon to obj.nodes.hand, turn a head toward a target); obj.dispose() frees it.',
    'To change the object, call author_object again with the same id (the file is replaced). Do not hand-write geometry for it in game code.',
  ].join('\n');
}
