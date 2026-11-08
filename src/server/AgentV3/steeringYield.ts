export const STEERING_YIELD_REASON = 'simple-build fast lane stopped early — a new user instruction is queued; yield to the instruction-owning builder';
export const isSteeringYield = (reason: string | undefined): boolean => !!reason?.includes(STEERING_YIELD_REASON);
