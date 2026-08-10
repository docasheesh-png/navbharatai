// SELF-HEALING APP BUILDS — read a failed GitHub Actions log, work out what broke, and repair the files
// NavBharatAI itself generated, so the build restarts and finishes without the user doing anything.
//
// WHY (admin 2026-08-03, verbatim): "Build my APK now press kare .apk workflow run ho -> fail ho to v5
// dekh ke fix kare, wapas apne aap -> build workflow chale, sab kuch apne aap ho, tab tak user ko bas
// loading % show ho". A non-technical user cannot read a Gradle stack trace, and telling them to "open
// the run on GitHub" is handing them our problem. Everything in the repository except their app's own
// source was written by NavBharatAI — the workflow, the Capacitor config, the package.json wrapper — so
// when one of those is wrong, fixing it is fixing our own output, not editing the user's work.
//
// WHY DETERMINISTIC, NOT AN LLM (fifth absolute rule, step 5): a heal that runs must be 100% reliable.
// Every repair below is a mechanical edit with one correct answer — remove a cache line, bump a Java
// version, point webDir at the directory the build actually produced. A model asked to "fix this CI log"
// would be right most of the time, and "most of the time" on a self-driving loop means silently pushing
// a wrong commit into a user's repository. So the classifier only claims a failure it can name exactly,
// and returns autoFixable:false — with an honest explanation — for everything else.
//
// PURE: no network, no I/O. The route supplies the log and the current file contents and writes back
// whatever comes out, which is what makes every branch below unit-testable.

/** Every failure class NavBharatAI can name from a build log. */
export type RepairCode =
  | 'NPM_LOCK_CACHE'
  | 'NPM_CI_NO_LOCK'
  | 'NPM_PEER_CONFLICT'
  | 'NPM_PACKAGE_NOT_FOUND'
  | 'STALE_WORKFLOW'
  | 'BUILD_SCRIPT_MISSING'
  | 'WEB_DIR_MISSING'
  | 'ANDROID_PLATFORM_MISSING'
  | 'GRADLEW_NOT_EXECUTABLE'
  | 'SDK_LICENSE_NOT_ACCEPTED'
  | 'JAVA_VERSION_TOO_OLD'
  | 'ANDROID_RESOURCE_LINKING'
  | 'NODE_OUT_OF_MEMORY'
  | 'MISSING_SIGNING_SECRET'
  | 'APP_CODE_BUILD_FAILED'
  | 'UNKNOWN';

export interface BuildFailureDiagnosis {
  code: RepairCode;
  /**
   * What went wrong, written for the person who pressed the button. Never a raw log line and never a
   * vendor name — the White-Label Law applies to every user-facing string.
   */
  summary: string;
  /** True only when a mechanical repair of a NavBharatAI-generated file will genuinely fix it. */
  autoFixable: boolean;
  /** Repository-relative files the repair needs to read before it can patch them. */
  needs: string[];
  /** Facts pulled out of the log that the repair depends on (e.g. the directory Capacitor wanted). */
  detail?: Record<string, string>;
}

/** What NavBharatAI would generate for this repository today — the source of a refresh repair. */
export interface FreshFiles {
  /** The current kit's version of the failing workflow. */
  workflow?: string;
  /** The repo's package.json re-merged through the current rules (Capacitor majors aligned, build script present). */
  packageJson?: string;
}

export interface RepairResult {
  /** Only the files that actually changed — an empty object means there was nothing to repair. */
  files: Record<string, string>;
  /** Commit message for the repair, so every automatic change is visible in the user's git history. */
  message: string;
}

/** The whole log is huge; failures are always near the end, and GitHub prefixes every line with a timestamp. */
export function normalizeLog(raw: string): string {
  return String(raw || '')
    .split('\n')
    .map((l) => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, ''))
    .join('\n');
}

/**
 * Name the failure.
 *
 * ORDER MATTERS. The checks run most-specific first, because a broken build prints several plausible
 * strings at once: a Gradle failure caused by a missing web build also prints "Process completed with
 * exit code 1", and an unmatched generic pattern would mask the real cause and send the repair at the
 * wrong file. Returns UNKNOWN rather than guessing — an honest "I could not name this" beats a
 * confident wrong commit.
 */
