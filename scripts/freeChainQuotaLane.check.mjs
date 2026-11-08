#!/usr/bin/env node
/** Real isolated ledger test: no provider, credentials or production database access. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
const endpoint=process.argv[process.argv.indexOf('--emulator')+1];
assert.match(endpoint??'',/^127\.0\.0\.1:\d+$/,'Explicit loopback emulator required');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,endpoint,'No production fallback');
// Match existing credential-free emulator drills; prevent irrelevant ADC metadata probes.
process.env.GCE_METADATA_HOST='127.0.0.1:9';
const require=createRequire(import.meta.url);const {Firestore}=require('firebase-admin/firestore');
const db=new Firestore({projectId:'demo-navbharatai-phase2',databaseId:`quota-lane-${randomUUID()}`,host:endpoint,ssl:false});
const {FreeChainStore}=await import('../src/server/AI/FreeChain/store.ts');
let active=0,peak=0;
const handle={doc:path=>db.doc(path),runTransaction:async run=>{peak=Math.max(peak,++active);try{return await db.runTransaction(run);}finally{active--;}}};
const store=new FreeChainStore(handle);const stores=Array.from({length:32},()=>new FreeChainStore(handle));const now=Date.now();
const input={provider:'synthetic-quota-lane',model:'synthetic',timeZone:'rolling24h',inputTokens:1,outputTokens:1,limits:{rpm:30,rpd:1000,tpm:8000,tpd:200000},safetyMargin:0.9};
try {
 const started=performance.now(),latencies=[];
 const results=await Promise.all(Array.from({length:1024},async(_,i)=>{const t=performance.now();const result=await stores[i%stores.length].reserveQuota(input,now);latencies.push(performance.now()-t);return result;}));
 const elapsedMs=performance.now()-started;latencies.sort((a,b)=>a-b);
 const accepted=results.filter(r=>r.allowed).length;
 const reasons=Object.fromEntries([...new Set(results.map(r=>r.reason))].map(reason=>[reason,results.filter(r=>r.reason===reason).length]));
 assert.equal(accepted,27,'unchanged 30 RPM quota with 0.9 margin');
 assert(results.every(r=>['allowed','rpm','local_capacity'].includes(r.reason)),'No storage corruption/outage masquerading as quota');
 assert.equal((await store.quotaSnapshot(input,now)).usage.rpm,accepted,'every granted reservation is durably counted');
 assert.equal(peak,1,'same-account local transactions never overlap');assert.equal(active,0);
 assert.equal((await store.reserveQuota(input,now)).reason,'rpm','lane recovers and retains authoritative quota refusal');
 console.log(JSON.stringify({requests:results.length,elapsedMs,p95Ms:latencies[Math.ceil(latencies.length*.95)-1],p99Ms:latencies[Math.ceil(latencies.length*.99)-1],accepted,reasons,peakPhysicalTransactions:peak,active}));
 console.log('FreeChain quota-lane emulator: PASS; no provider calls or production data.');
} finally {await db.terminate();}
