/**
 * ADMIN 2026-09-28: "sundar aur real cheez bane fake/farzi nahi!!" — over a screenshot of a calculator
 * rendered in a serif "0" with browser-default buttons, that a real browser had opened, judged RENDERED,
 * and called "verified ✓".
 *
 * Every render check asked whether the app RAN. None asked whether one line of its CSS had reached the
 * page. renderStyle.ts is that question: the browser script measures the painted page (author CSS rules,
 * a font rule, default-looking buttons), a pure judge reads it, and the route records UNSTYLED_RENDER,
 * tells the user in plain words with a one-tap repair, and stops the summary from calling a raw-HTML page
 * "beautifully designed". Evidence, never a gate — it fails no build and moves no money.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  judgeRenderStyle, splitStyleMarker, renderStyleNote, unstyledRenderUserNote,
  STYLE_MARKER, STYLE_EVIDENCE_JS, MIN_ELEMENTS_TO_JUDGE, MIN_DEFAULT_BUTTONS,
  type RenderStyleEvidence,
} from '../src/server/AgentV3/renderStyle';
import { splitPaintMarker } from '../src/server/AgentV3/PreviewVerify';
import { browsePageScript } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { auditSummaryClaims } from '../src/server/AgentV3/claimAudit';
import { buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const ev = (o: Partial<RenderStyleEvidence>): RenderStyleEvidence => ({ rules: 40, fontRule: true, buttons: 5, styledButtons: 5, elements: 60, ...o });

describe('1 · the judge', () => {
  it('🔴 the screenshot: not one CSS rule on the page, default buttons — UNSTYLED, strong', () => {
    const v = judgeRenderStyle(ev({ rules: 0, fontRule: false, buttons: 18, styledButtons: 0, elements: 42 }));
    expect(v.verdict).toBe('unstyled');
    expect(v.verdict === 'unstyled' && v.strong).toBe(true);
    expect(v.reason).toMatch(/not one CSS rule/);
  });

  it('rules exist but no font and every button browser-default — UNSTYLED, weak', () => {
    const v = judgeRenderStyle(ev({ rules: 6, fontRule: false, buttons: MIN_DEFAULT_BUTTONS, styledButtons: 0 }));
    expect(v.verdict).toBe('unstyled');
    expect(v.verdict === 'unstyled' && v.strong).toBe(false);
  });

  it('a styled app is styled — one styled button or a font rule is enough to clear the weak test', () => {
    expect(judgeRenderStyle(ev({ rules: 6, fontRule: false, buttons: 4, styledButtons: 1 })).verdict).toBe('styled');
    expect(judgeRenderStyle(ev({ rules: 6, fontRule: true, buttons: 4, styledButtons: 0 })).verdict).toBe('styled');
    expect(judgeRenderStyle(ev({})).verdict).toBe('styled');
  });

  it('PRECISION FIRST — no evidence or too small a page is unknown, never an accusation', () => {
    expect(judgeRenderStyle(undefined).verdict).toBe('unknown');
    expect(judgeRenderStyle(null).verdict).toBe('unknown');
    expect(judgeRenderStyle(ev({ rules: 0, elements: MIN_ELEMENTS_TO_JUDGE - 1 })).verdict).toBe('unknown');
    // A page with rules, no font and two default buttons is not enough to call raw HTML.
    expect(judgeRenderStyle(ev({ rules: 3, fontRule: false, buttons: MIN_DEFAULT_BUTTONS - 1, styledButtons: 0 })).verdict).toBe('styled');
  });

  it('Tailwind counts: the runtime compiler puts its rules on the page, so a utility-class app is styled', () => {
    expect(judgeRenderStyle(ev({ rules: 900, fontRule: false, buttons: 6, styledButtons: 6 })).verdict).toBe('styled');
  });
});

describe('2 · the marker travels beside the paint marker without disturbing it', () => {
  const stdout = `${STYLE_MARKER}{"rules":0,"fontRule":false,"buttons":18,"styledButtons":0,"elements":42}\nNBAI_PAINTED:1\n<html><body><div id="root"><button>0</button></div></body></html>`;

  it('splitStyleMarker reads the evidence and splitPaintMarker still yields the same html', () => {
    const { style } = splitStyleMarker(stdout);
    expect(style).toEqual({ rules: 0, fontRule: false, buttons: 18, styledButtons: 0, elements: 42 });
    const { painted, html } = splitPaintMarker(stdout);
    expect(painted).toBe(true);
    expect(html).toBe('<html><body><div id="root"><button>0</button></div></body></html>');
  });

  it('no marker, or a garbled one, is unknown — an older script or a curl fallback accuses nobody', () => {
    expect(splitStyleMarker('NBAI_PAINTED:1\n<html></html>').style).toBeUndefined();
    expect(splitStyleMarker(`${STYLE_MARKER}{not json\nNBAI_PAINTED:1`).style).toBeUndefined();
    // Hostile or odd numbers are clamped, never trusted into the judge.
    expect(splitStyleMarker(`${STYLE_MARKER}{"rules":-4,"fontRule":"yes","buttons":2.9,"elements":1e999}`).style)
      .toEqual({ rules: 0, fontRule: false, buttons: 2, styledButtons: 0, elements: 0 });
  });

  it('🔴 the browse script measures a PAINTED page and prints the marker BEFORE the paint marker', () => {
    const script = browsePageScript('https://x.e2b.app/');
    expect(script).toContain(`console.log(${JSON.stringify(STYLE_MARKER)}+JSON.stringify(styleEv))`);
    expect(script).toContain('if(painted){var styleEv=await p.evaluate(');
    expect(script.indexOf(STYLE_MARKER)).toBeLessThan(script.indexOf("console.log('NBAI_PAINTED:'+painted)"));
    expect(script).toContain(STYLE_EVIDENCE_JS);
  });

  it('the in-page measurement is real JavaScript that runs against a document', () => {
    // A minimal DOM double — enough to execute every branch of the evaluate body.
    const rule = (cssText: string) => ({ cssText });
    const doc = {
      styleSheets: [
        { cssRules: [rule('body{font-family:system-ui}'), rule('.k{border-radius:12px}')] },
        { get cssRules(): never { throw new Error('cross-origin'); } },
      ],
      querySelectorAll: () => [{}, {}, {}],
      body: { querySelectorAll: () => new Array(30) },
    };
    const fn = new Function('document', 'getComputedStyle', `return (${STYLE_EVIDENCE_JS})();`);
    const out = fn(doc, () => ({ backgroundColor: 'rgb(239, 239, 239)', borderStyle: 'outset', borderRadius: '0px', paddingLeft: '6px', paddingTop: '1px' }));
    expect(out).toEqual({ rules: 3, fontRule: true, buttons: 3, styledButtons: 0, elements: 30 });
    const styled = fn(doc, () => ({ backgroundColor: 'rgb(79, 70, 229)', borderStyle: 'none', borderRadius: '12px', paddingLeft: '16px', paddingTop: '10px' }));
    expect(styled.styledButtons).toBe(3);
  });
});

describe('3 · what the user and the admin are told', () => {
  const strong = judgeRenderStyle(ev({ rules: 0, fontRule: false, buttons: 18, styledButtons: 0, elements: 42 }));
  const weak = judgeRenderStyle(ev({ rules: 6, fontRule: false, buttons: 4, styledButtons: 0 }));

  it('the report line: UNSTYLED_RENDER at warning for either unstyled verdict, RENDER_STYLE info when styled, nothing when unknown', () => {
    expect(renderStyleNote(strong, 'render rescue')).toMatchObject({ code: 'UNSTYLED_RENDER', severity: 'warning', autoResolved: false });
    expect(renderStyleNote(strong, 'render rescue')!.message).toMatch(/never reached the page/);
    expect(renderStyleNote(weak, 'preview verify')).toMatchObject({ code: 'UNSTYLED_RENDER', severity: 'warning' });
    expect(renderStyleNote(judgeRenderStyle(ev({})), 'x')).toMatchObject({ code: 'RENDER_STYLE', severity: 'info', autoResolved: true });
    expect(renderStyleNote(judgeRenderStyle(undefined), 'x')).toBeNull();
  });

  it('the user note is added only for the strong case, names no tool, and offers the repair', () => {
    expect(unstyledRenderUserNote(strong)).toMatch(/none of its styles had loaded/);
    expect(unstyledRenderUserNote(strong)).toMatch(/fix the styling/);
    expect(unstyledRenderUserNote(strong)).not.toMatch(/tailwind|vite|css module|playwright|chromium/i);
    expect(unstyledRenderUserNote(weak)).toBe('');
    expect(unstyledRenderUserNote(judgeRenderStyle(ev({})))).toBe('');
  });

  it('the finding card offers a one-tap repair for UNSTYLED_RENDER, and nothing for the clean RENDER_STYLE line', () => {
    const offers = buildFindingSuggestions([
      { code: 'UNSTYLED_RENDER', severity: 'warning', message: 'raw html' },
      { code: 'RENDER_STYLE', severity: 'info', message: 'styled' },
    ] as never);
    expect(offers.map((o) => o.id)).toEqual(['found-unstyled-render']);
    expect(offers[0].prompt).toMatch(/global stylesheet is imported/);
  });

  it('🔴 "a beautiful, polished UI" about a raw-HTML page is contradicted; the same words about a styled page are not', () => {
    const base = { consoleCaptured: false };
    expect(auditSummaryClaims('Your calculator has a beautiful, polished UI with a dark theme.', { ...base, renderUnstyled: true }).map((c) => c.kind)).toEqual(['design-claimed']);
    expect(auditSummaryClaims('Your calculator has a professionally designed interface.', { ...base, renderUnstyled: true }).map((c) => c.kind)).toEqual(['design-claimed']);
    expect(auditSummaryClaims('Aapka calculator bahut sundar ban gaya hai.', { ...base, renderUnstyled: true }).map((c) => c.kind)).toEqual(['design-claimed']);
    expect(auditSummaryClaims('Your calculator has a beautiful, polished UI.', { ...base, renderUnstyled: false })).toEqual([]);
    expect(auditSummaryClaims('Your calculator has a beautiful, polished UI.', base)).toEqual([]);
    // Not a claim about looks: a code-quality adjective, or "responsive".
    expect(auditSummaryClaims('The code is clean and the layout is responsive.', { ...base, renderUnstyled: true })).toEqual([]);
  });
});

describe('4 · 🔒 the wiring, read from the source — tsc and vitest cannot see a measurement nobody records', () => {
  const route = read('src/server/routes/agentv3.ts');
  const actuator = read('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');

  it('browseUrl returns the evidence, parsed from the raw stdout', () => {
    expect(actuator).toContain('const { style } = splitStyleMarker(pw.stdout);');
    expect(actuator).toContain("return { html, painted, source: 'browser', style };");
  });

  it('both render checks that see the app paint hand the shot to the judge', () => {
    expect(route).toContain("if (verdict.rendered) { noteRenderStyle(shot, 'render rescue');");
    expect(route).toContain("if (verdict.rendered) { noteRenderStyle(shot, 'preview verify');");
    // A curl snapshot never ran the app's CSS and is never judged.
    expect(route).toContain("if (shot.source !== 'browser') return;");
  });

  it('the verdict reaches the claim audit and the user summary', () => {
    expect(route).toContain("renderUnstyled: currentRenderStyle()?.verdict === 'unstyled',");
    expect(route).toContain('unstyledRenderUserNote(styleVerdict)');
  });
});
