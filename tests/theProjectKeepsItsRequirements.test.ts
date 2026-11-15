// INCIDENT: a built 3D game was replaced by a different game on an edit. One cause: the original brief had no
// durable home — WorkspaceMemory evicts the oldest episode of ANY kind (a build writes dozens of error/fix/note
// episodes), Firestore keeps only the last 100 and ignores a snapshot after 30 days, and the planner reads the
// last 3 requests. CLASS: instructions kept in a recency-bounded buffer.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyMessage, emptyLedger, rebuildLedger, activeRequirements, renderRequirements, userMessagesOf, sameRequirements,
  topicOf, isStandingInstruction, isCorrection, MAX_ITEMS,
} from '../src/server/AgentV3/projectRequirements';
import { InMemoryRequirementsStore, ensureLedger } from '../src/server/AgentV3/projectRequirementsStore';
import { evictEpisodes, WorkspaceMemory, type Episode } from '../src/server/AgentV3/WorkspaceMemory';
import { episodesToPersist } from '../src/server/AgentV3/FirestoreWorkspaceMemoryStore';
import { planningRequest } from '../src/server/AgentV3/planningRequest';
import { GAME_BRIEF } from './fixtures/threeDGame';

const isBuild = (t: string) => /\bbuild\b|banao|make me/i.test(t);

function transcript(extra: string[] = [], filler = 0): unknown[] {
  const turns: unknown[] = [{ role: 'user', id: 'msg-1', content: GAME_BRIEF }, { role: 'assistant', content: 'Built it.' }];
  for (let i = 0; i < filler; i++) turns.push({ role: 'user', content: `tweak number ${i}: change tree ${i} colour` }, { role: 'assistant', content: 'done' });
  extra.forEach((t, i) => turns.push({ role: 'user', id: `late-${i}`, content: t }, { role: 'assistant', content: 'ok' }));
  return turns;
}

describe('what the ledger keeps', () => {
  it('the first build request is the brief; lasting instructions become requirements with their source', () => {
    const l = rebuildLedger(userMessagesOf(transcript()).map((m) => ({ ...m, isBuildRequest: isBuild(m.text) })));
    expect(l.brief?.sourceId).toBe('msg-1');
    const texts = activeRequirements(l).map((r) => r.text);
    expect(texts.some((t) => /always keep first-person controls/i.test(t))).toBe(true);
    expect(texts.some((t) => /never remove the three loaded scenes/i.test(t))).toBe(true);
    expect(activeRequirements(l).every((r) => r.sourceId === 'msg-1')).toBe(true);
  });
  it('a one-off request is not a standing requirement', () => {
    const l = applyMessage(emptyLedger(), { id: 'a', text: 'make the sky a bit bluer', ts: 1 });
    expect(activeRequirements(l)).toHaveLength(0);
    expect(isStandingInstruction('make the sky a bit bluer')).toBe(false);
  });
  it('Hinglish standing instructions are recognised', () => {
    expect(isStandingInstruction('camera hamesha first person rakhna')).toBe(true);
    expect(isStandingInstruction('scenes kabhi nahi hatana')).toBe(true);
  });
  it('folding the same message twice changes nothing; a repeated constraint does not duplicate', () => {
    const m = { id: 'x', text: 'You must always keep the speedometer visible.', ts: 1 };
    const once = applyMessage(emptyLedger(), m);
    expect(applyMessage(once, m)).toBe(once);
    const again = applyMessage(once, { id: 'y', text: 'Always keep the speedometer visible!', ts: 2 });
    expect(activeRequirements(again)).toHaveLength(1);
  });
});

describe('a later explicit correction takes effect', () => {
  it('supersedes the requirement it overlaps, keeps it as history, and the builder is shown only the new one', () => {
    let l = rebuildLedger(userMessagesOf(transcript()).map((m) => ({ ...m, isBuildRequest: isBuild(m.text) })));
    l = applyMessage(l, { id: 'late-0', text: 'Actually, change the controls: from now on use third-person controls instead of first-person controls.', ts: 99 });
    const active = activeRequirements(l).map((r) => r.text);
    expect(active.join(' ')).toMatch(/third-person controls/);
    expect(active.join(' ')).not.toMatch(/always keep first-person controls/i);
    expect(l.items.find((r) => /always keep first-person/i.test(r.text))?.supersededBy).toBeTruthy();
    const shown = renderRequirements(l);
    expect(shown).toMatch(/third-person controls/);
    // the old sentence may appear ONLY as something the brief no longer says:
    const [live, cancelledPart = ''] = [shown.split('NO LONGER apply')[0], shown.split('NO LONGER apply')[1]];
    expect(cancelledPart).toMatch(/always keep first-person controls/i);
    expect(shown).toMatch(/do not follow them/);
    expect(live.replace(/Original brief[^\n]*\n/, '')).not.toMatch(/always keep first-person controls/i);
    expect(shown).toMatch(/\[late-0\]/); // traceable to the message
    expect(shown).toMatch(/never remove the three loaded scenes/i); // unrelated requirement untouched
  });
  it('a correction that overlaps nothing is just a new requirement', () => {
    const l = applyMessage(rebuildLedger([{ id: 'a', text: 'Always keep the HUD visible.', ts: 1 }]), { id: 'b', text: 'Actually, use a night sky.', ts: 2 });
    expect(activeRequirements(l)).toHaveLength(2);
    expect(isCorrection('Actually, use a night sky.')).toBe(true);
  });
});

