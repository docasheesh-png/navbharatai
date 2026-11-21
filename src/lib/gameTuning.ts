// THE TUNE PANEL'S SIDE OF THE PREVIEW BRIDGE (admin 2026-11-21: "a tuning panel in the preview: sliders for speed,
// difficulty and so on, without prompting again"). The game kit's core/tuning.ts announces its adjustable numbers to the
// preview ({ nbTuneList }) and accepts { nbTuneSet } only from the preview window. This module reads what the frame
// sent — never trusting it: at most MAX_TUNABLES, a plain key, finite numbers, min < max — and writes the file Save
// stores (the same text the kit's tuningFile() writes, asserted equal in tests). PURE.

export interface TuneItem { key: string; label: string; min: number; max: number; step: number; value: number; fallback: number }

export const MAX_TUNABLES = 30;
export const TUNING_VALUES_PATH = 'src/game/tuning.values.ts';
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/** The sliders a preview frame announced, or null when the message is not a tuning list. */
export function readTuneList(data: unknown): TuneItem[] | null {
  const list = (data as { nbTuneList?: unknown } | null)?.nbTuneList;
  if (!Array.isArray(list)) return null;
  const out: TuneItem[] = [];
  for (const raw of list.slice(0, MAX_TUNABLES)) {
    const r = raw as Partial<TuneItem> | null;
    if (!r || typeof r.key !== 'string' || !KEY.test(r.key)) continue;
    const nums = [r.min, r.max, r.step, r.value, r.fallback];
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    if ((r.max as number) <= (r.min as number) || (r.step as number) <= 0) continue;
    out.push({ key: r.key, label: typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 40) : r.key, min: r.min as number, max: r.max as number, step: r.step as number, value: r.value as number, fallback: r.fallback as number });
  }
  return out;
}

/** The message that sets one slider's value in the game. */
export function tuneSetMessage(key: string, value: number): { nbTuneSet: { key: string; value: number } } {
  return { nbTuneSet: { key, value } };
}

/** The message that asks the game to announce its sliders again (after the preview reloads). */
export const TUNE_LIST_ASK = { nbTune: 'list' } as const;

/** src/game/tuning.values.ts holding these values — byte-for-byte what the kit's tuningFile() writes. */
export function tuningValuesFile(values: Record<string, number>): string {
  const lines = Object.keys(values).filter((k) => KEY.test(k) && Number.isFinite(values[k])).sort()
    .map((k) => '  ' + k + ': ' + Number(values[k]) + ',');
  return '// Saved from the Tune panel in NavBharatAI\'s preview. Edit here or drag the sliders and Save again.\n'
    + 'export const TUNING: Record<string, number> = {\n' + lines.join('\n') + (lines.length ? '\n' : '') + '};\n';
}
