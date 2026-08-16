import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { editModePrefix, summarizeFileTree, architectSystemPrompt, planSystemPrompt, dateContextBlock, LANGUAGE_RULE } from './systemPrompt';

describe('LANGUAGE_RULE (mirror the user, never default to Hindi)', () => {
  it('is blunt about mirroring the user and not defaulting to Hindi', () => {
    expect(LANGUAGE_RULE).toContain('MIRROR THE USER');
    expect(LANGUAGE_RULE.toLowerCase()).toContain('do not default to hindi');
    expect(LANGUAGE_RULE).toContain('English in');
  });
  it('is carried by BOTH the architect build prompt and the plan prompt', () => {
    expect(architectSystemPrompt()).toContain('MIRROR THE USER');
    expect(planSystemPrompt()).toContain('MIRROR THE USER');
  });
});

describe('hand-written seed script guidance (deep-test App #8 — Prisma seed P2002/P2003)', () => {
  it('tells the architect to make an executable seed script idempotent AND foreign-key-ordered', () => {
    const p = architectSystemPrompt();
    expect(p).toContain('idempotent');
    expect(p).toContain('upsert');
    expect(p).toContain('deleteMany');
    // the two exact Prisma errors a bad seed throws, so the guidance is unmistakable
    expect(p).toContain('P2002');
    expect(p).toContain('P2003');
  });
});

describe('Prisma relation guidance (deep-test App #10 — 7 wasted `prisma generate` attempts)', () => {
  it('tells the architect to name two-relations-to-the-same-model and add both-side back-refs', () => {
    const p = architectSystemPrompt();
    expect(p).toContain('Ambiguous relation');
    expect(p).toContain('@relation');
    expect(p).toContain('opposite relation field');
  });
  it('warns that SQLite does not support Prisma enums (the seed-import crash)', () => {
    const p = architectSystemPrompt();
    expect(p).toContain('SQLite does NOT support Prisma');
    expect(p.toLowerCase()).toContain('enum');
  });
});

describe('ErrorBoundary prevention (autopsy 2026-07-21, and the 2026-08-12 root fix — do not rewrite it)', () => {
  it('tells the model the boundary is PROVIDED and must NOT be rewritten — the real prevention', () => {
    // The old guidance taught the model HOW to write the boundary (constructor, useDefineForClassFields)
    // — which still primed it to author one, and it kept breaking it (three reports). The stronger fix,
    // confirmed by the prevention audit, is: the scaffold already ships a correct one; do not touch it.
    const p = architectSystemPrompt();
    expect(p).toContain('ERROR BOUNDARY');
    expect(p).toContain('ALREADY PROVIDED');
    expect(p).toContain('DO NOT OPEN OR REWRITE IT');
    expect(p).toContain('functional component'); // names the exact wrong move the model keeps making
    // it must steer AWAY from the thrash: reuse the existing boundary rather than authoring a new one
    // (the prompt no longer teaches HOW to write one — that priming was the problem).
    expect(p).toContain('reuse the existing ErrorBoundary');
    expect(p).not.toContain('write the CANONICAL class ONCE');
  });
});

describe('Node-only backend libs in frontend guidance (deep-test App #12 — jsonwebtoken in the browser)', () => {
  it('forbids jsonwebtoken/bcrypt/etc. in browser code and keeps JWT sign/verify server-side', () => {
    const p = architectSystemPrompt();
    expect(p).toContain('jsonwebtoken');
    expect(p).toContain('bcrypt');
    // the correct client behaviour: store token + Authorization header, never verify in the browser
    expect(p).toContain('Authorization: Bearer');
    expect(p).toContain('SERVER-only');
  });
});

describe('Design-kit guidance (M2-S2.1 — reuse the scaffold component kit for a premium look)', () => {
  it('points the architect at the ready-made kit classes and palette vars', () => {
    const p = architectSystemPrompt();
    expect(p).toMatch(/DESIGN KIT/i);
    expect(p).toContain('.card');
    expect(p).toContain('.badge');
    expect(p).toContain('.container');
  });
});

describe('React Rules-of-Hooks guidance (M1-S1.3 — prevent the #1 runtime crash upstream)', () => {
  it('tells the architect to call hooks unconditionally at the top level, not after an early return', () => {
    const p = architectSystemPrompt();
    expect(p).toContain('RULES OF HOOKS');
    expect(p).toMatch(/top level/i);
    expect(p).toMatch(/early return/i);
    expect(p).toMatch(/useMemo|useEffect|useState/);
  });
});

