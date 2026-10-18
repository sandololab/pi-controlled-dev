import {closeSync,existsSync,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {Buffer} from 'node:buffer';
import {execFileSync} from 'node:child_process';
import {canonicalize,hashBytes,hashCanonical,hashContract,parseJson,validateContract,validateScalar,validateStructure} from './contracts.js';
import type {ArtifactRef,AssignmentEnvelope,CandidateManifest,DeveloperResult,TaskSpec} from './contracts.js';
import {DurableStore} from './store.js';
import type {ArtifactInspection,StoredLedger} from './store.js';
import {boundedDeveloperRecoveryData} from './recovery-resume.js';
import {resolveProjectStorage,assertProjectStoragePath,projectCustodianRoot} from './project-storage.js';
import {readProjectHandoffForRuntimeImport} from './project-handoff.js';
import {LockManager} from './lock-manager.js';
import type {LockHandle} from './lock-manager.js';
import {runQuiescent} from './run-quiescence.js';
import {verifyTerminalProof} from './pi-subagents-rpc.js';
import {CONTROLLED_DEVELOPER_NAME,DEVELOPER_LAUNCH_CONTRACT_HASH} from './controlled-developer.js';
import {verifyTranscript} from './controlled-agent-runtime.js';
import {ScopeGuard,workspaceManifest} from './scope-guard.js';
import {CandidateGit} from './candidate-git.js';
import {hostGitEnvironment} from './host-git-policy.js';
import {verifiedRuntimeRootMappings,runtimeRootMatches} from './runtime-root-binding.js';

/** A clean baseline and terminal evidence, never a Candidate or writer approval. */
export interface BoundedDeveloperCheckpointDescriptor {
 readonly schemaVersion:1;readonly kind:'BOUNDED_DEVELOPER_BASELINE';readonly projectId:string;readonly taskId:string;readonly specHash:string;
 readonly stateRevision:number;readonly stateDigest:string;readonly eventHash:string;
 readonly assignmentId:string;readonly assignmentHash:string;readonly resultRef:ArtifactRef;readonly terminalProofRef:ArtifactRef;
 readonly originalRepoRoot:string;readonly originalWorkRoot:string;readonly originalTranscriptPath:string;
 readonly baselineCommit:string;readonly baselineTree:string;readonly manifestDigest:string;readonly manifestBytes:number;
 readonly transcriptDigest:string;readonly transcriptBytes:number;
 readonly previousApprovalId:string;readonly previousApprovalHash:string;readonly sourceCanaryDigest:string;
}
export interface VerifiedBoundedDeveloperCheckpoint {
 readonly descriptor:BoundedDeveloperCheckpointDescriptor;readonly descriptorDigest:string;
 readonly descriptorRelativePath:string;readonly transcriptRelativePath:string;readonly manifest:CandidateManifest;
}
interface Acquired {repoRoot:string;taskRoot:string;machineDataRoot:string;ledger:StoredLedger;descriptor:BoundedDeveloperCheckpointDescriptor;manifest:CandidateManifest;transcript:Uint8Array;sealed:boolean}
interface LeaseOptions {readonly manager:LockManager;readonly workspaceLock:LockHandle}
const acquired=new WeakMap<object,Acquired>();
const MAX_MANIFEST=64*1024*1024,MAX_TRANSCRIPT=16*1024*1024;
export class BoundedDeveloperCheckpointError extends Error {constructor(readonly code:string){super(code)}}
function fail(code:string):never{throw new BoundedDeveloperCheckpointError(code)}
const same=(a:unknown,b:unknown)=>canonicalize(a)===canonicalize(b);
const copy=<T>(value:T):T=>JSON.parse(canonicalize(value)) as T;
function directory(path:string):void{const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(path)!==path)fail('BOUNDED_CHECKPOINT_PATH_INVALID')}
function ancestors(path:string):string[]{const rows:string[]=[];for(let p=dirname(path);;p=dirname(p)){
 const s=lstatSync(p,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(p)!==p)fail('BOUNDED_CHECKPOINT_PATH_INVALID');
 rows.push(`${p}:${s.dev}:${s.ino}:${s.mode}:${s.birthtimeNs}`);if(p===dirname(p))break;
 }return rows;}
