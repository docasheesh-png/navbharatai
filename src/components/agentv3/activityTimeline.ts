// AgentV3 — Claude-style chat timeline grouping (pure, fully unit-testable).
//
// THE REDESIGN (admin, 2026-07-02): v5.0's build progress used to be a noisy flat stream —
// "⏱️ Estimated build time ~13 min", "✓ src/lib/utils.ts (1/33)" × 33, "⏱ minute 4 — still
// working…" — every file, timer and heartbeat its own chat line. The admin wants the Claude
// Code presentation instead: the agent's PROSE stays conversational, and everything the engine
// DID between two prose lines collapses into one glanceable action row — "Created 33 files",
// "Edited AgentV3Panel.tsx +38 -0", "Read 2 files, ran 10 commands" — expandable to the real
// underlying activity (real file paths, real bash commands, real ✓/✗ results).
//
// This module is the PURE brain of that redesign. It takes the already-merged chat messages
// (user + agent prose, ts-ordered), the live activity feed (real tool_call/tool_result/
// file_changed events — never synthetic), and the diff map (real patches), and produces the
// ordered block list the chat renders. No I/O, no React — the component stays thin.

import type { ActivityEntry } from './agentV3Types';

/** The minimal message shape the grouper needs — the panel's ChatMsg satisfies it. */
export interface TimelineMsgLike {
  role: 'user' | 'agent';
  text: string;
  ts: number;
}

export type ChatBlock<M extends TimelineMsgLike> =
  | { kind: 'msg'; key: string; msg: M }
  | {
      kind: 'actions';
      key: string;
      ts: number;
      /** The real activity entries in this group (render these on expand). */
      entries: ActivityEntry[];
      /** Claude-style one-line summary, e.g. "Created 33 files, ran 2 commands". */
      summary: string;
      /** Real diff stats summed from the patches of files this group created/edited (null = none known). */
      stats: { plus: number; minus: number } | null;
      /** The created/edited files in this group that have a real diff patch — rendered as the inline,
       *  PERSISTENT colorized diff under the response (admin 2026-07-21: "diff gayab na ho"). */
      files: Array<{ path: string; patch: string; op: 'create' | 'edit' }>;
      /** True while any entry in the group is still in-flight (renders a spinner). */
      active: boolean;
      /** True when any entry failed (renders the row with a failure accent). */
      failed: boolean;
      /** Live progress note from the engine's per-file ticks, e.g. "12/33 files" (active builds). */
      progress: string | null;
    };

/**
 * Transient engine chatter that must NOT render as prose bubbles: ETA/heartbeat timers and the
 * per-file "✓ path (12/33)" ticks (those are represented by the action rows instead — the ticks
 * still feed the live progress note). Everything else the agent says is real conversation.
 */
export function isProgressNoise(text: string): boolean {
  const t = (text || '').trim();
  if (t.startsWith('⏱')) return true;                 // "⏱️ Estimated build time…", "⏱️ Still building…", "⏱ minute N — still working"
  if (/^✓ \S+ \(\d+\/\d+\)$/.test(t)) return true;    // per-file build tick
  return false;
}

/** Parse a per-file build tick ("✓ src/App.tsx (12/33)") into its progress counters. */
export function parseFileTick(text: string): { done: number; total: number } | null {
  const m = /^✓ \S+ \((\d+)\/(\d+)\)$/.exec((text || '').trim());
  if (!m) return null;
  return { done: parseInt(m[1], 10), total: parseInt(m[2], 10) };
}

/** Count real +/- lines in a unified diff patch (excluding the +++/--- file headers). */
export function diffStats(patch: string): { plus: number; minus: number } {
  let plus = 0;
  let minus = 0;
  for (const line of (patch || '').split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) plus++;
    else if (line.startsWith('-')) minus++;
  }
  return { plus, minus };
}

const basename = (p: string): string => p.split('/').pop() || p;

/**
 * The created/edited files in a group that have a KNOWN diff patch, in first-appearance order — the
 * data behind the inline "changes" diff under a response. A file both created and edited in the group
 * shows once (as 'create'). Only real patches (from the diff map) are included; a file with no patch
 * yet is omitted (never a fabricated diff).
 */
export function groupFileDiffs(
  entries: ActivityEntry[],
  diffs: Record<string, string>,
): Array<{ path: string; patch: string; op: 'create' | 'edit' }> {
  const created = new Set<string>();
  for (const e of entries) {
    const c = classify(e);
    if (c.op === 'create' || c.op === 'write') created.add(c.path);
  }
  const seen = new Set<string>();
  const out: Array<{ path: string; patch: string; op: 'create' | 'edit' }> = [];
  for (const e of entries) {
    const c = classify(e);
    if (c.op !== 'create' && c.op !== 'edit' && c.op !== 'write' && c.op !== 'editing') continue;
    if (seen.has(c.path)) continue;
    const patch = diffs[c.path];
    if (!patch) continue;
    seen.add(c.path);
    out.push({ path: c.path, patch, op: created.has(c.path) ? 'create' : 'edit' });
  }
  return out;
}

