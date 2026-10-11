// What the admin's margin cards print, read from the server's ONE platform margin (Q-114 — see
// src/server/lib/platformMargin.ts). Two cards on two tabs used to each print revenue minus CHAT cost, one of
// them labelled plainly "Net Margin". Both now read this, so they cannot disagree, and the words change
// with the certainty: a cost that could not be fully measured is "at least", so the margin is "at most".

export interface PlatformMarginPayload {
  days?: number;
  revenueInr?: number;
  chat?: { costInr?: number; complete?: boolean };
  builds?: { costInr?: number; complete?: boolean };
  assistants?: { costInr?: number; complete?: boolean };
  costInr?: number;
  complete?: boolean;
  marginInr?: number;
}

const inr = (n: unknown): string => `₹${(Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export interface PlatformMarginView {
  marginLabel: string;
  marginValue: string;
  marginSub: string;
  costLabel: string;
  costValue: string;
  costSub: string;
  positive: boolean;
}

/** Null when the server sent no margin (an older server) — the card then says nothing rather than ₹0. */
export function platformMarginView(pm: PlatformMarginPayload | null | undefined): PlatformMarginView | null {
  if (!pm || typeof pm !== 'object' || !Number.isFinite(Number(pm.marginInr))) return null;
  const days = Number.isFinite(Number(pm.days)) ? Number(pm.days) : 30;
  const exact = pm.complete === true;
  const parts = `chat ${inr(pm.chat?.costInr)} · builds ${inr(pm.builds?.costInr)} · assistants ${inr(pm.assistants?.costInr)}`;
  const unmeasured = [
    pm.chat?.complete === false ? 'chat' : '',
    pm.builds?.complete === false ? 'builds' : '',
    pm.assistants?.complete === false ? 'assistants' : '',
  ].filter(Boolean).join(', ');
  return {
    marginLabel: `Platform margin · ${days} days${exact ? '' : ' (at most)'}`,
    marginValue: inr(pm.marginInr),
    marginSub: `Revenue ${inr(pm.revenueInr)} minus AI cost ${inr(pm.costInr)} (${parts})`,
    costLabel: `AI cost · ${days} days${exact ? '' : ' (at least)'}`,
    costValue: inr(pm.costInr),
    costSub: unmeasured ? `${parts} · not fully measured: ${unmeasured}` : parts,
    positive: Number(pm.marginInr) >= 0,
  };
}
