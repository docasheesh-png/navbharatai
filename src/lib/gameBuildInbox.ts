/** App-owned, synchronous, owner-bound one-shot handoff. Never persisted/replayed. */
export type GameBuildRequest = { owner: string; text: string; id: number };
export class GameBuildInbox {
  private owner = '';
  private next = 0;
  private pending: GameBuildRequest | null = null;
  bind(owner: string): void {
    if (owner !== this.owner) { this.owner = owner; this.pending = null; }
  }
  put(owner: string, text: string): GameBuildRequest {
    this.bind(owner);
    return this.pending = { owner, text, id: ++this.next };
  }
  claim(owner: string, id: number): GameBuildRequest | null {
    const request = this.pending;
    if (!request || this.owner !== owner || request.owner !== owner || request.id !== id) return null;
    this.pending = null;
    return request;
  }
}
export function gameBuildTargetReady(request: { owner: string; session: string }, current: {
  owner: string; session: string; workspace?: string; running: boolean; switching: boolean;
}): boolean {
  return request.owner === current.owner && request.session === current.session &&
    !current.workspace && !current.running && !current.switching;
}
