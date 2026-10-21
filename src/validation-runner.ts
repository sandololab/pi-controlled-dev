import { executeSupervisedCommand } from './host-command.js';
import type { HostCommandOptions, HostCommandExecution } from './host-command.js';
import { runQuiescent } from './run-quiescence.js';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { canonicalize, hashBytes, hashCanonical, hashContract, parseJson, validateStructure } from './contracts.js';
import type { ArtifactRef, CommandSpec, Criterion, TaskSpec, ValidationResult, WorkflowState } from './contracts.js';
import type { DurableStore } from './store.js';
import { workspaceManifest, trackedWorkspaceManifest } from './scope-guard.js';
import { RUNTIME_EVENT_SCHEMA, extractRuntimeEvents, parseRuntimeJsonl, redactRuntimeText, runtimeDiagnosis } from './runtime-observability.js';
import type { RuntimeEvent, RuntimeEvidence } from './runtime-observability.js';
import { createExecutableScenario, createScenarioRun, createTechnicalEvidenceBundle,
  EVIDENCE_BUNDLE_MEDIA_TYPE, SCENARIO_MEDIA_TYPE, SCENARIO_RUN_MEDIA_TYPE } from './scenario-management.js';

const executed=new WeakSet<object>();
/** Shared bounded execution primitive. The root is selected by the trusted host;
 * only the immutable TaskSpec's exact approved argv is executable. */
export function executeApprovedCommand(spec:TaskSpec,commandId:string,root:string){
  const command=spec.validationCommands.find(c=>c.id===commandId);
  if(!command||!validateStructure('CommandSpec',command).ok||hashContract('TaskSpec',spec)!==spec.specHash)throw new Error('VALIDATION_PRECONDITION');
  return executeHostValidationCommand(command,root);
}
/** Shared process primitive for exact host-selected recipes. Never registered as a model tool.
 * Project callers must validate and bind their own immutable approved plan before calling. */
export function executeHostValidationCommand(command:CommandSpec,root:string){
  if(!validateStructure('CommandSpec',command).ok)throw new Error('VALIDATION_PRECONDITION');
  const startedAt=new Date().toISOString(),child=spawnSync(command.executable,[...command.argv],{cwd:root,encoding:'utf8',timeout:command.timeoutMs,
    killSignal:'SIGKILL',maxBuffer:64*1024,shell:false}),endedAt=new Date().toISOString();
  if(!Number.isSafeInteger(child.pid)||child.pid<=0||(child.status===null&&child.signal===null))throw new Error('VALIDATION_TERMINAL_PROOF_UNAVAILABLE');
  return {command,startedAt,endedAt,child};
}
export function isExecutedValidation(value:ValidationResult):boolean{return executed.has(value)}
export interface ValidationProcessProof {
  readonly schemaVersion:1; readonly source:'node-spawnSync'|'node-spawn'; readonly taskId:string; readonly specHash:string;
  readonly commandHash:string; readonly candidateDigest:string; readonly candidateGeneration:number; readonly cwd:string;
  readonly pid:number; readonly exitCode:number|null; readonly signal:string|null; readonly startedAt:string; readonly endedAt:string;
  readonly timedOut:boolean; readonly logDigest:string; readonly postCandidateDigest:string;
}
/** Executes only an exact, already-approved CommandSpec, without shell inference.
 * A synchronous return plus observed exit status/signal is separate from validation success. */
export function runApprovedValidation(spec:TaskSpec,state:WorkflowState,commandId:string,store:DurableStore):
  {readonly result:ValidationResult;readonly artifacts:readonly ArtifactRef[]}{
  const command=spec.validationCommands.find(value=>value.id===commandId),candidate=state.candidate;
  if(!command||!validateStructure('CommandSpec',command).ok||hashContract('TaskSpec',spec)!==spec.specHash
    ||canonicalize(parseJson(store.read(state.spec),64*1024*1024))!==canonicalize(spec)||state.state!=='TESTING'||state.specHash!==spec.specHash||!candidate
    ||state.runs.some(run=>!runQuiescent(run)))throw new Error('VALIDATION_PRECONDITION');
  const digest=()=>hashCanonical(workspaceManifest(candidate.root,candidate.baseCommit));
  if(digest()!==candidate.digest)throw new Error('VALIDATION_CANDIDATE_CHANGED');
  return collectValidationEvidence(command,store,{taskId:spec.taskId,specHash:spec.specHash,
    candidate:{root:candidate.root,baseCommit:candidate.baseCommit,digest:candidate.digest,generation:candidate.generation},
    criteria:spec.acceptanceCriteria,createdAt:state.createdAt,patchRef:candidate.patch.id});
}
/** Project callers retain a separate exact baseline/run envelope in the project store.
 * Sharing process/evidence machinery never creates a WorkflowState or accepts task results. */
