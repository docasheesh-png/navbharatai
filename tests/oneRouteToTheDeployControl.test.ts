import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';
import { DEPLOY_BACKEND_ROUTE, DEPLOY_BACKEND_LABEL } from '../src/lib/backendDeployOffer';
import { serverNeedText, buildNeedsNotice } from '../src/server/AgentV3/buildNeeds';
import { DEPLOY_BACKEND_PATH } from '../src/components/agentv3/NbaiDomainConnect';

/**
 * ADMIN 2026-10-17, finishing *"website connect, databse connect, backend connect ko simple banao"*.
 *
 * THREE surfaces have to tell a user with a server-half app where the control is: the domain screen's
 * words when its host cannot navigate (Q-1137), the build's closing "what this app still needs" notice,
 * and the Publish panel's own steps (Q-1139). Until today the notice was the one that never said —
 * `included` read *"publish it when you are ready"*, and for a bare-server app Publish REFUSES; `buy`
 * and `none` read "host it yourself", which is true and unactionable for a non-technical owner.
 *
 * 🔑 Same class as Q-1136 / Q-1137: something that names an action without a path to it. And three
 * copies of a route agree only until one is edited — a route that is subtly wrong in ONE place is
 * worse than none, because the user follows it, finds nothing, and stops believing the next one.
 */
const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('🔒 one route to the deploy control, named by every surface that names it', () => {
  it('the route is one constant, and the domain screen re-exports that same value', () => {
    expect(DEPLOY_BACKEND_PATH).toBe(DEPLOY_BACKEND_ROUTE);
    expect(DEPLOY_BACKEND_ROUTE).toContain('NavBharatAI Pro');
    expect(DEPLOY_BACKEND_ROUTE).toContain('Publish');
    expect(DEPLOY_BACKEND_ROUTE).toContain(DEPLOY_BACKEND_LABEL);
  });

  it('no surface keeps its own copy of the sentence', () => {
    const root = resolve(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
        const rel = full.slice(root.length + 1);
        if (rel === 'src/lib/backendDeployOffer.ts') continue;   // the one home
        const code = stripCodeComments(readFileSync(full, 'utf8'));
        // The route's distinctive middle — a literal here means a second copy that can drift.
        if (code.includes('the More sheet → Publish')) offenders.push(rel);
      }
    };
    walk(resolve(root, 'src'));
    expect(offenders, 'import DEPLOY_BACKEND_ROUTE instead of re-typing the route').toEqual([]);
  });

  it('ALL THREE server-row branches now name it — including the one that said "publish when ready"', () => {
    for (const plan of ['buy', 'included', 'none'] as const) {
      const row = serverNeedText({ needsServer: true, plan });
      expect(row, `plan=${plan}`).not.toBeNull();
      expect(row!.why, `plan=${plan} must say WHERE, not only what`).toContain(DEPLOY_BACKEND_ROUTE);
    }
  });

  it('an app with no server half still says nothing at all', () => {
    expect(serverNeedText({ needsServer: false, plan: 'none' })).toBeNull();
    expect(serverNeedText(null)).toBeNull();
    expect(buildNeedsNotice({ server: { needsServer: false, plan: 'none' } })).toBe('');
  });

  it('the route reaches the real closing line, in a localised notice too', () => {
    // The route stays English inside a localised notice, exactly as `Plans` / `Database` already do:
    // it names buttons whose own labels are English on the screen the user is sent to.
    const hi = buildNeedsNotice({ server: { needsServer: true, plan: 'included' } }, 'hi');
    expect(hi).toContain(DEPLOY_BACKEND_ROUTE);
    expect(hi, 'the rest of the line is still the user\'s own language').toMatch(/[ऀ-ॿ]/);
  });

  it('the plans offer is unchanged where it was right — a route is not an upsell', () => {
    const buy = serverNeedText({ needsServer: true, plan: 'buy' })!;
    expect(buy.cta).toEqual({ view: 'billing', label: 'Open Plans' });
    // `included` and `none` still offer NO button: selling a plan they hold, or one we could not read,
    // is what the row's own docblock forbids.
    expect(serverNeedText({ needsServer: true, plan: 'included' })!.cta).toBeUndefined();
    expect(serverNeedText({ needsServer: true, plan: 'none' })!.cta).toBeUndefined();
  });

  /**
   * ⚠️ WHAT WAS MEASURED AND NOT BUILT, so nobody builds it by accident later. `connectActions.ts` has
   * recorded since 2026-09-20 that a DOMAIN row needed a verified domain status, and that fact now
   * exists. But its case — domain linked · not serving · the app needs a server — is a strict SUBSET
   * of this row's own case, so it would be a second line about one problem, paid for with a live
   * DNS/HTTP probe on every build.
   */
  it('the server row already covers every app a domain row would have fired on', () => {
    // The subset relation in code: needsServer is the row's trigger, and it is also the domain row's
    // third condition — so there is no app the domain row would reach that this row does not.
    expect(serverNeedText({ needsServer: true, plan: 'none' })).not.toBeNull();
    const notice = src('src/server/AgentV3/buildNeeds.ts');
    expect(notice, 'the decision is recorded where the next session will read it')
      .toContain('strict SUBSET of this row');
  });
});
