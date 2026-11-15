// OBJECT FORGE — SUBJECTS: what kind of thing was asked for, and the right help for making that kind.
//
// Admin 2026-11-15: *"train / tree / car / bike / animal / kuch bhi — bas woh subject api call se bana ke; pura code AI ko nahi bhejna."*
// The model is never asked for code: it is asked for DATA (a Forge spec), which the Forge checks and its own engine builds. What makes the
// first answer good is what the model is shown, so each KIND of subject gets the worked example closest to it and a short checklist of what
// that kind must have (a car: four wheels on the ground, on one axle line each, turning; an animal: legs under the body, a head on a neck,
// joints to bend). Reading the kind is a few words in English and Hinglish; a subject that fits no kind gets the general rules.
import { FORGE_EXAMPLES } from './forgeExamples';

export type SubjectKind = 'rail' | 'road' | 'bike' | 'air' | 'water' | 'animal' | 'bird' | 'plant' | 'building' | 'person' | 'prop';

const WORDS: Array<[SubjectKind, string[]]> = [
  ['rail', ['train', 'locomotive', 'engine', 'metro', 'tram', 'rail', 'railway', 'rake', 'rel', 'relgadi', 'monorail', 'bullet']],
  ['bike', ['bike', 'motorbike', 'motorcycle', 'bicycle', 'cycle', 'scooter', 'scooty', 'moped', 'bullet bike', 'dirt bike']],
  ['road', ['car', 'gaadi', 'gadi', 'bus', 'truck', 'lorry', 'van', 'jeep', 'suv', 'taxi', 'auto', 'rickshaw', 'tractor', 'ambulance', 'tempo', 'vehicle', 'cab', 'sedan', 'hatchback', 'bulldozer']],
  ['air', ['plane', 'aeroplane', 'airplane', 'jet', 'helicopter', 'chopper', 'drone', 'rocket', 'balloon', 'glider', 'vimaan', 'hawai', 'jahaz', 'ufo', 'spaceship']],
  ['water', ['boat', 'ship', 'canoe', 'kayak', 'submarine', 'naav', 'nav', 'yacht', 'steamer', 'raft', 'ferry']],
  ['bird', ['bird', 'eagle', 'crow', 'sparrow', 'parrot', 'peacock', 'mor', 'owl', 'pigeon', 'kabootar', 'duck', 'hen', 'chicken', 'murgi', 'hawk', 'vulture', 'cheel', 'tota']],
  ['animal', ['animal', 'dog', 'cat', 'lion', 'tiger', 'elephant', 'horse', 'cow', 'bull', 'sheep', 'goat', 'deer', 'bear', 'wolf', 'fox', 'monkey', 'camel', 'zebra', 'giraffe', 'rhino', 'hippo', 'buffalo', 'donkey', 'pig', 'rabbit', 'leopard', 'cheetah', 'kutta', 'billi', 'sher', 'hathi', 'ghoda', 'gai', 'bandar', 'unt', 'narsingh', 'lionman', 'dragon', 'dinosaur', 'creature', 'janwar', 'monster', 'beast']],
  ['plant', ['tree', 'plant', 'flower', 'bush', 'palm', 'pine', 'cactus', 'grass', 'ped', 'phool', 'paudha', 'bamboo', 'banyan', 'mango', 'forest', 'hedge', 'sunflower', 'lotus']],
  ['building', ['house', 'building', 'temple', 'mandir', 'tower', 'castle', 'fort', 'shop', 'ghar', 'imarat', 'mosque', 'church', 'school', 'hospital', 'bridge', 'pul', 'lighthouse', 'hut', 'jhopdi', 'palace', 'mahal', 'skyscraper', 'barn', 'garage', 'station', 'stadium', 'wall', 'gate']],
  ['person', ['person', 'human', 'man', 'woman', 'boy', 'girl', 'insaan', 'aadmi', 'ladki', 'ladka', 'character', 'soldier', 'warrior', 'villager', 'player', 'npc', 'robot', 'zombie', 'child', 'baby', 'police', 'doctor', 'farmer', 'kisan']],
];

