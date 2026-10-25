/** A synchronous lock for the time before the build hook owns a request. */
export type SubmissionPhase = 'attachments' | 'saving' | 'features' | 'framework' | 'confirmation' | 'starting';
export interface SubmissionTicket {
  readonly sessionId: string;
  readonly abort: AbortController;
  launched: boolean;
}
export class SubmissionScope {
  private active: SubmissionTicket | null = null;
  get busy(): boolean { return this.active !== null; }
  begin(sessionId: string): SubmissionTicket | null {
    if (this.active) return null;
    return this.active = { sessionId, abort: new AbortController(), launched: false };
  }
  current(ticket: SubmissionTicket, sessionId: string): boolean {
    return this.active === ticket && ticket.sessionId === sessionId && !ticket.abort.signal.aborted;
  }
  launch(ticket: SubmissionTicket, sessionId: string): boolean {
    if (!this.current(ticket, sessionId) || ticket.launched) return false;
    ticket.launched = true;
    return true;
  }
  finish(ticket: SubmissionTicket): boolean {
    if (this.active !== ticket) return false;
    this.active = null;
    return true;
  }
  cancel(): void {
    this.active?.abort.abort();
    this.active = null;
  }
}
export const submissionStatus: Record<SubmissionPhase, string> = {
  attachments: 'Preparing attachments…',
  saving: 'Saving your edits…',
  features: 'Checking requested features…',
  framework: 'Waiting for your framework choice. Nothing has started yet.',
  confirmation: 'Waiting for your feature confirmation. Nothing has started yet.',
  starting: 'Starting your request…',
};
export function submissionIsWorking(phase: SubmissionPhase): boolean {
  return phase !== 'framework' && phase !== 'confirmation';
}
