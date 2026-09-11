import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { shouldServeSnapshot, snapshotChannelId } from '../src/server/AgentV3/previewSnapshot';
import { makeChannelId } from '../src/server/AgentV3/Deployment';

/**
 * A FINISHED APP SHOULD NOT NEED A RENTED COMPUTER TO STAY ALIVE.
 *
 * Four connections: take the copy when the app is proven, keep it, serve it when the machine is gone,
 * and tell the user which version they are looking at. Drop any one and nothing fails — the preview
 * just goes back to a spinner retrying against a machine that is never coming back.
 */
const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
const store = readFileSync(join(process.cwd(), 'src/server/AgentV3/SandboxStore.ts'), 'utf8');
const deployment = readFileSync(join(process.cwd(), 'src/server/AgentV3/Deployment.ts'), 'utf8');
const surface = readFileSync(join(process.cwd(), 'src/components/agentv3/PreviewSurface.tsx'), 'utf8');

describe('1. the copy is taken only from a build that PROVED it packages', () => {
  it('rides the production build gate’s success, reusing the dist it just produced', () => {
    expect(route).toContain('if (verdict.ok && previewSnapshotEnabled() && snapshotSuitable(pkgRaw)');
  });

  it('is bounded at both steps — a copy must never eat the advisory window', () => {
    const i = route.indexOf('previewSnapshotEnabled() && snapshotSuitable(pkgRaw)');
    const block = route.slice(i, i + 1800);
    expect(block).toContain("'snapshot-dist'");
    expect(block).toContain("'snapshot-deploy'");
  });

  it('every failure inside it is swallowed', () => {
    // Bounded by the NEXT block (the vaccine), not by a character count: a character window drifts
    // the first time a line is added inside the block — which is exactly what happened on 2026-09-11.
    const i = route.indexOf('previewSnapshotEnabled() && snapshotSuitable(pkgRaw)');
    const end = route.indexOf('vaccineEnabled(workspaceId)', i);
    expect(i).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(i);
    expect(route.slice(i, end)).toContain('must never be able to affect the build it is copying');
  });
});

describe('2. it can never overwrite what somebody deliberately published', () => {
  it('deploys to the SNAPSHOT channel, explicitly', () => {
    expect(route).toContain('deployStatic(workspaceId, dist, snapshotChannelId(workspaceId))');
  });

  it('and the two channels genuinely differ', () => {
    // Not a source assertion — the actual property, so this cannot pass on grep alone.
    const ws = 'agentv3-uid-session';
    expect(snapshotChannelId(ws)).not.toBe(makeChannelId(ws));
  });

  it('the publish path is unchanged — the channel is a defaulted parameter, not a second method', () => {
    expect(deployment).toContain('channelId = makeChannelId(workspaceId)');
  });
});

describe('3. it is served only when the machine is genuinely gone', () => {
  it('the door checks before falling back to its retry page', () => {
    const i = route.indexOf('if (!sandboxId) {');
    expect(i).toBeGreaterThan(-1);
    const block = route.slice(i, i + 900);
    expect(block).toContain('shouldServeSnapshot({');
    expect(block.indexOf('shouldServeSnapshot')).toBeLessThan(block.indexOf("page(200, 'asleep')"));
  });

  it('the "still starting" case is left alone — that machine is seconds away', () => {
    expect(shouldServeSnapshot({ enabled: true, doorState: 'starting', snapshotUrl: 'https://x.web.app' })).toBe(false);
  });

  it('the snapshot is remembered with a MERGE, so it survives later builds that produce none', () => {
    const i = store.indexOf('async saveSnapshot(');
    expect(i).toBeGreaterThan(-1);
    expect(store.slice(i, i + 600)).toContain('{ merge: true }');
  });
});

describe('4. the user is told WHICH version they are looking at', () => {
  it('the server says so, from the same record and the same rule the door uses', () => {
    // REPOINTED (2026-09-08): there are now TWO situations and two notes — an EXPIRED machine and one
    // that is STARTING UP — so the payload picks between them instead of always sending SNAPSHOT_NOTE.
    // What this test protects is unchanged: whenever a copy is framed, the user is told so.
    expect(route).toContain('snapshotServing: true, snapshotNote: snapshotWaking ? SNAPSHOT_WAKING_NOTE : SNAPSHOT_NOTE');
  });

  it('🔒 the health verdict is the DOOR\'S OWN rule, not a second copy of it', () => {
    // The load-bearing half of the waking fallback. If this block still answered only for a machine
    // that is GONE, the door would frame a saved copy while the panel said nothing at all — the exact
    // silent substitution the old blanket refusal existed to prevent.
    const at = route.indexOf('let snapshotServing = false;');
    expect(at).toBeGreaterThan(-1);
    const block = route.slice(at, at + 1600);
    expect(block).toContain("const doorState = sandboxGone ? 'asleep' as const : 'starting' as const;");
    expect(block).toContain('shouldServeSnapshot({');
    expect(block).toContain('workspaceFilesSavedAt(workspaceId)');
    expect(block).toContain("snapshotWaking = doorState === 'starting'");
  });

  it('🔒 and the frame returns to the live app by itself, exactly once, on the edge', () => {
    // Once the door 302s to the copy, the frame has left our origin and nothing in it is watching for
    // the live app. Without this the copy would stay up until something else reloaded the frame —
    // which for a wake that healed itself could be never.
    expect(surface).toContain('snapshotFramedRef');
    expect(surface).toContain('if (snapshotFramedRef.current && !servingSnapshot) setLiveReloadKey((k) => k + 1);');
    // On the EDGE, never the level: bumping every poll would remount the framed app every 150s.
    expect(surface).toContain('snapshotFramedRef.current = servingSnapshot;');
  });

  it('the surface shows it', () => {
    expect(surface).toContain('health?.snapshotServing === true');
    expect(surface).toContain('{snapshotNote}');
  });

  it('it is NOT styled as an error — nothing is wrong with their app', () => {
    const i = surface.indexOf('{snapshotNote}');
    const block = surface.slice(i - 500, i + 100);
    expect(block).not.toContain('text-red');
    expect(block).not.toContain('border-red');
  });
});
