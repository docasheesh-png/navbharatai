import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  checkFeaturePresence,
  featurePresenceEvidence,
  isUnrenderedSpaShell,
} from '../src/server/AgentV3/FeaturePresence';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from '../src/server/AgentV3/goldenScaffolds/registry';

/**
 * A SENTENCE IS NOT A CONTROL (autopsy 56f0c645, 2026-09-21).
 *
 * 🔴 WHAT HAPPENED. A quick-notes build reported `FEATURE_COVERAGE: 1 requested feature(s) have NO
 * visible control in the running app — Search. Present: List / items.` The app's search box was
 * present, carried `aria-label="Search notes"`, and was wired to a real filter.
 *
 * 📌 HOW WE KNOW, RECORDED RATHER THAN ASSERTED. That build's manifest hashed `src/App.tsx` at
 * `38364d60a1cd1803eb4d338cd445f4e48c8158991914d4a9a636a3fe90eb25ac`, which on 2026-09-21 was
 * byte-identical to our own `quick-notes` golden scaffold — the app was the scaffold, unmodified, and
 * the build wrote zero files (`WRITE_TIME_TYPECHECK` said so). Commit `e2cd0e65a` then legitimately
 * added `aria-label="New note"` to that scaffold, so the hash has moved and is history now.
 * ⚠️ It is deliberately NOT asserted here. A pinned hash over a file that is SUPPOSED to improve
 * fails on every legitimate edit, and its only remedy is to paste the new hash — which teaches the
 * next session to paste hashes and verifies nothing. The forward-looking lock is the PROPERTY below:
 * this scaffold must keep a search field the probe can actually see.
 *
 * 🔑 THE CAUSE WAS NOT THE SEARCH RULE — it was the WITNESS. `checkFeaturePresence` already had a
 * capture-corroboration guard resting on one premise: *another feature probed PRESENT, so the DOM
 * really was captured.* That premise is false for a probe satisfied by PROSE. The `list` rule counts
 * an honest empty-state sentence, and `hasControlMatching` tests the page's entire visible-text blob,
 * so neither proves that one affordance reached the capture. A partial capture — the heading and
 * "No notes yet…" painted, the controls not yet — let `list` vouch for a DOM that had no controls in
 * it at all, and the `search` verdict was released against a working app. Those 44 characters of text
 * also carried it past `isUnrenderedSpaShell`'s 40-character floor, so the honesty guard stayed quiet.
 *
 * The fix is that a feature may be called MISSING only when some present probe rests on a real
 * element. Every test below names the specific thing it stops.
 */
const PROMPT = 'Build a quick notes app: write short notes, pin the important ones to the top, search by text, '
  + 'and save everything in the browser so it persists on reload. Fast, distraction-free, mobile-first UI.';

/** The capture from the real build: heading + empty-state line painted, no controls yet. */
const PARTIAL_CAPTURE = '<div id="root"><div class="container"><h1>Quick Notes</h1>'
  + '<p class="muted">No notes yet - your notes stay on this device.</p></div></div>';

/** The same app once React has painted it — what the probe was supposed to be judging. */
const FULL_CAPTURE = '<div id="root"><div class="row"><h1>Quick Notes</h1>'
  + '<button aria-label="Toggle theme">Dark</button></div><div class="card">'
  + '<input placeholder="Jot something down..."><button class="primary">Add</button>'
  + '<input aria-label="Search notes" placeholder="Search notes">'
  + '<p class="muted">No notes yet - your notes stay on this device.</p><ul></ul></div></div>';

describe('the app in the report really did have search', () => {
  it('the app the report named is still OUR scaffold, and still has a search field', () => {
    // The identity half of the autopsy. The hash is history (see the note above); what must hold for
    // ever is that this scaffold keeps a search affordance the probe can SEE — a labelled field, not
    // a bare box — because the whole finding turned on whether one existed.
    const g = GOLDEN_SCAFFOLDS.find((x) => x.id === 'quick-notes');
    expect(g, 'the quick-notes scaffold must still exist').toBeTruthy();
    const files = goldenScaffoldFiles(g as never) as Record<string, string>;
    const app = files['src/App.tsx'];
    expect(app).toContain('aria-label="Search notes"');
    expect(app).toContain('placeholder="Search notes"');
    // Not just a box: it actually filters.
    expect(app).toContain('n.text.toLowerCase().includes(q)');
    // And the probe's own rule agrees, run against the real attribute rather than a hand-written DOM.
    expect(checkFeaturePresence('search by text', app).present).toContain('Search');
  });

  it('and the rules find it correctly on the rendered DOM — the SEARCH RULE was never the bug', () => {
    const r = checkFeaturePresence(PROMPT, FULL_CAPTURE);
    expect(r.present).toContain('Search');
    expect(r.missing).toEqual([]);
  });
});

