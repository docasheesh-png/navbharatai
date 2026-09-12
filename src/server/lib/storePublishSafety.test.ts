import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  assessPublishSafety, decideFromScan, filesForScan, refusalFor, MAX_RECORDED_FINDINGS,
} from './storePublishSafety';
import type { ContentScanResult } from '../AgentV3/ContentSafetyScanner';
import { classifyPublishedText } from '../AgentV3/illegalContentRules';

const finding = (severity: string, rule = 'R') => ({
  severity: severity as 'critical' | 'high' | 'medium',
  rule, description: 'do something bad.', matchSnippet: 'bad',
});

describe('the App Mart publish scan', () => {
  it('a clean app publishes exactly as before', () => {
    const d = assessPublishSafety({ 'index.html': '<h1>Chai counter</h1><button>Add</button>' });
    expect(d.flagged).toBe(false);
    expect(d.refuse).toBe(false);
    expect(d.forceUnlisted).toBe(false);
    expect(d.findings).toEqual([]);
    expect(d.summary).toBe('');
  });

  it('catches a wallet drainer asking for a recovery phrase', () => {
    const d = assessPublishSafety({ 'index.html': '<p>Enter your 12-word recovery phrase to continue</p>' });
    expect(d.flagged).toBe(true);
    expect(d.summary).toContain('SEED_PHRASE_HARVEST');
  });

  it('catches a brand-impersonation lure', () => {
    const d = assessPublishSafety({
      'app.js': 'render("Your PayPal account has been suspended — verify your identity")',
    });
    expect(d.flagged).toBe(true);
  });
});

describe('🔴 the hole that mattered more than "no scan at all"', () => {
  /**
   * A re-publish keeps its listing. That is right for an ordinary update and completely wrong for a
   * hostile one: publish something clean, wait for an admin to LIST it, then re-publish a phishing
   * page into the same approved listing. `forceUnlisted` is what makes that impossible.
   */
  it('a flagged app loses its listing EVEN IN WARN MODE — publishing is allowed, being featured is not', () => {
    const scan: ContentScanResult = { safe: false, findings: [finding('high')] };
    const warn = decideFromScan(scan, false);
    expect(warn.refuse).toBe(false);        // the app still publishes; its own link still works
    expect(warn.forceUnlisted).toBe(true);  // but it goes back into the review queue
  });

  it('a clean re-publish does NOT disturb a listing it already earned', () => {
    expect(decideFromScan({ safe: true, findings: [] }, false).forceUnlisted).toBe(false);
    expect(decideFromScan({ safe: true, findings: [] }, true).forceUnlisted).toBe(false);
  });

  it('block mode refuses outright, and says why and how to appeal', () => {
    const d = decideFromScan({ safe: false, findings: [finding('high')] }, true);
    expect(d.refuse).toBe(true);
    expect(d.refusalMessage).toContain('do something bad');
    // A refusal with no way back is how an honest creator gets silently lost.
    expect(d.refusalMessage).toContain('Grievance');
  });

  it('a MEDIUM-only finding is recorded but changes nothing — precision over nagging', () => {
    // `safe` stays true for medium, so a cautious pattern cannot take someone's listing away.
    const d = decideFromScan({ safe: true, findings: [finding('medium')] }, true);
    expect(d.flagged).toBe(false);
    expect(d.refuse).toBe(false);
    expect(d.forceUnlisted).toBe(false);
    expect(d.findings).toHaveLength(1); // still visible to a reviewer
  });
});

