import test from 'node:test';
import assert from 'node:assert/strict';
import {installSourceLoader} from './load-source.mjs';
import {fixtures,TIME,H,GIT} from './contract-fixtures.mjs';
installSourceLoader();
const api=await import('../src/contracts.ts');
const rb=await import('../src/runtime-root-binding.ts');
// Protocol projections only: these are not acquired host receipts or provider runs.
function fixture({bounded=true,descriptorChange,previousChange,sealChange,transcriptChange,omitEvidence}={}){
 const f=fixtures(api),records=[],bytes=new Map(),record=(id,kind,value)=>{records.push({id,kind,value});return value};
 const put=(id,value,mediaType='application/json',register=true)=>{const raw=Buffer.isBuffer(value)?value:Buffer.from(api.canonicalize(value)),ref={schemaVersion:1,id,relativeStorePath:`artifacts/${id}`,digest:api.hashBytes(raw),bytes:raw.length,mediaType};bytes.set(id,raw);if(register)record(id,'ArtifactRef',ref);return ref};
 const refFor=(id,value)=>({schemaVersion:1,id,relativeStorePath:`artifacts/${id}`,digest:api.hashCanonical(value),bytes:Buffer.byteLength(api.canonicalize(value)),mediaType:'application/json'});
 record('spec','TaskSpec',f.TaskSpec);record('assignment','AssignmentEnvelope',f.AssignmentEnvelope);
 const result={...f.DeveloperResult,changedFiles:[],commandsRun:[],blockedReason:'Need an operator answer'};record('result','DeveloperResult',result);
 const proof=put('terminal-proof',{schemaVersion:1,runId:'run',requestId:'request',role:'Developer',ownerSessionId:'owner',childSessionId:'/old/session.jsonl',statusRequestId:'status',completionSessionId:'owner',terminalStatus:'complete',observedAt:TIME,source:'targeted-rpc-status',provider:{version:1,state:'observed',runId:'run',runnerProcessInstanceId:'process',observedAt:1,instances:[{kind:'runner',processInstanceId:'process',closeObservedAt:1,exitCode:0,signal:null}],resumeDisposition:'resumable'}});
 const canary=put('approved-data',{specHash:f.TaskSpec.specHash,baselineCommit:GIT,originalTreeHash:H});
 const gate={...f.HumanGate,status:'CONSUMED',approvedData:canary,approvedDataHash:canary.digest,consumedEventId:'gate-consumed'};record('gate','HumanGate',gate);
 let previous={...f.WorkflowState,state:bounded?'BLOCKED':'PENDING',revision:3,baselineCommit:GIT,lastEventId:'old-head',gates:['gate'],...(bounded?{blockedReason:'Developer reported a bounded blocker',results:['result'],runs:[{...f.RunRecord,runId:'run',resultRef:'result',childSessionId:'/old/session.jsonl',terminalProofRef:'terminal-proof'}]}:{})};
 if(previousChange)previousChange(previous,records,bytes);record('old-state','WorkflowState',previous);
 const events=[{...f.TransitionEvent,id:'gate-consumed',revision:2,taskId:'task'},{...f.TransitionEvent,id:'old-head',revision:3,eventHash:H,taskId:'task',sourceState:'IMPLEMENTING',targetState:previous.state,...(bounded?{kind:'TRANSITION',transitionId:'TR-015',reason:'Developer reported a bounded blocker'}:{})}];
 const p={schemaVersion:bounded?2:1,projectId:H,taskId:'task',specHash:f.TaskSpec.specHash,sourceRevision:3,sourceEventHash:H,sourceStateDigest:api.hashCanonical(previous),projectOriginalRepoRoot:'/original',historicalRepoRoot:'/original',previousRepoRoot:'/original',repoRoot:'/new',previousCandidateRoot:null,candidateRoot:null,candidateDigest:null,candidateGeneration:null,sourceHead:GIT,sourceTree:GIT,sourceInventoryDigest:H,humanDigest:H,handoffDigest:H,resumeState:previous.state};
 const prefix=`candidates/task/bounded-baselines/${p.sourceStateDigest}/`;
 let boundedBaselineRef,boundedTranscriptRef,rows=[];
 if(bounded){
  let transcript=Buffer.from([JSON.stringify({type:'session',cwd:'/writer'}),JSON.stringify({type:'message',message:{role:'system',sections:{preamble:'<active_agent name="controlled.developer"/>'},toolsAdded:['read','edit','write','structured_output'].map(name=>({name}))}})].join('\n')+'\n');if(transcriptChange)transcript=transcriptChange(transcript);
  const d={schemaVersion:1,kind:'BOUNDED_DEVELOPER_BASELINE',projectId:H,taskId:'task',specHash:f.TaskSpec.specHash,stateRevision:3,stateDigest:p.sourceStateDigest,eventHash:H,assignmentId:'assignment',assignmentHash:f.AssignmentEnvelope.assignmentHash,resultRef:refFor('result',result),terminalProofRef:proof,originalRepoRoot:'/original',originalWorkRoot:'/writer',originalTranscriptPath:'/old/session.jsonl',baselineCommit:GIT,baselineTree:GIT,manifestDigest:H,manifestBytes:100,transcriptDigest:api.hashBytes(transcript),transcriptBytes:transcript.length,previousApprovalId:'gate',previousApprovalHash:canary.digest,sourceCanaryDigest:H};if(descriptorChange)descriptorChange(d);
  p.boundedBaseline={descriptor:d,descriptorRelativePath:prefix+'descriptor.json',transcriptRelativePath:prefix+'transcript.jsonl',workRoot:'/new-machine/writer'};
  boundedBaselineRef=put('baseline-descriptor',d);boundedTranscriptRef=put('baseline-transcript',transcript);
  rows=[[prefix+'descriptor.json',boundedBaselineRef.digest,boundedBaselineRef.bytes],[prefix+'manifest.json',d.manifestDigest,d.manifestBytes],[prefix+'transcript.jsonl',d.transcriptDigest,d.transcriptBytes]].map(([path,digest,bytes])=>({path:'.controlled-dev/'+path,digest,bytes,mode:0o600}));
 }
 const seal={schemaVersion:1,projectId:H,originalRepoRoot:'/original',sourceHead:GIT,sourceTree:GIT,ownerDisposition:'RELEASED_FOR_TRANSFER',taskHeads:[{taskId:'task',specHash:p.specHash,stateRevision:3,stateDigest:p.sourceStateDigest,eventHash:H}],namespaceManifest:rows};if(sealChange)sealChange(seal);
 const handoffRef=put('handoff',seal);p.handoffDigest=handoffRef.digest;
 const request={schemaVersion:1,purpose:'project-runtime-import',subjectKind:'project-runtime-binding',subjectId:'task',subjectRevision:3,action:'APPROVE',confirmationId:'confirmation',payload:p,payloadDigest:api.hashCanonical(p),presentation:{title:'New local owner',content:'Fresh local confirmation'}};
 const receipt={...request,payload:undefined,presentation:undefined,decision:'APPROVE',requestDigest:api.hashCanonical(request),presentationDigest:api.hashCanonical(request.presentation),confirmationInstance:{source:'ctx.ui.custom',sessionId:'new-owner'}};delete receipt.payload;delete receipt.presentation;
 const confirmationRef=put('confirmation',{schemaVersion:1,request,receipt});
 const binding={schemaVersion:1,id:'binding',payload:p,confirmationRef,handoffRef,...(bounded?{boundedBaselineRef,boundedTranscriptRef}:{})};const bindingRef=put('binding',binding,rb.RUNTIME_ROOT_BINDING_MEDIA);
 const next={...previous,revision:4,repoRoot:'/new',runtimeBindingRef:bindingRef,ownerSessionId:'new-owner',invalidEvidenceIds:['gate'],lastEventId:'import'};record('new-state','WorkflowState',next);
 events.push({...f.TransitionEvent,id:'import',revision:4,kind:'RECORD',recordType:'RECONCILED',previousEventHash:H,evidenceRefs:[bindingRef.id,confirmationRef.id,handoffRef.id,...(bounded?[boundedBaselineRef.id,boundedTranscriptRef.id]:[])].filter(id=>id!==omitEvidence)});
 return {p,binding,records,events,bytes,next,previous,read:ref=>{if(!bytes.has(ref.id))throw Error('MISSING');return bytes.get(ref.id)},put};
}
const verify=f=>rb.verifiedRuntimeRootMappings(f.records,f.events,{read:f.read});
test('version2 authentic projection covers sealed baseline and transcript, preserving historical state and deep-freezing mapping',()=>{
 const f=fixture(),saved=structuredClone(f.previous),m=verify(f);assert.equal(m.length,1);assert.deepEqual(f.previous,saved);assert.equal(m[0].payload.boundedBaseline.workRoot,'/new-machine/writer');assert.equal(rb.runtimeRootMappingFor(f.next,m),m[0]);assert.throws(()=>rb.runtimeRootMappingFor(f.next,JSON.parse(JSON.stringify(m))),/BINDING_INVALID/);assert.ok(Object.isFrozen(m[0].payload.boundedBaseline.descriptor.resultRef));
});
test('legacy version1 projection remains accepted and cannot carry version2 fields',()=>{
 const f=fixture({bounded:false});assert.equal(verify(f)[0].payload.schemaVersion,1);assert.throws(()=>rb.checkRuntimeRootBindingPayload({...f.p,boundedBaseline:{}}),/BINDING_INVALID/);assert.throws(()=>rb.checkRuntimeRootBindingPayload({...f.p,schemaVersion:3}),/BINDING_INVALID/);
});
test('version2 rejects candidate, wrong phase, unsafe work root and foreign descriptor/path bindings',()=>{
 for(const change of [p=>p.candidateRoot='/candidate',p=>p.resumeState='TESTING',p=>p.boundedBaseline.workRoot='/new/inside',p=>p.boundedBaseline.workRoot='/new/../writer',p=>p.boundedBaseline.descriptorRelativePath='candidates/foreign/descriptor.json',p=>p.boundedBaseline.descriptor.taskId='foreign',p=>p.boundedBaseline.descriptor.transcriptBytes=16*1024*1024+1,p=>p.boundedBaseline.descriptor.extra=true]){const p=structuredClone(fixture().p);change(p);assert.throws(()=>rb.checkRuntimeRootBindingPayload(p),/BINDING_INVALID/)}
});
test('coherently rehashed descriptor still rejects altered historical workroot, result, terminal and old approval',()=>{
 for(const descriptorChange of [d=>d.originalWorkRoot='/foreign-writer',d=>d.originalTranscriptPath='/different/session',d=>d.assignmentHash=H,d=>d.resultRef.digest=H,d=>d.terminalProofRef.digest=H,d=>d.previousApprovalHash=H,d=>d.sourceCanaryDigest='f'.repeat(64),d=>d.manifestBytes=-1])assert.throws(()=>verify(fixture({descriptorChange})),/BINDING_INVALID/);
});
test('source state with effects, uncertain child, wrong blocker or changed counters cannot become baseline mapping',()=>{
 for(const previousChange of [(s,rs)=>rs.find(r=>r.kind==='DeveloperResult').value.changedFiles=['file.txt'],s=>s.runs[0].status='UNKNOWN',s=>s.blockedReason='Another blocker'])assert.throws(()=>verify(fixture({previousChange})),/BINDING_INVALID/);
 const f=fixture();f.records.find(r=>r.id==='new-state').value.counters={...f.previous.counters,dispatches:1};assert.throws(()=>verify(f),/BINDING_INVALID/);
});
test('sealed descriptor, manifest and transcript rows are mandatory and unique',()=>{
 for(const sealChange of [s=>s.namespaceManifest.pop(),s=>s.namespaceManifest[0].digest=H,s=>s.namespaceManifest[1].bytes++,s=>s.namespaceManifest.push(s.namespaceManifest[0]),s=>s.ownerDisposition='LEASE_HELD_CHECKPOINT'])assert.throws(()=>verify(fixture({sealChange})),/BINDING_INVALID/);
});
test('both bounded refs must be registered, byte-exact and part of reconciliation evidence',()=>{
 for(const omitEvidence of ['baseline-descriptor','baseline-transcript'])assert.throws(()=>verify(fixture({omitEvidence})),/BINDING_INVALID/);
 for(const id of ['baseline-descriptor','baseline-transcript']){const f=fixture();f.records=f.records.filter(r=>r.id!==id);assert.throws(()=>verify(f),/BINDING_INVALID/)}
 const f=fixture();f.bytes.set('baseline-transcript',Buffer.from('changed'));assert.throws(()=>verify(f),/BINDING_INVALID/);
});

