// Q-1133 — A GITHUB FAILURE IS ANSWERED IN OUR OWN WORDS, NOT GITHUB'S.
//
// 🔴 THE DEFECT, as four routes shipped it:
//
//     res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
//
// GitHub's own wording became the WHOLE error: "Not Found", "Bad credentials",
// "Git Repository is empty." Each is true and each tells a non-technical person nothing about
// what to do next. `github.ts` carried three of them; `cloudsync.ts` the fourth.
//
// ⚠️ AND THE HUNT FOUND A FIFTH THE ROW NEVER NAMED. `github.ts`'s push-enhanced catch had a
// fallback sentence of OURS — which is why it looked fixed — but GitHub's message still came
// first, so it read exactly like the other four whenever GitHub supplied one. The row said
// "github.ts (×3) and cloudsync.ts"; the shape said five. The shape was right.
//
// 🧬 THE CLASS IS THAT WRITING THE SENTENCE WAS EACH ROUTE'S OWN JOB. `mobileShip.ts` already had
// the considered form — a curated hint per status, the upstream message kept as a secondary
// `detail` — and it stayed one route's private good habit for as long as nothing required it.
// So the count below is not the point; the DOOR is. These assertions fail when a NEW route
// answers a GitHub failure by hand, which is the sibling that does not exist yet.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { githubApiErrorAnswer } from '../src/server/lib/githubApiError';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';

const ROOT = process.cwd();

function serverFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p); continue; }
      if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(relative(ROOT, p).split('\\').join('/'));
    }
  };
  walk(join(ROOT, 'src/server'));
  return out;
}

/** The upstream message read out of an axios-shaped error. */
const UPSTREAM_MESSAGE = /response\s*\??\.\s*data\s*\??\.\s*message/;

describe('a GitHub failure is answered in our own words', () => {
  it('no server file hands the upstream message over as the error the user reads', () => {
    const offenders: string[] = [];
    for (const file of serverFiles()) {
      const src = stripCodeComments(readFileSync(join(ROOT, file), 'utf8'));
      for (const [i, line] of src.split(/\r?\n/).entries()) {
        if (!UPSTREAM_MESSAGE.test(line)) continue;
        // `detail:` / `const detail =` is the ALLOWED use — secondary context beside our sentence.
        if (/\bdetail\b\s*[:=]/.test(line)) continue;
        // Anything that puts it in the `error` field, or hands it to the door as the public
        // message, is the defect — whatever fallback follows the `||`.
        if (/\berror\s*:/.test(line) || /sendSafeError\s*\(/.test(line)) {
          offenders.push(`${file}:${i + 1}  ${line.trim()}`);
        }
      }
    }
    expect(offenders, 'route these through sendGithubApiError instead').toEqual([]);
  });

  it('every site the row named, and the fifth it did not, goes through the one door', () => {
    const gh = stripCodeComments(readFileSync(join(ROOT, 'src/server/routes/github.ts'), 'utf8'));
    const cs = stripCodeComments(readFileSync(join(ROOT, 'src/server/routes/cloudsync.ts'), 'utf8'));
    // Five sites were fixed; two of them (`/api/github/file`, `/api/github/branches`) were then
    // DELETED in the same change under CLAUDE.md's undecided-route rule, because no caller for
    // either has ever existed. What survives is fetch + push-enhanced here, import in cloudsync.
    expect((gh.match(/sendGithubApiError\(/g) ?? []).length, 'fetch + push-enhanced').toBe(2);
    expect((cs.match(/sendGithubApiError\(/g) ?? []).length).toBe(1);
  });

  it('the two deleted routes are gone, and gone from the undecided baseline with them', () => {
    const gh = readFileSync(join(ROOT, 'src/server/routes/github.ts'), 'utf8');
    const code = stripCodeComments(gh);
    expect(code).not.toContain("app.post('/api/github/file'");
    expect(code).not.toContain("app.post('/api/github/branches'");
    // The deletion is recorded in the file, in the shape the route below it already uses.
    expect(gh).toContain('DELETED 2026-10-17');
    const baseline = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/uncalledApiRoutesBaseline.json'), 'utf8'));
    expect(Object.keys(baseline)).not.toContain('POST /api/github/file');
    expect(Object.keys(baseline)).not.toContain('POST /api/github/branches');
  });

  it('names what the user was doing, and says what to do — never GitHub\u2019s own wording', () => {
    const notFound = githubApiErrorAnswer({ response: { status: 404, data: { message: 'Not Found' } } }, 'file');
    expect(notFound.error).toContain('open that file');
    expect(notFound.error).not.toBe('Not Found');
    // GitHub's wording survives as context, not as the answer.
    expect(notFound.detail).toBe('Not Found');

    const bad = githubApiErrorAnswer({ response: { status: 401, data: { message: 'Bad credentials' } } }, 'fetch');
    expect(bad.error).toMatch(/[Rr]econnect GitHub/);
    expect(bad.error).not.toContain('Bad credentials');
  });

  it('a GitHub outage is not reported as the user\u2019s bad request', () => {
    expect(githubApiErrorAnswer({ response: { status: 500 } }, 'push').status).toBe(502);
    expect(githubApiErrorAnswer({ response: { status: 503 } }, 'push').status).toBe(502);
    // The user's own 4xx keeps its status — it is genuinely about their request.
    expect(githubApiErrorAnswer({ response: { status: 404 } }, 'push').status).toBe(404);
  });

  it('a call that never reached GitHub says so, instead of becoming a 500 with no words', () => {
    const offline = githubApiErrorAnswer(new Error('getaddrinfo ENOTFOUND api.github.com'), 'import');
    expect(offline.status).toBe(502);
    expect(offline.error).toMatch(/could not reach GitHub/i);
    expect(offline.detail).toBeUndefined();
  });

  it('every action has its own wording, so the hint can never name the wrong thing', () => {
    const actions = ['fetch', 'file', 'branches', 'push', 'import'] as const;
    const said = actions.map((a) => githubApiErrorAnswer({ response: { status: 404 } }, a).error);
    expect(new Set(said).size, 'each action reads differently').toBe(actions.length);
    for (const s of said) expect(s.length).toBeGreaterThan(20);
  });

  it('an empty or whitespace upstream message does not become an empty detail', () => {
    expect(githubApiErrorAnswer({ response: { status: 403, data: { message: '   ' } } }, 'fetch').detail).toBeUndefined();
    expect(githubApiErrorAnswer({ response: { status: 403, data: {} } }, 'fetch').detail).toBeUndefined();
  });
});
