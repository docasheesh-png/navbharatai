// A RACE THE USER DID NOT DESCRIBE GETS NAVBHARATAI'S OWN ENDLESS TRACK — EVERY TIME, NOT WHEN THE MODEL REMEMBERS.
//
// 🔴 OWNER 2026-11-18, verbatim: *"navbharatai pro me jab bhi koi racing game bane, to hamesa (100%) navbharatai
// me library se road map liye jaye (agar user kuch na kahe road ke bare me to!) … racing game me road choti
// bati hai, aur race bas 10-12 second ke baad track khatam ho jata hai … user ko hamesa infinity ♾️ road dikhe"*.
//
// 🔑 ROOT CAUSE. The 3D layer has carried an endless, seamless track since 2026-11-02 (`createTrackStream` and
// `DEFAULT_TRACK_PLAN` in objects.ts), but using it was one sentence among many in a long recipe instruction.
// The builder reached for `createRoad()` instead, whose default is a 300 m straight: at racing speed
// (25–30 m/s) that is ten to twelve seconds, then the road ends. The capability existed; whether a race got it
// depended on which model answered — the same class as the game kit itself (gameKitSeed.ts, build 46e2d74b).
//
// 🧬 THE FIX, IN THREE PLACES THAT CANNOT DRIFT, ALL READING THIS ONE MODULE:
//   1. `wantsEndlessRaceCourse(prompt)` — the ONE reading of "a race whose course the user did not describe".
//      A course is described when the request names its SHAPE, SCENERY or END (a curve, a hill, a bridge, a
//      city, a finish line, laps …). The bare words "road", "track" or "highway" describe nothing — "car racing
//      game on a road" still gets the default course.
//   2. `ENDLESS_RACE_COURSE_RULE` — a mandatory line in the kit handoff (gameKitHandoffBlock), not a hint in a
//      recipe the model may skim.
//   3. `raceCourseHalves` / `raceCourseFinding` / `endlessRaceCourseNote` — a check on the code the builder
//      writes: a game that drives a vehicle and never streams a track gets a repair note naming the exact call,
//      once per build. A note never fails a build (the honest limit: the model writes the game, so the
//      platform steers and checks it; it does not rewrite the model's scene).
// PURE: no I/O.
import { buildGameContract } from './gameIntent';
import { GAME_STARTER_ALTERNATION } from '../lib/gameStarters';

/**
 * Words that DESCRIBE a course: its shape, its scenery, its length or where it ends. When any is present the
 * builder derives the track plan from the user's words (the 3D layer's own instruction); otherwise the default
 * endless course is mandatory. Precision-first: a word here must say something the default would contradict.
 */
const COURSE_DESCRIBED = new RegExp([
  // shape
  String.raw`\b(?:straight|curves?|curvy|sharp turns?|bends?|zig-?zag|hairpins?|s-bends?|sharp corners?|spiral|oval|figure[- ]?(?:8|eight))\b`,
  // relief and crossings
  String.raw`\b(?:hills?|hilly|mountains?|slopes?|climbs?|ramps?|bridges?|tunnels?|flyovers?|level crossings?)\b`,
  // water
  String.raw`\b(?:rivers?|lakes?|sea|ocean|beach|coast(?:al)?|water)\b`,
  // scenery
  String.raw`\b(?:desert|city|town|village|forest|jungle|snow(?:y)?|ice|icy|countryside|farm|ghat|valley|canyon)\b`,
  // length and end
  String.raw`\b(?:finish line|laps?|circuit|closed track|loop track|dead[- ]end|ends? (?:at|in|with)|\d+\s*(?:km|kilomet(?:er|re)s?|m|met(?:er|re)s?)\b)`,
  // Hinglish
  String.raw`\b(?:pahad|pahaad|pahari|nadi|pul|shahar|gaon|gaanv|registan|jungle|samundar|ghumavdar|seedha|sidha)\b`,
  // Devanagari (no \b: it does not apply to these letters)
  'सीधा|सीधी|पहाड़|नदी|पुल|शहर|गाँव|गांव|जंगल|रेगिस्तान|समुद्र|मोड़|घुमावदार|सुरंग',
].join('|'), 'i');

/** "Endless road", "infinite track", "never-ending highway": the default course IS that, so it describes nothing else. */
const ENDLESS_WORDS = /\b(?:endless|infinite|never[- ]ending|unlimited)\s+(?:road|track|highway|course|race)s?\b/gi;

/** True when the request is a race (the scope contract's own genre reading) and says nothing about its course. */
export function wantsEndlessRaceCourse(prompt: string | null | undefined): boolean {
  const text = String(prompt ?? '');
  if (!text.trim()) return false;
  let genre = 'unknown';
  try { genre = buildGameContract(text).genre; } catch { return false; }
  if (genre !== 'racing') return false;
  return !COURSE_DESCRIBED.test(text.replace(ENDLESS_WORDS, ' '));
}

/**
 * The mandatory handoff line for that race. Names the exact calls, so there is nothing to work out. The twelve
 * pieces are only the STARTING course (owner 2026-11-18: "12 par takna nahi hai … user jab chahe map ko badlao
 * karwa sake … kuch bhi hard-core nahi"): the course lives in one file of the game's own, so any later change is
 * an edit to that file, and stream.setPlan swaps it while the game runs.
 */