function regular(path:string,max:number):Uint8Array{
 const parents=ancestors(path),s=lstatSync(path,{bigint:true}),identity=(v:typeof s)=>[v.dev,v.ino,v.mode,v.nlink,v.size,v.birthtimeNs,v.ctimeNs,v.mtimeNs].join(':');
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||s.size>BigInt(max)||realpathSync(path)!==path)fail('BOUNDED_CHECKPOINT_FILE_INVALID');
 const fd=openSync(path,'r');try{
  if(identity(fstatSync(fd,{bigint:true}))!==identity(s))fail('BOUNDED_CHECKPOINT_CHANGED');
  const raw=new Uint8Array(Number(s.size));let offset=0;while(offset<raw.byteLength){const n=readSync(fd,raw,offset,raw.byteLength-offset,offset);if(!n)fail('BOUNDED_CHECKPOINT_CHANGED');offset+=n;}
  if(identity(fstatSync(fd,{bigint:true}))!==identity(s)||identity(lstatSync(path,{bigint:true}))!==identity(s)||realpathSync(path)!==path||!same(ancestors(path),parents))fail('BOUNDED_CHECKPOINT_CHANGED');
  return raw;
 }finally{closeSync(fd)}
}
function git(repo:string,args:readonly string[]):string{return execFileSync('git',['--no-optional-locks','-C',repo,'-c','core.fsmonitor=false',...args],{encoding:'utf8',env:hostGitEnvironment(),timeout:30000,maxBuffer:1024*1024}).trim()}
function lease(repoRoot:string,options:LeaseOptions):void{if(!options?.manager||!options.workspaceLock||!options.manager.verifyWorkspaceLock(options.workspaceLock)
 ||options.workspaceLock.record.workspaceHash!==options.manager.workspaceIdentity(repoRoot).workspaceHash)fail('BOUNDED_CHECKPOINT_LEASE_REQUIRED')}
function location(repoRoot:string,taskRoot:string,machineDataRoot:string){const context=resolveProjectStorage(machineDataRoot,repoRoot);
 if(!context.custodian||!projectCustodianRoot(repoRoot))fail('BOUNDED_CHECKPOINT_CUSTODIAN_REQUIRED');
 const ledger=DurableStore.load(taskRoot);if(!validateScalar('ID',ledger.state.taskId).ok||taskRoot!==join(context.projectRoot,'tasks',ledger.state.taskId))fail('BOUNDED_CHECKPOINT_TASK_INVALID');
 assertProjectStoragePath(context,taskRoot);return {context,ledger};
}
function folder(repoRoot:string,d:Pick<BoundedDeveloperCheckpointDescriptor,'taskId'|'stateDigest'>):string{
 if(!validateScalar('ID',d.taskId).ok||!validateScalar('Hash',d.stateDigest).ok)fail('BOUNDED_CHECKPOINT_DESCRIPTOR_INVALID');
 return join(repoRoot,'.controlled-dev','candidates',d.taskId,'bounded-baselines',d.stateDigest);
}
function paths(repoRoot:string,d:BoundedDeveloperCheckpointDescriptor){const base=folder(repoRoot,d),prefix=`candidates/${d.taskId}/bounded-baselines/${d.stateDigest}`;
 return {base,descriptor:join(base,'descriptor.json'),manifest:join(base,'manifest.json'),transcript:join(base,'transcript.jsonl'),descriptorRelativePath:`${prefix}/descriptor.json`,transcriptRelativePath:`${prefix}/transcript.jsonl`};}
