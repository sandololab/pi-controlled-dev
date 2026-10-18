import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const api=await import('../src/trusted-confirmation.ts');
const {createTrustedConfirmationRequest:create,presentTrustedConfirmation:present,consumeTrustedConfirmation:consume,readTrustedConfirmationEvidence:read,CONFIRMATION_LIMITS}=api;
const {hashCanonical,canonicalize}=await import('../src/contracts.ts');
const {DurableStore}=await import('../src/store.ts');
const {projectConfirmationFixture,default:probe}=await import('./project-confirmation-host-probe.ts');
const input=()=>({purpose:'project-memory-approval',subjectKind:'ProjectMemoryProposalFixture',subjectId:'proposal-1',subjectRevision:1,action:'APPROVE',
  payload:{fixtureOnly:true,rule:'Usare il repository esistente.'},presentation:{title:'Conferma fittizia',content:'Confermi di usare il repository esistente?'}});
// Native UI doubles test branches only. None of these results certify real human interaction.
const context=(response=true)=>({mode:'tui',sessionManager:{getSessionId:()=> 'test-session'},ui:{confirm:async()=>response}});
function storage(t){const root=mkdtempSync(join(tmpdir(),'confirmation-test-')),data=join(root,'data'),repo=join(root,'repo');mkdirSync(data);mkdirSync(repo);
  t.after(()=>rmSync(root,{recursive:true,force:true}));return DurableStore.create(data,repo,'fixture',()=> 'ACCEPT')}
async function approved(){const request=create(input()),ctx=context(),receipt=await present(ctx,request);return {request,ctx,receipt}}

