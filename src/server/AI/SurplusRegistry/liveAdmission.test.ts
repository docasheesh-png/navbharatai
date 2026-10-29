import { describe,it,expect } from 'vitest';
import { synthesizeLiveReviews } from './liveAdmission';
import { syntheticTestReviews } from '../../../../tests/fixtures/surplusProductionEvidence';
import type { Snapshot } from './types';
const now=1800000000000;
const env={AGENTV3_SURPLUS_BUILDER:'true',SURPLUS_API_KEY:'synthetic-test-key'};
const snapshot:Snapshot={version:'test',startedAt:now,observedAt:now,expiresAt:now+10000,models:['test-model'],offers:[]};
const evidence=()=>syntheticTestReviews(env,snapshot,now);
describe('production observations never manufacture reviews',()=>{
 it('declines a configured key and observed model without evidence',()=>{
  expect(()=>synthesizeLiveReviews(env,snapshot,now)).toThrow('evidence unavailable or unverified');
 });
 it('preserves original evidence dates without renewing or mutating the record',()=>{
  const record=evidence(), original=structuredClone(record);
  const result=synthesizeLiveReviews(env,snapshot,now+1,record);
  expect(result.capabilities[0].expiresAt).toBe(record.capabilities[0].expiresAt);
  expect(record).toEqual(original);expect(result).not.toBe(record);
 });
 it.each(['quality','tariff','capability','account','pilot','mapping','placeholder','example','marketplace','fallback','unapproved'] as const)('rejects missing/expired/fabricated %s evidence',kind=>{
  const record=evidence();
  if(kind==='quality')record.reviews.quality=[];
  if(kind==='tariff')record.tariffs=[];
  if(kind==='capability')record.capabilities[0].expiresAt=now;
  if(kind==='account')record.account.liveCredentialCheckExpiresAt=now;
  if(kind==='pilot')record.pilot.expiresAt=now;
  if(kind==='mapping')record.usageMappings=[];
  if(kind==='placeholder')record.tariffs[0].artifactSha256='c'.repeat(64);
  if(kind==='marketplace')Object.assign(record.account,{marketplaceOnly:false});
  if(kind==='fallback')Object.assign(record.account,{noFallbackKeys:false});
  if(kind==='unapproved')record.reviews.quality[0].approved=false;
  if(kind==='example')record.tariffs[0].sourceUrl='https://official-provider.example/pricing';
  expect(()=>synthesizeLiveReviews(env,snapshot,now,record)).toThrow('evidence unavailable or unverified');
 });
});
