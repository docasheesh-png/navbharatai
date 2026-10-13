// A WRITE THE MODEL ASKED FOR IS A FACT, NOT A DEFAULT (autopsy 9c612cdb, 2026-10-12).
//
// 🔴 WHAT HAPPENED. The report said: "After the app first rendered 350s in, 12 file(s) were written by 3 writer(s):
// production-defaults (6 files), build loop (5 files), design-consistency-heal (1 file)." The model had written its
// final summary at 348.4s and made NO write after it. The five "build loop" files were the platform's own finishing
// passes — the unused-import sweep (2 files), the end-to-end scaffold (playwright.config.ts, e2e/smoke.spec.ts) and
// the architecture note (docs/decisions/ADR-001.md) — none of which named a pass. `postGreenWrites.ts` labelled
// every unnamed write "build loop", so the report told the reader the model kept editing an app that already worked.
//
// 🔑 THE CLASS: "who wrote this?" was answered by ABSENCE — no pass name ⇒ the model. Any platform writer that forgot
// `runInPass` was therefore reported as the model, and nothing could tell the two apart. This module makes the model
// half a POSITIVE fact: `AgentRunner` runs every tool call a model asked for inside this zone, and the write choke
// point (`greenFreeze.assertWriteAllowed`) reads it. A write that is neither inside a named pass nor inside a model's
// tool call is reported as what it is — an unnamed platform step — never as the model.
//
// Two kinds of model tool call, because two kinds of run exist: the BUILD (the user's own request — the architect,
// its escalations, and the sub-agents it delegates to) and a PLATFORM REPAIR (an `AgentRunner` the platform starts
// with `platformRequest: true` — the integrity, preview, hooks, vaccine … repairs). The repair is sticky: a
// sub-agent a repair delegates to is still that repair, whatever its own options say.
//
// Attribution only. Nothing here decides whether a write is allowed — that stays `greenFreeze.writeRefused`, which
// does not read this zone. PURE apart from the async context.
import { AsyncLocalStorage } from 'node:async_hooks';

/** Which kind of run asked for the tool call: the user's build, or a repair the platform started. */
export type ModelToolOrigin = 'build' | 'platform-repair';

const zone = new AsyncLocalStorage<ModelToolOrigin>();

/** Run `fn` as a tool call a model asked for. Every write under it is the model's own. */
export function runAsModelToolCall<T>(fn: () => Promise<T>, opts: { platformRequest?: boolean } = {}): Promise<T> {
  const origin: ModelToolOrigin = zone.getStore() === 'platform-repair' || opts.platformRequest === true ? 'platform-repair' : 'build';
  return zone.run(origin, fn);
}

/** The model tool call the current write is part of, or null when no model asked for it. */
export function modelToolOrigin(): ModelToolOrigin | null {
  return zone.getStore() ?? null;
}
