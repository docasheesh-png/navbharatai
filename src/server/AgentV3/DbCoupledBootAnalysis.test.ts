import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  analyzeDbCoupledBoot, dbCoupledBootFixInstruction, dbCoupledBootFixOffer, isInsideTry,
} from './DbCoupledBootAnalysis';

// The real shape, condensed from the repo this class was verified against (Mitrify server/index.ts).
const ZOMBIE = `
import express from "express";
import { ensureSchema } from "./ensureSchema";
import { registerRoutes } from "./routes";
const app = express();
const httpServer = createServer(app);
httpServer.listen({ port, host: "0.0.0.0" });
(async () => {
  await ensureSchema();
  await registerRoutes(httpServer, app);
  const { setupVite } = await import("./vite");
  await setupVite(httpServer, app);
})();
`;

describe('the shape it exists to catch', () => {
  it('flags the Mitrify shape: awaited DB call before client serving, unguarded, in the listener file', () => {
    const found = analyzeDbCoupledBoot({ 'server/index.ts': ZOMBIE });
    expect(found).toMatchObject({ file: 'server/index.ts', dbCall: 'ensureSchema', servingCall: 'setupVite' });
    expect(found!.message).toContain('Cannot GET');
    expect(found!.message).toContain('Serving must never depend on the database');
  });

  it('recognises the other spellings of boot-time DB work', () => {
    for (const call of ['runMigrations', 'prisma.$connect', 'mongoose.connect', 'pool.connect', 'sequelize.sync']) {
      const src = ZOMBIE.replace('await ensureSchema()', `await ${call}()`);
      expect(analyzeDbCoupledBoot({ 'server/index.ts': src }), call).not.toBeNull();
    }
  });

  it('recognises serveStatic and express.static as the serving mount too', () => {
    const src = ZOMBIE.replace('await setupVite(httpServer, app);', 'serveStatic(app);').replace('const { setupVite } = await import("./vite");', '');
    expect(analyzeDbCoupledBoot({ 'server/index.ts': src })?.servingCall).toBe('serveStatic');
  });
});

describe('it stays silent when the code is already right — the half that keeps the check trusted', () => {
  it('a GUARDED db call is the correct pattern, not a finding', () => {
    // Flagging it would tell the user to add a guard they already have.
    const guarded = ZOMBIE.replace('await ensureSchema();', 'try { await ensureSchema(); } catch (err) { console.error(err); }');
    expect(analyzeDbCoupledBoot({ 'server/index.ts': guarded })).toBeNull();
  });

  it('serving mounted BEFORE the db call is already decoupled', () => {
    const decoupled = `
const app = express();
httpServer.listen({ port });
(async () => {
  await setupVite(httpServer, app);
  await ensureSchema();
})();
`;
    expect(analyzeDbCoupledBoot({ 'server/index.ts': decoupled })).toBeNull();
  });

  it('an API-only service has no pages to lose', () => {
    const api = `const app = express(); httpServer.listen({ port }); (async () => { await ensureSchema(); await registerRoutes(app); })();`;
    expect(analyzeDbCoupledBoot({ 'server/index.ts': api })).toBeNull();
  });

  it('a router module that never listens is not the server', () => {
    const routerOnly = ZOMBIE.replace('httpServer.listen({ port, host: "0.0.0.0" });', '');
    expect(analyzeDbCoupledBoot({ 'server/routes.ts': routerOnly })).toBeNull();
  });

  it('is not fooled by a commented-out call or one inside a string', () => {
    const commented = ZOMBIE.replace('await ensureSchema();', '// await ensureSchema();\n  console.log("await ensureSchema() runs later");');
    expect(analyzeDbCoupledBoot({ 'server/index.ts': commented })).toBeNull();
  });

  it('does not flag generic awaits — a named net, or the noise drowns the signal', () => {
    const generic = ZOMBIE.replace('await ensureSchema();', 'await loadConfig();');
    expect(analyzeDbCoupledBoot({ 'server/index.ts': generic })).toBeNull();
  });

  it('survives junk input', () => {
    expect(analyzeDbCoupledBoot({})).toBeNull();
    expect(analyzeDbCoupledBoot(null as never)).toBeNull();
    expect(analyzeDbCoupledBoot({ 'a.ts': undefined as never })).toBeNull();
  });
});

describe('isInsideTry — real brace matching, because a regex guess flags guarded code', () => {
  it('finds containment through nested braces', () => {
    const src = 'try { if (x) { await db(); } } finally {}';
    expect(isInsideTry(src, src.indexOf('await'))).toBe(true);
  });

  it('a try block that CLOSED before the call does not guard it', () => {
    const src = 'try { setup(); } catch {} \n await db();';
    expect(isInsideTry(src, src.indexOf('await'))).toBe(false);
  });

  it('a try block that starts after the call does not guard it', () => {
    const src = 'await db(); try { later(); } catch {}';
    expect(isInsideTry(src, src.indexOf('await'))).toBe(false);
  });
});

