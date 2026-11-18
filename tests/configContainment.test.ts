import { describe, expect, it } from 'vitest';
import { parseTsconfigJsonc } from '../src/server/AgentV3/FrameworkFoundation';
import { ensureTsconfigJsx, healTsconfigConflictTail } from '../src/server/AgentV3/TsconfigGuard';
import { conflictMarkerRefusal } from '../src/server/AgentV3/conflictMarkerGuard';
const marker = '<'.repeat(7);
describe('synthetic config containment', () => {
  it('preserves quoted comment-like paths and URLs with trailing commas', () => {
    expect(parseTsconfigJsonc('{"include":["src/*legacy*/**/*.tsx"],"url":"https://example.test/a",}'))
      .toEqual({ include: ['src/*legacy*/**/*.tsx'], url: 'https://example.test/a' });
  });
  it('never truncates or refuses valid JSONC marker comments', () => {
    const source = '{}\n/*\n' + marker + ' example\n*/';
    expect(healTsconfigConflictTail('tsconfig.json', source)).toBe(source);
    expect(conflictMarkerRefusal('tsconfig.json', source)).toBeNull();
  });
  it('does not let a legitimate old example exempt new corrupt markup', () => {
    const old = '{}\n/*\n' + marker + ' example\n*/';
    expect(conflictMarkerRefusal('tsconfig.json', '{}\n' + marker + ' broken', old)).not.toBeNull();
  });
  it('still heals trailing real markup', () => {
    expect(healTsconfigConflictTail('tsconfig.json', '{}\n' + marker + ' broken')).toBe('{}\n');
  });
  it.each(['jsxFactory', 'jsxFragmentFactory'])('preserves custom %s', key => {
    const source = JSON.stringify({compilerOptions:{lib:['DOM'],[key]:'custom'}});
    expect(ensureTsconfigJsx('tsconfig.json',source,{framework:'vite-react'})).toBe(source);
  });
});
