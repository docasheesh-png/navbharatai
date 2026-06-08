import { AIProvider, AIProviderResponse, ProviderTelemetry } from './ProviderTypes';

export class AIRouter {
  private providers: AIProvider[] = [];

  registerProvider(provider: AIProvider) {
    this.providers.push(provider);
    this.providers.sort((a, b) => a.priority - b.priority);
  }

  async route(prompt: string): Promise<{ response: AIProviderResponse; telemetry: ProviderTelemetry }> {
    return this.execute(prompt);
  }

  // Support for structured generation
  async generate(prompt: string, schema: any): Promise<any> {
    const { response } = await this.execute(prompt, schema);
    console.log("Provider response content:", response.content);
    return JSON.parse(response.content);
  }

  private async execute(prompt: string, schema?: any): Promise<{ response: AIProviderResponse; telemetry: ProviderTelemetry }> {
    let retries = 0;
    const maxRetries = 3;
    const targetSchema = schema?.type === 'OBJECT' ? schema : undefined;

    for (const provider of this.providers) {
      try {
        const isHealthy = await provider.healthCheck();
        console.log(`Checking provider ${provider.name}: ${isHealthy ? 'Healthy' : 'Unhealthy'}`);
        if (!isHealthy) continue;

        const startTime = Date.now();
        console.log(`Executing ${provider.name}...`);
        const response = await provider.execute(prompt, targetSchema);
        const latency = Date.now() - startTime;

        return {
          response,
          telemetry: {
            provider: provider.name,
            retries,
            latency,
            success: true
          }
        };
      } catch (error) {
        retries++;
        console.error(`Provider ${provider.name} failed`, error);
        if (retries >= maxRetries) {
          throw new Error('All providers failed');
        }
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 100));
      }
    }
    throw new Error('No providers available');
  }
}
