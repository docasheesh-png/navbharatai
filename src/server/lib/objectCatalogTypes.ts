// WHAT A GAME IS MADE OF — the shared shape behind the object catalogue.
//
// Admin, 2026-09-14: *"generally kisi app me kya kya object chahiye hote hai — uski ek detailed list
// banao… list jitni badi hogi NavBharatAI ko utni hi asani hogi."*
//
// 🔒 TWO DECISIONS HERE CARRY THE WHOLE FILE, AND BOTH EXIST TO KEEP THE LIST GROWABLE.
//
// 1. MATCHING IS DATA, NOT A HAND-WRITTEN RegExp PER ENTRY. Every entry gives `words` (English and
//    romanised Hindi) and optionally `hi` (Devanagari), and `compileMatch` assembles the pattern. A
//    hundred-odd hand-written regexes is a hundred chances to get one wrong, and one of them already
//    was: `\b` is defined on ASCII word characters, so it can NEVER sit beside a Devanagari letter —
//    the boundary logic inverts and the alternative silently never matches. Building the pattern in
//    one place makes that bug impossible to reintroduce, rather than merely fixed.
//
// 2. HOW TO PLACE A THING IS A PROPERTY OF ITS KIND, NOT OF THE THING. A tree, a rock and a bush are
//    scattered the same way; a car, a bus and a tractor sit on a road the same way. Writing that per
//    object would be a hundred copies of one paragraph that drift apart — the exact failure this repo
//    has recorded for `safeRelPath` and for model ids. So placement lives on the CATEGORY, and the
//    entry carries only what is true of that object alone: its real size, its parts, and its tell.

/**
 * The kinds of thing a game world is made of. The category decides HOW the object joins a scene —
 * grounded or floating, instanced or unique, animated or still, casting shadows or not.
 */
export type ObjectCategory =
  | 'vehicle-land' | 'vehicle-air' | 'vehicle-water'
  | 'character' | 'animal'
  | 'terrain' | 'water' | 'vegetation' | 'rock' | 'sky'
  | 'building' | 'street-prop' | 'interior'
  | 'sport' | 'weapon' | 'collectible' | 'container' | 'food' | 'effect';

export interface CatalogEntry {
  /** Stable id — used in tests, in the build report, and as the spec cache key. */
  id: string;
  /** What to call it to the model. */
  name: string;
  category: ObjectCategory;
  /** English + romanised-Hindi alternatives, `|`-separated. Matched with ASCII word boundaries. */
  words: string;
  /** Devanagari alternatives, `|`-separated. Matched WITHOUT `\b` — see the note above. */
  hi?: string;
  /** The library builder, when one exists. Naming it is what stops the model hand-modelling anyway. */
  builder?: string;
  /** Real-world size in metres. ⚠️ Real measurements, never rounded to look tidy — they ARE the value. */
  dims: string;
  /** The parts without which it does not read as the thing. Most-defining first. */
  parts: string[];
  /** The ONE proportion or property that carries it. The highest-value line in every entry. */
  tell: string;
}

/**
 * Build an entry's matcher. ⚠️ The Devanagari group deliberately carries NO `\b` — see decision 2
 * above; adding one would silently disable every Hindi alternative in the catalogue.
 */
export function compileMatch(e: Pick<CatalogEntry, 'words' | 'hi'>): RegExp {
  const ascii = '\\b(?:' + e.words + ')\\b';
  return new RegExp(e.hi ? ascii + '|(?:' + e.hi + ')' : ascii, 'i');
}

/**
 * HOW TO PUT THIS KIND OF THING INTO A SCENE — the half of "make it real" that is not modelling.
 *
 * 🔴 WHY THIS MATTERS AS MUCH AS THE MODEL. A perfectly modelled car floating 20 cm above the road,
 * with no contact shadow and wheels that do not turn, looks FAKER than a crude car that is planted,
 * shadowed and rolling. Placement is most of what the eye reads as "real", and it is the part an
 * improvising builder skips first because nothing errors when it is missing.
 */
export interface PlacementRule {
  /** One line the builder reads first. */
  headline: string;
  /** The concrete rules, in the order they matter. */
  rules: string[];
}

