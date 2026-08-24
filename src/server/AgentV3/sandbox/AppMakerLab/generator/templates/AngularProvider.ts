import { DESIGN_KIT_CSS } from './designKit';
import { ITemplateProvider } from './ViteReactProvider';

const PKG = JSON.stringify({
  name: 'my-angular-app',
  version: '1.0.0',
  private: true,
  scripts: {
    ng: 'ng',
    start: 'ng serve --host 0.0.0.0 --port 4200',
    dev: 'ng serve --host 0.0.0.0 --port 4200',
    build: 'ng build',
  },
  dependencies: {
    '@angular/animations': '^18.0.0',
    '@angular/common': '^18.0.0',
    '@angular/compiler': '^18.0.0',
    '@angular/core': '^18.0.0',
    '@angular/forms': '^18.0.0',
    '@angular/platform-browser': '^18.0.0',
    '@angular/platform-browser-dynamic': '^18.0.0',
    '@angular/router': '^18.0.0',
    rxjs: '^7.8.0',
    tslib: '^2.6.0',
    'zone.js': '~0.14.0',
  },
  devDependencies: {
    '@angular-devkit/build-angular': '^18.0.0',
    '@angular/cli': '^18.0.0',
    '@angular/compiler-cli': '^18.0.0',
    typescript: '~5.4.0',
  },
}, null, 2);

const TSCONFIG = JSON.stringify({
  compileOnSave: false,
  compilerOptions: {
    baseUrl: './',
    outDir: './dist/out-tsc',
    forceConsistentCasingInFileNames: true,
    strict: true,
    noImplicitOverride: true,
    noPropertyAccessFromIndexSignature: true,
    noImplicitReturns: true,
    noFallthroughCasesInSwitch: true,
    esModuleInterop: true,
    sourceMap: true,
    declaration: false,
    experimentalDecorators: true,
    moduleResolution: 'bundler',
    importHelpers: true,
    target: 'ES2022',
    module: 'ES2022',
    useDefineForClassFields: false,
    lib: ['ES2022', 'dom'],
  },
  angularCompilerOptions: {
    enableI18nLegacyMessageIdFormat: false,
    strictInjectionParameters: true,
    strictInputAccessModifiers: true,
    strictTemplates: true,
  },
}, null, 2);

const ANGULAR_JSON = JSON.stringify({
  $schema: './node_modules/@angular/cli/lib/config/schema.json',
  version: 1,
  newProjectRoot: 'projects',
  projects: {
    app: {
      projectType: 'application',
      root: '',
      sourceRoot: 'src',
      architect: {
        build: {
          builder: '@angular-devkit/build-angular:application',
          options: {
            outputPath: 'dist/app',
            index: 'src/index.html',
            browser: 'src/main.ts',
            polyfills: ['zone.js'],
            tsConfig: 'tsconfig.json',
            assets: ['src/favicon.ico', 'src/assets'],
            styles: ['src/styles.css'],
            scripts: [],
          },
        },
        serve: {
          builder: '@angular-devkit/build-angular:dev-server',
          configurations: { production: { buildTarget: 'app:build:production' }, development: { buildTarget: 'app:build:development' } },
          defaultConfiguration: 'development',
        },
      },
    },
  },
}, null, 2);

const MAIN_TS = `import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).catch(err => console.error(err));
`;

const APP_CONFIG = `import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';

export const appConfig: ApplicationConfig = {
  providers: [provideRouter([])],
};
`;

const APP_COMPONENT = `import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  standalone: true,
  template: \`
    <div style="padding: 2rem; font-family: sans-serif;">
      <h1>Hello from Angular!</h1>
      <p>Count: {{ count }}</p>
      <button (click)="increment()">Increment</button>
    </div>
  \`,
})
export class AppComponent {
  count = 0;
  // 🔒 A METHOD, NOT \`count++\` IN THE TEMPLATE (verified by a real build, 2026-08-24). Angular's
  // template language is NOT JavaScript: it has no increment operator, so \`(click)="count++"\` does not
  // merely lint badly — it fails to COMPILE, and every Angular app this scaffold made was dead on
  // arrival:
  //
  //     NG5002: Parser Error: Unexpected end of expression: count++ ...
  //     NG50:   The value 'undefined' cannot be used here.
  //
  // The same rule rules out \`--\`, \`+=\` and \`new\` in a template. Calling a component method is the
  // idiomatic Angular answer and is what \`ng new\` itself generates.
  increment(): void { this.count++; }
}
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My Angular App</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/x-icon" href="favicon.ico">
</head>
<body>
  <app-root></app-root>
</body>
</html>
`;

const STYLES_CSS = `* { box-sizing: border-box; }
body { margin: 0; }
`;

export class AngularProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'tsconfig.json': TSCONFIG,
      'angular.json': ANGULAR_JSON,
      'src/main.ts': MAIN_TS,
      'src/app/app.config.ts': APP_CONFIG,
      'src/app/app.component.ts': APP_COMPONENT,
      'src/index.html': INDEX_HTML,
      'src/styles.css': DESIGN_KIT_CSS + '\n\n' + STYLES_CSS,
    };
  }
}