test('even coherently sealed transcript rejects edits, wrong identity and contradictory supervisor prompt',()=>{
 const changes=[raw=>Buffer.from(raw.toString().replace('"cwd":"/writer"','"cwd":"/foreign"')),raw=>Buffer.from(raw.toString().replace('<active_agent','Use contact_supervisor first <active_agent')),raw=>Buffer.concat([raw,Buffer.from(JSON.stringify({type:'message',message:{role:'assistant',content:[{type:'toolCall',name:'edit',arguments:{path:'file.txt',oldText:'x',newText:'y'}}]}})+'\n')])];
 for(const transcriptChange of changes)assert.throws(()=>verify(fixture({transcriptChange})),/BINDING_INVALID/);
});

function nextImport(f,{ready=false,foreignPrevious=false,extraSpawn=false}={}){
 let previous=f.next;
 if(ready){previous={...previous,revision:5,state:'READY',lastEventId:'ready'};f.records.push({id:'ready-state',kind:'WorkflowState',value:previous});f.events.push({...f.events.at(-1),id:'ready',revision:5,sourceState:'BLOCKED',targetState:'READY'});}
 if(foreignPrevious)previous.runtimeBindingRef={...previous.runtimeBindingRef,id:'foreign-binding'};
 if(extraSpawn)f.events.push({...f.events.at(-1),id:'foreign-spawn',revision:previous.revision,recordType:'SPAWN_INTENT'});
 const p={...f.p,sourceRevision:previous.revision,sourceStateDigest:api.hashCanonical(previous),sourceEventHash:f.events.at(-1).eventHash,previousRepoRoot:'/new',repoRoot:'/third',resumeState:previous.state};
 const prefix=`candidates/task/bounded-baselines/${p.sourceStateDigest}/`,d={...p.boundedBaseline.descriptor,stateRevision:p.sourceRevision,stateDigest:p.sourceStateDigest,eventHash:p.sourceEventHash,originalRepoRoot:'/new'};
 p.boundedBaseline={descriptor:d,descriptorRelativePath:prefix+'descriptor.json',transcriptRelativePath:prefix+'transcript.jsonl',workRoot:'/third-machine/writer'};
 const boundedBaselineRef=f.put('second-descriptor',d),boundedTranscriptRef=f.put('second-transcript',f.read(f.binding.boundedTranscriptRef));
 const rows=[[prefix+'descriptor.json',boundedBaselineRef.digest,boundedBaselineRef.bytes],[prefix+'manifest.json',d.manifestDigest,d.manifestBytes],[prefix+'transcript.jsonl',d.transcriptDigest,d.transcriptBytes]].map(([path,digest,bytes])=>({path:'.controlled-dev/'+path,digest,bytes,mode:0o600}));
 const handoffRef=f.put('second-handoff',{schemaVersion:1,projectId:H,originalRepoRoot:'/original',sourceHead:GIT,sourceTree:GIT,ownerDisposition:'RELEASED_FOR_TRANSFER',taskHeads:[{taskId:'task',specHash:p.specHash,stateRevision:p.sourceRevision,stateDigest:p.sourceStateDigest,eventHash:p.sourceEventHash}],namespaceManifest:rows});p.handoffDigest=handoffRef.digest;
 const request={schemaVersion:1,purpose:'project-runtime-import',subjectKind:'project-runtime-binding',subjectId:'task',subjectRevision:p.sourceRevision,action:'APPROVE',confirmationId:'fresh-second',payload:p,payloadDigest:api.hashCanonical(p),presentation:{title:'Second new local owner',content:'Separate fresh confirmation'}};
 const receipt={schemaVersion:1,purpose:request.purpose,subjectKind:request.subjectKind,subjectId:'task',subjectRevision:p.sourceRevision,action:'APPROVE',decision:'APPROVE',confirmationId:'fresh-second',requestDigest:api.hashCanonical(request),payloadDigest:request.payloadDigest,presentationDigest:api.hashCanonical(request.presentation),confirmationInstance:{source:'ctx.ui.custom',sessionId:'third-owner'}};
 const confirmationRef=f.put('second-confirmation',{schemaVersion:1,request,receipt}),binding={schemaVersion:1,id:'second-binding',payload:p,confirmationRef,handoffRef,boundedBaselineRef,boundedTranscriptRef},bindingRef=f.put('second-binding',binding,rb.RUNTIME_ROOT_BINDING_MEDIA);
 f.records.push({id:'third-state',kind:'WorkflowState',value:{...previous,revision:p.sourceRevision+1,repoRoot:'/third',runtimeBindingRef:bindingRef,ownerSessionId:'third-owner'}});
 f.events.push({...f.events.at(-1),id:'second-import',revision:p.sourceRevision+1,kind:'RECORD',recordType:'RECONCILED',previousEventHash:p.sourceEventHash,evidenceRefs:[bindingRef.id,confirmationRef.id,handoffRef.id,boundedBaselineRef.id,boundedTranscriptRef.id]});return f;
}
test('successive transfer retains raw assignment/run paths through a previous authentic mapping and another fresh decision',()=>{
 for(const ready of [false,true]){const f=nextImport(fixture(),{ready}),rawRun=structuredClone(f.previous.runs),m=verify(f);assert.equal(m.length,2);assert.equal(m[1].payload.repoRoot,'/third');assert.equal(m[1].payload.boundedBaseline.descriptor.originalWorkRoot,'/writer');assert.deepEqual(f.records.find(r=>r.id==='third-state').value.runs,rawRun);}
 for(const options of [{foreignPrevious:true},{extraSpawn:true}])assert.throws(()=>verify(nextImport(fixture(),options)),/BINDING_INVALID/);
 const f=nextImport(fixture());f.records=f.records.filter(r=>r.id!=='binding');assert.throws(()=>verify(f),/BINDING_INVALID/);
});
