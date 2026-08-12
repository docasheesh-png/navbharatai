import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sectionUntil } from '../../../tests/helpers/sourceSlice';
import {
  requestedFeatureLabels, renderRequestedFeatureContract, MAX_CONTRACT_FEATURES,
  analyzeRequirementCoverage,
} from './RequirementCoverage';

// THE REPORT THIS EXISTS FOR (dukaan stock app). The user wrote, in their own words:
//
//     "Saari cheezon ki list dikhe, upar search box ho"
//
// No search was built. The end-of-build audit noticed and said so — and the app shipped, with the user
// told it was ready. Making that finding trustworthy was the honest half; it still runs after the app
// exists. This is the other half: the same list, handed to the builder BEFORE it builds.

describe('reading the features out of the user\'s own words', () => {
  it('finds what the dukaan user actually asked for', () => {
    expect(requestedFeatureLabels('Saari cheezon ki list dikhe, upar search box ho')).toContain('search');
  });

  it('reads a multi-feature request', () => {
    const labels = requestedFeatureLabels('Shop app with login, a cart, checkout and payment');
    expect(labels).toEqual(expect.arrayContaining(['login / authentication', 'shopping cart', 'checkout', 'payment']));
  });

  it('does NOT turn a refusal into a requirement', () => {
    // "No settings" once produced a false "Requested feature not found: settings". A contract built
    // from the same mistake would be worse — it would order the builder to build the thing the user
    // explicitly declined.
    expect(requestedFeatureLabels('No settings, no other features — keep it minimal')).not.toContain('settings');
  });

  it('is silent on a request that names no known surface', () => {
    expect(requestedFeatureLabels('make it look nicer')).toEqual([]);
    expect(requestedFeatureLabels('')).toEqual([]);
  });
});

describe('the contract handed to the builder', () => {
  it('names each feature and says it will be checked', () => {
    const text = renderRequestedFeatureContract(['search', 'shopping cart']);
    expect(text).toContain('search');
    expect(text).toContain('shopping cart');
    expect(text).toContain('EXPLICITLY ASKED FOR');
    expect(text).toContain('checked against this exact list');
  });

  it('allows a feature to live inside an existing page', () => {
    // The dukaan case is exactly this: a search box at the top of a list needs no file of its own.
    // Without saying so, the contract would push the builder into inventing a Search.tsx to satisfy it.
    expect(renderRequestedFeatureContract(['search'])).toMatch(/does not need its own file/);
  });

  it('is EMPTY when nothing was asked for, so the prompt is left untouched', () => {
    // The guarantee that a build whose request names no known surface is byte-identical to before.
    expect(renderRequestedFeatureContract([])).toBe('');
    expect(renderRequestedFeatureContract(['   '])).toBe('');
  });

  it('caps a kitchen-sink request instead of crowding out the real prompt', () => {
    const many = Array.from({ length: MAX_CONTRACT_FEATURES + 5 }, (_, i) => `feature-${i}`);
    const text = renderRequestedFeatureContract(many);
    expect(text).toContain('feature-0');
    expect(text).not.toContain(`feature-${MAX_CONTRACT_FEATURES + 4}`);
    expect(text).toContain('and 5 more');
  });
});

describe('the promise and the grade are the same list', () => {
  // This is the property worth protecting. Two separately-maintained lists would drift, and then the
  // build would be asked for one thing and judged on another — which is how a true finding starts
  // looking like a false alarm and gets ignored.
  const request = 'Shop with login, cart, checkout, search and an admin panel';

  it('every feature the audit says was REQUESTED is one the contract named', () => {
    const graph = { files: ['src/App.tsx'], components: ['App'], routes: [] } as never;
    const audited = analyzeRequirementCoverage(request, graph).requested;
    const promised = requestedFeatureLabels(request);
    expect(audited.sort()).toEqual(promised.sort());
  });

  it('holds for the negation case too — declined features are in neither list', () => {
    const req = 'A blog. No login.';
    const graph = { files: ['src/Blog.tsx'], components: ['Blog'], routes: [] } as never;
    expect(requestedFeatureLabels(req)).not.toContain('login / authentication');
    expect(analyzeRequirementCoverage(req, graph).requested).not.toContain('login / authentication');
  });
});

describe('the contract actually reaches the builder', () => {
  // A contract nobody sends is the "looks done, does nothing" state — and it would be invisible,
  // because the end-of-build audit would keep reporting the same misses either way.
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('is prepended to the build prompt', () => {
    const block = sectionUntil(route, 'renderRequestedFeatureContract(requestedFeatureLabels(prompt))', '\n\n  ');
    expect(block).toContain('buildPrompt = `${contract}');
  });

  it('is built from the CURRENT request, not a stored spec', () => {
    // Auditing against the cumulative spec was a real bug (report 1682cd03): a tiny follow-up edit
    // re-judged the whole original build. Promising from a stored spec would resurrect it at the other
    // end — a one-line edit would be handed the first build's entire feature list to rebuild.
    expect(route).toContain('requestedFeatureLabels(prompt)');
  });

  it('cannot take a build down with it', () => {
    const block = sectionUntil(route, 'const contract = renderRequestedFeatureContract', '// ');
    expect(block).toContain('catch');
  });

  it('needs no flag, because it invents nothing', () => {
    // The requirement-GAP guidance beside it is flag-gated for a real reason: it proposes features the
    // user never mentioned. This one only repeats theirs, so gating it would leave a known broken
    // promise switched off by default.
    const block = sectionUntil(route, 'THE USER\'S OWN WORDS, RESTATED AS A CONTRACT', 'try {');
    expect(block).toContain('No flag');
  });
});
