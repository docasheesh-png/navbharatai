/**
 * BR1982 (a weather-app request, succeeded, charged a small free-tier amount) —
 * retained evidence, not a replay.
 *
 * Setup hit the E2B concurrent-sandbox cap of 20; the sandbox later served the
 * build (SANDBOX_RECOVERED). The text-only fast lane still ran. One generated
 * TypeScript file was correctly refused by the write-time syntax gate
 * ("Unexpected <<"). The same pass's tsconfig.json is treated as JSONC, so that
 * gate skipped it, and leftover apply-patch SEARCH/REPLACE markup landed after
 * a valid JSONC object. Fast-lane verify had already failed TS6053 on a
 * dangling tsconfig.node.json reference (the earlier, still-clean file). The
 * full builder then hit TS17004 because the model-written tsconfig had a DOM
 * lib but no jsx flag. The app eventually typechecked, rendered, and a user
 * journey passed; release gate YELLOW for remaining dependency advisories that
 * need a major upgrade. The build ran well over its ETA band.
 *
 * Already closed on main, locked here against this report's shape:
 *   • BR1961 F2 (#4146) — sandboxUnavailableNotice does not invite a second Start.
 *   • BR1952 (#4124) — a text-only fast lane is not started when setup failed.
 *   • BR1979 (#4241) — sanitizeTsconfigReferences drops a dangling
 *     tsconfig.node.json reference before the fast lane's tsc gate.
 *   • The write-time syntax gate still refuses a TypeScript file whose first
 *     parse error is leftover apply-patch markup.
 *
 * Shipped in this PR:
 *   • A write-time conflict-marker guard (all text files, including tsconfig
 *     JSONC) refuses leftover apply-patch / merge markers on a clean file.
 *   • A parseable tsconfig whose only fault is a trailing marker block is
 *     salvaged (prefix kept) and, when it is a DOM/app tsconfig missing jsx,
 *     gains "jsx": "react-jsx".
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { sandboxUnavailableNotice } from '../src/server/routes/agentv3';
import { sanitizeTsconfigReferences } from '../src/server/AgentV3/FrameworkFoundation';
import {
  ensureTsconfigBaseUrl,
  ensureTsconfigJsx,
  healTsconfigConflictTail,
} from '../src/server/AgentV3/TsconfigGuard';
import {
  conflictMarkerRefusal,
  firstConflictMarkerLine,
  stripTrailingConflictMarkup,
  writeConflictGuardEnabled,
} from '../src/server/AgentV3/conflictMarkerGuard';
import { firstSyntaxError, writeParseGuardEnabled } from '../src/server/AgentV3/SyntaxCheck';
import { tsconfig as officialStarterTsconfig, tsconfigNode } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProviderContents';

const OPEN = '<'.repeat(7);
const CLOSE = '>'.repeat(7);

const ROUTE = readFileSync('src/server/routes/agentv3.ts', 'utf8');
const SIMPLE = readFileSync('src/server/AgentV3/SimpleBuilder.ts', 'utf8');
const DISPATCH = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');

/** Clean JSONC prefix of this report's model-written tsconfig (comments, no jsx, no references). */
const BR1982_TSCONFIG_PREFIX = `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
`;

const BR1982_TSCONFIG_TAIL = `${OPEN} SEARCH
  "references": [{ "path": "./tsconfig.node.json" }]
}
=======
}
${CLOSE} REPLACE>>>
`;

const BR1982_TSCONFIG = BR1982_TSCONFIG_PREFIX + BR1982_TSCONFIG_TAIL;

describe('BR1982 — a busy sandbox is not a goodbye, and the fast lane is not started', () => {
  it("the notice says we are still trying and does not invite this report's old retry", () => {
    const n = sandboxUnavailableNotice();
    expect(n).toMatch(/temporarily unavailable/i);
    expect(n).toMatch(/still trying|as soon as I can/i);
    expect(n).not.toMatch(/I can't create files right now/i);
    expect(n).not.toMatch(/please try building again in a little while/i);
    expect(n).not.toMatch(/try building again|try again later|please retry/i);
  });

  it('FAST_LANE_SKIPPED_SANDBOX still gates the text-only lane on sandboxUnavailable', () => {
    expect(ROUTE).toMatch(/const fastLaneWouldRun = !sandboxUnavailable &&/);
    expect(ROUTE).toContain("code: 'FAST_LANE_SKIPPED_SANDBOX'");
    expect(ROUTE).toContain('text-only fast lanes cannot run against an unavailable workspace');
  });
});

describe('BR1982 — the write-time syntax gate still refuses leftover markup in TypeScript', () => {
  it("this report's weather types file (Unexpected <<) is still a syntax error", async () => {
    const src = [
      'export interface Weather {',
      '  city: string;',
      '}',
      `${OPEN} SEARCH`,
      'export type Weather = {};',
      CLOSE,
    ].join('\n');
    const err = await firstSyntaxError('src/types/weather.ts', src);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/<</);
    expect(err!.line).toBe(4);
  });
});

