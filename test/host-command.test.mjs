import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {executeSupervisedCommand,hostProcessGroupQuiescent}=await import('../src/host-command.ts');
const {DurableStore}=await import('../src/store.ts');
const binding={taskId:'synthetic-task',specHash:'1'.repeat(64),candidateDigest:'2'.repeat(64),candidateGeneration:1};
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'host-command-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const repo=join(dir,'repo'),data=join(dir,'data');mkdirSync(repo);mkdirSync(data);return {repo,store:DurableStore.project(data,repo,'planning',()=> 'ACCEPT',true)}}
const command=(code,timeoutMs=5000)=>({schemaVersion:1,id:'synthetic-check',executable:process.execPath,argv:['-e',code],timeoutMs,required:true});
test('supervised checks leave the UI event loop available and retain complete bounded output above 64 KiB',async t=>{
 const f=fixture(t),events=[];let beats=0;const timer=setInterval(()=>beats++,20);t.after(()=>clearInterval(timer));
 const out=await executeSupervisedCommand(command("setTimeout(()=>process.stdout.write('é'.repeat(100000)),600)"),f.repo,f.store,binding,{onProgress:e=>events.push(e)});
 assert.equal(out.child.status,0);assert.equal(out.child.error,undefined);assert.equal(out.child.stdout,'é'.repeat(100000));assert.ok(beats>8);
 assert.ok(events.some(e=>e.phase==='RUNNING'&&e.elapsedMs>=200));assert.equal(events.at(-1).phase,'FINISHED');assert.ok(events.at(-1).outputBytes>=200000);
 const rows=out.artifacts.map(ref=>JSON.parse(Buffer.from(f.store.read(ref)).toString('utf8')));assert.deepEqual(rows.map(r=>r.phase),['INTENT','STARTED','CLOSED']);assert.equal(rows.at(-1).groupQuiescent,true);assert.equal(rows.at(-1).commandHash,rows[0].commandHash);
});
test('a time limit closes the owned process group, including a child inheriting the output pipes',async t=>{
 const f=fixture(t);const out=await executeSupervisedCommand(command("const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});console.log(c.pid);setInterval(()=>{},1000)",3000),f.repo,f.store,binding);
 assert.equal(out.child.error.code,'ETIMEDOUT');assert.equal(out.child.status,null);assert.equal(hostProcessGroupQuiescent(out.child.pid),true);
 const child=Number(out.child.stdout.trim());assert.ok(child>0);try{const stat=readFileSync(`/proc/${child}/stat`,'utf8');assert.match(stat.slice(stat.lastIndexOf(')')+2),/^[ZX] /)}catch(error){if(error.code!=='ENOENT')throw error}
});
test('the hard output limit interrupts a check without accepting truncated success',async t=>{
 const f=fixture(t),out=await executeSupervisedCommand(command("process.stdout.write('x'.repeat(6*1024*1024));setInterval(()=>{},1000)"),f.repo,f.store,binding);
 assert.equal(out.child.error.code,'ENOBUFS');assert.ok(out.child.stdout.length<=4*1024*1024);assert.equal(hostProcessGroupQuiescent(out.child.pid),true);
});
test('spawn failure has a durable no-start outcome and cannot produce a successful check',async t=>{
 const f=fixture(t),c={...command('void 0'),executable:join(f.repo,'absent-command')};await assert.rejects(executeSupervisedCommand(c,f.repo,f.store,binding),/VALIDATION_TERMINAL_PROOF_UNAVAILABLE/);
});
test('presentation errors cannot alter results; concurrent commands in the same store are refused',async t=>{
 const f=fixture(t),first=executeSupervisedCommand(command('setTimeout(()=>{},250)'),f.repo,f.store,binding,{onProgress(){throw new Error('display failed')}});
 await assert.rejects(executeSupervisedCommand(command(''),f.repo,f.store,binding),/HOST_COMMAND_BUSY/);assert.equal((await first).child.status,0);
});
test('a failed durable start journal kills the command and reports storage failure',async t=>{
 const f=fixture(t),put=f.store.put.bind(f.store);let failed=false;t.mock.method(f.store,'put',(id,...rest)=>{if(id.endsWith('-started')){failed=true;throw new Error('SYNTHETIC_DISK_FAILURE')}return put(id,...rest)});
 await assert.rejects(executeSupervisedCommand(command('setInterval(()=>{},1000)'),f.repo,f.store,binding),/SYNTHETIC_DISK_FAILURE/);assert.equal(failed,true);
});

test('an unkillable check returns an uncertain outcome after bounded shutdown instead of hanging the TUI',async t=>{
 const f=fixture(t),originalKill=process.kill.bind(process);let group;
 const {syncBuiltinESMExports}=await import('node:module');
 const mock=t.mock.method(process,'kill',(pid,...rest)=>{if(pid<0){group=-pid;throw Object.assign(new Error('synthetic signal refusal'),{code:'EACCES'})}return originalKill(pid,...rest)});syncBuiltinESMExports();
 try{await assert.rejects(executeSupervisedCommand(command('setInterval(()=>{},1000)',50),f.repo,f.store,binding),/HOST_COMMAND_TERMINATION_UNPROVEN/);assert.ok(group>0)}
 finally{mock.mock.restore();syncBuiltinESMExports();if(group)originalKill(-group,'SIGKILL');for(let i=0;i<100&&!hostProcessGroupQuiescent(group);i++)await new Promise(done=>setTimeout(done,10));await new Promise(done=>setTimeout(done,50))}
});
