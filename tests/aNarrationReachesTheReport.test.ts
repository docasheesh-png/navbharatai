// AUTOPSY 303e8a6f (2026-10-12), item J3 — the user saw "⚡ Starting from NavBharatAI's tested "AI image generator"
// app template — verifying and customizing it for you." at 11 s; the forensic report has no such line. The route
// has two ways to talk to the user: its own `emit` (broadcast + session timeline) and the build's `events` bus,
// which is the one the build report subscribes to. Fifteen user-visible narrations after that subscription — the
// template line, the database offer and its outcome, the paid-checkout setup, the game kit, the pasted page — went
// out on the bare `emit`, so the report showed the admin a build the user did not watch.
//
// The CLASS: user-visible narration sent outside the bus the report reads. `events.emit` already broadcasts through
// the same `emit`, so the user sees what they saw; the report now sees it too.
//
// ⚠️ CORRECTED BY THE ADVERSARIAL REVIEW: the census was single-line, so the multi-line database-offer narration
// slipped past it; the bus applies the mid-build emoji rule (a 👍 is stripped), so the two lines that carried one
// now say in source what the user sees; and a line restating a row the route already filed is marked `filed`, so
// the report never adds it again as an AGENT_NOTE warning or error.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

const ROUTE = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

describe('🔒 every narration after the report subscribes goes through the bus it reads', () => {
  it('no bare emit of a narration once the build report is listening', () => {
    const sub = ROUTE.indexOf('events.subscribe((e) => buildDiag.ingestEvent(e), false);');
    expect(sub).toBeGreaterThan(0);
    const after = ROUTE.slice(sub);
    // Multi-line aware: `emit({` then `type: 'narration'` on the next line is the same call.
    const bare = [...after.matchAll(/(?<![.\w])emit\(\s*\{\s*type:\s*'narration'[^\n]{0,60}/g)].map((m) => m[0]);
    expect(bare).toEqual([]);
  });

  it('the template line is among them', () => {
    expect(ROUTE).toContain("events.emit({ type: 'narration', agent: 'architect', text: `⚡ Starting from NavBharatAI's tested \"${golden.label}\" app template");
  });

  it('a line sent on the bus is in the report, and still reaches the user', () => {
    const events = new AgentEventStream();
    const d = new BuildDiagnostics();
    const userSaw: string[] = [];
    events.subscribe((e) => { if (e.type === 'narration') userSaw.push(e.text); }, false);
    events.subscribe((e) => d.ingestEvent(e), false);
    const line = '⚡ Starting from NavBharatAI\'s tested "AI image generator" app template — verifying and customizing it for you.';
    events.emit({ type: 'narration', agent: 'architect', text: line, ts: 1 });
    expect(userSaw).toEqual([line]);
    expect(d.report().issues.map((i) => i.message)).toContain(line);
  });
});

describe('the review\'s corrections', () => {
  it('a filed line is a plain step in the report, never a second finding', () => {
    const d = new BuildDiagnostics();
    d.ingestEvent({ type: 'narration', agent: 'architect', text: '⚠️ Your database could not be created just now. I will build with data kept on this device for now.', ts: 1, filed: true } as never);
    d.ingestEvent({ type: 'narration', agent: 'architect', text: '⚠️ The preview could not be started.', ts: 2 } as never);
    const rows = d.report().issues.map((i) => [i.code, i.severity]);
    expect(rows).toEqual([['AGENT_STEP', 'info'], ['AGENT_NOTE', 'error']]);
  });

  it('🔒 every narration that restates a row the route filed carries the flag', () => {
    for (const marker of ["text: `⚠️ ${made && !made.ok ? made.error : 'Your database could not be created just now.'}", 'text: `⚠️ ${asleep}`']) {
      const at = ROUTE.indexOf(marker);
      expect(at, marker).toBeGreaterThan(0);
      expect(ROUTE.slice(ROUTE.lastIndexOf('events.emit({', at), at)).toContain('filed: true');
    }
  });

  it('the source says what the user sees: no celebration mid-build', () => {
    expect(ROUTE).not.toMatch(/text: '👍/);
  });
});
