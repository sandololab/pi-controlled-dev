import { lstatSync, readFileSync, readlinkSync, realpathSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { canonicalize, hashBytes, hashCanonical, validateContract } from './contracts.js';
import type { AssignmentEnvelope } from './contracts.js';
import { DurableStore } from './store.js';
import { currentProcessIncarnation, inspectProcessOwner } from './process-incarnation.js';
import type { ReviewerNoDispatchProof, LegacyReviewerPreflightEvidence } from './run-quiescence.js';
/** Narrow migration of this frozen faulty protocol, never inference from missing logs or process IDs. */
export const LEGACY_REVIEWER_PROTOCOL=Object.freeze({
 reviewerSourceHash:'e9faec2bde26eaf07c7716ab2cd6931ded74162e7f85e410d7cfda0bb84d54ee',
 rpcSourceHash:'5302821f1af0a55c12e19ffa1c28f87dc04c3f23829ea367b60cc2b6eb3b1827',
 installedPackageDigest:'46ffc4b1979b124665d41dc7646589ee780bb04754279b656aa973d1f568c76f',
 bridgeSourceHash:'f2dfaf9e32f7aa4ae7a7c24571b6df6500bf2207dffcd96f64af929ce4b8da01',requestLimit:262144});
export interface LegacyReviewerHostInput {readonly storeRoot:string;readonly installedRoot:string;readonly bridgePath:string;
 readonly originalHostPid:number;readonly sessionFile:string;readonly terminalEventsPath:string}
const receipts=new WeakSet<object>();
export function isAcquiredLegacyReviewerProof(proof:ReviewerNoDispatchProof):boolean{return receipts.has(proof)}
function fail():never{throw new Error('LEGACY_REVIEWER_NO_DISPATCH_UNPROVEN')}
function file(path:string,max:number){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>max||realpathSync(path)!==path)fail();return {stat,bytes:readFileSync(path)}}
function processInfo(pid:number){const raw=readFileSync(`/proc/${pid}/stat`).toString('utf8'),end=raw.lastIndexOf(')'),parts=raw.slice(end+2).split(' ');
 return {parentPid:Number(parts[1]),startTicks:parts[19],cwd:readlinkSync(`/proc/${pid}/cwd`),cmdline:readFileSync(`/proc/${pid}/cmdline`).toString('utf8').split('\0').filter(Boolean)}}
