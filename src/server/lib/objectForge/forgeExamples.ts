// OBJECT FORGE — worked examples the builder can ask for (author_object({ example: "person" })) and adapt. Every one is a real, checked spec:
// tests build each, measure it, and hold it to its own claims (height, parts touching, a walk clip that does not tear it apart).
//
// They are STARTING POINTS, not a catalogue the builder is limited to: a "giraffe" is the quadruped with a longer neck and legs, a
// "robot" is the person with box parts, a "castle" is the house repeated. The rules the examples teach are what matters: proportions in
// metres, parts that touch, limbs hung from pivots so they can swing, one side built and mirrored.
//
// Honest ceiling: these are stylised, low-poly figures — no faces, no clothing folds, no fur. That is a choice the builder can state to
// the user; it is never passed off as realistic.

export interface ForgeExample {
  id: string;
  what: string;
  spec: Record<string, unknown>;
}

const walk = (axis: 'x' | 'y' | 'z', amplitude: number, phase = 0, speed = 1, offset = 0): Record<string, unknown> => ({ property: 'rotation', axis, amplitude, speed, phase, offset });

// ---------------------------------------------------------------------------------------------------------------------------------
// A person, 1.8 m, facing +z. Torso is the pivot of everything (it bobs when walking); each arm hangs from a shoulder, each leg from a hip,
// with an elbow and a knee below. Left and right are ONE node with mirror: "x" and mirrorPhase 0.5, so they swing against each other.
const PERSON: ForgeExample = {
  id: 'person',
  what: 'A stylised person, 1.8 m tall: torso, head with hair and eyes, two arms with elbows, two legs with knees and shoes. Clips: walk, idle.',
  spec: {
    id: 'person',
    name: 'Person',
    materials: {
      skin: { color: '#d9a273', roughness: 0.8 },
      hair: { color: '#2b1d14', roughness: 0.9 },
      shirt: { color: '#3b6ea5', roughness: 0.85 },
      pants: { color: '#2f3640', roughness: 0.9 },
      shoes: { color: '#1b1b1f', roughness: 0.6 },
      eye: { color: '#101010', roughness: 0.3 },
    },
    nodes: [
      {
        name: 'torso',
        position: [0, 0.95, 0],
        clips: { walk: [{ property: 'position', axis: 'y', amplitude: 0.02, speed: 2, phase: 0.25 }], idle: [{ property: 'position', axis: 'y', amplitude: 0.006, speed: 0.5 }] },
        children: [
          { name: 'pelvis', shape: { type: 'box', size: [0.34, 0.2, 0.2] }, material: 'pants' },
          { name: 'chest', shape: { type: 'capsule', radius: 0.15, length: 0.2 }, material: 'shirt', position: [0, 0.34, 0], scale: [1.15, 1, 0.75] },
          { name: 'neck', shape: { type: 'cylinder', radiusTop: 0.05, radiusBottom: 0.055, height: 0.1 }, material: 'skin', position: [0, 0.6, 0] },
          {
            name: 'head',
            position: [0, 0.66, 0],
            clips: { idle: [walk('y', 8, 0, 0.2)] },
            children: [
              { name: 'skull', shape: { type: 'sphere', radius: [0.09, 0.105, 0.1], seg: 14 }, material: 'skin', position: [0, 0.08, 0] },
              { name: 'hair', shape: { type: 'sphere', radius: [0.097, 0.09, 0.105], seg: 14 }, material: 'hair', position: [0, 0.115, -0.012] },
              { name: 'nose', shape: { type: 'box', size: [0.02, 0.035, 0.03] }, material: 'skin', position: [0, 0.07, 0.1] },
              { name: 'eye', shape: { type: 'sphere', radius: 0.012, seg: 8 }, material: 'eye', position: [0.035, 0.1, 0.088], mirror: 'x' },
            ],
          },
          {
            name: 'shoulder',
            position: [0.2, 0.5, 0],
            mirror: 'x',
            mirrorPhase: 0.5,
            clips: { walk: [walk('x', 28, 0.5)], idle: [walk('z', 1.5, 0, 0.5)] },
            children: [
              { name: 'upper_arm', shape: { type: 'capsule', radius: 0.042, length: 0.18 }, material: 'shirt', position: [0, -0.15, 0] },
              {
                name: 'elbow',
                position: [0, -0.3, 0],
                rotation: [-12, 0, 0],
                clips: { walk: [walk('x', 14, 0.5, 1, -14)] },
                children: [
                  { name: 'forearm', shape: { type: 'capsule', radius: 0.036, length: 0.16 }, material: 'skin', position: [0, -0.12, 0] },
                  { name: 'hand', shape: { type: 'sphere', radius: 0.04, seg: 8 }, material: 'skin', position: [0, -0.25, 0] },
                ],
              },
            ],
          },
          {
            name: 'hip',
            position: [0.09, -0.1, 0],
            mirror: 'x',
            mirrorPhase: 0.5,
            clips: { walk: [walk('x', 30, 0)] },
            children: [
              { name: 'thigh', shape: { type: 'capsule', radius: 0.07, length: 0.3 }, material: 'pants', position: [0, -0.22, 0] },
              {
                name: 'knee',
                position: [0, -0.46, 0],
                clips: { walk: [walk('x', 22, 0.25, 1, 22)] },
                children: [
                  { name: 'shin', shape: { type: 'capsule', radius: 0.052, length: 0.3 }, material: 'pants', position: [0, -0.18, 0] },
                  { name: 'foot', shape: { type: 'box', size: [0.1, 0.07, 0.26] }, material: 'shoes', position: [0, -0.355, 0.05] },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------------------------------------------------------------
// A four-legged animal (a dog-like body, 0.6 m at the shoulder, 1.0 m long). The body is a LOFT along z (sections from tail to chest),
// the legs hang from four hips (front pair and back pair, each a mirrored node), the tail is a tube.
const QUADRUPED: ForgeExample = {
  id: 'quadruped',
  what: 'A four-legged animal like a dog: lofted body, neck, head with snout and ears, four legs that trot, a wagging tail. Clips: walk, idle. Stretch the legs and neck for a horse or a giraffe.',
  spec: {
    id: 'quadruped',
    name: 'Four-legged animal',
    materials: {
      fur: { color: '#b07a3c', roughness: 0.95 },
      belly: { color: '#e3cfa6', roughness: 0.95 },
      dark: { color: '#2a1d12', roughness: 0.7 },
      eye: { color: '#0d0d0d', roughness: 0.3 },
    },
    nodes: [
      {
        name: 'body',
        position: [0, 0, 0],
        children: [
          {
            name: 'trunk',
            shape: {
              type: 'loft', length: 0.95, stations: 16, ring: 14,
              sections: [
                { t: 0, halfWidth: 0.08, top: 0.62, bottom: 0.46 },
                { t: 0.2, halfWidth: 0.12, top: 0.68, bottom: 0.42 },
                { t: 0.6, halfWidth: 0.14, top: 0.7, bottom: 0.4 },
                { t: 1, halfWidth: 0.11, top: 0.7, bottom: 0.44 },
              ],
            },
            material: 'fur',
          },
          {
            name: 'neck',
            position: [0, 0.68, 0.45],
            rotation: [-35, 0, 0],
            children: [
              { name: 'neck_shape', shape: { type: 'capsule', radius: 0.075, length: 0.12 }, material: 'fur', position: [0, 0.06, 0] },
            ],
          },
          {
            name: 'head',
            position: [0, 0.82, 0.56],
            clips: { idle: [walk('x', 6, 0, 0.3)], walk: [{ property: 'rotation', axis: 'x', amplitude: 3, speed: 2, phase: 0.1 }] },
            children: [
              { name: 'skull', shape: { type: 'sphere', radius: [0.085, 0.08, 0.1], seg: 12 }, material: 'fur', position: [0, 0, 0] },
              { name: 'snout', shape: { type: 'capsule', radius: 0.04, length: 0.07 }, material: 'belly', position: [0, -0.02, 0.12], rotation: [90, 0, 0] },
              { name: 'nose', shape: { type: 'sphere', radius: 0.02, seg: 8 }, material: 'dark', position: [0, -0.015, 0.2] },
              { name: 'ear', shape: { type: 'box', size: [0.03, 0.09, 0.05] }, material: 'dark', position: [0.06, 0.09, -0.02], rotation: [0, 0, -18], mirror: 'x' },
              { name: 'eye', shape: { type: 'sphere', radius: 0.013, seg: 8 }, material: 'eye', position: [0.045, 0.03, 0.075], mirror: 'x' },
            ],
          },
          {
            name: 'tail',
            position: [0, 0.6, -0.46],
            clips: { walk: [walk('x', 8, 0, 1)], idle: [walk('y', 20, 0, 2.5)] },
            children: [
              { name: 'tail_shape', shape: { type: 'tube', path: [[0, 0, 0], [0, 0.08, -0.1], [0, 0.2, -0.16]], radius: [0.03, 0.025, 0.012], seg: 8 }, material: 'fur' },
            ],
          },
          {
            name: 'front_leg',
            position: [0.09, 0.46, 0.34],
            mirror: 'x',
            mirrorPhase: 0.5,
            clips: { walk: [walk('x', 28, 0)] },
            children: [
              { name: 'f_upper', shape: { type: 'capsule', radius: 0.04, length: 0.16 }, material: 'fur', position: [0, -0.12, 0] },
              {
                name: 'f_wrist',
                position: [0, -0.24, 0],
                clips: { walk: [walk('x', 14, 0.25, 1, -14)] },
                children: [
                  { name: 'f_lower', shape: { type: 'capsule', radius: 0.032, length: 0.12 }, material: 'fur', position: [0, -0.09, 0] },
                  { name: 'f_paw', shape: { type: 'box', size: [0.07, 0.04, 0.11] }, material: 'dark', position: [0, -0.2, 0.02] },
                ],
              },
            ],
          },
          {
            name: 'back_leg',
            position: [0.09, 0.46, -0.32],
            mirror: 'x',
            mirrorPhase: 0.5,
            clips: { walk: [walk('x', 28, 0.5)] },
            children: [
              { name: 'b_upper', shape: { type: 'capsule', radius: 0.05, length: 0.16 }, material: 'fur', position: [0, -0.1, -0.02], rotation: [12, 0, 0] },
              {
                name: 'b_hock',
                position: [0, -0.22, -0.05],
                clips: { walk: [walk('x', 18, 0.75, 1, 18)] },
                children: [
                  { name: 'b_lower', shape: { type: 'capsule', radius: 0.032, length: 0.12 }, material: 'fur', position: [0, -0.09, 0] },
                  { name: 'b_paw', shape: { type: 'box', size: [0.07, 0.04, 0.11] }, material: 'dark', position: [0, -0.2, 0.02] },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------------------------------------------------------------
// A house: walls from a box, a roof from an EXTRUDED triangle, a door and windows as thin boxes, a chimney. Nothing animates.
const HOUSE: ForgeExample = {
  id: 'house',
  what: 'A small house 8 m wide: walls, a pitched roof (an extruded triangle), door, two windows, chimney. For a castle, shop or temple, change the boxes and repeat the towers.',
  spec: {
    id: 'house',
    name: 'House',
    materials: {
      wall: { color: '#e8d9b5', roughness: 0.95 },
      roof: { color: '#a8442f', roughness: 0.85 },
      wood: { color: '#6b4426', roughness: 0.8 },
      glass: { color: '#9fd3e6', roughness: 0.1, metalness: 0.2, opacity: 0.8 },
      stone: { color: '#8d8d8d', roughness: 1 },
    },
    nodes: [
      { name: 'walls', shape: { type: 'box', size: [8, 3, 6] }, material: 'wall', position: [0, 1.5, 0] },
      { name: 'roof', shape: { type: 'extrude', polygon: [[-3.5, 0], [3.5, 0], [0, 2.4]], depth: 8.8 }, material: 'roof', position: [0, 3, 0], rotation: [0, 90, 0] },
      { name: 'door', shape: { type: 'box', size: [1.1, 2.1, 0.12] }, material: 'wood', position: [0, 1.05, 3.03] },
      { name: 'window', shape: { type: 'box', size: [1.2, 1, 0.12] }, material: 'glass', position: [2.4, 1.7, 3.03], mirror: 'x' },
      { name: 'chimney', shape: { type: 'box', size: [0.7, 1.8, 0.7] }, material: 'stone', position: [2.6, 4.2, -1.2] },
    ],
  },
};

// ---------------------------------------------------------------------------------------------------------------------------------
// A tree: the trunk is a TUBE along a bent path (tapering to a point), the crown is overlapping spheres. A tree sways in the wind.
const TREE: ForgeExample = {
  id: 'tree',
  what: 'A broadleaf tree 6 m tall: a bent tapering trunk, two branches, a crown of overlapping leaf blobs; it sways in a breeze (clip: sway). For a pine, stack cones; for a palm, curve the trunk and radial-repeat long leaves.',
  spec: {
    id: 'tree',
    name: 'Tree',
    materials: {
      bark: { color: '#5b4128', roughness: 1 },
      leaf: { color: '#3f7d34', roughness: 0.9 },
      leaf2: { color: '#52964a', roughness: 0.9 },
    },
    nodes: [
      {
        name: 'tree',
        clips: { sway: [walk('z', 1.2, 0, 0.3), walk('x', 0.8, 0.3, 0.25)] },
        children: [
          { name: 'trunk', shape: { type: 'tube', path: [[0, 0, 0], [0.05, 1.2, 0], [-0.08, 2.4, 0.05], [0.05, 3.4, 0]], radius: [0.3, 0.24, 0.17, 0.1], seg: 10 }, material: 'bark' },
          { name: 'branch', shape: { type: 'tube', path: [[0, 2.5, 0], [0.5, 3.1, 0.1], [0.95, 3.7, 0.1]], radius: [0.1, 0.07, 0.04], seg: 6 }, material: 'bark', mirror: 'x' },
          { name: 'crown_main', shape: { type: 'sphere', radius: [1.5, 1.2, 1.5], seg: 14 }, material: 'leaf', position: [0, 4.5, 0] },
          { name: 'crown_side', shape: { type: 'sphere', radius: [0.95, 0.8, 0.95], seg: 12 }, material: 'leaf2', position: [1.1, 4, 0.2], mirror: 'x' },
          { name: 'crown_top', shape: { type: 'sphere', radius: [0.9, 0.7, 0.9], seg: 12 }, material: 'leaf2', position: [0.1, 5.4, -0.1] },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------------------------------------------------------------
// A sword: the blade is an EXTRUDED outline (a point at the tip), the guard and grip are boxes and a cylinder, the pommel a sphere.
// It is 1.1 m and lies along +y with the handle at the bottom, so it can be put in a hand node and rotated.
const SWORD: ForgeExample = {
  id: 'sword',
  what: 'A one-handed sword 1.1 m long: pointed blade, guard, grip, pommel. Held upright (blade along +y); parent it to a hand node. For an axe or spear change the extruded outline.',
  spec: {
    id: 'sword',
    name: 'Sword',
    materials: {
      steel: { color: '#c7ccd1', roughness: 0.25, metalness: 0.9 },
      brass: { color: '#b58a2e', roughness: 0.4, metalness: 0.8 },
      leather: { color: '#4a2f1d', roughness: 0.9 },
    },
    nodes: [
      {
        name: 'sword',
        children: [
          { name: 'pommel', shape: { type: 'sphere', radius: 0.035, seg: 10 }, material: 'brass', position: [0, 0.035, 0] },
          { name: 'grip', shape: { type: 'cylinder', radiusTop: 0.022, radiusBottom: 0.022, height: 0.18, seg: 10 }, material: 'leather', position: [0, 0.17, 0] },
          { name: 'guard', shape: { type: 'box', size: [0.26, 0.03, 0.05] }, material: 'brass', position: [0, 0.275, 0] },
          { name: 'blade', shape: { type: 'extrude', polygon: [[-0.035, 0], [0.035, 0], [0.032, 0.66], [0, 0.74], [-0.032, 0.66]], depth: 0.012 }, material: 'steel', position: [0, 0.29, 0] },
        ],
      },
    ],
  },
};


// ---------------------------------------------------------------------------------------------------------------------------------
// Vehicles. The wheels TURN: a rotation track with spin: true, about the axle (x), so one clip makes every wheel of a repeated carriage roll.
// A TRAIN: a locomotive (boiler on its side, cab, chimney, three pairs of big wheels) and two carriages made ONCE and repeated.
const spin = (axis: 'x' | 'y' | 'z', speed: number): Record<string, unknown> => ({ property: 'rotation', axis, speed, spin: true });

const TRAIN: ForgeExample = {
  id: 'train',
  what: 'A steam train 30 m long: locomotive (boiler, cab, chimney, headlamp, six big wheels) and two carriages (windows, roof, four wheels each), the carriage built once and repeated. Wheels roll (clip: run). For a metro or a bullet train change the boiler to a loft nose and drop the chimney.',
  spec: {
    id: 'train',
    name: 'Steam train',
    materials: {
      engine: { color: '#1f3a5f', roughness: 0.5, metalness: 0.4 },
      dark: { color: '#262626', roughness: 0.7, metalness: 0.5 },
      roof: { color: '#d9d9d9', roughness: 0.6 },
      coach: { color: '#b3342b', roughness: 0.6 },
      glass: { color: '#9fd3e6', roughness: 0.1, metalness: 0.2, opacity: 0.85 },
      wheel: { color: '#303030', roughness: 0.5, metalness: 0.7 },
      lamp: { color: '#fff3c4', emissive: '#ffd45e' },
    },
    nodes: [
      { name: 'chassis', shape: { type: 'box', size: [2.0, 0.5, 8.6] }, material: 'dark', position: [0, 0.7, 8.2] },
      { name: 'boiler', shape: { type: 'cylinder', radiusTop: 1.0, radiusBottom: 1.0, height: 6.5, seg: 16 }, material: 'engine', position: [0, 1.85, 8.75], rotation: [90, 0, 0] },
      { name: 'cab', shape: { type: 'box', size: [2.3, 2.6, 2.2] }, material: 'engine', position: [0, 2.0, 4.6] },
      { name: 'cab_roof', shape: { type: 'box', size: [2.5, 0.15, 2.5] }, material: 'roof', position: [0, 3.35, 4.6] },
      { name: 'chimney', shape: { type: 'cylinder', radiusTop: 0.3, radiusBottom: 0.2, height: 1.0, seg: 12 }, material: 'dark', position: [0, 3.2, 11.2] },
      { name: 'dome', shape: { type: 'sphere', radius: [0.45, 0.35, 0.45], seg: 12 }, material: 'dark', position: [0, 2.75, 8.2] },
      { name: 'headlamp', shape: { type: 'sphere', radius: 0.25, seg: 10 }, material: 'lamp', position: [0, 1.85, 12.05] },
      {
        name: 'loco_wheel',
        shape: { type: 'cylinder', radiusTop: 0.55, radiusBottom: 0.55, height: 0.2, seg: 18 }, material: 'wheel',
        position: [1.0, 0.55, 6.2], rotation: [0, 0, 90], mirror: 'x', repeat: { count: 3, step: [0, 0, 2.0] },
        clips: { run: [spin('x', 1.2)] },
      },
      { name: 'coupler', shape: { type: 'box', size: [0.25, 0.25, 1.0] }, material: 'dark', position: [0, 0.85, 3.2] },
      {
        name: 'carriage',
        position: [0, 0, -2],
        repeat: { count: 2, step: [0, 0, -10.5] },
        children: [
          { name: 'floor', shape: { type: 'box', size: [2.4, 0.4, 10] }, material: 'dark', position: [0, 0.75, 0] },
          { name: 'body', shape: { type: 'box', size: [2.8, 2.7, 10] }, material: 'coach', position: [0, 2.3, 0] },
          { name: 'roof', shape: { type: 'box', size: [3.0, 0.2, 10.2] }, material: 'roof', position: [0, 3.75, 0] },
          { name: 'window', shape: { type: 'box', size: [0.08, 0.8, 1.2] }, material: 'glass', position: [1.42, 2.7, -3.5], mirror: 'x', repeat: { count: 4, step: [0, 0, 2.3] } },
          {
            name: 'wheel',
            shape: { type: 'cylinder', radiusTop: 0.45, radiusBottom: 0.45, height: 0.2, seg: 16 }, material: 'wheel',
            position: [1.0, 0.45, -3.5], rotation: [0, 0, 90], mirror: 'x', repeat: { count: 2, step: [0, 0, 7] },
            clips: { run: [spin('x', 1.5)] },
          },
        ],
      },
    ],
  },
};

// A CAR 4.4 m long: a lofted body (the shape is the cross-sections along the length), a glass greenhouse, four wheels from ONE node
// (mirrored and repeated), headlights, bumpers. Wheels roll (clip: drive).
const CAR: ForgeExample = {
  id: 'car',
  what: 'A hatchback car 4.4 m long: lofted body, glass cabin, four wheels with rims that roll (clip: drive), headlights and bumpers. For a bus or a truck lengthen the loft and add wheel pairs with repeat; for an auto-rickshaw use one front wheel.',
  spec: {
    id: 'car',
    name: 'Car',
    materials: {
      paint: { color: '#c0392b', roughness: 0.35, metalness: 0.6 },
      glass: { color: '#9fd3e6', roughness: 0.05, metalness: 0.3, opacity: 0.8 },
      tyre: { color: '#1b1b1b', roughness: 0.9 },
      rim: { color: '#c9ced3', roughness: 0.3, metalness: 0.9 },
      lamp: { color: '#fff3c4', emissive: '#ffd45e' },
      trim: { color: '#262626', roughness: 0.6 },
    },
    nodes: [
      {
        name: 'body',
        shape: {
          type: 'loft', length: 4.4, stations: 18, ring: 14,
          sections: [
            { t: 0, halfWidth: 0.72, top: 0.66, bottom: 0.32, power: 3 },
            { t: 0.15, halfWidth: 0.86, top: 0.74, bottom: 0.3, power: 3 },
            { t: 0.5, halfWidth: 0.9, top: 0.78, bottom: 0.3, power: 3 },
            { t: 0.85, halfWidth: 0.86, top: 0.72, bottom: 0.3, power: 3 },
            { t: 1, halfWidth: 0.7, top: 0.62, bottom: 0.34, power: 3 },
          ],
        },
        material: 'paint',
      },
      {
        name: 'cabin',
        shape: {
          type: 'loft', length: 2.3, stations: 12, ring: 12,
          sections: [
            { t: 0, halfWidth: 0.6, top: 1.12, bottom: 0.7, power: 2.6 },
            { t: 0.3, halfWidth: 0.72, top: 1.34, bottom: 0.7, power: 2.6 },
            { t: 0.7, halfWidth: 0.72, top: 1.34, bottom: 0.7, power: 2.6 },
            { t: 1, halfWidth: 0.6, top: 1.12, bottom: 0.7, power: 2.6 },
          ],
        },
        material: 'glass', position: [0, 0, -0.2],
      },
      { name: 'roof', shape: { type: 'box', size: [1.3, 0.06, 1.3] }, material: 'paint', position: [0, 1.36, -0.2] },
      {
        name: 'wheel',
        shape: { type: 'cylinder', radiusTop: 0.34, radiusBottom: 0.34, height: 0.24, seg: 18 }, material: 'tyre',
        position: [0.8, 0.34, 1.4], rotation: [0, 0, 90], mirror: 'x', repeat: { count: 2, step: [0, 0, -2.8] },
        clips: { drive: [spin('x', 2.5)] },
        children: [
          { name: 'rim', shape: { type: 'cylinder', radiusTop: 0.22, radiusBottom: 0.22, height: 0.27, seg: 12 }, material: 'rim' },
          { name: 'spoke', shape: { type: 'box', size: [0.42, 0.29, 0.05] }, material: 'trim', repeat: { count: 3, around: { axis: 'y', degrees: 180 } } },
        ],
      },
      { name: 'headlight', shape: { type: 'sphere', radius: [0.11, 0.09, 0.07], seg: 10 }, material: 'lamp', position: [0.55, 0.5, 2.14], mirror: 'x' },
      { name: 'front_bumper', shape: { type: 'box', size: [1.7, 0.14, 0.14] }, material: 'trim', position: [0, 0.34, 2.16] },
      { name: 'rear_bumper', shape: { type: 'box', size: [1.7, 0.14, 0.14] }, material: 'trim', position: [0, 0.34, -2.16] },
    ],
  },
};

// A MOTORBIKE: two wheels (a torus tyre and spokes), a tube frame, fork, handlebar, tank, seat, engine, exhaust. Wheels roll (clip: ride).
const BIKE: ForgeExample = {
  id: 'bike',
  what: 'A motorbike 1.9 m long: torus tyres with spokes that roll (clip: ride), tube frame, fork and handlebar, red tank, seat, engine, headlight, exhaust. For a bicycle thin the frame and drop the engine and tank; for a scooter lower the seat and fatten the front panel.',
  spec: {
    id: 'bike',
    name: 'Motorbike',
    materials: {
      frame: { color: '#222222', roughness: 0.5, metalness: 0.7 },
      tank: { color: '#c62828', roughness: 0.3, metalness: 0.6 },
      tyre: { color: '#111111', roughness: 0.9 },
      metal: { color: '#9aa0a6', roughness: 0.3, metalness: 0.9 },
      seat: { color: '#2b2b2b', roughness: 0.8 },
      lamp: { color: '#fff3c4', emissive: '#ffd45e' },
    },
    nodes: [
      {
        name: 'wheel',
        shape: { type: 'torus', radius: 0.3, tube: 0.07, seg: 24, tubeSeg: 8 }, material: 'tyre',
        position: [0, 0.37, 0.75], rotation: [0, 0, 90], repeat: { count: 2, step: [0, 0, -1.5] },
        clips: { ride: [spin('x', 2)] },
        children: [
          { name: 'hub', shape: { type: 'cylinder', radiusTop: 0.07, radiusBottom: 0.07, height: 0.16, seg: 10 }, material: 'metal' },
          { name: 'spoke', shape: { type: 'box', size: [0.6, 0.03, 0.02] }, material: 'metal', repeat: { count: 3, around: { axis: 'y', degrees: 180 } } },
        ],
      },
      { name: 'frame', shape: { type: 'tube', path: [[0, 0.88, 0.5], [0, 0.55, 0.15], [0, 0.45, -0.1], [0, 0.6, -0.55], [0, 0.55, -0.72]], radius: 0.04, seg: 8 }, material: 'frame' },
      { name: 'engine', shape: { type: 'box', size: [0.26, 0.3, 0.42] }, material: 'metal', position: [0, 0.42, 0.02] },
      { name: 'tank', shape: { type: 'sphere', radius: [0.17, 0.14, 0.3], seg: 14 }, material: 'tank', position: [0, 0.8, 0.14] },
      { name: 'seat', shape: { type: 'box', size: [0.22, 0.08, 0.55] }, material: 'seat', position: [0, 0.72, -0.35] },
      { name: 'fork', shape: { type: 'tube', path: [[0.08, 0.9, 0.5], [0.08, 0.37, 0.75]], radius: 0.03, seg: 8 }, material: 'metal', mirror: 'x' },
      { name: 'handlebar', shape: { type: 'tube', path: [[-0.36, 0.97, 0.5], [0, 0.93, 0.5], [0.36, 0.97, 0.5]], radius: 0.022, seg: 8 }, material: 'frame' },
      { name: 'headlight', shape: { type: 'sphere', radius: 0.09, seg: 10 }, material: 'lamp', position: [0, 0.9, 0.6] },
      { name: 'swingarm', shape: { type: 'tube', path: [[0.08, 0.5, -0.55], [0.08, 0.37, -0.75]], radius: 0.03, seg: 8 }, material: 'frame', mirror: 'x' },
      { name: 'exhaust', shape: { type: 'tube', path: [[0.16, 0.3, 0.12], [0.17, 0.3, -0.7]], radius: 0.035, seg: 8 }, material: 'metal', mirror: 'x' },
    ],
  },
};

export const FORGE_EXAMPLES: Record<string, ForgeExample> = {
  person: PERSON,
  quadruped: QUADRUPED,
  house: HOUSE,
  tree: TREE,
  sword: SWORD,
  train: TRAIN,
  car: CAR,
  bike: BIKE,
};

export const FORGE_EXAMPLE_IDS = Object.keys(FORGE_EXAMPLES);
