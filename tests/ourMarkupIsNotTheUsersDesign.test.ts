/**
 * AUTOPSY 9c612cdb (2026-10-12) — Q-993. The report said:
 *
 *   DESIGN_CONSISTENCY warning "Design consistency 90/100 (A) across 14 file(s). 8 spacing values are off the
 *     4px grid — snap to multiples of 4px for rhythm. Worst: src/index.css (7)."
 *   SPACING_SNAPPED "7 spacing value(s) in 1 file(s) … src/index.css: 10px → 8px, 14px → 12px, 6px → 4px"
 *   …and the model, at write time: "7 spacing values are off the 4px grid — snap to multiples of 4px … fix it now"
 *
 * Four defects of one class — a deterministic platform normaliser and the report and model around it
 * disagreeing about what the app is:
 *   1. the score was recorded BEFORE the snap it described (the shipped 100/100 was never written);
 *   2. the eighth value was OUR badge's `gap:6px` in index.html, graded as the user's design;
 *   3. the snap kept a private comment rule that read `https://` as a `//` comment, so it could not reach
 *      that value while the lint counted it (and it rewrote values inside `<!-- -->`);
 *   4. arithmetic the snap owns was still handed to the model at the write and in `evaluate`;
 * plus the report gap that hid (2): "Worst:" named only files over the per-file threshold.
 *
 * The order fix (1) is locked in tests/theDesignLineSaysWhatIsTrueNow.test.ts; this file locks the rest.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractSpacingPx, offGridSpacing } from '../src/server/AppMakerLab/intelligence/DesignLinter';
import { stripCommentsForMarkup } from '../src/server/AgentV3/stripCodeComments';
import { lintBuiltApp, designLintSummary, LINTABLE_DESIGN_FILE } from '../src/server/AgentV3/buildQualityLint';
import { spacingSnapPatches, snapSpacingInSource } from '../src/server/AgentV3/spacingSnap';
import { appSignatureHtml, injectAppSignature } from '../src/server/AgentV3/appSignature';
import { withHonestyBanner, type FakeFeatureFinding, type FakeFeatureKind } from '../src/server/AgentV3/fakeFeatureScan';
import { extractHonestyBanner } from '../src/lib/honestyBanner';
import { previewBridgeSource, injectPreviewBridge } from '../src/server/AgentV3/previewBridge';
import { blankOurMarkup } from '../src/server/AgentV3/ourInjectedMarkup';
import { DESIGN_KIT_CSS } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/designKit';
import { NATIVE_FEEL_CSS } from '../src/server/AgentV3/nativeFeel';
import { TemplateRegistry } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/TemplateRegistry';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from '../src/server/AgentV3/goldenScaffolds/registry';
import { qualityNote, modelDesignLine, filesANoteStillFlags } from '../src/server/AgentV3/writeTimeQualityCheck';

const SNAP_ON = {} as NodeJS.ProcessEnv;
const SNAP_OFF = { AGENTV3_SPACING_SNAP: 'off' } as NodeJS.ProcessEnv;
const offGrid = (s: string) => offGridSpacing(extractSpacingPx(stripCommentsForMarkup(s)));

const finding = (kind: FakeFeatureKind): FakeFeatureFinding => ({ kind, file: 'src/Login.tsx', line: 3, snippet: "password === 'admin'", requirementId: kind as never });

/** The vite-react starter exactly as a fresh sandbox gets it. */
const STARTER = new TemplateRegistry().getProvider('vite-react').getFiles([]) as Record<string, string>;

/**
 * Our markup as it sits in apps built BEFORE today — the badge's `gap:6px` and the banner's
 * `10px 48px 10px 14px`. Version "2" badges are not re-injected, so this exact markup lives on in real
 * apps; it must never be graded, whatever its values.
 */
const legacyMarked = (html: string): string =>
  withHonestyBanner(injectAppSignature(html), [finding('login')])!
    .replace('gap:8px;padding:8px 12px', 'gap:6px;padding:8px 12px')
    .replace('padding:8px 48px 8px 16px', 'padding:10px 48px 10px 14px');

/** The report's stylesheet shape: seven off-grid values in the app's own index.css. */
const REPORT_CSS = '.app-header{padding:10px 14px;gap:6px}.card{margin:10px;padding:14px}.x{gap:6px;padding:10px}';

