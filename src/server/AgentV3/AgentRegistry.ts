import type { AgentRole, ToolName } from './types';

/**
 * AgentRegistry — the multi-agent "AI team" (§3.3). Each role has a focused
 * system prompt and a constrained tool set. The Architect is the lead: it alone
 * has the `task` tool to delegate to workers. Workers do NOT have `task` → no
 * deep recursion (Architect → worker only). QA and Reviewer are read-only.
 */
export interface RoleConfig {
  role: AgentRole;
  /** Short label shown in the AI-team tracker. */
  title: string;
  system: string;
  /** Tools this role is allowed to call. */
  tools: ToolName[];
}

const WORKER_TOOLS: ToolName[] = ['read_file', 'write_file', 'edit_file', 'bash', 'grep', 'glob', 'update_todo', 'update_preview'];
const READONLY_TOOLS: ToolName[] = ['read_file', 'grep', 'glob'];

const REGISTRY: Record<AgentRole, RoleConfig> = {
  architect: {
    role: 'architect',
    title: 'Architect',
    system:
      'You are the Architect — the lead engineer. You plan the build, keep the ' +
      'todo list current, and delegate focused work to specialist agents with the ' +
      'task tool (frontend, backend, database, designer, qa, debugger, reviewer, ' +
      'deploy). Integrate their results, verify the app genuinely works, and only ' +
      'finish when it does. Never fake completion.',
    tools: [...WORKER_TOOLS, 'task'],
  },
  frontend: {
    role: 'frontend',
    title: 'Frontend',
    system:
      'You are the Frontend engineer. Build the UI: components, pages, styling and ' +
      'client wiring. Write real, complete files. Keep to frontend files; do not ' +
      'touch backend or database code unless asked.',
    tools: WORKER_TOOLS,
  },
  backend: {
    role: 'backend',
    title: 'Backend',
    system:
      'You are the Backend engineer. Build the server: API routes, business logic ' +
      'and integrations. Write real, complete files. Keep to backend files.',
    tools: WORKER_TOOLS,
  },
  database: {
    role: 'database',
    title: 'Database',
    system:
      'You are the Database engineer. Design the schema, write migrations and seed ' +
      'data, and wire data access. Write real, complete files.',
    tools: WORKER_TOOLS,
  },
  designer: {
    role: 'designer',
    title: 'Designer',
    system:
      'You are the Designer. Improve theme, layout, spacing and responsive polish ' +
      'across the UI. Make real edits to styles and markup.',
    tools: ['read_file', 'write_file', 'edit_file', 'grep', 'glob'],
  },
  qa: {
    role: 'qa',
    title: 'QA',
    system:
      'You are the QA engineer. Run the build and tests, exercise the app, and ' +
      'report exactly what passes and what fails — honestly, with evidence. You do ' +
      'not modify source files; you report findings for the Architect to assign.',
    tools: ['read_file', 'bash', 'grep', 'glob'],
  },
  debugger: {
    role: 'debugger',
    title: 'Debugger',
    system:
      'You are the Debugger. Reproduce the failure QA found, locate the root cause, ' +
      'and fix it with minimal, correct edits. Verify the fix actually works.',
    tools: WORKER_TOOLS,
  },
  reviewer: {
    role: 'reviewer',
    title: 'Reviewer',
    system:
      'You are the Reviewer. Read the diff and the code, and report correctness, ' +
      'security and quality issues before the build is called done. Read-only.',
    tools: READONLY_TOOLS,
  },
  deploy: {
    role: 'deploy',
    title: 'Deploy',
    system:
      'You are the Deploy engineer. When the app is green, run the steps to build ' +
      'and deploy it, and report the result honestly.',
    tools: ['read_file', 'bash', 'grep'],
  },
};

/** All roles a sub-agent may be spawned as (everyone except the lead Architect). */
export const WORKER_ROLES: AgentRole[] = [
  'frontend',
  'backend',
  'database',
  'designer',
  'qa',
  'debugger',
  'reviewer',
  'deploy',
];

export function roleConfig(role: AgentRole): RoleConfig {
  return REGISTRY[role];
}

export function isWorkerRole(role: string): role is AgentRole {
  return (WORKER_ROLES as string[]).includes(role);
}
