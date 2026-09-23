import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { classifyRuntimeError, apiTesterHintFor, groupRuntimeErrors } from '../src/server/AgentV3/RuntimeErrorClassify';
import { DESIGN_KIT_CSS } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';

/**
 * Autopsy ac41a924 (2026-09-23): the one runtime error left in a finished news site was
 * `[requestfailed] https://images.unsplash.com/photo-1531417442582-f4d7a67d0f99?… — net::ERR_BLOCKED_BY_ORB`
 * — a guessed stock-photo id that returned an error page, which the browser blocks as an image. The
 * classifier's generic `net::ERR` rule filed it as a failing NETWORK call, so the user was told, at
 * severity error, to open the API Tester and debug "an API call in your app" — there was no API.
 *
 * Two halves: the report tells the truth about what broke, and the build prompt stops the model
 * guessing photo URLs in the first place.
 */

const ORB = '[requestfailed] https://images.unsplash.com/photo-1531417442582-f4d7a67d0f99?auto=format&fit=crop&w=800&q=80 — net::ERR_BLOCKED_BY_ORB';

describe('a broken image is classified as an image', () => {
  it('the exact capture from the report', () => {
    expect(classifyRuntimeError(ORB).id).toBe('broken-image');
  });

  it('an image file that fails or answers 404, on any host', () => {
    expect(classifyRuntimeError('[requestfailed] https://cdn.example.com/a/logo.png — net::ERR_NAME_NOT_RESOLVED').id).toBe('broken-image');
    expect(classifyRuntimeError('HTTP 404 from https://site.example/img/hero.jpg?v=2').id).toBe('broken-image');
    expect(classifyRuntimeError('[requestfailed] https://picsum.photos/800/400 — net::ERR_FAILED').id).toBe('broken-image');
  });

  it('a real API failure is still an API failure', () => {
    expect(classifyRuntimeError('[requestfailed] https://api.example.com/users — net::ERR_CONNECTION_REFUSED').id).toBe('network-fetch');
    expect(classifyRuntimeError('HTTP 500 from https://api.example.com/users').id).toBe('http-status');
    expect(classifyRuntimeError('TypeError: Failed to fetch').id).toBe('network-fetch');
  });

  it('the repair pass is told to draw the picture, not to guess another URL', () => {
    const [g] = groupRuntimeErrors([ORB]);
    expect(g.category.hint).toMatch(/do not guess another photo url/i);
  });
});

describe('the API Tester is suggested only when there is an API', () => {
  it('no API Tester line for a broken image', () => {
    expect(apiTesterHintFor([ORB])).toBe('');
  });

  it('still suggested for a failing endpoint beside a broken image', () => {
    expect(apiTesterHintFor([ORB, 'HTTP 500 from https://api.example.com/users'])).toMatch(/API Tester/);
  });
});

describe('the build prompt stops the guess upstream', () => {
  it('the architect is told never to invent an image URL, and what to draw instead', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/systemPrompt.ts'), 'utf8');
    expect(src).toContain('NEVER INVENT AN IMAGE URL');
    expect(src).toMatch(/CSS gradient panel/);
  });

  it('the design kit ships the placeholder the rule names, built from tokens only', () => {
    expect(DESIGN_KIT_CSS).toMatch(/\.nb-img \{[^}]*aspect-ratio: 16 \/ 9/);
    expect(DESIGN_KIT_CSS).toContain('.nb-img-square');
    const rule = /\.nb-img \{[^}]*\}/.exec(DESIGN_KIT_CSS)![0];
    expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/systemPrompt.ts'), 'utf8');
    expect(src).toContain('`.nb-img`');
  });

  it('the image rule does not split the kit rules from their "which scaffolds ship the kit" note', () => {
    // The note says "the classes above"; a rule wedged between them made it read as the image rule's.
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/systemPrompt.ts'), 'utf8');
    const consistency = src.indexOf('Consistency IS the design.');
    const note = src.indexOf('WHICH SCAFFOLDS SHIP THE KIT');
    const image = src.indexOf('NEVER INVENT AN IMAGE URL');
    expect(consistency).toBeGreaterThan(0);
    expect(note).toBeGreaterThan(consistency);
    expect(src.slice(consistency, note)).not.toContain('NEVER INVENT AN IMAGE URL');
    expect(image).toBeGreaterThan(note);
  });
});
