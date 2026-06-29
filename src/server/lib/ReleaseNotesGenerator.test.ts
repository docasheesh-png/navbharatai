import { describe, it, expect } from 'vitest';
import { diffBlueprints, generateReleaseNote } from './ReleaseNotesGenerator';

describe('ReleaseNotesGenerator (P-PME.2)', () => {
  describe('diffBlueprints', () => {
    it('classifies added / removed / kept (case-insensitive, deduped)', () => {
      const d = diffBlueprints(
        { features: ['Login', 'Dashboard', 'Dark mode', 'login'] },
        { features: ['Login', 'Dashboard', 'Old export'] },
      );
      expect(d.added).toEqual(['Dark mode']);
      expect(d.removed).toEqual(['Old export']);
      expect(d.kept.sort()).toEqual(['Dashboard', 'Login']);
    });
    it('treats a missing previous as a first release (everything added)', () => {
      const d = diffBlueprints({ features: ['A', 'B'] }, null);
      expect(d.added).toEqual(['A', 'B']);
      expect(d.removed).toEqual([]);
    });
    it('ignores blank/whitespace feature entries', () => {
      const d = diffBlueprints({ features: ['A', '  ', ''] }, { features: ['A'] });
      expect(d.added).toEqual([]);
      expect(d.kept).toEqual(['A']);
    });
  });

  describe('generateReleaseNote', () => {
    it('produces a structured note + markdown for a normal release', () => {
      const note = generateReleaseNote(
        { name: 'TodoApp', features: ['Login', 'Tasks', 'Reminders'], techStack: ['React', 'Firebase'] },
        { features: ['Login', 'Tasks'] },
        { version: 'v2.1.0', date: '2026-06-29' },
      );
      expect(note.appName).toBe('TodoApp');
      expect(note.version).toBe('v2.1.0');
      expect(note.added).toEqual(['Reminders']);
      expect(note.removed).toEqual([]);
      expect(note.keptCount).toBe(2);
      expect(note.noChanges).toBe(false);
      expect(note.markdown).toContain('# TodoApp — v2.1.0');
      expect(note.markdown).toContain('## ✨ New');
      expect(note.markdown).toContain('- Reminders');
      expect(note.markdown).toContain('React · Firebase');
    });

    it('marks a first release and defaults the version', () => {
      const note = generateReleaseNote({ name: 'Fresh', features: ['A', 'B'] }, null, { date: '2026-06-29' });
      expect(note.version).toBe('v1.0.0');
      expect(note.summary).toContain('Initial release');
      expect(note.added).toEqual(['A', 'B']);
    });

    it('HONESTY: an identical blueprint yields an honest "no changes" note, not fake highlights', () => {
      const bp = { name: 'Same', features: ['X', 'Y'] };
      const note = generateReleaseNote(bp, { features: ['Y', 'X'] }, { version: 'v1.0.2', date: '2026-06-29' });
      expect(note.noChanges).toBe(true);
      expect(note.added).toEqual([]);
      expect(note.removed).toEqual([]);
      expect(note.summary).toContain('No user-visible feature changes');
      expect(note.markdown).not.toContain('## ✨ New');
    });

    it('lists removed features in their own section', () => {
      const note = generateReleaseNote(
        { name: 'App', features: ['Keep'] },
        { features: ['Keep', 'Gone'] },
        { version: 'v3', date: '2026-06-29' },
      );
      expect(note.removed).toEqual(['Gone']);
      expect(note.markdown).toContain('## 🗑️ Removed');
      expect(note.markdown).toContain('- Gone');
    });

    it('never reads the clock — date is "unreleased" when not supplied', () => {
      const note = generateReleaseNote({ name: 'A', features: ['x'] }, null);
      expect(note.date).toBe('unreleased');
    });
  });
});