export function classifyBuildFailure(rawLog: string, workflowPath: string): BuildFailureDiagnosis {
  const full = normalizeLog(rawLog);
  // Patterns are matched against the FAILED STEP ONLY. A job log contains every step, including the
  // ones that succeeded, and successful steps are noisy: the old install ran `npm ci || npm install`,
  // so a perfectly healthy install left a loud npm-ci complaint in the log. Matching the whole job read
  // that complaint and reported "the build used a strict install that needs a lock file" for a run
  // whose install had taken 19 seconds and gone green — a confident, wrong diagnosis pointing the
  // repair at the wrong file. The stage marker is still read from the FULL log, because the step that
  // prints it is by definition a different step from the one that broke.
  const log = failedStepSection(full);

  // ── The user's own signing key. Never auto-fixable: we do not have it, and must not have it. ──
  const secretMatch = log.match(/Missing required secret[:\s]+([A-Z_][A-Z0-9_]*)/);
  if (secretMatch || /keystore.*(not set|missing|empty)|ANDROID_KEYSTORE_BASE64/i.test(log)) {
    return {
      code: 'MISSING_SIGNING_SECRET',
      summary: secretMatch
        ? `Your Play Store signing key is not on the repository yet — the build needs ${secretMatch[1]}.`
        : 'Your Play Store signing key is not on the repository yet.',
      autoFixable: false,
      needs: [],
      detail: secretMatch ? { secret: secretMatch[1] } : undefined,
    };
  }

  // ── setup-node asked npm to cache with no lock file present. Kills the run ~18s in. ──
  if (/Dependencies lock file is not found/i.test(log)) {
    return {
      code: 'NPM_LOCK_CACHE',
      summary: 'The build tried to reuse a saved copy of the app’s libraries that does not exist yet.',
      autoFixable: true,
      needs: [workflowPath],
    };
  }

  // ── npm could not resolve the app's libraries. ──
  //
  // These two are the dominant real-world failure for a generated app, because package.json is written
  // by the builder: a package name that does not exist on the registry, or two libraries demanding
  // different versions of the same thing. They are told apart because only ONE of them has a fix that
  // is always right.
  const missingPkg = packageNameFromNpm404(log);
  if (/npm ERR!\s*code\s*E404|404\s+Not Found.*registry\.npmjs\.org/i.test(log)) {
    return {
      code: 'NPM_PACKAGE_NOT_FOUND',
      // NOT auto-fixable on purpose: the cure is to stop generating the bad name, and removing the
      // package here would leave the code that imports it failing one step later with a worse message.
      summary: missingPkg
        ? `Your app asks for a library that does not exist: ${missingPkg}.`
        : 'Your app asks for a library that does not exist.',
      autoFixable: false,
      needs: [],
      detail: missingPkg ? { package: missingPkg } : undefined,
    };
  }
  if (/npm ERR!\s*code\s*ERESOLVE|unable to resolve dependency tree|ERESOLVE could not resolve/i.test(log)) {
    return {
      code: 'NPM_PEER_CONFLICT',
      summary: 'Two of your app’s libraries wanted different versions of the same thing.',
      autoFixable: true,
      needs: [workflowPath],
    };
  }

  // ── `npm ci` without a package-lock.json. ──
  if (/npm ci.{0,120}package-lock\.json|can only install packages when your package\.json/is.test(log)) {
    return {
      code: 'NPM_CI_NO_LOCK',
      summary: 'The build used a strict install that needs a lock file this app does not have.',
      autoFixable: true,
      needs: [workflowPath],
    };
  }

  if (/Missing script:\s*"?build"?|npm ERR!\s*missing script:\s*build/i.test(log)) {
    return {
      code: 'BUILD_SCRIPT_MISSING',
      summary: 'The app had no "build" step defined, so there was nothing for the packager to package.',
      autoFixable: true,
      needs: ['package.json', 'capacitor.config.ts'],
    };
  }

  // Capacitor names the directory it wanted, which is exactly what the repair needs.
  const webDirMatch = log.match(/Could not find the web assets directory:?\s*\.?\/?([\w.\-/]+)/i);
  if (webDirMatch || /web assets directory.*(does not exist|not found)/i.test(log)) {
    return {
      code: 'WEB_DIR_MISSING',
      summary: 'The packager looked for the built app in the wrong folder.',
      autoFixable: true,
      needs: ['capacitor.config.ts', 'package.json'],
      detail: webDirMatch ? { expected: webDirMatch[1].replace(/\/+$/, '') } : undefined,
    };
  }

  if (/android platform has not been added|Could not find the android platform|capacitor\.config.*android.*missing/i.test(log)
      || (/cap sync android/i.test(log) && /android.{0,40}not (been )?(added|found)/i.test(log))) {
    return {
      code: 'ANDROID_PLATFORM_MISSING',
      summary: 'The Android part of the project had not been created before the build tried to compile it.',
      autoFixable: true,
      needs: [workflowPath, 'package.json'],
    };
  }

  // "chmod: cannot access './gradlew'" is NOT a permissions problem — the file is not there at all,
  // because `npx cap add android` never created the project. Checked BEFORE the permission pattern,
  // which would otherwise claim it and "repair" a chmod that is already correct.
  if (/chmod:.{0,40}gradlew.{0,60}No such file|gradlew.{0,20}No such file or directory|Could not find or load main class org\.gradle/i.test(log)) {
    return {
      code: 'ANDROID_PLATFORM_MISSING',
      summary: 'The Android project was never created, so there was nothing to compile.',
      autoFixable: true,
      // package.json too: the usual reason the project cannot be created is that the app's Capacitor
      // packages are on different major versions, and that is fixed there, not in the workflow.
      needs: [workflowPath, 'package.json'],
    };
  }

  if (/gradlew.{0,40}Permission denied|Permission denied.{0,40}gradlew|\.\/gradlew: not found/i.test(log)) {
    return {
      code: 'GRADLEW_NOT_EXECUTABLE',
      summary: 'The Android build tool was not allowed to run on the build machine.',
      autoFixable: true,
      needs: [workflowPath],
    };
  }

  if (/You have not accepted the license agreements|Android SDK.{0,60}licen[cs]e/i.test(log)) {
    return {
      code: 'SDK_LICENSE_NOT_ACCEPTED',
      summary: 'The Android build tools needed their terms accepted on the build machine.',
      autoFixable: true,
      needs: [workflowPath],
    };
  }

  if (/Unsupported class file major version|invalid source release|requires Java \d+|Java version.{0,30}not supported/i.test(log)) {
    return {
      code: 'JAVA_VERSION_TOO_OLD',
      summary: 'The build machine was set up with an older Java than this Android build needs.',
      autoFixable: true,
      needs: [workflowPath],
    };
  }

  // ── Android resource linking failed (aapt2). Capacitor's launch theme references a drawable/resource
  // that a fresh `cap add android` did not ship (the reported real case: @drawable/splash not found). This
  // lives in the GENERATED android/ project — created on CI, gitignored, absent from the user's repo — so
  // no edit to a repo file the AI can see would fix it. The current workflow now self-heals the missing
  // splash drawable deterministically, so refreshing our own workflow IS the repair. Named explicitly
  // (rather than swept into the generic android-stage fallback) so the diagnosis is honest and telemetry
  // can see the class. Checked BEFORE the app-code error extractor, which does not recognise an aapt error. ──
  if (/Android resource linking failed|failed linking references|aapt2?(?:\.exe)?\b.*error|error:\s*resource\s+[\w./]+\s+not found/i.test(log)) {
    return {
      code: 'ANDROID_RESOURCE_LINKING',
      summary: 'The build stopped while packaging the app’s images and screens.',
      autoFixable: true,
      needs: [workflowPath],
    };
  }

  if (/JavaScript heap out of memory|FATAL ERROR:.*Allocation failed/i.test(log)) {
    return {
      code: 'NODE_OUT_OF_MEMORY',
      summary: 'The build machine ran out of memory while building the app.',
      autoFixable: true,
      needs: [workflowPath],
    };
  }

  // ── The app's own source failed to compile. NOT a packaging problem, so no file surgery can fix it. ──
  const appError = extractAppBuildError(log);
  if (appError) {
    return {
      code: 'APP_CODE_BUILD_FAILED',
      summary: 'Your app itself did not compile, so it could not be packaged.',
      autoFixable: false,
      needs: [],
      detail: { error: appError },
    };
  }

  // ── Not named — but if the stage that died is one NavBharatAI set up, replacing our own workflow
  // with the current one is a legitimate, safe repair. It is how a repository created months ago picks
  // up every fix made since, including ones nobody has written a specific pattern for. It cannot loop:
  // once the workflow matches the current kit the repair changes nothing and is reported as unfixable.
  const stage = failedStage(full);
  if (stage && stage !== 'webbuild') {
    return {
      code: 'STALE_WORKFLOW',
      summary: stage === 'install'
        ? 'The build stopped while installing your app’s libraries.'
        : stage === 'capacitor'
          ? 'The build stopped while creating the Android project.'
          : 'The build stopped while building the Android app.',
      autoFixable: true,
      needs: [workflowPath, 'package.json'],
      detail: { stage },
    };
  }

  return {
    code: 'UNKNOWN',
    summary: stage === 'webbuild'
      ? 'Your app itself did not compile, so it could not be packaged.'
      : 'The build stopped for a reason NavBharatAI could not identify.',
    autoFixable: false,
    needs: [],
    detail: stage ? { stage } : undefined,
  };
}

