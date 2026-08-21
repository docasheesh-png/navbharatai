// Tests for the preview revival guarantee (admin 2026-08-21: "jab pahli bar chale, tabhi pakka ho
// jana chahiye jo sleep ke bad wake up hona hai").
//
// The reported failure was not a sleeping sandbox alone — "chahe kuch kar lo, koi bhi command de do,
// kitna bhi edit karwa lo" — a preview that no amount of work could bring back. The revival path was
// not short of a wake-up call; it was short of KNOWLEDGE, because the command and port that worked
// were used once and thrown away.

import { describe, it, expect } from 'vitest';
import {
  buildRecipe, isUsableRecipe, revivalConfirmedMessage, revivalUnconfirmedMessage,
} from './previewRevival';

const NOW = 1_700_000_000_000;

describe('buildRecipe — captured at success, while nothing is a guess', () => {
  it('records the command and the port that actually worked', () => {
    const { ok, recipe, gaps } = buildRecipe({ devCommand: 'npm run dev', port: 5173, framework: 'vite-react', now: NOW });
    expect(ok).toBe(true);
    expect(gaps).toEqual([]);
    expect(recipe).toEqual({ devCommand: 'npm run dev', port: 5173, framework: 'vite-react', provenAt: NOW });
  });

  it('REFUSES a half-recipe — that is worse than none', () => {
    // A partial recipe would pass the guarantee at first run and fail at revival: exactly the shape of
    // failure this module exists to end.
    expect(buildRecipe({ devCommand: '', port: 5173, now: NOW })).toMatchObject({ ok: false, recipe: null, gaps: ['no-command'] });
    expect(buildRecipe({ devCommand: 'npm run dev', port: null, now: NOW })).toMatchObject({ ok: false, recipe: null, gaps: ['no-port'] });
    expect(buildRecipe({ devCommand: '   ', port: 0, now: NOW }).gaps).toEqual(['no-command', 'no-port']);
  });

  it('rejects a port that is not a real TCP port', () => {
    for (const port of [0, -1, 70000, 1.5, NaN]) {
      expect(buildRecipe({ devCommand: 'npm start', port, now: NOW }).ok, String(port)).toBe(false);
    }
  });

  it('framework is optional — the command and port are what revival actually needs', () => {
    const { ok, recipe } = buildRecipe({ devCommand: 'npm start', port: 3000, framework: '  ', now: NOW });
    expect(ok).toBe(true);
    expect(recipe?.framework).toBeUndefined();
  });
});

describe('isUsableRecipe — the read-back check that makes it a guarantee', () => {
  it('accepts a complete recipe', () => {
    expect(isUsableRecipe({ devCommand: 'npm run dev', port: 5173, provenAt: NOW })).toBe(true);
  });

  it('rejects anything a revival could not actually use', () => {
    // "We wrote it" and "it is there" are different facts — the same conflation that treated a stale
    // URL as a live preview and a stale build as a current one.
    for (const bad of [null, undefined, {}, 'recipe', 42, { devCommand: 'npm run dev' }, { port: 5173 },
      { devCommand: '', port: 5173 }, { devCommand: 'x', port: 'p' }, { devCommand: 'x', port: 99999 }]) {
      expect(isUsableRecipe(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('what the user is told', () => {
  it('the confirmation promises RECOVERY, and does not overclaim speed', () => {
    const m = revivalConfirmedMessage();
    expect(m).toMatch(/brought back/i);
    // It must not promise "instant" — a rebuilt sandbox honestly takes minutes.
    expect(m).not.toMatch(/instant|immediately|seconds/i);
  });

  it('an unconfirmed guarantee is said AT FIRST RUN, names the gap, and blames nobody', () => {
    const m = revivalUnconfirmedMessage(['no-command']);
    expect(m).toMatch(/start command could not be recorded/i);
    expect(m).toMatch(/may take longer/i);
    // Never told as the user's fault — the gap is ours.
    expect(m).not.toMatch(/your app is|you must|invalid/i);
  });

  it('names the port gap distinctly, so two different causes never read the same', () => {
    expect(revivalUnconfirmedMessage(['no-port'])).toMatch(/port it runs on/i);
    expect(revivalUnconfirmedMessage(['no-port'])).not.toEqual(revivalUnconfirmedMessage(['no-command']));
  });

  it('never leaks a vendor name (White-Label law)', () => {
    for (const m of [revivalConfirmedMessage(), revivalUnconfirmedMessage(['no-port']), revivalUnconfirmedMessage([])]) {
      expect(m).not.toMatch(/e2b|sandbox|firebase|GLM|Kimi|Claude|Gemini|Grok/i);
    }
  });
});
