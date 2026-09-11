/**
 * 🔒 A COST TILE MUST REPORT A MEASUREMENT, NOT OUR OWN BOOKKEEPING (admin screenshot 2026-09-11).
 *
 * The Monitor showed "LIVE SANDBOXES 18 — Running now, billed by the minute" beside "BUILDS —, no
 * build in window" for six hours. Eighteen machines billing with nobody building is either the most
 * expensive bug in the platform or a counting error, and nothing could say which, because the tile
 * never asked E2B anything: it counted `listRecent(200).filter(r => !r.pausedAt)`, i.e. "every record
 * WE did not pause OURSELVES".
 *
 * `pausedAt` is written from three places, all inside our own sweeps. A sandbox E2B paused at its own
 * timeout — the normal end for anything both sweeps miss, since #2782 set `onTimeout: 'pause'` — or
 * killed, therefore looked alive and billing forever. The error runs the other way too: the orphan
 * sweep stamps `pausedAt` after three FAILED pause attempts precisely because the machine may still
 * be running, which under-counts a real cost.
 *
 * These rules are the ones that keep the replacement honest.
 */
import { describe, it, expect } from 'vitest';
import {
  countRunningSandboxes,
  liveSandboxNote,
  MAX_SANDBOX_PAGES,
  BILLING_STATE,
  type SandboxPageFetcher,
} from './liveSandboxCount';

const page = (states: string[], nextToken?: string | null) => ({
  items: states.map((state) => ({ state })),
  nextToken: nextToken ?? null,
});

describe('counting what is actually running', () => {
  it('counts only the state that bills', async () => {
    const fetchPage: SandboxPageFetcher = async () => page(['running', 'paused', 'running', 'paused']);
    expect(await countRunningSandboxes(fetchPage)).toEqual({ running: 2, truncated: false });
  });

  it('a paused fleet is a real, reportable ZERO — the answer the old tile could never give', async () => {
    const fetchPage: SandboxPageFetcher = async () => page(['paused', 'paused', 'paused']);
    const r = await countRunningSandboxes(fetchPage);
    expect(r.running).toBe(0);
    expect(liveSandboxNote(r)).toMatch(/no machine is billing/i);
  });

  it('walks pages and sums across them', async () => {
    const pages = [page(['running', 'running'], 't1'), page(['paused', 'running'], 't2'), page(['running'])];
    let i = 0;
    const fetchPage: SandboxPageFetcher = async () => pages[i++];
    expect(await countRunningSandboxes(fetchPage)).toEqual({ running: 4, truncated: false });
  });

  it('passes the cursor it was handed back to the provider', async () => {
    const seen: (string | undefined)[] = [];
    const pages = [page(['running'], 'tok-a'), page(['running'], 'tok-b'), page(['running'])];
    let i = 0;
    const fetchPage: SandboxPageFetcher = async (token) => { seen.push(token); return pages[i++]; };
    await countRunningSandboxes(fetchPage);
    expect(seen).toEqual([undefined, 'tok-a', 'tok-b']);
  });

  it('state matching is case- and whitespace-tolerant, and nothing else counts', async () => {
    const fetchPage: SandboxPageFetcher = async () => page([' RUNNING ', 'Running', 'runnin', '', 'starting']);
    expect((await countRunningSandboxes(fetchPage)).running).toBe(2);
    expect(BILLING_STATE).toBe('running');
  });
});

describe('🔒 the honesty rules — a cost number must never be invented', () => {
  it('a provider that cannot be reached yields NULL, never a reassuring zero', async () => {
    const fetchPage: SandboxPageFetcher = async () => { throw new Error('ETIMEDOUT'); };
    const r = await countRunningSandboxes(fetchPage);
    expect(r.running).toBeNull();
    expect(r.reason).toMatch(/ETIMEDOUT/);
    // And the tile line must not claim anything about billing.
    expect(liveSandboxNote(r)).not.toMatch(/billed/i);
    expect(liveSandboxNote(r)).toMatch(/could not|unknown/i);
  });

  it('no provider configured is also unknown, not zero', async () => {
    for (const absent of [null, undefined, 'nope' as unknown as SandboxPageFetcher]) {
      const r = await countRunningSandboxes(absent as never);
      expect(r.running, String(absent)).toBeNull();
      expect(r.reason).toBeTruthy();
    }
  });

  it('🔒 stops at the page bound and SAYS the number is a floor', async () => {
    // Unbounded, one admin panel load could crawl an external API for minutes. Bounded silently, the
    // tile would report a smaller number as though it were the total — the same class of quiet
    // wrongness this whole change exists to remove.
    let calls = 0;
    const fetchPage: SandboxPageFetcher = async () => { calls++; return page(['running', 'running'], 'more'); };
    const r = await countRunningSandboxes(fetchPage);
    expect(calls).toBe(MAX_SANDBOX_PAGES);
    expect(r.running).toBe(MAX_SANDBOX_PAGES * 2);
    expect(r.truncated).toBe(true);
    expect(liveSandboxNote(r)).toMatch(/at least/i);
  });

  it('a malformed page is survived rather than thrown on', async () => {
    const fetchPage: SandboxPageFetcher = async () => ({ items: null as never, nextToken: null });
    expect(await countRunningSandboxes(fetchPage)).toEqual({ running: 0, truncated: false });
  });
});

describe('the tile line', () => {
  it('says "billed" ONLY when something measurably is', () => {
    expect(liveSandboxNote({ running: 3, truncated: false })).toMatch(/billed by the minute/i);
    expect(liveSandboxNote({ running: 0, truncated: false })).not.toMatch(/billed by the minute/i);
    expect(liveSandboxNote({ running: null, truncated: false })).not.toMatch(/billed by the minute/i);
  });
});

describe('wiring — the route and the tile must both use the measurement', () => {
  const read = (rel: string) =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('fs').readFileSync(require('path').join(__dirname, rel), 'utf8') as string;

  it('the admin route no longer infers "live" from our own pause records', () => {
    const route = read('../routes/admin.ts');
    expect(route).toContain('actuator.countRunningSandboxes()');
    // The exact inference that produced the 18.
    expect(route).not.toContain('records.filter((r) => !r.pausedAt).length');
  });

  it('the tile takes its sub-line from the SERVER, so an unmeasured number cannot claim billing', () => {
    const panel = read('../../components/admin/MonitorPanels.tsx');
    expect(panel).toContain('data?.liveSandboxNote');
    // The old hardcoded claim may remain only as the measured-value fallback, never as the null one.
    expect(panel).toMatch(/liveSandboxes == null \? 'Could not ask/);
  });
});
