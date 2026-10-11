/** A tool call that was refused before it did any work. `dispatch()` maps this to `is_error: true`. */
export class ToolRefusal extends Error {
  readonly isToolRefusal = true;
  constructor(message: string) {
    super(message);
    this.name = 'ToolRefusal';
  }
}

/** Refuse a tool call. The message reaches the model verbatim (no `Error:` prefix). */
export function refuse(message: string): never {
  throw new ToolRefusal(message);
}
