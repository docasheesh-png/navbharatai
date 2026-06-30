import { describe, it, expect } from 'vitest';
import {
  extractPromotableLessons,
  mergeLessonsIntoBrain,
  formatBrainLessons,
  emptyBrain,
  MIN_BUILDS_FOR_BRAIN,
  type UserBrain,
  type IncomingLesson,
} from './UserLessonBrain';
import type { Episode } from './WorkspaceMemory';

const ep = (kind: Episode['kind'], text: string, ts = 1): Episode => ({ kind, text, ts });
const inc = (text: string, kind: IncomingLesson['kind'] = 'note', ts = 1): IncomingLesson => ({ text, kind, ts });

describe('extractPromotableLessons', () => {
  it('keeps only proven fixes and reflection notes (drops error/request/audit/PLAN_STATE)', () => {
    const episodes: Episode[] = [
      ep('request', 'build a todo app'),
      ep('error', 'TypeError: x is undefined'),
      ep('audit', 'risky action taken'),
      ep('note', 'PLAN_STATE\n[x] done'),                     // internal bookkeeping → dropped
      ep('note', '[reflection] prefer named exports'),
      ep('fix', 'declared tailwindcss in package.json and it built'),
    ];
    const out = extractPromotableLessons(episodes);
    const texts = out.map((l) => l.text);
    expect(texts).toContain('[reflection] prefer named exports');
    expect(texts.some((t) => /declared tailwindcss/.test(t))).toBe(true);
    expect(texts.some((t) => /TypeError/.test(t))).toBe(false);
    expect(texts.some((t) => /PLAN_STATE/.test(t))).toBe(false);
    expect(texts.some((t) => /build a todo app/.test(t))).toBe(false);
  });

  it('returns [] for non-arrays / empty', () => {
    expect(extractPromotableLessons([])).toEqual([]);
    expect(extractPromotableLessons(undefined as any)).toEqual([]);
  });
});

describe('mergeLessonsIntoBrain', () => {
  it('adds new lessons (reinforced=1) and advances totalBuilds', () => {
    const brain = mergeLessonsIntoBrain(emptyBrain(), [inc('use react-router-dom v6 API', 'note')], '2026-06-30T00:00:00Z');
    expect(brain.totalBuilds).toBe(1);
    expect(brain.lessons).toHaveLength(1);
    expect(brain.lessons[0].reinforced).toBe(1);
  });

  it('REINFORCES a repeated lesson across builds (carries the count forward)', () => {
    let brain: UserBrain = emptyBrain();
    brain = mergeLessonsIntoBrain(brain, [inc('always declare tailwindcss in package.json', 'note', 1)], '2026-06-30T00:00:00Z');
    brain = mergeLessonsIntoBrain(brain, [inc('always declare tailwindcss in package.json', 'note', 2)], '2026-06-30T00:01:00Z');
    brain = mergeLessonsIntoBrain(brain, [inc('always declare tailwindcss in package.json', 'note', 3)], '2026-06-30T00:02:00Z');
    expect(brain.lessons).toHaveLength(1);
    expect(brain.lessons[0].reinforced).toBe(3); // confirmed 3 times — counts persisted, not reset
    expect(brain.totalBuilds).toBe(3);
  });

  it('a proven `fix` upgrades a `note` of the same claim', () => {
    let brain: UserBrain = mergeLessonsIntoBrain(emptyBrain(), [inc('guard the array before mapping', 'note', 1)], 'x');
    brain = mergeLessonsIntoBrain(brain, [inc('guard the array before mapping', 'fix', 2)], 'y');
    expect(brain.lessons).toHaveLength(1);
    expect(brain.lessons[0].kind).toBe('fix'); // upgraded from note → fix
  });

  it('a contradiction lets the NEWER advice win', () => {
    let brain: UserBrain = mergeLessonsIntoBrain(emptyBrain(), [inc('use local component state for the form', 'note', 1000)], 'x');
    brain = mergeLessonsIntoBrain(brain, [inc('do not use local component state for the form', 'note', 5000)], 'y');
    expect(brain.lessons).toHaveLength(1);
    expect(brain.lessons[0].text).toMatch(/do not use local component state/i);
  });

  it('caps the stored set (never grows unbounded)', () => {
    let brain: UserBrain = emptyBrain();
    for (let i = 0; i < 120; i++) {
      brain = mergeLessonsIntoBrain(brain, [inc(`distinct lesson number ${i}`, 'note', i + 1)], 'x');
    }
    expect(brain.lessons.length).toBeLessThanOrEqual(60);
  });

  it('tolerates a null/garbage prior brain', () => {
    const brain = mergeLessonsIntoBrain(null, [inc('a real lesson', 'fix', 1)], '2026-06-30T00:00:00Z');
    expect(brain.lessons).toHaveLength(1);
    expect(brain.totalBuilds).toBe(1);
  });
});

describe('formatBrainLessons', () => {
  it('returns "" until there is enough cross-project history', () => {
    const oneBuild = mergeLessonsIntoBrain(emptyBrain(), [inc('a lesson', 'fix', 1)], 'x');
    expect(oneBuild.totalBuilds).toBeLessThan(MIN_BUILDS_FOR_BRAIN);
    expect(formatBrainLessons(oneBuild)).toBe('');
    expect(formatBrainLessons(null)).toBe('');
    expect(formatBrainLessons(emptyBrain())).toBe('');
  });

  it('renders a header + the top lessons once there is history, with fixes ranked above notes', () => {
    let brain: UserBrain = emptyBrain();
    brain = mergeLessonsIntoBrain(brain, [inc('reflection lesson about routing', 'note', 1)], 'x');
    brain = mergeLessonsIntoBrain(brain, [inc('proven fix for the build error', 'fix', 2)], 'y');
    const out = formatBrainLessons(brain);
    expect(out).toContain('YOUR PAST PROJECTS');
    expect(out).toContain('proven fix for the build error');
    expect(out).toContain('reflection lesson about routing');
    // The proven fix (higher confidence) is listed before the note.
    expect(out.indexOf('proven fix')).toBeLessThan(out.indexOf('reflection lesson'));
  });

  it('stays within the block length cap', () => {
    let brain: UserBrain = emptyBrain();
    for (let i = 0; i < 10; i++) {
      brain = mergeLessonsIntoBrain(brain, [inc(`${'x'.repeat(300)}-${i}`, 'note', i + 1)], 'z');
    }
    const out = formatBrainLessons(brain);
    expect(out.length).toBeLessThanOrEqual(1200);
  });
});
