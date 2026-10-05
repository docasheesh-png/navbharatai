/**
 * Q-101: every verdict reads ONE ledger of what the build already proved. The two readers stay the authority on
 * their own sources (command log, timeline); the ledger composes them, names each fact once and keeps its
 * source, and is the only thing the route's verdicts ask. A census fails on any new direct read.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { readEvidenceLedger, fillGateFromLedger, renderProvenInLedger } from '../src/server/AgentV3/evidenceLedger';
import { agentRunEvidence } from '../src/server/AgentV3/agentRunEvidence';
import { provenFromTimeline } from '../src/server/AgentV3/provenFromTimeline';

const TSC_OK = { command: 'npx tsc --noEmit', exitCode: 0, stdout: '', stderr: '' };
const TSC_BAD = { command: 'npx tsc --noEmit', exitCode: 2, stdout: "src/a.ts(1,1): error TS2304: Cannot find name 'x'.", stderr: '' };
const RENDERED = { code: 'APP_RENDERED', severity: 'info' };
const VERIFIED = { code: 'RUNTIME_VERIFIED', severity: 'info' };
const PUBLISHED = { code: 'PREVIEW_PUBLISHED', severity: 'info' };

describe('one vocabulary, with the source of every fact', () => {
  it('answers exactly what the two readers answer — composed, not copied', () => {
    for (const [cmds, issues] of [
      [[TSC_OK], [RENDERED, VERIFIED, PUBLISHED]],
      [[TSC_BAD], [PUBLISHED]],
      [[], []],
      [[TSC_OK, TSC_BAD], [{ code: 'APP_RENDERED', severity: 'warning' }]],
    ] as const) {
      const ledger = readEvidenceLedger(cmds as never, issues as never);
      const log = agentRunEvidence(cmds as never);
      const seen = provenFromTimeline(issues as never);
      expect(ledger.facts.typecheck?.outcome).toBe(log.typecheck);
      expect(ledger.facts.tests?.outcome).toBe(log.tests);
      expect(ledger.facts.pages?.outcome).toBe(seen.pages);
      expect(ledger.facts.preview?.outcome).toBe(seen.preview);
      expect(ledger.previewUrlPublished).toBe(seen.previewUrlPublished);
    }
  });

  it('every fact says where it was proven', () => {
    const l = readEvidenceLedger([TSC_OK] as never, [RENDERED, VERIFIED] as never);
    expect(l.facts.typecheck).toEqual({ outcome: 'passed', source: 'command-log' });
    expect(l.facts.preview).toEqual({ outcome: 'passed', source: 'timeline' });
    expect(l.facts.pages).toEqual({ outcome: 'passed', source: 'timeline' });
    expect(renderProvenInLedger(l)).toBe(true);
    expect(renderProvenInLedger(readEvidenceLedger([], []))).toBe(false);
  });
});

describe('filling a gate moves the sentence, never the money', () => {
  it('fills only what was not run; a recorded failure keeps its failure', () => {
    const ledger = readEvidenceLedger([TSC_OK] as never, [RENDERED, PUBLISHED] as never);
    const gate = { typecheck: 'failed', tests: 'not-run', pages: 'not-run', preview: 'not-run', previewUrlPublished: undefined } as const;
    const out = fillGateFromLedger({ ...gate }, ledger);
    expect(out.typecheck).toBe('failed');
    expect(out.preview).toBe('passed');
    expect(out.tests).toBe('not-run');
    expect(out.previewUrlPublished).toBe(true);
  });

  it('a failed typecheck in the log fills an unrun gate as failed — the truth either way', () => {
    const out = fillGateFromLedger({ typecheck: 'not-run', tests: 'not-run', pages: 'not-run', preview: 'not-run' } as never, readEvidenceLedger([TSC_BAD] as never, []));
    expect((out as { typecheck: string }).typecheck).toBe('failed');
  });
});

describe('census: one read', () => {
  it('the route asks the ledger and nothing else', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(route).toContain('fillGateFromLedger(gateEvidence, buildDiag.evidenceLedger())');
    expect(route).not.toMatch(/provenFromTimeline\(/);
    expect(route).not.toMatch(/\.agentRunEvidence\(\)/);
  });

  it('no other server module reads either source directly', () => {
    const ALLOWED = new Set(['evidenceLedger.ts', 'BuildDiagnostics.ts', 'agentRunEvidence.ts', 'provenFromTimeline.ts']);
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) { walk(f); continue; }
        if (!/\.ts$/.test(n) || /\.test\.ts$/.test(n) || ALLOWED.has(n)) continue;
        const src = readFileSync(f, 'utf8');
        if (/from '[./]*(?:AgentV3\/)?(?:provenFromTimeline|agentRunEvidence)'/.test(src)) offenders.push(f);
      }
    };
    walk('src/server');
    expect(offenders).toEqual([]);
  });
});
