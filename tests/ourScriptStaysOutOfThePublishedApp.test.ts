import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripBridgeFromBuiltFile } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { injectPreviewBridge, hasPreviewBridge, PREVIEW_BRIDGE_MARKER } from '../src/server/AgentV3/previewBridge';

/**
 * 🔴 OUR INSTRUMENTATION SHIPPED INSIDE THE USER'S PUBLISHED APP
 * (deep re-autopsy of build `9cca1fd5`, 2026-09-17; the claim survived three adversarial lenses).
 *
 * `injectPreviewBridge` writes NavBharatAI's console mirror into the SANDBOX's `index.html` so the live
 * preview can report runtime errors — correct, and it must stay there. But Vite copies that same
 * document into `dist/`, `downloadDistFiles` reads `dist/` back verbatim, and that Map is what a
 * publish uploads, what the bucket mirror serves and what the GitHub push writes into the user's own
 * repository.
 *
 * The comment at the injection site asserted the opposite **in writing** — *"the DURABLE files are
 * untouched, so a download, a publish and the user's own code never see it"* — which is why the gap
 * survived: the claim read like a guarantee, so nobody checked it.
 *
 * ⚠️ WHAT THIS IS AND IS NOT. The adversarial pass killed the scarier reading: the bridge's inbound
 * gate is satisfied only by a script already running IN that page, which already has full DOM access,
 * so it grants an attacker nothing on a top-level page. What remains is ~18 KB of unminified
 * NavBharatAI code inside a page that is otherwise a few hundred bytes, visible in View Source and
 * pushed into the user's repo. A white-label and trust defect, not a security incident — and this
 * file says so rather than overstating it.
 */

const REAL_PAGE = '<!doctype html><html><head><title>My App</title></head>'
  + '<body><div id="root"></div><script type="module" src="/assets/index-a1b2c3.js"></script></body></html>';

describe('🔴 the built index.html a publish uploads', () => {
  const bridged = injectPreviewBridge(REAL_PAGE, 'live');

  it('the bridge really is in the document Vite copies (otherwise there is nothing to fix)', () => {
    expect(hasPreviewBridge(bridged)).toBe(true);
    expect(bridged.length).toBeGreaterThan(REAL_PAGE.length + 1000);
  });

  it('🔴 and it is gone from what leaves the sandbox', () => {
    const out = stripBridgeFromBuiltFile('index.html', Buffer.from(bridged, 'utf8'));
    expect(hasPreviewBridge(out.toString('utf8'))).toBe(false);
    expect(out.toString('utf8')).not.toContain(PREVIEW_BRIDGE_MARKER);
  });

  it("🔒 the user's OWN page survives intact — this removes ours, not theirs", () => {
    const out = stripBridgeFromBuiltFile('index.html', Buffer.from(bridged, 'utf8')).toString('utf8');
    expect(out).toContain('<title>My App</title>');
    expect(out).toContain('<div id="root"></div>');
    expect(out).toContain('/assets/index-a1b2c3.js');
  });

  it('a nested built document is treated the same', () => {
    const out = stripBridgeFromBuiltFile('nested/page.html', Buffer.from(bridged, 'utf8'));
    expect(hasPreviewBridge(out.toString('utf8'))).toBe(false);
  });
});

/**
 * ⚠️ NAMED HONESTLY AFTER A REVERSION SHOWED THE FIRST NAME OVERSOLD IT.
 *
 * This block was called "binaries are never decoded, let alone rewritten". Removing the marker
 * pre-filter left all of it passing — because the helper's `stripped === text ? bytes : …` line
 * already returns the ORIGINAL Buffer whenever nothing changed. So correctness never depended on the
 * pre-filter; it is a COST guard, and the tests below prove the half they can: a binary comes back
 * byte-identical, as the same object. The pre-filter's own reason is asserted from the source instead,
 * where it is a claim about work avoided rather than about bytes.
 *
 * Claiming a guarantee a test does not prove is how a suite comes to be trusted for the wrong reasons.
 */
