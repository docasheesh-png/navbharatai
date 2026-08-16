import React, { useState, useRef, useEffect } from 'react';
import { escapeHtml } from '../../lib/escapeHtml';
import {
  Plus, FileCode, GripVertical, MoreVertical, Pencil, Copy, Trash2,
  Download, FolderOpen, FileText, Globe, Layout, Eye, X, ChevronRight,
  Palette, AlignLeft, Menu, Layers, Check, Monitor, RefreshCw, Loader2, History, AlertTriangle
} from 'lucide-react';
import { AppTargetPicker, useUserApps, useAppFiles, saveFilesToApp } from './AppTargetPicker';
import { useIsNarrow } from '../../hooks/useIsNarrow';

// ─── Types ────────────────────────────────────────────────────────────────────

type PageType = 'content' | 'form' | 'dashboard' | 'landing';
type NavStyle = 'horizontal' | 'vertical' | 'hamburger';
type ColorScheme = 'dark' | 'light' | 'colorful' | 'minimal';
type EditorTab = 'content' | 'settings';

interface PageSettings {
  slug: string;
  metaDescription: string;
  includeInNav: boolean;
  pageType: PageType;
}

interface Page {
  id: string;
  name: string;
  title: string;
  code: string;
  settings: PageSettings;
}

interface NavConfig {
  style: NavStyle;
  logoText: string;
  colorScheme: ColorScheme;
}

interface MultiPageBuilderProps {
  initialCode?: string;
  /** Preview handoff — the pages are saved into the real app by this tool itself. */
  onExport?: (pages: Record<string, string>) => void;
  /** The app the user is currently working on, pre-selected in the picker. */
  sessionId?: string;
  /** Hand a page's spec to the REAL engine (Pro v5.0). Replaces the dead /api/generate "AI Generate"
   *  call (admin autopsy 2026-07-21). */
  onBuildViaV5?: (prompt: string) => void;
}

// ─── Default HTML templates ───────────────────────────────────────────────────

const HOME_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Home</title>
</head>
<body>
  <section style="padding:80px 40px;text-align:center;background:#0f172a;color:#f1f5f9;min-height:100vh">
    <h1 style="font-size:3rem;font-weight:700;margin-bottom:1rem">Welcome to Our Site</h1>
    <p style="font-size:1.25rem;color:#94a3b8;max-width:600px;margin:0 auto 2rem">
      Your amazing tagline goes here. Tell visitors what you do in one sentence.
    </p>
    <a href="about.html" style="display:inline-block;padding:14px 32px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
      Learn More →
    </a>
  </section>
</body>
</html>`;

const ABOUT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>About</title>
</head>
<body>
  <section style="padding:80px 40px;background:#0f172a;color:#f1f5f9;min-height:100vh;max-width:800px;margin:0 auto">
    <h1 style="font-size:2.5rem;font-weight:700;margin-bottom:1.5rem">About Us</h1>
    <p style="font-size:1.1rem;color:#94a3b8;line-height:1.8;margin-bottom:1.5rem">
      We are a passionate team dedicated to building great products. Our mission is to
      deliver exceptional value to our users through thoughtful design and robust engineering.
    </p>
    <p style="font-size:1.1rem;color:#94a3b8;line-height:1.8">
      Founded in 2024, we have grown from a small startup to a team of talented individuals
      all focused on making your experience as seamless as possible.
    </p>
  </section>
</body>
</html>`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

function makeFilename(page: Page): string {
  if (page.settings.slug === 'index' || page.name.toLowerCase() === 'home') return 'index.html';
  return `${page.settings.slug || slugify(page.name)}.html`;
}

// escNav escapes user-controlled values (page title/name, logo text, filename) before they go into the
// generated nav markup — which is both written into the app AND injected into a same-origin preview
// via dangerouslySetInnerHTML, so an unescaped `<img src=x onerror=…>` page title would run in-origin.
const escNav = escapeHtml;

