import type { Message } from '../types/index';

/**
 * Generates a random UCI (Unique Conversation Identifier) string:
 * 10–16 characters drawn from uppercase, lowercase, digits and symbols,
 * guaranteed to contain at least one from every class.
 */
export function generateUCI(): string {
  const uppers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowers = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const symbols = '!@#$%^&*';
  const allChars = uppers + lowers + digits + symbols;

  const len = Math.floor(Math.random() * (16 - 10 + 1)) + 10;

  let result = '';
  result += uppers[Math.floor(Math.random() * uppers.length)];
  result += lowers[Math.floor(Math.random() * lowers.length)];
  result += digits[Math.floor(Math.random() * digits.length)];
  result += symbols[Math.floor(Math.random() * symbols.length)];

  for (let i = 4; i < len; i++) {
    result += allChars[Math.floor(Math.random() * allChars.length)];
  }

  const arr = result.split('');
  for (let j = arr.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    const temp = arr[j];
    arr[j] = arr[k];
    arr[k] = temp;
  }
  return arr.join('');
}

/** Returns a random element from an array. */
export function getRandomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Builds a human-readable session memory summary from the conversation history.
 * Used to compress long sessions into a concise context block.
 */
export function generateSmartHeuristicSummary(history: Message[]): string {
  const userMessages = history.filter(m => m.sender === 'user');
  if (userMessages.length === 0) return 'Initialized default sandbox environment';

  const completed: string[] = [];
  const pending: string[] = [];

  userMessages.forEach(m => {
    const txt = m.text.toLowerCase();
    if (txt.includes('build') || txt.includes('create') || txt.includes('make') || txt.includes('banao')) {
      completed.push(`Feature build: "${m.text.slice(0, 35)}..."`);
    } else if (txt.includes('fix') || txt.includes('bug') || txt.includes('correct') || txt.includes('error')) {
      completed.push(`Debugging session: "${m.text.slice(0, 35)}..."`);
    } else {
      pending.push(`Pending item: "${m.text.slice(0, 35)}..."`);
    }
  });

  if (completed.length === 0) completed.push('Workspace initiation under UCI protocol');
  if (pending.length === 0) pending.push('Dynamic continuous prompt analysis');

  return `### 🧠 COMPRESSED INTELLECTUAL WORKSPACE MEMORY
- **Completed Milestones**:
${completed.map(c => `  - ${c}`).join('\n')}
- **Pending Actions**:
${pending.map(p => `  - ${p}`).join('\n')}
`;
}

/**
 * Extracts the first HTML code block from an AI response text.
 * Injects an error-tracking harness and a viewport meta tag when found.
 * Returns null when no code block is present.
 */
export function extractCode(text: string): string | null {
  const htmlMatch = text.match(/```html\s+([\s\S]*?)?```/) || text.match(/<html>\s+([\s\S]*?)?<\/html>/i);
  const jsMatch = text.match(/```(?:javascript|js)\s+([\s\S]*?)?```/);
  const cssMatch = text.match(/```css\s+([\s\S]*?)?```/);

  if (!htmlMatch && !jsMatch && !cssMatch) return null;

  let html = htmlMatch ? (htmlMatch[1] || htmlMatch[0]) : '';

  const errorTracker = `
      <script>
        window.onerror = function(msg, url, lineNo, columnNo, error) {
          window.parent.postMessage({ type: 'SANDBOX_ERROR', message: msg + " at line " + lineNo }, '*');
          return false;
        };
        console.error = (function(oldError) {
          return function(msg) {
            window.parent.postMessage({ type: 'SANDBOX_ERROR', message: msg }, '*');
            oldError.apply(console, arguments);
          }
        })(console.error);
      </script>
    `;

  if (html) {
    if (html.includes('</head>')) {
      html = html.replace('</head>', errorTracker + '</head>');
    } else if (html.includes('<head>')) {
      html = html.replace('<head>', '<head>' + errorTracker);
    }

    if (!html.toLowerCase().includes('viewport')) {
      if (html.includes('</head>')) {
        html = html.replace('</head>', '<meta name="viewport" content="width=device-width, initial-scale=1.0"></head>');
      }
    }
  }

  return html;
}

/**
 * Classifies a chat message as a build request or a conversational reply.
 * Used by the NBI chat "auto" mode to decide whether to generate an app.
 */
