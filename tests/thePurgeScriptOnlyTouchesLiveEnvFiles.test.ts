import { describe, expect, it } from 'vitest';
import { fileDocId } from '../src/server/AgentV3/WorkspaceFileStore';
import { isSecretEnvPath } from '../src/server/lib/workspacePath';
import {
  approvalOk,
  cli,
  fileDocId as scriptFileDocId,
  isSecretEnvPath as scriptIsSecretEnvPath,
  planPurge,
} from '../scripts/purgeDurableEnvFiles.mjs';

const SAMPLES = ['.env', '.env.local', 'server/.env.production', '.env.example', 'src/env.ts', '.envrc'];

describe('the purge script only touches live env files (TD-1)', () => {
  it('agrees with the TypeScript doors on every sample path', () => {
    for (const p of SAMPLES) {
      expect(scriptIsSecretEnvPath(p)).toBe(isSecretEnvPath(p));
      expect(scriptFileDocId(p)).toBe(fileDocId(p));
    }
  });

  it('never plans a delete of .env.example', () => {
    const actions = planPurge([{
      id: 'ws-1',
      paths: ['.env', '.env.example', '.env.local', 'src/env.ts', '.envrc'],
      sizes: { '.env': 8, '.env.local': 4 },
    }]);
    expect(actions.map((a: { path: string }) => a.path)).toEqual(['.env', '.env.local']);
  });

  it('a dry run writes nothing, even when the store has a live .env', async () => {
    const writes: string[] = [];
    const db = {
      async pageWorkspaceDocs() {
        return {
          docs: [{ id: 'ws-1', paths: ['.env', '.env.example', 'src/a.ts'], sizes: { '.env': 11 } }],
          next: null,
        };
      },
      async applyRemoval(a: { path: string }) { writes.push(a.path); },
    };
    const lines: string[] = [];
    const code = await cli(['node', 'purge', '--project', 'demo'], {}, { db, log: (s: string) => lines.push(s) });
    expect(code).toBe(0);
    expect(writes).toEqual([]);
    expect(lines.some((l) => l.startsWith('ws-1\t.env\t11'))).toBe(true);
    expect(lines.join('\n')).not.toContain('SECRET');
  });

  it('refuses --apply unless the owner approval env is set', async () => {
    const writes: string[] = [];
    const db = {
      async pageWorkspaceDocs() {
        return { docs: [{ id: 'ws-1', paths: ['.env'], sizes: { '.env': 3 } }], next: null };
      },
      async applyRemoval(a: { path: string }) { writes.push(a.path); },
    };
    const code = await cli(['node', 'purge', '--project', 'demo', '--apply'], {}, { db, log: () => {} });
    expect(code).toBe(2);
    expect(writes).toEqual([]);
    expect(approvalOk('owner-approved-2026-10-09')).toBe(true);
    expect(approvalOk('yes')).toBe(false);
  });
});
