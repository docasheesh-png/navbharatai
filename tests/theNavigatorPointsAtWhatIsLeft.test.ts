// THE ACTION NAVIGATOR — the rules the admin described, encoded as the cases that would break them.
//
// The ask (2026-09-21) is a TRAIL of dots from the More button down to the one button that finishes
// the job, clearing as each job is really done. Four laws carry the whole design, and each one has a
// real failure behind it, so each gets its own block here:
//
//   1. a dot clears on the FACT, never on the click
//   2. a parent's dot is COUNTED, never stored
//   3. a fact we do not know produces NO dot
//   4. an opportunity can be dismissed; an attention cannot
//
// The last block is REVERSION-PROOF: delete the law from the module and the named case fails. That
// matters most for law 4, which is one `filter` predicate — the kind of line a later refactor
// "simplifies" without any other test noticing.

import { describe, it, expect } from 'vitest';
import {
  pendingActions,
  badgeAt,
  actionsAt,
  badgeLabelAt,
  strongerTone,
  PREVIEW_DWELL_MS,
  type NavigatorFacts,
} from '../src/lib/actionNavigator';
import { needsPublishDot } from '../src/lib/publishFreshness';

/** A finished, successful build the user has really looked at. The starting point of the ask's flow. */
const provenApp: NavigatorFacts = {
  building: false,
  buildFinished: true,
  buildOk: true,
  previewDwellMs: PREVIEW_DWELL_MS,
};

describe('A — the flow the admin described, step by step', () => {
  it('a build that is still running offers nothing at all', () => {
    const actions = pendingActions({ ...provenApp, building: true, publishFreshness: 'never_published' });
    expect(actions).toEqual([]);
    expect(badgeAt(actions, ['more'])).toBeNull();
  });

  it('a finished app the user has NOT looked at yet offers nothing — the trail starts after the preview', () => {
    // "jaise hi user preview chalaye, THODI DER CHALA LE, uske bad"
    const actions = pendingActions({ ...provenApp, previewDwellMs: 0, publishFreshness: 'never_published' });
    expect(actions).toEqual([]);
  });

  it('one second short of the threshold is still nothing; at the threshold the trail appears', () => {
    const almost = pendingActions({ ...provenApp, previewDwellMs: PREVIEW_DWELL_MS - 1, publishFreshness: 'never_published' });
    expect(almost).toEqual([]);

    const ready = pendingActions({ ...provenApp, publishFreshness: 'never_published' });
    expect(ready.map((a) => a.id)).toContain('publish.first');
  });

  it('once the app is proven, the dot appears on More, on Publish, and on the button that does it', () => {
    const actions = pendingActions({ ...provenApp, publishFreshness: 'never_published' });

    // The trail, exactly as described: 3-dot More -> Publish -> the option inside.
    expect(badgeAt(actions, ['more'])).toBe('opportunity');
    expect(badgeAt(actions, ['more', 'publish'])).toBe('opportunity');
    expect(badgeAt(actions, ['more', 'publish', 'navbharatai'])).toBe('opportunity');
  });

  it('publishing clears its own dot and nothing else has to be told', () => {
    // "user ne publish on navbharatai par click kiya publish ho gaya = publish on navbharatai wala
    //  red dot gayab" — and the parent goes with it, because the parent is counted, not stored.
    const after = pendingActions({ ...provenApp, publishFreshness: 'up_to_date' });
    expect(after.map((a) => a.id)).not.toContain('publish.first');
    expect(badgeAt(after, ['more', 'publish', 'navbharatai'])).toBeNull();
    expect(badgeAt(after, ['more'])).toBeNull();
  });

  it('App Mart and the APK clear one at a time, each on its own success', () => {
    // "user ne publish on app mart kiya -> successful -> red dot hat gaya! and so on..."
    const both = pendingActions({
      ...provenApp,
      publishFreshness: 'up_to_date',
      appMartPublished: false,
      apkBuilt: false,
    });
    expect(both.map((a) => a.id).sort()).toEqual(['publish.apk', 'publish.appmart']);

    const afterAppMart = pendingActions({
      ...provenApp,
      publishFreshness: 'up_to_date',
      appMartPublished: true,
      apkBuilt: false,
    });
    expect(afterAppMart.map((a) => a.id)).toEqual(['publish.apk']);
    // The Publish sheet still has a dot, because one option is still pending.
    expect(badgeAt(afterAppMart, ['more', 'publish'])).toBe('opportunity');

    const afterBoth = pendingActions({
      ...provenApp,
      publishFreshness: 'up_to_date',
      appMartPublished: true,
      apkBuilt: true,
    });
    expect(badgeAt(afterBoth, ['more'])).toBeNull();
  });

  it('a domain is offered only once something is actually live', () => {
    const notYetPublished = pendingActions({
      ...provenApp,
      publishFreshness: 'never_published',
      customDomainOffered: true,
      customDomainConnected: false,
    });
    expect(notYetPublished.map((a) => a.id)).not.toContain('publish.domain');

    const live = pendingActions({
      ...provenApp,
      publishFreshness: 'up_to_date',
      customDomainOffered: true,
      customDomainConnected: false,
    });
    expect(live.map((a) => a.id)).toContain('publish.domain');

    const connected = pendingActions({
      ...provenApp,
      publishFreshness: 'up_to_date',
      customDomainOffered: true,
      customDomainConnected: true,
    });
    expect(connected.map((a) => a.id)).not.toContain('publish.domain');
  });
});

