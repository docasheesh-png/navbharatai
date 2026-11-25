/**
 * 🧬 A HELD-BACK KIT UPDATE IS FINISHED BY THE BUILDER, SAFELY (Q-3331 — failedbr BR2518 + BR2519).
 *
 * The partial refresh (Q-3330) brings 124 of 137 kit files to an existing game, but holds back the shell chain (Game.ts and
 * 12 more) behind the user-edited play/playerBody.ts, which lacks four names the new play/actions.ts imports. The user's
 * file is never overwritten. Instead: the builder is TOLD exactly which names that file must export, and the growth guard
 * lets through the one edit that does only that — every line the file had is kept, and only exports the kit's own version
 * has are added. Anything else (a changed line, an invented export) is still refused.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { kitHeldBackHandoff, recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { growthVerdict, restoresKitExports } from '../src/server/AgentV3/growthGuard';

const PATH = 'src/game/play/playerBody.ts';
const KIT = recipeFilePool().get(PATH)!.content;
const NAMES = ['aimBone', 'boneKey', 'playerModelRoot', 'holdItem'];
// The user's edited copy: the four functions are private (the reported state), plus a line of their own.
const EDITED = KIT.replace(/export function (aimBone|boneKey|playerModelRoot|holdItem)\b/g, 'function $1') + '\n// my own tweak: a bigger sword\n';
const RESTORED = EDITED + '\nexport { aimBone, boneKey, playerModelRoot, holdItem };\n';
const REQ = 'Knight Boxer enemy show nahi ho rahe hai';

describe('the builder is told exactly what the edited file needs', () => {
  it('names the file and the four names, and says to keep the user\'s changes', () => {
    const text = kitHeldBackHandoff([{ path: 'src/game/play/actions.ts', why: 'x', edited: PATH, missing: NAMES }, { path: 'src/game/Game.ts', why: 'y', edited: PATH, missing: ['holdItem'] }]);
    expect(text).toContain(`- ${PATH} (edited in this project) must export: aimBone, boneKey, playerModelRoot, holdItem`);
    expect(text).toMatch(/KEEPING every change already in the file \(never replace the file/);
  });
  it('nothing held back ⇒ nothing said', () => {
    expect(kitHeldBackHandoff([])).toBe('');
    expect(kitHeldBackHandoff(undefined)).toBe('');
  });
  it('the build route prepends it to the builder\'s prompt', () => {
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toContain('const waiting = kitHeldBackHandoff(refresh.heldBack); if (waiting) buildPrompt =');
  });
});

describe('🔴 the growth guard lets that edit through — and only that edit', () => {
  it('adding the four exports, every line kept: allowed, though the request is not about the kit', () => {
    expect(restoresKitExports(EDITED, RESTORED, KIT)).toBe(true);
    expect(growthVerdict({ path: PATH, before: EDITED, after: RESTORED, request: REQ }).allow).toBe(true);
  });
  it('🔁 reversion: without this opening the same edit was refused (a kit file, the request not about it)', () => {
    expect(restoresKitExports(EDITED, EDITED, KIT)).toBe(false); // nothing added
    const v = growthVerdict({ path: PATH, before: EDITED, after: EDITED.replace('// my own tweak: a bigger sword', '// rewritten') + '\nexport { holdItem };\n', request: REQ });
    expect(v.allow).toBe(false);
  });
  it('a line of the user\'s is changed or dropped ⇒ refused and put back', () => {
    const changed = RESTORED.replace('// my own tweak: a bigger sword', '// a smaller sword');
    const v = growthVerdict({ path: PATH, before: EDITED, after: changed, request: REQ });
    expect(v.allow).toBe(false); expect(v.restore).toBe(EDITED);
  });
  it('an export the kit does not have ⇒ refused', () => {
    expect(restoresKitExports(EDITED, EDITED + '\nexport const cheatMode = true;\n', KIT)).toBe(false);
  });
});
