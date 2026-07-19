import { ITemplateProvider } from './ViteReactProvider';
import { ViteReactProvider } from './ViteReactProvider';
import { NextjsProvider } from './NextjsProvider';
import { VueProvider } from './VueProvider';
import { SvelteProvider } from './SvelteProvider';
import { SvelteKitProvider } from './SvelteKitProvider';
import { SolidProvider } from './SolidProvider';
import { PreactProvider } from './PreactProvider';
import { LitProvider } from './LitProvider';
import { AlpineProvider } from './AlpineProvider';
import { NodeExpressProvider } from './NodeExpressProvider';
import { HonoProvider } from './HonoProvider';
import { NestJSProvider } from './NestJSProvider';
import { FastifyProvider } from './FastifyProvider';
import { SpringBootProvider } from './SpringBootProvider';
import { GoProvider } from './GoProvider';
import { PythonFastapiProvider } from './PythonFastapiProvider';
import { DjangoProvider } from './DjangoProvider';
import { FlaskProvider } from './FlaskProvider';
import { AstroProvider } from './AstroProvider';
import { NuxtProvider } from './NuxtProvider';
import { RemixProvider } from './RemixProvider';
import { AngularProvider } from './AngularProvider';
import { VanillaProvider } from './VanillaProvider';
import { StaticProvider } from './StaticProvider';

export class TemplateRegistry {
  private providers: Record<string, ITemplateProvider> = {
    // React ecosystem
    'vite-react': new ViteReactProvider(),
    'nextjs': new NextjsProvider(),
    'remix': new RemixProvider(),
    // Vue ecosystem
    'vue': new VueProvider(),
    'nuxt': new NuxtProvider(),
    // Svelte ecosystem
    'svelte': new SvelteProvider(),
    'sveltekit': new SvelteKitProvider(),
    // Node.js backends
    'node-express': new NodeExpressProvider(),
    'hono': new HonoProvider(),
    'nestjs': new NestJSProvider(),
    'fastify': new FastifyProvider(),
    // Python backends
    'python-fastapi': new PythonFastapiProvider(),
    'django': new DjangoProvider(),
    'flask': new FlaskProvider(),
    // JVM / Go backends — run on the fullstack E2B template (JDK 17 + Maven, Go 1.23)
    'spring-boot': new SpringBootProvider(),
    'go': new GoProvider(),
    // Other frontend
    'solid': new SolidProvider(),
    'preact': new PreactProvider(),
    'lit': new LitProvider(),
    'alpine': new AlpineProvider(),
    'astro': new AstroProvider(),
    'angular': new AngularProvider(),
    'vanilla': new VanillaProvider(),
    // Static
    'static': new StaticProvider(),
  };

  getProvider(framework: string): ITemplateProvider {
    const provider = this.providers[framework];
    if (!provider) {
      throw new Error(`Framework "${framework}" not supported. Available: ${Object.keys(this.providers).join(', ')}`);
    }
    return provider;
  }

  listFrameworks(): string[] {
    return Object.keys(this.providers);
  }
}
