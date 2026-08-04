import { describe, it, expect } from 'vitest';
import {
  analyzeRequirementCoverage,
  requirementCoverageSummary,
  currentRequestForCoverage,
} from './RequirementCoverage';
import type { ProjectGraph } from './WorkspaceMemory';

function graph(partial: Partial<ProjectGraph>): ProjectGraph {
  return {
    files: [],
    symbols: [],
    components: [],
    routes: [],
    imports: {},
    dependencies: [],
    ...partial,
  };
}

describe('analyzeRequirementCoverage', () => {
  it('is silent when there is no request', () => {
    const r = analyzeRequirementCoverage('', graph({ components: ['LoginForm'] }));
    expect(r.requested).toHaveLength(0);
    expect(r.findings).toHaveLength(0);
  });

  it('is silent when nothing has been built yet (no false "missing")', () => {
    const r = analyzeRequirementCoverage('build a login and dashboard', graph({}));
    expect(r.findings).toHaveLength(0);
    expect(r.missing).toHaveLength(0);
  });

  it('flags a requested feature that has no matching surface', () => {
    const r = analyzeRequirementCoverage(
      'build a todo app with a dashboard',
      graph({ components: ['TodoList'], files: ['src/TodoList.tsx'] }),
    );
    expect(r.requested).toContain('dashboard');
    expect(r.missing).toContain('dashboard');
    expect(r.findings.some((f) => f.feature === 'dashboard' && f.level === 'medium')).toBe(true);
  });

  // Deep-test App #1: "No settings, no other features" must NOT produce a false
  // "Requested feature not found: settings" — the user explicitly DECLINED settings.
  it('does NOT flag an explicitly-declined feature as requested ("No settings")', () => {
    const r = analyzeRequirementCoverage(
      'Build a simple digital clock. No settings, no other features — just the live clock and date.',
      graph({ components: ['Clock'], files: ['src/App.tsx'] }),
    );
    expect(r.requested).not.toContain('settings');
    expect(r.missing).not.toContain('settings');
    expect(r.findings.some((f) => f.feature === 'settings')).toBe(false);
  });

  it('counts a feature as covered when a matching component exists', () => {
    const r = analyzeRequirementCoverage(
      'I need login and a dashboard',
      graph({ components: ['LoginForm', 'Dashboard'] }),
    );
    expect(r.covered).toEqual(expect.arrayContaining(['login / authentication', 'dashboard']));
    expect(r.missing).toHaveLength(0);
    expect(r.findings).toHaveLength(0);
  });

  it('counts a folder-routed feature as covered by its DIRECTORY, not just the basename (ShopSphere/Nuxt autopsy)', () => {
    // Nuxt/Next encode the admin panel in the DIRECTORY (components/admin/, pages/admin/), not the
    // filename. A basename-only surface dropped `admin/` → false "admin panel not found". Full paths fix it.
    const r = analyzeRequirementCoverage(
      'multi-vendor marketplace with an admin panel to approve vendors',
      graph({
        components: ['VendorApprovalModal', 'RBACGuard'],
        files: ['components/admin/VendorApprovalModal.vue', 'server/middleware/rbac.ts', 'pages/index.vue'],
      }),
    );
    expect(r.requested).toContain('admin panel');
    expect(r.covered).toContain('admin panel');
    expect(r.missing).not.toContain('admin panel');
  });

  it('matches synonyms (auth component satisfies a login request)', () => {
    const r = analyzeRequirementCoverage(
      'add login',
      graph({ components: ['AuthGate'], files: ['src/AuthGate.tsx'] }),
    );
    expect(r.covered).toContain('login / authentication');
    expect(r.missing).toHaveLength(0);
  });

  it('matches a built surface by route or file name, not only components', () => {
    const r = analyzeRequirementCoverage(
      'add a contact page',
      graph({ routes: ['/contact'], files: ['src/pages/contact.tsx'] }),
    );
    expect(r.covered).toContain('contact page');
    expect(r.missing).toHaveLength(0);
  });

  it('separates covered from missing across multiple requested features', () => {
    const r = analyzeRequirementCoverage(
      'shop app with cart, checkout and an admin panel',
      graph({ components: ['Cart', 'Checkout'], files: ['src/Cart.tsx', 'src/Checkout.tsx'] }),
    );
    expect(r.covered).toEqual(expect.arrayContaining(['shopping cart', 'checkout']));
    expect(r.missing).toContain('admin panel');
  });

  it('matches real-world artifact names (the Hospital-build false negatives)', () => {
    // "Registration.tsx" does not contain the substring "register" — the old artifact regex
    // reported a fully-built OPD Registration page as missing.
    const reg = analyzeRequirementCoverage(
      'Hospital OPD with patient registration',
      graph({ files: ['src/pages/Registration.tsx', 'src/hooks/useRegistrations.ts'] }),
    );
    expect(reg.covered).toContain('sign-up / registration');
    expect(reg.missing).not.toContain('sign-up / registration');
    // A toast system IS the app's notification surface.
    const notif = analyzeRequirementCoverage(
      'an app with notifications',
      graph({ files: ['src/context/ToastContext.tsx'] }),
    );
    expect(notif.covered).toContain('notifications');
    // A filter surface satisfies a search request (search & filter ship as one CRUD surface).
    const search = analyzeRequirementCoverage(
      'a list with search',
      graph({ components: ['PatientFilters'] }),
    );
    expect(search.covered).toContain('search');
  });

  it('caps findings at five', () => {
    const r = analyzeRequirementCoverage(
      'login signup dashboard profile settings search cart admin',
      graph({ components: ['Placeholder'], files: ['src/Placeholder.tsx'] }),
    );
    expect(r.findings.length).toBeLessThanOrEqual(5);
  });

  it('flags newly-catalogued surfaces (upload/booking/reviews) when requested but not built', () => {
    const r = analyzeRequirementCoverage(
      'a listings app with image upload, a booking calendar and reviews',
      graph({ components: ['ListingCard'], files: ['src/ListingCard.tsx'] }),
    );
    expect(r.missing).toEqual(expect.arrayContaining(['file / image upload', 'calendar / booking / appointment', 'reviews / ratings']));
  });

  it('counts the new surfaces as covered when a matching artifact exists (broad synonyms)', () => {
    const upload = analyzeRequirementCoverage('let users upload a photo', graph({ components: ['Dropzone'] }));
    expect(upload.covered).toContain('file / image upload');

    const booking = analyzeRequirementCoverage('an appointment booking page', graph({ files: ['src/pages/AppointmentScheduler.tsx'] }));
    expect(booking.covered).toContain('calendar / booking / appointment');

    const reports = analyzeRequirementCoverage('a sales analytics report', graph({ components: ['SalesChart'] }));
    expect(reports.covered).toContain('analytics / reports / charts');

    const reset = analyzeRequirementCoverage('add a forgot password flow', graph({ files: ['src/ResetPassword.tsx'] }));
    expect(reset.covered).toContain('password reset');
  });
});