describe('a prose-only witness may not release a missing verdict', () => {
  it('THE EXACT REPORT CASE no longer accuses a working app', () => {
    // Before the fix this returned present ["List / items"], missing ["Search"] — reproduced
    // byte-for-byte from the report before anything was changed.
    const r = checkFeaturePresence(PROMPT, PARTIAL_CAPTURE);
    expect(r.missing).toEqual([]);
  });

  it('the honesty guard could NOT have caught it — the text was over the floor', () => {
    // 44 characters of empty-state copy, and a heading counts toward `controls`, so the shell guard
    // sees a "rendered" page. This is why the fix had to be in the witness, not in that threshold.
    expect(isUnrenderedSpaShell(PARTIAL_CAPTURE)).toBe(false);
  });

  it('an empty-state sentence is recorded as PROSE, not as a captured list', () => {
    const r = checkFeaturePresence('a todo list', '<div>No tasks here yet…</div>');
    const list = r.probes.find((p) => p.feature === 'list');
    expect(list?.present).toBe(true);
    expect(list?.via).toBe('text');
  });

  it('a real <ul> is recorded as a CONTROL', () => {
    const r = checkFeaturePresence('a todo list', '<div id="root"><ul><li>milk</li></ul></div>');
    expect(r.probes.find((p) => p.feature === 'list')?.via).toBe('control');
  });

  it('the word "delete" in a paragraph does not become a delete button', () => {
    // hasControlMatching tests the whole visible-text blob, so prose satisfies it. It may still count
    // as a hint — it may not corroborate a capture.
    const r = checkFeaturePresence(
      'a notes app with search and delete',
      '<div id="root"><p>Notes you delete are gone for ever.</p><p>No notes yet at all.</p></div>',
    );
    expect(r.missing).toEqual([]); // nothing may be accused off two paragraphs
  });
});

describe('what must NOT change — a real gap is still reported', () => {
  it('controls captured and genuinely no search ⇒ Search is reported missing', () => {
    const noSearch = '<div id="root"><div class="card"><input placeholder="Jot something down...">'
      + '<button>Add</button><ul><li>milk<button>Delete</button></li></ul></div></div>';
    const r = checkFeaturePresence(PROMPT, noSearch);
    expect(r.missing).toEqual(['Search']);
    expect(r.present).toContain('List / items');
  });

  it('an ALL-PRESENT result still stands even when prose-matched — it accuses nobody', () => {
    // The first version of the guard silenced this too, and the existing suite caught it. A result
    // with no missing features cannot contain a false accusation, so there is nothing to suppress.
    const r = checkFeaturePresence('a todo list', '<div>No tasks here yet…</div>');
    expect(r.probes.length).toBeGreaterThan(0);
    expect(r.present).toEqual(['List / items']);
    expect(r.missing).toEqual([]);
  });

  it('the all-absent capture-miss guard is untouched', () => {
    const r = checkFeaturePresence(PROMPT, '<div id="root"><h1>Quick Notes</h1><p>Loading your notes…</p></div>');
    expect(r.probes).toEqual([]);
  });

  it('a feature the user DECLINED is still never probed', () => {
    const r = checkFeaturePresence(
      'a notes app, no search at all',
      '<div id="root"><ul><li>milk</li></ul></div>',
    );
    expect(r.missing).not.toContain('Search');
  });
});

describe('the verdict now carries its evidence', () => {
  it('names what each probe rested on, so a false finding is auditable from the report', () => {
    // 🔎 The half of this fix that took longest to establish. The report recorded the verdict and none
    // of the evidence, so settling whether a working app had lost its search box meant hashing the
    // scaffold, re-running the probe against a reconstructed DOM and finally guessing the capture.
    const line = featurePresenceEvidence(checkFeaturePresence(PROMPT, FULL_CAPTURE));
    expect(line).toContain('Search=control');
    expect(line).toContain('List / items=control');
  });

  it('an absent probe says so rather than being left out', () => {
    const noSearch = '<div id="root"><div class="card"><input placeholder="Jot it down">'
      + '<button>Add</button><ul><li>milk</li></ul></div></div>';
    expect(featurePresenceEvidence(checkFeaturePresence(PROMPT, noSearch))).toContain('Search=absent');
  });

  it('nothing probed ⇒ no evidence line to print', () => {
    expect(featurePresenceEvidence({ probes: [], missing: [], present: [] })).toBe('');
  });

  it('the CALL SITE records the capture beside the verdict', () => {
    // Neither tsc nor vitest can see a detail that was never attached, and the whole point is that the
    // next false finding is diagnosable without an investigation.
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('featurePresenceEvidence(coverage)');
    expect(route).toContain('capture: source=');
    expect(route).toContain('painted=');
  });
});
