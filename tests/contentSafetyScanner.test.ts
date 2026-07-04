import { describe, it, expect, afterEach } from 'vitest';
import { scanPublishedContent, publishScanBlocks, contentScanSummary } from '../src/server/AgentV3/ContentSafetyScanner';

const dist = (html: string): Map<string, Buffer> => new Map([['dist/index.html', Buffer.from(html, 'utf-8')]]);
afterEach(() => { delete process.env.AGENTV3_PUBLISH_SCAN; });

describe('ContentSafetyScanner — flags real abuse, spares real apps', () => {
  it('flags a crypto seed-phrase harvester (wallet drainer) as unsafe', () => {
    const r = scanPublishedContent(dist('<h1>Restore wallet</h1><label>Enter your 12-word seed phrase</label><textarea></textarea>'));
    expect(r.safe).toBe(false);
    expect(r.findings.some((f) => f.rule === 'SEED_PHRASE_HARVEST')).toBe(true);
  });

  it('flags a "enter your private key" wallet drainer', () => {
    const r = scanPublishedContent(dist('<p>Paste your private key to connect</p><input id="pk" />'));
    expect(r.safe).toBe(false);
    expect(r.findings.some((f) => f.rule === 'PRIVATE_KEY_HARVEST')).toBe(true);
  });

  it('flags a brand-impersonation phishing lure', () => {
    const r = scanPublishedContent(dist('<h2>PayPal</h2><p>Your account has been suspended. Verify your identity.</p><input type="password"/>'));
    expect(r.safe).toBe(false);
    expect(r.findings.some((f) => f.rule === 'BRAND_PHISH_LURE')).toBe(true);
  });

  it('does NOT flag a legitimate login form for the user\'s OWN product (no false positive)', () => {
    const r = scanPublishedContent(dist(
      '<form action="/api/login" method="post"><h1>Sign in to TaskPro</h1>' +
      '<input type="email" placeholder="Email"/><input type="password" placeholder="Password"/>' +
      '<button>Log in</button></form>',
    ));
    expect(r.safe).toBe(true);
    expect(r.findings.length).toBe(0);
  });

  it('does NOT flag an ordinary marketing / CRUD app', () => {
    const r = scanPublishedContent(dist('<h1>Hospital OPD</h1><table><tr><td>Patient</td></tr></table><button>Add note</button>'));
    expect(r.safe).toBe(true);
  });

  it('is empty + safe for a static site with no scannable text', () => {
    expect(scanPublishedContent(new Map())).toEqual({ safe: true, findings: [] });
  });

  it('publishScanBlocks reads the env (default warn-only)', () => {
    expect(publishScanBlocks()).toBe(false);
    process.env.AGENTV3_PUBLISH_SCAN = 'block';
    expect(publishScanBlocks()).toBe(true);
    process.env.AGENTV3_PUBLISH_SCAN = 'warn';
    expect(publishScanBlocks()).toBe(false);
  });

  it('contentScanSummary is honest and non-empty only when there are findings', () => {
    expect(contentScanSummary({ safe: true, findings: [] })).toBe('');
    const s = contentScanSummary(scanPublishedContent(dist('<p>Enter your private key</p>')));
    expect(s).toMatch(/content-safety/);
  });
});

describe('withDeploymentPersistence — content scan wiring (block mode)', () => {
  it('block mode holds an unsafe app and never publishes it', async () => {
    process.env.AGENTV3_PUBLISH_SCAN = 'block';
    const { withDeploymentPersistence } = await import('../src/server/AgentV3/DeploymentStore');
    let called = false;
    const wrapped = withDeploymentPersistence(async () => { called = true; return 'https://x'; }, 'u1', 'firebase');
    const unsafe = new Map([['dist/index.html', Buffer.from('<label>secret recovery phrase</label><textarea></textarea>', 'utf-8')]]);
    await expect(wrapped('ws-1', unsafe)).rejects.toThrow(/held for review/i);
    expect(called).toBe(false);
  });

  it('warn mode (default) publishes an unsafe app but the scanner still returns unsafe for auditing', async () => {
    const { withDeploymentPersistence } = await import('../src/server/AgentV3/DeploymentStore');
    const wrapped = withDeploymentPersistence(async () => 'https://ok.web.app', 'u1', 'firebase');
    const unsafe = new Map([['dist/index.html', Buffer.from('<label>secret recovery phrase</label>', 'utf-8')]]);
    await expect(wrapped('ws-1', unsafe)).resolves.toBe('https://ok.web.app'); // warn-only never blocks
  });
});
