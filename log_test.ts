import 'dotenv/config';
import { UniversalAIRouter } from './src/server/AI/UniversalAIRouter';

async function runLogTest() {
  const router = new UniversalAIRouter();
  
  const simplePrompt = "Hi";
  const complexPrompt = "Explain the difference between a synchronous and asynchronous function in TypeScript in detail, providing code examples for each and discussing their use cases in a full-stack application environment with nodejs and express.";

  console.log("--- Simple Prompt Test ---");
  try {
    const response = await (router as any).runOrchestratedInference(simplePrompt, [], false);
    console.log("Simple Success!");
  } catch (error: any) {
    console.log("Simple Failed!", error.message);
  }

  console.log("\n--- Complex Prompt Test ---");
  try {
    const response = await (router as any).runOrchestratedInference(complexPrompt, [], false);
    console.log("Complex Success!");
  } catch (error: any) {
    console.log("Complex Failed!", error.message);
  }
}

runLogTest();