describe('summarizeFileTree (edit at scale — bound the injected tree)', () => {
  it('lists every path in full for a SMALL project (unchanged behaviour)', () => {
    const out = summarizeFileTree(['src/App.tsx', 'package.json', 'src/lib/util.ts']);
    expect(out).toBe('src/App.tsx\npackage.json\nsrc/lib/util.ts');
  });

  it('SUMMARIZES a large project by directory instead of dumping every path', () => {
    // 1,000 files across many dirs — the full list would be ~40KB+ in EVERY turn's prompt.
    const paths: string[] = ['package.json', 'tsconfig.json'];
    for (let d = 0; d < 30; d++) for (let f = 0; f < 40; f++) paths.push(`client/src/pages/dir${d}/file${f}.tsx`);
    const out = summarizeFileTree(paths);
    // It must NOT contain every individual deep file…
    expect(out).not.toContain('file39.tsx');
    // …but MUST convey scale, structure, and how to navigate.
    expect(out).toContain(`${paths.length} files`);
    expect(out).toContain('directories');
    expect(out).toContain('search_files');
    // Root files are surfaced (they are few + important: config/entry).
    expect(out).toContain('package.json');
    expect(out).toContain('tsconfig.json');
    // A representative directory with its count appears.
    expect(out).toMatch(/client\/src\/pages\/dir\d+\/ — 40/);
    // The whole summary stays far smaller than the raw list would be.
    expect(out.length).toBeLessThan(paths.join('\n').length / 2);
  });

  it('caps the number of directory lines and says how many were elided', () => {
    const paths: string[] = [];
    for (let d = 0; d < 600; d++) paths.push(`pkg/mod${d}/index.ts`); // > fullListMax(500) → summary mode
    const out = summarizeFileTree(paths, { maxDirLines: 50 });
    expect(out).toContain('and 550 more director');
  });

  it('full-list threshold is 500 (admin 2026-07-06): 500 files → full list, 501 → summary', () => {
    const at = Array.from({ length: 500 }, (_, i) => `pkg/dir${i}/index.ts`);
    const atOut = summarizeFileTree(at);
    expect(atOut).not.toContain('LARGE project');   // exactly at the cap → still the full flat list
    expect(atOut).toContain('pkg/dir499/index.ts');
    const over = Array.from({ length: 501 }, (_, i) => `pkg/dir${i}/index.ts`);
    const overOut = summarizeFileTree(over);
    expect(overOut).toContain('LARGE project');      // one over → bounded directory summary
  });

  it('respects a custom fullListMax and handles empty input', () => {
    expect(summarizeFileTree([])).toBe('');
    // With fullListMax=2, three files trigger the summary path.
    const out = summarizeFileTree(['a/x.ts', 'a/y.ts', 'b/z.ts'], { fullListMax: 2 });
    expect(out).toContain('3 files');
  });

  // Prompt-size governance (autopsy 2026-07-05, follow-up 3): the Mitrify import injected ~150
  // attached_assets/IMG_*.png|jpeg names into EVERY turn's manifest — pure token noise the model can
  // never text-edit, and part of why the cheap floor (GLM/KIMI) timed out on the bloated prompt.
  describe('binary assets are excluded from the manifest (with one honest note)', () => {
    it('filters image/font/media names out of the small-project flat list', () => {
      const out = summarizeFileTree([
        'src/App.tsx',
        'attached_assets/IMG_4787_1777795591587.png',
        'attached_assets/photo.jpeg',
        'public/font.woff2',
        'public/intro.mp4',
        'package.json',
      ]);
      expect(out).toContain('src/App.tsx');
      expect(out).toContain('package.json');
      expect(out).not.toContain('IMG_4787');
      expect(out).not.toContain('photo.jpeg');
      expect(out).not.toContain('font.woff2');
      expect(out).not.toContain('intro.mp4');
      // One honest note so the agent knows assets exist (never "this project has no images").
      expect(out).toContain('+4 binary asset files');
      expect(out).toContain('omitted');
    });

    it('keeps .svg (editable text the agent legitimately modifies)', () => {
      const out = summarizeFileTree(['src/logo.svg', 'src/App.tsx']);
      expect(out).toContain('src/logo.svg');
      expect(out).not.toContain('binary asset');
    });

    it('binary files do not push a small project over the summary threshold', () => {
      // 10 source files + 395 images = 405 total (over fullListMax 400), but only 10 EDITABLE files —
      // the agent must still get the full flat list of what it can actually edit.
      const paths = Array.from({ length: 10 }, (_, i) => `src/f${i}.ts`);
      for (let i = 0; i < 395; i++) paths.push(`attached_assets/img${i}.png`);
      const out = summarizeFileTree(paths);
      expect(out).toContain('src/f9.ts');           // full flat list survived
      expect(out).not.toContain('LARGE project');    // not forced into summary mode by images
      expect(out).toContain('+395 binary asset files');
    });

    it('large-project summary also carries the binary-asset note', () => {
      const paths: string[] = [];
      for (let d = 0; d < 30; d++) for (let f = 0; f < 40; f++) paths.push(`src/dir${d}/file${f}.tsx`);
      paths.push('assets/a.png', 'assets/b.png');
      const out = summarizeFileTree(paths);
      expect(out).toContain('LARGE project');
      expect(out).toContain('+2 binary asset files');
      // Directory counts reflect EDITABLE files only (1200, not 1202).
      expect(out).toContain('1200 files');
    });

    it('an assets-only tree degrades to just the note (never an empty misleading blank)', () => {
      const out = summarizeFileTree(['a.png', 'b.jpg']);
      expect(out).toContain('+2 binary asset files');
    });
  });
});

