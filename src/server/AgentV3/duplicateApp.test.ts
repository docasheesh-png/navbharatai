import { describe, it, expect } from 'vitest';
import { copyName, copyStatus } from './duplicateApp';

describe('copyName — never a name the user already has', () => {
  it('appends (copy), then numbers', () => {
    expect(copyName('Shop', [])).toBe('Shop (copy)');
    expect(copyName('Shop', ['Shop (copy)'])).toBe('Shop (copy 2)');
    expect(copyName('Shop', ['Shop (copy)', 'shop (COPY 2)'])).toBe('Shop (copy 3)');
  });

  it('copying a copy does not stack suffixes', () => {
    expect(copyName('Shop (copy)', ['Shop (copy)'])).toBe('Shop (copy 2)');
    expect(copyName('Shop (copy 4)', [])).toBe('Shop (copy)');
  });

  it('tolerates an empty or odd base', () => {
    expect(copyName('', [])).toBe('My app (copy)');
    expect(copyName('   ', [])).toBe('My app (copy)');
    expect(copyName(undefined as unknown as string, [])).toBe('My app (copy)');
  });
});

describe('copyStatus — a copy never claims a build in progress', () => {
  it('turns running into done and keeps every other state', () => {
    // The store's statuses are running | complete | stopped | error — a copy is never "running".
    expect(copyStatus('running')).toBe('complete');
    expect(copyStatus(undefined)).toBe('complete');
    expect(copyStatus('complete')).toBe('complete');
    expect(copyStatus('stopped')).toBe('stopped');
    expect(copyStatus('error')).toBe('error');
  });
});
