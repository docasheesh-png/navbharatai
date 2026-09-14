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

import { persistedAuditEntry } from '../src/server/lib/audit';

describe('persistedAuditEntry — the durable log says what the Cloud Logging line says (admin Monitor capture, 2026-09-14)', () => {
  // The panel showed nine DIAGNOSTICS_READ_FAILED rows as INFO with an empty message. The mirror one
  // statement above had computed WARNING and the failure text was sitting in meta.error the whole time.
  it('a *_FAILED event persists as warn, not info — the SAME severity the SIEM mirror emits', () => {
    expect(persistedAuditEntry('DIAGNOSTICS_READ_FAILED', { kind: 'history', error: 'boom' }).level).toBe('warn');
    expect(persistedAuditEntry('BLOCKED_SCAN', { ip: '1.2.3.4', path: '/.env' }).level).toBe('warn');
  });

  it('a critical-class event persists as error', () => {
    expect(persistedAuditEntry('SECRET_LEAK_DETECTED', {}).level).toBe('error');
  });

  it('an explicit level wins over the inferred one, both ways', () => {
    expect(persistedAuditEntry('DIAGNOSTICS_READ_FAILED', {}, 'info').level).toBe('info');
    expect(persistedAuditEntry('SOMETHING_ROUTINE', {}, 'error').level).toBe('error');
  });

  it('derives a message from the meta field that says what happened, so the row is never "EVENT — "', () => {
    expect(persistedAuditEntry('DIAGNOSTICS_READ_FAILED', { kind: 'history', key: 'ws1', error: 'permission denied' }).message)
      .toBe('error: permission denied');
    expect(persistedAuditEntry('BLOCKED_SCAN', { ip: '1.2.3.4', path: '/wp-admin' }).message).toBe('path: /wp-admin');
  });

  it('an explicit message is used verbatim and beats every derived one', () => {
    expect(persistedAuditEntry('X', { message: 'hand-written', error: 'ignored' }).message).toBe('hand-written');
  });

  it('a plain event with nothing to say has no message — never an invented one', () => {
    expect(persistedAuditEntry('AGENTV3_FREE_TIER_CHEAP_BUILD', { userId: 'u1' }, 'info').message).toBeUndefined();
  });

  it('caps a derived message so a stack trace cannot become the log line', () => {
    const m = persistedAuditEntry('X_FAILED', { error: 'e'.repeat(2000) }).message ?? '';
    expect(m.length).toBeLessThanOrEqual('error: '.length + 300);
  });

  it('routes traceId / workspaceId / sessionId to their columns and keeps the rest as meta', () => {
    const e = persistedAuditEntry('X', { traceId: 't', sessionId: 's', foo: 1 });
    expect(e.traceId).toBe('t');
    expect(e.workspaceId).toBe('s');
    expect(e.meta).toEqual({ foo: 1 });
  });
});
