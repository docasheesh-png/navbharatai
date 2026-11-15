import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { clearPreviewGaveUp } from '../src/server/AgentV3/previewGiveUp';
class Fake implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string) { const v = this.files.get(p); if (v === undefined) throw new Error('ENOENT: ' + p); return v; }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}
let act: Fake; let d: ToolDispatcher;
const run = () => d.dispatch({id:'royale',name:'generate_game_royale',input:{}}, 'architect');
beforeEach(() => {
  act = new Fake(); const events = new AgentEventStream(); clearPreviewGaveUp('royale-test');
  d = new ToolDispatcher(act, 'royale-test', new WorkspaceState(events), events);
  d.setUserOwnedFiles([], 'Build an original battle royale practice game');
  d.setRoyaleNewProjectAllowed(true);
});
afterEach(() => vi.unstubAllEnvs());
describe('original royale dispatch safety', () => {
  it('rejects reopened generated projects even without manually owned files', async () => { vi.stubEnv('AGENTV3_ORIGINAL_ROYALE','on'); d.setRoyaleNewProjectAllowed(false); expect((await run()).is_error).toBe(true); expect(act.files.size).toBe(0); });
  it.each(['off', 'false', '0', 'unknown'])('disabled or invalid flag %s makes no writes', async (value) => { vi.stubEnv('AGENTV3_ORIGINAL_ROYALE', value); expect((await run()).is_error).toBe(true); expect(act.files.size).toBe(0); });
  it.each(['true', 'ON', '1'])('uses shared enabled flag spelling %s', async (value) => { vi.stubEnv('AGENTV3_ORIGINAL_ROYALE', value); expect((await run()).is_error).toBeFalsy(); expect(act.files.has('src/game/RoyalePractice.tsx')).toBe(true); });
  it('default OFF makes no writes', async () => { vi.stubEnv('AGENTV3_ORIGINAL_ROYALE',''); expect((await run()).is_error).toBe(true); expect(act.files.size).toBe(0); });
  it('does not overwrite existing or imported source', async () => { vi.stubEnv('AGENTV3_ORIGINAL_ROYALE','on'); d.setUserOwnedFiles(['src/App.tsx'], 'Build PUBG'); expect((await run()).is_error).toBe(true); expect(act.files.size).toBe(0); });
  it('preserves a stored Athree world', async () => { vi.stubEnv('AGENTV3_ORIGINAL_ROYALE','on'); act.files.set('src/game/athree/index.ts','existing'); expect((await run()).is_error).toBe(true); expect([...act.files.values()]).toEqual(['existing']); });
  it('does not reinterpret transient reads as a missing map', async () => { vi.stubEnv('AGENTV3_ORIGINAL_ROYALE','on'); vi.spyOn(act,'readFile').mockRejectedValue(new Error('timeout')); expect((await run()).is_error).toBe(true); expect(act.files.size).toBe(0); });
  it('does not substitute for an explicitly named Athree map', async () => { vi.stubEnv('AGENTV3_ORIGINAL_ROYALE','on'); d.setCoverageRequest('Build PUBG with Athree map'); expect((await run()).is_error).toBe(true); expect(act.files.size).toBe(0); });
  it('does not add games to ordinary app requests', async () => { vi.stubEnv('AGENTV3_ORIGINAL_ROYALE','on'); d.setCoverageRequest('Build an invoice dashboard'); expect((await run()).is_error).toBe(true); expect(act.files.size).toBe(0); });
  it('adds the enabled original practice files only for a new matching project', async () => { vi.stubEnv('AGENTV3_ORIGINAL_ROYALE','on'); const result = await run(); expect(result.is_error).toBeFalsy(); expect(act.files.has('src/game/RoyalePractice.tsx')).toBe(true); expect(act.files.has('src/App.tsx')).toBe(false); });
});
