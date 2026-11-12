import { describe, expect, it } from 'vitest';
import { isSourcePathOnly, withoutSourcePaths } from '../src/server/lib/sourcePathPrompt';
import { analyzeRequirementGaps, missingDomainFeatures, stripNonDomainUses } from '../src/server/lib/RequirementGapAnalyzer';
import { classifyIntentWithConfidence } from '../src/server/AgentV3/IntentClassifier';
import { buildConfirmation } from '../src/server/AgentV3/buildConfirmation';
import { gameKitPlan } from '../src/server/AgentV3/gameKitSeed';

const SOURCE_PATH = 'src/game/fx/synth.ts';

describe('a bare source path is not a new game request', () => {
  it('recognizes a path-only message, including Markdown wrappers', () => {
    expect(isSourcePathOnly(SOURCE_PATH)).toBe(true);
    expect(isSourcePathOnly('\x60src/game/fx/synth.ts\x60')).toBe(true);
    expect(isSourcePathOnly('[src/game/fx/synth.ts]')).toBe(true);
    expect(isSourcePathOnly('Build a game starting from ' + SOURCE_PATH)).toBe(false);
  });

  it('removes path segments before the shared domain analyzer sees their words', () => {
    expect(withoutSourcePaths(SOURCE_PATH)).not.toMatch(/\bgame\b/i);
    expect(stripNonDomainUses(SOURCE_PATH)).not.toMatch(/\bgame\b/i);
    expect(analyzeRequirementGaps(SOURCE_PATH).domain).toBe('general');
    expect(missingDomainFeatures(SOURCE_PATH, '').domain).toBe('general');
  });

  it('does not route a bare path into a build or seed the game kit', () => {
    expect(classifyIntentWithConfidence(SOURCE_PATH)).toMatchObject({
      intent: 'chat',
      confidence: 'high',
      signal: 'source-path-only',
    });
    expect(buildConfirmation(SOURCE_PATH)).toEqual({
      confirmed: false,
      reason: 'names-nothing-to-build',
    });
    expect(gameKitPlan(SOURCE_PATH, 'vite-react')).toEqual([]);
  });

  it('keeps a real game order when game intent is stated outside the path', () => {
    const prompt = 'Build a game starting from ' + SOURCE_PATH;
    expect(analyzeRequirementGaps(prompt).domain).toBe('game');
    expect(gameKitPlan(prompt, 'vite-react')).toContain('generate_game_runtime');
    expect(buildConfirmation(prompt).confirmed).toBe(true);
  });

  it('does not let a path segment erase an explicit game request in a file-edit prompt', () => {
    const prompt = 'Fix ' + SOURCE_PATH + ' to add a laser sound effect to the game';
    expect(analyzeRequirementGaps(prompt).domain).toBe('game');
    expect(gameKitPlan(prompt, 'vite-react')).toContain('generate_game_runtime');
  });
});
