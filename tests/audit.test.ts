import { describe, it, expect, vi, afterEach } from 'vitest';
import { audit } from '../src/server/lib/audit';

afterEach(() => vi.restoreAllMocks());

describe('audit()', () => {
  it('logs a structured entry with event, timestamp and meta', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    audit('TEST_EVENT', { userId: 'u1' });
    // Two lines: human-readable [AUDIT] + the P-SEC.7 structured SIEM mirror.
    expect(spy).toHaveBeenCalledTimes(2);
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toContain('[AUDIT]');
    const json = JSON.parse(logged.replace('[AUDIT] ', ''));
    expect(json.event).toBe('TEST_EVENT');
    expect(json.userId).toBe('u1');
    expect(typeof json.ts).toBe('string');
  });

  it('P-SEC.7: emits a pure-JSON structured SIEM line with severity + component', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    audit('LOGIN_FAILED', { userId: 'u1' });
    // Second line must be pure JSON (no prefix) so Cloud Logging parses jsonPayload.
    const structured = JSON.parse(spy.mock.calls[1][0] as string);
    expect(structured.component).toBe('nbai-audit');
    expect(structured.event).toBe('LOGIN_FAILED');
    expect(structured.severity).toBe('WARNING'); // inferred from "FAILED"
    expect(structured.userId).toBe('u1');
  });

  it('P-SEC.7: infers INFO severity for neutral events, honours explicit level', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    audit('PROJECT_OPENED', {});
    expect(JSON.parse(spy.mock.calls[1][0] as string).severity).toBe('INFO');
    spy.mockClear();
    audit('PROJECT_OPENED', {}, 'error');
    expect(JSON.parse(spy.mock.calls[1][0] as string).severity).toBe('ERROR');
  });

  it('works with no meta', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    audit('NO_META');
    const json = JSON.parse((spy.mock.calls[0][0] as string).replace('[AUDIT] ', ''));
    expect(json.event).toBe('NO_META');
  });
});
