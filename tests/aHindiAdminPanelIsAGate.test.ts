// failedbr #1005 (2026-11-20): "…मेरे पास है एडमिन पैनल होना चाहिए" (an admin panel) was read as "asks for no sign-in", and the
// builder was told to add no login or access control. The Latin list knew "admin"; the Devanagari list did not.
import { describe, expect, it } from 'vitest';
import { requestScopeVerdict } from '../src/server/AgentV3/requestScope';

const note = (request: string) => requestScopeVerdict({ request, newBuild: true } as never)?.reason ?? null;

describe('a Hindi admin panel is an access gate (failedbr #1005)', () => {
  it.each(['से यह गेम बनाना है रोब्लाक्स पर उसके बाद बस मेरे पास है एडमिन पैनल होना चाहिए', 'पिन डालकर खुलने वाला ऐप'])('no "no sign-in" note: %s', (r) => {
    expect(note(r)).toBeNull();
  });
  it.each(['एक कैलकुलेटर ऐप बनाओ', 'पिनकोड से दुकान ढूंढने वाला ऐप', 'ब्लॉक गेम बनाओ'])('a word inside another word is not a gate: %s', (r) => {
    expect(note(r)).toBe('names-no-sign-in');
  });
});
