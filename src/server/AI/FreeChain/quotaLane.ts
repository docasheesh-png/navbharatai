/** Local backpressure only: Firestore transactions remain the cross-replica quota authority. */
const MAX_LANES = 32;
const MAX_WAITERS = 1024;
const WAIT_MS = 10_000;
interface Job { start: () => void; reject: () => void; deadline: number; timer: ReturnType<typeof setTimeout> }
interface Lane { active: boolean; waiting: Job[] }
interface State { lanes: Map<string, Lane>; waiting: number }
const states = new WeakMap<object, State>();
export class QuotaLaneBusyError extends Error { constructor() { super('Quota transaction admission unavailable'); this.name = 'QuotaLaneBusyError'; } }
const busy = () => new QuotaLaneBusyError();

/** Different accounts can progress together. Same-account reads/reservations cannot stampede locally. */
export function inQuotaLane<T>(db: object, provider: string, run: () => Promise<T>): Promise<T> {
  let state = states.get(db);
  if (!state) { state = { lanes: new Map(), waiting: 0 }; states.set(db, state); }
  let lane = state.lanes.get(provider);
  if (!lane) {
    if (state.lanes.size >= MAX_LANES) return Promise.reject(busy());
    lane = { active: false, waiting: [] }; state.lanes.set(provider, lane);
  }
  const owner = state, queue = lane;
  if (queue.active && owner.waiting >= MAX_WAITERS) return Promise.reject(busy());
  const drain = () => {
    queue.active = false;
    while (queue.waiting.length) {
      const next = queue.waiting.shift()!;
      owner.waiting--; clearTimeout(next.timer);
      if (Date.now() >= next.deadline) { next.reject(); continue; }
      next.start(); return;
    }
    owner.lanes.delete(provider);
  };
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      queue.active = true;
      // A deadline never releases an already-running SDK transaction. Its physical completion owns the lane.
      void Promise.resolve().then(run).then(resolve, reject).finally(drain);
    };
    if (!queue.active) { start(); return; }
    const job: Job = { start, reject: () => reject(busy()), deadline: Date.now() + WAIT_MS,
      timer: undefined as unknown as ReturnType<typeof setTimeout> };
    job.timer = setTimeout(() => {
      const index = queue.waiting.indexOf(job);
      if (index < 0) return;
      queue.waiting.splice(index, 1); owner.waiting--; job.reject();
    }, WAIT_MS);
    owner.waiting++; queue.waiting.push(job);
  });
}
