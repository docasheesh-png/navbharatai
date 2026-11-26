import {describe,it,expect} from 'vitest';
import {athreeModulesFor as pick,enforceAthreeModuleExclusions as enforce} from './athreeModuleSelection';
// 2026-11-25 (admin, problem 5 — "intention, not words"): every module minus exclusions; only "only/sirf/keval" narrows.
describe('bounded exclusion-aware module selection',()=>{
 it.each([
 ['नदी और पेड़',['sea','plants','rivers','sky','roads','vehicles'],[]],
 ['कार और सड़क',['sea','plants','rivers','sky','roads','vehicles'],[]],
 ['बारिश और रात',['sea','plants','rivers','sky','roads','vehicles'],[]],
 ['नदी और पेड़ नहीं',['sea','sky','roads','vehicles'],['plants','rivers']],
 ['नदी चाहिए, पेड़ नहीं',['sea','rivers','sky','roads','vehicles'],['plants']],
 ['nahi chahiye ped; nadi chahiye',['sea','rivers','sky','roads','vehicles'],['plants']],
 ['नहीं चाहिए पेड़; नदी चाहिए',['sea','rivers','sky','roads','vehicles'],['plants']],
 ['never add trees, river',['sea','rivers','sky','roads','vehicles'],['plants']],
 ['no optional modules',[],['sea','plants','rivers','sky','roads','vehicles']],
 ['trees are not needed; add river',['sea','rivers','sky','roads','vehicles'],['plants']],
 ['trees not needed; add river',['sea','rivers','sky','roads','vehicles'],['plants']],
 ['trees and cars nahi, nadi chahiye',['sea','rivers','sky','roads'],['plants','vehicles']],
 ['not only trees but rivers',['plants','rivers'],[]],
 ["don't include trees; add river",['sea','rivers','sky','roads','vehicles'],['plants']],
 ['river with no trees',['sea','rivers','sky','roads','vehicles'],['plants']],
 ['no trees and no cars',['sea','rivers','sky','roads'],['plants','vehicles']],
 ['ped aur gaadi nahi',['sea','rivers','sky','roads'],['plants','vehicles']],
 ['पेड़ और कार नहीं',['sea','rivers','sky','roads'],['plants','vehicles']],
 ['nadi chahiye ped nahi',['sea','rivers','sky','roads','vehicles'],['plants']],
 ['पेड़ नहीं नदी चाहिए',['sea','rivers','sky','roads','vehicles'],['plants']],
 ['नदी चाहिए पेड़ नहीं',['sea','rivers','sky','roads','vehicles'],['plants']],
 ['no trees and cars with rivers',['sea','rivers','sky','roads'],['plants','vehicles']],
 ['river without trees, sky',['sea','rivers','sky','roads','vehicles'],['plants']],
 ['nadi aur ped',['sea','plants','rivers','sky','roads','vehicles'],[]],
 ['no trees but add sky',['sea','rivers','sky','roads','vehicles'],['plants']],
 ['trees, no trees',['sea','rivers','sky','roads','vehicles'],['plants']],
 ])('%s',(text,modules,excluded)=>{expect(pick(text).modules).toEqual(modules);expect(pick(text).excluded).toEqual(excluded);});
 it('keeps fallback only without any mentioned feature',()=>{expect(pick('build a game').modules).toHaveLength(6);expect(pick('no trees').modules).toEqual(['sea','rivers','sky','roads','vehicles']); /* 2026-11-25: a named feature no longer bans the rest */});
 it('subtracts explicit exclusions from everything',()=>{const p=pick('everything except roads');expect(p.modules).toHaveLength(5);expect(p.excluded).toEqual(['roads']);expect(p.modules).not.toContain('roads');});
 it('does not allow explicit include to override exclusions',()=>{const p=pick('everything except roads');expect(()=>enforce(['roads'],p)).toThrow(/excluded/);expect(enforce(['rivers','sky'],p)).toEqual(['rivers','sky']);expect(()=>enforce([' ROADS '],p)).toThrow(/excluded/);expect(enforce(['volcano'],p)).toEqual(['volcano']);});
 it('retains positive match explanation',()=>expect(pick('nadi').reason).toContain('rivers (nadi)'));
});
