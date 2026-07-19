import { describe, it, expect } from 'vitest';
import { nextBuildRepairHint, nextMiddlewareCorrectPath } from './frameworkBuildHints';

describe('nextBuildRepairHint — targeted Next.js build-error guidance (CargoPilot autopsy)', () => {
  it('returns null for non-Next output', () => {
    expect(nextBuildRepairHint('some random compiler error')).toBeNull();
    expect(nextBuildRepairHint('')).toBeNull();
  });

  it('App-Router `export const config` deprecation (the EXACT CargoPilot error) → remove-it guidance', () => {
    const out = nextBuildRepairHint(
      '> Build error occurred\nError: Page config in /home/user/workspace/app/api/webhooks/stripe/route.ts is deprecated. Replace `export const config=…` with the following:\nVisit https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config',
    );
    expect(out).toContain('App Router');
    expect(out).toContain('await req.text()');
    expect(out).toContain('runtime');
  });

  it('getServerSideProps in app dir → Server Component / route handler guidance', () => {
    const out = nextBuildRepairHint('Error: getServerSideProps is not supported in the app directory. app/page.tsx');
    expect(out).toContain('Server Component');
    expect(out).toContain('route handler');
  });

  it('missing "use client" for a hook component → add-directive guidance', () => {
    const out = nextBuildRepairHint(
      'You\'re importing a component that needs useState. It only works in a Client Component but none of its parents are marked with "use client". app/components/Counter.tsx',
    );
    expect(out).toContain('use client');
    expect(out).toContain('FIRST line');
  });

  it('an unrecognised Next error → null (no false hint)', () => {
    expect(nextBuildRepairHint('next build: some brand new error we do not recognise yet')).toBeNull();
  });
});

describe('nextMiddlewareCorrectPath — a misplaced Next.js middleware silently disables route guards', () => {
  it('relocates app/middleware to the project root (the exact CargoPilot mistake)', () => {
    expect(nextMiddlewareCorrectPath('app/middleware.ts')).toBe('middleware.ts');
    expect(nextMiddlewareCorrectPath('app/middleware.js')).toBe('middleware.js');
    expect(nextMiddlewareCorrectPath('./app/middleware.ts')).toBe('middleware.ts');
  });

  it('relocates src/app/middleware to src/middleware (src-dir projects)', () => {
    expect(nextMiddlewareCorrectPath('src/app/middleware.ts')).toBe('src/middleware.ts');
  });

  it('leaves an already-correct middleware untouched (null = no relocation)', () => {
    expect(nextMiddlewareCorrectPath('middleware.ts')).toBeNull();
    expect(nextMiddlewareCorrectPath('src/middleware.ts')).toBeNull();
  });

  it('null for non-middleware or deeper paths (not the Next special file)', () => {
    expect(nextMiddlewareCorrectPath('app/api/route.ts')).toBeNull();
    expect(nextMiddlewareCorrectPath('app/admin/middleware.ts')).toBeNull();
    expect(nextMiddlewareCorrectPath('lib/middleware.ts')).toBeNull();
    expect(nextMiddlewareCorrectPath('')).toBeNull();
  });
});
