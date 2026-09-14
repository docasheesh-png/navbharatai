// THE HERO OBJECT — what the player controls and stares at for the whole game.
//
// ── THE REPORT THIS EXISTS FOR (admin screenshot, 2026-09-14) ────────────────────────────────────
// A bike racing game. The bike was a red capsule lying across two grey cylinders. The admin's words:
// *"object ek dam nakli se bante hai, farzi object lagte hai."* They were right, and the interesting
// part is WHY — because on paper everything needed was already there:
//
//   • `realismIntent.ts` (their own 2026-08-27 instruction) already reads "real/asli/realistic" from
//     intention rather than wording, and already picks the REAL tier.
//   • `objects.ts` already builds genuinely good things at that tier — `createCar` has a raked
//     windscreen, wheel arches, separate tyre and rim, emissive lights, a grille and mirrors.
//   • The build prompt already says, in capitals, *"build every object with objects.ts rather than
//     hand-modelling shapes."*
//
// 🔴 AND NONE OF IT COULD HELP, BECAUSE THE LIBRARY HAD NO BIKE. Eight builders existed — car, tree,
// mountain, river, desert, road, animal, humanoid — so for a bike racing game the instruction "use
// the library, never hand-model" was an instruction the model could not obey. It hand-modelled, with
// no spec, and three primitives is what free-form hand-modelling produces. The detail tier changes
// nothing either: `setDetailLevel` only reaches objects.ts builders, so a hand-modelled object is
// 'lite' no matter what the user typed.
//
// ── SO THE FIX IS IN TWO HALVES, AND THIS FILE IS THE SECOND ─────────────────────────────────────
// The first half is a real `createMotorcycle`. That fixes bikes. It does not fix the CONDITION, which
// is that a library of N builders meets an N+1th request every day — an auto-rickshaw, a tractor, a
// fishing boat, a cricket bat — and the moment it does, the engine is back to improvising.
//
// So when the library has no builder, the model still gets a CONTRACT: the object's real-world
// dimensions and the parts without which it does not read as the thing. That is the same knowledge
// `createCar` already encodes in prose — *"~4.3 m long, 1.8 m wide, 2.6 m wheelbase, 0.32 m wheel
// radius; those five numbers are most of why it reads as a car"* — generalised, so it is available
// for the objects nobody has written a builder for yet.
//
// ⚠️ THE HONEST CEILING, STATED HERE SO NOBODY HAS TO DISCOVER IT: this makes hand-modelled objects
// look DELIBERATE. It does not make them photoreal. Photoreal needs real scanned assets (.glb), which
// is a hosting, licensing and attribution project — not a prompt. Every user-facing word about this
// says "real-looking", never "photorealistic", for exactly that reason.
//
// PURE: prompt in, contract out. No clock, no I/O, no env.

import { realismIntent, type RealismTier } from './realismIntent';

export interface HeroObjectSpec {
  /** Stable id, used in tests and in the build report. */
  id: string;
  /** What to call it to the model. */
  name: string;
  /** Words that mean this object — English, Hinglish and Devanagari, because users type all three. */
  match: RegExp;
  /**
   * The library builder, when one exists. Naming it is the whole point: a builder that exists and is
   * not used is the failure mode this file was written from, in reverse.
   */
  builder?: string;
  /** Real-world size, in metres, written the way the model should reproduce it. */
  dims: string;
  /** The parts without which it does not read as the thing. Ordered most- to least-defining. */
  parts: string[];
  /** The ONE proportion that carries the silhouette. This is the highest-value line in the entry. */
  tell: string;
}

/**
 * ⚠️ EVERY NUMBER HERE IS A REAL-WORLD MEASUREMENT, not a modelling convenience. They are the whole
 * value of the table: a model given "about 2 m long" produces a toy, and a model given "2.05 m long,
 * 1.35 m wheelbase, 0.30 m wheel radius" produces a bike. Do not round them to look tidy.
 */
