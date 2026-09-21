// AUTOPSY 53d43c18 (2026-09-21) — "Fix bugs", and the bug was ours.
//
// A finished memory-match game (build e4d27bde: rendered, typechecked, production build clean, green
// guard saved) came back an hour later with `Cannot read properties of null (reading 'useState')`.
// The user typed two words — **"Fix bugs"** — and a 21-minute build was spent discovering that
// `index.html` had *"no `<div id="root">` and no `<script>`"*, with `npm run build` transforming
// **1 module**. They were billed ₹113 for the engine to repair an entry file the engine owns.
//
// 🔴 `ensureHtmlEntryScript` exists for exactly that, is pure and unit-tested, and had ONE call site:
// `SimpleBuilder.ts` — the FAST LANE. The architect loop, which is where most builds run and where all
// three builds in that report ran, had no boot check at all. This repo's own headline class (autopsy
// a38c6fef): the instance fixed in one of the two lanes that carry it, the sibling never hunted.
//
// 🔍 A SECOND, INDEPENDENT DEFECT in the same block, proven from the same report's own numbers.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ensureHtmlEntryScript } from '../src/server/AgentV3/HtmlEntryGuard';
import { planAppDefaults } from '../src/server/AgentV3/appDefaults';
import { injectPreviewBridge, withoutPreviewBridge, PREVIEW_BRIDGE_MARKER } from '../src/server/AgentV3/previewBridge';

const ENTRY = 'src/main.tsx';
const CLEAN_HTML =
  '<!DOCTYPE html>\n<html lang="en">\n  <head><meta charset="UTF-8" /><title>Memory match</title></head>\n' +
  '  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>\n</html>\n';

describe('an index.html that cannot boot is repaired on EVERY lane', () => {
  it('🔴 THE REPORT ITSELF: no mount node and no entry script — both restored', () => {
    const broken = '<!DOCTYPE html>\n<html lang="en">\n  <head><title>Memory match</title></head>\n  <body></body>\n</html>\n';
    const r = ensureHtmlEntryScript({ 'index.html': broken, [ENTRY]: 'export default 1' });
    expect(r.injected).toBe(true);
    expect(r.files['index.html']).toContain('id="root"');
    expect(r.files['index.html']).toMatch(/<script\b[^>]*src=["'][^"']*main\.tsx/);
  });

  it('⚠️ and a page that already boots is left exactly as it is', () => {
    const r = ensureHtmlEntryScript({ 'index.html': CLEAN_HTML, [ENTRY]: 'export default 1' });
    expect(r.injected).toBe(false);
    expect(r.files['index.html']).toBe(CLEAN_HTML);
  });

  it('⚠️ it never invents an entry module that does not exist', () => {
    // No src/main.tsx in the file set — guessing one would produce a 404 and a blank page, which is
    // the same failure with our fingerprints on it.
    const r = ensureHtmlEntryScript({ 'index.html': '<!DOCTYPE html><html><body></body></html>' });
    expect(r.injected).toBe(false);
  });

  it('🔒 the guard is wired on the ARCHITECT path, not only the fast lane (reversion guard)', () => {
    // `tsc` and `vitest` cannot see that a guard is reachable from only one of two lanes — which is
    // exactly how this survived from 2026-07-13 to 2026-09-21. Only the source says where it runs.
    const route = fs.readFileSync(path.join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain("from '../AgentV3/HtmlEntryGuard'");
    expect(route).toContain('ensureHtmlEntryScript(full)');
    expect(route).toContain('HTML_ENTRY_REPAIRED');
    // Still reachable from the fast lane too — this widens, it does not move.
    const simple = fs.readFileSync(path.join(__dirname, '../src/server/AgentV3/SimpleBuilder.ts'), 'utf8');
    expect(simple).toContain('ensureHtmlEntryScript');
  });

  it('🔒 a repaired entry file is OUR fact, never a finding against the user’s app', () => {
    const diag = fs.readFileSync(path.join(__dirname, '../src/server/AgentV3/BuildDiagnostics.ts'), 'utf8');
    const set = diag.slice(diag.indexOf('PROCESS_ONLY_CODES'), diag.indexOf('PROCESS_ONLY_CODES') + 2000);
    expect(set).toContain("'HTML_ENTRY_REPAIRED'");
  });
});

describe('our preview bridge is never saved into the user’s own source', () => {
  it('🔴 THE MEASUREMENT FROM THE REPORT: 299 bytes in, 18 KB out', () => {
    const bridged = injectPreviewBridge(CLEAN_HTML, 'live');
    expect(bridged).toContain(PREVIEW_BRIDGE_MARKER);
    // The report's own build output reads `dist/index.html  18.46 kB` — this is that number.
    expect(bridged.length).toBeGreaterThan(18_000);

    // What the defaults pass used to persist: the bridge, plus its own meta tags on top.
    const unguarded = planAppDefaults(bridged, 'Memory match').indexHtml ?? '';
    expect(unguarded).toContain(PREVIEW_BRIDGE_MARKER);

    // What it persists now: the user's document, with the meta tags and none of our shim.
    const guarded = planAppDefaults(withoutPreviewBridge('index.html', bridged), 'Memory match').indexHtml ?? '';
    expect(guarded).not.toContain(PREVIEW_BRIDGE_MARKER);
    expect(guarded).toContain('id="root"');
    expect(guarded).toContain('/src/main.tsx');
    expect(guarded).toContain('og:title');
    expect(guarded.length).toBeLessThan(2_000);
  });

  it('⚠️ the bridge did NOT remove the mount node — stated because the report invites that conclusion', () => {
    // The same report's `index.html` lost its root div and script, and this pass is the obvious
    // suspect. It is not the culprit: measured, it preserves both. What did remove them is an OPEN
    // root cause in PROGRESS.md, and saying so is the point.
    const out = planAppDefaults(injectPreviewBridge(CLEAN_HTML, 'live'), 'Memory match').indexHtml ?? '';
    expect(out).toContain('id="root"');
    expect(out).toContain('/src/main.tsx');
  });

  it('🔒 the sandbox read is stripped before it is written back (reversion guard)', () => {
    const route = fs.readFileSync(path.join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain("withoutPreviewBridge(idxPath, await actuator.readFile(workspaceId, idxPath))");
  });
});
