import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
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
 * present, carried `aria-label="Search notes"`, and was wired to a real filter — the `src/App.tsx`
 * that ran hashes identical to our own golden scaffold (asserted below, so this is a fact and not a
 * recollection).
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
  it('the App.tsx that ran is byte-identical to our own quick-notes scaffold', () => {
    // The manifest in build 56f0c645 recorded this hash for src/App.tsx. If it matches ours, the app
    // was the scaffold, unmodified — which is what makes "the finding was false" a fact rather than a
    // theory. (The build wrote zero files; WRITE_TIME_TYPECHECK said so.)
    const g = GOLDEN_SCAFFOLDS.find((x) => x.id === 'quick-notes');
    expect(g, 'the quick-notes scaffold must still exist').toBeTruthy();
    const files = goldenScaffoldFiles(g as never) as Record<string, string>;
    const app = files['src/App.tsx'];
    expect(createHash('sha256').update(app).digest('hex'))
      .toBe('38364d60a1cd1803eb4d338cd445f4e48c8158991914d4a9a636a3fe90eb25ac');
  });

  it('that scaffold has a LABELLED search field wired to a real filter', () => {
    const g = GOLDEN_SCAFFOLDS.find((x) => x.id === 'quick-notes');
    const files = goldenScaffoldFiles(g as never) as Record<string, string>;
    const app = files['src/App.tsx'];
    expect(app).toContain('aria-label="Search notes"');
    expect(app).toContain('placeholder="Search notes"');
    // Not just a box: it actually filters.
    expect(app).toContain('n.text.toLowerCase().includes(q)');
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