describe('🔒 the scan can never be the thing that breaks a publish', () => {
  it('a scanner failure reports clean rather than refusing', () => {
    // A safety net that takes the app down when IT breaks is worse than the risk it covers. The
    // files map is deliberately hostile here.
    const d = assessPublishSafety({ a: null as unknown as string, b: undefined as unknown as string }, true);
    expect(d.refuse).toBe(false);
    expect(d.flagged).toBe(false);
  });

  it('non-string content is skipped, never coerced into a fake match', () => {
    const m = filesForScan({ good: 'hello', bad: 42 as unknown as string });
    expect([...m.keys()]).toEqual(['good']);
  });

  it('findings are capped, so one pathological file cannot bloat the record', () => {
    const many = Array.from({ length: 20 }, (_, i) => finding('high', `R${i}`));
    expect(decideFromScan({ safe: false, findings: many }, false).findings).toHaveLength(MAX_RECORDED_FINDINGS);
  });

  it('the refusal names a reason even when the scan gave none', () => {
    expect(refusalFor(undefined)).toContain('unsafe content');
  });
});

describe('wiring — the scan actually runs on the App Mart publish', () => {
  const route = readFileSync(join(__dirname, '..', 'routes', 'navStore.ts'), 'utf8');
  const publish = route.slice(
    route.indexOf("app.post('/api/nav-store/web/publish'"),
    route.indexOf("app.get('/api/nav-store/web/app/:id'"),
  );

  it('runs BEFORE anything is saved — a refused publish leaves nothing behind', () => {
    const scan = publish.indexOf('assessPublishSafety(');
    const save = publish.indexOf('saveWebApp(');
    expect(scan).toBeGreaterThan(0);
    expect(save).toBeGreaterThan(scan);
  });

  it('a flagged app cannot keep a listing on re-publish', () => {
    expect(publish).toContain('!safety.forceUnlisted');
  });

  it('the findings land on the record, so a reviewer sees what the scanner saw', () => {
    expect(publish).toContain('safetyFindings: safety.findings');
  });

  it('🔒 findings are ADMIN-ONLY — never handed to a viewer', () => {
    // Telling a publisher which pattern caught them is free tuning for the next attempt; telling a
    // VIEWER publishes an accusation no human has reviewed yet.
    const store = readFileSync(join(__dirname, 'navStoreWeb.ts'), 'utf8');
    const publicType = store.slice(store.indexOf('export type PublicWebStoreApp'), store.indexOf('export function toPublicWebApp'));
    expect(publicType).not.toContain('safetyFindings');
  });

  it('both refusal and flag are audited, so there is a record either way', () => {
    expect(publish).toContain("audit('STORE_PUBLISH_REFUSED'");
    expect(publish).toContain("audit('STORE_PUBLISH_FLAGGED'");
  });
});

