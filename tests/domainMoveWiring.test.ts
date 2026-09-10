import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MOVED_NOTE } from '../src/server/lib/domainMove';

/**
 * "Move this domain to this app" — one tap (ROADMAP §13, 1.3). The decision is pure and tested in
 * domainMove.test.ts; these locks hold the WIRING: decided before the attach, both spellings
 * detached, the refusal naming nobody, and the screen saying it moved.
 */
const src = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const routes = src('src/server/routes/nbaiDomains.ts');
const screen = src('src/components/agentv3/NbaiDomainConnect.tsx');

describe('🔒 the move is decided BEFORE the attach, inside the connect route', () => {
  it('reads the holder, decides, and only then attaches', () => {
    const connectAt = routes.indexOf("app.post('/api/domains/nbai/connect'");
    const holderAt = routes.indexOf('const holder = await linkForDomain(host);', connectAt);
    const decideAt = routes.indexOf('decideDomainMove(holder, workspaceId, verifiedUid)', connectAt);
    const attachAt = routes.indexOf('await attachCustomDomain(workspaceId, host);', connectAt);
    expect(holderAt).toBeGreaterThan(connectAt);
    expect(decideAt).toBeGreaterThan(holderAt);
    expect(attachAt).toBeGreaterThan(decideAt);
  });

  it('🔒 detaches BOTH spellings from the old app, best-effort each', () => {
    expect(routes).toContain('for (const spelling of [host, alternateHost(host)].filter((h): h is string => !!h)) {');
    expect(routes).toContain('await deleteCustomDomain(move.from, spelling);');
    const at = routes.indexOf('await deleteCustomDomain(move.from, spelling);');
    expect(routes.slice(at - 40, at)).toContain('try {');
  });

  it('a different account is refused with a 409 and the pure module\'s message — nothing about whose', () => {
    expect(routes).toContain("if (move.action === 'refuse') {");
    expect(routes).toContain('res.status(409).json({ error: move.message });');
  });

  it('the response carries movedFrom without touching the one-source res.json line', () => {
    expect(routes).toContain('(verdict as Record<string, unknown>).movedFrom = movedFrom;');
    expect(routes).toContain('res.json({ ...verdict, autoDns:');
  });
});

describe('the screen says it moved, and how to undo', () => {
  it('renders the note from the connect response', () => {
    expect(screen).toContain('{result.movedFrom && (');
    expect(screen).toContain(MOVED_NOTE);
  });
});
