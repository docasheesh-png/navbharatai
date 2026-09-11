import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  dueForRescan, rescanAction, rescanSummary, runOutboundRescan,
  RESCAN_MAX_APPS_PER_RUN, RESCAN_INTERVAL_MS,
} from './outboundRescan';
import type { DeploymentRecord } from './DeploymentStore';

/**
 * AN APP CLEAN ON MONDAY CAN BE LISTED BY FRIDAY (NavBharat Cloud slice 4 — ROADMAP §11).
 *
 * The publish-time check catches an app BUILT to harvest credentials. It is powerless against the
 * other shape: an app published innocently whose outbound host is compromised or sold weeks later.
 * Nothing about the app changes; the world's opinion of where it points does.
 */
const rec = (o: Partial<DeploymentRecord> & { workspaceId: string }): DeploymentRecord => ({
  userId: 'u', url: 'https://x', fileCount: 1, updatedAt: 0, ...o,
} as DeploymentRecord);

const DAY = 24 * 60 * 60 * 1000;

describe('dueForRescan', () => {
  it('picks live apps whose recorded hosts are old enough to re-ask about', () => {
    const out = dueForRescan([rec({ workspaceId: 'a', outboundOrigins: ['https://x.example.com'], updatedAt: 0 })], 2 * DAY);
    expect(out.due).toEqual([{ workspaceId: 'a', origins: ['https://x.example.com'] }]);
  });

  it('a recently-checked app is left alone', () => {
    const out = dueForRescan([rec({ workspaceId: 'a', outboundOrigins: ['https://x.example.com'], updatedAt: 2 * DAY })], 2 * DAY + 1000);
    expect(out.due).toEqual([]);
  });

  it('🔒 an app already HELD or TAKEN DOWN is never re-flagged', () => {
    // Re-flagging what the admin has already actioned is how a queue of real work becomes noise.
    const records = [
      rec({ workspaceId: 'held', status: 'held', outboundOrigins: ['https://x.example.com'] }),
      rec({ workspaceId: 'down', status: 'taken_down', outboundOrigins: ['https://x.example.com'] }),
      rec({ workspaceId: 'gone', status: 'unpublished', outboundOrigins: ['https://x.example.com'] }),
    ];
    expect(dueForRescan(records, 5 * DAY).due).toEqual([]);
  });

  it('🔒 NO RECORDED ORIGINS is reported as a GAP, never assumed clean', () => {
    // Absent means "published before the check existed" — we do not know where it points, and
    // inventing "nowhere" is the unmeasured-rendered-as-zero mistake this codebase keeps catching.
    const out = dueForRescan([rec({ workspaceId: 'old' })], 5 * DAY);
    expect(out.due).toEqual([]);
    expect(out.originsUnrecorded ?? out.unknownOrigins).toEqual(['old']);
  });

  it('an app measured as pointing nowhere outbound is simply not due', () => {
    const out = dueForRescan([rec({ workspaceId: 'a', outboundOrigins: [] })], 5 * DAY);
    expect(out.due).toEqual([]);
    expect(out.unknownOrigins).toEqual([]); // measured — a different answer from absent
  });

  it('🔒 BOUNDED — a backlog drains over sweeps rather than spiking one', () => {
    const many = Array.from({ length: RESCAN_MAX_APPS_PER_RUN + 50 }, (_, i) =>
      rec({ workspaceId: `w${i}`, outboundOrigins: ['https://x.example.com'] }));
    expect(dueForRescan(many, 5 * DAY).due.length).toBe(RESCAN_MAX_APPS_PER_RUN);
    expect(RESCAN_INTERVAL_MS).toBe(DAY);
  });
});

describe('🔒 rescanAction — an app comes down on EVIDENCE, never on the absence of an answer', () => {
  it('a listing holds', () => {
    expect(rescanAction({ listed: [{}], incomplete: false })).toBe('hold');
  });

  it('checked and nothing listed is clean', () => {
    expect(rescanAction({ listed: [], incomplete: false })).toBe('clean');
  });

  it('🔒 COULD NOT CHECK is its own answer — not clean, and never grounds for a takedown', () => {
    // A Web Risk outage or an expired key would otherwise take down every published app at once — a
    // self-inflicted outage dressed as a safety feature.
    expect(rescanAction({ listed: [], incomplete: true })).toBe('unknown');
  });
});

