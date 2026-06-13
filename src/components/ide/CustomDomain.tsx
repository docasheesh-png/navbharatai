import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Globe,
  Copy,
  Check,
  ChevronRight,
  Shield,
  RefreshCw,
  Terminal,
  AlertCircle,
  CheckCircle2,
  Clock,
  Wifi,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Platform = 'firebase' | 'vercel' | 'cloudrun' | 'netlify';
type DnsProvider = 'GoDaddy' | 'Namecheap' | 'Cloudflare' | 'Google Domains' | 'BigRock' | 'Hostinger' | 'Other';
type PropagationStatus = 'idle' | 'checking' | 'propagated' | 'propagating' | 'not_found';

interface DnsRecord {
  type: string;
  name: string;
  value: string;
  ttl: number;
}

interface SavedDomain {
  domain: string;
  platform: Platform;
  configuredAt: string;
  status: 'pending' | 'active';
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const PLATFORMS: { id: Platform; label: string; icon: string; description: string }[] = [
  { id: 'firebase', label: 'Firebase Hosting', icon: '🔥', description: 'Free SSL, CDN, instant deploy' },
  { id: 'vercel', label: 'Vercel', icon: '▲', description: 'Best for Next.js & React apps' },
  { id: 'cloudrun', label: 'Google Cloud Run', icon: 'G', description: 'Enterprise-grade, auto-scaling' },
  { id: 'netlify', label: 'Netlify', icon: 'N', description: 'JAMstack, form handling, free tier' },
];

const DNS_PROVIDERS: DnsProvider[] = [
  'GoDaddy', 'Namecheap', 'Cloudflare', 'Google Domains', 'BigRock', 'Hostinger', 'Other',
];

const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

const STEPS = ['Domain Input', 'DNS Records', 'Verification', 'SSL Certificate'];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getDnsRecords(platform: Platform, domain: string, deployUrl: string, addWww: boolean): DnsRecord[] {
  const apex = '@';
  const records: DnsRecord[] = [];

  if (platform === 'firebase') {
    records.push({ type: 'A', name: apex, value: '151.101.1.195', ttl: 3600 });
    records.push({ type: 'TXT', name: apex, value: `firebase-hosting-verification=${domain.replace(/\./g, '-')}`, ttl: 3600 });
    if (addWww) records.push({ type: 'CNAME', name: 'www', value: deployUrl || 'your-app.firebaseapp.com', ttl: 3600 });
  } else if (platform === 'vercel') {
    records.push({ type: 'A', name: apex, value: '76.76.19.19', ttl: 3600 });
    if (addWww) records.push({ type: 'CNAME', name: 'www', value: 'cname.vercel-dns.com', ttl: 3600 });
  } else if (platform === 'cloudrun') {
    records.push({ type: 'CNAME', name: addWww ? 'www' : apex, value: 'ghs.googlehosted.com', ttl: 3600 });
    if (addWww) records.push({ type: 'CNAME', name: apex, value: deployUrl || 'your-app.run.app', ttl: 3600 });
  } else if (platform === 'netlify') {
    records.push({ type: 'CNAME', name: apex, value: deployUrl || 'your-app.netlify.app', ttl: 3600 });
    if (addWww) records.push({ type: 'CNAME', name: 'www', value: deployUrl || 'your-app.netlify.app', ttl: 3600 });
  }

  return records;
}

function getCliCommand(platform: Platform, domain: string): string {
  if (platform === 'firebase') return `firebase target:apply hosting main your-app && firebase hosting:channel:deploy`;
  if (platform === 'vercel') return `vercel domains add ${domain || 'apnadomain.com'}`;
  if (platform === 'cloudrun') return `gcloud beta run domain-mappings create --service navbharat-ai-prod --domain ${domain || 'apnadomain.com'}`;
  if (platform === 'netlify') return `netlify domains:create ${domain || 'apnadomain.com'}`;
  return '';
}

function getPlatformInstructions(platform: Platform, dnsProvider: DnsProvider): string[] {
  const providerLogin: Record<DnsProvider, string> = {
    GoDaddy: 'Log in to GoDaddy.com → My Products → DNS → Add Record',
    Namecheap: 'Log in to Namecheap.com → Domain List → Manage → Advanced DNS',
    Cloudflare: 'Cloudflare Dashboard → select your domain → DNS → Add Record',
    'Google Domains': 'domains.google.com → your domain → DNS → Manage custom records',
    BigRock: 'Log in to BigRock.in → My Domains → DNS Management → Add Record',
    Hostinger: 'Log in to Hostinger hPanel → Domains → DNS / Nameservers → Add Record',
    Other: 'Log in to your DNS provider dashboard and find the DNS management section',
  };

  const step1 = providerLogin[dnsProvider];

  if (platform === 'firebase') {
    return [
      step1,
      'In Type field select "A", Name "@", paste the IP address in Value',
      'Add another record: Type "TXT", paste the verification value',
      'Save and wait 24-48 hours for propagation',
    ];
  }
  if (platform === 'vercel') {
    return [
      step1,
      'Select Type "A", Name "@", Value "76.76.19.19"',
      'Select Type "CNAME", Name "www", Value "cname.vercel-dns.com"',
      'Add your domain in the Vercel dashboard: Settings → Domains',
    ];
  }
  if (platform === 'cloudrun') {
    return [
      step1,
      'Select Type "CNAME", Name "www", Value "ghs.googlehosted.com"',
      'Google Cloud Console → Cloud Run → your service → Custom domains → add domain',
      'You may also need to add a TXT record for verification',
    ];
  }
  if (platform === 'netlify') {
    return [
      step1,
      'Select Type "CNAME", Name "@", paste your Netlify app URL in Value',
      'Netlify Dashboard → Sites → your site → Domain settings → add domain',
      'Both Netlify DNS and external DNS are supported',
    ];
  }
  return [];
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop */
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded hover:bg-white/10 transition-colors"
      title="Copy"
    >
      {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} className="text-white/50" />}
    </button>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {STEPS.map((label, i) => {
        const stepNum = i + 1;
        const done = stepNum < current;
        const active = stepNum === current;
        return (
          <React.Fragment key={label}>
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  done ? 'bg-green-500 text-white' : active ? 'bg-indigo-500 text-white' : 'bg-white/10 text-white/40'
                }`}
              >
                {done ? <Check size={13} /> : stepNum}
              </div>
              <span className={`text-[10px] whitespace-nowrap ${active ? 'text-indigo-300' : 'text-white/30'}`}>
                {label}
              </span>
            </div>
            {i < total - 1 && (
              <div className={`flex-1 h-px mb-4 ${done ? 'bg-green-500/50' : 'bg-white/10'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export const CustomDomain: React.FC = () => {
  const [platform, setPlatform] = useState<Platform>('firebase');
  const [dnsProvider, setDnsProvider] = useState<DnsProvider>('GoDaddy');
  const [step, setStep] = useState(1);

  // Step 1
  const [domain, setDomain] = useState('');
  const [addWww, setAddWww] = useState(true);
  const [deployUrl, setDeployUrl] = useState('');
  const [domainError, setDomainError] = useState('');

  // Step 3
  const [propagationStatus, setPropagationStatus] = useState<PropagationStatus>('idle');
  const [dnsResult, setDnsResult] = useState<string>('');
  const [autoRetry, setAutoRetry] = useState(false);
  const autoRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step 4 checklist
  const [checklist, setChecklist] = useState({
    domainAdded: false,
    dnsConfigured: false,
    dnsPropagated: false,
    sslActive: false,
  });

  const [copiedCommand, setCopiedCommand] = useState(false);

  // Load saved domains
  useEffect(() => {
    const saved = localStorage.getItem('navbharatai_custom_domains');
    if (saved) {
      const domains: SavedDomain[] = JSON.parse(saved);
      if (domains.length > 0) {
        const last = domains[domains.length - 1];
        setDomain(last.domain);
        setPlatform(last.platform);
      }
    }
  }, []);

  // Auto-retry cleanup
  useEffect(() => {
    return () => {
      if (autoRetryRef.current) clearInterval(autoRetryRef.current);
    };
  }, []);

  useEffect(() => {
    if (autoRetry && step === 3) {
      autoRetryRef.current = setInterval(() => {
        checkDns(domain);
      }, 30000);
    } else {
      if (autoRetryRef.current) clearInterval(autoRetryRef.current);
    }
    return () => {
      if (autoRetryRef.current) clearInterval(autoRetryRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRetry, step, domain]);

  const saveDomain = useCallback((d: string, p: Platform) => {
    const saved = localStorage.getItem('navbharatai_custom_domains');
    const domains: SavedDomain[] = saved ? JSON.parse(saved) : [];
    const existing = domains.findIndex((x) => x.domain === d);
    const entry: SavedDomain = { domain: d, platform: p, configuredAt: new Date().toISOString(), status: 'pending' };
    if (existing >= 0) domains[existing] = entry;
    else domains.push(entry);
    localStorage.setItem('navbharatai_custom_domains', JSON.stringify(domains));
  }, []);

  const validateDomain = (val: string) => {
    if (!val) { setDomainError('Domain is required'); return false; }
    if (!DOMAIN_REGEX.test(val)) { setDomainError('Enter a valid domain format (e.g. mydomain.com)'); return false; }
    setDomainError('');
    return true;
  };

  const checkDns = useCallback(async (d: string) => {
    if (!d) return;
    setPropagationStatus('checking');
    setDnsResult('');
    try {
      const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(d)}&type=A`);
      const json = await res.json();
      if (json.Answer && json.Answer.length > 0) {
        setPropagationStatus('propagated');
        setDnsResult(json.Answer.map((a: { data: string }) => a.data).join(', '));
        setChecklist((c) => ({ ...c, dnsPropagated: true }));
        // Mark domain as active in localStorage
        const saved = localStorage.getItem('navbharatai_custom_domains');
        if (saved) {
          const domains: SavedDomain[] = JSON.parse(saved);
          const idx = domains.findIndex((x) => x.domain === d);
          if (idx >= 0) { domains[idx].status = 'active'; localStorage.setItem('navbharatai_custom_domains', JSON.stringify(domains)); }
        }
      } else if (json.Status === 3) {
        setPropagationStatus('not_found');
      } else {
        setPropagationStatus('propagating');
      }
    } catch {
      setPropagationStatus('not_found');
    }
  }, []);

  const handleNext = () => {
    if (step === 1) {
      if (!validateDomain(domain)) return;
      saveDomain(domain, platform);
      setChecklist((c) => ({ ...c, domainAdded: true }));
      setStep(2);
    } else if (step === 2) {
      setChecklist((c) => ({ ...c, dnsConfigured: true }));
      setStep(3);
    } else if (step === 3) {
      setStep(4);
      if (propagationStatus === 'propagated') {
        setChecklist((c) => ({ ...c, sslActive: true }));
      }
    }
  };

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(getCliCommand(platform, domain));
      setCopiedCommand(true);
      setTimeout(() => setCopiedCommand(false), 2000);
    } catch { /* noop */ }
  };

  const dnsRecords = getDnsRecords(platform, domain, deployUrl, addWww);
  const instructions = getPlatformInstructions(platform, dnsProvider);
  const allDone = Object.values(checklist).every(Boolean);

  return (
    <div className="flex h-full min-h-0 bg-[#0d1117] text-white font-sans" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* ── Left Sidebar ── */}
      <div className="w-[260px] shrink-0 border-r border-white/10 flex flex-col p-4 gap-4 overflow-y-auto">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Globe size={16} className="text-indigo-400" />
            <span className="text-sm font-semibold text-white/80">Platform</span>
          </div>
          <div className="flex flex-col gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPlatform(p.id)}
                className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${
                  platform === p.id
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'border-white/10 bg-[#161b22] hover:border-white/20'
                }`}
              >
                <span
                  className={`text-lg leading-none mt-0.5 ${
                    p.id === 'cloudrun' ? 'font-bold text-blue-400' : p.id === 'netlify' ? 'text-teal-400 font-bold' : ''
                  }`}
                >
                  {p.icon}
                </span>
                <div>
                  <div className="text-xs font-semibold text-white/90">{p.label}</div>
                  <div className="text-[10px] text-white/40 mt-0.5 leading-snug">{p.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* DNS Provider chips */}
        <div>
          <div className="text-xs font-semibold text-white/60 mb-2">DNS Provider</div>
          <div className="flex flex-wrap gap-1.5">
            {DNS_PROVIDERS.map((p) => (
              <button
                key={p}
                onClick={() => setDnsProvider(p)}
                className={`px-2 py-1 rounded text-[10px] font-medium border transition-all ${
                  dnsProvider === p
                    ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                    : 'border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:text-white/70'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main Area ── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6">
        <div className="max-w-2xl w-full mx-auto">
          <StepIndicator current={step} total={STEPS.length} />

          {/* ── Step 1: Domain Input ── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold mb-1">Connect Your Domain</h2>
                <p className="text-sm text-white/50">
                  Enter the custom domain you want to connect to <span className="text-indigo-400">{PLATFORMS.find((p) => p.id === platform)?.label}</span>.
                </p>
              </div>

              <div>
                <label className="text-xs text-white/60 mb-1.5 block">Custom Domain</label>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => { setDomain(e.target.value); if (domainError) validateDomain(e.target.value); }}
                  placeholder="apnadomain.com"
                  className={`w-full bg-[#161b22] border rounded-lg px-4 py-3 text-sm outline-none transition-colors ${
                    domainError ? 'border-red-500/70' : 'border-white/10 focus:border-indigo-500/70'
                  }`}
                />
                {domainError && (
                  <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1">
                    <AlertCircle size={11} /> {domainError}
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs text-white/60 mb-1.5 block">Current Deployment URL</label>
                <input
                  type="text"
                  value={deployUrl}
                  onChange={(e) => setDeployUrl(e.target.value)}
                  placeholder={
                    platform === 'firebase' ? 'your-app.firebaseapp.com' :
                    platform === 'vercel' ? 'your-app.vercel.app' :
                    platform === 'cloudrun' ? 'your-app-xxx.run.app' :
                    'your-app.netlify.app'
                  }
                  className="w-full bg-[#161b22] border border-white/10 focus:border-indigo-500/70 rounded-lg px-4 py-3 text-sm outline-none transition-colors"
                />
              </div>

              <label className="flex items-center gap-3 cursor-pointer group">
                <div
                  onClick={() => setAddWww((v) => !v)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${addWww ? 'bg-indigo-500' : 'bg-white/20'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${addWww ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
                <div>
                  <span className="text-sm text-white/80">Also add www subdomain</span>
                  <p className="text-[10px] text-white/40">Both @ and www CNAME records will be configured</p>
                </div>
              </label>
            </div>
          )}

          {/* ── Step 2: DNS Records ── */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold mb-1">Configure DNS Records</h2>
                <p className="text-sm text-white/50">
                  Add these records in your DNS provider (<span className="text-indigo-300">{dnsProvider}</span>) dashboard.
                </p>
              </div>

              {/* DNS Records Table */}
              <div className="bg-[#161b22] border border-white/10 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
                  <Terminal size={13} className="text-indigo-400" />
                  <span className="text-xs font-semibold text-white/70">DNS Records — {domain || 'apnadomain.com'}</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="text-left px-4 py-2 text-white/40 font-medium">Type</th>
                      <th className="text-left px-4 py-2 text-white/40 font-medium">Name</th>
                      <th className="text-left px-4 py-2 text-white/40 font-medium">Value</th>
                      <th className="text-left px-4 py-2 text-white/40 font-medium">TTL</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {dnsRecords.map((rec, i) => (
                      <tr key={i} className="border-b border-white/5 last:border-0 hover:bg-white/3">
                        <td className="px-4 py-2.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            rec.type === 'A' ? 'bg-blue-500/20 text-blue-300' :
                            rec.type === 'CNAME' ? 'bg-purple-500/20 text-purple-300' :
                            'bg-yellow-500/20 text-yellow-300'
                          }`}>{rec.type}</span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-white/80">{rec.name}</td>
                        <td className="px-4 py-2.5 font-mono text-white/70 max-w-[200px] truncate">{rec.value}</td>
                        <td className="px-4 py-2.5 text-white/40">{rec.ttl}</td>
                        <td className="px-2 py-2"><CopyButton text={rec.value} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Platform-specific instructions */}
              <div className="bg-[#161b22] border border-white/10 rounded-xl p-4">
                <div className="text-xs font-semibold text-white/60 mb-3 flex items-center gap-2">
                  <span>{PLATFORMS.find((p) => p.id === platform)?.icon}</span>
                  Steps to set up {PLATFORMS.find((p) => p.id === platform)?.label} on {dnsProvider}
                </div>
                <ol className="space-y-2">
                  {instructions.map((step, i) => (
                    <li key={i} className="flex gap-3 text-xs text-white/70">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[10px] font-bold mt-0.5">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {/* ── Step 3: Verification ── */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold mb-1">DNS Propagation Check</h2>
                <p className="text-sm text-white/50">
                  DNS propagation can take 24-48 hours. Check the status below.
                </p>
              </div>

              <div className="bg-[#161b22] border border-white/10 rounded-xl p-4 space-y-4">
                <div className="flex gap-3">
                  <input
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="apnadomain.com"
                    className="flex-1 bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500/70"
                  />
                  <button
                    onClick={() => checkDns(domain)}
                    disabled={propagationStatus === 'checking'}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                  >
                    {propagationStatus === 'checking' ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Wifi size={14} />
                    )}
                    Check DNS
                  </button>
                </div>

                {propagationStatus !== 'idle' && (
                  <div className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${
                    propagationStatus === 'propagated' ? 'border-green-500/30 bg-green-500/10' :
                    propagationStatus === 'checking' ? 'border-indigo-500/30 bg-indigo-500/10' :
                    propagationStatus === 'propagating' ? 'border-yellow-500/30 bg-yellow-500/10' :
                    'border-red-500/30 bg-red-500/10'
                  }`}>
                    {propagationStatus === 'propagated' && <CheckCircle2 size={16} className="text-green-400 mt-0.5 shrink-0" />}
                    {propagationStatus === 'checking' && <RefreshCw size={16} className="text-indigo-400 animate-spin mt-0.5 shrink-0" />}
                    {propagationStatus === 'propagating' && <Clock size={16} className="text-yellow-400 mt-0.5 shrink-0" />}
                    {propagationStatus === 'not_found' && <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />}
                    <div>
                      {propagationStatus === 'propagated' && (
                        <><p className="font-medium text-green-300">Propagated! DNS records found.</p><p className="text-xs text-white/50 mt-0.5">IP: {dnsResult}</p></>
                      )}
                      {propagationStatus === 'checking' && <p className="text-indigo-300">Checking DNS...</p>}
                      {propagationStatus === 'propagating' && (
                        <><p className="font-medium text-yellow-300">Propagating... please wait</p><p className="text-xs text-white/50 mt-0.5">DNS changes can take 24-48 hours to propagate.</p></>
                      )}
                      {propagationStatus === 'not_found' && (
                        <><p className="font-medium text-red-300">DNS record not found</p><p className="text-xs text-white/50 mt-0.5">Make sure the records are added correctly and try again.</p></>
                      )}
                    </div>
                  </div>
                )}

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <div
                    onClick={() => setAutoRetry((v) => !v)}
                    className={`w-9 h-4.5 rounded-full transition-colors relative flex-shrink-0 ${autoRetry ? 'bg-indigo-500' : 'bg-white/20'}`}
                    style={{ height: '18px', width: '36px' }}
                  >
                    <div className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${autoRetry ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                  </div>
                  <span className="text-xs text-white/60">Auto-retry (check every 30 seconds)</span>
                </label>
              </div>
            </div>
          )}

          {/* ── Step 4: SSL ── */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold mb-1">SSL Certificate</h2>
                <p className="text-sm text-white/50">
                  SSL is automatically configured by the platform. No manual steps required.
                </p>
              </div>

              <div className="bg-[#161b22] border border-white/10 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Shield size={15} className="text-green-400" />
                  <span>
                    {platform === 'firebase' && 'Auto-SSL via Google (Firebase Hosting)'}
                    {platform === 'vercel' && "Auto-SSL via Let's Encrypt (Vercel)"}
                    {platform === 'cloudrun' && 'Auto-SSL via Google-managed certificate (Cloud Run)'}
                    {platform === 'netlify' && "Auto-SSL via Let's Encrypt (Netlify)"}
                  </span>
                </div>
                <p className="text-xs text-white/50 leading-relaxed">
                  After domain propagation, the SSL certificate is automatically issued and renewed. The first issuance may take 10-15 minutes.
                </p>
              </div>

              {/* Checklist */}
              <div className="bg-[#161b22] border border-white/10 rounded-xl p-4">
                <div className="text-xs font-semibold text-white/60 mb-3">Setup Checklist</div>
                <div className="space-y-2.5">
                  {([
                    { key: 'domainAdded', label: 'Domain added' },
                    { key: 'dnsConfigured', label: 'DNS records configured' },
                    { key: 'dnsPropagated', label: 'DNS propagated' },
                    { key: 'sslActive', label: 'SSL active' },
                  ] as const).map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-2.5 text-sm">
                      {checklist[key] ? (
                        <CheckCircle2 size={15} className="text-green-400 shrink-0" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-white/20 shrink-0" />
                      )}
                      <span className={checklist[key] ? 'text-white/80' : 'text-white/40'}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Success banner */}
              {allDone && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-sm text-green-300 flex items-center gap-2.5">
                  <CheckCircle2 size={16} className="shrink-0" />
                  🎉 Your domain is ready! <span className="font-semibold">{domain}</span> is live.
                </div>
              )}
            </div>
          )}

          {/* ── Navigation buttons ── */}
          <div className="mt-6 flex items-center justify-between">
            <button
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1}
              className="px-4 py-2 rounded-lg border border-white/10 text-sm text-white/60 hover:text-white hover:border-white/20 disabled:opacity-30 transition-all"
            >
              Back
            </button>
            {step < 4 ? (
              <button
                onClick={handleNext}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors"
              >
                Next <ChevronRight size={15} />
              </button>
            ) : (
              <button
                onClick={() => { setStep(1); setPropagationStatus('idle'); }}
                className="px-5 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-sm font-medium transition-colors"
              >
                Add New Domain
              </button>
            )}
          </div>

          {/* ── CLI Command (persistent footer) ── */}
          <div className="mt-8 bg-[#161b22] border border-white/10 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
              <Terminal size={13} className="text-indigo-400" />
              <span className="text-xs font-semibold text-white/60">CLI Command — {PLATFORMS.find((p) => p.id === platform)?.label}</span>
            </div>
            <div className="px-4 py-3 flex items-center justify-between gap-3">
              <code className="text-xs font-mono text-green-300 break-all leading-relaxed flex-1">
                {getCliCommand(platform, domain)}
              </code>
              <button
                onClick={handleCopyCommand}
                className="shrink-0 p-2 rounded hover:bg-white/10 transition-colors"
                title="Copy command"
              >
                {copiedCommand ? <Check size={14} className="text-green-400" /> : <Copy size={14} className="text-white/50" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomDomain;
