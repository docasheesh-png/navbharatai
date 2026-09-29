// DID THE RENDERED APP CARRY ANY STYLING AT ALL? — measured in the real browser, judged here, pure.
//
// WHY (admin 2026-09-28, with a screenshot of a calculator rendered in a serif "0" with browser-default
// buttons wrapping inline: "kya aisa calculator banaya ja raha hai! … user ko aise farzi app na mile!").
// That build (2720e553) had been opened in a real browser, judged RENDERED, and told the user "Build
// verified — the app compiles ✓". Every gate asked whether the app RAN. None asked whether a single line
// of the app's own CSS had reached the page. An app with no stylesheet at all and an app with a
// 5,000-character design system paint the same `painted=1`, and the platform could not tell them apart.
//
// The static gates upstream (DesignCoverage, the class check, the stylesheet tier) reason about the
// SOURCE. This is the other half — the PAGE — and it is the one that catches the whole class regardless
// of cause: a stylesheet emptied by a continuation, a stylesheet nobody imported, a CSS Module the
// renderer dropped, a Tailwind the compiler never ran. Whatever the cause, the browser shows raw HTML,
// and raw HTML is what this measures.
//
// EVIDENCE, NOT A GATE. It never fails a build and never moves money: a working unstyled app is still a
// working app under the billing law ("app bani = preview chala"). It records a finding the user is told
// about in plain words, with a one-tap repair offer, and it stops the summary from calling such an app
// "polished" or "beautifully designed". PRECISION FIRST: a page too small to judge, or with no evidence,
// is `unknown` — never an accusation.

/** What the in-sandbox browser script measured on the rendered page. */
export interface RenderStyleEvidence {
  /** Author CSS rules reachable from the document — stylesheets the app (or its runtime compiler) put there. */
  rules: number;
  /** Does any author rule set a font-family? (A page with none renders in the browser's serif default.) */
  fontRule: boolean;
  /** Buttons on the page, and how many of them differ from the browser's default button look. */
  buttons: number;
  styledButtons: number;
  /** Elements in the body — a size floor, so a splash page with three words is never judged. */
  elements: number;
}

/** The line the browser script prints; parsed by `splitStyleMarker` below. */
export const STYLE_MARKER = 'NBAI_STYLE:';

/** A page smaller than this is not an app screen and is never judged. */
export const MIN_ELEMENTS_TO_JUDGE = 8;
/** With this many buttons all still browser-default and no font rule, the app reads as raw HTML. */
export const MIN_DEFAULT_BUTTONS = 3;

/**
 * The body of the `page.evaluate` that measures a rendered page. Kept as a string here — beside the
 * judge that reads its output — so the two halves of one measurement live in one file. It runs INSIDE
 * the app's page, so it is written to never throw: every read is guarded, and a cross-origin stylesheet
 * (a CDN font, a package's CSS) counts as ONE rule because the browser will not let us count its rules.
 *
 * Default-button detection compares against Chromium's UA button: `rgb(239, 239, 239)` background, 0
 * radius, `1px 6px` padding, 2px outset border. A button that changes ANY of those was styled by the app.
 */
export const STYLE_EVIDENCE_JS = `function(){
  var rules=0,fontRule=false;
  try{
    var sheets=document.styleSheets;
    for(var i=0;i<sheets.length;i++){
      var ss=sheets[i];
      try{
        var list=ss.cssRules;
        if(!list){rules+=1;continue;}
        rules+=list.length;
        if(!fontRule){for(var j=0;j<list.length&&j<400;j++){var t=list[j].cssText||'';if(t.indexOf('font-family')>=0){fontRule=true;break;}}}
      }catch(e){rules+=1;}
    }
  }catch(e){}
  var buttons=0,styledButtons=0;
  try{
    var btns=document.querySelectorAll('button,input[type=submit],input[type=button]');
    for(var k=0;k<btns.length&&k<60;k++){
      buttons++;
      var c=getComputedStyle(btns[k]);
      var def=(c.backgroundColor==='rgb(239, 239, 239)'||c.backgroundColor==='rgba(0, 0, 0, 0)'&&c.borderStyle==='outset')&&c.borderRadius==='0px'&&c.paddingLeft==='6px'&&c.paddingTop==='1px';
      if(!def)styledButtons++;
    }
  }catch(e){}
  var elements=0;
  try{elements=document.body?document.body.querySelectorAll('*').length:0;}catch(e){}
  return {rules:rules,fontRule:fontRule,buttons:buttons,styledButtons:styledButtons,elements:elements};
}`;

/**
 * Pull the style line out of the browser script's stdout. Pure; never throws. A stdout with no marker
 * (an older script, a truncated stream, a curl fallback) yields `undefined` — unknown, never "unstyled".
 */