export interface ValidationBinding {readonly taskId:string;readonly specHash:string;
  readonly candidate:{readonly root:string;readonly baseCommit:string;readonly digest:string;readonly generation:number};readonly criteria:readonly Criterion[];readonly createdAt:string;
  readonly patchRef?:string;readonly trackedBaseline?:boolean;readonly scenario?:import('./scenario-management.js').ExecutableScenario}
export function collectValidationEvidence(command:CommandSpec,store:DurableStore,binding:ValidationBinding){
  const digest=()=>hashCanonical(binding.trackedBaseline?trackedWorkspaceManifest(binding.candidate.root,binding.candidate.baseCommit):workspaceManifest(binding.candidate.root,binding.candidate.baseCommit));
  if(digest()!==binding.candidate.digest)throw new Error('VALIDATION_CANDIDATE_CHANGED');
  return finishValidationEvidence(command,store,binding,executeHostValidationCommand(command,binding.candidate.root));
}
export async function collectValidationEvidenceAsync(command:CommandSpec,store:DurableStore,binding:ValidationBinding,options:HostCommandOptions={}){
  const digest=()=>hashCanonical(binding.trackedBaseline?trackedWorkspaceManifest(binding.candidate.root,binding.candidate.baseCommit):workspaceManifest(binding.candidate.root,binding.candidate.baseCommit));
  if(digest()!==binding.candidate.digest)throw new Error('VALIDATION_CANDIDATE_CHANGED');
  const execution=await executeSupervisedCommand(command,binding.candidate.root,store,{taskId:binding.taskId,specHash:binding.specHash,candidateDigest:binding.candidate.digest,candidateGeneration:binding.candidate.generation},{...options,onProgress:event=>options.onProgress?.({...event,description:binding.criteria.find(c=>c.commandIds.includes(command.id))?.text??'Approved automated check'})});
  return finishValidationEvidence(command,store,binding,execution);
}
function finishValidationEvidence(command:CommandSpec,store:DurableStore,binding:ValidationBinding,execution:ReturnType<typeof executeHostValidationCommand>|HostCommandExecution){
  const candidate=binding.candidate,commandId=command.id;
  const digest=()=>hashCanonical(binding.trackedBaseline?trackedWorkspaceManifest(candidate.root,candidate.baseCommit):workspaceManifest(candidate.root,candidate.baseCommit));
  const {startedAt,endedAt,child:process}=execution;
  // Store only bounded, redacted output. The child cannot turn free-form log text
  // into validation authority; structured events are extracted separately.
  const stdout=String(process.stdout??''),stderr=String(process.stderr??'');
  const safeOut=redactRuntimeText(stdout),safeErr=redactRuntimeText(stderr);
  const log=canonicalize({stdout:safeOut.text,stderr:safeErr.text}),logDigest=hashBytes(Buffer.from(log));
  const postCandidateDigest=digest(),timedOut=process.error?.code==='ETIMEDOUT';
  const proof:ValidationProcessProof={schemaVersion:1,source:'source' in execution?execution.source:'node-spawnSync',taskId:binding.taskId,specHash:binding.specHash,
    commandHash:hashCanonical(command),candidateDigest:candidate.digest,candidateGeneration:candidate.generation,cwd:candidate.root,
    pid:process.pid,exitCode:process.status,signal:process.signal,startedAt,endedAt,timedOut,logDigest,postCandidateDigest};
  const token=hashCanonical(proof).slice(0,24),logRef=store.put(`validation-log-${token}`,log),proofRef=store.put(`validation-proof-${token}`,canonicalize(proof));
  let childEvents:readonly RuntimeEvent[]=[],runtimeProblem:string|undefined,childRedactions=0;
  try{const captured=extractRuntimeEvents(stdout,stderr);childEvents=captured.events;childRedactions=captured.redactions}
  catch(error){runtimeProblem=error instanceof Error?error.message:'RUNTIME_EVIDENCE_INVALID'}
  const status=postCandidateDigest!==candidate.digest||(process.error&&!timedOut)||runtimeProblem?'INVALID'
    :timedOut?'TIMED_OUT':process.status===0?'PASSED':process.status!==null?'FAILED':'INVALID';
  const correlationId=`validation-${token}`;
  const hostEvents:RuntimeEvent[]=[{schemaVersion:RUNTIME_EVENT_SCHEMA,timestamp:startedAt,source:'validation-runner',
    eventType:'validation.started',severity:'INFO',correlationId,data:{commandId:command.id,candidateGeneration:candidate.generation}},
  ...childEvents,{schemaVersion:RUNTIME_EVENT_SCHEMA,timestamp:endedAt,source:'validation-runner',
    eventType:'validation.finished',severity:status==='PASSED'?'INFO':'ERROR',correlationId,
    data:{status,exitCode:process.status,complete:!runtimeProblem&&!process.error&&!timedOut&&postCandidateDigest===candidate.digest},
    metrics:{durationMs:Math.max(0,Date.parse(endedAt)-Date.parse(startedAt))}}];
  const jsonl=hostEvents.map(event=>canonicalize(event)).join('\n')+'\n';
  // Defensive re-parse of exactly the bytes placed in the immutable store.
  parseRuntimeJsonl(jsonl);
  const eventRef=store.put(`runtime-events-${token}`,jsonl,'application/x-ndjson');
  const complete=!runtimeProblem&&!process.error&&!timedOut&&postCandidateDigest===candidate.digest;
  const diagnosis=runtimeDiagnosis(status,hostEvents,complete);
  const metrics:Record<string,number>={};for(const row of hostEvents)for(const [name,value] of Object.entries(row.metrics??{}))metrics[name]=value;
  const evidence:RuntimeEvidence={schemaVersion:1,id:`runtime-evidence-${token}`,taskId:binding.taskId,validationId:`validation-${token}`,
    scenarioId:command.id,commandHash:proof.commandHash,candidateDigest:candidate.digest,candidateGeneration:candidate.generation,
    startedAt,endedAt,exitCode:process.status,status,complete,
    eventCount:hostEvents.length,eventLogRef:eventRef.id,redactions:safeOut.redactions+safeErr.redactions+childRedactions,
    summary:complete?status==='PASSED'?"The check passed.":"The check failed; events are available for diagnosis.":
      "Execution or evidence is incomplete: no successful outcome can be inferred.",
    importantObservations:diagnosis.observed,metrics,diagnosis};
  const evidenceRef=store.put(evidence.id,canonicalize(evidence),'application/vnd.pi-controlled-dev.runtime-evidence+json');
  const result:ValidationResult=Object.freeze({schemaVersion:1,id:`validation-${token}`,taskId:binding.taskId,commandId,specHash:binding.specHash,
    candidateDigest:candidate.digest,candidateGeneration:candidate.generation,commandHash:proof.commandHash,status,issuer:'Orchestrator',
    startedAt,endedAt,...(process.status!==null?{exitCode:process.status}:{}),logRef:logRef.id,processProofRef:proofRef.id,postCandidateDigest,
    reason:runtimeProblem?"Runtime evidence emitted by the check is incomplete or invalid. No successful outcome was recorded."
      :process.error?.code==='ENOBUFS'?"The check exceeded the allowed output limit and was interrupted. No successful outcome was recorded."
      :timedOut?"The check exceeded the maximum allowed time."
      :`Approved command observed ${status}`});
  if(!validateStructure('ValidationResult',result).ok)throw new Error('VALIDATION_RESULT_INVALID');
  const scenario=binding.scenario??createExecutableScenario({taskId:binding.taskId,validationCommands:[command],acceptanceCriteria:binding.criteria},commandId,binding.createdAt),scenarioRef=store.put(`scenario-${scenario.scenarioHash.slice(0,24)}`,
    canonicalize(scenario),SCENARIO_MEDIA_TYPE);
  const scenarioRun=createScenarioRun(scenario,result,evidence,evidenceRef,eventRef),runRef=store.put(scenarioRun.runId,
    canonicalize(scenarioRun),SCENARIO_RUN_MEDIA_TYPE);
  const bundle=createTechnicalEvidenceBundle(scenario,[scenarioRun],binding.criteria,{...(binding.patchRef?{patchRef:binding.patchRef}:{}),
    extraArtifactRefs:[scenarioRef.id,runRef.id]}),bundleRef=store.put(bundle.bundleId,canonicalize(bundle),EVIDENCE_BUNDLE_MEDIA_TYPE);
  executed.add(result);return {result,artifacts:[...('artifacts' in execution?execution.artifacts:[]),logRef,proofRef,eventRef,evidenceRef,scenarioRef,runRef,bundleRef]};
}
export function verifyValidationProcessProof(input:unknown,result:ValidationResult,state:WorkflowState,log:Uint8Array):boolean{
  try{
    const p=JSON.parse(canonicalize(input));
    if(Object.keys(p).sort().join(',')!==['schemaVersion','source','taskId','specHash','commandHash','candidateDigest','candidateGeneration','cwd','pid',
      'exitCode','signal','startedAt','endedAt','timedOut','logDigest','postCandidateDigest'].sort().join(',')||p.schemaVersion!==1||!['node-spawnSync','node-spawn'].includes(p.source))return false;
    return p.taskId===result.taskId&&p.taskId===state.taskId&&p.specHash===result.specHash&&p.specHash===state.specHash
      &&p.commandHash===result.commandHash&&p.candidateDigest===result.candidateDigest&&p.candidateDigest===state.candidate?.digest
      &&p.candidateGeneration===result.candidateGeneration&&p.candidateGeneration===state.candidate?.generation&&p.cwd===state.candidate?.root&&Number.isSafeInteger(p.pid)&&p.pid>0
      &&p.startedAt===result.startedAt&&p.endedAt===result.endedAt&&p.exitCode===result.exitCode&&p.exitCode===0&&p.signal===null
      &&p.timedOut===false&&p.logDigest===hashBytes(log)&&p.postCandidateDigest===result.postCandidateDigest&&p.postCandidateDigest===p.candidateDigest;
  }catch{return false}
}
