import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
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
    // Every top-level generator the command bundles is read from ITS OWN list (a hand list here went stale the day the
    // 2D kit generator was added), plus the helpers those generators import.
    const script = readFileSync('scripts/gameKitHistory.mjs', 'utf8');
    const listed = [...(/const GENERATORS = \[([\s\S]*?)\]/.exec(script)?.[1] ?? '').matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1]);   // top-level names; folder generators are copied below
    expect(listed).toContain('GameShellGenerator');
    for (const name of new Set([...listed, 'GameBuildingGenerator', 'GameAssetLodGenerator', 'GameAssetTextureVerifier', 'GameAssetRuntimeGenerator', 'GameRoyaleFoundationGenerator', 'kitTypeContract', 'gameKitHistory'])) {
      copyFileSync(`src/server/lib/${name}.ts`, join(root, `src/server/lib/${name}.ts`));
    }
    // Generators that live in their own folder (the Athree map and the Object Forge, with their source modules) travel with the command.
    for (const folder of ['athreeMap', 'world2d', 'objectForge']) {
      mkdirSync(join(root, `src/server/lib/${folder}`), { recursive: true });
      for (const name of readdirSync(`src/server/lib/${folder}`)) {
        if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) copyFileSync(`src/server/lib/${folder}/${name}`, join(root, `src/server/lib/${folder}/${name}`));
      }
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
