import { describe, it, expect } from 'vitest';
import { buildLessonFromDiagnostics } from './BuildLessons';

describe('buildLessonFromDiagnostics — distil the build report into a durable lesson', () => {
  it('a genuinely clean build teaches nothing → null (no memory churn)', () => {
    expect(buildLessonFromDiagnostics({ ok: true, problems: [], judgeFindings: [] })).toBeNull();
    expect(buildLessonFromDiagnostics({ ok: true })).toBeNull();
  });

  it('captures the root cause of a FAILED build', () => {
    const l = buildLessonFromDiagnostics({ ok: false, rootCause: 'dev server OOM-killed at 2GB' });
    expect(l).toContain('A build failed');
    expect(l).toContain('dev server OOM-killed at 2GB');
    expect(l).toMatch(/prevent this next time/i);
  });

  it('folds the top unresolved problems (bounded to 3) and ignores tool/heartbeat noise', () => {
    const l = buildLessonFromDiagnostics({
      ok: false,
      problems: [
        { severity: 'error', code: 'BUILD_ERROR', message: 'missing tsconfig' },
        { severity: 'warning', code: 'READINESS_WARNING', message: 'no error boundary' },
        { severity: 'error', message: 'preview blank' },
        { severity: 'error', message: 'fourth problem should be dropped' },
        { severity: 'info', code: 'HEARTBEAT', message: 'still working' },
      ],
    });
    expect(l).toContain('missing tsconfig');
    expect(l).toContain('no error boundary');
    expect(l).toContain('preview blank');
    expect(l).not.toContain('fourth problem');
    expect(l).not.toContain('still working');
  });

  it('captures the Sonnet judge findings (the cosmetic/quality misses a cheap model shipped)', () => {
    const l = buildLessonFromDiagnostics({ ok: true, judgeFindings: ['login is cosmetic — no real auth', 'password stored in localStorage'] });
    expect(l).toContain('A build shipped but had issues');
    expect(l).toContain('login is cosmetic');
    expect(l).toContain('password stored in localStorage');
  });

  it('an ok build with ONLY info-level problems still teaches nothing → null', () => {
    expect(buildLessonFromDiagnostics({ ok: true, problems: [{ severity: 'info', message: 'step 1' }] })).toBeNull();
  });

  it('combines root cause + judge + problems into one concise lesson', () => {
    const l = buildLessonFromDiagnostics({
      ok: false,
      rootCause: 'preview never rendered',
      judgeFindings: ['feature not actually implemented'],
      problems: [{ severity: 'error', message: 'ReferenceError in Calculator' }],
    });
    expect(l).toContain('preview never rendered');
    expect(l).toContain('feature not actually implemented');
    expect(l).toContain('ReferenceError in Calculator');
  });
});
