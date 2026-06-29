/**
 * P-TQA.4 — deterministic mock AI provider for prompt/output regression tests.
 *
 * Real provider calls are non-deterministic, slow, and cost money — useless for a fast CI gate.
 * This stub returns CANNED tool-call sequences for a fixed set of "golden" build requests, so the
 * regression suite can feed AI-shaped output through the REAL evaluation pipeline (WorkspaceMemory
 * graph build → analyzeArchitecture) and assert the pipeline catches bad output (hallucinated
 * imports, server-only builtins in the frontend) and passes good output — with zero network/API.
 *
 * `applyToolCalls()` mirrors production exactly: ToolDispatcher routes a successful `write_file`
 * into `WorkspaceMemory.indexFile(path, content)` (ToolDispatcher.ts), which is what this calls.
 */
import type { WorkspaceMemory } from '../../src/server/AgentV3/WorkspaceMemory';

export interface MockToolCall {
  name: 'write_file';
  args: { path: string; content: string };
}

/** A minimal deterministic provider: prompt → canned tool calls. */
export class MockAiProvider {
  constructor(private readonly golden: Record<string, MockToolCall[]>) {}

  /** Return the canned tool-call sequence for a known prompt (empty if unknown). */
  respond(prompt: string): MockToolCall[] {
    return this.golden[prompt] ?? [];
  }
}

/** Apply a mock tool-call sequence to a WorkspaceMemory exactly as ToolDispatcher would. */
export function applyToolCalls(mem: WorkspaceMemory, calls: MockToolCall[]): void {
  for (const call of calls) {
    if (call.name === 'write_file') {
      mem.indexFile(call.args.path, call.args.content);
    }
  }
}

// ── Golden fixtures ─────────────────────────────────────────────────────────

/** A correct React + Vite todo app: all local imports resolve, no server-only builtins. */
const GOOD_TODO_APP: MockToolCall[] = [
  {
    name: 'write_file',
    args: {
      path: 'src/App.tsx',
      content: [
        "import { useState } from 'react';",
        "import { TodoList } from './components/TodoList';",
        '',
        'export function App() {',
        "  const [todos, setTodos] = useState<string[]>([]);",
        '  return <TodoList todos={todos} onAdd={(t) => setTodos([...todos, t])} />;',
        '}',
      ].join('\n'),
    },
  },
  {
    name: 'write_file',
    args: {
      path: 'src/components/TodoList.tsx',
      content: [
        "import { useState } from 'react';",
        '',
        'export function TodoList({ todos, onAdd }: { todos: string[]; onAdd: (t: string) => void }) {',
        "  const [draft, setDraft] = useState('');",
        '  return (',
        '    <div>',
        '      <input value={draft} onChange={(e) => setDraft(e.target.value)} />',
        '      <button onClick={() => onAdd(draft)}>Add</button>',
        '      <ul>{todos.map((t, i) => <li key={i}>{t}</li>)}</ul>',
        '    </div>',
        '  );',
        '}',
      ].join('\n'),
    },
  },
  {
    name: 'write_file',
    args: {
      path: 'package.json',
      content: JSON.stringify(
        { name: 'todo', dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' } },
        null,
        2,
      ),
    },
  },
];

/**
 * A BROKEN response that a bad prompt change could produce: App.tsx imports a local file that was
 * never written (hallucinated import) AND imports the server-only `fs` builtin into frontend code.
 * The real validator must flag both.
 */
const BAD_HALLUCINATED_IMPORTS: MockToolCall[] = [
  {
    name: 'write_file',
    args: {
      path: 'src/App.tsx',
      content: [
        "import { useState } from 'react';",
        "import { Missing } from './components/DoesNotExist';", // hallucinated local import
        "import fs from 'fs';",                                  // server-only builtin in frontend
        '',
        'export function App() {',
        '  const [n] = useState(0);',
        '  return <Missing n={n} />;',
        '}',
      ].join('\n'),
    },
  },
];

export const GOLDEN_CASES: Record<string, MockToolCall[]> = {
  'build a React todo app': GOOD_TODO_APP,
  'build an app (broken output)': BAD_HALLUCINATED_IMPORTS,
};
