// AN IMPORTED MANIFEST IS NEVER REPLACED BY OUR STARTER (autopsy d0b2fcd6, 2026-10-07, Q-740).
//
// The user's 175-file app landed by BULK archive; the actuator's warm cache never heard about it and still held
// our starter's package.json (written before the import). Two installs then emptied the manifest (Q-739), and
// the empty-manifest restore picked the "last valid copy" — the cache's starter (and the durable copy, stale for
// the same reason, Q-735, also held the starter). The imported app ran as "project@0.1.0", our Vite starter:
// no db:push, no tailwind, a build-error overlay, and STARTER_STILL_SHOWING.

import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { writeWorkspaceFiles } from '../src/server/AgentV3/WorkspaceFiles';
import { E2BActuator } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { starterTemplates } from '../src/server/AgentV3/starterFragment';

const project = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`client/src/f${i}.tsx`, `export const f${i} = ${i};`]));
project['package.json'] = JSON.stringify({ name: 'mitrify', scripts: { dev: 'tsx server/index.ts', 'db:push': 'drizzle-kit push' } });

function bulkSink() {
  const noted: Record<string, string>[] = [];
  let count = 0;
  const sink = {
    writeFile: async () => undefined,
    writeBinaryFile: async (_w: string, _p: string, b64: string) => {
      const tar = gunzipSync(Buffer.from(b64, 'base64'));
      count = 0;
      for (let off = 0; off + 512 <= tar.length; ) {
        const name = tar.toString('ascii', off, off + 100).replace(/\0.*$/, '');
        if (!name) break;
        const size = parseInt(tar.toString('ascii', off + 124, off + 135).trim(), 8) || 0;
        count++; off += 512 + Math.ceil(size / 512) * 512;
      }
    },
    runCommand: async () => ({ exitCode: 0, stdout: `NBAI_EXTRACTED:${count}\n`, stderr: '' }),
    readFile: async (_w: string, p: string) => project[p],
    noteFilesLanded: (_w: string, files: Record<string, string>) => { noted.push(files); },
  };
  return { sink, noted };
}

const viteStarterPkg = starterTemplates().map((t) => t['package.json']).find((p) => typeof p === 'string' && /vite/.test(p))!;

function emptyManifestSandbox(sourceFiles: number) {
  const writes: Record<string, string> = {};
  return {
    writes,
    sandbox: {
      files: {
        read: async (p: string) => (p.endsWith('package.json') ? '' : ''),
        write: async (p: string, c: string) => { writes[p] = c; },
      },
      commands: {
        run: async (cmd: string) => ({ exitCode: 0, stdout: /\bwc -l\b/.test(cmd) && /-name '\*\.ts'/.test(cmd) ? `${sourceFiles}\n` : '', stderr: '' }),
      },
    },
  };
}

describe('the warm cache hears about a bulk landing', () => {
  it('🔒 writeWorkspaceFiles tells the sink exactly what the archive landed', async () => {
    const h = bulkSink();
    const res = await writeWorkspaceFiles(h.sink, 'ws', project);
    expect(res.landedVia).toMatch(/^bulk/);
    expect(h.noted).toHaveLength(1);
    expect(h.noted[0]['package.json']).toBe(project['package.json']);
    expect(Object.keys(h.noted[0])).toHaveLength(Object.keys(project).length);
  });

  it('🔒 the E2B actuator puts the landed files in its cache — the imported manifest replaces the starter one', () => {
    const act = new E2BActuator('test-key') as unknown as { noteFilesLanded: (w: string, f: Record<string, string>) => void; _fileCache: Map<string, Map<string, string>>; _cacheFileWrite: (w: string, p: string, c: string) => void };
    act._cacheFileWrite('ws', 'package.json', viteStarterPkg);
    act.noteFilesLanded('ws', { 'package.json': project['package.json'], 'client/src/f1.tsx': project['client/src/f1.tsx'] });
    expect(act._fileCache.get('ws')!.get('package.json')).toBe(project['package.json']);
  });
});

describe('an emptied manifest is never put back as our starter over a real project', () => {
  it('🔒 a workspace with a real project does NOT get the starter manifest written over it', async () => {
    const act = new E2BActuator('test-key') as unknown as { _restoreEmptyManifest: (s: unknown, w: string) => Promise<string | null>; _cacheFileWrite: (w: string, p: string, c: string) => void };
    act._cacheFileWrite('ws', 'package.json', viteStarterPkg); // the stale cache from the report
    const f = emptyManifestSandbox(180);
    const note = await act._restoreEmptyManifest(f.sandbox, 'ws');
    expect(Object.values(f.writes)).not.toContain(viteStarterPkg);
    expect(note).toMatch(/no valid copy was available/);
  });

  it('a workspace that IS just our starter still gets its manifest back (the case the restore was built for)', async () => {
    const act = new E2BActuator('test-key') as unknown as { _restoreEmptyManifest: (s: unknown, w: string) => Promise<string | null>; _cacheFileWrite: (w: string, p: string, c: string) => void };
    act._cacheFileWrite('ws', 'package.json', viteStarterPkg);
    const f = emptyManifestSandbox(4);
    await act._restoreEmptyManifest(f.sandbox, 'ws');
    expect(Object.values(f.writes)).toContain(viteStarterPkg);
  });

  it('the user\'s own manifest in the cache is always restored', async () => {
    const act = new E2BActuator('test-key') as unknown as { _restoreEmptyManifest: (s: unknown, w: string) => Promise<string | null>; _cacheFileWrite: (w: string, p: string, c: string) => void };
    act._cacheFileWrite('ws', 'package.json', project['package.json']);
    const f = emptyManifestSandbox(180);
    await act._restoreEmptyManifest(f.sandbox, 'ws');
    expect(Object.values(f.writes)).toContain(project['package.json']);
  });
});
