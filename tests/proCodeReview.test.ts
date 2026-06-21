import { describe, it, expect, vi } from 'vitest';
import { reviewCode, formatReviewReport } from '../src/server/pro/ProCodeReview';
import type { ModelCall } from '../src/server/project/aiEdits';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';

describe('reviewCode', () => {
  it('returns empty findings for VFS with no source files', async () => {
    const vfs = VirtualFileSystem.fromRecord({ 'index.html': '<h1>Hello</h1>' });
    const callModel: ModelCall = vi.fn();
    const result = await reviewCode(vfs, callModel);
    expect(result.findings).toHaveLength(0);
    expect(result.score).toBe(100);
    expect(callModel).not.toHaveBeenCalled();
  });

  it('parses structured JSON response from model', async () => {
    const vfs = VirtualFileSystem.fromRecord({
      'src/App.tsx': 'export default function App() { return null; }',
    });
    const mockResult = {
      findings: [{ file: 'src/App.tsx', line: 1, severity: 'low', category: 'quality', description: 'Empty component', fix: 'Add content' }],
      summary: 'Code is mostly clean.',
      score: 85,
      techDebt: [],
    };
    const callModel: ModelCall = vi.fn().mockResolvedValue(JSON.stringify(mockResult));
    const result = await reviewCode(vfs, callModel);
    expect(result.score).toBe(85);
    expect(result.findings).toHaveLength(1);
  });

  it('returns fallback result when model returns invalid JSON', async () => {
    const vfs = VirtualFileSystem.fromRecord({ 'src/App.tsx': 'bad code' });
    const callModel: ModelCall = vi.fn().mockResolvedValue('not json');
    const result = await reviewCode(vfs, callModel);
    expect(result.score).toBe(70);
    expect(result.findings).toHaveLength(0);
  });
});

describe('formatReviewReport', () => {
  it('shows "No significant issues" when no findings', () => {
    const report = formatReviewReport({ findings: [], summary: 'All good.', score: 100, techDebt: [] });
    expect(report).toContain('No significant issues');
  });

  it('shows quality score in header', () => {
    const report = formatReviewReport({ findings: [], summary: 'Clean.', score: 95, techDebt: [] });
    expect(report).toContain('95/100');
  });

  it('includes tech debt section when present', () => {
    const report = formatReviewReport({
      findings: [],
      summary: 'Has debt.',
      score: 70,
      techDebt: ['TODO: fix auth', 'FIXME: remove magic number'],
    });
    expect(report).toContain('TODO');
  });
});
