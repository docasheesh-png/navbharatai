import { ITemplateProvider } from './ViteReactProvider';
import { ViteReactProvider } from './ViteReactProvider';

export class TemplateRegistry {
  private providers: Record<string, ITemplateProvider> = {
    'vite-react': new ViteReactProvider(),
  };

  getProvider(framework: string): ITemplateProvider {
    const provider = this.providers[framework];
    if (!provider) {
      throw new Error(`Framework ${framework} not supported`);
    }
    return provider;
  }
}
