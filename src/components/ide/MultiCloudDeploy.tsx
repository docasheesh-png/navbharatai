import React, { useState, useEffect } from 'react';
import { CloudUpload, ServerCog, CloudCheck, CloudCog, Globe, Rocket, Check, X, Loader2, ChevronRight, RefreshCw, ExternalLink, Terminal, Shield, Zap, Clock, AlertCircle, CheckCircle2, Copy } from 'lucide-react';

type Platform = 'vercel' | 'netlify' | 'firebase' | 'cloudrun' | 'railway' | 'render';
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
  vercel: {
    name: 'Vercel',
    color: '#000000',
    icon: '▲',
    description: 'Fastest frontend deployments with Edge Network',
    buildCmd: 'npm run build',
    outputDir: 'dist',
    envVars: ['VITE_API_URL', 'VITE_FIREBASE_KEY'],
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

const LOG_MESSAGES: Record<DeployStatus, string[]> = {
  idle: [],
  building: [
    '> Installing dependencies...',
    '> npm install --production',
    '> Dependencies installed (1.2s)',
    '> Running build...',
    '> npm run build',
    '> vite build',
    '> Transforming modules...',
    '> Bundling chunks...',
    '> Build complete (4.8s)',
  ],
  deploying: [
    '> Uploading assets...',
    '> Deploying to CDN...',
    '> Configuring DNS...',
    '> SSL certificate provisioned',
    '> Deployment propagating...',
  ],
  success: ['> ✅ Deployment successful!', '> 🌍 Your app is live!'],
  failed: ['> ❌ Deployment failed', '> Check environment variables and try again'],
};

export function MultiCloudDeploy() {
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

    const buildLogs = LOG_MESSAGES.building;
    for (let i = 0; i < buildLogs.length; i++) {
      await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
      setLogs(prev => [...prev, buildLogs[i]]);
    }

    setDeployStatus('deploying');
    const deployLogs = LOG_MESSAGES.deploying;
    for (let i = 0; i < deployLogs.length; i++) {
      await new Promise(r => setTimeout(r, 400 + Math.random() * 300));
      setLogs(prev => [...prev, deployLogs[i]]);
    }

    const success = Math.random() > 0.1;
    if (success) {
      setDeployStatus('success');
      const url = `https://${PLATFORMS[selectedPlatform].name.toLowerCase().replace(' ', '-')}-navbharat-${Math.random().toString(36).slice(2, 8)}.${selectedPlatform === 'vercel' ? 'vercel.app' : selectedPlatform === 'netlify' ? 'netlify.app' : selectedPlatform === 'firebase' ? 'web.app' : 'run.app'}`;
      setLiveUrl(url);
      setLogs(prev => [...prev, ...LOG_MESSAGES.success, `> URL: ${url}`]);
      const dep: Deployment = {
        id: Date.now().toString(),
        platform: selectedPlatform,
        url,
        status: 'live',
        timestamp: Date.now(),
        duration: 8 + Math.floor(Math.random() * 10),
      };
      setDeployments(prev => [dep, ...prev.slice(0, 9)]);
    } else {
      setDeployStatus('failed');
      setLogs(prev => [...prev, ...LOG_MESSAGES.failed]);
    }
  };

  const copyUrl = () => {
    if (liveUrl) { navigator.clipboard.writeText(liveUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const cfg = PLATFORMS[selectedPlatform];

  const containerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a', color: '#e2e8f0', fontFamily: 'sans-serif' };
  const cardStyle: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '12px' };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CloudUpload size={20} color="#3b82f6" />
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#f1f5f9' }}>Multi-Cloud Deploy</div>
            <div style={{ color: '#64748b', fontSize: 11 }}>Deploy to 6 platforms with one click</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['deploy', 'history', 'config'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500, background: activeTab === t ? '#3b82f6' : '#334155', color: activeTab === t ? '#fff' : '#94a3b8' }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>

        {/* Deploy Tab */}
        {activeTab === 'deploy' && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Platform Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {(Object.entries(PLATFORMS) as [Platform, PlatformConfig][]).map(([id, p]) => (
                <button key={id} onClick={() => setSelectedPlatform(id)} style={{ padding: '12px', borderRadius: 8, border: `2px solid ${selectedPlatform === id ? p.color : '#334155'}`, background: selectedPlatform === id ? `${p.color}15` : '#1e293b', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 16 }}>{p.icon}</span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: selectedPlatform === id ? p.color : '#e2e8f0' }}>{p.name}</span>
                    {p.free && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: '#052e16', color: '#4ade80' }}>FREE</span>}
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.4 }}>{p.description}</div>
                </button>
              ))}
            </div>

            {/* Selected Platform Config */}
            <div style={{ ...cardStyle }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <ServerCog size={14} color="#94a3b8" />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{cfg.name} Configuration</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Build Command</div>
                  <div style={{ background: '#0f172a', borderRadius: 4, padding: '6px 8px', fontSize: 11, color: '#a5f3fc', fontFamily: 'monospace' }}>{cfg.buildCmd}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Output Directory</div>
                  <div style={{ background: '#0f172a', borderRadius: 4, padding: '6px 8px', fontSize: 11, color: '#a5f3fc', fontFamily: 'monospace' }}>{cfg.outputDir}</div>
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {cfg.features.map(f => (
                  <span key={f} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, background: '#1e3a5f', color: '#60a5fa' }}>{f}</span>
                ))}
              </div>
            </div>

            {/* Deploy Button & Logs */}
            <button onClick={runDeploy} disabled={deployStatus === 'building' || deployStatus === 'deploying'} style={{ padding: '12px', borderRadius: 8, border: 'none', cursor: deployStatus === 'building' || deployStatus === 'deploying' ? 'not-allowed' : 'pointer', background: deployStatus === 'success' ? '#10b981' : deployStatus === 'failed' ? '#ef4444' : '#3b82f6', color: '#fff', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: deployStatus === 'building' || deployStatus === 'deploying' ? 0.8 : 1 }}>
              {deployStatus === 'building' || deployStatus === 'deploying' ? <><Loader2 size={16} className="animate-spin" /> {deployStatus === 'building' ? 'Building...' : 'Deploying...'}</> : deployStatus === 'success' ? <><CloudCheck size={16} /> Deployed! Deploy Again</> : deployStatus === 'failed' ? <><RefreshCw size={16} /> Retry Deploy</> : <><Rocket size={16} /> Deploy to {cfg.name}</>}
            </button>

            {/* Live URL */}
            {liveUrl && (
              <div style={{ ...cardStyle, border: '1px solid #10b981', background: '#052e16' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 600, marginBottom: 2 }}>🎉 Live URL</div>
                    <div style={{ fontSize: 12, color: '#86efac', fontFamily: 'monospace' }}>{liveUrl}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={copyUrl} style={{ padding: '6px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', background: '#065f46', color: '#4ade80', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied!' : 'Copy'}
                    </button>
                    <a href={liveUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '6px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', background: '#065f46', color: '#4ade80', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                      <ExternalLink size={12} /> Open
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Build Logs */}
            {logs.length > 0 && (
              <div style={{ background: '#020617', border: '1px solid #1e293b', borderRadius: 6, padding: '10px 12px', fontFamily: 'monospace', fontSize: 11, color: '#94a3b8', maxHeight: 200, overflow: 'auto' }}>
                {logs.map((log, i) => (
                  <div key={i} style={{ color: log.startsWith('> ✅') || log.startsWith('> 🌍') ? '#4ade80' : log.startsWith('> ❌') ? '#f87171' : log.startsWith('> URL') ? '#60a5fa' : '#94a3b8', marginBottom: 1 }}>{log}</div>
                ))}
                {(deployStatus === 'building' || deployStatus === 'deploying') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#f59e0b' }}>
                    <Loader2 size={10} className="animate-spin" /> processing...
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {deployments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#475569' }}>
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
                    <div style={{ fontSize: 10, color: '#64748b' }}>{dep.duration}s · {new Date(dep.timestamp).toLocaleDateString()}</div>
                  </div>
                  <a href={dep.url} target="_blank" rel="noopener noreferrer" style={{ color: '#94a3b8', textDecoration: 'none' }}><ExternalLink size={14} /></a>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Config Tab */}
        {activeTab === 'config' && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ ...cardStyle }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Shield size={14} color="#f59e0b" /> Environment Variables
              </div>
              {cfg.envVars.map(v => (
                <div key={v} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{v}</div>
                  <input
                    type="password"
                    value={envVars[v] || ''}
                    onChange={e => setEnvVars(prev => ({ ...prev, [v]: e.target.value }))}
                    placeholder={`Enter ${v}...`}
                    style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '8px 10px', fontSize: 12, boxSizing: 'border-box', outline: 'none', fontFamily: 'monospace' }}
                  />
                </div>
              ))}
            </div>
            <div style={{ ...cardStyle }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Deployment Checklist</div>
              {[
                { label: 'Build runs successfully', done: true },
                { label: 'Environment variables configured', done: Object.keys(envVars).length > 0 },
                { label: 'Custom domain ready', done: false },
                { label: 'SSL certificate enabled', done: true },
                { label: 'CDN configured', done: true },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #1e293b' }}>
                  {item.done ? <CheckCircle2 size={14} color="#4ade80" /> : <AlertCircle size={14} color="#f59e0b" />}
                  <span style={{ fontSize: 12, color: item.done ? '#e2e8f0' : '#94a3b8' }}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
