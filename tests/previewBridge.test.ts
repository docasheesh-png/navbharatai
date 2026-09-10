import { describe, it, expect } from 'vitest';
import {
  previewBridgeSource, injectPreviewBridge, stripPreviewBridge, hasPreviewBridge,
  isHtmlDocumentPath, PREVIEW_BRIDGE_MARKER,
} from '../src/server/AgentV3/previewBridge';

const DOC = '<!DOCTYPE html><html><head><title>App</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';

describe('previewBridgeSource — one mirror, both previews', () => {
  it('mirrors every console level, window errors and unhandled rejections', () => {
    const js = previewBridgeSource('live');
    for (const lvl of ["'log'", "'info'", "'warn'", "'error'"]) expect(js).toContain(lvl);
    expect(js).toContain("addEventListener('error'");
    expect(js).toContain("addEventListener('unhandledrejection'");
  });

  it('WRAPS the app’s console rather than replacing it', () => {
    // If this ever regresses the app's own logging disappears, which is a worse bug than the one the
    // mirror fixes: we would have taken a capability away to add a panel.
    expect(previewBridgeSource('live')).toContain('orig[level].apply(console, arguments)');
  });

  it('bounds every message so one huge object dump cannot flood the channel', () => {
    expect(previewBridgeSource('live')).toContain(".slice(0, 600)");
  });

  it('labels which preview the rows came from', () => {
    expect(previewBridgeSource('live')).toContain("var SOURCE = 'live'");
    expect(previewBridgeSource('in-browser')).toContain("var SOURCE = 'in-browser'");
  });

  it('reports FAILED network calls only — never every request', () => {
    const js = previewBridgeSource('live');
    expect(js).toContain('res.status >= 400');
    expect(js).toContain('XMLHttpRequest');
    // A 2xx must not produce a row: the only reporting call sites are the failure branches.
    expect(js).not.toMatch(/res\.status\s*<\s*400[\s\S]{0,80}reportHttp/);
  });

  it('re-throws what the app’s own fetch would have thrown', () => {
    // Swallowing the rejection would make a broken API call look like a hanging one — the mirror must
    // observe, never absorb.
    const js = previewBridgeSource('live');
    expect(js).toContain('throw err;');
    expect(js).toContain('throw e;');
  });

  it('guards itself against being installed twice', () => {
    expect(previewBridgeSource('live')).toContain(`if (window.${PREVIEW_BRIDGE_MARKER}) return;`);
  });
});

describe('injectPreviewBridge', () => {
  it('puts the bridge first in <head>, so a boot-time error is already captured', () => {
    const out = injectPreviewBridge(DOC);
    expect(hasPreviewBridge(out)).toBe(true);
    expect(out.indexOf(PREVIEW_BRIDGE_MARKER)).toBeLessThan(out.indexOf('<title>'));
  });

  it('is idempotent — a reboot never double-wraps the console', () => {
    const once = injectPreviewBridge(DOC);
    expect(injectPreviewBridge(once)).toBe(once);
  });

  it('leaves a document it cannot place the bridge in exactly as it was', () => {
    expect(injectPreviewBridge('just text, no markup')).toBe('just text, no markup');
    expect(injectPreviewBridge('')).toBe('');
  });

  it('falls back to <html> when there is no <head>', () => {
    expect(hasPreviewBridge(injectPreviewBridge('<html><body>hi</body></html>'))).toBe(true);
  });
});

describe('stripPreviewBridge — the bridge can never reach a user’s shipped app', () => {
  it('restores the document byte-for-byte', () => {
    expect(stripPreviewBridge(injectPreviewBridge(DOC))).toBe(DOC);
  });

  it('leaves the app’s OWN scripts alone', () => {
    const out = stripPreviewBridge(injectPreviewBridge(DOC));
    expect(out).toContain('<script type="module" src="/src/main.tsx"></script>');
  });

  it('is a no-op on a document that never had one', () => {
    expect(stripPreviewBridge(DOC)).toBe(DOC);
    expect(stripPreviewBridge('')).toBe('');
  });

  it('strips it even when the model has moved it and reformatted around it', () => {
    const mangled = `<html><head><meta charset="utf-8">\n  <script>${previewBridgeSource('live')}</script>\n  <title>x</title></head><body></body></html>`;
    const out = stripPreviewBridge(mangled);
    expect(hasPreviewBridge(out)).toBe(false);
    expect(out).toContain('<title>x</title>');
    expect(out).toContain('<meta charset="utf-8">');
  });

  it('knows which paths could carry one', () => {
    expect(isHtmlDocumentPath('index.html')).toBe(true);
    expect(isHtmlDocumentPath('public/index.htm')).toBe(true);
    expect(isHtmlDocumentPath('src/App.tsx')).toBe(false);
    expect(isHtmlDocumentPath('')).toBe(false);
  });
});
