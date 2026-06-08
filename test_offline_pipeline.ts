
import { RequirementIntelligenceEngine } from './src/server/AppMakerLab/intelligence/RequirementIntelligenceEngine.js';
import { BlueprintBuilder } from './src/server/AppMakerLab/intelligence/BlueprintBuilder.js';
import { FilePlanningEngine } from './src/server/AppMakerLab/intelligence/FilePlanningEngine.js';

function runOffline() {
    console.log("--- STARTING OFFLINE PIPELINE VERIFICATION ---");
    
    // 1. RequirementIntelligenceEngine (Mocked)
    const model = RequirementIntelligenceEngine.getExampleModel("WHATSAPP");
    console.log("1. StructuredRequirementModel:", JSON.stringify(model, null, 2));

    // 2. BlueprintBuilder
    const blueprint = BlueprintBuilder.build(model);
    console.log("2. ProjectBlueprint:", JSON.stringify(blueprint, null, 2));

    // 3. FilePlanningEngine
    const plan = FilePlanningEngine.plan(blueprint);
    console.log("3. FileGenerationPlan:", JSON.stringify(plan, null, 2));

    console.log("4. Total files planned:", plan.files.length);
    console.log("5. Number of files planned:", plan.files.length);
    console.log("5. List of planned files:", JSON.stringify(plan.files.map(f => f.path), null, 2));
}
runOffline();