test('trusted request snapshots inert canonical payload and immutable exact presentation',()=>{
  const original=input(),request=create(original);original.payload.rule='changed';original.presentation.content='changed';
  assert.equal(request.payload.rule,'Usare il repository esistente.');assert.equal(request.payloadDigest,hashCanonical(request.payload));
  assert.equal(Object.isFrozen(request.payload),true);assert.equal(Object.isFrozen(request.presentation),true);
  assert.match(request.presentation.content,/APPROVE/);assert.match(request.confirmationId,/^local-/);
  const reordered={rule:'Usare il repository esistente.',fixtureOnly:true};assert.equal(hashCanonical(reordered),request.payloadDigest);
});
test('trusted request allowlist and closed bounded schemas reject arbitrary input',()=>{
  for(const patch of [{purpose:'model-approved'},{subjectRevision:-1},{subjectId:'invalid id'},{action:'AUTO_APPROVE'},{approved:true}])assert.throws(()=>create({...input(),...patch}));
  assert.throws(()=>create({...input(),payload:'x'.repeat(CONFIRMATION_LIMITS.payloadBytes)}));
  assert.throws(()=>create({...input(),presentation:{title:'x',content:'x'.repeat(CONFIRMATION_LIMITS.presentationBytes)}}));
  assert.throws(()=>create({...input(),presentation:{title:'x',content:'unsafe\u001b[2J'}}));
  for(const content of [null,false,1,[],{}])assert.throws(()=>create({...input(),presentation:{title:'x',content}}));
  assert.throws(()=>create({...input(),payload:{get approved(){throw new Error('getter must not run')}}}),/DESCRIPTOR/);
});
test('external requests and copies cannot invoke even a native confirmation double',async()=>{
  let calls=0;const ctx=context();ctx.ui.confirm=async()=>{calls++;return true};const request=create(input());
  for(const q of [input(),structuredClone(request),{...request,purpose:'arbitrary'}])await assert.rejects(()=>present(ctx,q),/UNREGISTERED/);
  assert.equal(calls,0);
});
test('receipt binds exact title, content, payload, action, subject and session',async()=>{
  let shown;const request=create(input()),ctx=context();ctx.ui.confirm=async(title,content)=>{shown={title,content};return true};
  const receipt=await present(ctx,request);assert.deepEqual(shown,request.presentation);
  assert.equal(receipt.presentationDigest,hashCanonical(shown));assert.equal(receipt.requestDigest,hashCanonical(request));
  for(const k of ['purpose','subjectKind','subjectId','subjectRevision','action','payloadDigest'])assert.equal(receipt[k],request[k]);
  assert.equal(receipt.confirmationInstance.sessionId,'test-session');assert.equal(Object.hasOwn(receipt,'actorIdentity'),false);
});
for(const action of ['REJECT','ANSWER'])test(`explicit ${action} uses affirmative native return; cancellation is separate`,async t=>{
  const request=create({...input(),action,payload:{answer:'Usare la convenzione esistente.'}}),receipt=await present(context(),request),store=storage(t);
  assert.equal(receipt.decision,action);assert.equal(read(store,consume(receipt,()=>request,store),request).receipt.decision,action);
});
test('cancel, nonboolean, timeout and UI exceptions cannot mint receipts',async()=>{
  for(const response of [false,undefined,1,'true',{approved:true}]){const ctx=context();ctx.ui.confirm=async()=>response;assert.equal(await present(ctx,create(input())),undefined);}
  const ctx=context();ctx.ui.confirm=async()=>{throw new Error('timeout')};assert.equal(await present(ctx,create(input())),undefined);
});
test('headless and absent session fail closed without showing a dialog',async()=>{
  for(const mode of ['rpc','json','print','headless']){let calls=0;const ctx=context();ctx.mode=mode;ctx.ui.confirm=async()=>{calls++;return true};
    await assert.rejects(()=>present(ctx,create(input())),/HUMAN_CHANNEL_UNAVAILABLE/);assert.equal(calls,0)}
  const ctx=context();ctx.sessionManager.getSessionId=()=>undefined;await assert.rejects(()=>present(ctx,create(input())),/HUMAN_CHANNEL_UNAVAILABLE/);
});
test('session, mode or native method change during dialog invalidates affirmative return',async()=>{
  for(const mutate of [c=>{c.mode='rpc'},c=>{c.sessionManager.getSessionId=()=> 'other'},c=>{c.ui.confirm=async()=>true}]){
    const ctx=context();ctx.ui.confirm=async()=>{mutate(ctx);return true};assert.equal(await present(ctx,create(input())),undefined)}
});
test('same request cannot be presented twice or concurrently',async()=>{
  const request=create(input());let release;const ctx=context();ctx.ui.confirm=()=>new Promise(r=>{release=r});
  const pending=present(ctx,request);await assert.rejects(()=>present(ctx,request),/UNREGISTERED/);release(true);assert.ok(await pending);
});
for(const [label,change] of [
  ['revision',r=>({...r,subjectRevision:2})],['subject',r=>({...r,subjectId:'other'})],['subject kind',r=>({...r,subjectKind:'Other'})],
  ['purpose',r=>({...r,purpose:'task-human-gate'})],['payload',r=>({...r,payload:{different:true},payloadDigest:hashCanonical({different:true})})],
  ['payload digest',r=>({...r,payloadDigest:'b'.repeat(64)})],['action',r=>({...r,action:'REJECT'})],
  ['presentation',r=>({...r,presentation:{...r.presentation,content:'different'}})],
])test(`stale ${label} rejects consumption before persistence and burns receipt`,async t=>{
  const {request,receipt}=await approved();let puts=0;const store=storage(t),writer={read:ref=>store.read(ref),put(...args){puts++;return store.put(...args)}};
  assert.throws(()=>consume(receipt,()=>change(request),writer));assert.equal(puts,0);
  assert.throws(()=>consume(receipt,()=>request,writer),/RECEIPT_INVALID/);
});
test('forged receipts from every role, copied genuine receipts and diagnostic records have no authority',async t=>{
  const {request,receipt}=await approved(),store=storage(t);
  for(const role of ['Scout','Developer','Reviewer','Oracle','parent']){
    const forged={...receipt,role,approved:true};assert.throws(()=>consume(forged,()=>request,store),/RECEIPT_INVALID/)}
  assert.throws(()=>consume(structuredClone(receipt),()=>request,store),/RECEIPT_INVALID/);
  const {requestTrustedHumanConfirmation:diagnose}=await import('./trusted-human-probe.ts');
  const diagnostic=await diagnose(context(),{gateProbeId:'fixture',testDataHash:request.payloadDigest});assert.equal(diagnostic.humanAccepted,true);
  assert.throws(()=>consume(diagnostic,()=>request,store),/RECEIPT_INVALID/);
});
test('single-use persists evidence before consumer action; reload cannot restore permission',async t=>{
  const {request,receipt}=await approved(),store=storage(t);const ref=consume(receipt,()=>request,store);
  const evidence=read(store,ref,request);assert.deepEqual(evidence.receipt,receipt);assert.equal(ref.digest,hashCanonical(evidence));
  assert.throws(()=>consume(receipt,()=>request,store),/RECEIPT_INVALID/);
  assert.throws(()=>consume(evidence.receipt,()=>request,store),/RECEIPT_INVALID/);
});
test('I/O failure or subject change during persistence burns receipt without authorizing action',async t=>{
  const first=await approved();assert.throws(()=>consume(first.receipt,()=>first.request,{put(){throw new Error('IO_FAILURE')}}),/IO_FAILURE/);
  assert.throws(()=>consume(first.receipt,()=>first.request,storage(t)),/RECEIPT_INVALID/);
  const second=await approved(),store=storage(t);let current=second.request;
  const writer={read:ref=>store.read(ref),put(...args){const ref=store.put(...args);current={...current,subjectRevision:2};return ref}};
  assert.throws(()=>consume(second.receipt,()=>current,writer),/STALE/);
});
test('session or native method change after dialog prevents consumption',async t=>{
  for(const mutate of [c=>{c.mode='rpc'},c=>{c.sessionManager.getSessionId=()=> 'other'},c=>{c.ui.confirm=async()=>true}]){
    const {ctx,request,receipt}=await approved();mutate(ctx);assert.throws(()=>consume(receipt,()=>request,storage(t)),/STALE/)}
});
test('historical artifact verifier rejects wrong media, tampering and self-consistent mismatched receipt',async t=>{
  const {request,receipt}=await approved(),store=storage(t),ref=consume(receipt,()=>request,store),packet=read(store,ref,request);
  assert.throws(()=>read(store,{...ref,mediaType:'text/plain'},request),/EVIDENCE_INVALID/);
  assert.throws(()=>read({read:()=>Buffer.from('{}')},ref,request),/EVIDENCE_INVALID/);
  for(const patch of [{decision:'REJECT'},{purpose:'task-human-gate'},{subjectRevision:2},{presentationDigest:'a'.repeat(64)},{extra:true}]){
    const content=canonicalize({...packet,receipt:{...packet.receipt,...patch}}),modified={...ref,digest:hashCanonical(JSON.parse(content)),bytes:Buffer.byteLength(content)};
    assert.throws(()=>read({read:()=>Buffer.from(content)},modified,request));}
});
test('shared custom TUI path preserves cancellation default and exact logical content',async t=>{
  const request=create(input());let shown;const ctx=context();ctx.ui.custom=factory=>new Promise(resolve=>{
    const frame=factory({requestRender(){},terminal:{rows:40}},null,null,resolve);shown=frame.render(100).join('\n');frame.handleInput('\t');frame.handleInput('\r');});
  const receipt=await present(ctx,request);assert.match(shown,/Confermi di usare il repository esistente/);
  assert.equal(receipt.confirmationInstance.source,'ctx.ui.custom');assert.ok(consume(receipt,()=>request,storage(t)));
});
test('project-level fixture persists canonical exact evidence and verifies in a fresh process',async t=>{
  const store=storage(t),result=await projectConfirmationFixture(context(),store);assert.ok(result);
  const artifact=join(store.root,result.ref.relativeStorePath),before=readFileSync(artifact);assert.equal(hashCanonical(result.evidence),result.ref.digest);
  const code=`import {readFileSync} from 'node:fs'; import {installSourceLoader} from './test/load-source.mjs'; installSourceLoader(); const api=await import('./src/trusted-confirmation.ts'); const packet=JSON.parse(readFileSync(process.argv[1],'utf8')); const ref=JSON.parse(process.argv[2]); const evidence=api.readTrustedConfirmationEvidence({read:()=>readFileSync(process.argv[1])},ref,packet.request); let refused=false; try{api.consumeTrustedConfirmation(evidence.receipt,()=>packet.request,{})}catch{refused=true} if(!refused)throw new Error('RELOAD_AUTHORITY'); console.log(evidence.receipt.payloadDigest);`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code,artifact,JSON.stringify(result.ref)],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8'});
  assert.ifError(child.error);assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),result.evidence.receipt.payloadDigest);
  assert.deepEqual(readFileSync(artifact),before);
});
test('fixture host command is explicit, rejects headless and parent/agent mutation tools remain blocked',async()=>{
  let tools=['read','write','edit','bash','subagent'];const events=new Map(),commands=new Map();
  probe({on(name,fn){events.set(name,fn)},registerCommand(name,command){commands.set(name,command)},
    getAllTools:()=>[{name:'read',sourceInfo:{source:'builtin',path:'<builtin:read>'}}],getActiveTools:()=>tools,setActiveTools:names=>{tools=names}});
  const ctx=context();ctx.mode='rpc';await events.get('session_start')({},ctx);assert.deepEqual(tools,['read']);
  await assert.rejects(()=>commands.get('project-confirmation-fixture').handler('',ctx),/HUMAN_CHANNEL_UNAVAILABLE/);
  for(const toolName of ['write','edit','bash','subagent','createTrustedConfirmationRequest','consumeTrustedConfirmation'])assert.equal(events.get('tool_call')({toolName}).block,true);
  for(const role of ['scout','developer','reviewer','oracle'])assert.doesNotMatch(readFileSync(new URL(`../src/controlled-${role}.ts`,import.meta.url),'utf8'),/trusted-confirmation/);
});

test('generic task-purpose receipt cannot bypass registered HumanGate or acceptHumanDecision',async t=>{
  const {presentHumanGate,CentralOrchestrator}=await import('../src/orchestrator.ts');
  const request=create({...input(),purpose:'task-human-gate'}),ctx=context(),receipt=await present(ctx,request);
  assert.throws(()=>CentralOrchestrator.prototype.acceptHumanDecision.call({}, {}, receipt),/HUMAN_DECISION_INVALID/);
  await assert.rejects(()=>presentHumanGate(ctx,{gateType:'beforeImplementation',snapshot:{sessionId:'test-session'},displayText:'{}'}),/HUMAN_DECISION_INVALID/);
  assert.ok(consume(receipt,()=>request,storage(t)),'Task admission refusal never consumes the unrelated generic capability');
});
