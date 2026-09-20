import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { nemotronConfigNote, nemotronTierAllowed } from '../src/server/AgentV3/nemotron';

/**
 * A value that cannot be read must SAY SO.
 *
 * 🔴 THE INCIDENT, 2026-09-20. The admin set `AGENTV3_NEMOTRON=week`. The accepted word is `weak`.
 * `week` names no tier, so Nemotron's judge and plan stayed OFF — while the Cloud Run console showed
 * the key configured and nothing anywhere reported a problem. The single measured saving this vendor
 * was adopted for (the judge, 78% of a cheap build's real provider cost) was silently not taken.
 *
 * The VERDICT was already right: a person who wanted every tier would type `on`, so an unreadable
 * value can never have meant that. What was missing was the report. This file pins both halves — the
 * safe verdict AND the fact that it is now audible.
 *
 * Fourth occurrence of this exact shape in this repo: a trailing space in BRAVE_API_KEY, an `=` in
 * ALERT_EMAIL_FROM, `20%` in AGENTV3_FEATURE_HEAL_PCT, and now this.
 */

const env = (v?: string) => ({ ...(v === undefined ? {} : { AGENTV3_NEMOTRON: v }), NEMOTRON_API_KEY: 'k' }) as NodeJS.ProcessEnv;

describe('the verdict is unchanged — an unreadable value is still OFF, never "everywhere"', () => {
  it('🔴 "week" — the real typo — does not enable the judge', () => {
    expect(nemotronTierAllowed('weak', env('week'))).toBe(false);
  });

  it.each(['weak', 'free', 'on', 'Weak', ' weak ', 'weak,normal'])(
    '%s is understood and enables the weak tier', (v) => {
      expect(nemotronTierAllowed('weak', env(v))).toBe(true);
    });

  it('unset stays OFF — a provider key must never be a feature switch', () => {
    expect(nemotronTierAllowed('weak', env())).toBe(false);
  });

  it('an explicit off stays off', () => {
    expect(nemotronTierAllowed('weak', env('off'))).toBe(false);
  });
});

describe('…and now it says so', () => {
  it('🔴 "week" produces a note that names the value AND the accepted words', () => {
    const note = nemotronConfigNote(env('week'));
    expect(note).toBeTruthy();
    expect(note).toContain('"week"');
    expect(note).toContain('weak');
    expect(note).toContain('on');
  });

  it('a partly-wrong list names ONLY the part that is wrong', () => {
    const note = nemotronConfigNote(env('weak,stronk'))!;
    expect(note).toContain('"stronk"');
    expect(note).not.toContain('"weak"');
  });

  it('every understood value is silent — this must not nag a correct config', () => {
    for (const v of ['weak', 'free', 'on', 'Weak', ' weak ', 'weak,normal,strong']) {
      expect(nemotronConfigNote(env(v)), `${v} should be silent`).toBeNull();
    }
  });

  it('unset and an explicit off are silent — neither is a mistake', () => {
    expect(nemotronConfigNote(env())).toBeNull();
    expect(nemotronConfigNote(env('off'))).toBeNull();
  });

  it('⚠️ it does NOT suggest "off" as a tier name — a bare off disables everything', () => {
    // TIER_WORDS contains `off` (the internal name of the Normal tier), but `nemotronHardOff` is
    // checked first, so advising it would be advice that does the opposite of what it says.
    const note = nemotronConfigNote(env('week'))!;
    const accepted = note.slice(note.indexOf('Accepted:'));
    expect(accepted).not.toMatch(/\boff\b/);
  });

  it('the value is never CORRECTED toward the nearest word', () => {
    // Guessing that "week" meant "weak" would make the config mean whatever it resembles, and the
    // next typo would silently enable a tier the admin never chose.
    expect(nemotronTierAllowed('weak', env('week'))).toBe(false);
    expect(nemotronConfigNote(env('week'))).not.toMatch(/did you mean|assuming|corrected/i);
  });
});

describe('the misread reaches the admin where they actually look', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  it('the build report carries the note beside the ladder it applies to', () => {
    // ⚠️ THE FIRST VERSION OF THIS CASE WAS DEAD, and the reversion proof is what caught it. It read
    // `expect(route).toContain('nemotronConfigNote()')` — satisfied by the SEVERITY expression a few
    // lines above, so deleting the detail line entirely left all 19 cases green. A test that cannot
    // fail for the reason it was written is worse than no test: it reports a guard that is not there.
    // It now reads the `detail:` array specifically, which is the thing the admin actually sees.
    const at = route.indexOf("code: 'TIER_LADDER'");
    expect(at).toBeGreaterThan(-1);
    const detailAt = route.indexOf('detail: [', at);
    expect(detailAt, 'the TIER_LADDER record has no detail array any more').toBeGreaterThan(-1);
    const detail = route.slice(detailAt, route.indexOf('].filter(Boolean)', detailAt));
    expect(detail, 'the misread-flag note is not in the line the admin reads')
      .toContain('nemotronConfigNote()');
  });

  it('and it makes that line a WARNING, not another info line nobody scans', () => {
    const at = route.indexOf("code: 'TIER_LADDER'");
    expect(at).toBeGreaterThan(-1);
    const block = route.slice(Math.max(0, at - 700), at);
    expect(block).toContain('nemotronConfigNote()');
    expect(block).toContain("'warning'");
  });
});

describe('the log fires, once', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { spy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { spy.mockRestore(); });

  it('a never-seen bad value logs exactly one line, and a repeat is quiet', () => {
    const unique = `zzz-${Math.random().toString(36).slice(2, 10)}`;
    nemotronTierAllowed('weak', env(unique));
    const first = spy.mock.calls.filter((c) => String(c[0]).includes('[NEMOTRON]')).length;
    expect(first).toBe(1);
    nemotronTierAllowed('weak', env(unique));
    nemotronTierAllowed('off', env(unique));
    const after = spy.mock.calls.filter((c) => String(c[0]).includes('[NEMOTRON]')).length;
    expect(after, 'a per-build call must not log on every build').toBe(1);
  });

  it('a good value logs nothing at all', () => {
    nemotronTierAllowed('weak', env('weak'));
    expect(spy.mock.calls.filter((c) => String(c[0]).includes('[NEMOTRON]')).length).toBe(0);
  });
});
