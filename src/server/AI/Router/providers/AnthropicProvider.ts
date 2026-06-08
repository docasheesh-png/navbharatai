import { AIProvider, AIProviderResponse } from '../ProviderTypes';
import Anthropic from '@anthropic-ai/sdk';

export class AnthropicProvider implements AIProvider {
  name: 'ANTHROPIC' = 'ANTHROPIC';
  priority = 3; 

  private client: Anthropic;

  constructor() {
    console.log("ANTHROPIC_API_KEY check:", !!process.env.ANTHROPIC_API_KEY);
    this.client = new Anthropic({ 
        apiKey: process.env.ANTHROPIC_API_KEY, 
        baseURL: process.env.ANTHROPIC_BASE_URL?.replace(/\/v1$/, '') 
    });
  }

  async execute(prompt: string, schema?: any): Promise<AIProviderResponse> {
    const startTime = Date.now();
    
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
    
    const response = await this.client.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 2048,
      messages: messages,
    });

    const content = (response.content[0] as Anthropic.TextBlock).text;

    return {
      content: content,
      latencyMs: Date.now() - startTime,
      provider: 'ANTHROPIC',
      model: 'claude-3-5-sonnet-20240620'
    };
  }

  async healthCheck(): Promise<boolean> {
    return !!process.env.ANTHROPIC_API_KEY;
  }
}
