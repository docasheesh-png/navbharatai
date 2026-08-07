import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  sanitizeForFleet, fleetDocId, mergeFleetSighting, mergeFleetProvenFix,
  formatFleetMistakes, uniqueSignatures, fleetLedgerEnabled,
  MAX_FLEET_LOOKUPS, MAX_FLEET_WRITES,
} from './FleetMistakeLedger';
import { mistakeKey, MAX_GUARDS } from './MistakeLedger';

// FLEET LEARNING (2026-08-07): the per-user MistakeLedger stops a user repeating THEIR OWN mistake.
// This layer is the aviation model — one investigated failure becomes a checklist item for every
// cockpit: user #1001's first build gets the fix user #7 proved months ago. Safe to share across
// users ONLY because (a) the key is the anonymous errorSignature, (b) sample/fix text is
// secret+PII-redacted before storage, (c) no user/workspace/prompt data is ever passed in.

const ERR_A = 'Error: listen EADDRINUSE: address already in use :::5173';
const ERR_A_AGAIN = 'Error: listen EADDRINUSE: address already in use :::3000';
const ERR_B = 'Could not resolve "./icons/router.js" from node_modules/lucide-react/dist/esm/lucide-react.js';

describe('privacy by construction — nothing personal can travel between users', () => {
  it('sanitizeForFleet strips API keys AND personal data from stored text', () => {
    const dirty = 'fetch failed for user aashish@example.com with key sk-ant-abcdefghijklmnopqrstuvwx call 9876543210';
    const clean = sanitizeForFleet(dirty);
    expect(clean).not.toContain('aashish@example.com');
    expect(clean).not.toContain('sk-ant-');
    expect(clean).not.toContain('9876543210');
    expect(clean).toContain('[REDACTED:');
  });

  it('collapses whitespace and stays bounded', () => {
    const clean = sanitizeForFleet(`a\n\n${'b'.repeat(1000)}`, 100);
    expect(clean.length).toBeLessThanOrEqual(100);
    expect(clean).not.toContain('\n');
  });

  it('the doc id is a hash — no error text (which could carry specifics) leaks into the key', () => {
    const id = fleetDocId(mistakeKey(ERR_B));
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(fleetDocId(mistakeKey(ERR_A))).toBe(fleetDocId(mistakeKey(ERR_A_AGAIN))); // same failure → same doc
    expect(fleetDocId(mistakeKey(ERR_A))).not.toBe(id);
  });
});

describe('merging — same proven-fix discipline as the per-user ledger', () => {
  it('a first sighting creates an UNSOLVED record', () => {
    const rec = mergeFleetSighting(null, ERR_A)!;
    expect(rec.seen).toBe(1);
    expect(rec.provenFix).toBeUndefined();
    expect(rec.signature).toBe(mistakeKey(ERR_A));
  });

  it('a repeat sighting increments seen; after a fix is known it increments repeatsAfterFix', () => {
    let rec = mergeFleetSighting(null, ERR_A)!;
    rec = mergeFleetSighting(rec, ERR_A_AGAIN)!;
    expect(rec.seen).toBe(2);
    expect(rec.repeatsAfterFix).toBe(0); // nothing was known yet
    rec = mergeFleetProvenFix(rec, ERR_A, 'free the port before starting the dev server')!;
    rec = mergeFleetSighting(rec, ERR_A)!;
    expect(rec.repeatsAfterFix).toBe(1); // the fleet-wide honesty counter
  });

  it('the stored fix is sanitized — a secret in a rootCause can never reach another user', () => {
    const rec = mergeFleetProvenFix(null, ERR_A, 'set ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuvwx in env')!;
    expect(rec.provenFix).not.toContain('sk-ant-abcdefghijklmnopqrstuvwx');
    expect(rec.provenFix).toContain('[REDACTED:');
  });

  it('an empty error has no identity and merges to nothing', () => {
    expect(mergeFleetSighting(null, '')).toBeNull();
    expect(mergeFleetProvenFix(null, '', 'fix')).toBeNull();
  });
});

describe('the guard block — one tested format shared with the per-user ledger', () => {
  it('a solved fleet record is retrieved by SIGNATURE across differing details', () => {
    const rec = mergeFleetProvenFix(mergeFleetSighting(null, ERR_A), ERR_A, 'free the port first')!;
    const out = formatFleetMistakes([rec], [ERR_A_AGAIN]); // different port number
    expect(out).toContain('solved before on NavBharatAI'); // fleet header, not the personal one
    expect(out).toContain('PROVEN FIX');
    expect(out).toContain('free the port first');
  });

  it('is EMPTY when nothing matches or nothing is solved — unmatched builds are byte-identical to today', () => {
    const unsolved = mergeFleetSighting(null, ERR_A)!;
    expect(formatFleetMistakes([unsolved], [ERR_A])).toBe('');
    expect(formatFleetMistakes([], [ERR_A])).toBe('');
  });

  it('lookups and writes per build are bounded', () => {
    expect(MAX_FLEET_LOOKUPS).toBeGreaterThanOrEqual(MAX_GUARDS);
    expect(MAX_FLEET_WRITES).toBeGreaterThan(0);
    const many = Array.from({ length: 30 }, (_, i) => `Error: unique failure ${i} in module m${i}`);
    expect(uniqueSignatures(many, MAX_FLEET_LOOKUPS)).toHaveLength(MAX_FLEET_LOOKUPS);
    expect(uniqueSignatures([ERR_A, ERR_A_AGAIN, ERR_B], 10)).toHaveLength(2); // dedupe by identity
  });
});

describe('kill switch', () => {
  it('AGENTV3_FLEET_LEDGER=off disables; default is on', () => {
    expect(fleetLedgerEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(fleetLedgerEnabled({ AGENTV3_FLEET_LEDGER: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(fleetLedgerEnabled({ AGENTV3_FLEET_LEDGER: 'OFF ' } as NodeJS.ProcessEnv)).toBe(false);
    expect(fleetLedgerEnabled({ AGENTV3_FLEET_LEDGER: 'on' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

// Source contract: the fleet is genuinely wired (a module nobody calls is dead code), and wired
// SAFELY — read as a fallback after the personal guard, written with deliberately NO user id.
describe('wiring — consulted as a fallback, updated anonymously', () => {
  const SRC = readFileSync(fileURLToPath(new URL('../routes/agentv3.ts', import.meta.url)), 'utf8');

  it('is READ only when the personal ledger had nothing (personal history wins)', () => {
    expect(SRC).toContain('} else if (pastErrors.length > 0)');
    expect(SRC).toContain('fleetMistakeLedgerStore.guardDetailFor(pastErrors)');
  });

  it('is WRITTEN with NO user id — the store cannot leak what it is never given', () => {
    expect(SRC).toContain('fleetMistakeLedgerStore.recordBuild({ ok: result.ok');
    expect(SRC).not.toContain('fleetMistakeLedgerStore.recordBuild(userId');
  });

  it('both call sites live inside the existing best-effort catch blocks', () => {
    const at = SRC.indexOf('fleetMistakeLedgerStore.guardDetailFor');
    expect(SRC.slice(at, at + 1200)).toContain('catch');
    const at2 = SRC.indexOf('fleetMistakeLedgerStore.recordBuild');
    expect(SRC.slice(at2, at2 + 3000)).toContain('catch');
  });

  it('the store CODE never touches a user identifier (comments stripped before checking)', () => {
    const STORE = readFileSync(fileURLToPath(new URL('./FleetMistakeLedger.ts', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(STORE).not.toMatch(/userId|workspaceId|\buid\b|email/i);
  });
});