function value(c:Acquired):VerifiedBoundedDeveloperCheckpoint {const p=paths(c.repoRoot,c.descriptor),v=Object.freeze({descriptor:Object.freeze(copy(c.descriptor)),descriptorDigest:hashCanonical(c.descriptor),descriptorRelativePath:p.descriptorRelativePath,transcriptRelativePath:p.transcriptRelativePath,manifest:copy(c.manifest)});acquired.set(v,c);return v;}
function make(root:string,path:string):void{if(path===root){directory(root);return}make(root,dirname(path));if(!existsSync(path))mkdirSync(path,{mode:0o700});directory(path)}
function put(path:string,raw:Uint8Array):void{
 if(existsSync(path)){if(!same(hashBytes(regular(path,MAX_MANIFEST)),hashBytes(raw)))fail('BOUNDED_CHECKPOINT_COLLISION');return}
 // Exclusive publication never replaces operator files. A partial file after a crash
 // is rejected; no release seal is published until all three files verify exactly.
 const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,raw);fsyncSync(fd)}finally{closeSync(fd)}
 const dir=openSync(dirname(path),'r');try{fsyncSync(dir)}finally{closeSync(dir)}
}
function ref(ledger:StoredLedger,id:string):ArtifactRef{const r=ledger.records.find(r=>r.id===id);if(!r||ledger.state.invalidEvidenceIds.includes(id))fail('BOUNDED_CHECKPOINT_EVIDENCE_INVALID');
 return r.kind==='ArtifactRef'?r.value:{schemaVersion:1,id,digest:hashCanonical(r.value),bytes:Buffer.byteLength(canonicalize(r.value),'utf8'),relativeStorePath:`artifacts/${id}`,mediaType:'application/json'};}
