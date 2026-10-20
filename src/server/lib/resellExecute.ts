// Run a resell attempt. Every dependency is injected so a test can prove the order:
// quote, then create, then charge, and delete if the charge or the hand-over fails.
//
// This module does not import Express, Google, or Supabase.

import type { ServerPublishResult } from '../AgentV3/serverPublish';
import {
  databaseAddonProof, quoteDatabaseResell, quoteServerResell, serverAddonProof, stableResellRef,
  type ResellAddonRow, type ResellOption,
} from './resellQuote';

export interface ChargeResult {
  ok: boolean;
  charged?: boolean;
  error?: string;
  /** When the row written (or replayed) is still inside its paid window. */
  active?: boolean;
}

export interface ServerResellDeps {
  quoteInput: Omit<Parameters<typeof quoteServerResell>[0], 'canPay'> & { canPay: boolean | null };
  publish: () => Promise<ServerPublishResult>;
  charge: (clientRef: string, proof: string) => Promise<ChargeResult>;
  teardown: (service: string | undefined) => Promise<{ ok: boolean }>;
  nowMs?: number;
}

function refused(status: number, error: string, payment: Record<string, unknown> = {}): { status: number; body: Record<string, unknown> } {
  return { status, body: { ok: false, charged: false, error, ...payment } };
}

/**
 * Deploy an EXTRA server and charge only if Cloud Run reported it ready.
 * A plan-included server never reaches `publish` here — the quote says to use the normal Publish.
 */
export async function executeServerResell(
  input: { agreedToTerms: boolean; workspaceId: string },
  deps: ServerResellDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const quote: ResellOption = quoteServerResell(deps.quoteInput);
  if (!quote.canStart) {
    return { status: quote.status, body: { ok: quote.mode === 'included', charged: false, error: quote.reason, mode: quote.mode, stopRef: quote.stopRef } };
  }
  if (!input.agreedToTerms) {
    return refused(400, 'Tick the terms first. The server was not started and nothing was charged.');
  }
  const published = await deps.publish();
  if (!published.live) {
    return { status: published.status, body: { ...published.body, charged: false } };
  }
  const proof = published.url ? serverAddonProof(input.workspaceId, published.url) : null;
  if (!published.ready || !proof) {
    const down = await deps.teardown(published.service);
    return refused(502, down.ok
      ? 'The server did not become ready, so it was taken down. Nothing was charged.'
      : 'The server did not become ready and could not be confirmed down. Nothing was charged.');
  }
  const clientRef = stableResellRef('server', input.workspaceId, deps.nowMs ?? Date.now());
  let charged: ChargeResult;
  try { charged = await deps.charge(clientRef, proof); }
  catch {
    return refused(503, 'Payment confirmation is unavailable. The live server has been kept for reconciliation; do not purchase it again.', { charged: null, paymentStatus: 'unknown', delivered: true, reconciliationRequired: true });
  }
  if (charged.ok && charged.active !== false) {
    return {
      status: 200,
      body: {
        ok: true,
        charged: charged.charged === true,
        url: published.url,
        message: charged.charged
          ? `Your server is live. ₹${quote.priceInr} was taken from your wallet for 30 days.`
          : 'Your server is live. This one was already paid for, so nothing extra was charged.',
      },
    };
  }
  const down = await deps.teardown(published.service);
  return refused(402, down.ok
    ? `${charged.error || 'The charge did not complete.'} The server was taken down. Nothing was charged.`
    : `${charged.error || 'The charge did not complete.'} The server may still be up and you were NOT charged. Stop it from Publish if it is still listed.`);
}

export interface DatabaseResellDeps {
  quoteInput: Parameters<typeof quoteDatabaseResell>[0];
  create: () => Promise<
    | { ok: true; projectRef: string; url: string; env: Record<string, string> }
    | { ok: false; message: string; cleaned: boolean }
  >;
  save: (env: Record<string, string>) => Promise<boolean>;
  charge: (clientRef: string, proof: string) => Promise<ChargeResult>;
  /** Delete the project. ok false ⇒ it may still be billing us, so do not refund. */
  destroy: (projectRef: string) => Promise<{ ok: boolean }>;
  refund: (clientRef: string) => Promise<{ ok: boolean }>;
  nowMs?: number;
}

