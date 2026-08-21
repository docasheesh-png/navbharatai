// "Shake the phone to report a problem" — the decisions, without the browser.
//
// ADMIN 2026-08-21: "user pure app navbharatai me kahi bhi kuch bhi report kar sakta hai (phone me
// phone shake kar ke)".
//
// THREE THINGS THE OBVIOUS IMPLEMENTATION GETS WRONG, and they are all here rather than in the
// component, so each one is provable in a test instead of discovered by a user on a bus:
//
//   1. A PHONE IN A POCKET SHAKES ALL DAY. A naive "acceleration crossed a threshold" fires on a bumpy
//      auto ride and on every jog. A real shake is a REVERSAL — the phone thrown one way and pulled
//      back — several times inside a short window. Counting direction changes is what separates
//      "someone is asking for help" from "someone is walking".
//   2. IT MUST NOT FIRE TWICE. The gesture that opens the sheet keeps happening while the sheet opens,
//      so without a cooldown the user gets a second sheet on top of the first.
//   3. IT CANNOT BE THE ONLY WAY IN. Nobody discovers an invisible gesture, and iOS refuses motion
//      access until the user grants it — so a visible "Report a problem" entry has to exist too and
//      this module is deliberately not the only path. (The component owns that; it is noted here
//      because it is the part most likely to be dropped as "extra".)

/** One accelerometer sample, in m/s² — whatever the platform gives us. */
export interface MotionSample {
  x: number;
  y: number;
  z: number;
  /** ms timestamp. */
  at: number;
}

/**
 * How hard a single movement must be before it counts at all.
 *
 * Tuned to be well above ordinary handling (walking a phone around registers roughly 12–15 m/s² of
 * combined magnitude including gravity) and comfortably below a deliberate shake.
 */
export const SHAKE_FORCE = 22;

/** How many direction reversals make a shake. Two is an accident; three is intent. */
export const SHAKE_REVERSALS = 3;

/** All of them must happen inside this window, or it is just a rough journey. */
export const SHAKE_WINDOW_MS = 1200;

/** After firing, ignore motion for this long — the hand is still moving when the sheet appears. */
export const SHAKE_COOLDOWN_MS = 4000;

export interface ShakeState {
  /** Timestamps of the recent qualifying reversals. */
  hits: number[];
  /** Sign of the last strong movement (+1/-1/0), for spotting a reversal. */
  lastDirection: number;
  /** When we last reported a shake. */
  firedAt: number;
}

export const initialShakeState = (): ShakeState => ({ hits: [], lastDirection: 0, firedAt: 0 });

/** Combined force of a sample, gravity removed well enough for a threshold test. */
export function magnitude(s: Pick<MotionSample, 'x' | 'y' | 'z'>): number {
  return Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
}

/**
 * Feed one sample in; get the next state and whether THIS sample completes a shake. Pure.
 *
 * The direction is taken from the dominant axis, so a shake along any axis counts — a phone held flat
 * on a desk and one held upright are shaken in completely different directions.
 */
export function feedShake(state: ShakeState, sample: MotionSample): { state: ShakeState; shook: boolean } {
  if (sample.at - state.firedAt < SHAKE_COOLDOWN_MS && state.firedAt > 0) {
    return { state, shook: false };
  }
  if (magnitude(sample) < SHAKE_FORCE) return { state, shook: false };

  const dominant = [sample.x, sample.y, sample.z].reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  const direction = dominant >= 0 ? 1 : -1;
  // A push in the SAME direction is one long movement, not a shake — only a reversal counts.
  if (direction === state.lastDirection) return { state: { ...state, lastDirection: direction }, shook: false };

  const hits = [...state.hits, sample.at].filter((t) => sample.at - t <= SHAKE_WINDOW_MS);
  if (hits.length >= SHAKE_REVERSALS) {
    // Direction is cleared along with the hits: the NEXT gesture is a new gesture. Keeping the old
    // direction made a fresh shake that happened to start the same way lose its first movement, so it
    // needed an extra reversal to be believed — invisible in a demo, and exactly the kind of "why did
    // it not work that time?" that makes a feature feel unreliable.
    return { state: { hits: [], lastDirection: 0, firedAt: sample.at }, shook: true };
  }
  return { state: { hits, lastDirection: direction, firedAt: state.firedAt }, shook: false };
}

/** The user's own switch. Shake is a convenience, and a convenience you cannot turn off is a nuisance. */
export const SHAKE_PREF_KEY = 'navbharat_shake_to_report';

export function shakeEnabled(read: (k: string) => string | null): boolean {
  try {
    return read(SHAKE_PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}