function historical(c:Acquired):void{
 const {ledger:l,descriptor:d}=c,s=l.state,run=s.runs.at(-1),records=[...l.records,{id:'bounded-checkpoint-state',kind:'WorkflowState' as const,value:s}],reader={read:(r:ArtifactRef)=>DurableStore.readArtifact(c.taskRoot,r)};
 const runtimeRootMappings=s.runtimeBindingRef?verifiedRuntimeRootMappings(records,l.events,reader):undefined;
 const context={records,specId:s.spec.id,stateId:'bounded-checkpoint-state',assignmentId:d.assignmentId,modelExtracted:false,...(runtimeRootMappings?{runtimeRootMappings}:{})};
 if(l.truncatedTailBytes||!['BLOCKED','AWAITING_HUMAN','READY'].includes(s.state)||s.blockedReason!=='Developer reported a bounded blocker'||s.candidate||s.repoRoot!==d.originalRepoRoot
  ||s.specHash!==d.specHash||s.taskId!==d.taskId||s.revision!==d.stateRevision||hashCanonical(s)!==d.stateDigest||l.events.at(-1)?.eventHash!==d.eventHash
  ||!run||run.role!=='Developer'||run.assignmentId!==d.assignmentId||run.resultRef!==d.resultRef.id||run.terminalProofRef!==d.terminalProofRef.id||run.childSessionId!==d.originalTranscriptPath
  ||s.runs.some(r=>!runQuiescent(r)||r.status!=='TERMINAL'))fail('BOUNDED_CHECKPOINT_HISTORY_INVALID');
 const spec=l.records.find(r=>r.kind==='TaskSpec'&&r.id===s.spec.id)?.value as TaskSpec|undefined;
 const a=l.records.find(r=>r.kind==='AssignmentEnvelope'&&r.id===d.assignmentId)?.value as AssignmentEnvelope|undefined;
 const result=l.records.find(r=>r.kind==='DeveloperResult'&&r.id===d.resultRef.id)?.value as DeveloperResult|undefined;
 if(!spec||!a||!result||!validateContract('TaskSpec',spec,context).ok||hashContract('TaskSpec',spec)!==d.specHash||!validateContract('AssignmentEnvelope',a,context).ok
  ||a.assignmentHash!==d.assignmentHash||hashContract('AssignmentEnvelope',a)!==d.assignmentHash||a.workRoot!==d.originalWorkRoot||!runtimeRootMatches(a.repoRoot,d.originalRepoRoot,s,runtimeRootMappings)
  ||a.baseCommit!==d.baselineCommit||a.launchContractHash!==DEVELOPER_LAUNCH_CONTRACT_HASH||a.candidateDigest!==undefined||a.candidateGeneration!==undefined
  ||!same(a.authority,['OP-01','OP-02'])||!validateContract('DeveloperResult',result,context).ok||!result.blockedReason||result.changedFiles.length||result.commandsRun.length
  ||!s.results.includes(d.resultRef.id)||!same(ref(l,d.resultRef.id),d.resultRef)||!same(ref(l,d.terminalProofRef.id),d.terminalProofRef))fail('BOUNDED_CHECKPOINT_HISTORY_INVALID');
 const read=(r:ArtifactRef)=>DurableStore.readArtifact(c.taskRoot,r);
 for(const prior of s.runs){if(!prior.runId||!prior.childSessionId||!prior.terminalProofRef||prior.requestId.startsWith('intent-'))fail('BOUNDED_CHECKPOINT_HISTORY_INVALID');
  const terminal=parseJson(read(ref(l,prior.terminalProofRef)),MAX_TRANSCRIPT);
  if(!verifyTerminalProof(terminal,{runId:prior.runId,requestId:prior.requestId,role:prior.role,ownerSessionId:prior.ownerSessionId,childSessionId:prior.childSessionId})
   ||prior===run&&(terminal as {terminalStatus?:string}).terminalStatus!=='complete')fail('BOUNDED_CHECKPOINT_HISTORY_INVALID');
 }
 const gate=l.records.find(r=>r.kind==='HumanGate'&&r.id===d.previousApprovalId);
 if(gate?.kind!=='HumanGate'||gate.value.status!=='CONSUMED'||gate.value.approvedDataHash!==d.previousApprovalHash)fail('BOUNDED_CHECKPOINT_HISTORY_INVALID');
 const approved=parseJson(read(gate.value.approvedData),MAX_MANIFEST) as {specHash?:string;baselineCommit?:string;originalTreeHash?:string};
 if(approved.specHash!==d.specHash||approved.baselineCommit!==d.baselineCommit||approved.originalTreeHash!==d.sourceCanaryDigest)fail('BOUNDED_CHECKPOINT_HISTORY_INVALID');
 if(!validateStructure('CandidateManifest',c.manifest).ok||c.manifest.baseCommit!==d.baselineCommit||hashCanonical(c.manifest)!==d.manifestDigest
  ||hashBytes(c.transcript)!==d.transcriptDigest||c.transcript.byteLength!==d.transcriptBytes)fail('BOUNDED_CHECKPOINT_PAYLOAD_INVALID');
 if(git(c.repoRoot,['rev-parse','HEAD'])!==d.baselineCommit||git(c.repoRoot,['rev-parse',`${d.baselineCommit}^{tree}`])!==d.baselineTree)fail('BOUNDED_CHECKPOINT_GIT_CHANGED');
}
/** Automatic host persistence at the verified terminal/no-effects boundary. No new permit. */
export function captureBoundedDeveloperCheckpoint(repoRoot:string,taskRoot:string,machineDataRoot:string,options:LeaseOptions & {readonly inspect:ArtifactInspection}):VerifiedBoundedDeveloperCheckpoint{
 lease(repoRoot,options);if(typeof options.inspect!=='function')fail('BOUNDED_CHECKPOINT_INSPECTION_REQUIRED');
 const {context,ledger}=location(repoRoot,taskRoot,machineDataRoot),reader={agentDataRoot:machineDataRoot,read:(r:ArtifactRef)=>DurableStore.readArtifact(taskRoot,r)};
 const proof=boundedDeveloperRecoveryData(ledger,reader),manifest=workspaceManifest(proof.workRoot,proof.baselineCommit),manifestRaw=Buffer.from(canonicalize(manifest));
 const run=ledger.state.runs.at(-1)!,assignment=ledger.records.find(r=>r.id===run.assignmentId&&r.kind==='AssignmentEnvelope')?.value as AssignmentEnvelope;
 const transcript=proof.transcriptArtifactRef?DurableStore.readArtifact(taskRoot,proof.transcriptArtifactRef):regular(run.childSessionId!,MAX_TRANSCRIPT);
 if(manifestRaw.byteLength>MAX_MANIFEST||hashBytes(transcript)!==proof.transcriptDigest||options.inspect(transcript,'application/vnd.pi-controlled-dev.terminal-transcript+jsonl')!=='ACCEPT')fail('BOUNDED_CHECKPOINT_PAYLOAD_INVALID');
 const descriptor:BoundedDeveloperCheckpointDescriptor={schemaVersion:1,kind:'BOUNDED_DEVELOPER_BASELINE',projectId:context.projectId,taskId:ledger.state.taskId,specHash:ledger.state.specHash,
  stateRevision:ledger.state.revision,stateDigest:hashCanonical(ledger.state),eventHash:ledger.events.at(-1)!.eventHash,assignmentId:proof.assignmentId,assignmentHash:proof.assignmentHash,
  resultRef:proof.resultRef,terminalProofRef:proof.terminalProofRef,originalRepoRoot:repoRoot,originalWorkRoot:assignment.workRoot,originalTranscriptPath:run.childSessionId!,
  baselineCommit:proof.baselineCommit,baselineTree:git(repoRoot,['rev-parse',`${proof.baselineCommit}^{tree}`]),manifestDigest:hashCanonical(manifest),manifestBytes:manifestRaw.byteLength,
  transcriptDigest:proof.transcriptDigest,transcriptBytes:transcript.byteLength,previousApprovalId:proof.previousApprovalId,previousApprovalHash:proof.previousApprovalHash,sourceCanaryDigest:proof.historicalSourceCanaryDigest??proof.originalTreeHash};
 const c:Acquired={repoRoot,taskRoot,machineDataRoot,ledger,descriptor,manifest,transcript,sealed:false};historical(c);
 const fresh=()=>{lease(repoRoot,options);if(!same(boundedDeveloperRecoveryData(DurableStore.load(taskRoot),reader),proof))fail('BOUNDED_CHECKPOINT_CHANGED')};fresh();
 const p=paths(repoRoot,descriptor);make(join(repoRoot,'.controlled-dev'),p.base);
 put(p.manifest,manifestRaw);fresh();put(p.transcript,transcript);fresh();put(p.descriptor,Buffer.from(canonicalize(descriptor)));fresh();
 if(hashBytes(regular(p.manifest,MAX_MANIFEST))!==descriptor.manifestDigest||hashBytes(regular(p.transcript,MAX_TRANSCRIPT))!==descriptor.transcriptDigest
  ||hashBytes(regular(p.descriptor,32768))!==hashCanonical(descriptor))fail('BOUNDED_CHECKPOINT_CHANGED');
 return value(c);
}
/** Discovery requires the exact current released seal, including the baseline files. */
export function readBoundedDeveloperCheckpoint(repoRoot:string,taskRoot:string,machineDataRoot:string):VerifiedBoundedDeveloperCheckpoint|undefined{
 const {context,ledger}=location(repoRoot,taskRoot,machineDataRoot),base=folder(repoRoot,{taskId:ledger.state.taskId,stateDigest:hashCanonical(ledger.state)}),path=join(base,'descriptor.json');
 const release=readProjectHandoffForRuntimeImport(repoRoot)?.record;
 if(!release||release.ownerDisposition!=='RELEASED_FOR_TRANSFER')fail('BOUNDED_CHECKPOINT_RELEASE_REQUIRED');
 if(!existsSync(path))return undefined;
 const raw=regular(path,32768),d=parseJson(raw,32768) as unknown as BoundedDeveloperCheckpointDescriptor;
 const keys='assignmentHash,assignmentId,baselineCommit,baselineTree,eventHash,kind,manifestBytes,manifestDigest,originalRepoRoot,originalTranscriptPath,originalWorkRoot,previousApprovalHash,previousApprovalId,projectId,resultRef,schemaVersion,sourceCanaryDigest,specHash,stateDigest,stateRevision,taskId,terminalProofRef,transcriptBytes,transcriptDigest';
 if(!d||Object.keys(d).sort().join(',')!==keys||d.schemaVersion!==1||d.kind!=='BOUNDED_DEVELOPER_BASELINE'||d.projectId!==context.projectId
  ||d.taskId!==ledger.state.taskId||d.stateDigest!==hashCanonical(ledger.state)||Buffer.from(raw).toString('utf8')!==canonicalize(d)
  ||![d.specHash,d.assignmentHash,d.manifestDigest,d.transcriptDigest,d.previousApprovalHash,d.sourceCanaryDigest].every(v=>validateScalar('Hash',v).ok)
  ||![d.baselineCommit,d.baselineTree].every(v=>validateScalar('GitOID',v).ok)||![d.originalRepoRoot,d.originalWorkRoot,d.originalTranscriptPath].every(v=>validateScalar('Root',v).ok)
  ||!Number.isSafeInteger(d.manifestBytes)||d.manifestBytes<0||d.manifestBytes>MAX_MANIFEST||!Number.isSafeInteger(d.transcriptBytes)||d.transcriptBytes<0||d.transcriptBytes>MAX_TRANSCRIPT)fail('BOUNDED_CHECKPOINT_DESCRIPTOR_INVALID');
 const p=paths(repoRoot,d),manifestRaw=regular(p.manifest,MAX_MANIFEST),transcript=regular(p.transcript,MAX_TRANSCRIPT);
 for(const [relative,bytes,digest] of [[p.descriptorRelativePath,raw.byteLength,hashBytes(raw)],[`${p.descriptorRelativePath.slice(0,-15)}manifest.json`,manifestRaw.byteLength,hashBytes(manifestRaw)],[p.transcriptRelativePath,transcript.byteLength,hashBytes(transcript)]] as const){
  if(!release.namespaceManifest.some(f=>f.path===`.controlled-dev/${relative}`&&f.bytes===bytes&&f.digest===digest))fail('BOUNDED_CHECKPOINT_SEAL_MISMATCH');
 }
 if(manifestRaw.byteLength!==d.manifestBytes||hashBytes(manifestRaw)!==d.manifestDigest)fail('BOUNDED_CHECKPOINT_PAYLOAD_INVALID');
 verifyTranscript(p.transcript,d.originalWorkRoot,CONTROLLED_DEVELOPER_NAME,['read','edit','write','structured_output'],['read','structured_output']);
 const c:Acquired={repoRoot,taskRoot,machineDataRoot,ledger,descriptor:d,manifest:parseJson(manifestRaw,MAX_MANIFEST) as unknown as CandidateManifest,transcript,sealed:true};historical(c);
 return value(c);
}
/** Host IO sink inside the existing authenticated import flow. Materialization is data,
 * not admission: the caller must consume the native exact-projection receipt first,
 * and the central orchestrator must obtain a new bounded writer gate afterwards. */
