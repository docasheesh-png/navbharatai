import { useState } from 'react';
import { Paintbrush, Download, Check, Copy, RefreshCw, Image as ImageIcon, Monitor, Smartphone, Sun, Moon } from 'lucide-react';

interface BrandConfig {
  appName: string;
  tagline: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  bgColor: string;
  textColor: string;
  fontFamily: string;
  borderRadius: string;
  ogTitle: string;
  ogDescription: string;
  ogImageUrl: string;
  twitterHandle: string;
  footerText: string;
  customDomain: string;
}

const DEFAULT_CONFIG: BrandConfig = {
  appName: 'NavBharat AI', tagline: 'World-class AI app maker', logoUrl: '', faviconUrl: '',
  primaryColor: '#6366f1', secondaryColor: '#10b981', accentColor: '#f59e0b',
  // ⚠️ THE USER'S BRANDING, not ours — exported into their app and their assets, so these stay
  // literal colours. Deliberately outside the 2026-08-16 theme-variable sweep.
  bgColor: '#0d1117', textColor: '#ffffff', fontFamily: 'Inter',
  borderRadius: '12', ogTitle: 'NavBharat AI — Build apps with AI',
  ogDescription: 'India ka pehla AI-powered app maker — build, deploy, scale.', ogImageUrl: '',
  twitterHandle: '@navbharat_ai', footerText: '© 2025 NavBharat AI. Made with ❤️ in India.',
  customDomain: 'navbharat.ai',
};

const FONT_OPTIONS = ['Inter', 'Roboto', 'Poppins', 'Nunito', 'Raleway', 'Ubuntu', 'Noto Sans', 'Playfair Display', 'Fira Code'];
const BORDER_RADIUS_OPTIONS = [{ label: 'Sharp', value: '0' }, { label: 'Soft', value: '8' }, { label: 'Medium', value: '12' }, { label: 'Rounded', value: '16' }, { label: 'Pill', value: '999' }];

const COLOR_PRESETS = [
  { name: 'Indigo Pro', primary: '#6366f1', secondary: '#10b981', accent: '#f59e0b', bg: '#0d1117', text: '#ffffff' },
  { name: 'Saffron India', primary: '#ff6b00', secondary: '#138808', accent: '#ffffff', bg: '#0a0a0a', text: '#ffffff' },
  { name: 'Ocean Blue', primary: '#0ea5e9', secondary: '#06b6d4', accent: '#f0abfc', bg: '#020617', text: '#e2e8f0' },
  { name: 'Rose Gold', primary: '#e11d48', secondary: '#ec4899', accent: '#fbbf24', bg: '#1c1917', text: '#fafaf9' },
  { name: 'Forest Green', primary: '#16a34a', secondary: '#0d9488', accent: '#86efac', bg: '#052e16', text: '#f0fdf4' },
  { name: 'Royal Purple', primary: '#7c3aed', secondary: '#4f46e5', accent: '#c084fc', bg: '#0f0a1a', text: '#f5f3ff' },
];

const STORAGE_KEY = 'navbharat_brand_config';