export async function executeDatabaseResell(
  input: { agreedToTerms: boolean; workspaceId: string },
  deps: DatabaseResellDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const quote = quoteDatabaseResell(deps.quoteInput);
  if (!quote.canStart) {
    return { status: quote.status, body: { ok: quote.mode === 'included', charged: false, error: quote.reason, mode: quote.mode, stopRef: quote.stopRef } };
  }
  if (!input.agreedToTerms) {
    return refused(400, 'Tick the terms first. No database was created and nothing was charged.');
  }
  const created = await deps.create();
  if (!created.ok) {
    return refused(502, created.cleaned
      ? created.message
      : `${created.message} Nothing was charged.`);
  }
  const proof = databaseAddonProof(input.workspaceId, created.projectRef);
  if (!proof) {
    const gone = await deps.destroy(created.projectRef).catch(() => ({ ok: false }));
    return refused(502, gone.ok ? 'The database id was not one we can bill against, so it was removed. Nothing was charged.' : 'The database id could not be billed and cleanup could not be confirmed. Nothing was charged.', { cleanupPending: !gone.ok });
  }
  const clientRef = stableResellRef('database', input.workspaceId, deps.nowMs ?? Date.now());
  let charged: ChargeResult;
  try { charged = await deps.charge(clientRef, proof); }
  catch {
    // A lost response is not evidence that the debit failed. Preserve the provisioned resource
    // until the ledger can be reconciled, rather than deleting something the user may have paid for.
    return refused(503, 'Payment confirmation is unavailable. The database has been kept for reconciliation; do not start another purchase.', { charged: null, paymentStatus: 'unknown', delivered: false, cleanupPending: true });
  }
  if (!charged.ok || charged.active === false) {
    const gone = await deps.destroy(created.projectRef).catch(() => ({ ok: false }));
    return refused(402, gone.ok
      ? `${charged.error || 'The charge did not complete.'} The database was deleted. Nothing was charged.`
      : `${charged.error || 'The charge did not complete.'} The database may still exist and you were NOT charged.`);
  }
  const saved = await deps.save(created.env).catch(() => false);
  if (!saved) {
    const gone = await deps.destroy(created.projectRef).catch(() => ({ ok: false }));
    if (!gone.ok) {
      return refused(500, 'The database is ready but its keys could not be saved, and it could not be confirmed deleted. You were charged because it is still up — remove it from Publish once it can be deleted, and unused days come back.', { charged: charged.charged === true, refunded: false, delivered: false, cleanupPending: true });
    }
    const refunded = await deps.refund(clientRef).catch(() => ({ ok: false }));
    return refused(500, refunded.ok
      ? 'The database was ready but its keys could not be saved, so it was deleted and the charge was returned.'
      : 'The database was deleted because its keys could not be saved. The charge could not be returned automatically — it is not still running. Try Remove again.', { charged: charged.charged === true, refunded: refunded.ok, delivered: false, cleanupPending: false });
  }
  const sharedNote = deps.quoteInput.product === 'shared'
    ? ' Connect verified sign-in with configureNbaiAuth, then publish the app again. Users can access their own records; older unowned records stay available only to the app owner. The app key alone grants no access.'
    : '';
  return {
    status: 200,
    body: {
      ok: true,
      charged: charged.charged === true,
      url: created.url,
      message: charged.charged
        ? `Your database is ready and wired into this app. ₹${quote.priceInr} was taken from your wallet for 30 days.${sharedNote}`
        : `Your database is ready. This one was already paid for, so nothing extra was charged.${sharedNote}`,
    },
  };
}

/** Rows the quote needs. Expired rows are the caller's job to filter out. */
export type { ResellAddonRow };
