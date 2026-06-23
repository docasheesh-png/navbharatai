import { describe, it, expect } from 'vitest';
import { formatRecalledLessons } from './RecalledLessons';
import type { RecallHit } from './WorkspaceMemory';

/**
 * Build an episode RecallHit in the real shape produced by WorkspaceMemory.recall:
 * episode hits carry the kind in `detail` and the text in `ref`.
 */
const epHit = (kind: string, text: string, score = 1): RecallHit => ({
  type: 'episode',
  ref: text,
  detail: kind,
  score,
});

describe('formatRecalledLessons', () => {
  it('includes note/error/fix texts and EXCLUDES request texts', () => {
    const hits: RecallHit[] = [
      epHit('request', 'build a todo app with login'),
      epHit('note', '[reflection] Build failed; use react-router-dom v6 API'),
      epHit('error', 'Module not found: react-router-dom'),
      epHit('fix', 'installed react-router-dom and re-ran the build'),
    ];
    const out = formatRecalledLessons(hits);

    expect(out).toContain('Lessons from earlier in this project');
    expect(out).toContain('react-router-dom v6 API');
    expect(out).toContain('Module not found: react-router-dom');
    expect(out).toContain('installed react-router-dom');
    // The user's own request must never be echoed back.
    expect(out).not.toContain('build a todo app with login');
  });

  it('returns "" for empty input', () => {
    expect(formatRecalledLessons([])).toBe('');
  });

  it('returns "" when only request hits are present', () => {
    const hits: RecallHit[] = [
      epHit('request', 'build a blog'),
      epHit('request', 'add comments'),
    ];
    expect(formatRecalledLessons(hits)).toBe('');
  });

  it('ignores non-episode hits (symbols/files)', () => {
    const hits: RecallHit[] = [
      { type: 'symbol', ref: 'TodoList', file: 'src/TodoList.tsx', detail: 'component', score: 2 },
      { type: 'file', ref: 'src/App.tsx', file: 'src/App.tsx', score: 1 },
      epHit('note', '[reflection] prefer absolute imports'),
    ];
    const out = formatRecalledLessons(hits);
    expect(out).not.toContain('TodoList');
    expect(out).not.toContain('src/App.tsx');
    expect(out).toContain('prefer absolute imports');
  });

  it('dedupes by text', () => {
    const hits: RecallHit[] = [
      epHit('note', 'avoid mutating state directly'),
      epHit('error', 'avoid mutating state directly'),
      epHit('fix', 'AVOID mutating state directly'),
    ];
    const out = formatRecalledLessons(hits);
    const occurrences = out.split('avoid mutating state directly').length - 1;
    // Case-insensitive dedupe → the line appears at most once (the first kept).
    expect(occurrences).toBeLessThanOrEqual(1);
    expect(out).toContain('avoid mutating state directly');
  });

  it('caps the number of lessons at 6 (input order preserved)', () => {
    const hits: RecallHit[] = Array.from({ length: 12 }, (_, i) =>
      epHit('note', `lesson number ${i}`),
    );
    const out = formatRecalledLessons(hits);
    const bulletLines = out.split('\n').filter((l) => l.startsWith('- '));
    expect(bulletLines).toHaveLength(6);
    // Keeps input order: first six (0..5) are present, the seventh (6) is not.
    expect(out).toContain('lesson number 0');
    expect(out).toContain('lesson number 5');
    expect(out).not.toContain('lesson number 6');
  });

  it('stays within the length cap with long inputs', () => {
    const long = 'x'.repeat(500);
    const hits: RecallHit[] = Array.from({ length: 6 }, (_, i) =>
      epHit('note', `${long}-${i}`),
    );
    const out = formatRecalledLessons(hits);
    expect(out.length).toBeLessThanOrEqual(1200);
    // Each lesson is truncated to ~160 chars.
    for (const line of out.split('\n').filter((l) => l.startsWith('- '))) {
      expect(line.length).toBeLessThanOrEqual(2 + 160);
    }
  });
});
