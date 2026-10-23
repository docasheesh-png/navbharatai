import { validPaidCapNanoUsd } from './spendCap';

interface Publication { cap: number; promise: Promise<void>; retryAt?: number }
/** One current deployment observation per database object; never a cached spend authorization. */
const publications = new WeakMap<object, Publication>();
export const DEPLOYMENT_BUDGET_OBSERVATION_TIMEOUT_MS = 5_000;

function boundedObservation(observe: () => Promise<{ capNanoUsd: number; revision: number }>) {
  return new Promise<{ capNanoUsd: number; revision: number }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Budget observation timed out')),
      DEPLOYMENT_BUDGET_OBSERVATION_TIMEOUT_MS);
    // A timeout does not prove the write failed. A late lower limit remains valid;
    // callers fail closed and later reservations always reread durable authority.
    Promise.resolve().then(observe).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/**
 * Publish a stricter configured limit even if this turn never reaches a paid rung.
 * Successful observations coalesce per process/config. Every paid reservation must still
 * read the durable authority transactionally. Explicit admin changes are not overwritten
 * by status GETs or by continuously replaying a successful deployment observation.
 */
export function publishDeploymentPaidLimit(
  database: object,
  cap: number,
  observe: () => Promise<{ capNanoUsd: number; revision: number }>,
): Promise<void> {
  if (!validPaidCapNanoUsd(cap)) return Promise.reject(new Error('Invalid deployment budget'));
  const previous = publications.get(database);
  if (previous?.cap === cap && (previous.retryAt === undefined || Date.now() < previous.retryAt)) return previous.promise;
  const current: Publication = { cap, promise: Promise.resolve() };
  current.promise = boundedObservation(observe).then(policy => {
    if (!validPaidCapNanoUsd(policy.capNanoUsd) || policy.capNanoUsd > cap
      || !Number.isSafeInteger(policy.revision) || policy.revision < 1) throw new Error('Invalid shared budget observation');
  }).catch(() => {
    current.retryAt = Date.now() + 1_000;
    throw new Error('Shared paid-budget observation unavailable');
  });
  publications.set(database, current);
  return current.promise;
}
