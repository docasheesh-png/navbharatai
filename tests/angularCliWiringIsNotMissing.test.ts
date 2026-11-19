import { describe, expect, it } from 'vitest';
import { AngularProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/AngularProvider';
import { angularWorkspaceFacts, angularRequiredDependencies, isAngularMountShell } from '../src/server/AgentV3/angularWorkspaceAnalysis';
import { injectGlobalStylesheetImport, findOrphanStylesheets } from '../src/server/AgentV3/ProjectIntegrityChecks';
import { analyzeDesignCoverage } from '../src/server/AgentV3/DesignCoverage';
import { findUnusedDependencies } from '../src/server/AgentV3/ImportExportAnalysis';
import { analyzeDependencies } from '../src/server/AgentV3/DependencyAnalysis';

const workspace = (options: Record<string, unknown>, configurations = {}) => JSON.stringify({
  projects: { app: { architect: { build: { builder: '@angular-devkit/build-angular:application', options, configurations } } } },
});
const shell = '<!doctype html><html><head><meta charset="utf-8"><base href="/"><title>Colour Play</title></head><body><app-root></app-root></body></html>';
const app = () => ({
  'angular.json': workspace({ index: 'src/index.html', browser: 'src/main.ts', styles: ['src/styles.css'], polyfills: ['zone.js'] }),
  'src/main.ts': "import { bootstrapApplication } from '@angular/platform-browser'; import { AppComponent } from './app/app.component'; bootstrapApplication(AppComponent);",
  'src/app/app.component.ts': "import { Component } from '@angular/core'; @Component({selector:'app-root',template:'<h1>Colour Play</h1>'}) export class AppComponent {}",
  'src/index.html': shell,
  'src/styles.css': 'body { color: red; }',
});

describe('cdffbb71: Angular CLI wiring is an actual dependency, not an absent import', () => {
  it('does not repair the current shipped Angular starter into duplicate stylesheet imports or flag its mount as a page', () => {
    const files = new AngularProvider().getFiles([]);
    expect(findOrphanStylesheets(files)).toEqual([]);
    expect(injectGlobalStylesheetImport(files).injected).toEqual([]);
    expect(analyzeDesignCoverage(files)).toMatchObject({ pagesExamined: 0, findings: [], ok: true });
  });

  it('recognizes base/configuration styles, object inputs and deliberate inject:false bundles without basename collisions', () => {
    const files = { ...app(),
      'angular.json': workspace({ styles: ['src/styles.css', { input: 'src/theme.css', inject: false }] }, { dark: { styles: [{ input: 'src/dark.css' }] } }),
      'src/theme.css': 'body{}', 'src/dark.css': 'body{}', 'other/styles.css': 'body{}',
    };
    expect([...angularWorkspaceFacts(files).styles].sort()).toEqual(['src/dark.css', 'src/styles.css', 'src/theme.css']);
    expect(findOrphanStylesheets(files)).toEqual([{ stylesheet: 'other/styles.css' }]);
  });

  it('resolves nested workspace paths independently and reads JSON comments', () => {
    const files = { 'apps/shop/angular.json': '// CLI workspace\n' + workspace({ styles: ['src/styles.css'] }),
      'apps/shop/src/styles.css': 'body{}', 'src/styles.css': 'body{}' };
    expect(findOrphanStylesheets(files)).toEqual([{ stylesheet: 'src/styles.css' }]);
  });

  it('keeps component styles scoped when styleUrl/styleUrls wire them, while unrelated metadata remains unused', () => {
    const files = { ...app(),
      'src/app/card.ts': "import { Component as C } from '@angular/core'; @C({selector:'my-card',styleUrl:'./card.css',styleUrls:['./theme.css']}) export class Card {}",
      'src/app/card.css': '.card{}', 'src/app/theme.css': '.theme{}',
      'src/app/unused.ts': "const example={styleUrl:'./unused.css'};", 'src/app/unused.css': '.unused{}',
    };
    expect(findOrphanStylesheets(files)).toEqual([{ stylesheet: 'src/app/unused.css' }]);
  });

  it('does not accept arbitrary JSON strings, malformed config or non-Angular builders as stylesheet wiring', () => {
    for (const config of ['{', JSON.stringify({ note: 'src/styles.css' }), workspace({ styles: ['src/styles.css'] }).replace('@angular-devkit/build-angular:application', 'custom:application')]) {
      expect(findOrphanStylesheets({ ...app(), 'angular.json': config })).toEqual([{ stylesheet: 'src/styles.css' }]);
    }
  });

  it('requires the matching configured entry and actual Angular bootstrap selector before exempting the HTML shell', () => {
    const files = app();
    expect(isAngularMountShell('src/index.html', shell, files)).toBe(true);
    for (const altered of [
      { ...files, 'src/main.ts': '' },
      { ...files, 'src/main.ts': files['src/main.ts'].replace('@angular/platform-browser', 'unrelated') },
      { ...files, 'src/app/app.component.ts': files['src/app/app.component.ts'].replace('app-root', 'other-root') },
      { ...files, 'angular.json': workspace({ index: 'another.html', browser: 'src/main.ts' }) },
    ]) expect(analyzeDesignCoverage(altered).findings).toContainEqual(expect.objectContaining({ file: 'src/index.html', defects: ['NO_STYLESHEET', 'NO_HEADING'] }));
    expect(isAngularMountShell('src/index.html', shell.replace('<app-root></app-root>', '<!-- <app-root></app-root> -->'), files)).toBe(false);
  });

  it('recognizes aliased standalone bootstraps and NgModule bootstrap declarations', () => {
    const files = app();
    expect(isAngularMountShell('src/index.html', shell, { ...files,
      'src/main.ts': files['src/main.ts'].replace('{ bootstrapApplication }', '{ bootstrapApplication as boot }').replace('bootstrapApplication(AppComponent)', 'boot(AppComponent)'),
    })).toBe(true);
    expect(isAngularMountShell('src/index.html', shell, { ...files,
      'src/main.ts': "import { platformBrowserDynamic } from '@angular/platform-browser-dynamic'; import { AppModule } from './app/app.module'; platformBrowserDynamic().bootstrapModule(AppModule);",
      'src/app/app.module.ts': "import { NgModule } from '@angular/core'; import { AppComponent } from './app.component'; @NgModule({ bootstrap: [AppComponent] }) export class AppModule {}",
    })).toBe(true);
  });

  it('shares actual Angular peer/config uses across both dependency analyzers and preserves optional-unused findings', () => {
    const pkg = JSON.stringify({ dependencies: { '@angular/core': '^18.0.0', '@angular/common': '^18.0.0', '@angular/platform-browser': '^18.0.0', '@angular/compiler': '^18.0.0', rxjs: '^7.0.0', 'zone.js': '^0.14.0', '@angular/animations': '^18.0.0', '@angular/router': '^18.0.0', '@angular/platform-browser-dynamic': '^18.0.0', lodash: '^4.0.0' }, devDependencies: { '@angular/compiler-cli': '^18.0.0' } });
    const files = { ...app(), 'package.json': pkg };
    const expected = ['@angular/animations', '@angular/platform-browser-dynamic', '@angular/router', 'lodash'];
    expect(findUnusedDependencies(files).map((d) => d.name).sort()).toEqual(expected);
    expect(analyzeDependencies(['@angular/core', '@angular/platform-browser'], pkg, files).filter((d) => d.kind === 'unused').map((d) => d.package).sort()).toEqual(expected);
    expect(angularRequiredDependencies(pkg).has('zone.js')).toBe(false); // optional, used only with evidence
    const zoneless = { ...files, 'angular.json': workspace({ index: 'src/index.html', browser: 'src/main.ts' }) };
    expect(findUnusedDependencies(zoneless).map((d) => d.name)).toContain('zone.js');
  });

  it('does not convert local polyfill/script paths into packages; package subpaths count as their package', () => {
    const facts = angularWorkspaceFacts({ ...app(), 'angular.json': workspace({ polyfills: ['zone.js/testing', './src/polyfills.ts'], scripts: [{ input: 'bootstrap/dist/js/bootstrap.js' }], styles: ['node_modules/@scope/theme/styles.css'] }), 'src/polyfills.ts': '' });
    expect([...facts.packages].sort()).toEqual(['@scope/theme', 'bootstrap', 'zone.js']);
    expect(angularRequiredDependencies('{')).toEqual(new Set());
  });
});
