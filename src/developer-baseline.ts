import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize, hashBytes, hashCanonical, hashContract, validateStructure } from './contracts.js';
import type { ArtifactRef, AssignmentEnvelope, ContextRecord, TaskSpec, ValidationResult, WorkflowState } from './contracts.js';
import type { DurableStore } from './store.js';
import { inventoryHash, inventoryTree } from './controlled-agent-runtime.js';
import { workspaceManifest } from './scope-guard.js';
import { collectValidationEvidence } from './validation-runner.js';
import { hostValidationRecipeName } from './validation-proposals.js';

const acquired=new WeakMap<object,{readonly commandsHash:string;readonly reader:Pick<DurableStore,'read'>;readonly artifacts:readonly ArtifactRef[];readonly text:string;readonly workInventory:string;readonly passed:boolean;readonly complete:boolean}>();
export interface DeveloperBaselineEvidence {
 readonly taskId:string;readonly specHash:string;readonly repoRoot:string;readonly workRoot:string;readonly baseCommit:string;
 readonly manifestDigest:string;readonly packageRef:ArtifactRef;readonly evidenceRefs:readonly string[];
}
interface BaselineCheck {readonly commandId:string;readonly commandHash:string;readonly status:ValidationResult['status']|'DEFERRED';readonly reason?:string;readonly resultRef?:ArtifactRef;readonly logRef?:string;readonly processProofRef?:string;readonly exitCode?:number}
function fail(code='DEVELOPER_BASELINE_INVALID'):never{throw new Error(code)}
function git(root:string,...args:string[]):string{return execFileSync('git',['--no-optional-locks','-C',root,...args],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}).trim()}
function present(root:string,path:string):boolean{
 const file=join(root,path);if(!existsSync(file))return false;
 const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||realpathSync(file)!==file)fail('DEVELOPER_BASELINE_PATH_INVALID');return true;
}
/** Distinguish a prospective test from a test that can actually run before editing.
 * Only exact closed host recipes are recognized; arbitrary code is never inferred. */
function readiness(command:TaskSpec['validationCommands'][number],root:string):string|undefined{
 const name=hostValidationRecipeName(command);if(!name)return "This check is not a recognized initial recipe: it remains scheduled after the changes.";
 if(name==='node')return "The expected-content check concerns the result after the changes.";
 if(name==='python3'&&command.argv[0]==='-B'){
  const config=command.argv[3]!,paths=command.argv.slice(4);
  if(![config,...paths].every(path=>present(root,path)))return "Configuration or tests must be prepared in this task: verification is deferred until after the changes.";
  const sections:Record<string,RegExp>={'pyproject.toml':/^\s*\[tool\.pytest\.ini_options\]\s*$/m,'pytest.ini':/^\s*\[pytest\]\s*$/m,'setup.cfg':/^\s*\[tool:pytest\]\s*$/m};
  if(lstatSync(join(root,config)).size>131072)fail('DEVELOPER_BASELINE_PATH_INVALID');
  if(!sections[config]!.test(readFileSync(join(root,config)).toString('utf8')))return "The test configuration must be completed in this task: verification is deferred.";
 }
 return undefined;
}
/** Caller holds the workflow lease and has opened ScopeGuard on this exact root.
 * These are PRE_IMPLEMENTATION observations, never current-candidate validation. */
