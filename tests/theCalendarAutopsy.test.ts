// AUTOPSY 120eb52f / b4901ce5 / 0edea014 (2026-09-30): "Calendar wala app bnao", then "Continue …", then
// "Install button do" — three builds, all stopped by the user. Each item below was a fault of ours.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contractModule } from '../src/server/AgentV3/SimpleBuilder';
import { danglingStylesheetImports, withoutStylesheetImports, missingImportedSheetNote } from '../src/server/AgentV3/CssConsistency';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { freeCancellationMessage } from '../src/server/AgentV3/cancelledBuildBilling';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

// The contract, verbatim from the report.
const CONTRACT = `export const EventStatus = {
  UPCOMING: 'UPCOMING',
  ONGOING: 'ONGOING',
  COMPLETED: 'COMPLETED',
} as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];

export interface Event {
  id: string;
  title: string;
  startDate: Date;
  status: EventStatus;
}`;

describe('1 · an enum written as data keeps its data', () => {
  it('🔴 the `as const` object reaches the types file beside its type', () => {
    const m = contractModule(CONTRACT)!;
    expect(m.source).toMatch(/export const EventStatus = \{[\s\S]*\} as const;/);
    expect(m.source).toContain('export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];');
    expect(m.symbols.filter((s) => s === 'EventStatus')).toHaveLength(1);
  });
  it('🔒 a constant that CALLS something stays out — the types file depends on nothing it does not hold', () => {
    const m = contractModule(`${CONTRACT}\nexport const handlers = { a: makeThing() } as const;`)!;
    expect(m.source).not.toContain('handlers');
  });
  const tsc = join(__dirname, '..', 'node_modules', '.bin', 'tsc');
  it.skipIf(!existsSync(tsc))('🔴 and the file it writes really compiles, used the way the app uses it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nbai-contract-'));
    writeFileSync(join(dir, 'types.ts'), contractModule(CONTRACT)!.source);
    writeFileSync(join(dir, 'use.ts'), "import { EventStatus, type Event } from './types';\nexport const e: Event = { id: '1', title: 't', startDate: new Date(), status: EventStatus.UPCOMING };\n");
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, isolatedModules: true, verbatimModuleSyntax: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2020', types: [], noEmit: true }, files: ['types.ts', 'use.ts'] }));
    expect(() => execFileSync(tsc, ['-p', dir], { encoding: 'utf8' })).not.toThrow();
  }, 60_000);
});

class MemActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

const HEADER = `import React from 'react';\nimport './Header.css';\n\nexport function Header() {\n  return <header className="calendar-header"><h1 className="header-title">May</h1></header>;\n}\n`;

describe('2 · a screen that imports a stylesheet nobody wrote', () => {
  it('🔴 the note names THAT file as the place for the rules — not src/index.css', async () => {
    const act = new MemActuator();
    act.files.set('src/main.tsx', "import './index.css';\nimport App from './App';\n");
    act.files.set('src/index.css', ':root { --accent: #4f46e5; }\n');
    const d = new ToolDispatcher(act, 'ws-1');
    const r = await d.dispatch({ id: 'w', name: 'write_file', input: { path: 'src/components/Header.tsx', content: HEADER } });
    expect(r.content).toMatch(/imports '\.\/Header\.css', but src\/components\/Header\.css does not exist/);
    expect(r.content).toContain('Write src/components/Header.css now');
    expect(r.content).not.toMatch(/Add the rules to src\/index\.css/);
  });
  it('the pure note', () => {
    expect(missingImportedSheetNote('src/A.tsx', 'src/A.css', ['x'])).toMatch(/the app will NOT build until it does/);
  });
  it('🔴 at the end of the build, an import of a missing sheet is found and removed — and only that', () => {
    const files = {
      'src/components/Header.tsx': HEADER,
      'src/pages/CalendarPage.tsx': "import './CalendarPage.css';\nimport s from './cal.module.css';\nexport const x = s;\n",
      'src/pages/CalendarPage.css': '.a{}',
    };
    const d = danglingStylesheetImports(files);
    expect(d).toEqual([{ file: 'src/components/Header.tsx', specifier: './Header.css', sheet: 'src/components/Header.css' }]);
    const fixed = withoutStylesheetImports(HEADER, ['./Header.css']);
    expect(fixed).not.toContain("'./Header.css'");
    expect(fixed).toContain("import React from 'react';");
    expect(fixed).toContain('export function Header()');
  });
  it('🔒 the route removes it only after the sandbox confirms the file is absent, and says so', () => {
    const route = read('src/server/routes/agentv3.ts');
    const block = route.slice(route.indexOf('A STYLESHEET IMPORT OF A FILE THAT DOES NOT EXIST'), route.indexOf('ENTRY-FILE DUPLICATE-IMPORT SWEEP'));
    expect(block).toContain('danglingStylesheetImports(full)');
    expect(block).toMatch(/actuator\.readFile\(workspaceId, d\.sheet\)\.then\(\(\) => true, \(\) => false\)/);
    expect(block).toContain("code: 'DANGLING_STYLESHEET_IMPORT_REMOVED'");
    expect(read('src/server/AgentV3/BuildDiagnostics.ts')).toContain("'DANGLING_STYLESHEET_IMPORT_REMOVED'");
  });
});

describe('3 · a stopped edit is free — and the user is told the truth about it', () => {
  it('🔴 not "before anything was produced … exactly as it was" when six files changed', () => {
    const m = freeCancellationMessage('unverified-edit');
    expect(m).not.toMatch(/before anything was produced|exactly as it was/);
    expect(m).toMatch(/FREE/);
    expect(m).toMatch(/changed so far is saved/);
    expect(freeCancellationMessage('nothing')).toMatch(/before anything was produced/);
  });
  it('the route asks it by what the user is holding', () => {
    expect(read('src/server/routes/agentv3.ts')).toContain('? freeCancellationMessage(cancelBill.delivery)');
  });
});

describe('4 · a build no model touched does not name a model', () => {
  it('🔴 the report names the ladder\'s first rung, not the Claude backstop', () => {
    const d = new BuildDiagnostics({ model: 'claude-haiku-4-5-20251001' });
    d.setProviderChain('GLM(glm-4.7-flashx) → KIMI(kimi-k2.7-code) → CLAUDE_HAIKU', ['GLM', 'KIMI', 'CLAUDE_HAIKU'], 'GLM(glm-4.7-flashx)');
    expect(d.report().model).toBe('GLM(glm-4.7-flashx)');
  });
  it('🔴 the signed manifest says no call was made', () => {
    expect(read('src/server/routes/agentv3.ts')).toContain("providerLedger.entries().length === 0 ? 'none (no model call was made)'");
  });
});
