import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';

it('the real history command resolves imported contracts and registers the current camera without losing old hashes', () => {
  const root = mkdtempSync(join(process.cwd(), 'tests/.tmp-history-command-'));
  try {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'src/server/lib'), { recursive: true });
    copyFileSync('scripts/gameKitHistory.mjs', join(root, 'scripts/gameKitHistory.mjs'));
    for (const name of ['GameRuntimeGenerator', 'Game3DGenerator', 'GameControllerGenerator', 'GameSystemsGenerator', 'GameVfxAudioGenerator', 'MelodyGenerator', 'GameShellGenerator', 'kitTypeContract', 'gameKitHistory']) {
      copyFileSync(`src/server/lib/${name}.ts`, join(root, `src/server/lib/${name}.ts`));
    }
    const before = readFileSync(join(root, 'src/server/lib/gameKitHistory.ts'), 'utf8');
    execFileSync(process.execPath, [join(root, 'scripts/gameKitHistory.mjs')], { cwd: root, timeout: 15_000 });
    const after = readFileSync(join(root, 'src/server/lib/gameKitHistory.ts'), 'utf8');
    for (const hash of before.matchAll(/"([a-f0-9]{64})"/g)) expect(after).toContain(hash[1]);
    const camera = generateGame3D().files['src/game/three/camera.ts'];
    expect(after).toContain(createHash('sha256').update(camera).digest('hex'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
