// A CAR PICKED IN THE GAME LIBRARY ARRIVES IN AN OPEN-WORLD GAME TOO (admin 2026-11-26: "maine game library se police car
// choose ki par woh bhi nahi ayi, likh kar aya, yah car available nahi hai").
//
// 🔎 THE ROOT. "Use as my car" was written for the racing starter only (carSwap.ts sets CAR.model in src/game/car.ts). In any
// other game the platform REFUSED — "this game is not a race … it has no car file the platform can set" — and the user was told
// the car was not changed. A refusal where the kit can do the job is a skip: an open-world game has everything a car needs
// (ctx.vehicles: get in with Use, drive, get out; world.place: on the ground, moving with the floating origin).
//
// THE FIX. In a game whose features list is the kit's, the platform adds the picked model and writes
// src/game/features/myCar.ts: the car stands a few metres in front of the player, drivable at once (the kit's own car is the
// stand-in for the moment the model loads, and stays if the model cannot load — never an empty spot). Picking another car
// later changes one line (MY_CAR.model). PURE (strings in, strings out).

export const MY_CAR_FEATURE_PATH = 'src/game/features/myCar.ts';

/** The feature file for a library car (by its subject, e.g. 'police car'). PURE. */
export function myCarFeatureSource(subject: string): string {
  const model = String(subject).replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 80) || 'car';
  return [
    "// THIS GAME'S CAR — the one the user picked in the Game library, written by NavBharatAI. It stands in front of the player at",
    '// the start: walk up, press Use (E) to get in, drive, press Use to get out. To change it, change MY_CAR below.',
    "import * as THREE from 'three';",
    "import { defineFeature } from '../play/features';",
    "import type { OpenWorld } from '../play/openWorld';",
    "import { createCar } from '../three/objects';",
    "import { loadRequestedAsset } from '../three/assetModels';",
    '',
    'export const MY_CAR = {',
    '  /** The library model (its subject in this game). */',
    `  model: '${model}',`,
    '  /** Its length in metres (a car is about 4.3). */',
    '  length: 4.3,',
    '  /** Turn the model, degrees (180 if it drives backwards). */',
    '  yaw: 0,',
    '  /** How far in front of the player it stands at the start, metres. */',
    '  ahead: 7,',
    '};',
    '',
    'export default defineFeature<OpenWorld>({',
    "  id: 'myCar',",
    "  about: ['my car', 'meri gaadi', 'car', 'gaadi', 'vehicle', MY_CAR.model],",
    '  setup(ctx, world) {',
    '    const car = new THREE.Group();',
    "    car.name = 'My car (' + MY_CAR.model + ')';",
    '    // The kit\'s own car first, so there is a car to drive from the first frame; the picked model replaces its look.',
    '    const standIn = createCar();',
    '    car.add(standIn);',
    '    const at = world.playerWorld();',
    '    world.place(car, at.x + MY_CAR.ahead, at.z);',
    '    ctx.vehicles.add(car);',
    '    const none = () => ({ root: new THREE.Group(), source: \'procedural\' as const, update() {}, dispose() {} });',
    '    void loadRequestedAsset(MY_CAR.model, none).then((handle) => {',
    "      if (handle.source !== 'model') { console.error('[myCar] the model \"' + MY_CAR.model + '\" could not be loaded; the standard car is kept'); return; }",
    '      const model = handle.root;',
    '      model.rotation.y = THREE.MathUtils.degToRad(MY_CAR.yaw);',
    '      const box = new THREE.Box3().setFromObject(model);',
    '      const size = box.getSize(new THREE.Vector3());',
    '      const longest = Math.max(size.x, size.z) || 1;',
    '      model.scale.multiplyScalar(MY_CAR.length / longest);',
    '      const fit = new THREE.Box3().setFromObject(model);',
    '      model.position.x -= (fit.min.x + fit.max.x) / 2;',
    '      model.position.z -= (fit.min.z + fit.max.z) / 2;',
    '      model.position.y -= fit.min.y;                       // its wheels on the ground',
    '      car.remove(standIn);',
    '      car.add(model);',
    '    }).catch((error) => console.error(\'[myCar] the model could not be loaded; the standard car is kept\', error));',
    '    return car;',
    '  },',
    '});',
    '',
  ].join('\n');
}

/** `source` with MY_CAR.model set to this subject (every other byte kept), or null when it is not in the shape we wrote. PURE. */
export function setMyCarModel(source: string, subject: string): string | null {
  const model = String(subject).replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 80) || 'car';
  const lines = [...String(source).matchAll(/^([ \t]*model:[ \t]*)'[^'\n]*'([ \t]*,?[ \t]*)$/gm)];
  if (!/export const MY_CAR\b/.test(String(source)) || lines.length !== 1) return null;
  const [whole, lead, tail] = lines[0];
  return String(source).slice(0, lines[0].index!) + `${lead}'${model}'${tail}` + String(source).slice(lines[0].index! + whole.length);
}

/** What the builder is told when the platform put the car in. PURE. */
export function myCarAddedHandoff(name: string, subject: string): string {
  return `[DONE BY THE PLATFORM — the user's car] The user picked "${name}" in the Game library as the car they drive. This is an open-world game, so the platform `
    + `added that model to the game and wrote ${MY_CAR_FEATURE_PATH} (MY_CAR.model = '${subject}'), listed in src/game/features/index.ts: the car stands a few metres in `
    + 'front of the player at the start; the player walks up, presses Use (E) to get in, drives it and presses Use to get out. Do not add the model again, do not write '
    + 'another car for this request and do not edit src/App.tsx. Check that the game still runs, then tell the user in their language where the car is and how to get in, '
    + 'and that "gaadi ulti hai" is fixed with MY_CAR.yaw: 180.';
}
