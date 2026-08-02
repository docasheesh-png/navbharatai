import 'dotenv/config';
import { VertexAI } from '@google-cloud/vertexai';
import { AIProvider, AIProviderResponse, readProviderUsage } from '../ProviderTypes';

export class VertexProvider implements AIProvider {
    name: 'VERTEX' = 'VERTEX';
    priority = 1;
    private isConfigured: boolean = false;
    private vertexAI: VertexAI | null = null;
    private modelPro = 'gemini-2.5-pro';
    private modelFlash = 'gemini-2.5-flash';

    constructor() {
        const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
        const location = process.env.GOOGLE_CLOUD_REGION || 'us-central1';

        console.log(`[VERTEX] GOOGLE_CLOUD_PROJECT=${process.env.GOOGLE_CLOUD_PROJECT}`);
        console.log(`[VERTEX] GOOGLE_CLOUD_PROJECT_ID=${process.env.GOOGLE_CLOUD_PROJECT_ID}`);
        console.log(`[VERTEX] FINAL_PROJECT_ID=${projectId}`);
        console.log(`[VERTEX] LOCATION=${location}`);

        if (projectId) {
            this.vertexAI = new VertexAI({
                project: projectId,
                location: location
            });
            this.isConfigured = true;
        } else {
            console.warn("GOOGLE_CLOUD_PROJECT/GOOGLE_CLOUD_PROJECT_ID not set, VertexProvider disabled");
        }
    }

    async execute(prompt: string, schema?: any, modelOverride?: string, systemPrompt?: string): Promise<AIProviderResponse> {
        if (!this.vertexAI) {
            throw new Error("Vertex AI not configured");
        }
        const startTime = Date.now();
        const modelName = modelOverride || this.modelPro;
        const modelConfig: any = { model: modelName };
        if (systemPrompt) {
            modelConfig.systemInstruction = { role: 'system', parts: [{ text: systemPrompt }] };
        }
        const model = this.vertexAI.getGenerativeModel(modelConfig);

        let retries = 0;
        const maxRetries = 2;

        while (true) {
            try {
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Vertex AI Timeout')), 30000)
                );

                const result = await Promise.race([
                    model.generateContent({
                        contents: [{ role: 'user', parts: [{ text: prompt }] }]
                    }),
                    timeoutPromise
                ]) as any;

                return {
                    content: result.response.candidates[0].content.parts[0].text || '',
                    latencyMs: Date.now() - startTime,
                    provider: 'VERTEX',
                    model: modelName,
                    usage: readProviderUsage(result.response?.usageMetadata),
                };
            } catch (error: any) {
                retries++;
                if (retries > maxRetries || (error.status !== 429 && !error.message.includes('429'))) {
                    throw this.normalizeError(error);
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries)));
            }
        }
    }

    private normalizeError(error: any): Error {
        if (error.status === 429 || error.message?.includes('429')) {
            return new Error('Vertex AI Rate Limited (429)');
        }
        return new Error(`Vertex AI Error: ${error.message}`);
    }

    async executeStream(prompt: string, systemPrompt: string | undefined, onChunk: (text: string) => void): Promise<string> {
        if (!this.vertexAI) throw new Error('Vertex AI not configured');
        const modelConfig: any = { model: this.modelPro };
        if (systemPrompt) modelConfig.systemInstruction = { role: 'system', parts: [{ text: systemPrompt }] };
        const model = this.vertexAI.getGenerativeModel(modelConfig);
        const result = await model.generateContentStream({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
        });
        let full = '';
        for await (const chunk of result.stream) {
            const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (text) { full += text; onChunk(text); }
        }
        return full;
    }

    async healthCheck(): Promise<boolean> {
        if (!this.vertexAI) {
            return false;
        }
        // Basic check if configured
        return this.isConfigured;
    }
}
