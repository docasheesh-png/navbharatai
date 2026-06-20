import { describe, it, expect } from 'vitest';
import { shouldConfirm } from '../src/server/Guider/GuiderGate';

describe('GuiderGate.shouldConfirm (Hybrid — confirm only when it matters)', () => {
  it('confirms a fresh build (empty workspace)', () => {
    expect(shouldConfirm({ prompt: 'make a todo app', hasExistingFiles: false })).toBe(true);
  });

  it('does NOT confirm a small edit on an existing app', () => {
    expect(shouldConfirm({ prompt: 'make the button red', hasExistingFiles: true, isEdit: true })).toBe(false);
    expect(shouldConfirm({ prompt: 'change the heading text', hasExistingFiles: true, isEdit: true })).toBe(false);
  });

  it('confirms a big/rebuild request even on an existing app', () => {
    expect(shouldConfirm({ prompt: 'rebuild the whole app from scratch', hasExistingFiles: true, isEdit: true })).toBe(true);
    expect(shouldConfirm({ prompt: 'add a dashboard with auth and a database backend', hasExistingFiles: true, isEdit: true })).toBe(true);
  });

  it('confirms a very long, multi-feature edit request', () => {
    const long = Array.from({ length: 65 }, (_, i) => `feature${i}`).join(' ');
    expect(shouldConfirm({ prompt: long, hasExistingFiles: true, isEdit: true })).toBe(true);
  });

  it('returns false for an empty prompt', () => {
    expect(shouldConfirm({ prompt: '   ', hasExistingFiles: false })).toBe(false);
  });

  it('confirms a substantial non-edit request on existing files', () => {
    const big = 'create multiple pages with navigation and a settings screen and a profile page and analytics charts and export options and a lot more content here to cross the threshold easily indeed';
    expect(shouldConfirm({ prompt: big, hasExistingFiles: true, isEdit: false })).toBe(true);
  });
});
