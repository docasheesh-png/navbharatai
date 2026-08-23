import { describe, it, expect, vi } from 'vitest';
import {
  resolveEmailConfig, sendAlertEmail, alertSubject, DEFAULT_EMAIL_ENDPOINT,
} from './alertEmail';

const admins = ['admin@example.com'];

describe('resolveEmailConfig — every missing piece names ITSELF', () => {
  it('is not configured with no key, and says which key', () => {
    const cfg = resolveEmailConfig({} as any, admins);
    expect(cfg.configured).toBe(false);
    expect(cfg.reason).toContain('ALERT_EMAIL_API_KEY');
  });

  it('is not configured with a key but no sender — the case that would fail on EVERY send', () => {
    // A provider rejects a send from an unverified address, so without this check the key would look
    // configured and every send would fail: the worst of both states.
    const cfg = resolveEmailConfig({ ALERT_EMAIL_API_KEY: 'k' } as any, admins);
    expect(cfg.configured).toBe(false);
    expect(cfg.reason).toContain('ALERT_EMAIL_FROM');
  });

  it('is not configured with no recipient at all', () => {
    const cfg = resolveEmailConfig({ ALERT_EMAIL_API_KEY: 'k', ALERT_EMAIL_FROM: 'a@b.com' } as any, []);
    expect(cfg.configured).toBe(false);
    expect(cfg.reason).toContain('ALERT_EMAIL_TO');
  });

  it('is configured once key + sender exist, defaulting recipients to the admins', () => {
    const cfg = resolveEmailConfig({ ALERT_EMAIL_API_KEY: 'k', ALERT_EMAIL_FROM: 'a@b.com' } as any, admins);
    expect(cfg.configured).toBe(true);
    expect(cfg.reason).toBe('');
    expect(cfg.to).toEqual(admins);
    expect(cfg.endpoint).toBe(DEFAULT_EMAIL_ENDPOINT);
  });

  it('an explicit recipient list overrides the admins', () => {
    const cfg = resolveEmailConfig({
      ALERT_EMAIL_API_KEY: 'k', ALERT_EMAIL_FROM: 'a@b.com', ALERT_EMAIL_TO: 'x@y.com, z@y.com',
    } as any, admins);
    expect(cfg.to).toEqual(['x@y.com', 'z@y.com']);
  });

  it('accepts the provider-native key name too', () => {
    const cfg = resolveEmailConfig({ RESEND_API_KEY: 'k', ALERT_EMAIL_FROM: 'a@b.com' } as any, admins);
    expect(cfg.configured).toBe(true);
  });

  it('treats whitespace as unset rather than as a value', () => {
    const cfg = resolveEmailConfig({ ALERT_EMAIL_API_KEY: '   ', ALERT_EMAIL_FROM: 'a@b.com' } as any, admins);
    expect(cfg.configured).toBe(false);
  });
});

describe('alertSubject — readable on a lock screen', () => {
  it('leads with the severity word, not our banner', () => {
    expect(alertSubject('🔴 NavBharatAI Monitor — Build failure rate is 25%')).toBe('[NavBharatAI] ALERT: Build failure rate is 25%');
    expect(alertSubject('🟡 NavBharatAI Monitor — VM spend is 4× the previous window')).toContain('Warning:');
    expect(alertSubject('🟢 NavBharatAI Monitor — resolved: High error rate is back to normal')).toContain('Resolved:');
  });

  it('drops the measurement clause and truncates a long condition', () => {
    const s = alertSubject('🔴 NavBharatAI Monitor — something broke (measured over the last hour). Open Admin.');
    expect(s).not.toContain('measured over');
    expect(alertSubject(`🔴 ${'x'.repeat(300)}`).length).toBeLessThan(120);
  });
});

describe('sendAlertEmail — never claim a send that did not happen', () => {
  const cfg = resolveEmailConfig({ ALERT_EMAIL_API_KEY: 'k', ALERT_EMAIL_FROM: 'a@b.com' } as any, admins);

  it('reports NOT sent, with the reason, when email is unconfigured', async () => {
    const unconfigured = resolveEmailConfig({} as any, admins);
    const res = await sendAlertEmail(unconfigured, 'anything');
    expect(res.sent).toBe(false);
    expect(res.error).toContain('ALERT_EMAIL_API_KEY');
  });

  it('posts the alert and reports sent on success', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as any;
    const res = await sendAlertEmail(cfg, '🔴 NavBharatAI Monitor — builds are failing', { fetchImpl });
    expect(res.sent).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(DEFAULT_EMAIL_ENDPOINT);
    expect(init.headers.Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body);
    expect(body.from).toBe('a@b.com');
    expect(body.to).toEqual(admins);
    expect(body.subject).toContain('ALERT');
    expect(body.text).toContain('builds are failing');
  });

  it('surfaces the provider status, because 401 and 403 mean different fixes', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad key', { status: 401 })) as any;
    const res = await sendAlertEmail(cfg, 'msg', { fetchImpl });
    expect(res.sent).toBe(false);
    expect(res.error).toContain('401');
    expect(res.error).toContain('bad key');
  });

  it('reports a timeout honestly instead of hanging the sweep', async () => {
    const fetchImpl = vi.fn((_u: any, init: any) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => {
        const e: any = new Error('aborted');
        e.name = 'AbortError';
        rej(e);
      });
    })) as any;
    const res = await sendAlertEmail(cfg, 'msg', { fetchImpl, timeoutMs: 1_000 });
    expect(res.sent).toBe(false);
    expect(res.error).toContain('timed out');
  });

  it('never throws, whatever the transport does', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network down'); }) as any;
    const res = await sendAlertEmail(cfg, 'msg', { fetchImpl });
    expect(res.sent).toBe(false);
    expect(res.error).toContain('network down');
  });

  it('does not leak the API key into the reported error', async () => {
    const fetchImpl = vi.fn(async () => new Response('denied', { status: 403 })) as any;
    const res = await sendAlertEmail(cfg, 'msg', { fetchImpl });
    expect(res.error).not.toContain('Bearer');
    expect(res.error).not.toContain(cfg.apiKey);
  });
});