export function materializeBoundedDeveloperCheckpoint(checkpoint:VerifiedBoundedDeveloperCheckpoint,workRoot:string,options:LeaseOptions & {readonly assertAuthorized:()=>void}):void{
 const c=acquired.get(checkpoint);if(!c||!c.sealed||typeof options?.assertAuthorized!=='function')fail('BOUNDED_CHECKPOINT_CAPABILITY_INVALID');
 const fresh=()=>{lease(c.repoRoot,options);options.assertAuthorized();const current=readBoundedDeveloperCheckpoint(c.repoRoot,c.taskRoot,c.machineDataRoot);
  if(!current||current.descriptorDigest!==checkpoint.descriptorDigest)fail('BOUNDED_CHECKPOINT_CHANGED')};fresh();
 const git=new CandidateGit(c.repoRoot,c.machineDataRoot);git.detached(workRoot,c.descriptor.baselineCommit);
 if(hashCanonical(workspaceManifest(workRoot,c.descriptor.baselineCommit))!==c.descriptor.manifestDigest)fail('BOUNDED_CHECKPOINT_GIT_CHANGED');
 const spec=c.ledger.records.find(r=>r.kind==='TaskSpec'&&r.id===c.ledger.state.spec.id)?.value as TaskSpec;
 const guard=ScopeGuard.open({...spec.scope,repoRoot:c.repoRoot},workRoot,c.descriptor.baselineCommit,0);
 if(hashCanonical(guard.baselineManifest())!==c.descriptor.manifestDigest)fail('BOUNDED_CHECKPOINT_GIT_CHANGED');fresh();
}
