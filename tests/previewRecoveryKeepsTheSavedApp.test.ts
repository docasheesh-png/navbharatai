import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { shouldSeedStarter } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/seedStarter';

describe('waking an existing app never introduces a generic starter', () => {
  it.each(['vite-react', 'nextjs', 'vue', 'import', undefined])('disables starter and fragment completion for %s', (framework) => {
    expect(shouldSeedStarter(framework, { seedStarter: false })).toBe(false);
  });
  it('the authenticated wake opts out without moving a canonical-read gate before reconnect', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const start = src.indexOf("app.post('/api/agentv3/preview-diagnose'");
    const route = src.slice(start, src.indexOf('// PREVIEW HEALTH', start));
    const ensure = 'await actuator.ensureWorkspace(workspaceId, framework, resumeSandboxId, { seedStarter: false });';
    expect(route).toContain(ensure);
    expect(route.indexOf('assertVerifiedWorkspaceOwner')).toBeLessThan(route.indexOf(ensure));
    expect(route.indexOf(ensure)).toBeLessThan(route.indexOf('const saved = await loadWorkspaceFiles(workspaceId)'));
    expect(route).toContain('restoreWorkspaceAssets(actuator, workspaceId)');
    expect(route).toContain('loadUserVaultSecrets(userId, workspaceId)');
    expect(route).toContain('ensureBootEnv(actuator as unknown as BootEnvIo, workspaceId, bootEnv)');
    expect(route).toContain('rethrowSandboxRecoveryUnavailable(error)');
  });
});
