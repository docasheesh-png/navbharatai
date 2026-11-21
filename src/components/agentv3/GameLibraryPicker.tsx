// THE GAME LIBRARY ON SCREEN (2026-11-19). Browse NavBharatAI's reviewed 3D models with a picture each, search them,
// filter by kind, and tap one to FILL the composer with "add this exact model to my game" — nothing runs until the user
// sends it, exactly like the 💡 suggestions. Data comes from the free /api/agentv3/game-library (no model call). When the
// library is not switched on for this account the screen says so plainly instead of offering what a build would refuse.

import { useEffect, useRef, useState } from 'react';
import { Search, Box } from 'lucide-react';
import { authedFetch } from '../../lib/authedFetch';

export interface LibraryRow {
  id: string;
  name: string;
  category: string;
  subjects: string[];
  animations: string[];
  thumb: string | null;
}
export interface LibraryResponse {
  enabled: boolean;
  rows: LibraryRow[];
  total: number;
  categories: Array<{ category: string; count: number }>;
  prompts: Record<string, string>;
  /** Per model: the instruction that makes it the character the user plays as. Absent for a map place. */
  characterPrompts: Record<string, string>;
}

/** The one place a server body enters this screen: anything not shaped like a library answer is an error, never data. */
export function parseLibraryResponse(body: unknown): LibraryResponse | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.enabled !== 'boolean' || !Array.isArray(b.rows) || typeof b.total !== 'number' || !Array.isArray(b.categories) || !b.prompts || typeof b.prompts !== 'object') return null;
  const rows = b.rows.filter((r): r is LibraryRow => !!r && typeof r === 'object'
    && typeof (r as LibraryRow).id === 'string' && typeof (r as LibraryRow).name === 'string' && typeof (r as LibraryRow).category === 'string'
    && Array.isArray((r as LibraryRow).subjects) && Array.isArray((r as LibraryRow).animations)
    && ((r as LibraryRow).thumb === null || (typeof (r as LibraryRow).thumb === 'string' && (r as LibraryRow).thumb!.startsWith('/api/agentv3/game-library/thumb/'))));
  const texts = (v: unknown) => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v as Record<string, unknown> : {}).filter(([, t]) => typeof t === 'string')) as Record<string, string>;
  const prompts = texts(b.prompts);
  const categories = b.categories.filter((c): c is { category: string; count: number } => !!c && typeof (c as { category: unknown }).category === 'string' && typeof (c as { count: unknown }).count === 'number');
  return { enabled: b.enabled, rows, total: b.total, categories, prompts, characterPrompts: texts(b.characterPrompts) };
}

const label = (category: string) => category.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

interface Props {
  /** Receives the ready-to-send instruction for the tapped model. */
  onPick: (text: string) => void;
}

export function GameLibraryPicker({ onPick }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [use, setUse] = useState<'add' | 'character'>('add');
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef(0);

  useEffect(() => {
    const id = ++request.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: '60' });
        if (query.trim()) params.set('q', query.trim());
        if (category) params.set('category', category);
        const res = await authedFetch(`/api/agentv3/game-library?${params.toString()}`);
        const parsed = res.ok ? parseLibraryResponse(await res.json().catch(() => null)) : null;
        if (id !== request.current) return;
        if (!parsed) { setError(res.status === 401 ? 'Sign in to browse the library.' : 'The library could not be loaded. Try again in a moment.'); return; }
        setError(null); setData(parsed);
      } catch {
        if (id === request.current) setError('The library could not be loaded. Check your connection and try again.');
      } finally {
        if (id === request.current) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query, category]);

  return (
    <div className="flex flex-col gap-2 p-2" data-testid="game-library-picker">
      <div className="text-xs font-semibold text-ink">Game library</div>
      <p className="text-[11px] leading-snug text-muted">
        {use === 'add' ? 'Ready 3D models for your game. Tap one to add it to your message, then send.' : 'Tap a model to make it the character you play as, then send.'}
      </p>
      <div className="flex gap-1" role="group" aria-label="What a tapped model does">
        {([['add', 'Add to my game'], ['character', 'Use as my character']] as const).map(([mode, text]) => (
          <button
            key={mode}
            type="button"
            onClick={() => setUse(mode)}
            aria-pressed={use === mode}
            data-testid={`game-library-use-${mode}`}
            className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold ${use === mode ? 'bg-indigo-600 text-on-accent' : 'bg-raised text-muted hover:text-ink'}`}
          >
            {text}
          </button>
        ))}
      </div>
      {data && !data.enabled && (
        <p className="rounded-lg border border-line bg-raised px-2 py-1.5 text-[11px] leading-snug text-muted" data-testid="game-library-off">
          The model library is not switched on for your account yet, so a game uses NavBharatAI&apos;s built-in shapes instead. You can still look around.
        </p>
      )}
      <label className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2">
        <Search className="h-3.5 w-3.5 text-muted" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value.slice(0, 60))}
          placeholder="Search: cow, castle, car…"
          aria-label="Search the game library"
          className="h-9 min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-muted"
        />
      </label>
      {data && data.categories.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-0.5" role="group" aria-label="Kind of model">
          {[{ category: '', count: data.categories.reduce((n, c) => n + c.count, 0) }, ...data.categories].map((c) => (
            <button
              key={c.category || 'all'}
              type="button"
              onClick={() => setCategory(c.category)}
              aria-pressed={category === c.category}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${category === c.category ? 'bg-indigo-600 text-on-accent' : 'bg-raised text-muted hover:text-ink'}`}
            >
              {c.category ? label(c.category) : 'All'}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-[11px] text-danger" role="alert">{error}</p>}
      {!error && data && data.rows.length === 0 && !loading && (
        <p className="text-[11px] text-muted">Nothing in the library matches “{query}”. Describe it in your message and the builder will make it.</p>
      )}
      <div className="grid max-h-72 grid-cols-3 gap-1.5 overflow-y-auto overscroll-contain" aria-busy={loading}>
        {data?.rows.filter((row) => use === 'add' || !!data.characterPrompts[row.id]).map((row) => (
          <button
            key={row.id}
            type="button"
            title={row.animations.length ? `${row.name} — moves: ${row.animations.join(', ')}` : row.name}
            onClick={() => { const text = use === 'character' ? data.characterPrompts[row.id] : data.prompts[row.id]; if (text) onPick(text); }}
            className="flex flex-col items-center gap-0.5 rounded-lg border border-line bg-surface p-1 text-center hover:border-accent"
          >
            {row.thumb
              ? <img src={row.thumb} alt="" width={80} height={80} loading="lazy" className="h-16 w-16 object-contain" />
              : <span className="flex h-16 w-16 items-center justify-center text-muted"><Box className="h-7 w-7" aria-hidden /></span>}
            <span className="line-clamp-2 text-[10px] leading-tight text-ink">{row.name}</span>
          </button>
        ))}
      </div>
      {data && data.total > data.rows.length && (
        <p className="text-[10px] text-muted">Showing {data.rows.length} of {data.total}. Search to find the rest.</p>
      )}
    </div>
  );
}
