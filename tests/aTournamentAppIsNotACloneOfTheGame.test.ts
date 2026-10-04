/**
 * 🎮 A TOURNAMENT APP FOR A GAME'S PLAYERS IS NOT A CLONE OF THE GAME — autopsy `39e982bd`,
 * Q-515, Q-516 and Q-518: the last three items that report left OPEN.
 *
 * ── Q-516, the one that steered the whole build ────────────────────────────────────────────────────
 *
 * `APP_SCOPE` recorded *"LARGE — clone of Free Fire"*, and that was the request's ONLY scope signal —
 * so one false reading is what handed the build to the mega-app roadmap planner. Measured on `main`
 * before a line was written: `"a tournament app for Free Fire players"` and `"PUBG tournament
 * registration app"` both returned `["asks to clone <game>"]`.
 *
 * A battle royale cannot be cloned by a wallet and a leaderboard, and nobody asked. The product name
 * is followed by a noun naming DATA ABOUT ITS PLAYERS — the prompt's registration fields are literally
 * *"Free Fire IGN"*, *"Free Fire UID"*, *"Free Fire level"* — or the COMPETITION around it
 * (tournament, match, lobby, squad, esports, leaderboard, rank, kills). That is the sixth shape of
 * "the product is being used", after channels, content, markdown, prohibitions and launch verbs, and
 * it joins the same list rather than becoming a sixth special case.
 *
 * The SAME report's `REQUIREMENT_GAPS` called an esports tournament app **ecommerce** and told the
 * builder it was missing *"product catalog + search, order management, inventory tracking"*. The two
 * words came from the payment gateway's own section — *"PayPal **checkout** integration"* and
 * *"capture **orders** on the backend"*. `checkout` is the NAME of PayPal's and Stripe's product.
 * Measured before: `ecommerce` with those three gaps; after: **`fintech`** with KYC, 2FA, fraud/limit
 * checks and an audit log — exactly what an app moving real money needs. `RequirementGapAnalyzer` had
 * already fixed one of that pair (`\border\b`, autopsy 73df1fbb); `checkout` was its unhunted sibling.
 *
 * ── Q-518 ──────────────────────────────────────────────────────────────────────────────────────────
 *
 * The explorer recorded *"OK \"View Details\" — it responded (nothing visibly changed)"* as a PASS. A
 * button labelled **View Details** that changes nothing is a dead control, and a user finds it in their
 * first minute. `unresponsive` already existed for a search box, a sort menu and a theme switch; this
 * is the fourth name that makes "nothing happened" a failure.
 *
 * ── Q-515 — ARGUED AS NOT A DEFECT, with the evidence ──────────────────────────────────────────────
 *
 * The row read *"`SPACING_SNAPPED` fixed 6 values; `DESIGN_CONSISTENCY` reported 27 in the same file —
 * 21 were left"*. **That was wrong, and reading the code says so.** `snapSpacingInSource` returns
 * `changes: [...new Set(changes)]` — DEDUPED to distinct mappings — while the finding counts
 * OCCURRENCES. All 27 were rewritten: the post-snap re-check (autopsy e3b0ce25) found zero violations,
 * which is why that report's `DESIGN_CONSISTENCY` carries `autoResolved: true`. One real defect
 * remains, and it is the one that misled the autopsy: both lines said "N spacing value(s)" for two
 * different units. The note now states both.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import { analyzeRequirementGaps, stripNonDomainUses } from '../src/server/lib/RequirementGapAnalyzer';
import { snapSpacingInSource, spacingSnapNote } from '../src/server/AgentV3/spacingSnap';
import { NAVIGATION_PROMISE, FAILING_VERDICTS, parseExploreOutput, EXPLORE_RESULT_MARKER } from '../src/server/AgentV3/clickExplorer';

const signals = (p: string): string[] => (analyzeAppScope(p) as { signals: string[] }).signals;
const clone = (p: string): boolean => signals(p).some((s) => s.startsWith('asks to clone '));

/** The report's own prompt, in the shape the analysers saw it. */
const REPORT = [
  'BUILD PRIMECLASH ESPORTS — COMPLETE ANDROID APPLICATION',
  'Build a complete, functional Android esports tournament application named PrimeClash Esports.',
  'Registration fields: Full name. Free Fire IGN. Free Fire UID. Mobile number. Email. Password.',
  'Do not automatically trust a user-entered Free Fire level.',
  'Create real-time tournament listings. Tournament types: Solo. Duo. Squad.',
  'Create a premium wallet interface with: Deposited balance. Winning balance. Deposit history. Withdrawal history.',
  'Manual UPI deposit. Copy UPI ID. Dynamic QR code. 12-digit UTR field. Submit deposit request.',
  'PayPal integration. Prepare an optional PayPal checkout integration. Create and capture orders on the backend.',
  'Minimum withdrawal: 200. Maximum withdrawal: 600 per request. Supported methods: UPI ID. Bank account.',
].join('\n');

