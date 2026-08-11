// AgentV3 — "an imported project installs and runs itself" decision.
//
// ADMIN LAW (2026-08-10, verbatim): "navbharatai pro koi user kitni bhi badi file upload kyu na kare!
// usko llm / provider tak bhejki need hai hi nahi! ide/vsc jaise usko install kar ke preview chala dena
// hai bas!!" — however big the upload, it never needs to reach the model; install it and run the
// preview like an IDE/VS Code does.
//
// WHAT WAS WRONG. A .zip import landed the files durably and stopped in the FILES tab with nothing
// running the project. The only way to actually SEE the app was to type a message — which starts a full
// build turn and pushes the whole imported codebase through the model. A real build report showed
// exactly that shape: 37 imported files, 11 model calls, ~21-25k input tokens each, to accomplish what
// `npm install && npm run dev` does. Wrong twice over: the user pays for tokens that bought nothing,
// and the model is made responsible for an operation that is pure infrastructure.
//
// The boot itself already existed and is MODEL-FREE — `preview-diagnose` hydrates the sandbox from the
// durable files, installs dependencies, starts the dev server and publishes the URL, with zero model
// calls. So this is not a new capability; it is the import finally ASKING for the one we had.
//
// WHY THIS IS NOT THE EXISTING C1 AUTO-RESUME. C1 answers "the preview is empty — is anything up?" and
// is deliberately gated to once per workspace so it can never loop. An import asks a different question
// — "there are NEW files, run them" — which is true even when the workspace already resumed once and
// already has a URL. Answering it with C1's gate would silently skip the boot on every re-import.
//
// PURE. The fetch, the streaming progress and the mode switch live in PreviewSurface; the rule lives
// here so it can be tested and can never drift into a second copy elsewhere.

export interface ImportedBootSignals {
  /** Rises once per import. 0/undefined = no import has asked for a boot. */
  bootSignal?: number;
  /** The signal already acted on, so one import boots exactly one sandbox. */
  bootedFor: number;
  /** The workspace the files landed in. */
  workspaceId?: string;
  /**
   * The sandbox probe: true = a live backend exists, false = none, null = not probed YET.
   *
   * The three-way distinction matters. The probe is asynchronous and is still null for the first
   * moments after mount — which is exactly when an import arrives — so treating "not yet known" as
   * "no backend" would drop the boot for a timing reason. Null therefore means WAIT (the effect re-runs
   * when the probe lands), while an explicit false means there is genuinely nothing to boot.
   */
  livePreviewAvailable: boolean | null;
}

/** Should this import trigger the model-free install-and-run? Pure. */
export function shouldBootImportedProject(s: ImportedBootSignals): boolean {
  if (!s.bootSignal) return false;                     // no import asked
  if (s.bootSignal === s.bootedFor) return false;      // already booted for this one
  if (!s.workspaceId) return false;                    // nothing to hydrate from
  if (s.livePreviewAvailable !== true) return false;   // not probed yet, or no live backend at all
  return true;
}
