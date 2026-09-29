import { VITE_ENV_DTS_PATH, VITE_ENV_DTS_CONTENT } from '../../../../viteEnvTypes';
import { packageJson, viteConfig, tsconfig, tsconfigBuild, tsconfigNode, indexHtml, mainTsx, appTsx, errorBoundaryTsx, indexCss } from './ViteReactProviderContents';

export interface ITemplateProvider {
  getFiles(features: string[]): Record<string, string>;
}

export class ViteReactProvider implements ITemplateProvider {
  getFiles(features: string[]): Record<string, string> {
    return {
      'package.json': packageJson,
      'vite.config.ts': viteConfig,
      'tsconfig.json': tsconfig,
      // 🔒 THE BUILD SCRIPT POINTS HERE, SO THE SCAFFOLD MUST SHIP IT (user report 2026-08-23,
      // "Make an VPN App"). package.json runs `tsc -p tsconfig.build.json && vite build`, and this
      // file was exported by ViteReactProviderContents but never written — so `npm run build` died
      // instantly on EVERY app this provider makes:
      //
      //     error TS5058: The specified path does not exist: 'tsconfig.build.json'.
      //
      // The builder then "repaired" it with `cp tsconfig.json tsconfig.build.json`, which is not the
      // same config — that produced 96,610 characters of new type errors (missing @types for
      // react-dom/client and react/jsx-runtime among them) on an app whose preview was already
      // rendering correctly. A one-line omission cost that user minutes of avalanche.
      //
      // tests/scaffoldScriptsResolve.test.ts now fails for ANY scaffold whose scripts reference a
      // file it does not ship, so the next one is caught in CI rather than in someone's build.
      'tsconfig.build.json': tsconfigBuild,
      'tsconfig.node.json': tsconfigNode,
      'index.html': indexHtml,
      'src/main.tsx': mainTsx,
      'src/index.css': indexCss,
      'src/App.tsx': appTsx,
      'src/ErrorBoundary.tsx': errorBoundaryTsx,
      // Vite's client types — without them the first file that reads `import.meta.env` (a payment key,
      // an API base URL) fails the typecheck and the model has to discover and write this line itself
      // (autopsy a7aa447c: the first Razorpay file). See viteEnvTypes.ts.
      [VITE_ENV_DTS_PATH]: VITE_ENV_DTS_CONTENT,
    };
  }
}
