/** Owner 2026-11-01: all Pro bands pay a fixed fee on the discounted, pre-sandbox
 * user subtotal. This is a service fee, not measured infrastructure expense.
 * Call only AFTER failure/waiver/stop/free/discount rules; zero stays zero.
 */
export const PRO_SANDBOX_FEE_PCT = 2.5;
export function proSandboxFee(subtotalUsd: number): { subtotalUsd: number; feeUsd: number; totalUsd: number } {
  const subtotal = Number.isFinite(subtotalUsd) ? Math.max(0, subtotalUsd) : 0;
  const feeUsd = subtotal / 40;
  const totalUsd = subtotal + feeUsd;
  if (!Number.isFinite(totalUsd)) return { subtotalUsd: 0, feeUsd: 0, totalUsd: 0 };
  return { subtotalUsd: subtotal, feeUsd, totalUsd };
}
export function proSandboxFeeFields(fee: ReturnType<typeof proSandboxFee>) {
  return { preSandboxSubtotalUsd: fee.subtotalUsd, sandboxFeeUsd: fee.feeUsd, sandboxFeePct: PRO_SANDBOX_FEE_PCT };
}

/** Legacy waiver/stop copy describes an AI subtotal; it must not deny the separate fee. */
export function proSubtotalNotice(message: string): string {
  return message.replaceAll('no service charge', 'no AI service margin')
    + ' This describes the AI subtotal; the separately itemized sandbox service fee is 2.5% of that subtotal after any build discount.';
}
