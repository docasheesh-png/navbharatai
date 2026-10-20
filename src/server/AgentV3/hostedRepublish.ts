import type { DeploymentRecord } from './DeploymentStore';

/** Shared moderation rule for static and server publishing; no runtime store dependencies. */
export function hostedRepublishRefusal(existing: Pick<DeploymentRecord, 'status'> | null | undefined): string | null {
  if (existing?.status === 'taken_down') {
    return 'This app was taken down for a policy violation and cannot be published again. Contact support if you believe this is a mistake.';
  }
  if (existing?.status === 'held') {
    return 'This app is held for review, so it cannot be published again until the review is finished. Contact support if you believe this is a mistake.';
  }
  return null;
}
