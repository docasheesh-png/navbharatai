// Q-2641 / BR1969 — the injected "made by NavBharatAI" badge was named as a 42px sideways
// overflow on a 390×844 phone (224px wide, reaching 420px). A transformed html/body is the
// containing block for position:fixed and grows with overflowing content (a wide race track),
// so right:12px was 12px from that wide block.
//
// New injections pin the badge to the visual viewport (reviewer CSS plus
// right: calc(12px + 100% - 100vw) for a wider containing block). Existing version-2 signed
// apps are not rewritten. [data-nbai-signature] is NOT exempted in mobileLayoutCheck.
//
// Chromium headless is not runnable on every machine (the existing badge/phone suites skip
// visibly when /opt/pw-browsers is absent). These fixtures are therefore proven with the CSS
// containing-block geometry the overflow depends on, at 390×844, against the HTML we actually
// inject.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  APP_SIGNATURE_LABEL,
  APP_SIGNATURE_MARKER,
  APP_SIGNATURE_VERSION,
  appSignatureHtml,
  hasCurrentAppSignature,
  injectAppSignature,
} from '../src/server/AgentV3/appSignature';

const PHONE = { width: 390, height: 844 } as const;
/** The width MOBILE_LAYOUT_ISSUES recorded for this badge on BR1969. */
const HISTORICAL_BADGE_WIDTH = 224;
const OVERFLOW_TOLERANCE_PX = 4;

const PLAIN = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"><h1>Hi</h1><p>ok</p></div></body></html>`;
const TRANSFORMED = `<!doctype html><html style="transform:translateZ(0)"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;transform:scale(1)"><div id="root" style="transform:translate3d(0,0,0)"><h1>Hi</h1></div></body></html>`;
const WIDE_TRACK = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"><div class="track" style="width:700px;height:80px;background:#ddd">bike race track</div></div></body></html>`;
const TRANSFORMED_WIDE_TRACK = `<!doctype html><html style="transform:translateZ(0)"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;transform:translateZ(0)"><div id="root"><div class="track" style="width:700px;height:80px;background:#ddd">bike race track</div></div></body></html>`;

const OLD_V2 = `<div data-nbai-signature="2" style="position:fixed;right:12px;bottom:12px;z-index:2147483647;display:flex;align-items:center;gap:4px"><a href="https://navbharatai.com">made by NavBharatAI</a></div>`;

function hasTransform(style: string | undefined): boolean {
  return !!style && /(?:^|;)\s*transform\s*:/.test(style) && !/(?:^|;)\s*transform\s*:\s*none\b/.test(style);
}

function tagStyle(html: string, tag: 'html' | 'body'): string | undefined {
  const m = html.match(new RegExp(`<${tag}\\b([^>]*)>`, 'i'));
  if (!m) return undefined;
  return (m[1].match(/\bstyle="([^"]*)"/i) || [])[1];
}

/**
 * Containing-block geometry for a body-level `position:fixed` badge at 390×844.
 * When html or body has a transform, it becomes the CB and grows with overflowing in-flow content.
 * A transform on #root does not — injectAppSignature places the badge as a body sibling of #root.
 */
function measureBadge(html: string, contentWidth: number, opts: { reviewerRightOnly?: boolean } = {}) {
  const signed = html.includes(`${APP_SIGNATURE_MARKER}=`) ? html : injectAppSignature(html);
  const htmlTf = hasTransform(tagStyle(signed, 'html'));
  const bodyTf = hasTransform(tagStyle(signed, 'body'));
  const transformed = htmlTf || bodyTf;
  const vw = PHONE.width;
  const cbWidth = transformed ? Math.max(vw, contentWidth) : vw;
  const inset = 12;
  const reviewerRight = inset; // env(safe-area-inset-right) is 0 in these fixtures
  const containingBlockCompensated = inset + cbWidth - vw;
  const right = opts.reviewerRightOnly ? reviewerRight : Math.max(reviewerRight, containingBlockCompensated);
  const maxWidth = vw - 24;
  const width = Math.min(HISTORICAL_BADGE_WIDTH, maxWidth);
  const rightEdge = cbWidth - right;
  const leftEdge = rightEdge - width;
  const overflowRight = Math.max(0, rightEdge - vw);
  const overflowLeft = Math.max(0, -leftEdge);
  return {
    signed,
    transformed,
    cbWidth,
    width,
    leftEdge,
    rightEdge,
    overflowRight,
    overflowLeft,
    overflowsPhone: overflowRight > OVERFLOW_TOLERANCE_PX || overflowLeft > OVERFLOW_TOLERANCE_PX,
    badgeBeforeBody: signed.toLowerCase().lastIndexOf('</body>') > signed.indexOf(APP_SIGNATURE_MARKER),
    badgeOutsideRoot: !signed.includes(`id="root">${appSignatureHtml().slice(0, 20)}`),
  };
}

