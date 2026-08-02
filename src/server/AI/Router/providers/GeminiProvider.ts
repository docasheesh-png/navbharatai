import { AIProvider, AIProviderResponse, readProviderUsage } from '../ProviderTypes';
import { GoogleGenAI } from "@google/genai";

export class GeminiProvider implements AIProvider {
  name: 'GEMINI' = 'GEMINI';
  priority = 2;

  async execute(prompt: string, schema?: any, modelOverride?: string, systemPrompt?: string): Promise<AIProviderResponse> {
    console.log(`[GeminiProvider] Entry. Key present: ${!!process.env.GEMINI_API_KEY}, Length: ${process.env.GEMINI_API_KEY?.length}`);
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const startTime = Date.now();
    const model = modelOverride || 'gemini-2.5-flash';
    console.log(`[GeminiProvider] Entry. Model: ${model}. Prompt Length: ${prompt.length} chars.`);

    try {
        const config: any = {};
        if (systemPrompt) config.systemInstruction = systemPrompt;
        if (schema) { config.responseMimeType = "application/json"; config.responseSchema = schema; }
        const result = await ai.models.generateContent({ model: model, contents: prompt, config: Object.keys(config).length ? config : undefined });
        
        const latency = Date.now() - startTime;
        console.log(`[GeminiProvider] Exit. Success. Latency: ${latency}ms.`);
        
        return {
          content: result.text || '',
          latencyMs: latency,
          provider: 'GEMINI',
          model: model,
          usage: readProviderUsage((result as any).usageMetadata),
        };
    } catch (error: any) {
        console.error(`[GeminiProvider] Exit. Error: ${error.message}. Latency: ${Date.now() - startTime}ms.`);
        throw error;
    }
  }

  async executeStream(prompt: string, systemPrompt: string | undefined, onChunk: (text: string) => void): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const model = 'gemini-2.5-flash';
    const config: any = {};
    if (systemPrompt) config.systemInstruction = systemPrompt;
    const stream = await ai.models.generateContentStream({
      model,
      contents: prompt,
      config: Object.keys(config).length ? config : undefined,
    });
    let full = '';
    for await (const chunk of stream) {
      const text = chunk.text || '';
      if (text) { full += text; onChunk(text); }
    }
    return full;
  }

  async healthCheck(): Promise<boolean> {
    return !!process.env.GEMINI_API_KEY;
  }
}
