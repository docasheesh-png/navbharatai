import React, { useState, useEffect, useRef } from 'react';
import { HeartPulse, Activity, AlertCircle, CheckCircle2, Cpu, Globe, Clock, Zap, AlertTriangle, RefreshCw, TrendingUp, Users, Eye, Server, Wifi, Shield, BarChart2 } from 'lucide-react';

interface Metric {
  label: string;
  value: number;
  unit: string;
  status: 'good' | 'warning' | 'critical';
  icon: React.ReactNode;
  trend: number;
}

interface IncidentEvent {
  id: string;
  type: 'error' | 'warning' | 'info' | 'success';
  message: string;
  timestamp: number;
  resolved: boolean;
}

interface UptimePoint {
  time: string;
  uptime: number;
  latency: number;
}

function generateUptimeData(): UptimePoint[] {
  return Array.from({ length: 24 }, (_, i) => ({
    time: `${String(i).padStart(2, '0')}:00`,
    uptime: 95 + Math.random() * 5,
    latency: 40 + Math.random() * 80,
  }));
}

const SIMULATED_INCIDENTS: IncidentEvent[] = [
  { id: '1', type: 'success', message: 'Deployment v2.1.4 completed successfully', timestamp: Date.now() - 3600000, resolved: true },
  { id: '2', type: 'warning', message: 'CPU usage spike 85% — auto-scaled to 2 instances', timestamp: Date.now() - 7200000, resolved: true },
  { id: '3', type: 'error', message: 'Firebase read quota at 90% — consider upgrading plan', timestamp: Date.now() - 14400000, resolved: false },
  { id: '4', type: 'info', message: 'SSL certificate renewed automatically', timestamp: Date.now() - 86400000, resolved: true },
  { id: '5', type: 'success', message: 'Uptime SLA 99.97% maintained this month', timestamp: Date.now() - 172800000, resolved: true },
];

