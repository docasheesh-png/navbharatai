#!/usr/bin/env node
/** Offline, closed-answer evaluation. Never dispatches a model or executes supplied code. */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// Independently authored answer keys; synthetic fixture passes do not measure model quality.
export const cases = [
  { id:'hi-add', category:'Hindi arithmetic', prompt:'केवल संख्या लिखें: 37 + 58 कितना है?', key:95 },
  { id:'hi-percent', category:'Hindi arithmetic', prompt:'केवल संख्या लिखें: 240 का 15 प्रतिशत कितना है?', key:36 },
  { id:'hi-unit', category:'Hindi units', prompt:'केवल संख्या लिखें: 2.5 किलोमीटर में कितने मीटर हैं?', key:2500 },
  { id:'hi-capital', category:'Hindi factual', prompt:'भारत की राजधानी क्या है? केवल नाम लिखें।', key:'नई दिल्ली', aliases:['New Delhi','नयी दिल्ली'] },
  { id:'en-compare', category:'arithmetic', prompt:'Which is larger, 9.11 or 9.9? Return only the larger number.', key:9.9 },
  { id:'en-prime', category:'arithmetic', prompt:'Return only a JSON array of all prime numbers strictly between 10 and 20.', key:[11,13,17,19] },
  { id:'en-seconds', category:'units', prompt:'Return only the number of seconds in 2 hours and 3 minutes.', key:7380 },
  { id:'en-capital', category:'factual', prompt:'What is the capital city of Japan? Return only the city name.', key:'Tokyo', aliases:['टोक्यो'] },
  { id:'py-range', category:'Python tracing', prompt:'Without running tools, give only the JSON array printed by Python: print([i*i for i in range(4)])', key:[0,1,4,9] },
  { id:'py-slice', category:'Python tracing', prompt:'What does Python print? print("abcdef"[1:5:2]) Return only the printed text.', key:'bd' },
  { id:'js-map', category:'JavaScript tracing', prompt:'Return only the JSON array from [1,2,3].map(x => x * 2).', key:[2,4,6] },
  { id:'js-filter', category:'JavaScript tracing', prompt:'Return only the JSON array from [0,1,2,3,4].filter(x => x % 2 === 0).', key:[0,2,4] },
  { id:'hi-negative', category:'Hindi arithmetic', prompt:'केवल संख्या लिखें: -7 + 3 × 4 कितना है?', key:5 },
  { id:'hi-fraction', category:'Hindi arithmetic', prompt:'केवल संख्या लिखें: 3/4 + 1/8 का दशमलव मान क्या है?', key:0.875 },
  { id:'py-sum', category:'Python tracing', prompt:'Return only the integer printed by Python: print(sum(range(1, 6)))', key:15 },
  { id:'insufficient', category:'uncertainty', prompt:'A rectangle has area 24 square units; no other dimensions are given. What is its exact perimeter? Return only INSUFFICIENT if it cannot be determined uniquely.', key:'INSUFFICIENT' },
];
const normalize = value => String(value).normalize('NFKC').trim().toLocaleLowerCase('en-US');
export function gradeAnswer(item, answer) {
  if (typeof answer !== 'string' || !answer.trim() || answer.length > 4096) return false;
  if (typeof item.key === 'string') return [item.key,...(item.aliases ?? [])].some(key=>normalize(answer)===normalize(key));
  try { return JSON.stringify(JSON.parse(answer)) === JSON.stringify(item.key); } catch { return false; }
}
export function manifest(users=1000) {
  return Array.from({length:users*4},(_,i)=>({requestId:`quality-${i}`,userId:`user-${Math.floor(i/4)}`,turn:i%4+1,caseId:cases[i%cases.length].id,prompt:cases[i%cases.length].prompt}));
}
/** Expected records are requestId/userId/caseId/answer/status/source; source must identify real provider output. */
export function evaluate(records, users=1000) {
  if (!Array.isArray(records) || !Number.isInteger(users) || users<1 || users>1000) throw Error('Invalid bounded evaluation input');
  const expected=manifest(users), expectedById=new Map(expected.map(x=>[x.requestId,x])), grouped=new Map();
  const unknown=[];
  for (const record of records) {
    if (!record || !expectedById.has(record.requestId)) { unknown.push(record?.requestId??null); continue; }
    const list=grouped.get(record.requestId)??[];list.push(record);grouped.set(record.requestId,list);
  }
  const outcomes=expected.map(task=>{
    const rows=grouped.get(task.requestId)??[];const row=rows[0];
    const reason=rows.length===0?'missing':rows.length!==1?'duplicate':row.userId!==task.userId||row.caseId!==task.caseId?'identity-mismatch':row.source!=='real-provider'?'unverified-source':row.status!=='ok'?'request-failed':gradeAnswer(cases.find(c=>c.id===task.caseId),row.answer)?'pass':'incorrect-or-format';
    return {requestId:task.requestId,userId:task.userId,caseId:task.caseId,reason};
  });
  const counts={};for(const o of outcomes)counts[o.reason]=(counts[o.reason]??0)+1;
  const passed=counts.pass??0;const usersAllFourPassed=Array.from({length:users},(_,u)=>outcomes.slice(u*4,u*4+4).every(o=>o.reason==='pass')).filter(Boolean).length;
  return {scope:'Closed-answer benchmark only; source labels require independent provenance verification, never universal correctness.',expected:expected.length,received:records.length,passed,failed:expected.length-passed,usersAllFourPassed,unknownRecords:unknown.length,counts,pass:passed===expected.length&&unknown.length===0,outcomes};
}
function main() {
  const [mode,input,output]=process.argv.slice(2);
  if(mode==='manifest'&&input) {writeFileSync(input,JSON.stringify(manifest(),null,2)+'\n');return;}
  if(mode==='grade'&&input&&output) {
    const data=readFileSync(input,'utf8');if(data.length>32*1024*1024)throw Error('Input too large');
    const report={...evaluate(JSON.parse(data)),inputSha256:createHash('sha256').update(data).digest('hex')};writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({expected:report.expected,passed:report.passed,failed:report.failed,usersAllFourPassed:report.usersAllFourPassed,counts:report.counts,pass:report.pass}));
    if(!report.pass)process.exitCode=1;return;
  }
  throw Error('Usage: chatAnswerQuality.mjs manifest OUTPUT.json | grade RESPONSES.json REPORT.json');
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main();
