import { assertLegacyInferenceAllowed } from '../../inferencePolicy';
import 'dotenv/config';
import { AIProvider, AIProviderResponse, readProviderUsage } from '../ProviderTypes';
import { vertexGenAI, vertexProjectId, vertexLocation } from '../../../lib/vertexGenAI';

/** How long one Vertex answer may take before the request is aborted (was a race that left it running). */
export const VERTEX_TIMEOUT_MS = 30_000;

export class VertexProvider implements AIProvider {
    name: 'VERTEX' = 'VERTEX';
    priority = 1;
    private isConfigured: boolean = false;
    private modelPro = 'gemini-2.5-pro';
    private modelFlash = 'gemini-2.5-flash';

    constructor() {
        const projectId = vertexProjectId();
        console.log(`[VERTEX] FINAL_PROJECT_ID=${projectId}`);
        console.log(`[VERTEX] LOCATION=${vertexLocation()}`);
        if (projectId) {
            this.isConfigured = true;
        } else {
            console.warn("GOOGLE_CLOUD_PROJECT/GOOGLE_CLOUD_PROJECT_ID not set, VertexProvider disabled");
        }
    }

    async execute(prompt: string, schema?: any, modelOverride?: string, systemPrompt?: string): Promise<AIProviderResponse> {
    assertLegacyInferenceAllowed('direct-text-provider');
        const ai = vertexGenAI();
        if (!ai) {
            throw new Error("Vertex AI not configured");
        }
        const startTime = Date.now();
        const modelName = modelOverride || this.modelPro;

        let retries = 0;
        const maxRetries = 2;

        while (true) {
            // The timeout ABORTS the request (Q-769). It used to race a timer against the call, so a slow
            // answer was abandoned by us while the connection stayed open behind it.
            const timer = new AbortController();
            const t = setTimeout(() => timer.abort(), VERTEX_TIMEOUT_MS);
            try {
                const config: Record<string, unknown> = { abortSignal: timer.signal };
                if (systemPrompt) config.systemInstruction = systemPrompt;
                const result = await ai.models.generateContent({
                    model: modelName,
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    config,
                });
                return {
                    content: result.text || '',
                    latencyMs: Date.now() - startTime,
                    provider: 'VERTEX',
                    model: modelName,
                    usage: readProviderUsage(result.usageMetadata),
                };
            } catch (error: any) {
                const err = timer.signal.aborted ? new Error('Vertex AI Timeout') : error;
                retries++;
                if (retries > maxRetries || !isRateLimited(err)) {
                    throw this.normalizeError(err);
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries)));
            } finally {
                clearTimeout(t);
            }
        }
    }

    private normalizeError(error: any): Error {
        if (isRateLimited(error)) {
            return new Error('Vertex AI Rate Limited (429)');
        }
        return new Error(`Vertex AI Error: ${error?.message}`);
    }

    /**
     * The client left: the request is aborted and no more is read (Q-621, Q-769).
     *
     * Since 2026-10-11 this rung runs on `@google/genai`, which takes `config.abortSignal` — the old
     * `@google-cloud/vertexai` took no signal at all, so all we could do was stop reading. ⚠️ Said exactly:
     * Google documents the abort as client-only ("will not cancel the request in the service. You will
     * still be charged usage"), so what it buys is the connection closed and the turn ended at once — not
     * a refund of what Google already generated. See `lib/vertexGenAI.ts`.
     */
    async executeStream(prompt: string, systemPrompt: string | undefined, onChunk: (text: string) => void, modelName?: string, signal?: AbortSignal): Promise<string> {
    assertLegacyInferenceAllowed('direct-text-provider');
        const ai = vertexGenAI();
        if (!ai) throw new Error('Vertex AI not configured');
        const request = { model: modelName || this.modelPro, contents: [{ role: 'user', parts: [{ text: prompt }] }], config: {} as Record<string, unknown> };
        if (systemPrompt) request.config.systemInstruction = systemPrompt;
        if (signal) request.config.abortSignal = signal;
        const stream = await ai.models.generateContentStream(request);
        let full = '';
        for await (const chunk of stream) {
            if (signal?.aborted) break;
            const text = chunk.text || '';
            if (text) { full += text; onChunk(text); }
        }
        return full;
    }

    async healthCheck(): Promise<boolean> {
        return this.isConfigured && !!vertexGenAI();
    }
}

/** A rate-limit answer, in either SDK's spelling. */
function isRateLimited(error: any): boolean {
    return error?.status === 429 || String(error?.message ?? '').includes('429');
}
