import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { needsRealServer, builtAServer, tallyServerNecessity, necessityHeadline } from '../src/server/AgentV3/serverNecessity';

/**
 * ADMIN 2026-08-12, on whether the in-browser preview could replace E2B: "koi to jugad koi to rasta
 * hoga?" There is, and it is not the preview — it is the architecture the builder chooses.
 *
 * The dukaan stock app was built as Express + Postgres + bcryptjs + multer, which forces a real Linux
 * VM for every preview and every verification. It needed none of it: login, a product list, a search
 * box, a photo and a daily total are all things a browser can do directly against a hosted database.
 * The engine was never asked whether a server was necessary, so it built one, and the VM bill followed
 * from a decision nobody made on purpose.
 *
 * This module measures the gap. It exists BEFORE any builder change, because a plan built on a guessed
 * percentage is a guess wearing a roadmap — and if the gap is small, the plan should not proceed.
 */

// The admin's real prompt, verbatim from the report.
const DUKAAN = `Meri chhoti dukaan ke liye ek stock app banao.
- Login ho (email se)
- Saaman add kar sakun: naam, price, kitne piece hain, aur ek photo
- Saari cheezon ki list dikhe, upar search box ho
- Jis cheez ke 5 se kam piece bache hon, woh laal dikhe
- Ek page par aaj ka total stock ka hisaab dikhe
Mobile par acha dikhna chahiye. Data save rehna chahiye.`;

describe('the dukaan app never needed a server', () => {
  it('says so', () => {
    /**
     * THE WHOLE ARGUMENT, in one assertion. Login, a list, a search box, a photo and a total are
     * ordinary hosted-database features. Every one of them was implemented with Express + Postgres +
     * bcrypt + multer instead, and that is what made the VM mandatory.
     */
    expect(needsRealServer(DUKAAN).needed).toBe(false);
  });

  it('…and the build gave it one anyway — which is the number being measured', () => {
    const paths = ['server/index.ts', 'server/auth.ts', 'server/db.ts', 'src/App.tsx'];
    expect(builtAServer(paths)).toBe(true);
    const t = tallyServerNecessity([{ prompt: DUKAAN, paths }]);
    expect(t.builtButNotNeeded).toBe(1);
    expect(t.neededAndBuilt).toBe(0);
  });
});

describe('what genuinely cannot run in a browser', () => {
  const needs = (p: string) => needsRealServer(p).needed;

  it('a webhook — a browser tab has no address to give', () => {
    expect(needs('payment ke baad webhook aana chahiye')).toBe(true);
  });

  it('taking money, in English and in Hinglish', () => {
    expect(needs('add Razorpay checkout')).toBe(true);
    expect(needs('user se paise lena hai UPI se')).toBe(true);
    expect(needs('subscription plans with refunds')).toBe(true);
  });

  it('a scheduled job — it must run when nobody has the app open', () => {
    expect(needs('har roz subah report bheje')).toBe(true);
    expect(needs('send a daily email reminder')).toBe(true);
    expect(needs('cron job every hour')).toBe(true);
  });

  it('a secret key — public the moment it ships inside the app', () => {
    expect(needs('use the OpenAI api key to summarise')).toBe(true);
    expect(needs('SMS otp bhejna hai')).toBe(true);
  });

  it('heavy native work', () => {
    expect(needs('generate a PDF invoice')).toBe(true);
    expect(needs('scrape prices from a website')).toBe(true);
  });

  it('the reason is stated in the user\'s terms, not ours', () => {
    const r = needsRealServer('add Cashfree payment');
    expect(r.reasons.join(' ')).toMatch(/payment gateway confirms the payment to a server/);
    expect(r.reasons.join(' ')).not.toMatch(/express|node|lambda/i);
  });
});

describe('what people ASSUME needs a server and does not', () => {
  /**
   * This block is the plan's actual argument. Each of these is a normal hosted-database feature that a
   * browser talks to directly — and every one of them appeared in the dukaan app.
   */
  const needs = (p: string) => needsRealServer(p).needed;

  it('login, signup and sessions', () => {
    for (const p of ['login ho email se', 'signup and login page', 'users ka account bane']) {
      expect(needs(p), p).toBe(false);
    }
  });

  it('saving data, lists, search and sorting', () => {
    for (const p of ['data save rehna chahiye', 'list dikhe with search box', 'sort by price']) {
      expect(needs(p), p).toBe(false);
    }
  });

  it('photo upload', () => {
    expect(needs('ek photo bhi add kar sakun')).toBe(false);
  });

  it('realtime and dashboards', () => {
    expect(needs('live updates dikhe sabko')).toBe(false);
    expect(needs('ek dashboard with charts and totals')).toBe(false);
  });

  it('an empty or missing prompt claims nothing', () => {
    for (const p of ['', '   ', null, undefined]) expect(needsRealServer(p as any).needed).toBe(false);
  });
});

