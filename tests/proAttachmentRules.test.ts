import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('denies client SDK access to private originals metadata and deletion fences',()=>{
  const rules=readFileSync('firestore.rules','utf8');
  expect(rules).toMatch(/match \/pro_attachment_owners_v1\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
  expect(rules).toMatch(/match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
});
