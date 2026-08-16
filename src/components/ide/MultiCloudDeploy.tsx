import React, { useState, useEffect } from 'react';
import { ShareForReview } from './ShareForReview';
import { CloudUpload, ServerCog, CloudCheck, CloudCog, Globe, Rocket, Check, X, Loader2, ChevronRight, RefreshCw, ExternalLink, Terminal, Shield, Zap, Clock, AlertCircle, CheckCircle2, Copy } from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';

type Platform = 'vercel' | 'netlify' | 'firebase' | 'cloudrun' | 'railway' | 'render' | 'navbharat';
type DeployStatus = 'idle' | 'building' | 'deploying' | 'success' | 'failed';

interface Deployment {
  id: string;
  platform: Platform;
  url: string;
  status: 'live' | 'failed';
  timestamp: number;
  duration: number;
}

interface PlatformConfig {
  name: string;
  color: string;
  icon: string;
  description: string;
  buildCmd: string;
  outputDir: string;
  envVars: string[];
  features: string[];
  free: boolean;
}

const PLATFORMS: Record<Platform, PlatformConfig> = {
  navbharat: {
    name: 'NavBharat Hosting',
    color: '#6366f1',
    icon: '🇮🇳',
    description: 'Instant hosting via NavBharatAI — get a live URL in seconds',
    buildCmd: 'navbharat deploy',
    outputDir: 'dist',
    envVars: [],
    features: ['Instant Deploy', 'Live URL', 'PWA Ready', 'Free Tier'],
    free: true,
  },
  vercel: {
    name: 'Vercel',
    color: '#000000',
    icon: '▲',
    description: 'Fastest frontend deployments with Edge Network',
    buildCmd: 'npm run build',
    outputDir: 'dist',
    // VERCEL_TOKEN enables a REAL in-app deploy (P-DEPLOY.6, via /api/pro/deploy); without it, honest CLI steps.
    envVars: ['VERCEL_TOKEN', 'VITE_API_URL', 'VITE_FIREBASE_KEY'],
    features: ['Edge CDN', 'Auto HTTPS', 'Preview URLs', 'Analytics'],
    free: true,
  },
  netlify: {
    name: 'Netlify',
    color: '#00c7b7',
    icon: '◆',
    description: 'Modern web platform with serverless functions',
    buildCmd: 'npm run build',
    outputDir: 'dist',
    envVars: ['VITE_API_URL', 'VITE_FIREBASE_KEY'],
    features: ['Forms', 'Functions', 'Identity', 'Split Testing'],
    free: true,
  },
  firebase: {
    name: 'Firebase Hosting',
    color: '#ff6d00',
    icon: '🔥',
    description: 'Google-backed hosting with CDN and SSL',
    buildCmd: 'npm run build && firebase deploy',
    outputDir: 'dist',
    envVars: ['FIREBASE_PROJECT_ID', 'FIREBASE_TOKEN'],
    features: ['Global CDN', 'Auto SSL', 'Custom Domain', 'Analytics'],
    free: true,
  },
  cloudrun: {
    name: 'Google Cloud Run',
    color: '#4285f4',
    icon: '☁',
    description: 'Containerized deployments that scale to zero',
    buildCmd: 'docker build && gcloud run deploy',
    outputDir: 'dist',
    envVars: ['GOOGLE_PROJECT_ID', 'GOOGLE_CREDENTIALS'],
    features: ['Auto Scale', 'Pay per use', 'Private VPC', 'Custom Domains'],
    free: false,
  },
  railway: {
    name: 'Railway',
    color: '#7c3aed',
    icon: '🚂',
    description: 'Deploy from GitHub with zero config',
    buildCmd: 'npm run build',
    outputDir: 'dist',
    envVars: ['RAILWAY_TOKEN'],
    features: ['GitHub Deploy', 'Auto SSL', 'Logs', 'Metrics'],
    free: true,
  },
  render: {
    name: 'Render',
    color: '#46e3b7',
    icon: '⚡',
    description: 'Unified cloud to build and run all your apps',
    buildCmd: 'npm run build',
    outputDir: 'dist',
    envVars: ['RENDER_API_KEY'],
    features: ['Static Sites', 'Web Services', 'Cron Jobs', 'Private Network'],
    free: true,
  },
};

