import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withContainerTimeout } from './DockerActuator';

const src = readFileSync(resolve(__dirname, 'DockerActuator.ts'), 'utf8');

describe('DockerActuator sandbox networking (BLD-13)', () => {
  it('does not attach the container to the host network', () => {
    expect(src).not.toContain("NetworkMode: 'host'");
    expect(src).toContain("process.env.DOCKER_SANDBOX_NETWORK || 'bridge'");
  });

  it('wraps exec with timeout -k so a timed-out command is killed inside the container', () => {
    expect(src).toContain('timeout -k');
    const shell = withContainerTimeout(['sh', '-c', 'echo hi'], 120_000);
    expect(shell).toEqual(['timeout', '-k', '5', '120', 'sh', '-c', 'echo hi']);
    const argv = withContainerTimeout(['rm', '-f', '--', '/workspace/x'], 10_000);
    expect(argv).toEqual(['timeout', '-k', '5', '10', 'rm', '-f', '--', '/workspace/x']);
    expect(withContainerTimeout(['cat', '--', 'a'], 1_500)[3]).toBe('2');
  });

  it('path helpers use argv, not a concatenated shell string', () => {
    expect(src).toContain("['mkdir', '-p', '--'");
    expect(src).toContain("['cat', '--'");
    expect(src).toContain(`'cat > "$1"'`);
    expect(src).not.toContain('NetworkMode: \'host\'');
    expect(src).not.toMatch(/cat "\$\{/);
    expect(src).not.toMatch(/mkdir -p "\$\{/);
    expect(src).toContain("execFile('tar'");
  });
});
