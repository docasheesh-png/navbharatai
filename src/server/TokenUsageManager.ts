export class TokenUsageManager {
  private usage: Record<string, any> = {};

  logUsage(provider: string, model: string, inputTokens: number, outputTokens: number) {
    const key = `${provider}:${model}`;
    if (!this.usage[key]) {
      this.usage[key] = { inputTokens: 0, outputTokens: 0, requestCount: 0 };
    }
    this.usage[key].inputTokens += inputTokens;
    this.usage[key].outputTokens += outputTokens;
    this.usage[key].requestCount += 1;
  }

  getUsage() {
    return this.usage;
  }
}
