import { describe, it, expect } from 'vitest';
import { reviewBuild, formatReview } from './ReviewerAgent';
import type { SubAgentSpawn } from './ToolDispatcher';

const makeSpawn =
  (summary: string): SubAgentSpawn =>
  async () => ({ ok: true, summary });

describe('reviewBuild', () => {
  it('returns passed=true and high score when reviewer says PASS', async () => {
    const result = await reviewBuild({
      userRequest: 'build a todo app',
      fileTree: ['src/App.tsx', 'src/TodoList.tsx'],
      fileSample: [{ path: 'src/App.tsx', content: 'export function App() {}' }],
      spawn: makeSpawn('[PASS] App looks complete. Score: 95'),
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it('returns passed=false when reviewer finds critical issues', async () => {
    const result = await reviewBuild({
      userRequest: 'build a login app',
      fileTree: ['src/App.tsx'],
      fileSample: [],
      spawn: makeSpawn('[CRITICAL] Login feature is completely missing.\n[WARNING] No error handling.\nScore: 30'),
    });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.severity === 'critical')).toBe(true);
    expect(result.score).toBeLessThan(60);
  });

  it('detects WARNING issues without failing the build', async () => {
    const result = await reviewBuild({
      userRequest: 'build a dashboard',
      fileTree: ['src/App.tsx'],
      fileSample: [],
      spawn: makeSpawn('[WARNING] No loading state shown.\nScore: 75'),
    });
    expect(result.passed).toBe(true);
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
  });

  it('resolves gracefully (passed=true, score=0) when spawn throws', async () => {
    const failSpawn: SubAgentSpawn = async () => {
      throw new Error('spawn unavailable');
    };
    const result = await reviewBuild({
      userRequest: 'build something',
      fileTree: [],
      fileSample: [],
      spawn: failSpawn,
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(0);
  });

  it('parses emoji-style issue markers', async () => {
    const result = await reviewBuild({
      userRequest: 'make a chat app',
      fileTree: ['src/App.tsx'],
      fileSample: [],
      spawn: makeSpawn('🚨 Messages are not persisted anywhere.\n⚠️ No input validation.\nScore: 55'),
    });
    expect(result.issues.some((i) => i.severity === 'critical')).toBe(true);
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
  });
});

describe('formatReview', () => {
  it('returns empty string when score is 0 (review was skipped)', () => {
    expect(formatReview({ passed: true, score: 0, issues: [], summary: '' })).toBe('');
  });

  it('includes score and summary in output', () => {
    const out = formatReview({ passed: true, score: 92, issues: [], summary: 'Looks complete.' });
    expect(out).toContain('92');
    expect(out).toContain('Looks complete.');
  });

  it('uses ✅ for high scores, ⚠️ for medium, ❌ for low', () => {
    expect(formatReview({ passed: true, score: 95, issues: [], summary: 'great' })).toContain('✅');
    expect(formatReview({ passed: true, score: 75, issues: [], summary: 'ok' })).toContain('⚠️');
    expect(formatReview({ passed: false, score: 35, issues: [], summary: 'bad' })).toContain('❌');
  });

  it('includes issue lines when issues are present', () => {
    const out = formatReview({
      passed: false,
      score: 45,
      issues: [{ severity: 'critical', message: 'Missing auth' }],
      summary: 'Issues found.',
    });
    expect(out).toContain('Missing auth');
    expect(out).toContain('🚨');
  });
});
