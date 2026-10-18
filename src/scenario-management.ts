import { canonicalize, hashCanonical } from './contracts.js';
import type { ArtifactRef, Candidate, CommandSpec, Criterion, TaskSpec, ValidationResult } from './contracts.js';
import type { RuntimeComparison, RuntimeEvidence } from './runtime-observability.js';

export const SCENARIO_MEDIA_TYPE='application/vnd.pi-controlled-dev.executable-scenario+json';
export const SCENARIO_RUN_MEDIA_TYPE='application/vnd.pi-controlled-dev.scenario-run+json';
export const EVIDENCE_BUNDLE_MEDIA_TYPE='application/vnd.pi-controlled-dev.technical-evidence-bundle+json';

export type ScenarioLifecycle='DRAFT'|'READY'|'EXECUTED'|'SUPERSEDED';
export interface ExecutableScenario {
  readonly schemaVersion:1;readonly scenarioId:string;readonly taskId:string;readonly version:number;readonly scenarioHash:string;
  readonly lifecycle:ScenarioLifecycle;readonly title:string;readonly purpose:string;readonly setup:readonly string[];
  readonly inputs:readonly string[];readonly execution:{readonly commandId:string;readonly commandHash:string};
  readonly expectedObservations:readonly string[];readonly criterionIds:readonly string[];
  readonly evidenceRequirements:readonly string[];readonly cleanup:readonly string[];
  readonly repeatability:{readonly environmentAssumptions:readonly string[];readonly exactCommandRequired:true};
  readonly createdAt:string;readonly updatedAt:string;
}
export interface ScenarioRun {
  readonly schemaVersion:1;readonly runId:string;readonly taskId:string;readonly scenarioId:string;readonly scenarioVersion:number;
  readonly scenarioHash:string;readonly commandHash:string;readonly startedAt:string;readonly endedAt:string;
  readonly candidateDigest:string;readonly candidateGeneration:number;readonly result:'PASS'|'FAIL'|'BLOCKED';
  readonly validationResultRefs:readonly string[];readonly runtimeEvidenceRefs:readonly string[];
  readonly artifactRefs:readonly string[];readonly warnings:readonly string[];readonly anomalies:readonly string[];
}
export interface CriterionEvidenceMapping {
  readonly criterionId:string;readonly evidenceRefs:readonly string[];readonly status:'PASSED'|'FAILED'|'BLOCKED'|'MISSING';
}
export interface TechnicalEvidenceBundle {
  readonly schemaVersion:1;readonly bundleId:string;readonly taskId:string;readonly scenarioId:string;readonly scenarioHash:string;
  readonly runIds:readonly string[];readonly validationResultRefs:readonly string[];readonly runtimeEvidenceRefs:readonly string[];
  readonly artifactRefs:readonly string[];readonly criterionEvidence:readonly CriterionEvidenceMapping[];
  readonly residualTechnicalRisks:readonly string[];readonly createdAt:string;
  readonly beforeAfterComparisonRef?:string;readonly patchRef?:string;readonly reviewerResultRef?:string;
}
export class ScenarioError extends Error{constructor(readonly code:string){super(code)}}
const id=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const hash=/^[a-f0-9]{64}$/;
const iso=(value:string)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value));
const unique=(values:readonly string[])=>new Set(values).size===values.length;
const strings=(value:unknown,min=0,max=256):value is readonly string[]=>Array.isArray(value)&&value.length>=min&&value.length<=max&&value.every(item=>typeof item==='string'&&item.length>0&&item.length<=4096)&&unique(value);
const exact=(value:object,keys:readonly string[])=>Object.keys(value).sort().join(',')===[...keys].sort().join(',');

