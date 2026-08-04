import { describe, it, expect } from 'vitest';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * Polish campaign — "third lap": Engineer AI legacy prose. Engineer AI is RETIRED (its app-building is now
 * NavBharatAI Pro v5.0). The retired entry is correctly banner-marked, but several OTHER entries still told
 * users to "use the Engineer AI" to build/deploy a real app — a dead route. This locks them to v5.0.
 *
 * Left intentionally: the retired entry itself (a clear RETIRED → v5.0 redirect), the History entry (old
 * sessions genuinely include an "Engineer AI" type), and the docs-site group list (the `engineer_ai`
 * KnowledgeDocs group still exists) — none of these route a user to a dead builder.
 */
const kb = (id: string) => APP_KNOWLEDGE_BASE.find((f) => f.id === id)!;
const text = (id: string) => `${kb(id).description ?? ''} ${kb(id).howToUse ?? ''}`;

describe('No entry routes a user to the retired Engineer AI to build/deploy an app', () => {
  it.each(['coding_ai', 'repo_analyst', 'professionals', 'settings_secrets', 'login_auth'])(
    '%s points app-building at NavBharatAI Pro v5.0, not "the Engineer AI"',
    (id) => {
      expect(text(id)).not.toMatch(/the Engineer AI/);
      expect(text(id)).not.toMatch(/use Engineer AI/);
    },
  );
});

describe('The retired Engineer AI entry is an honest redirect', () => {
  it('is banner-marked RETIRED and points at NavBharatAI Pro v5.0', () => {
    const e = kb('engineer_ai');
    expect(e.path).toMatch(/RETIRED/);
    expect(e.path).toMatch(/NavBharatAI Pro v5\.0/);
    expect(e.howToUse).toMatch(/retired/i);
    expect(e.howToUse).toMatch(/App Builder v5\.0|NavBharatAI Pro v5\.0/);
  });
});
