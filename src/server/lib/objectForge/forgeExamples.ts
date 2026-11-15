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

export const FORGE_EXAMPLES: Record<string, ForgeExample> = {
  person: PERSON,
  quadruped: QUADRUPED,
  house: HOUSE,
  tree: TREE,
  sword: SWORD,
};

export const FORGE_EXAMPLE_IDS = Object.keys(FORGE_EXAMPLES);
