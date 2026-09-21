/**
 * Engine wiring for generic per-user professional memory (admin 2026-07-15) — regression lock.
 *
 * Locks the exact contract: the stored profile + memory layer reach the SYSTEM prompt,
 * the model's <user_memory> block never reaches the user, facts are validated against
 * the config's declared fields and persisted ONLY for a verified user on a memory-enabled
 * professional, and memory-off professionals are unaffected (replies still defensively stripped).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getRouterMock = vi.fn();
vi.mock('../src/server/AI/AIRouterManager', () => ({
  AIRouterManager: { getRouter: (ns: string) => getRouterMock(ns) },
}));

const loadMock = vi.fn();
const saveMock = vi.fn();
vi.mock('../src/server/professionals/ClientProfileStore', () => ({
  clientProfileStore: {
    load: (...args: unknown[]) => loadMock(...args),
    save: (...args: unknown[]) => saveMock(...args),
  },
}));

import { runProfessionalChat, buildProfessionalSystemPrompt } from '../src/server/professionals/engine';
import type { ProfessionalConfig } from '../src/server/professionals/types';

const TEACHER: ProfessionalConfig = {
  id: 'teacher_ai',
  name: 'Teacher AI',
  systemPrompt: 'You are Teacher AI.',
  memory: {
    subject: 'student',
    intake: 'Learn their name, college, exams and weak subjects.',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'college', label: 'School/College' },
      { key: 'targetExams', label: 'Preparing for', list: true },
      { key: 'weakSubjects', label: 'Weak subjects', list: true },
    ],
  },
};

const PLAIN: ProfessionalConfig = {
  id: 'plain_ai',
  name: 'Plain AI',
  systemPrompt: 'You are Plain AI.',
};

function routerCapturing(content: string) {
  return {
    routeRaced: vi.fn().mockImplementation(async (_prompt: string, _system: string) => ({
      response: { content },
      telemetry: { success: true },
    })),
  };
}

describe('professional engine — generic per-user memory', () => {
  beforeEach(() => {
    getRouterMock.mockReset();
    loadMock.mockReset().mockResolvedValue(null);
    saveMock.mockReset().mockResolvedValue(undefined);
  });

  it('injects the stored profile + memory layer into the system prompt for a verified user', async () => {
    loadMock.mockResolvedValue({ name: 'Ravi', weakSubjects: ['Organic Chemistry'] });
    const router = routerCapturing('Hello Ravi!');
    getRouterMock.mockReturnValue(router);

    await runProfessionalChat(TEACHER, 'namaste', [], 'uid-1');

    expect(loadMock).toHaveBeenCalledWith('uid-1', 'teacher_ai');
    const systemPrompt = router.routeRaced.mock.calls[0][1] as string;
    expect(systemPrompt).toMatch(/WHAT YOU ALREADY KNOW ABOUT THIS STUDENT/);
    expect(systemPrompt).toMatch(/Ravi/);
    expect(systemPrompt).toMatch(/Organic Chemistry/);
    expect(systemPrompt).toMatch(/FIRST MEETING/);
  });

  it('strips the <student_memory> block from the reply and saves the merged profile', async () => {
    loadMock.mockResolvedValue({ name: 'Ravi' });
    getRouterMock.mockReturnValue(
      routerCapturing('Nice to meet you!\n<student_memory>{"college":"DAV College","targetExams":["NEET"]}</student_memory>'),
    );

    const reply = await runProfessionalChat(TEACHER, 'I study at DAV College, preparing NEET', [], 'uid-1');

    expect(reply).toBe('Nice to meet you!');
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith('uid-1', 'teacher_ai', {
      name: 'Ravi',
      college: 'DAV College',
      targetExams: ['NEET'],
    });
  });

  it('anonymous user: introduction layer present, honest no-persistence variant, nothing loaded or saved', async () => {
    const router = routerCapturing('Welcome! What is your name?');
    getRouterMock.mockReturnValue(router);

    const reply = await runProfessionalChat(TEACHER, 'namaste');

    expect(reply).toBe('Welcome! What is your name?');
    const systemPrompt = router.routeRaced.mock.calls[0][1] as string;
    expect(systemPrompt).toMatch(/FIRST MEETING/);
    expect(systemPrompt).toMatch(/NOT signed in/);
    expect(loadMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('memory-off professional: no memory layer, no store calls, but a leaked block is still stripped', async () => {
    const router = routerCapturing('Answer.\n<student_memory>{"name":"X"}</student_memory>');
    getRouterMock.mockReturnValue(router);

    const reply = await runProfessionalChat(PLAIN, 'hello', [], 'uid-1');

    expect(reply).toBe('Answer.');
    const systemPrompt = router.routeRaced.mock.calls[0][1] as string;
    expect(systemPrompt).not.toMatch(/FIRST MEETING/);
    expect(loadMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('a reply that is ONLY a memory block never leaks it — a safe line is returned instead', async () => {
    getRouterMock.mockReturnValue(routerCapturing('<student_memory>{"name":"Ravi"}</student_memory>'));

    const reply = await runProfessionalChat(TEACHER, 'my name is Ravi', [], 'uid-1');

    expect(reply).not.toMatch(/student_memory/);
    expect(reply.length).toBeGreaterThan(0);
    // `name` is BOTH a Teacher field and a shared one, so it is saved to both profiles (2026-09-21).
    expect(saveMock).toHaveBeenCalledWith('uid-1', 'teacher_ai', { name: 'Ravi' });
    expect(saveMock).toHaveBeenCalledWith('uid-1', '_shared', { name: 'Ravi' });
    expect(saveMock).toHaveBeenCalledTimes(2);
  });

  // ── THE SHARED IDENTITY (admin 2026-09-21: "user ka naam, profession … woh yaad rakhna hai") ──────
  it('a name learned by ANOTHER expert greets the user here — the shared profile is loaded and injected', async () => {
    // Teacher's own profile is empty; the shared one (written by, say, the Lawyer) knows the name.
    loadMock.mockImplementation(async (_uid: string, id: string) => (id === '_shared' ? { name: 'Priya', occupation: 'CA student' } : null));
    const router = routerCapturing('Hello Priya!');
    getRouterMock.mockReturnValue(router);

    await runProfessionalChat(TEACHER, 'namaste', [], 'uid-1');

    expect(loadMock).toHaveBeenCalledWith('uid-1', 'teacher_ai');
    expect(loadMock).toHaveBeenCalledWith('uid-1', '_shared');
    const systemPrompt = router.routeRaced.mock.calls[0][1] as string;
    expect(systemPrompt).toMatch(/WHAT YOU ALREADY KNOW ABOUT THIS STUDENT/);
    expect(systemPrompt).toMatch(/Priya/);
    // `occupation` is not a TEACHER field, yet it is rendered: the effective fields include the shared ones.
    expect(systemPrompt).toMatch(/CA student/);
  });

  it("the professional's OWN value wins over the shared one for the same key", async () => {
    loadMock.mockImplementation(async (_uid: string, id: string) => (id === '_shared' ? { name: 'P. Sharma' } : { name: 'Priya' }));
    const router = routerCapturing('Hi!');
    getRouterMock.mockReturnValue(router);

    await runProfessionalChat(TEACHER, 'hi', [], 'uid-1');

    const systemPrompt = router.routeRaced.mock.calls[0][1] as string;
    expect(systemPrompt).toMatch(/• Name: Priya/);
    expect(systemPrompt).not.toMatch(/P\. Sharma/);
  });

  it('"remember this" is saved to the SHARED profile only — never into the professional\'s own', async () => {
    loadMock.mockResolvedValue(null);
    getRouterMock.mockReturnValue(
      routerCapturing('Done.\n<user_memory>{"remember":["I prefer replies in Hinglish"],"college":"DAV College"}</user_memory>'),
    );

    await runProfessionalChat(TEACHER, 'isko yaad rakhna: Hinglish me reply dena', [], 'uid-1');

    expect(saveMock).toHaveBeenCalledWith('uid-1', 'teacher_ai', { college: 'DAV College' });
    expect(saveMock).toHaveBeenCalledWith('uid-1', '_shared', { remember: ['I prefer replies in Hinglish'] });
    expect(saveMock).toHaveBeenCalledTimes(2);
  });

  it('a `remember` entry is DROPPED when the user never asked — and kept when they did', async () => {
    loadMock.mockResolvedValue(null);
    getRouterMock.mockReturnValue(routerCapturing('Noted.\n<user_memory>{"remember":["likes cricket"],"college":"DAV"}</user_memory>'));
    await runProfessionalChat(TEACHER, 'I play cricket on weekends', [], 'uid-1');
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith('uid-1', 'teacher_ai', { college: 'DAV' });

    saveMock.mockClear();
    getRouterMock.mockReturnValue(routerCapturing('Done.\n<user_memory>{"remember":["I play cricket on weekends"]}</user_memory>'));
    await runProfessionalChat(TEACHER, 'yaad rakhna: I play cricket on weekends', [], 'uid-1');
    expect(saveMock).toHaveBeenCalledWith('uid-1', '_shared', { remember: ['I play cricket on weekends'] });
  });

  it('a shared key the professional did NOT declare still reaches the shared profile, and not its own', async () => {
    loadMock.mockResolvedValue(null);
    getRouterMock.mockReturnValue(routerCapturing('Noted.\n<user_memory>{"location":"Lucknow"}</user_memory>'));

    await runProfessionalChat(TEACHER, 'main Lucknow se hoon', [], 'uid-1');

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith('uid-1', '_shared', { location: 'Lucknow' });
  });

  it('the shared block is NOT injected for an anonymous user, and no memory block is asked for', async () => {
    const router = routerCapturing('Welcome!');
    getRouterMock.mockReturnValue(router);
    await runProfessionalChat(TEACHER, 'hi');
    const systemPrompt = router.routeRaced.mock.calls[0][1] as string;
    expect(loadMock).not.toHaveBeenCalled();
    // The RULE mentioning the section is always present; the SECTION itself (the rendered block) is not.
    expect(systemPrompt).not.toMatch(/WHAT YOU ALREADY KNOW ABOUT THIS STUDENT \(remembered/);
    // …and an anonymous user is never asked for a memory block at all, shared keys included.
    expect(systemPrompt).not.toMatch(/"remember"/);
    expect(systemPrompt).toMatch(/Do not output any <user_memory> block/);
  });

  it('buildProfessionalSystemPrompt places the memory block into the assembled prompt', () => {
    const prompt = buildProfessionalSystemPrompt(PLAIN, 'KB BLOCK', 'MEMORY BLOCK');
    expect(prompt).toMatch(/MEMORY BLOCK/);
    expect(prompt).toMatch(/KB BLOCK/);
  });

  it('EVERY professional gets the shared expert-depth method layer', () => {
    // The depth layer must be present even for a config with no bespoke method.
    const prompt = buildProfessionalSystemPrompt(PLAIN);
    expect(prompt).toMatch(/HOW A TOP EXPERT IN YOUR FIELD ACTUALLY WORKS/);
    expect(prompt).toMatch(/GO DEEP/);
  });

  it("a config's signature method is injected prominently when present", () => {
    const withMethod: ProfessionalConfig = { ...PLAIN, method: 'STEP-A then STEP-B then STEP-C.' };
    const prompt = buildProfessionalSystemPrompt(withMethod);
    expect(prompt).toMatch(/YOUR SIGNATURE METHOD/);
    expect(prompt).toMatch(/STEP-A then STEP-B/);
    // and the shared depth layer still applies on top
    expect(prompt).toMatch(/HOW A TOP EXPERT IN YOUR FIELD ACTUALLY WORKS/);
    // no signature-method heading when a config has none
    expect(buildProfessionalSystemPrompt(PLAIN)).not.toMatch(/YOUR SIGNATURE METHOD/);
  });
});
