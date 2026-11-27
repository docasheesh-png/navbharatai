// 🗺️ THE MAP FROM ABOVE, IN THE CHAT (admin 2026-11-27, wave 2 part 2). Under the build step that made or changed a game's Athree map:
// a small top-down picture of THAT map — computed on the server from the game's own world code and seed (mapPreviewRun.ts) — with a
// legend of what it really shows, the player's start, and a Save button that keeps the map in the user's library.
// When the picture could not be computed, the card says "Map preview unavailable" and why. It never draws a stand-in.

import { useEffect, useRef, useState } from 'react';
import { Map as MapIcon, Save } from 'lucide-react';
import { mapLegend, mapPreviewPixels, mapSideLabel, MAP_CELL_RGB, type MapCellCode, type MapPreview, type MapPreviewCard as MapPreviewCardData } from '../../lib/mapPreview';
import { saveMyMap } from '../../lib/mapLibraryClient';

/** Paints a preview grid into a canvas (one pixel per cell, scaled up crisp by CSS) with the spawn marked. */
export function MapPicture({ preview, size = 192, label }: { preview: MapPreview; size?: number; label: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = preview.width;
    canvas.height = preview.height;
    const image = ctx.createImageData(preview.width, preview.height);
    image.data.set(mapPreviewPixels(preview));
    ctx.putImageData(image, 0, 0);
  }, [preview]);
  return (
    <div className="relative shrink-0 overflow-hidden rounded-lg border border-line" style={{ width: size, height: size }}>
      <canvas ref={ref} role="img" aria-label={label} data-testid="map-preview-canvas" className="block h-full w-full" style={{ imageRendering: 'pixelated' }} />
      {preview.spawn && (
        <span
          title="Where the player starts"
          data-testid="map-preview-spawn"
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-danger"
          style={{ left: `${preview.spawn.u * 100}%`, top: `${preview.spawn.v * 100}%` }}
        />
      )}
    </div>
  );
}

/** One legend colour, painted the way the map is (a canvas), so the swatch is exactly the picture's colour. */
function Swatch({ code }: { code: MapCellCode }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const [r, g, b] = MAP_CELL_RGB[code];
    const image = ctx.createImageData(1, 1);
    image.data.set([r, g, b, 255]);
    ctx.putImageData(image, 0, 0);
  }, [code]);
  return <canvas ref={ref} width={1} height={1} aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm border border-line" style={{ imageRendering: 'pixelated' }} />;
}

export function MapLegend({ preview }: { preview: MapPreview }) {
  return (
    <ul className="flex flex-wrap gap-x-2.5 gap-y-1" data-testid="map-preview-legend">
      {mapLegend(preview).map((l) => (
        <li key={l.code} className="flex items-center gap-1 text-[10px] text-muted"><Swatch code={l.code} />{l.label}</li>
      ))}
      {preview.spawn && <li className="flex items-center gap-1 text-[10px] text-muted"><span aria-hidden className="h-2.5 w-2.5 rounded-full border-2 border-surface bg-danger" />Player start</li>}
    </ul>
  );
}

export function MapPreviewCard({ card }: { card: MapPreviewCardData }) {
  const [saving, setSaving] = useState<'closed' | 'open' | 'busy'>('closed');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const save = async () => {
    if (!card.plan || saving === 'busy') return;
    const clean = name.trim();
    if (!clean) { setError('Give the map a name first.'); return; }
    setSaving('busy');
    setError('');
    const r = await saveMyMap(clean, card.plan, card.preview);
    if (r.ok) { setSaved(r.value.name); setSaving('closed'); setName(''); }
    else { setError(r.error); setSaving('open'); }
  };

  return (
    <div className="mt-2 rounded-xl border border-line bg-card p-3" data-testid="map-preview-card">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink"><MapIcon className="h-3.5 w-3.5" aria-hidden />{card.title}</div>
      {card.changed && <p className="mb-2 text-[11px] text-accent-text" data-testid="map-preview-changed">{card.changed}</p>}
      {card.preview ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <MapPicture preview={card.preview} label={`Top-down picture of your map, ${mapSideLabel(card.preview.sideMeters)}`} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-[11px] text-muted">{mapSideLabel(card.preview.sideMeters)} · seed {card.preview.seed} · drawn from your game&apos;s own map code. The towns and buildings your game adds while it runs are not in this picture.</p>
            <MapLegend preview={card.preview} />
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-warn" role="status" data-testid="map-preview-unavailable">{card.unavailable ?? 'Map preview unavailable.'}</p>
      )}
      {card.plan && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {saving === 'closed' ? (
            <button type="button" onClick={() => { setSaving('open'); setSaved(''); setError(''); }} data-testid="map-preview-save-open"
              className="flex w-fit items-center gap-1.5 rounded-lg bg-raised px-2.5 py-1.5 text-[11px] font-semibold text-ink hover:bg-surface">
              <Save className="h-3.5 w-3.5" aria-hidden />Save to My maps
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder="Name this map, e.g. Ganga Nagar" aria-label="Map name"
                data-testid="map-preview-save-name" disabled={saving === 'busy'}
                onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
                className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[11px] text-ink outline-none placeholder:text-muted" />
              <button type="button" onClick={() => void save()} disabled={saving === 'busy'} data-testid="map-preview-save"
                className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-on-accent disabled:opacity-60">{saving === 'busy' ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => { setSaving('closed'); setError(''); }} disabled={saving === 'busy'}
                className="rounded-lg px-2 py-1.5 text-[11px] text-muted hover:text-ink">Cancel</button>
            </div>
          )}
          {saved && <p className="text-[11px] text-success" role="status" data-testid="map-preview-saved">Saved as &ldquo;{saved}&rdquo;. Find it under Mode → My maps, and use it in a new game from there.</p>}
          {error && <p className="text-[11px] text-danger" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
