import { IAiProvider } from './provider.interface';
import { GoogleGenAI } from "@google/genai";

export class GeminiProvider implements IAiProvider {
  name: string;
  private modelName: string;
  private genAI: GoogleGenAI | null = null;

  constructor(modelName: string) {
    this.name = `Gemini-${modelName}`;
    this.modelName = modelName;
  }

  private getGenAI(): GoogleGenAI {
    if (!this.genAI) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("Missing Gemini API Key");
      this.genAI = new GoogleGenAI({ apiKey });
    }
    return this.genAI;
  }

  async generateContent(prompt: string, contents?: any[]): Promise<string> {
    console.log(`[GeminiProvider] Generating with model: ${this.modelName}`);
    try {
      const genAI = this.getGenAI();
      const response = await genAI.models.generateContent({
        model: this.modelName,
        contents: contents || prompt,
      });
      const text = response.text;

      if (!text) throw new Error("No response text");
      return text;
    } catch (error: any) {
      console.error(`[GeminiProvider] Gemini generation error: ${error.message}`);
      throw error;
    }
  }

  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }
}
