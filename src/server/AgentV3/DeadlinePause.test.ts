import { describe, it, expect } from 'vitest';
import { deadlinePauseMessage } from './DeadlinePause';

describe('deadlinePauseMessage (RC-4: honest deadline-pause wording)', () => {
  it('NEVER claims the build was "almost done" (the old dishonest wording is gone)', () => {
    for (const n of [0, 1, 5, 1650]) {
      const m = deadlinePauseMessage(n);
      expect(m.narration.toLowerCase()).not.toContain('almost done');
      expect(m.summary.toLowerCase()).not.toContain('almost done');
    }
  });

  it('states the REAL files-saved progress when work was done', () => {
    const m = deadlinePauseMessage(12);
    expect(m.narration).toContain('12 files');
    expect(m.summary).toContain('12 files');
    expect(m.narration).toContain('Continuing automatically');
  });

  it('singular "file" for exactly one', () => {
    const m = deadlinePauseMessage(1);
    expect(m.narration).toContain('1 file ');
    expect(m.narration).not.toContain('1 files');
  });

  it('is honest when NOTHING was written (no fake progress)', () => {
    const m = deadlinePauseMessage(0);
    expect(m.narration).toContain('before any files were written');
    expect(m.narration).toContain('nothing was lost');
    expect(m.summary).toContain('continuing automatically');
  });

  it('guards garbage input (negative / NaN / Infinity) → treated as zero progress', () => {
    for (const bad of [-3, NaN, Infinity]) {
      const m = deadlinePauseMessage(bad);
      expect(m.narration).toContain('before any files were written');
    }
  });
});
