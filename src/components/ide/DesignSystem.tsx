import React, { useState, useEffect } from 'react';
import { LayoutTemplate, Layers, Palette, Type, Copy, Check, Plus, Trash2, Download, Eye, Code, Sparkles, RefreshCw, Sliders } from 'lucide-react';

interface ColorToken {
  name: string;
  value: string;
  description: string;
}

interface SpacingToken {
  name: string;
  value: number;
  unit: string;
}

interface TypographyToken {
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
}

interface DesignTokens {
  colors: ColorToken[];
  spacing: SpacingToken[];
  typography: TypographyToken[];
  borderRadius: { name: string; value: string }[];
  shadows: { name: string; value: string }[];
}

const DEFAULT_TOKENS: DesignTokens = {
  colors: [
    { name: 'primary', value: '#6366f1', description: 'Primary brand color' },
    { name: 'primary-dark', value: '#4f46e5', description: 'Dark primary' },
    { name: 'primary-light', value: '#a5b4fc', description: 'Light primary' },
    { name: 'secondary', value: '#10b981', description: 'Secondary / success' },
    { name: 'warning', value: '#f59e0b', description: 'Warning color' },
    { name: 'error', value: '#ef4444', description: 'Error / danger' },
    { name: 'bg', value: '#0f172a', description: 'App background' },
    { name: 'surface', value: '#1e293b', description: 'Card surface' },
    { name: 'border', value: '#334155', description: 'Border color' },
    { name: 'text', value: '#e2e8f0', description: 'Primary text' },
    { name: 'text-muted', value: '#94a3b8', description: 'Muted text' },
    { name: 'text-subtle', value: '#64748b', description: 'Subtle text' },
  ],
  spacing: [
    { name: 'xs', value: 4, unit: 'px' },
    { name: 'sm', value: 8, unit: 'px' },
    { name: 'md', value: 16, unit: 'px' },
    { name: 'lg', value: 24, unit: 'px' },
    { name: 'xl', value: 32, unit: 'px' },
    { name: '2xl', value: 48, unit: 'px' },
    { name: '3xl', value: 64, unit: 'px' },
  ],
  typography: [
    { name: 'display', fontFamily: 'Inter', fontSize: 48, fontWeight: 700, lineHeight: 1.2 },
    { name: 'h1', fontFamily: 'Inter', fontSize: 32, fontWeight: 700, lineHeight: 1.3 },
    { name: 'h2', fontFamily: 'Inter', fontSize: 24, fontWeight: 600, lineHeight: 1.4 },
    { name: 'h3', fontFamily: 'Inter', fontSize: 20, fontWeight: 600, lineHeight: 1.4 },
    { name: 'body', fontFamily: 'Inter', fontSize: 16, fontWeight: 400, lineHeight: 1.6 },
    { name: 'small', fontFamily: 'Inter', fontSize: 14, fontWeight: 400, lineHeight: 1.5 },
    { name: 'caption', fontFamily: 'Inter', fontSize: 12, fontWeight: 400, lineHeight: 1.4 },
    { name: 'code', fontFamily: 'JetBrains Mono', fontSize: 14, fontWeight: 400, lineHeight: 1.6 },
  ],
  borderRadius: [
    { name: 'none', value: '0px' },
    { name: 'sm', value: '4px' },
    { name: 'md', value: '8px' },
    { name: 'lg', value: '12px' },
    { name: 'xl', value: '16px' },
    { name: 'full', value: '9999px' },
  ],
  shadows: [
    { name: 'sm', value: '0 1px 2px 0 rgba(0,0,0,0.3)' },
    { name: 'md', value: '0 4px 6px -1px rgba(0,0,0,0.4)' },
    { name: 'lg', value: '0 10px 15px -3px rgba(0,0,0,0.5)' },
    { name: 'xl', value: '0 20px 25px -5px rgba(0,0,0,0.5), 0 8px 10px -6px rgba(0,0,0,0.4)' },
    { name: 'glow', value: '0 0 20px rgba(99,102,241,0.4)' },
  ],
};

const COMPONENT_PREVIEWS = [
  {
    name: 'Button',
    code: `<button className="btn-primary">Click Me</button>`,
    preview: (primary: string) => (
      <button style={{ background: primary, color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Click Me</button>
    ),
  },
  {
    name: 'Card',
    code: `<div className="card"><h3>Card Title</h3><p>Card content here.</p></div>`,
    preview: (_: string) => (
      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '16px', width: 180 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Card Title</div>
        <div style={{ color: '#94a3b8', fontSize: 12 }}>Card content here.</div>
      </div>
    ),
  },
  {
    name: 'Badge',
    code: `<span className="badge badge-success">Active</span>`,
    preview: (primary: string) => (
      <span style={{ background: `${primary}20`, color: primary, border: `1px solid ${primary}40`, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500 }}>Active</span>
    ),
  },
  {
    name: 'Input',
    code: `<input type="text" className="input" placeholder="Type here..." />`,
    preview: (_: string) => (
      <input type="text" placeholder="Type here..." style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '8px 12px', fontSize: 13, outline: 'none', width: 180 }} />
    ),
  },
];

