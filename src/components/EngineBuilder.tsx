import { useState } from 'react';
import { buildApp, previewIframeSrc, type BuildResponse } from '../services/buildService';

/**
 * EngineBuilder — a self-contained UI for the real Phase 3/4 build engine.
 *
 * Drives `/api/build` (VFS + EditEngine + Verifier + RepairLoop) and renders the
 * generated multi-file app + a live static preview. Mount it anywhere (e.g. a new
 * tab/route in the Pro IDE) — it does not depend on the legacy build flow.
 *
 *   import { EngineBuilder } from './components/EngineBuilder';
 *   // ...render <EngineBuilder /> in a view/route
 */
export function EngineBuilder() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuildResponse | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const run = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await buildApp({ prompt: prompt.trim(), files: result?.files, preview: true });
      setResult(res);
      const first = Object.keys(res.files).sort()[0] || null;
      setActiveFile(first);
    } catch (e: any) {
      setError(e?.message || 'Build failed');
    } finally {
      setLoading(false);
    }
  };

  const files = result?.files || {};
  const fileNames = Object.keys(files).sort();
  const previewSession = result?.preview?.ok && result.preview.target === 'static'
    ? result.preview.sessionId : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0d1117', color: '#c9d1d9', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ padding: 16, borderBottom: '1px solid #30363d', display: 'flex', gap: 8 }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the app to build (e.g. a todo app with categories)…"
          rows={2}
          style={{ flex: 1, background: '#0d1117', color: '#fff', border: '1px solid #30363d', borderRadius: 8, padding: 10, fontSize: 13, resize: 'vertical' }}
        />
        <button
          onClick={run}
          disabled={loading || !prompt.trim()}
          style={{ background: loading ? '#21262d' : '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '0 20px', fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}
        >
          {loading ? 'Building…' : result ? 'Edit' : 'Build'}
        </button>
      </div>

      {error && <div style={{ padding: 12, color: '#f85149', fontSize: 13 }}>⚠️ {error}</div>}

      {result && (
        <div style={{ padding: '8px 16px', fontSize: 12, color: result.ok ? '#3fb950' : '#d29922', borderBottom: '1px solid #30363d' }}>
          {result.ok ? '✅' : '⚠️'} {result.fileCount} files · applied {result.applied}
          {result.repairAttempts > 0 && ` · auto-repaired ×${result.repairAttempts}`}
          {result.verify.warnings > 0 && ` · ${result.verify.warnings} warning(s)`}
          {result.verify.errors > 0 && ` · ${result.verify.errors} error(s)`}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* file tree */}
        <div style={{ width: 200, borderRight: '1px solid #30363d', overflow: 'auto', padding: 8 }}>
          {fileNames.length === 0 && <div style={{ color: '#484f58', fontSize: 12, padding: 8 }}>No files yet</div>}
          {fileNames.map((name) => (
            <div
              key={name}
              onClick={() => setActiveFile(name)}
              style={{ padding: '6px 8px', fontSize: 12, cursor: 'pointer', borderRadius: 6, background: activeFile === name ? '#21262d' : 'transparent', color: activeFile === name ? '#fff' : '#8b949e' }}
            >
              {name}
            </div>
          ))}
        </div>

        {/* code view */}
        <pre style={{ flex: 1, margin: 0, overflow: 'auto', padding: 12, fontSize: 12, background: '#010409', whiteSpace: 'pre-wrap' }}>
          {activeFile ? files[activeFile] : ''}
        </pre>

        {/* live preview */}
        <div style={{ width: '40%', borderLeft: '1px solid #30363d', background: '#fff' }}>
          {previewSession ? (
            <iframe title="preview" src={previewIframeSrc(previewSession)} style={{ width: '100%', height: '100%', border: 'none' }} />
          ) : (
            <div style={{ color: '#8b949e', fontSize: 12, padding: 16 }}>
              {result?.preview && !result.preview.ok
                ? `Preview: ${result.preview.reason || 'not available'}`
                : 'Live preview appears here after a build.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
