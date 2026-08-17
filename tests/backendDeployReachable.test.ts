import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { braceBlock } from './helpers/sourceSlice';

/**
 * THE ROUTE THAT NO ONE COULD CALL (root-caused 2026-08-07).
 *
 * `renderDeploy.ts` really deploys a user's backend, `POST /api/agentv3/deploy-backend` really exposes
 * it, and the admin really set `RENDER_API_KEY` in Cloud Run on 2026-08-02 expecting it to work. But a
 * repo-wide grep for the string `deploy-backend` returned the route definition and NOTHING ELSE — no
 * caller anywhere in `src/components`. Every user was told "config added, now go and deploy it
 * yourself" while the button that could do it for them did not exist, and the injection text literally
 * promised the feature was "coming next" after it had already shipped.
 *
 * A real capability with no way to reach it is the same rule-2 failure as a button that does nothing —
 * it just fails in the quieter direction, which is why it survived so long. These are the locks that
 * keep BOTH halves connected: the caller must exist, and the caller must stay honest.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const panel = read('src/components/ide/GitPanel.tsx');
const route = read('src/server/routes/agentv3.ts');
const engine = read('src/server/AgentV3/renderDeploy.ts');

describe('The deploy route has a real caller', () => {
  it('the client actually calls /api/agentv3/deploy-backend', () => {
    // The one assertion that would have caught the original gap.
    expect(panel).toContain("'/api/agentv3/deploy-backend'");
  });

  it('it goes through the shared authed fetch, not a hand-rolled Authorization header', () => {
    // Four copies of one path helper have already cost this repo a day; auth is not the place to
    // start a fifth divergence.
    const fn = braceBlock(panel, 'const triggerManagedBackendDeploy');
    expect(fn).toContain('authedFetch(');
    expect(fn).not.toContain('getIdToken');
  });

  it('the button is rendered ONLY for a host whose engine exists', () => {
    expect(panel).toContain('canOfferManagedDeploy(selectedPlatform)');
    expect(panel).toContain('{canManagedDeploy && deployStatus === ');
  });

  it('a malformed repo is refused BEFORE the call, with the fix named', () => {
    const fn = braceBlock(panel, 'const triggerManagedBackendDeploy');
    expect(fn).toContain('if (!body) {');
    expect(fn).toContain('owner/repo');
  });

  it('the outcome is classified by the shared pure helper, never re-interpreted in the component', () => {
    const fn = braceBlock(panel, 'const triggerManagedBackendDeploy');
    expect(fn).toContain('managedDeployOutcome(res.status, json)');
    // Only a genuine success may flip the panel to "deployed".
    expect(fn).toContain("if (outcome.kind === 'deployed' && json?.url)");
  });

  it('a network failure says so instead of leaving a spinner running forever', () => {
    const fn = braceBlock(panel, 'const triggerManagedBackendDeploy');
    expect(fn).toContain('Could not reach NavBharatAI');
    expect(fn).toContain('setManagedDeploying(false)');
  });
});

describe('The deploy runs on the USER\'s Render account, not ours', () => {
  it('the route reads the user\'s own saved key and passes it to the engine', () => {
    // Before this, the engine only ever read process.env — so one server key would have deployed every
    // user's backend into a single Render account billed to whoever owns it.
    // Matched on the CALL, not its argument list: the read gained a workspace when keys became
    // scopeable to one app. The property being protected is that the key comes from the USER's own
    // vault rather than the server's env — that is what keeps every user's backend on their own
    // Render account instead of one account billed to whoever owns our key.
    expect(route).toMatch(/const renderVault = userId \? await loadUserVaultSecrets\(userId/);
    // …and that it is the key for THIS app: a deploy key the user tied to one app must not deploy another.
    expect(route).toMatch(/loadUserVaultSecrets\(userId, workspaceId\)/);
    expect(route).toContain('resolveRenderKey(renderVault)');
    expect(route).toContain('apiKey: renderKey.key');
  });

  // The PRECEDENCE itself (user key beats server key) is proved behaviourally in
  // renderDeploy.test.ts — "resolveRenderKey PREFERS the user's own key". Asserting it again by
  // reading source offsets here would be the fragile fixed-window style `sourceSlice.ts` exists to
  // replace, and it would break on a comment edit while proving nothing extra.

  it('the refusal names a key the user can actually set — the old one named a setting nothing read', () => {
    // The old message said "Set RENDER_API_KEY (Settings → Secrets & Keys)" while the code read only
    // process.env, so a user who followed it exactly got the identical refusal back.
    const fn = braceBlock(engine, 'export function renderRequirement');
    // And the path it names is the tile's REAL name — the old text sent people to "Secrets & Keys",
    // a screen that does not exist. See settingsLabels.ts / settingsLabels.test.ts.
    expect(fn).toContain('Settings → Secrets & API Keys');
    expect(route).toContain('error: renderRequirement(process.env, renderVault)');
  });
});
