import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { royaleNewProjectAllowed, type RoyaleProjectEvidence } from '../src/server/AgentV3/royaleProjectEligibility';
const empty: RoyaleProjectEvidence = { inventoryRead:true,hasVerifiedRevision:false,hydratedSourceIsNew:true,intent:'new_build',editing:false,importing:false,importRequested:false,durablePathCount:0,durableSourceCount:0,verifiedStarterSourceCount:0 };
describe('server lifecycle evidence for original royale',()=>{
  it('permits a positively inventoried new project',()=>expect(royaleNewProjectAllowed(empty)).toBe(true));
  it('permits fully verified unchanged starter source',()=>expect(royaleNewProjectAllowed({...empty,durablePathCount:11,verifiedStarterSourceCount:4})).toBe(true));
  it.each([{hasVerifiedRevision:true},{hydratedSourceIsNew:false},{inventoryRead:false},{intent:'edit_existing'},{editing:true},{importing:true},{importRequested:true},{durablePathCount:4,durableSourceCount:3},{durablePathCount:4}])('denies unknown, imported, reopened and custom source %j',changes=>expect(royaleNewProjectAllowed({...empty,...changes})).toBe(false));
});

it('composition root uses verified hydration and revisions, not manual ownership',()=>{
 const source=readFileSync('src/server/routes/agentv3.ts','utf8');
 expect(source).toContain("royaleHydrationVerified = durable.status !== 'unreadable' && baseResult.finding?.code !== 'EDIT_BASE_UNCHECKED'");
 expect(source).toContain('hasVerifiedRevision: editHeadAtStart !== null');
 expect(source).toContain('hydratedSourceIsNew: royaleHydrationVerified');
 expect(source).toContain('inventoryRead: royaleInventoryRead, intent, editing: isEditMode');
});
