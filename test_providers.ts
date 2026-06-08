
import { VertexProvider } from './src/server/AI/Router/providers/VertexProvider';
import { GeminiProvider } from './src/server/AI/Router/providers/GeminiProvider';

async function test() {
    console.log("--- Testing Providers ---");
    
    // Test Gemini
    console.log("Testing GeminiProvider...");
    try {
        const gemini = new GeminiProvider();
        const health = await gemini.healthCheck();
        console.log("Gemini Health:", health);
        if (health) {
            const resp = await gemini.execute("Hello, are you working?", undefined, "gemini-2.5-flash");
            console.log("Gemini Response:", resp.content);
        }
    } catch (e) {
        console.error("Gemini Test Failed:", e);
    }

    // Test Vertex
    console.log("Testing VertexProvider...");
    try {
        const vertex = new VertexProvider();
        const health = await vertex.healthCheck();
        console.log("Vertex Health:", health);
        if (health) {
             const resp = await vertex.execute("Hello, are you working?");
             console.log("Vertex Response:", resp.content);
        }
    } catch (e) {
        console.error("Vertex Test Failed:", e);
    }
}

test();