describe('editModePrefix', () => {
  it('injects a bounded directory SUMMARY (not every path) for a large imported app', () => {
    const paths: string[] = ['package.json'];
    for (let i = 0; i < 800; i++) paths.push(`server/routes/handler${i}.ts`);
    const p = editModePrefix(paths);
    expect(p).toContain('<<<EXISTING_FILES>>>');
    expect(p).toContain('801 files');
    expect(p).not.toContain('handler799.ts'); // the deep list is summarized away
  });

  it('declares EDIT MODE and instructs reading before writing', () => {
    const p = editModePrefix(['src/App.tsx']);
    expect(p).toContain('EDIT MODE');
    expect(p).toContain('READ BEFORE WRITING');
  });

  it('instructs preferring edit_file over write_file for existing files', () => {
    const p = editModePrefix(['src/App.tsx']);
    expect(p).toContain('PREFER edit_file');
    expect(p).toContain('write_file');
  });

  it('instructs locating code with grep/glob before editing', () => {
    const p = editModePrefix(['src/App.tsx']);
    expect(p).toContain('LOCATE FIRST');
    expect(p).toContain('grep');
    expect(p).toContain('glob');
  });

  // MITRIFY AUTOPSY 2026-08-04 — the worst outcome in the report: asked to remove a small green dot
  // from the home page, the engine searched ~30 times, never found it, then DELETED the app's LOGO and
  // reported "done — I removed the green dot". The user lost their logo AND still had the dot. A
  // not-found target must end the turn honestly, never be swapped for a different (destructive) edit.
  it('forbids substituting a different change when the named target cannot be found', () => {
    const p = editModePrefix(['src/App.tsx']);
    expect(p).toContain('NEVER SUBSTITUTE A DIFFERENT CHANGE');
    expect(p).toContain('STOP');
    expect(p).toMatch(/could not find/i);
  });

  it('points a not-found VISUAL detail at image/CSS assets instead of the nearest element', () => {
    const p = editModePrefix(['src/App.tsx']);
    expect(p).toMatch(/IMAGE\/SVG\s+ASSET/i);
    expect(p).toMatch(/stylesheet|CSS class/i);
  });

  // The tool that removes the NEED to guess: without this instruction find_ui_element exists but is
  // never reached, and the engine goes back to ~30 blind class-name greps (mitrify, 27 min / ₹393).
  it('directs a visual request to find_ui_element FIRST, not to hand-guessed class names', () => {
    const p = editModePrefix(['src/App.tsx']);
    expect(p).toContain('find_ui_element');
    expect(p).toMatch(/visual request/i);
    expect(p).toMatch(/Do not start guessing Tailwind class names/i);
  });

  it('forbids rebuilding from scratch and demands minimum changes', () => {
    const p = editModePrefix(['src/App.tsx']);
    expect(p).toContain('NEVER REBUILD FROM SCRATCH');
    expect(p).toContain('MINIMUM CHANGES');
  });

  it('injects the provided file tree between explicit markers', () => {
    const p = editModePrefix(['src/App.tsx', 'src/components/Navbar.tsx', 'package.json']);
    expect(p).toContain('<<<EXISTING_FILES>>>');
    expect(p).toContain('<<<END_FILES>>>');
    expect(p).toContain('src/App.tsx');
    expect(p).toContain('src/components/Navbar.tsx');
    expect(p).toContain('package.json');
  });

  it('still allows creating genuinely-new files', () => {
    const p = editModePrefix(['src/App.tsx']);
    expect(p).toContain('NEW FILES ARE FINE');
  });

  it('makes "never break the app" the #1 absolute edit rule and demands post-edit verification', () => {
    const p = editModePrefix(['src/App.tsx']);
    expect(p).toContain('YOUR EDIT MUST NEVER BREAK THE APP');
    // It must demand actually proving the app still builds/runs after editing — via the LOCAL binary
    // `./node_modules/.bin/tsc` (build report 2026-07-21: even `npx --no-install tsc` cancels without
    // typechecking when typescript is absent, and bare `npx tsc` runs the `tsc@2.0.4` squatter's help page).
    expect(p).toContain('./node_modules/.bin/tsc --noEmit');
    expect(p).not.toContain('run `npx tsc --noEmit`'); // never the squatter-prone bare form
    expect(p).not.toMatch(/npx\s+--no-install\s+tsc/); // upgraded away from the npx form entirely
    expect(p).toContain('prove it still works');
  });

  it('omits the file-tree block when no files are supplied (defensive default)', () => {
    const p = editModePrefix();
    expect(p).toContain('EDIT MODE');
    expect(p).not.toContain('<<<EXISTING_FILES>>>');
  });

  it('is a non-empty string distinct from the plain architect prompt', () => {
    const edit = editModePrefix(['a.ts']);
    const architect = architectSystemPrompt();
    expect(edit.length).toBeGreaterThan(0);
    expect(edit).not.toEqual(architect);
  });
});

