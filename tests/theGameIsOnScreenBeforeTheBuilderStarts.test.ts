// THREE STRUGGLES OF failedbr #2485, EACH AT ITS CLASS.
//
// Q-3233 — «first real-browser render 1114 s into the build»: the seed had mounted a playable game, and the preview waited
//          for a model to start a dev server. 🧬 Something the platform already has, held back until a model asks for it.
// Q-3232 — «recipes 61.5 s», six recipes, and nothing said which. 🧬 A cost recorded as one number nobody can break down.
// Q-3235 — the builder's first turn translated its brief back to the user and built nothing; a nudge restarted it.
//          🧬 An instruction about HOW to speak, read by a weak model as WHAT to do.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startPreviewAfterSeed, seedMountedAPlayableApp, seedPreviewEnabled, seedRecipeTimes, SEED_PREVIEW_HANDOFF } from '../src/server/AgentV3/seedPreview';
import { usersOwnWordsLine, buildLanguageInstruction } from '../src/server/AgentV3/LanguageDetect';

const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
const SEEDED = ['generate_game_runtime', 'generate_game_3d', 'generate_athree_map', 'generate_game_shell', 'generate_open_world'];
const io = (over: Partial<Parameters<typeof startPreviewAfterSeed>[0]> = {}) => {
  const ran: string[] = []; const codes: string[] = [];
  return { ran, codes, args: {
    seeded: SEEDED, alreadyUp: false, port: 5173,
    run: async (c: string) => { ran.push(c); return c.startsWith('curl') ? { stdout: '__STATUS__200' } : { stdout: 'dev server is UP on port 5173' }; },
    portUrl: async (port: number) => `https://${port}-box.example`, record: (i: { code: string }) => { codes.push(i.code); }, env: {} as NodeJS.ProcessEnv, ...over,
  } };
};

describe('🖥️ Q-3233: the mounted game is on screen before the builder\'s first call', () => {
  it('after a seed that mounted the open-world starter: the dev server is started, the address is EARNED, the preview published', async () => {
    const t = io();
    expect(await startPreviewAfterSeed(t.args)).toEqual({ url: 'https://5173-box.example', port: 5173 });
    expect(t.ran[0]).toBe('npm run dev');
    expect(t.ran[1]).toMatch(/^curl .*http:\/\/127\.0\.0\.1:5173/);
    expect(t.codes).toEqual(['SEED_PREVIEW_UP']);
  });

  it('the port the server really took is the one published', async () => {
    const t = io({ run: async (c: string) => (c.startsWith('curl') ? { stdout: '__STATUS__200' } : { stdout: 'dev server already healthy on port 5174' }) });
    expect((await startPreviewAfterSeed(t.args))?.port).toBe(5174);
  });

  it('🔒 nothing is claimed that was not seen: no answer → no preview, said plainly; a throw → nothing', async () => {
    const dead = io({ run: async (c: string) => (c.startsWith('curl') ? { stdout: '__STATUS__000' } : { stdout: '' }) });
    expect(await startPreviewAfterSeed(dead.args)).toBeNull();
    expect(dead.codes).toEqual(['SEED_PREVIEW_NOT_UP']);
    expect(await startPreviewAfterSeed(io({ run: async () => { throw new Error('sandbox gone'); } }).args)).toBeNull();
  });

  it('only for a seed that mounted a playable app, never over a preview that is already up, and it has a kill switch', async () => {
    expect(seedMountedAPlayableApp(SEEDED)).toBe(true);
    expect(seedMountedAPlayableApp(['generate_game_runtime', 'generate_game_3d', 'generate_game_shell'])).toBe(false);
    for (const over of [{ seeded: ['generate_game_shell'] }, { alreadyUp: true }, { env: { AGENTV3_SEED_PREVIEW: 'off' } as NodeJS.ProcessEnv }]) {
      const t = io(over);
      expect(await startPreviewAfterSeed(t.args)).toBeNull();
      expect(t.ran).toEqual([]);
    }
    expect(seedPreviewEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('the route does it right after the seed, publishes the address and tells the builder not to start another server', () => {
    expect(route).toMatch(/const seedPreview = await startPreviewAfterSeed\(\{ seeded: gameKitSeeded, alreadyUp: !!lastPreviewUrl, port: oneShotDevPort\(framework\),/);
    expect(route).toMatch(/if \(seedPreview\) \{ lastPreviewUrl = applyPreviewDomain\(seedPreview\.url\); events\.emit\(\{ type: 'preview', url: lastPreviewUrl, ts: Date\.now\(\) \}\); buildPrompt = `\$\{SEED_PREVIEW_HANDOFF\}/);
    expect(SEED_PREVIEW_HANDOFF).toMatch(/Do NOT start, restart or kill a dev server/);
    // Before the builder runs, not after.
    expect(route.indexOf('await startPreviewAfterSeed(')).toBeLessThan(route.indexOf('if (!result) result = await runner.run(buildPrompt);'));
  });
});

describe('⏱️ Q-3232: the seed says where its time went', () => {
  it('per recipe, in the report', () => {
    expect(seedRecipeTimes([{ recipe: 'generate_game_runtime', ms: 4200 }, { recipe: 'generate_game_3d', ms: 31_500 }, { recipe: 'generate_athree_map', ms: 9000 }]))
      .toBe('game_runtime 4.2 s, game_3d 31.5 s, athree_map 9.0 s');
    expect(seedRecipeTimes([{ recipe: 'x' }])).toBe('not timed');
    expect(route).toMatch(/kitResults\.push\(\{ recipe, ok: !r\.is_error, content: String\(r\.content \?\? ''\), ms: Date\.now\(\) - recipeStartedAt \}\);/);
    expect(route).toMatch(/detail: `recipes \$\{\(kitRecipesMs \/ 1000\)\.toFixed\(1\)\} s \(\$\{seedRecipeTimes\(kitResults\)\}\)`/);
  });
});

describe('🗣️ Q-3235: how to speak is not what to do', () => {
  it('where a brief replaces the request, the builder is told its first reply starts the work — never the task said again', () => {
    const line = usersOwnWordsLine('ek bada open-world game banao');
    expect(line).toMatch(/Never repeat, summarise or translate the task text back to the user/);
    expect(line).toMatch(/your first reply STARTS THE WORK with a tool call/);
    expect(buildLanguageInstruction({ prompt: 'x', isContinuation: false, editingExistingApp: false, briefReplacesRequest: true })).toContain('STARTS THE WORK');
    // An ordinary build, where the user's words are the request, is unchanged.
    expect(buildLanguageInstruction({ prompt: 'ek game banao', isContinuation: false, editingExistingApp: false })).not.toContain('STARTS THE WORK');
  });
});