export const HERO_OBJECTS: readonly HeroObjectSpec[] = [
  {
    id: 'motorcycle',
    name: 'motorcycle',
    match: /\b(?:motorcycle|motorbike|motor\s*bike|superbike|bike\s*(?:racing|race|rider|riding|game)|racing\s*bike|bullet|pulsar|scooty|scooter|moped|baik)\b|(?:मोटरसाइकिल|बाइक|स्कूटी)/i,
    builder: 'createMotorcycle',
    dims: '2.05 m long, 0.72 m across the bars, 1.10 m tall, WHEELBASE 1.35 m, wheel radius 0.30 m, seat 0.80 m',
    parts: ['fuel tank', 'seat falling to a kicked-up tail', 'RAKED front forks (not vertical)', 'handlebar with grips', 'engine block low and central', 'exhaust header into a can', 'swingarm and chain', 'front disc and caliper', 'mudguards over both wheels', 'headlight and tail light that EMIT'],
    tell: 'A motorcycle is mostly AIR — the wheels sit far apart with open daylight under the engine, and the tank-to-tail line falls backwards. A body blob bridging two cylinders has none of that, which is exactly why it reads as a toy however good the lighting is.',
  },
  {
    id: 'bicycle',
    name: 'bicycle',
    match: /\b(?:bicycle|cycle|cycling|pedal\s*bike|bmx)\b|(?:साइकिल)/i,
    builder: 'createBicycle',
    dims: '1.75 m long, 1.05 m wheelbase, wheel radius 0.34 m, saddle 0.96 m, bars 0.55 m wide',
    parts: ['open DIAMOND frame of thin tubes', 'two large thin wheels with visible spokes', 'saddle on a seat post', 'handlebars', 'chainring, pedals and cranks'],
    tell: 'It is NOT a small motorcycle. The frame is open tubing you can see the background through, the wheels are larger and far thinner, and there is no engine mass in the middle.',
  },
  {
    id: 'car',
    name: 'car',
    match: /\b(?:car|sedan|hatchback|suv|taxi|cab|gaadi|gadi)\b|(?:कार|गाड़ी)/i,
    builder: 'createCar',
    dims: '4.3 m long, 1.8 m wide, 1.45 m tall, wheelbase 2.6 m, wheel radius 0.32 m',
    parts: ['cabin narrower and higher than the body', 'raked windscreen', 'bonnet and boot LOWER than the cabin', 'wheel arches', 'separate tyre and rim', 'grille and bumpers', 'headlights and tail lights that EMIT'],
    tell: 'The STEP between the low bonnet, the higher cabin and the low boot is the car’s outline. A single box with wheels is a bus at car scale.',
  },
  {
    id: 'auto-rickshaw',
    name: 'auto-rickshaw',
    match: /\b(?:auto\s*-?\s*rickshaw|rickshaw|autorickshaw|tuk\s*-?\s*tuk|tempo)\b|(?:ऑटो|रिक्शा)/i,
    dims: '2.6 m long, 1.3 m wide, 1.7 m tall, THREE wheels (one front, two rear), wheel radius 0.20 m',
    parts: ['single front wheel under a fork', 'canvas roof on thin posts', 'OPEN sides with no doors', 'bench seat visible from outside', 'handlebar steering, not a wheel', 'yellow-and-green or black-and-yellow paint'],
    tell: 'The three-wheel stance and the open sides are the whole silhouette — you can see straight through it, which no car does.',
  },
  {
    id: 'bus',
    name: 'bus',
    match: /\b(?:bus|coach|minibus)\b|(?:बस)/i,
    dims: '11 m long, 2.5 m wide, 3.2 m tall, wheelbase 5.6 m, wheel radius 0.50 m',
    parts: ['a long flat-sided box with a flat front', 'a ROW of windows the full length', 'a door with steps', 'large wheels partly hidden by the body', 'destination board above the windscreen'],
    tell: 'The window band running the whole length at a constant height is what makes it a bus rather than a large van.',
  },
  {
    id: 'truck',
    name: 'truck',
    match: /\b(?:truck|lorry|tipper|trailer|semi)\b|(?:ट्रक)/i,
    dims: '8.5 m long, 2.5 m wide, 3.4 m tall, wheel radius 0.52 m, 6 wheels (2 front, 4 rear in pairs)',
    parts: ['a SEPARATE cab and cargo body with a visible gap between them', 'cab taller than it is long', 'rear wheels doubled', 'tall exhaust stack', 'mudflaps and a bumper'],
    tell: 'The gap between the cab and the load body is the defining line. One continuous box is a bus.',
  },
  {
    id: 'tractor',
    name: 'tractor',
    match: /\b(?:tractor|farm\s*vehicle)\b|(?:ट्रैक्टर)/i,
    dims: '3.6 m long, 2.0 m wide, 2.6 m tall, REAR wheel radius 0.75 m, FRONT wheel radius 0.40 m',
    parts: ['rear wheels almost twice the front ones', 'deep chevron tread on the rear tyres', 'narrow bonnet with an exhaust stack in front of the driver', 'open seat above the rear axle', 'mudguards over the rear wheels'],
    tell: 'The huge-rear, small-front wheel mismatch IS the tractor. Equal wheels make it a truck.',
  },
  {
    id: 'train',
    name: 'train / locomotive',
    match: /\b(?:train|locomotive|railway|metro|rail\s*engine)\b|(?:ट्रेन|रेल)/i,
    dims: 'locomotive 20 m long, 3.0 m wide, 4.0 m tall; each coach 22 m; track gauge 1.676 m',
    parts: ['bogies (wheel trucks) under each end, not wheels on the body', 'a long unbroken flank', 'cab windows only at the ends', 'couplings between units', 'rails and sleepers beneath'],
    tell: 'Length-to-height of roughly 5:1 and wheels grouped into bogies. Evenly spaced wheels along the body reads as a toy.',
  },
  {
    id: 'aeroplane',
    name: 'aeroplane',
    match: /\b(?:aeroplane|airplane|aircraft|plane|jet|flight\s*sim(?:ulator)?|fighter\s*jet)\b|(?:हवाई\s*जहाज|विमान)/i,
    dims: 'airliner 40 m long, wingspan 35 m, 12 m tall; fighter 16 m long, wingspan 11 m',
    parts: ['wings SWEPT back, mounted low on the fuselage', 'a vertical tail fin plus horizontal tailplane', 'engines under the wings (airliner) or in the fuselage (fighter)', 'cockpit glazing at the nose', 'retractable landing gear'],
    tell: 'Wingspan is close to the fuselage LENGTH. Short stubby wings are the commonest mistake and make it read as a paper toy.',
  },
  {
    id: 'helicopter',
    name: 'helicopter',
    match: /\b(?:helicopter|chopper|heli)\b|(?:हेलीकॉप्टर)/i,
    dims: '13 m long including the boom, main rotor diameter 11 m, 3.5 m tall',
    parts: ['main rotor WIDER than the body is long', 'a thin tail boom with a vertical tail rotor', 'bubble cockpit glazing', 'skids or wheels', 'engine housing behind the rotor mast'],
    tell: 'The rotor disc is enormous relative to the fuselage, and the tail rotor is vertical (facing sideways). A small rotor makes it a toy instantly.',
  },
  {
    id: 'boat',
    name: 'boat',
    match: /\b(?:boat|dinghy|canoe|kayak|speedboat|fishing\s*boat|naav|nav\s*chalao)\b|(?:नाव|नौका)/i,
    dims: '5.0 m long, 1.8 m wide, 1.2 m tall at the bow, draught 0.35 m',
    parts: ['a V-shaped bow that narrows to a point', 'a flat transom at the stern', 'a hull that curves up toward the bow (sheer)', 'bench seats across the beam', 'outboard motor or oars'],
    tell: 'The bow narrows to a POINT and the stern is cut flat. A symmetrical box floats like a crate, not a boat.',
  },
  {
    id: 'ship',
    name: 'ship',
    match: /\b(?:ship|cargo\s*ship|tanker|cruise\s*ship|warship|naval)\b|(?:जहाज)/i,
    dims: 'cargo ship 180 m long, 28 m beam, 14 m freeboard, superstructure 8 decks',
    parts: ['a bulbous bow below the waterline', 'the superstructure set well AFT, not centred', 'a funnel above the superstructure', 'containers or deck cranes', 'a visible waterline with different paint below'],
    tell: 'Length is six to eight times the beam, and the accommodation block sits near the stern. A centred box is a ferry at best.',
  },
  {
    id: 'tank',
    name: 'tank',
    match: /\b(?:tank|armou?red\s*vehicle|battle\s*tank)\b|(?:टैंक)/i,
    dims: 'hull 7.0 m long, 3.6 m wide, 2.4 m tall; barrel 5.0 m; tracks 0.6 m wide',
    parts: ['a turret that ROTATES independently of the hull', 'a long thin barrel with a muzzle brake', 'continuous tracks over road wheels, idler and drive sprocket', 'sloped frontal armour', 'a commander’s hatch'],
    tell: 'The barrel is most of the vehicle’s length again, and the tracks wrap over visibly separate road wheels. Smooth track slabs read as rubber skirts.',
  },
  {
    id: 'rocket',
    name: 'rocket / spaceship',
    match: /\b(?:rocket|spaceship|space\s*craft|spacecraft|launch\s*vehicle|space\s*shuttle)\b|(?:रॉकेट|अंतरिक्ष\s*यान)/i,
    dims: 'rocket 50 m tall, 3.7 m diameter, fins 3 m span, nozzle bell 2.4 m',
    parts: ['a tapered nose cone', 'a long unbroken cylindrical body', 'stage separation lines', 'fins at the base', 'engine bells recessed under the tail'],
    tell: 'Height is roughly thirteen times the diameter. A short fat cylinder reads as a firework.',
  },
  {
    id: 'drone',
    name: 'drone',
    match: /\b(?:drone|quad\s*copter|quadcopter|uav)\b|(?:ड्रोन)/i,
    dims: '0.45 m across the motors, 0.12 m tall, propeller diameter 0.24 m',
    parts: ['FOUR arms in an X from a central body', 'a motor and propeller at each arm tip', 'a camera gimbal slung below the body', 'landing legs', 'status LEDs'],
    tell: 'The propeller discs overlap nothing and the arms are clearly separate from the body. A single blob with fans on top is not a drone.',
  },
  {
    id: 'human',
    name: 'human character',
    match: /\b(?:player|character|person|human|hero|man|woman|soldier|runner|avatar|aadmi|insaan)\b|(?:आदमी|इंसान|खिलाड़ी)/i,
    builder: 'createHumanoid',
    dims: '1.75 m tall; head is 1/7.5 of height; shoulders 0.45 m wide; legs are half the total height',
    parts: ['separate head, torso, upper and lower arms, upper and lower legs', 'knees that bend ONE way only', 'arms that swing OPPOSITE the legs', 'hands and feet as distinct masses', 'neck between head and shoulders'],
    tell: 'Legs are HALF the total height and the head is small. A capsule with a sphere on top is the single clearest sign of an AI-generated game.',
  },
  {
    id: 'horse',
    name: 'horse',
    match: /\b(?:horse|ghoda|stallion|mare|pony|riding\s*horse)\b|(?:घोड़ा)/i,
    builder: "createAnimal({ kind: 'horse' })",
    dims: '2.4 m nose to tail, 0.7 m wide, 1.6 m at the withers, legs 0.9 m',
    parts: ['a deep chest tapering to a narrower rump', 'a long neck angled up from the shoulders', 'a head with a distinct muzzle', 'four legs with hocks that bend backwards on the hind pair', 'mane and tail'],
    tell: 'It moves on DIAGONAL pairs — front-left with rear-right. All four legs in phase reads as a toy being dragged.',
  },
  {
    id: 'elephant',
    name: 'elephant',
    match: /\b(?:elephant|hathi|haathi)\b|(?:हाथी)/i,
    dims: '6.0 m long, 2.0 m wide, 3.2 m at the shoulder, legs 1.6 m, trunk 2.0 m',
    parts: ['a trunk reaching near the ground', 'ears as large flat sheets', 'pillar legs of near-constant thickness', 'a domed head and forehead', 'tusks and a thin tail'],
    tell: 'The legs are PILLARS, not tapered animal legs, and the ears are almost as tall as the head. Tapered legs make it a large cow.',
  },
  {
    id: 'bird',
    name: 'bird',
    match: /\b(?:bird|eagle|crow|pigeon|parrot|flappy|chidiya)\b|(?:पक्षी|चिड़िया)/i,
    dims: 'body 0.35 m, wingspan 1.2 m, tail 0.2 m',
    parts: ['wings that are WIDE and thin, hinged at the body', 'a tail fan used to steer', 'a small head with a beak', 'legs tucked in flight, extended on landing'],
    tell: 'Wingspan is three to four times the body length, and the wings bend at a wrist rather than staying flat boards.',
  },
  {
    id: 'fish',
    name: 'fish',
    match: /\b(?:fish|shark|machli|aquarium)\b|(?:मछली)/i,
    dims: 'body 0.40 m long, 0.12 m tall, 0.06 m wide; tail fin 0.12 m',
    parts: ['a body flattened SIDE to side, not top to bottom', 'a forked or fan tail fin', 'a dorsal fin on top', 'paired pectoral fins', 'a visible gill line and eye'],
    tell: 'The cross-section is TALL and narrow. A rounded tube is a submarine.',
  },
  {
    id: 'house',
    name: 'house / building',
    match: /\b(?:house|home|building|shop|hut|bungalow|makaan|ghar|dukaan)\b|(?:घर|मकान|दुकान|इमारत)/i,
    dims: 'single storey 9 m x 8 m, walls 3.0 m, roof ridge 4.5 m; door 2.1 m x 0.9 m; window 1.2 m x 1.2 m at 1.0 m sill',
    parts: ['a roof with real OVERHANG past the walls', 'a door at human scale (2.1 m)', 'windows at a consistent sill height', 'a visible plinth or step at the base', 'wall surface material, never one flat colour'],
    tell: 'The door proves the scale of everything else — get it to 2.1 m and the building reads correctly. A roof flush with the walls is what makes a house look like a packing crate.',
  },
  {
    id: 'cricket',
    name: 'cricket equipment',
    match: /\b(?:cricket|batting|bowler|wicket|ipl)\b|(?:क्रिकेट)/i,
    dims: 'bat 0.96 m long with a 0.108 m wide blade; ball 0.072 m diameter; stumps 0.71 m tall, 0.229 m across all three; pitch 20.12 m',
    parts: ['a bat with a distinct handle, shoulder and swelling toward the toe', 'a seam around the ball', 'three stumps with two bails on top', 'creases marked on the pitch'],
    tell: 'The bat’s blade is flat on the face and ridged on the back, and it is only 10.8 cm wide — far narrower than people model it.',
  },
  {
    id: 'ball',
    name: 'ball',
    match: /\b(?:football|soccer|basketball|volleyball|tennis\s*ball)\b|(?:फुटबॉल|गेंद)/i,
    dims: 'football 0.22 m diameter; basketball 0.24 m; tennis ball 0.067 m',
    parts: ['a panel or seam pattern, never a plain sphere', 'a matte surface that catches light unevenly', 'a contact shadow on the ground'],
    tell: 'A plain untextured sphere is the flattest object it is possible to render. The panel lines are the whole read.',
  },
  {
    id: 'sword',
    name: 'sword',
    match: /\b(?:sword|blade|katana|talwar|sabre|saber)\b|(?:तलवार)/i,
    dims: '1.00 m overall, blade 0.80 m long and 0.05 m wide tapering to a point, grip 0.15 m',
    parts: ['a blade with a visible edge bevel, not a flat slab', 'a crossguard wider than the grip', 'a wrapped grip', 'a pommel counterweight at the end'],
    tell: 'The blade TAPERS in both width and thickness toward the point. A constant-width box is a ruler.',
  },
  {
    id: 'gun',
    name: 'firearm',
    match: /\b(?:gun|rifle|pistol|shooter|shooting\s*game|sniper|ak\s*-?\s*47)\b|(?:बंदूक|राइफल)/i,
    dims: 'rifle 1.00 m long, barrel 0.50 m, magazine 0.25 m; pistol 0.20 m long',
    parts: ['a barrel clearly thinner than the receiver', 'a magazine below the receiver', 'a pistol grip and trigger guard', 'a stock against the shoulder (rifle)', 'iron sights or an optic on top'],
    tell: 'The barrel is thin and the receiver is thick, and the grip sits at an angle to both. One tapered box reads as a plank.',
  },
];

