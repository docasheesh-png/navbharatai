import { describe, it, expect } from 'vitest';
import {
  analyzeRequirementCoverage,
  requirementCoverageSummary,
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

  it('counts a feature as covered when a matching component exists', () => {
    const r = analyzeRequirementCoverage(
      'I need login and a dashboard',
      graph({ components: ['LoginForm', 'Dashboard'] }),
    );
    expect(r.covered).toEqual(expect.arrayContaining(['login / authentication', 'dashboard']));
    expect(r.missing).toHaveLength(0);
    expect(r.findings).toHaveLength(0);
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