interface MultiCloudDeployProps {
  generatedCode?: string;
}

export function MultiCloudDeploy({ generatedCode }: MultiCloudDeployProps = {}) {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('vercel');
  const [deployStatus, setDeployStatus] = useState<DeployStatus>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>(() => {
    try { return JSON.parse(localStorage.getItem('navbharat_deployments') || '[]'); } catch { return []; }
  });
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'deploy' | 'history' | 'config'>('deploy');
  const [liveUrl, setLiveUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    localStorage.setItem('navbharat_deployments', JSON.stringify(deployments));
  }, [deployments]);

  const runDeploy = async () => {
    if (deployStatus === 'building' || deployStatus === 'deploying') return;
    setDeployStatus('building');
    setLogs([]);
    setLiveUrl('');

    // NavBharat Hosting: real deploy via /api/pwa/save
    if (selectedPlatform === 'navbharat') {
      if (!generatedCode) {
        setDeployStatus('failed');
        setLogs(['> ❌ No app code found. Build something with NavBharat AI first.']);
        return;
      }
      setLogs(['> Preparing NavBharat Hosting upload...']);
      setDeployStatus('deploying');
      setLogs(prev => [...prev, '> Uploading app bundle...']);
      try {
        const titleMatch = generatedCode.match(/<title[^>]*>([^<]+)<\/title>/i);
        const name = titleMatch?.[1]?.trim() || 'NavBharat App';
        // Hosting is durable now (Firestore-backed) so the save endpoint requires a signed-in user.
        const saveHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        try {
          const { auth } = await import('../../lib/firebase');
          const tok = await auth.currentUser?.getIdToken();
          if (tok) saveHeaders.Authorization = `Bearer ${tok}`;
        } catch { /* best-effort; the server answers 401 with an honest message */ }
        const res = await fetch('/api/pwa/save', {
          method: 'POST',
          headers: saveHeaders,
          body: JSON.stringify({ html: generatedCode, name }),
        });
        const data = await res.json();
        if (data.url) {
          setDeployStatus('success');
          setLiveUrl(data.url);
          setLogs(prev => [...prev, '> ✅ Deployed successfully!', `> 🌍 Live URL: ${data.url}`]);
          setDeployments(prev => [{
            id: Date.now().toString(), platform: 'navbharat', url: data.url,
            status: 'live', timestamp: Date.now(), duration: 2,
          }, ...prev.slice(0, 9)]);
        } else {
          throw new Error(data.error || 'Deploy failed');
        }
      } catch (err: any) {
        setDeployStatus('failed');
        setLogs(prev => [...prev, `> ❌ ${err.message || 'Deploy failed'}`]);
      }
      return;
    }

    // P-DEPLOY.6 — REAL Vercel deploy when the user supplies their own token: publish via the platform's
    // existing /api/pro/deploy backend (deployVercel) instead of only printing CLI text. Honest: no token
    // → falls through to the CLI instructions below (never a faked success).
    if (selectedPlatform === 'vercel' && (envVars['VERCEL_TOKEN'] || '').trim()) {
      if (!generatedCode) {
        setDeployStatus('failed');
        setLogs(['> ❌ No app code found. Build something with NavBharat AI first.']);
        return;
      }
      setDeployStatus('deploying');
      setLogs(['> Deploying to Vercel with your token…']);
      try {
        const titleMatch = generatedCode.match(/<title[^>]*>([^<]+)<\/title>/i);
        const name = (titleMatch?.[1]?.trim() || 'navbharat-app').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 52) || 'navbharat-app';
        const res = await fetch('/api/pro/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'vercel', token: envVars['VERCEL_TOKEN'].trim(), name, files: { 'index.html': generatedCode } }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.url) {
          setDeployStatus('success');
          setLiveUrl(data.url);
          setLogs(prev => [...prev, '> ✅ Deployed to Vercel!', `> 🌍 Live URL: ${data.url}`]);
          setDeployments(prev => [{ id: Date.now().toString(), platform: 'vercel', url: data.url, status: 'live', timestamp: Date.now(), duration: 3 }, ...prev.slice(0, 9)]);
        } else {
          throw new Error(data.error || `Vercel deploy failed (${res.status})`);
        }
      } catch (err: any) {
        setDeployStatus('failed');
        setLogs(prev => [...prev, `> ❌ ${err.message || 'Vercel deploy failed'}`, '> Check your VERCEL_TOKEN in the Config tab.']);
      }
      return;
    }

    // Other platforms need a real CLI + API token — show honest deploy instructions.
    const cliCommands: Partial<Record<Platform, string>> = {
      vercel:   'npx vercel --prod',
      netlify:  `npx netlify deploy --prod --dir=${PLATFORMS[selectedPlatform].outputDir}`,
      firebase: 'npx firebase deploy --only hosting',
      cloudrun: 'gcloud run deploy --source . --platform managed --region asia-southeast1 --allow-unauthenticated',
      railway:  'railway up',
      render:   '# Connect your Git repo at render.com — auto-deploys on every push',
    };
    const cliCmd = cliCommands[selectedPlatform] ?? 'npm run build && <platform deploy command>';
    setDeployStatus('idle');
    setLogs([
      '─────────────────────────────────────────',
      `Deploy to ${PLATFORMS[selectedPlatform].name} — CLI steps:`,
      '─────────────────────────────────────────',
      `1. Build:   npm run build`,
      `2. Deploy:  ${cliCmd}`,
      '',
      'NavBharat Hosting is instant — no CLI needed.',
      'Switch to NavBharat Hosting above for a live URL in seconds.',
    ]);
  };

  const copyUrl = () => {
    if (liveUrl) { navigator.clipboard.writeText(liveUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const cfg = PLATFORMS[selectedPlatform];

  const containerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a', color: 'var(--text-body)', fontFamily: 'sans-serif' };
  const cardStyle: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '12px' };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CloudUpload size={20} color="#3b82f6" />
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-body)' }}>Multi-Cloud Deploy</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Instant NavBharat Hosting · CLI guides for Vercel, Netlify &amp; more</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', maxWidth: '100%' }}>
          {(['deploy', 'history', 'config'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500, flexShrink: 0, background: activeTab === t ? '#3b82f6' : '#334155', color: activeTab === t ? '#fff' : 'var(--text-muted)' }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>

        {/* Deploy Tab */}
        {activeTab === 'deploy' && (
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Platform Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              {(Object.entries(PLATFORMS) as [Platform, PlatformConfig][]).map(([id, p]) => (
                <button key={id} onClick={() => setSelectedPlatform(id)} style={{ padding: '12px', borderRadius: 8, border: `2px solid ${selectedPlatform === id ? p.color : '#334155'}`, background: selectedPlatform === id ? `${p.color}15` : '#1e293b', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 16 }}>{p.icon}</span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: selectedPlatform === id ? p.color : 'var(--text-body)' }}>{p.name}</span>
                    {p.free && <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: '#052e16', color: '#4ade80' }}>FREE</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>{p.description}</div>
                </button>
              ))}
            </div>

            {/* Selected Platform Config */}
            <div style={{ ...cardStyle }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <ServerCog size={14} color="#94a3b8" />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{cfg.name} Configuration</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Build Command</div>
                  <div style={{ background: '#0f172a', borderRadius: 4, padding: '7px 9px', fontSize: 12, color: '#a5f3fc', fontFamily: 'monospace', wordBreak: 'break-all' }}>{cfg.buildCmd}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Output Directory</div>
                  <div style={{ background: '#0f172a', borderRadius: 4, padding: '7px 9px', fontSize: 12, color: '#a5f3fc', fontFamily: 'monospace', wordBreak: 'break-all' }}>{cfg.outputDir}</div>
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {cfg.features.map(f => (
                  <span key={f} style={{ fontSize: 11, padding: '4px 9px', borderRadius: 10, background: '#1e3a5f', color: '#60a5fa' }}>{f}</span>
                ))}
              </div>
            </div>

            {/* Deploy Button & Logs */}
            <button onClick={runDeploy} style={{ padding: '14px 12px', borderRadius: 10, width: '100%', border: 'none', cursor: 'pointer', background: deployStatus === 'success' ? '#10b981' : '#3b82f6', color: '#fff', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {deployStatus === 'success' && selectedPlatform === 'navbharat' ? <><CloudCheck size={16} /> Deployed! Deploy Again</> : selectedPlatform === 'navbharat' ? <><Rocket size={16} /> Deploy to NavBharat Hosting</> : <><Terminal size={16} /> Show Deploy Steps</>}
            </button>

            {/* Live URL */}
            {liveUrl && (
              <div style={{ ...cardStyle, border: '1px solid #10b981', background: '#052e16' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                    <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 600, marginBottom: 2 }}>🎉 Live URL</div>
                    <div style={{ fontSize: 12, color: '#86efac', fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.5 }}>{liveUrl}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={copyUrl} style={{ padding: '9px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#065f46', color: '#4ade80', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied!' : 'Copy'}
                    </button>
                    <a href={liveUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '9px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#065f46', color: '#4ade80', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, textDecoration: 'none' }}>
                      <ExternalLink size={12} /> Open
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Build Logs */}
            {logs.length > 0 && (
              <div style={{ background: '#020617', border: '1px solid #1e293b', borderRadius: 6, padding: '10px 12px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', maxHeight: 200, overflow: 'auto' }}>
                {logs.map((log, i) => (
                  <div key={i} style={{ color: log.startsWith('> ✅') || log.startsWith('> 🌍') ? '#4ade80' : log.startsWith('> ❌') ? '#f87171' : log.startsWith('> URL') ? '#60a5fa' : 'var(--text-muted)', marginBottom: 1 }}>{log}</div>
                ))}
                {(deployStatus === 'building' || deployStatus === 'deploying') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#f59e0b' }}>
                    <TirangaLoader size={10} /> processing...
                  </div>
                )}
              </div>
            )}

            {/* P-COLLAB.3 — share a read-only preview with a client + collect feedback */}
            <ShareForReview generatedCode={generatedCode} />
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {deployments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-faint)' }}>
                <CloudUpload size={32} style={{ margin: '0 auto 12px' }} />
                <div>No deployments yet. Deploy your first app!</div>
              </div>
            ) : deployments.map(dep => (
              <div key={dep.id} style={{ ...{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '12px' }, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>{PLATFORMS[dep.platform].icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{PLATFORMS[dep.platform].name}</div>
                    <div style={{ fontSize: 11, color: '#60a5fa', fontFamily: 'monospace' }}>{dep.url}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: dep.status === 'live' ? '#4ade80' : '#f87171' }}>{dep.status === 'live' ? '● Live' : '● Failed'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{dep.duration}s · {new Date(dep.timestamp).toLocaleDateString()}</div>
                  </div>
                  <a href={dep.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}><ExternalLink size={14} /></a>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Config Tab */}
        {activeTab === 'config' && (
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ ...cardStyle }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Shield size={14} color="#f59e0b" /> Environment Variables
              </div>
              {cfg.envVars.map(v => (
                <div key={v} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{v}</div>
                  <input
                    type="password"
                    value={envVars[v] || ''}
                    onChange={e => setEnvVars(prev => ({ ...prev, [v]: e.target.value }))}
                    placeholder={`Enter ${v}...`}
                    style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: 'var(--text-body)', padding: '8px 10px', fontSize: 12, boxSizing: 'border-box', outline: 'none', fontFamily: 'monospace' }}
                  />
                </div>
              ))}
            </div>
            <div style={{ ...cardStyle }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Deployment Readiness</div>
              {/* Honest readiness (admin autopsy 2026-07-21): each item reflects REAL state — the old
                  checklist hardcoded 'Build successful / SSL / CDN' to always-green regardless of any
                  actual deploy. */}
              {[
                { label: 'App built and ready', done: !!generatedCode },
                { label: 'Environment variables configured', done: Object.keys(envVars).length > 0 },
                { label: 'Custom domain connected', done: false },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #1e293b' }}>
                  {item.done ? <CheckCircle2 size={14} color="#4ade80" /> : <AlertCircle size={14} color="#f59e0b" />}
                  <span style={{ fontSize: 12, color: item.done ? '#e2e8f0' : 'var(--text-muted)' }}>{item.label}</span>
                </div>
              ))}
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
                HTTPS/SSL and CDN are provided automatically by your chosen host (Vercel, Netlify, Cloudflare, Firebase, …).
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
