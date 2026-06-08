import { AIRouter } from "../../AI/Router/AIRouter";
import { VertexProvider } from "../../AI/Router/providers/VertexProvider";
import { GeminiProvider } from "../../AI/Router/providers/GeminiProvider";
import { AnthropicProvider } from "../../AI/Router/providers/AnthropicProvider";
import { StructuredRequirementModel } from "../types/RequirementModels";
import { Type } from "@google/genai";

export class RequirementIntelligenceEngine {
    private router: AIRouter;

    constructor() {
        this.router = new AIRouter();
        console.log("Registering providers...");
        this.router.registerProvider(new VertexProvider());
        this.router.registerProvider(new GeminiProvider());
        this.router.registerProvider(new AnthropicProvider());
    }

    async parse(prompt: string): Promise<StructuredRequirementModel> {
        const schema = {
            type: Type.OBJECT,
            properties: {
                domain: { type: Type.STRING },
                projectType: { type: Type.STRING },
                pages: { type: Type.ARRAY, items: { type: Type.STRING } },
                entities: { type: Type.ARRAY, items: { type: Type.STRING } },
                features: { type: Type.ARRAY, items: { type: Type.STRING } },
                apis: { type: Type.ARRAY, items: { type: Type.STRING } },
                auth: { type: Type.OBJECT, properties: { enabled: { type: Type.BOOLEAN }, provider: { type: Type.STRING } } },
                database: { type: Type.OBJECT, properties: { enabled: { type: Type.BOOLEAN }, type: { type: Type.STRING } } },
                integrations: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["domain", "projectType", "pages", "entities", "features", "apis", "auth", "database", "integrations"]
        };
        
        return this.router.generate(prompt, schema);
    }
}
