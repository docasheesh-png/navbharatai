/**
 * Owner P2 review item 9: the control-store collections are inaccessible to clients. `firestore.rules` grants access
 * only by explicit `match` blocks and ends in a deny-all default; these collections must never get a block of their
 * own, and no broader wildcard may ever grant them access.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TRAFFIC_CONTROL_AUDIT_COLLECTION, TRAFFIC_CONTROL_COLLECTION, TRAFFIC_CONTROL_REVISIONS_COLLECTION } from '../src/server/AI/TrafficRegistry/controlStore';

const rules = readFileSync('firestore.rules', 'utf8').replace(/\/\/.*$/gm, '');

describe('the traffic-control collections are server-only', () => {
  it('no rule names them', () => {
    for (const c of [TRAFFIC_CONTROL_COLLECTION, TRAFFIC_CONTROL_REVISIONS_COLLECTION, TRAFFIC_CONTROL_AUDIT_COLLECTION]) expect(rules).not.toContain(c);
  });
  it('the only top-level wildcard is the deny-all default', () => {
    const wildcards = [...rules.matchAll(/match \/\{([a-zA-Z]+)(=\*\*)?\}[^{]*\{([^}]*)\}/g)];
    expect(wildcards.length).toBeGreaterThanOrEqual(1);
    for (const w of wildcards) expect(w[3].replace(/\s+/g, ' ').trim()).toBe('allow read, write: if false;');
  });
  it('the server writes them only through the admin SDK store (no client import of the store)', () => {
    const panel = readFileSync('src/components/admin/TrafficControlPanel.tsx', 'utf8');
    expect(panel).not.toMatch(/firebase\/firestore|controlStore/);
  });
});