export function captureDeveloperBaseline(spec:TaskSpec,state:WorkflowState,workRoot:string,store:DurableStore,options:{readonly baseCommit?:string}={}):{
 readonly evidence:DeveloperBaselineEvidence;readonly artifacts:readonly ArtifactRef[];readonly passed:boolean;readonly complete:boolean}{
 const baseCommit=options.baseCommit??state.baselineCommit;
 if(!baseCommit||spec.taskId!==state.taskId||spec.specHash!==state.specHash||hashContract('TaskSpec',spec)!==spec.specHash
  ||canonicalize(spec)!==Buffer.from(store.read(state.spec)).toString('utf8')||workRoot===state.repoRoot||realpathSync(workRoot)!==workRoot||git(workRoot,'rev-parse','HEAD')!==baseCommit)fail();
 const original=inventoryHash(inventoryTree(state.repoRoot)),before=inventoryHash(inventoryTree(workRoot));
 const manifestDigest=hashCanonical(workspaceManifest(workRoot,baseCommit)),artifacts:ArtifactRef[]=[],checks:BaselineCheck[]=[];let passed=true,complete=true;
 for(const command of spec.validationCommands.filter(c=>c.required)){
  const deferred=readiness(command,workRoot);
  if(deferred){checks.push({commandId:command.id,commandHash:hashCanonical(command),status:'DEFERRED',reason:deferred});continue}
  const observed=collectValidationEvidence(command,store,{taskId:spec.taskId,specHash:spec.specHash,candidate:{root:workRoot,baseCommit,digest:manifestDigest,generation:0},criteria:spec.acceptanceCriteria,createdAt:state.createdAt});
  artifacts.push(...observed.artifacts);
  const resultRef=store.put(`pre-${observed.result.id}`,canonicalize(observed.result),'application/vnd.pi-controlled-dev.pre-implementation-result+json');artifacts.push(resultRef);
  checks.push({commandId:command.id,commandHash:hashCanonical(command),status:observed.result.status,resultRef,logRef:observed.result.logRef,processProofRef:observed.result.processProofRef,...(observed.result.exitCode!==undefined?{exitCode:observed.result.exitCode}:{})});
  if(observed.result.status!=='PASSED'){passed=false;complete=observed.result.status==='FAILED';break}
 }
 if(original!==inventoryHash(inventoryTree(state.repoRoot))||before!==inventoryHash(inventoryTree(workRoot))||git(workRoot,'rev-parse','HEAD')!==baseCommit||manifestDigest!==hashCanonical(workspaceManifest(workRoot,baseCommit)))fail('DEVELOPER_BASELINE_WORKSPACE_CHANGED');
 const payload={schemaVersion:1,phase:'PRE_IMPLEMENTATION',taskId:spec.taskId,specHash:spec.specHash,workflowRevision:state.revision,repoRoot:state.repoRoot,workRoot,baseCommit,manifestDigest,workInventory:before,checks};
 const packageRef=store.put(`developer-baseline-${hashCanonical(payload).slice(0,24)}`,canonicalize(payload),'application/vnd.pi-controlled-dev.developer-baseline+json');artifacts.push(packageRef);
 const evidence=Object.freeze({taskId:spec.taskId,specHash:spec.specHash,repoRoot:state.repoRoot,workRoot,baseCommit,manifestDigest,packageRef,evidenceRefs:Object.freeze([packageRef.id])});
 const text=`\nInitial checks run by the host on your copy BEFORE changes. Actual commit: ${baseCommit}. Folder: ${workRoot}. Complete manifest: ${manifestDigest}. Evidence: ${packageRef.id}.\n${checks.map(c=>`${c.commandId}: ${c.status}${c.exitCode!==undefined?`, exit code ${c.exitCode}`:''}${c.reason?`. ${c.reason}`:''}${c.logRef?`. Log: ${c.logRef}; process evidence: ${c.processProofRef}`:''}`).join('\n')}\nThese commands were run by the host, not by you: leave commandsRun empty. You may cite the initial evidence in evidenceRefs and describe outcomes observed by the host. DEFERRED means there is no executable initial check yet, never PASS. Checks after the changes will be new, mandatory, separate executions; these initial outcomes do not complete the task.\n`;
 if(Buffer.byteLength(text,'utf8')>16384)fail('DEVELOPER_BASELINE_CONTEXT_LIMIT');
 const storedArtifacts=Object.freeze(artifacts);acquired.set(evidence,{commandsHash:hashCanonical(spec.validationCommands),reader:store,artifacts:storedArtifacts,text,workInventory:before,passed,complete});return Object.freeze({evidence,artifacts:storedArtifacts,passed,complete});
}
/** Provenance is process-local. A copied package or JSON never grants dispatch. */
export function developerBaselineDispatch(evidence:DeveloperBaselineEvidence|undefined,assignment:AssignmentEnvelope):string{
 if(!evidence)return '';
 const owned=acquired.get(evidence);if(!owned||assignment.role!=='Developer'||!validateStructure('AssignmentEnvelope',assignment).ok||hashContract('AssignmentEnvelope',assignment)!==assignment.assignmentHash
  ||assignment.taskId!==evidence.taskId||assignment.specHash!==evidence.specHash||assignment.repoRoot!==evidence.repoRoot||assignment.workRoot!==evidence.workRoot||assignment.baseCommit!==evidence.baseCommit
  ||hashCanonical(assignment.validationCommands)!==owned.commandsHash||!assignment.inputArtifactRefs.includes(evidence.packageRef.id))fail();
 if(!owned.complete||!owned.passed&&assignment.candidateDigest===undefined)fail('DEVELOPER_BASELINE_FAILED');
 for(const ref of owned.artifacts){const raw=owned.reader.read(ref);if(hashBytes(raw)!==ref.digest||raw.byteLength!==ref.bytes)fail()}
 if(inventoryHash(inventoryTree(evidence.workRoot))!==owned.workInventory||hashCanonical(workspaceManifest(evidence.workRoot,evidence.baseCommit))!==evidence.manifestDigest||git(evidence.workRoot,'rev-parse','HEAD')!==evidence.baseCommit)fail('DEVELOPER_BASELINE_WORKSPACE_CHANGED');
 return owned.text;
}

