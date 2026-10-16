// APP BRANDING FOR THE MOBILE SHIP (admin 2026-10-16: "APP LOGO AND NATIVE APP ICON MUST BOTH BE CUSTOM").
//
// THE CLASS. A native app that carries somebody else's picture on the user's home screen: Capacitor's default icon
// (no logo uploaded, or the icon generator failed with only a warning), another app's icon left in a reused native
// project, or the platform's own. Nothing used to look at what was inside the native project, so every one of those
// shipped silently.
//
// THE DESIGN. Three layers, each doing one job:
//   1. HERE (server, before the push): decide WHICH logo the app has — the user's own, else a freshly generated one,
//      else an explicitly declared "none" — and write it with the branding script into the project.
//   2. THE SCRIPT (scripts/nbai-branding.mjs, run on the GitHub runner): validate the logo, generate / apply the
//      launcher icons and splash, and verify the NATIVE project. It never finishes while the project still holds a
//      default or stale icon; if generation fails it applies an app-specific fallback and says so.
//   3. THE WORKFLOWS (mobileShipKit.ts): call the script before Gradle / Xcode, so the artifact is built from the
//      verified project.
//
// PURE apart from `generateAiLogo`, which is injected so it can be tested.
import { BRANDING_SCRIPT, BRANDING_SCRIPT_PATH } from './appBrandingScript';
import { fetchImageProHostImage, imageProConfigured } from './imageProHost';

export const BRANDING_JSON_PATH = 'resources/branding.json';

export type DeclaredLogo = 'user' | 'ai' | 'none';

export interface LogoDecision {
  declared: DeclaredLogo;
  /** The logo as a data URL when `declared` is 'user' or 'ai'. */
  dataUrl?: string;
  /** Why no AI logo exists, in words for the build report. Only set when `declared` is 'none'. */
  aiFailure?: string;
}

export interface AiLogoResult { dataUrl?: string; error?: string }
export type AiLogoGenerator = (prompt: string) => Promise<AiLogoResult>;

const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/i;

/** The prompt for an app's own logo. The app name goes in quotes so it is read as a name, not as an instruction. */
export function aiLogoPrompt(appName: string): string {
  const name = String(appName || 'App').replace(/["\s]+/g, ' ').trim().slice(0, 60) || 'App';
  return `A professional mobile app icon logo for an app named "${name}". Flat modern vector style, one bold simple symbol centred on a solid colourful background, square, no text, no letters, no watermark.`;
}

/**
 * Which logo does this app have? The user's explicit choice always wins; only when there is none is one generated.
 * Never throws — a generator that fails (or is not configured) yields `declared: 'none'` with the reason, and the
 * script then applies the explicit, app-specific fallback and reports it.
 */
export async function decideLogo(opts: {
  appName: string;
  iconDataUrl?: string;
  /** A logo generated for this app on an earlier ship — reused so the app's branding never changes between ships. */
  savedAiLogo?: string;
  generateAiLogo?: AiLogoGenerator | null;
}): Promise<LogoDecision> {
  if (opts.iconDataUrl && IMAGE_DATA_URL.test(opts.iconDataUrl.trim())) return { declared: 'user', dataUrl: opts.iconDataUrl.trim() };
  if (opts.savedAiLogo && IMAGE_DATA_URL.test(opts.savedAiLogo.trim())) return { declared: 'ai', dataUrl: opts.savedAiLogo.trim() };
  if (!opts.generateAiLogo) return { declared: 'none', aiFailure: 'AI logo generation is not available on this server' };
  try {
    const r = await opts.generateAiLogo(aiLogoPrompt(opts.appName));
    if (r.dataUrl && IMAGE_DATA_URL.test(r.dataUrl.trim())) return { declared: 'ai', dataUrl: r.dataUrl.trim() };
    return { declared: 'none', aiFailure: (r.error || 'the image service returned no picture').slice(0, 160) };
  } catch (e) {
    return { declared: 'none', aiFailure: String((e as Error)?.message || e).slice(0, 160) };
  }
}

/** The AI logo generator backed by the platform's image host, or null when it is switched off or not configured. */
export function serverAiLogoGenerator(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): AiLogoGenerator | null {
  if ((env.MOBILE_AI_LOGO || '').trim().toLowerCase() === 'off') return null;
  if (!imageProConfigured(env)) return null;
  return async (prompt) => {
    // A prompt the word ban refuses throws; decideLogo turns that into an honest "none".
    const r = await fetchImageProHostImage(prompt, { w: 1024, h: 1024 }, { env, fetchImpl });
    if (!r.image) return { error: r.error || 'no picture' };
    return { dataUrl: `data:${r.image.mimeType.split(';')[0]};base64,${r.image.base64}` };
  };
}

/** The seed that makes the fallback mark and colours specific to ONE app. Same app → same look; two apps → two looks. */
export function brandingSeed(appId: string, appName: string): string {
  return `${appId}|${appName}`;
}

/** The text files the branding step needs in the project. The logo bytes are written by the assembler beside them. */
export function brandingTextFiles(opts: { appName: string; appId: string; decision: LogoDecision; /** The exact file the logo was written to ('' when there is none). */ iconFile?: string }): Record<string, string> {
  const json = {
    appName: opts.appName,
    appId: opts.appId,
    declared: opts.decision.declared,
    iconFile: opts.iconFile || '',
    aiFailure: opts.decision.aiFailure || '',
    seed: brandingSeed(opts.appId, opts.appName),
  };
  return { [BRANDING_SCRIPT_PATH]: BRANDING_SCRIPT, [BRANDING_JSON_PATH]: JSON.stringify(json, null, 2) + '\n' };
}

/** One sentence for the ship notes, so the user is never left guessing which icon their app got. PURE. */
export function brandingNote(decision: LogoDecision): string {
  if (decision.declared === 'user') return 'Your logo is used for the app icon and the splash screen.';
  if (decision.declared === 'ai') return 'No logo was chosen, so one was generated for your app and is used for the app icon and the splash screen.';
  return `No logo was chosen and none could be generated (${decision.aiFailure || 'unavailable'}), so the app gets a unique mark of its own — pick a logo in the APK builder to replace it.`;
}
