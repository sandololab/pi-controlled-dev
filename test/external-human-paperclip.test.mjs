import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {installSourceLoader} from './load-source.mjs';
import {PaperclipHumanClient} from '../integrations/paperclip/client.mjs';
import {digest,seal,verify} from '../integrations/paperclip/protocol.mjs';
installSourceLoader();
const {createExternalHumanContext,hasHumanChannel}=await import('../src/external-human-channel.ts');
const {createTrustedConfirmationRequest,presentTrustedConfirmation,consumeTrustedConfirmation}=await import('../src/trusted-confirmation.ts');
const input=()=>({purpose:'integration-checkpoint',subjectKind:'checkpoint',subjectId:'example',subjectRevision:1,action:'APPROVE',payload:{commit:'abc',criterion:'Check the exact candidate'},presentation:{title:'Approve this check?',content:'Read-only check of the exact candidate.'}});
function store(){const files=new Map();return {put(id,content,mediaType){const bytes=Buffer.from(content),ref={schemaVersion:1,id,bytes:bytes.length,digest:createHash('sha256').update(bytes).digest('hex'),mediaType,relativeStorePath:"artifacts/"+id};files.set(id,bytes);return ref;},read(ref){return files.get(ref.id)}};}
function response(q,patch={}){return {accepted:true,requestDigest:q.digest,provider:'paperclip',interactionId:'interaction',actorUserId:'human',...patch};}
function channel(confirm){let id='session';const ctx=createExternalHumanContext({sessionManager:{getSessionId:()=>id},ui:{confirm:async()=>{throw Error('TUI must not be used')}}},confirm);return {ctx,change(){id='another-session'}};}
test('registered external human channel emits a native one-use confirmation; copied receipts have no authority',async()=>{
 const c=channel(async q=>response(q)),request=createTrustedConfirmationRequest(input()),receipt=await presentTrustedConfirmation(c.ctx,request),s=store();
 assert.equal(receipt.confirmationInstance.source,'external-human');
 assert.throws(()=>consumeTrustedConfirmation(JSON.parse(JSON.stringify(receipt)),()=>request,s),/RECEIPT_INVALID/);
 assert.ok(consumeTrustedConfirmation(receipt,()=>request,s));
 assert.throws(()=>consumeTrustedConfirmation(receipt,()=>request,s),/RECEIPT_INVALID/);
});
test('unregistered mode, print/rpc and JSON context cannot authorize a native confirmation',async()=>{
 for(const mode of ['external-human','rpc','print']){
  const fake={mode,sessionManager:{getSessionId:()=> 'session'},ui:{confirm:async()=>true}};
  assert.equal(hasHumanChannel(fake),false);
  await assert.rejects(presentTrustedConfirmation(fake,createTrustedConfirmationRequest(input())),/HUMAN_CHANNEL_UNAVAILABLE/);
 }
 const c=channel(async q=>response(q)),fake=JSON.parse(JSON.stringify(c.ctx));fake.sessionManager={getSessionId:()=> 'session'};assert.equal(hasHumanChannel(fake),false);
});
test('native context spreads preserve the host capability while UI replacement cannot manufacture approval',async()=>{
 const c=channel(async q=>response(q,{accepted:false}));
 assert.equal(hasHumanChannel({...c.ctx}),true);
 const altered={...c.ctx,ui:{confirm:async()=>true}};
 assert.equal(await presentTrustedConfirmation(altered,createTrustedConfirmationRequest(input())),undefined);
});
test('session changes and disposed host channels fail closed',async()=>{
 const c=channel(async q=>{c.change();return response(q)});
 assert.equal(await presentTrustedConfirmation(c.ctx,createTrustedConfirmationRequest(input())),undefined);
 const d=channel(async q=>response(q));d.ctx.disposeHumanChannel();
 await assert.rejects(presentTrustedConfirmation(d.ctx,createTrustedConfirmationRequest(input())),/HUMAN_CHANNEL_UNAVAILABLE/);
});
test('wrong response digest, anonymous actor and malformed results cannot approve',async()=>{
 for(const patch of [{requestDigest:'wrong'},{actorUserId:''},{accepted:'yes'}]){
  const c=channel(async q=>response(q,patch));
  await assert.rejects(presentTrustedConfirmation(c.ctx,createTrustedConfirmationRequest(input())),/RESPONSE_INVALID/);
 }
});
test('changed native subject after human acceptance burns the receipt without action',async()=>{
 const c=channel(async q=>response(q)),request=createTrustedConfirmationRequest(input()),r=await presentTrustedConfirmation(c.ctx,request),s=store();
 assert.throws(()=>consumeTrustedConfirmation(r,()=>({...request,subjectRevision:2}),s),/STALE/);
 assert.throws(()=>consumeTrustedConfirmation(r,()=>request,s),/RECEIPT_INVALID/);
});
function fakePaperclip(){
 const calls=[],documents=new Map(),interactions=[];const state={calls,documents,interactions};
 const actor={id:'agent',companyId:'company'},issue={id:'issue',identifier:'TST-1',projectId:'project',companyId:'company',assigneeAgentId:'agent',assigneeUserId:null,status:'in_progress',executionPolicy:{mode:'standard',commentRequired:false,stages:[]}};
 const fetcher=async(url,options={})=>{
  calls.push({url,method:options.method,headers:options.headers});
  assert.equal(options.headers.Authorization,'Bearer ephemeral-test-value');assert.equal(options.headers['X-Paperclip-Run-Id'],'run');
  const route=new URL(url).pathname,body=options.body?JSON.parse(options.body):undefined;
  const ok=v=>new Response(JSON.stringify(v),{status:200,headers:{'Content-Type':'application/json'}});
  if(route==='/api/agents/me')return ok(actor);
  if(route==='/api/issues/issue')return ok(body?Object.assign(issue,body):issue);
  if(route==='/api/issues/issue/interactions'){
   if(options.method==='GET')return ok(interactions);
   const row={...body,id:'interaction-'+interactions.length,companyId:'company',issueId:'issue',status:'pending',requestedResolverPolicy:body.resolverPolicy,effectiveResolverPolicy:body.resolverPolicy};
   interactions.push(row);return ok(row);
  }
  const key=route.split('/documents/')[1];
  if(key){if(body)documents.set(key,{...body,id:'doc-'+key,latestRevisionId:'revision-1'});return documents.has(key)?ok(documents.get(key)):new Response('{}',{status:404});}
  throw Error('Unexpected route '+route);
 };
 state.client=new PaperclipHumanClient({apiUrl:'http://127.0.0.1:3100',companyId:'company',issueId:'issue',agentId:'agent',runId:'run',apiKey:'ephemeral-test-value',fetcher});
 state.accept=(row,patch={})=>Object.assign(row,{status:'accepted',resolvedByUserId:'owner',resolvedByAgentId:null,resolvedByRunId:null,resolvedAt:'2026-01-01T00:00:00Z',result:{version:1,outcome:'accepted'},...patch});
 return state;
}
function nativeRequest(){const v={version:1,requestId:'request',sessionId:'session',title:'Approve exact candidate',display:'Candidate abc; run only the stated check.'};return {...v,kind:'confirm',digest:digest(v)};}
test('Paperclip confirmation uses verified document revision, human_only and audited run; repeated publish does not duplicate',async()=>{
 const f=fakePaperclip(),q=nativeRequest();await f.client.identity();const row=await f.client.publish('job',q);assert.equal(row.effectiveResolverPolicy,'human_only');
 assert.equal(await f.client.read(row,q),null);assert.equal((await f.client.publish('job',q)).id,row.id);assert.equal(f.interactions.length,1);
 f.accept(f.interactions[0]);const result=await f.client.read(row,q);assert.equal(result.accepted,true);assert.equal(result.actorUserId,'owner');assert.equal(result.requestDigest,q.digest);
});
test('Paperclip agent resolution, changed document, wrong company and widened resolver cannot yield approval',async()=>{
 for(const type of ['agent','document','company','policy']){
  const f=fakePaperclip(),q=nativeRequest();await f.client.identity();const row=await f.client.publish('job',q);f.accept(f.interactions[0]);
  if(type==='agent')f.interactions[0].resolvedByAgentId='agent';
  if(type==='document')f.documents.get('pi-request').body='Different candidate';
  if(type==='company')f.interactions[0].companyId='foreign';
  if(type==='policy')f.interactions[0].effectiveResolverPolicy='anyone';
  await assert.rejects(f.client.read(row,q),/HUMAN_RESOLVER_REQUIRED|PRESENTATION_MISMATCH|HUMAN_POLICY_REQUIRED/);
 }
});
test('expired/rejected Paperclip requests never become accepted native decisions',async()=>{
 const f=fakePaperclip(),q=nativeRequest();await f.client.identity();const row=await f.client.publish('job',q);
 f.interactions[0].status='expired';assert.equal((await f.client.read(row,q)).cancelled,true);
 f.accept(f.interactions[0],{status:'rejected',result:{version:1,outcome:'rejected'}});assert.equal((await f.client.read(row,q)).accepted,false);
});
test('transport signatures bind all fields; forged and replay-to-other-request payloads are detected',()=>{
 const key='random test key',packet=seal(key,{requestId:'one',digest:'candidate',accepted:true});assert.equal(verify(key,packet),true);
 assert.equal(verify(key,{...packet,value:{...packet.value,requestId:'two'}}),false);
 assert.equal(verify('different key',packet),false);
});