function generateNav(pages: Page[], config: NavConfig): string {
  const navPages = pages.filter((p) => p.settings.includeInNav);
  const links = navPages
    .map((p) => {
      const href = escNav(makeFilename(p));
      return `<a href="${href}" style="${linkStyle(config.colorScheme)}">${escNav(p.title || p.name)}</a>`;
    })
    .join('\n    ');

  const bg = navBg(config.colorScheme);
  const textColor = config.colorScheme === 'light' ? '#1e293b' : '#f1f5f9';

  if (config.style === 'vertical') {
    return `<nav style="width:220px;min-height:100vh;background:${bg};padding:24px 16px;display:flex;flex-direction:column;gap:8px;position:fixed;top:0;left:0">
  <div style="font-weight:700;font-size:1.1rem;color:${textColor};margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.1)">${escNav(config.logoText)}</div>
  ${links}
</nav>`;
  }

  return `<nav style="background:${bg};padding:0 32px;display:flex;align-items:center;gap:24px;height:60px;position:sticky;top:0;z-index:100;box-shadow:0 1px 0 rgba(255,255,255,0.1)">
  <span style="font-weight:700;font-size:1.1rem;color:${textColor};margin-right:auto">${escNav(config.logoText)}</span>
  ${links}
</nav>`;
}

// ⚠️ LITERAL HEXES ON PURPOSE — these colours go into the HTML this tool GENERATES for the user's
// own page, not into NavBharatAI's chrome. A theme var here would leak our palette into their app
// (and resolve to nothing outside our page). The theme sweep of 2026-08-16 skipped them by design.
function navBg(scheme: ColorScheme): string {
  switch (scheme) {
    case 'light': return '#ffffff';
    case 'colorful': return '#6366f1';
    case 'minimal': return 'transparent';
    default: return '#161b22';
  }
}

function linkStyle(scheme: ColorScheme): string {
  const color = scheme === 'light' ? '#1e293b' : scheme === 'colorful' ? '#ffffff' : '#94a3b8';
  return `color:${color};text-decoration:none;font-size:0.95rem;padding:6px 12px;border-radius:6px;transition:opacity .2s`;
}

function injectNav(html: string, navHtml: string): string {
  if (html.includes('<body')) {
    return html.replace(/(<body[^>]*>)/i, `$1\n${navHtml}`);
  }
  return navHtml + '\n' + html;
}

function buildExportPages(pages: Page[], navConfig: NavConfig): Record<string, string> {
  const navHtml = generateNav(pages, navConfig);
  const result: Record<string, string> = {};
  pages.forEach((page) => {
    const filename = makeFilename(page);
    result[filename] = injectNav(page.code, navHtml);
  });
  result['assets/style.css'] = generateSharedCSS(navConfig);
  return result;
}

