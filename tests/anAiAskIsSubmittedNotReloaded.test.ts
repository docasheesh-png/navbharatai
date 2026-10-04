// Queue Q-085 (autopsy 1219c639, admin-approved 2026-10-01, option a): a chat form that asks the app's
// AI appends the question and answer to a list, so it read as a create form and the journey then
// checked the "item" survived a reload. A chat's messages usually live in memory, and in the preview
// the AI may not answer at all, so that check would fail a working app. An AI ask is checked as a
// submit that does not break the app — never as create-and-reload.
import { describe, expect, it } from 'vitest';
import { deriveJourneys, formAsksAi } from '../src/server/AgentV3/journeyDerivation';

const chatComponent = (importLine: string, call: string) => `
  import { useState } from 'react';
  ${importLine}
  export default function AiChat() {
    const [messages, setMessages] = useState([]);
    const [text, setText] = useState('');
    async function handleSubmit(e) {
      e.preventDefault();
      setMessages((m) => [...m, { id: Date.now(), role: 'user', text }]);
      const reply = await ${call};
      setMessages((m) => [...m, { id: Date.now() + 1, role: 'ai', text: reply }]);
    }
    return (
      <div>
        <ul>{messages.map((m) => <li key={m.id}>{m.text}</li>)}</ul>
        <form onSubmit={handleSubmit}>
          <input name="question" placeholder="Ask anything" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit">Send</button>
        </form>
      </div>
    );
  }
`;

const app = (component: string, extra: Record<string, string> = {}) => ({
  'src/App.tsx': "import AiChat from './components/AiChat';\nexport default function App() { return <AiChat />; }",
  'src/components/AiChat.tsx': component,
  'src/main.tsx': "import { createRoot } from 'react-dom/client'; createRoot(document.getElementById('root')).render(<App />);",
  ...extra,
});

describe('an AI ask is a submit, not a create', () => {
  it('a chat that calls src/lib/ai gets a submit-only journey, no reload check', () => {
    const files = app(chatComponent("import { askAi } from '../lib/ai';", 'askAi(text)'),
      { 'src/lib/ai.ts': 'export async function askAi(q: string) { return fetch("/api/app-ai/ask").then((r) => r.text()); }' });
    const j = deriveJourneys({ files, marker: 'nbai-x', routes: ['/'] });
    expect(j).toHaveLength(1);
    expect(j[0].kind).toBe('form-submit');
    expect(j[0].title).toMatch(/ask the app's AI/i);
  });

  it('the AI call reached through a hook counts too', () => {
    const files = app(chatComponent("import { useAsk } from '../hooks/useAsk';", 'useAsk()(text)'), {
      'src/hooks/useAsk.ts': "import { askAi } from '@/lib/ai';\nexport function useAsk() { return askAi; }",
      'src/lib/ai.ts': 'export async function askAi(q: string) { return q; }',
    });
    expect(formAsksAi('src/components/AiChat.tsx', files)).toBe(true);
    expect(deriveJourneys({ files, marker: 'nbai-x', routes: ['/'] })[0].kind).toBe('form-submit');
  });

  it('window.NavAI (the published-app gateway) counts', () => {
    const files = app(chatComponent('', 'window.NavAI.ask(text)'));
    expect(formAsksAi('src/components/AiChat.tsx', files)).toBe(true);
  });

  it('the same list-and-form shape with NO AI call still proves it survives a reload', () => {
    const files = app(chatComponent("import { saveNote } from '../lib/notes';", 'saveNote(text)'),
      { 'src/lib/notes.ts': 'export async function saveNote(t: string) { localStorage.setItem("n", t); return t; }' });
    expect(formAsksAi('src/components/AiChat.tsx', files)).toBe(false);
    expect(deriveJourneys({ files, marker: 'nbai-x', routes: ['/'] })[0].kind).toBe('create-persists');
  });

  it('a word "ai" in a path that is not an AI helper does not count', () => {
    const files = { 'src/components/Form.tsx': "import { trail } from '../lib/aisle';\nexport default () => null;", 'src/lib/aisle.ts': 'export const trail = 1;' };
    expect(formAsksAi('src/components/Form.tsx', files)).toBe(false);
  });
});
