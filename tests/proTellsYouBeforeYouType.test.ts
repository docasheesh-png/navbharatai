// The paid image tier must say it is off BEFORE a user spends a prompt on it.
//
// Admin, 2026-09-19, with a screenshot of the Pro studio: "image generate kam nahi kar raha hai".
// What they had hit was the honest 503 from `POST /api/image/pro/generate` — but they only hit it
// AFTER choosing the tier, writing "make a 4k hd image of human jumped from sky", and pressing send.
// `imageProConfigured()` had known the answer before they opened the screen.
//
// These cases pin the fact being carried to the browser, and the direction every failure falls in.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildPublicConfig } from '../src/server/routes/health';
import {
  imageProAvailableFrom,
  IMAGE_PRO_UNAVAILABLE_NOTE,
} from '../src/lib/imageProAvailability';

const GEN = readFileSync(join(__dirname, '..', 'src/components/ide/AIImageGenerator.tsx'), 'utf8');
/** Comments carry the reasoning, including quoted strings — never assert against them. */
const codeOnly = GEN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the server publishes whether Pro can serve', () => {
  it('reports it, and only as a boolean', () => {
    expect(buildPublicConfig(null, undefined, null, true).imageProAvailable).toBe(true);
    expect(buildPublicConfig(null, undefined, null, false).imageProAvailable).toBe(false);
  });

  it('defaults to NOT available when the caller says nothing — a route that forgets to pass it cannot claim a paid tier works', () => {
    expect(buildPublicConfig(null).imageProAvailable).toBe(false);
  });

  it('keeps the shape closed, so nothing secret can drift into this public route', () => {
    expect(Object.keys(buildPublicConfig('1234567890123456')).sort())
      .toEqual(['grievance', 'imageProAvailable', 'metaPixelId', 'platformFeePct']);
  });

  it('the route asks imageProConfigured() rather than reading env itself — one owner for the rule', () => {
    const health = readFileSync(join(__dirname, '..', 'src/server/routes/health.ts'), 'utf8');
    expect(health).toContain('imageProConfigured()');
    // The endpoint, the key and the model id must never be named on this route.
    expect(health).not.toMatch(/IMAGE_PRO_(KEY|ENDPOINT|MODEL)/);
  });
});

describe('the client reads it in the safe direction', () => {
  it('only an explicit false means unavailable', () => {
    expect(imageProAvailableFrom({ imageProAvailable: false })).toBe(false);
    expect(imageProAvailableFrom({ imageProAvailable: true })).toBe(true);
  });

  it('a server that does not publish the field yet reads as AVAILABLE — deploying the client first cannot switch a working tier off', () => {
    expect(imageProAvailableFrom({})).toBe(true);
    expect(imageProAvailableFrom(null)).toBe(true);
    expect(imageProAvailableFrom(undefined)).toBe(true);
    expect(imageProAvailableFrom('not json')).toBe(true);
  });

  it('a fetch failure falls back to available — the 503 is still the honest backstop', () => {
    const src = readFileSync(join(__dirname, '..', 'src/lib/imageProAvailability.ts'), 'utf8');
    // Both exits of fetchImageProAvailable return true.
    expect(src).toMatch(/if \(!res\.ok\) return true;/);
    expect(src).toMatch(/catch \{\s*return true;\s*\}/);
  });

  it('the note names no vendor, no model and no environment variable', () => {
    expect(IMAGE_PRO_UNAVAILABLE_NOTE).toMatch(/NavBharatAI/);
    for (const leak of [/flux/i, /z-?image/i, /wavespeed/i, /replicate/i, /IMAGE_PRO_/, /env/i, /endpoint/i, /api key/i]) {
      expect(IMAGE_PRO_UNAVAILABLE_NOTE).not.toMatch(leak);
    }
  });
});

describe('the panel is honest before a prompt is written', () => {
  it('asks the server on mount', () => {
    expect(codeOnly).toContain('fetchImageProAvailable()');
  });

  it('a remembered Pro choice is DISPLAYED as Free when Pro is off, and is not overwritten', () => {
    // Only an explicit false forces Free…
    expect(codeOnly).toMatch(/proAvailable === false \? 'free' : chosenTier/);
    // …and what is persisted is the CHOICE, never the effective tier, so switching Pro on restores it.
    expect(codeOnly).toMatch(/setItem\(TIER_KEY, chosenTier\)/);
    expect(codeOnly).not.toMatch(/setItem\(TIER_KEY, effectiveTier\)/);
  });

  it('the dead Pro chip cannot be pressed, so it cannot cost a prompt', () => {
    expect(codeOnly).toMatch(/disabled=\{dead\}/);
    expect(codeOnly).toMatch(/if \(!dead\) setChosenTier\(t\)/);
  });

  it('states it in the LAYOUT too, because a title attribute does nothing on a phone', () => {
    expect(codeOnly).toMatch(/proOff && \(/);
    expect(codeOnly).toContain('IMAGE_PRO_UNAVAILABLE_NOTE');
  });

  it('an UNKNOWN answer changes nothing — the tier starts null, not false', () => {
    expect(codeOnly).toMatch(/useState<ImageProAvailability>\(null\)/);
  });
});
