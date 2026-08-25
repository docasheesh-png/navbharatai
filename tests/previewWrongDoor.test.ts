import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { analyzePreviewHtml, hasFrontendSource } from '../src/server/AgentV3/PreviewVerify';

/**
 * ⚠️ THE SAME BODY MEANS TWO DIFFERENT THINGS (admin screenshot 2026-08-25).
 *
 * Their preview showed `{"error":"Not found"}` and the platform called it "the server returned an
 * error instead of the app". That is a wrong diagnosis, and an expensive one: the server was working
 * PERFECTLY. An Express app correctly reports that nothing is routed at `/`. The app was fine — the
 * preview was pointed at the wrong door, at the backend port instead of the site.
 *
 * The two are distinguishable by a fact we already hold: does this workspace contain frontend source?
 * If it does, an API error at the preview URL is a port mismatch. If it does not, the app IS an API
 * and the original wording was right all along.
 */
const API_404 = '{"error":"Not found"}';

describe('an API answering at the preview URL is diagnosed by what the project contains', () => {
  it('with frontend files, it is a WRONG DOOR — not a broken app', () => {
    const v = analyzePreviewHtml(API_404, { hasFrontendFiles: true });
    const line = v.problems.join(' ');
    expect(line).toContain('showing your API, not your web page');
    expect(line).toContain('pointed at the backend port');
    // The thing it must NOT say, because it would send the user hunting a bug that does not exist.
    expect(line).not.toContain('the server returned an error instead of the app');
  });

  it('without them, the app IS an API and the original wording stands', () => {
    expect(analyzePreviewHtml(API_404, { hasFrontendFiles: false }).problems.join(' '))
      .toContain('the server returned an error instead of the app');
  });

  it('unknown changes nothing — an unchecked thing never rewrites a verdict', () => {
    expect(analyzePreviewHtml(API_404, {}).problems.join(' '))
      .toContain('the server returned an error instead of the app');
  });

  it('either way it is still reported as a problem — neither reading is "fine"', () => {
    // A preview the user cannot use is a problem in both worlds. Only the SENTENCE changes.
    for (const ctx of [{ hasFrontendFiles: true }, { hasFrontendFiles: false }, {}]) {
      expect(analyzePreviewHtml(API_404, ctx).problems.length).toBeGreaterThan(0);
    }
  });

  it('a real page is untouched by any of this', () => {
    const page = '<html><body><h1>Chai Counter</h1><p>Track every cup.</p><button>Add</button></body></html>';
    expect(analyzePreviewHtml(page, { hasFrontendFiles: true }).problems.join(' ')).not.toContain('your API');
  });
});

describe('hasFrontendSource — components and pages only', () => {
  it('recognises what a browser is meant to render', () => {
    expect(hasFrontendSource(['src/App.tsx'])).toBe(true);
    expect(hasFrontendSource(['index.html'])).toBe(true);
    expect(hasFrontendSource(['client/src/Board.vue'])).toBe(true);
    expect(hasFrontendSource(['src/Page.svelte'])).toBe(true);
  });

  it('does NOT count .ts — an API project is full of it and has no page to show', () => {
    expect(hasFrontendSource(['src/index.ts', 'src/routes/upi.ts', 'package.json'])).toBe(false);
    expect(hasFrontendSource([])).toBe(false);
  });
});

describe('the call site passes TRUE or UNKNOWN, never FALSE', () => {
  it('because this turn writing no frontend file proves nothing about the project', () => {
    // `writtenFiles` holds only this turn's writes. Passing `false` there would be the
    // artifact-for-evidence mistake, and it would produce the WRONG sentence for a real web app.
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('hasFrontendFiles: hasFrontendSource(writtenFiles.keys()) ? true : undefined,');
  });
});
