// Q-1021 — THE JOURNEY CHECK READS THE APP, NOT OUR INSTRUMENTATION.
//
// 🔴 THE DEFECT. `journeyDerivation.appOwnFiles` is the one place every "does this app do X?" question in
// that module is asked of — and it stripped ONE of the three things NavBharatAI injects into a built app.
// `withoutAppSignature` removes the "made by NavBharatAI" badge. It does not touch:
//   • the red HONESTY BANNER (`honestyBanner.ts`) — the NO-FAKE-FEATURE rule's demo warning;
//   • the PREVIEW BRIDGE (`previewBridge.ts`) — roughly 300 lines of OUR script, which registers
//     `addEventListener('input', …)`, a `click` handler and a `mouseover` handler.
// So on an app whose author wrote no script at all, "what does this app do?" was partly being answered
// about our own instrumentation.
//
// 🔑 THE CLASS, and why the fix is one call rather than three patterns copied in. Autopsy 9c612cdb had
// already met this exact bug in the design lint (our badge's `gap:6px` counted as the user's eighth
// off-grid value) and fixed it with `ourMarkupRanges`: ONE list of what we inject, owned by the three
// modules that write it. This reader was left on its private, partial strip. Pointing it at the shared
// one closes today's gap AND makes a fourth injection safe by construction instead of by somebody
// remembering to add it in two places.
//
// The census at the bottom is the part that keeps it closed: a reader of the app's own files that rolls
// its own strip is this bug again, so the test fails on one.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appOwnFiles, appHasNoDataEntry, dataEntryEvidence } from '../src/server/AgentV3/journeyDerivation';
import { blankOurMarkup, ourMarkupRanges } from '../src/server/AgentV3/ourInjectedMarkup';
import { appSignatureHtml } from '../src/server/AgentV3/appSignature';
import { withHonestyBanner } from '../src/server/AgentV3/fakeFeatureScan';
import { previewBridgeSource } from '../src/server/AgentV3/previewBridge';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';
import { HONESTY_BANNER_OPEN, extractHonestyBanner } from '../src/lib/honestyBanner';

/** Everything we inject, built from the modules that really write it — never a paraphrase of it. */
const OUR_BADGE = appSignatureHtml();
const OUR_BANNER = extractHonestyBanner(
  withHonestyBanner('<!doctype html><html><body></body></html>', [
    { kind: 'login', file: 'src/Login.tsx', line: 12, snippet: 'const user = { id: 1 }', keys: ['GOOGLE_CLIENT_ID'] },
  ] as never, 'en')!,
);
const OUR_BRIDGE = `<script>${previewBridgeSource('live')}</script>`;

/** An app with NO data entry of its own: a scoreboard that only renders. */
const PLAIN_APP_BODY = '<div id="root"><h1>Score</h1><p class="score">42</p></div>';

function pageWithOurs(body: string): string {
  return `<!doctype html><html><head><title>Score</title></head><body>${body}\n${OUR_BANNER}\n${OUR_BADGE}\n${OUR_BRIDGE}</body></html>`;
}

