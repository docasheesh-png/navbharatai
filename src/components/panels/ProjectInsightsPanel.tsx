/**
 * Project Insights & Integrations panel — wires the previously-headless backends into the actual
 * v3.0 UI so they DO something visible:
 *   - Build SLO compliance        → GET  /api/analytics/slo        (P-PME.11)
 *   - App SBOM + license check     → POST /api/workspace/sbom       (P-BRE.10)
 *   - Webhook management           → /api/webhooks/:userId CRUD     (P-PME.9)
 *
 * Reachable from Settings → "Insights & Webhooks". Real data only — honest empty/zero states, no fakes.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Activity, ShieldCheck, Webhook as WebhookIcon, Plus, Trash2, RefreshCcw, Send, Brain } from 'lucide-react';
import type { User as FirebaseUser } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Popover } from '../ui/Popover';
import { Donut } from '../ui/charts';
import { cardClasses } from '../ui/variants';

interface ProjectInsightsPanelProps {
  user: FirebaseUser | null;
  files: Record<string, string>;
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
      <div className="flex items-center gap-2">{icon}<h3 className="text-sm font-black text-white uppercase tracking-tight">{title}</h3></div>
      {action}
    </div>
    {children}
  </div>
);

export const ProjectInsightsPanel: React.FC<ProjectInsightsPanelProps> = ({ user, files }) => {
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

  const fmtSec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const confColor = (c: number) => (c >= 85 ? 'text-emerald-400' : c >= 70 ? 'text-amber-400' : 'text-red-400');

  return (
    <div className="flex-1 h-full overflow-auto bg-[#0d1117] p-6 space-y-5">
      <h2 className="text-lg font-black text-white tracking-tight">Insights & Integrations</h2>

      {/* Build SLO */}
      <Card icon={<Activity className="w-4 h-4 text-emerald-400" />} title="Build SLO Compliance"
        action={<Button variant="ghost" size="sm" onClick={fetchSlo} className="uppercase tracking-widest"><RefreshCcw className="w-3 h-3" />Refresh</Button>}>
        {!slo || slo.totalBuilds === 0 ? (
          <p className="text-[11px] text-[#8b949e]">No builds yet — SLO compliance appears once builds have run.</p>
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
                center={<span className="text-white font-black text-sm">{Math.round((1 - (slo.overallViolationRate || 0)) * 100)}%</span>}
              />
              <div className="text-xs text-[#8b949e]">Builds: <span className="text-white font-bold">{slo.totalBuilds}</span> · Violations: <span className="text-red-400 font-bold">{slo.totalViolations}</span> ({Math.round((slo.overallViolationRate || 0) * 100)}%)<div className="text-[10px] mt-1">Green = within SLO · red = over.</div></div>
            </div>
            {(slo.byTier || []).map((t: any) => (
              <div key={t.tier} className="flex justify-between bg-black/30 rounded-xl px-4 py-2 text-[11px]">
                <span className="text-white font-bold uppercase">{t.tier} <span className="text-[#8b949e] normal-case">(SLO {fmtSec(t.sloMs)})</span></span>
                <span className="text-[#8b949e]">{t.builds} builds · {Math.round((t.violationRate || 0) * 100)}% over · p95 {fmtSec(t.p95Ms)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Code Confidence (P-AI.1 hallucination check) */}
      <Card icon={<Brain className="w-4 h-4 text-fuchsia-400" />} title="Code Confidence (AI hallucination check)"
        action={<Button size="sm" onClick={runConf} disabled={confBusy} className="uppercase tracking-widest bg-fuchsia-600 hover:bg-fuchsia-700">{confBusy ? 'Checking…' : 'Check Code'}</Button>}>
        {!conf ? (
          <p className="text-[11px] text-[#8b949e]">Scan the generated code for hallucination signals — undeclared (hallucinated) dependencies, imports to files that don't exist, and placeholder/"not implemented" stubs — and get a confidence score.</p>
        ) : (
          <div className="space-y-2 text-[11px]">
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-black ${confColor(conf.confidence)}`}>{conf.confidence}%</span>
              <span className="text-[#8b949e]">confidence {conf.isLowConfidence ? '· ⚠ low — review before shipping' : '· looks solid'}</span>
            </div>
            <div className="text-[#8b949e]">
              Hallucinated deps: <span className="text-white font-bold">{conf.counts['hallucinated-dependency']}</span> ·
              Unresolved imports: <span className="text-white font-bold">{conf.counts['unresolved-local-import']}</span> ·
              Stubs: <span className="text-white font-bold">{conf.counts['placeholder-stub']}</span>
            </div>
            {conf.signals.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-auto">{conf.signals.slice(0, 30).map((s: any, i: number) => (
                <div key={i} className="bg-black/30 rounded px-3 py-1 font-mono text-[10px] text-amber-300">{s.kind}: <span className="text-white">{s.detail}</span> <span className="text-[#8b949e]">({s.file})</span></div>
              ))}</div>
            )}
          </div>
        )}
      </Card>

      {/* React Rules-of-Hooks safety */}
      <Card icon={<Brain className="w-4 h-4 text-sky-400" />} title="React Hooks Safety (Rules of Hooks)"
        action={<Button size="sm" onClick={runHooksRules} disabled={hooksRulesBusy} className="uppercase tracking-widest bg-sky-600 hover:bg-sky-700">{hooksRulesBusy ? 'Checking…' : 'Check Hooks'}</Button>}>
        {!hooksRules ? (
          <p className="text-[11px] text-[#8b949e]">Scan the generated React code for Rules-of-Hooks violations — hooks called conditionally, after an early return, inside a loop, or from a nested callback. These crash the app at runtime (white screen), so catching them here prevents a broken preview.</p>
        ) : hooksRules.ok ? (
          <div className="text-[11px] text-emerald-400 font-bold">✓ No Rules-of-Hooks violations across {hooksRules.filesScanned} React file(s).</div>
        ) : (
          <div className="space-y-2 text-[11px]">
            <div className="text-red-400 font-bold">{hooksRules.violations.length} violation(s) found — these will crash the app at runtime.</div>
            <div className="text-[#8b949e]">
              Conditional: <span className="text-white font-bold">{hooksRules.counts['conditional-hook']}</span> ·
              After return: <span className="text-white font-bold">{hooksRules.counts['hook-after-return']}</span> ·
              In loop: <span className="text-white font-bold">{hooksRules.counts['hook-in-loop']}</span> ·
              In callback: <span className="text-white font-bold">{hooksRules.counts['hook-in-callback']}</span>
            </div>
            <div className="space-y-1 max-h-40 overflow-auto">{hooksRules.violations.slice(0, 30).map((v: any, i: number) => (
              <div key={i} className="bg-black/30 rounded px-3 py-1 font-mono text-[10px] text-amber-300">{v.kind}: <span className="text-white">{v.hook}()</span> <span className="text-[#8b949e]">({v.file}:{v.line})</span></div>
            ))}</div>
          </div>
        )}
      </Card>

      {/* Import/Export consistency */}
      <Card icon={<Brain className="w-4 h-4 text-teal-400" />} title="Import / Export Consistency"
        action={<Button size="sm" onClick={runImportChk} disabled={importChkBusy} className="uppercase tracking-widest bg-teal-600 hover:bg-teal-700">{importChkBusy ? 'Checking…' : 'Check Imports'}</Button>}>
        {!importChk ? (
          <p className="text-[11px] text-[#8b949e]">Scan the generated code for imports of names a local module doesn't actually export (e.g. <span className="font-mono">import &#123; Foo &#125; from './bar'</span> when bar has no <span className="font-mono">Foo</span>). These fail the build with "'Foo' is not exported" — exact symbol-level check.</p>
        ) : importChk.ok ? (
          <div className="text-[11px] text-emerald-400 font-bold">✓ All imports match their target exports across {importChk.filesScanned} file(s).</div>
        ) : (
          <div className="space-y-2 text-[11px]">
            <div className="text-red-400 font-bold">{importChk.mismatches.length} broken import(s) — these will fail the build.</div>
            <div className="text-[#8b949e]">
              Missing named export: <span className="text-white font-bold">{importChk.counts['named-import-not-exported']}</span> ·
              Missing default export: <span className="text-white font-bold">{importChk.counts['default-import-missing']}</span>
            </div>
            <div className="space-y-1 max-h-40 overflow-auto">{importChk.mismatches.slice(0, 30).map((m: any, i: number) => (
              <div key={i} className="bg-black/30 rounded px-3 py-1 font-mono text-[10px] text-amber-300"><span className="text-white">{m.imported}</span> ✗ {m.from} <span className="text-[#8b949e]">({m.file}:{m.line})</span></div>
            ))}</div>
          </div>
        )}
      </Card>

      {/* SBOM */}
      <Card icon={<ShieldCheck className="w-4 h-4 text-indigo-400" />} title="App SBOM + License Check"
        action={<Button size="sm" onClick={runSbom} disabled={sbomBusy} className="uppercase tracking-widest">{sbomBusy ? 'Scanning…' : 'Generate SBOM'}</Button>}>
        {sbomMsg && <p className="text-[11px] text-amber-400">{sbomMsg}</p>}
        {sbom && (
          <div className="space-y-2 text-[11px]">
            <div className="text-[#8b949e]">Dependencies: <span className="text-white font-bold">{sbom.componentCount}</span></div>
            <div className={sbom.hasCopyleftRisk ? 'text-red-400 font-bold' : 'text-emerald-400 font-bold'}>
              {sbom.hasCopyleftRisk ? `⚠ ${sbom.copyleft.strong.length} strong-copyleft (GPL/AGPL) dependency(ies) — review before shipping commercially` : '✓ No strong-copyleft (GPL/AGPL) dependencies'}
            </div>
            {sbom.hasCopyleftRisk && (
              <div className="space-y-1">{sbom.copyleft.strong.map((c: any, i: number) => (
                <div key={i} className="bg-red-950/20 border border-red-500/20 rounded px-3 py-1 font-mono text-[10px] text-red-300">{c.name}@{c.version} — {c.license}</div>
              ))}</div>
            )}
          </div>
        )}
        {!sbom && !sbomMsg && <p className="text-[11px] text-[#8b949e]">Generate a CycloneDX SBOM + GPL/AGPL license check for this app's dependencies.</p>}
      </Card>

      {/* Webhooks */}
      <Card icon={<WebhookIcon className="w-4 h-4 text-cyan-400" />} title="Webhooks"
        action={
          <div className="flex items-center gap-1.5">
            <Popover align="right" trigger={<button aria-label="Which events fire?" className="text-[#8b949e] hover:text-white text-[11px] w-5 h-5 rounded-full border border-white/15 leading-none">?</button>}>
              <div className="px-2 py-1.5 text-[11px] text-[#c9d1d9] max-w-[15rem] space-y-1">
                <p className="font-bold text-white">Events delivered</p>
                <p>BUILD_COMPLETE · BUILD_FAILED · DEPLOY_COMPLETE · DEPLOY_FAILED — a POST is sent to every configured URL.</p>
              </div>
            </Popover>
            {hooks.length > 0 && <Button variant="ghost" size="sm" onClick={testHooks} className="uppercase tracking-widest text-cyan-400"><Send className="w-3 h-3" />Send test</Button>}
          </div>
        }>
        {!uid ? (
          <p className="text-[11px] text-[#8b949e]">Sign in to manage webhooks for build/deploy events.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] text-[#8b949e]">Get a POST on BUILD_COMPLETE / FAILED / DEPLOY_COMPLETE / FAILED — wire builds into Slack/Discord/your CI.</p>
            <div className="flex gap-2">
              <Input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://hooks.slack.com/…" className="flex-1 bg-black/40 focus:border-cyan-500" />
              <Button onClick={addHook} disabled={whBusy || !newUrl.trim()} className="bg-cyan-600 hover:bg-cyan-700"><Plus className="w-3.5 h-3.5" />Add</Button>
            </div>
            {whMsg && <p className="text-[11px] text-amber-400">{whMsg}</p>}
            <div className="space-y-1.5">
              {hooks.length === 0 && <p className="text-[10px] text-[#8b949e] uppercase font-bold">No webhooks yet.</p>}
              {hooks.map(h => (
                <div key={h.id} className="flex items-center justify-between bg-black/30 rounded-lg px-3 py-2">
                  <span className="text-[11px] text-white font-mono truncate max-w-[60%]">{h.url}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-[#8b949e]">{(h.events || []).length} events</span>
                    <button onClick={() => delHook(h.id)} className="text-red-400 hover:text-red-300"><Trash2 className="w-3.5 h-3.5" /></button>
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
