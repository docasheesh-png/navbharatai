import React, { useState, useCallback } from 'react';
import {
  CreditCard,
  DollarSign,
  Heart,
  Smartphone,
  Megaphone,
  RefreshCw,
  Copy,
  Check,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  ChevronRight,
  IndianRupee,
  Zap,
} from 'lucide-react';
import { resolveAppSource, hasAnalysableApp } from '../../lib/workspaceSource';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MonetizationWizardProps {
  generatedCode?: string;
  /** The v5-synced workspace files — the real app to inject the snippet into. */
  files?: Record<string, string>;
  onCodeUpdate?: (code: string) => void;
}

type MethodId = 'razorpay' | 'cashfree' | 'stripe' | 'upi' | 'adsense' | 'subscription';

interface SubscriptionPlan {
  name: string;
  price: string;
  features: string[];
}

interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  companyName: string;
  currency: string;
  amount: string;
  variableAmount: boolean;
  modes: { card: boolean; upi: boolean; netbanking: boolean; wallet: boolean };
}

interface UpiConfig {
  upiId: string;
  name: string;
  amount: string;
  variableAmount: boolean;
}

interface AdsenseConfig {
  publisherId: string;
  slotId: string;
  format: 'display' | 'in-article' | 'in-feed';
}

interface SubscriptionConfig {
  plans: SubscriptionPlan[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function copyToClipboard(text: string, setCopied: (k: string) => void, key: string) {
  navigator.clipboard.writeText(text).then(() => {
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  });
}

// ─── Code generators ──────────────────────────────────────────────────────────

function generateRazorpayCode(cfg: RazorpayConfig): { html: string; script: string } {
  const amountExpr = cfg.variableAmount ? 'window.payAmount' : cfg.amount || '0';
  const html = `<button id="rzp-button" class="pay-btn" style="background:#6366f1;color:#fff;padding:12px 28px;border:none;border-radius:8px;font-size:16px;cursor:pointer;">
  Pay ${cfg.currency === 'INR' ? '₹' : cfg.currency === 'USD' ? '$' : '€'}{{amount}}
</button>`;
  const script = `<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
var options = {
  key: "${cfg.keyId || '{{keyId}}'}",
  amount: ${amountExpr} * 100,
  currency: "${cfg.currency}",
  name: "${cfg.companyName || '{{companyName}}'}",
  description: "Payment",
  handler: function(response) {
    alert("Payment successful! ID: " + response.razorpay_payment_id);
  },
  prefill: { name: "", email: "", contact: "" },
  method: {
    card: ${cfg.modes.card},
    upi: ${cfg.modes.upi},
    netbanking: ${cfg.modes.netbanking},
    wallet: ${cfg.modes.wallet}
  },
  theme: { color: "#6366f1" }
};
var rzp = new Razorpay(options);
document.getElementById('rzp-button').onclick = function(e) {
  rzp.open(); e.preventDefault();
};
</script>`;
  return { html, script };
}

function generateUpiCode(cfg: UpiConfig): { link: string; html: string } {
  const amount = cfg.variableAmount ? '{{amount}}' : cfg.amount || '0';
  const link = `upi://pay?pa=${cfg.upiId || '{{upiId}}'}&pn=${encodeURIComponent(cfg.name || '{{name}}')}&am=${amount}&cu=INR`;
  const html = `<!-- UPI Deep Link Button -->
<a href="${link}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:16px;">
  Pay via UPI
</a>
<!-- For mobile apps: window.location.href = "${link}"; -->`;
  return { link, html };
}

function generateAdsenseCode(cfg: AdsenseConfig): string {
  if (cfg.format === 'display') {
    return `<!-- Google AdSense - Display Ad -->
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${cfg.publisherId || 'ca-pub-XXXXXXXXXX'}"
     crossorigin="anonymous"></script>
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="${cfg.publisherId || 'ca-pub-XXXXXXXXXX'}"
     data-ad-slot="${cfg.slotId || 'XXXXXXXXXX'}"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>
     (adsbygoogle = window.adsbygoogle || []).push({});
</script>`;
  }
  if (cfg.format === 'in-article') {
    return `<!-- Google AdSense - In-Article Ad -->
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${cfg.publisherId || 'ca-pub-XXXXXXXXXX'}"
     crossorigin="anonymous"></script>
<ins class="adsbygoogle"
     style="display:block;text-align:center;"
     data-ad-layout="in-article"
     data-ad-format="fluid"
     data-ad-client="${cfg.publisherId || 'ca-pub-XXXXXXXXXX'}"
     data-ad-slot="${cfg.slotId || 'XXXXXXXXXX'}"></ins>
<script>
     (adsbygoogle = window.adsbygoogle || []).push({});
</script>`;
  }
  return `<!-- Google AdSense - In-Feed Ad -->
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${cfg.publisherId || 'ca-pub-XXXXXXXXXX'}"
     crossorigin="anonymous"></script>
<ins class="adsbygoogle"
     style="display:block"
     data-ad-format="fluid"
     data-ad-layout-key="-fb+5w+4e-db+86"
     data-ad-client="${cfg.publisherId || 'ca-pub-XXXXXXXXXX'}"
     data-ad-slot="${cfg.slotId || 'XXXXXXXXXX'}"></ins>
<script>
     (adsbygoogle = window.adsbygoogle || []).push({});
</script>`;
}

function generateSubscriptionCode(plans: SubscriptionPlan[]): { pricing: string; firebase: string } {
  const cards = plans.map(p => `  <div class="plan-card" style="border:1px solid #30363d;border-radius:12px;padding:24px;flex:1;background:#161b22;">
    <h3 style="color:#e6edf3;margin:0 0 8px;">${p.name}</h3>
    <div style="font-size:32px;font-weight:700;color:#6366f1;margin-bottom:16px;">₹${p.price}<span style="font-size:14px;color:#8b949e;">/mo</span></div>
    <ul style="list-style:none;padding:0;margin:0 0 20px;">
${p.features.map(f => `      <li style="color:#8b949e;padding:4px 0;">✓ ${f}</li>`).join('\n')}
    </ul>
    <button style="width:100%;padding:10px;background:#6366f1;color:#fff;border:none;border-radius:8px;cursor:pointer;">Choose ${p.name}</button>
  </div>`).join('\n');

  const pricing = `<!-- Subscription Pricing Page -->
<div style="display:flex;gap:16px;padding:32px;font-family:sans-serif;">
${cards}
</div>`;

  const firebase = `// Firebase Subscription Check
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

async function checkSubscription() {
  const auth = getAuth();
  const db = getFirestore();
  const user = auth.currentUser;
  if (!user) return { active: false, plan: null };

  const ref = doc(db, 'subscriptions', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { active: false, plan: null };

  const data = snap.data();
  const isActive = data.status === 'active' && new Date(data.expiresAt) > new Date();
  return { active: isActive, plan: data.plan };
}

// Usage:
// const { active, plan } = await checkSubscription();
// if (!active) { /* redirect to pricing */ }`;

  return { pricing, firebase };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface CodeBlockProps {
  code: string;
  label: string;
  copiedKey: string;
  setCopied: (k: string) => void;
  blockKey: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ code, label, copiedKey, setCopied, blockKey }) => (
  <div className="mb-4">
    <div className="flex items-center justify-between mb-1">
      <span style={{ color: '#8b949e', fontSize: 12 }}>{label}</span>
      <button
        onClick={() => copyToClipboard(code, setCopied, blockKey)}
        style={{
          background: 'none', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
          color: copiedKey === blockKey ? '#22c55e' : '#8b949e', fontSize: 12,
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        {copiedKey === blockKey ? <Check size={12} /> : <Copy size={12} />}
        {copiedKey === blockKey ? 'Copied!' : 'Copy'}
      </button>
    </div>
    <pre style={{
      background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 8, padding: 12, overflowX: 'auto', fontSize: 12,
      color: '#e6edf3', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
    }}>{code}</pre>
  </div>
);

// ─── Revenue Calculator ───────────────────────────────────────────────────────

const RevenueCalculator: React.FC<{ method: MethodId }> = ({ method }) => {
  const [visitors, setVisitors] = useState(5000);
  const [conversion, setConversion] = useState(2);
  const [aov, setAov] = useState(500);

  const revenue = method === 'adsense'
    ? Math.round(visitors * 0.01 * 0.3 * 100) / 100  // rough RPM estimate
    : Math.round(visitors * (conversion / 100) * aov);

  return (
    <div style={{ background: '#161b22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 16, marginTop: 16 }}>
      <div style={{ color: '#e6edf3', fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <IndianRupee size={15} /> Revenue Calculator
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 4 }}>
            Monthly visitors: <strong style={{ color: '#e6edf3' }}>{visitors.toLocaleString()}</strong>
          </div>
          <input type="range" min={100} max={100000} step={100} value={visitors}
            onChange={e => setVisitors(Number(e.target.value))}
            style={{ width: '100%', accentColor: '#6366f1' }} />
        </div>
        {method !== 'adsense' && (
          <div>
            <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 4 }}>
              Conversion rate: <strong style={{ color: '#e6edf3' }}>{conversion}%</strong>
            </div>
            <input type="range" min={0.5} max={10} step={0.5} value={conversion}
              onChange={e => setConversion(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#6366f1' }} />
          </div>
        )}
        {method !== 'adsense' && (
          <div>
            <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 4 }}>Average order value (₹)</div>
            <input type="number" value={aov} onChange={e => setAov(Number(e.target.value))}
              style={{
                width: '100%', background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6, padding: '6px 10px', color: '#e6edf3', fontSize: 13,
              }} />
          </div>
        )}
        <div style={{
          background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: 8, padding: 12, textAlign: 'center',
        }}>
          <div style={{ color: '#8b949e', fontSize: 12 }}>Estimated monthly revenue</div>
          <div style={{ color: '#6366f1', fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            {method === 'adsense' ? `$${revenue}` : `₹${revenue.toLocaleString()}`}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const MonetizationWizard: React.FC<MonetizationWizardProps> = ({ generatedCode, files, onCodeUpdate }) => {
  const [selected, setSelected] = useState<MethodId>('razorpay');
  const [copiedKey, setCopied] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [injectState, setInjectState] = useState<'idle' | 'done' | 'noapp'>('idle');

  // Razorpay config
  const [rzpCfg, setRzpCfg] = useState<RazorpayConfig>({
    keyId: '', keySecret: '', companyName: '', currency: 'INR',
    amount: '499', variableAmount: false,
    modes: { card: true, upi: true, netbanking: true, wallet: true },
  });

  // UPI config
  const [upiCfg, setUpiCfg] = useState<UpiConfig>({ upiId: '', name: '', amount: '99', variableAmount: false });

  // AdSense config
  const [adsCfg, setAdsCfg] = useState<AdsenseConfig>({ publisherId: '', slotId: '', format: 'display' });

  // Subscription config
  const [subCfg, setSubCfg] = useState<SubscriptionConfig>({
    plans: [
      { name: 'Basic', price: '299', features: ['5 projects', '1GB storage', 'Email support'] },
      { name: 'Pro', price: '799', features: ['Unlimited projects', '10GB storage', 'Priority support', 'Custom domain'] },
      { name: 'Enterprise', price: '2499', features: ['Everything in Pro', 'Dedicated server', 'SLA 99.9%', 'White-label'] },
    ],
  });

  const inputStyle: React.CSSProperties = {
    width: '100%', background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6, padding: '7px 10px', color: '#e6edf3', fontSize: 13, boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = { color: '#8b949e', fontSize: 12, marginBottom: 4, display: 'block' };

  const handleInject = useCallback(() => {
    if (!onCodeUpdate) return;
    let snippet = '';
    if (selected === 'razorpay') {
      const { html, script } = generateRazorpayCode(rzpCfg);
      snippet = `\n<!-- Razorpay Payment -->\n${html}\n${script}`;
    } else if (selected === 'upi') {
      const { html } = generateUpiCode(upiCfg);
      snippet = `\n<!-- UPI Payment -->\n${html}`;
    } else if (selected === 'adsense') {
      snippet = `\n<!-- AdSense Ad -->\n${generateAdsenseCode(adsCfg)}`;
    } else if (selected === 'subscription') {
      const { pricing } = generateSubscriptionCode(subCfg.plans);
      snippet = `\n<!-- Subscription Pricing -->\n${pricing}`;
    }
    // Inject into the REAL app (admin autopsy 2026-07-21): the old code appended onto the retired
    // generatedCode placeholder and flashed "Injected!" even when nothing real was updated. Resolve
    // the real source; only claim success when there's an app to inject into.
    const src = resolveAppSource(generatedCode, files);
    if (!hasAnalysableApp(src)) {
      setInjectState('noapp');
      setTimeout(() => setInjectState('idle'), 2500);
      return;
    }
    const merged = src.html.includes('</body>')
      ? src.html.replace('</body>', `${snippet}\n</body>`)
      : src.html + snippet;
    onCodeUpdate(merged);
    setInjectState('done');
    setTimeout(() => setInjectState('idle'), 2500);
  }, [selected, rzpCfg, upiCfg, adsCfg, subCfg, generatedCode, files, onCodeUpdate]);

  const methods: { id: MethodId; icon: React.ReactNode; label: string; tagline: string; detail: string; fee: string; color: string }[] = [
    { id: 'razorpay', icon: <CreditCard size={20} />, label: 'Razorpay', tagline: "India ka #1 payment gateway", detail: 'Credit/Debit, UPI, Netbanking', fee: '2% + ₹3 / txn', color: '#6366f1' },
    { id: 'cashfree', icon: <DollarSign size={20} />, label: 'Cashfree', tagline: 'Low fees, instant settlement', detail: 'UPI, Cards, Wallets', fee: '1.75% / txn', color: '#22c55e' },
    { id: 'stripe', icon: <Heart size={20} />, label: 'Stripe', tagline: 'International payments', detail: 'Cards, Apple Pay, Google Pay', fee: '2.9% + $0.30 USD', color: '#a855f7' },
    { id: 'upi', icon: <Smartphone size={20} />, label: 'UPI Deep Link', tagline: 'Direct UPI payment link', detail: 'No gateway needed', fee: 'Zero fees', color: '#f97316' },
    { id: 'adsense', icon: <Megaphone size={20} />, label: 'Google AdSense', tagline: 'Earn from ads', detail: 'Display, in-article ads', fee: 'Revenue share', color: '#eab308' },
    { id: 'subscription', icon: <RefreshCw size={20} />, label: 'Subscription', tagline: 'Monthly/yearly plans', detail: 'Firebase + Razorpay combo', fee: 'Custom pricing', color: '#3b82f6' },
  ];

  // ── Right panel renderers ──

  const renderRazorpay = () => {
    const { html, script } = generateRazorpayCode(rzpCfg);
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Key ID</label>
            <input style={inputStyle} placeholder="rzp_test_XXXXXXXXXX" value={rzpCfg.keyId}
              onChange={e => setRzpCfg(p => ({ ...p, keyId: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Key Secret</label>
            <div style={{ position: 'relative' }}>
              <input style={{ ...inputStyle, paddingRight: 32 }} type={showSecret ? 'text' : 'password'}
                placeholder="•••••••••••" value={rzpCfg.keySecret}
                onChange={e => setRzpCfg(p => ({ ...p, keySecret: e.target.value }))} />
              <button onClick={() => setShowSecret(s => !s)}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#8b949e' }}>
                {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Company Name</label>
            <input style={inputStyle} placeholder="My Startup" value={rzpCfg.companyName}
              onChange={e => setRzpCfg(p => ({ ...p, companyName: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Currency</label>
            <select style={{ ...inputStyle }} value={rzpCfg.currency}
              onChange={e => setRzpCfg(p => ({ ...p, currency: e.target.value }))}>
              <option value="INR">INR — ₹</option>
              <option value="USD">USD — $</option>
              <option value="EUR">EUR — €</option>
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Payment Modes</label>
          <div style={{ display: 'flex', gap: 12 }}>
            {(['card', 'upi', 'netbanking', 'wallet'] as const).map(m => (
              <label key={m} style={{ color: '#8b949e', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={rzpCfg.modes[m]} style={{ accentColor: '#6366f1' }}
                  onChange={e => setRzpCfg(p => ({ ...p, modes: { ...p.modes, [m]: e.target.checked } }))} />
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </label>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Amount (₹)</label>
            <input style={inputStyle} type="number" value={rzpCfg.amount} disabled={rzpCfg.variableAmount}
              onChange={e => setRzpCfg(p => ({ ...p, amount: e.target.value }))} />
          </div>
          <label style={{ color: '#8b949e', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', alignSelf: 'flex-end', paddingBottom: 2 }}>
            <input type="checkbox" checked={rzpCfg.variableAmount} style={{ accentColor: '#6366f1' }}
              onChange={e => setRzpCfg(p => ({ ...p, variableAmount: e.target.checked }))} />
            Variable amount
          </label>
        </div>
        <CodeBlock code={html} label="HTML Button" copiedKey={copiedKey} setCopied={setCopied} blockKey="rzp-html" />
        <CodeBlock code={script} label="Checkout Script" copiedKey={copiedKey} setCopied={setCopied} blockKey="rzp-script" />
      </>
    );
  };

  const renderUpi = () => {
    const { link, html } = generateUpiCode(upiCfg);
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>UPI ID</label>
            <input style={inputStyle} placeholder="yourname@upi" value={upiCfg.upiId}
              onChange={e => setUpiCfg(p => ({ ...p, upiId: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Display Name</label>
            <input style={inputStyle} placeholder="My Business" value={upiCfg.name}
              onChange={e => setUpiCfg(p => ({ ...p, name: e.target.value }))} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Amount (₹)</label>
            <input style={inputStyle} type="number" value={upiCfg.amount} disabled={upiCfg.variableAmount}
              onChange={e => setUpiCfg(p => ({ ...p, amount: e.target.value }))} />
          </div>
          <label style={{ color: '#8b949e', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', alignSelf: 'flex-end', paddingBottom: 2 }}>
            <input type="checkbox" checked={upiCfg.variableAmount} style={{ accentColor: '#f97316' }}
              onChange={e => setUpiCfg(p => ({ ...p, variableAmount: e.target.checked }))} />
            Variable amount
          </label>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Generated UPI Link</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <code style={{ ...inputStyle, flex: 1, display: 'block', wordBreak: 'break-all', color: '#f97316', fontSize: 11 }}>{link}</code>
            <button onClick={() => copyToClipboard(link, setCopied, 'upi-link')}
              style={{ background: '#f97316', border: 'none', borderRadius: 6, padding: '0 12px', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              {copiedKey === 'upi-link' ? <Check size={14} /> : <Copy size={14} />}
              {copiedKey === 'upi-link' ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
        <CodeBlock code={html} label="HTML Button with UPI Link" copiedKey={copiedKey} setCopied={setCopied} blockKey="upi-html" />
      </>
    );
  };

  const renderAdsense = () => {
    const code = generateAdsenseCode(adsCfg);
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Publisher ID</label>
            <input style={inputStyle} placeholder="ca-pub-XXXXXXXXXX" value={adsCfg.publisherId}
              onChange={e => setAdsCfg(p => ({ ...p, publisherId: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Ad Slot ID</label>
            <input style={inputStyle} placeholder="1234567890" value={adsCfg.slotId}
              onChange={e => setAdsCfg(p => ({ ...p, slotId: e.target.value }))} />
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Ad Format</label>
          <div style={{ display: 'flex', gap: 16 }}>
            {(['display', 'in-article', 'in-feed'] as const).map(f => (
              <label key={f} style={{ color: '#8b949e', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="radio" name="adFormat" value={f} checked={adsCfg.format === f} style={{ accentColor: '#eab308' }}
                  onChange={() => setAdsCfg(p => ({ ...p, format: f }))} />
                {f.charAt(0).toUpperCase() + f.slice(1).replace('-', ' ')}
              </label>
            ))}
          </div>
        </div>
        <div style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)', borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 12, color: '#ca8a04' }}>
          AdSense approval takes 1-2 weeks. Submit your site first at adsense.google.com
        </div>
        <CodeBlock code={code} label="AdSense Code" copiedKey={copiedKey} setCopied={setCopied} blockKey="adsense-code" />
      </>
    );
  };

  const updatePlan = (idx: number, field: keyof SubscriptionPlan, value: string) => {
    setSubCfg(p => {
      const plans = [...p.plans];
      if (field === 'features') return p;
      plans[idx] = { ...plans[idx], [field]: value };
      return { plans };
    });
  };
  const updateFeature = (planIdx: number, featIdx: number, value: string) => {
    setSubCfg(p => {
      const plans = p.plans.map((plan, i) => {
        if (i !== planIdx) return plan;
        const features = [...plan.features];
        features[featIdx] = value;
        return { ...plan, features };
      });
      return { plans };
    });
  };
  const addFeature = (planIdx: number) => {
    setSubCfg(p => {
      const plans = p.plans.map((plan, i) =>
        i === planIdx ? { ...plan, features: [...plan.features, 'New feature'] } : plan
      );
      return { plans };
    });
  };
  const removeFeature = (planIdx: number, featIdx: number) => {
    setSubCfg(p => {
      const plans = p.plans.map((plan, i) =>
        i === planIdx ? { ...plan, features: plan.features.filter((_, fi) => fi !== featIdx) } : plan
      );
      return { plans };
    });
  };

  const renderSubscription = () => {
    const { pricing, firebase } = generateSubscriptionCode(subCfg.plans);
    const planColors = ['#6366f1', '#22c55e', '#f97316'];
    return (
      <>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          {subCfg.plans.map((plan, pi) => (
            <div key={pi} style={{ flex: 1, background: '#0d1117', border: `1px solid ${planColors[pi]}40`, borderRadius: 8, padding: 12 }}>
              <input style={{ ...inputStyle, fontWeight: 600, color: planColors[pi], marginBottom: 6 }}
                value={plan.name} onChange={e => updatePlan(pi, 'name', e.target.value)} />
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ color: '#8b949e', fontSize: 12, marginRight: 4 }}>₹</span>
                <input style={{ ...inputStyle, width: 70 }} type="number" value={plan.price}
                  onChange={e => updatePlan(pi, 'price', e.target.value)} />
                <span style={{ color: '#8b949e', fontSize: 11, marginLeft: 4 }}>/mo</span>
              </div>
              {plan.features.map((feat, fi) => (
                <div key={fi} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  <input style={{ ...inputStyle, flex: 1, fontSize: 11 }} value={feat}
                    onChange={e => updateFeature(pi, fi, e.target.value)} />
                  <button onClick={() => removeFeature(pi, fi)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 2 }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <button onClick={() => addFeature(pi)}
                style={{ background: 'none', border: `1px dashed ${planColors[pi]}60`, borderRadius: 4, width: '100%', padding: '4px 0', cursor: 'pointer', color: planColors[pi], fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, marginTop: 4 }}>
                <Plus size={11} /> Add feature
              </button>
            </div>
          ))}
        </div>
        <CodeBlock code={pricing} label="Pricing Page HTML" copiedKey={copiedKey} setCopied={setCopied} blockKey="sub-pricing" />
        <CodeBlock code={firebase} label="Firebase Subscription Check" copiedKey={copiedKey} setCopied={setCopied} blockKey="sub-firebase" />
      </>
    );
  };

  const renderCashfree = () => (
    <div style={{ color: '#8b949e', fontSize: 13, padding: 12, background: '#0d1117', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ color: '#22c55e', fontWeight: 600, marginBottom: 8 }}>Cashfree Integration</div>
      <p>1. Sign up at cashfree.com and get API keys.</p>
      <p>2. Use the Cashfree JS SDK or server-side API to create orders.</p>
      <p>3. Redirect to checkout URL or use Drop-in checkout.</p>
      <CodeBlock
        code={`// Cashfree Drop-in Checkout
const cashfree = await load({ mode: "sandbox" });
const checkoutOptions = {
  paymentSessionId: "{{sessionId}}", // from your server
  redirectTarget: "_modal",
};
cashfree.checkout(checkoutOptions).then(result => {
  if (result.error) console.log(result.error.message);
  if (result.paymentDetails) console.log("Payment success");
});`}
        label="Cashfree Checkout JS"
        copiedKey={copiedKey}
        setCopied={setCopied}
        blockKey="cashfree-code"
      />
    </div>
  );

  const renderStripe = () => (
    <div style={{ color: '#8b949e', fontSize: 13 }}>
      <CodeBlock
        code={`// Stripe Payment - Install: npm install @stripe/stripe-js
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe('pk_test_XXXXXXXXXX');

async function handlePayment() {
  const stripe = await stripePromise;
  // Create session on your server first
  const response = await fetch('/create-checkout-session', { method: 'POST' });
  const session = await response.json();
  await stripe.redirectToCheckout({ sessionId: session.id });
}

// Server-side (Node.js):
// const session = await stripe.checkout.sessions.create({
//   payment_method_types: ['card'],
//   line_items: [{ price: 'price_xxx', quantity: 1 }],
//   mode: 'payment',
//   success_url: 'https://yoursite.com/success',
//   cancel_url: 'https://yoursite.com/cancel',
// });`}
        label="Stripe Checkout (JS + Node)"
        copiedKey={copiedKey}
        setCopied={setCopied}
        blockKey="stripe-code"
      />
    </div>
  );

  const activeMethod = methods.find(m => m.id === selected)!;

  return (
    <div style={{ display: 'flex', height: '100%', background: '#0d1117', overflow: 'hidden', fontFamily: 'system-ui, sans-serif' }}>

      {/* Left Panel */}
      <div style={{ width: 260, borderRight: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '12px 8px' }}>
        <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 14, padding: '4px 8px 10px' }}>
          Monetization Wizard
        </div>
        {methods.map(m => (
          <button
            key={m.id}
            onClick={() => setSelected(m.id)}
            style={{
              width: '100%', textAlign: 'left', background: selected === m.id ? `${m.color}18` : 'none',
              border: `1px solid ${selected === m.id ? m.color + '60' : 'rgba(255,255,255,0.06)'}`,
              borderRadius: 8, padding: '10px 12px', cursor: 'pointer', marginBottom: 6,
              transition: 'all 0.15s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ color: m.color }}>{m.icon}</span>
              <span style={{ color: '#e6edf3', fontWeight: 600, fontSize: 13 }}>{m.label}</span>
              {selected === m.id && <ChevronRight size={12} style={{ marginLeft: 'auto', color: m.color }} />}
            </div>
            <div style={{ color: '#8b949e', fontSize: 11, marginBottom: 2 }}>{m.tagline}</div>
            <div style={{ color: '#6b7280', fontSize: 11 }}>{m.detail}</div>
            <div style={{ color: m.color, fontSize: 11, marginTop: 4, fontWeight: 500 }}>{m.fee}</div>
          </button>
        ))}
      </div>

      {/* Right Panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: activeMethod.color }}>{activeMethod.icon}</span>
          <span style={{ color: '#e6edf3', fontWeight: 600, fontSize: 14 }}>{activeMethod.label}</span>
          <span style={{ color: '#8b949e', fontSize: 12 }}>— {activeMethod.tagline}</span>
          {onCodeUpdate && (
            <button
              onClick={handleInject}
              style={{
                marginLeft: 'auto', background: injectState === 'done' ? '#22c55e' : injectState === 'noapp' ? '#f59e0b' : activeMethod.color,
                border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer',
                color: '#fff', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5,
                transition: 'background 0.2s',
              }}
            >
              {injectState === 'done' ? <Check size={13} /> : <Zap size={13} />}
              {injectState === 'done' ? 'Injected!' : injectState === 'noapp' ? 'Build an app first' : 'Inject into App'}
            </button>
          )}
        </div>

        {/* Config + Code */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {selected === 'razorpay' && renderRazorpay()}
          {selected === 'cashfree' && renderCashfree()}
          {selected === 'stripe' && renderStripe()}
          {selected === 'upi' && renderUpi()}
          {selected === 'adsense' && renderAdsense()}
          {selected === 'subscription' && renderSubscription()}

          <RevenueCalculator method={selected} />
        </div>
      </div>
    </div>
  );
};

export default MonetizationWizard;