export interface HeroObjectContract {
  /** The objects this prompt is about. Empty when none matched. */
  specs: HeroObjectSpec[];
  /** The detail tier the prompt asked for — passed through so the caller does not recompute it. */
  tier: RealismTier;
  /** The prompt block to hand the builder. Empty string when there is nothing to say. */
  block: string;
}

/** How many specs may reach one prompt. A game is about a few things, and a wall of text is ignored. */
const MAX_SPECS = 4;

/**
 * Which hero objects does this prompt need, and what must be true of each?
 *
 * ⚠️ SCOPED TO 3D/GAME PROMPTS BY THE CALLER, NEVER BY THIS FUNCTION. A billing app that mentions a
 * "cab" invoice must not receive a paragraph about auto-rickshaw wheel radii; the route already gates
 * the realism block the same way, and this rides that gate.
 *
 * PURE.
 */
export function heroObjectContract(prompt: string | null | undefined): HeroObjectContract {
  const text = String(prompt ?? '');
  const tier = realismIntent(text).tier;
  if (!text.trim()) return { specs: [], tier, block: '' };

  const specs = HERO_OBJECTS.filter((s) => s.match.test(text)).slice(0, MAX_SPECS);
  if (specs.length === 0) return { specs: [], tier, block: '' };

  const lines: string[] = [];
  lines.push('HERO OBJECTS — what this game is actually about, and what each one must be:');
  for (const s of specs) {
    lines.push('');
    lines.push('• ' + s.name.toUpperCase());
    lines.push(s.builder
      // A builder that exists and is not used is the failure this file was written from, inverted.
      ? '  BUILD IT WITH ' + s.builder + ' from objects.ts. Do NOT hand-model it — the library version '
        + 'already has the real proportions and every part below.'
      : '  There is no library builder for this one, so HAND-MODEL it to this spec — never as two or '
        + 'three primitives stuck together.');
    lines.push('  Real size: ' + s.dims + '. Use these numbers; do not round them to look tidy.');
    lines.push('  Must have: ' + s.parts.join('; ') + '.');
    lines.push('  The tell: ' + s.tell);
  }
  lines.push('');
  lines.push(tier === 'real'
    ? 'The user asked for REAL, so build EVERY part listed above, give each its own material '
      + '(surfaceMaterial for anything the player gets close to), and make any light EMIT. '
      + 'Say "real-looking" in your summary — never "photorealistic", which this cannot deliver.'
    : 'The user did not ask for realism, so the parts above may be simplified — but the SIZES and '
      + 'the tell still apply. A wrong-proportioned object looks broken at every detail level, and '
      + 'getting the silhouette right costs no frames on a phone.');

  return { specs, tier, block: lines.join('\n') };
}

/** The matched object ids, for the build report. PURE. */
export function heroObjectIds(prompt: string | null | undefined): string[] {
  return heroObjectContract(prompt).specs.map((s) => s.id);
}
