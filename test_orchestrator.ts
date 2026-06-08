
import { UniversalAIRouter } from './src/server/AI/UniversalAIRouter';

async function run() {
    const router = new UniversalAIRouter();
    console.log("--- Triggering router with: Build a calendar app ---");
    // Passing simple history
    const result = await router.route("Build a calendar app", [], 'pro');
    console.log("Router result:", result);
}
run();