describe('currentRequestForCoverage — scope coverage to the CURRENT turn (report 1682cd03)', () => {
  it('is empty for no requests', () => {
    expect(currentRequestForCoverage([])).toBe('');
    expect(currentRequestForCoverage(['   ', ''])).toBe('');
  });

  it('returns the sole request unchanged on a first build (multi-feature spec intact)', () => {
    const spec = 'Build QuizArena with a login, a blog, a leaderboard and a stats dashboard';
    expect(currentRequestForCoverage([spec])).toBe(spec);
  });

  it('returns ONLY the most-recent request on a follow-up/edit turn', () => {
    const reqs = [
      'Build FitPulse — a workout tracker with login, a blog feed and exercise logging',
      'rest timer me 30s ka option bhi add karo',
    ];
    expect(currentRequestForCoverage(reqs)).toBe('rest timer me 30s ka option bhi add karo');
  });

  // THE exact real failure (report 1682cd03): a tiny edit turn on a long-lived app used to re-audit
  // the ENTIRE original spec against the current graph and falsely flag login/blog "not found" — one
  // of those advisories even became the rootCause of a 95/100 PASSING build. Scoping to the current
  // request kills the class: the "add a 30s rest option" edit names neither login nor blog, so neither
  // can be flagged, while a real gap in the CURRENT ask is still caught.
  it('does NOT resurrect the original spec\'s features (login/blog) on an unrelated micro-edit', () => {
    const requests = [
      'Build FitPulse — a workout tracker with login, a blog feed and exercise logging',
      'rest timer me 30s ka option bhi add karo',
    ];
    const currentApp = graph({
      components: ['ExerciseList', 'WorkoutHistory', 'ThemeProvider', 'RestTimer'],
      files: ['src/App.tsx', 'src/hooks/useRestTimer.ts'],
    });
    // OLD (buggy) behaviour: auditing the cumulative join WOULD flag login + blog as missing.
    const cumulative = analyzeRequirementCoverage(requests.join('\n'), currentApp);
    expect(cumulative.missing).toEqual(expect.arrayContaining(['login / authentication', 'blog / articles']));
    // NEW behaviour: scope to the current request → neither is even considered.
    const scoped = analyzeRequirementCoverage(currentRequestForCoverage(requests), currentApp);
    expect(scoped.missing).not.toContain('login / authentication');
    expect(scoped.missing).not.toContain('blog / articles');
    expect(scoped.findings).toHaveLength(0);
  });
});

describe('requirementCoverageSummary', () => {
  it('reports the no-named-features case', () => {
    const r = analyzeRequirementCoverage('make it look nicer', graph({ components: ['Home'] }));
    expect(requirementCoverageSummary(r)).toContain('no specific named features');
  });

  it('renders a pass line when all requested features are present', () => {
    const r = analyzeRequirementCoverage('add login', graph({ components: ['LoginForm'] }));
    expect(requirementCoverageSummary(r)).toContain('✓');
  });

  it('lists the missing features', () => {
    const r = analyzeRequirementCoverage(
      'app with a dashboard',
      graph({ components: ['Home'], files: ['src/Home.tsx'] }),
    );
    const out = requirementCoverageSummary(r);
    expect(out).toContain('not found in the build');
    expect(out).toContain('dashboard');
  });
});
