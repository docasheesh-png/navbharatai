// The feature probe read only the screen the preview opened on, so on a multi-screen app a control one
// tab away was reported "missing" (autopsy a106df77: Delete lived on the Bills screen, the probe read the
// Dashboard). These tests lock the class: the probe reads the app's own routes before calling anything
// missing, only when something would be, without recording those screens' console into the repair window.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { combineScreens, screensReadNote, screensToProbe, screenUrl, MAX_PROBE_SCREENS, featureProbeScreensEnabled } from '../src/server/AgentV3/featureProbeScreens';
import { checkFeaturePresence } from '../src/server/AgentV3/FeaturePresence';

const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
const e2b = readFileSync(resolve(__dirname, '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');

const page = (body: string) => `<!doctype html><html><body><div id="root">${body}</div></body></html>`;
const HOME = page('<h1>Dashboard</h1><a href="/new">New Bill</a><input placeholder="Customer name"><button>Add bill</button><p>Total sales ₹0</p>');
const BILLS = page('<h1>Bills</h1><table><tr><td>Ravi</td><td><button aria-label="Delete bill">Delete</button></td></tr></table>');
const PROMPT = 'Build a billing app where I can add bills and delete bills';

describe('which screens are read', () => {
  it('skips home, dynamic routes and the sign-in page; dedupes; caps', () => {
    expect(screensToProbe(['/', '/bills', '/new', '/bills', '/bill/:id', '/login', '/settings', '/reports', '/a', '/b']))
      .toEqual(['/bills', '/new', '/settings', '/reports']);
    expect(screensToProbe(['/x', '/y', '/z', '/w', '/v']).length).toBe(MAX_PROBE_SCREENS);
    expect(screensToProbe([])).toEqual([]);
  });

  it('a screen URL keeps the preview origin and drops its query', () => {
    expect(screenUrl('https://5173-abc.e2b.app/?nbai=1', '/bills')).toBe('https://5173-abc.e2b.app/bills');
    expect(screenUrl('not a url', '/bills')).toBeNull();
  });

  it('the kill switch', () => {
    expect(featureProbeScreensEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(featureProbeScreensEnabled({ AGENTV3_FEATURE_PROBE_SCREENS: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('🔴 the class: a control on another screen is not missing', () => {
  it('home alone calls Delete missing; home + the Bills screen does not', () => {
    const homeOnly = checkFeaturePresence(PROMPT, HOME);
    expect(homeOnly.missing).toContain('Delete / remove');
    const both = checkFeaturePresence(PROMPT, combineScreens(HOME, [{ route: '/bills', html: BILLS }]));
    expect(both.missing).toEqual([]);
    expect(both.present).toEqual(expect.arrayContaining(['Add / create', 'Delete / remove']));
  });

  it('a control missing on every screen is still reported', () => {
    const r = checkFeaturePresence(`${PROMPT} and filter them`, combineScreens(HOME, [{ route: '/bills', html: BILLS }]));
    expect(r.missing).toContain('Filter');
  });

  it('the report says which screens were read', () => {
    expect(screensReadNote([])).toBe('screens=/');
    expect(screensReadNote([{ route: '/bills', html: '' }, { route: '/new', html: '' }])).toBe('screens=/,/bills,/new');
  });
});

describe('the route wiring (source guards)', () => {
  it('reads other screens only when something would be called missing, and never behind a sign-in session', () => {
    expect(route).toMatch(/if \(coverage\.missing\.length > 0 && !readBehindSignIn && !abort\.signal\.aborted\) \{\s*probedScreens = await readOtherScreens\(\);/);
  });

  it('reads the routes the app declares, nested ones included', () => {
    expect(route).toMatch(/screensToProbe\(extractPageRoutes\(/);
  });

  it('only a screen that rendered counts, and its console stays out of the repair window', () => {
    expect(route).toMatch(/actuator\.browseUrl\(workspaceId, url, \{ recordConsole: false \}\)/);
    expect(route).toMatch(/analyzePreviewHtml\(sc\.html, \{ painted: sc\.painted, source: sc\.source \}\)\.rendered\) out\.push/);
    expect(e2b).toMatch(/recordConsole: opts\?\.recordConsole !== false && browseConsoleCaptureEnabled\(\)/);
  });

  it('both post-heal re-probes read the same screens again', () => {
    expect(route.match(/combineScreens\(after(?:Html)?, afterScreens\)/g)?.length).toBe(2);
  });

  it('the report line carries the screens read', () => {
    expect(route).toMatch(/\$\{featurePresenceEvidence\(coverage\)\} · \$\{screensReadNote\(probedScreens\)\}/);
  });
});