const tokens = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** The kind of subject a description is about (the FIRST word in the description that names one wins: "a bike with a dog" is a bike), or 'prop'. */
export function subjectKindOf(text: string): SubjectKind {
  const t = tokens(text);
  for (let i = 0; i < t.length; i++) {
    // Prefer the longest phrase at this position, but keep the first subject rule.
    let match: SubjectKind | undefined; let length = 0;
    for (const [kind, words] of WORDS) for (const word of words) {
      const phrase = word.split(' ');
      if (phrase.length > length && phrase.every((part, j) => t[i + j] === part)) {
        match = kind; length = phrase.length;
      }
    }
    if (match) return match;
  }
  return 'prop';
}

const EXAMPLE_FOR: Record<SubjectKind, string> = {
  rail: 'train', road: 'car', bike: 'bike', air: 'sword', water: 'sword', animal: 'quadruped', bird: 'quadruped', plant: 'tree', building: 'house', person: 'person', prop: 'sword',
};

/** The id of the worked example closest to a kind of subject. (Air and water have none yet: the format is shown with a plain prop and the checklist carries the rest.) */
export function exampleIdForKind(kind: SubjectKind): string { return EXAMPLE_FOR[kind]; }
export function exampleForSubject(text: string): { kind: SubjectKind; id: string; spec: Record<string, unknown> } {
  const kind = subjectKindOf(text);
  const id = EXAMPLE_FOR[kind];
  return { kind, id, spec: FORGE_EXAMPLES[id].spec };
}

