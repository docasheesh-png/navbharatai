import { describe, it, expect } from 'vitest';
import {
  findMissingDotenvWiring,
  injectDotenvLoad,
  dotenvEntryFile,
  loadsEnvAlready,
  envFileKeys,
  dotenvWiringMessage,
} from './envLoading';

/**
 * THE REPORT (admin 2026-08-22). An Express build whose preview answered every request with
 * `{"message":"secret option required for sessions"}` — `.env` held `SESSION_SECRET`, the code read
 * `process.env.SESSION_SECRET`, and nothing loaded the file.
 *
 * The build healed itself, which under the 50/50 law is the red flag rather than the win: the question
 * is why the app was generated that way at all. These tests are the prevention half.
 *
 * Every "does nothing" case below matters more than the fix case. Injecting an import into somebody's
 * working app is the only way this module can do harm, so the bar is: fire when certain, and stay
 * silent everywhere else.
 */

const PKG = (extra: Record<string, unknown> = {}) => JSON.stringify({ name: 'app', dependencies: { express: '^4' }, ...extra }, null, 2);

describe('the exact app from the report', () => {
  const files = {
    'package.json': PKG({ scripts: { start: 'tsx src/index.ts' } }),
    '.env': 'SESSION_SECRET=abc123\nDATABASE_URL=postgres://x\n',
    'src/index.ts': "import express from 'express';\nimport session from 'express-session';\nconst app = express();\napp.use(session({ secret: process.env.SESSION_SECRET }));\n",
  };

  it('is caught, with the keys named', () => {
    const w = findMissingDotenvWiring(files);
    expect(w).not.toBeNull();
    expect(w!.entry).toBe('src/index.ts');
    expect(w!.keys).toContain('SESSION_SECRET');
    expect(w!.moduleKind).toBe('esm');
  });

  it('is fixed by ONE line, and that line is FIRST', () => {
    const { files: out, wired } = injectDotenvLoad(files);
    expect(wired).not.toBeNull();
    // First, not merely present: a module that reads process.env while being imported runs before any
    // statement below its import, so a load placed after the other imports silently does not work.
    expect(out['src/index.ts'].split('\n')[0]).toBe("import 'dotenv/config';");
    expect(out['src/index.ts']).toContain("import express from 'express'");
  });

  it('says what happened in the user’s own terms', () => {
    const w = findMissingDotenvWiring(files)!;
    const msg = dotenvWiringMessage(w);
    expect(msg).toContain('SESSION_SECRET');
    expect(msg).toContain('src/index.ts');
    expect(msg).not.toMatch(/dotenv|npm|package\.json/i); // no jargon the user did not ask for
  });
});

describe('it stays silent whenever it is not certain — the half that protects working apps', () => {
  it('a project that already loads its env is left alone, in every form', () => {
    const base = { '.env': 'API_KEY=x\n', 'src/index.ts': 'const k = process.env.API_KEY;\n' };
    const variants: Array<Record<string, string>> = [
      { ...base, 'package.json': PKG(), 'src/config.ts': "import 'dotenv/config';\n" },
      { ...base, 'package.json': PKG(), 'src/config.ts': "require('dotenv').config();\n" },
      { ...base, 'package.json': PKG(), 'src/config.ts': "import dotenv from 'dotenv';\ndotenv.config();\n" },
      { ...base, 'package.json': PKG({ scripts: { start: 'node -r dotenv/config index.js' } }) },
      { ...base, 'package.json': PKG({ scripts: { start: 'node --env-file=.env index.js' } }) },
    ];
    for (const files of variants) expect(findMissingDotenvWiring(files)).toBeNull();
  });

  it('a framework that reads .env ITSELF is never touched', () => {
    // Vite only exposes VITE_*, Next has its own file precedence — adding dotenv can change which
    // value wins, so being redundant here is not the risk; being WRONG is.
    for (const dep of ['vite', 'next', 'nuxt', 'astro', '@sveltejs/kit', 'react-scripts']) {
      const files = {
        'package.json': JSON.stringify({ dependencies: { [dep]: '^1' } }),
        '.env': 'API_KEY=x\n',
        'src/index.ts': 'const k = process.env.API_KEY;\n',
      };
      expect(findMissingDotenvWiring(files)).toBeNull();
    }
  });

  it('a key the RUNTIME supplies is not evidence of a bug', () => {
    // An app reading process.env.PORT with a .env that also sets it runs fine either way.
    const files = {
      'package.json': PKG(),
      '.env': 'PORT=3000\nNODE_ENV=development\n',
      'src/index.ts': 'app.listen(process.env.PORT || 3000);\n',
    };
    expect(findMissingDotenvWiring(files)).toBeNull();
  });

  it('a .env the code never READS is not a bug either', () => {
    const files = { 'package.json': PKG(), '.env': 'UNUSED=1\n', 'src/index.ts': 'console.log("hi");\n' };
    expect(findMissingDotenvWiring(files)).toBeNull();
  });

  it('an EXAMPLE env file defines nothing — its keys are placeholders', () => {
    const files = { 'package.json': PKG(), '.env.example': 'API_KEY=your-key-here\n', 'src/index.ts': 'const k = process.env.API_KEY;\n' };
    expect(findMissingDotenvWiring(files)).toBeNull();
  });

  it('an unreadable or absent package.json means we do not know the project — so we do nothing', () => {
    const src = { '.env': 'API_KEY=x\n', 'src/index.ts': 'const k = process.env.API_KEY;\n' };
    expect(findMissingDotenvWiring(src)).toBeNull();
    expect(findMissingDotenvWiring({ ...src, 'package.json': '{ not json' })).toBeNull();
  });

  it('no identifiable entry file means no guess', () => {
    const files = { 'package.json': PKG(), '.env': 'API_KEY=x\n', 'lib/util.ts': 'const k = process.env.API_KEY;\n' };
    expect(findMissingDotenvWiring(files)).toBeNull();
  });

  it('running it twice changes nothing the second time', () => {
    const files = {
      'package.json': PKG({ scripts: { start: 'node src/index.js' } }),
      '.env': 'API_KEY=x\n',
      'src/index.js': "const express = require('express');\nconst k = process.env.API_KEY;\n",
    };
    const once = injectDotenvLoad(files);
    expect(once.wired).not.toBeNull();
    const twice = injectDotenvLoad(once.files);
    expect(twice.wired).toBeNull();
    expect(twice.files['src/index.js']).toBe(once.files['src/index.js']);
  });
});

