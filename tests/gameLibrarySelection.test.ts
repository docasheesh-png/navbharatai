import { describe,it,expect } from 'vitest';
import { planGameLibrary, gameLibraryPlanningHandoff } from '../src/server/AgentV3/gameAssets/gameLibrarySelection';
import { readFileSync } from 'node:fs';
describe('requirements and target planning',()=>{
 it('dispatches explicit user roles and known target incompatibility',async()=>{
  const {makeDispatcher,toolCall}=await import('./helpers/dispatcherHarness');const {d}=makeDispatcher();
  const result=await d.dispatch(toolCall('object_spec',{library_plan:'racing game',requirements:[{subject:'car',role:'player'}],webgl2:false}),'architect');
  expect(result.is_error).toBeFalsy();const data=JSON.parse(String(result.content));expect(data.requirements[0].role).toBe('player');expect(data.requirements[0].candidates).toEqual([]);
 });
 it('wires compact conservative planning into the actual generator without a fabricated target',()=>{
  const plan=JSON.parse(gameLibraryPlanningHandoff('racing game with car').split('\n')[1]);
  expect(plan.deviceFit).toBe('unmeasured');expect(plan.requirements.some((r:{subject:string})=>r.subject==='car')).toBe(true);
  expect(readFileSync('src/server/routes/agentv3.ts','utf8')).toContain('gameLibraryPlanningHandoff(prompt)');
 });
 it('preserves explicit role and missing object rather than substituting genre scenery',()=>{
  const r=planGameLibrary({prompt:'racing game',requirements:[{subject:'unicorn',role:'player',animation:'run'}]});
  expect(r.genre).toBe('racing');expect(r.requirements[0].role).toBe('player');expect(r.requirements[0].candidates).toEqual([]);expect(r.requirements[0].missing.length).toBeGreaterThan(0);
  expect(r.suggestions.every(s=>!s.required)).toBe(true);
 });
 it('uses conservative unmeasured default and rejects known incompatible target',()=>{
  const r=planGameLibrary({prompt:'car game'});expect(r.profile).toBe('conservative-mobile');expect(r.deviceFit).toBe('unmeasured');
  const no=planGameLibrary({prompt:'car game',device:{webgl2:false}});expect(no.requirements.every(r=>r.candidates.length===0)).toBe(true);expect(no.deviceFit).toBe('unsupported-3d-runtime');
 });
 it('bounds explicit requests without silently declaring completeness',()=>{
  const r=planGameLibrary({prompt:'game',requirements:Array.from({length:17},()=>({subject:'car'}))});expect(r.requirements.length).toBe(16);expect(r.warnings.join(' ')).toContain('first 16');
 });
 it('keeps acquired candidates quarantined and proves individual rights/hash metadata exists',()=>{
  const rows=JSON.parse(readFileSync('docs/game-engine/asset-candidates/2026-11-13-batch.json','utf8'));
  expect(rows).toHaveLength(11);
  for(const r of rows){expect(r.license).toBe('CC0-1.0');expect(r.sha256).toMatch(/^[a-f0-9]{64}$/);expect(r.sourceSha256).toMatch(/^[a-f0-9]{64}$/);expect(r.bytes).toBeLessThan(5*1024*1024);expect(r.activation).toBe('quarantined-not-in-runtime-catalogue');}
 });
});
