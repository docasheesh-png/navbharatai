// Tap tone — the "tak" a control makes when touched (admin 2026-08-09: "vibration ki jagah touch
// tone (tak tak) awaz aye to jyada accha rahe").
//
// WHY SOUND, SYNTHESISED: the app-wide tap feedback used the Haptics vibration motor, which on many
// Android phones is a strong, whole-hand buzz — at chat-typing frequency it is irritating rather
// than reassuring. A short tick SOUND is what Android's own keyboard does. It is synthesised with
// WebAudio instead of shipping an audio file: zero asset bytes, zero decode latency, and the tick
// starts the same millisecond the finger lands (an <audio> element would add file-fetch + decode
// jitter to every first tap).
//
// The tick itself: a 1.8 kHz burst with a fast exponential decay (~35 ms) at low gain — a soft,
// dry "tak", not a beep. WebAudio may only start after a user gesture; every call here IS a user
// gesture (pointerdown), so the context resumes itself when the OS suspended it.
//
// Injectable AudioContext factory so the logic is unit-testable without a real audio stack, and
// EVERY path swallows errors — feedback must never break a tap.

interface OscillatorLike {
  frequency: { value: number };
  type: string;
  connect(node: unknown): void;
  start(when?: number): void;
  stop(when?: number): void;
}
interface GainLike {
  gain: {
    setValueAtTime(v: number, t: number): void;
    exponentialRampToValueAtTime(v: number, t: number): void;
  };
  connect(node: unknown): void;
}
export interface AudioContextLike {
  currentTime: number;
  state?: string;
  destination: unknown;
  resume?: () => Promise<void>;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
}

export const TAP_TONE_FREQ_HZ = 1800;
export const TAP_TONE_DURATION_S = 0.035;
export const TAP_TONE_GAIN = 0.08; // deliberately quiet — feedback, not a notification

let sharedCtx: AudioContextLike | null = null;

/** Default factory: one shared real AudioContext (creating one per tap leaks OS audio handles). */
function defaultCtx(): AudioContextLike | null {
  try {
    if (!sharedCtx) {
      const AC = (globalThis as { AudioContext?: new () => AudioContextLike; webkitAudioContext?: new () => AudioContextLike }).AudioContext
        ?? (globalThis as { webkitAudioContext?: new () => AudioContextLike }).webkitAudioContext;
      if (!AC) return null;
      sharedCtx = new AC();
    }
    return sharedCtx;
  } catch {
    return null;
  }
}

/**
 * Play one soft tick. Never throws; a device with no audio stack simply stays silent (which is also
 * the honest behaviour when the phone is on mute — unlike vibration, sound respects silent mode).
 */
export function playTapTone(ctxFactory: () => AudioContextLike | null = defaultCtx): void {
  try {
    const ctx = ctxFactory();
    if (!ctx) return;
    // A backgrounded/suspended context restarts on this gesture; fire-and-forget.
    if (ctx.state === 'suspended') { try { void ctx.resume?.(); } catch { /* best effort */ } }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = TAP_TONE_FREQ_HZ;
    const t0 = ctx.currentTime;
    gain.gain.setValueAtTime(TAP_TONE_GAIN, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + TAP_TONE_DURATION_S);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + TAP_TONE_DURATION_S);
  } catch { /* feedback must never break a tap */ }
}

/** Test seam: drop the shared context so a test can install its own factory cleanly. */
export function _resetTapToneForTests(): void {
  sharedCtx = null;
}
