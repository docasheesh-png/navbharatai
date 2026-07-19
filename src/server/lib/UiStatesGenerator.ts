// T2.5 (roadmap 2026-07-19) — Frontend UI-states generator (Tier-2, frontend UX pack).
//
// The audit's Frontend ❌ cluster: loading states, skeletons, optimistic updates, error boundaries were
// all LLM-authored ad hoc (no recipe). This emits a small, real, dependency-free React helper pack the
// generated app reuses everywhere:
//   • Spinner + Skeleton (loading placeholders, CSS keyframes shipped),
//   • EmptyState (a clean "nothing here yet"),
//   • ErrorBoundary (a class boundary with a fallback — the correct React pattern),
//   • useAsync (the loading/error/data hook so every fetch has honest states),
//   • useOptimisticList (optimistic add/remove that ROLLS BACK on failure).
// PURE builder → the caller writes the files. Real, complete code — no stubs (the real-features rule).

export interface UiStatesResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const FILES: Record<string, string> = {
  'src/components/ui/ui.css': `/* Loading-state keyframes for the UI helpers. Imported by Spinner/Skeleton. */
@keyframes nb-spin { to { transform: rotate(360deg); } }
@keyframes nb-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
.nb-spinner {
  display: inline-block; box-sizing: border-box;
  border: 3px solid currentColor; border-top-color: transparent; border-radius: 50%;
  animation: nb-spin 0.7s linear infinite;
}
.nb-skeleton {
  display: inline-block; border-radius: 6px;
  background: linear-gradient(90deg, rgba(130,130,130,0.12) 25%, rgba(130,130,130,0.22) 37%, rgba(130,130,130,0.12) 63%);
  background-size: 800px 100%; animation: nb-shimmer 1.3s ease-in-out infinite;
}
`,

  'src/components/ui/Spinner.tsx': `import './ui.css';

// A loading spinner. <Spinner /> or <Spinner size={32} />.
export function Spinner({ size = 24 }: { size?: number }) {
  return <span role="status" aria-label="Loading" className="nb-spinner" style={{ width: size, height: size }} />;
}
`,

  'src/components/ui/Skeleton.tsx': `import './ui.css';

// A shimmering placeholder for content that is still loading.
export function Skeleton({ width = '100%', height = 16, radius = 6 }: { width?: number | string; height?: number | string; radius?: number }) {
  return <span className="nb-skeleton" style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}
`,

  'src/components/ui/EmptyState.tsx': `import type { ReactNode } from 'react';

// A clean, honest "nothing here yet" state.
export function EmptyState({ title = 'Nothing here yet', message, action }: { title?: string; message?: string; action?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#6b7280' }}>
      <p style={{ fontWeight: 600, margin: 0 }}>{title}</p>
      {message && <p style={{ margin: '6px 0 0', fontSize: 14 }}>{message}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}
`,

  'src/components/ui/ErrorBoundary.tsx': `import { Component, type ErrorInfo, type ReactNode } from 'react';

// A React error boundary (the correct pattern is a class component). Wrap a subtree so a render error
// shows a fallback instead of a blank white screen. <ErrorBoundary><App /></ErrorBoundary>.
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean; message: string }> {
  state = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, message: error instanceof Error ? error.message : 'Something went wrong' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Report to your error tracker here (e.g. generate_error_tracking's captureError).
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <p style={{ fontWeight: 700 }}>Something went wrong.</p>
          <button onClick={() => this.setState({ hasError: false, message: '' })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
`,

  'src/hooks/useAsync.ts': `import { useCallback, useEffect, useRef, useState } from 'react';

// Run an async function with honest loading / error / data states. Returns { loading, error, data, run }.
// Pass immediate=false to defer until you call run() yourself (e.g. on a button click).
export function useAsync<T>(fn: () => Promise<T>, immediate = true) {
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState<string>('');
  const [data, setData] = useState<T | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fnRef.current();
      setData(result);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (immediate) void run().catch(() => {}); }, [immediate, run]);

  return { loading, error, data, run };
}
`,

  'src/hooks/useOptimisticList.ts': `import { useCallback, useState } from 'react';

// Optimistically add/remove from a list, then reconcile with the server. On failure the change is
// ROLLED BACK so the UI never lies. commit(fn) runs the server call; if it throws, the list reverts.
export function useOptimisticList<T extends { id: string }>(initial: T[]) {
  const [items, setItems] = useState<T[]>(initial);

  const optimisticAdd = useCallback(async (item: T, commit: () => Promise<T | void>) => {
    const prev = items;
    setItems((cur) => [item, ...cur]);
    try {
      const saved = await commit();
      if (saved) setItems((cur) => cur.map((i) => (i.id === item.id ? (saved as T) : i)));
    } catch (e) {
      setItems(prev); // roll back
      throw e;
    }
  }, [items]);

  const optimisticRemove = useCallback(async (id: string, commit: () => Promise<void>) => {
    const prev = items;
    setItems((cur) => cur.filter((i) => i.id !== id));
    try {
      await commit();
    } catch (e) {
      setItems(prev); // roll back
      throw e;
    }
  }, [items]);

  return { items, setItems, optimisticAdd, optimisticRemove };
}
`,
};

/**
 * Generate the frontend UI-states helper pack. `include` optionally filters which helpers to emit (by file
 * basename, e.g. ["Spinner","useAsync"]); default = all. `ui.css` is always included when a CSS-dependent
 * component is emitted. Pure — returns the files. Never throws.
 */
export function generateUiStates(include?: string[]): UiStatesResult {
  const wanted = Array.isArray(include) && include.length
    ? include.map((s) => String(s || '').toLowerCase()).filter(Boolean)
    : null;

  let files: Record<string, string>;
  if (!wanted) {
    files = { ...FILES };
  } else {
    files = {};
    for (const [path, content] of Object.entries(FILES)) {
      const base = (path.split('/').pop() || '').replace(/\.(tsx?|css)$/i, '').toLowerCase();
      if (base === 'ui' || wanted.includes(base)) files[path] = content;
    }
    // If any CSS-dependent component is present, ensure ui.css ships too.
    if (Object.keys(files).some((p) => /Spinner|Skeleton/i.test(p))) files['src/components/ui/ui.css'] = FILES['src/components/ui/ui.css'];
    if (Object.keys(files).length === 0) files = { ...FILES }; // nothing matched → emit the full pack
  }

  return {
    files,
    dependencies: [], // plain React, no new packages
    instructions:
      `Added a dependency-free UI-states pack (${Object.keys(files).length} files under src/components/ui + src/hooks). Use them:\n` +
      `  <Spinner /> / <Skeleton width={200} /> while loading; <EmptyState message="No items yet" /> when empty.\n` +
      `  Wrap risky subtrees: <ErrorBoundary><Page /></ErrorBoundary>.\n` +
      `  const { loading, error, data } = useAsync(() => fetch('/api/x').then(r => r.json()));\n` +
      `  useOptimisticList for instant add/remove that rolls back if the server call fails.`,
  };
}
