// "MERA 'GANGA NAGAR' MAP USE KARO" — which of the user's saved maps a request names (admin 2026-11-27, wave 2 part 2).
//
// A saved map is reused only when the request names it AND speaks of a map: the name alone ("Ganga Nagar" in a story about a town) is
// not a request for that map. The longest name that matches wins ("Ganga Nagar 2" over "Ganga Nagar"). The library's Use button sends
// lib/mapPreview.ts useSavedMapPrompt, which this reads back. PURE.

const MAP_WORD = /\b(?:map|maps|naksha|nakshe|nakshaa)\b|नक्शा|नक्शे|नक़्शा|मैप/iu;
const norm = (s: string): string => String(s ?? '').normalize('NFKC').toLowerCase().replace(/["'“”‘’`]/g, ' ').replace(/\s+/g, ' ').trim();
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function savedMapNamed<T extends { name: string }>(request: string | null | undefined, maps: readonly T[]): T | null {
  const text = norm(String(request ?? ''));
  if (!text || !MAP_WORD.test(text)) return null;
  let best: T | null = null;
  for (const m of maps) {
    const name = norm(m.name);
    if (!name) continue;
    if (new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(name)}(?:$|[^\\p{L}\\p{N}])`, 'u').test(text) && (!best || name.length > norm(best.name).length)) best = m;
  }
  return best;
}
