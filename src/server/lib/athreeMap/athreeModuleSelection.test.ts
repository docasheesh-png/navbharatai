import {describe,it,expect} from 'vitest';
import {athreeModulesFor as pick,enforceAthreeModuleExclusions as enforce} from './athreeModuleSelection';
describe('bounded exclusion-aware module selection',()=>{
 it.each([
 ['नदी और पेड़',['plants','rivers'],[]],
 ['कार और सड़क',['roads','vehicles'],[]],
 ['बारिश और रात',['sky'],[]],
 ['नदी और पेड़ नहीं',[],['plants','rivers']],
 ['नदी चाहिए, पेड़ नहीं',['rivers'],['plants']],
 ['nahi chahiye ped; nadi chahiye',['rivers'],['plants']],
 ['नहीं चाहिए पेड़; नदी चाहिए',['rivers'],['plants']],
 ['never add trees, river',['rivers'],['plants']],
 ['no optional modules',[],['sea','plants','rivers','sky','roads','vehicles']],
 ['trees are not needed; add river',['rivers'],['plants']],
 ['trees not needed; add river',['rivers'],['plants']],
 ['trees and cars nahi, nadi chahiye',['rivers'],['plants','vehicles']],
 ['not only trees but rivers',['plants','rivers'],[]],
 ["don't include trees; add river",['rivers'],['plants']],
 ['river with no trees',['rivers'],['plants']],
 ['no trees and no cars',[],['plants','vehicles']],
 ['ped aur gaadi nahi',[],['plants','vehicles']],
 ['पेड़ और कार नहीं',[],['plants','vehicles']],
 ['nadi chahiye ped nahi',['rivers'],['plants']],
 ['पेड़ नहीं नदी चाहिए',['rivers'],['plants']],
 ['नदी चाहिए पेड़ नहीं',['rivers'],['plants']],
 ['no trees and cars with rivers',['rivers'],['plants','vehicles']],
 ['river without trees, sky',['rivers','sky'],['plants']],
 ['nadi aur ped',['plants','rivers'],[]],
 ['no trees but add sky',['sky'],['plants']],
 ['trees, no trees',[],['plants']],
 ])('%s',(text,modules,excluded)=>{expect(pick(text).modules).toEqual(modules);expect(pick(text).excluded).toEqual(excluded);});
 it('keeps fallback only without any mentioned feature',()=>{expect(pick('build a game').modules).toHaveLength(6);expect(pick('no trees').modules).toEqual([]);});
 it('subtracts explicit exclusions from everything',()=>{const p=pick('everything except roads');expect(p.modules).toHaveLength(5);expect(p.excluded).toEqual(['roads']);expect(p.modules).not.toContain('roads');});
 it('does not allow explicit include to override exclusions',()=>{const p=pick('everything except roads');expect(()=>enforce(['roads'],p)).toThrow(/excluded/);expect(enforce(['rivers','sky'],p)).toEqual(['rivers','sky']);expect(()=>enforce([' ROADS '],p)).toThrow(/excluded/);expect(enforce(['volcano'],p)).toEqual(['volcano']);});
 it('retains positive match explanation',()=>expect(pick('nadi').reason).toContain('rivers (nadi)'));
});
