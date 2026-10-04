/**
 * 🖥️ THE APP WAS OFF THE USER'S SCREEN FOR EIGHT OF ITS NINE MINUTES — autopsy `39e982bd`, 2026-10-04.
 *
 * `BUILD PRIMECLASH ESPORTS` — a 228-feature request for a native Android esports app, built as
 * milestone 1 of a mega-app roadmap. `TIME_TO_FIRST_RENDER: 495s` on a 571-second build: the user
 * watched our starter page for **87%** of their build.
 *
 * The write order was `src/types.ts`, a Firebase client, a service, four hooks, two components, six
 * screens, a stylesheet, `src/main.tsx` — and `src/App.tsx` **twenty-third of twenty-four writes**.
 *
 * 🔴 `shellEarlyRule` HAD ALREADY BEEN IN THE ARCHITECT'S PROMPT SINCE `earlyPreview.ts` SHIPPED, and
 * says exactly the right thing: *"right after `src/types.ts`, write the ENTRY"*. It lost. A rule the
 * model is TOLD competes with a habit the model HAS, and inside a 90 KB system prompt the habit wins —
 * which is why every rule in this engine that actually changed behaviour became MECHANICAL
 * (`undefinedClassWriteNote`, `stylePolishResume`, `orphanHandBack`, and `SPACING_SNAPPED`, whose own
 * report line records three model calls wasted on the advisory version of itself).
 *
 * So the same rule is now handed back at the one moment it is actionable: a source file has just been
 * written, the entry is still our untouched starter, and the file to write next is named.
 *
 * ── THE OTHER THREE ROOT CAUSES FROM THE SAME REPORT ───────────────────────────────────────────────
 *
 * **The model refused instead of building.** It read the (correct) `UNSUPPORTED_STACK` brief and spent
 * its first substantive turn writing 1,975 characters about what the sandbox cannot do, ending with no
 * tool call. `UNFINISHED_BUILD_RESUMED` caught it and the next words were *"I hear you — I paused when
 * I should have shipped."* The rescue worked and cost ~70 s, one 871-token call and a user-visible
 * *"⏳ Not finished yet"*. The brief said what not to do and never said who tells the user — while
 * `buildFindingSuggestions.ts` records in as many words that this code needs no offer because *"the
 * user is told in the ready message already"*. Every part of the platform knew except the one actor
 * that could waste a turn on it.
 *
 * **The user was told to remove a package the plan was keeping.** `react-router-dom` was installed for
 * screens the roadmap plans in steps 3–5; `INTEGRITY_UNUSED_DEP` warned *"removing it shrinks the
 * install"*. The prune stands down for exactly this case in its own words (*"never on a roadmap
 * milestone turn — a package for a later module is not unused yet"*) and `megaRoadmapActive` is in
 * scope three lines from the call that wrote the warning. One fact, two readers, one of them told.
 *
 * **Two ordinary English words were reported as unknown outside services.** `UNKNOWN_NAME_IN_REQUEST`
 * named `COMPLETE` and `ANDROID` (and `APPLICATION`): the guard stands down for a request typed
 * entirely in capitals, and a structured spec with ALL-CAPS HEADINGS over a lower-case body defeats
 * that test. Measured on the report's own text before the fix: `["PRIMECLASH","COMPLETE","ANDROID"]`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import type { ToolUse } from '../src/server/AgentV3/ClaudeClient';
import { entryFirstWriteNote, earlyPreviewEnabled } from '../src/server/AgentV3/earlyPreview';
import { STARTER_ENTRY_CONTENT } from '../src/server/AgentV3/stillTheStarterApp';
import { unknownNamesInRequest } from '../src/server/AgentV3/unknownName';
import { unusedDependencyLine } from '../src/server/AgentV3/unusedDepPrune';
import { unsupportedStackBuilderNote, unsupportedStackRequested } from '../src/server/AgentV3/unsupportedStack';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

const call = (name: string, input: Record<string, unknown>): ToolUse => ({ id: 't1', name, input });

/** The report's own first write, byte-for-byte in shape: the shared contract, before any screen. */
const TYPES_TS = `export interface UserProfile {
  uid: string;
  fullName: string;
  freeFireIgn: string;
  walletPaise: number;
}
`;

