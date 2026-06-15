import { describe, it, expect, vi, afterEach } from 'vitest';
import { audit } from '../src/server/lib/audit';

afterEach(() => vi.restoreAllMocks());

describe('audit()', () => {
  it('logs a structured entry with event, timestamp and meta', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    audit('TEST_EVENT', { userId: 'u1' });
    expect(spy).toHaveBeenCalledOnce();
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain('[AUDIT]');
    const json = JSON.parse(logged.replace('[AUDIT] ', ''));
    expect(json.event).toBe('TEST_EVENT');
    expect(json.userId).toBe('u1');
    expect(typeof json.ts).toBe('string');
  });

  it('works with no meta', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    audit('NO_META');
    const json = JSON.parse((spy.mock.calls[0][0] as string).replace('[AUDIT] ', ''));
    expect(json.event).toBe('NO_META');
  });
});
