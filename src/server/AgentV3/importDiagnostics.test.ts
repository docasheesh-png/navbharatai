import { describe, it, expect } from 'vitest';
import { importFailureNarration, importFailureModelReason, repoOwnerFromUrl } from './importDiagnostics';

const URL = 'https://github.com/aashishcpmt093-ui/mitrify';

describe('repoOwnerFromUrl', () => {
  it('extracts the owner, names the exact account to connect', () => {
    expect(repoOwnerFromUrl(URL)).toBe('aashishcpmt093-ui');
    expect(repoOwnerFromUrl('https://github.com/o/r.git')).toBe('o');
    expect(repoOwnerFromUrl('not a url')).toBeNull();
  });
});

describe('importFailureNarration — accurate, actionable clone-failure messages', () => {
  it('no token → leads with "connect GitHub" (the #1 real cause), not "check the URL"', () => {
    const msg = importFailureNarration({ reason: 'not-found', hadToken: false, url: URL });
    expect(msg).toMatch(/not connected to your GitHub/i);
    expect(msg).toContain(URL);
    expect(msg).toContain('⚙ → GitHub');
  });

  it('token present + auth → says the connection expired, tells them to reconnect', () => {
    const msg = importFailureNarration({ reason: 'auth', hadToken: true, url: URL });
    expect(msg).toMatch(/expired/i);
    expect(msg).toMatch(/Reconnect GitHub/i);
  });

  it('token present + not-found → explains it is a DIFFERENT account AND names the owner (the "my own repo" confusion)', () => {
    const msg = importFailureNarration({ reason: 'not-found', hadToken: true, url: URL });
    expect(msg).toMatch(/DIFFERENT GitHub account/i);
    expect(msg).toMatch(/connect the account that actually owns it/i);
    expect(msg).toContain('aashishcpmt093-ui'); // names the exact account to connect
  });

  it('network → transient, invite a retry (never blames the user)', () => {
    const msg = importFailureNarration({ reason: 'network', hadToken: true, url: URL });
    expect(msg).toMatch(/network hiccup/i);
    expect(msg).toMatch(/try again/i);
  });

  it('unknown / no-git / bad-url → the honest generic fallback', () => {
    for (const reason of ['unknown', 'no-git', 'bad-url', undefined] as const) {
      const msg = importFailureNarration({ reason, hadToken: true, url: URL });
      expect(msg).toMatch(/couldn't complete the clone|didn't finish/i);
      expect(msg).toContain(URL);
    }
  });

  // REGRESSION (mitrify autopsy 2026-07-24): an UNCLASSIFIED clone failure of a provably-PUBLIC repo used
  // to be reported as "most likely a private repo the connected GitHub account cannot access", sending the
  // user to chase a non-existent access problem. The honest fallback must NOT assert the repo is private.
  it('unknown → NEVER asserts the repo is (most likely) private', () => {
    const msg = importFailureNarration({ reason: 'unknown', hadToken: true, url: URL });
    expect(msg).not.toMatch(/most likely a private repo/i);
    expect(msg).toMatch(/unexpected reason/i);
    // A conditional "if the repo is private…" hint is fine; asserting it IS private is not.
    expect(importFailureModelReason({ reason: 'unknown', hadToken: true })).not.toMatch(/most likely a private repo/i);
  });

  it('tls / protocol / disk → honest environmental messages, never a repo-access blame', () => {
    const tls = importFailureNarration({ reason: 'tls', hadToken: true, url: URL });
    expect(tls).toMatch(/secure connection|TLS/i);
    expect(tls).toMatch(/isn't a problem with your repo/i);

    const proto = importFailureNarration({ reason: 'protocol', hadToken: true, url: URL });
    expect(proto).toMatch(/interrupted|hiccup/i);
    expect(proto).toMatch(/try the import again/i);

    const disk = importFailureNarration({ reason: 'disk', hadToken: true, url: URL });
    expect(disk).toMatch(/space/i);
    expect(disk).toMatch(/on our side|not your repo/i);

    // model-facing reasons are specific + honest too
    expect(importFailureModelReason({ reason: 'tls', hadToken: true })).toMatch(/TLS|secure/i);
    expect(importFailureModelReason({ reason: 'protocol', hadToken: true })).toMatch(/interrupted|protocol/i);
    expect(importFailureModelReason({ reason: 'disk', hadToken: true })).toMatch(/disk|space/i);
  });

  it('every message ends with the honest "empty workspace" tail and NEVER names an AI vendor/model', () => {
    const forbidden = /\b(gemini|claude|anthropic|glm|kimi|moonshot|grok|openai|gpt|bedrock|vertex|z\.ai)\b/i;
    for (const reason of ['auth', 'not-found', 'network', 'unknown', undefined] as const) {
      for (const hadToken of [true, false]) {
        const msg = importFailureNarration({ reason, hadToken, url: URL });
        expect(msg).toContain('Starting with an empty workspace for now.');
        expect(msg).not.toMatch(forbidden);
      }
    }
  });
});

describe('importFailureModelReason — the internal reason threaded into the architect prompt', () => {
  it('is specific per cause so the model never re-asks for the URL', () => {
    expect(importFailureModelReason({ reason: 'auth', hadToken: true })).toMatch(/authenticate/i);
    expect(importFailureModelReason({ reason: 'not-found', hadToken: true })).toMatch(/different account|URL is wrong/i);
    expect(importFailureModelReason({ reason: 'network', hadToken: true })).toMatch(/network/i);
    expect(importFailureModelReason({ reason: 'not-found', hadToken: false })).toMatch(/no GitHub account is connected/i);
  });
});