export function WhitelabelBranding() {
  const [config, setConfig] = useState<BrandConfig>(() => {
    try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; } catch { return DEFAULT_CONFIG; }
  });
  const [activeTab, setActiveTab] = useState<'identity' | 'colors' | 'typography' | 'meta' | 'export'>('identity');
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [copied, setCopied] = useState('');
  const [darkPreview, setDarkPreview] = useState(true);

  const update = (patch: Partial<BrandConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  };

  const applyPreset = (preset: typeof COLOR_PRESETS[0]) => {
    update({ primaryColor: preset.primary, secondaryColor: preset.secondary, accentColor: preset.accent, bgColor: preset.bg, textColor: preset.text });
  };

  const resetToDefault = () => {
    setConfig(DEFAULT_CONFIG);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  };

  const generateCSS = (): string => `/* ${config.appName} — Brand CSS Variables */
:root {
  --brand-primary: ${config.primaryColor};
  --brand-secondary: ${config.secondaryColor};
  --brand-accent: ${config.accentColor};
  --brand-bg: ${config.bgColor};
  --brand-text: ${config.textColor};
  --brand-font: '${config.fontFamily}', sans-serif;
  --brand-radius: ${config.borderRadius}px;
  --brand-name: '${config.appName}';
}

/* Usage: */
body { background: var(--brand-bg); color: var(--brand-text); font-family: var(--brand-font); }
.btn-primary { background: var(--brand-primary); border-radius: var(--brand-radius); }
.btn-secondary { background: var(--brand-secondary); border-radius: var(--brand-radius); }
.accent { color: var(--brand-accent); }`;

  const generateMetaTags = (): string => `<!-- ${config.appName} Meta Tags -->
<title>${config.appName} — ${config.tagline}</title>
<meta name="description" content="${config.ogDescription}" />
<link rel="icon" href="${config.faviconUrl || '/favicon.ico'}" />

<!-- Open Graph -->
<meta property="og:title" content="${config.ogTitle}" />
<meta property="og:description" content="${config.ogDescription}" />
<meta property="og:image" content="${config.ogImageUrl || 'https://yourdomain.com/og-image.png'}" />
<meta property="og:url" content="https://${config.customDomain}" />
<meta property="og:type" content="website" />

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:site" content="${config.twitterHandle}" />
<meta name="twitter:title" content="${config.ogTitle}" />
<meta name="twitter:description" content="${config.ogDescription}" />
<meta name="twitter:image" content="${config.ogImageUrl || 'https://yourdomain.com/og-image.png'}" />`;

  const generateTailwindConfig = (): string => `// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: '${config.primaryColor}',
        secondary: '${config.secondaryColor}',
        accent: '${config.accentColor}',
        background: '${config.bgColor}',
      },
      fontFamily: {
        sans: ['${config.fontFamily}', 'sans-serif'],
      },
      borderRadius: {
        brand: '${config.borderRadius}px',
      },
    },
  },
};`;

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(''), 2000); });
  };

  const downloadCSS = () => {
    const blob = new Blob([generateCSS()], { type: 'text/css' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'brand.css'; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAll = () => {
    const content = `/* ===== ${config.appName} Brand Config ===== */\n\n${generateCSS()}\n\n/* ===== Meta Tags ===== */\n/*\n${generateMetaTags()}\n*/\n\n/* ===== Tailwind Config ===== */\n/*\n${generateTailwindConfig()}\n*/`;
    const blob = new Blob([content], { type: 'text/css' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${config.appName.toLowerCase().replace(/\s+/g, '-')}-brand.css`; a.click();
    URL.revokeObjectURL(url);
  };

  const css = generateCSS();
  const metaTags = generateMetaTags();
  const tailwindCfg = generateTailwindConfig();

  const tabs = [
    { key: 'identity', label: '🏷️ Identity' },
    { key: 'colors', label: '🎨 Colors' },
    { key: 'typography', label: '✏️ Typography' },
    { key: 'meta', label: '🌐 SEO / Meta' },
    { key: 'export', label: '📦 Export' },
  ] as const;

  return (
    <div className="h-full flex flex-col bg-surface text-ink overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-line bg-card">
        <div className="w-10 h-10 bg-pink-600/20 rounded-xl flex items-center justify-center">
          <Paintbrush className="w-5 h-5 text-accent-text" />
        </div>
        <div>
          {/* Honest name (admin autopsy 2026-07-21): this generates a brand kit (CSS variables, meta
              tags, Tailwind config) to EXPORT and paste into your app — it does not auto-apply to the
              built app. Renamed so it no longer implies one-click white-labeling. */}
          <h2 className="font-semibold text-ink text-base">Brand Kit Generator</h2>
          <p className="text-xs text-faint">Define name, logo, colors &amp; fonts → export a brand kit (CSS, meta tags, Tailwind config) to drop into your app</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={resetToDefault} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-surface border border-line rounded-lg text-faint hover:text-ink transition-all">
            <RefreshCw className="w-3.5 h-3.5" /> Reset
          </button>
          <button onClick={downloadAll} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-pink-600 hover:bg-pink-500 rounded-lg text-on-accent font-medium transition-all">
            <Download className="w-3.5 h-3.5" /> Export Brand Kit
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line bg-card overflow-x-auto">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 whitespace-nowrap transition-all ${activeTab === tab.key ? 'border-pink-500 text-accent-text' : 'border-transparent text-faint hover:text-muted'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Form */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* Identity Tab */}
          {activeTab === 'identity' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted mb-1.5 block">App Name</label>
                  <input className="w-full bg-card border border-line rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-pink-500/50" value={config.appName} onChange={e => update({ appName: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1.5 block">Tagline</label>
                  <input className="w-full bg-card border border-line rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-pink-500/50" value={config.tagline} onChange={e => update({ tagline: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted mb-1.5 block">Logo URL</label>
                <input className="w-full bg-card border border-line rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-pink-500/50" placeholder="https://yourapp.com/logo.png (SVG/PNG)" value={config.logoUrl} onChange={e => update({ logoUrl: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted mb-1.5 block">Favicon URL</label>
                <input className="w-full bg-card border border-line rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-pink-500/50" placeholder="https://yourapp.com/favicon.ico" value={config.faviconUrl} onChange={e => update({ faviconUrl: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted mb-1.5 block">Custom Domain</label>
                <input className="w-full bg-card border border-line rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-pink-500/50" placeholder="yourapp.com" value={config.customDomain} onChange={e => update({ customDomain: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted mb-1.5 block">Footer Text</label>
                <input className="w-full bg-card border border-line rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-pink-500/50" value={config.footerText} onChange={e => update({ footerText: e.target.value })} />
              </div>
            </div>
          )}

          {/* Colors Tab */}
          {activeTab === 'colors' && (
            <div className="space-y-5">
              {/* Presets */}
              <div>
                <p className="text-xs text-muted mb-3">Color Presets</p>
                <div className="grid grid-cols-3 gap-2">
                  {COLOR_PRESETS.map(preset => (
                    <button key={preset.name} onClick={() => applyPreset(preset)} className="flex items-center gap-2 p-2.5 rounded-xl border border-line bg-card hover:border-line transition-all group">
                      <div className="flex gap-0.5">
                        {[preset.primary, preset.secondary, preset.accent].map((c, i) => <div key={i} className="w-4 h-4 rounded-full" style={{ backgroundColor: c }} />)}
                      </div>
                      <span className="text-[10px] text-muted group-hover:text-body truncate">{preset.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Custom Colors */}
              <div className="space-y-3">
                {[
                  { key: 'primaryColor', label: 'Primary Color (buttons, links)', val: config.primaryColor },
                  { key: 'secondaryColor', label: 'Secondary Color (success, accents)', val: config.secondaryColor },
                  { key: 'accentColor', label: 'Accent Color (highlights)', val: config.accentColor },
                  { key: 'bgColor', label: 'Background Color', val: config.bgColor },
                  { key: 'textColor', label: 'Text Color', val: config.textColor },
                ].map(item => (
                  <div key={item.key} className="flex items-center gap-3 bg-card p-3 rounded-xl border border-line">
                    <input type="color" value={item.val} onChange={e => update({ [item.key]: e.target.value } as any)} className="w-10 h-10 rounded-xl border-0 cursor-pointer bg-transparent" />
                    <div className="flex-1">
                      <p className="text-xs text-body">{item.label}</p>
                      <p className="text-[10px] text-faint font-mono">{item.val}</p>
                    </div>
                    <input className="bg-surface border border-line rounded-lg px-2 py-1.5 text-xs text-ink font-mono w-24 focus:outline-none" value={item.val} onChange={e => update({ [item.key]: e.target.value } as any)} />
                  </div>
                ))}
              </div>
              {/* Border radius */}
              <div>
                <p className="text-xs text-muted mb-2">Border Radius</p>
                <div className="flex gap-2">
                  {BORDER_RADIUS_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => update({ borderRadius: opt.value })} className={`flex-1 py-2 text-[10px] rounded-xl border transition-all ${config.borderRadius === opt.value ? 'border-pink-500/50 bg-pink-500/10 text-accent-text' : 'border-line text-faint hover:border-line'}`} style={{ borderRadius: opt.value === '999' ? '999px' : `${opt.value}px` }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Typography Tab */}
          {activeTab === 'typography' && (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted mb-3">Font Family</p>
                <div className="grid grid-cols-3 gap-2">
                  {FONT_OPTIONS.map(font => (
                    <button key={font} onClick={() => update({ fontFamily: font })} className={`py-3 px-3 rounded-xl border text-xs transition-all text-center ${config.fontFamily === font ? 'border-pink-500/50 bg-pink-500/10 text-accent-text' : 'border-line bg-card text-muted hover:border-line'}`} style={{ fontFamily: font }}>
                      {font}
                    </button>
                  ))}
                </div>
              </div>
              <div className="bg-card border border-line rounded-xl p-4">
                <p className="text-[10px] text-faint uppercase tracking-wider mb-3">Preview</p>
                <div style={{ fontFamily: config.fontFamily }}>
                  <h1 className="text-2xl font-bold mb-1" style={{ color: config.primaryColor }}>{config.appName}</h1>
                  <h2 className="text-base font-semibold mb-2 text-body">{config.tagline}</h2>
                  <p className="text-sm text-muted">This is your app description. See how the font looks — professional and clean design.</p>
                  <div className="flex gap-2 mt-3">
                    <button className="px-4 py-2 text-xs text-ink font-medium" style={{ backgroundColor: config.primaryColor, borderRadius: `${config.borderRadius}px` }}>Primary Button</button>
                    <button className="px-4 py-2 text-xs text-ink font-medium" style={{ backgroundColor: config.secondaryColor, borderRadius: `${config.borderRadius}px` }}>Secondary</button>
                  </div>
                </div>
              </div>
              <div className="bg-card p-3 rounded-xl border border-line">
                <p className="text-[10px] text-faint mb-2">Google Fonts CDN Link</p>
                <code className="text-[9px] text-success font-mono">{`<link href="https://fonts.googleapis.com/css2?family=${config.fontFamily.replace(' ', '+')}:wght@400;500;600;700&display=swap" rel="stylesheet">`}</code>
              </div>
            </div>
          )}

          {/* Meta Tab */}
          {activeTab === 'meta' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted mb-1.5 block">OG Title</label>
                <input className="w-full bg-card border border-line rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-pink-500/50" value={config.ogTitle} onChange={e => update({ ogTitle: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted mb-1.5 block">OG Description</label>
                <textarea className="w-full bg-card border border-line rounded-xl px-3 py-2 text-sm text-ink resize-none focus:outline-none focus:border-pink-500/50" rows={2} value={config.ogDescription} onChange={e => update({ ogDescription: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted mb-1.5 block">OG Image URL (1200×630)</label>
                <input className="w-full bg-card border border-line rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-pink-500/50" placeholder="https://yourapp.com/og-image.png" value={config.ogImageUrl} onChange={e => update({ ogImageUrl: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted mb-1.5 block">Twitter Handle</label>
                <input className="w-full bg-card border border-line rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-pink-500/50" placeholder="@yourhandle" value={config.twitterHandle} onChange={e => update({ twitterHandle: e.target.value })} />
              </div>

              {/* Preview meta card */}
              <div className="bg-card border border-line rounded-xl overflow-hidden">
                <div className="p-3 border-b border-line">
                  <p className="text-[10px] text-faint">Social Share Preview</p>
                </div>
                <div className="p-3 flex gap-3">
                  <div className="w-20 h-14 bg-raised rounded-lg flex items-center justify-center shrink-0">
                    {config.ogImageUrl ? <img src={config.ogImageUrl} alt="OG" className="w-full h-full object-cover rounded-lg" /> : <ImageIcon className="w-6 h-6 text-faint" />}
                  </div>
                  <div>
                    <p className="text-[9px] text-faint uppercase">{config.customDomain}</p>
                    <p className="text-xs font-semibold text-ink mt-0.5">{config.ogTitle}</p>
                    <p className="text-[10px] text-faint line-clamp-2 mt-0.5">{config.ogDescription}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Export Tab */}
          {activeTab === 'export' && (
            <div className="space-y-4">
              {[
                { title: 'CSS Variables', lang: 'css', content: css, filename: 'brand.css', key: 'css' },
                { title: 'HTML Meta Tags', lang: 'html', content: metaTags, filename: 'meta-tags.html', key: 'meta' },
                { title: 'Tailwind Config', lang: 'js', content: tailwindCfg, filename: 'tailwind.config.js', key: 'tw' },
              ].map(item => (
                <div key={item.key} className="bg-card border border-line rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-line">
                    <span className="text-[10px] text-muted">{item.title}</span>
                    <div className="flex gap-1.5">
                      <button onClick={() => copyText(item.content, item.key)} className={`text-[9px] flex items-center gap-1 px-2 py-0.5 rounded-lg transition-all ${copied === item.key ? 'text-success bg-emerald-500/10' : 'text-faint bg-raised'}`}>
                        {copied === item.key ? <><Check className="w-2.5 h-2.5" /> Copied</> : <><Copy className="w-2.5 h-2.5" /> Copy</>}
                      </button>
                      <button onClick={() => { const b = new Blob([item.content], { type: 'text/plain' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = item.filename; a.click(); URL.revokeObjectURL(u); }} className="text-[9px] flex items-center gap-1 px-2 py-0.5 rounded-lg text-faint bg-raised">
                        <Download className="w-2.5 h-2.5" /> Save
                      </button>
                    </div>
                  </div>
                  <pre className="p-3 text-[9px] font-mono text-success overflow-x-auto max-h-48 whitespace-pre">{item.content}</pre>
                </div>
              ))}
              <button onClick={downloadAll} className="w-full py-3 bg-pink-600 hover:bg-pink-500 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all text-on-accent">
                <Download className="w-4 h-4" /> Download Complete Brand Kit
              </button>
            </div>
          )}
        </div>

        {/* Right: Live Preview */}
        <div className="w-72 border-l border-line flex flex-col bg-card">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-line">
            <p className="text-[10px] text-faint uppercase tracking-wider">Live Preview</p>
            <div className="flex gap-1">
              <button onClick={() => setPreviewMode('desktop')} className={`p-1.5 rounded-lg transition-all ${previewMode === 'desktop' ? 'bg-pink-500/20 text-accent-text' : 'text-faint hover:text-muted'}`}><Monitor className="w-3.5 h-3.5" /></button>
              <button onClick={() => setPreviewMode('mobile')} className={`p-1.5 rounded-lg transition-all ${previewMode === 'mobile' ? 'bg-pink-500/20 text-accent-text' : 'text-faint hover:text-muted'}`}><Smartphone className="w-3.5 h-3.5" /></button>
              <button onClick={() => setDarkPreview(!darkPreview)} className="p-1.5 rounded-lg text-faint hover:text-muted transition-all">
                {darkPreview ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div className="flex-1 p-3 overflow-auto flex items-start justify-center">
            <div
              className={`rounded-2xl overflow-hidden border border-line shadow-2xl transition-all ${previewMode === 'mobile' ? 'w-44' : 'w-full'}`}
              style={{ backgroundColor: darkPreview ? config.bgColor : '#ffffff', fontFamily: config.fontFamily }}
            >
              {/* Mock Browser Bar */}
              <div className="flex items-center gap-1.5 px-3 py-2 bg-well">
                <div className="w-2 h-2 rounded-full bg-red-500 text-on-accent" />
                <div className="w-2 h-2 rounded-full bg-amber-500 text-on-accent" />
                <div className="w-2 h-2 rounded-full bg-emerald-500 text-on-accent" />
                {/* The mock browser sits on the USER's chosen background, so its address text follows THEIR text colour, not our theme. */}
                <div className="flex-1 mx-2 bg-well rounded px-2 py-0.5 text-[7px]" style={{ color: darkPreview ? config.textColor : '#000', opacity: 0.6 }}>{config.customDomain}</div>
              </div>
              {/* Mock App */}
              <div className="p-4">
                {/* Nav */}
                <div className="flex items-center justify-between mb-4 pb-2 border-b" style={{ borderColor: darkPreview ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
                  <div className="flex items-center gap-2">
                    {config.logoUrl ? <img src={config.logoUrl} alt="Logo" className="w-5 h-5 rounded" /> : <div className="w-5 h-5 rounded" style={{ backgroundColor: config.primaryColor }} />}
                    <span className="text-[10px] font-bold" style={{ color: darkPreview ? config.textColor : '#000' }}>{config.appName}</span>
                  </div>
                  <button className="text-[8px] px-2 py-0.5 text-ink font-medium" style={{ backgroundColor: config.primaryColor, borderRadius: `${Math.min(Number(config.borderRadius), 8)}px` }}>Login</button>
                </div>
                {/* Hero */}
                <div className="mb-3">
                  <h1 className="text-sm font-bold mb-1" style={{ color: darkPreview ? config.textColor : '#000' }}>{config.tagline}</h1>
                  <p className="text-[9px] mb-2" style={{ color: darkPreview ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' }}>Some more description text will go here</p>
                  <button className="text-[9px] px-3 py-1.5 text-ink font-medium" style={{ backgroundColor: config.primaryColor, borderRadius: `${config.borderRadius}px` }}>Get Started</button>
                </div>
                {/* Cards */}
                <div className="grid grid-cols-2 gap-1.5">
                  {[config.primaryColor, config.secondaryColor].map((c, i) => (
                    <div key={i} className="p-2 rounded-lg" style={{ backgroundColor: c + '20', borderRadius: `${Math.min(Number(config.borderRadius), 8)}px` }}>
                      <div className="w-4 h-4 rounded mb-1" style={{ backgroundColor: c }} />
                      <p className="text-[8px] font-medium" style={{ color: c }}>Feature {i + 1}</p>
                    </div>
                  ))}
                </div>
                {/* Footer */}
                <div className="mt-3 pt-2 border-t text-center" style={{ borderColor: darkPreview ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
                  <p className="text-[7px]" style={{ color: darkPreview ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)' }}>{config.footerText}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
