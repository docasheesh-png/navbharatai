import { describe, expect, it } from 'vitest';
import { looksLikeRefusal } from '../src/server/lib/promptSafety';
import { decideBuildNudge } from '../src/server/AgentV3/nudgeToBuild';
import { answeredWithoutBuilding, readTurnAnswer } from '../src/server/AgentV3/turnAnswer';
import { shouldRetryEmptyBuild } from '../src/server/routes/agentv3';

// Report 77a2ecf5: the model declined in Hinglish six times, but the English-only shared predicate
// treated each answer as a stall and then retried the entire empty build. No private prompt is needed
// to reproduce the grammar or either caller's wrong decision.
const ANSWER = 'Main phir se clear kar deta hoon: main is tarah ka app nahi bana sakta. '
  + 'Main koi file nahi likh raha is request ke liye.';

describe('a Hindi refusal is still the model answering', () => {
  it.each([
    ANSWER,
    'Main yeh app nahi bana sakta.',
    'Mai aisi website nahin bana sakti.',
    'Mein aisa tool nhi bana sakta hoon.',
    '**Main yeh app bana nahi sakta.**',
    'Hum aapki is kaam mein madad nahi kar sakte.',
    'Main is request mein help nahin kar sakti.',
    'मैं यह ऐप नहीं बना सकता।',
    'मैं ऐसी वेबसाइट नही बना सकती।',
    'हम ऐसा टूल बना नहीं सकते।',
    'मैं इस काम में आपकी मदद नहीं कर सकता।',
    'मैं इस अनुरोध में सहायता नहीं कर सकती।',
  ])('recognizes an explicit first-person decline: %s', (text) => {
    expect(looksLikeRefusal(text)).toBe(true);
    expect(readTurnAnswer(text).declined).toBe(true);
  });

  it('stands down in both the in-run nudge and the higher-rung empty-build retry', () => {
    const answer = readTurnAnswer(ANSWER);
    expect(decideBuildNudge({
      text: ANSWER, expectsArtifacts: true, totalToolUses: 0,
      nudgesUsed: 0, maxNudges: 2, editingExistingApp: false,
    })).toEqual({ nudge: false, message: '', standDown: 'declined' });
    expect(shouldRetryEmptyBuild({
      expectsArtifacts: true, filesWritten: 0, isEditMode: false,
      existingProjectFiles: 0, aborted: false, withinCostCap: true,
      modelRefused: answer.declined,
    })).toBe(false);
    expect(answeredWithoutBuilding(answer)).toBe(true);
  });

  it.each([
    'Main app bana raha hoon aur login feature bhi jodunga.',
    'Main signup page nahi bana raha hoon; ab sirf checkout par kaam kar raha hoon.',
    'Main fake login nahi banaunga; ab asli authentication bana raha hoon.',
    'मैं नकली लॉगिन नहीं बनाऊँगा; अब वास्तविक प्रमाणीकरण बना रहा हूँ।',
    'Main agar app nahi bana sakta to aapse clarification poochunga.',
    'मैं अगर यह ऐप नहीं बना सकता तो सहायता माँगूँगा।',
    'Kya main yeh app nahi bana sakta?',
    'The error message is: "main yeh app nahi bana sakta".',
    'const message = "main yeh app nahi bana sakta";',
    '```tsx\nconst message = "main yeh app nahi bana sakta";\n```',
    'Here is the requested code:\n```text\nMain yeh app nahi bana sakta.\n```',
    '`Main yeh app nahi bana sakta` is the label requested for this button.',
    'x'.repeat(401) + ' Main yeh app nahi bana sakta.',
  ])('does not turn scope, a condition, a quote or code into a refusal: %s', (text) => {
    expect(looksLikeRefusal(text)).toBe(false);
  });
});