describe('🎮 Q-516a — an app ABOUT a game is not a clone of it', () => {
  it('no longer calls the report\'s own request a clone', () => {
    expect(clone(REPORT)).toBe(false);
  });

  it('clears the two shapes measured on main before the fix', () => {
    expect(clone('a tournament app for Free Fire players')).toBe(false);
    expect(clone('PUBG tournament registration app')).toBe(false);
  });

  it('still escalates a REAL clone request — the precision lock', () => {
    for (const q of [
      'Make a Free Fire clone',
      'Free Fire jaisa game banao',
      'build a WhatsApp clone',
      'Instagram jaisa app banao',
      'a Netflix clone with subscriptions',
    ]) expect(clone(q), q).toBe(true);
  });

  it('keeps every earlier guard it inherited', () => {
    // channel, content, launch verb, prohibition — the five shapes this list already carried.
    expect(clone('send the APK using WhatsApp')).toBe(false);
    expect(clone('mai isme notes, youtube video ka link dalunga')).toBe(false);
    expect(clone('voice commands: "open YouTube"')).toBe(false);
    expect(clone('Do NOT use copyrighted Spotify assets or branding')).toBe(false);
  });

  it('is one list, not a special case — the nouns are in TOOL_AFTER', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/lib/appScopeAnalyzer.ts'), 'utf8');
    const after = /const TOOL_AFTER = \/[^\n]*/.exec(src)?.[0] ?? '';
    for (const noun of ['ign', 'uid', 'tournament', 'esports', 'leaderboard']) {
      expect(after, noun).toContain(noun);
    }
  });
});

describe('💳 Q-516b — a payment gateway\'s own words are not a shop', () => {
  it('reads the report\'s app as fintech, with the gaps an app moving money needs', () => {
    const g = analyzeRequirementGaps(REPORT);
    expect(g.domain).toBe('fintech');
    expect(g.likelyMissing.join(' ')).not.toContain('inventory');
    expect(g.likelyMissing.join(' ')).not.toContain('catalog');
  });

  it('strips only the gateway\'s vocabulary, and only where nothing sells goods', () => {
    const gateway = 'Prepare an optional PayPal checkout integration. Create and capture orders on the backend.';
    expect(stripNonDomainUses(gateway)).not.toMatch(/checkout|orders/i);
    // A real shop keeps every word it had, whatever it integrates — the precision lock.
    const shop = 'An online store with a cart and Stripe checkout, plus order management.';
    const kept = stripNonDomainUses(shop);
    expect(kept).toMatch(/checkout/i);
    expect(kept).toMatch(/order/i);
    expect(analyzeRequirementGaps(shop).domain).toBe('ecommerce');
  });

  it('leaves a prompt with no gateway alone', () => {
    const plain = 'A simple checkout page for my orders.';
    expect(stripNonDomainUses(plain)).toMatch(/checkout/i);
    expect(analyzeRequirementGaps(plain).domain).toBe('ecommerce');
  });
});

