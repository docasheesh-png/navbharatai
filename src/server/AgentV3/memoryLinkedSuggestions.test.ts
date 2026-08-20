// Tests for the 💡 bulb's link to the app's own memory (admin 2026-08-20).
//
// The behaviour being locked: a feature the USER ASKED FOR and does not have outranks any idea we could
// infer from the files — and a feature they already have is never suggested back to them.

import { describe, it, expect } from 'vitest';
import { memoryLinkedSuggestions, mergeSuggestions, MAX_MEMORY_SUGGESTIONS } from './memoryLinkedSuggestions';
import type { NextSuggestion } from './nextBuildSuggestions';
import type { ProjectGraph } from './WorkspaceMemory';

/** A graph shaped like a small built app. */
function graphOf(files: string[], components: string[] = [], routes: string[] = []): ProjectGraph {
  return { files, components, routes } as unknown as ProjectGraph;
}

const GAME_FILES = ['src/App.tsx', 'src/Board.tsx', 'src/score.ts'];
const GAME_SOURCES = [
  { path: 'src/App.tsx', content: 'export default function App(){ return <Board/> }' },
  { path: 'src/Board.tsx', content: 'export function Board(){ return <div>board</div> }' },
  { path: 'src/score.ts', content: 'export const score = 0;' },
];

describe('memoryLinkedSuggestions — the user\'s own unmet asks', () => {
  it('offers a feature the user asked for that the app genuinely does not have', () => {
    const out = memoryLinkedSuggestions({
      requests: ['build a game with a search box'],
      graph: graphOf(GAME_FILES),
      sources: GAME_SOURCES,
    });
    expect(out.length).toBeGreaterThan(0);
    const s = out[0];
    expect(s.title.toLowerCase()).toContain('search');
    // It must say WHY it is being offered — this is the user's own ask, not an idea we invented.
    expect(s.detail).toContain('You asked for this earlier');
    // 'search' carries a code fingerprint, so its absence is a CHECKED fact and is said plainly.
    expect(s.detail).toContain('not in the app yet');
    expect(s.prompt.toLowerCase()).toContain('search');
    expect(s.id.startsWith('asked-')).toBe(true);
  });

  it('softens the claim when absence could NOT be proven from the code — and says so', () => {
    // 'chat / messaging' has no code fingerprint in the coverage table, so all we truly know is that
    // nothing is NAMED for it. A chat built inline would land here, so the wording must not assert.
    const out = memoryLinkedSuggestions({
      requests: ['add a chat'],
      graph: graphOf(GAME_FILES),
      sources: GAME_SOURCES,
    });
    expect(out[0].detail).toContain('could not find');
    expect(out[0].detail).toContain('ignore this if it is already there');
    expect(out[0].detail).not.toContain('not in the app yet');
  });

  it('puts the CHECKED-fact suggestions above the merely-unnamed ones', () => {
    const out = memoryLinkedSuggestions({
      requests: ['add a chat and a search box'],
      graph: graphOf(GAME_FILES),
      sources: GAME_SOURCES,
    });
    // search is confirmable (it has an evidence pattern); chat is not.
    expect(out[0].title).toBe('Finish the search');
  });

  it('speaks the label the way a person would — never the table\'s slash-separated synonyms', () => {
    const out = memoryLinkedSuggestions({
      requests: ['add a chat'],
      graph: graphOf(GAME_FILES),
      sources: GAME_SOURCES,
    });
    // The coverage table calls this 'chat / messaging'; "Finish the chat / messaging" is not English.
    expect(out[0].title).toBe('Finish the chat');
    expect(out[0].prompt).toContain('Add the chat');
    // The id keeps the full label, so two features can never collide.
    expect(out[0].id).toBe('asked-chat-messaging');
  });

  it('NEVER suggests something the app already has', () => {
    const out = memoryLinkedSuggestions({
      requests: ['add a search box'],
      graph: graphOf([...GAME_FILES, 'src/Search.tsx'], ['Search']),
      sources: [...GAME_SOURCES, { path: 'src/Search.tsx', content: 'export function Search(){ const [searchTerm,setSearchTerm]=useState(""); return <input placeholder="Search…"/> }' }],
    });
    expect(out.map((s) => s.id)).not.toContain('asked-search');
  });

  it('reads the NEWEST request first — the freshest ask is the most useful "what next"', () => {
    const out = memoryLinkedSuggestions({
      requests: ['add a search box', 'also add a chat'],
      graph: graphOf(GAME_FILES),
      sources: GAME_SOURCES,
      max: 1,
    });
    expect(out).toHaveLength(1);
    expect(out[0].title.toLowerCase()).toContain('chat');
  });

  it('is bounded, so the bulb still has room for the other ideas', () => {
    const out = memoryLinkedSuggestions({
      requests: ['add search, a chat, a profile page, notifications and a settings screen'],
      graph: graphOf(GAME_FILES),
      sources: GAME_SOURCES,
    });
    expect(out.length).toBeLessThanOrEqual(MAX_MEMORY_SUGGESTIONS);
  });

  it('says nothing when there is no memory, no request, or nothing built', () => {
    expect(memoryLinkedSuggestions({ requests: [], graph: graphOf(GAME_FILES), sources: GAME_SOURCES })).toEqual([]);
    expect(memoryLinkedSuggestions({ requests: ['   '], graph: graphOf(GAME_FILES), sources: GAME_SOURCES })).toEqual([]);
    expect(memoryLinkedSuggestions({ requests: ['add a search box'], graph: graphOf([]) })).toEqual([]);
  });

  it('never throws on a malformed graph — the bulb is not worth an error', () => {
    expect(() => memoryLinkedSuggestions({
      requests: ['add a search box'],
      graph: undefined as unknown as ProjectGraph,
    })).not.toThrow();
  });
});

describe('mergeSuggestions — the user\'s ask outranks our inference', () => {
  const mem: NextSuggestion[] = [
    { id: 'asked-search', title: 'Finish the search', detail: 'x', prompt: 'p', kind: 'domain' },
  ];
  const derived: NextSuggestion[] = [
    { id: 'dark-mode', title: 'Add a dark mode', detail: 'y', prompt: 'q', kind: 'enhancement' },
    { id: 'domain-search', title: 'Finish the search', detail: 'z', prompt: 'r', kind: 'domain' },
  ];

  it('puts the memory-derived suggestions first', () => {
    expect(mergeSuggestions(mem, derived, 10)[0].id).toBe('asked-search');
  });

  it('drops a duplicate that arrived from both sides — by TITLE, not just id', () => {
    // The two ids differ ('asked-…' vs 'domain-…') but it is one feature; showing it twice looks broken.
    const out = mergeSuggestions(mem, derived, 10);
    expect(out.map((s) => s.id)).toEqual(['asked-search', 'dark-mode']);
  });

  it('respects the cap and survives junk entries', () => {
    expect(mergeSuggestions(mem, derived, 1)).toHaveLength(1);
    expect(mergeSuggestions([null as unknown as NextSuggestion], derived, 5).map((s) => s.id))
      .toEqual(['dark-mode', 'domain-search']);
  });
});