describe('B — the build failed: report', () => {
  const failed: NavigatorFacts = { building: false, buildFinished: true, buildOk: false };

  it('a failed build puts a RED dot on More and on Report', () => {
    const actions = pendingActions(failed);
    expect(badgeAt(actions, ['more'])).toBe('attention');
    expect(badgeAt(actions, ['more', 'report'])).toBe('attention');
  });

  it('the dot goes when the report is SENT, not when the popup is opened', () => {
    // Law 1. There is deliberately no "opened" field to pass — a click is not an outcome.
    const stillPending = pendingActions({ ...failed, reportsSentForThisBuild: 0 });
    expect(badgeAt(stillPending, ['more', 'report'])).toBe('attention');

    const sent = pendingActions({ ...failed, reportsSentForThisBuild: 1 });
    expect(badgeAt(sent, ['more', 'report'])).toBeNull();
    expect(badgeAt(sent, ['more'])).toBeNull();
  });

  it('a failed build offers no next steps — only the report', () => {
    const actions = pendingActions({ ...failed, previewDwellMs: PREVIEW_DWELL_MS, publishFreshness: 'never_published', appMartPublished: false });
    expect(actions.map((a) => a.id)).toEqual(['report.failed-build']);
  });
});

describe('C — keys, and why this one is red', () => {
  it('a key the app cannot run without is an ATTENTION, not an opportunity', () => {
    const actions = pendingActions({ ...provenApp, missingRequiredKeys: 2 });
    expect(badgeAt(actions, ['more', 'secrets'])).toBe('attention');
    expect(actions.find((a) => a.id === 'secrets.missing-required')?.why).toContain('2 keys');
  });

  it('an app that needs no keys is never nagged about keys', () => {
    expect(pendingActions({ ...provenApp, missingRequiredKeys: 0 }).map((a) => a.id)).not.toContain('secrets.missing-required');
  });
});

