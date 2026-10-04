/**
 * 🧊 A FREEZE THAT STOPS NOTHING, AND A SENTENCE THAT SAID IT WOULD — queue row Q-141.
 *
 * `ReleaseGate.ts` is correct. Its store is correct. Its route is correct. And `AppKnowledgeBase.ts`,
 * which is what EVERY AI in NavBharatAI answers from, said:
 *
 *     "The deploy pipeline checks the public GET /api/release/gate?sha=<commit> before promoting
 *      and refuses to deploy when the gate is closed."
 *
 * It did not. The only check lived in `.github/workflows/deploy.yml`, behind
 * `if: steps.guard.outputs.ready == 'true'` — which needs the `GCP_SA_KEY` + `GCP_PROJECT_ID` repo
 * secrets, and `CLAUDE.md` records that those are not set, so that workflow skips and deploys nothing.
 * The Cloud Build trigger running `cloudbuild.yaml` is what ships every merge, and it had no gate step.
 *
 * **So an admin freezing releases during a live incident saw `Frozen: YES` in red on the admin board,
 * and the next merge deployed anyway.** That is the second absolute rule broken outright — and worse
 * than a faked indicator, because it is a TRUE reading of a control connected to nothing.
 *
 * 🔑 THE CLASS: a claim about a pipeline, written in prose, in a file the pipeline cannot see. No
 * typecheck, no test and no reviewer could catch the drift, because the sentence and the YAML had no
 * relationship at all. So the fix is not a better sentence — it is the relationship. The suite below
 * PARSES both pipeline files and fails when `DEPLOY_PATHS` disagrees with what they actually contain.
 *
 * ⚠️ And the honest answer does not rest on that table where evidence exists: the gate route now
 * records every time a pipeline really asks it, so the admin is told *"no deploy pipeline has ever
 * asked this endpoint"* — a measurement, not a claim.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { execFile, execFileSync } from 'child_process';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import {
  DEPLOY_PATHS,
  primaryDeployPath,
  anyPathEnforcesWithoutConfig,
  freezeEnforcementNote,
  freezeWouldNotHold,
  CHECK_IS_RECENT_MS,
} from '../src/server/lib/releaseGateEnforcement';

const repo = (p: string) => path.join(__dirname, '..', p);
const read = (p: string) => fs.readFileSync(repo(p), 'utf8');

const CLOUDBUILD = read('cloudbuild.yaml');
const DEPLOY_WORKFLOW = read('.github/workflows/deploy.yml');

describe('🧊 the table and the pipeline check each other — the drift that could not be caught', () => {
  it('names every deploy path this repo has, and no path it does not', () => {
    for (const p of DEPLOY_PATHS) expect(fs.existsSync(repo(p.file)), p.file).toBe(true);
    // Exactly one path ships a merge today. Two "primary" paths would mean nobody knows which.
    expect(DEPLOY_PATHS.filter((p) => p.primary)).toHaveLength(1);
    expect(primaryDeployPath().file).toBe('cloudbuild.yaml');
  });

  it('a path claimed to carry the check really references the gate endpoint', () => {
    const text: Record<string, string> = { 'cloudbuild.yaml': CLOUDBUILD, '.github/workflows/deploy.yml': DEPLOY_WORKFLOW };
    for (const p of DEPLOY_PATHS) {
      const src = text[p.file];
      expect(src, `${p.file} must be covered by this test`).toBeTruthy();
      const references = /release[/_-]?gate/i.test(src) && /allowed/.test(src);
      expect(references, `${p.file} claims carriesTheCheck=${p.carriesTheCheck}`).toBe(p.carriesTheCheck);
    }
  });

  it('a path claimed LIVE must not depend on a secret or a substitution', () => {
    // The whole defect was a check that existed and could never run. Any path we call live without
    // config must not be gated on something outside the repo — and today neither is.
    for (const p of DEPLOY_PATHS.filter((x) => x.liveWithoutConfig)) {
      expect(p.needs, `${p.file} is live, so it needs nothing`).toBe('');
    }
    expect(anyPathEnforcesWithoutConfig()).toBe(false);
  });

  it('the GitHub workflow is still gated behind the credentials that are not set', () => {
    // Pinned because this is WHY the old sentence was false. If this ever stops being true, the table
    // above is wrong and this test is the thing that says so.
    expect(DEPLOY_WORKFLOW).toMatch(/steps\.guard\.outputs\.ready == 'true'/);
    expect(DEPLOY_WORKFLOW).toMatch(/GCP_SA_KEY/);
  });
});

describe('🧊 the Cloud Build step cannot stop a deploy by accident', () => {
  const doc = yaml.load(CLOUDBUILD) as { steps: Array<Record<string, unknown>>; substitutions: Record<string, string> };

  it('parses — a malformed cloudbuild.yaml stops EVERY deploy, so this is the first thing to prove', () => {
    expect(Array.isArray(doc.steps)).toBe(true);
    expect(doc.steps.length).toBeGreaterThan(1);
  });

  it('runs the gate FIRST, so a frozen release does not pay for a Docker build either', () => {
    const script = String((doc.steps[0].args as string[])?.[1] ?? '');
    expect(script).toMatch(/_RELEASE_GATE_URL/);
    expect(script).toMatch(/RELEASE GATE CLOSED/);
  });

  it('uses an image the pipeline already pulls — nothing new has to be fetchable', () => {
    const gateImage = String(doc.steps[0].name);
    const images = doc.steps.map((s) => String(s.name));
    expect(images.filter((i) => i === gateImage).length).toBeGreaterThan(1);
  });

  it('exits non-zero ONLY on an explicit allowed:false — every other outcome continues the deploy', () => {
    const script = String((doc.steps[0].args as string[])?.[1] ?? '');
    // Three stand-down paths, each ending in exit 0: not configured, no answer, answer says open.
    expect((script.match(/exit 0/g) ?? []).length).toBe(3);
    expect((script.match(/exit 1/g) ?? []).length).toBe(1);
    // The one exit 1 is inside the allowed:false branch, and nowhere else.
    const beforeExit1 = script.slice(0, script.indexOf('exit 1'));
    expect(beforeExit1).toMatch(/"allowed":\s*false|"allowed": false/);
    // `set +e` so a non-zero curl cannot abort the step before the fail-open branch is reached.
    expect(script).toMatch(/set \+e/);
    expect(script).not.toMatch(/set -e\b/);
  });

  it('declares the substitution AND uses it — Cloud Build fails a build on either half alone', () => {
    // The file's own comment records this trap: MUST_MATCH rejects a substitution declared and never
    // used, and equally one used and never declared. Both halves, asserted.
    expect(Object.keys(doc.substitutions)).toContain('_RELEASE_GATE_URL');
    expect(doc.substitutions._RELEASE_GATE_URL).toBe('');
    expect(CLOUDBUILD).toMatch(/\$\{_RELEASE_GATE_URL\}/);
  });

  it('every substitution the file declares is used somewhere in it', () => {
    // The same trap, swept across all of them rather than only the one added here.
    for (const key of Object.keys(doc.substitutions)) {
      const used = new RegExp(`\\$\\{${key}\\}`).test(CLOUDBUILD);
      expect(used, `${key} is declared but never used — Cloud Build would fail the build`).toBe(true);
    }
  });
});

/**
 * THE STEP ITSELF, RUN. Every assertion above reads the YAML; these RUN the script the YAML carries,
 * against a real HTTP server, and check the exit status — because "a step that cannot stop a deploy by
 * accident" is a claim about behaviour, and this repo has paid for source guards that read like proofs.
 * Cloud Build substitutes `${_RELEASE_GATE_URL}` before bash sees it, which is what the replace does.
 */