describe('dateContextBlock (P-PE.8)', () => {
  it('formats a human + ISO date and tells the AI to use it as today', () => {
    const block = dateContextBlock('2026-06-29T12:00:00.000Z');
    expect(block).toContain('2026-06-29T12:00:00.000Z');
    expect(block).toContain('June 29, 2026');
    expect(block.toLowerCase()).toContain('today');
  });
  it('returns "" for a blank timestamp (no change)', () => {
    expect(dateContextBlock('')).toBe('');
    expect(dateContextBlock('   ')).toBe('');
  });
  it('falls back to the raw string for an unparseable timestamp', () => {
    const block = dateContextBlock('not-a-date');
    expect(block).toContain('not-a-date');
  });
});

describe('architectSystemPrompt / planSystemPrompt sanity', () => {
  it('architect prompt mentions write_file and edit_file tools', () => {
    const p = architectSystemPrompt();
    expect(p).toContain('write_file');
    expect(p).toContain('edit_file');
  });

  it('AP-4: parallel-build flag makes fix-dispatch guidance parallel-aware; default is byte-identical serial', () => {
    const off = architectSystemPrompt();
    const offExplicit = architectSystemPrompt(undefined, { parallelBuild: false });
    const on = architectSystemPrompt(undefined, { parallelBuild: true });
    // Default / off: original serial-writer guidance, no parallel-fix wording.
    expect(off).toContain('one file at a time, so fixes never collide');
    expect(off).not.toContain('per-file write lock');
    // Off must be byte-identical whether the flag is omitted or explicitly false (cache-prefix stable).
    expect(offExplicit).toBe(off);
    // On: different-file fixes may dispatch together; same-file still serial.
    expect(on).toContain('per-file write lock');
    expect(on).toContain('DIFFERENT files can go together');
    expect(on).toContain('SAME file');
    expect(on).not.toContain('one file at a time, so fixes never collide');
  });

  it('plan prompt instructs planning only (no file writes yet)', () => {
    const p = planSystemPrompt();
    expect(p.toLowerCase()).toContain('plan');
    expect(p).toContain('update_todo');
  });

  it('instructs building every app to be edit-resilient so later edits never break it', () => {
    const p = architectSystemPrompt();
    expect(p).toContain('EDIT-RESILIENT');
    expect(p).toContain('NEVER BREAK FROM LATER EDITS');
    // The concrete robustness levers must be spelled out, not just asserted.
    expect(p).toContain('ERROR BOUNDARY');
    expect(p).toContain('DECOUPLED');
  });

  it('tells the agent NOT to self-background the dev server (the "Killed" loop guard)', () => {
    const p = architectSystemPrompt();
    // The sandbox already backgrounds + keeps the dev server alive; a self-backgrounded
    // server is orphaned and reaped ("Killed"). The prompt must forbid `&`/`nohup` and
    // tell the agent what to do instead when it sees "Killed".
    expect(p).toContain('PLAIN FOREGROUND command');
    expect(p).toContain('nohup');
    expect(p).toContain('Killed');
    expect(p).toContain('do NOT relaunch with');
  });

  it('tells the agent it is already in the project root (no `cd /workspace`)', () => {
    const p = architectSystemPrompt();
    expect(p).toContain('cd /workspace');
    expect(p).toContain('project root');
  });

  it('forbids hand-writing bulk data (the seed.ts timeout cause) and points to generate_seed_data', () => {
    const p = architectSystemPrompt();
    expect(p).toContain('NEVER HAND-WRITE BULK DATA');
    expect(p).toContain('generate_seed_data');
    const plan = planSystemPrompt();
    expect(plan.toLowerCase()).toContain('seed data');
  });

  it('carries the prompt-injection guard: fenced external content is data, never instructions', () => {
    const p = architectSystemPrompt();
    expect(p).toContain('UNTRUSTED EXTERNAL DATA');
    expect(p).toContain('UNTRUSTED_EXTERNAL_DATA');
    expect(p).toContain('exfiltrate');
  });

  // AB-1: the polyglot backends must ship a scaffold hint that tells the agent the REAL run command
  // (Maven / Go toolchain), not the default npm one — otherwise a Java/Go build is told `npm run dev`.
  it('gives the Spring Boot scaffold hint the Maven run command + 0.0.0.0:8080 binding', () => {
    const p = architectSystemPrompt('spring-boot');
    expect(p).toContain('mvn spring-boot:run');
    expect(p).toContain('8080');
    expect(p).not.toContain('Run: `npm run dev` → PORT 5173'); // must NOT fall back to the vite hint
  });

  it('gives the Go scaffold hint the Go toolchain run command (not npm)', () => {
    const p = architectSystemPrompt('go');
    expect(p).toContain('go run main.go');
    expect(p).toContain('8080');
    expect(p).toContain('go mod tidy');
  });
});

