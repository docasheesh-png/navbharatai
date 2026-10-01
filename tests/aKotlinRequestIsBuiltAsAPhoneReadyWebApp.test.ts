/**
 * Autopsy 042e472f + dfd24058 (2026-10-01) — the JARVIS report.
 *
 * Build 1 asked for a native Android app ("Technology: Kotlin, Jetpack Compose … must compile in Android
 * Studio"). No rule named a native mobile stack, so the project planner made sixteen Kotlin modules, the
 * builder deleted the starter's package.json / vite.config.ts / index.html one file at a time (every guard
 * protected source code only), wrote Gradle files nothing here can run, and the build ended "Nothing has
 * been built yet". Build 2 (the same idea as a web app, ending "apk") was planned as "clone of YouTube",
 * claimed a gradle test suite from build 1's leftovers, never mentioned the APK it was asked for, called a
 * sixteen-file project "one HTML file", and shipped `uuid` for message ids under "⚠️ Build Review (85/100):
 * [PASS]" — a score nobody wrote.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  unsupportedStackRequested, unsupportedStackBuilderNote, unsupportedStackUserNote, isMobileStack,
} from '../src/server/AgentV3/unsupportedStack';
import { runtimeManifestDeletionTarget, runtimeManifestDeletionMessage } from '../src/server/AgentV3/CommandGovernance';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import { detectTestPlan } from '../src/server/AgentV3/testRunner';
import { deviceSummaryNotice, phoneBuildAsked } from '../src/server/AgentV3/devicePowers';
import { formatReview } from '../src/server/AgentV3/ReviewerAgent';
import { auditSummaryClaims } from '../src/server/AgentV3/claimAudit';
import { unfixableInstallNote } from '../src/server/lib/unfixablePackages';

const root = resolve(__dirname, '..');
const KOTLIN = readFileSync(resolve(root, 'tests/fixtures/autopsy042e472f.prompt.txt'), 'utf8');
const WEB = `Build a JARVIS-style voice assistant web app. Features: a mic button using the Web Speech API (SpeechRecognition) to take voice commands in Hindi and English; spoken replies using speechSynthesis; a dark, glowing arc-reactor style UI with a live chat log; commands like "open YouTube", "what's the time", "set a timer", "remember my name is …" (saved in localStorage); and a fallback text input. Keep it mobile-first and a single page. apk`;
const ROUTE = readFileSync(resolve(root, 'src/server/routes/agentv3.ts'), 'utf8');
const DISPATCHER = readFileSync(resolve(root, 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');

describe('a native mobile stack is named, like any stack we do not build', () => {
  it('the report\'s own prompt — a "Technology:" list, Jetpack Compose, Android Studio', () => {
    expect(unsupportedStackRequested(KOTLIN)).toBe('native Android (Kotlin)');
    expect(isMobileStack('native Android (Kotlin)')).toBe(true);
    expect(isMobileStack('PHP')).toBe(false);
  });
  it('Swift, Flutter and React Native, each asked to BUILD WITH', () => {
    expect(unsupportedStackRequested('build an iOS app using SwiftUI')).toBe('native iOS (Swift)');
    expect(unsupportedStackRequested('build a notes app in Swift for iPhone')).toBe('native iOS (Swift)');
    expect(unsupportedStackRequested('build a flutter app for my gym')).toBe('Flutter');
    expect(unsupportedStackRequested('a react native app for my shop')).toBe('React Native');
    expect(unsupportedStackRequested('Platform: Android\nLanguage: Kotlin')).toBe('native Android (Kotlin)');
  });
  it('precision: the ordinary words, the web app of the same report, a question, a conversion', () => {
    for (const p of [WEB, 'build a swift delivery app', 'a todo app with swift search', 'an expo app for events',
      'build an expo event app with tickets', 'build a react native style dashboard web app',
      'build an app to track my Android Studio courses', 'what is kotlin?', 'Convert my Flutter app to React',
      'language: Hindi', 'make a game like flappy bird']) {
      expect(unsupportedStackRequested(p), p).toBeNull();
    }
  });
  it('the builder hears what we DO build, and that the manifests are the app', () => {
    const n = unsupportedStackBuilderNote('native Android (Kotlin)', 'vite-react');
    expect(n).toMatch(/cannot build, compile or preview native Android \(Kotlin\)/);
    expect(n).toMatch(/More → Download APK/);
    expect(n).toMatch(/Never delete, empty or replace package\.json, vite\.config\.\*, index\.html/);
    expect(n).toMatch(/no Gradle, Kotlin/);
  });
  it('the user is told once; the APK sentence stands down when the summary already has it', () => {
    const full = unsupportedStackUserNote('native Android (Kotlin)', 'vite-react', 'Your app is ready.');
    expect(full).toMatch(/You asked for a \*\*native Android \(Kotlin\)\*\* app/);
    expect(full).toMatch(/More → Download APK/);
    const deduped = unsupportedStackUserNote('native Android (Kotlin)', 'vite-react', '… open **More → Download APK** …');
    expect(deduped).not.toMatch(/Download APK/);
  });
  it('the project planner gets the note, and so does every module turn (the plan goal)', () => {
    expect(ROUTE).toMatch(/const plannerGoal = unsupportedStackAsked \? `\$\{unsupportedStackBuilderNote\(unsupportedStackAsked, framework\)\}/);
    expect(ROUTE).toMatch(/projectPlanUserPrompt\(plannerGoal, ppScaffold\)/);
    expect(ROUTE).toMatch(/createProjectPlan\(plannerGoal, framework, modules, Date\.now\(\)\)/);
    expect(ROUTE).not.toMatch(/projectPlanUserPrompt\(prompt, ppScaffold\)/);
  });
});

describe('the files that make the project run are never deleted', () => {
  it('the report\'s commands, one file at a time', () => {
    expect(runtimeManifestDeletionTarget('rm -f package.json')).toBe('package.json');
    expect(runtimeManifestDeletionTarget('rm -f index.html')).toBe('index.html');
    expect(runtimeManifestDeletionTarget('rm -f tsconfig.json tsconfig.build.json tsconfig.node.json')).toBe('tsconfig.json');
    expect(runtimeManifestDeletionTarget('cd /home/user && rm ./package.json')).toBe('package.json');
    expect(runtimeManifestDeletionTarget('sh -c "rm -f package.json"')).toBe('package.json');
  });
  it('a lockfile, a nested page, node_modules and vite.config are not manifests', () => {
    for (const c of ['rm -f package-lock.json', 'rm -rf node_modules', 'rm docs/index.html', 'rm -f vite.config.js', 'rm public/index.html']) {
      expect(runtimeManifestDeletionTarget(c), c).toBeNull();
    }
  });
  it('the refusal says to write over it, and the dispatcher asks before running', () => {
    expect(runtimeManifestDeletionMessage('package.json')).toMatch(/write the new content over it/);
    expect(DISPATCHER).toMatch(/const manifestTarget = runtimeManifestDeletionTarget\(command\);/);
  });
});

describe('"open YouTube" is a command, not a clone', () => {
  it('both prompts of the report', () => {
    expect(analyzeAppScope(KOTLIN).famousApp).toBeNull();
    expect(analyzeAppScope(WEB).famousApp).toBeNull();
    expect(analyzeAppScope('a voice assistant: "YouTube kholo", "time batao"').famousApp).toBeNull();
  });
  it('a real clone request still escalates', () => {
    expect(analyzeAppScope('make a youtube clone').famousApp).toBe('YouTube');
    expect(analyzeAppScope('youtube jaisa app banao').famousApp).toBe('YouTube');
  });
});

describe('a JVM build file left beside a web app is not a test suite', () => {
  it('build 1\'s leftovers in build 2\'s workspace', () => {
    expect(detectTestPlan(['settings.gradle.kts', 'build.gradle.kts', 'app/build.gradle.kts', 'app/src/main/AndroidManifest.xml', 'src/App.tsx'])).toBeNull();
  });
});

describe('the APK the user asked for is named in the summary', () => {
  it('"… a single page. apk" with no phone plugin installed', () => {
    expect(phoneBuildAsked(WEB)).toBe(true);
    const n = deviceSummaryNotice({ prompt: WEB, summary: 'JARVIS is ready.', packageJson: '{"dependencies":{"react":"^19"}}' });
    expect(n).toMatch(/Your Android app \(APK\).*More → Download APK/s);
  });
  it('not when the summary already said it, and never for "mobile-first"', () => {
    expect(deviceSummaryNotice({ prompt: WEB, summary: 'Get it from More → Download APK.', packageJson: '{}' })).toBe('');
    expect(phoneBuildAsked('Keep it mobile-first and a single page')).toBe(false);
    expect(phoneBuildAsked('a mobile app style dashboard')).toBe(false);
  });
});

describe('a review with no score shows no score (fixed on main by #3442, autopsy 4d538ca3 — same class)', () => {
  it('"[PASS]" with no findings', () => {
    const out = formatReview({ passed: true, score: 85, scoreStated: false, issues: [], summary: '[PASS]' });
    expect(out.startsWith('✅')).toBe(true);
    expect(out).not.toMatch(/85/);
  });
});

describe('"one HTML file" about a multi-file project is corrected', () => {
  it('the report\'s sentence', () => {
    const c = auditSummaryClaims('- **Single page** — Everything lives in one HTML file, no routing.', {
      consoleCaptured: true, screenshotTaken: false, previewVerified: true, appSourceFiles: 16,
    });
    expect(c.map((x) => x.kind)).toContain('one-file');
  });
  it('a real one-file app, a single-page app, and an unknown count are not accused', () => {
    const base = { consoleCaptured: true, screenshotTaken: false, previewVerified: true };
    expect(auditSummaryClaims('Everything lives in one HTML file.', { ...base, appSourceFiles: 1 })).toEqual([]);
    expect(auditSummaryClaims('A single-page app with no routing.', { ...base, appSourceFiles: 16 })).toEqual([]);
    expect(auditSummaryClaims('Everything lives in one HTML file.', base)).toEqual([]);
  });
});

describe('an id needs no package', () => {
  it('the report\'s install command is answered with crypto.randomUUID()', () => {
    const n = unfixableInstallNote('npm install uuid && npm install --save-dev @types/uuid');
    expect(n).toMatch(/`uuid`:.*crypto\.randomUUID\(\)/);
    expect(n).toMatch(/`@types\/uuid`:/);
    expect(unfixableInstallNote('npm install zustand')).toBe('');
  });
});
