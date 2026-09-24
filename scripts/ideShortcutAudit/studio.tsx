// Mounts the WHOLE Code Studio with stub props — no login, no server — so Playwright can drive every
// shortcut on a phone viewport and assert its real effect. Throwaway (gitignored), used by PR C.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './harness.css';
import { CodeStudio } from '../../src/components/ide/CodeStudio';

declare global {
  interface Window {
    __calls: Array<{ what: string; arg?: unknown }>;
    __files: Record<string, string>;
    __setFiles: (f: Record<string, string>) => void;
  }
}
window.__calls = [];
const rec = (what: string, arg?: unknown) => { window.__calls.push({ what, arg }); };
// Things a shortcut may reach for that a test must observe rather than let happen.
window.prompt = (() => 'created-by-shortcut.ts') as typeof window.prompt;
window.open = ((url?: string | URL) => { rec('window.open', String(url)); return null; }) as typeof window.open;
const origBack = history.back.bind(history);
history.back = () => { rec('history.back'); };
history.forward = () => { rec('history.forward'); };
void origBack;

const INITIAL: Record<string, string> = {
  'src/App.tsx': [
    "import React, { useState } from 'react';",
    '',
    'export function greet(name: string): string {',
    "  return 'hello ' + name;",
    '}',
    '',
    'export default function App() {',
    "  const [count, setCount] = useState(0);",
    "  const label = greet('world');",
    '  return <button onClick={() => setCount(count + 1)}>{label} {count}</button>;',
    '}',
    '',
  ].join('\n'),
  'src/utils.ts': 'export const add = (a: number, b: number) => a + b;\nexport const sub = (a: number, b: number) => a - b;\n',
  'README.md': '# Harness\n\nA file for the tabs.\n',
};

function Host() {
  const [files, setFiles] = useState<Record<string, string>>(INITIAL);
  window.__files = files;
  window.__setFiles = setFiles;
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'auto' | 'planning' | 'build' | 'chat'>('auto');
  return (
    <div className="h-screen w-screen">
      <CodeStudio
        files={files}
        onFilesChange={(f) => { rec('onFilesChange', Object.keys(f)); setFiles(f); }}
        onFlushEdits={async () => { rec('onFlushEdits'); }}
        onRun={(f) => rec('onRun', Object.keys(f))}
        messages={[]}
        chatInput={input}
        onChatInputChange={setInput}
        onChatSend={() => rec('onChatSend')}
        isChatLoading={false}
        githubToken={null}
        githubUser={null}
        githubRepoContext={null}
        isGHSyncing={false}
        onGHConnect={() => rec('onGHConnect')}
        onGHDisconnect={() => rec('onGHDisconnect')}
        onGHPush={(m) => rec('onGHPush', m)}
        isPinned={false}
        onTogglePin={() => rec('onTogglePin')}
        mode={mode}
        onModeChange={setMode}
        onPreviewClick={() => rec('onPreviewClick')}
        onSocialChatTrigger={() => rec('onSocialChatTrigger')}
        theme="dark"
        onThemeChange={(t) => rec('onThemeChange', t)}
      />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Host />);
