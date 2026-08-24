import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Share2,
  Map as MapIcon,
  Bot,
  Copy,
  Check,
  Download,
  ChevronRight,
  AlertTriangle,
  Plus,
  Trash2,
  Eye,
  Tag as TagIcon, Loader2
} from 'lucide-react';
import { applySeoHead } from '../../lib/seoHead';
import { AppTargetPicker, useUserApps, useAppFiles, readAppFile, saveFilesToApp } from './AppTargetPicker';
import { resolveAppSource } from '../../lib/workspaceSource';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SEOOptimizerProps {
  generatedCode?: string;
  /** The v5-synced workspace files — the real app source when the preview isn't bundled. */
  files?: Record<string, string>;
  appName?: string;
  onCodeUpdate?: (html: string) => void;
  /** The app the user is currently working on, pre-selected in the picker. */
  sessionId?: string;
}

interface MetaFormData {
  siteName: string;
  pageTitle: string;
  description: string;
  keywords: string;
  canonicalUrl: string;
  language: string;
  robots: string;
  author: string;
}

interface OGFormData {
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  ogType: string;
  ogSiteName: string;
  twitterCard: string;
  twitterHandle: string;
}

interface SitemapPage {
  id: string;
  url: string;
  lastmod: string;
  priority: string;
  changefreq: string;
}

interface RobotsConfig {
  allowAll: boolean;
  blockAdmin: boolean;
  blockApi: boolean;
  blockPrivate: boolean;
  customRules: string;
  sitemapUrl: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }, []);
  return { copied, copy };
}

