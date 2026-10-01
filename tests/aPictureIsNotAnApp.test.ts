/**
 * AUTOPSY 19641ab5 (2026-10-01) — "Create full image" + a portrait photo, built as an app.
 *
 * A free user attached a photo and typed three words. Pro scored the request 83 ("complex", ~11 features
 * — counted from the photo's description), the mega-app roadmap planned a six-step image generator, and
 * the builder started one in a workspace that held only our starter's index.html. The user stopped it at
 * 108 s and was charged ₹7.62. Each section below is one root cause from that report.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isPictureRequest, shouldAnswerPictureRequest, pictureRequestFallback, PICTURE_REQUEST_STEER } from '../src/server/AgentV3/pictureRequest';
import { planningRequest, planningContextNote } from '../src/server/AgentV3/planningRequest';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import { asksForSimulation } from '../src/server/lib/megaRoadmap';
import { etaAccuracy } from '../src/server/AgentV3/BuildDiagnostics';
import { fleetHistoryFromTelemetry } from '../src/server/AgentV3/etaHistory';
import { etaEvidenceNote } from '../src/server/AgentV3/etaEvidence';
import { starterFilesToComplete, isOurStarterFile } from '../src/server/AgentV3/starterFragment';
import { ViteReactProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProvider';
import { E2BActuator } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';

const strip = (s: string) => s.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
const ROUTE = readFileSync('src/server/routes/agentv3.ts', 'utf8');
const VITE = new ViteReactProvider().getFiles([]);

// The report's own attachment description, shortened.
const PHOTO = '[Image: 1000243024.jpg]\nThe uploaded file is a portrait-style photograph of a woman. It is not a UI design, screenshot, mockup, or wireframe.\n\n**Visual elements:**\n- Long dark hair, parted in the middle\n- Gold earrings, a nose ring and a necklace\n- A red saree with a golden border\n- Soft daylight from the left, a blurred green background\n- Slight smile, looking at the camera\n- Bangles on both wrists, a bindi, mehndi on the hands\n- Framed from the shoulders up';

describe('§1 a picture request is answered, not built (pictureRequest.ts)', () => {
  it('🔴 the report: "Create full image" asks for a picture', () => {
    expect(isPictureRequest('Create full image')).toBe(true);
    expect(shouldAnswerPictureRequest({ prompt: 'Create full image', userAppExists: false, importing: false })).toBe(true);
  });

  it('pictures in any form are recognised', () => {
    for (const p of ['make a logo for my bakery', 'generate an image of a sunset over the sea', 'draw a red car', 'ek photo banao', 'design a poster for Diwali sale']) {
      expect(isPictureRequest(p), p).toBe(true);
    }
  });

  it('PRECISION: a request that names software still builds', () => {
    for (const p of [
      'Create an image generator app', 'make a photo gallery', 'image slider banao', 'build an image editor',
      'create a wallpaper website', 'image banane wala app banao', 'make a picture puzzle game',
      'build a todo app', 'how do I add an image to my page', 'create images for my app',
    ]) {
      expect(isPictureRequest(p), p).toBe(false);
    }
  });

  it('a workspace holding the user\'s app, an import, or the kill switch: no answer, build as before', () => {
    expect(shouldAnswerPictureRequest({ prompt: 'make a logo', userAppExists: true, importing: false })).toBe(false);
    expect(shouldAnswerPictureRequest({ prompt: 'make a logo', userAppExists: false, importing: true })).toBe(false);
    expect(shouldAnswerPictureRequest({ prompt: 'make a logo', userAppExists: false, importing: false, env: { AGENTV3_PICTURE_ANSWER: 'off' } as NodeJS.ProcessEnv })).toBe(false);
  });

  it('the answer names the studio and offers the app, and names no vendor', () => {
    for (const t of [PICTURE_REQUEST_STEER, pictureRequestFallback()]) {
      expect(t).toMatch(/Image Generator AI/);
      expect(t).toMatch(/Home → Other AI → AI Image Gen/);
      expect(t).toMatch(/image generator app/);
      expect(t).not.toMatch(/pollinations|gemini|grok|flux|cloudflare|openai|claude/i);
    }
  });

  it('WIRING: the route answers it on the chat lane with the steer and a deterministic fallback', () => {
    const src = strip(ROUTE);
    expect(src).toMatch(/const answerPictureRequest = [^;]*shouldAnswerPictureRequest\(/);
    expect(src).toMatch(/if \(answerPictureRequest\) \{[^}]*intent = 'chat';/);
    expect(src).toMatch(/answerPictureRequest \? PICTURE_REQUEST_STEER/);
    expect(src).toMatch(/answerPictureRequest\s*\?\s*pictureRequestFallback\(\)/);
    expect(src).toMatch(/if \(answerProjectElsewhere \|\| answerPictureRequest\) return null;/);
  });
});

describe('§2 a photo is not a feature list (planningRequest.ts)', () => {
  it('🔴 the report: the photo\'s description made the request LARGE; set aside, it does not', () => {
    const before = planningRequest({ prompt: 'Create full image', attachmentText: PHOTO, userAppExists: false });
    const after = planningRequest({ prompt: 'Create full image', attachmentText: '', picturesSetAside: 1, userAppExists: false });
    expect(analyzeAppScope(before.text).decision).toBe('analyze');
    expect(analyzeAppScope(after.text).decision).toBe('direct');
    expect(after.text).toBe('Create full image');
    expect(after.picturesSetAside).toBe(1);
    expect(planningContextNote(after, 17)).toMatch(/1 attached picture\(s\) were not read as part of the request/);
  });

  it('WIRING: the sizers read only what describes an app — a picture counts only with a design contract', () => {
    const src = strip(ROUTE);
    expect(src).toMatch(/const pictureIsSpec = designContract !== null;/);
    expect(src).toMatch(/\[docs, pictureIsSpec \? stripContractBlock\(vis\) : ''\]/);
    expect(src).toMatch(/planningRequest\(\{ prompt, attachmentText: planningAttachmentText, picturesSetAside,/);
    expect(src).not.toMatch(/planningRequest\(\{ prompt, attachmentText: attachmentContext/);
    // An import is sized exactly as before: both notes reach the planning text too.
    expect(src.match(/planningAttachmentText \+= `\\n\\n\[(IMPORT COMPLETENESS|APP IMPORT)/g)?.length).toBe(2);
  });
});

describe('§3 a negation reaches along a list (megaRoadmap.ts)', () => {
  it('🔴 the report\'s own instruction is honest, not a request to simulate', () => {
    expect(asksForSimulation('Do not use a placeholder or a fake loading animation; the image must be real.')).toBe(false);
    expect(asksForSimulation('Avoid placeholders, fake loading states and canned results.')).toBe(false);
  });

  it('a real ask to fake still counts, across a clause boundary or a turn', () => {
    expect(asksForSimulation('Do not call the API; simulate the progress of rendering.')).toBe(true);
    expect(asksForSimulation('Never show a fake result, but simulate the upload progress.')).toBe(true);
    expect(asksForSimulation('Show a fake progress bar while generating.')).toBe(true);
  });
});

describe('§4 a stopped build does not test the estimate', () => {
  const promise = { estimateMs: 660_413, lowMs: 643_903, highMs: 686_830, evidenced: true };

  it('🔴 the report: stopped at 1.8 min is "untested", not "0.2× and UNDER the band"', () => {
    const a = etaAccuracy(promise, 0, 107_202, 'OUTCOME_USER_STOPPED')!;
    expect(a.untested).toBe(true);
    expect(a.line).toMatch(/cut short \(OUTCOME_USER_STOPPED\)/);
    expect(a.line).not.toMatch(/UNDER the band/);
  });

  it('a build stopped AFTER the band still proves the estimate low; an ordinary build is judged', () => {
    expect(etaAccuracy(promise, 0, 900_000, 'OUTCOME_USER_STOPPED')!.untested).toBeUndefined();
    expect(etaAccuracy(promise, 0, 107_202, 'OUTCOME_BUILD_SUCCESS')!.line).toMatch(/UNDER the band/);
  });

  it('the admin aggregate counts no ratio for an untested build', () => {
    const src = readFileSync('src/server/AgentV3/AdminBuildReportStore.ts', 'utf8');
    expect(src).toMatch(/etaRatio: !trimmed\.etaAccuracy\?\.untested/);
    expect(src).toMatch(/etaWithinBand: !trimmed\.etaAccuracy\?\.untested/);
  });

  it('the platform prior is the mean of SUCCESSFUL builds; a stopped one does not drag it down', () => {
    const days = [{ byTaskType: { complex_app: { builds: 4, durationMs: 4 * 60_000 + 3 * 600_000, okBuilds: 3, okDurationMs: 3 * 600_000 } } }];
    const f = fleetHistoryFromTelemetry(days, 'complex_app', 'complex' as never);
    expect(f.history[0].durationMs).toBe(600_000);
    expect(f.builds).toBe(3);
    // A day written before okDurationMs existed keeps the old mean.
    const legacy = fleetHistoryFromTelemetry([{ byTaskType: { complex_app: { builds: 2, durationMs: 1_200_000 } } }], 'complex_app', 'complex' as never);
    expect(legacy.history[0].durationMs).toBe(600_000);
  });

  it('the evidence line says WHOSE builds taught it', () => {
    const est = { historyWeight: 1, basis: 'historical' } as never;
    expect(etaEvidenceNote(est, 'platform')).toMatch(/NavBharatAI's recent builds of this kind \(this app has none of its own yet\)/);
    expect(etaEvidenceNote(est, 'platform')).not.toMatch(/this workspace's own/);
    expect(etaEvidenceNote(est)).toMatch(/this workspace's own past builds/);
  });
});

describe('§5 a piece of our starter is completed, a user project never is (starterFragment.ts)', () => {
  it('🔴 the report: only our index.html — every other template file is put back', () => {
    const missing = starterFilesToComplete({ 'index.html': VITE['index.html'] }, VITE);
    expect(missing).toContain('package.json');
    expect(missing).toContain('src/main.tsx');
    expect(missing).not.toContain('index.html');
  });

  it('an empty workspace is the starter not yet written', () => {
    expect(starterFilesToComplete({}, VITE).sort()).toEqual(Object.keys(VITE).sort());
  });

  it('PRECISION: a user file, an edited starter file, or an unreadable file means a project — nothing written', () => {
    expect(starterFilesToComplete({ 'index.html': '<html><body>My shop</body></html>' }, VITE)).toEqual([]);
    expect(starterFilesToComplete({ 'index.html': VITE['index.html'], 'notes.txt': 'mine' }, VITE)).toEqual([]);
    expect(starterFilesToComplete({ 'index.html': VITE['index.html'].replace('App', 'My App') }, VITE)).toEqual([]);
    expect(starterFilesToComplete({ 'index.html': null }, VITE)).toEqual([]);
  });

  function fakeSandbox(present: Record<string, string>) {
    const written: string[] = [];
    return {
      written,
      sandbox: {
        files: {
          exists: async (p: string) => p === '/home/user/workspace' || Object.keys(present).some((k) => p === `/home/user/workspace/${k}`),
          read: async (p: string) => present[p.replace('/home/user/workspace/', '')],
          writeFiles: async (files: Array<{ path: string }>) => { written.push(...files.map((f) => f.path.replace('/home/user/workspace/', ''))); },
        },
        commands: { run: async () => ({ stdout: Object.keys(present).map((k) => `/home/user/workspace/${k}`).join('\n'), exitCode: 0 }) },
      },
    };
  }
  function actuatorOn(sandbox: unknown): E2BActuator {
    const act = new E2BActuator('test-key');
    const a = act as unknown as Record<string, unknown>;
    a.getSandbox = async () => sandbox;
    a._kickoffPlaywright = () => { /* no browser in a unit test */ };
    return act;
  }

  it('ACTUATOR: setup completes the fragment and says so; a user project is left alone', async () => {
    const frag = fakeSandbox({ 'index.html': VITE['index.html'] });
    const act = actuatorOn(frag.sandbox);
    await act.ensureWorkspace('ws-frag', 'vite-react');
    expect(frag.written).toContain('package.json');
    expect(frag.written).not.toContain('index.html');
    expect(act.starterCompletedCount('ws-frag')).toBe(Object.keys(VITE).length - 1);

    const user = fakeSandbox({ 'index.html': '<html><body>My shop</body></html>' });
    const act2 = actuatorOn(user.sandbox);
    await act2.ensureWorkspace('ws-user', 'vite-react');
    expect(user.written).toEqual([]);
    expect(act2.starterCompletedCount('ws-user')).toBe(0);
  });

  it('replacing our own untouched starter file is not a FULL-REWRITE warning', () => {
    expect(isOurStarterFile('index.html', VITE['index.html'], [VITE])).toBe(true);
    expect(isOurStarterFile('index.html', '<html>mine</html>', [VITE])).toBe(false);
    const src = strip(readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8'));
    expect(src).toMatch(/kind === 'modify' && isOurStarterFile\(path, existingContent, starterTemplates\(\)\)/);
  });
});