/** What a single activity entry means, parsed from the reducer's deterministic text formats. */
function classify(e: ActivityEntry):
  | { op: 'create' | 'edit' | 'delete' | 'write' | 'editing' | 'read'; path: string }
  | { op: 'command'; command: string }
  | { op: 'search' } | { op: 'agent'; text: string } | { op: 'preview' } | { op: 'plan' } | { op: 'other'; text: string } {
  const t = e.text || '';
  if (e.kind === 'file') {
    const m = /^(created|edited|deleted) (.+)$/.exec(t);
    if (m) return { op: m[1] === 'created' ? 'create' : m[1] === 'deleted' ? 'delete' : 'edit', path: m[2] };
  }
  if (e.kind === 'agent') return { op: 'agent', text: t };
  if (e.kind === 'preview') return { op: 'preview' };
  if (e.kind === 'plan') return { op: 'plan' };
  let m = /^writing (.+)$/.exec(t);
  if (m) return { op: 'write', path: m[1] };
  m = /^editing (.+)$/.exec(t);
  if (m) return { op: 'editing', path: m[1] };
  m = /^reading (.+)$/.exec(t);
  if (m) return { op: 'read', path: m[1] };
  m = /^running: (.*)$/s.exec(t);
  if (m) return { op: 'command', command: m[1] };
  if (/^searching\b|^listing files$/.test(t)) return { op: 'search' };
  if (t === 'updating the plan') return { op: 'plan' };
  return { op: 'other', text: t };
}

/**
 * Claude-style summary + real diff stats for one group of activity entries.
 * Created/edited counts are DISTINCT PATHS (a write_file tool call and its file_changed event
 * describe the same file — union, never double-count). Stats sum the real patches of the
 * group's created/edited files; when no patch is known there is no number (never a fake one).
 */
export function summarizeActions(
  entries: ActivityEntry[],
  diffs: Record<string, string>,
): { summary: string; stats: { plus: number; minus: number } | null } {
  const created = new Set<string>();
  const edited = new Set<string>();
  const deleted = new Set<string>();
  const read = new Set<string>();
  const commands: string[] = [];
  let searches = 0;
  const agents: string[] = [];
  let previews = 0;
  let plans = 0;
  const others: string[] = [];

  for (const e of entries) {
    const c = classify(e);
    switch (c.op) {
      case 'create': case 'write': created.add(c.path); break;
      case 'edit': case 'editing': edited.add(c.path); break;
      case 'delete': deleted.add(c.path); break;
      case 'read': read.add(c.path); break;
      case 'command': commands.push(c.command); break;
      case 'search': searches++; break;
      case 'agent': agents.push(c.text); break;
      case 'preview': previews++; break;
      case 'plan': plans++; break;
      case 'other': others.push(c.text); break;
    }
  }
  // A file both created and edited in one group is just "created".
  for (const p of created) edited.delete(p);

  const parts: string[] = [];
  if (created.size) parts.push(created.size === 1 ? `Created ${basename([...created][0])}` : `Created ${created.size} files`);
  if (edited.size) parts.push(edited.size === 1 ? `Edited ${basename([...edited][0])}` : `Edited ${edited.size} files`);
  if (deleted.size) parts.push(deleted.size === 1 ? `Deleted ${basename([...deleted][0])}` : `Deleted ${deleted.size} files`);
  if (read.size) parts.push(read.size === 1 ? 'Read a file' : `Read ${read.size} files`);
  if (commands.length) parts.push(commands.length === 1 ? `Ran \`${commands[0].length > 40 ? `${commands[0].slice(0, 40)}…` : commands[0]}\`` : `Ran ${commands.length} commands`);
  if (searches) parts.push(searches === 1 ? 'Searched files' : `Searched ${searches}×`);
  if (agents.length) parts.push(agents.length === 1 ? `Launched ${agents[0].split(' — ')[0]}` : `Launched ${agents.length} agents`);
  if (previews) parts.push('Published the preview');
  if (plans) parts.push('Updated the plan');
  if (!parts.length && others.length) parts.push(others[0]);
  if (!parts.length) parts.push('Worked');

  // First part keeps its capital; the rest read as a Claude-style comma list.
  const summary = parts.map((p, i) => (i === 0 ? p : p.charAt(0).toLowerCase() + p.slice(1))).join(', ');

  let plus = 0;
  let minus = 0;
  let sawPatch = false;
  for (const p of [...created, ...edited]) {
    const patch = diffs[p];
    if (!patch) continue;
    sawPatch = true;
    const s = diffStats(patch);
    plus += s.plus;
    minus += s.minus;
  }
  return { summary, stats: sawPatch ? { plus, minus } : null };
}

