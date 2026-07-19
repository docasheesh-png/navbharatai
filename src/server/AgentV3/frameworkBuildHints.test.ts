import { describe, it, expect } from 'vitest';
import { nextBuildRepairHint } from './frameworkBuildHints';

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
