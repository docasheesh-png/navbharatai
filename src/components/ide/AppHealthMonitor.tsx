import React, { useState, useEffect, useRef, useCallback } from 'react';
import { HeartPulse, CheckCircle2, AlertTriangle, RefreshCw, Wifi, Server, Clock, Activity } from 'lucide-react';

// P-MON.4 — App Health Monitor.
//
// HONESTY (a core NavBharatAI law): this panel shows ONLY real, measured signals. The one
// signal a (non-admin) client can read is the platform liveness endpoint `/api/health`
// (real process status + uptime). Deep per-app metrics (CPU, latency histograms, error
// rate, incident feed) require a connected deployment with telemetry, which is not wired
// yet — so instead of fabricating numbers, the panel states that plainly. There is no
// simulated/demo data anywhere in this component.

interface PlatformHealth {
  status: string;        // e.g. "ok"
  uptimeSeconds: number; // real process uptime
  ready: boolean;        // /api/ready reachable + 200
  fetchedAt: number;
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function AppHealthMonitor() {
  const [health, setHealth] = useState<PlatformHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/health', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`health check returned ${res.status}`);
      const data = await res.json();
      let ready = false;
      try {
        const r = await fetch('/api/ready', { headers: { Accept: 'application/json' } });
        ready = r.ok;
      } catch {
        ready = false;
      }
      setHealth({
        status: typeof data?.status === 'string' ? data.status : 'unknown',
        uptimeSeconds: typeof data?.uptime === 'number' ? data.uptime : 0,
        ready,
        fetchedAt: Date.now(),
      });
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Unable to reach the platform health endpoint.');
      setHealth(null);
    } finally {
      setLoading(false);
      setLastUpdated(new Date());
    }
  }, []);

  useEffect(() => {
    refresh();
    if (isLive) {
      intervalRef.current = setInterval(refresh, 10_000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isLive, refresh]);

  const containerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a', color: 'var(--text-body)', fontFamily: 'sans-serif' };
  const cardStyle: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '14px 16px' };

  const operational = !!health && health.status === 'ok' && health.ready;
  const headlineColor = error ? '#ef4444' : operational ? '#10b981' : '#f59e0b';
  const headlineText = loading
    ? 'Checking platform health…'
    : error
      ? 'Health endpoint unreachable'
      : operational
        ? 'Platform Operational'
        : 'Platform Starting / Degraded';

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <HeartPulse size={20} color="#ef4444" />
          <div>
            <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-body)' }}>App Health Monitor</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: headlineColor, animation: isLive && !error ? 'pulse 2s infinite' : 'none' }} />
              <span style={{ color: headlineColor, fontSize: 11 }}>{headlineText}</span>
              {lastUpdated && <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>· Updated {lastUpdated.toLocaleTimeString()}</span>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={() => refresh()} title="Refresh now" style={{ padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, background: '#334155', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <RefreshCw size={11} /> Refresh
          </button>
          <button onClick={() => setIsLive(p => !p)} style={{ padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, background: isLive ? '#052e16' : '#334155', color: isLive ? '#4ade80' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            {isLive ? <><Wifi size={11} /> Auto</> : <><RefreshCw size={11} /> Paused</>}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Real platform liveness signal */}
        {error ? (
          <div style={{ ...cardStyle, borderLeft: '3px solid #ef4444' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f87171', fontWeight: 600, fontSize: 13 }}>
              <AlertTriangle size={16} /> Health endpoint unreachable
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>{error}</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <div style={{ ...cardStyle, borderLeft: `3px solid ${operational ? '#10b981' : '#f59e0b'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Platform Status</span>
                <CheckCircle2 size={16} color={operational ? '#10b981' : '#f59e0b'} />
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: operational ? '#10b981' : '#f59e0b' }}>
                {loading ? '…' : operational ? 'Operational' : 'Degraded'}
              </div>
            </div>
            <div style={{ ...cardStyle, borderLeft: '3px solid #3b82f6' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Server Uptime</span>
                <Clock size={16} color="#3b82f6" />
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-body)' }}>
                {loading || !health ? '…' : formatUptime(health.uptimeSeconds)}
              </div>
            </div>
            <div style={{ ...cardStyle, borderLeft: `3px solid ${health?.ready ? '#10b981' : '#f59e0b'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Readiness</span>
                <Server size={16} color={health?.ready ? '#10b981' : '#f59e0b'} />
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: health?.ready ? '#10b981' : '#f59e0b' }}>
                {loading || !health ? '…' : health.ready ? 'Ready' : 'Not Ready'}
              </div>
            </div>
          </div>
        )}

        {/* Honest "not yet connected" state for deep per-app telemetry */}
        <div style={{ ...cardStyle }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Activity size={15} color="#3b82f6" />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-body)' }}>Detailed App Telemetry</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
            Live per-app metrics (latency histograms, error rate, CPU/memory, request volume, incident
            history) require a deployment with telemetry connected. This isn't wired for your app yet —
            so nothing is shown here rather than placeholder numbers. The status above is the real
            platform liveness signal from <code style={{ color: '#cbd5e1' }}>/api/health</code>.
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0' }}>
            Administrators can view live build, provider and composite health scores at
            <code style={{ color: 'var(--text-muted)' }}> /api/admin/health-score</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
