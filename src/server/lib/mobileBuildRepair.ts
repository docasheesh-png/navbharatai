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
  | 'BUILD_SCRIPT_MISSING'
  | 'WEB_DIR_MISSING'
  | 'ANDROID_PLATFORM_MISSING'
  | 'GRADLEW_NOT_EXECUTABLE'
  | 'SDK_LICENSE_NOT_ACCEPTED'
  | 'JAVA_VERSION_TOO_OLD'
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
  const log = normalizeLog(rawLog);

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
      needs: [workflowPath],
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

  return {
    code: 'UNKNOWN',
    summary: 'The build stopped for a reason NavBharatAI could not identify.',
    autoFixable: false,
    needs: [],
  };
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

/** A strict install needs a lock file this app has none of — fall back to a plain install. */
export function repairNpmCi(workflow: string): string | null {
  if (!/npm ci/.test(workflow)) return null;
  const out = workflow.replace(/npm ci(?!\s*\|\|)/g, 'npm ci || npm install');
  return out === workflow ? null : out;
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
  const out = workflow.replace(/(\.\/gradlew)/g, 'chmod +x ./gradlew && ./gradlew').replace(/chmod \+x \.\/gradlew && chmod \+x/g, 'chmod +x');
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
  const out = workflow.replace(/(java-version:\s*['"]?)(\d+)(['"]?)/g, (all, pre: string, ver: string, post: string) =>
    Number(ver) < target ? `${pre}${target}${post}` : all,
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
): RepairResult | null {
  const wf = current[workflowPath] || '';
  const one = (path: string, next: string | null, message: string): RepairResult | null =>
    next === null ? null : { files: { [path]: next }, message };

  switch (diag.code) {
    case 'NPM_LOCK_CACHE':
      return one(workflowPath, repairNpmCache(wf), 'NavBharatAI: stop the build looking for a saved library copy that does not exist');
    case 'NPM_CI_NO_LOCK':
      return one(workflowPath, repairNpmCi(wf), 'NavBharatAI: install the app’s libraries without requiring a lock file');
    case 'ANDROID_PLATFORM_MISSING':
      return one(workflowPath, repairAndroidPlatform(wf), 'NavBharatAI: create the Android project before compiling it');
    case 'GRADLEW_NOT_EXECUTABLE':
      return one(workflowPath, repairGradlewPermission(wf), 'NavBharatAI: allow the Android build tool to run');
    case 'SDK_LICENSE_NOT_ACCEPTED':
      return one(workflowPath, repairSdkLicenses(wf), 'NavBharatAI: accept the Android build tool terms on the build machine');
    case 'JAVA_VERSION_TOO_OLD':
      return one(workflowPath, repairJavaVersion(wf), 'NavBharatAI: use the Java version this Android build needs');
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
