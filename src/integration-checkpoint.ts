import { canonicalize, hashCanonical, copyJson } from './contract-json.js';
import { object, literal, list, scalars, integer, enumeration, scalar } from './contract-schema.js';
import type { Schema } from './contract-schema.js';
import type { Issue } from './contract-json.js';
import { validateStructure } from './contracts.js';
import type { ArtifactRef, CommandSpec } from './contracts.js';
import { freezeMemory, validateMemoryReference } from './project-memory.js';
import type { ProjectMemoryReference } from './project-memory.js';
import { localRef } from './candidate-git.js';
import { validateExecutableScenario, commandForScenario } from './scenario-management.js';
import type { ExecutableScenario } from './scenario-management.js';
import type { TaskWizardDraft } from './pre-task-proposal.js';
import { compileValidations } from './validation-proposals.js';

export const CHECKPOINT_MEDIA='application/vnd.pi-controlled-dev.integration-checkpoint+json';
export interface IntegrationBaselineReference {readonly projectId:string;readonly targetRef:string;readonly commit:string;readonly tree:string}
export interface CheckpointPlanReference {readonly planId:string;readonly revision:number;readonly digest:string;readonly plannedTaskId:string;readonly controlledTaskId:string}
export interface IntegrationCheckpointDefinition {
  readonly schemaVersion:1;readonly projectId:string;readonly checkpointId:string;readonly revision:number;
  readonly title:string;readonly purpose:string;readonly status:'DRAFT'|'APPROVED'|'SUPERSEDED';
  readonly plannedTaskRefs:readonly CheckpointPlanReference[];readonly controlledTaskRefs:readonly string[];
  readonly validationIntent:readonly string[];readonly validationPlan:TaskWizardDraft['validationPlan'];
  readonly commands:readonly CommandSpec[];readonly scenarios:readonly ExecutableScenario[];
  readonly relevantMemoryRefs:readonly ProjectMemoryReference[];readonly reviewRequired:boolean;
  readonly createdAt:string;readonly updatedAt:string;readonly contentDigest:string;
}
export interface CheckpointCoverage {readonly taskId:string;readonly specHash:string;readonly completionRef:ArtifactRef;
  readonly promotionResultRef:ArtifactRef|null;readonly integrationCommit:string;readonly integrationRequired:boolean}
export interface IntegrationCheckpointRun {
  readonly schemaVersion:1;readonly checkpointRunId:string;readonly definitionRef:ArtifactRef;readonly checkpointDefinitionId:string;
  readonly definitionRevision:number;readonly definitionDigest:string;readonly baseline:IntegrationBaselineReference;
  readonly startedAt:string;readonly finishedAt:string|null;readonly outcome:'PASS'|'FAIL'|'BLOCKED'|null;
  readonly phase:'CREATED'|'VALIDATIONS'|'SCENARIOS'|'REVIEW'|'FINISHED';readonly reason:string;
  readonly coverage:readonly CheckpointCoverage[];readonly evidenceRefs:readonly ArtifactRef[];readonly reviewRef:ArtifactRef|null;
  readonly owner:unknown;readonly reviewPacketRef:ArtifactRef|null;readonly reviewerDispatchRef:ArtifactRef|null;readonly reviewerTerminalRef:ArtifactRef|null;
}
const artifact=scalar<ArtifactRef>('Artifact',v=>validateStructure('ArtifactRef',v).ok);
const memory=scalar<ProjectMemoryReference>('Memory',v=>{try{validateMemoryReference(v);return true}catch{return false}});
const command=scalar<CommandSpec>('Command',v=>validateStructure('CommandSpec',v).ok);
const scenario=scalar<ExecutableScenario>('Scenario',v=>validateExecutableScenario(v));
const recipe=enumeration('NPM_TEST','PYTEST','CARGO_TEST','MAVEN_TEST','GRADLE_TEST','MAKE_TEST');
const proposal=object('ValidationProposal',{kind:enumeration('CONTENT','EXISTING_TEST','REVIEW'),description:scalars.Text,
  paths:list(scalars.Path,0,32),expectedLines:list(scalar<string>('Line',v=>typeof v==='string'&&v.length<=4096),0,128)},{mechanism:recipe});
const planRef=object('CheckpointPlanReference',{planId:scalars.ID,revision:integer(1,256),digest:scalars.Hash,plannedTaskId:scalars.ID,controlledTaskId:scalars.ID});
const definition=object('IntegrationCheckpointDefinition',{schemaVersion:literal(1),projectId:scalars.Hash,checkpointId:scalars.ID,
  revision:integer(1,256),title:scalars.Text,purpose:scalars.Text,status:enumeration('DRAFT','APPROVED','SUPERSEDED'),
  plannedTaskRefs:list(planRef,0,64),controlledTaskRefs:list(scalars.ID,1,64),validationIntent:list(scalars.Text,1,16),
  validationPlan:list(proposal,1,32),commands:list(command,1,64),scenarios:list(scenario,0,32),relevantMemoryRefs:list(memory,0,8),
  reviewRequired:scalar<boolean>('Boolean',v=>typeof v==='boolean'),createdAt:scalars.Time,updatedAt:scalars.Time,contentDigest:scalars.Hash});
