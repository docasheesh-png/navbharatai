import { UniversalAIRouter } from './AI/UniversalAIRouter';
import { AppMakerOrchestrator } from './AppMakerLab/AppMakerOrchestrator';

async function audit() {
    console.log("--- AUDIT START ---");
    const router = new UniversalAIRouter();

    // 6. Test successful AI call
    console.log("\n--- TEST 6: AI CALL ---");
    try {
        const response = await router.routeNavbharat("Generate a React Button component.");
        console.log("Response:", response);
    } catch(e) { console.error("Test 6 failed", e); }

    // 7. Hospital App Test
    console.log("\n--- TEST 7: HOSPITAL APP ---");
    try {
        const tasks = await AppMakerOrchestrator.execute("Create Hospital Management App");
        console.log("Result:", JSON.stringify(tasks, null, 2));
    } catch(e) { console.error("Test 7 failed", e); }

    console.log("\n--- AUDIT END ---");
}

audit().catch(console.error);
