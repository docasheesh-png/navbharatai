
import { GeminiProvider } from './src/server/AI/Router/providers/GeminiProvider';
import { UniversalAIRouter } from './src/server/AI/UniversalAIRouter';

// Set up environment
process.env.GEMINI_API_KEY = "dummy-key"; // We just want to check the flow

async function runTest() {
    console.log("Starting test...");
    
    // Test GeminiProvider directly to see where it fails
    try {
        const provider = new GeminiProvider();
        console.log("Calling GeminiProvider.execute()...");
        await provider.execute("Hello, are you there?");
    } catch (e: any) {
        console.error("GeminiProvider failed with:", e.message);
        console.error("Stack trace:", e.stack);
    }
}

runTest();