/**
 * Which stage died, read from the marker the generated workflow prints on failure.
 *
 * This is GROUND TRUTH, not a pattern match: the workflow inspects the runner's own filesystem (did the
 * libraries install, did the web build produce output, was the Android project created) and states the
 * answer. Pattern-matching a megabyte of Gradle output for the same fact is guesswork by comparison.
 * Older repositories have no marker, so this returns null and the text patterns above still decide.
 */
export function failedStage(log: string): 'install' | 'webbuild' | 'capacitor' | 'android' | null {
  const m = normalizeLog(log).match(/NBAI_FAILED_STAGE=(install|webbuild|capacitor|android)\b/);
  return (m?.[1] as 'install' | 'webbuild' | 'capacitor' | 'android') ?? null;
}

/**
 * The part of a job log belonging to the step that actually failed.
 *
 * GitHub wraps each step in `##[group]…##[endgroup]` and marks a failure with `##[error]`. A successful
 * step never emits `##[error]`, so the last group that contains one IS the step that broke. Returning
 * the whole log when nothing matches is deliberate: an older run with no group markers should still be
 * classified on its full text rather than silently yielding nothing.
 */
export function failedStepSection(log: string): string {
  const parts = log.split(/^##\[group\]/m);
  if (parts.length < 2) return log;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/##\[error\]/.test(parts[i])) return parts[i];
  }
  return log;
}

