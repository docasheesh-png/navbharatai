/**
 * Project Insights & Integrations panel — wires the previously-headless backends into the actual
 * v5.0 UI so they DO something visible:
 *   - Build SLO compliance        → GET  /api/analytics/slo        (P-PME.11)
 *   - App SBOM + license check     → POST /api/workspace/sbom       (P-BRE.10)
 *   - Webhook management           → /api/webhooks/:userId CRUD     (P-PME.9)
 *
 * Reachable from Settings → "Insights & Webhooks". Real data only — honest empty/zero states, no fakes.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePagedList } from '../../hooks/usePagedList';
import { LoadMore } from '../../components/common/LoadMore';
import { Activity, Brain, FileCode, Layers, Plus, RefreshCcw, Send, ShieldCheck, Trash2, TrendingUp, Webhook as WebhookIcon } from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Popover } from '../ui/Popover';
import { Donut } from '../ui/charts';
import { cardClasses } from '../ui/variants';
import { buildComponentTree, type TreeNode } from '../../lib/componentTree';

interface ProjectInsightsPanelProps {
  user: FirebaseUser | null;
  files: Record<string, string>;
  /** Current build workspace — enables the durable Code Review comments (P-DEV.11). */
  workspaceId?: string;
}

const WEBHOOK_EVENTS = ['BUILD_COMPLETE', 'BUILD_FAILED', 'DEPLOY_COMPLETE', 'DEPLOY_FAILED'] as const;

async function authedHeaders(): Promise<Record<string, string>> {
  const base: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) base.Authorization = `Bearer ${token}`;
  } catch { /* unauthenticated — server will reject protected calls */ }
  return base;
}

const Card: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode; action?: React.ReactNode }> = ({ icon, title, children, action }) => (
  <div className={cn(cardClasses(), 'p-5 space-y-4')}>
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">{icon}<h3 className="text-sm font-black text-ink uppercase tracking-tight">{title}</h3></div>
      {action}
    </div>
    {children}
  </div>
);

