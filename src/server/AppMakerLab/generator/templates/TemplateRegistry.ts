import { ITemplateProvider } from './ViteReactProvider';
import { ViteReactProvider } from './ViteReactProvider';
import { NextjsProvider } from './NextjsProvider';
import { VueProvider } from './VueProvider';
import { SvelteProvider } from './SvelteProvider';
import { NodeExpressProvider } from './NodeExpressProvider';
import { PythonFastapiProvider } from './PythonFastapiProvider';
import { StaticProvider } from './StaticProvider';

export class TemplateRegistry {
  private providers: Record<string, ITemplateProvider> = {
    'vite-react': new ViteReactProvider(),
    'nextjs': new NextjsProvider(),
    'vue': new VueProvider(),
    'svelte': new SvelteProvider(),
    'node-express': new NodeExpressProvider(),
    'python-fastapi': new PythonFastapiProvider(),
    'static': new StaticProvider(),
  };

  getProvider(framework: string): ITemplateProvider {
    const provider = this.providers[framework];
    if (!provider) {
      throw new Error(`Framework ${framework} not supported`);
    }
    return provider;
  }
}