describe('WRITE-IT-RIGHT prevention (build-report 1327b405: hooks crash + hardcoded token + Math.random token)', () => {
  const prompt = architectSystemPrompt();
  it('tells the builder never to call a hook conditionally (Rules of Hooks — the crash that closed the preview port)', () => {
    expect(prompt).toContain('Rules of Hooks');
    expect(prompt.toLowerCase()).toContain('conditionally');
    expect(prompt).toContain('unconditionally at the');
  });
  it('tells the builder never to hardcode a real-format token — use an obvious placeholder', () => {
    expect(prompt).toContain('sk_test_YOUR_KEY_HERE');
    expect(prompt.toLowerCase()).toContain('never hardcode a real-format api token');
  });
  it('tells the builder never to use Math.random() for a token/OTP/secret', () => {
    expect(prompt).toContain('crypto.randomUUID()');
    expect(prompt).toContain('Math.random()');
  });
});

/**
 * GAME BUILDING. Six generators ship the parts of a game that are hard to get right (phases 1–6). None
 * of that matters if the builder does not know to reach for them — a tool the model never calls is
 * dead code, which has happened repeatedly in this codebase.
 */
describe('game guidance points the builder at the engine instead of hand-rolling one', () => {
  const prompt = architectSystemPrompt();

  it('names every game tool, in the order they must be called', () => {
    const order = [
      'generate_game_runtime',
      'generate_game_3d',
      'generate_game_controller',
      'generate_game_systems',
      'generate_game_vfx',
      'generate_game_shell',
    ];
    let at = -1;
    for (const tool of order) {
      const next = prompt.indexOf(tool);
      expect(next, `${tool} is missing from the architect prompt`).toBeGreaterThan(-1);
      expect(next, `${tool} is out of order`).toBeGreaterThan(at);
      at = next;
    }
  });

  it('every tool it names is REALLY in the catalog — this pairing is what drifts', () => {
    // A prompt that instructs the model to call a tool which no longer exists produces a build that
    // burns turns on failed tool calls.
    const catalog = readFileSync(join(__dirname, 'ToolCatalog.ts'), 'utf8');
    for (const tool of [...prompt.matchAll(/generate_game_\w+/g)].map((m) => m[0])) {
      expect(catalog, `${tool} is in the prompt but not the catalog`).toContain(`name: '${tool}'`);
      expect(catalog, `${tool} is defined but not exposed`).toContain(`  '${tool}',`);
    }
  });

  it('tells it NOT to write its own loop, and says why', () => {
    expect(prompt).toContain('NEVER HAND-ROLL THE ENGINE');
    expect(prompt).toContain('requestAnimationFrame');
  });

  it('keeps the asset limit HONEST rather than overpromising', () => {
    // Rule 2: never claim a capability we do not have. Photo-real 3D characters is the one people ask
    // for and the one thing a code-only generator genuinely cannot deliver.
    expect(prompt).toContain('BE HONEST ABOUT ART');
    expect(prompt).toContain('photo-realistic');
    expect(prompt).toContain('grey boxes');
  });

  it('keeps gameplay decoupled from effects', () => {
    expect(prompt).toContain('never call');
    expect(prompt).toMatch(/particles or audio from gameplay/i);
  });
});