describe('the repair instruction — the exact pattern proven in the live repro', () => {
  const finding = analyzeDbCoupledBoot({ 'server/index.ts': ZOMBIE })!;
  const fix = dbCoupledBootFixInstruction(finding);

  it('guards, continues, and never rethrows', () => {
    expect(fix).toContain('try/catch');
    expect(fix).toContain('do NOT rethrow');
  });

  it('keeps the API-before-catch-all order — the fix must not break the API', () => {
    expect(fix).toContain('IN THEIR CURRENT ORDER');
    expect(fix).toContain('must not swallow /api/*');
  });

  it('retries in the background so a late database heals without a restart', () => {
    expect(fix).toContain('retry it in the background');
  });

  it('makes /health tell the truth while keeping the 200 platform contract', () => {
    expect(fix).toContain('/health');
    expect(fix).toContain('keep the 200 status');
  });

  it('the permission ask makes the user\'s reply the trigger — nothing changes until then', () => {
    const offer = dbCoupledBootFixOffer();
    expect(offer).toContain('say "fix the boot guard"');
    expect(offer.toLowerCase()).not.toContain('i fixed');
  });
});

describe('wired end to end — detection, verdict, teaching', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
  const route = read('routes/agentv3.ts');
  const prompt = read('AgentV3/systemPrompt.ts');

  it('the report records the class with the proven fix as an instruction, never auto-written', () => {
    expect(route).toContain("code: 'DB_COUPLED_BOOT'");
    expect(route).toContain('analyzeDbCoupledBoot(integrityFiles)');
    expect(route).toContain('dbCoupledBootFixInstruction(zombie)');
    // obs()-gated like its SPA sibling: on an import turn it is an observation, never our defect.
    // Anchored to the INTEGRITY call site specifically — there are two records now (the other is on
    // the import-preview path), and indexOf would otherwise assert against whichever comes first.
    const at = route.indexOf('analyzeDbCoupledBoot(integrityFiles)');
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at, at + 600)).toContain('...obs(');
  });

  it('the import verdict consults the boot log and carries the permission ask', () => {
    expect(route).toContain('halfBootCause(combined)');
    expect(route).toContain('analyzeDbCoupledBoot(importedFiles)');
    expect(route).toContain('dbCoupledBootFixOffer()');
  });

  it('an IMPORTED app gets the record too — integrityFiles is only the .env on that turn', () => {
    // Report 15985d3b carried no DB_COUPLED_BOOT for an imported app: the integrity-block copy runs
    // on integrityFiles, which on an import turn is just the .env we wrote (that build's own
    // POST_ANSWER_TIMING says "1 files"). importedFiles is the real project map.
    const at = route.indexOf('analyzeDbCoupledBoot(importedFiles)');
    expect(at).toBeGreaterThan(-1);
    const block = route.slice(at, at + 2000);
    expect(block).toContain("code: 'DB_COUPLED_BOOT'");
    expect(block).toContain('dbCoupledBootFixInstruction(zombie)');
    // An imported repo's coupled boot is the USER'S pre-existing code — recorded as an observation so
    // it never inflates the "problems v5.0 still owes" tally.
    expect(block).toContain('importTurnObservation(true,');
  });

  it('the Diagnose reason names the cause instead of pointing the user into the log', () => {
    // Two sites read the boot log now: the import verdict and the diagnose endpoint.
    expect((route.match(/halfBootCause\(combined\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('the builder prompt teaches BOTH halves: never write the trap, and how to fix it on request', () => {
    expect(prompt).toContain('PAGE SERVING MUST NEVER DEPEND ON THE DATABASE');
    expect(prompt).toContain('unhandledRejection handler keeps the process alive');
    expect(prompt).toContain('try { await ensureSchema(); } catch');
    // The permission phrase and the prompt recipe must AGREE, or the user's yes goes nowhere.
    expect(prompt).toContain('"fix the boot guard"');
  });
});

/**
 * THE REAL FILE'S SHAPE — added after the detector stayed SILENT on the exact repo it was written
 * for (report 15985d3b, 2026-08-05). The synthetic fixture above uses a dynamic
 * `await import("./vite")` inside the async block, so it has no top-level import line. The real
 * server/index.ts opens with `import { serveStatic } from "./static";` on line 11, the old pattern
 * matched that IMPORT as the serving mount, and since line 11 precedes `await ensureSchema()` on
 * line 83 the detector concluded "already decoupled" and said nothing.
 *
 * A synthetic fixture can only test the shapes I thought of; this one is the shape that shipped.
 */
const REAL_SHAPE = `
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION — server kept alive:", reason);
});

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { ensureSchema } from "./ensureSchema";

const app = express();
const httpServer = createServer(app);
httpServer.listen({ port, host: "0.0.0.0" }, () => { log(\`serving on port \${port}\`); });

(async () => {
  await ensureSchema();
  await registerRoutes(httpServer, app);
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }
})();
`;

describe('the shape that actually shipped — a top-level import is not a mount', () => {
  it('FIRES on the real file layout', () => {
    const found = analyzeDbCoupledBoot({ 'server/index.ts': REAL_SHAPE });
    expect(found).not.toBeNull();
    expect(found!.dbCall).toBe('ensureSchema');
  });

  it('an import ALONE never counts as serving', () => {
    // Importing the function and never calling it means this file serves nothing.
    const importOnly = `
import { serveStatic } from "./static";
const app = express();
httpServer.listen({ port });
(async () => { await ensureSchema(); await registerRoutes(app); })();
`;
    expect(analyzeDbCoupledBoot({ 'server/index.ts': importOnly })).toBeNull();
  });

  it('still respects a guard in the real layout', () => {
    const guarded = REAL_SHAPE.replace('await ensureSchema();', 'try { await ensureSchema(); } catch (e) { console.error(e); }');
    expect(analyzeDbCoupledBoot({ 'server/index.ts': guarded })).toBeNull();
  });
});
