import { IAiProvider } from './provider.interface';
import { VertexAI } from '@google-cloud/vertexai';

export class VertexProvider implements IAiProvider {
  name: string = "vertex-gemini";

  private modelName: string;
  private vertexAI: VertexAI | null = null;
  private model: any = null;

  constructor(modelName: string = "gemini-2.5-flash") {
    this.modelName = modelName;
  }

  private getModel() {
    if (!this.model) {
      const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || 'ais-asia-southeast1-83c8044c9b';
      const location = process.env.GOOGLE_CLOUD_REGION || 'us-central1';

      console.log(
        `[VertexProvider] Initializing with project: ${project}, location: ${location}, model: ${this.modelName}`
      );

      this.vertexAI = new VertexAI({
        project,
        location,
      });

      this.model = this.vertexAI.getGenerativeModel({
        model: this.modelName,
      });
    }

    return this.model;
  }

  async generateContent(prompt: string, contents?: any[]): Promise<string> {
    const model = this.getModel();

    const result = contents 
      ? await model.generateContent({ contents })
      : await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      });

    const response = result.response;
    const text =
      response?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text || !text.trim()) {
      throw new Error('Vertex returned empty response');
    }

    return text;
  }

  isAvailable(): boolean {
    return true;
  }
}