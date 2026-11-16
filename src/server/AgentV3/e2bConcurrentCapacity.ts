/**
 * The E2B concurrent-sandbox cap message, in one place.
 *
 * A proven cap is not evidence that the workspace's machine is gone. Replacing
 * it would split the workspace. The message must stay exact: a broader match
 * would treat an ordinary rate-limit or a quoted sentence as a cap.
 */
export const E2B_CONCURRENT_CAPACITY_RE =
  /^(?:Error:\s*)?Rate limit exceeded, please try again later - you have reached the maximum number of concurrent E2B sandboxes \(\d+\)/;

export function isE2BConcurrentCapacityMessage(value: string): boolean {
  return E2B_CONCURRENT_CAPACITY_RE.test(value);
}

export function isE2BConcurrentCapacityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return isE2BConcurrentCapacityMessage(message);
}
