import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Moon, Sun, Copy, Download, Check, ChevronDown, ChevronUp,
  Zap, Sliders, RefreshCw, Code2, Layers, PaintBucket, Loader2, Save, History, AlertTriangle
} from 'lucide-react';
import { resolveAppSource, hasAnalysableApp } from '../../lib/workspaceSource';
import { injectStyleBlock, injectScriptBlock, canCarryStylesheet } from '../../lib/cssInjection';
import { AppTargetPicker, useUserApps, useAppFiles, readAppFile, saveFilesToApp } from './AppTargetPicker';

/** Ids that fence this tool's own blocks, so a re-run replaces them instead of stacking copies. */
const DARK_CSS_MARKER = 'nb-darkmode';
const DARK_TOGGLE_MARKER = 'nb-darkmode-toggle';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ColorMapping {
  original: string;
  dark: string;
  usage: string;
  override?: string;
}

type Strategy = 'css-vars' | 'class-toggle' | 'color-scheme' | 'manual';
type ViewMode = 'light' | 'both' | 'dark';

interface PresetTheme {
  name: string;
  bg: string;
  bgSecondary: string;
  text: string;
  textSecondary: string;
  accent: string;
  border: string;
}

export interface DarkModeGeneratorProps {
  generatedCode?: string;
  /** The v5-synced workspace files — the real app source when the preview isn't bundled. */
  files?: Record<string, string>;
  onCodeUpdate?: (code: string) => void;
  /** The app the user is currently working on, pre-selected in the picker. */
  sessionId?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESET_THEMES: PresetTheme[] = [
  // ⚠️ PRESET DATA, NOT OUR UI — the user applies these palettes to THEIR app, so every value must
  // stay a real colour. Not touched by the 2026-08-16 theme sweep, and must never be.
  { name: 'GitHub Dark',    bg: '#0d1117', bgSecondary: '#161b22', text: '#e6edf3', textSecondary: '#8b949e', accent: '#58a6ff', border: 'rgba(255,255,255,0.1)' },
  { name: 'Dracula',        bg: '#282a36', bgSecondary: '#44475a', text: '#f8f8f2', textSecondary: '#6272a4', accent: '#bd93f9', border: 'rgba(189,147,249,0.2)' },
  { name: 'Nord',           bg: '#2e3440', bgSecondary: '#3b4252', text: '#eceff4', textSecondary: '#9099ab', accent: '#88c0d0', border: 'rgba(136,192,208,0.2)' },
  { name: 'Solarized Dark', bg: '#002b36', bgSecondary: '#073642', text: '#fdf6e3', textSecondary: '#93a1a1', accent: '#268bd2', border: 'rgba(38,139,210,0.25)' },
  { name: 'Monokai',        bg: '#272822', bgSecondary: '#3e3d32', text: '#f8f8f2', textSecondary: '#75715e', accent: '#f92672', border: 'rgba(249,38,114,0.2)' },
];

const DEFAULT_THEME = PRESET_THEMES[0];

// ─── Color Utilities ──────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean;
  if (full.length !== 6) return null;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function getLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isNeutral(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min < 30;
}

function toDarkColor(hex: string, theme: PresetTheme = DEFAULT_THEME): string {
  const lum = getLuminance(hex);
  if (!isNeutral(hex)) {
    // Keep accent colors, just brighten slightly for dark bg
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const factor = lum < 0.3 ? 1.4 : 0.9;
    const r = Math.min(255, Math.round(rgb.r * factor));
    const g = Math.min(255, Math.round(rgb.g * factor));
    const b = Math.min(255, Math.round(rgb.b * factor));
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  if (lum > 0.8) return theme.bg;           // near-white → dark bg
  if (lum > 0.5) return theme.bgSecondary;  // light gray → card bg
  if (lum > 0.2) return theme.textSecondary; // mid gray → secondary text
  return theme.text;                         // near-black → light text
}

function detectColors(html: string, theme: PresetTheme = DEFAULT_THEME): ColorMapping[] {
  const hexRegex = /#([0-9a-fA-F]{3,6})\b/g;
  const bgRegex = /background(?:-color)?\s*:\s*([^;}"'\n]+)/gi;
  const textRegex = /(?<![a-z-])color\s*:\s*([^;}"'\n]+)/gi;

  const colorUsage = new Map<string, string>();

  let m: RegExpExecArray | null;
  while ((m = bgRegex.exec(html)) !== null) {
    const val = m[1].trim();
    const hx = val.match(/#([0-9a-fA-F]{3,6})/);
    if (hx) colorUsage.set(hx[0].toLowerCase(), 'Background');
  }
  while ((m = textRegex.exec(html)) !== null) {
    const val = m[1].trim();
    const hx = val.match(/#([0-9a-fA-F]{3,6})/);
    if (hx && !colorUsage.has(hx[0].toLowerCase())) {
      colorUsage.set(hx[0].toLowerCase(), 'Text');
    }
  }
  while ((m = hexRegex.exec(html)) !== null) {
    const c = m[0].toLowerCase();
    if (!colorUsage.has(c)) colorUsage.set(c, isNeutral(c) ? 'Neutral' : 'Accent');
  }

  const mappings: ColorMapping[] = [];
  const seen = new Set<string>();
  for (const [orig, usage] of colorUsage) {
    if (seen.has(orig) || orig.length < 4) continue;
    seen.add(orig);
    mappings.push({ original: orig, dark: toDarkColor(orig, theme), usage });
  }
  return mappings.slice(0, 12);
}

function buildDarkCSS(mappings: ColorMapping[], strategy: Strategy, theme: PresetTheme): string {
  const vars = `  --bg-primary: ${theme.bg};
  --bg-secondary: ${theme.bgSecondary};
  --text-primary: ${theme.text};
  --text-secondary: ${theme.textSecondary};
  --accent: ${theme.accent};
  --border: ${theme.border};`;

  const colorOverrides = mappings.map(m =>
    `  /* ${m.usage} */ body { --orig-${m.original.replace('#', '')}: ${m.override ?? m.dark}; }`
  ).join('\n');

  if (strategy === 'css-vars') {
    return `/* Dark Mode — Auto-generated by NavBharatAI */
@media (prefers-color-scheme: dark) {
  :root {
${vars}
  }
  body {
    background: var(--bg-primary);
    color: var(--text-primary);
  }
  a { color: var(--accent); }
  input, textarea, select {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border-color: var(--border);
  }
  button {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }
${mappings.map(m => `  /* ${m.usage}: ${m.original} */`).join('\n')}
}`;
  }

  if (strategy === 'class-toggle') {
    return `/* Dark Mode (class toggle) — Auto-generated by NavBharatAI */
html.dark {
  --bg-primary: ${theme.bg};
  --bg-secondary: ${theme.bgSecondary};
  --text-primary: ${theme.text};
  --text-secondary: ${theme.textSecondary};
  --accent: ${theme.accent};
  --border: ${theme.border};
}
html.dark body {
  background: var(--bg-primary);
  color: var(--text-primary);
}
html.dark a { color: var(--accent); }
html.dark input, html.dark textarea, html.dark select {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-color: var(--border);
}`;
  }

  if (strategy === 'color-scheme') {
    return `/* Dark Mode (color-scheme) — Auto-generated by NavBharatAI */
:root { color-scheme: light dark; }
@media (prefers-color-scheme: dark) {
  body { background: ${theme.bg}; color: ${theme.text}; }
}`;
  }

  // manual
  return `/* Dark Mode (manual overrides) — Auto-generated by NavBharatAI */
@media (prefers-color-scheme: dark) {
${mappings.map(m => `  /* ${m.usage} */\n  [style*="${m.original}"] { color: ${m.override ?? m.dark} !important; background-color: ${m.override ?? m.dark} !important; }`).join('\n')}
}`;
}

/**
 * Put the generated dark stylesheet (and, for the toggle strategy, its button) into a page.
 *
 * ROOT-CAUSE REWRITE (admin 2026-07-27), because this result is now SAVED into the user's real file
 * rather than thrown at a preview. The previous version had three defects that only a preview could
 * hide:
 *   • it merged the generated CSS into the FIRST `</style>` it found — which is normally the user's
 *     OWN stylesheet, mixing generated rules into hand-written ones with no way to separate them again;
 *   • it appended the toggle `<script>` AFTER `</html>`, outside the document entirely;
 *   • it did all of that again on every press, so re-generating stacked duplicate CSS and a new
 *     floating button each time.
 * Both blocks are now fenced with their own ids, so a re-run REPLACES them and switching the strategy
 * away from the toggle actually removes the button instead of orphaning it.
 */
function injectDarkCSS(html: string, css: string, strategy: Strategy, theme: PresetTheme, filePath = 'index.html'): string {
  const toggleScript = strategy === 'class-toggle'
    ? `(function(){
  var btn = document.createElement('button');
  btn.textContent = '🌙 Toggle Dark';
  btn.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9999;padding:8px 14px;background:${theme.bgSecondary};color:${theme.text};border:1px solid ${theme.border};border-radius:8px;cursor:pointer;font-size:14px;';
  btn.onclick = function(){ document.documentElement.classList.toggle('dark'); };
  document.body.appendChild(btn);
})();`
    : '';

  const styled = injectStyleBlock(filePath, html, css, DARK_CSS_MARKER);
  const withCss = styled.ok ? styled.code : html;
  // A CSS target cannot carry the button; the stylesheet alone is the whole change there.
  if (!/\.html?$/i.test(filePath)) return withCss;
  const scripted = injectScriptBlock(filePath, withCss, toggleScript, DARK_TOGGLE_MARKER);
  return scripted.ok ? scripted.code : withCss;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const ColorSwatch: React.FC<{ color: string; size?: number }> = ({ color, size = 20 }) => (
  <span
    style={{ background: color, width: size, height: size, border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
  />
);

// ─── Main Component ───────────────────────────────────────────────────────────

export const DarkModeGenerator: React.FC<DarkModeGeneratorProps> = ({ generatedCode, files, onCodeUpdate, sessionId }) => {
  // Resolve the REAL app HTML (admin autopsy 2026-07-21): the transform is genuine but used to run on
  // the "Waiting for magic…" placeholder. Prefer the bundled preview / workspace index.html; treat the
  // placeholder as "no app" so the paste box + guidance appear instead.
  const resolved = resolveAppSource(generatedCode, files);
  const realApp = hasAnalysableApp(resolved);
  const [htmlInput, setHtmlInput] = useState(realApp ? resolved.html : '');
  const [darkHtml, setDarkHtml] = useState('');
  const [colorMappings, setColorMappings] = useState<ColorMapping[]>([]);
  const [strategy, setStrategy] = useState<Strategy>('css-vars');
  const [viewMode, setViewMode] = useState<ViewMode>('both');
  const [activeTheme, setActiveTheme] = useState<PresetTheme>(DEFAULT_THEME);
  const [generatedCSS, setGeneratedCSS] = useState('');
  const [showColorPanel, setShowColorPanel] = useState(true);
  const [showCSS, setShowCSS] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [syncScroll, setSyncScroll] = useState(false);

  // Saving into the user's REAL app (admin 2026-07-27). "Apply to app" used to call onCodeUpdate,
  // which only changed the on-screen preview — the dark mode was gone as soon as the tab closed.
  const { apps, loading: appsLoading, selected: targetSession, setSelected: setTargetSession } = useUserApps(sessionId);
  const { files: appFiles, loading: filesLoading, reload: reloadFiles } = useAppFiles(targetSession);
  const [targetPath, setTargetPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);

  // Default to the app's main page, which is what a user means by "my app" almost every time.
  useEffect(() => {
    if (targetPath && appFiles.some((f) => f.path === targetPath)) return;
    const carriers = appFiles.filter((f) => f.writable && canCarryStylesheet(f.path)).map((f) => f.path);
    setTargetPath(
      carriers.find((p) => /(^|\/)index\.html?$/i.test(p))
      || carriers.find((p) => /\.html?$/i.test(p))
      || carriers[0]
      || '',
    );
  }, [appFiles, targetPath]);

  const sourceHtml = realApp ? resolved.html : htmlInput;

  // Keep the manual-paste input in sync with the REAL app source (not the placeholder).
  useEffect(() => {
    if (realApp) setHtmlInput(resolved.html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realApp, resolved.html]);

  const runGenerate = useCallback((html: string, theme: PresetTheme, strat: Strategy) => {
    if (!html.trim()) return;
    const mappings = detectColors(html, theme);
    const css = buildDarkCSS(mappings, strat, theme);
    const injected = injectDarkCSS(html, css, strat, theme);
    setColorMappings(mappings);
    setGeneratedCSS(css);
    setDarkHtml(injected);
    setGenerated(true);
  }, []);

  const handleAutoGenerate = () => runGenerate(sourceHtml, activeTheme, strategy);

  const handleOverrideChange = (index: number, value: string) => {
    const updated = colorMappings.map((m, i) => i === index ? { ...m, override: value } : m);
    setColorMappings(updated);
    const css = buildDarkCSS(updated, strategy, activeTheme);
    const injected = injectDarkCSS(sourceHtml, css, strategy, activeTheme);
    setGeneratedCSS(css);
    setDarkHtml(injected);
  };

  const handlePreset = (theme: PresetTheme) => {
    setActiveTheme(theme);
    if (generated) runGenerate(sourceHtml, theme, strategy);
  };

  const handleStrategyChange = (s: Strategy) => {
    setStrategy(s);
    if (generated) runGenerate(sourceHtml, activeTheme, s);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generatedCSS);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([generatedCSS], { type: 'text/css' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'dark-mode.css'; a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Save the dark mode into the user's real app file.
   *
   * The file is re-read first and the blocks are merged into its CURRENT content, so this works on a
   * file that has changed since the tool loaded — and it never writes the preview's copy blindly.
   */
  const saveDarkModeToApp = useCallback(async () => {
    if (!targetSession || !targetPath || saving || !generated) return;
    setSaving(true);
    setSaveNote('');
    setSaveFailed(false);
    try {
      const current = await readAppFile(targetSession, targetPath);
      if (current === null) {
        setSaveFailed(true);
        setSaveNote('Could not open that file, so nothing was changed.');
        return;
      }
      const css = buildDarkCSS(colorMappings, strategy, activeTheme);
      const updated = injectDarkCSS(current, css, strategy, activeTheme, targetPath);
      const outcome = await saveFilesToApp(
        targetSession,
        { [targetPath]: updated },
        `Before adding dark mode to ${targetPath}`,
      );
      if (!outcome.ok) {
        setSaveFailed(true);
        setSaveNote(outcome.error || 'Could not save. Your app is unchanged.');
        return;
      }
      if (outcome.unchanged) {
        setSaveNote('Your app already has exactly this dark mode — nothing needed changing.');
        return;
      }
      setSaveNote(`Dark mode saved into ${targetPath}. ${outcome.undoHint || ''}`.trim());
      void reloadFiles(targetSession);
      if (onCodeUpdate && /\.html?$/i.test(targetPath)) onCodeUpdate(updated);
    } catch {
      setSaveFailed(true);
      setSaveNote('Could not reach the server. Your app is unchanged.');
    } finally {
      setSaving(false);
    }
  }, [targetSession, targetPath, saving, generated, colorMappings, strategy, activeTheme, onCodeUpdate, reloadFiles]);

  const iframeStyle: React.CSSProperties = {
    width: '100%',
    height: 360,
    border: 'none',
    borderRadius: 8,
    background: '#fff',
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: 'var(--surface-base)', minHeight: '100%', color: '#e6edf3', fontFamily: 'system-ui, sans-serif', padding: 20, boxSizing: 'border-box' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Moon size={22} color="#6366f1" />
          <span style={{ fontSize: 18, fontWeight: 700 }}>Dark Mode Generator</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setManualMode(m => !m)}
            style={{ padding: '6px 12px', background: manualMode ? '#6366f1' : 'var(--surface-raised)', color: '#e6edf3', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Sliders size={14} /> Manual Mode
          </button>
          <button
            onClick={handleAutoGenerate}
            style={{ padding: '7px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Moon size={14} /> Auto-Generate
          </button>
        </div>
      </div>

      {/* HTML Input — shown when there's no real app to read (so the placeholder never masquerades
          as input; the user can paste real HTML instead). */}
      {!realApp && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Paste HTML to convert</label>
          <textarea
            value={htmlInput}
            onChange={e => setHtmlInput(e.target.value)}
            placeholder="<html>...</html>"
            rows={5}
            style={{ width: '100%', background: 'var(--surface-card)', color: '#e6edf3', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }}
          />
        </div>
      )}

      {/* Preset Themes */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Preset Themes</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESET_THEMES.map(t => (
            <button
              key={t.name}
              onClick={() => handlePreset(t)}
              style={{ padding: '5px 12px', background: activeTheme.name === t.name ? '#6366f1' : 'var(--surface-card)', color: '#e6edf3', border: `1px solid ${activeTheme.name === t.name ? '#6366f1' : 'rgba(255,255,255,0.1)'}`, borderRadius: 20, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.accent, display: 'inline-block' }} />
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {/* Strategy Selection */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Dark Mode Strategy</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {([
            ['css-vars', 'CSS Variables', '(recommended)'],
            ['class-toggle', 'Class Toggle', '.dark class'],
            ['color-scheme', 'color-scheme', 'browser native'],
            ['manual', 'Manual Override', 'swap colors'],
          ] as [Strategy, string, string][]).map(([val, label, hint]) => (
            <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 12px', background: strategy === val ? 'rgba(99,102,241,0.15)' : 'var(--surface-card)', border: `1px solid ${strategy === val ? '#6366f1' : 'rgba(255,255,255,0.08)'}`, borderRadius: 6, fontSize: 13 }}>
              <input type="radio" name="strategy" value={val} checked={strategy === val} onChange={() => handleStrategyChange(val)} style={{ accentColor: '#6366f1' }} />
              <span style={{ fontWeight: strategy === val ? 600 : 400 }}>{label}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{hint}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Preview Section */}
      <div style={{ background: 'var(--surface-card)', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid rgba(255,255,255,0.08)' }}>
        {/* View Mode Toggle Bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', background: 'var(--surface-base)', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
            {(['light', 'both', 'dark'] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                style={{ padding: '6px 14px', background: viewMode === v ? '#6366f1' : 'transparent', color: viewMode === v ? '#fff' : 'var(--text-muted)', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: viewMode === v ? 600 : 400, display: 'flex', alignItems: 'center', gap: 5 }}
              >
                {v === 'light' && <Sun size={12} />}
                {v === 'both' && <Layers size={12} />}
                {v === 'dark' && <Moon size={12} />}
                {v === 'light' ? 'Light Only' : v === 'dark' ? 'Dark Only' : 'Before → After'}
              </button>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={syncScroll} onChange={e => setSyncScroll(e.target.checked)} style={{ accentColor: '#6366f1' }} />
            Sync scroll
          </label>
        </div>

        {/* Iframes */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {(viewMode === 'light' || viewMode === 'both') && (
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Sun size={13} color="#f59e0b" />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Light Mode</span>
              </div>
              <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                {sourceHtml ? (
                  <iframe srcDoc={sourceHtml} style={iframeStyle} title="Light preview" sandbox="allow-scripts" />
                ) : (
                  <div style={{ ...iframeStyle, background: '#1a1e2a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a5568', fontSize: 13 }}>
                    No HTML provided
                  </div>
                )}
              </div>
            </div>
          )}
          {(viewMode === 'dark' || viewMode === 'both') && (
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Moon size={13} color="#6366f1" />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Dark Mode</span>
              </div>
              <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(99,102,241,0.3)' }}>
                {darkHtml ? (
                  <iframe srcDoc={darkHtml} style={iframeStyle} title="Dark preview" sandbox="allow-scripts" />
                ) : (
                  <div style={{ ...iframeStyle, background: 'var(--surface-base)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#4a5568', fontSize: 13, gap: 8 }}>
                    <Moon size={28} color="#2d3148" />
                    <span>Click Auto-Generate to preview</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Color Mapping Panel */}
      {generated && (
        <div style={{ background: 'var(--surface-card)', borderRadius: 10, marginBottom: 16, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          <button
            onClick={() => setShowColorPanel(p => !p)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'none', border: 'none', color: '#e6edf3', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><PaintBucket size={15} color="#6366f1" /> Color Mappings</span>
            {showColorPanel ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          {showColorPanel && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    {['Original', 'Mapped Dark', 'Usage', 'Override'].map(h => (
                      <th key={h} style={{ padding: '8px 16px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'left', background: 'var(--surface-base)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {colorMappings.map((m, i) => (
                    <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '8px 16px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ColorSwatch color={m.original} />
                          <code style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.original}</code>
                        </div>
                      </td>
                      <td style={{ padding: '8px 16px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ColorSwatch color={m.override ?? m.dark} />
                          <code style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.override ?? m.dark}</code>
                        </div>
                      </td>
                      <td style={{ padding: '8px 16px', color: 'var(--text-muted)', fontSize: 12 }}>{m.usage}</td>
                      <td style={{ padding: '8px 16px' }}>
                        <input
                          type="color"
                          value={m.override ?? m.dark}
                          onChange={e => handleOverrideChange(i, e.target.value)}
                          style={{ width: 32, height: 28, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'none', padding: 0 }}
                          title="Override color"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Generated CSS */}
      {generated && (
        <div style={{ background: 'var(--surface-card)', borderRadius: 10, marginBottom: 16, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          <button
            onClick={() => setShowCSS(p => !p)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'none', border: 'none', color: '#e6edf3', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Code2 size={15} color="#6366f1" /> Generated CSS</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--surface-base)', padding: '2px 8px', borderRadius: 10 }}>{generatedCSS.split('\n').length} lines</span>
              {showCSS ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </div>
          </button>
          {showCSS && (
            <div>
              <div style={{ display: 'flex', gap: 8, padding: '0 16px 12px' }}>
                <button onClick={handleCopy} style={{ padding: '5px 12px', background: 'var(--surface-base)', color: '#e6edf3', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {copied ? <Check size={12} color="#22c55e" /> : <Copy size={12} />} {copied ? 'Copied!' : 'Copy'}
                </button>
                <button onClick={handleDownload} style={{ padding: '5px 12px', background: 'var(--surface-base)', color: '#e6edf3', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Download size={12} /> Download
                </button>
              </div>
              <pre style={{ margin: 0, padding: '0 16px 16px', fontSize: 12, color: 'var(--text-muted)', overflowX: 'auto', fontFamily: 'monospace', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                <code>{generatedCSS}</code>
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Save into the user's real app. This used to update only the on-screen preview, so the dark
          mode disappeared the moment the tab closed and the v5 builder never knew about it. */}
      {generated && (
        <div style={{ background: 'var(--surface-card)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '12px 12px 0', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Save size={14} color="#818cf8" /> Save this dark mode into your app
          </div>

          <AppTargetPicker
            apps={apps}
            appsLoading={appsLoading}
            files={appFiles}
            filesLoading={filesLoading}
            sessionId={targetSession}
            onSessionChange={(s) => { setTargetSession(s); setTargetPath(''); setSaveNote(''); }}
            selectedPath={targetPath}
            onPathChange={(p) => { setTargetPath(p); setSaveNote(''); }}
            fileFilter={(f) => canCarryStylesheet(f.path)}
            fileLabel="Add dark mode to"
          />

          {apps.length > 0 && (
            <div style={{ padding: '0 12px 12px' }}>
              <button
                onClick={() => void saveDarkModeToApp()}
                disabled={!targetSession || !targetPath || saving}
                style={{
                  width: '100%', padding: '13px 0',
                  background: 'linear-gradient(135deg, #6366f1, #818cf8)', color: '#fff', border: 'none',
                  borderRadius: 10, fontSize: 15, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  cursor: !targetSession || !targetPath || saving ? 'not-allowed' : 'pointer',
                  opacity: !targetSession || !targetPath || saving ? 0.4 : 1,
                }}
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                {saving ? 'Saving into your app…' : 'Save dark mode into my app'}
              </button>
              <p style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, display: 'flex', gap: 5 }}>
                <History size={11} style={{ marginTop: 2, flexShrink: 0 }} />
                A restore point is saved first, so you can undo this any time from Versioning.
                Running it again updates the same block rather than adding a second copy.
              </p>
              {saveNote && (
                <p style={{
                  marginTop: 8, fontSize: 12, lineHeight: 1.5, padding: '8px 10px', borderRadius: 8,
                  color: saveFailed ? '#fcd34d' : '#86efac',
                  background: saveFailed ? 'rgba(245,158,11,0.1)' : 'rgba(63,185,80,0.1)',
                  display: 'flex', gap: 6,
                }}>
                  {saveFailed && <AlertTriangle size={12} style={{ marginTop: 2, flexShrink: 0 }} />}
                  <span>{saveNote}</span>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {!generated && !sourceHtml && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: '#4a5568', fontSize: 13 }}>
          <Moon size={36} color="#21262d" style={{ marginBottom: 10, display: 'block', margin: '0 auto 10px' }} />
          Paste HTML above or provide <code>generatedCode</code> prop, then click Auto-Generate.
        </div>
      )}
    </div>
  );
};

export default DarkModeGenerator;
