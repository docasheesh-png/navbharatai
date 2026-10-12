// AUTOPSY 303e8a6f (2026-10-12), item J3 — the user saw "⚡ Starting from NavBharatAI's tested "AI image generator"
// app template — verifying and customizing it for you." at 11 s; the forensic report has no such line. The route
// has two ways to talk to the user: its own `emit` (broadcast + session timeline) and the build's `events` bus,
// which is the one the build report subscribes to. Fifteen user-visible narrations after that subscription — the
// template line, the database offer and its outcome, the paid-checkout setup, the game kit, the pasted page — went
// out on the bare `emit`, so the report showed the admin a build the user did not watch.
//
// The CLASS: user-visible narration sent outside the bus the report reads. `events.emit` already broadcasts through
// the same `emit`, so the user sees exactly what they saw; the report now sees it too.
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
    const bare = [...after.matchAll(/(?<![.\w])emit\(\{ type: 'narration'[^\n]{0,80}/g)].map((m) => m[0]);
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
