// 🗺️ THE MAP CARD AND MY MAPS ON SCREEN (admin 2026-11-27, wave 2 part 2). The card under a build step shows THE picture the server
// measured (or says "Map preview unavailable" and why — never a stand-in), a legend of only what the map has, the player start, and a
// real Save; My maps lists, uses and deletes through the real client calls. The event reaches the chat through the reducer (checked
// there), survives a reopen through the timeline, and every server reply is parsed before it is trusted.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';

const fetchMock = vi.fn();
vi.mock('../../lib/authedFetch', () => ({ authedFetch: (...a: unknown[]) => fetchMock(...a) }));

import { MapPreviewCard } from './MapPreviewCard';
import { MapLibraryPicker } from './MapLibraryPicker';
import { agentV3Reducer } from './agentV3Reducer';
import { conversationToEvents } from './agentV3History';
import { createTimelineRecorder } from '../../server/AgentV3/SessionTimeline';
import { listMyMaps, saveMyMap, deleteMyMap } from '../../lib/mapLibraryClient';
import { MAP_CELL, mapLegend, type MapPreview, type MapPreviewCard as Card } from '../../lib/mapPreview';

const preview: MapPreview = {
  v: 1, width: 8, height: 8, cells: MAP_CELL.deepSea.repeat(16) + MAP_CELL.grass.repeat(40) + MAP_CELL.road.repeat(8), sideMeters: 5000, mode: 'loop', seed: 77,
  boundary: 'none', spawn: { u: 0.25, v: 0.75 }, counts: { roadCells: 8, ponds: 0, plots: 0 },
};
const plan = { areaKm2: 25, sideKm: 5, archetype: 'desert', boundary: 'mountains', water: { sea: false, rivers: 0, lakes: 0, ponds: 2, canals: 0 }, roadStyle: 'grid', density: 'normal', region: null, gameType: 'shooter', timeOfDay: null, hours: null, seed: 77, profile: 'open-world' };
const card: Card = { preview, title: 'Your map, from above', plan };

beforeEach(() => fetchMock.mockReset());

describe('the map card', () => {
  it('shows the picture, the size and seed, a legend of only what the map has, the player start and Save', () => {
    const html = renderToStaticMarkup(<MapPreviewCard card={card} />);
    expect(html).toContain('data-testid="map-preview-canvas"');
    expect(html).toContain('5 km x 5 km · seed 77');
    expect(html).toContain('data-testid="map-preview-spawn"');
    expect(html).toContain('left:25%;top:75%');
    for (const l of mapLegend(preview)) expect(html).toContain(l.label);
    expect(html).not.toContain('Snow'); // not on this map, so not in the legend
    expect(html).toContain('Save to My maps');
    expect(html).not.toContain('map-preview-unavailable');
  });

  it('unavailable: says so and why, draws no picture', () => {
    const html = renderToStaticMarkup(<MapPreviewCard card={{ preview: null, unavailable: 'Map preview unavailable: it did not finish within 10 s and was stopped.', title: 'Your map, from above', plan }} />);
    expect(html).toContain('data-testid="map-preview-unavailable"');
    expect(html).toContain('Map preview unavailable: it did not finish within 10 s and was stopped.');
    expect(html).not.toContain('<canvas');
  });

  it('a changed layer is named on the card', () => {
    const html = renderToStaticMarkup(<MapPreviewCard card={{ ...card, changed: 'Changed only the roads: a smart-city grid with highways → curvy hill roads.' }} />);
    expect(html).toContain('Changed only the roads');
  });

  it('every button is wired to a real call (save on the card; use and delete in My maps)', () => {
    const cardSrc = readFileSync('src/components/agentv3/MapPreviewCard.tsx', 'utf8');
    expect(cardSrc).toMatch(/await saveMyMap\(clean, card\.plan, card\.preview\)/);
    const pickerSrc = readFileSync('src/components/agentv3/MapLibraryPicker.tsx', 'utf8');
    expect(pickerSrc).toMatch(/onClick=\{\(\) => onUse\(useSavedMapPrompt\(m\.name, m\.plan\.profile\)\)\}/);
    expect(pickerSrc).toMatch(/await deleteMyMap\(m\.id\)/);
    expect(pickerSrc).toMatch(/listMyMaps\(\)/);
    const panel = readFileSync('src/components/agentv3/AgentV3Panel.tsx', 'utf8');
    expect(panel).toMatch(/<MapLibraryPicker\s+onUse=\{\(message\) => \{ setPrompt\(message\)/);
    expect(panel).toMatch(/msg\.mapPreview && !msg\.streaming && <MapPreviewCard card=\{msg\.mapPreview\} \/>/);
  });

  it('My maps starts by loading the account\'s maps', () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ maps: [] })));
    const html = renderToStaticMarkup(<MapLibraryPicker onUse={() => {}} />);
    expect(html).toContain('My maps');
    expect(html).toContain('Loading your maps');
  });
});

describe('the client calls the real routes and parses every reply', () => {
  it('list / save / delete', async () => {
    const map = { id: 'a'.repeat(24), name: 'Ganga Nagar', plan, preview, createdAt: 1 };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ maps: [map, { id: 'bad' }] })));
    const list = await listMyMaps();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/map-library');
    expect(list.ok && list.value.map((m) => m.name)).toEqual(['Ganga Nagar']); // the malformed row is dropped

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ map })));
    const saved = await saveMyMap('Ganga Nagar', plan, preview);
    expect(fetchMock.mock.lastCall![0]).toBe('/api/map-library');
    expect(JSON.parse(fetchMock.mock.lastCall![1].body)).toEqual({ name: 'Ganga Nagar', plan, preview });
    expect(saved.ok).toBe(true);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'You already have a map called "Ganga Nagar".' }), { status: 409 }));
    expect(await saveMyMap('Ganga Nagar', plan, preview)).toEqual({ ok: false, error: 'You already have a map called "Ganga Nagar".' });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    expect((await deleteMyMap(map.id)).ok).toBe(true);
    expect(fetchMock.mock.lastCall![0]).toBe(`/api/map-library/${map.id}`);
    expect(fetchMock.mock.lastCall![1].method).toBe('DELETE');
  });
});

describe('the event reaches the chat, and comes back on reopen', () => {
  const empty = agentV3Reducer({ narration: [], activity: [], files: [], diffs: [], terminal: [], todos: [], agents: {}, checkpoints: [] } as any, { type: 'workspace', workspaceId: 'w', ts: 1 } as any);

  it('a map_preview event becomes a chat line carrying the card; a malformed card is dropped', () => {
    const s = agentV3Reducer(empty, { type: 'map_preview', card, ts: 5 });
    expect(s.narration.at(-1)).toMatchObject({ text: 'Your map, from above', mapPreview: { preview: { seed: 77 } } });
    const bad = agentV3Reducer(empty, { type: 'map_preview', card: { title: 'x', preview: { v: 1, width: 8, height: 8, cells: 'q' } } as any, ts: 6 });
    expect(bad.narration).toEqual(empty.narration);
  });

  it('the timeline keeps the card and a reopened chat shows it again', () => {
    const rec = createTimelineRecorder();
    rec.record({ type: 'map_preview', card, ts: 9 });
    const timeline = rec.events();
    expect(timeline).toEqual([{ t: 'map', card, ts: 9 }]);
    const events = conversationToEvents({ id: 'c', workspaceId: 'w', title: 't', status: 'complete', messages: [], timeline });
    const replayed = events.find((e) => e.type === 'map_preview');
    expect(replayed).toMatchObject({ type: 'map_preview', card: { title: 'Your map, from above' } });
  });
});
