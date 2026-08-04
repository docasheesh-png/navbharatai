// Roadmap breadth — kanban board / task board starter (a packaged domain vertical).
//
// A high-demand vertical for project management, issue tracking, CRMs and any "columns of cards" UI. The real
// feature is BOARD INTEGRITY: cards live in exactly one column in a stable, contiguous order (0,1,2,…), moving a
// card re-indexes both the source and destination columns so positions never collide or gap, and an optional
// per-column WIP LIMIT rejects a move/add that would overflow the column. This emits a dependency-free
// KanbanService + an Express router + a README. Real logic, not a stub — the ordering + WIP-limit rules are
// unit-tested against the emitted code. Pure builder → the caller writes the files.

export const KANBAN_SERVICE_SOURCE = `// Kanban-board domain logic. The core guarantees: (1) a card lives in exactly one column with a stable,
// contiguous position (0,1,2,…), (2) moving/adding re-indexes the affected columns so positions never collide
// or leave gaps, and (3) an optional per-column WIP LIMIT rejects an add/move that would overflow the column.
// In-memory here; swap the Maps for your database, keeping the same method contracts.

export interface Column {
  id: string;
  boardId: string;
  name: string;
  wipLimit: number | null; // max cards allowed (null = unlimited)
  order: number;
}

export interface Card {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string;
  position: number; // contiguous index within its column
  createdAt: string;
  updatedAt: string;
}

export class KanbanService {
  private columns = new Map<string, Column>();
  private cards = new Map<string, Card>();
  private seq = 0;

  private cardsIn(columnId: string): Card[] {
    return [...this.cards.values()].filter((c) => c.columnId === columnId).sort((a, b) => a.position - b.position);
  }

  /** Re-write positions in a column to a contiguous 0..n-1 in current sorted order. */
  private reindex(columnId: string, now: string): void {
    this.cardsIn(columnId).forEach((c, i) => {
      if (c.position !== i) { c.position = i; c.updatedAt = now; }
    });
  }

  /** Create a column. wipLimit null = unlimited; a positive integer caps the card count. */
  addColumn(boardId: string, name: string, wipLimit: number | null = null): Column {
    const board = String(boardId).trim();
    const nm = String(name).trim();
    if (!board) throw new Error('boardId is required');
    if (!nm) throw new Error('column name is required');
    let limit: number | null = null;
    if (wipLimit != null) {
      limit = Math.floor(Number(wipLimit));
      if (!Number.isFinite(limit) || limit <= 0) throw new Error('wipLimit must be a positive integer or null');
    }
    const order = [...this.columns.values()].filter((c) => c.boardId === board).length;
    const column: Column = { id: 'col' + String(++this.seq), boardId: board, name: nm, wipLimit: limit, order };
    this.columns.set(column.id, column);
    return column;
  }

  getColumn(id: string): Column | undefined {
    return this.columns.get(id);
  }

  /** Columns of a board, left to right. */
  columnsOf(boardId: string): Column[] {
    const board = String(boardId).trim();
    return [...this.columns.values()].filter((c) => c.boardId === board).sort((a, b) => a.order - b.order);
  }

  private requireColumn(id: string): Column {
    const c = this.columns.get(id);
    if (!c) throw new Error('column not found');
    return c;
  }

  /** Add a card to the end of a column. Rejected if the column is at its WIP limit. */
  addCard(columnId: string, input: { title: string; description?: string }, now: Date = new Date()): Card {
    const col = this.requireColumn(columnId);
    const title = String(input?.title ?? '').trim();
    if (!title) throw new Error('title is required');
    const current = this.cardsIn(columnId);
    if (col.wipLimit != null && current.length >= col.wipLimit) {
      throw new Error('column is at its WIP limit');
    }
    const iso = now.toISOString();
    const card: Card = {
      id: 'card' + String(++this.seq),
      boardId: col.boardId,
      columnId,
      title,
      description: String(input?.description ?? ''),
      position: current.length,
      createdAt: iso,
      updatedAt: iso,
    };
    this.cards.set(card.id, card);
    return card;
  }

  getCard(id: string): Card | undefined {
    return this.cards.get(id);
  }

  /**
   * Move a card to \`toColumnId\` at \`toPosition\` (clamped to the column length). Rejected if the destination is a
   * DIFFERENT column already at its WIP limit. Both source and destination are re-indexed to stay contiguous.
   */
  moveCard(cardId: string, toColumnId: string, toPosition: number, now: Date = new Date()): Card {
    const card = this.cards.get(cardId);
    if (!card) throw new Error('card not found');
    const dest = this.requireColumn(toColumnId);
    const fromColumnId = card.columnId;
    const sameColumn = fromColumnId === toColumnId;
    if (!sameColumn && dest.wipLimit != null && this.cardsIn(toColumnId).length >= dest.wipLimit) {
      throw new Error('destination column is at its WIP limit');
    }
    const iso = now.toISOString();
    // Remove from source (temporarily park it at a large position), reindex source.
    card.position = Number.MAX_SAFE_INTEGER;
    card.columnId = toColumnId;
    if (!sameColumn) this.reindex(fromColumnId, iso);
    // Insert into destination at the clamped position.
    const destCards = this.cardsIn(toColumnId).filter((c) => c.id !== cardId);
    const clamped = Math.max(0, Math.min(Math.floor(Number(toPosition)) || 0, destCards.length));
    destCards.splice(clamped, 0, card);
    destCards.forEach((c, i) => { c.position = i; c.updatedAt = iso; });
    card.updatedAt = iso;
    return card;
  }

  /** Edit a card's title/description. */
  updateCard(id: string, patch: { title?: string; description?: string }, now: Date = new Date()): Card {
    const card = this.cards.get(id);
    if (!card) throw new Error('card not found');
    if (patch.title !== undefined) {
      const t = String(patch.title).trim();
      if (!t) throw new Error('title cannot be empty');
      card.title = t;
    }
    if (patch.description !== undefined) card.description = String(patch.description);
    card.updatedAt = now.toISOString();
    return card;
  }

  /** Remove a card and re-index its column so positions stay contiguous. */
  removeCard(id: string, now: Date = new Date()): boolean {
    const card = this.cards.get(id);
    if (!card) return false;
    const columnId = card.columnId;
    this.cards.delete(id);
    this.reindex(columnId, now.toISOString());
    return true;
  }

  /** The whole board: columns left-to-right, each with its cards in order. */
  board(boardId: string): Array<Column & { cards: Card[] }> {
    return this.columnsOf(boardId).map((col) => ({ ...col, cards: this.cardsIn(col.id) }));
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const kanban = new KanbanService();
`;

