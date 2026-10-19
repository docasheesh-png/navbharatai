// THE CHARGE THE USER IS SHOWN IS THE CHARGE THAT WAS TAKEN (r6–r10 autopsy, 2026-10-18).
//
// When walletDebit.ts's overdraft floor (floorCharge, L120) caps a debit, the build's billing record and the
// result event still carried only the PRE-cap bill, so the report and the user read a charge the wallet never
// paid. These fields sit beside `billedInr` (which stays the bill — no price change): `walletDebitedInr` is what
// actually left the wallet, `absorbedInr` what the floor made us eat, `partialDebit` flags the gap. PURE.

export function chargeRecordFields(d: { debitedInr?: number; absorbedInr?: number } | null | undefined):
  { walletDebitedInr?: number; absorbedInr?: number; partialDebit?: true } {
  if (!d || typeof d.debitedInr !== 'number' || !Number.isFinite(d.debitedInr)) return {};
  const absorbed = typeof d.absorbedInr === 'number' && Number.isFinite(d.absorbedInr) && d.absorbedInr > 0
    ? Math.round(d.absorbedInr * 100) / 100 : 0;
  return {
    walletDebitedInr: Math.round(d.debitedInr * 100) / 100,
    ...(absorbed > 0 ? { absorbedInr: absorbed, partialDebit: true as const } : {}),
  };
}
