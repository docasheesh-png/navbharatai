// The Publish choice for a server or a database WE run.
//
// Buttons exist only after the server says the thing can actually be delivered. A plan server is
// not bought here — Publish already includes it. Own hosting and own Supabase stay on this card
// and stay free from us. Money is taken by the server, only after the resource is ready.

import { useEffect, useState } from 'react';
import { Database, Server } from 'lucide-react';
import { LONG_REQUEST_TIMEOUT_MS, fetchFailureLine } from '../../lib/longRequest';
import { addonById } from '../../lib/hostingAddons';

interface ResellSide {
  mode: 'included' | 'addon' | 'unavailable';
  priceInr: number;
  reason: string;
  canStart: boolean;
  stopRef: string | null;
  terms?: readonly string[];
}

interface ResellOptions {
  server: ResellSide;
  database: ResellSide;
  own?: { hosting?: string; database?: string };
}

export interface ResellHostingChoiceProps {
  workspaceId?: string;
  authedFetch?: (url: string, init?: RequestInit, timeoutMs?: number) => Promise<Response>;
  onOpenDatabaseSettings?: () => void;
  busy?: boolean;
}

const SERVER_PRICE = addonById('server')?.priceInr ?? 0;
const DB_PRICE = addonById('dedicated_db')?.priceInr ?? 0;

