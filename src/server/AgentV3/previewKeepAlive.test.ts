import { describe, it, expect } from 'vitest';
import {
  previewKeepAliveEnabled, isTopLevelNavigation, shouldServeKeepAliveShell, keepAliveShellPage,
  KEEPALIVE_INTERVAL_MS, KEEPALIVE_MAX_MS,
} from './previewKeepAlive';
import { idleLimitMs } from './sandboxReaper';

describe('the interval must beat the thing it is holding off', () => {
  it('pings well inside the idle window', () => {
    // THE ARITHMETIC IS THE BUG. A keep-alive slower than the sweep it is racing cannot win, which is
    // exactly why the pane watchdog was set to 150s against a 300s limit. Pinned so a future edit to
    // either number cannot silently make this useless.
    expect(KEEPALIVE_INTERVAL_MS).toBeLessThan(idleLimitMs({} as NodeJS.ProcessEnv) / 2);
  });

  it('has a ceiling, because a heartbeat holds a real billed machine', () => {
    // A tab left on a second monitor over a weekend is "visible" the whole time. Without this, that
    // costs ~₹7/hour with nobody in the room.
    expect(KEEPALIVE_MAX_MS).toBeGreaterThan(KEEPALIVE_INTERVAL_MS * 10);
    expect(KEEPALIVE_MAX_MS).toBeLessThanOrEqual(2 * 60 * 60_000);
  });
});

describe('previewKeepAliveEnabled', () => {
  it('is on by default and off only for the explicit kill switch', () => {
    expect(previewKeepAliveEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(previewKeepAliveEnabled({ AGENTV3_PREVIEW_KEEPALIVE: 'off' } as never)).toBe(false);
    expect(previewKeepAliveEnabled({ AGENTV3_PREVIEW_KEEPALIVE: 'on' } as never)).toBe(true);
  });
});

describe('isTopLevelNavigation — a missing header can only mean today’s behaviour', () => {
  it('an iframe navigation is not top level', () => {
    expect(isTopLevelNavigation('iframe')).toBe(false);
    expect(isTopLevelNavigation('IFRAME')).toBe(false);
    expect(isTopLevelNavigation(' iframe ')).toBe(false);
  });

  it('a document navigation is top level', () => {
    expect(isTopLevelNavigation('document')).toBe(true);
  });

  it('an ABSENT header is treated as an iframe, never as a popout', () => {
    // Deliberate. A browser that does not send Sec-Fetch-Dest gets the 302 that already works; it can
    // never be routed onto a path nobody has tested it on.
    expect(isTopLevelNavigation(undefined)).toBe(false);
    expect(isTopLevelNavigation(null)).toBe(false);
    expect(isTopLevelNavigation('')).toBe(false);
  });

  it('reads the first value when a header arrives repeated', () => {
    expect(isTopLevelNavigation(['iframe', 'document'])).toBe(false);
    expect(isTopLevelNavigation(['document'])).toBe(true);
  });
});

describe('shouldServeKeepAliveShell', () => {
  const base = { enabled: true, topLevel: true, targetUrl: 'https://5173-abc.e2b.app' };

  it('serves the shell for a popped-out tab', () => {
    expect(shouldServeKeepAliveShell(base)).toBe(true);
  });

  it('leaves our own iframe on the redirect, byte for byte', () => {
    // The in-app preview path is the one that has been stabilised all week. It must not change shape.
    expect(shouldServeKeepAliveShell({ ...base, topLevel: false })).toBe(false);
  });

  it('the kill switch restores the redirect everywhere', () => {
    expect(shouldServeKeepAliveShell({ ...base, enabled: false })).toBe(false);
  });

  it('never serves a shell with nowhere to point', () => {
    expect(shouldServeKeepAliveShell({ ...base, targetUrl: '' })).toBe(false);
    expect(shouldServeKeepAliveShell({ ...base, targetUrl: null })).toBe(false);
  });
});

describe('keepAliveShellPage', () => {
  const page = keepAliveShellPage({ targetUrl: 'https://5173-abc.e2b.app/', keepAlivePath: '/api/agentv3/preview-keepalive?ws=w1&exp=1&sig=s' });

  it('shows the app full-bleed and nothing else', () => {
    expect(page).toContain('src="https://5173-abc.e2b.app/"');
    expect(page).toContain('position:fixed;inset:0');
  });

  it('pings our own origin, never the vendor', () => {
    expect(page).toContain('/api/agentv3/preview-keepalive?ws=w1&exp=1&sig=s');
  });

  it('stops when the tab is hidden and after the ceiling', () => {
    expect(page).toContain("document.visibilityState === 'hidden'");
    expect(page).toContain('expired()');
    expect(page).toContain(String(KEEPALIVE_MAX_MS));
  });

  it('a failed ping can never break the page showing the user their app', () => {
    expect(page).toContain('.catch(function(){})');
  });

  it('loads nothing from anywhere else — no script, style or font fetch', () => {
    expect(page).not.toMatch(/<script[^>]+src=/i);
    expect(page).not.toMatch(/<link[^>]+href=/i);
  });

  it('escapes a hostile target url instead of interpolating it raw', () => {
    const hostile = keepAliveShellPage({ targetUrl: 'https://x/"><script>alert(1)</script>', keepAlivePath: '/p' });
    expect(hostile).not.toContain('"><script>alert(1)</script>');
    expect(hostile).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('escapes a hostile keep-alive path inside the script block', () => {
    const hostile = keepAliveShellPage({ targetUrl: 'https://x/', keepAlivePath: '</script><script>alert(1)//' });
    // The closing tag must not survive into the document, or the page ends early and the rest is markup.
    expect(hostile).not.toContain('</script><script>alert(1)');
    expect(hostile).toContain('\\u003c/script');
  });

  it('names no vendor anywhere the user could read it', () => {
    const visible = page.replace(/https:\/\/\S+?e2b\.app\S*/g, ''); // the app's own url is unavoidable
    expect(visible).not.toMatch(/e2b|glm|kimi|claude|anthropic|gemini|grok|moonshot/i);
  });
});
