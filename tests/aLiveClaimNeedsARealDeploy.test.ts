/**
 * 🌐 "YOUR APP IS LIVE" NEEDS A REAL DEPLOY (master audit 2026-11-25, Part N — "claiming a deployment succeeded without
 * checking deployment status").
 *
 * The deploy tool itself was already honest (every failure throws — autopsy aed2906d), but the model's own summary had no
 * rule: it could say "your app is now live!" on a turn where nothing was published, and the user would believe it. Now the
 * claim audit weighs that sentence against whether a deploy really SUCCEEDED this turn — precision first: an instruction
 * ("press Publish to make it live") is never a claim, and an app already live from an earlier Publish is not judged.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { auditSummaryClaims, deployClaimed } from '../src/server/AgentV3/claimAudit';
import { deployedThisTurn } from '../src/server/AgentV3/deployedThisTurn';

const base = { consoleCaptured: true, screenshotTaken: true, previewVerified: true };
const kinds = (summary: string, deployed: boolean | undefined) => auditSummaryClaims(summary, { ...base, deployedThisTurn: deployed }).map((c) => c.kind);

describe('🔴 a claim of being live, weighed against the deploy', () => {
  for (const said of [
    'Your app is now live at https://my-app.navbharatai.app 🎉',
    'Done! It has been deployed to production.',
    'The site was published to https://x.example.com.',
    'App deploy ho gaya, link share kar do.',
    'Successfully deployed!',
  ]) {
    it(`"${said}" with no deploy this turn is corrected`, () => {
      expect(kinds(said, false)).toContain('deploy-claimed');
    });
    it(`"${said}" after a deploy that succeeded is left alone`, () => {
      expect(kinds(said, true)).not.toContain('deploy-claimed');
    });
    it(`"${said}" when the fact is unknown (already live, or unreadable) is left alone`, () => {
      expect(kinds(said, undefined)).not.toContain('deploy-claimed');
    });
  }
  for (const offer of [
    'Your app is ready — press Publish to make it live.',
    'It is not deployed yet.',
    'When you are ready to deploy, tap Publish.',
    'Would you like me to deploy it?',
    'Aap Publish dabaiye, tab app live ho jayega.',
    'The app is ready to deploy.',
  ]) {
    it(`never fires on an offer or an instruction: "${offer}"`, () => {
      expect(deployClaimed(offer)).toBe(false);
      expect(kinds(offer, false)).not.toContain('deploy-claimed');
    });
  }
});

describe('the fact itself (deployedThisTurn.ts)', () => {
  it('a deploy that succeeded this turn ⇒ true', async () => {
    expect(await deployedThisTurn('w', () => true, { read: async () => null })).toBe(true);
  });
  it('no deploy and nothing live ⇒ false', async () => {
    expect(await deployedThisTurn('w', () => false, { read: async () => null })).toBe(false);
  });
  it('already live from an earlier Publish ⇒ unknown (silence)', async () => {
    expect(await deployedThisTurn('w', () => false, { read: async () => ({ url: 'https://a.app', status: 'active' } as any) })).toBeUndefined();
  });
  it('a store that is slow or throws ⇒ unknown, never a guess, never a hang', async () => {
    expect(await deployedThisTurn('w', () => false, { read: () => new Promise(() => {}) }, 20)).toBeUndefined();
    expect(await deployedThisTurn('w', () => false, { read: async () => { throw new Error('down'); } })).toBeUndefined();
  });
  it('the build route asks it and hands it to the audit (one call — the handler only shrinks)', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain("const deployedNow = await deployedThisTurn(workspaceId, () => buildDiag.toolWasUsed('deploy'));");
    expect(route).toContain('deployedThisTurn: deployedNow,');
  });
});