/**
 * INNER-PAGE DESIGN. The admin's report (2026-08-11): the first page is beautiful and the inner pages
 * "bas HTML feel dete hai". The deterministic gate (DesignCoverage) catches it after the fact; this
 * block is the half that stops it being generated in the first place, which is the half that matters.
 */
describe('the prompt demands the LAST page look as designed as the first', () => {
  const prompt = architectSystemPrompt();

  it('names the failure explicitly instead of just praising good design', () => {
    // Generic "make it beautiful" guidance is already present and did not prevent this. Naming the
    // specific failure — and WHY it is invisible while writing — is what changes behaviour.
    expect(prompt).toContain('THE INNER PAGES ARE WHERE THIS FAILS');
    expect(prompt).toContain('THE LAST PAGE YOU WRITE MUST LOOK AS');
  });

  it('gives a checkable five-point contract, not a vibe', () => {
    for (const requirement of ['PAGE SHELL', 'REAL HEADING', 'GROUPED CONTENT', 'STYLED CONTROLS', 'REAL STATES']) {
      expect(prompt, `${requirement} missing from the page contract`).toContain(requirement);
    }
  });

  it('the contract names the SAME kit classes the repair pass will ask for', () => {
    // If the prompt and the repair instruction disagreed, the heal would fight the builder.
    for (const cls of ['.container', '.card', '.btn-primary', '.nb-empty', '.field']) {
      expect(prompt, `${cls} missing`).toContain(cls);
    }
  });

  it('forbids inventing a second design language on the inner pages', () => {
    expect(prompt).toContain('do not invent a second design language');
  });
});

describe('the page contract is honest about which scaffolds actually ship the kit', () => {
  // The kit now ships with 8 scaffolds (designKit.ts), not the 1 it started with — but NOT all 24.
  // Telling a Next or Angular
  // or Svelte build to use `.card` would produce classes with NO CSS behind them — worse than plain
  // markup, because it also looks intentional.
  const prompt = architectSystemPrompt();

  it('names WHICH scaffolds ship the kit, so the model never writes classes with no CSS behind them', () => {
    expect(prompt).toContain('WHICH SCAFFOLDS SHIP THE KIT');
    // Must stay in step with designKit.test.ts — a stale list here is a lie to the builder.
    for (const has of ['Vite+React', 'Vue', 'Svelte', 'Preact', 'Solid', 'Alpine', 'Vanilla', 'Next', 'Nuxt', 'SvelteKit', 'Angular']) {
      expect(prompt, `${has} should be listed as having the kit`).toContain(has);
    }
    // And the ones that genuinely do NOT have it must still be named, or the model writes dead classes.
    for (const lacks of ['Remix', 'Astro', 'Lit']) {
      expect(prompt, `${lacks} should be listed as lacking the kit`).toContain(lacks);
    }
  });

  it('keeps the REQUIREMENT on other scaffolds, and says to define equivalents once', () => {
    expect(prompt).toContain('the five requirements are exactly');
    expect(prompt).toContain("project's own global stylesheet");
    expect(prompt).toContain('The rule is the OUTCOME, never the specific class name');
  });
});

