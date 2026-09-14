/**
 * THE PREVIEW BRIDGE IS OURS — it must never be judged as the app's code, and never reach a publish.
 *
 * Autopsy fd021c64 (2026-09-14): a real build report was headlined
 *     rootCause: "postmessage-wildcard-origin @ index.html:9"
 * That rule matches `.postMessage(data, '*')`, which is the exact line `previewBridgeSource` emits so
 * the Live preview's console mirror can reach its parent frame. The app's owner was told their build's
 * problem was a line WE injected into their index.html.
 *
 * These tests state the two RULES rather than that one sentence:
 *   1. Content entering the analysis corpus is bridge-free.
 *   2. Content entering DURABLE storage is bridge-free (durable is what a publish serves).
 */
import { describe, it, expect } from 'vitest';
import {
  previewBridgeSource,
  stripPreviewBridge,
  withoutPreviewBridge,
  isHtmlDocumentPath,
  PREVIEW_BRIDGE_MARKER,
} from '../src/server/AgentV3/previewBridge';
import { scanSecurity } from '../src/server/AgentV3/SecurityAnalysis';
import { WorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { deriveRootCause, isNeverRootCause, type BuildIssue } from '../src/server/AgentV3/BuildDiagnostics';

/** An index.html exactly as the sandbox holds it once the dev server has injected the bridge. */
function injectedIndexHtml(): string {
  return [
    '<!doctype html>',
    '<html>',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <title>My App</title>',
    `    <script>${previewBridgeSource('live')}</script>`,
    '  </head>',
    '  <body>',
    '    <div id="root"></div>',
    '    <script type="module" src="/src/main.tsx"></script>',
    '  </body>',
    '</html>',
  ].join('\n');
}

describe('the finding was ours, and it was real', () => {
  it('the bridge really does trip the security rule that headlined the report', () => {
    // Non-vacuity: if this ever stops matching, every test below passes for the wrong reason.
    const hits = scanSecurity('index.html', previewBridgeSource('live'));
    expect(hits.some((f) => f.rule === 'postmessage-wildcard-origin')).toBe(true);
  });

  it('an app that never called postMessage is clean once the bridge is removed', () => {
    const html = injectedIndexHtml();
    expect(scanSecurity('index.html', html).some((f) => f.rule === 'postmessage-wildcard-origin')).toBe(true);
    const clean = withoutPreviewBridge('index.html', html);
    expect(scanSecurity('index.html', clean).some((f) => f.rule === 'postmessage-wildcard-origin')).toBe(false);
  });

  it("the app's OWN wildcard postMessage still gets flagged — we hide our line, not theirs", () => {
    const html = injectedIndexHtml().replace(
      '<div id="root"></div>',
      `<div id="root"></div>\n    <script>frames[0].postMessage(secret, '*');</script>`,
    );
    const clean = withoutPreviewBridge('index.html', html);
    expect(clean).not.toContain(PREVIEW_BRIDGE_MARKER);
    expect(scanSecurity('index.html', clean).some((f) => f.rule === 'postmessage-wildcard-origin')).toBe(true);
  });
});

describe('withoutPreviewBridge — the one helper the analysis paths share', () => {
  it('is a no-op for a non-HTML path, even one that somehow carries the marker', () => {
    const src = `// ${PREVIEW_BRIDGE_MARKER}\nexport const x = 1;\n`;
    expect(withoutPreviewBridge('src/App.tsx', src)).toBe(src);
  });

  it('is a no-op for an HTML document that never had a bridge', () => {
    const html = '<!doctype html><html><body><div id="root"></div></body></html>';
    expect(withoutPreviewBridge('index.html', html)).toBe(html);
  });

  it('is idempotent, and agrees with stripPreviewBridge on HTML paths', () => {
    const html = injectedIndexHtml();
    const once = withoutPreviewBridge('index.html', html);
    expect(once).toBe(stripPreviewBridge(html));
    expect(withoutPreviewBridge('index.html', once)).toBe(once);
  });

  it('keeps everything the app actually wrote', () => {
    const clean = withoutPreviewBridge('index.html', injectedIndexHtml());
    expect(clean).toContain('<title>My App</title>');
    expect(clean).toContain('<div id="root"></div>');
    expect(clean).toContain('src="/src/main.tsx"');
  });

  it('survives null/undefined-ish content without throwing', () => {
    expect(withoutPreviewBridge('index.html', '')).toBe('');
    expect(withoutPreviewBridge('', '')).toBe('');
  });

  it('covers .htm as well as .html, since isHtmlDocumentPath does', () => {
    expect(isHtmlDocumentPath('public/index.htm')).toBe(true);
    expect(withoutPreviewBridge('public/index.htm', injectedIndexHtml())).not.toContain(PREVIEW_BRIDGE_MARKER);
  });
});

describe('RULE 1 — the analysis corpus is bridge-free BY CONSTRUCTION', () => {
  it('WorkspaceMemory.indexFile strips it, so every one of its call sites is covered', () => {
    // This is the guarantee that matters: the pre-seed indexer reads the sandbox with the RAW
    // actuator (not the read_file tool), so nothing upstream had stripped it.
    const mem = new WorkspaceMemory();
    mem.indexFile('index.html', injectedIndexHtml());
    expect(mem.securityFindings().some((f) => f.rule === 'postmessage-wildcard-origin')).toBe(false);
  });

  it("...and still reports the app's own findings from the very same file", () => {
    const mem = new WorkspaceMemory();
    mem.indexFile(
      'index.html',
      injectedIndexHtml().replace('<div id="root"></div>', `<div id="root"></div><script>win.postMessage(d, '*');</script>`),
    );
    expect(mem.securityFindings().some((f) => f.rule === 'postmessage-wildcard-origin')).toBe(true);
  });
});

describe('RULE 2 — the durable copy is bridge-free BY CONSTRUCTION', () => {
  it('the dispatcher persists through a wrapper, not through the raw callback', async () => {
    // A source-level rule, because the real defect was a call site that bypassed a guard: the class
    // must not hand the constructor's raw durable callback to its own code under the name the ~24
    // persist sites use. If `onFileWrite` is ever a plain parameter property again, the bridge can
    // reach durable storage from any of them — which is exactly how this bug existed.
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/server/AgentV3/ToolDispatcher.ts', 'utf8'));
    expect(src).toContain('private readonly onFileWriteRaw?:');
    expect(src).not.toMatch(/private readonly onFileWrite\?:\s*\(/);
    expect(src).toMatch(/private readonly onFileWrite = \([\s\S]{0,200}withoutPreviewBridge\(path, content\)/);
    // Non-vacuity: the sites this wrapper exists to cover must actually exist.
    expect((src.match(/this\.onFileWrite\?\.\(/g) ?? []).length).toBeGreaterThan(10);
  });

  it('the signature injector — the sharpest site — reads the sandbox, which is why it needed it', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile('src/server/AgentV3/ToolDispatcher.ts', 'utf8'));
    // It fires right after the preview port verifies UP, i.e. after the bridge was injected.
    expect(src).toContain('await this.injectAppSignatureIntoIndexHtml();');
    expect(src).toContain("'signature-read'");
  });
});

describe('an advisory is never a build’s root cause', () => {
  const issue = (over: Partial<BuildIssue>): BuildIssue => ({
    ts: 1, phase: 'build', severity: 'warning', code: 'X', message: 'm', autoResolved: false, ...over,
  } as BuildIssue);

  it('READINESS_WARNING is excluded — it is the non-blocking half of the readiness split', () => {
    expect(isNeverRootCause('READINESS_WARNING')).toBe(true);
    // ...and its blocking sibling stays eligible, or a real failure would lose its explanation.
    expect(isNeverRootCause('READINESS_BLOCKER')).toBe(false);
  });

  it('the reported build no longer blames a warning for failing', () => {
    const out = deriveRootCause({
      ok: false,
      issues: [issue({
        code: 'READINESS_WARNING',
        message: "postmessage-wildcard-origin @ index.html:9",
        autoResolved: true,
      })],
    });
    expect(out ?? '').not.toContain('postmessage-wildcard-origin @ index.html:9 ');
    expect(out ?? '').not.toBe("postmessage-wildcard-origin @ index.html:9");
  });

  it('THE CLASS: an auto-resolved item is named, but never claimed as the cause', () => {
    const out = deriveRootCause({
      ok: false,
      issues: [issue({ code: 'SOME_FUTURE_CODE', severity: 'error', message: 'a thing we already fixed', autoResolved: true })],
    }) ?? '';
    // Still named — it is the most useful thing the run has.
    expect(out).toContain('a thing we already fixed');
    // But the causal claim is withdrawn, and the report says why.
    expect(out).not.toBe('a thing we already fixed');
    expect(out.toLowerCase()).toContain('not known');
  });

  it('an UNRESOLVED problem is still reported as the cause, verbatim — no regression', () => {
    expect(deriveRootCause({
      ok: false,
      issues: [issue({ code: 'DB_UNREACHABLE', severity: 'error', message: 'database unreachable', autoResolved: false })],
    })).toBe('database unreachable');
  });

  it('an unresolved error outranks an auto-resolved one, so the wrapper cannot mask a real cause', () => {
    expect(deriveRootCause({
      ok: false,
      issues: [
        issue({ code: 'OLD', severity: 'error', message: 'already resolved', autoResolved: true }),
        issue({ code: 'DB_UNREACHABLE', severity: 'error', message: 'database unreachable', autoResolved: false }),
      ],
    })).toBe('database unreachable');
  });

  it('a SUCCESSFUL build never names an auto-resolved item at all', () => {
    // Not `undefined` — a clean build gets its own honest sentence. The rule is that the recovered
    // item does not appear in it, which is what the fallback's `ok === true` guard is for.
    const out = deriveRootCause({
      ok: true,
      issues: [issue({ code: 'SOME_FUTURE_CODE', severity: 'error', message: 'transient', autoResolved: true })],
    }) ?? '';
    expect(out).not.toContain('transient');
    expect(out.toLowerCase()).toContain('successfully');
  });
});