/**
 * The name of the package npm could not find.
 *
 * npm reports a 404 twice, in two shapes, and only one of them is safe to read. The quoted form
 * (`404 'name@range' is not in this registry`) names the package exactly, so it is tried FIRST; the URL
 * form ends in the words "Not found", which a loose pattern happily captures as the package name. The
 * trailing version range is stripped without breaking a scoped package, whose name legitimately starts
 * with '@'.
 */
export function packageNameFromNpm404(log: string): string | null {
  const quoted = log.match(/404\s+'([^']{1,120})'\s+is not in this registry/);
  const url = log.match(/registry\.npmjs\.org\/((?:@[\w.-]+\/)?[\w.-]+)/);
  const raw = quoted?.[1] ?? url?.[1];
  if (!raw) return null;
  const at = raw.lastIndexOf('@');
  return (at > 0 ? raw.slice(0, at) : raw) || null;
}

/**
 * Pull the real compile error out of a failed web build, so an un-fixable failure is still REPORTED
 * precisely instead of as "something went wrong". Bounded so a runaway log can never be echoed whole.
 */
export function extractAppBuildError(log: string): string | null {
  const patterns = [
    /error during build:\s*([\s\S]{0,400}?)(?:\n\s*at |\n\n|$)/i,
    /\n((?:\S+\.(?:tsx?|jsx?|css)).{0,80}?error TS\d+:[\s\S]{0,300}?)(?:\n\n|$)/i,
    /\n(Error:\s*[\s\S]{0,300}?)(?:\n\s*at |\n\n|$)/,
  ];
  for (const re of patterns) {
    const m = log.match(re);
    const text = m?.[1]?.trim();
    if (text) return text.slice(0, 400);
  }
  return null;
}

// ────────────────────────────── the repairs ──────────────────────────────
// Each takes the CURRENT contents and returns the corrected contents, or null when there was nothing to
// change. "Nothing to change" is load-bearing: it is what stops the self-healing loop from committing an
// identical file and re-running a build that will fail the same way forever.

