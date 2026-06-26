import { packageJson, viteConfig, tsconfig, tsconfigNode, indexHtml, mainTsx, appTsx } from './ViteReactProviderContents';

export interface ITemplateProvider {
  getFiles(features: string[]): Record<string, string>;
}

export class ViteReactProvider implements ITemplateProvider {
  getFiles(features: string[]): Record<string, string> {
    return {
      'package.json': packageJson,
      'vite.config.ts': viteConfig,
      'tsconfig.json': tsconfig,
      'tsconfig.node.json': tsconfigNode,
      'index.html': indexHtml,
      'src/main.tsx': mainTsx,
      'src/App.tsx': appTsx,
    };
  }
}