export function checkpointError(code:string):never{throw new Error(code)}
export function checkCheckpoint<T>(schema:Schema<T>,input:unknown):T {
  const value=copyJson(input as any),issues:Issue[]=[];if(canonicalize(value).length>262144)checkpointError('CHECKPOINT_RECORD_LIMIT');
  schema.check(value,'$',issues);if(issues.length)checkpointError('CHECKPOINT_RECORD_INVALID');return freezeMemory(value as T);
}
export function definitionDigest(v:Omit<IntegrationCheckpointDefinition,'contentDigest'>|IntegrationCheckpointDefinition):string {
  const {contentDigest,status,...material}=v as IntegrationCheckpointDefinition;return hashCanonical(material);
}
export function checkpointCommands(plan:TaskWizardDraft['validationPlan'],resolveExecutable:(name:string)=>string):readonly CommandSpec[] {
  // Reuse the same closed recipe compiler; prose and scenario text never become shell authority.
  for(const v of plan)if(v.kind==='CONTENT'&&(v.paths.length!==1||!v.expectedLines.length||v.mechanism!==undefined)
    ||v.kind==='EXISTING_TEST'&&!v.mechanism||v.kind==='REVIEW'&&v.mechanism!==undefined)checkpointError('CHECKPOINT_VALIDATION_PLAN_INVALID');
  return compileValidations({validationPlan:plan} as TaskWizardDraft,resolveExecutable);
}
export function validateDefinition(input:unknown):IntegrationCheckpointDefinition {
  const d=checkCheckpoint(definition,input) as IntegrationCheckpointDefinition;
  // REVIEW recipes have no process command: their execution requires the existing Reviewer.
  if(!d.reviewRequired&&d.validationPlan.some(v=>v.kind==='REVIEW'))checkpointError('CHECKPOINT_VALIDATION_PLAN_INVALID');
  if(definitionDigest(d)!==d.contentDigest||new Set(d.controlledTaskRefs).size!==d.controlledTaskRefs.length
    ||new Set(d.commands.map(c=>c.id)).size!==d.commands.length||new Set(d.scenarios.map(s=>s.scenarioId)).size!==d.scenarios.length
    ||d.plannedTaskRefs.some(r=>!d.controlledTaskRefs.includes(r.controlledTaskId)))checkpointError('CHECKPOINT_DEFINITION_BINDING');
  const executables=new Map(d.commands.map(c=>[c.executable.split('/').at(-1)==='npm-cli.js'?'npm':c.executable.split('/').at(-1)!.replace(/^python3\.\d+$/,'python3'),c.executable]));
  const compiled=checkpointCommands(d.validationPlan,name=>{const p=executables.get(name);if(!p)checkpointError('CHECKPOINT_COMMAND_INVALID');return p});
  if(canonicalize(compiled)!==canonicalize(d.commands))checkpointError('CHECKPOINT_COMMAND_INVALID');
  for(const s of d.scenarios)commandForScenario(s,d.commands);
  return d;
}
export function validateBaseline(v:IntegrationBaselineReference):void {
  if(Object.keys(v).sort().join(',')!=='commit,projectId,targetRef,tree'||!validateStructureValue('Hash',v.projectId)
    ||!validateStructureValue('GitOID',v.commit)||!validateStructureValue('GitOID',v.tree)||localRef(v.targetRef)!==v.targetRef)checkpointError('CHECKPOINT_BASELINE_INVALID');
}
function validateStructureValue(kind:'Hash'|'GitOID',v:unknown){const issues:Issue[]=[];scalars[kind].check(v as any,'$',issues);return !issues.length}
export function checkpointNarrative(d:IntegrationCheckpointDefinition,b:IntegrationBaselineReference):string {
  return `Integration verification — ${d.title}\n\nWhat you are approving\nThis confirmation approves the proposal; it does not start the checks. Starting requires a separate action. It does not authorize code changes, merges, rollbacks or other changes to the project branch.\nVerification will use an isolated copy of the exact specified version without modifying the project. Uncommitted local changes are excluded.\n\nWhy this verification\n${d.purpose}\nThis check verifies the selected results together in the specified project version.\n\nProject version\nBranch ${b.targetRef.slice(11)}, exact version selected in the previous summary.\n\nIncluded changes\n${d.controlledTaskRefs.length} selected tasks, described in the previous summary.\n\nWhat will be checked\n${d.validationIntent.join('\n')}\n${d.validationPlan.map(v=>v.description).join('\n')}\n${d.scenarios.map(s=>`${s.title}: ${s.purpose}`).join('\n')||"No additional scenarios."}\nIndependent technical review: ${d.reviewRequired?"planned":"not planned"}.\n\nResult\nPASS: the planned checks succeeded on this exact version.\nFAIL: at least one check found a problem; the project is not corrected automatically.\nBLOCKED: verification could not be completed reliably.\nSTALE: the result concerns an earlier project version; it does not verify subsequent changes.\n\nTechnical details\ncheckpointId: ${d.checkpointId}\ndefinitionRevision: ${d.revision}\nbaselineCommit: ${b.commit}\ntree: ${b.tree}\ndigest: ${d.contentDigest}\nTask IDs: ${d.controlledTaskRefs.join(', ')}\nExplicit reruns apply the same intent to the exact commit shown before starting.`;
}
