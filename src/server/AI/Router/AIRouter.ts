import { AIProvider, AIProviderResponse, ProviderTelemetry } from './ProviderTypes';

// Per-provider cooldown tracker (module-level singleton — shared across all requests)
const cooldownUntil = new Map<string, number>();

function isOnCooldown(name: string): boolean {
  return Date.now() < (cooldownUntil.get(name) || 0);
}

function setCooldown(name: string, seconds: number) {
  const until = Date.now() + seconds * 1000;
  cooldownUntil.set(name, until);
  console.log(`[CIRCUIT] ${name} on cooldown for ${seconds}s (until ${new Date(until).toISOString()})`);
}

function cooldownSeconds(error: any): number {
  const msg = String(error?.message || error?.status || '');
  if (msg.includes('429') || msg.toLowerCase().includes('rate') || msg.toLowerCase().includes('quota')) return 90;
  if (msg.includes('503') || msg.includes('overloaded')) return 45;
  if (msg.toLowerCase().includes('timeout')) return 15;
  return 10;
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

  async routeStream(prompt: string, systemPrompt: string | undefined, onChunk: (text: string) => void): Promise<void> {
    for (const pass of [1, 2]) {
      for (const provider of this.providers) {
        if (pass === 1 && isOnCooldown(provider.name)) continue;
        const healthy = await provider.healthCheck().catch(() => false);
        if (!healthy) continue;
        try {
          if (provider.executeStream) {
            await provider.executeStream(prompt, systemPrompt, onChunk);
          } else {
            const resp = await provider.execute(prompt, undefined, undefined, systemPrompt);
            onChunk(resp.content);
          }
          return;
        } catch (err: any) {
          const secs = cooldownSeconds(err);
          setCooldown(provider.name, secs);
          console.error(`[ROUTER_STREAM] ${provider.name} failed, cooldown ${secs}s:`, err?.message?.slice(0, 80));
        }
      }
    }
    onChunk('Abhi AI service thodi der ke liye busy hai. Kripya 1-2 minute mein dobara try karein. 🙏');
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

        try {
          const startTime = Date.now();
          console.log(`[ROUTER] Trying ${provider.name} (pass ${pass})...`);
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
