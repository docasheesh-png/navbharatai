// U-15 — Deep health report + status-page model.
//
// A pure, dependency-free engine that assembles a comprehensive health report from REAL runtime
// signals (readiness, process uptime, memory, node/version, and per-dependency checks the caller
// gathers). It powers the deployable GET /api/health probe and the public /status page.
//
// HONESTY: every value is a real, live signal — process uptime, real memory usage, real dependency
// states. We do NOT report a fabricated historical uptime % or SLA figure; a true cross-restart
// uptime record must accrue from real measurement over time (an infra/observability follow-up), so
// this reports the CURRENT instance's uptime and live component states, clearly labelled.

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  detail: string;
}

export interface HealthSignals {
  ready: boolean;
  uptimeSec: number;
  version: string;
  nodeVersion: string;
  /** Raw bytes from process.memoryUsage(). */
  memory: { rss: number; heapUsed: number; heapTotal: number };
  maintenanceMode: boolean;
  /** Per-dependency checks assembled from real state (backup, providers, …). */
  checks: HealthCheck[];
}

export interface HealthReport {
  status: HealthStatus;
  ready: boolean;
  maintenanceMode: boolean;
  uptimeSec: number;
  uptimeHuman: string;
  version: string;
  node: string;
  memoryMb: { rss: number; heapUsed: number; heapTotal: number };
  checks: HealthCheck[];
}

const RANK: Record<HealthStatus, number> = { ok: 0, degraded: 1, down: 2 };
const toMb = (bytes: number): number => Math.round((Number.isFinite(bytes) && bytes > 0 ? bytes : 0) / (1024 * 1024) * 10) / 10;

/** Format a duration in seconds as a compact human string, e.g. "2d 3h 4m" or "45s". */
export function formatUptime(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!d && !h && !m) parts.push(`${s}s`);
  return parts.join(' ');
}

/**
 * Assemble the overall health report from real signals. Pure.
 * Overall status: `down` if the server isn't ready (not serving); otherwise the WORST of maintenance
 * mode (→ degraded) and the individual dependency checks — a `down` dependency degrades the report but
 * does not itself mark the whole server `down` (the process is still serving).
 */
export function buildHealthReport(s: HealthSignals): HealthReport {
  let overall: HealthStatus;
  if (!s.ready) {
    overall = 'down';
  } else {
    // Worst dependency check, capped at 'degraded' (a bad dep doesn't take the whole server 'down').
    let worst: HealthStatus = 'ok';
    for (const c of s.checks) if (RANK[c.status] > RANK[worst]) worst = c.status;
    const depDegraded = worst !== 'ok';
    overall = (s.maintenanceMode || depDegraded) ? 'degraded' : 'ok';
  }

  return {
    status: overall,
    ready: s.ready,
    maintenanceMode: s.maintenanceMode,
    uptimeSec: Math.max(0, Math.floor(s.uptimeSec || 0)),
    uptimeHuman: formatUptime(s.uptimeSec),
    version: s.version || 'unknown',
    node: s.nodeVersion || 'unknown',
    memoryMb: { rss: toMb(s.memory.rss), heapUsed: toMb(s.memory.heapUsed), heapTotal: toMb(s.memory.heapTotal) },
    checks: s.checks,
  };
}

/** Render a self-contained (no external CDN → CSP-safe) status page that live-polls /api/health. */
export function renderStatusPageHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NavBharatAI — Status</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;font:15px/1.55 system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9}
.wrap{max-width:720px;margin:0 auto;padding:40px 24px}
h1{font-size:22px;margin:0 0 4px}
.banner{display:flex;align-items:center;gap:12px;border-radius:14px;padding:18px 20px;margin:18px 0;border:1px solid}
.dot{width:14px;height:14px;border-radius:50%;flex:none}
.ok{background:#0f2b1a;border-color:#238636}.ok .dot{background:#3fb950}
.degraded{background:#2b230f;border-color:#9e6a03}.degraded .dot{background:#d29922}
.down{background:#2b0f0f;border-color:#da3633}.down .dot{background:#f85149}
.big{font-size:18px;font-weight:700}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:18px 0}
.card{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:12px 14px}
.card .k{font-size:11px;color:#6e7681;text-transform:uppercase;letter-spacing:.05em}
.card .v{font-size:16px;color:#e6edf3;font-weight:700;margin-top:3px}
.checks{margin-top:10px}
.check{display:flex;align-items:center;gap:10px;background:#161b22;border:1px solid #21262d;border-radius:10px;padding:10px 14px;margin:8px 0}
.check .name{font-weight:600;color:#e6edf3}.check .detail{color:#8b949e;font-size:13px;margin-left:auto;text-align:right}
.s-ok{color:#3fb950}.s-degraded{color:#d29922}.s-down{color:#f85149}
.foot{color:#484f58;font-size:12px;margin-top:22px;text-align:center}
a{color:#58a6ff}
</style></head><body>
<div class="wrap">
  <h1>NavBharatAI Status</h1>
  <div class="foot" style="margin:0;text-align:left">Live component health. Machine-readable: <a href="/api/health">/api/health</a></div>
  <div id="banner" class="banner degraded"><span class="dot"></span><span class="big" id="headline">Checking…</span></div>
  <div class="meta" id="meta"></div>
  <div class="checks" id="checks"></div>
  <div class="foot" id="foot">Auto-refreshes every 15s.</div>
</div>
<script>
(function(){
  var LABEL={ok:'All systems operational',degraded:'Degraded performance',down:'Service unavailable'};
  function mb(n){return n+' MB';}
  function render(h){
    var b=document.getElementById('banner');
    b.className='banner '+(h.status||'down');
    document.getElementById('headline').textContent=LABEL[h.status]||'Unknown';
    var meta=[['Uptime',h.uptimeHuman],['Version',h.version],['Node',h.node],
      ['Memory (RSS)',mb(h.memoryMb&&h.memoryMb.rss)],['Ready',h.ready?'yes':'no'],
      ['Maintenance',h.maintenanceMode?'on':'off']];
    // Built as DOM with textContent, never as an innerHTML string. This page renders values that
    // arrive at RUNTIME from /api/health — versions, check names, failure details — and a detail line
    // is exactly where a dependency's own error text would one day be echoed. Concatenating those into
    // innerHTML is a DOM-XSS waiting for the first check that reports something it did not author.
    // (A server-side escape helper existed for this and was never wired; it could not have worked
    // either, since the data arrives after the page is served.)
    function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;
      if(text!==undefined&&text!==null)n.textContent=String(text);return n;}
    var metaBox=document.getElementById('meta');metaBox.textContent='';
    meta.forEach(function(m){var card=el('div','card');card.appendChild(el('div','k',m[0]));
      card.appendChild(el('div','v',m[1]));metaBox.appendChild(card);});
    var checksBox=document.getElementById('checks');checksBox.textContent='';
    (h.checks||[]).forEach(function(c){var row=el('div','check');
      row.appendChild(el('span','s-'+String(c.status||'').replace(/[^a-z]/g,''),'●'));
      row.appendChild(el('span','name',c.name));
      row.appendChild(el('span','detail',c.detail||''));checksBox.appendChild(row);});
  }
  function poll(){fetch('/api/health').then(function(r){return r.json();}).then(render).catch(function(){
    document.getElementById('headline').textContent='Status unavailable';});}
  poll();setInterval(poll,15000);
})();
</script>
</body></html>`;
}
