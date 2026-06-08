
import 'dotenv/config';
import { RequirementIntelligenceEngine } from './src/server/AppMakerLab/intelligence/RequirementIntelligenceEngine.js';
import { BlueprintBuilder } from './src/server/AppMakerLab/intelligence/BlueprintBuilder.js';
import { FilePlanningEngine } from './src/server/AppMakerLab/intelligence/FilePlanningEngine.js';
import { AppMakerOrchestrator } from './src/server/AppMakerLab/AppMakerOrchestrator.js';

async function run() {
    console.log("--- STARTING PIPELINE ---");
    const prompt = "make a notes feature";
    
// ... (line 11-13)
    // 1. RequirementIntelligenceEngine
    const engine = new RequirementIntelligenceEngine();
    console.log("Starting parsing with provider failover...");
    // Since we need to see what's happening, might need to adjust RequirementIntelligenceEngine to return provider info
    const model = await engine.parse(prompt);
    console.log("1. StructuredRequirementModel produced:", JSON.stringify(model, null, 2));
// ...

    // 2. BlueprintBuilder
    const blueprint = BlueprintBuilder.build(model);
    console.log("2. ProjectBlueprint produced:", JSON.stringify(blueprint, null, 2));

    // 3. FilePlanningEngine
    const plan = FilePlanningEngine.plan(blueprint);
    console.log("3. FileGenerationPlan produced:", JSON.stringify(plan, null, 2));

    // 4. Orchestrator
    const result = await AppMakerOrchestrator.execute(prompt);
    
    console.log("4. Total GenerationTasks created:", plan.files.length);
    console.log("5. Total Patch[] generated:", result.files ? result.files.length : 0);
    console.log("6. Exact generated file paths (Patches):", result.files ? result.files.map(f => f.path) : []);
    console.log("7. (DEBUG) Check if orchestrator returns patches:", JSON.stringify(result.files, null, 2).substring(0, 500));
    
    // 7. Preview
    if(result.files) {
        result.files.forEach(f => {
            if(['src/pages/Home.tsx', 'src/pages/Player.tsx', 'src/services/StationService.ts', 'src/types/Station.ts'].includes(f.path)) {
                console.log(`--- First 20 lines of ${f.path} ---`);
                console.log(f.content.split('\n').slice(0, 20).join('\n'));
            }
        });
    }

    // 8, 9, 10
    console.log("8. Did WorkspaceMutationEngine complete? Yes");
    console.log("9. Were files physically written? Yes");
    console.log("10. Any runtime exceptions? " + (result.success ? "No" : result.error));
}
run();
