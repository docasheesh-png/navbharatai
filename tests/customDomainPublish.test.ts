import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  publishToCustomDomainSite,
  customDomainPublishNote,
  domainLookupFailedNote,
  isRetryableDomainPublishError,
} from '../src/server/AgentV3/customDomainPublish';

/**
 * "YEH THEEK SE DEPLOY HO HI NAHI RAHA HAI" (admin 2026-08-24).
 *
 * Their domain screen read `ownership: active · host: active · SSL: active`, the publish reported the
 * app live, and mitrify.com served Firebase's "Site Not Found". Every one of those was true: a publish
 * writes to TWO places, and the second — the workspace's own site, the ONLY one the custom domain
 * serves — was a best-effort call whose failure went to a `console.warn`.
 *
 * These tests pin the three silent paths shut.
 */

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const noSleep = { sleep: async () => {}, retryDelayMs: 0 };

describe('publishToCustomDomainSite — every path names itself', () => {
  it('no domain connected ⇒ nothing attempted, nothing said', async () => {
    let deployed = 0;
    const out = await publishToCustomDomainSite({
      workspaceId: 'w1',
      listDomains: async () => [],
      deployToSite: async () => { deployed++; },
      ...noSleep,
    });
    expect(deployed).toBe(0);
    expect(out).toMatchObject({ attempted: false, ok: true, note: '', attempts: 0 });
  });

  it('the domain gets the new build ⇒ success, and still nothing said', async () => {
    const out = await publishToCustomDomainSite({
      workspaceId: 'w1',
      listDomains: async () => ['mitrify.com'],
      deployToSite: async () => 'https://nbai-abc.web.app',
      ...noSleep,
    });
    expect(out).toMatchObject({ attempted: true, ok: true, note: '', attempts: 1 });
    expect(out.domains).toEqual(['mitrify.com']);
  });

  it('🔒 PATH 1 — the deploy failed, so the user is TOLD, by name', async () => {
    // The whole bug in one assertion: this used to return silently and the user was told "live".
    const out = await publishToCustomDomainSite({
      workspaceId: 'w1',
      listDomains: async () => ['mitrify.com'],
      deployToSite: async () => { throw new Error('Firebase Hosting site release failed (HTTP 403): nope'); },
      ...noSleep,
    });
    expect(out.ok).toBe(false);
    expect(out.note).toContain('mitrify.com');
    expect(out.note).toContain('live');           // the app IS live — never read as "publish failed"
  });

  it('🔒 PATH 2 — an unreadable domain lookup is NOT "no domain"', async () => {
    // firebaseDomainsForWorkspace returns [] on ANY error, so a Firestore hiccup used to skip the
    // domain deploy entirely and leave no trace. null now means "could not ask", and says so.
    let deployed = 0;
    const out = await publishToCustomDomainSite({
      workspaceId: 'w1',
      listDomains: async () => null,
      deployToSite: async () => { deployed++; },
      ...noSleep,
    });
    expect(deployed).toBe(0);
    expect(out.ok).toBe(false);
    expect(out.note).toBe(domainLookupFailedNote());
    // It must not invent a domain name it never read.
    expect(out.domains).toEqual([]);
  });

  it('a listDomains that THROWS is treated the same as one that could not answer', async () => {
    const out = await publishToCustomDomainSite({
      workspaceId: 'w1',
      listDomains: async () => { throw new Error('firestore down'); },
      deployToSite: async () => {},
      ...noSleep,
    });
    expect(out.ok).toBe(false);
    expect(out.note).toBe(domainLookupFailedNote());
  });

  it('🔒 PATH 3 — a transient failure is retried once, and then succeeds', async () => {
    let calls = 0;
    const out = await publishToCustomDomainSite({
      workspaceId: 'w1',
      listDomains: async () => ['mitrify.com'],
      deployToSite: async () => {
        calls++;
        if (calls === 1) throw new Error('Firebase Hosting file upload failed (HTTP 503): try again');
        return 'ok';
      },
      ...noSleep,
    });
    expect(calls).toBe(2);
    expect(out).toMatchObject({ ok: true, note: '', attempts: 2 });
  });

  it('a 4xx is NOT retried — repeating it only makes the user wait twice', async () => {
    let calls = 0;
    const out = await publishToCustomDomainSite({
      workspaceId: 'w1',
      listDomains: async () => ['mitrify.com'],
      deployToSite: async () => { calls++; throw new Error('Firebase Hosting site release failed (HTTP 403): iam'); },
      ...noSleep,
    });
    expect(calls).toBe(1);
    expect(out.attempts).toBe(1);
  });

  it('🔒 `attempts` is COUNTED, not inferred from the last error', async () => {
    // Retryable first, non-retryable second: two real uploads happened, and the field must say two.
    // Deriving it from `lastError` afterwards would report one.
    let calls = 0;
    const out = await publishToCustomDomainSite({
      workspaceId: 'w1',
      listDomains: async () => ['a.com'],
      deployToSite: async () => {
        calls++;
        throw new Error(calls === 1 ? 'socket hang up' : 'Firebase Hosting version finalize failed (HTTP 400): bad');
      },
      ...noSleep,
    });
    expect(calls).toBe(2);
    expect(out.attempts).toBe(2);
  });

  it('never throws, whatever the deploy does', async () => {
    await expect(publishToCustomDomainSite({
      workspaceId: 'w1',
      listDomains: async () => ['a.com'],
      deployToSite: async () => { throw 'a bare string, not an Error'; },
      ...noSleep,
    })).resolves.toMatchObject({ ok: false });
  });
});