describe('🧊 the step RUN — only a closed gate exits non-zero', () => {
  const script = String(((yaml.load(CLOUDBUILD) as { steps: Array<{ args?: string[] }> }).steps[0].args ?? [])[1] ?? '');
  const haveTools = (() => {
    try {
      execFileSync('bash', ['-c', 'command -v curl >/dev/null'], { stdio: 'ignore' });
      return true;
    } catch { return false; }
  })();

  /**
   * Run the step with the substitution resolved; returns its exit status and output.
   *
   * ⚠️ ASYNC ON PURPOSE, and the first draft of this file got it wrong in a way worth recording: with
   * `execFileSync` the bash child blocks THIS process's event loop, so the test's own HTTP server —
   * which lives in the same process — can never accept curl's connection. Every case timed out at
   * curl's own `--max-time 20` and read as "the gate did not answer", i.e. it looked like a PASS of the
   * fail-open path while actually proving nothing at all.
   */
  const runStep = (url: string): Promise<{ code: number; out: string }> => {
    const resolved = script.split('${_RELEASE_GATE_URL}').join(url);
    return new Promise((resolve) => {
      execFile('bash', ['-c', resolved], {
        env: { ...process.env, COMMIT_SHA: 'deadbeefcafe' }, encoding: 'utf8', timeout: 30_000,
      }, (err, stdout) => {
        const code = err ? (typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : -1) : 0;
        resolve({ code, out: String(stdout ?? '') });
      });
    });
  };

  let server: Server | null = null;
  let port = 0;
  beforeAll(async () => {
    if (!haveTools) return;
    server = createServer((q, r) => {
      r.setHeader('content-type', 'application/json');
      if ((q.url ?? '').startsWith('/closed')) {
        r.end(JSON.stringify({ allowed: false, reason: 'Release freeze active: prod incident' }));
      } else if ((q.url ?? '').startsWith('/boom')) {
        r.statusCode = 500; r.end('internal error');
      } else {
        r.end(JSON.stringify({ allowed: true, reason: 'No release gate restrictions are active.' }));
      }
    });
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', () => done()));
    port = (server!.address() as AddressInfo).port;
  });
  afterAll(() => { server?.close(); });

  it.runIf(haveTools)('not configured ⇒ exit 0, and it SAYS a freeze will not stop this deploy', async () => {
    const r = await runStep('');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/A freeze will NOT stop this deploy/);
  });

  it.runIf(haveTools)('gate unreachable ⇒ exit 0, failing OPEN', async () => {
    const r = await runStep('http://127.0.0.1:9/gate');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/failing OPEN/);
  });

  it.runIf(haveTools)('a 500 from the gate ⇒ exit 0 — our own outage must not stop a deploy', async () => {
    const r = await runStep(`http://127.0.0.1:${port}/boom`);
    expect(r.code).toBe(0);
  });

  it.runIf(haveTools)('gate OPEN ⇒ exit 0', async () => {
    const r = await runStep(`http://127.0.0.1:${port}/open`);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Release gate open for deadbeefcafe/);
  });

  it.runIf(haveTools)('gate CLOSED ⇒ exit 1, naming the commit and echoing the reason', async () => {
    const r = await runStep(`http://127.0.0.1:${port}/closed`);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/RELEASE GATE CLOSED for deadbeefcafe/);
    expect(r.out).toMatch(/prod incident/);
  });
});

