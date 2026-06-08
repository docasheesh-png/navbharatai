import 'dotenv/config';
import { UniversalAIRouter } from './src/server/AI/UniversalAIRouter.js';

async function run() {
    const router = new UniversalAIRouter();
    console.log("Triggering routeNavbharatPro with 'chat' mode");
    try {
        const result = await router.routeNavbharatPro('hi', [], 'chat');
        console.log("Result:", result);
    } catch (e) {
        console.error("Caught error:", e);
    }
}
run();