export const ENDLESS_RACE_COURSE_RULE = [
  '🛣️ THE RACE COURSE: the request says nothing about the road, so the race STARTS on NavBharatAI\'s endless course,',
  'and nothing about it is fixed. Keep the course in ONE file of the game\'s own, src/game/<your-game>/trackPlan.ts:',
  '`export const TRACK_PLAN = createRacingRoadPlan()` from src/game/three/objects.ts starts with twelve',
  '10–100 km maps split into bounded chunks, cycling 1..12..1. This is only a starting list — any number of pieces',
  'in any order is valid, so when the user later asks for more or fewer stretches, other scenery, a course that',
  'ends at a lake or a closed circuit, that is an edit to this one file. Build it with',
  '`const stream = createTrackStream(TRACK_PLAN)`, `scene.add(stream.root)` in setup(), the car at',
  '`stream.startPose` (x, y, z and heading), and `stream.update(car)` every frame (it streams pieces ahead,',
  'recycles the ones behind and rebases the origin; use its { distance, lap } for the HUD).',
  '`stream.setPlan(plan, { now: true })` changes the course while the game runs (a track picker, a new stage),',
  'continuing seamlessly from the road already laid; check its boolean result. Width, seed, terrain and streaming',
  'settings require a new stream; a terminal under the car requires restart. RacingRoadGame restarts when its plan',
  'prop identity changes; keep it stable for normal rerenders and use onReady(stream) for seamless setPlan. NEVER build the race course with createRoad() or a',
  'PlaneGeometry: createRoad\'s default is 300 m, which ends after about ten seconds of racing.',
].join(' ');

export interface RaceCourseHalves {
  /** The file drives or builds a player vehicle. */
  drives: boolean;
  /** The file streams a track. */
  streams: boolean;
  /** The file builds a road with createRoad() (finite unless it is a closed path). */
  finiteRoad: boolean;
}

const SOURCE = /^src\/.+\.(?:t|j)sx?$/i;
const TEST_FILE = /\.(?:test|spec)\.[tj]sx?$/i;
/** Generated kit files define these calls; only the game's own files are read. */
const KIT_FILE = new RegExp(String.raw`^src\/game\/(?:three|core|fx|ui)\/|^src\/game\/(?:Game|GameCanvas|${GAME_STARTER_ALTERNATION})\.tsx?$|^src\/audio\/`, 'i');

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** One file's contribution. A file that is not the game's own source contributes nothing. */
export function raceCourseHalves(path: string, content: string): RaceCourseHalves {
  const p = String(path ?? '').replace(/^\.?\//, '');
  if (!SOURCE.test(p) || TEST_FILE.test(p) || KIT_FILE.test(p)) return { drives: false, streams: false, finiteRoad: false };
  const src = stripComments(String(content ?? ''));
  return {
    drives: /\b(?:driveVehicle|createVehicleState|createCar|createMotorcycle|createBicycle)\s*\(/.test(src),
    streams: /\bcreateTrackStream\s*\(/.test(src) || /<RacingRoadGame(?:\s|\/?>)/.test(src),
    finiteRoad: /\bcreateRoad\s*\(/.test(src) && !/\bclosed\s*:\s*true\b/.test(src),
  };
}

export interface RaceCourseFinding { finiteRoadFiles: string[] }

/** A game that drives a vehicle and streams no track, across every file written so far; null when it is fine. */
export function raceCourseFinding(index: ReadonlyMap<string, RaceCourseHalves>): RaceCourseFinding | null {
  const all = [...index.entries()];
  if (!all.some(([, h]) => h.drives) || all.some(([, h]) => h.streams)) return null;
  return { finiteRoadFiles: all.filter(([, h]) => h.finiteRoad).map(([p]) => p).sort() };
}

/**
 * THE END-OF-BUILD CHECK (admin 2026-11-19: "road/map bahut chota sa banta hai"). The write-time note above is said
 * ONCE; a builder that ignored it shipped a 300 m road and nothing stopped it. This reads the WHOLE workspace as it
 * is at the end (every lane's writes, not one dispatcher's), so a sub-agent's game file is judged too, and returns
 * the readiness blocker that keeps the build from being called done. Null when the race streams a course, or when
 * nothing drives a vehicle.
 */
export function endlessRaceCourseBlocker(files: ReadonlyMap<string, string> | Record<string, string>): string | null {
  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files);
  const index = new Map<string, RaceCourseHalves>();
  for (const [p, c] of entries) index.set(p, raceCourseHalves(p, c));
  const finding = raceCourseFinding(index);
  if (!finding) return null;
  const where = finding.finiteRoadFiles.length ? ` (${finding.finiteRoadFiles.join(', ')} build${finding.finiteRoadFiles.length === 1 ? 's' : ''} a finite createRoad() course)` : '';
  return `RACE COURSE IS NOT ENDLESS: the game drives a vehicle but no file streams a track${where}, so the road ends after about ten seconds. `
    + 'Mount the ready starter (<RacingRoadGame plan={TRACK_PLAN} /> from src/game/RacingRoadGame.tsx) or call createTrackStream(TRACK_PLAN) '
    + 'with TRACK_PLAN = createRacingRoadPlan() from src/game/three/objects.ts, and call stream.update(car) every frame.';
}

/** The repair note for that finding. */
export function endlessRaceCourseNote(f: RaceCourseFinding): string {
  const where = f.finiteRoadFiles.length
    ? ` ${f.finiteRoadFiles.join(', ')} build${f.finiteRoadFiles.length === 1 ? 's' : ''} the course with createRoad(), which ends after about ten seconds of racing.`
    : '';
  return `\n\n🛣️ THIS RACE HAS NO ENDLESS COURSE YET: the game drives a vehicle, but no file calls createTrackStream().${where}`
    + ` The request says nothing about the road, so the course must be NavBharatAI's own endless track: ${ENDLESS_RACE_COURSE_RULE}`;
}
