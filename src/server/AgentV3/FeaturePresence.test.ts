import { describe, it, expect } from 'vitest';
import { afterEach } from 'vitest';
import { checkFeaturePresence, featurePresenceSummary, featurePresenceRepairPrompt, featureHealEnabled, isUnrenderedSpaShell } from './FeaturePresence';

// The TaskLite prompt (admin report a06e7fd2) — Add / Delete / Mark complete / Filter (All/Active/
// Completed) / footer stats / a task list.
const TASKLITE = 'Build the smallest task manager. Features: Add task, Delete task, Mark complete, Filter: All, Active, Completed. Footer showing Total, Completed, Remaining.';

describe('checkFeaturePresence — only probes REQUESTED features', () => {
  it('does not probe a feature the prompt never mentioned', () => {
    const r = checkFeaturePresence('build a simple clock that shows the time', '<div>12:00</div>');
    expect(r.probes).toHaveLength(0);
    expect(r.missing).toHaveLength(0);
  });

  it('reports a requested feature PRESENT when its control renders', () => {
    const html = '<input placeholder="What needs to be done?"/><button>Add</button><ul><li>Buy milk<button aria-label="Delete">×</button></li></ul>';
    const r = checkFeaturePresence('Add task and Delete task from a list', html);
    const add = r.probes.find((p) => p.feature === 'add');
    const del = r.probes.find((p) => p.feature === 'delete');
    expect(add?.present).toBe(true);
    expect(del?.present).toBe(true);
    expect(r.missing).toHaveLength(0);
  });

  it('HIGHLIGHTS a requested feature as missing when its control is absent (asked Delete, no delete control)', () => {
    const html = '<input placeholder="Add a task"/><button>Add</button><ul><li>Buy milk</li></ul>';
    const r = checkFeaturePresence('Add task and Delete task', html);
    expect(r.present).toContain('Add / create');
    expect(r.missing).toContain('Delete / remove');
  });
});

describe('isUnrenderedSpaShell + honesty guard (deep-test build #2 — false "Present: none")', () => {
  // THE build #2 case: a Vite/React expense tracker rendered fine (Add form, category dropdown, filter,
  // list) but the preview CAPTURE returned the un-hydrated shell, so every feature probed as absent and
  // the report lied "4 features have NO visible control — Present: none" (it even became the rootCause).
  const SHELL = '<!doctype html><html><head><title>App</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';

  it('detects an un-rendered SPA shell (empty root, no controls, no text)', () => {
    expect(isUnrenderedSpaShell(SHELL)).toBe(true);
    expect(isUnrenderedSpaShell('<div id="app"></div>')).toBe(true);
  });

  it('a RENDERED app (real controls in the root) is NOT a shell', () => {
    const rendered = '<div id="root"><h1>Expense Tracker</h1><input placeholder="name"/><select><option>Food</option></select><button>Add</button><ul><li>bike</li></ul></div>';
    expect(isUnrenderedSpaShell(rendered)).toBe(false);
  });

  it('does NOT judge features off a shell — returns empty instead of a false "Present: none"', () => {
    const prompt = 'expense tracker: add an expense, filter by category, show the list';
    const r = checkFeaturePresence(prompt, SHELL);
    expect(r.probes).toHaveLength(0);   // nothing probed → nothing recorded
    expect(r.missing).toHaveLength(0);  // never a false "missing"
    expect(r.present).toHaveLength(0);
  });

  it('still correctly reports the SAME app when the RENDERED DOM is captured', () => {
    const prompt = 'expense tracker: add an expense, filter by category, show the list';
    const rendered = '<div id="root"><input placeholder="Expense name"/><input placeholder="0.00"/><select><option>All Categories</option></select><button>Add</button><button aria-label="delete">✕</button><ul><li>bike ₹100</li></ul></div>';
    const r = checkFeaturePresence(prompt, rendered);
    expect(r.present).toContain('Add / create');
    expect(r.present).toContain('List / items');
    expect(r.missing).toHaveLength(0);
  });
});

