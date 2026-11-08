import type { GatewayFundingBoundary } from './context';
/** Supplier liability is separate from the unchanged after-answer user wallet price.
 * No migration, default allowance, or cross-pool borrowing is performed here.
 */
export type ImplementedSupplierFunding = 'platform-free-fallback' | 'existing-professional';
export function supplierFundingCollection(funding: GatewayFundingBoundary): 'free_chat_chain' | 'professional_inference' {
  if (funding === 'platform-free-fallback') return 'free_chat_chain';
  if (funding === 'existing-professional') return 'professional_inference';
  throw new Error('Supplier funding is not integrated for this boundary');
}
export function supplierFundingSurface(funding: GatewayFundingBoundary, surface: string): boolean {
  return funding === 'platform-free-fallback' ? ['chat', 'professional', 'doctor', 'sda'].includes(surface)
    : funding === 'existing-professional' && ['professional', 'doctor', 'sda', 'developer-api'].includes(surface);
}
