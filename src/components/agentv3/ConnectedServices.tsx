/**
 * CONNECTED SERVICES — the user attaching their OWN tools to the builder (MCP).
 *
 * NavBharatAI ships 211 built-in tools. This is how a user adds the ones we did not write: their
 * Notion workspace, their Linear board, their company's internal API, or any of the hundreds of
 * published MCP services. Once connected, the builder can use those tools while building their app.
 *
 * ═══ WHAT THIS SCREEN DELIBERATELY DOES NOT DO ═══
 *
 * It never shows a saved key back. The server returns the address and whether auth was configured,
 * never the value — so there is nothing here that could leak one, even into a screenshot. To change a
 * key, the user removes the service and adds it again, which is a small cost for a guarantee that
 * holds without anyone having to remember it.
 *
 * Every refusal comes from the SERVER and is shown verbatim. The reasons are genuinely different —
 * a name that is already taken, an address we cannot reach, a service that offered no tools — and
 * replacing them with one generic "could not connect" would leave the user guessing at which.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Puzzle, Trash2, Loader2, Plus, X } from 'lucide-react';

export interface ConnectedService {
  id: string;
  url: string;
  hasAuth: boolean;
}

interface Props {
  workspaceId: string;
  /** Fetch wrapper that carries the user's auth — the same one the rest of the panel uses. */
  authedFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

export const ConnectedServices: React.FC<Props> = ({ workspaceId, authedFetch }) => {
  const [services, setServices] = useState<ConnectedService[] | null>(null);
  const [max, setMax] = useState(5);
  // THE PAID-PLAN GATE (admin 2026-09-12). `null` = not answered yet, which renders as neither locked
  // nor open — a screen that guesses "locked" during a slow load would upsell a paying customer.
  const [canConnect, setCanConnect] = useState<boolean | null>(null);
  const [lockedMessage, setLockedMessage] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [id, setId] = useState('');
  const [url, setUrl] = useState('');
  const [authValue, setAuthValue] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authedFetch('/api/agentv3/mcp/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) { setServices([]); return; }
      setServices(Array.isArray(data.servers) ? data.servers : []);
      if (Number.isFinite(data.max)) setMax(Number(data.max));
      // The server decides the entitlement; the screen only renders it. An older server that does not
      // send the field leaves `canConnect` unset, and the form stays open exactly as it does today.
      if (typeof data.canConnect === 'boolean') {
        setCanConnect(data.canConnect);
        setLockedMessage(typeof data.lockedMessage === 'string' ? data.lockedMessage : '');
      }
    } catch {
      // An unreadable list is NOT "nothing connected" — but an empty list is the only honest thing to
      // render, so the error line says which it was.
      setServices([]);
      setError('Could not load your connected services just now.');
    }
  }, [authedFetch, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const connect = async () => {
    setError(''); setNote(''); setBusy('connect');
    try {
      const res = await authedFetch('/api/agentv3/mcp/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          id: id.trim(),
          url: url.trim(),
          // Sent as a normal Authorization header — the shape almost every MCP service expects. It is
          // stored for this workspace and never returned to the browser again.
          ...(authValue.trim() ? { headers: { Authorization: authValue.trim() } } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || 'Could not connect that service.'); return; }
      // Say what was actually gained, not just "connected" — the tool count is the thing that tells
      // the user it really worked.
      setNote(`Connected "${data.id}" — ${data.toolCount} tool(s) are now available while building.`);
      setId(''); setUrl(''); setAuthValue(''); setAdding(false);
      await load();
    } catch {
      setError('Could not reach NavBharatAI. Check your connection and try again.');
    } finally {
      setBusy('');
    }
  };

  const remove = async (serviceId: string) => {
    setError(''); setNote(''); setBusy(serviceId);
    try {
      const res = await authedFetch('/api/agentv3/mcp/remove', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, id: serviceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) { setError(data?.error || 'Could not remove that service.'); return; }
      await load();
    } catch {
      setError('Could not reach NavBharatAI. Check your connection and try again.');
    } finally {
      setBusy('');
    }
  };

  const atCap = (services?.length ?? 0) >= max;

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <p className="text-xs text-zinc-400 leading-relaxed">
        Connect your own tools — a Notion workspace, a Linear board, your company&apos;s own service —
        and NavBharatAI can use them while building this app. The service needs a public https address
        that speaks MCP.
      </p>

      {services === null ? (
        <div className="flex items-center gap-2 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : services.length === 0 ? (
        <p className="text-xs text-zinc-500">Nothing connected yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {services.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
              <Puzzle className="w-4 h-4 shrink-0 text-emerald-400" />
              <div className="min-w-0 flex-1">
                <div className="text-zinc-200 font-medium truncate">{s.id}</div>
                <div className="text-[11px] text-zinc-500 truncate">{s.url}{s.hasAuth ? ' · key saved' : ''}</div>
              </div>
              <button
                onClick={() => void remove(s.id)}
                disabled={!!busy}
                title={`Disconnect ${s.id}`}
                className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 disabled:opacity-40"
              >
                {busy === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {canConnect === false ? (
        /* LOCKED, HONESTLY — the form is not rendered at all rather than accepting a URL and then
           refusing it. Services ALREADY connected stay listed above and stay removable: a plan that
           lapsed must never trap a user's own key inside our database. */
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3 text-[11px] text-zinc-400 leading-relaxed">
          {lockedMessage || 'Connecting your own tools is part of the paid plan.'}
        </div>
      ) : !adding ? (
        <button
          onClick={() => { setAdding(true); setError(''); setNote(''); }}
          disabled={atCap || services === null}
          className="flex items-center justify-center gap-1.5 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs font-semibold disabled:opacity-40"
        >
          <Plus className="w-4 h-4" />
          {atCap ? `You can connect up to ${max} services` : 'Connect a service'}
        </button>
      ) : (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-300">Connect a service</span>
            <button onClick={() => setAdding(false)} className="text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
          </div>
          <label className="text-[11px] text-zinc-400">
            A short name for it
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="notion"
              className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 outline-none focus:border-zinc-500"
            />
          </label>
          <label className="text-[11px] text-zinc-400">
            Its address
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mcp"
              className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 outline-none focus:border-zinc-500"
            />
          </label>
          <label className="text-[11px] text-zinc-400">
            Key, if it needs one (optional)
            {/* type=password so it is not readable over a shoulder or in a screen share. It is never
                sent back to this screen once saved. */}
            <input
              type="password"
              value={authValue}
              onChange={(e) => setAuthValue(e.target.value)}
              placeholder="Bearer sk-…"
              className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 outline-none focus:border-zinc-500"
            />
          </label>
          <button
            onClick={() => void connect()}
            disabled={!id.trim() || !url.trim() || busy === 'connect'}
            className="py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold disabled:opacity-40"
          >
            {busy === 'connect' ? 'Checking the service…' : 'Connect'}
          </button>
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            NavBharatAI checks the address and asks the service what it can do before saving anything —
            so a service that cannot be reached is never listed as connected.
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-400 leading-relaxed">{error}</p>}
      {note && <p className="text-xs text-emerald-400 leading-relaxed">{note}</p>}
    </div>
  );
};

export default ConnectedServices;
