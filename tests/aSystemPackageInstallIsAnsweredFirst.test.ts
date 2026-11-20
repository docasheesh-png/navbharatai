// failedbr #1803 (2026-11-20): `apt-get update && apt-get install -y ffmpeg` failed with "Permission denied" — the
// sandbox user is not root and sudo is refused. A system install is now answered before it runs, with the npm route.
import { describe, expect, it } from 'vitest';
import { systemPackageInstallRefusal } from '../src/server/AgentV3/systemPackageInstall';
import { makeDispatcher, toolCall } from './helpers/dispatcherHarness';

describe('a system package install is answered before it fails (failedbr #1803)', () => {
  it.each([
    'apt-get update && apt-get install -y ffmpeg', 'sudo apt install ffmpeg', 'apk add --no-cache ffmpeg',
    'yum install -y ImageMagick', 'brew install ffmpeg', 'cd /tmp; apt-get -y install poppler-utils',
  ])('refused: %s', (c) => {
    expect(systemPackageInstallRefusal(c)).toMatch(/needs root, and this sandbox has none/);
  });

  it.each(['which ffmpeg', 'apt list --installed | grep ffmpeg', 'dpkg -l', 'npm install ffmpeg-static', 'echo apt-get install x', 'npm update'])(
    'runs unchanged: %s', (c) => {
      expect(systemPackageInstallRefusal(c)).toBeNull();
    });

  it('🔴 through the bash tool: the command never reaches the sandbox', async () => {
    const { act, d } = makeDispatcher();
    const res = await d.dispatch(toolCall('bash', { command: 'apt-get update && apt-get install -y ffmpeg' }, 'b'), 'frontend');
    expect(JSON.stringify(res)).toMatch(/needs root/);
    expect(act.commands.some((c) => c.includes('apt-get'))).toBe(false);
  });
});
