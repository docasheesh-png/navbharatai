// Roadmap breadth — direct-messaging / chat starter (a packaged domain vertical).
//
// A high-demand vertical for social apps, marketplaces (buyer↔seller chat), support and any two-party
// conversation. The real feature is CONVERSATION INTEGRITY: a 1:1 conversation is uniquely identified by its
// participant PAIR under a canonical ordering — so (a,b) and (b,a) resolve to the SAME conversation (never a
// duplicate), the per-participant UNREAD count is always exact, and marking-read is MONOTONIC (a read cursor
// only moves forward — already-read messages never resurface). This emits a dependency-free MessagingService +
// an Express router + a README. Real logic, not a stub — the pairing + unread + read-cursor rules are
// unit-tested against the emitted code. Pure builder → the caller writes the files.

export const MESSAGING_SERVICE_SOURCE = `// Direct-messaging domain logic. The core guarantees: (1) a 1:1 conversation is keyed by the canonical
// (sorted) participant pair, so (a,b) === (b,a) and there is never a duplicate; (2) each participant's unread
// count is exact; and (3) a read cursor is MONOTONIC — marking read only moves it forward, so already-read
// messages never resurface. In-memory here; swap the Maps for your database, keeping the same method contracts.

export interface Message {
  id: string;
  conversationId: string;
  sender: string;
  body: string;
  createdAt: string;
}

export interface Conversation {
  id: string;              // canonical: participantA + '\\u0000' + participantB (sorted)
  participants: [string, string];
  createdAt: string;
  lastMessageAt: string | null;
}

export class MessagingService {
  private conversations = new Map<string, Conversation>();
  private messages = new Map<string, Message[]>(); // conversationId -> messages (append order)
  // Per (conversationId, participant): the id (numeric seq) of the last message that participant has read.
  private readCursor = new Map<string, number>();
  private seq = 0;

  /** Canonical conversation id for a participant pair — order-independent. */
  private convId(a: string, b: string): string {
    const x = String(a).trim();
    const y = String(b).trim();
    if (!x || !y) throw new Error('two participants are required');
    if (x === y) throw new Error('cannot open a conversation with yourself');
    return [x, y].sort().join('\\u0000');
  }

  private cursorKey(conversationId: string, participant: string): string {
    return conversationId + '\\u0001' + String(participant).trim();
  }

  /** Get (or lazily create) the single conversation between two participants. */
  openConversation(a: string, b: string, now: Date = new Date()): Conversation {
    const id = this.convId(a, b);
    let convo = this.conversations.get(id);
    if (!convo) {
      const pair = [String(a).trim(), String(b).trim()].sort() as [string, string];
      convo = { id, participants: pair, createdAt: now.toISOString(), lastMessageAt: null };
      this.conversations.set(id, convo);
      this.messages.set(id, []);
    }
    return convo;
  }

  /** Send a message from \`sender\` to \`recipient\`. Opens the conversation on first contact. */
  send(sender: string, recipient: string, body: string, now: Date = new Date()): Message {
    const text = String(body ?? '').trim();
    if (!text) throw new Error('message body is required');
    const convo = this.openConversation(sender, recipient, now);
    if (!convo.participants.includes(String(sender).trim())) throw new Error('sender is not a participant');
    const msg: Message = {
      id: String(++this.seq),
      conversationId: convo.id,
      sender: String(sender).trim(),
      body: text,
      createdAt: now.toISOString(),
    };
    this.messages.get(convo.id)!.push(msg);
    convo.lastMessageAt = msg.createdAt;
    // The sender has implicitly read their own message.
    this.readCursor.set(this.cursorKey(convo.id, msg.sender), Number(msg.id));
    return msg;
  }

  /** All messages in the conversation between two participants, oldest first. */
  history(a: string, b: string): Message[] {
    const id = this.convId(a, b);
    return [...(this.messages.get(id) ?? [])];
  }

  /** How many messages in this conversation \`participant\` has NOT yet read. */
  unreadCount(participant: string, other: string): number {
    const id = this.convId(participant, other);
    const cursor = this.readCursor.get(this.cursorKey(id, participant)) ?? 0;
    const who = String(participant).trim();
    let n = 0;
    for (const m of this.messages.get(id) ?? []) {
      if (m.sender !== who && Number(m.id) > cursor) n++;
    }
    return n;
  }

  /**
   * Mark the conversation read for \`participant\` up to the latest message. The cursor is MONOTONIC — it only
   * moves forward, so a stale/late call can never un-read newer messages. Returns the messages-just-read count.
   */
  markRead(participant: string, other: string, now: Date = new Date()): number {
    const id = this.convId(participant, other);
    const key = this.cursorKey(id, participant);
    const before = this.readCursor.get(key) ?? 0;
    const msgs = this.messages.get(id) ?? [];
    const latest = msgs.length ? Number(msgs[msgs.length - 1].id) : 0;
    const target = Math.max(before, latest); // monotonic: never go backwards
    this.readCursor.set(key, target);
    // Count how many previously-unread messages from the OTHER party this call cleared.
    const who = String(participant).trim();
    let cleared = 0;
    for (const m of msgs) {
      if (m.sender !== who && Number(m.id) > before && Number(m.id) <= target) cleared++;
    }
    void now;
    return cleared;
  }

  /** All conversations a participant is in, most-recently-active first, each with their unread count. */
  inbox(participant: string): Array<Conversation & { unread: number }> {
    const who = String(participant).trim();
    return [...this.conversations.values()]
      .filter((c) => c.participants.includes(who))
      .sort((a, b) => String(b.lastMessageAt ?? '').localeCompare(String(a.lastMessageAt ?? '')))
      .map((c) => {
        const other = c.participants[0] === who ? c.participants[1] : c.participants[0];
        return { ...c, unread: this.unreadCount(who, other) };
      });
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const messaging = new MessagingService();
`;

