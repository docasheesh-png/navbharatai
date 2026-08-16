import React, { useState, useEffect, useCallback } from 'react';
import {
  Gauge, Play, Clipboard, ChevronDown, ChevronUp,
  CheckCircle2, AlertTriangle, X, Lightbulb, Clock,
  BarChart2
} from 'lucide-react';
import { TirangaLoader } from '../ui/TirangaLoader';
import { resolveAppSource, hasAnalysableApp, appSourceGuidance } from '../../lib/workspaceSource';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Check {
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'info';
  detail?: string;
}

interface CategoryResult {
  score: number;
  checks: Check[];
}

interface AnalysisResult {
  performance: CategoryResult;
  accessibility: CategoryResult;
  seo: CategoryResult;
  bestPractices: CategoryResult;
  analyzedAt: number;
}

interface Recommendation {
  priority: 'high' | 'medium' | 'low';
  title: string;
  snippet: string;
}

interface HistoryEntry {
  performance: number;
  accessibility: number;
  seo: number;
  bestPractices: number;
  analyzedAt: number;
}

interface PerformanceAnalyzerProps {
  generatedCode?: string;
  /** The v5-synced workspace files — the real app source when the preview isn't bundled. */
  files?: Record<string, string>;
  /** The app's LIVE, publicly-reachable URL (the E2B preview or a deployed site). Enables REAL
   *  Lighthouse measurement — the static checks below are offline heuristics only. */
  liveUrl?: string;
}

// The real Lighthouse result from GET /api/analyze/pagespeed (the existing, tested PageSpeed proxy).
interface LiveResult {
  performance: number; accessibility: number; seo: number; bestPractices: number;
  lcp?: string; cls?: string; tbt?: string; fcp?: string; si?: string; tti?: string;
  strategy?: string; finalUrl?: string;
}
const VITAL_ORDER: Array<{ key: keyof LiveResult; label: string }> = [
  { key: 'lcp', label: 'Largest Contentful Paint (LCP)' },
  { key: 'cls', label: 'Cumulative Layout Shift (CLS)' },
  { key: 'tbt', label: 'Total Blocking Time (TBT)' },
  { key: 'fcp', label: 'First Contentful Paint (FCP)' },
  { key: 'si', label: 'Speed Index' },
  { key: 'tti', label: 'Time to Interactive (TTI)' },
];

// ─── Analysis Logic ───────────────────────────────────────────────────────────