/**
 * Whether an action group should be OPEN (its per-file lines shown inline in the chat feed) by default,
 * given the user's explicit toggle (null = untouched) and whether the group is still ACTIVE. Admin
 * 2026-07-12 ("real-time progress — har file main chat me dikhe, hide me nahi"): while a build is running
 * the group auto-EXPANDS so every "writing X / created X" streams live in the feed instead of being hidden
 * behind a click; once the build finishes it auto-collapses to the glanceable summary. A user tap on the row
 * overrides either way and sticks. Pure + tested.
 */
export function actionGroupOpen(userOverride: boolean | null, active: boolean): boolean {
  return userOverride ?? active;
}

/** Cap on the archived cross-turn activity log (memory bound for very long sessions). */
export const ACTIVITY_LOG_CAP = 600;

/**
 * Archive a settled turn's activity into the cross-turn log (admin 2026-07-21 — "diff gayab na ho"):
 * called by the hook when a NEW build starts, so the previous turn's action rows (files created,
 * diff stats) stay anchored in the chat instead of vanishing. Entries are deactivated (their build
 * is over — a spinner would be a lie) and the whole log is capped to the newest entries.
 */
export function carryOverActivity(prevLog: ActivityEntry[], prevActivity: ActivityEntry[]): ActivityEntry[] {
  const settled = prevActivity.map((e) => (e.active ? { ...e, active: false } : e));
  return [...prevLog, ...settled].slice(-ACTIVITY_LOG_CAP);
}

/** Detail rows for an expanded group: real entries, minus tool lines that duplicate a file event. */
/**
 * The file path an activity row is about, or null when the row is not about a file.
 *
 * Exported so the ROW component can label a file without re-parsing the entry text — the parsing
 * rules live here, and a second copy in the component is how the two would drift apart.
 */
export function entryFilePath(e: ActivityEntry): string | null {
  const c = classify(e);
  return 'path' in c && c.path ? c.path : null;
}

export function detailEntries(entries: ActivityEntry[]): ActivityEntry[] {
  const filePaths = new Set<string>();
  for (const e of entries) {
    const c = classify(e);
    if ((c.op === 'create' || c.op === 'edit' || c.op === 'delete') && e.kind === 'file') filePaths.add(c.path);
  }
  return entries.filter((e) => {
    const c = classify(e);
    if ((c.op === 'write' || c.op === 'editing') && filePaths.has(c.path)) return false; // its file_changed row already shows it
    return true;
  });
}

/**
 * Build the ordered chat blocks: prose (user + agent talk) interleaved with collapsed action
 * groups — consecutive activity entries between two prose messages form ONE group, exactly the
 * Claude Code rhythm. Progress ticks feed the live "12/33 files" note on the still-active group.
 */
export function buildChatBlocks<M extends TimelineMsgLike>(
  msgs: M[],
  activity: ActivityEntry[],
  diffs: Record<string, string>,
): Array<ChatBlock<M>> {
  const prose = msgs.filter((m) => m.role === 'user' || !isProgressNoise(m.text));
  // Latest per-file tick → the active group's progress note.
  let tick: { done: number; total: number; ts: number } | null = null;
  for (const m of msgs) {
    if (m.role !== 'agent') continue;
    const t = parseFileTick(m.text);
    if (t) tick = { ...t, ts: m.ts };
  }

  const blocks: Array<ChatBlock<M>> = [];
  let group: ActivityEntry[] = [];
  const flush = (): void => {
    if (!group.length) return;
    const { summary, stats } = summarizeActions(group, diffs);
    blocks.push({
      kind: 'actions',
      key: `act-${group[0].ts}-${group[0].id}`,
      ts: group[0].ts,
      entries: group,
      summary,
      stats,
      files: groupFileDiffs(group, diffs),
      active: group.some((e) => e.active === true),
      failed: group.some((e) => e.ok === false),
      progress: null,
    });
    group = [];
  };

  let i = 0;
  let j = 0;
  while (i < prose.length || j < activity.length) {
    // Prose wins ties so "let me fix X" reads before the actions it narrates.
    if (j >= activity.length || (i < prose.length && prose[i].ts <= activity[j].ts)) {
      flush();
      blocks.push({ kind: 'msg', key: `msg-${prose[i].ts}-${i}`, msg: prose[i] });
      i++;
    } else {
      group.push(activity[j]);
      j++;
    }
  }
  flush();

  // Attach the live progress note to the LAST block when it is a still-active action group and
  // the tick is newer than the group's start (an active build writing its files).
  const last = blocks[blocks.length - 1];
  if (last && last.kind === 'actions' && last.active && tick && tick.ts >= last.ts && tick.done < tick.total) {
    last.progress = `${tick.done}/${tick.total} files`;
  }
  return blocks;
}