describe('our badge, banner and bridge are not the user\'s design', () => {
  it('the legacy markup really is off the grid — so the fixture can fail', () => {
    expect(offGrid(legacyMarked(STARTER['index.html']))).toEqual([6, 10, 10, 14]);
  });

  it('an app with no CSS of its own gets no spacing finding from our markup', () => {
    const lint = lintBuiltApp({ ...STARTER, 'index.html': legacyMarked(STARTER['index.html']) })!;
    expect(lint.design.violations.filter((v) => v.type === 'off-grid-spacing')).toEqual([]);
    expect(lint.offenders['off-grid-spacing']).toBeUndefined();
  });

  it('the report-shaped app: 7 values, all in src/index.css — not 8 with our badge as the eighth', () => {
    const files = { ...STARTER, 'index.html': legacyMarked(STARTER['index.html']), 'src/index.css': `${STARTER['src/index.css'] ?? ''}\n${REPORT_CSS}` };
    const lint = lintBuiltApp(files)!;
    const spacing = lint.design.violations.find((v) => v.type === 'off-grid-spacing')!;
    expect(spacing.message).toMatch(/^7 spacing values are off/);
    expect(designLintSummary(lint)).toContain('Worst: src/index.css (7).');
  });

  it('blanking keeps every offset: same length, same line breaks, user markup untouched', () => {
    const doc = injectPreviewBridge(legacyMarked('<html><head></head><body>\n<div style="padding:10px">x</div>\n</body></html>'), 'live');
    const blank = blankOurMarkup('index.html', doc);
    expect(blank.length).toBe(doc.length);
    expect(blank.split('\n').length).toBe(doc.split('\n').length);
    expect(blank).toContain('<div style="padding:10px">x</div>');
    expect(blank).not.toContain('data-nbai-signature');
    expect(blank).not.toContain('nbai-honesty');
    expect(blankOurMarkup('src/App.tsx', doc)).toBe(doc); // only an HTML document carries our markup
  });
});

describe('📏 census — everything NavBharatAI writes into an app is on the 4px grid', () => {
  it('the badge, the honesty banner (every kind) and the preview bridge', () => {
    expect(offGrid(appSignatureHtml())).toEqual([]);
    for (const kind of ['login', 'oauth-button', 'payment', 'otp', 'email', 'sms', 'upload'] as FakeFeatureKind[]) {
      expect(offGrid(extractHonestyBanner(withHonestyBanner('<html><body></body></html>', [finding(kind)])!)), kind).toEqual([]);
    }
    expect(offGrid(previewBridgeSource('live'))).toEqual([]);
    expect(offGrid(previewBridgeSource('in-browser'))).toEqual([]);
  });

  it('the design kit and the native-feel baseline', () => {
    expect(offGrid(DESIGN_KIT_CSS)).toEqual([]);
    expect(offGrid(NATIVE_FEEL_CSS)).toEqual([]);
  });

  it('every framework starter and every golden scaffold', () => {
    const registry = new TemplateRegistry();
    for (const fw of registry.listFrameworks()) {
      for (const [p, c] of Object.entries(registry.getProvider(fw).getFiles([]))) {
        if (LINTABLE_DESIGN_FILE.test(p)) expect(offGrid(String(c)), `${fw} ${p}`).toEqual([]);
      }
    }
    for (const g of GOLDEN_SCAFFOLDS) {
      for (const [p, c] of Object.entries(goldenScaffoldFiles(g))) {
        if (LINTABLE_DESIGN_FILE.test(p)) expect(offGrid(c), `${g.id} ${p}`).toEqual([]);
      }
    }
  });
});

