const { CodeGenerator } = require('./BuildEngine/CodeGenerator.js');

const generator = new CodeGenerator();

const plan = {
  projectType: 'calculator',
  frontendRequired: true,
  backendRequired: false,
  databaseRequired: false,
  directories: ['src/components'],
  files: [
    { path: 'src/components/Calculator.tsx', purpose: 'Calculator UI' }
  ],
  features: ['Core UI']
};

const files = generator.generate(plan);
console.log(JSON.stringify(files, null, 2));

if (files.length === 1 && files[0].path === 'src/components/Calculator.tsx') {
    console.log('Verification Passed!');
} else {
    throw new Error('Verification Failed!');
}
