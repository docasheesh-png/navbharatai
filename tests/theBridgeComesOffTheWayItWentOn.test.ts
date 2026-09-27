// AUTOPSY 6bae5835 (2026-09-27) — the preview bridge's stripper was not the inverse of its injector.
//
// The injector writes our console mirror straight after `<head>` with no whitespace of its own. The
// stripper removed the tag AND the `[ \t]*\n` after it — in a real Vite `index.html` that newline is
// the USER's. So `identitySource` (the Study-Racer fix, 2026-09-25) could never make a bridged sandbox
// tree and the saved tree hash alike, and the build report said PREVIEW_SNAPSHOT_STALE ("both sides
// hold the same 33 file(s), so a file's CONTENT changed") on a build whose POST_GREEN_WRITES said
// nothing wrote. Every earlier fixture had `<head><title>` on one line, the one shape that hides it.

import { describe, it, expect } from 'vitest';
import { injectPreviewBridge, stripPreviewBridge, previewBridgeSource, withoutPreviewBridge } from '../src/server/AgentV3/previewBridge';
import { identitySource, workspaceContentHash, snapshotConfirmation } from '../src/server/AgentV3/snapshotIdentity';

// The document `npm create vite` writes — the shape nearly every app in this engine starts from.
const VITE = '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>Jarwis</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n';

const SHAPES: Record<string, string> = {
  'vite (newline after <head>)': VITE,
  'crlf line endings': VITE.replace(/\n/g, '\r\n'),
  'one line': '<!DOCTYPE html><html><head><title>A</title></head><body><div id="root"></div></body></html>',
  'no <head>, only <html>': '<html>\n<body>\n<div id="root"></div>\n</body>\n</html>\n',
  '<head> with attributes': '<html>\n<head lang="hi">\n\t<title>x</title>\n</head>\n<body></body>\n</html>',
  'blank line after <head>': '<html>\n<head>\n\n  <title>x</title>\n</head></html>',
};

describe('🔴 strip(inject(doc)) === doc, for every real document shape', () => {
  for (const [name, doc] of Object.entries(SHAPES)) {
    it(name, () => {
      const bridged = injectPreviewBridge(doc, 'live');
      expect(bridged).not.toBe(doc); // the bridge really went in
      expect(stripPreviewBridge(bridged)).toBe(doc);
      expect(withoutPreviewBridge('index.html', bridged)).toBe(doc);
    });
  }
});

describe('a tag a model moved onto its own line still leaves as a whole line', () => {
  it('indented, own line ⇒ the line goes, the neighbours stay exactly', () => {
    const tag = `<script>${previewBridgeSource('live')}</script>`;
    const moved = `<html><head><meta charset="utf-8">\n  ${tag}\n  <title>x</title></head><body></body></html>`;
    expect(stripPreviewBridge(moved)).toBe('<html><head><meta charset="utf-8">\n  <title>x</title></head><body></body></html>');
  });
  it('idempotent on the stripped result and a no-op on a clean document', () => {
    const once = stripPreviewBridge(injectPreviewBridge(VITE));
    expect(stripPreviewBridge(once)).toBe(once);
    expect(stripPreviewBridge(VITE)).toBe(VITE);
  });
});

describe('the snapshot identity finally holds on the document a real app has', () => {
  it('a bridged sandbox tree and the saved tree are ONE identity ⇒ the copy is re-stamped, not stale', () => {
    const app = { 'src/App.tsx': 'export default () => null;\n', 'index.html': VITE };
    const sandbox = { ...app, 'index.html': injectPreviewBridge(VITE, 'live') };
    const taken = { url: 'https://s-x.example', filesHash: workspaceContentHash(identitySource(sandbox)) };
    const v = snapshotConfirmation({ taken, persistedHash: workspaceContentHash(identitySource(app)) });
    expect(v.action).toBe('restamp');
  });
  it('a genuine late edit is still stale — the fix only removes OUR difference', () => {
    const sandbox = { 'index.html': injectPreviewBridge(VITE, 'live') };
    const taken = { url: 'https://s-x.example', filesHash: workspaceContentHash(identitySource(sandbox)) };
    const v = snapshotConfirmation({ taken, persistedHash: workspaceContentHash(identitySource({ 'index.html': VITE.replace('Jarwis', 'Jarvis') })) });
    expect(v.action).toBe('stale');
  });
});