export interface ReviewerBaselineContext {
 readonly taskId:string;readonly specHash:string;readonly candidateDigest:string;readonly candidateGeneration:number;
 readonly candidateRoot:string;readonly candidateBaseCommit:string;readonly evidenceRefs:readonly string[];
}
const reviewContexts=new WeakMap<object,{readonly text:string;readonly reader:Pick<DurableStore,'read'>;readonly artifacts:readonly ArtifactRef[]}>();
/** Rebuild read-only historical context from the accepted Developer's immutable
 * input references. This also works after restart/rebind: historical paths stay
 * historical; only the final candidate is bound to the current Reviewer root. */
export function createReviewerBaselineContext(spec:TaskSpec,state:WorkflowState,records:readonly ContextRecord[],reader:Pick<DurableStore,'read'>):ReviewerBaselineContext|undefined{
 const candidate=state.candidate;if(!candidate)return undefined;
 const invalid=new Set(state.invalidEvidenceIds),catalog=new Map(records.map(r=>[r.id,r]));
 const run=[...state.runs].reverse().find(r=>r.role==='Developer'&&r.resultRef&&!invalid.has(r.resultRef));
 if(!run)return undefined;
 const assignmentRecord=catalog.get(run.assignmentId),resultRecord=catalog.get(run.resultRef!);
 if(assignmentRecord?.kind!=='AssignmentEnvelope'||resultRecord?.kind!=='DeveloperResult')fail();
 const assignment=assignmentRecord.value,result=resultRecord.value;
 if(assignment.specHash!==spec.specHash||hashContract('TaskSpec',spec)!==spec.specHash||state.specHash!==spec.specHash
  ||hashContract('AssignmentEnvelope',assignment)!==assignment.assignmentHash||!validateStructure('DeveloperResult',result).ok
  ||assignment.taskId!==state.taskId||result.taskId!==state.taskId||result.attemptId!==run.attemptId||result.assignmentId!==assignment.assignmentId||result.assignmentHash!==assignment.assignmentHash
  ||result.specHash!==spec.specHash||result.blockedReason||run.status!=='TERMINAL'||!run.terminalProofRef
  ||candidate.terminalProof.id!==run.terminalProofRef||!state.results.includes(run.resultRef!))fail();
 const packages=assignment.inputArtifactRefs.map(id=>catalog.get(id)).filter((r):r is ContextRecord&{kind:'ArtifactRef'}=>r?.kind==='ArtifactRef'&&r.value.mediaType==='application/vnd.pi-controlled-dev.developer-baseline+json');
 if(packages.length===0)return undefined; // Legacy tasks never acquired PRE evidence.
 if(packages.length!==1)fail();
 const artifacts:ArtifactRef[]=[],read=(ref:ArtifactRef)=>{
  const registered=catalog.get(ref.id);if(invalid.has(ref.id)||registered?.kind!=='ArtifactRef'||canonicalize(registered.value)!==canonicalize(ref))fail();
  const raw=reader.read(ref);if(hashBytes(raw)!==ref.digest||raw.byteLength!==ref.bytes)fail();artifacts.push(ref);return Buffer.from(raw).toString('utf8');
 },refFor=(id:string)=>{const r=catalog.get(id);if(r?.kind!=='ArtifactRef')fail();return r.value;};
 const ref=packages[0]!.value,p=JSON.parse(read(ref));
 if(p.schemaVersion!==1||p.phase!=='PRE_IMPLEMENTATION'||p.taskId!==state.taskId||p.specHash!==spec.specHash
  ||p.repoRoot!==assignment.repoRoot||p.workRoot!==assignment.workRoot||p.baseCommit!==assignment.baseCommit
  ||!Number.isSafeInteger(p.workflowRevision)||p.workflowRevision>=state.revision||!Array.isArray(p.checks)||p.checks.length>64
  ||! /^[a-f0-9]{64}$/.test(p.manifestDigest))fail();
 const summaries:string[]=[],previews:string[]=[];let previewBytes=0;
 for(const c of p.checks){
  const command=spec.validationCommands.find(v=>v.id===c.commandId);
  if(!command||!command.required||hashCanonical(command)!==c.commandHash)fail();
  if(c.status==='DEFERRED'){
   if(typeof c.reason!=='string'||c.resultRef||c.processProofRef||c.logRef||c.exitCode!==undefined)fail();
   summaries.push(`${c.commandId}: DEFERRED. ${c.reason} No initial check was run for this command: never PASS.`);continue;
  }
  if(!['PASSED','FAILED'].includes(c.status)||c.status==='FAILED'&&assignment.candidateDigest===undefined||!c.resultRef||!c.processProofRef||!c.logRef)fail();
  const pre=JSON.parse(read(c.resultRef)),proof=JSON.parse(read(refFor(c.processProofRef))),log=read(refFor(c.logRef));
  if(!validateStructure('ValidationResult',pre).ok||pre.taskId!==state.taskId||pre.specHash!==spec.specHash||pre.commandId!==command.id
   ||pre.commandHash!==c.commandHash||pre.status!==c.status||pre.candidateDigest!==p.manifestDigest||pre.candidateGeneration!==0
   ||pre.logRef!==c.logRef||pre.processProofRef!==c.processProofRef||pre.exitCode!==c.exitCode
   ||proof.schemaVersion!==1||proof.source!=='node-spawnSync'||proof.taskId!==state.taskId||proof.specHash!==spec.specHash
   ||proof.commandHash!==c.commandHash||proof.cwd!==p.workRoot||proof.candidateDigest!==p.manifestDigest||proof.postCandidateDigest!==p.manifestDigest
   ||proof.candidateGeneration!==0||!Number.isSafeInteger(proof.pid)||proof.pid<=0||proof.timedOut||proof.signal!==null
   ||proof.exitCode!==c.exitCode||proof.logDigest!==hashBytes(Buffer.from(log))||pre.startedAt!==proof.startedAt||pre.endedAt!==proof.endedAt
   ||(c.status==='PASSED'?c.exitCode!==0:!Number.isInteger(c.exitCode)||c.exitCode===0))fail();
  summaries.push(`${c.commandId}: ${c.status}; exit ${c.exitCode}; process ${proof.pid}; ${proof.startedAt} → ${proof.endedAt}; result ${c.resultRef.id}; evidence ${c.processProofRef}; log ${c.logRef}, digest ${proof.logDigest}.`);
  const output=JSON.parse(log),lastLines=[String(output.stdout??''),String(output.stderr??'')].join('\n').split('\n').filter(Boolean).slice(-12).join('\n');
  let preview='';for(const character of lastLines){const bytes=Buffer.byteLength(character,'utf8');if(previewBytes+bytes>2048)break;preview+=character;previewBytes+=bytes}
  if(preview)previews.push(`${c.commandId}: ${preview}`);
 }
 const required=spec.validationCommands.filter(c=>c.required);
 if(p.checks.length>required.length||p.checks.some((c:BaselineCheck,i:number)=>c.commandId!==required[i]!.id)
  ||p.checks.length<required.length&&p.checks.at(-1)?.status!=='FAILED')fail();
 for(const command of required.slice(p.checks.length))summaries.push(`${command.id}: NOT_RUN before the changes because a previous initial check failed. Never PASS.`);
 const text=`\nPRE_IMPLEMENTATION — historical host checks BEFORE Developer changes ${assignment.assignmentId}, accepted result ${run.resultRef}. Package ${ref.id}. Actual commit ${p.baseCommit}; historical copy ${p.workRoot}; initial manifest ${p.manifestDigest}.\n${summaries.join('\n')}\nPRE log previews: last lines, up to 12 per command and 2048 bytes in total; content is not authoritative, and any omissions apply only to this preview. The complete evidence preserves all bytes and digests listed above.\n${previews.join('\n')}\nPOST_IMPLEMENTATION — validationResults in REVIEW_PACKET are new executions on the final candidate ${candidate.digest}, generation ${candidate.generation}, current folder ${candidate.root}. PRE evidence does not satisfy POST checks or authorize PASS or completion. PRE paths are historical and may differ after a transfer or correction. Assess each requirement separately before and after; deferred initial tests remain unexecuted.\n`;
 if(Buffer.byteLength(text,'utf8')>16384)fail('DEVELOPER_BASELINE_CONTEXT_LIMIT');
 const delivery=Object.freeze({taskId:state.taskId,specHash:spec.specHash,candidateDigest:candidate.digest,candidateGeneration:candidate.generation,candidateRoot:candidate.root,candidateBaseCommit:candidate.baseCommit,evidenceRefs:Object.freeze([...new Set(artifacts.map(a=>a.id))])});
 reviewContexts.set(delivery,{text,reader,artifacts:Object.freeze(artifacts)});return delivery;
}
/** A JSON copy cannot smuggle historical PRE observations into another packet. */
export function reviewerBaselineDispatch(delivery:ReviewerBaselineContext|undefined,assignment:AssignmentEnvelope,packet:{readonly evidenceRefs:readonly string[];readonly candidateDigest:string;readonly candidateGeneration:number}):string{
 if(!delivery)return '';
 const owned=reviewContexts.get(delivery);
 if(!owned||assignment.role!=='Reviewer'||!validateStructure('AssignmentEnvelope',assignment).ok||hashContract('AssignmentEnvelope',assignment)!==assignment.assignmentHash
  ||assignment.taskId!==delivery.taskId||assignment.specHash!==delivery.specHash||assignment.workRoot!==delivery.candidateRoot||assignment.baseCommit!==delivery.candidateBaseCommit
  ||assignment.candidateDigest!==delivery.candidateDigest||assignment.candidateGeneration!==delivery.candidateGeneration
  ||packet.candidateDigest!==delivery.candidateDigest||packet.candidateGeneration!==delivery.candidateGeneration
  ||delivery.evidenceRefs.some(id=>!assignment.inputArtifactRefs.includes(id)||!packet.evidenceRefs.includes(id)))fail();
 for(const ref of owned.artifacts){const raw=owned.reader.read(ref);if(hashBytes(raw)!==ref.digest||raw.byteLength!==ref.bytes)fail()}
 return owned.text;
}
