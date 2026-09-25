import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  devServerTailCommand, formatDevServerTail, readDevServerLastWords,
  devServerDeathEvidence, devServerLastWordsDetail,
} from '../src/server/AgentV3/devServerDeathEvidence';
import { DEV_SERVER_LOG_PATH } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';

/**
 * Autopsy ac41a924 (2026-09-23), and twice before it: the preview server stopped between the first
 * render and the runtime check, and the report could not say why — the restart was recorded, the
 * server's own output never read. Its last lines are now read once, before the restart, into the
 * admin report beside it.
 */

describe('reading the last words', () => {
  it('reads the tail of the one log the dev server writes, and cannot fail as a command', () => {
    const cmd = devServerTailCommand();
    expect(cmd).toContain(DEV_SERVER_LOG_PATH);
    expect(cmd).toMatch(/\|\| true$/);
  });

  it('bounds and cleans what it reports', () => {
    const noisy = ['\u001b[31mError: EADDRINUSE\u001b[0m', '', '   ', 'x'.repeat(500)].join('\n');
    const out = formatDevServerTail(noisy)!;
    expect(out).toContain('Error: EADDRINUSE');
    expect(out).not.toContain('\u001b');
    expect(out.length).toBeLessThanOrEqual(1210);
    expect(formatDevServerTail('\n  \n')).toBeNull();
    expect(formatDevServerTail(undefined)).toBeNull();
  });

  it('a runner that throws or answers nothing yields null, never an error', async () => {
    expect(await readDevServerLastWords(async () => { throw new Error('sandbox gone'); })).toBeNull();
    expect(await readDevServerLastWords(async () => ({ stdout: '' }))).toBeNull();
    expect(await readDevServerLastWords(async () => ({ stdout: 'Killed' }))).toBe('Killed');
  });
});

describe('both restart sites read it before restarting', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

  it('each restart is preceded by the read and followed by a record that carries it', () => {
    // ⚠️ REWRITTEN 2026-09-25, and the intent is unchanged. This used to pin the call as the literal
    // `withTimeout(readDevServerLastWords(` — the timeout has since moved INTO the module so all four
    // sites share one bound (see `devServerDeathEvidence`), and pinning the old spelling would have
    // forced that bound to stay duplicated at each call site. What this guard is for — the read
    // happens BEFORE the restart, and the record that follows carries it — is what is asserted.
    const reads = [...route.matchAll(/const lastWords = await devServerDeathEvidence\(/g)].map((m) => m.index!);
    expect(reads.length).toBe(4); // two restarts + two give-ups
    // Classify each read by the record it actually feeds — whichever code comes FIRST after it. A
    // give-up sits directly above a restart block, so "contains RESTARTED somewhere below" matches
    // all four and proves nothing.
    const firstCodeAfter = (at: number) => {
      const after = route.slice(at);
      const down = after.indexOf("code: 'PREVIEW_SERVER_DOWN'");
      const up = after.indexOf("code: 'PREVIEW_SERVER_RESTARTED'");
      if (down < 0) return 'restart';
      if (up < 0) return 'down';
      return down < up ? 'down' : 'restart';
    };
    const restarts = reads.filter((at) => firstCodeAfter(at) === 'restart');
    expect(restarts.length).toBe(2);
    expect(reads.filter((at) => firstCodeAfter(at) === 'down').length).toBe(2);
    for (const at of restarts) {
      const after = route.slice(at, at + 2500);
      const restart = after.indexOf("actuator.runCommand(workspaceId, 'npm run dev')");
      const record = after.indexOf("code: 'PREVIEW_SERVER_RESTARTED'");
      expect(restart).toBeGreaterThan(0);
      expect(record).toBeGreaterThan(restart);
      expect(after.slice(record, record + 700)).toContain('devServerLastWordsDetail(lastWords)');
    }
  });
});

/**
 * 🔴 IT WAS READ ON THE WRONG BRANCH — the restart, never the GIVE-UP (autopsy e628efd4, 2026-09-25).
 *
 * The evidence above shipped on 2026-09-23 and was wired one line before each restart. But when the
 * server would not stay up and the loop finally recorded `PREVIEW_SERVER_DOWN`, it recorded the
 * restart COUNT and nothing about the cause — so the platform could explain a death it recovered
 * from and NOT the one it gave up on. That is exactly backwards: the give-up is the only one a human
 * has to act on, and autopsy e628efd4's `PREVIEW_SERVER_DOWN` is precisely that unexplained line.
 *
 * ⚠️ The log at give-up is NOT stale. By then it holds the output of the LAST restart — the death
 * that ended the loop — which is why the give-up reads again rather than reusing the earlier string.
 */
describe('the give-up says WHY, not just how many times', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

  it('🔴 every PREVIEW_SERVER_DOWN carries the server’s own last words', () => {
    // Reversion guard, and it is the whole fix: drop either read and the report goes back to
    // reporting a dead server with no cause, which no behavioural test in this repo would notice.
    const downs = [...route.matchAll(/code: 'PREVIEW_SERVER_DOWN'/g)].map((m) => m.index!);
    expect(downs.length).toBe(2); // the verify loop and the runtime check — siblings, both fixed
    for (const at of downs) {
      const around = route.slice(Math.max(0, at - 900), at + 900);
      expect(around).toContain('devServerDeathEvidence((c) => actuator.runCommand(workspaceId, c))');
      expect(around).toContain('devServerLastWordsDetail(lastWords)');
    }
  });

  it('the read is bounded by the module, so the four sites cannot drift apart', async () => {
    // A runner that never settles must not hold a loop that is already reporting a dead server.
    const started = Date.now();
    const out = await devServerDeathEvidence(() => new Promise(() => {}), 40);
    expect(out).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('…and a working runner still reports what the log said', async () => {
    expect(await devServerDeathEvidence(async () => ({ stdout: 'Error: EADDRINUSE' }))).toBe('Error: EADDRINUSE');
  });

  it('one sentence for every site — an empty log and an unreadable one are not claimed apart', () => {
    expect(devServerLastWordsDetail('Killed')).toBe('its last output before it stopped: Killed');
    // We genuinely cannot tell these two apart from here, so the sentence does not pretend to.
    expect(devServerLastWordsDetail(null)).toBe(devServerLastWordsDetail(undefined));
    expect(devServerLastWordsDetail(null)).toMatch(/said nothing .*could not be read/);
  });
});
