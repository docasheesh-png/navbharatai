import { AnthropicProvider } from './Router/providers/AnthropicProvider';
import { GeminiProvider } from './Router/providers/GeminiProvider';
import { VertexProvider } from './Router/providers/VertexProvider';
import { AIRouter } from './Router/AIRouter';
import { ModelHealthRegistry } from './HealthRegistry';

export class AIRouterManager {
    private static instanceFree: AIRouter | null = null;
    private static instancePro: AIRouter | null = null;
    private static registryFree = new ModelHealthRegistry('free');
    private static registryPro = new ModelHealthRegistry('pro');

    static getRouter(namespace: 'free' | 'pro'): AIRouter {
        if (namespace === 'pro') {
            if (!this.instancePro) {
                this.instancePro = this.createRouterInstance('pro');
            }
            return this.instancePro;
        } else {
            if (!this.instanceFree) {
                this.instanceFree = this.createRouterInstance('free');
            }
            return this.instanceFree;
        }
    }

    private static createRouterInstance(namespace: 'free' | 'pro'): AIRouter {
        const router = new AIRouter();
        console.log(`[DEBUG] Creating router for ${namespace}. GOOGLE_CLOUD_PROJECT: ${process.env.GOOGLE_CLOUD_PROJECT}, GOOGLE_CLOUD_PROJECT_ID: ${process.env.GOOGLE_CLOUD_PROJECT_ID}`);
        console.log(`[DEBUG] Router providers count before registration: ${(router as any).providers?.length || 0}`);
        
        try {
            console.log(`[DEBUG] Instantiating VertexProvider for ${namespace}...`);
            const vertexProvider = new VertexProvider();
            console.log(`[DEBUG] VertexProvider instantiated for ${namespace}`);
            
            console.log(`[DEBUG] Registering VertexProvider for ${namespace}...`);
            router.registerProvider(vertexProvider);
            console.log(`[DEBUG] VertexProvider registered for ${namespace}`);
            console.log(`[DEBUG] Router providers count after Vertex registration: ${(router as any).providers?.length || 0}`);
        } catch (e) {
            console.error(`[ERROR] Failed to register VertexProvider for ${namespace}:`, e);
        }

        router.registerProvider(new GeminiProvider());
        console.log(`[DEBUG] GeminiProvider registered for ${namespace}`);
        console.log(`[DEBUG] Router providers count after Gemini registration: ${(router as any).providers?.length || 0}`);
        
        router.registerProvider(new AnthropicProvider());
        console.log(`[DEBUG] AnthropicProvider registered for ${namespace}`);
        
        return router;
    }
}
