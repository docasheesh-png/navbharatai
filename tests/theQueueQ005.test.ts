// BUILD_REPORT_QUEUE Q-005 (autopsy 6461025c): a build order in Hindi script never counted as an order —
// every Devanagari message is capped at LOW for routing, and `userAskedForAnAppToBeBuilt` needs HIGH. So
// Hindi-script users never saw the feature card and never got domain guidance.

import { describe, it, expect } from 'vitest';
import { userAskedForAnAppToBeBuilt, devanagariBuildOrder } from '../src/server/AgentV3/IntentClassifier';
import { featurePlanFor } from '../src/server/AgentV3/featurePlan';

describe('a build order in Hindi script is an order', () => {
  it('orders, with or without a leading yes, in either script', () => {
    for (const t of [
      'एक todo app बनाओ जिसमें login, search और reminders हों',
      'हाँ, एक todo app बनाओ जिसमें login, search और reminders हों',
      'एक दुकान का ऐप बना दो',
      'हाँ. build a todo app with login, search and reminders',
    ]) expect(userAskedForAnAppToBeBuilt(t), t).toBe(true);
  });
  it('questions and reports are not orders', () => {
    for (const t of ['क्या आप एक ऐप बना सकते हैं?', 'ऐप कैसे बनाओ', 'मेरा ऐप काम नहीं कर रहा', 'हाँ', 'हाँ, ठीक है']) {
      expect(userAskedForAnAppToBeBuilt(t), t).toBe(false);
    }
    expect(devanagariBuildOrder('build a todo app')).toBe(false);
  });
  it('so the feature card reaches a Hindi-script request', () => {
    expect(featurePlanFor('हाँ, एक todo app बनाओ जिसमें login, search और reminders हों', { requirementAware: true }).show).toBe(true);
  });
});
