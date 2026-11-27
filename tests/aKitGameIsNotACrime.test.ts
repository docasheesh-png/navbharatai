// A CRICKET GAME IS NOT CSAM — AND A FLAGGED APP IS HELD FOR A PERSON, NOT REFUSED (Q-3560).
//
// Admin report 2026-11-26: publishing a plain cricket game to App Mart was refused with "This app was
// not published: it pairs words describing a child with explicitly sexual words." The cause: the
// publish classifier paired its two word lists ANYWHERE in the app's concatenated source, and the
// game kit's own code carries three.js `object.children` in one file and the word "hardcore" in a code
// comment of another. So every kit-built 3D game was refused.
//
// THE CLASS: whole-document co-occurrence of two word lists over source code is not evidence. The
// fix pairs the halves only inside one phrase (same file, same code statement, within PAIR_WINDOW
// characters, neither half a code identifier). These tests lock the CLASS:
//   • a census — EVERY game recipe's real output, alone and all together, classifies 'general';
//     a new kit file with an innocent word cannot bring the bug back;
//   • the real positives still fire, including a JSX page that splits its words across lines;
//   • and the admin's 2026-11-26 decision: a text finding HOLDS the app for review instead of refusing.
//
// Proven by reversion: putting the old "subject.test(body) && context.test(body)" pairing back in
// classifyPublishedFiles makes the census fail on generate_game_shell (CSAM_SIGNAL + ADULT_CONTENT).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_RECIPES } from '../src/server/lib/gameRecipeLayers';
import {
  classifyPublishedFiles, classifyPublishedText, isCodeToken, ILLEGAL_RULES, PAIR_WINDOW,
} from '../src/server/AgentV3/illegalContentRules';
import { scannableFiles } from '../src/server/AgentV3/ContentSafetyScanner';
import { assessPublishSafety, filesForScan } from '../src/server/lib/storePublishSafety';
import { webAppServableTo } from '../src/server/lib/navStoreWeb';
import { triagePrompt } from '../src/server/lib/promptSafety';

const ROOT = join(__dirname, '..');
const classifyApp = (files: Record<string, string>) => classifyPublishedFiles(scannableFiles(filesForScan(files)));

describe('🔒 census: every kit-built game classifies as an ordinary app', () => {
  for (const [name, generate] of Object.entries(GAME_RECIPES)) {
    it(`${name} — its real output is 'general' and publishes without a hold`, () => {
      const files = generate().files;
      const r = classifyApp(files);
      expect(r.findings.map((f) => `${f.id}: ${f.evidence?.[0]?.file} — ${f.evidence?.[0]?.excerpt}`)).toEqual([]);
      expect(r.contentClass).toBe('general');
      const d = assessPublishSafety(files, true);
      expect(d.holdForReview).toBe(false);
      expect(d.refuse).toBe(false);
    });
  }

  it('the whole kit as ONE app (a full 3D cricket game carries every layer) is still general', () => {
    const all: Record<string, string> = {};
    for (const generate of Object.values(GAME_RECIPES)) Object.assign(all, generate().files);
    expect(classifyApp(all).findings).toEqual([]);
  });

  it('the exact reported shape: `scene.children` and a "hardcore" comment in the same app', () => {
    const shell = [
      '// car control hardcore joystick se nahi honi chahiye',
      ...Array.from({ length: 50 }, (_, i) => `const v${i} = ${i};`),
      'for (const o of this.scene.children) if (o.userData.bounded) this.boundary.keep(o, 0.4);',
    ].join('\n');
    expect(classifyApp({ 'src/game/Game.ts': shell }).findings).toEqual([]);
  });

  it('a three.js-shaped bundle: children/child identifiers next to "explicit"/"xxx" are code, not words', () => {
    const bundle = [
      'function dispose(o){for(const child of o.children){child.geometry.dispose()}} // explicit dispose of child meshes',
      'object.children.push(child);child.parent=object;',
      "const uuid='xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';const minor=v.minor;",
      'if(children[0]&&explicit(children[0]))return;',
    ].join('\n');
    expect(classifyApp({ 'dist/three.module.js': bundle }).findings).toEqual([]);
  });

  it('Devanagari: a kids cricket app and a health page elsewhere are not a pair', () => {
    const files = {
      'src/Home.tsx': '<h1>बच्चों के लिए क्रिकेट खेल</h1>',
      'src/Health.tsx': '<p>यौन स्वास्थ्य के बारे में डॉक्टर से बात करें</p>',
    };
    expect(classifyApp(files).findings).toEqual([]);
    // Same file, but separated by code statements and far apart, is still not one phrase.
    const one = `const a = 'बच्चों का स्कोर';\n${'const pad = 1;\n'.repeat(20)}const b = 'यौन शिक्षा';`;
    expect(classifyApp({ 'src/App.tsx': one }).findings).toEqual([]);
  });
});

describe('🔒 words that are ambiguous ALONE are not half a pair on the publish path', () => {
  // Each of these classified CSAM_SIGNAL or ADULT_CONTENT before Q-3560 (measured).
  for (const page of [
    'A cricket game for kids with a hardcore mode',
    'Hardcore mode: watch the timer',
    'build a hardcore racing game app',
    'School admission form: child name, child sex, date of birth',
    'explicit dispose of child meshes',
  ]) {
    it(JSON.stringify(page), () => expect(classifyPublishedText(page).findings).toEqual([]));
  }

  it('next to a sexual noun the same words still count', () => {
    expect(classifyPublishedText('kids hardcore videos').contentClass).toBe('illegal');
    expect(classifyPublishedText('minors explicit photos').contentClass).toBe('illegal');
    expect(classifyPublishedText('underage sex videos').contentClass).toBe('illegal');
  });
});

