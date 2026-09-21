/**
 * 🔴 "CONNECT A DATABASE" WAS PROSE INSIDE A SUMMARY AND REACHED NO SURFACE — the tray's PR 2.
 *
 * `PROGRESS.md` (2026-09-20) shipped PR 1 and named this as the bigger half:
 *
 *   > *"The tray shows what the engine already emits. The larger category — 'connect GitHub',
 *   > 'connect a database', 'point your domain' — is still prose inside the model's summary and
 *   > reaches no structured surface. PR 2 derives those from facts the server already holds … at
 *   > zero model cost."*
 *
 * ## ⚠️ ONE OF THE THREE, BECAUSE ONLY ONE FACT EXISTS (rule 6)
 *
 * | category | the fact | verdict |
 * |---|---|---|
 * | database | `databaseReadiness` — the app's OWN files save data, the vault has no database | ✅ derivable |
 * | GitHub | no durable per-user record at all; the token arrives per request and the build reads a CLIENT-SUPPLIED hint | ❌ a guess |
 * | domain | `DomainLink` stores that a domain is linked, but carries no verified status — "still not pointed" needs a live DNS probe whose propagating answer would nag someone who already did it | ❌ needs a fact that is not stored |
 *
 * **Shipping one honest row beats shipping three, two of which are guesses.** A row derived from a
 * client hint is a row that tells a user to connect something they connected last week.
 *
 * ## What this suite locks
 *
 * 1. The row appears only when the app really needs a database and really has none.
 * 2. It never blocks — `blocking` is what makes the tray open itself, and that is for a stopped build.
 * 3. The two mirrored `UserActionKind` unions cannot drift, which TypeScript cannot catch: the
 *    browser may not import `src/server/**`, so the client keeps a copy, and a kind added on one side
 *    falls through every branch on the other with no error at all.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { connectActions, databaseConnectAction, DATABASE_SUBJECT } from '../src/server/AgentV3/connectActions';
import { actionKey, groupOf, badgeCount, shouldAutoOpen, openActions, type UserAction } from '../src/server/AgentV3/userActions';
import { askPrompt, groupOf as viewGroupOf, type UserActionView } from '../src/components/agentv3/userActionView';

const SERVER_ACTIONS = readFileSync('src/server/AgentV3/userActions.ts', 'utf8');
const CLIENT_VIEW = readFileSync('src/components/agentv3/userActionView.ts', 'utf8');
const ROUTE = readFileSync('src/server/routes/agentv3.ts', 'utf8');
const CONNECT = readFileSync('src/server/AgentV3/connectActions.ts', 'utf8');

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Read a `UserActionKind` union out of a source file, as the set of its members. */
function kindUnion(src: string): string[] {
  const m = code(src).match(/export type UserActionKind\s*=\s*([^;]+);/);
  if (!m) throw new Error('UserActionKind not found');
  return m[1].split('|').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
}

const NEEDS_NO_DB = { needsDatabase: false, connected: false, canProvision: false };
const NEEDS_AND_HAS = { needsDatabase: true, connected: true, canProvision: true };
const NEEDS_AND_LACKS = { needsDatabase: true, connected: false, canProvision: false };

describe('🔴 the row appears only when it is true', () => {
  it('an app that saves data with no database gets the row', () => {
    const row = databaseConnectAction(NEEDS_AND_LACKS, 'b1', 1000)!;
    expect(row).toBeTruthy();
    expect(row.kind).toBe('connect');
    expect(row.title).toBe('Connect a database');
    expect(row.status).toBe('open');
    expect(row.buildId).toBe('b1');
    expect(row.createdAt).toBe(1000);
  });

  it('🔒 an app that does not save data is never asked', () => {
    expect(databaseConnectAction(NEEDS_NO_DB, 'b1', 1)).toBeNull();
  });

  it('🔒 a user who already connected one is never asked — however they did it', () => {
    // `connected` accepts the provider marker OR any real credential, so someone who pasted a
    // DATABASE_URL by hand and never opened the Database screen is not told they have none.
    expect(databaseConnectAction(NEEDS_AND_HAS, 'b1', 1)).toBeNull();
  });

  it('says nothing rather than guessing when there are no facts', () => {
    expect(databaseConnectAction(null, 'b1', 1)).toBeNull();
    expect(databaseConnectAction(undefined, 'b1', 1)).toBeNull();
    expect(connectActions({}, 'b1', 1)).toEqual([]);
    expect(connectActions({ database: NEEDS_AND_HAS }, 'b1', 1)).toEqual([]);
  });

  it('the wording follows what we can actually do for them', () => {
    const canDo = databaseConnectAction({ ...NEEDS_AND_LACKS, canProvision: true }, 'b1', 1)!;
    const cannot = databaseConnectAction(NEEDS_AND_LACKS, 'b1', 1)!;
    expect(canDo.why).toContain('one press');
    expect(cannot.why).toContain('Settings');
    // An offer we cannot fulfil is worse than no offer.
    expect(cannot.why).not.toContain('one press');
  });

  it('both halves say plainly what is at stake, without jargon', () => {
    for (const p of [true, false]) {
      const row = databaseConnectAction({ ...NEEDS_AND_LACKS, canProvision: p }, 'b1', 1)!;
      expect(row.why).toContain('nothing it saves will survive');
      expect(row.why).not.toMatch(/supabase|postgres|schema/i);
    }
  });
});

