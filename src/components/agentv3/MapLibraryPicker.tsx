// 📚 MY MAPS — the maps this account saved from a build's map card (admin 2026-11-27, wave 2 part 2). Each row shows the map from
// above, what it is, and two real actions: Use (puts "Use my saved map "<name>" for this game." in the composer — the build reads
// the saved plan and seed by that name for the signed-in account) and Delete (removes it from the library on the server).
// Data: /api/map-library (routes/mapLibrary.ts). Nothing runs until the user sends the message.

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { deleteMyMap, listMyMaps, type LibraryMap } from '../../lib/mapLibraryClient';
import { mapSideLabel, useSavedMapPrompt } from '../../lib/mapPreview';
import { MapPicture } from './MapPreviewCard';

const describe = (m: LibraryMap): string => {
  const p = m.plan;
  const water = [p.water.sea ? 'sea' : '', p.water.rivers ? `${p.water.rivers} river${p.water.rivers === 1 ? '' : 's'}` : '', p.water.lakes ? `${p.water.lakes} lake${p.water.lakes === 1 ? '' : 's'}` : '', p.water.ponds ? `${p.water.ponds} pond${p.water.ponds === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
  return `${p.archetype} land · ${p.boundary} edge · ${p.roadStyle} roads${water ? ` · ${water}` : ''}`;
};

export function MapLibraryPicker({ onUse }: { onUse: (message: string) => void }) {
  const [maps, setMaps] = useState<LibraryMap[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void listMyMaps().then((r) => {
      if (!live) return;
      if (r.ok) { setMaps(r.value); setError(''); } else setError(r.error);
    });
    return () => { live = false; };
  }, []);

  const remove = async (m: LibraryMap) => {
    if (busy) return;
    setBusy(m.id);
    const r = await deleteMyMap(m.id);
    setBusy(null);
    if (r.ok) { setMaps((list) => (list ?? []).filter((x) => x.id !== m.id)); setError(''); } else setError(r.error);
  };

  return (
    <div className="flex flex-col gap-2 p-2" data-testid="map-library-picker">
      <div className="text-xs font-semibold text-ink">My maps</div>
      <p className="text-[11px] leading-snug text-muted">Maps you saved from a game build. Use one to build a new game on the same map — same size, land, edge, water, roads and seed.</p>
      {error && <p className="text-[11px] text-danger" role="alert">{error}</p>}
      {!error && maps === null && <p className="text-[11px] text-muted" role="status">Loading your maps…</p>}
      {maps && maps.length === 0 && (
        <p className="text-[11px] text-muted" data-testid="map-library-empty">No saved maps yet. When a game build shows &ldquo;Your map, from above&rdquo;, press Save to My maps.</p>
      )}
      {maps && maps.length > 0 && (
        <ul className="flex flex-col gap-2">
          {maps.map((m) => (
            <li key={m.id} className="flex gap-2 rounded-lg border border-line bg-surface p-2" data-testid="map-library-row">
              {m.preview
                ? <MapPicture preview={m.preview} size={72} label={`Top-down picture of ${m.name}`} />
                : <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg border border-line text-center text-[9px] text-muted">No picture was saved</div>}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="truncate text-xs font-semibold text-ink">{m.name}</div>
                <div className="text-[10px] text-muted">{mapSideLabel(m.plan.sideKm * 1000)} · {describe(m)}</div>
                <div className="mt-auto flex gap-1.5">
                  <button type="button" onClick={() => onUse(useSavedMapPrompt(m.name, m.plan.profile))} data-testid="map-library-use"
                    className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-on-accent">Use this map</button>
                  <button type="button" onClick={() => void remove(m)} disabled={busy === m.id} aria-label={`Delete ${m.name}`} data-testid="map-library-delete"
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted hover:text-danger disabled:opacity-60">
                    <Trash2 className="h-3 w-3" aria-hidden />{busy === m.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