/**
 * PREVENTION — the FIRST build should not generate the defects the post-build passes exist to fix
 * (the 50/50 law, admin 2026-08-12). Evidence from three real reports; verified by the prevention audit.
 */
describe('write-it-right-the-first-time prevention list', () => {
  const p = architectSystemPrompt();

  it('the error-boundary "Add one" priming is GONE — it is named as provided', () => {
    // The prompt used to tell the model to ADD an error boundary in three places, so it authored (and
    // broke) one. It now names the provided file as protected.
    expect(p).toContain('src/ErrorBoundary.tsx');
    expect(p).not.toContain('reports a missing ERROR BOUNDARY');
  });

  it('no-unused-imports is a first-time rule, not just an after-the-fact sweep', () => {
    expect(p).toContain('NO UNUSED IMPORTS');
  });

  it('no dynamic innerHTML — the XSS defect is prevented, not only scanned for', () => {
    expect(p).toMatch(/innerHTML/);
    expect(p).toContain('XSS');
  });

  it('the entry point tells the model to put providers in App.tsx, not rewrite main.tsx', () => {
    // Mirrors the scaffold's sealed-entry banner — the model's rewrite of main.tsx is what dropped the
    // ErrorBoundary import.
    expect(p).toContain('KEEP the `import ErrorBoundary` line');
  });
});

describe('the scaffold port is guidance, not an order (admin 2026-08-15)', () => {
  /**
   * THE BUILD THIS COMES FROM. The framework was read as `vite-react` for an app that is actually a
   * fullstack client/ + server/ + shared/ project, so the hint told the model "PORT 5173". The dev
   * server came up correctly on 3000, and the model spent the last ten minutes of a 35.8-minute build
   * trying to MOVE the working server to 5173 — in its own words, "Server port 3000 par chal raha hai,
   * lekin preview 5173 expect kar raha hai."
   *
   * The platform now sweeps for the live port, but a sweep cannot help if the model has already
   * restarted the server onto the port it thought was mandatory. Both halves are needed.
   */
  it('every framework hint carries the rule, not just one of them', () => {
    for (const fw of ['vite-react', 'nextjs', 'node-express', 'static', 'go', 'flask', undefined]) {
      const p = architectSystemPrompt(fw);
      expect(p, String(fw)).toContain('call update_preview with the port it ACTUALLY bound');
      expect(p, String(fw)).toContain("Never change your server's port to match");
    }
  });

  it('it says the scaffold number is a DEFAULT', () => {
    // Without this word the two sentences read as contradictory instructions and the model picks one.
    expect(architectSystemPrompt('vite-react')).toMatch(/DEFAULT, not a requirement/);
  });
});

