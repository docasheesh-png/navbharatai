import { AIProvider, AIProviderResponse, ProviderTelemetry } from './ProviderTypes';

// Per-provider cooldown tracker (module-level singleton — shared across all requests)
const cooldownUntil = new Map<string, number>();
// Per-provider in-flight request counter (concurrency limiter)
const inFlight = new Map<string, number>();
const MAX_IN_FLIGHT = 8;

function isOnCooldown(name: string): boolean {
  return Date.now() < (cooldownUntil.get(name) || 0);
}

function setCooldown(name: string, seconds: number) {
  const until = Date.now() + seconds * 1000;
  cooldownUntil.set(name, until);
  console.log(`[CIRCUIT] ${name} on cooldown for ${seconds}s (until ${new Date(until).toISOString()})`);
}

function acquireSlot(name: string): boolean {
  const count = inFlight.get(name) || 0;
  if (count >= MAX_IN_FLIGHT) return false;
  inFlight.set(name, count + 1);
  return true;
}

function releaseSlot(name: string) {
  inFlight.set(name, Math.max(0, (inFlight.get(name) || 1) - 1));
}

function cooldownSeconds(error: any): number {
  const msg = String(error?.message || error?.status || '');
  let base: number;
  if (msg.includes('429') || msg.toLowerCase().includes('rate') || msg.toLowerCase().includes('quota')) base = 90;
  else if (msg.includes('503') || msg.includes('overloaded')) base = 45;
  else if (msg.toLowerCase().includes('timeout')) base = 15;
  else base = 10;
  // ±20% jitter — prevents thundering herd when many users retry simultaneously
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export class AIRouter {
  private providers: AIProvider[] = [];

  registerProvider(provider: AIProvider) {
    this.providers.push(provider);
    this.providers.sort((a, b) => a.priority - b.priority);
  }

  async route(prompt: string, systemPrompt?: string): Promise<{ response: AIProviderResponse; telemetry: ProviderTelemetry }> {
    return this.execute(prompt, undefined, systemPrompt);
  }

  async generate(prompt: string, schema: any): Promise<any> {
    const { response } = await this.execute(prompt, schema);
    return JSON.parse(response.content);
  }

  async routeStream(
    prompt: string,
    systemPrompt: string | undefined,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    for (const pass of [1, 2]) {
      for (const provider of this.providers) {
        if (signal?.aborted) return;
        if (pass === 1 && isOnCooldown(provider.name)) continue;
        const concurrent = inFlight.get(provider.name) || 0;
        if (concurrent >= MAX_IN_FLIGHT) {
          console.log(`[CAPACITY] ${provider.name} at max ${MAX_IN_FLIGHT} concurrent, skipping`);
          continue;
        }
        const healthy = await provider.healthCheck().catch(() => false);
        if (!healthy) continue;
        if (!acquireSlot(provider.name)) continue;
        try {
          if (provider.executeStream) {
            await provider.executeStream(prompt, systemPrompt, onChunk);
          } else {
            const resp = await provider.execute(prompt, undefined, undefined, systemPrompt);
            if (!signal?.aborted) onChunk(resp.content);
          }
          return;
        } catch (err: any) {
          const secs = cooldownSeconds(err);
          setCooldown(provider.name, secs);
          console.error(`[ROUTER_STREAM] ${provider.name} failed, cooldown ${secs}s:`, err?.message?.slice(0, 80));
        } finally {
          releaseSlot(provider.name);
        }
      }
    }
    if (!signal?.aborted) {
      onChunk('Abhi AI service thodi der ke liye busy hai. Kripya 1-2 minute mein dobara try karein. 🙏');
    }
  }

  private async execute(prompt: string, schema?: any, systemPrompt?: string): Promise<{ response: AIProviderResponse; telemetry: ProviderTelemetry }> {
    const targetSchema = schema?.type === 'OBJECT' ? schema : undefined;
    const errors: string[] = [];

    // Pass 1: skip providers on cooldown — try fast path first
    // Pass 2: if all on cooldown, try them anyway (better than error)
    for (const pass of [1, 2]) {
      for (const provider of this.providers) {
        const onCooldown = isOnCooldown(provider.name);
        if (pass === 1 && onCooldown) {
          console.log(`[CIRCUIT] Skipping ${provider.name} (cooldown active)`);
          continue;
        }

        const isHealthy = await provider.healthCheck().catch(() => false);
        if (!isHealthy) {
          console.log(`[ROUTER] ${provider.name} healthCheck=false, skipping`);
          continue;
        }

        const concurrent = inFlight.get(provider.name) || 0;
        if (concurrent >= MAX_IN_FLIGHT) {
          console.log(`[CAPACITY] ${provider.name} at max ${MAX_IN_FLIGHT} concurrent, skipping`);
          continue;
        }
        if (!acquireSlot(provider.name)) continue;
        try {
          const startTime = Date.now();
          console.log(`[ROUTER] Trying ${provider.name} (pass ${pass}, in-flight ${concurrent + 1})...`);
          const response = await provider.execute(prompt, targetSchema, undefined, systemPrompt);
          const latency = Date.now() - startTime;
          console.log(`[ROUTER] ${provider.name} SUCCESS in ${latency}ms`);

          return {
            response,
            telemetry: { provider: provider.name, retries: errors.length, latency, success: true },
          };
        } catch (error: any) {
          const secs = cooldownSeconds(error);
          console.error(`[ROUTER] ${provider.name} FAILED (${error?.message?.slice(0, 80)}), cooldown ${secs}s`);
          setCooldown(provider.name, secs);
          errors.push(`${provider.name}: ${error?.message?.slice(0, 60)}`);
        } finally {
          releaseSlot(provider.name);
        }
      }
    }

    // All 4 providers failed both passes — last-resort graceful message
    console.error('[ROUTER] ALL PROVIDERS FAILED:', errors);
    return {
      response: {
        content: 'Abhi AI service thodi der ke liye busy hai. Kripya 1-2 minute mein dobara try karein. 🙏',
        latencyMs: 0,
        provider: 'GEMINI',
        model: 'fallback',
      },
      telemetry: { provider: 'NONE', retries: errors.length, latency: 0, success: false },
    };
  }
}
