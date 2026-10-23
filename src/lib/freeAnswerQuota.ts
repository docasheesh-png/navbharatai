/** Public user-turn accounting only; never provider cost, model or account details. */
export interface FreeAnswerQuotaStatus {
  day: string;
  limit: number;
  /** Completed answers plus uncertain expired/disconnected attempts, excluding today's live hold. */
  used: number;
  /** Today's held answer credit. An active turn begun yesterday can have reserved=0. */
  reserved: 0 | 1;
  remaining: number;
  inProgress: boolean;
  resetsAt: number;
}
export const FREE_ANSWER_AUTHENTICATED_LIMIT = 20;
export const FREE_ANSWER_GUEST_LIMIT = 5;