describe('capture-failure guard (deep-test build #4 — "Present: none" on an app that rendered)', () => {
  // Build #4: a 6-feature expense tracker rendered ("Preview verified — renders correctly") yet the
  // preview CAPTURE returned a pre-render/partial DOM that isUnrenderedSpaShell didn't classify as a bare
  // shell, so every feature probed absent and the report lied "Present: none" — and it became a warning
  // on a working app. An all-absent result is the capture-miss signature (a real gap is PARTIAL).
  const prompt = 'expense tracker: add an expense, delete it, edit it, filter by category, search by name, show the list';

  it('reports NOTHING when ≥2 features were probed and ZERO are present (capture miss, not a real gap)', () => {
    // A partial/pre-render capture with no matching controls at all.
    const partial = '<div id="root"><div class="loading">Loading…</div></div>';
    const r = checkFeaturePresence(prompt, partial);
    expect(r.present).toHaveLength(0);
    expect(r.missing).toHaveLength(0);  // never a wall of false "missing"
    expect(r.probes).toHaveLength(0);
  });

  it('STILL reports a genuine PARTIAL gap (some present, some missing) — the guard only suppresses all-absent', () => {
    // add + list render, but delete/edit/filter/search do not → a real, actionable finding must survive.
    const partial = '<div id="root"><input placeholder="Expense name"/><button>Add</button><ul><li>bike ₹100</li></ul></div>';
    const r = checkFeaturePresence(prompt, partial);
    expect(r.present).toContain('Add / create');
    expect(r.present).toContain('List / items');
    expect(r.missing).toContain('Delete / remove');
    expect(r.missing.length).toBeGreaterThan(0);
  });

  // THE report-1682cd03 case (widened guard): the Hinglish EDIT instruction "rest timer me 30s ka option
  // bhi add karo" — "add karo" = "please make this change", NOT "build an Add feature" — trips the lone
  // `add` probe. On a real FitPulse render the workout app shows no generic Add/create control, so the
  // single probe is absent → the OLD ≥2 guard let it through and it falsely reported "Present: none",
  // which even became the rootCause of a 95/100 PASSING build. A lone unproven signal must stay silent.
  it('stays SILENT on a single requested feature that is absent (no corroborating present probe)', () => {
    const rendered = '<div id="root"><h1>FitPulse</h1><button>30s Rest</button><button>60s Rest</button><div>Workout history</div></div>';
    const r = checkFeaturePresence('rest timer me 30s ka option bhi add karo', rendered);
    expect(r.missing).toHaveLength(0);   // never a false "Add / create — Present: none"
    expect(r.present).toHaveLength(0);
    expect(featurePresenceSummary(r)).toBe('');  // nothing surfaced to the report
  });
});

describe('checkFeaturePresence — the full TaskLite app', () => {
  const goodHtml = [
    '<h1>TaskLite</h1>',
    '<input placeholder="What needs to be done?"/><button>Add</button>',
    '<div><button>All</button><button>Active</button><button>Completed</button></div>',
    '<ul><li><input type="checkbox"/>Buy milk<button aria-label="Delete task">×</button></li></ul>',
    '<footer>Total 1 Completed 0 Remaining 1</footer>',
  ].join('');

  it('marks all TaskLite features present in a correct build', () => {
    const r = checkFeaturePresence(TASKLITE, goodHtml);
    expect(r.missing).toHaveLength(0);
    for (const f of ['add', 'delete', 'complete', 'filter', 'list']) {
      expect(r.probes.find((p) => p.feature === f)?.present).toBe(true);
    }
  });

  it('flags filter + delete missing when the build shipped only add + a bare list', () => {
    const bareHtml = '<h1>TaskLite</h1><input placeholder="Add"/><button>Add</button><ul><li>Buy milk</li></ul>';
    const r = checkFeaturePresence(TASKLITE, bareHtml);
    expect(r.missing).toContain('Delete / remove');
    expect(r.missing).toContain('Filter');
    expect(r.present).toContain('Add / create');
    expect(r.present).toContain('List / items');
  });
});