describe('the snap and the lint read the same text', () => {
  it('the report-shaped build: the snap clears everything the lint counts, and index.html is byte-for-byte ours', () => {
    const html = legacyMarked(STARTER['index.html']);
    const files = { ...STARTER, 'index.html': html, 'src/index.css': `${STARTER['src/index.css'] ?? ''}\n${REPORT_CSS}` };
    const patches = spacingSnapPatches(files, ['index.html', 'src/index.css'], SNAP_ON);
    expect(patches.map((p) => p.path)).toEqual(['src/index.css']);
    expect(patches[0]!.snapped).toBe(7);
    const after = { ...files, ...Object.fromEntries(patches.map((p) => [p.path, p.content])) };
    expect(lintBuiltApp(after)!.design.violations.filter((v) => v.type === 'off-grid-spacing')).toEqual([]);
    expect(after['index.html']).toBe(html);
  });

  it('a snap that DOES rewrite index.html leaves our badge and banner exactly as they were', () => {
    const html = legacyMarked('<html><body>\n<main style="padding:10px;margin:14px;gap:6px"><p style="padding:18px">hi</p></main>\n</body></html>');
    const [patch] = spacingSnapPatches({ 'index.html': html }, ['index.html'], SNAP_ON);
    expect(patch).toBeDefined();
    expect(patch!.snapped).toBe(4);
    expect(patch!.content).toContain('<main style="padding:8px;margin:12px;gap:4px"><p style="padding:16px">');
    const badge = (s: string) => s.slice(s.indexOf('<div data-nbai-signature'), s.indexOf('</div>', s.indexOf('<div data-nbai-signature')) + 6);
    expect(badge(patch!.content)).toBe(badge(html));
    expect(badge(html)).toContain('gap:6px');
    expect(extractHonestyBanner(patch!.content)).toBe(extractHonestyBanner(html));
  });

  it('a value after a URL on the same line is reached (the lint counts it, so the snap must)', () => {
    expect(snapSpacingInSource('.hero{background:url(https://x/y.png);padding:10px}')?.content).toBe('.hero{background:url(https://x/y.png);padding:8px}');
    const nav = '<nav><a href="https://example.com/docs" style="display:flex;gap:6px;padding:10px">Docs</a></nav>';
    expect(snapSpacingInSource(nav, 4, 'src/nav.html')?.content).toContain('gap:4px;padding:8px');
  });

  it('a value inside an HTML comment is neither counted nor rewritten', () => {
    const doc = '<!-- old: padding:10px -->\n<div style="padding:10px"></div>';
    const out = snapSpacingInSource(doc, 4, 'index.html')!;
    expect(out.snapped).toBe(1);
    expect(out.content).toBe('<!-- old: padding:10px -->\n<div style="padding:8px"></div>');
  });

  it('🔒 one comment rule: the snap has no private copy', () => {
    const snap = readFileSync(join(__dirname, '../src/server/AgentV3/spacingSnap.ts'), 'utf8');
    expect(snap).not.toMatch(/function commentRanges/);
    expect(snap).toContain('shippedDesignText(path, source)');
  });
});

describe('the model is never handed arithmetic the platform does', () => {
  const css = '.a{padding:10px}.b{gap:6px}.c{margin:14px}.d{padding:18px}';

  it('the write-time note: silent while the snap is on, said when it is off', () => {
    expect(qualityNote('src/index.css', css, SNAP_ON)).toBe('');
    expect(qualityNote('src/index.css', css, SNAP_OFF)).toContain('off the 4px grid');
  });

  it('the evaluate line: the same lint, minus what the platform fixes', () => {
    const lint = lintBuiltApp({ 'src/index.css': css });
    expect(modelDesignLine(lint, SNAP_ON)).not.toContain('snap to multiples of 4px');
    expect(modelDesignLine(lint, SNAP_ON)).toContain('leave them as they are');
    expect(modelDesignLine(lint, SNAP_OFF)).toContain('snap to multiples of 4px');
    // One comment rule: a commented-out value is not reported to the model either.
    expect(modelDesignLine(lintBuiltApp({ 'src/index.css': `/* ${css} */ .ok{padding:8px}` }), SNAP_OFF)).not.toContain('off the 4px grid');
  });

  it('🔒 evaluate runs the build report\'s lint, not a private one', () => {
    const td = readFileSync(join(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(td).not.toMatch(/import \{[^}]*\blintDesign\b[^}]*\} from '\.\.\/AppMakerLab\/intelligence\/DesignLinter'/);
    expect(td).not.toContain('DESIGN_EXT');
    expect(td).toContain('modelDesignLine(lintBuiltApp(');
  });

  it('"still flagged" is asked in the note\'s own terms', () => {
    const colours = Array.from({ length: 20 }, (_, i) => `.c${i}{color:#${(i * 111111 + 100000).toString(16).slice(0, 6)};padding:8px}`).join('\n');
    const files = { 'src/index.css': css, 'src/theme.css': colours };
    expect(filesANoteStillFlags(files, ['src/index.css', 'src/theme.css'], SNAP_ON)).toEqual([]);
    expect(filesANoteStillFlags(files, ['src/index.css', 'src/theme.css'], SNAP_OFF)).toEqual(['src/index.css']);
  });
});

describe('"Worst:" names every file that adds to the spacing count', () => {
  it('a file with one off-grid value is named beside the file with seven', () => {
    const lint = lintBuiltApp({ 'src/a.css': REPORT_CSS, 'src/b.css': '.z{gap:6px}' })!;
    expect(lint.design.violations.find((v) => v.type === 'off-grid-spacing')!.message).toMatch(/^8 spacing values/);
    expect(designLintSummary(lint)).toContain('Worst: src/a.css (7), src/b.css (1).');
  });

  it('beyond the list, it says how many more', () => {
    const files = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((n) => [`src/${n}.css`, `.${n}{padding:10px}`]));
    expect(designLintSummary(lintBuiltApp(files)!)).toContain('Worst: src/a.css (1), src/b.css (1), src/c.css (1), and 2 more file(s).');
  });
});