export const ProjectInsightsPanel: React.FC<ProjectInsightsPanelProps> = ({ user, files, workspaceId }) => {
  // ── Build SLO ──
  const [slo, setSlo] = useState<any>(null);
  const fetchSlo = useCallback(async () => {
    try { const r = await fetch('/api/analytics/slo?limit=100'); if (r.ok) setSlo(await r.json()); } catch { /* ignore */ }
  }, []);
  useEffect(() => { fetchSlo(); }, [fetchSlo]);

  // ── SBOM ──
  const [sbom, setSbom] = useState<any>(null);
  const [sbomBusy, setSbomBusy] = useState(false);
  const [sbomMsg, setSbomMsg] = useState('');
  const runSbom = async () => {
    setSbomBusy(true); setSbomMsg(''); setSbom(null);
    try {
      const lockRaw = files['package-lock.json'];
      if (!lockRaw) { setSbomMsg('No package-lock.json in this project — build/install first to generate one.'); return; }
      let packageLock: any;
      try { packageLock = JSON.parse(lockRaw); } catch { setSbomMsg('package-lock.json is not valid JSON.'); return; }
      const r = await fetch('/api/workspace/sbom', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packageLock }) });
      const d = await r.json();
      if (r.ok) setSbom(d); else setSbomMsg(d.error || 'SBOM generation failed.');
    } catch (e: any) { setSbomMsg(`Error: ${e?.message || e}`); }
    finally { setSbomBusy(false); }
  };

  // ── Webhooks ──
  const [hooks, setHooks] = useState<any[]>([]);
  const [whBusy, setWhBusy] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [whMsg, setWhMsg] = useState('');
  const uid = user?.uid;

  const fetchHooks = useCallback(async () => {
    if (!uid) return;
    try {
      const r = await fetch(`/api/webhooks/${uid}`, { headers: await authedHeaders() });
      if (r.ok) { const d = await r.json(); setHooks(Array.isArray(d.webhooks) ? d.webhooks : []); }
    } catch { /* ignore */ }
  }, [uid]);
  useEffect(() => { fetchHooks(); }, [fetchHooks]);

  const addHook = async () => {
    if (!uid || !newUrl.trim()) return;
    setWhBusy(true); setWhMsg('');
    try {
      const r = await fetch(`/api/webhooks/${uid}`, { method: 'POST', headers: await authedHeaders(), body: JSON.stringify({ url: newUrl.trim() }) });
      const d = await r.json();
      if (r.ok) { setNewUrl(''); fetchHooks(); } else setWhMsg(d.error || 'Could not add webhook.');
    } catch (e: any) { setWhMsg(`Error: ${e?.message || e}`); }
    finally { setWhBusy(false); }
  };
  const delHook = async (id: string) => {
    if (!uid) return;
    try { await fetch(`/api/webhooks/${uid}/${id}`, { method: 'DELETE', headers: await authedHeaders() }); fetchHooks(); } catch { /* ignore */ }
  };
  const testHooks = async () => {
    if (!uid) return;
    setWhMsg('');
    try {
      const r = await fetch(`/api/webhooks/${uid}/test`, { method: 'POST', headers: await authedHeaders() });
      const d = await r.json();
      setWhMsg(r.ok ? `Test sent to ${d.attempted} webhook(s), ${d.succeeded} succeeded.` : (d.error || 'Test failed.'));
    } catch (e: any) { setWhMsg(`Error: ${e?.message || e}`); }
  };

  // ── Code Confidence (hallucination check) ──
  const [conf, setConf] = useState<any>(null);
  const [confBusy, setConfBusy] = useState(false);
  const runConf = async () => {
    setConfBusy(true); setConf(null);
    try {
      const r = await fetch('/api/workspace/hallucination-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
      if (r.ok) setConf(await r.json());
    } catch { /* ignore */ }
    finally { setConfBusy(false); }
  };

  // ── React Rules-of-Hooks safety check ──
  const [hooksRules, setHooksRules] = useState<any>(null);
  const [hooksRulesBusy, setHooksRulesBusy] = useState(false);
  const runHooksRules = async () => {
    setHooksRulesBusy(true); setHooksRules(null);
    try {
      const r = await fetch('/api/workspace/hooks-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
      if (r.ok) setHooksRules(await r.json());
    } catch { /* ignore */ }
    finally { setHooksRulesBusy(false); }
  };

  // ── Import/Export consistency check ──
  const [importChk, setImportChk] = useState<any>(null);
  const [importChkBusy, setImportChkBusy] = useState(false);
  const runImportChk = async () => {
    setImportChkBusy(true); setImportChk(null);
    try {
      const r = await fetch('/api/workspace/import-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
      if (r.ok) setImportChk(await r.json());
    } catch { /* ignore */ }
    finally { setImportChkBusy(false); }
  };

  // ── JSX undefined-component check ──
  const [jsxChk, setJsxChk] = useState<any>(null);
  const [jsxChkBusy, setJsxChkBusy] = useState(false);
  const runJsxChk = async () => {
    setJsxChkBusy(true); setJsxChk(null);
    try {
      const r = await fetch('/api/workspace/jsx-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
      if (r.ok) setJsxChk(await r.json());
    } catch { /* ignore */ }
    finally { setJsxChkBusy(false); }
  };

  // ── Scaling check: will this app survive real traffic? ──
  const [scale, setScale] = useState<any>(null);
  const [scaleBusy, setScaleBusy] = useState(false);
  const runScale = async () => {
    setScaleBusy(true); setScale(null);
    try {
      const r = await fetch('/api/workspace/scale-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
      if (r.ok) setScale(await r.json());
    } catch { /* ignore */ }
    finally { setScaleBusy(false); }
  };

  // ── Undefined-hook check ──
  const [hookRes, setHookRes] = useState<any>(null);
  const [hookResBusy, setHookResBusy] = useState(false);
  const runHookRes = async () => {
    setHookResBusy(true); setHookRes(null);
    try {
      const r = await fetch('/api/workspace/hook-resolution-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
      if (r.ok) setHookRes(await r.json());
    } catch { /* ignore */ }
    finally { setHookResBusy(false); }
  };

  // ── Dependency version-constraint check ──
  const [depChk, setDepChk] = useState<any>(null);
  const [depChkBusy, setDepChkBusy] = useState(false);
  const runDepChk = async () => {
    setDepChkBusy(true); setDepChk(null);
    try {
      const r = await fetch('/api/workspace/dependency-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
      if (r.ok) setDepChk(await r.json());
    } catch { /* ignore */ }
    finally { setDepChkBusy(false); }
  };

  // ── One-call Build Health (runs all robustness checks) ──
  const [health, setHealth] = useState<any>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const runHealth = async () => {
    setHealthBusy(true); setHealth(null);
    try {
      const r = await fetch('/api/workspace/health-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
      if (r.ok) setHealth(await r.json());
    } catch { /* ignore */ }
    finally { setHealthBusy(false); }
  };

  // ── Code Explanation (P-DEV.10) — instant, free, deterministic ──
  const [explainInput, setExplainInput] = useState('');
  const [explainResult, setExplainResult] = useState<any>(null);
  const [explainBusy, setExplainBusy] = useState(false);
  const runExplain = async () => {
    if (!explainInput.trim()) return;
    setExplainBusy(true); setExplainResult(null);
    try {
      const r = await fetch('/api/workspace/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: explainInput }) });
      if (r.ok) setExplainResult(await r.json());
    } catch { /* ignore */ }
    finally { setExplainBusy(false); }
  };

  const fmtSec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const confColor = (c: number) => (c >= 85 ? 'text-success' : c >= 70 ? 'text-warn' : 'text-danger');
  const cxColor = (l: string) => (l === 'Low' ? 'text-success' : l === 'Moderate' ? 'text-warn' : 'text-danger');

  // ── Inline Code Review comments (P-DEV.11) ──
  const [comments, setComments] = useState<any[]>([]);
  const pagedComments = usePagedList(comments);
  const [rvFile, setRvFile] = useState('');
  const [rvLine, setRvLine] = useState('');
  const [rvBody, setRvBody] = useState('');
  const [rvBusy, setRvBusy] = useState(false);
  const loadComments = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const r = await fetch(`/api/workspace/${encodeURIComponent(workspaceId)}/review`, { headers: await authedHeaders() });
      if (r.ok) { const d = await r.json(); setComments(Array.isArray(d?.comments) ? d.comments : []); }
    } catch { /* ignore */ }
  }, [workspaceId]);
  useEffect(() => { loadComments(); }, [loadComments]);
  const addComment = async () => {
    if (!workspaceId || !rvFile.trim() || !rvBody.trim()) return;
    setRvBusy(true);
    try {
      const r = await fetch(`/api/workspace/${encodeURIComponent(workspaceId)}/review`, {
        method: 'POST', headers: await authedHeaders(),
        body: JSON.stringify({ file: rvFile.trim(), line: Math.max(0, parseInt(rvLine, 10) || 0), body: rvBody.trim() }),
      });
      if (r.ok) { setRvBody(''); setRvLine(''); await loadComments(); }
    } catch { /* ignore */ }
    finally { setRvBusy(false); }
  };
  const toggleResolve = async (id: string, resolved: boolean) => {
    if (!workspaceId) return;
    try {
      await fetch(`/api/workspace/${encodeURIComponent(workspaceId)}/review/${encodeURIComponent(id)}/resolve`, {
        method: 'POST', headers: await authedHeaders(), body: JSON.stringify({ resolved }),
      });
      await loadComments();
    } catch { /* ignore */ }
  };

  // Pure and cheap, but re-deriving it on every keystroke of an unrelated panel would be wasteful.
  const appTree = useMemo(() => buildComponentTree(files || {}), [files]);

  return (
    <div className="flex-1 h-full overflow-auto bg-surface p-6 space-y-5">
      <h2 className="text-lg font-black text-ink tracking-tight">Insights & Integrations</h2>

      {/* WHAT IS MY APP MADE OF (ROADMAP §2 "component tree panel"). Placed FIRST because it answers the
          question a non-technical owner asks before any metric: "what screens does my app have, and
          what is on each one?" Derived from the files themselves — no model call, no cost, and it works
          on a project restored from history where no model is running. */}
      <Card icon={<Layers className="w-4 h-4 text-info" />} title="What your app is made of">
        {appTree.fileCount === 0 ? (
          <p className="text-[11px] text-muted">Build or open an app and its screens will appear here.</p>
        ) : (
          <div className="space-y-3">
            <div className="text-[11px] text-muted">
              {appTree.roots.length} screen{appTree.roots.length === 1 ? '' : 's'} · {appTree.fileCount} file{appTree.fileCount === 1 ? '' : 's'}
            </div>
            <div className="space-y-1.5">
              {appTree.roots.map((root) => <TreeRow key={root.path} node={root} depth={0} />)}
            </div>
            {appTree.orphans.length > 0 && (
              <div className="pt-2 border-t border-line">
                {/* An orphan is usually a screen the user cannot reach — a real bug in their app, so it
                    is surfaced rather than hidden. */}
                <div className="text-[11px] font-bold text-warn mb-1">Not used by any screen</div>
                <div className="space-y-1">
                  {appTree.orphans.map((o) => <TreeRow key={o.path} node={o} depth={0} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Build Health — one-click aggregate of every robustness check */}
      <Card icon={<Brain className="w-4 h-4 text-accent-text" />} title="Build Health — Will this app work?"
        action={<Button size="sm" onClick={runHealth} disabled={healthBusy} className="uppercase tracking-widest bg-violet-600 hover:bg-violet-700">{healthBusy ? 'Running…' : 'Run All Checks'}</Button>}>
        {!health ? (
          <p className="text-[11px] text-muted">Run every build-robustness check at once — code confidence, React Rules of Hooks, import/export consistency, and JSX component resolution — for a single verdict on whether the generated app will build and run.</p>
        ) : (
          <div className="space-y-2">
            <div className={`text-sm font-black ${health.ok ? 'text-success' : 'text-danger'}`}>
              {health.ok ? `✓ All checks passed across ${health.filesScanned} file(s) — good to ship.` : `✗ ${health.totalIssues} issue(s) found — fix before shipping.`}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {health.checks.map((c: any) => (
                <div key={c.id} className="flex items-start gap-2 bg-well rounded-xl px-3 py-2">
                  <span className={c.ok ? 'text-success' : 'text-danger'}>{c.ok ? '✓' : '✗'}</span>
                  <div>
                    <div className="text-[11px] font-bold text-ink">{c.name}{c.issues > 0 ? ` (${c.issues})` : ''}</div>
                    <div className="text-[10px] text-muted">{c.summary}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Build SLO */}
      <Card icon={<Activity className="w-4 h-4 text-success" />} title="Build SLO Compliance"
        action={<Button variant="ghost" size="sm" onClick={fetchSlo} className="uppercase tracking-widest"><RefreshCcw className="w-3 h-3" />Refresh</Button>}>
        {!slo || slo.totalBuilds === 0 ? (
          <p className="text-[11px] text-muted">No builds yet — SLO compliance appears once builds have run.</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-4">
              <Donut
                size={72}
                thickness={10}
                slices={[
                  { value: Math.max(0, (slo.totalBuilds || 0) - (slo.totalViolations || 0)), color: '#10b981', label: 'Within SLO' },
                  { value: slo.totalViolations || 0, color: '#ef4444', label: 'Over SLO' },
                ]}
                center={<span className="text-ink font-black text-sm">{Math.round((1 - (slo.overallViolationRate || 0)) * 100)}%</span>}
              />
              <div className="text-xs text-muted">Builds: <span className="text-ink font-bold">{slo.totalBuilds}</span> · Violations: <span className="text-danger font-bold">{slo.totalViolations}</span> ({Math.round((slo.overallViolationRate || 0) * 100)}%)<div className="text-[10px] mt-1">Green = within SLO · red = over.</div></div>
            </div>
            {(slo.byTier || []).map((t: any) => (
              <div key={t.tier} className="flex justify-between bg-well rounded-xl px-4 py-2 text-[11px]">
                <span className="text-ink font-bold uppercase">{t.tier} <span className="text-muted normal-case">(SLO {fmtSec(t.sloMs)})</span></span>
                <span className="text-muted">{t.builds} builds · {Math.round((t.violationRate || 0) * 100)}% over · p95 {fmtSec(t.p95Ms)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Code Confidence (P-AI.1 hallucination check) */}
      <Card icon={<Brain className="w-4 h-4 text-accent-text" />} title="Code Confidence (AI hallucination check)"
        action={<Button size="sm" onClick={runConf} disabled={confBusy} className="uppercase tracking-widest bg-fuchsia-600 hover:bg-fuchsia-700">{confBusy ? 'Checking…' : 'Check Code'}</Button>}>
        {!conf ? (
          <p className="text-[11px] text-muted">Scan the generated code for hallucination signals — undeclared (hallucinated) dependencies, imports to files that don't exist, and placeholder/"not implemented" stubs — and get a confidence score.</p>
        ) : (
          <div className="space-y-2 text-[11px]">
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-black ${confColor(conf.confidence)}`}>{conf.confidence}%</span>
              <span className="text-muted">confidence {conf.isLowConfidence ? '· ⚠ low — review before shipping' : '· looks solid'}</span>
            </div>
            <div className="text-muted">
              Hallucinated deps: <span className="text-ink font-bold">{conf.counts['hallucinated-dependency']}</span> ·
              Unresolved imports: <span className="text-ink font-bold">{conf.counts['unresolved-local-import']}</span> ·
              Stubs: <span className="text-ink font-bold">{conf.counts['placeholder-stub']}</span>
            </div>
            {conf.signals.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-auto">{conf.signals.slice(0, 30).map((s: any, i: number) => (
                <div key={i} className="bg-well rounded px-3 py-1 font-mono text-[10px] text-warn">{s.kind}: <span className="text-ink">{s.detail}</span> <span className="text-muted">({s.file})</span></div>
              ))}</div>
            )}
          </div>
        )}
      </Card>

      {/* React Rules-of-Hooks safety */}
      <Card icon={<Brain className="w-4 h-4 text-info" />} title="React Hooks Safety (Rules of Hooks)"
        action={<Button size="sm" onClick={runHooksRules} disabled={hooksRulesBusy} className="uppercase tracking-widest bg-sky-600 hover:bg-sky-700">{hooksRulesBusy ? 'Checking…' : 'Check Hooks'}</Button>}>
        {!hooksRules ? (
          <p className="text-[11px] text-muted">Scan the generated React code for Rules-of-Hooks violations — hooks called conditionally, after an early return, inside a loop, or from a nested callback. These crash the app at runtime (white screen), so catching them here prevents a broken preview.</p>
        ) : hooksRules.ok ? (
          <div className="text-[11px] text-success font-bold">✓ No Rules-of-Hooks violations across {hooksRules.filesScanned} React file(s).</div>
        ) : (
          <div className="space-y-2 text-[11px]">
            <div className="text-danger font-bold">{hooksRules.violations.length} violation(s) found — these will crash the app at runtime.</div>
            <div className="text-muted">
              Conditional: <span className="text-ink font-bold">{hooksRules.counts['conditional-hook']}</span> ·
              After return: <span className="text-ink font-bold">{hooksRules.counts['hook-after-return']}</span> ·
              In loop: <span className="text-ink font-bold">{hooksRules.counts['hook-in-loop']}</span> ·
              In callback: <span className="text-ink font-bold">{hooksRules.counts['hook-in-callback']}</span>
            </div>
            <div className="space-y-1 max-h-40 overflow-auto">{hooksRules.violations.slice(0, 30).map((v: any, i: number) => (
              <div key={i} className="bg-well rounded px-3 py-1 font-mono text-[10px] text-warn">{v.kind}: <span className="text-ink">{v.hook}()</span> <span className="text-muted">({v.file}:{v.line})</span></div>
            ))}</div>
          </div>
        )}
      </Card>

      {/* Import/Export consistency */}
      <Card icon={<Brain className="w-4 h-4 text-success" />} title="Import / Export Consistency"
        action={<Button size="sm" onClick={runImportChk} disabled={importChkBusy} className="uppercase tracking-widest bg-teal-600 hover:bg-teal-700">{importChkBusy ? 'Checking…' : 'Check Imports'}</Button>}>
        {!importChk ? (
          <p className="text-[11px] text-muted">Scan the generated code for imports of names a local module doesn't actually export (e.g. <span className="font-mono">import &#123; Foo &#125; from './bar'</span> when bar has no <span className="font-mono">Foo</span>). These fail the build with "'Foo' is not exported" — exact symbol-level check.</p>
        ) : importChk.ok ? (
          <div className="text-[11px] text-success font-bold">✓ All imports match their target exports across {importChk.filesScanned} file(s).</div>
        ) : (
          <div className="space-y-2 text-[11px]">
            <div className="text-danger font-bold">{importChk.mismatches.length} broken import(s) — these will fail the build.</div>
            <div className="text-muted">
              Missing named export: <span className="text-ink font-bold">{importChk.counts['named-import-not-exported']}</span> ·
              Missing default export: <span className="text-ink font-bold">{importChk.counts['default-import-missing']}</span>
            </div>
            <div className="space-y-1 max-h-40 overflow-auto">{importChk.mismatches.slice(0, 30).map((m: any, i: number) => (
              <div key={i} className="bg-well rounded px-3 py-1 font-mono text-[10px] text-warn"><span className="text-ink">{m.imported}</span> ✗ {m.from} <span className="text-muted">({m.file}:{m.line})</span></div>
            ))}</div>
          </div>
        )}
      </Card>

      {/* JSX undefined-component */}
      <Card icon={<Brain className="w-4 h-4 text-danger" />} title="JSX Component Resolution"
        action={<Button size="sm" onClick={runJsxChk} disabled={jsxChkBusy} className="uppercase tracking-widest bg-rose-600 hover:bg-rose-700">{jsxChkBusy ? 'Checking…' : 'Check JSX'}</Button>}>
        {!jsxChk ? (
          <p className="text-[11px] text-muted">Scan the generated JSX for components used but never imported or defined (e.g. <span className="font-mono">&lt;Widget /&gt;</span> with no <span className="font-mono">Widget</span> in scope). These throw "Widget is not defined" and white-screen the app — exact AST check that never flags host elements, local components, or props.</p>
        ) : jsxChk.ok ? (
          <div className="text-[11px] text-success font-bold">✓ Every JSX component resolves across {jsxChk.filesScanned} file(s).</div>
        ) : (
          <div className="space-y-2 text-[11px]">
            <div className="text-danger font-bold">{jsxChk.undefinedComponents.length} undefined component(s) — these will crash the app at runtime.</div>
            <div className="space-y-1 max-h-40 overflow-auto">{jsxChk.undefinedComponents.slice(0, 30).map((c: any, i: number) => (
              <div key={i} className="bg-well rounded px-3 py-1 font-mono text-[10px] text-warn">&lt;<span className="text-ink">{c.component}</span>&gt; <span className="text-muted">({c.file}:{c.line})</span></div>
            ))}</div>
          </div>
        )}
      </Card>

      {/* Scaling / load — ROADMAP §2. The verdict deliberately carries NO capacity figure; see
          ScaleAnalysis.ts for why an invented "handles N users" number would be the one claim a user
          would plan a launch around. */}
      <Card icon={<TrendingUp className="w-4 h-4 text-info" />} title="Will this app handle real traffic?"
        action={<Button size="sm" onClick={runScale} disabled={scaleBusy} className="uppercase tracking-widest bg-cyan-600 hover:bg-cyan-700">{scaleBusy ? 'Checking…' : 'Check Scaling'}</Button>}>
        {!scale ? (
          <p className="text-[11px] text-muted">Find the three things that actually slow an app down as it grows: queries that read <span className="font-mono">every</span> row, database calls running inside a loop, and filters on columns your migrations never indexed. Each finding says how the cost grows with your data and the exact change that fixes it.</p>
        ) : (
          <div className="space-y-2 text-[11px]">
            <div className={cn('font-bold', scale.ok ? 'text-success' : 'text-warn')}>{scale.ok ? '✓ ' : ''}{scale.verdict}</div>
            {!scale.ok && (
              <div className="space-y-2 max-h-72 overflow-auto">
                {scale.findings.map((f: any, i: number) => (
                  <div key={i} className="bg-well rounded px-3 py-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={cn('font-bold uppercase text-[9px] tracking-widest', f.severity === 'critical' ? 'text-danger' : 'text-warn')}>{f.severity}</span>
                      <span className="font-mono text-[10px] text-muted">{f.file}:{f.line}</span>
                    </div>
                    <div className="text-ink">{f.problem}</div>
                    <div className="text-muted">{f.atScale}</div>
                    <div className="text-success">Fix: {f.fix}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Undefined hook calls */}
      <Card icon={<Brain className="w-4 h-4 text-warn" />} title="Hook Resolution"
        action={<Button size="sm" onClick={runHookRes} disabled={hookResBusy} className="uppercase tracking-widest bg-orange-600 hover:bg-orange-700">{hookResBusy ? 'Checking…' : 'Check Hooks'}</Button>}>
        {!hookRes ? (
          <p className="text-[11px] text-muted">Scan for React hooks called but never imported or defined (e.g. <span className="font-mono">useState(0)</span> with no <span className="font-mono">import &#123; useState &#125;</span>). These throw "useState is not defined" and white-screen the app — exact AST check that never flags imported, local, or member-expression hooks.</p>
        ) : hookRes.ok ? (
          <div className="text-[11px] text-success font-bold">✓ Every hook call resolves across {hookRes.filesScanned} file(s).</div>
        ) : (
          <div className="space-y-2 text-[11px]">
            <div className="text-danger font-bold">{hookRes.undefinedHooks.length} undefined hook(s) — these will crash the app at runtime.</div>
            <div className="space-y-1 max-h-40 overflow-auto">{hookRes.undefinedHooks.slice(0, 30).map((h: any, i: number) => (
              <div key={i} className="bg-well rounded px-3 py-1 font-mono text-[10px] text-warn"><span className="text-ink">{h.hook}()</span> <span className="text-muted">({h.file}:{h.line})</span></div>
            ))}</div>
          </div>
        )}
      </Card>

      {/* Dependency version constraints */}
      <Card icon={<Brain className="w-4 h-4 text-success" />} title="Dependency Constraints"
        action={<Button size="sm" onClick={runDepChk} disabled={depChkBusy} className="uppercase tracking-widest bg-lime-600 hover:bg-lime-700">{depChkBusy ? 'Checking…' : 'Check Deps'}</Button>}>
        {!depChk ? (
          <p className="text-[11px] text-muted">Scan package.json for version conflicts that break <span className="font-mono">npm install</span> or crash the app — a react/react-dom major mismatch, the same package pinned to two majors, or <span className="font-mono">@types</span> drift.</p>
        ) : depChk.ok ? (
          <div className="text-[11px] text-success font-bold">✓ No dependency version conflicts across {depChk.filesScanned} manifest(s).</div>
        ) : (
          <div className="space-y-2 text-[11px]">
            <div className="text-danger font-bold">{depChk.conflicts.length} version conflict(s).</div>
            <div className="space-y-1 max-h-40 overflow-auto">{depChk.conflicts.slice(0, 30).map((c: any, i: number) => (
              <div key={i} className="bg-well rounded px-3 py-1 text-[10px] text-warn"><span className={`font-bold ${c.severity === 'high' ? 'text-danger' : c.severity === 'medium' ? 'text-warn' : 'text-muted'}`}>[{c.severity}]</span> {c.detail} <span className="text-faint">({c.file})</span></div>
            ))}</div>
          </div>
        )}
      </Card>

      {/* Code Explanation (P-DEV.10) */}
      <Card icon={<Activity className="w-4 h-4 text-info" />} title="Explain Code"
        action={<Button size="sm" onClick={runExplain} disabled={explainBusy || !explainInput.trim()} className="uppercase tracking-widest bg-cyan-600 hover:bg-cyan-700">{explainBusy ? 'Reading…' : 'Explain'}</Button>}>
        <p className="text-[11px] text-muted mb-2">Paste a function, component, or file — get an instant, free (no AI credits) plain-language explanation: what it is, its complexity, the patterns it uses, and concrete refactoring tips.</p>
        <textarea
          value={explainInput}
          onChange={(e) => setExplainInput(e.target.value)}
          placeholder="Paste code here…"
          spellCheck={false}
          className="w-full h-24 bg-well border border-line rounded px-2 py-1 text-[10px] font-mono text-body resize-y focus:outline-none focus:border-cyan-500"
        />
        {explainResult && explainResult.kind !== 'empty' && (
          <div className="mt-2 space-y-2 text-[11px]">
            <div className="text-body">{explainResult.summary}</div>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-muted">Complexity: <span className={`font-bold ${cxColor(explainResult.complexity.label)}`}>{explainResult.complexity.label}</span> <span className="text-faint">({explainResult.complexity.score})</span></span>
              <span className="text-faint">·</span>
              <span className="text-muted">{explainResult.stats.lines} lines · {explainResult.stats.functions} fn · {explainResult.stats.hooks} hooks</span>
            </div>
            {explainResult.patterns.length > 0 && (
              <div className="flex flex-wrap gap-1">{explainResult.patterns.map((p: string, i: number) => (
                <span key={i} className="bg-cyan-950/60 text-info rounded px-2 py-0.5 text-[10px]">{p}</span>
              ))}</div>
            )}
            {explainResult.refactors.length > 0 && (
              <div className="space-y-1">{explainResult.refactors.map((r: string, i: number) => (
                <div key={i} className="bg-well rounded px-3 py-1 text-[10px] text-warn">💡 {r}</div>
              ))}</div>
            )}
          </div>
        )}
      </Card>

      {/* Inline Code Review (P-DEV.11) */}
      {workspaceId && (
        <Card icon={<Send className="w-4 h-4 text-accent-text" />} title="Code Review"
          action={<Button size="sm" onClick={loadComments} className="uppercase tracking-widest"><RefreshCcw className="w-3.5 h-3.5" /></Button>}>
          <p className="text-[11px] text-muted">Leave GitHub-style review comments on a specific file + line — resolve or reply as you go. Saved to this project.</p>
          <div className="flex gap-2">
            <input value={rvFile} onChange={(e) => setRvFile(e.target.value)} placeholder="file path" className="flex-1 bg-well border border-line rounded px-2 py-1 text-[10px] font-mono text-body focus:outline-none focus:border-violet-500" />
            <input value={rvLine} onChange={(e) => setRvLine(e.target.value)} placeholder="line" inputMode="numeric" className="w-16 bg-well border border-line rounded px-2 py-1 text-[10px] font-mono text-body focus:outline-none focus:border-violet-500" />
          </div>
          <textarea value={rvBody} onChange={(e) => setRvBody(e.target.value)} placeholder="Comment…" className="w-full h-14 bg-well border border-line rounded px-2 py-1 text-[10px] text-body resize-y focus:outline-none focus:border-violet-500" />
          <Button size="sm" onClick={addComment} disabled={rvBusy || !rvFile.trim() || !rvBody.trim()} className="uppercase tracking-widest bg-violet-600 hover:bg-violet-700">{rvBusy ? 'Adding…' : 'Add comment'}</Button>
          {comments.length > 0 && (
            <div className="space-y-1 max-h-52 overflow-auto">{pagedComments.visible.map((c) => (
              <div key={c.id} className={cn('bg-well rounded px-3 py-2 text-[10px] space-y-1', c.resolved && 'opacity-50')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-accent-text">{c.file}:{c.line}</span>
                  <button onClick={() => toggleResolve(c.id, !c.resolved)} className={cn('text-[9px] uppercase tracking-widest', c.resolved ? 'text-muted' : 'text-success')}>{c.resolved ? 'Reopen' : 'Resolve'}</button>
                </div>
                <div className="text-body">{c.body}</div>
                {Array.isArray(c.replies) && c.replies.length > 0 && <div className="text-faint">{c.replies.length} repl{c.replies.length === 1 ? 'y' : 'ies'}</div>}
              </div>
            ))}</div>
          )}
          <LoadMore list={pagedComments} label="comments" />
        </Card>
      )}

      {/* SBOM */}
      <Card icon={<ShieldCheck className="w-4 h-4 text-accent-text" />} title="App SBOM + License Check"
        action={<Button size="sm" onClick={runSbom} disabled={sbomBusy} className="uppercase tracking-widest">{sbomBusy ? 'Scanning…' : 'Generate SBOM'}</Button>}>
        {sbomMsg && <p className="text-[11px] text-warn">{sbomMsg}</p>}
        {sbom && (
          <div className="space-y-2 text-[11px]">
            <div className="text-muted">Dependencies: <span className="text-ink font-bold">{sbom.componentCount}</span></div>
            <div className={sbom.hasCopyleftRisk ? 'text-danger font-bold' : 'text-success font-bold'}>
              {sbom.hasCopyleftRisk ? `⚠ ${sbom.copyleft.strong.length} strong-copyleft (GPL/AGPL) dependency(ies) — review before shipping commercially` : '✓ No strong-copyleft (GPL/AGPL) dependencies'}
            </div>
            {sbom.hasCopyleftRisk && (
              <div className="space-y-1">{sbom.copyleft.strong.map((c: any, i: number) => (
                <div key={i} className="bg-red-950/20 border border-red-500/20 rounded px-3 py-1 font-mono text-[10px] text-danger">{c.name}@{c.version} — {c.license}</div>
              ))}</div>
            )}
          </div>
        )}
        {!sbom && !sbomMsg && <p className="text-[11px] text-muted">Generate a CycloneDX SBOM + GPL/AGPL license check for this app's dependencies.</p>}
      </Card>

      {/* Webhooks */}
      <Card icon={<WebhookIcon className="w-4 h-4 text-info" />} title="Webhooks"
        action={
          <div className="flex items-center gap-1.5">
            <Popover align="right" trigger={<button aria-label="Which events fire?" className="text-muted hover:text-ink text-[11px] w-5 h-5 rounded-full border border-line leading-none">?</button>}>
              <div className="px-2 py-1.5 text-[11px] text-body max-w-[15rem] space-y-1">
                <p className="font-bold text-ink">Events delivered</p>
                <p>BUILD_COMPLETE · BUILD_FAILED · DEPLOY_COMPLETE · DEPLOY_FAILED — a POST is sent to every configured URL.</p>
              </div>
            </Popover>
            {hooks.length > 0 && <Button variant="ghost" size="sm" onClick={testHooks} className="uppercase tracking-widest text-info"><Send className="w-3 h-3" />Send test</Button>}
          </div>
        }>
        {!uid ? (
          <p className="text-[11px] text-muted">Sign in to manage webhooks for build/deploy events.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] text-muted">Get a POST on BUILD_COMPLETE / FAILED / DEPLOY_COMPLETE / FAILED — wire builds into Slack/Discord/your CI.</p>
            <div className="flex gap-2">
              <Input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://hooks.slack.com/…" className="flex-1 bg-well focus:border-cyan-500" />
              <Button onClick={addHook} disabled={whBusy || !newUrl.trim()} className="bg-cyan-600 hover:bg-cyan-700"><Plus className="w-3.5 h-3.5" />Add</Button>
            </div>
            {whMsg && <p className="text-[11px] text-warn">{whMsg}</p>}
            <div className="space-y-1.5">
              {hooks.length === 0 && <p className="text-[10px] text-muted uppercase font-bold">No webhooks yet.</p>}
              {hooks.map(h => (
                <div key={h.id} className="flex items-center justify-between bg-well rounded-lg px-3 py-2">
                  <span className="text-[11px] text-ink font-mono truncate max-w-[60%]">{h.url}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-muted">{(h.events || []).length} events</span>
                    <button onClick={() => delHook(h.id)} className="text-danger hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

export default ProjectInsightsPanel;

/**
 * One file in the tree. Shows the NAME the user recognises plus the plain-language role, and says out
 * loud when a branch was cut or loops — a tree that silently stopped would imply the app is smaller
 * than it is.
 */
function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[11px] min-w-0" style={{ paddingLeft: depth * 14 }}>
        <FileCode className="w-3 h-3 shrink-0 text-faint" />
        <span className="font-mono text-body truncate" title={node.path}>{node.name}</span>
        {node.label && <span className="text-faint shrink-0">· {node.label}</span>}
        {node.cyclic && <span className="text-warn shrink-0" title="These files import each other">· loops back</span>}
        {node.truncated && <span className="text-faint shrink-0">· more inside</span>}
      </div>
      {node.children.map((c) => <TreeRow key={`${node.path}>${c.path}`} node={c} depth={depth + 1} />)}
    </div>
  );
}
