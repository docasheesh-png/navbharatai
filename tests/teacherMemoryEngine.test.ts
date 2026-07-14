/**
 * Engine wiring for student-profile memory (Teacher AI, admin 2026-07-14) — regression lock.
 *
 * Locks the exact contract: the stored profile + memory layer reach the SYSTEM prompt,
 * the model's <student_memory> block never reaches the user, facts are persisted ONLY
 * for a verified user on a memory-enabled professional, and memory-off professionals
 * are byte-for-byte unaffected (their replies are still defensively stripped).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getRouterMock = vi.fn();
vi.mock('../src/server/AI/AIRouterManager', () => ({
  AIRouterManager: { getRouter: (ns: string) => getRouterMock(ns) },
}));

const loadMock = vi.fn();
const saveMock = vi.fn();
vi.mock('../src/server/professionals/StudentProfileStore', () => ({
  studentProfileStore: {
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
  memory: 'student_profile',
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

describe('professional engine — student-profile memory', () => {
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
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it('buildProfessionalSystemPrompt places the memory block into the assembled prompt', () => {
    const prompt = buildProfessionalSystemPrompt(PLAIN, 'KB BLOCK', 'MEMORY BLOCK');
    expect(prompt).toMatch(/MEMORY BLOCK/);
    expect(prompt).toMatch(/KB BLOCK/);
  });
});