describe('what counts as "the build produced a server"', () => {
  it('server/ backend/ and top-level api/ do', () => {
    expect(builtAServer(['server/index.ts'])).toBe(true);
    expect(builtAServer(['backend/app.js'])).toBe(true);
    expect(builtAServer(['api/orders.ts'])).toBe(true);
    expect(builtAServer(['functions/handler.ts'])).toBe(true);
  });

  it('src/api/client.ts does NOT — it is a browser fetch helper', () => {
    /**
     * THE PRECISION LINE. The dukaan app had `src/api/client.ts`, and counting it would inflate the
     * exact number this measurement exists to establish. A browser-native app talking to a hosted
     * database has a file like this and no server at all.
     */
    expect(builtAServer(['src/api/client.ts', 'src/App.tsx'])).toBe(false);
    expect(builtAServer(['src/server/mock.ts'])).toBe(false);
  });

  it('a pure frontend is not a server', () => {
    expect(builtAServer(['src/App.tsx', 'index.html', 'package.json'])).toBe(false);
    expect(builtAServer([])).toBe(false);
  });
});

describe('the tally, and the caveat it refuses to drop', () => {
  const builds = [
    { prompt: DUKAAN, paths: ['server/index.ts'] },                       // built, not needed
    { prompt: 'a todo list app', paths: ['src/App.tsx'] },                // neither
    { prompt: 'shop with Razorpay checkout', paths: ['server/pay.ts'] },  // both
    { prompt: 'send a daily email report', paths: ['src/App.tsx'] },      // needed, missing
  ];

  it('sorts every build into exactly one bucket', () => {
    const t = tallyServerNecessity(builds);
    expect(t.examined).toBe(4);
    expect(t.builtButNotNeeded).toBe(1);
    expect(t.neitherNeededNorBuilt).toBe(1);
    expect(t.neededAndBuilt).toBe(1);
    expect(t.neededButMissing).toBe(1);
  });

  it('counts WHY a server was needed, so the biggest genuine blocker is visible', () => {
    const t = tallyServerNecessity(builds);
    expect(Object.values(t.reasonCounts).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('a build with neither prompt nor files is skipped, not counted as browser-native', () => {
    // Counting it would quietly flatter the very result this measurement exists to test.
    const t = tallyServerNecessity([{ prompt: '', paths: [] }, { prompt: '  ', paths: null }]);
    expect(t.examined).toBe(0);
    expect(t.neitherNeededNorBuilt).toBe(0);
  });

  it('the headline states the share AND that it is an upper bound', () => {
    /**
     * The number drives a large decision, and a number presented without its limits is how a large
     * change gets approved on a misunderstanding. It reads the request's WORDING, so a requirement the
     * user never wrote down counts as "not needed".
     */
    const h = necessityHeadline(tallyServerNecessity(builds));
    expect(h).toMatch(/50% of 4 builds/);
    expect(h).toMatch(/1 were given one anyway/);
    expect(h).toMatch(/UPPER BOUND/);
  });

  it('says so honestly when there is nothing to measure', () => {
    expect(necessityHeadline(tallyServerNecessity([]))).toMatch(/No builds with enough recorded detail/);
  });
});

describe('WIRING — measured from real builds, and it changes nothing', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/admin.ts'), 'utf8');
  const store = readFileSync(join(process.cwd(), 'src/server/AgentV3/DiagnosticsStore.ts'), 'utf8');

  it('an admin-only endpoint runs it over stored builds', () => {
    expect(route).toContain("app.get('/api/admin/server-necessity', verifyAdminToken");
    expect(route).toContain('const tally = tallyServerNecessity(builds);');
  });

  it('it returns a SAMPLE, so the classifier can be spot-checked rather than trusted', () => {
    // A percentage produced by a regex nobody has seen is not evidence.
    expect(route).toContain('const sample = builds.slice(0, 25)');
    expect(route).toContain('reasons: n.reasons');
  });

  it('the reader takes the file PATHS from the manifest — no file contents, no extra query', () => {
    expect(store).toContain('export async function listPromptsAndPaths');
    expect(store).toContain('fileHashes ?? {})');
  });

  it('nothing about how builds RUN is touched by this measurement', () => {
    // Read-only by construction: the module exports pure functions and one list reader.
    const mod = readFileSync(join(process.cwd(), 'src/server/AgentV3/serverNecessity.ts'), 'utf8');
    expect(mod).not.toMatch(/process\.env|writeFile|runCommand|actuator/);
  });
});