export function ResellHostingChoice({ workspaceId, authedFetch, onOpenDatabaseSettings, busy }: ResellHostingChoiceProps) {
  const [options, setOptions] = useState<ResellOptions | null>(null);
  const [serverAgreed, setServerAgreed] = useState(false);
  const [dbAgreed, setDbAgreed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState<'server' | 'database' | null>(null);

  useEffect(() => {
    if (!authedFetch || !workspaceId) return;
    let live = true;
    authedFetch(`/api/agentv3/resell/options?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d?.server && d?.database) setOptions(d as ResellOptions); })
      .catch(() => { /* no options → no button, which is the honest failure */ });
    return () => { live = false; };
  }, [authedFetch, workspaceId]);

  const run = async (kind: 'server' | 'database') => {
    if (!authedFetch || !workspaceId) return;
    const agreed = kind === 'server' ? serverAgreed : dbAgreed;
    if (!agreed) { setNote('Tick the terms first. Nothing was started.'); return; }
    setWorking(kind); setNote(null);
    const path = kind === 'server' ? '/api/agentv3/resell/server' : '/api/agentv3/resell/database';
    const timeout = kind === 'server' ? 10 * 60_000 : LONG_REQUEST_TIMEOUT_MS.provisionDatabase;
    try {
      const res = await authedFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, agreedToTerms: true }),
      }, timeout);
      const data = await res.json().catch(() => null);
      setNote(data?.message || data?.error || 'That did not finish. If you were charged, it will show in your wallet.');
      if (res.ok) {
        const again = await authedFetch(`/api/agentv3/resell/options?workspaceId=${encodeURIComponent(workspaceId)}`);
        const data = await again.json().catch(() => null);
        if (data && 'server' in data && 'database' in data) setOptions(data as ResellOptions);
      }
    } catch (err) {
      setNote(fetchFailureLine(err, {
        notStarted: 'That did not start. Nothing was charged.',
        stillRunning: kind === 'server'
          ? 'The server is still being started. Do not press again — if it goes live, the charge happens once.'
          : 'The database is still being created. Do not press again — if it becomes ready, the charge happens once.',
      }));
    } finally {
      setWorking(null);
    }
  };

  const stop = async (kind: 'server' | 'database', ref: string) => {
    if (!authedFetch || !workspaceId) return;
    setWorking(kind); setNote(null);
    const path = kind === 'server' ? '/api/agentv3/resell/server/stop' : '/api/agentv3/resell/database/stop';
    try {
      const res = await authedFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, ref }),
      }, LONG_REQUEST_TIMEOUT_MS.provisionDatabase);
      const data = await res.json().catch(() => null);
      setNote(data?.error || (res.ok ? 'Stopped. Unused days were returned to your wallet.' : 'It was not stopped. Nothing was refunded.'));
      if (res.ok) {
        const again = await authedFetch(`/api/agentv3/resell/options?workspaceId=${encodeURIComponent(workspaceId)}`);
        const data = await again.json().catch(() => null);
        if (data && 'server' in data && 'database' in data) setOptions(data as ResellOptions);
      }
    } catch (err) {
      setNote(fetchFailureLine(err, {
        notStarted: 'That did not start. Nothing was refunded.',
        stillRunning: 'Still stopping it. Do not press again.',
      }));
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="mx-4 mb-2 rounded-xl border border-line bg-card p-3.5 flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <Server className="w-4 h-4 text-muted" />
        <span className="text-[13px] font-bold text-ink">Server and database</span>
      </div>
      <p className="text-[11.5px] text-muted leading-relaxed">
        You can host it yourself, and you can connect your own database. Both stay free from us, the same as today.
        A server from NavBharatAI is ₹{SERVER_PRICE} for 30 days and a private database is ₹{DB_PRICE} for 30 days —
        taken only after it is actually running, never from the add-on list.
      </p>
      {options?.server && (
        <p className="text-[11.5px] text-body leading-relaxed">{options.server.reason}</p>
      )}
      {options?.server.canStart && (
        <label className="flex items-start gap-2 text-[11.5px] text-muted leading-relaxed">
          <input type="checkbox" checked={serverAgreed} onChange={(e) => setServerAgreed(e.target.checked)} className="mt-0.5" />
          <span>{options.server.terms?.[0] || `₹${options.server.priceInr} from the money I added, only after the server is live.`}</span>
        </label>
      )}
      {options?.server.canStart && (
        <button
          type="button"
          disabled={!!busy || working !== null || !serverAgreed}
          onClick={() => void run('server')}
          className="self-start py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-on-accent text-[11.5px] font-bold"
        >
          {working === 'server' ? 'Starting the server…' : 'Run this server on NavBharatAI'}
        </button>
      )}
      {options?.server.stopRef && (
        <button
          type="button"
          disabled={!!busy || working !== null}
          onClick={() => void stop('server', options.server.stopRef as string)}
          className="self-start py-2 px-3 rounded-lg border border-line text-[11.5px] font-semibold text-body"
        >
          {working === 'server' ? 'Stopping…' : 'Stop this server and return unused days'}
        </button>
      )}
      {options?.database && (
        <p className="text-[11.5px] text-body leading-relaxed">{options.database.reason}</p>
      )}
      {options?.database.canStart && (
        <label className="flex items-start gap-2 text-[11.5px] text-muted leading-relaxed">
          <input type="checkbox" checked={dbAgreed} onChange={(e) => setDbAgreed(e.target.checked)} className="mt-0.5" />
          <span>{options.database.terms?.[0] || `₹${options.database.priceInr} from the money I added, only after the database is ready.`}</span>
        </label>
      )}
      {options?.database.canStart && (
        <button
          type="button"
          disabled={!!busy || working !== null || !dbAgreed}
          onClick={() => void run('database')}
          className="self-start py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-on-accent text-[11.5px] font-bold flex items-center gap-2"
        >
          <Database className="w-3.5 h-3.5" />
          {working === 'database' ? 'Creating the database…' : 'Create the database on NavBharatAI'}
        </button>
      )}
      {options?.database.stopRef && (
        <button
          type="button"
          disabled={!!busy || working !== null}
          onClick={() => void stop('database', options.database.stopRef as string)}
          className="self-start py-2 px-3 rounded-lg border border-line text-[11.5px] font-semibold text-body"
        >
          {working === 'database' ? 'Removing…' : 'Delete this database and return unused days'}
        </button>
      )}
      {onOpenDatabaseSettings && (
        <button
          type="button"
          onClick={() => onOpenDatabaseSettings()}
          className="self-start text-[11.5px] font-semibold text-body underline underline-offset-2"
        >
          Connect my own database
        </button>
      )}
      {note && <p className="text-[11.5px] text-warn leading-relaxed">{note}</p>}
    </div>
  );
}
