import { GeminiProvider } from './src/server/AI/Router/providers/GeminiProvider';

async function check() {
    console.log("Checking GEMINI_API_KEY...");
    const key = process.env.GEMINI_API_KEY;
    
    if (!key) {
        console.log("Key Loaded: NO");
    } else {
        console.log("Key Loaded: YES");
        console.log("Key Length:", key.length);
        console.log("Key Prefix:", key.substring(0, 5) + "...");
    }

    console.log("Attempting test prompt 'hi'...");
    try {
        const provider = new GeminiProvider();
        const response = await provider.execute("hi");
        console.log("Test Result Status: Success");
        console.log("Response Body:", response);
    } catch (e: any) {
        console.log("Test Result Status: Failed");
        console.error("Error details:", JSON.stringify(e, null, 2));
    }
}

check();