export const PLACEMENT: Readonly<Record<ObjectCategory, PlacementRule>> = {
  'vehicle-land': {
    headline: 'Planted on the road surface, shadowed, and never still while it moves.',
    rules: [
      'RAYCAST the ground and set y so the TYRES touch it — a vehicle hovering even 5 cm reads as fake instantly, and a vehicle sunk into the road reads as broken.',
      'castShadow AND receiveShadow. The contact shadow under a vehicle is what glues it to the world.',
      'Roll the wheels from the real speed every frame (speed / wheelRadius). Still wheels under a moving vehicle is the oldest tell there is.',
      'Steer the FRONT wheels only, and lean or roll the body slightly into a turn and forward under braking — a body that stays perfectly level reads as a sprite on rails.',
      'Follow the road, not the world axis: align the vehicle to the road tangent so it never drives diagonally across its own lane.',
      'Traffic goes in ONE direction per lane and keeps a gap. Cars spaced evenly at identical speed read as a conveyor belt, not a road.',
    ],
  },
  'vehicle-air': {
    headline: 'Banks into every turn, casts a shadow on the ground far below, and never hovers rigidly.',
    rules: [
      'BANK into turns (roll around the forward axis) and pitch with climb and dive. An aircraft that turns flat looks like a paper cut-out being slid sideways.',
      'Keep a shadow on the GROUND under it — a flying object with no ground shadow has no altitude the eye can read.',
      'Spin rotors and propellers fast enough to blur, or draw a translucent disc; a slowly turning rotor looks like a toy.',
      'Add small constant motion — a gentle bob, a little yaw drift. Perfectly rigid flight is the giveaway.',
      'Keep it well clear of terrain and buildings: an aircraft clipping a rooftop is the failure users screenshot.',
    ],
  },
  'vehicle-water': {
    headline: 'Sits IN the water, not on it, and moves with the surface.',
    rules: [
      'Sink the hull to its real draught so part of it is BELOW the waterline. A boat resting on top of the water plane is the commonest water mistake there is.',
      'Bob and roll with the waves — sample the water height at the bow and the stern and pitch between them.',
      'Leave a WAKE: a V of foam behind, and a bow wave in front while moving. Water with no wake makes the boat look pasted on.',
      'Paint below the waterline differently (antifoul, algae) — the line itself is what makes the hull read as floating.',
    ],
  },
  character: {
    headline: 'Grounded by a raycast, limbs moving in opposition, never a capsule.',
    rules: [
      'Use createHumanoid() — separate head, torso, upper and lower limbs, with knees that bend ONE way. A capsule with a sphere on top is the single clearest sign of an AI-generated game.',
      'Arms swing OPPOSITE the legs, the body tucks in the air, and the feet plant. Call hero.update(dt, speed, grounded) every frame.',
      'Raycast down to the ground each frame and set the feet on it — a character sliding above a slope is immediately wrong.',
      'Give idle motion: breathing, a slight weight shift. A perfectly still character reads as paused, not alive.',
      'Scale everything else to the character — a 1.75 m human is the ruler the player measures the whole world with.',
    ],
  },
  animal: {
    headline: 'Moves on diagonal pairs, grounded, with its own idle behaviour.',
    rules: [
      'A quadruped moves DIAGONAL pairs together (front-left with rear-right). All four legs in phase reads as a toy being dragged — this one detail carries the whole animal.',
      'Use createAnimal({ kind }) where the kind exists; it already has the gait.',
      'Ground each foot by raycast on uneven terrain, and let the body bob slightly with the stride.',
      'Idle behaviour beats stillness: grazing, a head turn, an ear flick, a tail swish.',
      'Vary scale and colour slightly per individual — a herd of identical animals reads as copy-paste.',
    ],
  },
  terrain: {
    headline: 'The thing everything else stands on — build it first, and raycast against it forever after.',
    rules: [
      'Build it ONCE with createTerrain() from seeded noise, and keep the mesh: every other object finds its ground height by raycasting this.',
      'receiveShadow = true, castShadow = false. Terrain that does not receive shadows makes every object on it look pasted.',
      'Use surfaceMaterial() (grass, soil, sand, road, stone) with enableAO(), never one flat colour — a flat-coloured ground is exactly what "not realistic" looks like.',
      'Add fog matched to the lighting preset so the world does not end at a visible edge.',
      'Keep the playable area flat enough to move on; save the drama for the distance.',
    ],
  },
  water: {
    headline: 'Moving, reflective, and something objects sit INSIDE.',
    rules: [
      'The surface must MOVE — animate the normals or the UVs every frame. A still water plane is a mirror-flat sheet of plastic, and nothing else about it will rescue it.',
      'It needs applyEnvironment() to have a sky to reflect. Water with nothing to reflect renders as flat grey paint.',
      'Make it partly transparent with a colour that deepens with depth, and hide the bed in the distance rather than ending it at a hard edge.',
      'Put a wet, darker band on the bank where the water meets the ground — a hard dry-to-wet edge is what makes a river look like a blue ribbon laid on grass.',
      'Anything floating must sink to its draught and bob; anything on the bank must not clip through the surface.',
    ],
  },
  vegetation: {
    headline: 'Scattered by the hundred in ONE draw call, varied, and never in a grid.',
    rules: [
      'Use scatterInstances() / InstancedMesh — a thousand separate trees is a thousand draw calls and the frame rate is gone before anything else loads.',
      'Randomise rotation, scale (±25%) and tilt per instance. Identical upright copies are what makes a forest read as wallpaper.',
      'Sink the base slightly INTO the ground and add a contact shadow — a tree standing exactly on the surface looks stuck on.',
      'Give scatter an accept() so nothing lands on roads, in water, or in the play space.',
      'Sway the canopy slowly in a vertex shader or by rotating the top group — completely motionless plants read as plastic.',
      'Cluster them: real vegetation grows in clumps with clearings, never at even spacing.',
    ],
  },
  rock: {
    headline: 'Half-buried, irregular, and never a sphere.',
    rules: [
      'Bury 20–40% of every rock in the ground. A rock resting exactly on the surface looks like a dropped prop — this single rule fixes most rock placement.',
      'Deform the geometry per instance (random vertex jitter) and rotate randomly; an un-deformed sphere or box is never a rock.',
      'Use surfaceMaterial(\'stone\') with enableAO(), and vary the tint between instances.',
      'Instance them like vegetation, and cluster: scree gathers at slope bases, boulders sit alone.',
    ],
  },
  sky: {
    headline: 'No shadows, no collision, slow — and far larger than it feels.',
    rules: [
      'Never castShadow and never collide. A cloud that blocks the sun geometrically, or that a player can hit, is a bug.',
      'Render on a huge scale and far away, with depthWrite off for soft volumes, so nothing in the world ever intersects it.',
      'Move it SLOWLY and continuously — clouds drift, stars rotate. Static sky elements make time feel stopped.',
      'Match it to the lighting preset: the sky, the fog colour and the key light must agree, or the scene reads as two scenes.',
      'applyEnvironment() is what makes the sky reflect in metal, glass and water. Without it the sky exists for the camera only.',
    ],
  },
  building: {
    headline: 'The door proves the scale; the roof overhang and the plinth stop it being a crate.',
    rules: [
      'Put the door at 2.1 m and everything else reads correctly. It is the fastest way to make a building the right size.',
      'Give the roof a real OVERHANG past the walls and a visible plinth or step at the base. A roof flush with the walls is exactly what makes a house look like a packing crate.',
      'Use surfaceMaterial() (brick, stone, plaster, tile) with enableAO(). One flat colour on a wall the player walks up to is the clearest "not real" there is.',
      'Windows at a CONSISTENT sill height across the building, and dark glass with a hint of reflection — bright flat windows look painted on.',
      'Align buildings to the street, with varied heights and small setbacks. Identical boxes on a grid read as a test scene.',
      'Sink the base into the terrain so no gap shows under a wall on sloping ground.',
    ],
  },
  'street-prop': {
    headline: 'Small, repeated, and what turns an empty road into a place.',
    rules: [
      'Repeat along the road at a REGULAR spacing (streetlights 25–30 m, poles 40 m) — this is the one category where evenness is correct, because real infrastructure is placed that way.',
      'Keep them OFF the carriageway, on the verge or footpath, and rotate them to face the road.',
      'Instance them: they are the highest-count objects in a street scene after vegetation.',
      'Anything that emits (streetlight, traffic light, shop sign) needs an emissive material AND a light — or, on a phone, a fake glow sprite, because a hundred real lights will not run.',
      'They must cast shadows. A pole with no shadow on the road is what makes a street look flat.',
    ],
  },
  interior: {
    headline: 'Human-scaled, against walls, resting exactly on the floor.',
    rules: [
      'Scale to the body: seat 0.45 m, desk 0.75 m, counter 0.9 m, door handle 1.0 m. Furniture at the wrong height makes a room feel like a doll house even when nothing else is wrong.',
      'Rest every leg exactly on the floor and push the back exactly against the wall — a 2 cm gap or overlap is visible from across the room.',
      'Leave WALKABLE space: real rooms have a metre of clear floor. Furniture packed wall to wall reads as a storage unit.',
      'receiveShadow on the floor and castShadow on everything standing on it, or the room looks lit by nothing.',
      'Use surfaceMaterial() for wood, cloth and tile, and vary it between pieces — one material for the whole room is the flattest a room can look.',
    ],
  },
  sport: {
    headline: 'Exact regulation sizes, because everyone watching already knows them.',
    rules: [
      'Use the REAL dimensions — a cricket pitch is 20.12 m, a football goal 7.32 m wide, a basketball hoop 3.05 m high. These are the one category where a player spots an error instantly, because they have seen the real thing a thousand times.',
      'Mark the lines ON the ground surface (a texture or a thin decal mesh), never as floating strips.',
      'Give the ball real physics: mass, bounce and drag. A ball that slides or floats destroys the whole scene.',
      'Equipment held by a player must be parented to the HAND, not positioned in world space each frame.',
    ],
  },
  weapon: {
    headline: 'Parented to the hand, correctly sized, and moving with the character.',
    rules: [
      'Parent it to the hand bone / hand group so it follows the animation. A weapon positioned in world space every frame slides and jitters.',
      'Keep it at real length — a sword is 1.0 m, a rifle 1.0 m, a pistol 0.20 m. Oversized weapons are the commonest scale mistake in generated games.',
      'The functional end must be distinct: a blade tapers, a barrel is thinner than the receiver, an axe head is off-centre. A constant-width box is a plank.',
      'Effects fire from the right point — the muzzle, the blade tip — never from the object centre.',
      'Give it weight in motion: a follow-through on a swing, a kick on a shot. Instant snapping reads as weightless.',
    ],
  },
  collectible: {
    headline: 'Floats, spins, glows — it must read as gettable from across the level.',
    rules: [
      'SPIN it slowly and BOB it up and down. A still collectible looks like scenery and players walk straight past it.',
      'Lift it ~0.5 m off the ground and give it an emissive material or a small light, so it is visible against any background.',
      'Keep the pickup radius generous and forgiving — larger than the object looks. Players should never have to aim at a pickup.',
      'Play the effect AND the sound AND a small camera pulse on collection; the pickup is the reward, and a silent one feels broken.',
      'Instance them, and never place one where the player cannot reach it.',
    ],
  },
  container: {
    headline: 'Stacked with physics in mind, worn, and never a perfect cube.',
    rules: [
      'Stack with a small random rotation and offset — a perfectly aligned stack is what makes a warehouse look like a test scene.',
      'Rest them ON the ground and on each other with no gap and no intersection.',
      'Break the shape up: planks, bands, a lid, a rim. A bare cube is the flattest object it is possible to place.',
      'Use surfaceMaterial(\'wood\'/\'metal\') with enableAO() and vary the wear between instances.',
      'If it can be destroyed or moved, give it real mass so it behaves believably when hit.',
    ],
  },
  food: {
    headline: 'Small, and scaled against the hand that holds it.',
    rules: [
      'Check the size against a 0.18 m hand — food is the easiest thing in a game to build twice too large.',
      'Never a plain sphere or box: give it a stem, a bite, a crust, a label. Plain primitives read as placeholders here more than anywhere.',
      'Place it ON a surface (plate, table, stall, basket) rather than floating, and give it a contact shadow.',
      'Vary size, tint and rotation across a pile — identical fruit is instantly artificial.',
    ],
  },
  effect: {
    headline: 'Additive, short, unshadowed — and always paired with sound and a camera kick.',
    rules: [
      'Particles never cast or receive shadows, and use additive blending with depthWrite off, or they punch dark squares through the scene.',
      'Fire the effect, the SOUND, a small camera shake and a split-second freeze TOGETHER. That combination is what people feel as impact; an effect with no sound feels weak and nobody can say why.',
      'Keep them SHORT — a few hundred milliseconds. Lingering particles look like a bug.',
      'Pool them. Allocating particles in the loop hands the garbage collector work every frame and is a top cause of stutter.',
      'Fade out by opacity AND scale together; fading only one looks like a texture problem.',
    ],
  },
};