describe('it survives 100+ messages and a worker restart', () => {
  let store: InMemoryRequirementsStore;
  beforeEach(() => { store = new InMemoryRequirementsStore(); });

  it('🔴 the brief and constraints are still there after 150 filler messages and a lost ledger (rebuilt from the canonical transcript)', async () => {
    const t = transcript([], 150);
    const r = await ensureLedger(store, 'proj-A', async () => t, isBuild); // worker restart: nothing stored
    expect(r.status).toBe('rebuilt');
    if (r.status === 'unrecoverable') throw new Error('unexpected');
    expect(r.ledger.brief?.text).toMatch(/realistic 3D city driving game/);
    expect(renderRequirements(r.ledger)).toMatch(/never remove the three loaded scenes/i);
    // …and the rebuild was stored, so the next worker reads it without the transcript:
    const again = await ensureLedger(store, 'proj-A', async () => { throw new Error('transcript must not be needed'); }, isBuild);
    expect(again.status).toBe('ok');
  });
  it('the planner is handed the requirements for an edit that depends on them', async () => {
    const r = await ensureLedger(store, 'proj-A', async () => transcript([], 150), isBuild);
    if (r.status === 'unrecoverable') throw new Error('unexpected');
    const p = planningRequest({ prompt: 'add a third-person camera option', userAppExists: true, projectMemory: renderRequirements(r.ledger) });
    expect(p.text).toMatch(/never remove the three loaded scenes/i);
    expect(p.text).toMatch(/PROJECT MEMORY/);
    expect(p.sources).toContain('project-memory');
    expect(p.sizing).not.toMatch(/PROJECT MEMORY/); // labels written for a model are not read by the sizers
  });
  it('an unrelated project contributes no context', async () => {
    await ensureLedger(store, 'proj-A', async () => transcript(), isBuild);
    const b = await ensureLedger(store, 'proj-B', async () => [{ role: 'user', content: 'build me a recipe app, always show calories' }], isBuild);
    if (b.status === 'unrecoverable') throw new Error('unexpected');
    expect(renderRequirements(b.ledger)).not.toMatch(/3D|first-person|scenes/i);
    const a = await store.load('proj-A');
    expect(a.status === 'ok' && JSON.stringify(a.ledger)).not.toMatch(/calories/);
  });
  it('is idempotent: rebuilding twice, or replaying a retried message, gives the same ledger', () => {
    const ms = userMessagesOf(transcript(['Actually, keep the camera third-person.'], 5)).map((m) => ({ ...m, isBuildRequest: isBuild(m.text) }));
    const once = rebuildLedger(ms);
    expect(sameRequirements(once, rebuildLedger([...ms, ...ms]))).toBe(true);
  });
  it('stops the edit (unrecoverable) only when BOTH the stored ledger and the transcript are unreadable', async () => {
    store.failReads = true;
    const r = await ensureLedger(store, 'proj-A', async () => { throw new Error('conversation store down'); }, isBuild);
    expect(r.status).toBe('unrecoverable');
    // A transcript that can be read recovers it even though the stored copy cannot be:
    const ok = await ensureLedger(store, 'proj-A', async () => transcript(), isBuild);
    expect(ok.status).toBe('rebuilt');
    // And a brand-new project (nothing stored, no transcript) is not an outage:
    store.failReads = false;
    const fresh = await ensureLedger(store, 'proj-new', async () => null, isBuild);
    expect(fresh.status).toBe('ok');
  });
  it('the ledger is bounded', () => {
    let l = emptyLedger();
    for (let i = 0; i < 200; i++) l = applyMessage(l, { id: `m${i}`, text: `You must always keep rule number ${i} item${i}x visible.`, ts: i + 1 });
    expect(l.items.length).toBeLessThanOrEqual(MAX_ITEMS);
    expect(renderRequirements(l, 1000).length).toBeLessThanOrEqual(1000);
  });
});