describe('🧊 the sentence the admin is given is measured, not assumed', () => {
  const NOW = 1_800_000_000_000;

  it('says plainly that a freeze does not hold, when nothing has ever asked the gate', () => {
    const note = freezeEnforcementNote(null, NOW);
    expect(note).toMatch(/DOES NOT STOP A DEPLOY TODAY/);
    expect(note).toMatch(/No deploy pipeline has ever asked this endpoint/);
    expect(note).toMatch(/_RELEASE_GATE_URL/);
    expect(note).toMatch(/cloudbuild\.yaml/);
  });

  it('believes the EVIDENCE over the table once a pipeline has really asked', () => {
    const note = freezeEnforcementNote({ lastCheckedAtMs: NOW - 60_000, checkCount: 7 }, NOW);
    expect(note).toMatch(/does reach the pipeline/);
    expect(note).toMatch(/7 check\(s\)/);
    expect(note).not.toMatch(/DOES NOT STOP/);
  });

  it('stops believing a check that is older than the deploys since', () => {
    const note = freezeEnforcementNote({ lastCheckedAtMs: NOW - CHECK_IS_RECENT_MS - 1, checkCount: 2 }, NOW);
    expect(note).toMatch(/no longer evidence/);
    expect(note).toMatch(/DOES NOT STOP A DEPLOY TODAY/);
  });

  it('never throws on a record with nothing in it', () => {
    expect(freezeEnforcementNote({}, NOW)).toMatch(/DOES NOT STOP/);
    expect(freezeEnforcementNote({ lastCheckedAtMs: Number.NaN }, NOW)).toMatch(/DOES NOT STOP/);
    expect(freezeEnforcementNote(undefined, NOW)).toMatch(/DOES NOT STOP/);
  });

  it('warns on exactly the changes that ask for enforcement, and not on the ones that lift it', () => {
    expect(freezeWouldNotHold({ frozen: true })).toBe(true);
    expect(freezeWouldNotHold({ approvalRequired: true })).toBe(true);
    expect(freezeWouldNotHold({ frozen: false, approvalRequired: false })).toBe(false);
    expect(freezeWouldNotHold(null)).toBe(false);
  });
});

