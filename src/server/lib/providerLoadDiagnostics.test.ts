import {expect,it} from 'vitest';
import {LoadDiagnosticError,loadStage,safeLoadDiagnostic} from './providerLoadDiagnostics';
import {LoadBatchError} from './providerLoadBatch';
const id='11111111-1111-4111-8111-111111111111';
it('safe projection excludes raw details and unknown fields/codes',()=>{
 const e=new LoadDiagnosticError('unavailable','quote_http','http_rejected',403,'secret-code',{model:'string',max_input_per_million:'missing',secret:'string'});
 Object.assign(e,{cause:'Bearer private',headers:{authorization:'private'}});
 expect(safeLoadDiagnostic(e,id)).toEqual({correlationId:id,stage:'quote_http',reason:'http_rejected',upstreamStatus:403,fields:{model:'string',max_input_per_million:'missing'}});
});
it.each(['settings_read','configuration_write'] as const)('classifies database stage %s without raw errors',async stage=>{
 await expect(loadStage(stage,async()=>{throw Error('credential private');})).rejects.toMatchObject({stage,reason:'operation_unavailable'});
});
it('preserves revision and validation semantics',()=>{
 expect(safeLoadDiagnostic(new LoadBatchError('conflict'),id).reason).toBe('revision_conflict');
 expect(safeLoadDiagnostic(new LoadBatchError('invalid'),id).reason).toBe('validation_failed');
 expect(JSON.stringify(safeLoadDiagnostic(Error('secret'),id))).not.toContain('secret');
});