describe('🔎 Q-518 — a control that promises more and shows nothing is dead', () => {
  it('names the labels that promise more content', () => {
    for (const yes of ['View Details', 'view details', 'Details', 'View more', 'See all', 'Read more', 'Learn more', 'Show more', 'Open', 'Expand', 'विवरण']) {
      expect(NAVIGATION_PROMISE.test(yes), yes).toBe(true);
    }
  });

  it('refuses the labels that may legitimately change nothing — precision first', () => {
    // A bare "View" is a grid/list switcher as often as a navigation; Copy, Refresh and Share can all
    // leave the screen exactly as it was.
    for (const no of ['View', 'Copy', 'Refresh', 'Share', 'Save', 'Submit', 'Overview', 'Preview', 'Interview']) {
      expect(NAVIGATION_PROMISE.test(no), no).toBe(false);
    }
  });

  it('is a FAILING verdict, so it reaches the report, the user\'s offer and the repair', () => {
    expect(FAILING_VERDICTS.has('unresponsive')).toBe(true);
  });

  it('carries WHY it was dead back through the parser, so the user\'s sentence cannot lie', () => {
    // A field the page sets and the parser drops is a field nothing reads.
    const line = `${EXPLORE_RESULT_MARKER}${JSON.stringify({
      type: 'press', label: 'View Details', tag: 'button', verdict: 'unresponsive',
      note: 'it promises more to see and showed nothing', errors: [], changed: false, deadReason: 'promise',
    })}`;
    const run = parseExploreOutput(line);
    expect(run.presses).toHaveLength(1);
    expect(run.presses[0].deadReason).toBe('promise');
    // An unknown reason is dropped rather than guessed at.
    const bad = `${EXPLORE_RESULT_MARKER}${JSON.stringify({ type: 'press', label: 'x', tag: 'button', verdict: 'unresponsive', note: 'n', errors: [], changed: false, deadReason: 'nonsense' })}`;
    expect(parseExploreOutput(bad).presses[0].deadReason).toBeUndefined();
  });

  it('gives each reason its own sentence — a colour sentence about a dead link is the defect', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/clickExplorer.ts'), 'utf8');
    expect(src).toContain("p.deadReason === 'promise'");
    expect(src).toMatch(/promises more to see and the screen does not change/);
    expect(src).toMatch(/never changed the app's colours/);
  });

  it('is judged only on a press that changed NOTHING, after every other verdict', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/clickExplorer.ts'), 'utf8');
    expect(src).toContain("if (res.verdict === 'ok' && !res.changed && !res.primedBy && hit.promise)");
  });
});

describe('📏 Q-515 — two numbers, two units, one sentence', () => {
  it('states both, because one of them made an autopsy wrong', () => {
    const css = Array.from({ length: 5 }, (_, i) => `.a${i}{padding:18px;gap:10px;margin:14px}`).join('\n');
    const p = snapSpacingInSource(css)!;
    expect(p.changes).toHaveLength(3);      // distinct mappings
    expect(p.occurrences).toBe(15);         // declarations rewritten
    const note = spacingSnapNote([{ path: 'src/theme.css', content: p.content, changes: p.changes, occurrences: p.occurrences }]);
    expect(note).toContain('15 spacing value(s) (3 distinct)');
  });

  it('says it plainly when the two are the same', () => {
    const one = snapSpacingInSource('.x{padding:18px}')!;
    expect(one.occurrences).toBe(1);
    expect(spacingSnapNote([{ path: 'a.css', content: one.content, changes: one.changes, occurrences: one.occurrences }]))
      .toContain('1 spacing value(s) in');
  });

  it('rewrites EVERY occurrence while reporting the distinct values — the fact the row got wrong', () => {
    // 🔎 Mixed values on purpose: three identical 18px share a divisor of 18, which `isCoherentOtherGrid`
    // reads as the file having its own 18px rhythm and leaves alone. That guard is correct and my first
    // draft of this case tripped it — recorded so nobody "fixes" the snapper to break a design system.
    const css = '.a{padding:18px}.b{padding:18px}.c{padding:18px;gap:10px}';
    const p = snapSpacingInSource(css)!;
    expect(p.content).not.toMatch(/18px|10px/);
    expect(p.changes).toEqual(['18px → 16px', '10px → 8px']);
    expect(p.occurrences).toBe(4);
  });

  it('leaves a file that is coherently on ANOTHER grid exactly as written', () => {
    expect(snapSpacingInSource('.a{padding:18px}.b{padding:30px}.c{padding:42px}')).toBeNull();
  });
});
