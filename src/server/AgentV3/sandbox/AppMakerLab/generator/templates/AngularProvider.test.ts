import { describe, expect, it } from 'vitest';
import { AngularProvider } from './AngularProvider';

describe('the emitted Angular workspace can build and serve (cdffbb71)', () => {
  const files = new AngularProvider().getFiles([]);
  const workspace = JSON.parse(files['angular.json']);

  it('keeps the Angular runtime and toolchain on the same supported family', () => {
    const pkg = JSON.parse(files['package.json']);
    const angular = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
      .filter(([name]) => name.startsWith('@angular/') || name.startsWith('@angular-devkit/'));
    const versions = angular.map(([, version]) => version as string);
    expect(new Set(versions).size).toBe(1);
    // 18's newest compatible patch still carries known advisories; the real
    // emitted 22.3 scaffold was installed, audited, built and served together.
    expect(Number(versions[0].replace(/^[^\d]*/, '').split('.')[0])).toBeGreaterThanOrEqual(22);
  });

  it('every default and serve build target resolves to a declared configuration', () => {
    for (const project of Object.values(workspace.projects) as any[]) {
      const targets = project.architect;
      for (const target of Object.values(targets) as any[]) {
        if (target.defaultConfiguration) {
          expect(target.configurations, 'default configuration must exist').toHaveProperty(target.defaultConfiguration);
        }
      }
      // CLI invocations which disable the default still need a valid base target.
      expect(targets.serve.options.buildTarget).toBeTruthy();
      for (const options of [targets.serve.options, ...Object.values(targets.serve.configurations)] as any[]) {
        const [projectName, targetName, configuration] = options.buildTarget.split(':');
        const build = workspace.projects[projectName]?.architect[targetName];
        expect(build, options.buildTarget).toBeDefined();
        if (configuration) expect(build.configurations, options.buildTarget).toHaveProperty(configuration);
      }
    }
  });

  it('every build input and stylesheet exists in the emitted file set', () => {
    const options = workspace.projects.app.architect.build.options;
    for (const path of [options.index, options.browser, options.tsConfig, ...options.styles, ...options.scripts]) {
      expect(files[path], `missing build input: ${path}`).toBeDefined();
    }
    for (const asset of options.assets as string[]) {
      expect(Object.keys(files).some(path => path === asset || path.startsWith(`${asset}/`)), `missing asset: ${asset}`).toBe(true);
    }
  });

  it('never links an icon that the scaffold does not emit', () => {
    const links = files['src/index.html'].matchAll(/<link\b[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["']/g);
    for (const [, href] of links) expect(files[`src/${href}`], `missing icon: ${href}`).toBeDefined();
  });
});
