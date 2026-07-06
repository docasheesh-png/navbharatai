import { describe, it, expect } from 'vitest';
import {
  parseChatRole, roleSystemPrompt, parseProposedSteps, stripStepsBlock,
  selectRoleContextFiles, formatRoleContext,
  ROLE_CONTEXT_MAX_FILES, ROLE_CONTEXT_MAX_FILE_CHARS,
} from './RoleChats';
import { MAX_QUEUE_ITEMS } from './BuildQueue';

describe('parseChatRole', () => {
  it('accepts exactly the two roles, rejects everything else (the normal lane)', () => {
    expect(parseChatRole('planner')).toBe('planner');
    expect(parseChatRole('advisor')).toBe('advisor');
    expect(parseChatRole('main')).toBeNull();
    expect(parseChatRole('')).toBeNull();
    expect(parseChatRole(undefined)).toBeNull();
    expect(parseChatRole(42)).toBeNull();
  });
});

describe('roleSystemPrompt', () => {
  it('both roles are explicitly read-only and carry the shared steps contract', () => {
    for (const role of ['planner', 'advisor'] as const) {
      const p = roleSystemPrompt(role);
      expect(p).toMatch(/NEVER build or edit/i);
      expect(p).toContain('```steps');
    }
    expect(roleSystemPrompt('planner')).toMatch(/PLANNER/);
    expect(roleSystemPrompt('advisor')).toMatch(/ADVISOR/);
  });
});

describe('parseProposedSteps — the strict output contract', () => {
  it('parses a fenced steps block of strings, in order', () => {
    const reply = 'Here is the plan.\n```steps\n["Build the login page", "Add the API"]\n```';
    expect(parseProposedSteps(reply)).toEqual(['Build the login page', 'Add the API']);
  });

  it('accepts {prompt} objects, trims, drops blanks, dedupes', () => {
    const reply = '```steps\n[{"prompt":" Do X "}, "", "Do X", "Do Y"]\n```';
    expect(parseProposedSteps(reply)).toEqual(['Do X', 'Do Y']);
  });

  it('caps at MAX_QUEUE_ITEMS so nothing unbounded reaches the queue', () => {
    const many = JSON.stringify(Array.from({ length: 40 }, (_, i) => `step ${i}`));
    expect(parseProposedSteps('```steps\n' + many + '\n```')).toHaveLength(MAX_QUEUE_ITEMS);
  });

  it('malformed input → [] (no block / bad JSON / non-array / null)', () => {
    expect(parseProposedSteps('just prose, no steps')).toEqual([]);
    expect(parseProposedSteps('```steps\nnot json\n```')).toEqual([]);
    expect(parseProposedSteps('```steps\n{"a":1}\n```')).toEqual([]);
    expect(parseProposedSteps(null)).toEqual([]);
    expect(parseProposedSteps(undefined)).toEqual([]);
  });
});

describe('stripStepsBlock', () => {
  it('removes the machine block so the chat shows clean prose', () => {
    const reply = 'Plan below.\n```steps\n["a"]\n```\nDone.';
    expect(stripStepsBlock(reply)).toBe('Plan below.\n\nDone.');
  });
  it('is a no-op when there is no block', () => {
    expect(stripStepsBlock('no block here')).toBe('no block here');
  });
});

describe('selectRoleContextFiles — deterministic, bounded grounding', () => {
  const files = {
    'src/login/LoginPage.tsx': 'export function LoginPage() { /* login form */ }',
    'src/api/auth.ts': 'export async function login(email, password) {}',
    'src/unrelated/Chart.tsx': 'chart rendering code',
    'assets/logo.png': 'binary-ish',
    'package-lock.json': '{}',
  };

  it('picks path/content matches for the prompt, path hits ranked highest', () => {
    const picked = selectRoleContextFiles(files, 'audit the login flow');
    expect(picked.map((f) => f.path)).toEqual(['src/login/LoginPage.tsx', 'src/api/auth.ts']);
  });

  it('skips binary/lock files and returns [] when nothing matches', () => {
    const picked = selectRoleContextFiles(files, 'zzz-nothing-matches');
    expect(picked).toEqual([]);
  });

  it('bounds file count and per-file size', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 20; i++) many[`src/login/f${i}.ts`] = 'login '.repeat(2000); // ~12k chars each
    const picked = selectRoleContextFiles(many, 'login');
    expect(picked.length).toBeLessThanOrEqual(ROLE_CONTEXT_MAX_FILES);
    for (const f of picked) expect(f.content.length).toBeLessThanOrEqual(ROLE_CONTEXT_MAX_FILE_CHARS);
  });

  it('is deterministic — same inputs, same picks', () => {
    expect(selectRoleContextFiles(files, 'login')).toEqual(selectRoleContextFiles(files, 'login'));
  });
});

describe('formatRoleContext', () => {
  it('labels the context honestly (bounded subset, empty-match note)', () => {
    const withFiles = formatRoleContext('src/\n  a.ts', [{ path: 'src/a.ts', content: 'x' }]);
    expect(withFiles).toContain('REAL PROJECT CONTEXT');
    expect(withFiles).toContain('--- src/a.ts ---');
    expect(withFiles).toContain('not the whole project');
    const noFiles = formatRoleContext('src/', []);
    expect(noFiles).toContain('no file contents matched');
  });
});
