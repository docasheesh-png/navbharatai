import { IGenerationEngine, Patch } from "./IGenerationEngine";
import { GenerationTask } from "./PlannerTypes";
import 'dotenv/config';
import { AIRouter } from "../../AI/Router/AIRouter";
import { VertexProvider } from "../../AI/Router/providers/VertexProvider";
import { GeminiProvider } from "../../AI/Router/providers/GeminiProvider";
import { AnthropicProvider } from "../../AI/Router/providers/AnthropicProvider";

export class LLMGenerationEngine implements IGenerationEngine {
    private router: AIRouter;

    constructor() {
        this.router = new AIRouter();
        console.log("[AI ROUTER]\nRegistered:\n- Vertex\n- Gemini\n- Anthropic\n\nPrimary:\nVertex");
        this.router.registerProvider(new VertexProvider());
        this.router.registerProvider(new GeminiProvider());
        this.router.registerProvider(new AnthropicProvider());
    }

    async execute(task: GenerationTask): Promise<Patch[]> {
        console.log('[ENTER] LLMGenerationEngine.execute', { taskName: task.name });
        if (!task.path) {
            throw new Error(`GenerationTask missing path: ${task.name}`);
        }
        
        try {
            const prompt = `
                You are a code generation engine. 
                Generate THE COMPLETE FILE CONTENT for the following task:
                Task Name: ${task.name}
                Task Type: ${task.type}
                Description: ${task.contentDescription}
                
                REQUIREMENTS:
                1. Provide ONLY raw code content.
                2. NO markdown fences or text outside the code.
                3. Include all necessary imports.
                4. Ensure the code is production-ready.
            `;
            
            const response = await this.router.route(prompt);
            
            let content = response.response.content;

            // Handle JSON-only responses (e.g., requirement models or wrapped responses)
            if (content?.trim().startsWith('{')) {
                try {
                    const json = JSON.parse(content);
                    content = json.content || json.code || content;
                } catch (e) {
                    // Not JSON-content, treat as raw content
                }
            }
            
            let code = content || "";
            
            // Sanitize markdown fences
            code = code.replace(/```[a-z]*\n/g, '').replace(/```/g, '').trim();

            if (!code) throw new Error("No code generated");

            console.log(`Task: ${task.name}\nProvider: ${response.telemetry.provider}\nModel: ${response.response.model}\nSuccess: ${response.telemetry.success}`);

            return [{
                path: task.path,
                content: code
            }];
        } catch (err) {
            console.error(`Error generating code for ${task.name}:`, err);
            throw err;
        }
    }
}