/** What a thing of this kind must have, for the model to check its own answer against. Short and concrete: shapes and numbers, not advice. */
export const SUBJECT_CHECKLIST: Record<SubjectKind, string[]> = {
  rail: [
    'Real size: a carriage is about 20 m long, 3 m wide, 4 m high; a locomotive 20 m; gauge 1.5 m between the wheels. Scale down for a toy.',
    'Build ONE carriage as a group and repeat it (repeat: { count, step }): the copies share geometry, but each still adds a node, transforms, draw work and rendered triangles.',
    'Wheels: cylinders turned on their side (rotation [0,0,90]), pairs mirrored on x, set along the length with repeat, each with a spin clip about x so they roll.',
    'Wheels touch the ground (y = radius). Body sits on a floor box above the wheels. Couplers join the vehicles (a small box overlapping both ends).',
    'A locomotive has a front (nose or boiler, headlamp that emits light) and a cab behind it.',
  ],
  road: [
    'Real size: a car 4.5 m long, 1.8 m wide, 1.5 m high; a bus 12 m x 2.5 m x 3.2 m; a truck 8 m x 2.5 m x 3.5 m; an auto-rickshaw 2.7 m x 1.3 m x 1.7 m.',
    'The BODY is a loft along z (sections tail to nose): a rounded shape, not a box. A greenhouse (glass loft) sits on top.',
    'Four wheels from ONE node: mirror x for left and right, repeat along z for front and rear; cylinders turned on their side (rotation [0,0,90]), radius 0.3 to 0.5 m, centre at y = radius, a spin clip about x.',
    'The body bottom is at about 0.3 m and overlaps the wheels so nothing floats. Headlights emit light (an emissive material); bumpers front and back.',
  ],
  bike: [
    'Real size: a motorbike 2.1 m long, 0.8 m wide at the bars, 1.1 m high; a bicycle 1.7 m long; wheels about 0.6 to 0.7 m across.',
    'Two wheels (a torus tyre turned on its side, rotation [0,0,90], plus a hub and spokes made with repeat around y), at the front and rear, centre height = wheel radius, each with a spin clip about x.',
    'A frame from tubes joining the steering head, the seat and the rear axle; a fork (two mirrored tubes) from the handlebar to the front hub; the handlebar a tube across x.',
    'Seat, tank (a squashed sphere) and engine sit ON the frame; every part touches its neighbour.',
  ],
  air: [
    'Real size: a light plane 8 m long, 11 m wingspan; an airliner 40 m long, 36 m wingspan; a helicopter 12 m long with a 10 m rotor; a drone 0.5 m.',
    'The fuselage is a loft along z (round nose, tapering tail). Wings are extruded outlines (a thin swept polygon) mirrored on x; the tail has a vertical fin (extrude) and two small horizontal fins (mirror x).',
    'A propeller or a rotor is a few thin boxes repeated around its axis, with a spin clip about that axis (fast: 5 to 10 turns a second).',
    'It is fine for the base to be off the ground; give it landing gear (wheels on thin tubes) so the lowest point is at y = 0.',
  ],
  water: [
    'Real size: a rowing boat 4 m x 1.4 m; a ship 100 m x 15 m; a canoe 4.5 m x 0.7 m. The waterline is y = 0: half the hull is below it.',
    'The HULL is a loft along z: pointed bow (a section with halfWidth near 0 at t = 1), wide middle, flat stern; its top is the deck.',
    'Superstructure (cabin, mast, funnel) stands on the deck: boxes and cylinders touching it. A sail is a thin extruded triangle.',
  ],
  animal: [
    'Proportions: a dog 0.6 m at the shoulder, 1 m long; a horse 1.6 m at the shoulder, 2.4 m long; an elephant 3 m x 5 m; a lion 1.1 m x 2 m; a cat 0.25 m x 0.5 m. The body is longer than it is tall.',
    'The TRUNK is a loft along z (tail to chest). A neck and a head (an ellipsoid with a snout and ears) at the front; a tail from a tube.',
    'FOUR legs from two nodes: a front leg and a back leg, each mirror x, each a pivot at the shoulder or hip with a thigh, a joint node (knee or hock) and a lower leg and a paw. Legs end at y = 0.',
    'Clips: walk (front legs swing opposite to the back leg on the same side: mirrorPhase 0.5 and the back pair phase 0.5), idle (a small head and tail movement).',
    'Fur, mane, horns, stripes, trunk: extra shapes on the same pivots, in other materials. A lion has a mane (a big sphere behind the head); an elephant a trunk (a tube) and ears (flat ellipsoids).',
  ],
  bird: [
    'A small bird 0.2 m long; an eagle 0.9 m long, 2 m wingspan; a peacock 1.2 m with a 1.5 m tail. The body is an ellipsoid or a short loft tilted a little (head up).',
    'Two wings (flat ellipsoids or thin extrusions) on pivots at the shoulders, mirrored on x, with a flap clip (a rotation about z swinging 30 to 60 degrees at 2 to 4 times a second).',
    'A small round head with a beak (a cone), two thin legs from tubes ending at y = 0 if it stands; a tail of one or several flat shapes.',
  ],
  plant: [
    'A tree 5 to 8 m; a palm 8 to 12 m; a bush 1 m; a flower 0.4 m; bamboo 6 m in thin cylinders; a cactus 2 m.',
    'A trunk is a TUBE along a slightly bent path, wide at the base and narrowing (a radius list); branches are thinner tubes (mirror x). The crown is overlapping ellipsoids in two greens, not one ball.',
    'A pine is cones stacked (cylinder with radiusTop 0), a palm is long thin leaves repeated around the top (repeat around y), a flower is a tube stem and a ring of flat petals (repeat around y) round a centre.',
    'A sway clip on the whole plant: small rotations about x and z at 0.2 to 0.4 times a second.',
  ],
  building: [
    'A house 8 m x 6 m x 3 m under a pitched roof; a temple 10 m with a stepped tower; a tower 6 m x 30 m; a castle wall 20 m; scale to the game.',
    'Walls are boxes; a roof is an extruded triangle (gable) or a cone (a turret); doors and windows are thin boxes set just in front of the wall face (glass material for windows).',
    'Repeat what repeats: windows, pillars, battlements, steps (repeat with a step). Build a wall once and rotate copies for the other sides.',
    'The base sits on y = 0; nothing floats: every part overlaps what it stands on.',
  ],
  person: [
    'A person 1.7 m (a child 1.1 m); head 1/7 of the height; shoulders about 0.4 m across; arms reach the middle of the thigh.',
    'Start from the person example and change it: build it on pivots (shoulder, elbow, hip, knee, neck) so it can walk; mirror x for the other arm and leg with mirrorPhase 0.5.',
    'Clothes are separate shapes or materials (shirt, trousers, shoes, hair); a hat, a weapon or a bag is a node on the head or hand pivot.',
  ],
  prop: [
    'Give it its real size in metres first; then block its biggest masses with the right proportions; add the details that make it recognisable at a glance.',
    'Round things are lathes (a vase, a bottle, a column, a cup) or spheres; flat outlines are extrusions (a blade, a sign, a wing); long thin things are tubes (a rope, a pipe).',
    'Anything that repeats (steps, fence posts, spokes, buttons) is ONE node with repeat. Anything symmetric is built on one side with mirror.',
  ],
};

export function subjectChecklist(kind: SubjectKind): string {
  return 'WHAT A ' + kind.toUpperCase() + ' MUST HAVE:\n' + SUBJECT_CHECKLIST[kind].map((l) => '- ' + l).join('\n');
}

