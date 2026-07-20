// AgentV3 — prompt → framework detection (server entry point).
//
// The detection + bidirectional-selection logic now lives in the SHARED module `src/lib/frameworkDetect`
// so the CLIENT (pre-build conflict confirm) and the SERVER (build route) use ONE source of truth and can
// never drift. This file re-exports it, keeping every existing server import path (`./PromptFramework`)
// working unchanged.
export {
  detectFrameworkFromPrompt,
  detectBackendOnlyFramework,
  resolveFrameworkSelection,
  DETECTABLE_FRAMEWORK_IDS,
  type FrameworkResolution,
} from '../../lib/frameworkDetect';
