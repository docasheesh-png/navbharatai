import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { escapeHtml } from '../../lib/escapeHtml';
import { UNTRUSTED_PREVIEW_SANDBOX } from '../../lib/previewSandbox';
import {
  Link,
  Key,
  Eye,
  EyeOff,
  Info,
  Loader2,
  CheckCircle2,
  X,
  ChevronRight,
  ChevronDown,
  Copy,
  ExternalLink,
  Sparkles,
  FileCode,
  RefreshCw,
  Check,
  Clock, Save, History, AlertTriangle
} from 'lucide-react';
import { insertSnippet } from '../../lib/htmlInsert';
import { AppTargetPicker, useUserApps, useAppFiles, readAppFile, saveFilesToApp } from './AppTargetPicker';
import { TirangaLoader } from '../ui/TirangaLoader';

interface FigmaImporterProps {
  onCodeGenerated?: (code: string) => void;
  /** The app the user is currently working on, pre-selected in the picker. */
  sessionId?: string;
  /** Hand the imported design + a refine instruction to the REAL engine (Pro v5.0). Replaces the old
   *  "Refine with AI" call to /api/generate, which never existed (admin autopsy 2026-07-21). */
  onBuildViaV5?: (prompt: string) => void;
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type OutputFormat = 'Tailwind CSS' | 'Plain CSS';

interface FigmaPage {
  id: string;
  name: string;
  type: string;
  children?: FigmaFrame[];
}

interface FigmaFrame {
  id: string;
  name: string;
  type: string;
  absoluteBoundingBox?: { width: number; height: number; x: number; y: number };
  children?: any[];
  fills?: any[];
  strokes?: any[];
}

interface FigmaFileInfo {
  name: string;
  lastModified: string;
  thumbnailUrl?: string;
  pages: FigmaPage[];
}

interface ImportOptions {
  includeColors: boolean;
  includeTypography: boolean;
  includeSpacing: boolean;
  includeImages: boolean;
  outputFormat: OutputFormat;
}

interface ExtractedAssets {
  colors: string[];
  fonts: Array<{ family: string; size: number; weight: number }>;
}

// (Figma is now reached through the server proxy /api/figma/proxy — no direct browser call.)
const HISTORY_KEY = 'navbharatai_figma_history';

const extractFileKey = (url: string): string | null => {
  const match = url.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
};

const buildStyleFromNode = (node: any): string => {
  const styles: string[] = [];
  if (node.fills && node.fills.length > 0) {
    const solidFill = node.fills.find((f: any) => f.type === 'SOLID' && f.visible !== false);
    if (solidFill?.color) {
      const { r, g, b, a = 1 } = solidFill.color;
      styles.push(`background-color: rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`);
    }
  }
  if (node.style) {
    if (node.style.fontSize) styles.push(`font-size: ${node.style.fontSize}px`);
    if (node.style.fontFamily) styles.push(`font-family: '${node.style.fontFamily}', sans-serif`);
    if (node.style.fontWeight) styles.push(`font-weight: ${node.style.fontWeight}`);
    if (node.style.textAlignHorizontal) {
      styles.push(`text-align: ${node.style.textAlignHorizontal.toLowerCase()}`);
    }
  }
  if (node.cornerRadius) styles.push(`border-radius: ${node.cornerRadius}px`);
  if (node.absoluteBoundingBox) {
    styles.push(`width: ${node.absoluteBoundingBox.width}px`);
    styles.push(`height: ${node.absoluteBoundingBox.height}px`);
  }
  if (node.paddingLeft || node.paddingRight || node.paddingTop || node.paddingBottom) {
    const pt = node.paddingTop || 0;
    const pr = node.paddingRight || 0;
    const pb = node.paddingBottom || 0;
    const pl = node.paddingLeft || 0;
    styles.push(`padding: ${pt}px ${pr}px ${pb}px ${pl}px`);
  }
  return styles.join('; ');
};

const generateTailwindClasses = (node: any): string => {
  const classes: string[] = [];
  if (node.layoutMode === 'HORIZONTAL') classes.push('flex', 'flex-row');
  if (node.layoutMode === 'VERTICAL') classes.push('flex', 'flex-col');
  if (node.primaryAxisAlignItems === 'CENTER') classes.push('justify-center');
  if (node.counterAxisAlignItems === 'CENTER') classes.push('items-center');
  if (node.cornerRadius) {
    if (node.cornerRadius >= 9999) classes.push('rounded-full');
    else if (node.cornerRadius >= 16) classes.push('rounded-2xl');
    else if (node.cornerRadius >= 8) classes.push('rounded-lg');
    else classes.push('rounded');
  }
  return classes.join(' ');
};

const figmaNodeToHTML = (node: any, depth = 0, useTailwind = true): string => {
  if (!node) return '';
  const style = buildStyleFromNode(node);
  const indent = '  '.repeat(depth);
  const tw = useTailwind ? generateTailwindClasses(node) : '';
  const classAttr = tw ? ` class="${tw}"` : '';
  switch (node.type) {
    case 'FRAME':
    case 'GROUP':
    case 'COMPONENT':
    case 'INSTANCE': {
      const children = (node.children || [])
        .map((c: any) => figmaNodeToHTML(c, depth + 1, useTailwind))
        .filter(Boolean)
        .join('\n');
      return `${indent}<div${classAttr} style="${style}">\n${children}\n${indent}</div>`;
    }
    case 'TEXT':
      return `${indent}<p${classAttr} style="${style}">${node.characters || ''}</p>`;
    case 'RECTANGLE':
      return `${indent}<div${classAttr} style="${style}"></div>`;
    case 'ELLIPSE':
      return `${indent}<div${classAttr} style="${style}; border-radius: 50%;"></div>`;
    case 'VECTOR':
    case 'STAR':
    case 'POLYGON':
      return `${indent}<div${classAttr} style="${style}; border-radius: 50%;"></div>`;
    case 'LINE':
      return `${indent}<hr style="width: ${node.absoluteBoundingBox?.width || 100}px;" />`;
    default:
      return `${indent}<!-- ${node.type}: ${node.name} -->`;
  }
};

const extractColors = (node: any, colors: Set<string> = new Set()): string[] => {
  if (node.fills) {
    node.fills.forEach((fill: any) => {
      if (fill.type === 'SOLID' && fill.color && fill.visible !== false) {
        const { r, g, b } = fill.color;
        colors.add(`rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`);
      }
    });
  }
  (node.children || []).forEach((c: any) => extractColors(c, colors));
  return Array.from(colors).slice(0, 12);
};

const extractTypography = (node: any, fonts: Map<string, any> = new Map()): Array<{ family: string; size: number; weight: number }> => {
  if (node.type === 'TEXT' && node.style) {
    const key = `${node.style.fontFamily}-${node.style.fontSize}-${node.style.fontWeight}`;
    if (!fonts.has(key)) {
      fonts.set(key, {
        family: node.style.fontFamily || 'Inter',
        size: node.style.fontSize || 14,
        weight: node.style.fontWeight || 400,
      });
    }
  }
  (node.children || []).forEach((c: any) => extractTypography(c, fonts));
  return Array.from(fonts.values()).slice(0, 8);
};

const loadHistory = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
};

