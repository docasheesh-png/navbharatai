import { describe, it, expect } from 'vitest';
import { shouldConfirm } from '../src/server/Guider/GuiderGate';

describe('shouldConfirm', () => {
  it('returns false for empty prompt', () => {
    expect(shouldConfirm({ prompt: '', hasExistingFiles: false })).toBe(false);
  });

  it('returns true for fresh build (no existing files)', () => {
    expect(shouldConfirm({ prompt: 'build a todo app', hasExistingFiles: false })).toBe(true);
  });

  it('returns false for short edit on existing app', () => {
    expect(shouldConfirm({ prompt: 'change button color to blue', hasExistingFiles: true, isEdit: true })).toBe(false);
  });

  it('returns true when prompt contains rebuild keyword', () => {
    expect(shouldConfirm({ prompt: 'rebuild the app from scratch', hasExistingFiles: true })).toBe(true);
  });

  it('returns true when prompt contains dashboard keyword', () => {
    expect(shouldConfirm({ prompt: 'add a dashboard to the app', hasExistingFiles: true })).toBe(true);
  });

  it('returns true when prompt is long on existing app (>40 words)', () => {
    const longPrompt = Array(42).fill('word').join(' ');
    expect(shouldConfirm({ prompt: longPrompt, hasExistingFiles: true })).toBe(true);
  });

  it('returns true when edit prompt is over 60 words', () => {
    const words = Array(65).fill('word').join(' ');
    expect(shouldConfirm({ prompt: words, hasExistingFiles: true, isEdit: true })).toBe(true);
  });
});
