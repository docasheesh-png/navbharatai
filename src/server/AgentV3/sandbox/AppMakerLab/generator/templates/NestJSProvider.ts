import { ITemplateProvider } from './ViteReactProvider';

const PKG = JSON.stringify({
  name: 'my-nestjs-app',
  version: '1.0.0',
  scripts: {
    dev: 'nest start --watch',
    start: 'node dist/main',
    build: 'nest build',
    'start:dev': 'nest start --watch',
    'start:prod': 'node dist/main',
  },
  dependencies: {
    '@nestjs/common': '^10.3.0',
    '@nestjs/core': '^10.3.0',
    '@nestjs/platform-express': '^10.3.0',
    'reflect-metadata': '^0.2.0',
    rxjs: '^7.8.1',
  },
  devDependencies: {
    '@nestjs/cli': '^10.3.0',
    '@nestjs/schematics': '^10.1.0',
    '@nestjs/testing': '^10.3.0',
    '@types/express': '^4.17.21',
    '@types/node': '^20.11.0',
    typescript: '^5.3.3',
    'ts-loader': '^9.5.1',
    'ts-node': '^10.9.2',
    tsconfig: '^7.0.0',
  },
}, null, 2);

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    module: 'commonjs',
    declaration: true,
    removeComments: true,
    emitDecoratorMetadata: true,
    experimentalDecorators: true,
    allowSyntheticDefaultImports: true,
    target: 'ES2021',
    sourceMap: true,
    outDir: './dist',
    baseUrl: './',
    incremental: true,
    skipLibCheck: true,
    strictNullChecks: false,
    noImplicitAny: false,
    strictBindCallApply: false,
    forceConsistentCasingInFileNames: false,
    noFallthroughCasesInSwitch: false,
  },
}, null, 2);

const NEST_CLI = JSON.stringify({
  $schema: 'https://json.schemastore.org/nest-cli',
  collection: '@nestjs/schematics',
  sourceRoot: 'src',
  compilerOptions: { deleteOutDir: true },
}, null, 2);

const MAIN_TS = `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(process.env.PORT || 3000, '0.0.0.0');
  console.log('NestJS app running on port', process.env.PORT || 3000);
}
bootstrap();
`;

const APP_MODULE = `import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
`;

const APP_CONTROLLER = `import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
`;

const APP_SERVICE = `import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello from NestJS!';
  }
}
`;

export class NestJSProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'package.json': PKG,
      'tsconfig.json': TSCONFIG,
      'nest-cli.json': NEST_CLI,
      'src/main.ts': MAIN_TS,
      'src/app.module.ts': APP_MODULE,
      'src/app.controller.ts': APP_CONTROLLER,
      'src/app.service.ts': APP_SERVICE,
    };
  }
}
