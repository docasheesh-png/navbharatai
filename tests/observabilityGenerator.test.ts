import { describe, it, expect } from 'vitest';
import { generateObservability } from '../src/server/AppMakerLab/generator/ObservabilityGenerator';

/** P-CGE.11 — observability instrumentation generator (pure). */

describe('generateObservability', () => {
  it('defaults to both sides with three files', () => {
    const { files, summary } = generateObservability();
    const paths = files.map((f) => f.path);
    expect(paths).toEqual(['src/observability.ts', 'src/server/requestLogger.ts', 'src/server/health.ts']);
    expect(summary).toContain('both');
    // Every file carries a wiring note.
    for (const f of files) expect(f.wiring.length).toBeGreaterThan(0);
  });

  it('frontend handler captures uncaught errors and rejections', () => {
    const { files } = generateObservability({ target: 'frontend' });
    expect(files).toHaveLength(1);
    const fe = files[0].content;
    expect(fe).toContain("addEventListener('error'");
    expect(fe).toContain("addEventListener('unhandledrejection'");
    expect(fe).toContain("'[app-error]'");
  });

  it('backend logger + health are dependency-free and runnable', () => {
    const { files } = generateObservability({ target: 'backend' });
    expect(files.map((f) => f.path)).toEqual(['src/server/requestLogger.ts', 'src/server/health.ts']);
    const logger = files[0].content;
    expect(logger).toContain('export function requestLogger');
    expect(logger).toContain('durationMs');
    expect(logger).not.toContain('morgan'); // no forced dependency
    const health = files[1].content;
    expect(health).toContain("healthRouter.get('/health'");
    expect(health).toContain("status: 'ok'");
  });

  it('coerces an unknown target to "both"', () => {
    const { files } = generateObservability({ target: 'nonsense' as unknown as 'both' });
    expect(files).toHaveLength(3);
  });
});