/** A starter workspace: our untouched App.tsx, and an index.html that mounts src/. */
function seedStarter(act: FakeActuator): void {
  act.files.set('src/App.tsx', STARTER_ENTRY_CONTENT);
  act.files.set('index.html', '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
}

describe('🖥️ the entry-first rule is handed back, not merely written in the prompt', () => {
  let act: FakeActuator;
  let d: ToolDispatcher;
  beforeEach(() => {
    act = new FakeActuator();
    const stream = new AgentEventStream();
    d = new ToolDispatcher(act, 'ws-entry-first', new WorkspaceState(stream), stream);
    seedStarter(act);
  });

  it('names the entry at the report\'s own first write', async () => {
    const res = await d.dispatch(call('write_file', { path: 'src/types.ts', content: TYPES_TS }), 'architect');
    expect(res.content).toMatch(/src\/App\.tsx/);
    expect(res.content).toMatch(/still shows the starter page/i);
    expect(res.content).toMatch(/NEXT/);
  });

  it('says it ONCE, however many leaves follow', async () => {
    const first = await d.dispatch(call('write_file', { path: 'src/types.ts', content: TYPES_TS }), 'architect');
    expect(first.content).toMatch(/still shows the starter page/i);
    for (const p of ['src/hooks/useAuth.ts', 'src/screens/MatchesScreen.tsx', 'src/components/BottomNavigation.tsx']) {
      const next = await d.dispatch(call('write_file', { path: p, content: 'export default function X() { return null; }\n' }), 'architect');
      expect(next.content, p).not.toMatch(/still shows the starter page/i);
    }
  });

  it('reaches every write door, since it rides the shared steering helper', async () => {
    const batch = await d.dispatch(call('write_files_batch', { files: [
      { path: 'src/types.ts', content: TYPES_TS },
      { path: 'src/lib/firebase.ts', content: 'export const app = null;\n' },
    ] }), 'architect');
    expect(batch.content).toMatch(/still shows the starter page/i);
  });

  it('is silent for the write that IS the entry', async () => {
    const res = await d.dispatch(call('write_file', { path: 'src/App.tsx', content: 'export default function App() { return <main>PrimeClash</main>; }\n' }), 'architect');
    expect(res.content).not.toMatch(/still shows the starter page/i);
  });

  it('is silent on an EDIT of a real app — the note would be false', async () => {
    act.files.set('src/App.tsx', 'export default function App() { return <main>PrimeClash</main>; }\n');
    const res = await d.dispatch(call('write_file', { path: 'src/types.ts', content: TYPES_TS }), 'architect');
    expect(res.content).not.toMatch(/still shows the starter page/i);
  });

  it('is silent for a write that says nothing about rendering', async () => {
    // package.json was the report's SECOND write and a stylesheet its twentieth; neither tells us the
    // app could render yet, and a note on them would fire before the model has written any app code.
    const pkg = await d.dispatch(call('write_file', { path: 'package.json', content: '{"name":"primeclash-esports"}\n' }), 'architect');
    expect(pkg.content).not.toMatch(/still shows the starter page/i);
    const css = await d.dispatch(call('write_file', { path: 'src/theme.css', content: ':root { --bg: #0B0B0E; }\n' }), 'architect');
    expect(css.content).not.toMatch(/still shows the starter page/i);
  });

  it('is silent for a plain-JavaScript app whose page no longer mounts src/', async () => {
    // autopsy 4499741f: the seeded App.tsx is untouched AND irrelevant there, and a build was once
    // sent to delete src/ to satisfy a verdict about a file nothing ran.
    act.files.set('index.html', '<!doctype html><html><body><div id="app"></div><script type="module" src="/script.js"></script></body></html>');
    const res = await d.dispatch(call('write_file', { path: 'src/types.ts', content: TYPES_TS }), 'architect');
    expect(res.content).not.toMatch(/still shows the starter page/i);
  });

  it('is silent for a Project Mode module that does not own the entry', async () => {
    d.setStarterExpected(true);
    const res = await d.dispatch(call('write_file', { path: 'src/types.ts', content: TYPES_TS }), 'architect');
    expect(res.content).not.toMatch(/still shows the starter page/i);
  });

  it('reverts with the early-preview switch', () => {
    expect(entryFirstWriteNote('src/App.tsx', { AGENTV3_EARLY_PREVIEW: 'off' } as NodeJS.ProcessEnv)).toBe('');
    expect(earlyPreviewEnabled({ AGENTV3_EARLY_PREVIEW: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(entryFirstWriteNote('src/App.tsx', {} as NodeJS.ProcessEnv)).toContain('src/App.tsx');
  });

  it('is wired into the shared steering helper — a source guard', () => {
    // A note on one door of four is the 6bae5835 defect. `tsc` cannot see which doors a note reaches.
    const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    const at = src.indexOf('private async writeSteeringNotes(');
    expect(at).toBeGreaterThan(-1);
    // The ONE line every door's result is built from: the note must be a term of it, not merely defined.
    const ret = src.slice(at).match(/\n    return hooks \+[^;]*;/)?.[0] ?? '';
    // Since the merge with #3524 the note rides `shadow` (the "what the preview will not show" notes), so the
    // ONE return line keeps its shape for every other source guard and still carries this note by construction.
    expect(ret).toContain('shadow');
    expect(src.slice(at)).toContain('shadow += await this.entryFirstNote(files);');
  });
});

describe('🙅 the builder is told the user has already been told', () => {
  it('says so in the mobile brief, which is the shape the report hit', () => {
    const stack = unsupportedStackRequested('Build a complete Android application in Kotlin with Jetpack Compose');
    expect(stack).toBeTruthy();
    const note = unsupportedStackBuilderNote(stack as string, 'vite-react');
    expect(note).toMatch(/ALREADY TOLD/i);
    expect(note).toMatch(/do NOT spend a turn explaining/i);
    expect(note).toMatch(/Build the app now/i);
  });

  it('says so in the non-mobile brief too — the sibling lane', () => {
    const note = unsupportedStackBuilderNote('Django', 'vite-react');
    expect(note).toMatch(/ALREADY TOLD/i);
    expect(note).toMatch(/do NOT spend a turn explaining/i);
  });

  it('still forbids writing the unsupported stack — nothing was traded away', () => {
    const note = unsupportedStackBuilderNote('native Android (Kotlin)', 'vite-react');
    expect(note).toMatch(/Never write native Android \(Kotlin\) files/);
    expect(note).toMatch(/Gradle/);
  });
});

describe('📦 a package the plan is keeping is not something to remove', () => {
  const dep = 'react-router-dom';

  it('reports the report\'s own case as kept for a later step', () => {
    const line = unusedDependencyLine(dep, { unfinished: false, addedThisBuild: true, moreStepsPlanned: true });
    expect(line.severity).toBe('info');
    expect(line.autoResolved).toBe(true);
    expect(line.message).toMatch(/later step of this app's plan/);
    expect(line.message).not.toMatch(/shrinks the install/);
  });

  it('still warns about a package the USER already had, even on a milestone turn', () => {
    // The plan says nothing about a dependency the plan did not add.
    const line = unusedDependencyLine('lodash', { unfinished: false, addedThisBuild: false, moreStepsPlanned: true });
    expect(line.severity).toBe('warning');
    expect(line.message).toMatch(/shrinks the install/);
  });

  it('keeps every verdict it had before', () => {
    expect(unusedDependencyLine(dep, { unfinished: true, addedThisBuild: true }).severity).toBe('info');
    expect(unusedDependencyLine(dep, { unfinished: false, addedThisBuild: true }).severity).toBe('warning');
    expect(unusedDependencyLine(dep, { unfinished: true, addedThisBuild: false }).severity).toBe('warning');
  });

  it('is wired to the two facts the prune itself reads — a source guard', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    const callSite = src.match(/unusedDependencyLine\(u\.name, \{[\s\S]{0,400}?\}\)/)?.[0] ?? '';
    expect(callSite).toContain('moreStepsPlanned');
    expect(callSite).toMatch(/megaRoadmapActive/);
    expect(callSite).toMatch(/projectModuleRef/);
  });
});

describe('🔤 a word in an ALL-CAPS heading is not an unknown service', () => {
  /** The report's own opening, headings and all. */
  const REPORT_HEAD = [
    'BUILD PRIMECLASH ESPORTS — COMPLETE ANDROID APPLICATION',
    '',
    'Act as a senior Android engineer, Kotlin developer, Firebase architect, UI/UX designer and application security engineer.',
    '',
    'Build a complete, functional Android esports tournament application named PrimeClash Esports.',
    '',
    '1. PROJECT CONFIGURATION',
    '',
    'Application name: PrimeClash Esports',
    '',
    'Programming language: Kotlin',
  ].join('\n');

  it('says nothing about the report\'s own request', () => {
    // Measured before the fix: ["PRIMECLASH","COMPLETE","ANDROID"].
    expect(unknownNamesInRequest(REPORT_HEAD)).toEqual([]);
  });

  it('still catches the case the feature was built for', () => {
    expect(unknownNamesInRequest('Build a COACT collector app for field staff')).toEqual(['COACT']);
    expect(unknownNamesInRequest('Make a dashboard that reads from ZYQWEX every morning')).toEqual(['ZYQWEX']);
  });

  it('judges each line on its own, not the document', () => {
    // A heading does not silence the body; a body word does not rescue a heading word.
    const mixed = 'SECTION ONE: DATA SOURCES\n\nPull the rows from WYVERNA each night.';
    expect(unknownNamesInRequest(mixed)).toEqual(['WYVERNA']);
  });

  it('keeps every stand-down it had', () => {
    expect(unknownNamesInRequest('BANAO EK BILLING APP JALDI')).toEqual([]);
    expect(unknownNamesInRequest('connect it to the ACMEX api')).toEqual([]);
    expect(unknownNamesInRequest('a music player that supports MP3, WAV, FLAC and OGG')).toEqual([]);
    expect(unknownNamesInRequest('')).toEqual([]);
  });
});
