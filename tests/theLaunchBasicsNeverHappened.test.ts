/**
 * 🔴 THE LAUNCH BASICS NEVER HAPPENED — every browser-verified build, since Green Freeze shipped
 * (traced from code 2026-09-25, from autopsy e628efd4's nine `GREEN_FREEZE_DEFERRED` writes).
 *
 * WHAT THE REPORT SHOWED, and what made it look like a documentation problem: nine refused writes —
 * `playwright.config.ts`, three `*.test.ts`, `ADR-001.md`, `index.html`, `manifest.webmanifest`,
 * `robots.txt`, `icon.svg` — sitting in the same report as `READINESS_WARNING: No tests at all`.
 * The obvious reading is that the gate marked the app down for files the freeze refused.
 *
 * WHAT IS ACTUALLY TRUE, traced through the route rather than inferred from the report: the green
 * latch is set the moment a real browser confirms the render, and BOTH deterministic post-build
 * passes run after it —
 *   • the starter-test scaffold (`planAutoTests` → `actuator.writeFile`), and
 *   • the U-2 launch basics (a web manifest, an installable icon, robots.txt, an offline service
 *     worker, and the SEO/OG/viewport patch to index.html).
 * Neither wrapped itself in `runInPass`, so `currentPass()` was `null`, Green Freeze refused every
 * write, and each refusal was swallowed by the pass's own `catch`. **Nothing failed. Nothing was
 * reported. The files simply never arrived**, on every build whose preview was verified in a real
 * browser — while `AppKnowledgeBase.ts` tells every AI in the product that these run "BY DEFAULT
 * after each build".
 *
 * 🔒 THE FIX IS CREATE-ONLY, NOT AN ALLOWLIST ENTRY. `ALLOWED_PASSES` asserts *"this pass writes to
 * a working app on purpose"*, which is true of a user's own repair and false of these two. A file
 * that did not exist when the browser rendered the app cannot have been part of what rendered, so
 * creating it cannot change the render; overwriting one that DID exist is precisely what the freeze
 * is for. The latch already holds the set of paths present at green, so the question is answered
 * exactly rather than guessed — and this is strictly NARROWER than the blanket "new files are always
 * allowed" carve-out removed in the 2026-08-12 adversarial review.
 *
 * ⚠️ THE HONEST CONSEQUENCE, stated rather than hidden: on a green app the index.html patch is still
 * refused, so the manifest and the service worker land but are not linked and are therefore inert.
 * The narration used to announce them regardless. It now says what actually landed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  latchGreen, clearGreenLatch, runInPass, writeRefused, ALLOWED_PASSES,
} from '../src/server/AgentV3/greenFreeze';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const WS = 'ws-launch-basics';

/** The tree as it stood when the browser rendered the app. */
const AT_GREEN = ['index.html', 'src/App.tsx', 'src/main.tsx', 'package.json'];

beforeEach(() => { clearGreenLatch(WS); latchGreen(WS, AT_GREEN); });
afterEach(() => clearGreenLatch(WS));

describe('the two deterministic passes may ADD what was not there', () => {
  it('🔴 the U-2 launch basics land — the whole point of the pass', async () => {
    await runInPass('production-defaults', async () => {
      expect(writeRefused(WS, 'manifest.webmanifest')).toBe(false);
      expect(writeRefused(WS, 'public/manifest.webmanifest')).toBe(false);
      expect(writeRefused(WS, 'robots.txt')).toBe(false);
      expect(writeRefused(WS, 'public/icon.svg')).toBe(false);
      expect(writeRefused(WS, 'public/sw.js')).toBe(false);
    });
  });

  it('🔴 the starter tests land — the other end of "No tests at all"', async () => {
    await runInPass('starter-tests', async () => {
      expect(writeRefused(WS, 'src/App.test.tsx')).toBe(false);
      expect(writeRefused(WS, 'src/lib/format.test.ts')).toBe(false);
    });
  });
});