describe('runOutboundRescan', () => {
  const base = {
    list: async () => [rec({ workspaceId: 'a', outboundOrigins: ['https://evil.example.com'], updatedAt: 0 })],
    nowMs: 5 * DAY,
  };

  it('holds an app whose outbound host is listed, and says which', async () => {
    const held: Array<[string, string]> = [];
    const r = await runOutboundRescan({
      ...base,
      scan: async () => ({ listed: [{ origin: 'https://evil.example.com' }], incomplete: false }),
      hold: async (w, note) => { held.push([w, note]); },
    });
    expect(r.held).toEqual(['a']);
    expect(held[0][1]).toContain('evil.example.com');
  });

  it('🔒 an UNCHECKABLE app is left live', async () => {
    let holds = 0;
    const r = await runOutboundRescan({
      ...base,
      scan: async () => ({ listed: [], incomplete: true }),
      hold: async () => { holds++; },
    });
    expect(holds).toBe(0);
    expect(r.unknown).toEqual(['a']);
    expect(r.held).toEqual([]);
  });

  it('🔒 a scan that THROWS is unknown, not a takedown', async () => {
    let holds = 0;
    const r = await runOutboundRescan({
      ...base,
      scan: async () => { throw new Error('web risk down'); },
      hold: async () => { holds++; },
    });
    expect(holds).toBe(0);
    expect(r.unknown).toEqual(['a']);
  });

  it('🔒 an unreadable store is not evidence about anybody\'s app', async () => {
    const r = await runOutboundRescan({
      list: async () => { throw new Error('firestore down'); },
      scan: async () => ({ listed: [{ origin: 'x' }], incomplete: false }),
      hold: async () => { throw new Error('should not be called'); },
    });
    expect(r).toEqual({ checked: 0, held: [], unknown: [], originsUnrecorded: [] });
  });

  it('a hold that FAILS is reported as not-held, never as held', async () => {
    const r = await runOutboundRescan({
      ...base,
      scan: async () => ({ listed: [{ origin: 'https://evil.example.com' }], incomplete: false }),
      hold: async () => { throw new Error('write refused'); },
    });
    expect(r.held).toEqual([]);
    expect(r.checked).toBe(1);
  });
});

describe('rescanSummary is honest about what it could not do', () => {
  it('names the permanent blind spot rather than rounding it away', () => {
    const s = rescanSummary({ checked: 3, held: [], unknown: ['b'], originsUnrecorded: ['c', 'd'] });
    expect(s).toContain('could not be checked');
    expect(s).toContain('no recorded outbound hosts');
  });

  it('says plainly when nothing was due', () => {
    expect(rescanSummary({ checked: 0, held: [], unknown: [], originsUnrecorded: [] })).toMatch(/no live apps were due/i);
  });
});

describe('🔒 the wiring', () => {
  const server = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');

  it('the sweep is registered as an EXCLUSIVE job — it HOLDS apps', () => {
    const at = server.indexOf("id: 'outbound-rescan'");
    expect(at).toBeGreaterThan(-1);
    expect(server.slice(at, at + 200)).toContain('exclusive: true');
  });

  it('🔒 it HOLDS rather than takes down — reversible by the admin', () => {
    const at = server.indexOf("id: 'outbound-rescan'");
    const body = server.slice(at, at + 2400);
    expect(body).toContain("setStatus(workspaceId, 'held')");
    expect(body).not.toContain("'taken_down'");
  });

  it('rides the same switch as the publish-time lookup — one key for the whole check', () => {
    expect(server).toContain("process.env.NAVBHARAT_WEB_RISK?.trim().toLowerCase() === 'on'");
  });

  it('a safety sweep can never affect the server', () => {
    const at = server.indexOf("id: 'outbound-rescan'");
    expect(server.slice(at, at + 2600)).toMatch(/catch\(\(\) => \{ \/\* a safety sweep must never affect the server/);
  });
});