describe('the game HUD contract (admin screenshot 2026-08-16 — overlapping HUD on a phone)', () => {
  /**
   * A real App Mart game rendered its mode name, five hearts, "Level 1" and a countdown printed
   * THROUGH each other in one band, because each overlay had been given its own
   * `position:absolute; top:12px` — which puts them all in the same place on a narrow screen.
   *
   * The player-side fix (portalling the store player above the tab bar) recovers the space the phone
   * chrome was stealing; it cannot un-overlap a HUD the build already wrote wrong. This is the
   * upstream half — the one that stops the NEXT game from repeating it.
   */
  it('tells the builder a HUD is one laid-out container, not one absolute box per element', () => {
    const p = architectSystemPrompt('vite-react');
    expect(p).toContain('THE HUD IS A LAYOUT, NOT A PILE');
    expect(p).toContain('justify-content: space-between');
    expect(p).toContain('ONE container per corner/edge (never one per element)');
  });

  it('requires the HUD not to swallow taps meant for the game', () => {
    expect(architectSystemPrompt('vite-react')).toContain('pointer-events');
  });

  it('names the two mobile units that are wrong by default', () => {
    // 100vh is wrong by the height of the browser bar, and ignoring the safe area puts an on-screen
    // joystick under the phone's own chrome — both produce "the controls are unreachable".
    const p = architectSystemPrompt('vite-react');
    expect(p).toContain('100dvh');
    expect(p).toContain('env(safe-area-inset-');
  });

  it('stops the build telling a phone player to press keys they do not have', () => {
    expect(architectSystemPrompt('vite-react')).toContain('is DESKTOP');
  });

  it('teaches all THREE machines a game is played on, not just phone-vs-desktop', () => {
    // Admin, 2026-08-16: "usko sabhi (3) cheezo ke liye sikhao — mobile | desktop | tablet."
    // Tablet is the one that gets skipped and the one that breaks: it is wide like a desktop and
    // touch like a phone, so a width-only rule hands it mouse-sized buttons or a stretched phone.
    const p = architectSystemPrompt('vite-react');
    expect(p).toContain('PHONE, PORTRAIT');
    expect(p).toContain('PHONE, LANDSCAPE');
    expect(p).toContain('TABLET');
    expect(p).toContain('DESKTOP');
  });

  it('decides controls by INPUT capability rather than by screen width', () => {
    // The insight that makes the three-way rule work at all: width cannot tell touch from mouse.
    const p = architectSystemPrompt('vite-react');
    expect(p).toContain('pointer: coarse');
    expect(p).toContain('hover: hover');
  });

  it('names the landscape-phone trap, where the screen is wide but SHORT', () => {
    expect(architectSystemPrompt('vite-react')).toMatch(/wide but very SHORT/);
  });

  it('carries the contract for every framework, not just the React one', () => {
    // The same class of game ships as a static canvas page just as often as a Vite app.
    for (const fw of ['vite-react', 'static', 'nextjs', undefined]) {
      expect(architectSystemPrompt(fw), String(fw)).toContain('THE HUD IS A LAYOUT, NOT A PILE');
    }
  });
});

describe('the three-screen contract for ordinary pages (mobile | tablet | desktop)', () => {
  /**
   * Admin, 2026-08-16: "usko sabhi (3) cheezo ke liye sikhao — mobile | desktop | tablet."
   *
   * The per-page contract had five points and said nothing at all about form factors, so "works on a
   * phone" was left to luck. Tablet is the one that gets skipped in practice AND the one that breaks,
   * because it is the only device that is wide like a desktop and touch like a phone at the same time
   * — a width-only breakpoint therefore gives it either mouse-sized tap targets or a phone layout
   * stretched into a lonely strip.
   */
  it('adds a SIXTH point naming all three screens', () => {
    const p = architectSystemPrompt('vite-react');
    expect(p).toContain('THE THREE SCREENS — PHONE, TABLET, DESKTOP');
  });

  it('separates the two questions: size decides layout, input decides controls', () => {
    // This split IS the rule. Collapsing it back into "breakpoints" is what broke tablets.
    expect(architectSystemPrompt('vite-react')).toContain('SIZE decides the LAYOUT, INPUT decides the CONTROLS');
  });

  it('names both tablet failure modes, not just one', () => {
    const p = architectSystemPrompt('vite-react');
    expect(p).toMatch(/three or four\s+squeezed narrower/);   // the desktop layout crammed in
    expect(p).toMatch(/single column stretched/);              // the phone layout blown up
  });

  it('forbids hover as the ONLY route to an action', () => {
    // A hover-only menu is not "degraded" on touch, it is completely unreachable.
    expect(architectSystemPrompt('vite-react')).toMatch(/hover must NEVER be the only way/);
  });

  it('treats height and orientation as real constraints', () => {
    const p = architectSystemPrompt('vite-react');
    expect(p).toContain('HEIGHT IS A SCREEN SIZE TOO');
    expect(p).toMatch(/BOTH orientations/);
  });

  it('carries the contract on every framework, including the ones without the CSS kit', () => {
    // The five-point contract explicitly still applies on Remix/Astro/Lit, where the kit classes do
    // not exist — the sixth must travel with it, or those scaffolds silently lose it.
    for (const fw of ['vite-react', 'static', 'nextjs', 'go', 'flask', undefined]) {
      expect(architectSystemPrompt(fw), String(fw)).toContain('THE THREE SCREENS — PHONE, TABLET, DESKTOP');
    }
  });
});