const saveHistory = (fileKey: string) => {
  const prev = loadHistory().filter((k) => k !== fileKey);
  localStorage.setItem(HISTORY_KEY, JSON.stringify([fileKey, ...prev].slice(0, 3)));
};

export const FigmaImporter: React.FC<FigmaImporterProps> = ({ onCodeGenerated, onBuildViaV5, sessionId }) => {
  const [figmaUrl, setFigmaUrl] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [showTokenHelp, setShowTokenHelp] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [connectionError, setConnectionError] = useState('');

  const [fileInfo, setFileInfo] = useState<FigmaFileInfo | null>(null);
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
  const [selectedFrame, setSelectedFrame] = useState<FigmaFrame | null>(null);
  const [selectedFrameNode, setSelectedFrameNode] = useState<any>(null);

  const [importOptions, setImportOptions] = useState<ImportOptions>({
    includeColors: true,
    includeTypography: true,
    includeSpacing: true,
    includeImages: false,
    outputFormat: 'Tailwind CSS',
  });

  const [isImporting, setIsImporting] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');

  // Saving the imported design into the user's REAL app (admin 2026-07-27). The Figma fetch was
  // always genuine, but the generated HTML only ever reached the on-screen preview — there was no
  // way to keep it, and no way to say which app it belonged to.
  const { apps, loading: appsLoading, selected: targetSession, setSelected: setTargetSession } = useUserApps(sessionId);
  const { files: appFiles, loading: filesLoading, reload: reloadFiles } = useAppFiles(targetSession);
  const [targetPath, setTargetPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const [extractedAssets, setExtractedAssets] = useState<ExtractedAssets>({ colors: [], fonts: [] });
  const [copied, setCopied] = useState(false);
  const [aiRefineOpen, setAiRefineOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isRefining, setIsRefining] = useState(false);

  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const validateUrl = (url: string) => {
    if (!url) { setUrlError(''); return; }
    if (!url.includes('figma.com')) {
      setUrlError('Paste a valid Figma URL');
    } else {
      setUrlError('');
    }
  };

  const handleConnect = useCallback(async () => {
    if (!figmaUrl || !token) return;
    const fileKey = extractFileKey(figmaUrl);
    if (!fileKey) { setUrlError('Paste a valid Figma URL'); return; }

    setConnectionStatus('connecting');
    setConnectionError('');
    setFileInfo(null);
    setGeneratedCode('');

    try {
      // Route through NavBharatAI's server-side Figma proxy (admin autopsy 2026-07-21): a direct
      // browser call to api.figma.com is CORS-blocked, so the import never worked. The proxy fetches
      // server-side with your token and returns the file JSON (with Figma's status for 403/404).
      const res = await fetch('/api/figma/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey, token }),
      });
      const payload = await res.json().catch(() => null);
      const figmaStatus = payload?.status ?? res.status;
      if (figmaStatus === 403) throw new Error('Token is invalid — check it in your Figma settings');
      if (figmaStatus === 404) throw new Error('File not found — check the URL again');
      if (!res.ok || !payload?.data) throw new Error((payload && payload.error) || `Figma API error: ${figmaStatus}`);

      const data = payload.data as any;
      const pages: FigmaPage[] = (data.document?.children || []).map((page: any) => ({
        id: page.id,
        name: page.name,
        type: page.type,
        children: (page.children || []).filter((n: any) => n.type === 'FRAME' || n.type === 'COMPONENT'),
      }));

      setFileInfo({
        name: data.name || 'Figma File',
        lastModified: data.lastModified || '',
        thumbnailUrl: data.thumbnailUrl,
        pages,
      });
      setConnectionStatus('connected');
      saveHistory(fileKey);
      setHistory(loadHistory());
    } catch (err: any) {
      setConnectionError(err?.message || 'Connection failed — please try again in a moment.');
      setConnectionStatus('error');
    }
  }, [figmaUrl, token]);

  const togglePage = (pageId: string) => {
    setExpandedPages((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  };

  const handleSelectFrame = (frame: FigmaFrame, rawNode: any) => {
    setSelectedFrame(frame);
    setSelectedFrameNode(rawNode);
  };

  const handleImport = useCallback(async () => {
    if (!selectedFrameNode) return;
    setIsImporting(true);
    try {
      const useTailwind = importOptions.outputFormat === 'Tailwind CSS';
      const html = figmaNodeToHTML(selectedFrameNode, 0, useTailwind);
      const colors = importOptions.includeColors ? extractColors(selectedFrameNode) : [];
      const fonts = importOptions.includeTypography ? extractTypography(selectedFrameNode) : [];

      const colorVars = colors.map((c, i) => `  --color-${i + 1}: ${c};`).join('\n');
      let output = '';
      if (!useTailwind) {
        output += `<style>\n:root {\n${colorVars}\n}\n</style>\n\n`;
      }
      output += `<!-- Frame: ${selectedFrame?.name} -->\n${html}`;

      setGeneratedCode(output);
      setExtractedAssets({ colors, fonts });
      onCodeGenerated?.(output);
    } finally {
      setIsImporting(false);
    }
  }, [selectedFrameNode, selectedFrame, importOptions, onCodeGenerated]);

  /** A safe file name for the imported frame, e.g. "Hero Section" → "pages/hero-section.html". */
  const suggestedPath = useMemo(() => {
    const slug = (selectedFrame?.name || 'figma-import')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'figma-import';
    return `pages/${slug}.html`;
  }, [selectedFrame]);

  useEffect(() => {
    if (!targetPath) setTargetPath(suggestedPath);
  }, [suggestedPath, targetPath]);

  /**
   * Save the imported design into the user's app.
   *
   * A NEW file becomes a complete standalone page — the import is a fragment, and a fragment written
   * to disk on its own is not something a browser can open. Adding to an EXISTING page appends the
   * markup to its body instead, so the page it already has is not thrown away.
   */
  const saveDesignToApp = useCallback(async () => {
    if (!targetSession || !targetPath || saving || !generatedCode) return;
    setSaving(true);
    setSaveNote('');
    setSaveFailed(false);
    try {
      const current = await readAppFile(targetSession, targetPath);
      let content: string;
      let verb: string;
      if (current === null) {
        content = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(selectedFrame?.name || 'Imported design')}</title>
</head>
<body>
${generatedCode}
</body>
</html>
`;
        verb = 'Created';
      } else {
        const merged = insertSnippet(targetPath, current, generatedCode);
        if (!merged.ok) {
          setSaveFailed(true);
          setSaveNote(merged.error || 'That file cannot take this design.');
          return;
        }
        content = merged.code;
        verb = 'Added the design to';
      }

      const outcome = await saveFilesToApp(
        targetSession,
        { [targetPath]: content },
        `Before importing "${selectedFrame?.name || 'a design'}" from Figma into ${targetPath}`,
      );
      if (!outcome.ok) {
        setSaveFailed(true);
        setSaveNote(outcome.error || 'Could not save. Your app is unchanged.');
        return;
      }
      if (outcome.unchanged) {
        setSaveNote('Your app already has exactly this — nothing needed changing.');
        return;
      }
      setSaveNote(`${verb} ${targetPath}. ${outcome.undoHint || ''}`.trim());
      void reloadFiles(targetSession);
    } catch {
      setSaveFailed(true);
      setSaveNote('Could not reach the server. Your app is unchanged.');
    } finally {
      setSaving(false);
    }
  }, [targetSession, targetPath, saving, generatedCode, selectedFrame, reloadFiles]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAiRefine = () => {
    if (!aiPrompt.trim() || !generatedCode) return;
    // Hand the imported design + instruction to the REAL engine (Pro v5.0) — the old /api/generate
    // call never existed, so refine silently did nothing. Send there builds/refines the real app.
    onBuildViaV5?.(
      `Build a working app from this Figma-imported design, applying this instruction: ${aiPrompt.trim()}\n\nDESIGN (HTML/CSS):\n${generatedCode}`,
    );
    setAiPrompt('');
    setAiRefineOpen(false);
  };

  const statusBadge = () => {
    const cfg: Record<ConnectionStatus, { label: string; icon: React.ReactNode; color: string }> = {
      disconnected: { label: 'Disconnected', icon: <X size={12} />, color: 'text-gray-400 bg-gray-800' },
      connecting: { label: 'Connecting...', icon: <TirangaLoader size={12} />, color: 'text-yellow-400 bg-yellow-900/30' },
      connected: { label: 'Connected ✓', icon: <CheckCircle2 size={12} />, color: 'text-green-400 bg-green-900/30' },
      error: { label: 'Error', icon: <X size={12} />, color: 'text-red-400 bg-red-900/30' },
    };
    const c = cfg[connectionStatus];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${c.color}`}>
        {c.icon} {c.label}
      </span>
    );
  };

  const formatDate = (iso: string) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('hi-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return iso; }
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-gray-100 overflow-hidden">
      {/* Section 1: Connection */}
      <div className="flex-shrink-0 p-4 border-b border-white/10">
        <div className="bg-[#161b22] border border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {/* Figma F logo */}
              <div className="w-7 h-7 rounded-md bg-[#1e1333] flex items-center justify-center">
                <span className="text-[#a259ff] font-black text-sm leading-none">F</span>
              </div>
              <h2 className="text-sm font-semibold text-gray-100">Import Design from Figma</h2>
            </div>
            {statusBadge()}
          </div>

          {/* Inputs row */}
          <div className="flex gap-3 mb-3">
            {/* URL input */}
            <div className="flex-1">
              <div className="flex items-center gap-1 mb-1">
                <label className="text-xs text-gray-400">Figma File URL</label>
                <div className="relative group">
                  <Info size={12} className="text-gray-500 cursor-pointer" />
                  <div className="absolute left-0 top-5 z-20 hidden group-hover:block w-56 bg-[#1c2128] border border-white/10 rounded-lg p-2 text-xs text-gray-300 shadow-xl">
                    Open the file in Figma → Share → Copy link
                  </div>
                </div>
              </div>
              <div className="relative">
                <Link size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="url"
                  value={figmaUrl}
                  onChange={(e) => { setFigmaUrl(e.target.value); validateUrl(e.target.value); }}
                  placeholder="https://www.figma.com/file/XXXXX/..."
                  className={`w-full bg-[#0d1117] border ${urlError ? 'border-red-500' : 'border-white/10'} rounded-lg pl-8 pr-3 py-2 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors`}
                />
              </div>
              {urlError && <p className="text-red-400 text-xs mt-1">{urlError}</p>}
            </div>

            {/* Token input */}
            <div className="flex-1">
              <div className="flex items-center gap-1 mb-1">
                <label className="text-xs text-gray-400">Personal Access Token</label>
                <div className="relative group">
                  <Info size={12} className="text-gray-500 cursor-pointer" />
                  <div className="absolute left-0 top-5 z-20 hidden group-hover:block w-60 bg-[#1c2128] border border-white/10 rounded-lg p-2 text-xs text-gray-300 shadow-xl">
                    Figma Account Settings → Personal Access Tokens → Create new token
                  </div>
                </div>
                <button
                  onClick={() => setShowTokenHelp((v) => !v)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 ml-1 underline"
                >
                  Where do I find the token?
                </button>
              </div>
              <div className="relative">
                <Key size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="figd_xxxxxxxxxxxx"
                  className="w-full bg-[#0d1117] border border-white/10 rounded-lg pl-8 pr-8 py-2 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
                />
                <button
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>

          {/* Token help card */}
          {showTokenHelp && (
            <div className="mb-3 bg-[#1c2128] border border-indigo-500/30 rounded-lg p-3 text-xs text-gray-300">
              <p className="font-medium text-indigo-300 mb-1">How to create a token:</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Open Figma → click the top-left avatar</li>
                <li>Choose "Account Settings"</li>
                <li>Go to the "Personal access tokens" section</li>
                <li>Click "Generate new token"</li>
                <li>Copy the token and paste it here</li>
              </ol>
            </div>
          )}

          {/* Connect button + history */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleConnect}
              disabled={!figmaUrl || !token || connectionStatus === 'connecting'}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-[#a259ff] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {connectionStatus === 'connecting' ? <TirangaLoader size={14} /> : <RefreshCw size={14} />}
              Connect &amp; Fetch
            </button>
            {history.length > 0 && (
              <div className="flex items-center gap-1">
                <Clock size={12} className="text-gray-500" />
                <span className="text-xs text-gray-500">Recent:</span>
                {history.map((key) => (
                  <button
                    key={key}
                    onClick={() => {
                      const url = `https://www.figma.com/file/${key}`;
                      setFigmaUrl(url);
                      validateUrl(url);
                    }}
                    className="text-xs bg-[#0d1117] border border-white/10 hover:border-indigo-500/50 text-gray-400 hover:text-gray-200 px-2 py-0.5 rounded transition-colors font-mono"
                  >
                    {key.slice(0, 8)}…
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Connection error */}
          {connectionError && (
            <div className="mt-3 flex items-start gap-2 bg-red-900/20 border border-red-500/30 rounded-lg p-2 text-xs text-red-300">
              <X size={14} className="flex-shrink-0 mt-0.5" />
              <span>{connectionError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Sections 2 & 3 */}
      <div className="flex flex-1 flex-col md:flex-row overflow-hidden">
        {/* Section 2: Design Tree */}
        {fileInfo && (
          <div className="w-full md:w-[280px] flex-shrink-0 max-h-[38vh] md:max-h-none border-b md:border-b-0 md:border-r border-white/10 flex flex-col overflow-hidden bg-[#0d1117]">
            {/* File info card */}
            <div className="p-3 border-b border-white/10 flex-shrink-0">
              <div className="bg-[#161b22] border border-white/10 rounded-lg p-3">
                {fileInfo.thumbnailUrl && (
                  <img src={fileInfo.thumbnailUrl} alt="thumbnail" className="w-full h-20 object-cover rounded mb-2 opacity-80" loading="lazy" />
                )}
                <p className="text-xs font-semibold text-gray-100 truncate">{fileInfo.name}</p>
                {fileInfo.lastModified && (
                  <p className="text-xs text-gray-500 mt-0.5">Modified: {formatDate(fileInfo.lastModified)}</p>
                )}
              </div>
            </div>

            {/* Pages & Frames */}
            <div className="flex-1 overflow-y-auto p-2">
              <p className="text-xs font-medium text-gray-500 px-2 mb-1 uppercase tracking-wide">Pages</p>
              {fileInfo.pages.map((page) => (
                <div key={page.id}>
                  <button
                    onClick={() => togglePage(page.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 text-left transition-colors group"
                  >
                    {expandedPages.has(page.id) ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
                    <span className="text-xs text-gray-300 truncate">{page.name}</span>
                    <span className="ml-auto text-xs text-gray-600">{page.children?.length || 0}</span>
                  </button>
                  {expandedPages.has(page.id) && (page.children || []).map((frame) => (
                    <button
                      key={frame.id}
                      onClick={() => handleSelectFrame(frame, frame)}
                      className={`w-full flex items-center gap-2 pl-7 pr-2 py-1.5 rounded-lg text-left transition-colors ${selectedFrame?.id === frame.id ? 'bg-indigo-600/20 border border-indigo-500/40' : 'hover:bg-white/5'}`}
                    >
                      <FileCode size={12} className={selectedFrame?.id === frame.id ? 'text-indigo-400' : 'text-gray-600'} />
                      <span className={`text-xs truncate ${selectedFrame?.id === frame.id ? 'text-indigo-300' : 'text-gray-400'}`}>{frame.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {/* Import options */}
            <div className="p-3 border-t border-white/10 flex-shrink-0">
              <div className="bg-[#161b22] border border-white/10 rounded-lg p-3 space-y-3">
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-2">Output Format</p>
                  <div className="flex gap-2">
                    {(['Tailwind CSS', 'Plain CSS'] as OutputFormat[]).map((fmt) => (
                      <button
                        key={fmt}
                        onClick={() => setImportOptions((o) => ({ ...o, outputFormat: fmt }))}
                        className={`flex-1 text-xs py-1 rounded-md border transition-colors ${importOptions.outputFormat === fmt ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-white/10 text-gray-400 hover:border-white/20'}`}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-1.5">Include</p>
                  <div className="space-y-1">
                    {[
                      { key: 'includeColors', label: 'Colors' },
                      { key: 'includeTypography', label: 'Typography' },
                      { key: 'includeSpacing', label: 'Spacing' },
                      { key: 'includeImages', label: 'Images (placeholder)' },
                    ].map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={importOptions[key as keyof ImportOptions] as boolean}
                          onChange={(e) => setImportOptions((o) => ({ ...o, [key]: e.target.checked }))}
                          className="w-3 h-3 accent-indigo-500"
                        />
                        <span className="text-xs text-gray-400">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <button
                  onClick={handleImport}
                  disabled={!selectedFrame || isImporting}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium py-2 rounded-lg transition-colors"
                >
                  {isImporting ? <TirangaLoader size={13} /> : <FileCode size={13} />}
                  Import Selected Frame
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Section 3: Output */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!generatedCode ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
              <div className="w-16 h-16 rounded-2xl bg-[#1e1333] border border-[#a259ff]/20 flex items-center justify-center">
                <span className="text-[#a259ff] font-black text-3xl leading-none">F</span>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-300">
                  {fileInfo ? 'Select a frame to import' : 'Connect a Figma file to get started'}
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  {fileInfo ? 'Expand a page in the left panel and choose a frame' : 'Enter the URL and token, then press Connect & Fetch'}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Output header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <FileCode size={15} className="text-indigo-400" />
                  <span className="text-sm font-medium text-gray-100">Generated HTML</span>
                  <span className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded-full">{importOptions.outputFormat}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={() => {
                      const w = window.open('', '_blank');
                      if (!w) return;
                      // SECURITY: the generated HTML is AI/Figma-derived and untrusted. Writing it
                      // straight into the (same-origin) popup let its scripts read the platform's
                      // cookies/localStorage (auth tokens). Instead, run it inside a SANDBOXED iframe
                      // with NO allow-same-origin → opaque origin, so it can render/execute but can't
                      // reach platform storage. Only this static shell touches the same-origin popup;
                      // `srcdoc` is set as a PROPERTY (no HTML-attribute escaping needed).
                      w.document.title = 'Preview';
                      w.document.body.style.margin = '0';
                      const frame = w.document.createElement('iframe');
                      frame.setAttribute('sandbox', UNTRUSTED_PREVIEW_SANDBOX);
                      frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0';
                      frame.srcdoc = generatedCode;
                      w.document.body.appendChild(frame);
                      w.document.close();
                    }}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <ExternalLink size={13} />
                    Open in Preview
                  </button>
                </div>
              </div>

              {/* Save into the user's real app. Until now the imported design could only be copied
                  by hand — the Figma fetch was real, but nothing it produced could be kept. */}
              <div className="flex-shrink-0 border-b border-white/10" style={{ background: '#161b22' }}>
                <div className="px-4 pt-3 text-sm font-semibold text-gray-200 flex items-center gap-2">
                  <Save size={14} className="text-[#a259ff]" /> Save this design into your app
                </div>
                <AppTargetPicker
                  apps={apps}
                  appsLoading={appsLoading}
                  files={appFiles}
                  filesLoading={filesLoading}
                  sessionId={targetSession}
                  onSessionChange={(sid) => { setTargetSession(sid); setSaveNote(''); }}
                  selectedPath={targetPath}
                  onPathChange={(pth) => { setTargetPath(pth); setSaveNote(''); }}
                  fileFilter={(f) => /\.html?$/i.test(f.path)}
                  newPathOptions={[suggestedPath]}
                  fileLabel="Save as"
                />
                {apps.length > 0 && (
                  <div className="px-3 pb-3">
                    <button
                      onClick={() => void saveDesignToApp()}
                      disabled={!targetSession || !targetPath || saving}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: '#a259ff' }}
                    >
                      {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                      {saving ? 'Saving into your app…' : 'Save into my app'}
                    </button>
                    <p className="mt-2 text-[11px] text-gray-500 leading-snug flex gap-1.5">
                      <History size={11} className="mt-0.5 flex-shrink-0" />
                      A new file becomes a complete page; an existing page keeps what it has and gains
                      this design. A restore point is saved first, so you can undo it from Versioning.
                    </p>
                    {saveNote && (
                      <p
                        className="mt-2 px-3 py-2 rounded-lg text-xs leading-relaxed flex gap-2"
                        style={{
                          color: saveFailed ? '#fcd34d' : '#86efac',
                          background: saveFailed ? 'rgba(245,158,11,0.1)' : 'rgba(63,185,80,0.1)',
                        }}
                      >
                        {saveFailed && <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />}
                        <span>{saveNote}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Code block */}
              <div className="flex-1 overflow-auto p-4">
                <pre className="text-xs text-gray-300 font-mono bg-[#161b22] border border-white/10 rounded-xl p-4 overflow-auto h-full leading-relaxed">
                  {generatedCode}
                </pre>
              </div>

              {/* Assets row */}
              {(extractedAssets.colors.length > 0 || extractedAssets.fonts.length > 0) && (
                <div className="px-4 pb-3 flex-shrink-0 flex gap-6 border-t border-white/10 pt-3">
                  {extractedAssets.colors.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5 font-medium">Color Palette</p>
                      <div className="flex flex-wrap gap-1.5">
                        {extractedAssets.colors.map((c, i) => (
                          <div key={i} title={c} className="w-5 h-5 rounded-full border border-white/20 flex-shrink-0" style={{ backgroundColor: c }} />
                        ))}
                      </div>
                    </div>
                  )}
                  {extractedAssets.fonts.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5 font-medium">Typography</p>
                      <div className="flex flex-wrap gap-1.5">
                        {extractedAssets.fonts.map((f, i) => (
                          <span key={i} className="text-xs bg-[#161b22] border border-white/10 px-2 py-0.5 rounded-full text-gray-400">
                            {f.family} {f.size}px/{f.weight}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* AI Refine */}
              <div className="px-4 pb-4 flex-shrink-0 border-t border-white/10 pt-3">
                {!aiRefineOpen ? (
                  <button
                    onClick={() => setAiRefineOpen(true)}
                    className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/30 px-4 py-2 rounded-lg transition-colors"
                  >
                    <Sparkles size={13} />
                    Refine with AI
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleAiRefine(); }}
                      placeholder="Describe modification, e.g. 'Add padding, make it responsive'"
                      className="flex-1 bg-[#0d1117] border border-indigo-500/50 rounded-lg px-3 py-2 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-400 transition-colors"
                    />
                    <button
                      onClick={handleAiRefine}
                      disabled={isRefining || !aiPrompt.trim()}
                      className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs px-4 py-2 rounded-lg transition-colors"
                    >
                      {isRefining ? <TirangaLoader size={13} /> : <Sparkles size={13} />}
                      Refine
                    </button>
                    <button
                      onClick={() => { setAiRefineOpen(false); setAiPrompt(''); }}
                      className="text-xs text-gray-500 hover:text-gray-300 px-2 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FigmaImporter;
