// AgentV3 — multi-provider deploy abstraction (R5 §5.1, "no lock-in").
//
// NavBharatAI must never depend on a single hosting provider. This module defines a small
// DeployProvider interface and a registry, so the deploy flow can publish a built app to ANY
// configured provider (Firebase, Netlify, Vercel, GitHub Pages, …) and honestly report which
// providers are available right now versus which still need an API token.
//
// Each provider is REAL: it either deploys for real, or — when its credential is missing — reports
// `configured: false` with an honest requirement string. There is no fake/placeholder provider.

import { FirebaseHostingDeployer } from './Deployment';

/** Per-request context a provider may need (e.g. the user's GitHub token for GitHub Pages). */
export interface DeployContext {
  userId?: string | null;
  /** The signed-in user's GitHub OAuth token, when available (for GitHub Pages). */
  githubToken?: string;
}

/** Public, serialisable status of a provider for the UI/chooser. */
export interface DeployProviderInfo {
  id: string;
  name: string;
  /** 'static' = front-end/static sites; 'fullstack' = runs a server/backend. */
  kind: 'static' | 'fullstack';
  /** True when the provider can deploy right now (its credentials are present). */
  configured: boolean;
  /** Honest, human-readable note: what to set to enable it, or that it is always available. */
  requirement: string;
}

export interface DeployProvider extends Omit<DeployProviderInfo, 'configured'> {
  /** Whether the provider's credentials are present so it can actually deploy. */
  isConfigured(ctx: DeployContext): boolean;
  /** Deploy the built static files; resolves to the live public URL. */
  deploy(workspaceId: string, files: Map<string, Buffer>, ctx: DeployContext): Promise<string>;
}

// ── Firebase Hosting (always available via the platform Google Cloud service account / ADC) ──
const firebaseProvider: DeployProvider = {
  id: 'firebase',
  name: 'Firebase Hosting',
  kind: 'static',
  requirement: 'Always available (uses the platform Google Cloud service account).',
  isConfigured: () => true,
  deploy: (workspaceId, files) => new FirebaseHostingDeployer().deployStatic(workspaceId, files),
};

// The live registry. Providers are added here as each real implementation lands (no placeholders).
const PROVIDERS: DeployProvider[] = [firebaseProvider];

/** Register a provider (used by each provider module + tests). Replaces any existing same-id entry. */
export function registerDeployProvider(provider: DeployProvider): void {
  const i = PROVIDERS.findIndex((p) => p.id === provider.id);
  if (i >= 0) PROVIDERS[i] = provider;
  else PROVIDERS.push(provider);
}

/** All registered providers. */
export function listDeployProviders(): DeployProvider[] {
  return [...PROVIDERS];
}

/** Look up a provider by id, or undefined. */
export function getDeployProvider(id: string): DeployProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** The default provider id when none is chosen. */
export const DEFAULT_DEPLOY_PROVIDER = 'firebase';

/** Serialisable status of every provider — for the UI chooser and the status endpoint. */
export function deployProviderStatus(ctx: DeployContext = {}): DeployProviderInfo[] {
  return PROVIDERS.map((p) => {
    let configured = false;
    try { configured = p.isConfigured(ctx); } catch { configured = false; }
    return { id: p.id, name: p.name, kind: p.kind, requirement: p.requirement, configured };
  });
}
