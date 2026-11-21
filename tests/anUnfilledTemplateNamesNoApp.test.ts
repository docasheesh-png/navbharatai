// failedbr #1020 (2026-11-20): a Hindi prompt template was pasted with its topic blank — "[यहाँ लिखिए आपको कौन सी ऐप बनानी है …]".
// The role line became the app's name, the placeholder's examples set the domain, and a To-Do app was guessed.
import { describe, expect, it } from 'vitest';
import { buildConfirmation } from '../src/server/AgentV3/buildConfirmation';

describe('an unfilled template names no app (failedbr #1020)', () => {
  it.each([
    'तुम एक एक्सपर्ट मोबाइल ऐप डेवलपर हो। मेरी ऐप का टॉपिक यह है: [यहाँ लिखिए आपको कौन सी ऐप बनानी है, जैसे: "एक साधारण कैलकुलेटर ऐप"]',
    'Build an app for [write your app idea here]',
    'Make an app: <insert topic here>',
  ])('answered, not built: %s', (m) => {
    expect(buildConfirmation(m)).toEqual({ confirmed: false, reason: 'unfilled-template' });
  });
  it.each(['Build a todo app with tags [work, home]', 'Build a calculator (with history)'])('an ordinary bracket still builds: %s', (m) => {
    expect(buildConfirmation(m).confirmed).toBe(true);
  });
});
