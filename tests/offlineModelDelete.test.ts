import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  deleteOfflineModel, offlineModelOnDevice, resetOfflineLlm, STAGE1_MODELS,
} from '../src/lib/offlineLlmEngine';

/**
 * ADMIN 2026-08-11: "offline ai me beta download ka option to hai, par agar memory full ho jaye to
 * delete ka option nahi. Waha ek aur option add karo — delete."
 *
 * They were right, and the gap was worse than it looked. "Turn off" called `resetOfflineLlm()`, which
 * only drops an IN-MEMORY reference — the model weights web-llm cached on first download (hundreds of
 * MB) stayed on the device forever, with no way to reclaim the space. The screen even admitted it
 * ("stays cached… until you clear the app's browser data"), which on the installed Android app is not
 * an instruction anyone can follow. On the low-end phones this feature exists for, a few hundred MB
 * that cannot be freed is the difference between an app someone keeps and one they uninstall.
 *
 * Turning a feature off must give back what turning it on took.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('delete really deletes', () => {
  it('removes weights for the WHOLE ladder, not just the model in use', async () => {
    /**
     * The loader falls back from the 0.5B to the 360M model on weaker devices, so a phone can be
     * holding weights for a model it never ended up using — exactly the bytes nobody would think to
     * look for.
     */
    const seen: string[] = [];
    const res = await deleteOfflineModel({ deleteFn: async (id) => { seen.push(id); } });
    expect(res.ok).toBe(true);
    expect(seen).toEqual([...STAGE1_MODELS]);
    expect(res.deleted).toEqual([...STAGE1_MODELS]);
    expect(STAGE1_MODELS.length).toBeGreaterThan(1); // the ladder is why this matters
  });

  it('honours an explicit id list', async () => {
    const seen: string[] = [];
    await deleteOfflineModel({ modelIds: ['only-this'], deleteFn: async (id) => { seen.push(id); } });
    expect(seen).toEqual(['only-this']);
  });

  it('a browser that REFUSES is reported, never a cheerful "space freed"', async () => {
    // Claiming success over a device where nothing changed is the exact dishonesty the rules forbid.
    const res = await deleteOfflineModel({ deleteFn: async () => { throw new Error('QuotaExceeded'); } });
    expect(res.ok).toBe(false);
    expect(res.deleted).toEqual([]);
    expect(res.error).toMatch(/QuotaExceeded/);
  });

  it('a model that was never downloaded does not turn a real deletion into a failure', async () => {
    /**
     * One id missing is normal — the fallback model usually was never fetched. Reporting failure then
     * would tell the user nothing was freed while space genuinely came back.
     */
    const res = await deleteOfflineModel({
      deleteFn: async (id) => { if (id !== STAGE1_MODELS[0]) throw new Error('not found'); },
    });
    expect(res.ok).toBe(true);
    expect(res.deleted).toEqual([STAGE1_MODELS[0]]);
    expect(res.error).toBeUndefined();
  });

  it('drops the in-memory engine too, so nothing keeps pointing at deleted files', async () => {
    resetOfflineLlm();
    const res = await deleteOfflineModel({ deleteFn: async () => {} });
    expect(res.ok).toBe(true);
    // A second delete right after is still safe — no stale engine, no throw.
    await expect(deleteOfflineModel({ deleteFn: async () => {} })).resolves.toMatchObject({ ok: true });
  });
});

describe('knowing whether anything is actually stored', () => {
  it('true when ANY ladder model is on the device', async () => {
    expect(await offlineModelOnDevice({ hasFn: async (id) => id === STAGE1_MODELS[1] })).toBe(true);
    expect(await offlineModelOnDevice({ hasFn: async () => false })).toBe(false);
  });

  it('an unreadable cache reads as ABSENT — never a Delete button that then fails', async () => {
    expect(await offlineModelOnDevice({ hasFn: async () => { throw new Error('no Cache API'); } })).toBe(false);
  });

  it('stops at the first hit rather than probing every id', async () => {
    const probe = vi.fn(async () => true);
    await offlineModelOnDevice({ hasFn: probe });
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe('WIRING — the button is where someone hunting for space would look', () => {
  const ui = read('src/components/offline/OfflineAI.tsx');

  it('Delete is offered while the beta is ON', () => {
    expect(ui).toContain('onClick={deleteModel}');
    expect(ui).toContain('deleteOfflineModel()');
  });

  it('…and ALSO when the beta is already OFF but the model is still stored', () => {
    /**
     * THE CASE THE ADMIN DESCRIBED. With the beta off, nothing on screen mentions it — while hundreds
     * of MB sit on the phone. A Delete button that only appears next to the "on" state would be hidden
     * exactly where the user is looking for space.
     */
    expect(ui).toContain('{modelOnDevice && (');
    expect(ui).toMatch(/Delete downloaded model — free up/);
    // Turning it off must re-check, or the button never appears after the state that hides it.
    expect(ui).toMatch(/setBeta\(st\); saveBetaState\(st\);\s*\n\s*void refreshOnDevice\(\);/);
  });

  it('never offers Delete when nothing is stored', () => {
    // The flag is only set from a real device probe.
    expect(ui).toContain('setModelOnDevice(await offlineModelOnDevice())');
    expect(ui).toContain('catch { setModelOnDevice(false); }');
  });

  it('asks first — this is a real download to redo, on a phone that may be paying for data', () => {
    expect(ui).toMatch(/window\.confirm\('Delete the downloaded AI model/);
  });

  it('reports success ONLY when the browser really deleted it', () => {
    expect(ui).toMatch(/if \(res\.ok\) \{[\s\S]{0,240}setDeleteNote\(/);
    expect(ui).toMatch(/setDlError\(`The model could not be deleted/);
  });

  it('the old text admitting the space could not be freed is gone', () => {
    // It read: "stays cached on your device until you clear the app's browser data" — honest, but a
    // dead end inside an installed app. Now the screen offers the action instead of describing a wall.
    expect(ui).not.toMatch(/until you clear the app's browser data/);
    expect(ui).toMatch(/Delete removes the model from your phone and frees the space/);
  });

  it('the probe is lazy — a user who never opens the beta never downloads web-llm', () => {
    // offlineModelOnDevice dynamically imports web-llm, so calling it on mount would defeat the whole
    // reason that import is lazy.
    expect(ui).not.toMatch(/useEffect\(\(\) => \{\s*void refreshOnDevice/);
    expect(ui).toMatch(/const openBeta = \(\) => \{[\s\S]{0,400}void refreshOnDevice\(\);/);
  });
});