/** Strip setup-node's npm cache — the app is pushed without a lock file, so caching hard-fails. */
export function repairNpmCache(workflow: string): string | null {
  const out = workflow
    .split('\n')
    .filter((l) => !/^\s*cache:\s*['"]?npm['"]?\s*$/.test(l) && !/^\s*cache-dependency-path:/.test(l))
    .join('\n');
  return out === workflow ? null : out;
}

/**
 * Only the lines that are actually EXECUTED, never the workflow's own comments.
 *
 * Every repair here rewrites shell commands, and a generated workflow is heavily commented — it explains
 * why each non-obvious step exists. Without this guard a repair happily edits its own explanation: the
 * comment "so npm ci failed on every run" was being rewritten into "so npm ci || npm install failed on
 * every run", producing a pointless commit that changed nothing executable and, worse, made the file
 * differ from the current kit forever after.
 */
function mapCommandLines(workflow: string, fn: (line: string) => string): string {
  return workflow
    .split('\n')
    .map((line) => (/^\s*#/.test(line) ? line : fn(line)))
    .join('\n');
}

/** A strict install needs a lock file this app has none of — fall back to a plain install. */
export function repairNpmCi(workflow: string): string | null {
  const out = mapCommandLines(workflow, (l) => l.replace(/npm ci(?!\s*\|\|)/g, 'npm ci || npm install'));
  return out === workflow ? null : out;
}

/**
 * Let the install proceed when two libraries disagree about a shared dependency.
 *
 * `--legacy-peer-deps` is npm's own documented answer to ERESOLVE, so this is a real fix rather than a
 * way of silencing the error: it restores npm 6's resolution, which installs what the app asked for.
 */
export function repairPeerConflict(workflow: string): string | null {
  if (/--legacy-peer-deps/.test(workflow)) return null;
  const m = workflow.match(/^(?!\s*#)([ \t]*)(run: )?(.*\bnpm (?:ci|install)\b.*)$/m);
  if (!m || m.index === undefined) return null;
  const at = m.index + m[0].length;
  return `${workflow.slice(0, at)} || npm install --legacy-peer-deps${workflow.slice(at)}`;
}

/** Make sure the Android project is created before anything tries to compile it. */
export function repairAndroidPlatform(workflow: string): string | null {
  if (/npx cap add android/.test(workflow)) return null;
  const out = workflow.replace(
    /^(\s*)(run:\s*)?(.*npx cap sync android.*)$/m,
    (_all, indent: string, run: string | undefined, line: string) =>
      run
        ? `${indent}${run}|\n${indent}  npx cap add android || echo "android/ already present — continuing"\n${indent}  ${line.trim()}`
        : `${indent}npx cap add android || echo "android/ already present — continuing"\n${indent}${line.trim()}`,
  );
  return out === workflow ? null : out;
}

/** Gradle's wrapper script arrives without the executable bit on a fresh checkout. */
export function repairGradlewPermission(workflow: string): string | null {
  if (/chmod \+x\s+\.?\/?gradlew/.test(workflow)) return null;
  const out = mapCommandLines(workflow, (l) =>
    l.replace(/(\.\/gradlew)/g, 'chmod +x ./gradlew && ./gradlew').replace(/chmod \+x \.\/gradlew && chmod \+x/g, 'chmod +x'));
  return out === workflow ? null : out;
}

/**
 * Accept the Android SDK licences on the runner before the first Gradle task.
 *
 * The insertion point is found by locating the line that actually invokes gradlew and walking BACK to
 * the `- name:` that opens its step — not by pattern-matching step titles, which are free text and would
 * silently place the new step after the build it is supposed to precede. Indentation is copied from the
 * step it is inserted before, so the repair works whatever style the workflow uses.
 */
export function repairSdkLicenses(workflow: string): string | null {
  if (/sdkmanager --licenses|android-actions\/setup-android/.test(workflow)) return null;
  const lines = workflow.split('\n');
  const gradleAt = lines.findIndex((l) => /gradlew\b/.test(l));
  if (gradleAt < 0) return null;
  let stepAt = gradleAt;
  while (stepAt >= 0 && !/^\s*- (name|uses|run):/.test(lines[stepAt])) stepAt--;
  if (stepAt < 0) return null;

  const indent = lines[stepAt].match(/^\s*/)?.[0] ?? '      ';
  lines.splice(stepAt, 0,
    `${indent}- name: Accept the Android build tool terms`,
    `${indent}  run: yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses || true`,
  );
  return lines.join('\n');
}

/** Android Gradle needs a modern JDK; an older `java-version` is a mechanical bump. */
export function repairJavaVersion(workflow: string, target = 21): string | null {
  const out = mapCommandLines(workflow, (l) =>
    l.replace(/(java-version:\s*['"]?)(\d+)(['"]?)/g, (all, pre: string, ver: string, post: string) =>
      Number(ver) < target ? `${pre}${target}${post}` : all),
  );
  return out === workflow ? null : out;
}

/**
 * Give Node enough heap for a large app's bundler run.
 *
 * `env:` is inserted as a SIBLING of `run:` at the same indentation — that is what makes it a key of the
 * same workflow step. Indented one level deeper it would be parsed as part of the shell command and do
 * nothing, which is the kind of "fix" that fails silently and burns another whole build.
 */
export function repairOutOfMemory(workflow: string): string | null {
  if (/NODE_OPTIONS/.test(workflow)) return null;
  const m = workflow.match(/^([ \t]*)run: npm run build[ \t]*$/m);
  if (!m || m.index === undefined) return null;
  const at = m.index + m[0].length;
  return `${workflow.slice(0, at)}\n${m[1]}env:\n${m[1]}  NODE_OPTIONS: --max-old-space-size=4096${workflow.slice(at)}`;
}

/** The directory a given toolchain writes its built app into. */
export function webDirForPackageJson(pkgJson: string): string {
  let pkg: Record<string, unknown> = {};
  try { pkg = JSON.parse(pkgJson || '{}') as Record<string, unknown>; } catch { /* fall through to the default */ }
  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };
  const scripts = (pkg.scripts as Record<string, string> | undefined) || {};
  const build = String(scripts.build || '');
  if (deps.next || /next build/.test(build)) return 'out';
  if (deps['react-scripts'] || /react-scripts build/.test(build)) return 'build';
  if (deps.vite || /vite build/.test(build)) return 'dist';
  return 'dist';
}

/** Point Capacitor at the directory the app's own build genuinely produces. */
export function repairWebDir(capConfig: string, webDir: string): string | null {
  const out = capConfig.replace(/(webDir:\s*)(['"])([^'"]*)\2/, (all, pre: string, q: string, cur: string) =>
    cur === webDir ? all : `${pre}${q}${webDir}${q}`,
  );
  return out === capConfig ? null : out;
}

/** Add the build script the packager calls, matching whatever bundler the app actually uses. */
export function repairBuildScript(pkgJson: string): string | null {
  let pkg: Record<string, unknown>;
  try { pkg = JSON.parse(pkgJson || '{}') as Record<string, unknown>; } catch { return null; }
  const scripts = { ...((pkg.scripts as Record<string, string> | undefined) || {}) };
  if (typeof scripts.build === 'string' && scripts.build.trim()) return null;
  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };
  scripts.build = deps.next ? 'next build'
    : deps['react-scripts'] ? 'react-scripts build'
    : deps.vite ? 'vite build'
    // No bundler at all: the app is already plain files, so "building" it is genuinely a no-op. Saying
    // so out loud beats inventing a build step that would fail.
    : 'echo "This app is ready to package as it is."';
  return `${JSON.stringify({ ...pkg, scripts }, null, 2)}\n`;
}

/**
 * Apply the repair for a diagnosis to the files the route fetched.
 *
 * Returns null when nothing changed — the caller MUST treat that as "cannot fix" and stop, or the
 * self-healing loop would push an empty commit and re-run a build that fails identically.
 */
export function repairFiles(
  diag: BuildFailureDiagnosis,
  current: Record<string, string>,
  workflowPath: string,
  /**
   * What NavBharatAI would generate for this repository TODAY. Supplying it lets a repository prepared
   * before a fix pick that fix up — the most valuable repair there is, because it heals every
   * already-pushed repo at once instead of one pattern at a time.
   *
   * It covers package.json as well as the workflow, and that is not optional detail: the reason
   * `cap add android` fails is almost always that the app's Capacitor packages sit on different major
   * versions, which lives in package.json. A refresh limited to the workflow would replace the file
   * that merely EXPOSED the problem and leave the one that CAUSED it — so the build would fail again,
   * the repair would find nothing left to change, and the user would be told "NavBharatAI could not fix
   * this one on its own" for something entirely within our power to fix.
   */
  fresh?: FreshFiles,
): RepairResult | null {
  const wf = current[workflowPath] || '';

  /**
   * Replace every NavBharatAI-generated file that is out of date, in ONE commit.
   *
   * Only files that genuinely differ are included, so an already-current repository yields null and the
   * loop stops instead of committing nothing and rebuilding forever.
   */
  const refresh = (): RepairResult | null => {
    const files: Record<string, string> = {};
    if (fresh?.workflow && fresh.workflow.trim() !== wf.trim()) files[workflowPath] = fresh.workflow;
    if (fresh?.packageJson && fresh.packageJson.trim() !== (current['package.json'] || '').trim()) {
      files['package.json'] = fresh.packageJson;
    }
    if (Object.keys(files).length === 0) return null;
    return {
      files,
      message: files['package.json']
        ? 'NavBharatAI: bring this app’s build setup up to date so the Android project can be created'
        : 'NavBharatAI: update this app’s build instructions to the current version',
    };
  };
  const one = (path: string, next: string | null, message: string): RepairResult | null =>
    next === null ? null : { files: { [path]: next }, message };

  switch (diag.code) {
    // Replacing our own workflow with the current one IS the repair here — the failure is in a stage we
    // set up, and the current kit is by construction our best version of it.
    case 'STALE_WORKFLOW':
      return refresh();
    case 'NPM_PEER_CONFLICT':
      // A refresh is preferred: the current install step already carries the --legacy-peer-deps
      // fallback. Only an already-current workflow needs the surgical edit.
      return refresh() ?? one(workflowPath, repairPeerConflict(wf), 'NavBharatAI: let the app’s libraries install despite a version disagreement');
    case 'NPM_LOCK_CACHE':
      return one(workflowPath, repairNpmCache(wf), 'NavBharatAI: stop the build looking for a saved library copy that does not exist') ?? refresh();
    case 'NPM_CI_NO_LOCK':
      return one(workflowPath, repairNpmCi(wf), 'NavBharatAI: install the app’s libraries without requiring a lock file') ?? refresh();
    case 'ANDROID_PLATFORM_MISSING':
      // The current workflow no longer swallows a failed `cap add` and verifies the project exists, so
      // refreshing it IS the fix for any repo still carrying the old swallowing version.
      return one(workflowPath, repairAndroidPlatform(wf), 'NavBharatAI: create the Android project before compiling it') ?? refresh();
    case 'GRADLEW_NOT_EXECUTABLE':
      return one(workflowPath, repairGradlewPermission(wf), 'NavBharatAI: allow the Android build tool to run') ?? refresh();
    case 'SDK_LICENSE_NOT_ACCEPTED':
      return one(workflowPath, repairSdkLicenses(wf), 'NavBharatAI: accept the Android build tool terms on the build machine');
    case 'JAVA_VERSION_TOO_OLD':
      return one(workflowPath, repairJavaVersion(wf), 'NavBharatAI: use the Java version this Android build needs');
    // The current workflow deterministically writes a placeholder @drawable/splash before compiling, so
    // refreshing our own workflow onto a repo that predates that fix IS the repair.
    case 'ANDROID_RESOURCE_LINKING':
      return refresh();
    case 'NODE_OUT_OF_MEMORY':
      return one(workflowPath, repairOutOfMemory(wf), 'NavBharatAI: give the build enough memory for this app');
    case 'WEB_DIR_MISSING': {
      const want = webDirForPackageJson(current['package.json'] || '');
      // The log names the directory Capacitor LOOKED in; repairing to that same value would be a no-op,
      // so the truth comes from what the app's own toolchain actually writes.
      if (diag.detail?.expected && diag.detail.expected === want) return null;
      return one('capacitor.config.ts', repairWebDir(current['capacitor.config.ts'] || '', want),
        `NavBharatAI: package the app from "${want}", where its build actually writes it`);
    }
    case 'BUILD_SCRIPT_MISSING':
      return one('package.json', repairBuildScript(current['package.json'] || ''),
        'NavBharatAI: define the build step the packager needs');
    default:
      return null;
  }
}
