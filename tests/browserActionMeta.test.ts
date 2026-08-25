import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseActionMeta } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';

/**
 * ⚠️ THE ERROR THE ADMIN SAW, TWICE IN ONE BUILD (2026-08-25, a racing game):
 *
 *     Tool call failed: Unterminated string in JSON at position 65536
 *     Tool call failed: Unterminated string in JSON at position 65536
 *
 * 65536 is 64KB exactly — the cap E2B puts on `commands.run` stdout. The browser-action script wrote
 * its screenshot to a FILE for precisely that reason, with a comment saying so, and wrote its METADATA
 * to stdout one line below. On a complex page a Playwright failure dumps candidate selectors and DOM
 * context into `result`, passes 65536, and the JSON arrives cut mid-string.
 *
 * TWICE because `withDaemonRetry` re-ran the same doomed call, and the unguarded `JSON.parse` threw
 * both times — so the model was told its BROWSER was broken when the browser had worked perfectly. It
 * lost the ability to interact with the app it had just built, on exactly the builds most likely to
 * need it: the complex ones, on weak providers that cannot afford wasted turns.
 *
 * This is the THIRD sibling of one bug in this file — the dist reader and the screenshot were already
 * moved off stdout for the same reason.
 */
describe('a browser action never reports OUR read failure as the app failing', () => {
  it('reads a normal payload', () => {
    const m = parseActionMeta(JSON.stringify({ result: 'clicked Start', url: 'http://localhost:5173/', cursorX: 10, cursorY: 20 }));
    expect(m).toEqual({ result: 'clicked Start', url: 'http://localhost:5173/', cursorX: 10, cursorY: 20 });
  });

  it('turns a TRUNCATED payload into an honest sentence, not a parser error', () => {
    // The real shape: valid JSON cut mid-string at the 64KB boundary.
    const truncated = `{"result":"ERROR: locator resolved to 0 elements${'x'.repeat(400)}`;
    const m = parseActionMeta(truncated);
    expect(m.result).toContain('too large to read back');
    // The distinction that matters: it must NOT claim the page broke.
    expect(m.result).toContain('not necessarily affected');
  });

  it('says so when there is nothing at all to read', () => {
    expect(parseActionMeta('').result).toContain('returned nothing');
    expect(parseActionMeta('   ').result).toContain('returned nothing');
  });

  it('never throws, whatever it is handed', () => {
    for (const junk of ['', 'null', '[]', '{', 'not json', '{"result":123}', JSON.stringify({ url: 5 })]) {
      expect(() => parseActionMeta(junk)).not.toThrow();
      expect(typeof parseActionMeta(junk).result).toBe('string');
    }
  });

  it('drops fields of the wrong type rather than passing them on', () => {
    const m = parseActionMeta(JSON.stringify({ result: 'ok', url: 5, cursorX: 'a' }));
    expect(m.url).toBeUndefined();
    expect(m.cursorX).toBeUndefined();
  });
});

describe('and the payload is routed off stdout in the first place', () => {
  const src = readFileSync(
    join(__dirname, '..', 'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');

  it('the script writes its meta to a file, like the screenshot beside it', () => {
    expect(src).toContain("writeFileSync('${TOOLS_DIR}/last-action.json', meta)");
  });

  it('...and caps result, so a future channel with its own limit cannot revive this', () => {
    // An error message longer than this is useless to a model anyway. Belt as well as braces.
    expect(src).toContain('String(result).slice(0,4000)');
  });

  it('the reader prefers the file and falls back to stdout', () => {
    // A sandbox that is already warm still holds the OLD script on disk, so the fallback is what keeps
    // this from breaking every live workspace the moment it deploys.
    expect(src).toContain('last-action.json');
    expect(src).toContain('parseActionMeta(metaRaw || result.stdout.trim())');
  });

  it('no unguarded JSON.parse of that stdout remains', () => {
    expect(src).not.toContain('JSON.parse(result.stdout.trim()) as { result: string');
  });
});

/**
 * THE SIBLING (rule 3). The element scan read the same capped stdout, and its payload GROWS WITH THE
 * PAGE — every element carries a selector, text, a rect and four computed styles. So the richer the
 * app, the more certainly it was truncated; its try/catch turned that into "no elements found"; and an
 * empty scan is indistinguishable from a simple page.
 *
 * The engine went blind on exactly the pages it most needed to see, and said nothing. Third instance
 * of one bug in one file, after the dist reader and the screenshot.
 */
describe('the element scan is off stdout too', () => {
  const src = readFileSync(
    join(__dirname, '..', 'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');

  it('the scan script writes a file', () => {
    expect(src).toContain("writeFileSync('${TOOLS_DIR}/last-scan.json', JSON.stringify(out))");
  });

  it('the reader prefers it, and still falls back to stdout for a warm sandbox', () => {
    expect(src).toContain('last-scan.json');
    expect(src).toContain('const raw = scanRaw || run.stdout.trim();');
  });

  it('still answers "we did not see", never "there is nothing there"', () => {
    // `scanned: false` was always the honest word and is deliberately kept. The fix does not change
    // what an unreadable scan REPORTS — it makes that branch rare instead of routine on a real app.
    const at = src.indexOf('const raw = scanRaw || run.stdout.trim();');
    const after = src.slice(at, at + 900);
    expect(after).toContain('scanned: false');
    expect(after).toContain('scanned: true');
  });

  it('no stdout-only JSON parse is left in the file', () => {
    // The three siblings — dist reader, screenshot, and now these two — are the whole set. A fourth
    // added later should have to look at this line.
    expect(src).not.toContain('JSON.parse(run.stdout.trim())');
  });
});
