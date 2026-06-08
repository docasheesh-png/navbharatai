import { AppMakerOrchestrator } from './AppMakerOrchestrator';

async function runTest() {
    console.log("Starting AppMakerLab test...");
    try {
        const result = await AppMakerOrchestrator.execute("Build a calculator app");
        
        console.log("Success:", result.success);
        if (result.success) {
            console.log("Generated file count:", result.files.length);
            for (const file of result.files) {
                console.log("\n--- File:", (file as any).path, "---");
                console.log((file as any).content);
            }
        } else {
            console.log("Error:", result.error);
        }
    } catch (e) {
        console.error("Test execution failed:", e);
    }
}

runTest();