export function scenarioVersionHash(input:Omit<ExecutableScenario,'scenarioHash'|'lifecycle'|'createdAt'|'updatedAt'|'version'>):string{
  return hashCanonical(input);
}
export function createExecutableScenario(spec:Pick<TaskSpec,'taskId'|'validationCommands'|'acceptanceCriteria'>,commandId:string,now=new Date().toISOString(),version=1):ExecutableScenario{
  const command=spec.validationCommands.find(value=>value.id===commandId);
  if(!command)throw new ScenarioError('SCENARIO_COMMAND_NOT_APPROVED');
  const criteria=spec.acceptanceCriteria.filter(value=>value.commandIds.includes(commandId));
  const material={schemaVersion:1 as const,scenarioId:command.id,taskId:spec.taskId,
    title:`Check ${command.id}`,purpose:criteria.length?`Collect technical evidence for ${criteria.map(value=>value.text).join('; ')}.`:"Collect additional technical evidence through an approved command.",
    setup:Object.freeze(["Use the isolated candidate copy prepared by the host."]),
    inputs:Object.freeze(["Current candidate identified by digest and generation."]),
    execution:Object.freeze({commandId:command.id,commandHash:hashCanonical(command)}),
    expectedObservations:Object.freeze(criteria.length?criteria.map(value=>value.text):["The approved command terminates with an observable result."]),criterionIds:Object.freeze(criteria.map(value=>value.id)),
    evidenceRequirements:Object.freeze(["Host validation result.", "Runtime events structured and attributed to the same execution."]),
    cleanup:Object.freeze(["Do not modify the original repository."]),repeatability:Object.freeze({
      environmentAssumptions:Object.freeze(["Same approved command and scenario definition."]),exactCommandRequired:true as const})};
  return Object.freeze({...material,version,scenarioHash:scenarioVersionHash(material),lifecycle:'READY' as const,createdAt:now,updatedAt:now});
}
export function validateExecutableScenario(input:unknown):input is ExecutableScenario{
  if(!input||typeof input!=='object'||Array.isArray(input))return false;const v=input as any;
  const keys=['schemaVersion','scenarioId','taskId','version','scenarioHash','lifecycle','title','purpose','setup','inputs','execution','expectedObservations','criterionIds','evidenceRequirements','cleanup','repeatability','createdAt','updatedAt'];
  if(!exact(v,keys)||v.schemaVersion!==1||!id.test(v.scenarioId)||!id.test(v.taskId)||!Number.isSafeInteger(v.version)||v.version<1||!hash.test(v.scenarioHash)
    ||!['DRAFT','READY','EXECUTED','SUPERSEDED'].includes(v.lifecycle)||typeof v.title!=='string'||!v.title||typeof v.purpose!=='string'||!v.purpose
    ||!strings(v.setup)||!strings(v.inputs)||!strings(v.expectedObservations,1)||!strings(v.criterionIds,0)||!v.criterionIds.every((x:string)=>id.test(x))
    ||!strings(v.evidenceRequirements,1)||!strings(v.cleanup)||!iso(v.createdAt)||!iso(v.updatedAt)||Date.parse(v.updatedAt)<Date.parse(v.createdAt))return false;
  if(!v.execution||!exact(v.execution,['commandId','commandHash'])||!id.test(v.execution.commandId)||!hash.test(v.execution.commandHash))return false;
  if(!v.repeatability||!exact(v.repeatability,['environmentAssumptions','exactCommandRequired'])||v.repeatability.exactCommandRequired!==true||!strings(v.repeatability.environmentAssumptions,1))return false;
  const {scenarioHash,lifecycle,createdAt,updatedAt,version,...material}=v;
  return scenarioHash===scenarioVersionHash(material);
}
export function nextScenarioVersion(previous:ExecutableScenario,next:Omit<ExecutableScenario,'scenarioHash'|'version'|'createdAt'|'updatedAt'|'lifecycle'>,now=new Date().toISOString()):ExecutableScenario{
  if(!validateExecutableScenario(previous)||previous.scenarioId!==next.scenarioId||previous.taskId!==next.taskId)throw new ScenarioError('SCENARIO_VERSION_INVALID');
  const nextHash=scenarioVersionHash(next);if(nextHash===previous.scenarioHash)throw new ScenarioError('SCENARIO_VERSION_UNCHANGED');
  return Object.freeze({...next,version:previous.version+1,scenarioHash:nextHash,lifecycle:'READY',createdAt:previous.createdAt,updatedAt:now});
}
export function transitionScenarioLifecycle(scenario:ExecutableScenario,next:ScenarioLifecycle,now=new Date().toISOString()):ExecutableScenario{
  if(!validateExecutableScenario(scenario))throw new ScenarioError('SCENARIO_LIFECYCLE_INVALID');
  const allowed:Readonly<Record<ScenarioLifecycle,readonly ScenarioLifecycle[]>>={DRAFT:['READY','SUPERSEDED'],READY:['EXECUTED','SUPERSEDED'],EXECUTED:['EXECUTED','SUPERSEDED'],SUPERSEDED:[]};
  if(!allowed[scenario.lifecycle].includes(next)||!iso(now)||Date.parse(now)<Date.parse(scenario.updatedAt))throw new ScenarioError('SCENARIO_LIFECYCLE_INVALID');
  return Object.freeze({...scenario,lifecycle:next,updatedAt:now});
}
export function createScenarioRun(scenario:ExecutableScenario,validation:ValidationResult,runtime:RuntimeEvidence,runtimeRef:ArtifactRef,eventRef:ArtifactRef):ScenarioRun{
  if(!validateExecutableScenario(scenario)||scenario.taskId!==validation.taskId||scenario.execution.commandId!==validation.commandId
    ||scenario.execution.commandHash!==validation.commandHash||runtime.validationId!==validation.id||runtime.scenarioId!==scenario.scenarioId
    ||runtime.commandHash!==scenario.execution.commandHash||runtime.candidateDigest!==validation.candidateDigest
    ||runtime.candidateGeneration!==validation.candidateGeneration||runtimeRef.id!==runtime.id||eventRef.id!==runtime.eventLogRef)
    throw new ScenarioError('SCENARIO_RUN_ATTRIBUTION');
  const result:ScenarioRun['result']=validation.status==='PASSED'?'PASS':validation.status==='FAILED'?'FAIL':'BLOCKED';
  const anomalies=[...runtime.diagnosis.unknown,...runtime.importantObservations.filter(value=>/errore|fallit|incomplet/i.test(value))];
  return Object.freeze({schemaVersion:1,runId:`scenario-run-${validation.id.replace(/^validation-/,'')}`,taskId:validation.taskId,
    scenarioId:scenario.scenarioId,scenarioVersion:scenario.version,scenarioHash:scenario.scenarioHash,commandHash:validation.commandHash,
    startedAt:validation.startedAt??runtime.startedAt,endedAt:validation.endedAt??runtime.endedAt,candidateDigest:validation.candidateDigest,
    candidateGeneration:validation.candidateGeneration,result,validationResultRefs:Object.freeze([validation.id]),
    runtimeEvidenceRefs:Object.freeze([runtimeRef.id,eventRef.id]),artifactRefs:Object.freeze([...new Set([validation.logRef!,validation.processProofRef!].filter(Boolean))]),
    warnings:Object.freeze(runtime.complete?[]:["Runtime evidence is incomplete."]),anomalies:Object.freeze([...new Set(anomalies)].slice(0,32))});
}
export function validateScenarioRun(input:unknown):input is ScenarioRun{
  if(!input||typeof input!=='object'||Array.isArray(input))return false;const v=input as any;
  return exact(v,['schemaVersion','runId','taskId','scenarioId','scenarioVersion','scenarioHash','commandHash','startedAt','endedAt','candidateDigest','candidateGeneration','result','validationResultRefs','runtimeEvidenceRefs','artifactRefs','warnings','anomalies'])
    &&v.schemaVersion===1&&id.test(v.runId)&&id.test(v.taskId)&&id.test(v.scenarioId)&&Number.isSafeInteger(v.scenarioVersion)&&v.scenarioVersion>=1
    &&hash.test(v.scenarioHash)&&hash.test(v.commandHash)&&hash.test(v.candidateDigest)&&Number.isSafeInteger(v.candidateGeneration)&&v.candidateGeneration>=0
    &&iso(v.startedAt)&&iso(v.endedAt)&&Date.parse(v.endedAt)>=Date.parse(v.startedAt)&&['PASS','FAIL','BLOCKED'].includes(v.result)
    &&strings(v.validationResultRefs,1,64)&&strings(v.runtimeEvidenceRefs,1,64)&&strings(v.artifactRefs,0,256)&&strings(v.warnings,0,64)&&strings(v.anomalies,0,64);
}
export function scenarioRunsComparable(before:ScenarioRun,after:ScenarioRun):boolean{
  return validateScenarioRun(before)&&validateScenarioRun(after)&&before.taskId===after.taskId&&before.scenarioId===after.scenarioId
    &&before.scenarioHash===after.scenarioHash&&before.scenarioVersion===after.scenarioVersion&&before.commandHash===after.commandHash
    &&before.candidateGeneration<after.candidateGeneration;
}
export function assertCurrentScenarioRun(run:ScenarioRun,candidate:Pick<Candidate,'digest'|'generation'>):void{
  if(!validateScenarioRun(run)||run.candidateDigest!==candidate.digest||run.candidateGeneration!==candidate.generation)throw new ScenarioError('SCENARIO_RUN_STALE_CANDIDATE');
}
export function createTechnicalEvidenceBundle(scenario:ExecutableScenario,runs:readonly ScenarioRun[],criteria:readonly Criterion[],options:{
  readonly createdAt?:string;readonly beforeAfterComparisonRef?:string;readonly patchRef?:string;readonly reviewerResultRef?:string;
  readonly residualTechnicalRisks?:readonly string[];readonly extraArtifactRefs?:readonly string[];}={}):TechnicalEvidenceBundle{
  if(!validateExecutableScenario(scenario)||!runs.length||runs.some(run=>!validateScenarioRun(run)||run.scenarioHash!==scenario.scenarioHash||run.scenarioId!==scenario.scenarioId))
    throw new ScenarioError('EVIDENCE_BUNDLE_ATTRIBUTION');
  const criterionMap=new Map(criteria.map(value=>[value.id,value]));
  if(scenario.criterionIds.some(value=>!criterionMap.has(value)))throw new ScenarioError('EVIDENCE_CRITERION_UNKNOWN');
  const refs=[...new Set(runs.flatMap(run=>[...run.validationResultRefs,...run.runtimeEvidenceRefs,...run.artifactRefs]))];
  const latest=runs.at(-1)!;const status:CriterionEvidenceMapping['status']=latest.result==='PASS'?'PASSED':latest.result==='FAIL'?'FAILED':'BLOCKED';
  const criterionEvidence=scenario.criterionIds.map(criterionId=>Object.freeze({criterionId,evidenceRefs:Object.freeze([...refs]),status}));
  const createdAt=options.createdAt??latest.endedAt;
  const identity={taskId:scenario.taskId,scenarioId:scenario.scenarioId,scenarioHash:scenario.scenarioHash,runIds:runs.map(run=>run.runId),createdAt};
  return Object.freeze({schemaVersion:1,bundleId:`evidence-${hashCanonical(identity).slice(0,24)}`,taskId:scenario.taskId,scenarioId:scenario.scenarioId,
    scenarioHash:scenario.scenarioHash,runIds:Object.freeze(runs.map(run=>run.runId)),validationResultRefs:Object.freeze([...new Set(runs.flatMap(run=>run.validationResultRefs))]),
    runtimeEvidenceRefs:Object.freeze([...new Set(runs.flatMap(run=>run.runtimeEvidenceRefs))]),artifactRefs:Object.freeze([...new Set([...refs,...(options.extraArtifactRefs??[])])]),
    criterionEvidence:Object.freeze(criterionEvidence),residualTechnicalRisks:Object.freeze([...(options.residualTechnicalRisks??[])]),createdAt,
    ...(options.beforeAfterComparisonRef?{beforeAfterComparisonRef:options.beforeAfterComparisonRef}:{}),...(options.patchRef?{patchRef:options.patchRef}:{}),
    ...(options.reviewerResultRef?{reviewerResultRef:options.reviewerResultRef}:{})});
}
export function validateTechnicalEvidenceBundle(input:unknown):input is TechnicalEvidenceBundle{
  if(!input||typeof input!=='object'||Array.isArray(input))return false;const v=input as any;
  const optional=['beforeAfterComparisonRef','patchRef','reviewerResultRef'].filter(key=>v[key]!==undefined);
  if(!exact(v,['schemaVersion','bundleId','taskId','scenarioId','scenarioHash','runIds','validationResultRefs','runtimeEvidenceRefs','artifactRefs','criterionEvidence','residualTechnicalRisks','createdAt',...optional])
    ||v.schemaVersion!==1||!id.test(v.bundleId)||!id.test(v.taskId)||!id.test(v.scenarioId)||!hash.test(v.scenarioHash)||!iso(v.createdAt)
    ||!strings(v.runIds,1)||!strings(v.validationResultRefs,1)||!strings(v.runtimeEvidenceRefs,1)||!strings(v.artifactRefs,1)
    ||!strings(v.residualTechnicalRisks)||optional.some(key=>!id.test(v[key]))||!Array.isArray(v.criterionEvidence))return false;
  return unique(v.criterionEvidence.map((item:any)=>item?.criterionId))&&v.criterionEvidence.every((item:any)=>item&&exact(item,['criterionId','evidenceRefs','status'])
    &&id.test(item.criterionId)&&strings(item.evidenceRefs,1)&&['PASSED','FAILED','BLOCKED','MISSING'].includes(item.status));
}
export function bindBeforeAfter(bundle:TechnicalEvidenceBundle,before:ScenarioRun,after:ScenarioRun,comparison:RuntimeComparison,comparisonRef:string):TechnicalEvidenceBundle{
  if(!validateTechnicalEvidenceBundle(bundle)||!scenarioRunsComparable(before,after)||bundle.scenarioHash!==after.scenarioHash
    ||comparison.scenarioId!==after.scenarioId||comparison.commandHash!==after.commandHash||comparison.before.validationId!==before.validationResultRefs[0]
    ||comparison.after.validationId!==after.validationResultRefs[0]||comparison.conclusion==='UNKNOWN'||!id.test(comparisonRef))throw new ScenarioError('SCENARIO_COMPARISON_INCOMPATIBLE');
  const runIds=Object.freeze([...new Set([...bundle.runIds,before.runId,after.runId])]),bundleId=`evidence-${hashCanonical({
    taskId:bundle.taskId,scenarioId:bundle.scenarioId,scenarioHash:bundle.scenarioHash,runIds,createdAt:bundle.createdAt,comparisonRef}).slice(0,24)}`;
  return Object.freeze({...bundle,bundleId,runIds,beforeAfterComparisonRef:comparisonRef,
    artifactRefs:Object.freeze([...new Set([...bundle.artifactRefs,comparisonRef])])});
}

export function commandForScenario(scenario:ExecutableScenario,commands:readonly CommandSpec[]):CommandSpec{
  const command=commands.find(value=>value.id===scenario.execution.commandId);
  if(!command||hashCanonical(command)!==scenario.execution.commandHash)throw new ScenarioError('SCENARIO_COMMAND_CHANGED');
  return command;
}

export function stableScenarioJson(value:ExecutableScenario|ScenarioRun|TechnicalEvidenceBundle):string{return canonicalize(value)}