export const MESSAGING_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { messaging } from './messagingService';

// REST endpoints for the messaging service. Mount with: app.use('/api', messagingRouter).
export const messagingRouter = Router();

// Send a message. { sender, recipient, body }. In production, take sender from the auth session.
messagingRouter.post('/messages', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { sender?: unknown; recipient?: unknown; body?: unknown };
  try {
    return res.status(201).json(messaging.send(String(body.sender ?? ''), String(body.recipient ?? ''), String(body.body ?? '')));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Conversation history between the caller and another user.
messagingRouter.get('/conversations/:me/:other/messages', (req: Request, res: Response) => {
  try {
    return res.status(200).json(messaging.history(req.params.me, req.params.other));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Mark a conversation read for the caller (up to the latest message). Returns the count just cleared.
messagingRouter.post('/conversations/:me/:other/read', (req: Request, res: Response) => {
  try {
    return res.status(200).json({ cleared: messaging.markRead(req.params.me, req.params.other) });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// The caller's inbox — every conversation with its unread count, most-recent first.
messagingRouter.get('/inbox/:me', (req: Request, res: Response) => {
  return res.status(200).json(messaging.inbox(req.params.me));
});
`;

const MESSAGING_README = `# Direct messaging / chat

A real 1:1 messaging backend. The core guarantees: a conversation is uniquely keyed by its **participant pair**
under a canonical ordering — so \`(a,b)\` and \`(b,a)\` are the **same** conversation (never a duplicate) — each
participant's **unread count** is exact, and the **read cursor is monotonic** (marking read only moves forward,
so already-read messages never resurface). Files:

- \`messagingService.ts\` — the domain logic (\`MessagingService\` + a \`messaging\` singleton). In-memory; swap the
  Maps for your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { messagingRouter } from './server/messaging/routes';
app.use('/api', messagingRouter);
\`\`\`

Endpoints:
- \`POST /api/messages\` \`{ sender, recipient, body }\` → sends (opens the conversation on first contact).
- \`GET  /api/conversations/:me/:other/messages\` → the conversation history (oldest first).
- \`POST /api/conversations/:me/:other/read\` → marks read up to the latest; returns \`{ cleared }\`.
- \`GET  /api/inbox/:me\` → every conversation with its \`unread\` count, most-recent first.

Take the \`sender\` / \`me\` from the auth session in production. For real-time delivery, emit a socket event from
\`send\` (this backend owns the source-of-truth state; the socket is just a transport).
`;

export interface MessagingConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Direct-messaging / chat starter wired under server/messaging/ (dependency-free domain logic + an Express ' +
  'router). The real guarantee is CONVERSATION INTEGRITY: a 1:1 conversation is keyed by the canonical (sorted) ' +
  'participant pair, so send(a,b) and send(b,a) share ONE conversation (never a duplicate); unreadCount() is ' +
  'exact per participant; and markRead() is MONOTONIC (the read cursor only moves forward — already-read ' +
  'messages never resurface). A self-conversation and an empty body are rejected. routes.ts exposes POST ' +
  '/messages, GET /conversations/:me/:other/messages, POST /conversations/:me/:other/read (returns the count ' +
  'cleared) and GET /inbox/:me (conversations + unread counts). Mount with app.use("/api", messagingRouter). ' +
  'Take the sender from the auth session in production; emit a socket event from send() for real-time delivery. ' +
  'In-memory by default — swap the Maps for your DB.';

export function generateMessagingIntegration(): MessagingConfig {
  return {
    files: {
      'server/messaging/messagingService.ts': MESSAGING_SERVICE_SOURCE,
      'server/messaging/routes.ts': MESSAGING_ROUTES_SOURCE,
      'server/messaging/README.md': MESSAGING_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