describe('…and nothing more than that', () => {
  it('🔒 a file that EXISTED at green is still refused — this is not an allowlist entry', async () => {
    // index.html is the one overwrite either pass attempts, and it is the one that must not happen:
    // it is the file the browser actually rendered.
    await runInPass('production-defaults', async () => {
      expect(writeRefused(WS, 'index.html')).toBe(true);
      expect(writeRefused(WS, './index.html')).toBe(true);   // spelling variance is normalised
      expect(writeRefused(WS, 'src/App.tsx')).toBe(true);
    });
    await runInPass('starter-tests', async () => {
      // A test file that already existed is somebody's real test. Never clobbered.
      expect(writeRefused(WS, 'src/App.tsx')).toBe(true);
    });
  });

  it('🔒 neither pass may touch the user’s secrets, whatever else it may create', async () => {
    // Defence in depth: nothing in either pass writes a .env, and a future entry must not have to
    // remember that. The 2026-08-12 reviewer erasing a user's real .env is why this rule exists.
    for (const pass of ['production-defaults', 'starter-tests']) {
      await runInPass(pass, async () => {
        expect(writeRefused(WS, '.env')).toBe(true);
        expect(writeRefused(WS, 'server/.env.production')).toBe(true);
      });
    }
  });

  it('🔒 every OTHER pass is unchanged — full deny, new file or edit', async () => {
    // The unused-import sweep and the reviewer's opinions are exactly what the freeze is for, and
    // they stay refused. So does an unnamed pass.
    expect(writeRefused(WS, 'src/App.tsx')).toBe(true);
    expect(writeRefused(WS, 'e2e/smoke.spec.ts')).toBe(true);
    await runInPass('some-future-pass', async () => {
      expect(writeRefused(WS, 'anything.ts')).toBe(true);
    });
  });

  it('🔒 an un-latched workspace is untouched — before green there is no freeze', async () => {
    clearGreenLatch(WS);
    await runInPass('production-defaults', async () => {
      expect(writeRefused(WS, 'index.html')).toBe(false);
    });
  });

  it('🔒 neither name is on ALLOWED_PASSES, which would restore the overwrite', () => {
    // Reversion guard with teeth: promoting either name to the full allowlist makes every assertion
    // in the block above pass EXCEPT this one, and would hand the index.html of a rendering app to a
    // deterministic sweep.
    expect(ALLOWED_PASSES.has('production-defaults')).toBe(false);
    expect(ALLOWED_PASSES.has('starter-tests')).toBe(false);
  });
});

describe('the wiring, which is the whole defect', () => {
  const route = read('src/server/routes/agentv3.ts');
  const freeze = read('src/server/AgentV3/greenFreeze.ts');

  it('🔴 both passes NAME themselves — an unnamed pass is a refused one', () => {
    // This is the fix. Without these two lines every assertion above still passes and not one file
    // reaches a green app, exactly as it did for six weeks.
    expect(route).toContain("runInPass('starter-tests'");
    expect(route).toContain("runInPass('production-defaults'");
  });

  it('🔒 …and the names they use are the names the freeze knows', () => {
    // A pass named `production-default` (singular) would be refused in silence, which is the failure
    // mode being fixed — so the two spellings are asserted against each other rather than assumed.
    for (const name of ['starter-tests', 'production-defaults']) {
      expect(freeze).toContain(`'${name}'`);
      expect(route).toContain(`runInPass('${name}'`);
    }
    expect(freeze).toContain('const CREATE_ONLY_PASSES');
    expect(freeze).toContain('CREATE_ONLY_PASSES.has(pass)');
  });

  it('🔒 the create-only rule asks the LATCH, never a guess about the path', () => {
    // "Was this file there when the browser rendered?" is a fact the latch already holds. Answering
    // it from the path's shape — a name that looks like a test, an extension allowlist — is how this
    // becomes a heuristic that lets an overwrite through.
    expect(freeze).toMatch(/CREATE_ONLY_PASSES\.has\(pass\)\)\s*return latches\.get\(workspaceId\)\?\.paths\.has\(norm\(path\)\)\s*\?\?\s*true;/);
  });

  it('🔴 the narration says what LANDED, not what was planned', () => {
    // On a green app exactly one half of the U-2 pass happens, so announcing "+ a web manifest, icon,
    // robots.txt and an offline service worker" unconditionally — which is what this line used to do
    // — is the fake-success the second absolute rule forbids.
    expect(route).not.toContain('+ a web manifest, icon, robots.txt and an offline service worker.');
    expect(route).toContain('let indexPatched = false;');
    expect(route).toContain('if (indexPatched && defaults.added.length > 0)');
  });
});
