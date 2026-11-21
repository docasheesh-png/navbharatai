/**
 * failedbr #697 (2026-09-16): an Assamese UPSC Mains question ("discuss … per question, upsc mains high quality
 * standards") was routed to a BUILD — a sandbox, an ETA, "~43 features", a credit upsell — on nothing but its
 * length. On main the length branch can no longer lock a build: the verdict is LOW (the intention reader decides),
 * and with no reader it falls to chat because the message names nothing to build. Locked on the real prompt.
 */
import { describe, expect, it } from 'vitest';
import { classifyIntentWithConfidence, readerlessIntent, namesSomethingToBuild } from '../src/server/AgentV3/IntentClassifier';

const P697 = 'পশ্চিম এছিয়া সংকট, ইউক্ৰেইন সংঘাত আৰু বৃহৎ শক্তিৰ প্ৰতিদ্বন্দ্বিতাৰ মাজত ব্ৰিকছৰ ঐক্য কিমান টেকসই? আলোচনা কৰক।per question discuss upsc mains high quality standards, not writing a';

describe('#697 — an essay question is not an order to build', () => {
  it('length alone gives no hard lock, and the readerless verdict is chat', () => {
    expect(classifyIntentWithConfidence(P697).confidence).toBe('low');
    expect(namesSomethingToBuild(P697)).toBe(false);
    expect(readerlessIntent(P697)).toBe('chat');
  });
});
