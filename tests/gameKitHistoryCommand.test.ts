import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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
    for (const name of ['GameBuildingGenerator', 'GameAssetLodGenerator', 'GameAssetTextureVerifier', 'GameAssetRuntimeGenerator', 'GameRuntimeGenerator', 'Game3DGenerator', 'GameControllerGenerator', 'GameSystemsGenerator', 'GameVfxAudioGenerator', 'MelodyGenerator', 'GameShellGenerator', 'GameEconomyGenerator', 'GameShopSimGenerator', 'GameManagerGenerator', 'GameRoyaleGenerator', 'GamePhysicsGenerator', 'kitTypeContract', 'gameKitHistory']) {
      copyFileSync(`src/server/lib/${name}.ts`, join(root, `src/server/lib/${name}.ts`));
    }
    const historyPath = join(root, 'src/server/lib/gameKitHistory.ts');
    const original = readFileSync(historyPath, 'utf8');
    const literal = /export const GAME_KIT_HISTORY[^=]*=\s*(\{[\s\S]*?\n\});/.exec(original)!;
    const history = JSON.parse(literal[1]) as Record<string, string[]>;
    const camera = generateGame3D().files['src/game/three/camera.ts'];
    const currentHash = createHash('sha256').update(camera).digest('hex');
    expect(history['src/game/three/camera.ts']).toContain(currentHash);
    history['src/game/three/camera.ts'] = history['src/game/three/camera.ts'].filter((h) => h !== currentHash);
    // Force actual registration: a no-op command must not pass just because the fixture already had it.
    const before = original.replace(literal[1], JSON.stringify(history, null, 2));
    writeFileSync(historyPath, before);
    const output = execFileSync(process.execPath, [join(root, 'scripts/gameKitHistory.mjs')], { cwd: root, timeout: 15_000, encoding: 'utf8' });
    expect(output).toContain('(1 new)');
    const after = readFileSync(join(root, 'src/server/lib/gameKitHistory.ts'), 'utf8');
    for (const hash of before.matchAll(/"([a-f0-9]{64})"/g)) expect(after).toContain(hash[1]);
    expect(after).toContain(currentHash);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