function generateSharedCSS(config: NavConfig): string {
  return `/* Shared navigation styles — generated by MultiPageBuilder */
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
nav a:hover { opacity: 0.8; }
`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface PageItemProps {
  page: Page;
  isActive: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canDelete: boolean;
  isHome: boolean;
}

function PageItem({ page, isActive, onSelect, onRename, onDuplicate, onDelete, canDelete, isHome }: PageItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(page.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== page.name) onRename(trimmed);
    else setDraft(page.name);
    setEditing(false);
  };

  return (
    <div
      onClick={onSelect}
      className="group relative flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer select-none"
      style={{
        background: isActive ? 'rgba(99,102,241,0.15)' : 'transparent',
        border: isActive ? '1px solid rgba(99,102,241,0.4)' : '1px solid transparent',
      }}
    >
      {/* Drag handle — visual only */}
      <GripVertical size={12} style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />

      <FileCode size={14} style={{ color: isActive ? '#818cf8' : 'rgba(255,255,255,0.5)', flexShrink: 0 }} />

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') { setDraft(page.name); setEditing(false); }
          }}
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(99,102,241,0.6)',
            borderRadius: 4,
            color: '#f1f5f9',
            fontSize: 13,
            padding: '1px 6px',
            outline: 'none',
          }}
        />
      ) : (
        <span
          style={{ flex: 1, fontSize: 13, color: isActive ? '#e2e8f0' : 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
        >
          {page.name}
        </span>
      )}

      {/* 3-dot menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '2px 2px',
            color: 'rgba(255,255,255,0.4)', borderRadius: 4, display: 'flex', alignItems: 'center',
          }}
        >
          <MoreVertical size={13} />
        </button>

        {menuOpen && (
          <div
            style={{
              position: 'absolute', right: 0, top: '100%', zIndex: 200,
              background: '#1e2533', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '4px 0', minWidth: 130, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}
          >
            <MenuItem icon={<Pencil size={12} />} label="Rename" onClick={() => { setEditing(true); setMenuOpen(false); }} />
            <MenuItem icon={<Copy size={12} />} label="Duplicate" onClick={() => { onDuplicate(); setMenuOpen(false); }} />
            {!isHome && canDelete && (
              <MenuItem icon={<Trash2 size={12} />} label="Delete" onClick={() => { onDelete(); setMenuOpen(false); }} danger />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger = false }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', cursor: 'pointer',
        background: hovered ? 'rgba(255,255,255,0.07)' : 'none',
        padding: '6px 12px', fontSize: 13,
        color: danger ? '#f87171' : 'rgba(255,255,255,0.8)',
        transition: 'background 0.15s',
      }}
    >
      {icon} {label}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export const MultiPageBuilder: React.FC<MultiPageBuilderProps> = ({ initialCode, onExport, onBuildViaV5, sessionId }) => {
  const MAX_PAGES = 10;

  const defaultPages: Page[] = [
    {
      id: uid(),
      name: 'Home',
      title: 'Home',
      code: initialCode || HOME_TEMPLATE,
      settings: { slug: 'index', metaDescription: 'Welcome to our site', includeInNav: true, pageType: 'landing' },
    },
    {
      id: uid(),
      name: 'About',
      title: 'About',
      code: ABOUT_TEMPLATE,
      settings: { slug: 'about', metaDescription: 'Learn more about us', includeInNav: true, pageType: 'content' },
    },
  ];

  const [pages, setPages] = useState<Page[]>(defaultPages);
  const [activePageId, setActivePageId] = useState<string>(defaultPages[0].id);
  const [editorTab, setEditorTab] = useState<EditorTab>('content');
  const [navConfig, setNavConfig] = useState<NavConfig>({ style: 'horizontal', logoText: 'My Site', colorScheme: 'dark' });
  const [siteName, setSiteName] = useState('My App');
  const [siteDescription, setSiteDescription] = useState('A modern multi-page website');
  const [showPreview, setShowPreview] = useState(false);
  const [showNavPreview, setShowNavPreview] = useState(false);
  const [navPreviewHtml, setNavPreviewHtml] = useState('');
  const [generating, setGenerating] = useState(false);
  const [showExportStructure, setShowExportStructure] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Saving into the user's REAL app (admin 2026-07-27) — see handleExportToWorkspace for the two
  // bugs this replaces. Only the app is chosen here; the file NAMES come from the page names.
  const { apps, loading: appsLoading, selected: targetSession, setSelected: setTargetSession } = useUserApps(sessionId);
  const { files: appFiles, loading: filesLoading, reload: reloadFiles } = useAppFiles(targetSession);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);

  // Three fixed-width panels side by side do not fit a phone, so on a narrow screen they become one
  // panel at a time with a switcher.
  const narrow = useIsNarrow();
  const [mobilePanel, setMobilePanel] = useState<'pages' | 'editor' | 'export'>('editor');

  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0];

  // Update iframe when preview is shown or code changes
  useEffect(() => {
    if (showPreview && iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(activePage.code);
        doc.close();
      }
    }
  }, [showPreview, activePage.code, activePageId]);

  // ── Page management ──────────────────────────────────────────────────────────

  function addPage() {
    if (pages.length >= MAX_PAGES) return;
    const count = pages.length + 1;
    const name = `Page ${count}`;
    const newPage: Page = {
      id: uid(),
      name,
      title: name,
      code: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <title>${name}</title>\n</head>\n<body style="background:#0f172a;color:#f1f5f9;padding:80px 40px;font-family:system-ui,sans-serif">\n  <h1>${name}</h1>\n  <p>Add your content here.</p>\n</body>\n</html>`,
      settings: { slug: slugify(name), metaDescription: '', includeInNav: true, pageType: 'content' },
    };
    setPages((prev) => [...prev, newPage]);
    setActivePageId(newPage.id);
  }

  function updatePage(id: string, patch: Partial<Page>) {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function updatePageSettings(id: string, patch: Partial<PageSettings>) {
    setPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, settings: { ...p.settings, ...patch } } : p))
    );
  }

  function renamePage(id: string, newName: string) {
    setPages((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const slug = p.name.toLowerCase() === 'home' ? 'index' : slugify(newName);
        return { ...p, name: newName, title: newName, settings: { ...p.settings, slug } };
      })
    );
  }

  function duplicatePage(id: string) {
    if (pages.length >= MAX_PAGES) return;
    const source = pages.find((p) => p.id === id);
    if (!source) return;
    const newName = `${source.name} Copy`;
    const copy: Page = {
      ...source,
      id: uid(),
      name: newName,
      title: newName,
      settings: { ...source.settings, slug: slugify(newName) },
    };
    setPages((prev) => [...prev, copy]);
    setActivePageId(copy.id);
  }

  function deletePage(id: string) {
    if (pages.length <= 1) return;
    const idx = pages.findIndex((p) => p.id === id);
    const newPages = pages.filter((p) => p.id !== id);
    setPages(newPages);
    if (activePageId === id) {
      setActivePageId(newPages[Math.max(0, idx - 1)].id);
    }
  }

  // ── AI Generate ──────────────────────────────────────────────────────────────

  function handleAIGenerate() {
    // Hand this page's spec to the REAL engine (Pro v5.0) — the old /api/generate call never existed,
    // so this button used to spin and silently do nothing (admin autopsy 2026-07-21). The manual
    // multi-page editor + export below stay fully local and real.
    onBuildViaV5?.(
      `Build a "${activePage.name}" page for this website: ${siteDescription}. Match the style of the site's other pages.`,
    );
  }

  // ── Nav preview ──────────────────────────────────────────────────────────────

  function handleNavPreview() {
    const html = generateNav(pages, navConfig);
    setNavPreviewHtml(html);
    setShowNavPreview(true);
  }

  // ── Export ───────────────────────────────────────────────────────────────────

  /**
   * Save EVERY page into the user's real app, as real files, under ONE restore point.
   *
   * Two bugs are fixed here at once (admin 2026-07-27). The old handler passed the whole page map to
   * `onExport`, whose only caller took `Object.values(pages)[0]` and pushed that single page into the
   * in-memory preview — so building a five-page site produced one page on screen and silently threw
   * the other four away. Now all of them, plus the shared stylesheet, are written to storage in a
   * single batch, so the site is either fully saved or not saved at all.
   */
  async function handleExportToWorkspace() {
    if (!targetSession || saving) return;
    setSaving(true);
    setSaveNote('');
    setSaveFailed(false);
    try {
      const exportPages = buildExportPages(pages, navConfig);
      const outcome = await saveFilesToApp(
        targetSession,
        exportPages,
        `Before saving ${Object.keys(exportPages).length} page(s) from the Multi-Page Builder`,
      );
      if (!outcome.ok) {
        setSaveFailed(true);
        setSaveNote(outcome.error || 'Could not save. Your app is unchanged.');
        return;
      }
      if (outcome.unchanged) {
        setSaveNote('Your app already has exactly these pages — nothing needed changing.');
        return;
      }
      setSaveNote(
        `Saved ${outcome.written.length} file${outcome.written.length === 1 ? '' : 's'} into your app: ` +
        `${outcome.written.join(', ')}. ${outcome.undoHint || ''}`.trim(),
      );
      void reloadFiles(targetSession);
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 2500);
      onExport?.(exportPages);
    } catch {
      setSaveFailed(true);
      setSaveNote('Could not reach the server. Your app is unchanged.');
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: narrow ? 'column' : 'row',
        height: '100%',
        minHeight: narrow ? 0 : 600,
        background: 'var(--surface-base)',
        color: '#e2e8f0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'hidden',
        borderRadius: 8,
      }}
    >
      {/* On a phone the three panels cannot sit side by side — 220 + 280 leaves nothing for the
          editor — so they become one at a time behind this switcher. */}
      {narrow && (
        <div
          style={{
            display: 'flex', flexShrink: 0, background: 'var(--surface-card)',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          {([['pages', `Pages (${pages.length})`], ['editor', 'Editor'], ['export', 'Save & Nav']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMobilePanel(id)}
              style={{
                flex: 1, padding: '11px 4px', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 600,
                background: mobilePanel === id ? 'rgba(99,102,241,0.2)' : 'transparent',
                color: mobilePanel === id ? '#818cf8' : 'rgba(255,255,255,0.5)',
                borderBottom: mobilePanel === id ? '2px solid #6366f1' : '2px solid transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Panel 1: Page Manager ─────────────────────────────────────────────── */}
      <div
        style={{
          display: narrow && mobilePanel !== 'pages' ? 'none' : 'flex',
          width: narrow ? '100%' : 220,
          flex: narrow ? 1 : undefined,
          flexShrink: 0,
          background: 'var(--surface-card)',
          borderRight: narrow ? 'none' : '1px solid rgba(255,255,255,0.1)',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 12px 8px', borderBottom: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.5)' }}>
            Pages
          </span>
          <button
            onClick={addPage}
            disabled={pages.length >= MAX_PAGES}
            title={pages.length >= MAX_PAGES ? 'Max 10 pages' : 'Add page'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: 6,
              background: pages.length >= MAX_PAGES ? 'rgba(255,255,255,0.04)' : 'rgba(99,102,241,0.15)',
              border: '1px solid rgba(99,102,241,0.3)',
              color: pages.length >= MAX_PAGES ? 'rgba(255,255,255,0.2)' : '#818cf8',
              cursor: pages.length >= MAX_PAGES ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <Plus size={13} />
          </button>
        </div>

        {/* Page list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
          {pages.map((page) => (
            <PageItem
              key={page.id}
              page={page}
              isActive={page.id === activePageId}
              onSelect={() => setActivePageId(page.id)}
              onRename={(name) => renamePage(page.id, name)}
              onDuplicate={() => duplicatePage(page.id)}
              onDelete={() => deletePage(page.id)}
              canDelete={pages.length > 1}
              isHome={page.name.toLowerCase() === 'home'}
            />
          ))}
        </div>

        {/* Page count */}
        <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.07)', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
          {pages.length} / {MAX_PAGES} pages
        </div>
      </div>

      {/* ── Panel 2: Page Editor ──────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: narrow && mobilePanel !== 'editor' ? 'none' : 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Tabs */}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 0,
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            background: 'var(--surface-card)', paddingLeft: 16, flexShrink: 0,
          }}
        >
          {(['content', 'settings'] as EditorTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setEditorTab(tab)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '10px 18px', fontSize: 13, fontWeight: 500,
                color: editorTab === tab ? '#818cf8' : 'rgba(255,255,255,0.45)',
                borderBottom: editorTab === tab ? '2px solid #6366f1' : '2px solid transparent',
                transition: 'all 0.15s', marginBottom: -1,
              }}
            >
              {tab === 'content' ? 'Page Content' : 'Page Settings'}
            </button>
          ))}

          {/* Active page chip */}
          <div style={{ marginLeft: 'auto', marginRight: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileCode size={12} style={{ color: '#818cf8' }} />
            <span style={{ fontSize: 12, color: '#818cf8', fontWeight: 500 }}>{activePage.name}</span>
          </div>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {editorTab === 'content' ? (
            <ContentTab
              page={activePage}
              onCodeChange={(code) => updatePage(activePageId, { code })}
              onTitleChange={(title) => updatePage(activePageId, { title })}
              onAIGenerate={handleAIGenerate}
              generating={generating}
              showPreview={showPreview}
              onTogglePreview={() => setShowPreview((v) => !v)}
              iframeRef={iframeRef}
            />
          ) : (
            <SettingsTab
              page={activePage}
              onSettingsChange={(patch) => updatePageSettings(activePageId, patch)}
              onTitleChange={(title) => updatePage(activePageId, { title })}
            />
          )}
        </div>
      </div>

      {/* ── Panel 3: Export & Navigation ─────────────────────────────────────── */}
      <div
        style={{
          width: narrow ? '100%' : 280,
          flex: narrow ? 1 : undefined,
          flexShrink: 0,
          background: 'var(--surface-card)',
          borderLeft: narrow ? 'none' : '1px solid rgba(255,255,255,0.1)',
          display: narrow && mobilePanel !== 'export' ? 'none' : 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        {/* Navigation Generator */}
        <Card title="Navigation" icon={<Layout size={14} />}>
          <FieldLabel>Nav Style</FieldLabel>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {(['horizontal', 'vertical', 'hamburger'] as NavStyle[]).map((s) => (
              <NavStyleBtn
                key={s}
                active={navConfig.style === s}
                label={s.charAt(0).toUpperCase() + s.slice(1)}
                icon={s === 'horizontal' ? <AlignLeft size={11} /> : s === 'vertical' ? <Layers size={11} /> : <Menu size={11} />}
                onClick={() => setNavConfig((c) => ({ ...c, style: s }))}
              />
            ))}
          </div>

          <FieldLabel>Logo Text</FieldLabel>
          <input
            value={navConfig.logoText}
            onChange={(e) => setNavConfig((c) => ({ ...c, logoText: e.target.value }))}
            style={inputStyle}
          />

          <FieldLabel>Color Scheme</FieldLabel>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {(['dark', 'light', 'colorful', 'minimal'] as ColorScheme[]).map((scheme) => (
              <ColorChip
                key={scheme}
                scheme={scheme}
                active={navConfig.colorScheme === scheme}
                onClick={() => setNavConfig((c) => ({ ...c, colorScheme: scheme }))}
              />
            ))}
          </div>

          <button onClick={handleNavPreview} style={secondaryBtnStyle}>
            <Eye size={12} /> Preview Nav
          </button>
        </Card>

        {/* Export */}
        <Card title="Export" icon={<Download size={14} />}>
          <button onClick={() => setShowExportStructure((v) => !v)} style={secondaryBtnStyle}>
            <FolderOpen size={12} /> {showExportStructure ? 'Hide' : 'Show'} File Structure
          </button>

          {showExportStructure && (
            <div
              style={{
                marginTop: 10, background: 'var(--surface-base)', borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.08)', padding: '10px 12px',
                fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7,
                color: 'rgba(255,255,255,0.65)',
              }}
            >
              <div>📁 {siteName.toLowerCase().replace(/\s+/g, '-')}/</div>
              {pages.map((p) => (
                <div key={p.id} style={{ paddingLeft: 16 }}>📄 {makeFilename(p)}</div>
              ))}
              <div style={{ paddingLeft: 16 }}>📁 assets/</div>
              <div style={{ paddingLeft: 32 }}>📄 style.css</div>
            </div>
          )}

          {/* Which app receives these pages. Without this the tool had no idea where to put them
              and quietly used whatever preview happened to be open. */}
          <div style={{ marginTop: 10, marginLeft: -12, marginRight: -12 }}>
            <AppTargetPicker
              apps={apps}
              appsLoading={appsLoading}
              files={appFiles}
              filesLoading={filesLoading}
              sessionId={targetSession}
              onSessionChange={(sid) => { setTargetSession(sid); setSaveNote(''); }}
            />
          </div>

          {apps.length > 0 && (
            <>
              <button
                onClick={() => void handleExportToWorkspace()}
                disabled={!targetSession || saving}
                style={{
                  ...primaryBtnStyle, marginTop: 4, padding: '13px 0', fontSize: 15, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  cursor: !targetSession || saving ? 'not-allowed' : 'pointer',
                  opacity: !targetSession || saving ? 0.4 : 1,
                }}
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : exportSuccess ? <Check size={15} /> : <Globe size={15} />}
                {saving ? 'Saving into your app…' : `Save ${pages.length} page${pages.length === 1 ? '' : 's'} into my app`}
              </button>
              <p style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5, display: 'flex', gap: 5 }}>
                <History size={11} style={{ marginTop: 2, flexShrink: 0 }} />
                Every page is saved together, under one restore point you can undo from Versioning.
              </p>
              {saveNote && (
                <p style={{
                  marginTop: 8, fontSize: 12, lineHeight: 1.5, padding: '8px 10px', borderRadius: 8,
                  color: saveFailed ? '#fcd34d' : '#86efac',
                  background: saveFailed ? 'rgba(245,158,11,0.1)' : 'rgba(63,185,80,0.1)',
                  display: 'flex', gap: 6, wordBreak: 'break-word',
                }}>
                  {saveFailed && <AlertTriangle size={12} style={{ marginTop: 2, flexShrink: 0 }} />}
                  <span>{saveNote}</span>
                </p>
              )}
            </>
          )}
        </Card>

        {/* Site Info */}
        <Card title="Site Info" icon={<Monitor size={14} />}>
          <FieldLabel>Site Name</FieldLabel>
          <input value={siteName} onChange={(e) => setSiteName(e.target.value)} style={inputStyle} />

          <FieldLabel>Site Description</FieldLabel>
          <textarea
            value={siteDescription}
            onChange={(e) => setSiteDescription(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
          />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Total pages</span>
            <span
              style={{
                fontSize: 12, fontWeight: 700, background: 'rgba(99,102,241,0.2)',
                color: '#818cf8', padding: '2px 10px', borderRadius: 99,
                border: '1px solid rgba(99,102,241,0.3)',
              }}
            >
              {pages.length}
            </span>
          </div>
        </Card>
      </div>

      {/* Nav preview modal */}
      {showNavPreview && (
        <Modal title="Nav HTML Preview" onClose={() => setShowNavPreview(false)}>
          <pre
            style={{
              fontFamily: 'monospace', fontSize: 12, color: '#a5f3fc',
              background: 'var(--surface-base)', padding: 16, borderRadius: 8,
              overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              maxHeight: 300, overflowY: 'auto',
            }}
          >
            {navPreviewHtml}
          </pre>
          <div
            style={{ marginTop: 12, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, overflow: 'hidden', background: '#fff' }}
            dangerouslySetInnerHTML={{ __html: navPreviewHtml }}
          />
        </Modal>
      )}
    </div>
  );
};

// ─── Content Tab ──────────────────────────────────────────────────────────────

interface ContentTabProps {
  page: Page;
  onCodeChange: (code: string) => void;
  onTitleChange: (title: string) => void;
  onAIGenerate: () => void;
  generating: boolean;
  showPreview: boolean;
  onTogglePreview: () => void;
  iframeRef: React.RefObject<HTMLIFrameElement>;
}

function ContentTab({ page, onCodeChange, onTitleChange, onAIGenerate, generating, showPreview, onTogglePreview, iframeRef }: ContentTabProps) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16, gap: 12 }}>
      {/* Page title */}
      <div>
        <FieldLabel>Page Title</FieldLabel>
        <input
          value={page.title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="e.g. Home, About, Contact"
          style={inputStyle}
        />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={onAIGenerate}
          disabled={generating}
          style={{
            ...primaryBtnStyle,
            display: 'flex', alignItems: 'center', gap: 6,
            opacity: generating ? 0.6 : 1,
            cursor: generating ? 'not-allowed' : 'pointer',
          }}
        >
          <ChevronRight size={12} />
          Build in Pro v5.0
        </button>

        <button
          onClick={onTogglePreview}
          style={{ ...secondaryBtnStyle, display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}
        >
          <Eye size={12} />
          {showPreview ? 'Hide Preview' : 'Preview this page'}
        </button>
      </div>

      {/* Code editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 180 }}>
        <FieldLabel>HTML Code</FieldLabel>
        <textarea
          value={page.code}
          onChange={(e) => onCodeChange(e.target.value)}
          spellCheck={false}
          style={{
            flex: 1,
            minHeight: 180,
            width: '100%',
            background: 'var(--surface-base)',
            color: '#a5f3fc',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            padding: 14,
            fontFamily: '"Fira Code", "Cascadia Code", "Consolas", monospace',
            fontSize: 12.5,
            lineHeight: 1.65,
            resize: 'vertical',
            outline: 'none',
            whiteSpace: 'pre',
            overflowX: 'auto',
            overflowWrap: 'normal',
            wordBreak: 'normal',
          }}
        />
      </div>

      {/* Inline preview */}
      {showPreview && (
        <div>
          <FieldLabel>Preview</FieldLabel>
          <div
            style={{
              height: 300, border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, overflow: 'hidden', background: '#fff',
            }}
          >
            <iframe
              ref={iframeRef}
              title="page-preview"
              style={{ width: '100%', height: '100%', border: 'none' }}
              sandbox="allow-scripts"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

interface SettingsTabProps {
  page: Page;
  onSettingsChange: (patch: Partial<PageSettings>) => void;
  onTitleChange: (title: string) => void;
}

function SettingsTab({ page, onSettingsChange, onTitleChange }: SettingsTabProps) {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <FieldLabel>Page Title</FieldLabel>
        <input value={page.title} onChange={(e) => onTitleChange(e.target.value)} style={inputStyle} />
      </div>

      <div>
        <FieldLabel>Page Slug</FieldLabel>
        <input
          value={page.settings.slug}
          onChange={(e) => onSettingsChange({ slug: e.target.value })}
          placeholder="e.g. about, contact"
          style={inputStyle}
        />
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
          File: {page.settings.slug === 'index' || page.name.toLowerCase() === 'home' ? 'index.html' : `${page.settings.slug || slugify(page.name)}.html`}
        </div>
      </div>

      <div>
        <FieldLabel>Meta Description</FieldLabel>
        <textarea
          value={page.settings.metaDescription}
          onChange={(e) => onSettingsChange({ metaDescription: e.target.value })}
          placeholder="Brief description for search engines…"
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
        />
      </div>

      <div>
        <FieldLabel>Include in Navigation</FieldLabel>
        <ToggleSwitch
          checked={page.settings.includeInNav}
          onChange={(v) => onSettingsChange({ includeInNav: v })}
          label={page.settings.includeInNav ? 'Visible in nav' : 'Hidden from nav'}
        />
      </div>

      <div>
        <FieldLabel>Page Type</FieldLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(['content', 'form', 'dashboard', 'landing'] as PageType[]).map((t) => (
            <button
              key={t}
              onClick={() => onSettingsChange({ pageType: t })}
              style={{
                padding: '5px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                fontWeight: 500, border: '1px solid',
                background: page.settings.pageType === t ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                borderColor: page.settings.pageType === t ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.12)',
                color: page.settings.pageType === t ? '#818cf8' : 'rgba(255,255,255,0.6)',
                transition: 'all 0.15s',
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Small reusable UI pieces ─────────────────────────────────────────────────

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      style={{
        margin: 12, border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10, overflow: 'hidden',
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)',
          background: 'rgba(255,255,255,0.03)',
        }}
      >
        <span style={{ color: '#818cf8' }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          {title}
        </span>
      </div>
      <div style={{ padding: '12px 14px' }}>{children}</div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {children}
    </div>
  );
}

function NavStyleBtn({ active, label, icon, onClick }: { active: boolean; label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        padding: '6px 4px', borderRadius: 7, cursor: 'pointer', fontSize: 10, fontWeight: 500,
        border: '1px solid',
        background: active ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
        borderColor: active ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)',
        color: active ? '#818cf8' : 'rgba(255,255,255,0.5)',
        transition: 'all 0.15s',
      }}
    >
      {icon} {label}
    </button>
  );
}

const SCHEME_COLORS: Record<ColorScheme, { bg: string; text: string }> = {
  dark: { bg: '#1e2533', text: '#f1f5f9' },
  light: { bg: '#f8fafc', text: '#1e293b' },
  colorful: { bg: '#6366f1', text: '#fff' },
  minimal: { bg: 'transparent', text: '#94a3b8' },
};

function ColorChip({ scheme, active, onClick }: { scheme: ColorScheme; active: boolean; onClick: () => void }) {
  const { bg, text } = SCHEME_COLORS[scheme];
  return (
    <button
      onClick={onClick}
      title={scheme.charAt(0).toUpperCase() + scheme.slice(1)}
      style={{
        width: 52, height: 28, borderRadius: 6, cursor: 'pointer', fontSize: 10,
        fontWeight: 600, border: active ? '2px solid #818cf8' : '2px solid rgba(255,255,255,0.15)',
        background: bg, color: text, transition: 'all 0.15s',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {scheme.charAt(0).toUpperCase() + scheme.slice(1)}
    </button>
  );
}

function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
      onClick={() => onChange(!checked)}
    >
      <div
        style={{
          width: 36, height: 20, borderRadius: 10, position: 'relative', transition: 'background 0.2s',
          background: checked ? '#6366f1' : 'rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.15)',
        }}
      >
        <div
          style={{
            position: 'absolute', top: 2, width: 14, height: 14, borderRadius: '50%',
            background: '#fff', transition: 'left 0.2s',
            left: checked ? 18 : 2,
          }}
        />
      </div>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>{label}</span>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface-card)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 12, padding: 20, maxWidth: 580, width: '90vw',
          maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0' }}>{title}</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', padding: 2 }}
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Shared style constants ───────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface-base)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 7,
  color: '#e2e8f0',
  padding: '7px 10px',
  fontSize: 13,
  outline: 'none',
  marginBottom: 12,
  boxSizing: 'border-box',
};

const primaryBtnStyle: React.CSSProperties = {
  background: 'rgba(99,102,241,0.18)',
  border: '1px solid rgba(99,102,241,0.4)',
  borderRadius: 7,
  color: '#818cf8',
  padding: '7px 14px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.15s',
};

const secondaryBtnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 7,
  color: 'rgba(255,255,255,0.65)',
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  transition: 'all 0.15s',
  marginBottom: 0,
};