describe('what we inject is real, and it is what the old strip missed', () => {
  it('all three pieces are present in the fixture, so the test is about something', () => {
    const page = pageWithOurs(PLAIN_APP_BODY);
    expect(OUR_BADGE.length, 'the badge').toBeGreaterThan(20);
    expect(OUR_BANNER.length, 'the honesty banner').toBeGreaterThan(20);
    expect(OUR_BRIDGE.length, 'the preview bridge').toBeGreaterThan(1000);
    expect(ourMarkupRanges('index.html', page).length, 'all three ranges are found').toBe(3);
  });

  it('🔴 the preview bridge really does carry input/click handlers — this is why it had to go', () => {
    expect(OUR_BRIDGE).toMatch(/addEventListener\(/);
    expect(OUR_BRIDGE).toContain("'input'");
    expect(OUR_BRIDGE).toContain("'click'");
  });
});

describe('🔴 appOwnFiles now hides all three, not one', () => {
  const page = pageWithOurs(PLAIN_APP_BODY);
  const own = appOwnFiles({ 'index.html': page });

  it('the app\'s own markup survives untouched', () => {
    expect(own['index.html']).toContain('<h1>Score</h1>');
    expect(own['index.html']).toContain('class="score"');
  });

  it('…and not one of our three pieces is left in the text the questions read', () => {
    const text = own['index.html']!;
    expect(text, 'our badge').not.toContain('NavBharatAI');
    expect(text, 'our honesty banner').not.toContain(HONESTY_BANNER_OPEN);
    expect(text, 'our honesty banner').not.toContain('nbai-honesty');
    expect(text, 'our preview bridge').not.toContain('addEventListener');
  });

  it('🔒 it BLANKS rather than deletes — every other offset still points at the same character', () => {
    expect(own['index.html']!.length).toBe(page.length);
    // `dataEntryEvidence` reports WHERE it found a sign, so a shifting offset would misreport the place.
    expect(own['index.html']!.indexOf('<h1>Score</h1>')).toBe(page.indexOf('<h1>Score</h1>'));
  });

  it('🔒 it is the SHARED stripper, so a fourth thing we inject is hidden here too, automatically', () => {
    expect(appOwnFiles({ 'index.html': page })['index.html']).toBe(blankOurMarkup('index.html', page));
  });

  it('a non-HTML file and a non-string value are passed through unharmed', () => {
    const files = { 'src/App.tsx': 'export default () => <h1>Score</h1>;', 'data.json': '{"a":1}' };
    expect(appOwnFiles(files)).toEqual(files);
    expect(appOwnFiles({ 'index.html': undefined as unknown as string })['index.html']).toBeUndefined();
    expect(appOwnFiles({})).toEqual({});
    expect(appOwnFiles(null as unknown as Record<string, string>)).toEqual({});
  });
});

describe('🔴 the verdict this changes: a render-only app is not credited with data entry', () => {
  it('a scoreboard carrying our banner, badge and bridge still has NO data-entry surface', () => {
    const files = { 'index.html': pageWithOurs(PLAIN_APP_BODY) };
    expect(dataEntryEvidence(files), 'our instrumentation is not the app taking input').toBeNull();
    expect(appHasNoDataEntry(files)).toBe(true);
  });

  it('🔒 AND A REAL FORM IS STILL FOUND — the strip must never hide the app\'s own input', () => {
    const files = { 'index.html': pageWithOurs(`${PLAIN_APP_BODY}<form><input name="who" /></form>`) };
    expect(dataEntryEvidence(files)).not.toBeNull();
    expect(appHasNoDataEntry(files)).toBe(false);
  });

  it('🔒 a React form component in the app\'s own source is still found', () => {
    const files = { 'src/Add.tsx': 'export default () => <form onSubmit={save}><input value={v} /></form>;' };
    expect(appHasNoDataEntry(files)).toBe(false);
  });
});

describe('🔒 THE CENSUS — a reader of the app\'s own files may not roll its own strip', () => {
  it('journeyDerivation reaches our markup only through the shared list', () => {
    const src = readFileSync(join(__dirname, '../src/server/AgentV3/journeyDerivation.ts'), 'utf8');
    expect(src).toContain("import { blankOurMarkup } from './ourInjectedMarkup'");
    // 🔴 COMMENTS STRIPPED, and this is not tidiness: the first version of this assertion failed on the
    // Q-1021 note that explains the fix, because that note NAMES the helper it removed. A source guard
    // that cannot tell code from the comment describing it fails on its own documentation — the same
    // trap Q-1081's census fell into, closed the same way.
    expect(stripCodeComments(src), 'the partial strip is what Q-1021 removed').not.toContain('withoutAppSignature');
  });

  it('no module outside appSignature.ts uses the badge-only strip to read an app', () => {
    // `withoutAppSignature` is still the right tool for REMOVING the badge (re-signing a document). It is
    // the wrong tool for ASKING WHAT THE APP DOES, which is what this census is about.
    const roots = ['src/server/AgentV3', 'src/server/lib', 'src/lib'];
    const offenders: string[] = [];
    for (const dir of roots) {
      for (const f of walk(join(__dirname, '..', dir))) {
        if (/appSignature\.ts$/.test(f) || /\.test\.tsx?$/.test(f)) continue;
        const text = stripCodeComments(readFileSync(f, 'utf8')); // see the note above — code, not prose about it
        if (/\bwithoutAppSignature\b/.test(text) && /\bappOwnFiles\b|dataEntry/i.test(text)) {
          offenders.push(f.replace(/.*\/navbharatai\//, ''));
        }
      }
    }
    expect(offenders, 'read the app through `blankOurMarkup`, not a private partial strip').toEqual([]);
  });
});

/** Every .ts file under a directory. Local to this test; no production path depends on it. */
function walk(dir: string): string[] {
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
  const out: string[] = [];
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const full = join(dir, name);
    let isDir = false;
    try { isDir = statSync(full).isDirectory(); } catch { continue; }
    if (isDir) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}
