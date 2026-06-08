
import { AppMakerOrchestrator } from './AppMakerLab/AppMakerOrchestrator';

async function run() {
    console.log("Starting test...");
    const result = await AppMakerOrchestrator.execute("Create a Notes App");
    console.log("Result success:", result.success);
    if (!result.success) {
        console.log("Error:", result.error);
    } else {
        console.log("Files:", result.files?.length);
    }
}

run().catch(console.error);
