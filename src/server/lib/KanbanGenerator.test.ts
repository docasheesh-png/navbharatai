import { describe, it, expect, afterAll } from 'vitest';

import { generateKanbanIntegration, KANBAN_SERVICE_SOURCE } from './KanbanGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateKanbanIntegration (wiring)', () => {
  it('emits the kanban service, routes and README', () => {
    const out = generateKanbanIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/kanban/kanbanService.ts');
    expect(paths).toContain('server/kanban/routes.ts');
    expect(paths).toContain('server/kanban/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/kanban/routes.ts']).toContain('export const kanbanRouter');
    expect(out.files['server/kanban/routes.ts']).toContain('409');
  });
});

// Materialize + execute the emitted domain logic — the contiguous-ordering + WIP-limit rules are real
// business rules, verified against the actual emitted code.
describe('emitted KanbanService — ordering + WIP limit (real logic)', () => {
  const emitted = emitModule('kanban', KANBAN_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  interface Column { id: string; boardId: string; name: string; wipLimit: number | null; order: number }
  interface Card { id: string; columnId: string; title: string; position: number }
  interface Service {
    addColumn(boardId: string, name: string, wipLimit?: number | null): Column;
    addCard(columnId: string, input: { title: string; description?: string }, now?: Date): Card;
    getCard(id: string): Card | undefined;
    moveCard(cardId: string, toColumnId: string, toPosition: number, now?: Date): Card;
    updateCard(id: string, patch: { title?: string; description?: string }, now?: Date): Card;
    removeCard(id: string, now?: Date): boolean;
    columnsOf(boardId: string): Column[];
    board(boardId: string): Array<Column & { cards: Card[] }>;
  }
  interface Emitted { KanbanService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('cards get contiguous positions 0,1,2 in add order', async () => {
    const { KanbanService } = await load();
    const svc = new KanbanService();
    const todo = svc.addColumn('b1', 'Todo');
    const a = svc.addCard(todo.id, { title: 'A' });
    const b = svc.addCard(todo.id, { title: 'B' });
    const c = svc.addCard(todo.id, { title: 'C' });
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);
    expect(svc.board('b1')[0].cards.map((x) => x.title)).toEqual(['A', 'B', 'C']);
  });

  it('removing a card re-indexes the column so positions stay contiguous', async () => {
    const { KanbanService } = await load();
    const svc = new KanbanService();
    const todo = svc.addColumn('b1', 'Todo');
    const a = svc.addCard(todo.id, { title: 'A' });
    const b = svc.addCard(todo.id, { title: 'B' });
    const c = svc.addCard(todo.id, { title: 'C' });
    svc.removeCard(b.id);
    const cards = svc.board('b1')[0].cards;
    expect(cards.map((x) => x.title)).toEqual(['A', 'C']);
    expect(cards.map((x) => x.position)).toEqual([0, 1]); // no gap where B was
    expect(svc.getCard(a.id)?.position).toBe(0);
    expect(svc.getCard(c.id)?.position).toBe(1);
  });

  it('moving a card re-indexes BOTH columns and inserts at the clamped position', async () => {
    const { KanbanService } = await load();
    const svc = new KanbanService();
    const todo = svc.addColumn('b1', 'Todo');
    const doing = svc.addColumn('b1', 'Doing');
    const a = svc.addCard(todo.id, { title: 'A' });
    svc.addCard(todo.id, { title: 'B' });
    const c = svc.addCard(todo.id, { title: 'C' });
    // move A (pos 0 in Todo) to Doing at position 0
    const moved = svc.moveCard(a.id, doing.id, 0);
    expect(moved.columnId).toBe(doing.id);
    expect(moved.position).toBe(0);
    // Todo re-indexed to B(0), C(1)
    expect(svc.board('b1')[0].cards.map((x) => x.title)).toEqual(['B', 'C']);
    expect(svc.board('b1')[0].cards.map((x) => x.position)).toEqual([0, 1]);
    // Doing has A(0)
    expect(svc.board('b1')[1].cards.map((x) => x.title)).toEqual(['A']);
    // moving C to Doing at an out-of-range position clamps to the end
    const movedC = svc.moveCard(c.id, doing.id, 99);
    expect(movedC.position).toBe(1);
    expect(svc.board('b1')[1].cards.map((x) => x.title)).toEqual(['A', 'C']);
  });

  it('enforces the per-column WIP limit on add and cross-column move (same-column move exempt)', async () => {
    const { KanbanService } = await load();
    const svc = new KanbanService();
    const todo = svc.addColumn('b1', 'Todo');
    const doing = svc.addColumn('b1', 'Doing', 1); // WIP limit 1
    svc.addCard(doing.id, { title: 'X' }); // fills Doing
    // a second add to Doing is rejected
    expect(() => svc.addCard(doing.id, { title: 'Y' })).toThrow(/WIP limit/);
    // a card in Todo cannot move into the full Doing
    const t = svc.addCard(todo.id, { title: 'T' });
    expect(() => svc.moveCard(t.id, doing.id, 0)).toThrow(/WIP limit/);
    // invalid wipLimit is rejected at column creation
    expect(() => svc.addColumn('b1', 'Bad', 0)).toThrow(/positive integer or null/);
  });

  it('validates input and unknown ids', async () => {
    const { KanbanService } = await load();
    const svc = new KanbanService();
    const col = svc.addColumn('b1', 'Todo');
    expect(() => svc.addColumn('', 'x')).toThrow(/boardId is required/);
    expect(() => svc.addColumn('b1', '')).toThrow(/column name is required/);
    expect(() => svc.addCard(col.id, { title: '' })).toThrow(/title is required/);
    expect(() => svc.addCard('nope', { title: 'x' })).toThrow(/column not found/);
    expect(() => svc.moveCard('nope', col.id, 0)).toThrow(/card not found/);
    expect(svc.removeCard('nope')).toBe(false);
  });
});