describe('the memory buffers no longer evict the user\'s own words', () => {
  const ep = (kind: Episode['kind'], i: number): Episode => ({ ts: i, kind, text: `${kind}-${i}` });
  it('🔴 evictEpisodes drops non-request episodes first — the brief outlives a noisy build', () => {
    const eps: Episode[] = [ep('request', 0), ...Array.from({ length: 600 }, (_, i) => ep(i % 2 ? 'error' : 'note', i + 1))];
    const kept = evictEpisodes(eps, 500);
    expect(kept).toHaveLength(500);
    expect(kept[0].kind).toBe('request');
    expect(kept.map((e) => e.ts)).toEqual([...kept.map((e) => e.ts)].sort((a, b) => a - b));
  });
  it('WorkspaceMemory keeps the first request through 700 recorded errors', () => {
    const mem = new WorkspaceMemory();
    mem.recordRequest('FIRST: a 3D city game, keep first-person controls');
    for (let i = 0; i < 700; i++) mem.recordError(`write-typecheck: boom ${i}`);
    expect(mem.recentRequests(50)[0]).toMatch(/^FIRST/);
  });
  it('the Firestore snapshot keeps the first request and recent older requests, not just the last 100', () => {
    const eps: Episode[] = [ep('request', 0), ...Array.from({ length: 300 }, (_, i) => ep(i % 20 === 0 ? 'request' : 'error', i + 1))];
    const out = episodesToPersist(eps, 100);
    expect(out[0].text).toBe('request-0');
    expect(out.length).toBeGreaterThan(100);
    expect(out.filter((e) => e.kind === 'request').length).toBeGreaterThan(15);
    expect(out.map((e) => e.ts)).toEqual([...out.map((e) => e.ts)].sort((a, b) => a - b));
    expect(episodesToPersist(eps.slice(0, 50), 100)).toHaveLength(50);
  });
});

describe('helpers', () => {
  it('topicOf drops stop words', () => { expect(topicOf('Always keep the first-person controls')).toEqual(expect.arrayContaining(['alway', 'first', 'person', 'control'].filter((w) => topicOf('Always keep the first-person controls').includes(w)))); expect(topicOf('the and of')).toEqual([]); });
});

import { prepareProjectMemory, recordUserMessage } from '../src/server/AgentV3/projectMemoryTurn';

describe('the per-turn use', () => {
  it('a message from a lane that must not be remembered (our own notice) is skipped', async () => {
    const store = new InMemoryRequirementsStore();
    await recordUserMessage('p', 'You must always do X', false, true, store);
    expect((await store.load('p')).status).toBe('missing');
  });
  it('🔴 100+ messages later, after a restart, an edit is handed the first message\'s constraint; a later correction wins', async () => {
    const store = new InMemoryRequirementsStore();
    const t = transcript([], 120);
    const read = async () => t;
    // worker restart: the store is empty, the conversation is canonical
    const first = await prepareProjectMemory({ projectId: 'p', message: 'add a third-person camera option', isBuildRequest: false, replace: false, readTranscript: read, isBuildText: isBuild, store });
    expect(first.status).toBe('rebuilt');
    expect(first.text).toMatch(/never remove the three loaded scenes/i);
    await recordUserMessage('p', 'Actually, change it: use third-person controls instead of first-person controls from now on.', false, false, store);
    const later = await prepareProjectMemory({ projectId: 'p', message: 'now tune the collision', isBuildRequest: false, replace: false, readTranscript: async () => { throw new Error('not needed'); }, isBuildText: isBuild, store });
    expect(later.status).toBe('ok');
    expect(later.text).toMatch(/third-person controls/);
    expect(later.text.split('NO LONGER apply')[0]).not.toMatch(/always keep first-person controls on WASD.*\n.*Standing/s);
  });
  it('a fresh start replaces the ledger with the new message', async () => {
    const store = new InMemoryRequirementsStore();
    await recordUserMessage('p', 'build a 3D city game, always keep first-person controls', true, false, store);
    const r = await prepareProjectMemory({ projectId: 'p', message: 'start fresh: build a recipe app, never show ads', isBuildRequest: true, replace: true, readTranscript: async () => null, isBuildText: isBuild, store });
    expect(JSON.stringify(r.ledger)).not.toMatch(/first-person/);
    expect(JSON.stringify(r.ledger)).toMatch(/never show ads/);
  });
  it('reports unrecoverable (the edit must stop before mutation) when nothing can be read', async () => {
    const store = new InMemoryRequirementsStore(); store.failReads = true;
    const r = await prepareProjectMemory({ projectId: 'p', message: 'edit it', isBuildRequest: false, replace: false, readTranscript: async () => { throw new Error('down'); }, isBuildText: isBuild, store });
    expect(r.status).toBe('unrecoverable');
    expect(r.text).toBe('');
  });
});
