import 'dotenv/config';
import { GeminiProvider } from './src/server/AI/Router/providers/GeminiProvider';

async function runTest() {
  const provider = new GeminiProvider();
  const prompt = "Explain the difference between a synchronous and asynchronous function in TypeScript in detail.";
  const models = ['gemini-2.5-flash', 'gemini-1.5-flash'];

  for (const model of models) {
    console.log(`--- Testing Model: ${model} ---`);
    try {
      console.log(`Request sent to ${model}...`);
      const response = await (provider as any).execute(prompt, undefined, model);
      console.log(`Status: Success`);
      console.log(`Response body: ${response.content.substring(0, 50)}...`);
    } catch (error: any) {
      console.log(`Status: Failed`);
      console.log(`Error body: ${error.message}`);
      console.log(`Error stack: ${error.stack}`);
    }
  }
}

runTest();
