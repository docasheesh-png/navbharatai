import { describe, it, expect } from 'vitest';
import { checkFeaturePresence, featurePresenceSummary, featurePresenceRepairPrompt } from './FeaturePresence';

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
