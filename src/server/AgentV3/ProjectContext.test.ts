import { describe, it, expect } from 'vitest';
import { buildProjectContext } from './ProjectContext';

describe('buildProjectContext — Claude-level memory for a follow-up build', () => {
  it('lists the existing files and tells the model to CONTINUE (no "what to continue")', () => {
    const ctx = buildProjectContext({
      files: ['src/components/Calculator.tsx', 'src/App.tsx', 'node_modules/react/index.js'],
      projectMap: 'Project memory: 9 files, 30 symbols.\nComponents: Calculator, Display',
      recentRequests: ['ek calculator banao'],
    });
    expect(ctx).toContain('CONTINUING an existing project');
    expect(ctx).toContain('src/components/Calculator.tsx');
    expect(ctx).toContain('Components: Calculator, Display');
    expect(ctx).toContain('ek calculator banao');
    expect(ctx).toContain('Do NOT ask "what would you like me to continue with"');
    // heavy dirs excluded
    expect(ctx).not.toContain('node_modules');
  });

  it('returns empty for a brand-new empty workspace', () => {
    expect(buildProjectContext({ files: [], recentRequests: [], projectMap: '' })).toBe('');
  });

  it('works with only a file list (no map / requests)', () => {
    const ctx = buildProjectContext({ files: ['index.html'] });
    expect(ctx).toContain('index.html');
    expect(ctx).toContain('CONTINUING');
  });

  it('caps files and requests so the context stays compact', () => {
    const files = Array.from({ length: 200 }, (_, i) => `src/f${i}.tsx`);
    const ctx = buildProjectContext({ files });
    expect((ctx.match(/src\/f\d+\.tsx/g) || []).length).toBe(60);
  });
});