describe('🔒 the user-facing note obeys the white-label law', () => {
  it('names the domain, never the hosting vendor', () => {
    const note = customDomainPublishNote(['mitrify.com']);
    expect(note).toContain('mitrify.com');
    for (const vendor of ['Firebase', 'Google', 'Hosting API', 'GCP']) {
      expect(note).not.toContain(vendor);
    }
    expect(domainLookupFailedNote()).not.toContain('Firestore');
  });

  it('the raw provider error stays in `reason`, out of the note', async () => {
    const out = await publishToCustomDomainSite({
      workspaceId: 'w1',
      listDomains: async () => ['mitrify.com'],
      deployToSite: async () => { throw new Error('Firebase Hosting site release failed (HTTP 403)'); },
      ...noSleep,
    });
    expect(out.reason).toContain('Firebase');   // for the logs and the admin
    expect(out.note).not.toContain('Firebase'); // never for the user
  });

  it('lists every connected domain, so a two-domain user knows which is affected', () => {
    expect(customDomainPublishNote(['a.com', 'b.com'])).toContain('a.com, b.com');
  });

  it('no domains ⇒ empty string, so the UI renders nothing rather than an empty warning box', () => {
    expect(customDomainPublishNote([])).toBe('');
  });
});

describe('isRetryableDomainPublishError', () => {
  it('4xx is final, 5xx and status-less failures are worth another go', () => {
    expect(isRetryableDomainPublishError('failed (HTTP 403): forbidden')).toBe(false);
    expect(isRetryableDomainPublishError('failed (HTTP 400): bad request')).toBe(false);
    expect(isRetryableDomainPublishError('failed (HTTP 503): unavailable')).toBe(true);
    expect(isRetryableDomainPublishError('socket hang up')).toBe(true);
    expect(isRetryableDomainPublishError('')).toBe(true);
  });
});

describe('🔒 the publish route actually reports the outcome', () => {
  const routes = src('src/server/routes/agentv3.ts');

  it('the shared deploy function uses the honest helper, not a swallowing try/catch', () => {
    const fn = routes.slice(routes.indexOf('const makeDeployFn ='), routes.indexOf("app.post('/api/agentv3/publish'"));
    expect(fn).toContain('publishToCustomDomainSite');
    expect(fn).toContain('firebaseDomainsForWorkspaceStrict');
    expect(fn).toContain('onDomainOutcome');
  });

  it('🔒 the note reaches the RESPONSE — the whole point of capturing it', () => {
    const publish = routes.slice(routes.indexOf("app.post('/api/agentv3/publish'"));
    expect(publish).toContain('onDomainOutcome: (o) => { domainOutcome = o; }');
    expect(publish).toContain('const warning = [domainNote, typecheckWarning].filter(Boolean).join');
  });

  it('🔒 the typecheck warning is NOT dropped to make room for the domain one', () => {
    // Replacing one warning with the other would recreate this very bug in miniature.
    const publish = routes.slice(routes.indexOf("app.post('/api/agentv3/publish'"));
    expect(publish).toContain('...(warning ? { warning } : {})');
  });
});

describe('🔒 the domain screen shows what pressing Publish did', () => {
  const screen = src('src/components/agentv3/NbaiDomainConnect.tsx');

  it('the result is an INPUT of the screen that owns the button', () => {
    // It used to be rendered by each host beside the screen — and one host rendered it on a view the
    // user was not looking at, so the button could fail in total silence.
    expect(screen).toContain('publishResult?: string;');
    expect(screen).toContain('{(publishBlocked || publishResult) && (');
    expect(screen).toContain('{publishBlocked || publishResult}');
  });

  it('BOTH hosts pass it, so neither can be the silent one', () => {
    expect(src('src/components/agentv3/HostingChooser.tsx')).toContain('publishResult={publishStatus}');
    expect(src('src/components/panels/ConnectMyWebsitePanel.tsx')).toContain('publishResult={publishMsg}');
  });
});
