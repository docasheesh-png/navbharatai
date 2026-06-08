export interface IAiProvider {
  name: string;
  generateContent(prompt: string, contents?: any[]): Promise<string>;
  isAvailable(): boolean;
}
