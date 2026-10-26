import { describe, it, expect } from 'vitest';
import { fixSandboxWorkspaceCd } from './sandboxWorkspaceCd';
import { SANDBOX_WORKSPACE_ROOT } from '../lib/workspacePath';

describe('fixSandboxWorkspaceCd', () => {
  it('rewrites cd /workspace before a chained grep (autopsy 7c3115a8)', () => {
    const r = fixSandboxWorkspaceCd('cd /workspace && grep -r "from.*meta" src/game --include="*.ts" | head -20');
    expect(r.fixed).toBe(true);
    expect(r.command).toBe(`cd ${SANDBOX_WORKSPACE_ROOT} && grep -r "from.*meta" src/game --include="*.ts" | head -20`);
  });

  it('rewrites quoted forms and a trailing slash', () => {
    expect(fixSandboxWorkspaceCd('cd "/workspace/"').command).toBe(`cd "${SANDBOX_WORKSPACE_ROOT}"`);
    expect(fixSandboxWorkspaceCd("cd '/workspace'").command).toBe(`cd '${SANDBOX_WORKSPACE_ROOT}'`);
  });

  it('does NOT rewrite deeper paths or unrelated cds', () => {
    expect(fixSandboxWorkspaceCd('cd /workspace/src && ls').fixed).toBe(false);
    expect(fixSandboxWorkspaceCd('cd /tmp').fixed).toBe(false);
    expect(fixSandboxWorkspaceCd('echo /workspace').fixed).toBe(false);
  });

  it('honours the kill switch', () => {
    const r = fixSandboxWorkspaceCd('cd /workspace && ls', { AGENTV3_SANDBOX_CD_REWRITE: 'off' });
    expect(r.fixed).toBe(false);
    expect(r.command).toBe('cd /workspace && ls');
  });
});