describe('checkFeaturePresence — robustness + empty-state', () => {
  it('an honest empty-state counts the list surface as present', () => {
    const r = checkFeaturePresence('a todo list', '<div>No tasks here — add your first task above.</div>');
    expect(r.probes.find((p) => p.feature === 'list')?.present).toBe(true);
  });
  it('returns empty for blank html or non-string input', () => {
    expect(checkFeaturePresence('add a task', '').probes).toHaveLength(0);
    // @ts-expect-error — defensive against a non-string html at runtime
    expect(checkFeaturePresence('add a task', null).probes).toHaveLength(0);
  });
  it('never throws on malformed html', () => {
    const r = checkFeaturePresence('add, delete, filter', '<input <<< <button');
    expect(Array.isArray(r.probes)).toBe(true);
  });

  // Deep-test App #1: an explicitly-DECLINED feature must never be probed (else it false-flags missing).
  it('does NOT probe a feature the user explicitly declined ("No settings")', () => {
    const r = checkFeaturePresence('Build a clock. No settings, no other features — just add a display.', '<div>12:00</div>');
    expect(r.probes.find((p) => p.feature === 'edit' || p.label.includes('Settings'))).toBeUndefined();
    // "add" is negated too here ("no other features … just add a display" — the add mention is affirmative),
    // but the declined-feature guard must at minimum keep declined features out of the missing list.
    expect(r.missing.join(' ')).not.toMatch(/settings/i);
  });
});

describe('summary + repair prompt', () => {
  it('summary names the missing features', () => {
    const r = checkFeaturePresence('add and delete tasks', '<input/><button>Add</button>');
    const s = featurePresenceSummary(r);
    expect(s).toMatch(/Feature coverage/);
    expect(s).toMatch(/Delete/);
  });
  it('summary is empty when nothing was probed', () => {
    expect(featurePresenceSummary(checkFeaturePresence('a clock', '<div>1:00</div>'))).toBe('');
  });
  it('repair prompt lists the missing features, empty when all present', () => {
    const missing = checkFeaturePresence('add and delete tasks', '<input/><button>Add</button>');
    expect(featurePresenceRepairPrompt(missing)).toMatch(/Delete/);
    // "add support" requests only the add feature (no list/delete keywords) → all present, no repair.
    const allPresent = checkFeaturePresence('add support', '<input/><button>Add</button>');
    expect(allPresent.missing).toHaveLength(0);
    expect(featurePresenceRepairPrompt(allPresent)).toBe('');
  });
});

describe('featureHealEnabled — Phase 1b opt-in flag', () => {
  const prev = process.env.AGENTV3_FEATURE_HEAL;
  afterEach(() => {
    if (prev === undefined) delete process.env.AGENTV3_FEATURE_HEAL;
    else process.env.AGENTV3_FEATURE_HEAL = prev;
  });

  it('is OFF by default (unset) — advisory only, no extra repair pass', () => {
    delete process.env.AGENTV3_FEATURE_HEAL;
    expect(featureHealEnabled()).toBe(false);
  });
  it('is ON for any explicit yes', () => {
    // CONTRACT CHANGED DELIBERATELY (audit finding #1, 2026-08-09): the old strictness was the
    // DEFECT, not a safeguard — rejecting `true`/`1` bought no safety (an admin typing them plainly
    // means ON) while `on` vs `true` silently disagreed across the codebase. One shared parser now
    // accepts every spelling of yes/no; an opt-in still requires an EXPLICIT yes, which is the part
    // that actually mattered.
    for (const v of ['on', 'true', '1', 'yes', 'ON']) {
      process.env.AGENTV3_FEATURE_HEAL = v;
      expect(featureHealEnabled(), v).toBe(true);
    }
  });
  it("stays OFF for an explicit no, an empty value, or a typo", () => {
    for (const v of ['off', 'false', '0', '', 'ture']) {
      process.env.AGENTV3_FEATURE_HEAL = v;
      expect(featureHealEnabled(), v).toBe(false);
    }
  });
});
