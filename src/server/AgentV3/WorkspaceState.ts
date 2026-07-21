import type { AgentEventStream } from './AgentEventStream';
import type { AgentRole, FileChange, GitCheckpoint, TodoItem, WorkspaceSnapshot } from './types';
import { mergeTodoLists } from './todoMerge';

/**
 * WorkspaceState — the single source of truth a v5.0 session's surfaces read
 * from. Tracks the file change log, todos, plan, git checkpoints, and terminal
 * output. Every mutation optionally broadcasts on an AgentEventStream so the
 * surfaces stay in sync with zero drift (NAVBHARATAI_PRO_V3_DESIGN.md §3.2).
 *
 * P0: the container + snapshot are real and tested. Actual file *contents* live
 * in the sandbox actuator (wired in P1); here we hold the change log + metadata
 * the surfaces render.
 */
export class WorkspaceState {
  private readonly files = new Map<string, FileChange>();
  private todos: TodoItem[] = [];
  private plan = '';
  private readonly checkpoints: GitCheckpoint[] = [];
  private readonly terminalLines: string[] = [];

  constructor(private readonly events?: AgentEventStream) {}

  /** Record a file create/modify/delete and broadcast it to the surfaces. */
  recordFileChange(change: FileChange, agent: AgentRole = 'architect'): void {
    if (change.kind === 'delete') this.files.delete(change.path);
    else this.files.set(change.path, change);
    this.events?.emit({ type: 'file_changed', agent, change, ts: Date.now() });
  }

  setTodos(todos: TodoItem[]): void {
    // ONE continuous plan (admin 2026-07-21): a fresh sub-plan mid-build must never reset the
    // user's "Plan x/y" back to 0/y — merge instead of replace (see todoMerge.ts for the rules:
    // done items are kept forever, stale pending items are pruned, new items append).
    this.todos = mergeTodoLists(this.todos, todos);
    this.events?.emit({ type: 'todo_updated', todos: this.todos, ts: Date.now() });
  }

  setPlan(plan: string): void {
    this.plan = plan;
    this.events?.emit({ type: 'plan_updated', plan, ts: Date.now() });
  }

  addCheckpoint(checkpoint: GitCheckpoint): void {
    this.checkpoints.push(checkpoint);
    this.events?.emit({ type: 'checkpoint', checkpoint, ts: Date.now() });
  }

  appendTerminal(line: string): void {
    this.terminalLines.push(line);
  }

  /** An immutable snapshot a newly-mounted surface can hydrate from. */
  snapshot(): WorkspaceSnapshot {
    return {
      files: [...this.files.values()],
      todos: [...this.todos],
      plan: this.plan,
      checkpoints: [...this.checkpoints],
      terminalLines: [...this.terminalLines],
    };
  }
}