describe('it writes the right line for the right module system', () => {
  it('CommonJS gets require(), not an import that would throw', () => {
    const files = {
      'package.json': PKG({ main: 'server.js' }),
      '.env': 'API_KEY=x\n',
      'server.js': "const express = require('express');\nconst k = process.env.API_KEY;\n",
    };
    const { files: out, wired } = injectDotenvLoad(files);
    expect(wired!.moduleKind).toBe('cjs');
    expect(out['server.js'].split('\n')[0]).toBe("require('dotenv').config();");
  });

  it('"type": "module" wins over what the file looks like', () => {
    const files = {
      'package.json': PKG({ type: 'module', main: 'server.js' }),
      '.env': 'API_KEY=x\n',
      'server.js': 'const k = process.env.API_KEY;\n',
    };
    expect(findMissingDotenvWiring(files)!.moduleKind).toBe('esm');
  });

  it('a shebang stays on line 1 — moving it would break an executable script', () => {
    const files = {
      'package.json': PKG({ main: 'cli.js' }),
      '.env': 'API_KEY=x\n',
      'cli.js': "#!/usr/bin/env node\nconst express = require('express');\nconst k = process.env.API_KEY;\n",
    };
    const out = injectDotenvLoad(files).files['cli.js'].split('\n');
    expect(out[0]).toBe('#!/usr/bin/env node');
    expect(out[1]).toBe("require('dotenv').config();");
  });
});

describe('entry resolution follows the project, not a convention', () => {
  it('the start script the project itself runs wins', () => {
    const files = {
      'package.json': PKG({ scripts: { start: 'tsx watch server/boot.ts' }, main: 'index.js' }),
      'server/boot.ts': '', 'index.js': '', 'src/index.ts': '',
    };
    expect(dotenvEntryFile(files)).toBe('server/boot.ts');
  });

  it('then `main`, then convention', () => {
    expect(dotenvEntryFile({ 'package.json': PKG({ main: './app.js' }), 'app.js': '', 'src/index.ts': '' })).toBe('app.js');
    expect(dotenvEntryFile({ 'package.json': PKG(), 'src/index.ts': '' })).toBe('src/index.ts');
    expect(dotenvEntryFile({ 'package.json': PKG() })).toBeNull();
  });
});

describe('the small pure pieces', () => {
  it('reads keys and skips comments, blanks and export prefixes', () => {
    expect(envFileKeys('# c\n\nA=1\nexport B=2\nnot a line\nC = 3\n')).toEqual(['A', 'B', 'C']);
  });

  it('loadsEnvAlready sees a load in ANY file, not just the entry', () => {
    expect(loadsEnvAlready({ 'src/db.ts': "import 'dotenv/config';\n" })).toBe(true);
    expect(loadsEnvAlready({ 'src/db.ts': 'const x = 1;\n' })).toBe(false);
  });
});

// ── The wiring, not just the logic ──────────────────────────────────────────
import { readFileSync } from 'fs';
import { join } from 'path';

describe('it is actually connected to a build', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('runs on the build path, beside the other deterministic fixes', () => {
    expect(route).toContain('injectDotenvLoad(integrityFiles)');
    expect(route).toContain('ENV_LOADING_WIRED');
  });

  it('the fix reaches BOTH the durable store and the sandbox — a store-only fix would not run', () => {
    const at = route.indexOf('injectDotenvLoad(integrityFiles)');
    const block = route.slice(at, at + 900);
    expect(block).toContain('writtenFiles.set(');
    expect(block).toContain('actuator.writeFile(');
  });

  it('has a kill switch, like every other guard in that block', () => {
    expect(route).toContain("process.env.AGENTV3_DOTENV_GUARD !== 'off'");
  });
});
