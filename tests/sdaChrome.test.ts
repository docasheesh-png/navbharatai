import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  initialToolsOpen, saveToolsOpen, SDA_TOOLS_PREF_KEY, SDA_NARROW_MAX_PX, type PrefStorage,
} from '../src/components/sda/sdaChrome';

/**
 * ADMIN REPORT 2026-08-08 (Doctor AI / SDA chat): "page ka space bina baat ki cheezo se ghira hua hai
 * … quick tool hide bhi kar do na, fir bhi itna sara space occupy hai … visibility maximum chahiye."
 *
 * Two defects, both locked here:
 *  1. Hiding Quick Tools did not STICK — the panel re-opened on every mount, so the doctor re-hid it
 *     each visit. A control whose choice the app forgets is broken, not merely inconvenient.
 *  2. Permanent chrome ate a third of a phone screen: a full row for a one-sentence disclaimer, a
 *     second row for the collapsed tools toggle, and a legend row captioning buttons already on screen.
 */

const fakeStorage = (initial: Record<string, string> = {}): PrefStorage & { data: Record<string, string> } => {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
};

describe('initialToolsOpen — an expressed preference is REMEMBERED (the reported bug)', () => {
  it('a saved "hidden" choice survives the next mount, even on a wide screen', () => {
    expect(initialToolsOpen(fakeStorage({ [SDA_TOOLS_PREF_KEY]: '0' }), 1440)).toBe(false);
  });

  it('a saved "shown" choice survives too — the preference wins in BOTH directions', () => {
    expect(initialToolsOpen(fakeStorage({ [SDA_TOOLS_PREF_KEY]: '1' }), 375)).toBe(true);
  });

  it('with no saved choice: closed on a phone (space is scarce), open on a wide screen', () => {
    expect(initialToolsOpen(fakeStorage(), 390)).toBe(false);
    expect(initialToolsOpen(fakeStorage(), SDA_NARROW_MAX_PX)).toBe(false); // the boundary is narrow
    expect(initialToolsOpen(fakeStorage(), SDA_NARROW_MAX_PX + 1)).toBe(true);
  });

  it('never throws when storage is absent or unreadable (Safari private mode) — falls back to the default', () => {
    expect(initialToolsOpen(null, 390)).toBe(false);
    expect(initialToolsOpen(undefined, 1440)).toBe(true);
    const hostile: PrefStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => {} };
    expect(initialToolsOpen(hostile, 1440)).toBe(true);
  });

  it('a corrupt stored value is ignored rather than trusted', () => {
    expect(initialToolsOpen(fakeStorage({ [SDA_TOOLS_PREF_KEY]: 'yes' }), 390)).toBe(false);
  });
});

describe('saveToolsOpen', () => {
  it('round-trips through initialToolsOpen', () => {
    const s = fakeStorage();
    saveToolsOpen(s, false);
    expect(initialToolsOpen(s, 1440)).toBe(false);
    saveToolsOpen(s, true);
    expect(initialToolsOpen(s, 390)).toBe(true);
  });

  it('a storage failure never throws — persistence is best-effort, the chat must not break', () => {
    const hostile: PrefStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(() => saveToolsOpen(hostile, true)).not.toThrow();
    expect(() => saveToolsOpen(null, true)).not.toThrow();
  });
});

// Source contract: the component must actually USE the remembered preference (a helper nobody calls
// is dead code), and the chrome rows the admin pointed at must be gone — while the clinical-safety
// disclaimer stays on screen, because that one is a safety obligation, not decoration.
describe('SDAChat wiring — the space actually came back, the safety text did not leave', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/components/sda/SDAChat.tsx'), 'utf8');

  it('the tools panel initializes FROM the saved preference, not a hardcoded true', () => {
    expect(SRC).toContain('initialToolsOpen(');
    expect(SRC).not.toMatch(/useState\(true\);\s*\n.*showTools/);
    expect(SRC).not.toContain('const [showTools, setShowTools] = useState(true)');
  });

  it('toggling PERSISTS the choice', () => {
    expect(SRC).toContain('saveToolsOpen(');
    expect(SRC).toContain('onClick={toggleTools}');
  });

  it('the duplicate legend row is gone (it captioned buttons already visible in the same row)', () => {
    expect(SRC).not.toContain('📎 Docs · 🎤 Dictate · 🔊 Talk to SDA · 🧮 Clinical Tools');
  });

  it('the disclaimer no longer owns a row, but is STILL rendered — safety text is never hidden', () => {
    expect(SRC).toContain('the treating physician remains responsible');
    // …and its full legal wording remains one hover/long-press away.
    expect(SRC).toContain('All diagnoses and treatment decisions remain the sole responsibility of the treating physician.');
  });

  it('the phone header is compact but the wide layout keeps its full identity', () => {
    expect(SRC).toContain('hidden sm:block text-[9px] text-emerald-600');
    expect(SRC).toContain('py-1.5 sm:py-2.5');
  });
});