describe('the two tones — red keeps its meaning', () => {
  it('a stale live site is RED; a first publish is BLUE', () => {
    // The distinction the whole colour split rests on: one is a fault the visitors can see, the
    // other is an invitation. Both are the same button.
    const stale = pendingActions({ ...provenApp, publishFreshness: 'changed' });
    expect(badgeAt(stale, ['more', 'publish', 'navbharatai'])).toBe('attention');

    const first = pendingActions({ ...provenApp, publishFreshness: 'never_published' });
    expect(badgeAt(first, ['more', 'publish', 'navbharatai'])).toBe('opportunity');
  });

  it('a red child makes the parent red even next to blue siblings', () => {
    const mixed = pendingActions({
      ...provenApp,
      publishFreshness: 'changed',       // red, under publish
      appMartPublished: false,           // blue, under publish
    });
    expect(badgeAt(mixed, ['more', 'publish'])).toBe('attention');
    expect(badgeAt(mixed, ['more'])).toBe('attention');
    expect(badgeAt(mixed, ['more', 'publish', 'appmart'])).toBe('opportunity');
  });

  it('attention sorts first, so a surface showing one item shows the one that matters', () => {
    const mixed = pendingActions({
      ...provenApp,
      publishFreshness: 'changed',
      appMartPublished: false,
      apkBuilt: false,
    });
    expect(mixed[0]!.tone).toBe('attention');
  });

  it('strongerTone treats null as weakest', () => {
    expect(strongerTone(null, null)).toBeNull();
    expect(strongerTone(null, 'opportunity')).toBe('opportunity');
    expect(strongerTone('opportunity', 'attention')).toBe('attention');
    expect(strongerTone('attention', 'opportunity')).toBe('attention');
  });
});

describe('law 3 — a fact we did not measure produces no dot', () => {
  it('unknown publish freshness says nothing in either direction', () => {
    const unknown = pendingActions({ ...provenApp, publishFreshness: 'unknown' });
    expect(unknown.filter((a) => a.path.includes('publish'))).toEqual([]);
  });

  it('a freshness nobody looked up says nothing', () => {
    expect(pendingActions({ ...provenApp })).toEqual([]);
  });

  it('App Mart and APK are silent until somebody actually answered the question', () => {
    // undefined is "we did not look", NOT "no". This is the field shape that makes a new surface
    // safe to add: a caller that cannot answer simply omits it.
    const nobodyLooked = pendingActions({ ...provenApp, publishFreshness: 'up_to_date' });
    expect(nobodyLooked).toEqual([]);
  });

  it('a domain nobody checked for is not offered even where it would be allowed', () => {
    const noAnswer = pendingActions({ ...provenApp, publishFreshness: 'up_to_date', customDomainOffered: true });
    expect(noAnswer.map((a) => a.id)).not.toContain('publish.domain');
  });
});

describe('law 2 — the roll-up is counted, so it cannot be left switched on', () => {
  it('an empty path means "anywhere"', () => {
    const actions = pendingActions({ ...provenApp, publishFreshness: 'never_published' });
    expect(badgeAt(actions, [])).toBe('opportunity');
    expect(badgeAt([], [])).toBeNull();
  });

  it('a path that matches nothing is null, and a partial name is not a match', () => {
    const actions = pendingActions({ ...provenApp, publishFreshness: 'never_published' });
    expect(badgeAt(actions, ['settings'])).toBeNull();
    expect(badgeAt(actions, ['more', 'pub'])).toBeNull();          // prefix of a SEGMENT is not a match
    expect(badgeAt(actions, ['more', 'publish', 'navbharatai', 'x'])).toBeNull(); // deeper than the leaf
  });

  it('actionsAt returns the subtree, and the label never leaves a dot unexplained', () => {
    const actions = pendingActions({
      ...provenApp,
      publishFreshness: 'up_to_date',
      appMartPublished: false,
      apkBuilt: false,
    });
    expect(actionsAt(actions, ['more', 'publish']).map((a) => a.id).sort()).toEqual(['publish.apk', 'publish.appmart']);
    expect(badgeLabelAt(actions, ['more', 'publish', 'appmart'])).toBe('Put it on App Mart');
    expect(badgeLabelAt(actions, ['more', 'publish'])).toBe('2 things you can do');
    expect(badgeLabelAt(actions, ['settings'])).toBeNull();
  });
});