describe('🔒 it can never hijack the screen', () => {
  const row = () => databaseConnectAction(NEEDS_AND_LACKS, 'b1', 1)!;

  it('🔴 it never blocks — that flag is for a build genuinely stopped at a gate', () => {
    expect(row().blocking).toBe(false);
    expect(shouldAutoOpen([row()])).toBe(false);
  });

  it('it lands in "your app needs this", not in "worth a look"', () => {
    expect(groupOf(row())).toBe('needed');
    expect(viewGroupOf(row() as unknown as UserActionView)).toBe('needed');
  });

  it('it still lights the badge — a task nobody sees is not a task', () => {
    expect(badgeCount([row()])).toBe(1);
    expect(openActions([row()])).toHaveLength(1);
  });

  it('two builds raise ONE row, not two — the id is derived from the thing', () => {
    const a = databaseConnectAction(NEEDS_AND_LACKS, 'build-1', 1)!;
    const b = databaseConnectAction(NEEDS_AND_LACKS, 'build-2', 2)!;
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(actionKey('connect', DATABASE_SUBJECT));
  });

  it('it is not a dead end — the user can ask about it instead of obeying it', () => {
    const prompt = askPrompt(row() as unknown as UserActionView);
    expect(prompt).toContain('Connect a database');
    expect(prompt).toContain('simpler option');
    // Not the generic fallback, which assumes the user wants something else instead.
    expect(prompt).not.toContain('here is what I actually want instead');
  });
});

describe('🔒 THE MIRRORED UNION CANNOT DRIFT — TypeScript cannot see this', () => {
  it('client and server agree on every kind', () => {
    expect(kindUnion(CLIENT_VIEW)).toEqual(kindUnion(SERVER_ACTIONS));
  });

  it('and `connect` is in both', () => {
    expect(kindUnion(SERVER_ACTIONS)).toContain('connect');
    expect(kindUnion(CLIENT_VIEW)).toContain('connect');
  });
});

describe('🔒 THE WIRING — derived where the facts already are, at zero model cost', () => {
  const src = code(ROUTE);

  it('the route derives and saves the rows', () => {
    expect(src).toContain('const rows = connectActions({');
    expect(src).toContain('await saveUserActions(workspaceId, rows)');
  });

  it('🔴 it judges the DURABLE copy, not this turn’s diff', () => {
    // `appNeedsDatabase` reads the app's own source. On an edit turn `writtenFiles` is the diff, so
    // judging that would report "no database needed" about an app full of persistence.
    expect(src).toContain('const appFiles = await loadWorkspaceFiles(workspaceId)');
    expect(src).toContain('files: appFiles,');
  });

  it('it spends no model call and cannot break a finished build', () => {
    expect(code(CONNECT)).not.toMatch(/runTurn|callModel|openai|anthropic/i);
    const at = src.indexOf('const rows = connectActions({');
    expect(at).toBeGreaterThan(-1);
    // The whole derivation sits inside a try whose catch says a task row must not affect the build.
    expect(src.slice(Math.max(0, at - 900), at)).toContain('try {');
  });

  it('the module is pure — it can never delete, write or fetch', () => {
    expect(code(CONNECT)).not.toMatch(/await |fetch\(|writeFile|delete /);
  });
});
