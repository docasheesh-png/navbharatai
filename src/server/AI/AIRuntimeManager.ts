
import { VertexProvider } from './Models/VertexProvider';

export class AIRuntimeManager {
  static getProvider(tier: 'navbharat') {
    switch (tier) {
      case 'navbharat':
        // Use Vertex AI
        return new VertexProvider("gemini-2.5-flash");
      default:
        throw new Error("Unknown AI tier");
    }
  }
}