describe('law 4 — REVERSION-PROOF: a dismissal can never silence a fault', () => {
  it('a dismissed opportunity goes away', () => {
    const actions = pendingActions({
      ...provenApp,
      publishFreshness: 'up_to_date',
      appMartPublished: false,
      dismissed: ['publish.appmart'],
    });
    expect(actions.map((a) => a.id)).not.toContain('publish.appmart');
    expect(badgeAt(actions, ['more'])).toBeNull();
  });

  it('a dismissed ATTENTION stays — this is the case a "simplification" would break', () => {
    // Delete `a.tone === 'attention' ||` from the filter in actionNavigator.ts and ONLY this test
    // fails. Nothing else in the suite passes a dismissal for a red action, and tsc cannot see that
    // a predicate lost a clause — which is exactly how a fault-hiding dismissal would ship.
    const staleSite = pendingActions({
      ...provenApp,
      publishFreshness: 'changed',
      dismissed: ['publish.stale'],
    });
    expect(staleSite.map((a) => a.id)).toContain('publish.stale');
    expect(badgeAt(staleSite, ['more', 'publish', 'navbharatai'])).toBe('attention');

    const failedBuild = pendingActions({
      building: false,
      buildFinished: true,
      buildOk: false,
      dismissed: ['report.failed-build'],
    });
    expect(failedBuild.map((a) => a.id)).toContain('report.failed-build');

    const missingKey = pendingActions({
      ...provenApp,
      missingRequiredKeys: 1,
      dismissed: ['secrets.missing-required'],
    });
    expect(missingKey.map((a) => a.id)).toContain('secrets.missing-required');
  });

  it('dismissing one thing does not dismiss its neighbours', () => {
    const actions = pendingActions({
      ...provenApp,
      publishFreshness: 'up_to_date',
      appMartPublished: false,
      apkBuilt: false,
      dismissed: ['publish.appmart'],
    });
    expect(actions.map((a) => a.id)).toEqual(['publish.apk']);
  });
});

describe('every action is usable by a surface that has never heard of it', () => {
  it('ids are unique and paths are non-empty, for every combination that produces actions', () => {
    const everything = pendingActions({
      building: false,
      buildFinished: true,
      buildOk: true,
      previewDwellMs: PREVIEW_DWELL_MS,
      publishFreshness: 'changed',
      customDomainOffered: true,
      customDomainConnected: false,
      appMartPublished: false,
      apkBuilt: false,
      missingRequiredKeys: 1,
    });
    const ids = everything.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const action of everything) {
      expect(action.path.length).toBeGreaterThan(0);
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.why.length).toBeGreaterThan(0);
      // Law: a label is what a person reads, so it must not be an id or a code.
      expect(action.label).not.toContain('.');
    }
  });

  it('is pure — the same facts give the same answer, and the input is not mutated', () => {
    const facts: NavigatorFacts = { ...provenApp, publishFreshness: 'never_published', dismissed: ['x'] };
    const frozen = JSON.stringify(facts);
    const a = pendingActions(facts);
    const b = pendingActions(facts);
    expect(a).toEqual(b);
    expect(JSON.stringify(facts)).toBe(frozen);
  });
});

describe('the navigator and publishFreshness are ONE verdict, not two', () => {
  // HostingChooser keeps `needsPublishDot` as the fallback for callers that do not pass the
  // navigator's list (its own tests). That fallback is only safe while the two rules agree, so the
  // agreement is asserted here rather than assumed — if either side's definition of "the live site
  // is stale" ever moves, this fails instead of the sheet quietly showing a different dot from the
  // menu that opened it.
  const FRESHNESS = ['never_published', 'up_to_date', 'changed', 'unknown'] as const;

  it('emits publish.stale for exactly the freshness values needsPublishDot fires on', () => {
    for (const freshness of FRESHNESS) {
      const actions = pendingActions({ ...provenApp, publishFreshness: freshness });
      const stale = actions.some((a) => a.id === 'publish.stale');
      expect(stale, `freshness=${freshness}`).toBe(needsPublishDot(freshness));
    }
  });

  it('and a stale site is ALWAYS attention, whatever else is pending', () => {
    for (const freshness of FRESHNESS) {
      const tone = badgeAt(
        pendingActions({ ...provenApp, publishFreshness: freshness, appMartPublished: false }),
        ['more', 'publish', 'navbharatai'],
      );
      if (needsPublishDot(freshness)) expect(tone, `freshness=${freshness}`).toBe('attention');
    }
  });
});
