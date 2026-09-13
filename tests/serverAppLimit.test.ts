/**
 * HOW MANY OF AN OWNER'S APPS MAY RUN A SERVER.
 *
 * `publishedAppCap` bounds how many apps EXIST. This bounds how many hold a container image and a
 * Cloud Run service — a different cost, and the only one that **no traffic overage offsets**: an
 * image sits in Artifact Registry at ~500 MB whether or not a visitor ever arrives, and nothing in
 * the codebase deletes it. Without this cap a 30-app plan implies 30 servers and the storage alone
 * outgrows the plan price with the apps completely idle.
 */
import { describe, it, expect } from 'vitest';
import { serverAppLimit } from '../src/server/AgentV3/hostApp';
import { HOSTING_TIERS } from '../src/lib/hostingTiers';

const at = (n: number) => Array.from({ length: n }, (_, i) => `ws-${i}`);

describe('the cap itself', () => {
  it('allows a new server app while under the tier limit', () => {
    expect(serverAppLimit({ isAdmin: false, liveServerWorkspaceIds: at(2), workspaceId: 'new', cap: 10 }).available).toBe(true);
  });

  it('refuses the one that would exceed it, and names the number', () => {
    const out = serverAppLimit({ isAdmin: false, liveServerWorkspaceIds: at(10), workspaceId: 'new', cap: 10 });
    expect(out.available).toBe(false);
    expect(out.message).toContain('limit of 10');
  });

  it('counts each workspace once, however many records name it', () => {
    // A redeploy history could list one workspace repeatedly; counting rows instead of workspaces
    // would refuse a publish the owner is entitled to, for apps that do not exist.
    const dupes = ['a', 'a', 'a', 'b', 'b'];
    expect(serverAppLimit({ isAdmin: false, liveServerWorkspaceIds: dupes, workspaceId: 'new', cap: 3 }).available).toBe(true);
  });
});

describe('🔒 updating an app you already host is always free', () => {
  /**
   * The cap is on how many run AT ONCE, never on how often they are deployed. Counting a redeploy
   * would make the last app on a plan un-updatable — the shape of bug that turns a limit into a trap,
   * and exactly what `publishedAppCap`'s own message promises does not happen ("Updating an app you
   * have already published is always free").
   */
  it('re-hosting an existing server app passes even when the owner is AT the limit', () => {
    const live = at(10);
    expect(serverAppLimit({ isAdmin: false, liveServerWorkspaceIds: live, workspaceId: live[3], cap: 10 }).available).toBe(true);
  });

  it('…and over it, which is what a cap being LOWERED must not break', () => {
    // A tier can shrink (a downgrade, or a catalogue change). Apps already hosted keep working; only
    // a NEW one is refused. Refusing the update instead would take somebody's live app off the air
    // for a change they did not make.
    const live = at(30);
    expect(serverAppLimit({ isAdmin: false, liveServerWorkspaceIds: live, workspaceId: live[0], cap: 10 }).available).toBe(true);
    expect(serverAppLimit({ isAdmin: false, liveServerWorkspaceIds: live, workspaceId: 'new', cap: 10 }).available).toBe(false);
  });
});

describe('⚠️ it fails OPEN on an unreadable count — the opposite of how `hasPlan` fails', () => {
  /**
   * An unknown PLAN must read as "no plan": guessing yes gives away a paid product. An unknown COUNT
   * is the other way round — guessing "at the cap" refuses a publish a paying customer is entitled
   * to, on the strength of a Firestore hiccup, while guessing "under it" costs at most one extra idle
   * service and self-corrects on the next deploy. The expensive mistake is the visible one.
   */
  it('null (registry unreadable) allows the publish', () => {
    expect(serverAppLimit({ isAdmin: false, liveServerWorkspaceIds: null, workspaceId: 'new', cap: 1 }).available).toBe(true);
  });

  it('an empty ARRAY is not the same thing — it genuinely means nobody is hosting', () => {
    expect(serverAppLimit({ isAdmin: false, liveServerWorkspaceIds: [], workspaceId: 'new', cap: 1 }).available).toBe(true);
    expect(serverAppLimit({ isAdmin: false, liveServerWorkspaceIds: ['a'], workspaceId: 'new', cap: 1 }).available).toBe(false);
  });

  it('an absent or nonsense cap does not block — the PLAN gate above already refused a non-holder', () => {
    for (const cap of [null, undefined, 0, -1, NaN, 'ten' as unknown as number]) {
      expect(serverAppLimit({ isAdmin: false, liveServerWorkspaceIds: at(99), workspaceId: 'new', cap: cap as number }).available, String(cap)).toBe(true);
    }
  });
});

describe('the admin is exempt, like every other gate on this path', () => {
  it('passes at any count', () => {
    expect(serverAppLimit({ isAdmin: true, liveServerWorkspaceIds: at(500), workspaceId: 'new', cap: 1 }).available).toBe(true);
  });
});

describe('WIRING — the catalogue number is what the gate enforces', () => {
  it('every tier has a positive server-app cap for the gate to read', () => {
    for (const t of HOSTING_TIERS) expect(t.backendApps).toBeGreaterThan(0);
  });

  it('a Starter holder is refused their 11th server app, and a Growth holder their 31st', () => {
    const [starter, growth] = HOSTING_TIERS;
    expect(serverAppLimit({ isAdmin: false, liveServerWorkspaceIds: at(starter.backendApps), workspaceId: 'new', cap: starter.backendApps }).available).toBe(false);
    expect(serverAppLimit({ isAdmin: false, liveServerWorkspaceIds: at(starter.backendApps - 1), workspaceId: 'new', cap: starter.backendApps }).available).toBe(true);
    expect(serverAppLimit({ isAdmin: false, liveServerWorkspaceIds: at(growth.backendApps), workspaceId: 'new', cap: growth.backendApps }).available).toBe(false);
  });

  it('the route asks the gate, and refuses with a named reason rather than a generic 500', () => {
    const route = require('fs').readFileSync(require('path').join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('serverAppLimit({');
    expect(route).toContain("reason: 'server_app_limit'");
    // The count must come from the registry, not be assumed — an assumed zero spends the allowance
    // from scratch on every publish and makes the cap unreachable.
    expect(route).toContain('liveServerWorkspaceIdsFor(');
  });
});
