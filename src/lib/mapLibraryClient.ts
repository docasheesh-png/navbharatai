// The client half of the map library (server: routes/mapLibrary.ts). Every server body enters through a parser here — a reply that is
// not shaped like the library's answer is an error, never data.

import { authedFetch } from './authedFetch';
import { parseMapPreview, parseSavedMapPlan, type MapPreview, type SavedMapPlan } from './mapPreview';

export interface LibraryMap { id: string; name: string; plan: SavedMapPlan; preview: MapPreview | null; createdAt: number }

export function parseLibraryMap(raw: unknown): LibraryMap | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^[a-f0-9]{24}$/.test(r.id) || typeof r.name !== 'string' || !r.name || r.name.length > 60) return null;
  const plan = parseSavedMapPlan(r.plan);
  if (!plan) return null;
  const preview = r.preview ? parseMapPreview(r.preview) : null;
  return { id: r.id, name: r.name, plan, preview, createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0 };
}

export function parseLibraryList(raw: unknown): LibraryMap[] | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { maps?: unknown }).maps)) return null;
  return ((raw as { maps: unknown[] }).maps).map(parseLibraryMap).filter((m): m is LibraryMap => m !== null);
}

const errorOf = async (res: Response, fallback: string): Promise<string> => {
  const body = await res.json().catch(() => null) as { error?: unknown } | null;
  if (res.status === 401) return 'Sign in to use your map library.';
  return typeof body?.error === 'string' && body.error ? body.error : fallback;
};

export type LibraryResult<T> = { ok: true; value: T; error?: undefined } | { ok: false; value?: undefined; error: string };

export async function listMyMaps(): Promise<LibraryResult<LibraryMap[]>> {
  try {
    const res = await authedFetch('/api/map-library');
    if (!res.ok) return { ok: false, error: await errorOf(res, 'Your saved maps could not be loaded. Try again in a moment.') };
    const maps = parseLibraryList(await res.json().catch(() => null));
    return maps ? { ok: true, value: maps } : { ok: false, error: 'Your saved maps could not be read. Try again in a moment.' };
  } catch {
    return { ok: false, error: 'Your saved maps could not be loaded. Check your connection and try again.' };
  }
}

export async function saveMyMap(name: string, plan: SavedMapPlan, preview: MapPreview | null): Promise<LibraryResult<LibraryMap>> {
  try {
    const res = await authedFetch('/api/map-library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, plan, preview }) });
    if (!res.ok) return { ok: false, error: await errorOf(res, 'The map could not be saved. Try again in a moment.') };
    const map = parseLibraryMap(((await res.json().catch(() => null)) as { map?: unknown } | null)?.map);
    return map ? { ok: true, value: map } : { ok: false, error: 'The map was sent, but the reply could not be read. Open My maps to check it is there.' };
  } catch {
    return { ok: false, error: 'The map could not be saved. Check your connection and try again.' };
  }
}

export async function deleteMyMap(id: string): Promise<LibraryResult<true>> {
  try {
    const res = await authedFetch(`/api/map-library/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) return { ok: false, error: await errorOf(res, 'The map could not be deleted. Try again in a moment.') };
    return { ok: true, value: true };
  } catch {
    return { ok: false, error: 'The map could not be deleted. Check your connection and try again.' };
  }
}