describe('⚡ opening an app waits for one round trip, not two', () => {
  const route = readFileSync(join(__dirname, '..', 'routes', 'navStore.ts'), 'utf8');
  const open = route.slice(
    route.indexOf("app.post('/api/nav-store/web/app/:id/open'"),
    route.indexOf("app.get('/api/nav-store/web/apps'"),
  );

  it('the bake read starts BEFORE the listing read is awaited', () => {
    const start = open.indexOf('readWebAppBake(appId)');
    const awaitListing = open.indexOf('await getWebApp(appId)');
    expect(start).toBeGreaterThan(0);
    expect(awaitListing).toBeGreaterThan(start);
  });

  it('a failed bake read can never fail the open — it falls through to the compile', () => {
    expect(open).toContain('.catch(() => null)');
  });

  it('🔒 the staleness rule is still applied, and still lives in ONE place', () => {
    // The whole risk of moving the check out of the reader is serving a superseded page. It is
    // checked here instead, by the same `bakeIsCurrent` the wrapper uses — not by a second rule.
    expect(open).toContain('bakeIsCurrent(');
    expect(open).toContain('found.version');
    const store = readFileSync(join(__dirname, 'navStoreWeb.ts'), 'utf8');
    expect(store.match(/bakeIsCurrent\(/g)?.length).toBe(1);
  });
});

describe('🔒 the illegal tier refuses UNCONDITIONALLY — no switch reaches it', () => {
  const illegal = classifyPublishedText('underage porn gallery');

  it('blocks even in WARN mode, which is what "saaf-saaf wale cases par block" means', () => {
    // The older judgement-call rules stay behind AGENTV3_PUBLISH_SCAN because a false positive there
    // costs an honest creator their app. A category that is unlawful for everyone must not be
    // reachable by flipping an operations switch.
    const d = decideFromScan({ safe: true, findings: [] }, false, illegal);
    expect(d.refuse).toBe(true);
    expect(d.forceUnlisted).toBe(true);
    expect(d.contentClass).toBe('illegal');
  });

  it('and the +18 setting cannot unlock it either', () => {
    const d = decideFromScan({ safe: true, findings: [] }, false, illegal, { adultOptIn: true });
    expect(d.refuse).toBe(true);
  });

  it('the illegal check comes FIRST, so no later branch can undo it', () => {
    const src = readFileSync(join(__dirname, 'storePublishSafety.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function decideFromScan'));
    expect(fn.indexOf('if (illegal.length > 0)')).toBeLessThan(fn.indexOf('refuse: !scan.safe && blockMode'));
  });

  it('the refusal names the category and the way to appeal, never the matched text', () => {
    const d = decideFromScan({ safe: true, findings: [] }, false, illegal);
    expect(d.refusalMessage).toContain('Grievance');
    expect(d.refusalMessage).not.toContain('underage');
  });
});

describe('the adult tier rides the creator’s own +18 setting', () => {
  const adult = classifyPublishedText('Adult videos — browse categories, 18+ only');

  it('a creator WITH the setting on publishes normally, marked 18+', () => {
    const d = decideFromScan({ safe: true, findings: [] }, false, adult, { adultOptIn: true });
    expect(d.refuse).toBe(false);
    expect(d.contentClass).toBe('adult');
    expect(d.adultWithoutOptIn).toBe(false);
  });

  it('a creator WITHOUT it is not refused — it waits for review, and they are told which switch', () => {
    // They are allowed to build it; they simply have not said they are an adult yet.
    const d = decideFromScan({ safe: true, findings: [] }, false, adult, { adultOptIn: false });
    expect(d.refuse).toBe(false);
    expect(d.forceUnlisted).toBe(true);
    expect(d.adultWithoutOptIn).toBe(true);
  });

  it('an ordinary app is untouched by any of this', () => {
    const d = decideFromScan({ safe: true, findings: [] }, false, classifyPublishedText('<h1>Chai</h1>'), { adultOptIn: false });
    expect(d).toMatchObject({ refuse: false, flagged: false, forceUnlisted: false, contentClass: 'general', adultWithoutOptIn: false });
  });
});

describe('wiring — Phase 5 reaches the real publish', () => {
  const route = readFileSync(join(__dirname, '..', 'routes', 'navStore.ts'), 'utf8');

  it('the publisher’s own +18 setting is read and passed in', () => {
    expect(route).toContain('adultOptIn: publisherAdult.optedIn');
  });

  it('the app’s class is stored, and `illegal` is narrowed away rather than cast', () => {
    // An illegal publish never reaches the save; narrowing means a future reorder stores `general`
    // (harmless, reviewable) instead of silently persisting `illegal`.
    expect(route).toContain("safety.contentClass === 'adult' ? 'adult' as const : 'general' as const");
  });

  it('18+ apps are hidden from browse on the SERVER, not in the client’s render', () => {
    const list = route.slice(route.indexOf("app.get('/api/nav-store/web/apps'"), route.indexOf("app.get('/api/nav-store/web/mine'"));
    expect(list).toContain('hiddenFromBrowse(');
    expect(list).toContain('isNativeRequest(req)');
  });

  it('both rule sets read the SAME text, so they cannot disagree about scope', () => {
    const safety = readFileSync(join(__dirname, 'storePublishSafety.ts'), 'utf8');
    expect(safety).toContain('classifyPublishedText(scannableText(scanned))');
  });
});