export function splitStyleMarker(stdout: string): { style?: RenderStyleEvidence; rest: string } {
  const text = String(stdout ?? '');
  const at = text.indexOf(STYLE_MARKER);
  if (at < 0) return { rest: text };
  const nl = text.indexOf('\n', at);
  const line = text.slice(at + STYLE_MARKER.length, nl < 0 ? undefined : nl).trim();
  const rest = text.slice(0, at) + (nl < 0 ? '' : text.slice(nl + 1));
  try {
    const raw = JSON.parse(line) as Partial<Record<keyof RenderStyleEvidence, unknown>>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    return {
      rest,
      style: {
        rules: num(raw.rules),
        fontRule: raw.fontRule === true,
        buttons: num(raw.buttons),
        styledButtons: num(raw.styledButtons),
        elements: num(raw.elements),
      },
    };
  } catch {
    return { rest };
  }
}

export type RenderStyleVerdict =
  | { verdict: 'unknown'; reason: string }
  | { verdict: 'styled'; reason: string }
  | { verdict: 'unstyled'; strong: boolean; reason: string };

/**
 * The judgement. Two ways to be unstyled, in order of certainty:
 *   STRONG — not one author CSS rule reached the page. Whatever the source holds, the browser painted
 *            the app with the UA stylesheet alone. This is the "secret calculator" screenshot exactly.
 *   WEAK   — rules exist, but no font-family was ever set and every button on the page still looks like
 *            the browser's default. The app has some CSS and still reads as raw HTML.
 * Anything else with evidence is `styled`; too little page, or no evidence, is `unknown`.
 */
export function judgeRenderStyle(ev: RenderStyleEvidence | undefined | null): RenderStyleVerdict {
  if (!ev) return { verdict: 'unknown', reason: 'the browser check did not measure the page\'s styling' };
  if (ev.elements < MIN_ELEMENTS_TO_JUDGE) {
    return { verdict: 'unknown', reason: `the page has only ${ev.elements} element(s) — too little to judge its styling` };
  }
  if (ev.rules === 0) {
    return {
      verdict: 'unstyled', strong: true,
      reason: `not one CSS rule from the app reached the page (${ev.elements} elements, ${ev.buttons} button(s), all browser-default) — it renders as raw HTML`,
    };
  }
  if (!ev.fontRule && ev.buttons >= MIN_DEFAULT_BUTTONS && ev.styledButtons === 0) {
    return {
      verdict: 'unstyled', strong: false,
      reason: `${ev.rules} CSS rule(s) reached the page, but no font was set and all ${ev.buttons} buttons still look browser-default — it reads as raw HTML`,
    };
  }
  return {
    verdict: 'styled',
    reason: `${ev.rules} CSS rule(s) on the page; ${ev.styledButtons} of ${ev.buttons} button(s) styled${ev.fontRule ? '; a font is set' : ''}`,
  };
}

/** Report codes. `UNSTYLED_RENDER` is an APP finding (the user sees raw HTML); `RENDER_STYLE` is the clean measurement. */
export const UNSTYLED_RENDER_CODE = 'UNSTYLED_RENDER';
export const RENDER_STYLE_CODE = 'RENDER_STYLE';

/** The report line for a verdict — `null` when there is nothing to say (unknown). */
export function renderStyleNote(v: RenderStyleVerdict, where: string): { code: string; severity: 'info' | 'warning'; message: string; autoResolved: boolean } | null {
  if (v.verdict === 'unknown') return null;
  if (v.verdict === 'styled') {
    return { code: RENDER_STYLE_CODE, severity: 'info', autoResolved: true, message: `The rendered app carries its own styling (${where}): ${v.reason}.` };
  }
  return {
    code: UNSTYLED_RENDER_CODE, severity: 'warning', autoResolved: false,
    message: `The app rendered but looks like raw HTML (${where}): ${v.reason}. ${v.strong
      ? 'Its stylesheet never reached the page — check that the global stylesheet is imported by the entry file and still holds its rules.'
      : 'Its styles are too thin to read as a designed product.'}`,
  };
}

/**
 * The sentence added to the user's own summary when the app rendered unstyled — a fact, an offer, and
 * nothing that names a tool. Only for the STRONG case: a weak verdict is a design opinion the finding
 * card already carries, and a correction in the reply must be one nobody could argue with.
 */
export function unstyledRenderUserNote(v: RenderStyleVerdict): string {
  if (v.verdict !== 'unstyled' || !v.strong) return '';
  return '\n\n⚠️ One thing to know: when I opened the app in a browser, none of its styles had loaded — it showed as plain, unstyled HTML. The app works, but it does not yet look designed. Reply "fix the styling" and I will make the stylesheet load and give every screen its proper look.';
}