describe('🔒 a binary comes back untouched — the same Buffer, not merely an equal one', () => {
  it('a PNG with no marker comes back as the SAME Buffer object, byte for byte', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x01]);
    const out = stripBridgeFromBuiltFile('assets/logo.png', png);
    expect(out).toBe(png);          // identity, not merely equality
    expect(out.equals(png)).toBe(true);
  });

  it('a hashed JS bundle is untouched', () => {
    const js = Buffer.from('export const a=1;//# sourceMappingURL=index.js.map', 'utf8');
    expect(stripBridgeFromBuiltFile('assets/index-a1b2c3.js', js)).toBe(js);
  });

  it('invalid UTF-8 that happens to be large is still never decoded', () => {
    const blob = Buffer.alloc(4096, 0xc3);
    expect(stripBridgeFromBuiltFile('assets/font.woff2', blob)).toBe(blob);
  });

  it('empty input is safe', () => {
    const empty = Buffer.alloc(0);
    expect(stripBridgeFromBuiltFile('index.html', empty)).toBe(empty);
  });
});

describe('🔒 `withoutPreviewBridge` stays the ONLY authority on what is stripped', () => {
  it('a NON-html file carrying the marker is left alone — this wrapper adds no new rule', () => {
    // The marker appears, so the cheap byte test passes and the helper decodes — but the shared
    // authority declines, because it is not an HTML document. The bytes must come back unchanged.
    const js = Buffer.from(`console.log(${JSON.stringify(PREVIEW_BRIDGE_MARKER)});`, 'utf8');
    const out = stripBridgeFromBuiltFile('assets/app.js', js);
    expect(out.toString('utf8')).toContain(PREVIEW_BRIDGE_MARKER);
  });

  it('an html file with no bridge is returned as the same Buffer', () => {
    const plain = Buffer.from(REAL_PAGE, 'utf8');
    expect(stripBridgeFromBuiltFile('index.html', plain)).toBe(plain);
  });
});

/**
 * 🔒 REVERSION GUARDS — the wiring, and the two homes that look tidier and are traps.
 */
describe('the wiring — proven by reversion', () => {
  const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const E2B = src('../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');

  it('every file leaving `dist/` goes through the strip', () => {
    expect(E2B).toContain('files.set(relPath, stripBridgeFromBuiltFile(relPath, Buffer.from(base64, \'base64\')));');
  });

  it('🔒 the SANDBOX copy is still bridged — stripping it would switch the live console off', () => {
    // The injection must still write the bridged document back to the sandbox.
    expect(E2B).toContain('const bridged = injectPreviewBridge(current, \'live\');');
    expect(E2B).toContain('await sandbox.files.write(full, bridged);');
  });

  it('🔒 NOT done at the workspace level — StaticPreview injects no bridge, so a plain HTML app would get a permanently empty console', () => {
    const staticPreview = src('../src/server/runtime/StaticPreview.ts');
    expect(staticPreview).not.toContain('previewBridge');
    const workspaceFiles = src('../src/server/AgentV3/WorkspaceFiles.ts');
    expect(workspaceFiles).not.toContain('withoutPreviewBridge');
  });

  it('🔒 NOT a wrapper in the actuator factory — a delegating object drops the duck-typed sandboxHeldSeconds and sandbox billing becomes ₹0', () => {
    const factory = src('../src/server/routes/actuatorFactory.ts');
    expect(factory).not.toContain('withoutPreviewBridge');
    expect(factory).not.toContain('stripBridgeFromBuiltFile');
  });

  it('the cheap byte test is there, so `dist/` assets are not decoded for a question about HTML', () => {
    // A COST guard, not a correctness one — see the note above the binary block.
    expect(E2B).toContain('if (!bytes.includes(PREVIEW_BRIDGE_MARKER)) return bytes;');
  });

  it('the injection site no longer claims a publish cannot see it', () => {
    expect(E2B).not.toContain('so a download, a publish and the user\'s own code never see it');
    expect(E2B).toContain('The download and the publish DID see it');
  });
});
