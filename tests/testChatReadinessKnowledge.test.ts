import { describe, expect, it } from 'vitest';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

describe('admin Test Chat Bot self-awareness', () => {
  it('describes the real admin path and distinguishes readiness from spending permission', () => {
    const entries = APP_KNOWLEDGE_BASE.filter(feature => feature.id === 'admin-test-chat-bot');
    expect(entries).toHaveLength(1);
    const [feature] = entries;
    expect(feature.path).toBe('Admin Dashboard → AI Engines → Test Chat Bot (verified admin only)');
    expect(feature.description).toContain('without inference or reservations');
    expect(feature.description).toContain('cannot create supplier guarantees or independent review');
    expect(feature.description).toContain('actual underlying seller and charge remain unverified');
    expect(feature.howToUse).toContain('Do not automatically resend a timed-out or uncertain request');
    expect(feature.howToUse).toContain('never changes provider credentials, deployment settings, shared caps or the production provider order');
    expect(feature.keywords).toContain('test chat bot');
    expect(feature.keywords).toContain('test kaise kare');
  });
});