describe('what an offending page cannot avoid is still caught', () => {
  it('the classic phrase, in one tag', () => {
    expect(classifyPublishedText('<h1>underage porn gallery</h1>').contentClass).toBe('illegal');
  });

  it('a JSX page that puts the two halves on separate lines is still one phrase', () => {
    const page = '<h1>Underage</h1>\n      <p>porn gallery</p>';
    expect(classifyApp({ 'src/App.tsx': page }).findings.map((f) => f.id)).toContain('CSAM_SIGNAL');
  });

  it('a betting offer split across two sentences is still one offer', () => {
    const r = classifyPublishedText('Play Teen Patti now! Deposit ₹100 via UPI and withdraw your winnings instantly.');
    expect(r.findings.map((f) => f.id)).toContain('REAL_MONEY_GAMBLING');
  });

  it('the window is real: the same two halves far apart in one line are not a pair', () => {
    const far = `underage ${'x'.repeat(PAIR_WINDOW + 20)} porn`;
    expect(classifyPublishedText(far).findings).toEqual([]);
  });

  it('isCodeToken is narrow: property access and calls are code, a sentence-final word is not', () => {
    const t = (s: string, word: string) => { const i = s.indexOf(word); return isCodeToken(s, i, i + word.length); };
    expect(t('a.children', 'children')).toBe(true);
    expect(t('child.position', 'child')).toBe(true);
    expect(t('children[0]', 'children')).toBe(true);
    expect(t('explicit(x)', 'explicit')).toBe(true);
    expect(t('For kids. Fun!', 'kids')).toBe(false);
    expect(t('Games for kids', 'kids')).toBe(false);
  });

  it('prompt triage keeps its WHOLE-MESSAGE pairing — a prompt is prose (Q-3561 added only the word rule)', () => {
    // The sentence is a request; its halves are 60+ characters apart and it still blocks, as before.
    expect(triagePrompt('Build an app for underage users, with a big gallery and many features, that shows porn').verdict).toBe('block');
    const src = readFileSync(join(ROOT, 'src/server/lib/promptSafety.ts'), 'utf8');
    expect(src).toContain('if (matchesUnambiguously(rule.context, body)) {');
    expect(src).not.toContain('pairedPhrases(');
  });

  it('every rule still has both halves (nothing was disabled to make the census pass)', () => {
    for (const rule of ILLEGAL_RULES) {
      expect(rule.subject, rule.id).toBeInstanceOf(RegExp);
      expect(rule.context, rule.id).toBeInstanceOf(RegExp);
    }
  });
});

describe('🔁 a flagged app is HELD for the admin, not refused (admin 2026-11-26)', () => {
  const held = { status: 'unlisted' as const, uid: 'creator', heldForReview: true };

  it('a held app is hidden from everyone but its owner and a store admin — link included', () => {
    expect(webAppServableTo(held, {})).toBe(false);
    expect(webAppServableTo(held, { uid: 'someone-else' })).toBe(false);
    expect(webAppServableTo(held, { uid: 'creator' })).toBe(true);
    expect(webAppServableTo(held, { isStoreAdmin: true })).toBe(true);
  });

  it('once the admin lists it (the hold is cleared) it is public; a removed app serves nobody', () => {
    expect(webAppServableTo({ ...held, status: 'listed', heldForReview: false }, {})).toBe(true);
    expect(webAppServableTo({ ...held, status: 'removed' }, { isStoreAdmin: true })).toBe(false);
    expect(webAppServableTo({ status: 'unlisted', uid: 'c' }, {})).toBe(true);
  });

  const route = readFileSync(join(ROOT, 'src/server/routes/navStore.ts'), 'utf8');
  const body = (start: string): string => {
    const i = route.indexOf(start);
    expect(i, start).toBeGreaterThan(-1);
    const rest = route.slice(i + start.length);
    const next = rest.search(/\n {2}app\.(get|post|put|patch|delete|use)\(/);
    return route.slice(i, next >= 0 ? i + start.length + next : route.length);
  };

  it('the publish stores the hold, unlisted, with the findings — and tells the creator plainly', () => {
    const pub = body("app.post('/api/nav-store/web/publish'");
    expect(pub).toContain('heldForReview: safety.holdForReview,');
    expect(pub).toContain("status: existing?.status === 'listed' && !safety.forceUnlisted ? 'listed' : 'unlisted'");
    expect(pub).toContain('safetyFindings: safety.findings,');
    expect(pub).toContain('heldNotice: safety.heldMessage');
  });

  it('🔒 every route that serves a web app asks the one rule (page, metadata, code, reports)', () => {
    for (const r of [
      "app.get('/api/nav-store/web/app/:id'",
      "app.post('/api/nav-store/web/app/:id/open'",
      "app.post('/api/nav-store/web/app/:id/remix'",
      "app.post('/api/nav-store/web/app/:id/report'",
    ]) expect(body(r), r).toContain('await webAppServable(req, found)');
  });

  it('only the admin’s listing releases the hold; removal still deletes it', () => {
    const review = body("app.post('/api/nav-store/web/admin/review'");
    expect(review).toContain("status: 'listed', heldForReview: false");
    expect(review).toContain('removeWebApp(id, removalReason');
  });

  it('a held app cannot be reacted to or commented on', () => {
    const social = readFileSync(join(ROOT, 'src/server/lib/appMartSocialStore.ts'), 'utf8');
    expect(social).toContain("live: a.status !== 'removed' && !a.heldForReview");
  });
});
