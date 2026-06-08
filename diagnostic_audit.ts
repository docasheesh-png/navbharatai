import 'dotenv/config';
import { UniversalAIRouter } from './src/server/AI/UniversalAIRouter';

async function runDiagnostic() {
  const router = new UniversalAIRouter();
  
  const prompts = [
    { name: "Simple Prompt", text: "hi" },
    { name: "Complex Prompt", text: "Write a 500 word article on childhood pneumonia." }
  ];

  for (const prompt of prompts) {
    console.log(`\n--- ${prompt.name} Audit ---`);
    console.log(`Prompt: "${prompt.text}"`);
    console.log(`Prompt length (chars): ${prompt.text.length}`);
    
    const startTime = Date.now();
    try {
      const response = await (router as any).runOrchestratedInference(prompt.text, [], false);
      const endTime = Date.now();
      console.log(`Success! Total Time: ${endTime - startTime}ms`);
    } catch (error: any) {
      const endTime = Date.now();
      console.log(`Failed! Total Time: ${endTime - startTime}ms`);
      console.log(`Error Message: ${error.message}`);
      console.log(`Error Stack: ${error.stack}`);
    }
  }
}

runDiagnostic();