function downloadFile(content: string, filename: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function extractFromCode(code: string) {
  const titleMatch = code.match(/<title[^>]*>([^<]*)<\/title>/i);
  const h1Match = code.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  const pMatch = code.match(/<p[^>]*>([^<]{20,200})<\/p>/i);
  return {
    title: titleMatch?.[1] ?? h1Match?.[1] ?? '',
    description: pMatch?.[1]?.replace(/<[^>]*>/g, '').trim() ?? '',
  };
}

// ─── Score calculation ─────────────────────────────────────────────────────────

function calcScore(
  meta: MetaFormData,
  og: OGFormData,
  pages: SitemapPage[]
): { total: number; items: { label: string; pts: number; done: boolean }[] } {
  const items = [
    { label: 'Page Title', pts: 15, done: meta.pageTitle.trim().length > 0 },
    { label: 'Meta Description', pts: 20, done: meta.description.trim().length > 0 },
    { label: 'OG Tags', pts: 20, done: og.ogTitle.trim().length > 0 && og.ogImage.trim().length > 0 },
    { label: 'Keywords', pts: 10, done: meta.keywords.trim().length > 0 },
    { label: 'Canonical URL', pts: 10, done: meta.canonicalUrl.trim().length > 0 },
    { label: 'Twitter Card', pts: 15, done: og.twitterCard.length > 0 && og.twitterHandle.trim().length > 0 },
    { label: 'Sitemap', pts: 10, done: pages.length > 0 },
  ];
  const total = items.reduce((sum, i) => sum + (i.done ? i.pts : 0), 0);
  return { total, items };
}

// ─── Score Gauge ──────────────────────────────────────────────────────────────

const ScoreGauge: React.FC<{ score: number }> = ({ score }) => {
  const r = 42;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(score / 100, 1);
  const color = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <svg width="100" height="100" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
      <circle
        cx="50" cy="50" r={r}
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeDasharray={`${circ * pct} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
        style={{ transition: 'stroke-dasharray 0.5s ease' }}
      />
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="18" fontWeight="700">
        {score}
      </text>
    </svg>
  );
};

// ─── Code Block ────────────────────────────────────────────────────────────────

const CodeBlock: React.FC<{ code: string; copyKey: string; onCopy: (t: string, k: string) => void; copied: string | null }> = ({
  code, copyKey, onCopy, copied,
}) => (
  <div className="relative rounded-lg overflow-hidden border border-white/10">
    <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/10">
      <span className="text-xs text-white/40 font-mono">generated</span>
      <button
        onClick={() => onCopy(code, copyKey)}
        className="flex items-center gap-1 text-xs text-white/50 hover:text-white/90 transition-colors"
      >
        {copied === copyKey ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
        {copied === copyKey ? 'Copied!' : 'Copy'}
      </button>
    </div>
    <pre className="p-4 text-xs font-mono leading-relaxed overflow-x-auto bg-[#0d1117] text-[#a5d6ff] whitespace-pre-wrap">
      {code}
    </pre>
  </div>
);

// ─── Input components ──────────────────────────────────────────────────────────

const inputCls = 'w-full bg-[#0d1117] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-500/60 transition-colors';
const labelCls = 'block text-xs font-medium text-white/60 mb-1.5';

// ─── TAB 1: Meta Tags ──────────────────────────────────────────────────────────

const MetaTab: React.FC<{
  meta: MetaFormData;
  setMeta: React.Dispatch<React.SetStateAction<MetaFormData>>;
  generatedCode?: string;
  onInject?: (code: string) => void;
  copy: (t: string, k: string) => void;
  copied: string | null;
}> = ({ meta, setMeta, generatedCode, copy, copied }) => {
  const [autoExtract, setAutoExtract] = useState(false);
  const dMeta = useDebounce(meta, 300);

  useEffect(() => {
    if (autoExtract && generatedCode) {
      const extracted = extractFromCode(generatedCode);
      setMeta(prev => ({
        ...prev,
        pageTitle: extracted.title || prev.pageTitle,
        description: extracted.description || prev.description,
      }));
    }
  }, [autoExtract, generatedCode, setMeta]);

  const generatedTags = `<!-- Primary Meta Tags -->
<title>${dMeta.siteName ? `${dMeta.siteName}${dMeta.pageTitle ? ` | ${dMeta.pageTitle}` : ''}` : dMeta.pageTitle}</title>
<meta name="title" content="${dMeta.pageTitle}" />
<meta name="description" content="${dMeta.description}" />
<meta name="keywords" content="${dMeta.keywords}" />
<meta name="robots" content="${dMeta.robots}" />
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<meta name="language" content="${dMeta.language}" />
<meta name="author" content="${dMeta.author}" />${dMeta.canonicalUrl ? `\n<link rel="canonical" href="${dMeta.canonicalUrl}" />` : ''}`;

  const set = (k: keyof MetaFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setMeta(prev => ({ ...prev, [k]: e.target.value }));

  return (
    <div className="flex flex-col md:flex-row gap-4 md:h-full md:overflow-visible">
      {/* Form */}
      <div className="w-full md:w-[360px] flex-shrink-0 space-y-4 md:overflow-y-auto md:pr-2">
        {/* Auto-extract toggle */}
        {generatedCode && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <button
              onClick={() => setAutoExtract(v => !v)}
              className={`w-10 h-5 rounded-full transition-colors relative ${autoExtract ? 'bg-blue-500' : 'bg-white/20'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoExtract ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-xs text-blue-300">Auto-extract from app code</span>
          </div>
        )}

        <div>
          <label className={labelCls}>Site Name</label>
          <input className={inputCls} value={meta.siteName} onChange={set('siteName')} placeholder="My Awesome App" />
        </div>

        <div>
          <label className={labelCls}>
            Page Title
            <span className={`ml-2 text-xs ${meta.pageTitle.length > 60 ? 'text-red-400' : 'text-white/30'}`}>
              {meta.pageTitle.length}/60 {meta.pageTitle.length > 60 && '⚠ Too long'}
            </span>
          </label>
          <input className={inputCls} value={meta.pageTitle} onChange={set('pageTitle')} placeholder="Home | My App" />
        </div>

        <div>
          <label className={labelCls}>
            Meta Description
            <span className={`ml-2 text-xs ${meta.description.length > 160 ? 'text-red-400' : 'text-white/30'}`}>
              {meta.description.length}/160 {meta.description.length > 160 && '⚠ Too long'}
            </span>
          </label>
          <textarea
            className={`${inputCls} resize-none`}
            rows={3}
            value={meta.description}
            onChange={set('description')}
            placeholder="A brief description of this page..."
          />
        </div>

        <div>
          <label className={labelCls}>Keywords (comma separated)</label>
          <input className={inputCls} value={meta.keywords} onChange={set('keywords')} placeholder="react, app, dashboard" />
        </div>

        <div>
          <label className={labelCls}>Canonical URL</label>
          <input className={inputCls} value={meta.canonicalUrl} onChange={set('canonicalUrl')} placeholder="https://example.com/page" />
        </div>

        <div>
          <label className={labelCls}>Language</label>
          <select className={inputCls} value={meta.language} onChange={set('language')}>
            <option value="English">English</option>
            <option value="Hindi">Hindi</option>
            <option value="Hinglish">Hinglish (auto-detect)</option>
            <option value="Bengali">Bengali</option>
            <option value="Tamil">Tamil</option>
          </select>
        </div>

        <div>
          <label className={labelCls}>Robots</label>
          <select className={inputCls} value={meta.robots} onChange={set('robots')}>
            <option value="index, follow">index, follow</option>
            <option value="noindex, nofollow">noindex, nofollow</option>
            <option value="index, nofollow">index, nofollow</option>
            <option value="noindex, follow">noindex, follow</option>
          </select>
        </div>

        <div>
          <label className={labelCls}>Author</label>
          <input className={inputCls} value={meta.author} onChange={set('author')} placeholder="John Doe" />
        </div>
      </div>

      {/* Output */}
      <div className="flex-1 min-w-0 space-y-3">
        <CodeBlock code={generatedTags} copyKey="meta" onCopy={copy} copied={copied} />
        {meta.pageTitle.length > 60 && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2 border border-red-400/20">
            <AlertTriangle size={12} />
            Page title exceeds 60 characters — search engines may truncate it.
          </div>
        )}
        {meta.description.length > 160 && (
          <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2 border border-amber-400/20">
            <AlertTriangle size={12} />
            Description exceeds 160 characters — it may be cut off in search results.
          </div>
        )}
      </div>
    </div>
  );
};

