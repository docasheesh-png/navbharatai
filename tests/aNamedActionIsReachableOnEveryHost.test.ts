import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';
import { connectStage, deployBackendWayForward, DEPLOY_BACKEND_PATH } from '../src/components/agentv3/NbaiDomainConnect';

/**
 * ADMIN REPORT 2026-10-17, mitrify.com: *"dns connect hone ke bad bhi live nahi huyi website. dekho"*.
 *
 * Q-1136 fixed the sentence that contradicted the verdict. This is the SIBLING found hunting that
 * class, and it is the half the user actually needed: the verdict was right, and on the surface most
 * users reach it from, it offered nothing to press.
 *
 * `NbaiDomainConnect` has TWO hosts. `HostingChooser` passes `onDeployBackend` (the controls live one
 * view away). `ConnectMyWebsitePanel` — the ONE real "Connect my website" entry point, reached from
 * Settings → App Settings → Domain and from Home → Other AI → Publish & Deploy → "Custom Domain" —
 * cannot, and did not. The screen's branch was gated `&& onDeployBackend &&`, so there it rendered
 * *"Deploy the server part first"* and no way to do it. An outcome described, with no path.
 *
 * 🔑 THE CLASS, and it is what this file locks: **a named action whose only way forward is an
 * optional prop.** The screen states the action unconditionally and leaves reachability to whoever
 * mounted it — honest on one host, a dead end on the next. So the rule is about the SHAPE, not about
 * this one prop: no `stage.action === '…'` branch may be gated on an optional callback.
 */
const SCREEN = 'src/components/agentv3/NbaiDomainConnect.tsx';
const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

/** Comments in this very screen quote the OLD shape, so a check that reads them checks its own prose. */
const screenCode = () => stripCodeComments(src(SCREEN));

/** Every optional callback prop the screen declares — derived, never a hand-kept list. */
function optionalCallbackProps(): string[] {
  const code = screenCode();
  const at = code.indexOf('interface NbaiDomainConnectProps');
  const body = code.slice(at, code.indexOf('\n}', at));
  return [...body.matchAll(/(\w+)\?:\s*\(/g)].map((m) => m[1]);
}

describe('🔒 a named action is reachable on EVERY host of the domain screen', () => {
  it('the optional callbacks are found at all — a derived list that derives nothing proves nothing', () => {
    expect(optionalCallbackProps()).toContain('onDeployBackend');
  });

  it('THE CLASS: no stage.action branch is gated on an optional callback', () => {
    const code = screenCode();
    const optional = optionalCallbackProps();
    const offenders: string[] = [];
    for (const m of code.matchAll(/stage\.action === '([a-z-]+)'([^\n]*)/g)) {
      const [, action, rest] = m;
      for (const prop of optional) {
        // `&& onX &&` gates the WHOLE branch on the prop; `&& (onX ? (` offers a fallback instead.
        if (new RegExp(`&&\\s*${prop}\\s*&&`).test(rest)) offenders.push(`${action} gated on ${prop}`);
      }
    }
    expect(offenders, 'a host that cannot pass the prop would render the verdict with nothing to act on')
      .toEqual([]);
  });

  it('the deploy-backend branch offers the button OR the path — never neither', () => {
    const code = screenCode();
    expect(code).toContain("stage.action === 'deploy-backend' && (onDeployBackend ? (");
    expect(code).toContain('Go to Deploy backend');            // the host that can navigate
    expect(code).toContain('deployBackendWayForward(false)');   // the host that cannot
  });

  it('the words name the exact route, and promise the domain work survives it', () => {
    expect(deployBackendWayForward(true), 'a host with a button needs no sentence').toBe('');
    const note = deployBackendWayForward(false);
    expect(note).toContain(DEPLOY_BACKEND_PATH);
    expect(DEPLOY_BACKEND_PATH).toContain('NavBharatAI Pro');
    expect(DEPLOY_BACKEND_PATH).toContain('Publish');
    expect(DEPLOY_BACKEND_PATH).toContain('Deploy backend');
    // Someone sent two screens away mid-flow has no way to know their DNS work is safe. Without this
    // the safe-looking move is to start the domain over — the exact loop this screen exists to end.
    expect(note, 'tell them the domain stays connected').toMatch(/stays connected/);
    expect(note).toMatch(/nothing here needs redoing/);
  });

  it('the verdict that needs a way forward is still produced', () => {
    const s = connectStage({
      active: true, ownershipState: 'OWNERSHIP_ACTIVE', hostState: 'HOST_ACTIVE', sslState: 'CERT_ACTIVE',
      publishBlocked: 'Your app has a server half…',
    });
    expect(s.action).toBe('deploy-backend');
  });
});

/**
 * THE HOST CENSUS. The class check above makes the screen complete by itself, so a new host cannot
 * reintroduce the dead end — but a new host IS a decision somebody should make knowingly (can it
 * navigate to the controls, or does it rely on the words?). This fails when the set changes, and it
 * also proves BOTH branches are live code rather than one being a comfortable theory.
 */
describe('🔒 both branches are real: one host navigates, one host uses the words', () => {
  function hostsOfTheScreen(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.tsx$/.test(entry)) continue;
        const rel = full.slice(resolve(__dirname, '..').length + 1);
        if (rel === SCREEN) continue;
        if (/<NbaiDomainConnect\b/.test(stripCodeComments(readFileSync(full, 'utf8')))) found.push(rel);
      }
    };
    walk(resolve(__dirname, '..', 'src'));
    return found.sort();
  }

  it('the hosts are exactly the two known ones', () => {
    expect(hostsOfTheScreen(), 'a new host must decide: navigate, or rely on deployBackendWayForward')
      .toEqual([
        'src/components/agentv3/HostingChooser.tsx',
        'src/components/panels/ConnectMyWebsitePanel.tsx',
      ]);
  });

  it('HostingChooser navigates — it has the controls one view away', () => {
    expect(stripCodeComments(src('src/components/agentv3/HostingChooser.tsx')))
      .toContain("onDeployBackend={() => setView('choose')}");
  });

  it('ConnectMyWebsitePanel does NOT, and that is why the words exist', () => {
    // It is mounted from Settings and from the sidebar; neither can reach the Publish sheet's
    // server-half card, so inventing a callback here would be a button that goes nowhere.
    const panel = stripCodeComments(src('src/components/panels/ConnectMyWebsitePanel.tsx'));
    expect(panel).toMatch(/<NbaiDomainConnect\b/);
    expect(panel).not.toContain('onDeployBackend');
  });
});
