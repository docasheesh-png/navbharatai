// failedbr #1179 (2026-11-20): the lane saved useMessages.ts with a subscribe that returned `() => {}` ("we do nothing because
// state is mutated directly"), so useSyncExternalStore never re-rendered and a sent message was never shown.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deadStoreSubscriptionNote, hasDeadStoreSubscription } from '../src/server/AgentV3/deadStoreSubscription';

const DEAD = `import { useSyncExternalStore } from 'react';
let messages: string[] = [];
function subscribe(listener: () => void) {
  // we do nothing because state is mutated directly
  return () => {};
}
export function useMessages() { return useSyncExternalStore(subscribe, () => messages); }`;
const LIVE = `import { useSyncExternalStore } from 'react';
const listeners = new Set<() => void>();
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useMessages() { return useSyncExternalStore(subscribe, () => []); }`;

describe('a store that never notifies is named at write time (failedbr #1179)', () => {
  it('the reported shape, and its arrow form', () => {
    expect(hasDeadStoreSubscription(DEAD)).toBe(true);
    expect(hasDeadStoreSubscription(`import { useSyncExternalStore } from 'react';\nconst subscribe = (cb: () => void) => () => {};\nuseSyncExternalStore(subscribe, () => 1);`)).toBe(true);
    expect(deadStoreSubscriptionNote({ 'src/hooks/useMessages.ts': DEAD })).toMatch(/NEVER re-render/);
  });
  it('a real subscription, or no useSyncExternalStore, is never named', () => {
    expect(hasDeadStoreSubscription(LIVE)).toBe(false);
    expect(hasDeadStoreSubscription('function subscribe(l) { return () => {}; }')).toBe(false);
  });
  it('🔒 the dispatcher says it with the file open', () => {
    expect(readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8')).toContain('storeLoop += deadStoreSubscriptionNote(files)');
  });
});
