// CHANGE ENGINE slice 7 — the USER's view of their app's memory: what it does, what is still open, what
// changed. The admin sees codes; the user sees plain words, and never a vendor, a model or a routing word.
//
// 🔒 WHITE-LABEL, BY CONSTRUCTION. Every string that leaves here is either a fixed English phrase written
// in this file, a platform feature label, or text passed through `redactProvidersText` — and the result is
// checked with `hasProviderLeak` field by field; a field that still leaks is dropped, not shown. The
// requirement ids and statuses are ours. Nothing in this view can name the AI that did the work.
// PURE.

import type { EngineeringMemory } from './changeLog';
import type { ChangeKind } from './changeClassifier';
import { redactProvidersText, hasProviderLeak } from '../../lib/providerRedaction';

export type PublicRequirementStatus = 'working' | 'built' | 'pending' | 'missing';

export interface PublicAppMemory {
  requirements: Array<{ id: string; label: string; status: PublicRequirementStatus }>;
  openIssues: Array<{ id: string; severity: 'warning' | 'error'; message: string; fixing: boolean }>;
  openIssueCount: number;
  changes: Array<{ id: string; ts: number; summary: string; kind: string; outcome: string; lost: number }>;
}

const KIND_WORDS: Record<ChangeKind, string> = {
  'micro-ui': 'Small visual change',
  local: 'Change',
  feature: 'New feature',
  bug: 'Bug fix',
  refactor: 'Code clean-up',
  'cross-cutting': 'App-wide change',
  data: 'Data change',
  integration: 'Connection to a service',
  security: 'Security change',
  architectural: 'Structure change',
  large: 'Large change',
};

const OUTCOME_WORDS = { completed: 'Done and checked', partial: 'Done, some checks open', failed: 'Did not finish', stopped: 'Stopped' } as const;

function clean(text: string, max: number): string | null {
  const t = redactProvidersText(text).replace(/\s+/g, ' ').trim().slice(0, max);
  return t && !hasProviderLeak(t) ? t : null;
}

export function publicAppMemory(mem: EngineeringMemory): PublicAppMemory {
  const requirements: PublicAppMemory['requirements'] = [];
  for (const i of mem.spec.items) {
    if (i.status === 'dropped') continue;
    const label = clean(i.label, 80);
    if (!label) continue;
    const status: PublicRequirementStatus = i.status === 'verified' ? 'working' : i.status === 'built' ? 'built' : i.status === 'regressed' ? 'missing' : 'pending';
    requirements.push({ id: i.id, label, status });
  }
  const open = mem.queue.issues.filter((i) => i.status === 'triaged' || i.status === 'assigned' || i.status === 'fixed');
  const openIssues: PublicAppMemory['openIssues'] = [];
  for (const i of open.filter((x) => x.status !== 'fixed').slice(0, 10)) {
    const message = clean(i.message, 200);
    if (!message) continue;
    openIssues.push({ id: i.id, severity: i.severity, message, fixing: i.status === 'assigned' });
  }
  const changes: PublicAppMemory['changes'] = [];
  for (const c of [...mem.changes].reverse().slice(0, 20)) {
    changes.push({
      id: c.id, ts: c.ts, summary: clean(c.summary, 160) ?? '', kind: KIND_WORDS[c.kind] ?? 'Change',
      outcome: OUTCOME_WORDS[c.status] ?? 'Done', lost: c.regressed.length,
    });
  }
  return { requirements, openIssues, openIssueCount: open.filter((x) => x.status !== 'fixed').length, changes };
}
