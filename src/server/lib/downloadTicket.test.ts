import { describe, it, expect } from 'vitest';
import {
  downloadSignInRequired, signDownloadTicket, verifyDownloadTicket, downloadTicketQuery,
  ticketRefusalMessage, DOWNLOAD_TICKET_TTL_MS,
} from './downloadTicket';

const SECRET = 'test-secret-key';
const now = 1_700_000_000_000;
const exp = now + DOWNLOAD_TICKET_TTL_MS;

describe('downloadSignInRequired', () => {
  it('is ON by default — this is the admin’s instruction', () => {
    expect(downloadSignInRequired({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('`off` hands anonymous downloads back without a deploy', () => {
    expect(downloadSignInRequired({ NAV_STORE_DOWNLOAD_SIGNIN: 'off' } as never)).toBe(false);
    expect(downloadSignInRequired({ NAV_STORE_DOWNLOAD_SIGNIN: ' OFF ' } as never)).toBe(false);
  });

  it('any other value leaves it on — a typo must not silently unlock the door', () => {
    expect(downloadSignInRequired({ NAV_STORE_DOWNLOAD_SIGNIN: 'no' } as never)).toBe(true);
    expect(downloadSignInRequired({ NAV_STORE_DOWNLOAD_SIGNIN: '0' } as never)).toBe(true);
    expect(downloadSignInRequired({ NAV_STORE_DOWNLOAD_SIGNIN: '' } as never)).toBe(true);
  });
});

describe('a ticket the browser can carry in a URL', () => {
  it('a freshly minted ticket verifies', () => {
    const sig = signDownloadTicket('app-1', 'u1', exp, SECRET);
    expect(verifyDownloadTicket('app-1', { u: 'u1', e: exp, t: sig }, SECRET, now)).toBe('ok');
  });

  it('🔒 cannot be re-pointed at a DIFFERENT app — the app id is inside the signature', () => {
    const sig = signDownloadTicket('app-1', 'u1', exp, SECRET);
    expect(verifyDownloadTicket('app-2', { u: 'u1', e: exp, t: sig }, SECRET, now)).toBe('bad');
  });

  it('🔒 cannot be re-pointed at a DIFFERENT account — the uid is inside it too', () => {
    const sig = signDownloadTicket('app-1', 'u1', exp, SECRET);
    expect(verifyDownloadTicket('app-1', { u: 'u2', e: exp, t: sig }, SECRET, now)).toBe('bad');
  });

  it('🔒 cannot be stretched past its expiry by editing the URL', () => {
    const sig = signDownloadTicket('app-1', 'u1', exp, SECRET);
    expect(verifyDownloadTicket('app-1', { u: 'u1', e: exp + 60_000, t: sig }, SECRET, now)).toBe('bad');
  });

  it('🔒 a ticket signed with another secret is refused', () => {
    const sig = signDownloadTicket('app-1', 'u1', exp, 'someone-elses-secret');
    expect(verifyDownloadTicket('app-1', { u: 'u1', e: exp, t: sig }, SECRET, now)).toBe('bad');
  });

  it('expires, and says so — "press Download again" is actionable where "not allowed" is not', () => {
    const sig = signDownloadTicket('app-1', 'u1', exp, SECRET);
    expect(verifyDownloadTicket('app-1', { u: 'u1', e: exp, t: sig }, SECRET, exp + 1)).toBe('expired');
    expect(ticketRefusalMessage('expired').toLowerCase()).toContain('again');
  });

  it('no ticket at all is `missing`, which is the "please sign in" case — not an error', () => {
    expect(verifyDownloadTicket('app-1', {}, SECRET, now)).toBe('missing');
    expect(ticketRefusalMessage('missing').toLowerCase()).toContain('sign in');
  });

  it('half a ticket is `bad`, never a crash', () => {
    const sig = signDownloadTicket('app-1', 'u1', exp, SECRET);
    expect(verifyDownloadTicket('app-1', { u: 'u1', t: sig }, SECRET, now)).toBe('bad');
    expect(verifyDownloadTicket('app-1', { e: exp, t: sig }, SECRET, now)).toBe('bad');
    expect(verifyDownloadTicket('app-1', { u: 'u1', e: 'soon', t: sig }, SECRET, now)).toBe('bad');
    expect(verifyDownloadTicket('app-1', { u: 'u1', e: exp, t: 'x' }, SECRET, now)).toBe('bad');
    expect(verifyDownloadTicket('app-1', { u: {}, e: [], t: null }, SECRET, now)).toBe('bad');
  });

  it('the query string is built in ONE place, so the route and the client cannot drift', () => {
    const q = downloadTicketQuery('u 1', exp, 'sig');
    expect(q).toContain('u=u%201');
    expect(q).toContain(`e=${exp}`);
    expect(q).toContain('t=sig');
  });

  it('lives minutes, not hours — it travels in a URL, which lands in history', () => {
    expect(DOWNLOAD_TICKET_TTL_MS).toBeLessThanOrEqual(30 * 60 * 1000);
    expect(DOWNLOAD_TICKET_TTL_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });
});