function analyzeHTML(html: string): AnalysisResult {
  // Performance checks
  const hasDefer = /defer|async/.test(html);
  const hasLazyLoad = /loading="lazy"/.test(html);
  const scriptCount = (html.match(/<script/g) || []).length;
  const hasInlineStyles = (html.match(/style="/g) || []).length;
  const hasRenderBlocking = /<link[^>]+stylesheet[^>]*>/.test(html) && !/<link[^>]+media="print"/.test(html);

  const perfChecks: Check[] = [
    {
      label: hasDefer ? 'Scripts use defer/async' : 'Scripts missing defer/async',
      status: hasDefer ? 'pass' : 'fail',
      detail: !hasDefer && scriptCount > 0 ? `${scriptCount} script tag(s) block rendering` : undefined,
    },
    {
      label: hasLazyLoad ? 'Images use loading="lazy"' : 'Images missing lazy loading',
      status: hasLazyLoad ? 'pass' : 'warn',
    },
    {
      label: hasInlineStyles > 5 ? `${hasInlineStyles} inline styles found (performance hit)` : 'Inline styles minimal',
      status: hasInlineStyles > 5 ? 'warn' : 'pass',
    },
    {
      label: scriptCount > 5 ? `${scriptCount} scripts detected — consider bundling` : 'Script count acceptable',
      status: scriptCount > 5 ? 'warn' : 'pass',
    },
    {
      label: hasRenderBlocking ? 'Render-blocking CSS link detected' : 'No obvious render-blocking resources',
      status: hasRenderBlocking ? 'warn' : 'pass',
    },
  ];

  const perfScore = Math.max(
    0,
    100 -
      (!hasDefer && scriptCount > 0 ? 25 : 0) -
      (!hasLazyLoad ? 15 : 0) -
      (hasInlineStyles > 5 ? 10 : 0) -
      (scriptCount > 5 ? 15 : 0) -
      (hasRenderBlocking ? 10 : 0)
  );

  // Accessibility checks
  const imgWithoutAlt = (html.match(/<img(?![^>]*\balt=)[^>]*>/gi) || []).length;
  const hasAriaLabels = /aria-label/.test(html);
  const hasLangAttr = /html[^>]*\slang\s*=\s*/i.test(html);
  const hasFormLabels = !/<input/.test(html) || /<label/.test(html);
  const hasRoleAttr = /role=/.test(html);
  const hasSkipLink = /skip.*nav|skip.*main/i.test(html);

  const a11yChecks: Check[] = [
    {
      label: imgWithoutAlt === 0 ? 'All images have alt text' : `${imgWithoutAlt} image(s) missing alt text`,
      status: imgWithoutAlt === 0 ? 'pass' : 'fail',
    },
    {
      label: hasLangAttr ? 'HTML lang attribute present' : 'HTML lang attribute missing',
      status: hasLangAttr ? 'pass' : 'fail',
    },
    {
      label: hasAriaLabels ? 'ARIA labels found' : 'No ARIA labels detected',
      status: hasAriaLabels ? 'pass' : 'info',
    },
    {
      label: hasFormLabels ? 'Form inputs have labels' : 'Form inputs may lack labels',
      status: hasFormLabels ? 'pass' : 'warn',
    },
    {
      label: hasRoleAttr ? 'ARIA roles present' : 'Consider adding ARIA roles',
      status: hasRoleAttr ? 'pass' : 'info',
    },
    {
      label: hasSkipLink ? 'Skip navigation link found' : 'No skip-to-content link',
      status: hasSkipLink ? 'pass' : 'info',
    },
  ];

  const a11yScore = Math.max(
    0,
    100 -
      (imgWithoutAlt > 0 ? Math.min(imgWithoutAlt * 10, 30) : 0) -
      (!hasLangAttr ? 20 : 0) -
      (!hasFormLabels ? 15 : 0)
  );

  // SEO checks
  const hasTitle = /<title[^>]*>[^<]+<\/title>/i.test(html);
  const hasMeta = /<meta[^>]+name=["']description["'][^>]*>/i.test(html);
  const hasH1 = /<h1[\s>]/.test(html);
  const hasOG = /og:title/.test(html);
  const hasCanonical = /rel=["']canonical["']/.test(html);
  const hasViewport = /name=["']viewport["']/.test(html);
  const hasRobots = /name=["']robots["']/.test(html);

  const seoChecks: Check[] = [
    {
      label: hasTitle ? 'Title tag present' : 'Missing <title> tag',
      status: hasTitle ? 'pass' : 'fail',
    },
    {
      label: hasMeta ? 'Meta description found' : 'No meta description',
      status: hasMeta ? 'pass' : 'fail',
    },
    {
      label: hasH1 ? 'H1 heading present' : 'No H1 heading found',
      status: hasH1 ? 'pass' : 'warn',
    },
    {
      label: hasOG ? 'Open Graph tags present' : 'No Open Graph tags (og:title, og:image)',
      status: hasOG ? 'pass' : 'warn',
    },
    {
      label: hasCanonical ? 'Canonical URL found' : 'No canonical URL',
      status: hasCanonical ? 'pass' : 'info',
    },
    {
      label: hasViewport ? 'Viewport meta tag present' : 'Missing viewport meta tag',
      status: hasViewport ? 'pass' : 'fail',
    },
    {
      label: hasRobots ? 'Robots meta tag present' : 'No robots meta tag',
      status: hasRobots ? 'pass' : 'info',
    },
  ];

  const seoScore = Math.max(
    0,
    100 -
      (!hasTitle ? 30 : 0) -
      (!hasMeta ? 20 : 0) -
      (!hasViewport ? 20 : 0) -
      (!hasH1 ? 10 : 0) -
      (!hasOG ? 10 : 0)
  );

  // Best practices checks
  const hasConsoleLog = /console\.log/.test(html);
  const hasHttpLinks = /http:\/\/(?!localhost)/.test(html);
  const hasDeprecatedTags = /<(font|center|marquee|blink|frameset|frame)[^>]*>/i.test(html);
  const hasDoctype = /<!DOCTYPE\s+html>/i.test(html);
  const hasCharset = /charset/.test(html);
  const hasXSS = /javascript:/i.test(html) || /on\w+\s*=\s*["'][^"']*["']/i.test(html);

  const bpChecks: Check[] = [
    {
      label: hasDoctype ? 'DOCTYPE declaration present' : 'Missing DOCTYPE declaration',
      status: hasDoctype ? 'pass' : 'fail',
    },
    {
      label: hasCharset ? 'Charset meta tag present' : 'Missing charset declaration',
      status: hasCharset ? 'pass' : 'warn',
    },
    {
      label: !hasConsoleLog ? 'No console.log in production code' : 'console.log() calls found',
      status: !hasConsoleLog ? 'pass' : 'warn',
    },
    {
      label: !hasHttpLinks ? 'No insecure HTTP links' : 'Insecure HTTP links detected',
      status: !hasHttpLinks ? 'pass' : 'fail',
    },
    {
      label: !hasDeprecatedTags ? 'No deprecated HTML tags' : 'Deprecated HTML tags found',
      status: !hasDeprecatedTags ? 'pass' : 'fail',
    },
    {
      label: !hasXSS ? 'No obvious XSS vectors' : 'Potential inline event handlers detected',
      status: !hasXSS ? 'pass' : 'warn',
    },
  ];

  const bpScore = Math.max(
    0,
    100 -
      (!hasDoctype ? 20 : 0) -
      (!hasCharset ? 10 : 0) -
      (hasConsoleLog ? 10 : 0) -
      (hasHttpLinks ? 25 : 0) -
      (hasDeprecatedTags ? 20 : 0) -
      (hasXSS ? 20 : 0)
  );

  return {
    performance: { score: perfScore, checks: perfChecks },
    accessibility: { score: a11yScore, checks: a11yChecks },
    seo: { score: seoScore, checks: seoChecks },
    bestPractices: { score: bpScore, checks: bpChecks },
    analyzedAt: Date.now(),
  };
}

function buildRecommendations(result: AnalysisResult): Recommendation[] {
  const recs: Recommendation[] = [];
  const { performance: perf, accessibility: a11y, seo, bestPractices: bp } = result;

  const perfFails = perf.checks.filter((c) => c.status === 'fail' || c.status === 'warn');
  const a11yFails = a11y.checks.filter((c) => c.status === 'fail' || c.status === 'warn');
  const seoFails = seo.checks.filter((c) => c.status === 'fail' || c.status === 'warn');
  const bpFails = bp.checks.filter((c) => c.status === 'fail' || c.status === 'warn');

  if (a11yFails.some((c) => c.label.includes('lang')))
    recs.push({ priority: 'high', title: 'Add lang attribute to <html>', snippet: '<html lang="en">' });
  if (seoFails.some((c) => c.label.includes('title')))
    recs.push({ priority: 'high', title: 'Add <title> tag in <head>', snippet: '<title>My App</title>' });
  if (seoFails.some((c) => c.label.includes('meta description')))
    recs.push({ priority: 'high', title: 'Add meta description for SEO', snippet: '<meta name="description" content="App description here">' });
  if (seoFails.some((c) => c.label.includes('viewport')))
    recs.push({ priority: 'high', title: 'Add viewport meta for mobile', snippet: '<meta name="viewport" content="width=device-width, initial-scale=1">' });
  if (bpFails.some((c) => c.label.includes('HTTP links')))
    recs.push({ priority: 'high', title: 'Replace HTTP links with HTTPS', snippet: '<!-- Change http:// to https:// in all src/href -->' });
  if (perfFails.some((c) => c.label.includes('defer')))
    recs.push({ priority: 'medium', title: 'Add defer to script tags', snippet: '<script src="app.js" defer></script>' });
  if (perfFails.some((c) => c.label.includes('lazy')))
    recs.push({ priority: 'medium', title: 'Add lazy loading to images', snippet: '<img src="photo.jpg" alt="..." loading="lazy">' });
  if (a11yFails.some((c) => c.label.includes('alt')))
    recs.push({ priority: 'medium', title: 'Add alt text to all images', snippet: '<img src="..." alt="Descriptive text here">' });
  if (seoFails.some((c) => c.label.includes('H1')))
    recs.push({ priority: 'medium', title: 'Add a single H1 heading per page', snippet: '<h1>Page Main Heading</h1>' });
  if (bpFails.some((c) => c.label.includes('console.log')))
    recs.push({ priority: 'low', title: 'Remove console.log() before deploy', snippet: '// Remove: console.log("debug", data)' });
  if (seoFails.some((c) => c.label.includes('Open Graph')))
    recs.push({ priority: 'low', title: 'Add Open Graph tags for social sharing', snippet: '<meta property="og:title" content="My App">\n<meta property="og:image" content="preview.png">' });

  return recs;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const CIRCUMFERENCE = 2 * Math.PI * 45; // r=45, svg 120px

function scoreColor(score: number): string {
  if (score >= 90) return '#22c55e';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  const color = scoreColor(score);
  const offset = CIRCUMFERENCE - (score / 100) * CIRCUMFERENCE;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="45" fill="none" stroke="#21262d" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r="45"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={`${CIRCUMFERENCE}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 60 60)"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        <text
          x="60"
          y="60"
          textAnchor="middle"
          dominantBaseline="central"
          fill={color}
          fontSize="26"
          fontWeight="bold"
          fontFamily="sans-serif"
        >
          {score}
        </text>
      </svg>
      <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
    </div>
  );
}

const STATUS_ICON: Record<Check['status'], React.ReactNode> = {
  pass: <CheckCircle2 size={14} className="text-green-500 shrink-0 mt-0.5" />,
  warn: <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />,
  fail: <X size={14} className="text-red-500 shrink-0 mt-0.5" />,
  info: <Lightbulb size={14} className="text-blue-400 shrink-0 mt-0.5" />,
};

const STATUS_TEXT: Record<Check['status'], string> = {
  pass: 'text-green-400',
  warn: 'text-amber-300',
  fail: 'text-red-400',
  info: 'text-blue-300',
};

function CheckList({ title, checks }: { title: string; checks: Check[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-[#30363d] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#1c2128] transition-colors"
      >
        <span className="text-sm font-semibold text-[#e6edf3]">{title}</span>
        {open ? <ChevronUp size={16} color="#8b949e" /> : <ChevronDown size={16} color="#8b949e" />}
      </button>
      {open && (
        <ul className="px-4 pb-3 space-y-2">
          {checks.map((c, i) => (
            <li key={i} className="flex items-start gap-2">
              {STATUS_ICON[c.status]}
              <span className={`text-xs ${STATUS_TEXT[c.status]}`}>
                {c.label}
                {c.detail && <span className="text-[#8b949e] ml-1">— {c.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const PRIORITY_BADGE: Record<Recommendation['priority'], string> = {
  high: 'bg-red-900/50 text-red-300 border border-red-700',
  medium: 'bg-amber-900/50 text-amber-300 border border-amber-700',
  low: 'bg-blue-900/50 text-blue-300 border border-blue-700',
};

const PRIORITY_LABEL: Record<Recommendation['priority'], string> = {
  high: 'High Impact',
  medium: 'Medium',
  low: 'Low',
};

function RecommendationCard({ rec }: { rec: Recommendation }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-[#30363d] p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${PRIORITY_BADGE[rec.priority]}`}>
          {PRIORITY_LABEL[rec.priority]}
        </span>
        <span className="text-xs text-[#e6edf3] font-medium">{rec.title}</span>
      </div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="text-[10px] text-[#58a6ff] hover:underline"
      >
        {expanded ? 'Hide snippet' : 'Show fix'}
      </button>
      {expanded && (
        <pre className="text-[10px] bg-[#0d1117] border border-[#30363d] rounded p-2 overflow-x-auto text-green-300 whitespace-pre-wrap">
          {rec.snippet}
        </pre>
      )}
    </div>
  );
}

const HISTORY_KEY = 'navbharatai_perf_history';
const MAX_HISTORY = 5;

function MiniBarChart({ history }: { history: HistoryEntry[] }) {
  if (history.length === 0) return null;
  const categories: (keyof Omit<HistoryEntry, 'analyzedAt'>)[] = [
    'performance',
    'accessibility',
    'seo',
    'bestPractices',
  ];
  const labels = ['Perf', 'A11y', 'SEO', 'BP'];

  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-3 min-w-max px-2 pb-1">
        {history.map((entry, hi) => (
          <div key={hi} className="flex flex-col items-center gap-1">
            <div className="flex items-end gap-1">
              {categories.map((cat, ci) => {
                const val = entry[cat] as number;
                const color = scoreColor(val);
                return (
                  <div key={ci} className="flex flex-col items-center gap-0.5">
                    <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>{val}</span>
                    <div
                      style={{
                        width: 14,
                        height: Math.max(4, (val / 100) * 48),
                        background: color,
                        borderRadius: 2,
                      }}
                    />
                    <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>{labels[ci]}</span>
                  </div>
                );
              })}
            </div>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
              {new Date(entry.analyzedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const PerformanceAnalyzer: React.FC<PerformanceAnalyzerProps> = ({ generatedCode, files, liveUrl }) => {
  // REAL performance measurement (admin 2026-07-25): run the LIVE app through Google's Lighthouse engine
  // (PageSpeed Insights) via /api/analyze/pagespeed → genuine scores + Core Web Vitals. Only works on a
  // publicly-reachable URL (the live preview / a deployed site); the static checks below stay as an
  // offline heuristic fallback. The measured URL defaults to the live preview URL when we have one.
  const [measureUrl, setMeasureUrl] = useState(liveUrl || '');
  const [strategy, setStrategy] = useState<'mobile' | 'desktop'>('mobile');
  const [live, setLive] = useState<LiveResult | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState('');

  useEffect(() => { if (liveUrl && !measureUrl) setMeasureUrl(liveUrl); }, [liveUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const runLiveMeasure = useCallback(async () => {
    const url = measureUrl.trim();
    if (!url || liveLoading) return;
    setLiveLoading(true); setLiveError(''); setLive(null);
    try {
      const res = await fetch(`/api/analyze/pagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error((data && typeof data.error === 'string' && data.error) || 'Could not measure this URL.');
      }
      setLive(data as LiveResult);
    } catch (e) {
      setLiveError(e instanceof Error ? e.message : 'Could not measure this URL — please try again.');
    } finally {
      setLiveLoading(false);
    }
  }, [measureUrl, strategy, liveLoading]);

  // Resolve the REAL app HTML (admin autopsy 2026-07-21): prefer the bundled preview, else the
  // workspace index.html; the "Waiting for magic…" placeholder counts as no app yet, so the manual
  // Paste fallback and empty state show correctly instead of scoring the placeholder.
  const appSource = resolveAppSource(generatedCode, files);
  const realApp = hasAnalysableApp(appSource);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pasteModal, setPasteModal] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [codeToAnalyze, setCodeToAnalyze] = useState<string | undefined>(realApp ? appSource.html : undefined);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Sync prop changes — analyse the real app source, or nothing when there is no built app yet.
  useEffect(() => {
    setCodeToAnalyze(realApp ? appSource.html : undefined);
  }, [realApp, appSource.html]);

  // Load history from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  const runAnalysis = useCallback(
    (html: string) => {
      setIsAnalyzing(true);
      const res = analyzeHTML(html);
      setResult(res);

      const entry: HistoryEntry = {
        performance: res.performance.score,
        accessibility: res.accessibility.score,
        seo: res.seo.score,
        bestPractices: res.bestPractices.score,
        analyzedAt: res.analyzedAt,
      };

      setHistory((prev) => {
        const updated = [entry, ...prev].slice(0, MAX_HISTORY);
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
        } catch {
          // ignore
        }
        return updated;
      });

      setIsAnalyzing(false);
    },
    []
  );

  const handleAnalyze = () => {
    if (codeToAnalyze && codeToAnalyze.trim()) {
      runAnalysis(codeToAnalyze);
    }
  };

  const handlePasteConfirm = () => {
    if (pasteValue.trim()) {
      setCodeToAnalyze(pasteValue);
      setPasteModal(false);
      runAnalysis(pasteValue);
    }
  };

  const recommendations = result ? buildRecommendations(result) : [];

  return (
    <div
      className="flex flex-col h-full overflow-hidden text-[#e6edf3]"
      style={{ background: 'var(--surface-base)', fontFamily: 'sans-serif' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-[#30363d] shrink-0"
        style={{ background: 'var(--surface-card)' }}
      >
        <div className="flex items-center gap-2">
          <Gauge size={18} className="text-indigo-400" />
          <span className="font-semibold text-sm text-[#e6edf3]">Performance Analyzer</span>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <span className="text-[10px] text-[#8b949e] flex items-center gap-1">
              <Clock size={11} />
              {new Date(result.analyzedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          {/* Open the full pagespeed.web.dev report for the SAME live URL (was previously an empty ?url=
              that opened a blank PageSpeed — the exact broken button, fixed 2026-07-25). Disabled until
              there is a URL to test. */}
          <a
            href={measureUrl.trim() ? `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(measureUrl.trim())}` : undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!measureUrl.trim()}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-[#30363d] transition-colors ${measureUrl.trim() ? 'text-[#58a6ff] hover:bg-[#21262d]' : 'text-[#484f58] cursor-not-allowed pointer-events-none'}`}
            title={measureUrl.trim() ? 'Open the full report on pagespeed.web.dev' : 'Enter a live URL below first'}
          >
            <BarChart2 size={13} />
            Full report ↗
          </a>
          {!realApp && (
            <button
              onClick={() => setPasteModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-[#30363d] text-[#e6edf3] hover:bg-[#21262d] transition-colors"
            >
              <Clipboard size={13} />
              Paste Code
            </button>
          )}
          <button
            onClick={handleAnalyze}
            disabled={!codeToAnalyze || isAnalyzing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isAnalyzing ? (
              <>
                <TirangaLoader className="w-3 h-3" />
                Analyzing...
              </>
            ) : (
              <>
                <Play size={12} />
                Analyze
              </>
            )}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* ─── LIVE performance — REAL Lighthouse metrics (the genuine measurement) ─── */}
          <div className="rounded-xl border border-indigo-500/30 p-4" style={{ background: '#12141c' }}>
            <div className="flex items-center gap-2 mb-1">
              <Gauge size={15} className="text-indigo-400" />
              <span className="text-sm font-semibold text-[#e6edf3]">Live performance — real Lighthouse metrics</span>
            </div>
            <p className="text-[11px] text-[#8b949e] mb-3">Measures your actually-running app (Core Web Vitals: LCP, CLS, TBT…) via Google Lighthouse. Needs a public URL — your live preview or a deployed site.</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={measureUrl}
                onChange={(e) => setMeasureUrl(e.target.value)}
                placeholder="https://your-app.example.com  (live preview or deployed URL)"
                className="flex-1 min-w-[220px] rounded-md border border-[#30363d] bg-[#0d1117] text-xs text-[#e6edf3] px-3 py-2 focus:outline-none focus:border-indigo-500"
              />
              <div className="flex rounded-md border border-[#30363d] overflow-hidden text-xs">
                {(['mobile', 'desktop'] as const).map((s) => (
                  <button key={s} onClick={() => setStrategy(s)} className={`px-3 py-2 ${strategy === s ? 'bg-indigo-600 text-white' : 'text-[#8b949e] hover:bg-[#21262d]'}`}>{s === 'mobile' ? 'Mobile' : 'Desktop'}</button>
                ))}
              </div>
              <button
                onClick={runLiveMeasure}
                disabled={!measureUrl.trim() || liveLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {liveLoading ? <><TirangaLoader className="w-3 h-3" /> Measuring…</> : <><Play size={12} /> Measure live</>}
              </button>
            </div>
            {!liveUrl && !measureUrl.trim() && (
              <p className="mt-2 text-[11px] text-amber-300/80">Open your app's live preview once (or deploy it) to get a public URL, then measure real performance here.</p>
            )}
            {liveError && <p className="mt-2 text-[11px] text-red-400">{liveError}</p>}
            {liveLoading && <p className="mt-3 text-[11px] text-[#8b949e]">Running Lighthouse on the live page — this takes ~10–30s…</p>}
            {live && !liveLoading && (
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-5 justify-center">
                  {([['performance', 'Performance'], ['accessibility', 'Accessibility'], ['seo', 'SEO'], ['bestPractices', 'Best Practices']] as const).map(([k, label]) => {
                    const v = live[k];
                    return v == null
                      ? <div key={k} className="flex flex-col items-center justify-center gap-2" style={{ width: 120, height: 146 }}><span className="text-2xl text-[#484f58]">—</span><span className="text-xs text-[#8b949e]">{label}</span></div>
                      : <ScoreRing key={k} score={v} label={label} />;
                  })}
                </div>
                {VITAL_ORDER.some(({ key }) => live[key]) && (
                  <div className="rounded-lg border border-[#30363d] p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#8b949e] mb-2">Core Web Vitals (measured)</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {VITAL_ORDER.filter(({ key }) => live[key]).map(({ key, label }) => (
                        <div key={key} className="rounded-md bg-[#0d1117] border border-[#30363d] px-2.5 py-2">
                          <div className="text-sm font-semibold text-[#e6edf3]">{live[key]}</div>
                          <div className="text-[10px] text-[#8b949e] leading-tight">{label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-[#8b949e]">Measured on {live.finalUrl || measureUrl} ({live.strategy}) via Google Lighthouse.</p>
              </div>
            )}
          </div>

          {/* Static code checks (offline heuristics) — a quick, no-URL lint of the HTML source. Honest:
              this is NOT the performance measurement above; for a React SPA it sees only the static shell. */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#8b949e]">Static code checks (offline)</span>
            <span className="text-[10px] text-[#6e7681]">— quick HTML/SEO/a11y lint, no URL needed</span>
          </div>
          {/* Empty State */}
          {!result && !isAnalyzing && (
            <div className="flex flex-col items-center justify-center h-full gap-4 py-16">
              <Gauge size={56} className="text-[#30363d]" />
              <p className="text-sm text-[#8b949e] text-center max-w-xs leading-relaxed">
                {realApp ? 'Tap "Analyze" to score your app.' : (appSourceGuidance(appSource.kind) + ' Or paste code.')}
              </p>
              {!realApp && (
                <button
                  onClick={() => setPasteModal(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 transition-colors"
                >
                  <Clipboard size={15} />
                  Paste Code
                </button>
              )}
            </div>
          )}

          {/* Analyzing spinner */}
          {isAnalyzing && (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <TirangaLoader className="w-8 h-8" />
              <span className="text-sm text-[#8b949e]">Analyzing code...</span>
            </div>
          )}

          {/* Scores */}
          {result && !isAnalyzing && (
            <>
              <div className="rounded-xl border border-[#30363d] p-5" style={{ background: 'var(--surface-card)' }}>
                <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-widest mb-4">Score Overview</h2>
                <div className="flex flex-wrap gap-6 justify-center">
                  <ScoreRing score={result.performance.score} label="Performance" />
                  <ScoreRing score={result.accessibility.score} label="Accessibility" />
                  <ScoreRing score={result.seo.score} label="SEO" />
                  <ScoreRing score={result.bestPractices.score} label="Best Practices" />
                </div>
              </div>

              {/* Detailed Findings 2-col */}
              <div>
                <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-widest mb-3">Detailed Findings</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" style={{ background: 'var(--surface-card)', borderRadius: 12, padding: 16, border: '1px solid #30363d' }}>
                  <CheckList title="Performance" checks={result.performance.checks} />
                  <CheckList title="Accessibility" checks={result.accessibility.checks} />
                  <CheckList title="SEO" checks={result.seo.checks} />
                  <CheckList title="Best Practices" checks={result.bestPractices.checks} />
                </div>
              </div>

              {/* History */}
              {history.length > 0 && (
                <div className="rounded-xl border border-[#30363d] overflow-hidden" style={{ background: 'var(--surface-card)' }}>
                  <button
                    onClick={() => setHistoryOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#1c2128] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <BarChart2 size={14} className="text-[#8b949e]" />
                      <span className="text-xs font-semibold text-[#8b949e] uppercase tracking-widest">Score History</span>
                    </div>
                    {historyOpen ? <ChevronUp size={15} color="#8b949e" /> : <ChevronDown size={15} color="#8b949e" />}
                  </button>
                  {historyOpen && (
                    <div className="px-4 pb-4 pt-1">
                      <MiniBarChart history={history} />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Recommendations Panel */}
        {result && !isAnalyzing && recommendations.length > 0 && (
          <div
            className="shrink-0 border-l border-[#30363d] overflow-y-auto p-4 space-y-3"
            style={{ width: 300, background: 'var(--surface-card)' }}
          >
            <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-widest sticky top-0 pb-2" style={{ background: 'var(--surface-card)' }}>
              Recommendations
            </h2>
            {(['high', 'medium', 'low'] as const).map((priority) => {
              const group = recommendations.filter((r) => r.priority === priority);
              if (group.length === 0) return null;
              return (
                <div key={priority} className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#8b949e]">
                    {PRIORITY_LABEL[priority]}
                  </p>
                  {group.map((rec, i) => (
                    <RecommendationCard key={i} rec={rec} />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Paste Modal */}
      {pasteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div
            className="rounded-xl border border-[#30363d] p-5 flex flex-col gap-4 w-[520px] max-w-[95vw]"
            style={{ background: 'var(--surface-card)' }}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm text-[#e6edf3]">Paste HTML Code</span>
              <button onClick={() => setPasteModal(false)} className="text-[#8b949e] hover:text-white">
                <X size={18} />
              </button>
            </div>
            <textarea
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
              placeholder="Paste your HTML code here..."
              className="w-full h-56 rounded-lg border border-[#30363d] bg-[#0d1117] text-xs text-[#e6edf3] p-3 font-mono resize-none focus:outline-none focus:border-indigo-500"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPasteModal(false)}
                className="px-4 py-2 rounded-lg text-xs border border-[#30363d] text-[#8b949e] hover:text-white hover:bg-[#21262d] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePasteConfirm}
                disabled={!pasteValue.trim()}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Analyze
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
