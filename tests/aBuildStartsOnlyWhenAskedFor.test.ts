// Q-200 and Q-201 (admin 2026-10-03): a build starts only when the message confirms it, a "yes" to our offer
// builds the offered request, and a file sent in a chat is kept for that chat alone.
import { readFileSync } from 'fs';
import { describe, it, expect, beforeEach } from 'vitest';
import { buildConfirmation, isOfferAcceptance, buildConfirmationEnabled, OFFER_LIFETIME_MS } from '../src/server/AgentV3/buildConfirmation';
import {
  saveAttachmentMemory, loadAttachmentMemory, deleteAttachmentMemory, shouldRecallAttachment,
  refersToEarlierAttachment, clampUtf8, rememberableUid, _resetAttachmentMemory,
  ATTACHMENT_MEMORY_MAX_BYTES, ATTACHMENT_MEMORY_TTL_MS, attachmentMemoryEnabled,
} from '../src/server/lib/attachmentMemory';
import { WorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { wasBuildRequest } from '../src/server/AgentV3/planningRequest';
import { purgeWorkspace } from '../src/server/AgentV3/WorkspaceManager';

const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

describe('a build starts only when the message confirms it (Q-200)', () => {
  it('the report\'s own prompts are answered, not built', () => {
    // Autopsy 3f959fde and a4be7fa2, verbatim openings.
    expect(buildConfirmation('Ipudu e data ni check cheyu, e algorithm suitable avutundi').confirmed).toBe(false);
    expect(buildConfirmation('First data table lo draws check chesi e algorithm suitable check cheyu').confirmed).toBe(false);
  });

  it('a question is answered first, even when it names an app', () => {
    expect(buildConfirmation('Can you build me a todo app?')).toEqual({ confirmed: false, reason: 'question' });
    expect(buildConfirmation('kya tum mere liye ek calculator app bana sakte ho?').confirmed).toBe(false);
    expect(buildConfirmation('which algorithm is best for lottery prediction').confirmed).toBe(false);
  });

  it('an order that names what to build still builds at once', () => {
    expect(buildConfirmation('build a notes app').confirmed).toBe(true);
    expect(buildConfirmation('ek billing app banao').confirmed).toBe(true);
    expect(buildConfirmation('एक टूडू ऐप बनाओ').confirmed).toBe(true);
    expect(buildConfirmation('Create a complete Hospital OPD Management System with billing and pharmacy').confirmed).toBe(true);
    expect(buildConfirmation('a todo app for my shop with categories').confirmed).toBe(true);
  });

  it('pasted source stays a build; long text that names nothing does not', () => {
    const html = '<!doctype html>\n<html><head><title>Bill</title></head><body><button id="add">Add</button><script>let x=1;</script></body></html>';
    expect(buildConfirmation(html).confirmed).toBe(true);
    const instructions = 'You are an expert assistant. Always call me Boss, answer in Hindi, keep every answer short, never guess, and tell me when you do not know something for certain please.';
    expect(buildConfirmation(instructions)).toEqual({ confirmed: false, reason: 'names-nothing-to-build' });
  });

  it('an explicit edit is never questioned', () => {
    expect(buildConfirmation('fix the login button colour').confirmed).toBe(true);
    expect(buildConfirmation('continue').confirmed).toBe(true);
  });

  it('a short yes is an acceptance; a yes with a new request is not', () => {
    for (const m of ['haan', 'Haan bana do', 'yes please', 'ok build it', 'avunu', 'हाँ बना दो', 'go ahead', 'theek hai bana do']) {
      expect(isOfferAcceptance(m), m).toBe(true);
    }
    for (const m of ['haan par pehle batao kitna time lagega', 'no', 'please', '', 'yes but make it red', 'nahi']) {
      expect(isOfferAcceptance(m), m).toBe(false);
    }
  });

  it('the switch defaults on and turns off only on "off"', () => {
    expect(buildConfirmationEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(buildConfirmationEnabled({ AGENTV3_CONFIRM_BUILD: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(OFFER_LIFETIME_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('an offer turn is remembered with its time, and is not a spec until it is accepted', () => {
    const mem = new WorkspaceMemory();
    mem.recordRequest('Ipudu e data ni check cheyu', 1000, 'offer');
    expect(mem.lastRequestTurn()).toEqual({ text: 'Ipudu e data ni check cheyu', lane: 'offer', ts: 1000 });
    expect(wasBuildRequest({ text: 'Ipudu e data ni check cheyu', lane: 'offer' })).toBe(false);
  });

  it('the route: an unconfirmed build is answered and offered; a yes builds the offered request', () => {
    expect(route).toContain("const offerToBuild = buildCheck !== null && !buildCheck.confirmed;");
    expect(route).toContain("(intent === 'new_build' || (intent === 'edit_existing' && !earlierRequestLeftAnApp))");
    const accept = route.indexOf('if (offerAccepted && lastRequestTurn) {');
    expect(accept).toBeGreaterThan(0);
    expect(route.slice(accept, accept + 300)).toContain('prompt = lastRequestTurn.text;');
    expect(route).toContain("chatMem.recordRequest(prompt, undefined, answerThenOffer ? 'offer' : 'chat');");
    expect(route).toContain("+ (answerThenOffer ? BUILD_OFFER_STEER : '')");
    // The chat history keeps what the user typed.
    expect(route).toContain("{ role: 'user', content: typedPrompt, ts: buildStartedAt },");
    // The guard runs before the chat lane decides.
    expect(route.indexOf('const offerToBuild =')).toBeLessThan(route.indexOf('const isPlainChatTurn ='));
  });
});

describe('a file sent in a chat stays in that chat (Q-201)', () => {
  beforeEach(() => _resetAttachmentMemory());

  it('is kept for the same account and chat, and for no other', async () => {
    expect(await saveAttachmentMemory({ uid: 'u1', workspaceId: 'agentv3-u1-a', text: 'draw,number\n1,42', names: ['kerala.xlsx'], now: 1000 })).toBe(true);
    expect((await loadAttachmentMemory('u1', 'agentv3-u1-a', 2000))?.text).toBe('draw,number\n1,42');
    expect(await loadAttachmentMemory('u1', 'agentv3-u1-b', 2000)).toBeNull();
    expect(await loadAttachmentMemory('u2', 'agentv3-u1-a', 2000)).toBeNull();
  });

  it('is never kept for an anonymous caller', async () => {
    expect(rememberableUid('anon')).toBe(false);
    expect(rememberableUid(null)).toBe(false);
    expect(await saveAttachmentMemory({ uid: 'anon', workspaceId: 'agentv3-anon-a', text: 'x', names: [] })).toBe(false);
  });

  it('expires after 30 days and is deleted on the way out', async () => {
    await saveAttachmentMemory({ uid: 'u1', workspaceId: 'w', text: 'rows', names: [], now: 0 });
    expect(await loadAttachmentMemory('u1', 'w', ATTACHMENT_MEMORY_TTL_MS + 1)).toBeNull();
    expect(await loadAttachmentMemory('u1', 'w', 1)).toBeNull();
  });

  it('is cut to 50 KB without splitting a character', async () => {
    const big = 'अ'.repeat(30_000); // 3 bytes each
    const c = clampUtf8(big, ATTACHMENT_MEMORY_MAX_BYTES);
    expect(c.truncated).toBe(true);
    expect(Buffer.byteLength(c.text, 'utf8')).toBeLessThanOrEqual(ATTACHMENT_MEMORY_MAX_BYTES);
    await saveAttachmentMemory({ uid: 'u1', workspaceId: 'w', text: big, names: [] });
    expect((await loadAttachmentMemory('u1', 'w'))?.truncated).toBe(true);
  });

  it('is handed back only when the chat talks about it, or says yes to an offer', () => {
    expect(refersToEarlierAttachment('First data table lo draws check chesi')).toBe(true);
    expect(refersToEarlierAttachment('is file ka analysis karo')).toBe(true);
    expect(refersToEarlierAttachment('इस डेटा को देखो')).toBe(true);
    expect(refersToEarlierAttachment('make it blue')).toBe(false);
    expect(refersToEarlierAttachment('build a todo list app')).toBe(false);
    expect(shouldRecallAttachment({ message: 'haan', hasAttachmentNow: false, offerAccepted: true })).toBe(true);
    expect(shouldRecallAttachment({ message: 'haan', hasAttachmentNow: false, offerAccepted: false })).toBe(false);
    expect(shouldRecallAttachment({ message: 'check this data', hasAttachmentNow: true, offerAccepted: false })).toBe(false);
  });

  it('is deleted with the chat and on unsend', async () => {
    await saveAttachmentMemory({ uid: 'u1', workspaceId: 'w', text: 'rows', names: [] });
    await deleteAttachmentMemory('w');
    expect(await loadAttachmentMemory('u1', 'w')).toBeNull();
    const calls: string[] = [];
    const noop = async () => {};
    const res = await purgeWorkspace({
      removeConversation: noop, purgeFiles: noop, deletePlan: noop, deleteMemory: noop, deleteDiagnostics: noop,
      releaseDeployment: noop, deleteAttachmentMemory: async (id) => { calls.push(id); },
    }, 'w');
    expect(calls).toEqual(['w']);
    expect(res.stores.map((s) => s.store)).toContain('attachment-memory');
    expect(route).toContain('deleteAttachmentMemory,');
    expect(route).toContain('await deleteAttachmentMemory(cid).catch(');
  });

  it('the route keeps documents only, masked, and recalls before the chat lane', () => {
    expect(route).toContain("rememberableDocs = docs ? redactPII(docs) : '';");
    // A bare yes recalls only the file that came with the offer.
    expect(route).toContain('loaded.savedAt >= lastRequestTurn.ts - 10 * 60_000');
    expect(route.indexOf("fenceUntrusted('attached files (sent earlier in this chat)'")).toBeLessThan(route.indexOf('const isPlainChatTurn ='));
    expect(attachmentMemoryEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(attachmentMemoryEnabled({ AGENTV3_ATTACHMENT_MEMORY: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });
});
