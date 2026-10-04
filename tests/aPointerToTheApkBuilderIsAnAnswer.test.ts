// Autopsy 0c2a987a (2026-09-30). "Make in .apk files" on an existing app. The first model call answered
// correctly — More → Download APK → "Get my app ready to build" → "Build my APK now"; no code change is
// needed because NavBharatAI builds the package itself. It was nudged twice ("ACT NOW"), the empty-build
// retry then re-ran the build one rung higher, and that was nudged again: six model calls, 3.4 minutes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { decideBuildNudge, asksForAppPackage, turnPointedToPlatformFeature, standDownNote } from '../src/server/AgentV3/nudgeToBuild';
import { readTurnAnswer, answeredWithoutBuilding } from '../src/server/AgentV3/turnAnswer';

const REQUEST = 'Make in .apk files';
// The report's first answer, verbatim.
const ANSWER = `I can help you get your app as a real Android APK file.

NavBharatAI builds the APK for you — you don't need Android Studio or any manual setup. Here is what to do:

1. **Go to the "More" tab** at the bottom of the screen.
2. **Tap "Download APK".**
3. **Tap "Get my app ready to build"** — NavBharatAI will check the app compiles and fix anything needed.
4. **Tap "Build my APK now"** — the build runs on a real machine (this takes a few minutes and shows a percentage).
5. Once it finishes, your \`.apk\` file is ready to install on any Android phone.

The APK installs directly and needs no signing key. Only if you later want to publish on Google Play would you need your own signing key for the \`.aab\` bundle — that key stays with you and NavBharatAI never sees it.`;

const base = { expectsArtifacts: true, totalToolUses: 0, nudgesUsed: 0, maxNudges: 2, editingExistingApp: true };

describe('the report\'s own turn', () => {
  it('🔴 is not nudged', () => {
    const d = decideBuildNudge({ ...base, text: ANSWER, request: REQUEST });
    expect(d.nudge).toBe(false);
    expect(d.standDown).toBe('pointed-to-feature');
    expect(standDownNote('pointed-to-feature')).toMatch(/APK flow/);
  });
  it('🔴 is read as an answer — so it is neither retried nor flipped to "the build produced no files"', () => {
    const a = readTurnAnswer(ANSWER, REQUEST);
    expect(a.pointed).toBe(true);
    expect(answeredWithoutBuilding(a)).toBe(true);
  });
});

describe('both halves are required', () => {
  it.each(['Make in .apk files', 'apk bana do', 'I need the aab for play store', 'convert my app into an apk', 'give me the ipa'])('asks for a package: %s', (r) => {
    expect(asksForAppPackage(r)).toBe(true);
  });
  it.each(['add a download APK button to my app', 'build a todo app', 'what is an apk?', 'my apk crashes on open'])('does not: %s', (r) => {
    expect(asksForAppPackage(r)).toBe(false);
  });
  it('a build request whose answer merely mentions the APK builder is still nudged', () => {
    const text = "I'll build the todo app now, and later you can use Download APK to get it on your phone.";
    expect(turnPointedToPlatformFeature(text, 'build a todo app')).toBe(false);
    expect(decideBuildNudge({ ...base, text, request: 'build a todo app' }).nudge).toBe(true);
  });
  it('without the request the new test never fires — every older caller is unchanged', () => {
    expect(decideBuildNudge({ ...base, text: ANSWER }).standDown).toBeUndefined();
    expect(readTurnAnswer(ANSWER).pointed).toBe(false);
  });
});

describe('wired where the answer is read', () => {
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
  const runner = readFileSync(join(__dirname, '../src/server/AgentV3/AgentRunner.ts'), 'utf8');
  it('the runner passes the request to the nudge', () => {
    expect(runner).toContain('request: userPrompt,');
  });
  it('the route reads both answers with the request, and the retry and the empty flip honour it', () => {
    expect(route).toContain('const firstAttempt = readTurnAnswer(modelsOwnWords(result), prompt);');
    expect(route).toContain('const modelAnswer = readTurnAnswer(modelsOwnWords(result), prompt);');
    expect(route).toContain('modelAskedTheUser: firstAttemptAskedTheUser || firstAttempt.pointed,');
    expect(route).toContain('modelAnswer.asked || modelAnswer.pointed,');
  });
});
