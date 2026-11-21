/**
 * failedbr #672 / #673 (queue Q-3219): our preview bridge sits in the sandbox's index.html. `read_file` strips it, but
 * the agent's `grep` read the file directly — a search for "network error" returned our own
 * `reportHttp(…, 'request failed (network error)')`, and the user's "fix this network error" (the bridge's own words)
 * was chased through our script as if it were the app's.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { injectPreviewBridge, bridgeLineRanges, withoutBridgeGrepMatches } from '../src/server/AgentV3/previewBridge';

const page = '<!doctype html>\n<html>\n<head>\n<title>Shop</title>\n</head>\n<body>\n<div id="root"></div>\n<script type="module" src="/src/main.tsx"></script>\n</body>\n</html>\n';

describe('a search does not return our preview script', () => {
  const html = injectPreviewBridge(page);
  const ranges = bridgeLineRanges(html);
  const lines = html.split('\n');
  const inBridge = lines.findIndex((l) => l.includes('network error')) + 1;
  const appLine = lines.findIndex((l) => l.includes('id="root"')) + 1;

  it('the bridge\'s lines are known, and the app\'s are outside them', () => {
    expect(ranges.length).toBe(1);
    expect(inBridge).toBeGreaterThan(0);
    expect(ranges.some(([a, b]) => inBridge >= a && inBridge <= b)).toBe(true);
    expect(ranges.some(([a, b]) => appLine >= a && appLine <= b)).toBe(false);
    expect(bridgeLineRanges(page)).toEqual([]);
  });

  it('matches inside the bridge are hidden and counted; the app\'s and other files\' matches stay', async () => {
    const out = await withoutBridgeGrepMatches(
      `./index.html:${inBridge}:      reportHttp(url, 0, 'request failed (network error)')\nsrc/api.ts:12:  throw new Error('network error')\nindex.html:${appLine}:<div id="root"></div>`,
      async () => ranges,
    );
    expect(out).not.toMatch(/reportHttp/);
    expect(out).toMatch(/src\/api\.ts:12/);
    expect(out).toMatch(new RegExp(`index\\.html:${appLine}`));
    expect(out).toMatch(/1 match\(es\) inside NavBharatAI's own preview script were hidden/);
    const onlyOurs = await withoutBridgeGrepMatches(`index.html:${inBridge}:x`, async () => ranges);
    expect(onlyOurs).toMatch(/^\(no matches in the app's own code\)/);
    expect(await withoutBridgeGrepMatches('src/a.ts:1:x', async () => [])).toBe('src/a.ts:1:x');
  });

  it('wired: the grep tool filters through it', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(src).toContain('const shown = await withoutBridgeGrepMatches(reading.text, async (p) => bridgeLineRanges(await this.actuator.readFile(this.workspaceId, p)));');
  });
});