export const KANBAN_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { kanban } from './kanbanService';

// REST endpoints for the kanban board. Mount with: app.use('/api', kanbanRouter).
export const kanbanRouter = Router();

// Create a column. { boardId, name, wipLimit? }.
kanbanRouter.post('/columns', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { boardId?: unknown; name?: unknown; wipLimit?: unknown };
  try {
    const wip = body.wipLimit === undefined || body.wipLimit === null ? null : Number(body.wipLimit);
    return res.status(201).json(kanban.addColumn(String(body.boardId ?? ''), String(body.name ?? ''), wip));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// The whole board (columns + cards in order).
kanbanRouter.get('/boards/:boardId', (req: Request, res: Response) => {
  return res.status(200).json(kanban.board(req.params.boardId));
});

// Add a card to a column. { title, description? } — 409 if the column is at its WIP limit.
kanbanRouter.post('/columns/:columnId/cards', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { title?: unknown; description?: unknown };
  try {
    return res.status(201).json(kanban.addCard(req.params.columnId, { title: String(body.title ?? ''), description: String(body.description ?? '') }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not add card';
    if (message === 'column not found') return res.status(404).json({ error: message });
    if (message.includes('WIP limit')) return res.status(409).json({ error: message });
    return res.status(400).json({ error: message });
  }
});

// Move a card. { toColumnId, toPosition } — 409 if the destination column is at its WIP limit.
kanbanRouter.patch('/cards/:id/move', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { toColumnId?: unknown; toPosition?: unknown };
  try {
    return res.status(200).json(kanban.moveCard(req.params.id, String(body.toColumnId ?? ''), Number(body.toPosition ?? 0)));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not move card';
    if (message === 'card not found' || message === 'column not found') return res.status(404).json({ error: message });
    if (message.includes('WIP limit')) return res.status(409).json({ error: message });
    return res.status(400).json({ error: message });
  }
});

// Edit / delete a card.
kanbanRouter.patch('/cards/:id', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { title?: unknown; description?: unknown };
  const patch: { title?: string; description?: string } = {};
  if (body.title !== undefined) patch.title = String(body.title);
  if (body.description !== undefined) patch.description = String(body.description);
  try {
    return res.status(200).json(kanban.updateCard(req.params.id, patch));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not update';
    return res.status(message === 'card not found' ? 404 : 400).json({ error: message });
  }
});

kanbanRouter.delete('/cards/:id', (req: Request, res: Response) => {
  if (!kanban.removeCard(req.params.id)) return res.status(404).json({ error: 'card not found' });
  return res.status(204).send();
});
`;

const KANBAN_README = `# Kanban board / task board

A real kanban backend. The core guarantees: a card lives in exactly one column with a **stable, contiguous
position** (0,1,2,…), moving/adding **re-indexes** the affected columns so positions never collide or gap, and
an optional per-column **WIP limit** rejects an add/move that would overflow the column. Files:

- \`kanbanService.ts\` — the domain logic (\`KanbanService\` + a \`kanban\` singleton). In-memory; swap the Maps for
  your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { kanbanRouter } from './server/kanban/routes';
app.use('/api', kanbanRouter);
\`\`\`

Endpoints:
- \`POST /api/columns\` \`{ boardId, name, wipLimit? }\`.
- \`GET  /api/boards/:boardId\` → columns left-to-right, each with its cards in order.
- \`POST /api/columns/:columnId/cards\` \`{ title, description? }\` → **409** if the column is at its WIP limit.
- \`PATCH /api/cards/:id/move\` \`{ toColumnId, toPosition }\` → **409** if the destination column is full.
- \`PATCH /api/cards/:id\` (edit) / \`DELETE /api/cards/:id\` (removes + re-indexes the column).

\`toPosition\` is clamped to the destination length, so an out-of-range drop lands at the end. Identify a board
with whatever groups the work (a project id, a user id).
`;

export interface KanbanConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Kanban board / task board starter wired under server/kanban/ (dependency-free domain logic + an Express ' +
  'router). The real guarantee is BOARD INTEGRITY: a card lives in exactly one column with a stable contiguous ' +
  'position (0,1,2,…); addCard/moveCard re-index the affected columns so positions never collide or gap; and an ' +
  'optional per-column WIP LIMIT rejects an add/move that would overflow the column (moveCard within the same ' +
  'column is exempt). moveCard clamps toPosition to the destination length. routes.ts exposes POST /columns, GET ' +
  '/boards/:boardId (columns + ordered cards), POST /columns/:columnId/cards (409 at WIP limit), PATCH ' +
  '/cards/:id/move (409 if destination full), PATCH /cards/:id and DELETE /cards/:id. Mount with app.use("/api", ' +
  'kanbanRouter). In-memory by default — swap the Maps for your DB.';

export function generateKanbanIntegration(): KanbanConfig {
  return {
    files: {
      'server/kanban/kanbanService.ts': KANBAN_SERVICE_SOURCE,
      'server/kanban/routes.ts': KANBAN_ROUTES_SOURCE,
      'server/kanban/README.md': KANBAN_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
