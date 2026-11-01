import React, { useEffect, useRef, useState } from 'react';
import { adminHeaders } from '../../lib/adminFetch';

type Snapshot = { enabled: boolean; mode: string; syncedAt: number | null; modelCount: number | null; hasError: boolean };
const endpoints = { read: '/api/v1/agentv3/router-one/catalog', refresh: '/api/v1/agentv3/router-one/catalog/refresh' };

/** Reads only catalog state. A catalog price never proves a settled supplier charge. */
export async function requestRouterOneCatalog(token: string, refresh: boolean, signal: AbortSignal): Promise<Snapshot> {
  const response = await fetch(refresh ? endpoints.refresh : endpoints.read, { method: refresh ? 'POST' : 'GET', headers: adminHeaders(token), signal });
  if (!response.ok) throw new Error(`Catalog status unconfirmed (HTTP ${response.status}).`);
  const body = await response.json();
  if (!body || typeof body.enabled !== 'boolean' || !['auto', 'env', 'synced'].includes(body.mode)
    || (body.lastError !== null && (typeof body.lastError !== 'object' || !body.lastError))
    || (body.lastGood !== null && (!body.lastGood || !Number.isFinite(body.lastGood.syncedAt) || !Number.isFinite(new Date(body.lastGood.syncedAt).getTime()) || !Array.isArray(body.lastGood.ranked)))) {
    throw new Error('Catalog status response is incomplete.');
  }
  return { enabled: body.enabled, mode: body.mode, syncedAt: body.lastGood?.syncedAt ?? null, modelCount: body.lastGood?.ranked.length ?? null, hasError: body.lastError !== null };
}

export function RouterOneCatalogPanel({ adminToken }: { adminToken: string }): React.ReactElement {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => { setSnapshot(null); setError(''); setBusy(false); return () => { active.current?.abort(); active.current = null; }; }, [adminToken]);
  const load = async (refresh: boolean) => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError('');
    const deadline = setTimeout(() => controller.abort(), 30_000);
    try {
      const next = await requestRouterOneCatalog(adminToken, refresh, controller.signal);
      if (active.current === controller) setSnapshot(next);
    } catch (cause) {
      if (active.current === controller) setError(`${cause instanceof Error ? cause.message : 'Catalog request failed.'} Read status before retrying a refresh; its outcome may be unconfirmed.`);
    } finally {
      clearTimeout(deadline);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  };
  return <section aria-label="Router One catalog" className="rounded-xl border border-line p-4 space-y-3">
    <h2 className="text-lg font-bold">Router One catalog</h2>
    <p>Catalog metadata only. Actual billing settlement is unavailable; these prices cannot authorize a wallet debit.</p>
    <div className="flex gap-2">
      <button type="button" disabled={busy} onClick={() => void load(false)}>Read catalog status</button>
      <button type="button" disabled={busy || !snapshot?.enabled || !!error} onClick={() => void load(true)}>Refresh provider catalog</button>
    </div>
    {busy && <p role="status">Reading catalog…</p>}
    {error && <p role="alert">{error} Any displayed snapshot is from an earlier successful read.</p>}
    {!snapshot && <p>Status has not been read.</p>}
    {snapshot && <dl>
      <dt>Sync configuration</dt><dd>{snapshot.enabled ? 'Enabled' : 'Disabled'}</dd>
      <dt>Selection mode</dt><dd>{snapshot.mode}</dd>
      <dt>Last saved catalog</dt><dd>{snapshot.syncedAt === null ? 'Unavailable' : new Date(snapshot.syncedAt).toISOString()}</dd>
      <dt>Ranked models</dt><dd>{snapshot.modelCount ?? 'Unknown'}</dd>
      <dt>Latest sync</dt><dd>{snapshot.hasError ? 'Failed; last saved catalog retained' : 'No error reported; see saved catalog timestamp'}</dd>
    </dl>}
  </section>;
}