interface DesignSystemProps {
  onCodeUpdate?: (html: string) => void;
  generatedCode?: string;
}

export function DesignSystem({ onCodeUpdate, generatedCode }: DesignSystemProps = {}) {
  const [tokens, setTokens] = useState<DesignTokens>(() => {
    try { return JSON.parse(localStorage.getItem('navbharat_design_tokens') || JSON.stringify(DEFAULT_TOKENS)); } catch { return DEFAULT_TOKENS; }
  });
  const [activeTab, setActiveTab] = useState<'colors' | 'typography' | 'spacing' | 'components' | 'export'>('colors');
  const [copied, setCopied] = useState<string | null>(null);
  const [editingColor, setEditingColor] = useState<number | null>(null);
  const [previewMode, setPreviewMode] = useState<'preview' | 'code'>('preview');

  useEffect(() => {
    localStorage.setItem('navbharat_design_tokens', JSON.stringify(tokens));
  }, [tokens]);

  const primaryColor = tokens.colors.find(c => c.name === 'primary')?.value || '#6366f1';

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const generateCSS = () => {
    const lines = [':root {'];
    tokens.colors.forEach(c => lines.push(`  --color-${c.name}: ${c.value};`));
    tokens.spacing.forEach(s => lines.push(`  --spacing-${s.name}: ${s.value}${s.unit};`));
    tokens.borderRadius.forEach(r => lines.push(`  --radius-${r.name}: ${r.value};`));
    tokens.shadows.forEach(s => lines.push(`  --shadow-${s.name}: ${s.value};`));
    lines.push('}');
    tokens.typography.forEach(t => {
      lines.push('');
      lines.push(`.text-${t.name} {`);
      lines.push(`  font-family: '${t.fontFamily}', sans-serif;`);
      lines.push(`  font-size: ${t.fontSize}px;`);
      lines.push(`  font-weight: ${t.fontWeight};`);
      lines.push(`  line-height: ${t.lineHeight};`);
      lines.push('}');
    });
    return lines.join('\n');
  };

  const containerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a', color: '#e2e8f0', fontFamily: 'sans-serif' };
  const cardStyle: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '12px' };
  const monoStyle: React.CSSProperties = { fontFamily: 'JetBrains Mono, monospace', fontSize: 11 };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LayoutTemplate size={20} color="#a855f7" />
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#f1f5f9' }}>Design System</div>
            <div style={{ color: '#64748b', fontSize: 11 }}>Tokens, components & style guide</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['colors', 'typography', 'spacing', 'components', 'export'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500, background: activeTab === t ? '#a855f7' : '#334155', color: activeTab === t ? '#fff' : '#94a3b8' }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>

        {/* Colors */}
        {activeTab === 'colors' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
              {tokens.colors.map((color, idx) => (
                <div key={idx} style={{ ...cardStyle, cursor: 'pointer' }} onClick={() => setEditingColor(editingColor === idx ? null : idx)}>
                  <div style={{ height: 48, borderRadius: 6, marginBottom: 8, background: color.value, border: '1px solid rgba(255,255,255,0.1)', position: 'relative' }}>
                    {editingColor === idx && (
                      <input type="color" value={color.value} onChange={e => setTokens(prev => ({ ...prev, colors: prev.colors.map((c, i) => i === idx ? { ...c, value: e.target.value } : c) }))} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                    )}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: '#e2e8f0' }}>--color-{color.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                    <span style={{ ...monoStyle, color: '#64748b' }}>{color.value}</span>
                    <button onClick={e => { e.stopPropagation(); copyText(color.value, color.name); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 0 }}>
                      {copied === color.name ? <Check size={10} color="#4ade80" /> : <Copy size={10} />}
                    </button>
                  </div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{color.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Typography */}
        {activeTab === 'typography' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tokens.typography.map((t, idx) => (
              <div key={idx} style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: t.fontFamily, fontSize: Math.min(t.fontSize, 32), fontWeight: t.fontWeight, lineHeight: t.lineHeight, color: '#e2e8f0' }}>
                    {t.name.charAt(0).toUpperCase() + t.name.slice(1)} — NavBharatAI
                  </div>
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <div style={{ ...monoStyle, color: '#94a3b8' }}>{t.fontFamily} · {t.fontSize}px · {t.fontWeight}</div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>line-height: {t.lineHeight}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Spacing */}
        {activeTab === 'spacing' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tokens.spacing.map((s, idx) => (
              <div key={idx} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ background: primaryColor, height: s.value, width: s.value * 2, borderRadius: 2, flexShrink: 0, minWidth: s.value * 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>--spacing-{s.name}</div>
                  <div style={{ ...monoStyle, color: '#64748b' }}>{s.value}{s.unit}</div>
                </div>
                <button onClick={() => copyText(`var(--spacing-${s.name})`, `spacing-${s.name}`)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                  {copied === `spacing-${s.name}` ? <Check size={12} color="#4ade80" /> : <Copy size={12} />}
                </button>
              </div>
            ))}
            <div style={{ ...cardStyle }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Border Radius</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {tokens.borderRadius.map(r => (
                  <div key={r.name} style={{ textAlign: 'center' }}>
                    <div style={{ width: 40, height: 40, background: primaryColor, borderRadius: r.value, margin: '0 auto 6px' }} />
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>{r.name}</div>
                    <div style={{ ...monoStyle, color: '#64748b', fontSize: 10 }}>{r.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Components */}
        {activeTab === 'components' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              {(['preview', 'code'] as const).map(m => (
                <button key={m} onClick={() => setPreviewMode(m)} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, background: previewMode === m ? '#334155' : 'transparent', color: previewMode === m ? '#e2e8f0' : '#64748b' }}>
                  {m === 'preview' ? <><Eye size={11} style={{ display: 'inline', marginRight: 4 }} />Preview</> : <><Code size={11} style={{ display: 'inline', marginRight: 4 }} />Code</>}
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {COMPONENT_PREVIEWS.map(comp => (
                <div key={comp.name} style={{ ...cardStyle }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: '#94a3b8' }}>{comp.name}</div>
                  <div style={{ background: '#0f172a', borderRadius: 6, padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 80, marginBottom: 8 }}>
                    {previewMode === 'preview' ? comp.preview(primaryColor) : (
                      <pre style={{ ...monoStyle, color: '#a5f3fc', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{comp.code}</pre>
                    )}
                  </div>
                  <button onClick={() => copyText(comp.code, comp.name)} style={{ width: '100%', padding: '5px', borderRadius: 4, border: '1px solid #334155', background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    {copied === comp.name ? <><Check size={10} color="#4ade80" />Copied!</> : <><Copy size={10} />Copy Code</>}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Export */}
        {activeTab === 'export' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ ...cardStyle }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Download size={14} color="#a855f7" /> CSS Variables
              </div>
              <pre style={{ ...monoStyle, background: '#0f172a', borderRadius: 6, padding: '12px', color: '#a5f3fc', overflow: 'auto', maxHeight: 300, margin: 0 }}>
                {generateCSS()}
              </pre>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button onClick={() => copyText(generateCSS(), 'css')} style={{ padding: '8px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#a855f7', color: '#fff', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {copied === 'css' ? <><Check size={12} />Copied!</> : <><Copy size={12} />Copy CSS</>}
                </button>
                {onCodeUpdate && (
                  <button
                    onClick={() => {
                      const css = generateCSS();
                      const styleTag = `<style id="nb-design-tokens">\n${css}\n</style>`;
                      let newHtml = generatedCode || '';
                      if (newHtml.includes('<style id="nb-design-tokens">')) {
                        newHtml = newHtml.replace(/<style id="nb-design-tokens">[\s\S]*?<\/style>/, styleTag);
                      } else if (newHtml.includes('</head>')) {
                        newHtml = newHtml.replace('</head>', `${styleTag}\n</head>`);
                      } else {
                        newHtml = styleTag + '\n' + newHtml;
                      }
                      onCodeUpdate!(newHtml);
                    }}
                    style={{ padding: '8px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#7c3aed', color: '#fff', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Download size={12} /> Inject CSS Tokens into App
                  </button>
                )}
              </div>
            </div>
            <div style={{ ...cardStyle }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Tailwind Config</div>
              <pre style={{ ...monoStyle, background: '#0f172a', borderRadius: 6, padding: '12px', color: '#a5f3fc', overflow: 'auto', maxHeight: 200, margin: 0 }}>{`// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
${tokens.colors.map(c => `        '${c.name}': '${c.value}',`).join('\n')}
      },
    },
  },
}`}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
