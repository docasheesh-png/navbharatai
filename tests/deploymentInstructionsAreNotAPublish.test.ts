// failedbr #961 (2026-11-20): a deliverables list asking for "Deployment instructions (Vercel)" switched the deploy tool on
// ("The user asked for this app to be published in their message"). Instructions are a document, not consent.
import { describe, expect, it } from 'vitest';
import { decidePublishConsent } from '../src/server/AgentV3/publishConsent';

describe('deployment instructions are not a publish order (failedbr #961)', () => {
  it.each(['Build a paper trading app. Deliverables: full source, Deployment instructions (Vercel), README', 'add deploy steps to the README', 'write a deployment guide', 'deployment tracker app'])('denied: %s', (m) => {
    expect(decidePublishConsent(m).consent).toBe('denied');
  });
  it.each(['build it and deploy it to vercel', 'publish my app', 'publish karo'])('granted: %s', (m) => {
    expect(decidePublishConsent(m).consent).toBe('granted');
  });
});