test('Paperclip questions preserve full text in a revision-bound document and accept only a real human answer',async()=>{
 for(const kind of ['select','editor']){
  const f=fakePaperclip(),v={...nativeRequest(),kind,display:'Long native proposal. '.repeat(1000),...(kind==='select'?{options:['Proceed','Revise']}:{})};
  await f.client.identity();const row=await f.client.publish('job',v),question=row.payload.questions[0];
  assert.ok(question.helpText.length<4000);assert.ok(f.documents.get('pi-request').body.includes(v.display));
  assert.equal(await f.client.read(row,v),null);
  f.accept(f.interactions[0],{status:'answered',result:{version:1,answers:[{questionId:'answer',optionIds:[kind==='select'?'option-1':'text'],...(kind==='editor'?{otherText:'A real reply'}:{})}]}});
  assert.equal((await f.client.read(row,v)).value,kind==='select'?'Revise':'A real reply');
  f.documents.get('pi-request').latestRevisionId='revision-2';
  await assert.rejects(f.client.read(row,v),/STALE_TARGET/);
 }
});
test('invalid selections and changed question policies cannot authorize a choice',async()=>{
 const f=fakePaperclip(),v={...nativeRequest(),kind:'select',options:['Proceed','Revise']};
 await f.client.identity();const row=await f.client.publish('job',v);
 f.accept(f.interactions[0],{status:'answered',result:{version:1,answers:[{questionId:'answer',optionIds:['unknown']}]}});
 await assert.rejects(f.client.read(row,v),/ANSWER_INVALID/);
 f.interactions[0].payload.questions[0].allowOther=true;
 await assert.rejects(f.client.read(row,v),/PRESENTATION_MISMATCH/);
});