describe('Q-2641: new injections keep the badge inside a 390×844 phone', () => {
  it('keeps the 32×32 CSS-only close control, body-level injection, and reviewer viewport CSS', () => {
    const b = appSignatureHtml();
    expect(APP_SIGNATURE_VERSION).toBe('2');
    expect(b).toContain(`${APP_SIGNATURE_MARKER}="2"`);
    expect(b).toContain('width:32px;height:32px;flex:none');
    expect(b).toMatch(/<input type="checkbox"/);
    expect(b).not.toMatch(/<script|\bon[a-z]+=/i);
    expect(b).toContain('left:auto');
    expect(b).toContain('box-sizing:border-box');
    expect(b).toContain('width:max-content');
    expect(b).toContain('max-width:calc(100vw - 24px)');
    expect(b).toContain('right:max(12px, env(safe-area-inset-right, 0px), calc(12px + 100% - 100vw))');
    expect(b).toContain('bottom:max(12px, env(safe-area-inset-bottom, 0px))');
    expect(b).toContain('min-width:0');
    expect(b).toContain('text-overflow:ellipsis');
    expect(b).toContain('white-space:nowrap');
    expect(b).toContain(APP_SIGNATURE_LABEL);
    const out = injectAppSignature(PLAIN);
    expect(out.indexOf(APP_SIGNATURE_MARKER)).toBeGreaterThan(out.indexOf('id="root"'));
    expect(out.indexOf(APP_SIGNATURE_MARKER)).toBeLessThan(out.toLowerCase().lastIndexOf('</body>'));
  });

  it('does not rewrite an existing version-2 signed app', () => {
    const already = PLAIN.replace('</body>', `${OLD_V2}\n</body>`);
    expect(hasCurrentAppSignature(already)).toBe(true);
    expect(injectAppSignature(already)).toBe(already);
    expect(already).toContain('right:12px;bottom:12px');
    expect(already).not.toContain('calc(12px + 100% - 100vw)');
  });

  it('does not exempt [data-nbai-signature] in mobileLayoutCheck', () => {
    const src = readFileSync('src/server/AgentV3/mobileLayoutCheck.ts', 'utf8');
    expect(src).not.toContain('data-nbai-signature');
    expect(src).not.toContain('APP_SIGNATURE');
    expect(src).not.toContain('nbai-signature');
  });
});

describe('Q-2641 fixtures at 390×844', () => {
  it('a plain page keeps the badge inside the phone', () => {
    const m = measureBadge(PLAIN, 390);
    expect(m.transformed).toBe(false);
    expect(m.badgeBeforeBody).toBe(true);
    expect(m.overflowsPhone).toBe(false);
    expect(m.rightEdge).toBeLessThanOrEqual(PHONE.width);
    expect(m.leftEdge).toBeGreaterThanOrEqual(0);
  });

  it('a transformed html/body/parent without extra width still fits', () => {
    const m = measureBadge(TRANSFORMED, 390);
    expect(m.transformed).toBe(true);
    expect(m.overflowsPhone).toBe(false);
    expect(m.cbWidth).toBe(390);
    expect(m.rightEdge).toBe(378);
  });

  it('a wide track like BR1969’s racer does not push a viewport-fixed badge off the phone', () => {
    const m = measureBadge(WIDE_TRACK, 700);
    expect(m.transformed).toBe(false);
    expect(m.cbWidth).toBe(390);
    expect(m.overflowsPhone).toBe(false);
    expect(m.rightEdge).toBe(378);
  });

  it('a transformed html/body plus a wide track stays on the visual viewport (the extra right calc)', () => {
    const shipped = measureBadge(TRANSFORMED_WIDE_TRACK, 700);
    expect(shipped.transformed).toBe(true);
    expect(shipped.cbWidth).toBe(700);
    expect(shipped.overflowsPhone).toBe(false);
    expect(shipped.rightEdge).toBe(378);
    expect(shipped.leftEdge).toBe(154);

    // The reviewer’s right:max(12px, env(...)) alone is not enough here — that is BR1969:
    // containing block 432–700px, right:12px, badge reaching past 390.
    const reviewerOnly = measureBadge(TRANSFORMED_WIDE_TRACK, 700, { reviewerRightOnly: true });
    expect(reviewerOnly.rightEdge).toBe(688);
    expect(reviewerOnly.overflowsPhone).toBe(true);
  });
});