// ─── TAB 2: Open Graph & Social ────────────────────────────────────────────────

const OGTab: React.FC<{
  og: OGFormData;
  setOG: React.Dispatch<React.SetStateAction<OGFormData>>;
  metaTitle: string;
  metaDesc: string;
  copy: (t: string, k: string) => void;
  copied: string | null;
}> = ({ og, setOG, metaTitle, metaDesc, copy, copied }) => {
  const dOG = useDebounce(og, 300);

  const ogTags = `<!-- Open Graph / Facebook -->
<meta property="og:type" content="${dOG.ogType}" />
<meta property="og:url" content="" />
<meta property="og:title" content="${dOG.ogTitle || metaTitle}" />
<meta property="og:description" content="${dOG.ogDescription || metaDesc}" />
<meta property="og:image" content="${dOG.ogImage}" />
<meta property="og:site_name" content="${dOG.ogSiteName}" />

<!-- Twitter -->
<meta property="twitter:card" content="${dOG.twitterCard}" />
<meta property="twitter:url" content="" />
<meta property="twitter:title" content="${dOG.ogTitle || metaTitle}" />
<meta property="twitter:description" content="${dOG.ogDescription || metaDesc}" />
<meta property="twitter:image" content="${dOG.ogImage}" />
<meta property="twitter:site" content="${dOG.twitterHandle}" />`;

  const set = (k: keyof OGFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setOG(prev => ({ ...prev, [k]: e.target.value }));

  const displayTitle = dOG.ogTitle || metaTitle || 'Page Title';
  const displayDesc = dOG.ogDescription || metaDesc || 'Page description goes here.';
  const displaySite = dOG.ogSiteName || 'example.com';

  return (
    <div className="flex flex-col md:flex-row gap-4 md:h-full md:overflow-visible">
      {/* Form */}
      <div className="w-full md:w-[360px] flex-shrink-0 space-y-4 md:overflow-y-auto md:pr-2">
        <div>
          <label className={labelCls}>OG Title (auto-filled from meta title)</label>
          <input className={inputCls} value={og.ogTitle} onChange={set('ogTitle')} placeholder={metaTitle || 'Page title'} />
        </div>
        <div>
          <label className={labelCls}>OG Description</label>
          <input className={inputCls} value={og.ogDescription} onChange={set('ogDescription')} placeholder={metaDesc || 'Page description'} />
        </div>
        <div>
          <label className={labelCls}>OG Image URL</label>
          <input className={inputCls} value={og.ogImage} onChange={set('ogImage')} placeholder="https://example.com/og-image.jpg" />
        </div>
        {og.ogImage && (
          <div className="rounded-lg overflow-hidden border border-white/10 h-28 bg-black">
            <img src={og.ogImage} alt="OG preview" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          </div>
        )}
        <div>
          <label className={labelCls}>OG Type</label>
          <select className={inputCls} value={og.ogType} onChange={set('ogType')}>
            <option value="website">website</option>
            <option value="article">article</option>
            <option value="product">product</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>OG Site Name</label>
          <input className={inputCls} value={og.ogSiteName} onChange={set('ogSiteName')} placeholder="My Site" />
        </div>
        <div>
          <label className={labelCls}>Twitter Card</label>
          <select className={inputCls} value={og.twitterCard} onChange={set('twitterCard')}>
            <option value="summary">summary</option>
            <option value="summary_large_image">summary_large_image</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Twitter Handle</label>
          <input className={inputCls} value={og.twitterHandle} onChange={set('twitterHandle')} placeholder="@username" />
        </div>
      </div>

      {/* Previews + Code */}
      <div className="flex-1 min-w-0 space-y-4 md:overflow-y-auto">
        {/* Google SERP preview */}
        <div>
          <p className="text-xs text-white/40 mb-2 font-medium uppercase tracking-wide">Google Search Preview</p>
          <div className="p-4 rounded-lg bg-white">
            <p className="text-[#1a0dab] text-lg font-medium truncate cursor-pointer hover:underline">{displayTitle}</p>
            <p className="text-[#006621] text-sm">{displaySite}</p>
            <p className="text-[#545454] text-sm mt-0.5 line-clamp-2">{displayDesc}</p>
          </div>
        </div>

        {/* Facebook OG preview */}
        <div>
          <p className="text-xs text-white/40 mb-2 font-medium uppercase tracking-wide">Facebook / OG Preview</p>
          <div className="rounded-lg overflow-hidden border border-[#dadde1] bg-[#f0f2f5]">
            {dOG.ogImage ? (
              <div className="h-36 bg-black">
                <img src={dOG.ogImage} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
            ) : (
              <div className="h-36 bg-[#e4e6ea] flex items-center justify-center">
                <Eye size={32} className="text-[#bcc0c4]" />
              </div>
            )}
            <div className="px-3 py-2 bg-[#f0f2f5]">
              <p className="text-[#606770] text-xs uppercase">{displaySite}</p>
              <p className="text-[#1c1e21] text-sm font-semibold mt-0.5 truncate">{displayTitle}</p>
              <p className="text-[#606770] text-xs mt-0.5 line-clamp-2">{displayDesc}</p>
            </div>
          </div>
        </div>

        {/* Twitter card preview */}
        <div>
          <p className="text-xs text-white/40 mb-2 font-medium uppercase tracking-wide">Twitter Card Preview</p>
          <div className="rounded-2xl overflow-hidden border border-[#2f3336] bg-black">
            {dOG.twitterCard === 'summary_large_image' && (
              dOG.ogImage ? (
                <div className="h-40 bg-black">
                  <img src={dOG.ogImage} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                </div>
              ) : (
                <div className="h-40 bg-[#16181c] flex items-center justify-center">
                  <Eye size={32} className="text-[#536471]" />
                </div>
              )
            )}
            <div className="p-3 flex gap-3">
              {dOG.twitterCard === 'summary' && (
                <div className="w-16 h-16 rounded-2xl overflow-hidden bg-[#16181c] flex-shrink-0">
                  {dOG.ogImage && <img src={dOG.ogImage} alt="" className="w-full h-full object-cover" />}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-white text-sm font-bold truncate">{displayTitle}</p>
                <p className="text-[#71767b] text-xs mt-0.5 line-clamp-2">{displayDesc}</p>
                <p className="text-[#71767b] text-xs mt-1">{displaySite}</p>
              </div>
            </div>
          </div>
        </div>

        <CodeBlock code={ogTags} copyKey="og" onCopy={copy} copied={copied} />
      </div>
    </div>
  );
};

// ─── TAB 3: Sitemap ────────────────────────────────────────────────────────────

const SitemapTab: React.FC<{
  pages: SitemapPage[];
  setPages: React.Dispatch<React.SetStateAction<SitemapPage[]>>;
  generatedCode?: string;
  copy: (t: string, k: string) => void;
  copied: string | null;
}> = ({ pages, setPages, generatedCode, copy, copied }) => {
  const [siteUrl, setSiteUrl] = useState('https://example.com');
  const [autoExtract, setAutoExtract] = useState(false);
  const dPages = useDebounce(pages, 300);
  const dSiteUrl = useDebounce(siteUrl, 300);

  useEffect(() => {
    if (autoExtract && generatedCode) {
      const hrefRe = /href=["']([^"'#?][^"']*?)["']/g;
      const found = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = hrefRe.exec(generatedCode)) !== null) {
        if (!m[1].startsWith('http') && !m[1].startsWith('//')) {
          found.add(m[1].startsWith('/') ? m[1] : `/${m[1]}`);
        }
      }
      const today = new Date().toISOString().split('T')[0];
      const newPages: SitemapPage[] = Array.from(found).map(u => ({
        id: Math.random().toString(36).slice(2),
        url: u,
        lastmod: today,
        priority: '0.8',
        changefreq: 'weekly',
      }));
      if (newPages.length) setPages(newPages);
    }
  }, [autoExtract, generatedCode, setPages]);

  const addPage = () => {
    setPages(prev => [...prev, {
      id: Math.random().toString(36).slice(2),
      url: '/',
      lastmod: new Date().toISOString().split('T')[0],
      priority: '0.8',
      changefreq: 'weekly',
    }]);
  };

  const removePage = (id: string) => setPages(prev => prev.filter(p => p.id !== id));
  const updatePage = (id: string, k: keyof SitemapPage, v: string) =>
    setPages(prev => prev.map(p => p.id === id ? { ...p, [k]: v } : p));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${dPages.map(p => `  <url>
    <loc>${dSiteUrl}${p.url}</loc>
    <lastmod>${p.lastmod}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  return (
    <div className="flex flex-col md:flex-row gap-4 md:h-full md:overflow-visible">
      <div className="w-full md:w-[360px] flex-shrink-0 space-y-4 md:overflow-y-auto md:pr-2">
        <div>
          <label className={labelCls}>Base URL</label>
          <input className={inputCls} value={siteUrl} onChange={e => setSiteUrl(e.target.value)} placeholder="https://example.com" />
        </div>

        {generatedCode && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <button
              onClick={() => setAutoExtract(v => !v)}
              className={`w-10 h-5 rounded-full transition-colors relative ${autoExtract ? 'bg-blue-500' : 'bg-white/20'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoExtract ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-xs text-blue-300">Auto-extract URLs from code</span>
          </div>
        )}

        <div className="space-y-3">
          {pages.map(p => (
            <div key={p.id} className="p-3 rounded-lg border border-white/10 bg-white/5 space-y-2">
              <div className="flex gap-2">
                <input
                  className={`${inputCls} flex-1`}
                  value={p.url}
                  onChange={e => updatePage(p.id, 'url', e.target.value)}
                  placeholder="/about"
                />
                <button onClick={() => removePage(p.id)} className="text-white/30 hover:text-red-400 transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <input type="date" className={`${inputCls} text-xs`} value={p.lastmod} onChange={e => updatePage(p.id, 'lastmod', e.target.value)} />
                <select className={`${inputCls} text-xs`} value={p.priority} onChange={e => updatePage(p.id, 'priority', e.target.value)}>
                  {['1.0','0.9','0.8','0.7','0.6','0.5','0.4','0.3'].map(v => <option key={v}>{v}</option>)}
                </select>
                <select className={`${inputCls} text-xs`} value={p.changefreq} onChange={e => updatePage(p.id, 'changefreq', e.target.value)}>
                  {['always','hourly','daily','weekly','monthly','yearly','never'].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={addPage}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-white/20 text-sm text-white/50 hover:text-white/80 hover:border-white/40 transition-colors"
        >
          <Plus size={14} /> Add Page
        </button>
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        <CodeBlock code={xml} copyKey="sitemap" onCopy={copy} copied={copied} />
        <button
          onClick={() => downloadFile(xml, 'sitemap.xml', 'application/xml')}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
        >
          <Download size={14} /> Download sitemap.xml
        </button>
      </div>
    </div>
  );
};

// ─── TAB 4: robots.txt ────────────────────────────────────────────────────────

const RobotsTab: React.FC<{
  robots: RobotsConfig;
  setRobots: React.Dispatch<React.SetStateAction<RobotsConfig>>;
  copy: (t: string, k: string) => void;
  copied: string | null;
}> = ({ robots, setRobots, copy, copied }) => {
  const dRobots = useDebounce(robots, 300);

  const lines: string[] = ['User-agent: *'];
  if (dRobots.allowAll) {
    lines.push('Allow: /');
  } else {
    lines.push('Allow: /');
    if (dRobots.blockAdmin) lines.push('Disallow: /admin');
    if (dRobots.blockApi) lines.push('Disallow: /api');
    if (dRobots.blockPrivate) lines.push('Disallow: /private');
  }
  if (dRobots.customRules.trim()) {
    lines.push('', '# Custom rules', ...dRobots.customRules.trim().split('\n'));
  }
  if (dRobots.sitemapUrl.trim()) {
    lines.push('', `Sitemap: ${dRobots.sitemapUrl.trim()}`);
  }
  const robotsTxt = lines.join('\n');

  const toggle = (k: keyof RobotsConfig) => setRobots(prev => ({ ...prev, [k]: !prev[k as keyof RobotsConfig] }));

  return (
    <div className="flex flex-col md:flex-row gap-4 md:h-full md:overflow-visible">
      <div className="w-full md:w-[360px] flex-shrink-0 space-y-4 md:overflow-y-auto md:pr-2">
        <div className="space-y-2">
          {([
            { k: 'allowAll', label: 'Allow all crawlers' },
            { k: 'blockAdmin', label: 'Block /admin' },
            { k: 'blockApi', label: 'Block /api' },
            { k: 'blockPrivate', label: 'Block /private' },
          ] as const).map(({ k, label }) => (
            <label key={k} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/5 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={robots[k] as boolean}
                onChange={() => toggle(k)}
                className="w-4 h-4 rounded accent-blue-500"
                disabled={k !== 'allowAll' && robots.allowAll}
              />
              <span className={`text-sm ${k !== 'allowAll' && robots.allowAll ? 'text-white/30' : 'text-white/70'}`}>{label}</span>
            </label>
          ))}
        </div>

        <div>
          <label className={labelCls}>Custom Rules</label>
          <textarea
            className={`${inputCls} resize-none font-mono text-xs`}
            rows={4}
            value={robots.customRules}
            onChange={e => setRobots(prev => ({ ...prev, customRules: e.target.value }))}
            placeholder={`Disallow: /secret\nAllow: /public`}
          />
        </div>

        <div>
          <label className={labelCls}>Sitemap URL</label>
          <input
            className={inputCls}
            value={robots.sitemapUrl}
            onChange={e => setRobots(prev => ({ ...prev, sitemapUrl: e.target.value }))}
            placeholder="https://example.com/sitemap.xml"
          />
        </div>
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        <CodeBlock code={robotsTxt} copyKey="robots" onCopy={copy} copied={copied} />
        <button
          onClick={() => downloadFile(robotsTxt, 'robots.txt')}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
        >
          <Download size={14} /> Download robots.txt
        </button>
      </div>
    </div>
  );
};

// ─── Score Sidebar ─────────────────────────────────────────────────────────────

const ScoreSidebar: React.FC<{ meta: MetaFormData; og: OGFormData; pages: SitemapPage[] }> = ({ meta, og, pages }) => {
  const { total, items } = calcScore(meta, og, pages);
  return (
    <div className="w-full md:w-[240px] flex-shrink-0 bg-[#161b22] rounded-xl border border-white/10 p-4 flex flex-col gap-4">
      <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">SEO Score</p>
      <div className="flex justify-center">
        <ScoreGauge score={total} />
      </div>
      <p className="text-center text-xs text-white/40">
        {total >= 80 ? 'Excellent' : total >= 50 ? 'Needs work' : 'Poor'}
      </p>
      <div className="space-y-2 mt-1">
        {items.map(item => (
          <div key={item.label} className="flex items-center gap-2">
            <div className={`w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center ${item.done ? 'bg-green-500/20' : 'bg-white/5'}`}>
              {item.done
                ? <Check size={9} className="text-green-400" />
                : <ChevronRight size={9} className="text-white/20" />}
            </div>
            <span className={`text-xs flex-1 ${item.done ? 'text-white/70' : 'text-white/30'}`}>{item.label}</span>
            <span className={`text-xs font-mono ${item.done ? 'text-green-400' : 'text-white/20'}`}>+{item.pts}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const SEOOptimizer: React.FC<SEOOptimizerProps> = ({ generatedCode, files, appName, onCodeUpdate, sessionId }) => {
  // Analyse the REAL app (admin autopsy 2026-07-21): the retired generatedCode is the "Waiting for
  // magic…" placeholder in v5.0, so auto-extract used to read the placeholder's title/text. Resolve
  // the real source; appHtml is '' when there's no built app (so the auto-extract guards go false).
  const appHtml = resolveAppSource(generatedCode, files).html;
  const [tab, setTab] = useState(0);

  // Saving into the user's REAL page (admin 2026-07-27). "Apply to App" used to call onCodeUpdate,
  // which only changed the on-screen preview — so the SEO tags a user carefully filled in were gone
  // the moment they closed the tab, and search engines never saw any of it.
  const { apps, loading: appsLoading, selected: targetSession, setSelected: setTargetSession } = useUserApps(sessionId);
  const { files: appFiles, loading: filesLoading, reload: reloadFiles } = useAppFiles(targetSession);
  const [targetPath, setTargetPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    if (targetPath && appFiles.some((f) => f.path === targetPath)) return;
    const pages = appFiles.filter((f) => f.writable && /\.html?$/i.test(f.path)).map((f) => f.path);
    setTargetPath(pages.find((p) => /(^|\/)index\.html?$/i.test(p)) || pages[0] || '');
  }, [appFiles, targetPath]);
  const { copied, copy } = useCopy();

  const [meta, setMeta] = useState<MetaFormData>({
    siteName: appName ?? '',
    pageTitle: '',
    description: '',
    keywords: '',
    canonicalUrl: '',
    language: 'English',
    robots: 'index, follow',
    author: '',
  });

  const [og, setOG] = useState<OGFormData>({
    ogTitle: '',
    ogDescription: '',
    ogImage: '',
    ogType: 'website',
    ogSiteName: appName ?? '',
    twitterCard: 'summary_large_image',
    twitterHandle: '',
  });

  /**
   * Write the SEO tags into the chosen page of the chosen app.
   *
   * The page is re-read first so the tags are merged into its CURRENT content, and the tag building
   * itself now escapes every value — a description containing a quote used to break the page it was
   * meant to describe.
   */
  const saveSeoToApp = useCallback(async () => {
    if (!targetSession || !targetPath || saving) return;
    setSaving(true);
    setSaveNote('');
    setSaveFailed(false);
    try {
      const current = await readAppFile(targetSession, targetPath);
      if (current === null) {
        setSaveFailed(true);
        setSaveNote('Could not open that page, so nothing was changed.');
        return;
      }
      const titleFull = meta.siteName
        ? `${meta.siteName}${meta.pageTitle ? ` | ${meta.pageTitle}` : ''}`
        : meta.pageTitle;
      const applied = applySeoHead(current, {
        title: titleFull,
        description: meta.description,
        keywords: meta.keywords,
        robots: meta.robots,
        author: meta.author,
        canonicalUrl: meta.canonicalUrl,
        ogTitle: og.ogTitle,
        ogDescription: og.ogDescription,
        ogImage: og.ogImage,
        ogType: og.ogType,
        ogSiteName: og.ogSiteName,
        twitterCard: og.twitterCard,
        twitterHandle: og.twitterHandle,
      });
      if (!applied.ok) {
        setSaveFailed(true);
        setSaveNote(applied.error || 'Those tags could not be added to that page.');
        return;
      }

      const outcome = await saveFilesToApp(
        targetSession,
        { [targetPath]: applied.code },
        `Before adding SEO tags to ${targetPath}`,
      );
      if (!outcome.ok) {
        setSaveFailed(true);
        setSaveNote(outcome.error || 'Could not save. Your app is unchanged.');
        return;
      }
      if (outcome.unchanged) {
        setSaveNote('Your page already has exactly these tags — nothing needed changing.');
        return;
      }
      setSaveNote(
        `SEO tags saved into ${targetPath}${applied.replaced ? ` (${applied.replaced} old tag${applied.replaced === 1 ? '' : 's'} replaced)` : ''}. ${outcome.undoHint || ''}`.trim(),
      );
      void reloadFiles(targetSession);
      onCodeUpdate?.(applied.code);
    } catch {
      setSaveFailed(true);
      setSaveNote('Could not reach the server. Your app is unchanged.');
    } finally {
      setSaving(false);
    }
  }, [targetSession, targetPath, saving, meta, og, onCodeUpdate, reloadFiles]);

  const [pages, setPages] = useState<SitemapPage[]>([
    { id: '1', url: '/', lastmod: new Date().toISOString().split('T')[0], priority: '1.0', changefreq: 'daily' },
  ]);

  const [robotsCfg, setRobotsCfg] = useState<RobotsConfig>({
    allowAll: true,
    blockAdmin: false,
    blockApi: false,
    blockPrivate: false,
    customRules: '',
    sitemapUrl: '',
  });

  // sync appName changes
  useEffect(() => {
    if (appName) {
      setMeta(prev => ({ ...prev, siteName: appName }));
      setOG(prev => ({ ...prev, ogSiteName: appName }));
    }
  }, [appName]);

  const tabs = [
    { label: 'Meta Tags', icon: <TagIcon size={14} /> },
    { label: 'Open Graph', icon: <Share2 size={14} /> },
    { label: 'Sitemap', icon: <MapIcon size={14} /> },
    { label: 'robots.txt', icon: <Bot size={14} /> },
  ];

  return (
    // Mobile: single vertical scroll, sidebar stacks below. Desktop: bounded two-pane with inner scroll.
    <div className="flex flex-col md:flex-row h-full bg-[#0d1117] text-white overflow-y-auto md:overflow-hidden">
      {/* Main area */}
      <div className="w-full md:flex-1 min-w-0 flex flex-col md:overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 px-5 pt-4 pb-0 border-b border-white/10">
          <div className="flex items-center gap-2 mb-3">
            <Search size={16} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-white/90">SEO Optimizer</h2>
            <span className="text-xs text-white/30 ml-1">— meta tags, OG, sitemap &amp; robots</span>
          </div>
          {/* Tabs — scroll horizontally on narrow phones instead of clipping */}
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {tabs.map((t, i) => (
              <button
                key={i}
                onClick={() => setTab(i)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-colors ${
                  tab === i
                    ? 'text-blue-400 border-blue-400 bg-blue-500/10'
                    : 'text-white/40 border-transparent hover:text-white/70'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Save into the user's REAL page. This used to update only the on-screen preview, so the
            SEO tags never reached the file — and search engines never saw any of them. */}
        <div className="flex-shrink-0 border-b border-white/10 bg-blue-500/5">
          <AppTargetPicker
            apps={apps}
            appsLoading={appsLoading}
            files={appFiles}
            filesLoading={filesLoading}
            sessionId={targetSession}
            onSessionChange={(sid) => { setTargetSession(sid); setTargetPath(''); setSaveNote(''); }}
            selectedPath={targetPath}
            onPathChange={(pth) => { setTargetPath(pth); setSaveNote(''); }}
            fileFilter={(f) => /\.html?$/i.test(f.path)}
            fileLabel="Add the SEO tags to"
          />
          {apps.length > 0 && (
            <div className="px-3 pb-3">
              <button
                onClick={() => void saveSeoToApp()}
                disabled={!targetSession || !targetPath || saving}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {saving ? 'Saving into your app…' : 'Save SEO tags into my app'}
              </button>
              <p className="mt-2 text-[11px] text-white/40 leading-snug">
                A restore point is saved first, so you can undo this from Versioning. Running it again
                replaces the same tags rather than adding a second copy.
              </p>
              {saveNote && (
                <p className={`mt-2 px-3 py-2 rounded-lg text-xs leading-relaxed ${saveFailed ? 'text-amber-300 bg-amber-500/10' : 'text-green-300 bg-green-500/10'}`}>
                  {saveNote}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Tab content */}
        <div className="flex-1 md:overflow-hidden p-4">
          {tab === 0 && (
            <MetaTab meta={meta} setMeta={setMeta} generatedCode={appHtml} copy={copy} copied={copied} />
          )}
          {tab === 1 && (
            <OGTab og={og} setOG={setOG} metaTitle={meta.pageTitle} metaDesc={meta.description} copy={copy} copied={copied} />
          )}
          {tab === 2 && (
            <SitemapTab pages={pages} setPages={setPages} generatedCode={appHtml} copy={copy} copied={copied} />
          )}
          {tab === 3 && (
            <RobotsTab robots={robotsCfg} setRobots={setRobotsCfg} copy={copy} copied={copied} />
          )}
        </div>
      </div>

      {/* Score sidebar */}
      <div className="w-full md:w-auto flex-shrink-0 p-4 border-t border-white/10 md:border-t-0 md:border-l md:overflow-y-auto pb-24 md:pb-4">
        <ScoreSidebar meta={meta} og={og} pages={pages} />
      </div>
    </div>
  );
};

export default SEOOptimizer;
