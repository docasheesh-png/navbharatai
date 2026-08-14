import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveMegaRoadmap,
  loadMegaRoadmap,
  deleteMegaRoadmap,
  parseStoredMegaRoadmap,
  __clearMegaRoadmapCacheForTests,
  type StoredMegaRoadmap,
} from './MegaRoadmapStore';
import type { MegaRoadmap } from '../lib/megaRoadmap';

const roadmap: MegaRoadmap = {
  famousApp: 'Instagram',
  userMessage: 'Yeh ek badi app hai — main pehle core banata hoon.',
  achievableSummary: 'A working photo app you can use now.',
  note: 'Real-time DMs need a server and will come as a later step.',
  steps: [
    { n: 1, title: 'Feed', goal: 'see posts', buildPrompt: 'Build a photo feed with mock posts.', infraCeiling: false },
    { n: 2, title: 'DMs', goal: 'chat', buildPrompt: 'Add direct messages.', infraCeiling: true },
  ],
};

const record: StoredMegaRoadmap = {
  roadmap, currentStep: 1, sourcePrompt: 'make an app like Instagram', createdAt: 1000, updatedAt: 1000,
};

beforeEach(() => __clearMegaRoadmapCacheForTests());

describe('MegaRoadmapStore — parse strictness', () => {
  it('round-trips a valid record', () => {
    const parsed = parseStoredMegaRoadmap(JSON.stringify(record));
    expect(parsed).not.toBeNull();
    expect(parsed!.roadmap.steps).toHaveLength(2);
    expect(parsed!.roadmap.steps[1].infraCeiling).toBe(true);
    expect(parsed!.currentStep).toBe(1);
    expect(parsed!.roadmap.userMessage).toMatch(/badi app/);
  });

  it('rejects corrupt / non-JSON / empty / stepless blobs', () => {
    expect(parseStoredMegaRoadmap('not json')).toBeNull();
    expect(parseStoredMegaRoadmap('')).toBeNull();
    expect(parseStoredMegaRoadmap(JSON.stringify({ roadmap: { steps: [] } }))).toBeNull();
    expect(parseStoredMegaRoadmap(JSON.stringify({ roadmap: {} }))).toBeNull();
    expect(parseStoredMegaRoadmap(123 as never)).toBeNull();
  });

  it('rejects a roadmap whose step is missing a required field', () => {
    const bad = { ...record, roadmap: { ...roadmap, steps: [{ n: 1, title: 'x', goal: 'y' /* no buildPrompt */ }] } };
    expect(parseStoredMegaRoadmap(JSON.stringify(bad))).toBeNull();
  });

  it('defaults currentStep to 1 when missing/invalid and fills step numbers', () => {
    const noStep = { ...record } as any; delete noStep.currentStep;
    expect(parseStoredMegaRoadmap(JSON.stringify(noStep))!.currentStep).toBe(1);
    const badStep = { ...record, currentStep: -5 };
    expect(parseStoredMegaRoadmap(JSON.stringify(badStep))!.currentStep).toBe(1);
  });
});

describe('MegaRoadmapStore — in-memory cache round-trip (Firestore skipped under VITEST)', () => {
  it('save then load returns the same record for a workspace', async () => {
    await saveMegaRoadmap('ws-1', record);
    const got = await loadMegaRoadmap('ws-1');
    expect(got).not.toBeNull();
    expect(got!.roadmap.famousApp).toBe('Instagram');
    expect(got!.currentStep).toBe(1);
  });

  it('load for an unknown workspace is null', async () => {
    expect(await loadMegaRoadmap('never-saved')).toBeNull();
  });

  it('delete removes the roadmap', async () => {
    await saveMegaRoadmap('ws-2', record);
    await deleteMegaRoadmap('ws-2');
    expect(await loadMegaRoadmap('ws-2')).toBeNull();
  });

  it('never throws on save/load/delete', async () => {
    await expect(saveMegaRoadmap('ws-3', record)).resolves.toBeUndefined();
    await expect(loadMegaRoadmap('ws-3')).resolves.not.toBeUndefined();
    await expect(deleteMegaRoadmap('ws-3')).resolves.toBeUndefined();
  });
});
