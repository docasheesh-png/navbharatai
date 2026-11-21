// TWO SMALL ITEMS OF failedbr #2481, EACH FIXED AT ITS CLASS (admin 2026-11-21: "fix karo!!").
//
// Q-3225 — 🧬 a fact about OUR probe recorded as a fact about the app. The preview flip visited ports 3000/5000/8080 in the
// sandbox browser with console recording on; the sandbox's 502 for each empty port landed in the app's runtime record and
// the builder chased "network issues" on a healthy app.
//
// Q-3226 — 🧬 a language instruction pointing at text the user did not write. On a roadmap build the builder's turn began
// "the user wrote this request in …, reply in the language they wrote in", followed by the planner's ENGLISH brief; the
// user's Hinglish words were nowhere in the turn, so the builder mirrored English.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { portVisitBrowseOpts, rankPortCandidates } from '../src/server/AgentV3/PortDiscovery';
import { browsePageScript } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { buildLanguageInstruction, usersOwnWordsLine } from '../src/server/AgentV3/LanguageDetect';
import { replyLanguageBinding, replyVoiceForRequest } from '../src/server/AgentV3/replyLanguageBinding';

const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
const REQUEST = 'ek real gta jaise game banao, bahut bade map par, user apne charecter ko joystik se control kare';

describe('🔌 Q-3225: a flip probe never writes into the app\'s console record', () => {
  it('the exact #2481 flip: app on 5173, the probes are 3000, 5000 and 8080', () => {
    const cands = rankPortCandidates({ parsed: 5173, scriptPort: undefined, expected: 5173, listening: [5173], framework: 'vite-react' });
    expect(cands.filter((p) => p !== 5173)).toEqual([3000, 5000, 8080]);
  });

  it('a probe visit does not record; the visit to the app\'s own port does', () => {
    expect(portVisitBrowseOpts(true)).toEqual({ recordConsole: false });
    expect(portVisitBrowseOpts(false)).toEqual({ recordConsole: true });
    // And "do not record" really means no listener in the page script.
    expect(browsePageScript('https://3000-x.e2b.app', portVisitBrowseOpts(true))).not.toMatch(/httperror/);
    expect(browsePageScript('https://5173-x.e2b.app', portVisitBrowseOpts(false))).toMatch(/httperror/);
  });

  it('🧬 census: every flip loop in the route visits its candidates as probes', () => {
    const loops = route.split('for (const cand of rankPortCandidates(').slice(1);
    expect(loops.length).toBeGreaterThanOrEqual(2);   // the Diagnose route and the import path
    for (const body of loops) expect(body.slice(0, 400)).toMatch(/const attempt = await visit\(cand, true\);/);
    // and every visit() that browses a port url passes the probe decision on
    const visits = route.match(/actuator\.browseUrl\(workspaceId, internalPreviewUrl\(url\).{0,60}?, 30_000/g) ?? [];
    expect(visits.length).toBeGreaterThanOrEqual(2);
    for (const v of visits) expect(v).toContain('portVisitBrowseOpts(flipProbe)');
  });
});

describe('🗣️ Q-3226: on a roadmap build the builder is shown the user\'s OWN words', () => {
  const binding = replyLanguageBinding(replyVoiceForRequest(REQUEST));

  it('the request reads as Roman Hinglish', () => {
    expect(binding).toMatch(/Roman-script Hinglish/);
  });

  it('a brief that replaces the request quotes the user\'s message and names the brief as the planner\'s', () => {
    const line = buildLanguageInstruction({ prompt: REQUEST, isContinuation: false, editingExistingApp: false, briefReplacesRequest: true, replyLanguage: binding });
    expect(line).toContain(`The user's own message was: "${REQUEST}"`);
    expect(line).toMatch(/written by the planner in English — it is NOT the user's message/);
    expect(line).toMatch(/narrate every step, ask, and write your final summary in it/);
    expect(line).toContain(binding);
  });

  it('an ordinary build (the user\'s words ARE the request) is unchanged', () => {
    const plain = buildLanguageInstruction({ prompt: REQUEST, isContinuation: false, editingExistingApp: false });
    expect(plain).not.toMatch(/planner/);
    expect(buildLanguageInstruction({ prompt: REQUEST, isContinuation: false, editingExistingApp: false, briefReplacesRequest: false })).toBe(plain);
  });

  it('a very long message is bounded', () => {
    expect(usersOwnWordsLine('x'.repeat(5000)).length).toBeLessThan(900);
  });

  it('the route says so exactly when a milestone replaced the request — to the architect AND every sub-agent', () => {
    expect(route.split("briefReplacesRequest: !!milestoneRequest, replyLanguage: replyLanguageBinding(").length - 1).toBe(2);
    expect(route).toMatch(/buildLanguageInstruction\(\{ prompt, continuedRequest: checksRequest,[^}]*briefReplacesRequest: !!milestoneRequest, replyLanguage: replyLanguageBinding\(rb\.replyVoice \?\? voiceOf\(originalPrompt\)\) \}\)/);
  });
});
