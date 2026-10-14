// EDGE TRAFFIC METER — visitor (frontend) bytes counted where every published app is served.
//
// Every published app is served by ONE Cloudflare Worker (infra/cloudflare/mitrify-apps-worker.js),
// cache hits included. With the `NBAI_TRAFFIC` Analytics Engine binding the Worker writes one data
// point per response: blob1 = app subdomain, double1 = response bytes (Content-Length). This module
// reads the per-subdomain total for one UTC day through Cloudflare's Analytics Engine SQL API.
//
// Cheap: Analytics Engine writes are free-tier friendly and sampled reads are corrected with
// `_sample_interval`. Accurate enough for billing: it counts what the edge actually sent, bots and
// curl included (the browser beacon could not see those). A response with no Content-Length is
// counted as 0 bytes — the error is always in the user's favour.
//
// OFF unless FRONTEND_TRAFFIC_METER=on AND CF_ACCOUNT_ID + CF_ANALYTICS_TOKEN are set. Charging on top
// of it additionally needs NAVBHARAT_BILL_HOSTING=on (the same switch as server traffic).

export function edgeMeterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.FRONTEND_TRAFFIC_METER ?? '').trim().toLowerCase() === 'on'
    && !!String(env.CF_ACCOUNT_ID ?? '').trim()
    && !!String(env.CF_ANALYTICS_TOKEN ?? '').trim();
}

export function edgeDataset(env: NodeJS.ProcessEnv = process.env): string {
  const d = String(env.NBAI_TRAFFIC_DATASET ?? '').trim();
  return /^[A-Za-z0-9_]{1,64}$/.test(d) ? d : 'nbai_traffic';
}

/** The app's edge subdomain from its published URL (`https://v3-abc.mitrify.in/` → `v3-abc`). */
export function subForUrl(url: string | null | undefined): string | null {
  try {
    const host = new URL(String(url ?? '')).hostname;
    const sub = host.split('.')[0] || '';
    return /^[a-z0-9-]{1,80}$/.test(sub) && host.includes('.') ? sub : null;
  } catch {
    return null;
  }
}

/** SQL for one UTC day. `day` is validated to YYYY-MM-DD, so nothing user-shaped reaches the query. */
export function edgeDaySql(day: string, dataset: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return `SELECT blob1 AS sub, SUM(double1 * _sample_interval) AS bytes FROM ${dataset} `
    + `WHERE timestamp >= toDateTime('${day} 00:00:00') AND timestamp < toDateTime('${day} 00:00:00') + INTERVAL '1' DAY `
    + 'GROUP BY sub FORMAT JSON';
}

/** PURE. Parse the SQL API's JSON. Null when the answer is not the shape we asked for. */
export function parseEdgeRows(body: unknown): Map<string, number> | null {
  const rows = (body as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return null;
  const out = new Map<string, number>();
  for (const r of rows) {
    const sub = String((r as any)?.sub ?? '');
    const bytes = Number((r as any)?.bytes);
    if (!sub || !Number.isFinite(bytes) || bytes < 0) continue;
    out.set(sub, (out.get(sub) ?? 0) + bytes);
  }
  return out;
}

/** Bytes per subdomain for one UTC day, or null when the meter is off or could not be read. */
export async function readEdgeBytesForDay(
  day: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, number> | null> {
  if (!edgeMeterEnabled(env)) return null;
  const sql = edgeDaySql(day, edgeDataset(env));
  if (!sql) return null;
  try {
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(String(env.CF_ACCOUNT_ID).trim())}/analytics_engine/sql`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${String(env.CF_ANALYTICS_TOKEN).trim()}` },
      body: sql,
    });
    if (!res.ok) return null;
    return parseEdgeRows(await res.json().catch(() => null));
  } catch {
    return null;
  }
}