describe('BR1982 — leftover apply-patch markup is refused on a clean file, including tsconfig JSONC', () => {
  it('the guard is default-ON (kill switch AGENTV3_WRITE_CONFLICT_GUARD=off)', () => {
    expect(writeConflictGuardEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(writeConflictGuardEnabled({ AGENTV3_WRITE_CONFLICT_GUARD: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(writeParseGuardEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it("this report's tsconfig (JSONC prefix + SEARCH/REPLACE tail) is refused on a new write", () => {
    const line = firstConflictMarkerLine(BR1982_TSCONFIG);
    expect(line).toBe(24);
    const msg = conflictMarkerRefusal('tsconfig.json', BR1982_TSCONFIG, '');
    expect(msg).toMatch(/WRITE REJECTED/);
    expect(msg).toMatch(/tsconfig\.json/);
    expect(msg).toMatch(/line 24/);
    expect(msg).not.toMatch(/not overwriting it/i);
  });

  it('neighbour: a clean tsconfig and a file that only mentions markers in a string are allowed', () => {
    expect(conflictMarkerRefusal('tsconfig.json', BR1982_TSCONFIG_PREFIX, '')).toBeNull();
    const mentioned = 'const open = "' + OPEN + '";\nexport const n = 1;\n';
    // The marker text sits inside a string, not at the start of the line.
    expect(firstConflictMarkerLine(mentioned)).toBeNull();
    expect(conflictMarkerRefusal('src/help.ts', mentioned, '')).toBeNull();
  });

  it('neighbour: a Markdown heading underline (seven equals) is not a marker', () => {
    const md = 'Title\n=======\n\nSome text.\n';
    expect(firstConflictMarkerLine(md)).toBeNull();
    expect(conflictMarkerRefusal('README.md', md, '')).toBeNull();
  });

  it('neighbour: an already-marked file may be overwritten (repair-in-progress is not trapped)', () => {
    const repaired = BR1982_TSCONFIG_PREFIX;
    expect(conflictMarkerRefusal('tsconfig.json', repaired, BR1982_TSCONFIG)).toBeNull();
    // Still-marked repair attempts are also allowed, so the model is not boxed in.
    expect(conflictMarkerRefusal('tsconfig.json', BR1982_TSCONFIG, BR1982_TSCONFIG)).toBeNull();
  });

  it('neighbour: the kill switch allows a marked write', () => {
    expect(conflictMarkerRefusal('tsconfig.json', BR1982_TSCONFIG, '', false)).toBeNull();
  });
});

describe('BR1982 — a parseable tsconfig with a trailing marker block is salvaged, then given jsx', () => {
  it("sanitizeTsconfigReferences strips this report's tail even though the prefix has no references", () => {
    const res = sanitizeTsconfigReferences({ 'tsconfig.json': BR1982_TSCONFIG, 'package.json': '{}' });
    expect(res.stripped).toEqual(['tsconfig.json']);
    expect(res.fixes).toEqual([]);
    expect(res.patch['tsconfig.json']).toBe(BR1982_TSCONFIG_PREFIX);
  });

  it('neighbour: a dangling reference in the prefix is still removed after the tail is dropped (BR1979 class)', () => {
    const withRef = JSON.stringify({
      compilerOptions: { jsx: 'react-jsx', lib: ['DOM'] },
      include: ['src'],
      references: [{ path: './tsconfig.node.json' }],
    }, null, 2) + '\n' + BR1982_TSCONFIG_TAIL;
    const res = sanitizeTsconfigReferences({ 'tsconfig.json': withRef, 'package.json': '{}' });
    expect(res.stripped).toEqual(['tsconfig.json']);
    expect(res.fixes).toEqual([{ file: 'tsconfig.json', removed: ['./tsconfig.node.json'] }]);
    const out = JSON.parse(res.patch['tsconfig.json']);
    expect(out.references).toBeUndefined();
    expect(out.include).toEqual(['src']);
  });

  it('neighbour: the official starter (no references, no markup, has jsx) is left alone', () => {
    const official = JSON.parse(officialStarterTsconfig);
    expect(official.compilerOptions.jsx).toBe('react-jsx');
    expect(official.references).toBeUndefined();
    const res = sanitizeTsconfigReferences({
      'tsconfig.json': officialStarterTsconfig,
      'tsconfig.node.json': tsconfigNode,
    });
    expect(res.fixes).toHaveLength(0);
    expect(res.stripped ?? []).toHaveLength(0);
    expect(res.patch).toEqual({});
    expect(ensureTsconfigJsx('tsconfig.json', officialStarterTsconfig)).toBe(officialStarterTsconfig);
  });

  it("the write-door compose turns this report's file into a clean tsconfig with jsx and no markers", () => {
    const out = ensureTsconfigBaseUrl(
      'tsconfig.json',
      ensureTsconfigJsx('tsconfig.json', healTsconfigConflictTail('tsconfig.json', BR1982_TSCONFIG)),
    );
    const json = JSON.parse(out);
    expect(json.compilerOptions.jsx).toBe('react-jsx');
    expect(json.compilerOptions.moduleResolution).toBe('bundler');
    expect(json.references).toBeUndefined();
    expect(firstConflictMarkerLine(out)).toBeNull();
  });

  it('stripTrailingConflictMarkup is a no-op when there is nothing to salvage (marker on line 1, or none)', () => {
    expect(stripTrailingConflictMarkup(BR1982_TSCONFIG_PREFIX).stripped).toBe(false);
    const only = `${OPEN} SEARCH\nfoo\n`;
    expect(stripTrailingConflictMarkup(only).stripped).toBe(false);
  });
});

describe('BR1982 — hook census (a new write door cannot silently skip these heals)', () => {
  it('guardedWrite still runs guardConfigContent then parseGuardRejection', () => {
    expect(DISPATCH).toContain('healTsconfigConflictTail(path, ensureViteResolveAlias(path, ensureViteAllowedHosts(path, content)))');
    expect(DISPATCH).toContain('ensureTsconfigJsx(path, healTsconfigConflictTail(');
    expect(DISPATCH).toContain('ensureTsconfigBaseUrl(path, ensureTsconfigJsx(');
    expect(DISPATCH).toContain('conflictMarkerRefusal(path, newContent, oldContent, true)');
    expect(DISPATCH).toContain('writeConflictGuardEnabled()');
    // Both write doors share parseGuardRejection (write_file via guardedWrite, edit_file directly).
    const parseCalls = DISPATCH.split('parseGuardRejection(').length - 1;
    expect(parseCalls).toBeGreaterThanOrEqual(3); // definition + guardedWrite + edit_file
  });

  it('the tsconfig sanitizer still runs behind the same kill switch, and now applies a markup-only patch', () => {
    expect(SIMPLE).toContain('sanitizeTsconfigReferences(before, deps.scaffoldPaths ?? [])');
    expect(SIMPLE).toContain("AGENTV3_TSCONFIG_SANITIZE !== 'off'");
    expect(SIMPLE).toContain('(refs.stripped?.length ?? 0) > 0');
    expect(ROUTE).toContain('sanitizeTsconfigReferences(Object.fromEntries(writtenFiles), scaffold)');
    expect(ROUTE).toContain("code: 'TSCONFIG_REFERENCES_REPAIRED'");
    expect(ROUTE).toContain("code: 'TSCONFIG_MARKUP_REPAIRED'");
    expect(ROUTE).toContain('sanitizeTsconfigReferences(saved, Object.keys(saved))');
    const routeHeals = ROUTE.split('sanitizeTsconfigReferences(').length - 1;
    expect(routeHeals).toBe(3);
    const routeGuards = ROUTE.split("AGENTV3_TSCONFIG_SANITIZE !== 'off'").length - 1;
    expect(routeGuards).toBeGreaterThanOrEqual(3);
  });
});