export function AppHealthMonitor() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [uptimeData, setUptimeData] = useState<UptimePoint[]>(() => generateUptimeData());
  const [incidents, setIncidents] = useState<IncidentEvent[]>(SIMULATED_INCIDENTS);
  const [isLive, setIsLive] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [activeTab, setActiveTab] = useState<'overview' | 'performance' | 'incidents' | 'logs'>('overview');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [logLines, setLogLines] = useState<string[]>([
    '[INFO] Server started on port 8080',
    '[INFO] Firebase connection established',
    '[INFO] Static assets cached (CDN)',
    '[WARN] Memory usage: 72%',
    '[INFO] 142 active sessions',
  ]);

  const generateMetrics = (): Metric[] => [
    { label: 'Uptime', value: 99.94 + Math.random() * 0.05, unit: '%', status: 'good', icon: <CheckCircle2 size={16} />, trend: 0.01 },
    { label: 'Avg Latency', value: 45 + Math.random() * 30, unit: 'ms', status: 'good', icon: <Zap size={16} />, trend: -3 },
    { label: 'Active Users', value: 1200 + Math.floor(Math.random() * 400), unit: '', status: 'good', icon: <Users size={16} />, trend: 12 },
    { label: 'CPU Usage', value: 35 + Math.random() * 30, unit: '%', status: 'good', icon: <Cpu size={16} />, trend: 2 },
    { label: 'Memory', value: 60 + Math.random() * 20, unit: '%', status: 'warning', icon: <Server size={16} />, trend: 5 },
    { label: 'Error Rate', value: Math.random() * 0.5, unit: '%', status: 'good', icon: <AlertTriangle size={16} />, trend: -0.1 },
    { label: 'Page Views', value: 8500 + Math.floor(Math.random() * 1500), unit: '/hr', status: 'good', icon: <Eye size={16} />, trend: 8 },
    { label: 'API Calls', value: 22000 + Math.floor(Math.random() * 3000), unit: '/hr', status: 'good', icon: <Globe size={16} />, trend: 15 },
  ].map(m => ({ ...m, status: m.value > 80 && m.unit === '%' && m.label !== 'Uptime' ? 'warning' : m.status as 'good' | 'warning' | 'critical' }));

  useEffect(() => {
    setMetrics(generateMetrics());
    if (isLive) {
      intervalRef.current = setInterval(() => {
        setMetrics(generateMetrics());
        setLastUpdated(new Date());
        setUptimeData(generateUptimeData());
        const logTypes = ['INFO', 'WARN', 'INFO', 'INFO', 'DEBUG'];
        const logMsgs = [
          'Request processed: GET /api/users (23ms)',
          'Cache hit: 94% ratio',
          'New session started',
          'Firebase snapshot received',
          'Auth token refreshed',
          'CDN edge cache updated',
        ];
        const type = logTypes[Math.floor(Math.random() * logTypes.length)];
        const msg = logMsgs[Math.floor(Math.random() * logMsgs.length)];
        setLogLines(prev => [`[${type}] ${msg}`, ...prev.slice(0, 49)]);
      }, 2000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isLive]);

  const resolveIncident = (id: string) => {
    setIncidents(prev => prev.map(i => i.id === id ? { ...i, resolved: true } : i));
  };

  const overallHealth = metrics.length > 0 && metrics.filter(m => m.status === 'good').length >= metrics.length * 0.75 ? 'healthy' : 'degraded';

  const containerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a', color: '#e2e8f0', fontFamily: 'sans-serif' };
  const cardStyle: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '12px' };

  const statusColor = { good: '#10b981', warning: '#f59e0b', critical: '#ef4444' };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <HeartPulse size={20} color="#ef4444" />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: '#f1f5f9' }}>App Health Monitor</span>
              <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4, background: '#451a03', color: '#fb923c', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Demo Data</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: overallHealth === 'healthy' ? '#10b981' : '#f59e0b', animation: isLive ? 'pulse 2s infinite' : 'none' }} />
              <span style={{ color: overallHealth === 'healthy' ? '#10b981' : '#f59e0b', fontSize: 11 }}>
                {overallHealth === 'healthy' ? 'All Systems Operational' : 'Partial Degradation'}
              </span>
              <span style={{ color: '#475569', fontSize: 10 }}>· Updated {lastUpdated.toLocaleTimeString()}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={() => setIsLive(p => !p)} style={{ padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, background: isLive ? '#052e16' : '#334155', color: isLive ? '#4ade80' : '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
            {isLive ? <><Wifi size={11} /> Live</> : <><RefreshCw size={11} /> Paused</>}
          </button>
          {(['overview', 'performance', 'incidents', 'logs'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500, background: activeTab === t ? '#ef4444' : '#334155', color: activeTab === t ? '#fff' : '#94a3b8' }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Metrics Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {metrics.map(m => (
                <div key={m.label} style={{ ...cardStyle, borderLeft: `3px solid ${statusColor[m.status]}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <span style={{ color: '#64748b', fontSize: 11 }}>{m.label}</span>
                    <span style={{ color: statusColor[m.status] }}>{m.icon}</span>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: statusColor[m.status] }}>
                    {m.unit === '%' ? m.value.toFixed(m.label === 'Uptime' ? 2 : 1) : Math.floor(m.value).toLocaleString()}{m.unit}
                  </div>
                  <div style={{ fontSize: 10, color: m.trend >= 0 ? '#4ade80' : '#f87171', marginTop: 2 }}>
                    {m.trend >= 0 ? '↑' : '↓'} {Math.abs(m.trend)}{m.unit} vs last hour
                  </div>
                </div>
              ))}
            </div>

            {/* Uptime Chart (simplified) */}
            <div style={{ ...cardStyle }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Activity size={14} color="#3b82f6" /> 24h Latency (ms)
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 60 }}>
                {uptimeData.map((p, i) => {
                  const h = Math.min(60, (p.latency / 150) * 60);
                  return (
                    <div key={i} title={`${p.time}: ${Math.round(p.latency)}ms`} style={{ flex: 1, background: p.latency > 80 ? '#f59e0b' : '#3b82f6', height: h, borderRadius: '2px 2px 0 0', opacity: 0.8 }} />
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 10, color: '#475569' }}>00:00</span>
                <span style={{ fontSize: 10, color: '#475569' }}>12:00</span>
                <span style={{ fontSize: 10, color: '#475569' }}>23:00</span>
              </div>
            </div>

            {/* Service Status */}
            <div style={{ ...cardStyle }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Service Status</div>
              {[
                { name: 'API Server', status: 'operational', latency: '28ms' },
                { name: 'Firebase Auth', status: 'operational', latency: '45ms' },
                { name: 'Firestore DB', status: 'operational', latency: '62ms' },
                { name: 'Firebase Storage', status: 'operational', latency: '89ms' },
                { name: 'CDN (CloudFlare)', status: 'operational', latency: '12ms' },
                { name: 'Payment Gateway', status: 'operational', latency: '120ms' },
              ].map(svc => (
                <div key={svc.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #1e293b' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981' }} />
                    <span style={{ fontSize: 12 }}>{svc.name}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{svc.latency}</span>
                    <span style={{ fontSize: 11, color: '#4ade80' }}>Operational</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Performance Tab */}
        {activeTab === 'performance' && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: 'First Contentful Paint', value: '0.8s', score: 95, color: '#10b981' },
              { label: 'Largest Contentful Paint', value: '1.4s', score: 88, color: '#10b981' },
              { label: 'Total Blocking Time', value: '45ms', score: 92, color: '#10b981' },
              { label: 'Cumulative Layout Shift', value: '0.04', score: 97, color: '#10b981' },
              { label: 'Time to Interactive', value: '1.9s', score: 85, color: '#f59e0b' },
              { label: 'Speed Index', value: '1.2s', score: 91, color: '#10b981' },
            ].map(metric => (
              <div key={metric.label} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', border: `3px solid ${metric.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: metric.color }}>{metric.score}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{metric.label}</div>
                  <div style={{ height: 6, background: '#334155', borderRadius: 3, marginTop: 6 }}>
                    <div style={{ height: '100%', width: `${metric.score}%`, background: metric.color, borderRadius: 3 }} />
                  </div>
                </div>
                <div style={{ fontWeight: 700, color: metric.color, fontSize: 14, flexShrink: 0 }}>{metric.value}</div>
              </div>
            ))}
            <div style={{ ...cardStyle, background: '#052e16', border: '1px solid #166534' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Shield size={14} color="#4ade80" />
                <span style={{ color: '#4ade80', fontSize: 13, fontWeight: 600 }}>Performance Score: 92/100</span>
              </div>
              <p style={{ fontSize: 12, color: '#86efac', margin: 0 }}>Your app meets Google Core Web Vitals thresholds. All metrics are in the "Good" range for mobile and desktop.</p>
            </div>
          </div>
        )}

        {/* Incidents Tab */}
        {activeTab === 'incidents' && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {incidents.map(inc => {
              const colors = { error: '#ef4444', warning: '#f59e0b', info: '#3b82f6', success: '#10b981' };
              const bg = { error: '#7f1d1d', warning: '#451a03', info: '#172554', success: '#052e16' };
              return (
                <div key={inc.id} style={{ ...cardStyle, borderLeft: `3px solid ${colors[inc.type]}`, background: inc.resolved ? '#1e293b' : `${bg[inc.type]}40` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: bg[inc.type], color: colors[inc.type] }}>{inc.type.toUpperCase()}</span>
                        {inc.resolved && <span style={{ fontSize: 10, color: '#64748b' }}>· Resolved</span>}
                      </div>
                      <div style={{ fontSize: 13, color: inc.resolved ? '#94a3b8' : '#e2e8f0' }}>{inc.message}</div>
                      <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>{new Date(inc.timestamp).toLocaleString()}</div>
                    </div>
                    {!inc.resolved && (
                      <button onClick={() => resolveIncident(inc.id)} style={{ padding: '4px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', background: '#334155', color: '#94a3b8', fontSize: 11, flexShrink: 0, marginLeft: 8 }}>
                        Resolve
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Logs Tab */}
        {activeTab === 'logs' && (
          <div style={{ padding: 16 }}>
            <div style={{ background: '#020617', border: '1px solid #1e293b', borderRadius: 8, padding: '12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, maxHeight: 'calc(100vh - 180px)', overflow: 'auto' }}>
              {isLive && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#4ade80', marginBottom: 8, fontSize: 10 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80' }} />
                  LIVE STREAMING
                </div>
              )}
              {logLines.map((line, i) => (
                <div key={i} style={{ color: line.includes('[ERROR]') ? '#f87171' : line.includes('[WARN]') ? '#fbbf24' : line.includes('[DEBUG]') ? '#818cf8' : '#94a3b8', marginBottom: 2 }}>
                  <span style={{ color: '#475569' }}>{new Date(Date.now() - i * 2000).toLocaleTimeString()} </span>{line}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
