import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { devServerTailCommand, formatDevServerTail, readDevServerLastWords } from '../src/server/AgentV3/devServerDeathEvidence';
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
    const reads = [...route.matchAll(/const lastWords = await withTimeout\(readDevServerLastWords\(/g)].map((m) => m.index!);
    expect(reads.length).toBe(2);
    for (const at of reads) {
      const after = route.slice(at, at + 2500);
      const restart = after.indexOf("actuator.runCommand(workspaceId, 'npm run dev')");
      const record = after.indexOf("code: 'PREVIEW_SERVER_RESTARTED'");
      expect(restart).toBeGreaterThan(0);
      expect(record).toBeGreaterThan(restart);
      expect(after.slice(record, record + 700)).toContain('its last output before it stopped');
    }
  });
});