export function classifyBuildIntent(message: string): 'build' | 'chat' {
  const lower = message.trim().toLowerCase();
  const wordCount = lower.split(/\s+/).length;

  if (wordCount <= 4 && /^(hi|hello|hey|hii|helo|ok|okay|thanks|thank you|thx|shukriya|acha|accha|theek hai|theek|samjha|samajh|haan|nahi|sure|great|nice|good|perfect|kya haal|kaise ho|namaste|bye|good morning|good night|test)\s*[!.?]*$/.test(lower)) {
    return 'chat';
  }

  if (/\b(app|game|website|web app|tool|bana[od]?|create|make|build|generate|develop|design|calculator|todo|quiz|login|dashboard|social|blog|portfolio|ecommerce|landing page|chat app|music player|weather|notes|timer|calendar|survey|banao|banana|chahiye)\b/i.test(lower)) {
    return 'build';
  }

  if (wordCount < 12 && (/\?$/.test(message.trim()) || /^(what|how|why|when|where|who|explain|kya|batao|bata|samjhao|tell me|kaise|kyun|kab|kaisa)\b/i.test(lower))) {
    return 'chat';
  }

  return 'build';
}

/**
 * Fine-grained intent classifier for the Pro Chat "auto" mode.
 * Returns one of: 'chat' | 'clarify' | 'direct_build' | 'plan_build'.
 */
export function classifyAutoIntent(
  message: string,
  history: Message[],
): 'chat' | 'clarify' | 'direct_build' | 'plan_build' {
  const msg = message.trim();
  const lower = msg.toLowerCase();

  if (/\b(coding nahi|build nahi|mat bana|don't build|no code|no build|sirf bata|sirf samjha|just (tell|explain|discuss)|without (building|coding)|abhi nahi|bas batao)\b/i.test(lower)) return 'chat';

  const isQuestion = /\?$/.test(msg) || /^(kya|kaise|kyun|what|how|why|explain|batao|samjhao|tell me|describe)\b/i.test(lower);
  const hasBuildVerb = /\b(bana|banao|banana|build|create|make|generate|develop|chahiye|chahie|design|kar do|karo)\b/i.test(lower);
  if (isQuestion && !hasBuildVerb) return 'chat';

  const lastAi = [...history].reverse().find(m => m.sender === 'ai');
  const aiWasAsking = !!(lastAi && /\?/.test(lastAi.text) && /\b(bana|build|banau|shall i|chahiye)\b/i.test(lastAi.text.toLowerCase()));
  const isConfirm = /^(haan|yes|ok|sure|bilkul|karo|go ahead|ha\b|👍|theek|kar do|bana do)\s*[!.]*$/i.test(msg.trim());
  if (isConfirm && aiWasAsking) return 'direct_build';

  const hasAppNoun = /\b(app|application|game|website|tool|dashboard|calculator|quiz|generator|system|platform|portal|page|form|tracker|timer|clock|todo|chat|login|signup|landing)\b/i.test(lower);

  if (!hasBuildVerb && !hasAppNoun) return 'chat';

  if (hasAppNoun && !hasBuildVerb && msg.length < 60) return 'clarify';

  const isComplex = msg.length > 120 ||
    (lower.match(/\b(aur|and|with|plus|bhi|also)\b/g) || []).length >= 3 ||
    (msg.match(/^\d+\./gm) || []).length >= 2 ||
    /\b(auth|login|database|api|dark mode|responsive|animation|filter|search|sort|registration|profile|payment|categories|multiple)\b/i.test(lower);

  if (hasBuildVerb && isComplex) return 'plan_build';
  return 'direct_build';
}

/**
 * Coerce an unknown value (e.g. a `restoredMessages` field read back from Firestore) into a Message[].
 * Firestore can store a session's `restoredMessages` as a non-array (legacy/corrupted doc), and `x || []`
 * does NOT guard a truthy non-array — spreading/iterating it then throws "... is not iterable" (a real
 * production crash class). This enforces the array invariant at the boundary. Pure + unit-tested.
 */
export function asMessageArray(x: unknown): Message[] {
  return Array.isArray(x) ? (x as Message[]) : [];
}

/**
 * Deduplicate messages by id and return them sorted by ascending timestamp.
 * Used when restoring a session: combines restoredMessages + messages, drops
 * duplicates (last write wins), and produces a stable chronological history.
 * Defensive: a non-array input is treated as empty instead of throwing "not iterable".
 */
export function dedupAndSortMessages(messages: Message[]): Message[] {
  const byId: Record<string, Message> = {};
  for (const msg of asMessageArray(messages)) {
    if (msg && msg.id) byId[msg.id] = msg;
  }
  return Object.values(byId).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}
