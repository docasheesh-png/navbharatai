import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { withDeadline } from '../src/server/AgentV3/asyncUtils';
import { makeDispatcher, toolCall } from './helpers/dispatcherHarness';

describe('a late tool write is discarded (BLD-3)', () => {
  it('a write that outlives the deadline does not land, and the runner says stopped', async () => {
    const { act, d } = makeDispatcher();
    act.readFile = async () => {
      await new Promise((r) => setTimeout(r, 100));
      throw new Error('ENOENT: src/A.tsx');
    };
    let result: { is_error: boolean; content: string };
    try {
      const settled = await withDeadline(
        (signal) => d.dispatch(toolCall('write_file', { path: 'src/A.tsx', content: 'export const a = 1;\n' }), 'architect', { signal }),
        20,
        'tool write_file',
      );
      result = { is_error: settled.is_error, content: settled.content };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result = {
        is_error: true,
        content: /timed out after/.test(msg)
          ? 'Tool "write_file" did not finish within about 1 min and was stopped. Anything it had not written yet was discarded; files it had already written stay.'
          : msg,
      };
    }
    await new Promise((r) => setTimeout(r, 250));
    expect(act.files.get('src/A.tsx')).toBeUndefined();
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('was stopped');
    const runner = readFileSync(join(process.cwd(), 'src/server/AgentV3/AgentRunner.ts'), 'utf8');
    expect(runner).toContain('was stopped');
    expect(runner).toContain('Anything it had not written yet was discarded');
    expect(runner).not.toContain('was skipped so the build could keep moving');
  });
});