/** Trusted host read-only capture. The live original launcher must still exist; no caller-supplied attestation is accepted. */
export function acquireLegacyReviewerNoDispatchProof(input:LegacyReviewerHostInput):ReviewerNoDispatchProof{
 let stage='ledger';
 try{
  const ledger=DurableStore.load(input.storeRoot),state=ledger.state,run=state.runs.findLast(r=>r.role==='Reviewer'),candidate=state.candidate;
  if(state.state!=='BLOCKED'||state.blockedReason!=='Reviewer batch failed'||!candidate||!run||run.status!=='UNKNOWN'||run.runId||run.childSessionId||run.resultRef||run.terminalProofRef||run.dispatchProofRef||run.requestId!==`intent-${run.attemptId}`)fail();
  const record=ledger.records.find(r=>r.kind==='AssignmentEnvelope'&&r.value.assignmentId===run.assignmentId);
  if(record?.kind!=='AssignmentEnvelope')fail();const a=record.value as AssignmentEnvelope;
  if(a.role!=='Reviewer'||a.specHash!==state.specHash||a.taskId!==state.taskId||a.attemptId!==run.attemptId||a.repoRoot!==state.repoRoot||a.workRoot!==candidate.root||a.candidateDigest!==candidate.digest||a.candidateGeneration!==candidate.generation)fail();
  stage='manifest';const manifestBytes=DurableStore.readArtifact(input.storeRoot,candidate.manifest),manifest=JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
  if(!validateContract('CandidateManifest',manifest).ok||hashCanonical(manifest)!==candidate.digest||manifest.baseCommit!==a.baseCommit||Buffer.byteLength(canonicalize(manifest),'utf8')<=LEGACY_REVIEWER_PROTOCOL.requestLimit)fail();
  stage='original-process';const original=processInfo(input.originalHostPid),parent=processInfo(original.parentPid),domain=currentProcessIncarnation();
  if(!domain||original.cwd!==a.repoRoot||parent.cwd!==a.repoRoot||original.cmdline[0]!=='pi'||parent.cmdline.length!==2||resolve(parent.cmdline[1])!==input.bridgePath)fail();
  stage='original-launcher-code';const bridge=file(input.bridgePath,65536);if(hashBytes(bridge.bytes)!==LEGACY_REVIEWER_PROTOCOL.bridgeSourceHash)fail();
  const root=dirname(input.bridgePath),expectedRoot=join(root,'installed-v13','node_modules','pi-controlled-dev');
  if(input.installedRoot!==expectedRoot||input.terminalEventsPath!==join(root,'artifacts','terminal-events.jsonl'))fail();
  stage='launch-events';const events=file(input.terminalEventsPath,32*1024*1024).bytes.toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
  const starts=events.filter(e=>e.kind==='start'&&e.pid===input.originalHostPid);if(starts.length!==1)fail();const start=starts[0],started=Date.parse(start.timestamp);
  if(!Number.isFinite(started)||start.model!=='openai-codex/gpt-6.1-sol'||start.thinking!=='medium')fail();
  stage='installed-code';
  const catalog=file(join(root,'artifacts','package-v13-source-verification.json'),65536);
  if(hashBytes(catalog.bytes)!==LEGACY_REVIEWER_PROTOCOL.installedPackageDigest||catalog.stat.mtimeMs>started||catalog.stat.ctimeMs>started)fail();
  const verification=JSON.parse(catalog.bytes.toString('utf8'));
  if(verification.files?.length!==98||Date.parse(verification.timestamp)>started)fail();
  for(const entry of verification.files){const source=file(join(input.installedRoot,entry.path),32*1024*1024);if(entry.match!==true||hashBytes(source.bytes)!==entry.sha256||source.stat.mtimeMs>started||source.stat.ctimeMs>started)fail();}

  for(const [name,hash] of [['controlled-reviewer.ts',LEGACY_REVIEWER_PROTOCOL.reviewerSourceHash],['pi-subagents-rpc.ts',LEGACY_REVIEWER_PROTOCOL.rpcSourceHash]] as const){
    const path=join(input.installedRoot,'src',name),source=file(path,512*1024);
    if(hashBytes(source.bytes)!==hash||source.stat.mtimeMs>started||source.stat.ctimeMs>started)fail();
  }
  if(bridge.stat.mtimeMs>started||bridge.stat.ctimeMs>started)fail();
  const descriptors=readdirSync(`/proc/${original.parentPid}/fd`).flatMap(fd=>{try{return [readlinkSync(`/proc/${original.parentPid}/fd/${fd}`)]}catch{return []}});
  if(!descriptors.includes(input.terminalEventsPath)||!descriptors.includes(join(root,'artifacts',start.run+'-terminal.raw')))fail();
  stage='original-owner-session';const session=file(input.sessionFile,64*1024*1024).bytes.toString('utf8').split('\n')[0],header=JSON.parse(session);
  if(header.type!=='session'||header.id!==state.ownerSessionId||header.id!==run.ownerSessionId||header.cwd!==a.repoRoot||Date.parse(header.timestamp)<started||Date.parse(header.timestamp)-started>2000)fail();
  const nearby=readdirSync(dirname(input.sessionFile)).filter(name=>name.endsWith('.jsonl')).flatMap(name=>{
    try{const h=JSON.parse(readFileSync(join(dirname(input.sessionFile),name)).toString('utf8').split('\n')[0]);return h.cwd===a.repoRoot&&Math.abs(Date.parse(h.timestamp)-started)<=2000?[h.id]:[]}catch{return []}});
  if(nearby.length!==1||nearby[0]!==header.id)fail();
  stage='original-owner-locks';const incarnation={...domain,pid:input.originalHostPid,startTicks:original.startTicks};
  const dataRoot=input.storeRoot.split('/controlled-dev/projects/')[0],workspaceHash=hashBytes(Buffer.from(a.repoRoot));
  if(!input.storeRoot.startsWith(dataRoot+'/controlled-dev/projects/')||!dirname(input.sessionFile).startsWith(dataRoot+'/sessions/')||!input.sessionFile.endsWith('_'+state.ownerSessionId+'.jsonl'))fail();
  const lockRoot=join(dataRoot,'controlled-dev','locks'),locks=[join(lockRoot,'tasks',hashBytes(Buffer.from(workspaceHash+'\0'+state.taskId))+'.lock'),join(lockRoot,'workspaces',workspaceHash+'.lock')].map(path=>JSON.parse(file(path,16384).bytes.toString('utf8')));
  if(locks.some(l=>l.schemaVersion!==2||l.workspaceHash!==workspaceHash||l.ownerSessionId!==state.ownerSessionId||canonicalize(l.processIncarnation)!==canonicalize(incarnation))||locks[0].kind!=='TASK'||locks[0].taskId!==state.taskId||locks[1].kind!=='WORKSPACE')fail();

  if(inspectProcessOwner(incarnation).status!=='LIVE'||processInfo(input.originalHostPid).parentPid!==original.parentPid||processInfo(original.parentPid).startTicks!==parent.startTicks)fail();
  const evidence:LegacyReviewerPreflightEvidence={schemaVersion:1,method:'FROZEN_FULL_MANIFEST_REQUEST_LIMIT',...LEGACY_REVIEWER_PROTOCOL,
    manifestRef:Object.freeze({...candidate.manifest}),manifestByteLowerBound:Buffer.byteLength(canonicalize(manifest),'utf8'),originalHost:Object.freeze({...incarnation}),
    originalLocksHash:hashCanonical(locks),originalParentPid:original.parentPid,originalParentStartTicks:parent.startTicks,originalSessionHeaderHash:hashBytes(Buffer.from(session)),
    installedRoot:input.installedRoot,bridgePath:input.bridgePath,launchStartedAt:new Date(started).toISOString(),ledgerRevision:state.revision,ledgerEventHash:ledger.events.at(-1)!.eventHash};
  const proof:ReviewerNoDispatchProof=Object.freeze({schemaVersion:1,source:'reviewer-host-before-spawn',taskId:a.taskId,specHash:a.specHash,
    assignmentId:a.assignmentId,assignmentHash:a.assignmentHash,attemptId:a.attemptId,ownerSessionId:run.ownerSessionId,runtimeGeneration:'legacy-v13-full-manifest',
    launchContractHash:a.launchContractHash,candidateDigest:a.candidateDigest!,candidateGeneration:a.candidateGeneration!,code:'TASK_REQUEST_LIMIT',observedAt:new Date().toISOString(),legacyProtocol:Object.freeze(evidence)});
  receipts.add(proof);return proof;
 }catch(error){throw Object.assign(new Error('LEGACY_REVIEWER_NO_DISPATCH_UNPROVEN'),{diagnosticStage:stage,detail:error instanceof Error?error.message:'unverifiable'})}
}
