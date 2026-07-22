// @babel/standalone ships no type declarations. PreviewCompileCheck.ts uses it to dry-compile source
// files through the same transform the in-browser preview uses. This ambient declaration gives it an
// `any` type under the server tsconfig (which includes src/server/runtime but not src/declarations.d.ts).
declare module '@babel/standalone';
