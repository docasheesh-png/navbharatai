/**
 * failedbr #2158 (2026-11-09, "Cosmic Defender"): one paragraph asked for a compact space shooter with a
 * leaderboard, then set rules ("do not start a paid live server, publish, configure a domain …", "After building,
 * run the available free preview/tests and report …"). The counter read 22 parts, Project Mode fired, and the game
 * was split into fourteen modules. A rule about how to build names no part, and what every small game has
 * (score, lives, restart) is not a module.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countEnumeratedFeatures, enumeratedFeatureItems, SPEC_FEATURE_COUNT } from '../src/server/AgentV3/enumeratedFeatures';
import { megaProjectSignals } from '../src/server/AgentV3/ProjectPlan';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';

const prompt = readFileSync(join(__dirname, 'fixtures', 'failedbr2158.cosmic.prompt.txt'), 'utf8');

describe('a rule about how to build is not a part to build', () => {
  it('the real prompt is one build, not a project', () => {
    expect(countEnumeratedFeatures(prompt)).toBeLessThan(SPEC_FEATURE_COUNT);
    expect(megaProjectSignals(prompt).fires).toBe(false);
    expect(analyzeAppScope(prompt).size).not.toBe('large');
  });

  it('no prohibition, restriction or after-build instruction is counted', () => {
    const items = enumeratedFeatureItems(prompt).join(' | ');
    for (const word of ['publish', 'configure a domain', 'external accounts', 'free in-browser preview', 'run the available', 'report the actual', 'available in navbharatai', 'polished', 'compact']) {
      expect(items, word).not.toContain(word);
    }
  });

  it('the staples of a small game are not modules; a big game\'s parts still count', () => {
    expect(countEnumeratedFeatures('Make a shooter game with collisions, score, lives, pause/resume, game-over, restart')).toBe(0);
    expect(countEnumeratedFeatures('Make a battle royale game with clans, guilds, a marketplace, voice chat, tournaments, ranked mode, a battle pass')).toBe(7);
  });

  it('a forbidding clause drops only itself — the list before it still counts', () => {
    expect(enumeratedFeatureItems('Build a shop app with products, cart, checkout; do not add login, reviews, wishlist')).toEqual(['products', 'cart', 'checkout']);
    expect(countEnumeratedFeatures('school ERP with students, teachers, attendance, fees, exams, timetable, library, transport')).toBe(8);
  });
});
