const known = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Admission facts are diagnostics, not a reservation or a final debit. No wallet policy changes. */
export function buildWalletBudgetDiagnostic(balanceInr: number | null, estimateInr: number | null) {
  return {
    phase: 'build' as const, severity: 'info' as const, code: 'BUILD_WALLET_BUDGET', autoResolved: true,
    message: 'Wallet affordability uses the balance captured at admission and a build estimate. The estimate is not a completion guarantee or a wallet debit.',
    detail: JSON.stringify({ balanceAtAdmissionInr: known(balanceInr), estimatedBuildCostInr: known(estimateInr),
      note: 'Null means not captured (exempt account or unknown balance). Final settlement decides the actual charge.' }),
  };
}

export function buildWalletStopDetail(balanceInr: number, estimateInr: number | null, provisionalCostInr: number): string {
  return JSON.stringify({
    balanceAtAdmissionInr: known(balanceInr), estimatedBuildCostInr: known(estimateInr),
    provisionalBuildCostInr: known(provisionalCostInr),
    note: 'The provisional cost exceeded this build\'s admitted wallet budget. This guard does not debit the wallet. Final settlement can waive a failed build; compiler and runtime findings remain separate.',
  });
}
