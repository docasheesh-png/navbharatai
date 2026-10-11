import { beforeEach, describe, expect, it } from 'vitest';
import { _clearWorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { makeDispatcher, toolCall } from './helpers/dispatcherHarness';

/**
 * TD-10: a refused tool call is an error result. The guidance text is unchanged;
 * the timeline must not mark the step done.
 */
describe('a refused tool call is never reported as done', () => {
  beforeEach(() => { _clearWorkspaceMemory(); });

  it('(a) blanking a populated src/App.tsx is an error and the file is unchanged', async () => {
    const { act, d, events } = makeDispatcher();
    const original = 'export default function App(){ return null; }\n';
    act.files.set('src/App.tsx', original);
    const res = await d.dispatch(toolCall('write_file', { path: 'src/App.tsx', content: '' }), 'architect');
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('blanking a populated source');
    expect(res.content.startsWith('Error:')).toBe(false);
    expect(act.files.get('src/App.tsx')).toBe(original);
    const result = events.find((e) => e.type === 'tool_result');
    expect(result && result.type === 'tool_result' && result.ok).toBe(false);
  });

  it('(b) a write that erases a real key in .env is an error', async () => {
    const { act, d } = makeDispatcher();
    const original = 'DATABASE_URL=postgres://real-user:secret@localhost/db\n';
    act.files.set('.env', original);
    const res = await d.dispatch(toolCall('write_file', {
      path: '.env',
      content: 'DATABASE_URL=your_database_url\n',
    }), 'architect');
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('GOVERNANCE BLOCKED');
    expect(act.files.get('.env')).toBe(original);
  });

  it('(c) creating a duplicate module under another convention root is an error', async () => {
    const { act, d } = makeDispatcher();
    const body = 'export function Column(){ return null; }\n';
    const first = await d.dispatch(toolCall('write_file', {
      path: 'src/components/IssueBoard/Column.tsx',
      content: body,
    }, 'c1'), 'frontend');
    expect(first.is_error).toBe(false);
    const res = await d.dispatch(toolCall('write_file', {
      path: 'app/components/IssueBoard/Column.tsx',
      content: body,
    }, 'c2'), 'frontend');
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('A copy of this module already exists');
    expect(act.files.has('app/components/IssueBoard/Column.tsx')).toBe(false);
  });

  it('(d) a parse-guard rejection is an error', async () => {
    const { act, d } = makeDispatcher();
    const res = await d.dispatch(toolCall('write_file', {
      path: 'src/Broken.tsx',
      content: 'export const x = (',
    }), 'frontend');
    expect(res.is_error).toBe(true);
    expect(res.content).toMatch(/WRITE REJECTED/);
    expect(act.files.has('src/Broken.tsx')).toBe(false);
  });

  it('(e) a governance-blocked bash delete does not run', async () => {
    const { act, d } = makeDispatcher();
    const res = await d.dispatch(toolCall('bash', { command: 'rm -rf src' }), 'architect');
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('GOVERNANCE BLOCKED');
    expect(act.commands.some((c) => c.includes('rm -rf src'))).toBe(false);
  });

  it('(f) the tool_result for a refused blanking write has ok false', async () => {
    const { act, d, events } = makeDispatcher();
    act.files.set('src/App.tsx', 'export default function App(){ return 1; }\n');
    await d.dispatch(toolCall('write_file', { path: 'src/App.tsx', content: '   ' }), 'architect');
    const result = events.find((e) => e.type === 'tool_result');
    expect(result && result.type === 'tool_result' ? result.ok : undefined).toBe(false);
  });
});
