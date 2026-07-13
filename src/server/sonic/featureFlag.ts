// Sonic Chat (Amazon Nova Sonic voice) — feature flag.
//
// EXPERIMENT (admin 2026-07-13): an ISOLATED, real-time speech-to-speech voice chat
// backed by Amazon Nova Sonic on Bedrock. It is OFF by default and fully self-contained
// so it can be tested on a real deploy and either kept (wired into NavBharatAI Free) or
// deleted without touching anything else. Two independent off-switches, like the AgentV3
// cheap floor: the flag AND real AWS credentials must both be present, else every entry
// point is inert (the WS route refuses the upgrade; the UI hides the surface).

/** The Nova Sonic model id (region us-east-1). Env-overridable. */
export function sonicModelId(): string {
  return (process.env.SONIC_MODEL_ID || 'amazon.nova-2-sonic-v1:0').trim();
}

/** The AWS region Nova Sonic runs in (playground default us-east-1). */
export function sonicRegion(): string {
  return (process.env.AWS_REGION || process.env.SONIC_REGION || 'us-east-1').trim();
}

/** True only when the flag is on AND real AWS credentials are present. */
export function isSonicEnabled(): boolean {
  if (process.env.SONIC_CHAT_ENABLED !== 'true') return false;
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}