describe('🧊 no surface claims the gate is enforced any more', () => {
  it('the knowledge base every AI answers from no longer promises it', () => {
    const kb = read('src/server/AppContext/AppKnowledgeBase.ts');
    const at = kb.indexOf("id: 'admin-release-gate'");
    expect(at).toBeGreaterThan(-1);
    const entry = kb.slice(at, kb.indexOf("id: 'admin-mfa'", at));
    // The exact sentence that was false.
    expect(entry).not.toMatch(/refuses to deploy when the gate is closed/);
    // And it now names the one thing that has to be set, so an AI can answer "how do I make it real?".
    expect(entry).toMatch(/_RELEASE_GATE_URL/);
    expect(entry).toMatch(/enforcement/);
  });

  it('the admin read returns the sentence, not just the flags', () => {
    const admin = read('src/server/routes/admin.ts');
    const at = admin.indexOf("app.get('/api/admin/release-gate'");
    expect(at).toBeGreaterThan(-1);
    const block = admin.slice(at, at + 900);
    expect(block).toMatch(/freezeEnforcementNote\(/);
    expect(block).toMatch(/lastChecked/);
  });

  it('the admin SCREEN shows it, not only the API — the board is where "Frozen: YES" is read', () => {
    const panel = read('src/components/admin/EngineReportsPanel.tsx');
    const at = panel.indexOf('title="Release gate"');
    expect(at).toBeGreaterThan(-1);
    const card = panel.slice(at, panel.indexOf('</ReportCard>', at));
    expect(card).toMatch(/d\?\.enforcement/);
  });

  it('the public route records the one piece of evidence that exists, without making the pipeline wait', () => {
    const route = read('src/server/routes/releaseGate.ts');
    expect(route).toMatch(/void releaseGateStore\.noteChecked\(sha\)/);
  });

  it('the evidence lives in its own document, because the config is written with merge:false', () => {
    // A field on the config doc would be erased the next time an admin changed the freeze — and the
    // erased field is the evidence that the wiring works.
    const store = read('src/server/lib/ReleaseGateStore.ts');
    expect(store).toMatch(/CHECKS_DOC_ID = 'release_gate_checks'/);
    expect(store).toMatch(/doc\(DOC_ID\)\.set\(normalizeGateConfig\(config\), \{ merge: false \}\)/);
    expect(store).toMatch(/doc\(CHECKS_DOC_ID\)\.set\(\{/);
  });
});
