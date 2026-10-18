import { physicalProjectRootForTask, resolveProjectStorage } from './project-storage.js';
import { assertHumanVaultLocation, humanVaultRoot } from './project-custodian.js';
import { ProjectAutonomyRepository, policyNarrative, AUTONOMY_ACTION_LABELS } from './project-autonomy.js';
import { GreenfieldBootstrap } from './greenfield-bootstrap.js';
import { errorPresentation } from './controlled-ui.js';
import { IntegrationCheckpointRepository } from './integration-checkpoint-repository.js';
import { ProjectPlanningRepository } from './project-planning-repository.js';
import { readTrustedConfirmationEvidence } from './trusted-confirmation.js';
import { designNarrative, projectExecutionReason, projectTaskStatusLabel } from './project-planning.js';
import { CandidatePromotionRepository } from './candidate-promotion-repository.js';
import { ProjectMemoryRepository } from './project-memory-repository.js';
import { memoryPresentation, MEMORY_RECEIPT_MEDIA } from './project-memory.js';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { canonicalize, hashBytes, parseJson } from './contracts.js';
import type { ArtifactRef, ContextRecord, DecisionRecord, DeveloperResult, ReviewResult, TaskSpec } from './contracts.js';
import { DurableStore } from './store.js';
import { EVIDENCE_BUNDLE_MEDIA_TYPE, SCENARIO_MEDIA_TYPE, SCENARIO_RUN_MEDIA_TYPE,
  validateExecutableScenario, validateScenarioRun, validateTechnicalEvidenceBundle } from './scenario-management.js';
import type { ExecutableScenario, ScenarioRun, TechnicalEvidenceBundle } from './scenario-management.js';
import type { RuntimeComparison, RuntimeEvidence } from './runtime-observability.js';

export interface HumanProjectionResult {readonly status:'CURRENT'|'STALE';readonly taskId:string;readonly vaultRoot:string;readonly files:readonly string[];readonly reason?:string}
const folders=['Tasks','Scenarios','Runs','Evidence','Reviews','Decisions','Indexes','Notes'] as const;
const safeId=(value:string)=>value.replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,96)||'record';
const yaml=(value:string|number)=>typeof value==='number'?String(value):JSON.stringify(value);
const list=(values:readonly string[],empty="None.")=>values.length?values.map(value=>`- ${value}`).join('\n'):empty;
const observedStatus=(value:string)=>value==='PASS'||value==='PASSED'?'PASS':value==='FAIL'||value==='FAILED'?'FAIL':'BLOCKED';
const noteName={task:(id:string)=>`Task ${safeId(id)}`,scenario:(id:string)=>`Scenario ${safeId(id)}`,
  run:(id:string)=>`Run ${safeId(id)}`,evidence:(id:string)=>`Evidence ${safeId(id)}`,review:(id:string)=>`Review ${safeId(id)}`,
  decision:(id:string)=>`Decision ${safeId(id)}`,notes:(kind:string,id:string)=>`${safeId(kind)}-${safeId(id)}-notes`};
const markdownFileLink=(path:string,label:string)=>`[${label.replace(/[\\[\]]/g,'\\$&')}](<${path.replace(/[%<>?#]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}>)`;
const numberedSteps=(steps:readonly string[])=>steps.map((step,i)=>`${i+1}. ${step.replace(/^\s*\d+[.)]\s+/,'')}`).join('\n');
const link=(name:string,label?:string)=>{
  // Keep legacy note paths stable while presenting their generated labels in English.
  const legacy=/^(Attività|Piano|Integrazione|Review integrazione|Verifica integrazione|Lezione|Convenzione|Vincolo) (.+)$/.exec(basename(name));
  const names:Record<string,string>={'Attività':'Planned task','Piano':'Plan','Integrazione':'Integration','Review integrazione':'Integration review','Verifica integrazione':'Integration check','Lezione':'Lesson','Convenzione':'Convention','Vincolo':'Constraint'};
  const display=label??(legacy?`${names[legacy[1]]} ${legacy[2]}`:undefined);
  return `[[${name}${display?`|${display}`:''}]]`;
};
const sentence=(value:string)=>{const text=value.trim();return !text||/[.!?]$/.test(text)?text:`${text}.`};
const natural=(values:readonly string[],empty:string)=>values.length===0?empty:values.length===1?values[0]:values.length===2?`${values[0]} and ${values[1]}`:`${values.slice(0,-1).join(', ')} and ${values.at(-1)}`;
const paragraphs=(values:readonly string[],empty:string)=>values.length?values.map(sentence).join('\n\n'):empty;
const unique=(values:readonly string[])=>[...new Set(values.map(value=>value.trim()).filter(Boolean))];
const designRationaleFrom=(summary:string):string|undefined=>{
  const match=/(?:Design rationale|Scelte di progettazione):\s*(.+)$/is.exec(summary);
  const value=match?.[1].replace(/\s+/g,' ').trim();return value||undefined;
};
const ordinal=(value:number)=>String(value);
const lowerInitial=(value:string)=>/^[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]/u.test(value)?`${value[0].toLocaleLowerCase('en')}${value.slice(1)}`:value;
const narrativePurpose=(value:string)=>{
  const prefix="Collect technical evidence for ";
  return value.startsWith(prefix)?`${prefix}${lowerInitial(value.slice(prefix.length))}`:value;
};
const narrativeInput=(value:string)=>value==="Current candidate identified by digest and generation"
  ?"the current candidate copy, identified by its digest and generation":lowerInitial(value);
const criterionObject=(values:readonly string[])=>values.length===1?`criterion “${sentence(values[0]).replace(/[.]$/,'')}”`
  :`criteria ${natural(values.map(value=>`“${sentence(value).replace(/[.]$/,'')}”`),'')}`;
const criterionPurpose=(values:readonly string[])=>`The scenario checks ${criterionObject(values)}.`;
const resultText=(result:ScenarioRun['result'])=>result==='PASS'?"succeeded"
  :result==='FAIL'?"failed":"did not produce a conclusive outcome";
const stateText=(state:string)=>state==='COMPLETED'?"Work is complete: the required checks, independent review and final confirmation are recorded."
  :state==='BLOCKED'?"Work is blocked. Before continuing, examine the open problem identified in the evidence or decisions."
  :state==='AWAITING_HUMAN'?"Automated checks reached a point that requires an explicit decision from the responsible person."
  :state==='REVIEWING'?"The candidate is undergoing independent review. A technical result exists, but the task is not complete yet."
  :state==='REWORK'?"The checks revealed a problem, and the work returned for correction."
  :state==='TESTING'?"The change is available in the candidate copy, and the planned checks are running."
  :state==='IMPLEMENTING'?"The Developer is preparing the change in the candidate copy, a workspace isolated from the original."
  :state==='READY'?"Analysis is complete, and the task is ready for implementation, subject to the required confirmations."
  :state==='ANALYZING'?"The Scout is analyzing the objective, scope and prerequisites before implementation."
  :state==='FAILED'?"The task ended without completion. The notes preserve the evidence explaining the outcome."
  :"The task has been created and is waiting for the controlled workflow to start.";
const decisionLabel=(kind:DecisionRecord['kind'])=>({ACCEPT_FINDING:"accept the reported issue",DISMISS_FINDING:"reject the reported issue",
  DEFER_RISK:"defer handling the risk",RESOLVE_RISK:"consider the risk resolved",ADOPT_ADVICE:"adopt the advice received",
  REJECT_ADVICE:"decline the advice received",RESOLVE_AMBIGUITY:"resolve the ambiguity"}[kind]);
const decisionAlternative=(kind:DecisionRecord['kind'])=>({ACCEPT_FINDING:"The rejected alternative was to dismiss the issue without correcting it or explicitly accepting its consequences.",
  DISMISS_FINDING:"The rejected alternative was to accept the issue as grounds for stopping or correcting the work.",
  DEFER_RISK:"The rejected alternative was to resolve the risk immediately before proceeding.",RESOLVE_RISK:"The rejected alternative was to leave the risk open or defer handling it.",
  ADOPT_ADVICE:"The rejected alternative was to decline the advice received.",REJECT_ADVICE:"The rejected alternative was to adopt the advice received.",
  RESOLVE_AMBIGUITY:"The rejected alternative was to leave the question without an actionable answer."}[kind]);
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function asRuntimeEvidence(value:unknown):RuntimeEvidence|undefined{
  if(!isObject(value)||value.schemaVersion!==1||typeof value.id!=='string'||typeof value.scenarioId!=='string'||typeof value.summary!=='string'
    ||!Array.isArray(value.importantObservations)||!isObject(value.diagnosis)||!Array.isArray(value.diagnosis.observed)
    ||!Array.isArray(value.diagnosis.inferred)||!Array.isArray(value.diagnosis.unknown))return undefined;
  return value as unknown as RuntimeEvidence;
}
function asRuntimeComparison(value:unknown):RuntimeComparison|undefined{
  if(!isObject(value)||value.schemaVersion!==1||typeof value.scenarioId!=='string'||!isObject(value.before)||!isObject(value.after)
    ||!Array.isArray(value.eventTypeChanges)||!Array.isArray(value.metricChanges)||!Array.isArray(value.residualAnomalies)
    ||!['RESOLVED','PERSISTS','UNKNOWN'].includes(String(value.conclusion)))return undefined;
  return value as unknown as RuntimeComparison;
}
function frontmatter(properties:Readonly<Record<string,string|number|readonly string[]>>):string{
  const lines=['---'];for(const [key,value] of Object.entries(properties)){
    if(Array.isArray(value)){lines.push(`${key}:`);for(const item of value)lines.push(`  - ${yaml(item)}`)}else lines.push(`${key}: ${yaml(value as string|number)}`);
  }return lines.concat('---','').join('\n');
}
function atomic(path:string,content:string):void{
  mkdirSync(dirname(path),{recursive:true});const temp=`${path}.tmp`;
  writeFileSync(temp,content.endsWith('\n')?content:`${content}\n`);renameSync(temp,path);
}
function artifactBytes(taskRoot:string,ref:ArtifactRef):Uint8Array{
  if(ref.relativeStorePath!==`artifacts/${ref.id}`)throw new Error('HUMAN_PROJECTION_ARTIFACT_PATH');
  const raw=readFileSync(join(taskRoot,ref.relativeStorePath));
  if(raw.byteLength!==ref.bytes||hashBytes(raw)!==ref.digest)throw new Error('HUMAN_PROJECTION_ARTIFACT_INTEGRITY');return raw;
}
function artifactJson(taskRoot:string,record:ContextRecord&{kind:'ArtifactRef'}):unknown{return parseJson(artifactBytes(taskRoot,record.value),8*1024*1024)}
function vaultDirectory(root:string,path:string):void {
  const rel=relative(root,path);if(resolve(root)!==root||rel.startsWith('..')||rel.startsWith('/'))throw new Error('HUMAN_PROJECTION_PATH_INVALID');
  if(!existsSync(root)){if(realpathSync(dirname(root))!==dirname(root))throw new Error('HUMAN_PROJECTION_PATH_INVALID');mkdirSync(root)}
  let current=root;
  const check=()=>{const stat=lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(current)!==current)throw new Error('HUMAN_PROJECTION_PATH_INVALID')};check();
  for(const part of rel.split('/').filter(Boolean)){current=join(current,part);if(!existsSync(current))mkdirSync(current);check()}
}
function vaultFile(root:string,path:string):void {
  vaultDirectory(root,dirname(path));
  for(const target of [path,path+'.tmp'])try{const stat=lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||realpathSync(target)!==target)throw new Error('HUMAN_PROJECTION_PATH_INVALID')}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error}
}
function managed(path:string,content:string,files:string[],vaultRoot:string):void{vaultFile(vaultRoot,path);atomic(path,content);files.push(path.slice(vaultRoot.length+1))}
function humanNotes(vaultRoot:string,kind:string,id:string,files:string[]):string{
  const name=noteName.notes(kind,id),path=join(vaultRoot,'Notes',`${name}.md`);
  vaultFile(vaultRoot,path);
  if(!existsSync(path)){atomic(path,`${frontmatter({type:'controlled-human-notes',id:`${kind}-${id}`,tags:['controlled-dev/human-notes']})}# Personal notes\n\nThis space is yours. Automatic regeneration does not modify this file.\n`);files.push(path.slice(vaultRoot.length+1))}
  return name;
}
function base(folder:string,type:string,title:string):string{return `filters:\n  and:\n    - 'file.inFolder("${folder}")'\n    - 'type == "${type}"'\nproperties:\n  status:\n    displayName: "Status"\n  updated:\n    displayName: "Updated"\nviews:\n  - type: table\n    name: "${title}"\n    order:\n      - file.name\n      - status\n      - updated\n`;}

/** Rebuilds only the human projection. Structured records remain the sole authority. */
export function rebuildHumanView(taskRoot:string,options:{readonly machineDataRoot?:string}={}):HumanProjectionResult{
  const ledger=DurableStore.load(taskRoot),taskId=ledger.state.taskId,projectRoot=dirname(dirname(taskRoot)),files:string[]=[];
  const specRecord=ledger.records.find(record=>record.kind==='TaskSpec'&&record.id===ledger.state.spec.id);
  if(specRecord?.kind!=='TaskSpec')throw new Error('HUMAN_PROJECTION_SPEC_MISSING');
  const spec=specRecord.value as TaskSpec,vaultRoot=assertHumanVaultLocation(projectRoot,spec.scope.repoRoot);
  const physicalRepo=physicalProjectRootForTask(taskRoot,spec.scope.repoRoot,ledger),legacyData=dirname(dirname(dirname(projectRoot))),machineData=options.machineDataRoot??legacyData;
  if(projectRoot===join(physicalRepo,'.controlled-dev','state','controlled-dev','projects',basename(projectRoot))&&!options.machineDataRoot)throw new Error('HUMAN_PROJECTION_CONTEXT_REQUIRED');
  const placement=resolveProjectStorage(machineData,physicalRepo);
  if(placement.projectRoot!==projectRoot||placement.custodian&&!options.machineDataRoot)throw new Error('HUMAN_PROJECTION_CONTEXT_REQUIRED');
  for(const folder of folders)vaultDirectory(vaultRoot,join(vaultRoot,folder));
  const promotion=CandidatePromotionRepository.open(machineData,physicalRepo,()=> 'ACCEPT');
  const integration=promotion?.binding(taskId)?promotion.status(taskId):undefined;
  const integrationText=integration?`## Project integration\n\n${integration.explanation}\n\nDestination: \`${integration.binding!.targetRef.slice('refs/heads/'.length)}\`. The original folder remains the official project. ${integration.baselineReady?"The result is available to dependent tasks.":"Your approval will authorize the package to perform the exact prepared integration locally."}\n\n${integration.proposal?`The proposal and evidence are in [[Promotions/Integrazione ${safeId(taskId)}|Project integration]].\n\n`:''}`:'';
  if(promotion)files.push(...rebuildCandidatePromotionView(promotion));
  const artifacts=ledger.records.filter((record):record is ContextRecord&{kind:'ArtifactRef'}=>record.kind==='ArtifactRef');
  const scenarios=artifacts.filter(record=>record.value.mediaType===SCENARIO_MEDIA_TYPE).map(record=>artifactJson(taskRoot,record)).filter(validateExecutableScenario).sort((a,b)=>a.scenarioId.localeCompare(b.scenarioId));
  const runs=artifacts.filter(record=>record.value.mediaType===SCENARIO_RUN_MEDIA_TYPE).map(record=>artifactJson(taskRoot,record)).filter(validateScenarioRun)
    .sort((a,b)=>a.scenarioId.localeCompare(b.scenarioId)||a.candidateGeneration-b.candidateGeneration||a.startedAt.localeCompare(b.startedAt)||a.runId.localeCompare(b.runId));
  const bundles=artifacts.filter(record=>record.value.mediaType===EVIDENCE_BUNDLE_MEDIA_TYPE).map(record=>artifactJson(taskRoot,record)).filter(validateTechnicalEvidenceBundle).sort((a,b)=>a.bundleId.localeCompare(b.bundleId));
  const reviews=ledger.records.filter((record):record is ContextRecord&{kind:'ReviewResult'}=>record.kind==='ReviewResult').map(record=>record.value as ReviewResult).sort((a,b)=>a.assignmentId.localeCompare(b.assignmentId));
  const developerResults=ledger.records.filter((record):record is ContextRecord&{kind:'DeveloperResult'}=>record.kind==='DeveloperResult').map(record=>record.value as DeveloperResult);
  const decisions=ledger.records.filter((record):record is ContextRecord&{kind:'DecisionRecord'}=>record.kind==='DecisionRecord').map(record=>record.value as DecisionRecord).sort((a,b)=>a.id.localeCompare(b.id));
  const runtimeEvidence=new Map<string,RuntimeEvidence>(),comparisons=new Map<string,RuntimeComparison>();
  for(const record of artifacts){
    if(record.value.mediaType==='application/vnd.pi-controlled-dev.runtime-evidence+json'){const value=asRuntimeEvidence(artifactJson(taskRoot,record));if(value)runtimeEvidence.set(record.id,value)}
    if(record.value.mediaType==='application/vnd.pi-controlled-dev.runtime-comparison+json'){const value=asRuntimeComparison(artifactJson(taskRoot,record));if(value)comparisons.set(record.id,value)}
  }
  const criteria=new Map(spec.acceptanceCriteria.map(value=>[value.id,value])),scenarioById=new Map(scenarios.map(value=>[value.scenarioId,value]));
  const runsFor=(scenario:ExecutableScenario)=>runs.filter(value=>value.scenarioHash===scenario.scenarioHash);
  const planningContext=ProjectPlanningRepository.open(machineData,physicalRepo,()=> 'ACCEPT');
  const plannedExecution=planningContext?.links().find(execution=>execution.controlledTaskId===taskId);
  const approvedPlan=plannedExecution&&planningContext?.history().find(plan=>plan.planId===plannedExecution.planId&&plan.revision===plannedExecution.planRevision&&plan.contentDigest===plannedExecution.planDigest);
  const plannedPoint=approvedPlan?.plannedTasks.find(point=>point.plannedTaskId===plannedExecution!.plannedTaskId);
  const textKey=(text:string)=>text.normalize('NFC').trim().replace(/\s+/g,' ').replace(/[.!?]+$/,'');
  const distinctDescription=unique([spec.objective,...spec.requirements.map(requirement=>requirement.text)]).filter(text=>textKey(text)!==textKey(spec.title));
  const firstCriterion=!distinctDescription.length?spec.acceptanceCriteria.find(criterion=>textKey(criterion.text)!==textKey(spec.title)):undefined;
  const what=distinctDescription.length?paragraphs(distinctDescription,''):firstCriterion?sentence(firstCriterion.text):"The title and scope below describe the work; the records provide no separate description.";
  const motivation=plannedPoint?.rationale&&![spec.title,spec.objective,...distinctDescription,firstCriterion?.text??''].some(text=>textKey(text)===textKey(plannedPoint.rationale))?plannedPoint.rationale:undefined;
  const outcomeCriteria=spec.acceptanceCriteria.filter(criterion=>criterion!==firstCriterion);
  const verificationDescriptions=spec.validationCommands.map((command,index)=>`Automated check ${index+1}: ${natural(spec.acceptanceCriteria.filter(criterion=>criterion.commandIds.includes(command.id)).map(criterion=>criterion.text),"execution specified by the verification plan")}.`);
  const hasReview=spec.acceptanceCriteria.some(criterion=>criterion.method==='REVIEW'||criterion.method==='BOTH');
  const taskLink=noteName.task(taskId),taskNotes=humanNotes(vaultRoot,'task',taskId,files);
  const scenarioLinks=scenarios.map(value=>link(noteName.scenario(value.scenarioId),value.title));
  const evidenceLink=(value:TechnicalEvidenceBundle)=>link(noteName.evidence(value.bundleId),`evidence for ${scenarioById.get(value.scenarioId)?.title??"the technical scenario"}`);
  const reviewLink=(value:ReviewResult)=>link(noteName.review(value.assignmentId),`independent review with outcome ${value.verdict}`);
  const unresolved=scenarios.filter(value=>runsFor(value).at(-1)?.result!=='PASS');
  const blockingFindings=reviews.flatMap(value=>value.findings.filter(finding=>finding.blocking));
  const currentReason=projectExecutionReason(ledger.state);
  const blockedRun=ledger.state.state==='BLOCKED'&&ledger.state.blockedReason==='Developer reported a bounded blocker'
    ?ledger.state.runs.findLast(run=>run.role==='Developer'&&run.status==='TERMINAL'&&run.resultRef&&!ledger.state.invalidEvidenceIds.includes(run.resultRef)):undefined;
  const blockedResult=blockedRun?ledger.records.find(record=>record.id===blockedRun.resultRef&&record.kind==='DeveloperResult'
    &&record.value.assignmentId===blockedRun.assignmentId&&record.value.taskId===taskId&&record.value.specHash===spec.specHash):undefined;
  const developerBlock=blockedResult?.kind==='DeveloperResult'?blockedResult.value.blockedReason:undefined;
  const openProblems=[...(currentReason?[`Current reason for stopping: ${currentReason}`]:[]),
    ...(developerBlock?[`Reason given by the agent preparing the change: ${sentence(developerBlock)}`]:[]),
    ...unresolved.map(value=>`Scenario ${link(noteName.scenario(value.scenarioId),value.title)} does not yet have a successful latest execution.`),
    ...blockingFindings.map(value=>`The review reports an issue that is still blocking: ${sentence(value.text)}`)];
  const taskScenarioText=scenarios.length?`The required behavior is verified through ${natural(scenarioLinks,'')}. Each scenario describes a repeatable check and links to its executions.`
    :"No executable scenarios are available for this task yet.";
  const taskEvidenceText=bundles.length?`The collected evidence is explained in ${natural(bundles.map(evidenceLink),'')}. These notes connect observations to acceptance criteria without replacing the structured records.`
    :"No technical evidence has been collected for this task yet.";
  const designRationale=developerResults.map(value=>designRationaleFrom(value.summary)).filter((value):value is string=>!!value).at(-1);

  managed(join(vaultRoot,'Tasks',`${taskLink}.md`),`${frontmatter({type:'controlled-task',id:taskId,status:ledger.state.state,created:ledger.state.createdAt,updated:ledger.state.updatedAt,generation:ledger.state.candidate?.generation??0,tags:['controlled-dev/task']})}# ${spec.title}\n\n## What to do\n\n${what}\n\nSpecific scope: ${natural(spec.scope.allowedPaths.map(path=>existsSync(join(physicalRepo,path))?markdownFileLink(join(physicalRepo,path),path):"`"+path+"`"),"no authorized files")}.\n\n## Why it matters\n\n${motivation?`${sentence(motivation)}\n\nRationale recorded in the approved plan item linked to this task.`:"The records contain no additional rationale beyond the objective. This page describes the purpose and required result."}

${plannedPoint?.implementationSteps?.length?`## Planned steps\n\n${numberedSteps(plannedPoint.implementationSteps)}\n\nThis sequence belongs to the approved plan linked to the task; it does not certify that the steps have already been performed.\n\n`:''}\n\n## Work progress\n\n${stateText(ledger.state.state)}\n\nThe candidate copy is the isolated workspace where the Developer prepares changes without altering the original repository.${ledger.state.candidate?` The version currently under examination is generation ${ledger.state.candidate.generation} of this copy.`:" No candidate copy is available yet."}

${integrationText}\n## Parts of the project that may change\n\n${spec.scope.allowedPaths.length?`Changes are limited to ${natural(spec.scope.allowedPaths.map(value=>`\`${value}\``),'')}. The host rejects any change outside these paths.`:"The task does not authorize changes to project files."}${spec.scope.deniedPaths.length?` Explicitly excluded: ${natural(spec.scope.deniedPaths.map(value=>`\`${value}\``),'')}.`:''}\n\n## Expected result\n\n${list(outcomeCriteria.map(value=>sentence(value.text)),firstCriterion?"The operational criterion is described above under What to do.":"No readable acceptance criteria are available.")}\n\n## Planned checks\n\n${list(verificationDescriptions,"This TaskSpec specifies no automated verification commands.")}

${hasReview?"An independent review of the criteria described above is planned.":"Verification methods for the criteria are preserved in the TaskSpec."} Planned checks are not outcomes: actual results appear in the evidence and review.\n\n${designRationale?`## Design choices\n\n${sentence(designRationale)}\n\nThis explanation comes from the Developer's structured summary. It describes the observed choice but does not replace technical evidence or the Reviewer's independent judgment.\n\n`:''}## Available scenarios\n\n${taskScenarioText}\n\n## Available evidence\n\n${taskEvidenceText}\n\n## Review and decisions\n\n${reviews.length?`The independent assessment is documented in ${natural(reviews.map(reviewLink),'')}. The Reviewer checks the candidate, evidence and scope without changing code.`:"The independent review is not available yet."}

${decisions.length?`Choices recorded during the work are explained in ${natural(decisions.map(value=>link(noteName.decision(value.id),`decision: ${decisionLabel(value.kind)}`)),'')}.`:"No decisions have been recorded to explain."}\n\n## Outstanding issues\n\n${openProblems.length?list(openProblems):"The structured data indicates no outstanding technical issues. This does not replace review or final confirmation."}\n\n## Personal notes\n\nYou may add observations in ${link(taskNotes,"this personal note")}. Automatic regeneration does not overwrite it.\n\n## Technical details\n\n- Task ID: \`${taskId}\`\n- Structured status: \`${ledger.state.state}\`\n- Recorded stop reason: ${ledger.state.state==='BLOCKED'?ledger.state.blockedReason??"unavailable":ledger.state.state==='FAILED'?ledger.state.terminalReason??"unavailable":"no current stop"}\n- Candidate generation: ${ledger.state.candidate?.generation??"unavailable"}
${integration?`- Candidate commit: ${integration.binding?.candidateCommit??"not frozen yet"}\n- Integration commit: ${integration.result?.integrationCommit??integration.proposal?.integrationCommit??"unavailable"}\n- Integration: ${integration.status}`:''}
`,files,vaultRoot);

  for(const scenario of scenarios){
    const scenarioRuns=runsFor(scenario),notes=humanNotes(vaultRoot,'scenario',scenario.scenarioId,files),criterionTexts=scenario.criterionIds.map(id=>criteria.get(id)?.text).filter((value):value is string=>!!value);
    const verifiedBehavior=criterionTexts.length?criterionPurpose(criterionTexts):sentence(narrativePurpose(scenario.purpose));
    const runNarrative=scenarioRuns.length?scenarioRuns.map((value,index)=>`The ${ordinal(index+1)} execution, ${link(noteName.run(value.runId),resultText(value.result))}, used generation ${value.candidateGeneration} of the candidate.`).join('\n\n')
      :"This scenario has not been executed yet.";
    managed(join(vaultRoot,'Scenarios',`${noteName.scenario(scenario.scenarioId)}.md`),`${frontmatter({type:'controlled-scenario',id:scenario.scenarioId,status:scenario.lifecycle,task:taskId,created:scenario.createdAt,updated:scenario.updatedAt,generation:scenario.version,tags:['controlled-dev/scenario']})}# Scenario — ${scenario.title}\n\n## Reproduced behavior\n\n${verifiedBehavior} The check is repeatable because it specifies preparation, inputs, expected results and the command authorized by the host.\n\n## Why it is useful\n\n${criterionTexts.length?`It collects technical evidence for ${criterionObject(criterionTexts)}.`:"This scenario provides an additional technical check. The available data does not link it to a specific acceptance criterion."}\n\n## Preparation\n\n${paragraphs(scenario.setup,"No additional preparation beyond the isolated candidate copy is required.")}\n\nDeclared inputs: ${natural(scenario.inputs.map(value=>narrativeInput(sentence(value).replace(/[.]$/,''))),"no descriptive inputs are available")}. Assumptions required to repeat the check: ${natural(scenario.repeatability.environmentAssumptions.map(value=>lowerInitial(sentence(value).replace(/[.]$/,''))),"no additional assumptions are available")}.\n\n## What runs\n\nThe host runs the approved check on the candidate copy. The actual command is bound to the structured scenario: editing this note cannot change it or introduce shell instructions.\n\n## Observations and expectations\n\n${paragraphs(scenario.expectedObservations,"There is not enough information to describe the expected result.")}\n\nThe result is useful only if the execution preserves the identity of the scenario and the specific approved command, keeping repeated checks comparable.\n\n## Documented executions\n\n${runNarrative}\n\n## Links\n\nThis scenario belongs to ${link(taskLink,"main task")}. Personal observations can be added in ${link(notes,"a separate note")}.\n\n## Technical details\n\n- Scenario ID: \`${scenario.scenarioId}\`\n- Version: ${scenario.version}
- Lifecycle: \`${scenario.lifecycle}\`\n- Scenario hash: \`${scenario.scenarioHash}\`
- Command ID: \`${scenario.execution.commandId}\`\n- Command hash: \`${scenario.execution.commandHash}\`
- Criterion ID: ${scenario.criterionIds.length?scenario.criterionIds.map(value=>`\`${value}\``).join(', '):"none"}
`,files,vaultRoot);
  }

  for(const run of runs){
    const scenario=scenarioById.get(run.scenarioId),scenarioRuns=scenario?runsFor(scenario):runs.filter(value=>value.scenarioId===run.scenarioId),index=Math.max(0,scenarioRuns.findIndex(value=>value.runId===run.runId));
    const prior=index>0?scenarioRuns[index-1]:undefined,evidence=bundles.filter(value=>value.runIds.includes(run.runId)),notes=humanNotes(vaultRoot,'run',run.runId,files);
    const runtime=run.runtimeEvidenceRefs.map(value=>runtimeEvidence.get(value)).filter((value):value is RuntimeEvidence=>!!value);
    const observations=unique(runtime.flatMap(value=>[value.summary,...value.importantObservations,...value.diagnosis.observed.filter(row=>!/^Processo:\s*(PASSED|FAILED|BLOCKED)[.]?$/i.test(row))]));
    const interpretations=unique(runtime.flatMap(value=>value.diagnosis.inferred)),unknowns=unique(runtime.flatMap(value=>value.diagnosis.unknown));
    const resultCallout=run.result==='PASS'?"> [!success] Execution result\n> The check completed successfully.":run.result==='FAIL'?"> [!failure] Execution result\n> The check reproduced a problem and failed.":"> [!warning] Execution result\n> The evidence does not support a conclusive outcome.";
    const repetition=prior?`This run repeats the same scenario after ${link(noteName.run(prior.runId),`execution ${ordinal(index)}`)}. The previous run ${resultText(prior.result)}; the full comparison, when available, is explained in the Evidence note.`
      :"This is the first documented execution of the scenario, providing the starting point for later comparisons.";
    managed(join(vaultRoot,'Runs',`${noteName.run(run.runId)}.md`),`${frontmatter({type:'controlled-run',id:run.runId,status:run.result,task:taskId,scenario:run.scenarioId,created:run.startedAt,updated:run.endedAt,generation:run.candidateGeneration,tags:['controlled-dev/run']})}# Run — ${scenario?.title??run.scenarioId}\n\n## Result\n\n${resultCallout}\n\n## What happened\n\nThis is execution ${ordinal(index+1)} of scenario ${link(noteName.scenario(run.scenarioId),scenario?.title??"linked")}. The check ran on generation ${run.candidateGeneration} of the candidate copy and ${resultText(run.result)}.

${repetition}\n\n## Observations\n\n${paragraphs(observations,"The store records the check's outcome but contains no additional narrative observations for this execution.")}\n\n## Technical interpretation\n\n${paragraphs(interpretations,run.result==='FAIL'?"The events confirm failure, but there is not enough information to determine its technical cause.":"No additional technical interpretation beyond the observations was recorded.")}\n\n## What remains uncertain\n\n${paragraphs(unknowns,run.result==='BLOCKED'?"There is not enough information to determine a reliable outcome.":"The structured data indicates no further uncertainties for this execution.")}\n\n## Where to go next\n\n${evidence.length?`The meaning of the collected evidence is explained in ${natural(evidence.map(evidenceLink),'')}.`:"An Evidence note interpreting this execution is not available yet."} You may add personal observations in ${link(notes,"this separate note")}.\n\n## Technical details\n\n- Run ID: \`${run.runId}\`
- Scenario ID: \`${run.scenarioId}\`\n- Scenario version: ${run.scenarioVersion}\n- Candidate generation: ${run.candidateGeneration}
- Candidate digest: \`${run.candidateDigest}\`\n- Command hash: \`${run.commandHash}\`
- Validation result: ${run.validationResultRefs.map(value=>`\`${value}\``).join(', ')}
- Runtime evidence: ${run.runtimeEvidenceRefs.map(value=>`\`${value}\``).join(', ')}
- Artifact: ${run.artifactRefs.length?run.artifactRefs.map(value=>`\`${value}\``).join(', '):"none"}
`,files,vaultRoot);
  }

  for(const bundle of bundles){
    const scenario=scenarioById.get(bundle.scenarioId),bundleRuns=runs.filter(value=>bundle.runIds.includes(value.runId)).sort((a,b)=>a.candidateGeneration-b.candidateGeneration||a.startedAt.localeCompare(b.startedAt)||a.runId.localeCompare(b.runId));
    const first=bundleRuns.at(0),last=bundleRuns.at(-1),comparison=bundle.beforeAfterComparisonRef?comparisons.get(bundle.beforeAfterComparisonRef):undefined;
    const linkedReviews=reviews.filter(review=>review.evidenceRefs.includes(bundle.bundleId)||bundle.reviewerResultRef===review.assignmentId),notes=humanNotes(vaultRoot,'evidence',bundle.bundleId,files);
    const bundleCriterionTexts=bundle.criterionEvidence.map(value=>criteria.get(value.criterionId)?.text).filter((value):value is string=>!!value);
    const evidencePurpose=bundleCriterionTexts.length?criterionPurpose(bundleCriterionTexts)
      :scenario?sentence(narrativePurpose(scenario.purpose)):"There is not enough information to further describe the scenario's purpose.";
    const criterionNarrative=bundle.criterionEvidence.map(value=>{const text=criteria.get(value.criterionId)?.text??"a criterion not described in the current view";return `For “${text}”, the technical evidence is **${value.status}**.`});
    const observed=bundleRuns.map((value,index)=>`${link(noteName.run(value.runId),`execution ${ordinal(index+1)}`)} used generation ${value.candidateGeneration} of the candidate and ${resultText(value.result)}.`);
    let changed:string;
    if(bundle.beforeAfterComparisonRef&&first&&last&&first.runId!==last.runId){
      const details=unique([...(comparison?.metricChanges??[]),...(comparison?.eventTypeChanges??[])]);
      changed=`In the first run the check's outcome was **${first.result}** on generation ${first.candidateGeneration}; after correction, the same scenario ran on generation ${last.candidateGeneration} with outcome **${last.result}**.

${details.length?`The structured comparison records ${natural(details.map(value=>`the change \`${value}\``),'')}.`:"The record confirms the before/after comparison but contains no more specific narrative values to display."}\n\nBoth executions use the same scenario version and approved command, making the comparison meaningful: a different test was not selected after the correction.`;
    }else changed="There is not enough information to describe a before/after change: this bundle contains only one comparable execution.";
    const conclusion=last?.result==='PASS'?"The available evidence shows that the latest scenario execution satisfied the planned technical check."
      :last?.result==='FAIL'?"The available evidence shows that the problem remains reproducible in the latest execution.":"The available evidence does not support a reliable technical conclusion.";
    const resultCallout=last?.result==='PASS'?"> [!success] Summary\n> The latest available execution passed and has attributed technical evidence.":last?.result==='FAIL'?"> [!failure] Summary\n> The latest available execution failed; the problem remains visible in the evidence.":"> [!warning] Summary\n> The collected evidence does not support a conclusive outcome.";
    managed(join(vaultRoot,'Evidence',`${noteName.evidence(bundle.bundleId)}.md`),`${frontmatter({type:'controlled-evidence',id:bundle.bundleId,status:observedStatus(last?.result??'BLOCKED'),task:taskId,scenario:bundle.scenarioId,created:bundle.createdAt,updated:bundle.createdAt,generation:last?.candidateGeneration??0,tags:['controlled-dev/evidence']})}# Evidence — ${scenario?.title??bundle.scenarioId}\n\n## What we are trying to demonstrate\n\nThis note interprets the evidence produced by scenario ${link(noteName.scenario(bundle.scenarioId),scenario?.title??"linked")}. ${evidencePurpose}

${paragraphs(criterionNarrative,"The bundle contains no explicit link to acceptance criteria.")}\n\n## Result\n\n${resultCallout}\n\n## Observations\n\n${paragraphs(observed,"No readable executions linked to this evidence are available.")}\n\n## What changed\n\n${changed}\n\n## Why the result matters\n\n${bundle.beforeAfterComparisonRef?"Compatible scenario, command and generation identities allow the change to be attributed more reliably to the subsequent candidate. The comparison remains technical evidence limited to this scenario.":"This evidence documents a specific technical result. Without a second compatible run, we cannot describe a before/after progression."}\n\n## What we can conclude\n\n${conclusion}

${paragraphs(criterionNarrative,"No separate conclusion for each criterion is available.")}\n\n## What we cannot conclude\n\n> [!warning] Evidence limitation\n> This note demonstrates the behavior observed in the scenario. It does not automatically prove broader system requirements, replace the Reviewer's judgment or complete the task.\n\n## Limitations and residual risks\n\n${bundle.residualTechnicalRisks.length?paragraphs(bundle.residualTechnicalRisks,''):"No specific residual technical risks were recorded in the bundle. This only means that the store lists no others; it does not justify concluding that every possible risk has been excluded."}\n\n## Where to go next\n\nThis evidence belongs to ${link(taskLink,"main task")}.${linkedReviews.length?` It was considered in ${natural(linkedReviews.map(reviewLink),'')}.`: " It is not linked to a readable review yet."} Personal notes can be added in ${link(notes,"this separate note")}.\n\n## Technical details\n\n- Bundle ID: \`${bundle.bundleId}\`
- Scenario ID: \`${bundle.scenarioId}\`\n- Scenario hash: \`${bundle.scenarioHash}\`
- Run ID: ${bundle.runIds.map(value=>`\`${value}\``).join(', ')}
- Validation result: ${bundle.validationResultRefs.map(value=>`\`${value}\``).join(', ')}
- Runtime evidence: ${bundle.runtimeEvidenceRefs.map(value=>`\`${value}\``).join(', ')}\n- Before/after comparison: ${bundle.beforeAfterComparisonRef?`\`${bundle.beforeAfterComparisonRef}\``:"unavailable"}
- Patch: ${bundle.patchRef?`\`${bundle.patchRef}\``:"unavailable"}\n- Evidence by criterion: ${bundle.criterionEvidence.map(value=>`\`${value.criterionId}\` → ${value.evidenceRefs.map(ref=>`\`${ref}\``).join(', ')}`).join('; ')||"none"}
`,files,vaultRoot);
  }

  for(const review of reviews){
    const notes=humanNotes(vaultRoot,'review',review.assignmentId,files),considered=bundles.filter(value=>review.evidenceRefs.includes(value.bundleId));
    const criterionRows=review.criteria.map(value=>{const criterion=criteria.get(value.criterionId)?.text??"Criterion not described in the current view";return `For “${criterion}”, the Reviewer recorded **${value.assessment.status}**: ${sentence(value.assessment.reason)}`});
    const verdictReason=review.verdict==='PASS'?"The Reviewer returned PASS because the examined criteria, scope, tests and actual changes are consistent with the attributed evidence."
      :review.verdict==='FAIL'?"The Reviewer returned FAIL because at least one issue or negative assessment prevents approval of the candidate."
      :"The Reviewer returned BLOCKED because the available information does not support a complete technical verdict.";
    const resultCallout=review.verdict==='PASS'?"> [!success] Review outcome\n> The independent review approved the examined candidate.":review.verdict==='FAIL'?"> [!failure] Review outcome\n> The independent review did not approve the candidate.":"> [!warning] Review outcome\n> The independent review lacks enough evidence to conclude.";
    managed(join(vaultRoot,'Reviews',`${noteName.review(review.assignmentId)}.md`),`${frontmatter({type:'controlled-review',id:review.assignmentId,status:review.verdict,task:taskId,created:ledger.state.updatedAt,updated:ledger.state.updatedAt,generation:review.candidateGeneration,tags:['controlled-dev/review']})}# Review — ${spec.title}\n\n## Outcome\n\n${resultCallout}

${verdictReason}\n\n## What the Reviewer examined\n\nThe Reviewer is independent and read-only. It compared generation ${review.candidateGeneration} of the candidate with the task criteria, scope boundaries, check results and actual changes.\n\nAutomated verification alone was not considered sufficient: the verdict also covers the relevance of the evidence, scope compliance and consistency between reported and actual changes.\n\n## Evidence considered\n\n${considered.length?`The Reviewer consulted ${natural(considered.map(evidenceLink),'')}.`:"The records contain technical review references, but there is not enough information to link them to an Evidence note available in this view."}

${paragraphs(criterionRows,"No narrative assessments of individual criteria are available.")}\n\n## Reasons for this outcome\n\n- Scope: ${sentence(review.scopeAssessment.reason)}
- Test: ${sentence(review.testAssessment.reason)}\n- Actual changes: ${sentence(review.actualChangesAssessment.reason)}

${verdictReason}\n\n## Issues found\n\n${review.findings.length?list(review.findings.map(value=>`${value.blocking?"Blocking issue":"Non-blocking observation"}: ${sentence(value.text)}`)):"The Reviewer recorded no specific issues."}\n\n## Residual risks\n\n${review.residualRisks.length?paragraphs(review.residualRisks.map(value=>value.text),''):"No specific residual risks were recorded. This does not extend the verdict beyond the candidate and evidence actually examined."}\n\n## Where to go next\n\nThe review belongs to ${link(taskLink,"main task")}.${considered.length?` You can return to the evidence through ${natural(considered.map(evidenceLink),'')}.`:''} Personal notes can be added in ${link(notes,"this separate note")}.\n\n## Technical details\n\n- Assignment ID: \`${review.assignmentId}\`
- Attempt ID: \`${review.attemptId}\`\n- Structured verdict: \`${review.verdict}\`\n- Candidate generation: ${review.candidateGeneration}
- Reviewed tree hash: \`${review.reviewedTreeHash}\`
- Validation result: ${review.validationResultIds.map(value=>`\`${value}\``).join(', ')}
- Evidence ref: ${review.evidenceRefs.map(value=>`\`${value}\``).join(', ')||"none"}\n\nThis note is a readable explanation; the authoritative verdict remains in the Reviewer's structured record.\n`,files,vaultRoot);
  }

  for(const decision of decisions){
    const notes=humanNotes(vaultRoot,'decision',decision.id,files),relatedBundles=bundles.filter(value=>decision.evidenceRefs.includes(value.bundleId)),relatedReviews=reviews.filter(value=>decision.evidenceRefs.includes(value.assignmentId));
    const considered=[...relatedBundles.map(evidenceLink),...relatedReviews.map(reviewLink)];
    managed(join(vaultRoot,'Decisions',`${noteName.decision(decision.id)}.md`),`${frontmatter({type:'controlled-decision',id:decision.id,status:decision.kind,task:taskId,created:ledger.state.updatedAt,updated:ledger.state.updatedAt,tags:['controlled-dev/decision']})}# Decision — ${decisionLabel(decision.kind)}\n\n## Context\n\nAn explicit choice had to be recorded during the work so the workflow could determine how to handle an issue, risk, advice or ambiguity. The decision remains separate from technical evidence: it cannot make a test PASS or replace the Reviewer.\n\n## Decision\n\nThe decision was to **${decisionLabel(decision.kind)}**.\n\n## Reason\n\n${sentence(decision.reason)}\n\n## Consequences\n\nThe workflow can apply this choice only through the verified structured record. This page preserves the meaning of the decision over time, but editing it does not change the recorded authority.\n\n## Elements considered\n\n${considered.length?`The decision is linked to ${natural(considered,'')}.`:"The records preserve technical references, but there is not enough information to link them to an Evidence or Review note available in this view."}\n\n## Rejected alternative\n\n${decisionAlternative(decision.kind)}\n\n## Where to go next\n\nThe decision belongs to ${link(taskLink,"main task")}. Personal notes can be added in ${link(notes,"this separate note")}.\n\n## Technical details\n\n- Decision ID: \`${decision.id}\`\n- Type: \`${decision.kind}\`
- Subject ID: \`${decision.subjectId}\`
- Evidence ref: ${decision.evidenceRefs.map(value=>`\`${value}\``).join(', ')}
- Human gate ID: ${decision.humanGateId?`\`${decision.humanGateId}\``:"not present"}
`,files,vaultRoot);
  }

  const bases=[['Tasks','controlled-task','Task'],['Scenarios','controlled-scenario','Scenari'],['Runs','controlled-run','Esecuzioni'],['Evidence','controlled-evidence','Evidenze'],['Reviews','controlled-review','Review']] as const;
  for(const [folder,type,title] of bases)managed(join(vaultRoot,'Indexes',`${title}.base`),base(folder,type,title),files,vaultRoot);
  const taskFiles=readdirSync(join(vaultRoot,'Tasks')).filter(value=>value.endsWith('.md')).sort();
  managed(join(vaultRoot,'Home.md'),`${frontmatter({type:'controlled-home',id:'controlled-dev-home',status:'active',updated:ledger.state.updatedAt,tags:['controlled-dev/home']})}# Controlled Dev\n\nThis repository explains work performed with pi-controlled-dev in a form intended for people. JSON data preserves the workflow's facts and authority; these notes explain what happened, why it matters and which conclusions the evidence supports.\n\n## Where to start\n\nStart with ${link(taskLink,spec.title)}. The note presents the objective, work status, permitted areas of change and criteria to satisfy. Follow its links to scenarios, executions, evidence and reviews.\n\nA **scenario** describes a repeatable check. A **run** is a specific execution of it. An **Evidence** note interprets the collected evidence, while the **Review** explains the independent judgment of the candidate.\n\n## Work status\n\n${stateText(ledger.state.state)}

${taskFiles.length>1?`Available tasks: ${natural(taskFiles.map(value=>link(value.slice(0,-3))),'')}.`:`Available task: ${link(taskLink,spec.title)}.`}\n\n## Scenarios and results\n\n${scenarios.length?`Documented: ${scenarios.length} scenarios: ${natural(scenarioLinks,'')}. Each Scenario page links to executions showing the observed behavior.`:"No documented scenarios are available yet."}

${bundles.length?`Technical conclusions are collected in ${natural(bundles.map(evidenceLink),'')}.`:"No Evidence notes are available yet."}\n\n## Review and decisions\n\n${reviews.length?`The independent assessment is available in ${natural(reviews.map(reviewLink),'')}.`:"The independent review is not available yet."} ${decisions.length?`Recorded decisions are explained in ${natural(decisions.map(value=>link(noteName.decision(value.id),decisionLabel(value.kind))),'')}.`:"There are no decisions to consult."}\n\n## Open issues\n\n${openProblems.length?list(openProblems):"The structured data indicates no outstanding technical issues. Consult Evidence and Review for limitations and residual risks."}\n\n## Indexes\n\nBase views let you filter notes without changing authoritative content:\n\n- [[Indexes/Task.base|Tasks]] shows task status;\n- [[Indexes/Scenari.base|Scenarios]] lists repeatable checks;\n- [[Indexes/Esecuzioni.base|Executions]] shows individual runs;\n- [[Indexes/Evidenze.base|Evidence]] collects technical conclusions;\n- [[Indexes/Review.base|Reviews]] shows independent review outcomes.\n\nPersonal notes are in \`Notes/\` and are not deleted during regeneration.\n`,files,vaultRoot);
  if(existsSync(join(projectRoot,'memory'))){
    const memory=ProjectMemoryRepository.open(machineData,physicalRepo,()=> 'ACCEPT');
    if(memory)files.push(...rebuildProjectMemoryView(memory));
  }
  const receipts=artifacts.filter(r=>r.value.mediaType===MEMORY_RECEIPT_MEDIA).map(r=>artifactJson(taskRoot,r) as any);
  if(receipts.length){
    const supplied=receipts.filter(r=>r.delivery==='PROVIDER_ACKNOWLEDGED');
    const text=supplied.map(r=>`The ${r.role} received ${r.records.length?r.records.map((m:any)=>`[[${memoryNoteName(m.recordId)}|memory ${m.recordId}]], revision ${m.revision}, digest \`${m.digest}\``).join('; '):"an empty memory context"}.`).join('\n\n');
    const path=join(vaultRoot,'Tasks',`${taskLink}.md`);vaultFile(vaultRoot,path);
    atomic(path,readFileSync(path).toString('utf8')+`\n## Memories that influenced the work\n\n${text}\n\nReceipts describe the context supplied at dispatch. They do not certify the agent's understanding or compliance.\n`);
  }
  if(planningContext)files.push(...rebuildProjectPlanningView(planningContext));
  const result:Object={schemaVersion:1,status:'CURRENT',taskId,vaultRootRelative:basename(vaultRoot),files:[...files].sort(),sourceRevision:ledger.state.revision,sourceEventId:ledger.state.lastEventId};
  atomic(join(taskRoot,'human-projection.json'),canonicalize(result));
  return Object.freeze({status:'CURRENT',taskId,vaultRoot,files:Object.freeze([...files].sort())});
}


export function refreshHumanView(taskRoot:string,options:{readonly machineDataRoot?:string}={}):HumanProjectionResult{
  try{return rebuildHumanView(taskRoot,options)}catch(error){
    const taskId=basename(taskRoot),projectRoot=dirname(dirname(taskRoot)),reason=error instanceof Error?error.message:'HUMAN_PROJECTION_UNAVAILABLE';
    let vaultRoot=join(projectRoot,'human');try{const ledger=DurableStore.load(taskRoot),spec=ledger.records.find(r=>r.kind==='TaskSpec'&&r.id===ledger.state.spec.id);vaultRoot=humanVaultRoot(projectRoot,spec?.kind==='TaskSpec'?spec.value.scope.repoRoot:ledger.state.repoRoot)}catch{}
    try{atomic(join(taskRoot,'human-projection.json'),canonicalize({schemaVersion:1,status:'STALE',taskId,reason}))}catch{}
    return Object.freeze({status:'STALE',taskId,vaultRoot,files:Object.freeze([]),reason});
  }
}

export function shouldRefreshHumanView(event:{readonly kind:string;readonly targetState:string;readonly recordType?:string}):boolean{
  return event.kind==='CREATE'||['BLOCKED','COMPLETED','FAILED'].includes(event.targetState)
    ||['CANDIDATE_MATERIALIZED','VALIDATION_RECORDED','REVIEW_RECORDED','GATE_DECIDED','DECISION_RECORDED'].includes(event.recordType??'');
}

const memoryFolder=(kind:string)=>({'software-adr':'Architecture','technical-lesson':'Lessons','project-convention':'Conventions','technical-constraint':'Constraints'} as Record<string,string>)[kind];
const memoryNoteName=(id:string)=>`${id.startsWith('SAD-')?'ADR':id.startsWith('TL-')?'Lezione':id.startsWith('PC-')?'Convenzione':'Vincolo'} ${id}`;
/** Same human repository and helpers as task projection; Notes are never overwritten. */
export function rebuildProjectMemoryView(repo:ProjectMemoryRepository):readonly string[]{
  const vaultRoot=assertHumanVaultLocation(repo.projectRoot,repo.repoRoot),files:string[]=[],entries=repo.entries();
  for(const folder of ['Architecture','Lessons','Conventions','Constraints','Indexes','Notes'])vaultDirectory(vaultRoot,join(vaultRoot,folder));
  for(const {record,staleEvidence} of entries){
    const notes=humanNotes(vaultRoot,'memory',record.recordId,files);
    const evidence=record.evidenceRefs.map(e=>{
      const name=e.kind==='scenario'?noteName.scenario(e.id):e.kind==='scenario-run'?noteName.run(e.id):e.kind==='technical-evidence-bundle'?noteName.evidence(e.id):e.kind==='review'?noteName.review(e.id):undefined;
      const folder=e.kind==='scenario'?'Scenarios':e.kind==='scenario-run'?'Runs':e.kind==='technical-evidence-bundle'?'Evidence':'Reviews';
      return `${name&&existsSync(join(vaultRoot,folder,name+'.md'))?link(name):e.id} supports this memory as ${e.kind}. The reference preserves digest \`${e.digest}\`.`;
    });
    const tasks=record.relatedTaskRefs.filter(id=>existsSync(join(vaultRoot,'Tasks',noteName.task(id)+'.md'))).map(id=>link(noteName.task(id)));
    const related=record.relatedRecordRefs.map(r=>entries.some(e=>e.record.recordId===r.recordId)?link(memoryNoteName(r.recordId)):r.recordId);
    const narrative=memoryPresentation(record).split('\n').map(line=>["Context","Decision","Why this decision was made","Consequences","Alternatives considered","Problem encountered","Cause","What we learned","When this lesson is useful","When it is no longer valid","Project convention","Why we follow it","Current source","Technical constraint","Reason for the constraint","Consequences for the software","Where it applies","Status"].includes(line)?`## ${line}\n`:line).join('\n');
    const title=record.recordKind==='software-adr'?'ADR':record.recordKind==='technical-lesson'?"Technical lesson":record.recordKind==='project-convention'?"Convention":"Technical constraint";
    const history=repo.history(record.recordId);
    managed(join(vaultRoot,memoryFolder(record.recordKind),memoryNoteName(record.recordId)+'.md'),
      `${frontmatter({type:'controlled-project-memory',kind:record.recordKind,id:record.recordId,revision:record.revision,status:record.status,project:record.projectId,
        scope:record.scope.kind==='repository'?'repository':record.scope.path,created:record.createdAt,updated:record.updatedAt,authority:record.authorityKind,supersedes:record.supersedes,tags:['controlled-dev/project-memory']})}# ${title} — ${record.title}\n\n${narrative}\n\n## Linked evidence\n\n${paragraphs(evidence,"No technical evidence has been linked. Assess this limitation before adopting the memory.")}\n\n${staleEvidence.length?"Evidence "+staleEvidence.join(', ')+" requires verification again. For a lesson, this prevents loading it as current advice. For an architectural decision, it does not automatically revoke the accepted decision.\n\n":''}## Linked tasks and memories\n\n${tasks.length?"This memory is linked to "+natural(tasks,'')+'.':"No linked task notes are available yet."} ${related.length?"Other relevant memories: "+natural(related,'')+'.':''}\n\n## Previous decisions\n\n${record.supersedes.length?"This memory supersedes "+record.supersedes.map(id=>link(memoryNoteName(id))).join(', ')+'.':"It does not supersede another memory."} ${record.supersededBy.length?"It was superseded by "+record.supersededBy.map(id=>link(memoryNoteName(id))).join(', ')+'.':''}\n\n## Personal notes\n\nYou may write in ${link(notes,"this personal note")}. Notes do not change the authoritative status and are preserved during regeneration.\n\n## Technical details\n\nIdentity: \`${record.recordId}\`. Current revision: ${record.revision}. Digest: \`${record.contentDigest}\`.\n\nThe structured history preserves ${history.length} revisions: ${history.map(r=>`${r.revision} (${r.status})`).join(', ')}.\n`,files,vaultRoot);
  }
  managed(join(vaultRoot,'Indexes','Project Memory.base'),`filters:\n  and:\n    - 'type == "controlled-project-memory"'\nproperties:\n  kind:\n    displayName: "Memory kind"\n  status:\n    displayName: "Status"\nviews:\n  - type: table\n    name: "Project technical memory"\n    order:\n      - file.name\n      - kind\n      - status\n      - scope\n      - updated\n`,files,vaultRoot);
  managed(join(vaultRoot,'Indexes','Project Memory.md'),`# Project technical memory\n\nThese notes explain software decisions, lessons learned, conventions and constraints that may be useful in later tasks. The host loads only current, relevant memories within the role's limits. Lessons are advice; an accepted decision or current constraint requires an explicit assessment of any divergence.\n\nThe [[Indexes/Project Memory.base|Technical memory]] view lets you filter by kind, status and scope.\n\n${list(entries.map(e=>link(memoryNoteName(e.record.recordId),e.record.title)),"No memories are present yet.")}\n\nJSON records are authoritative. Editing these notes does not accept a proposal, activate a lesson or change tasks or scope. Personal notes remain in Notes.\n`,files,vaultRoot);
  const home=join(vaultRoot,'Home.md');vaultFile(vaultRoot,home);
  if(existsSync(home)){
    const marker="## Project technical memory";const existing=readFileSync(home).toString('utf8');
    atomic(home,existing.replace(/## (?:Project technical memory|Memoria tecnica del progetto)\n[\s\S]*?(?=\n## |$)/,'')+`${marker}\n\nDecisions, lessons, conventions and constraints across tasks are available in [[Indexes/Project Memory|Project technical memory]]. These notes explain the structured records without replacing their authority.\n`);
  }
  return Object.freeze(files.sort());
}

/** Human-facing plan and history share the task vault. No Markdown field is read as authority. */
export function rebuildProjectPlanningView(repo:ProjectPlanningRepository):readonly string[]{
  const vaultRoot=assertHumanVaultLocation(repo.projectRoot,repo.repoRoot),files:string[]=[],history=repo.history(),current=repo.current(),views=repo.progress(),goals=repo.goals();
  for(const folder of ['Planning','Planning/Plan History','Planning/Planned Tasks','Indexes','Notes'])vaultDirectory(vaultRoot,join(vaultRoot,folder));
  const memory=ProjectMemoryRepository.open(repo.store.agentDataRoot,repo.repoRoot,repo.store.artifactInspection);
  const autonomy=ProjectAutonomyRepository.open(repo.store.agentDataRoot,repo.repoRoot,repo.store.artifactInspection),activePolicy=autonomy?.policies().find(p=>p.status==='APPROVED')??autonomy?.policies().findLast(p=>p.status!=='DRAFT'),autonomyRun=autonomy?.runs().at(-1);
  const modeText=activePolicy?`Controlled Autonomy.\n\n${policyNarrative(activePolicy.policy)}\n\nStatus: ${autonomyRun?.status==='ACTIVE'?"In progress":autonomyRun?.status==='PAUSED'?"Paused":autonomyRun?.status==='FINISHED'?"Final verification passed":autonomyRun?.status==='CANCELLED'?"Interrupted":activePolicy?.status==='REVOKED'?"Authorization revoked":"Waiting to start"}.\n${autonomyRun?.interruption?`Automatic development suspended: ${autonomyRun.interruption.decisionNeeded}`:''}`:"Supervised mode. Confirmations at the normal checkpoints.";
  if(memory)files.push(...rebuildProjectMemoryView(memory));
  const promotion=CandidatePromotionRepository.open(repo.store.agentDataRoot,repo.repoRoot,repo.store.artifactInspection);if(promotion)files.push(...rebuildCandidatePromotionView(promotion));
  const goal=goals.find(g=>current?.projectGoalRef.id===`${g.goalId}-r${g.revision}`)??goals.at(-1);
  const bootstrapStore=DurableStore.bootstrap(repo.store.agentDataRoot,repo.projectId,repo.store.artifactInspection);
  const setup=bootstrapStore?.readProjectIndex()?new GreenfieldBootstrap(repo.store.agentDataRoot,repo.repoRoot,repo.store.artifactInspection).proposal(repo.projectId,true):undefined;
  const initial=setup?"## Initial state\n\nThe project started from an empty technical baseline. Controlled tasks build the code, which appears in the official folder after each approved integration. Initial decisions remain proposals until individually confirmed.\n\n":'';
  const note=(taskId:string)=>`Attività ${safeId(taskId)}`,generatedAt=new Date().toISOString();
  const plannedLink=(id:string,label:string,from='Planning')=>markdownFileLink(relative(join(vaultRoot,from),join(vaultRoot,'Planning','Planned Tasks',note(id)+'.md')),label);
  const currentLink=markdownFileLink('../Current Plan.md',"current plan and progress");
  const advancement=()=>`## Observed progress and integration\n\nRegistry read: ${generatedAt}. These states come from currently saved data, not from claims in the proposal.\n\n${views.map(v=>`### ${plannedLink(v.task.plannedTaskId,v.task.title)}\n\nStatus: ${projectTaskStatusLabel(v.status)}.\n\n${v.explanation}\n\nProject integration: ${v.baselineReady===true?"result available in the project baseline":v.integrationStatus?"result not yet available in the project baseline":"integration information unavailable"}.\n\n${v.links.length?v.links.map(e=>markdownFileLink(relative(join(vaultRoot,'Planning'),join(vaultRoot,'Tasks',noteName.task(e.controlledTaskId)+'.md')),"Open the executed task")).join(' · '):"No linked executed task."}`).join('\n\n')}\n`;
  const planText=(plan:import('./project-planning.js').ProjectPlan,isCurrent=false)=>{
    const boundGoal=goals.find(g=>plan.projectGoalRef.id===`${g.goalId}-r${g.revision}`)!;
    const pointLink=(id:string,label:string)=>plannedLink(id,label,isCurrent?'Planning':'Planning/Plan History');
    let approval="Not approved yet.";
    if(plan.status!=='DRAFT'){
      const ref=repo.approvalEvidence(plan.planId,plan.revision),packet=parseJson(repo.store.read(ref),135168) as any;
      approval=`Approved on ${readTrustedConfirmationEvidence(repo.store,ref,packet.request).receipt.confirmedAt}.`;
    }
    const status=isCurrent?`## Current situation\n\n${views.filter(v=>v.status==='COMPLETED').length} tasks completed out of ${views.length}; ${views.filter(v=>v.status==='ACTIVE').length} in progress; ${views.filter(v=>v.status==='BLOCKED').length} require a decision.\n\nUpdated: ${generatedAt}. Completion and integration are separate; current details follow the plan content.\n\n${views.map(v=>`- ${pointLink(v.task.plannedTaskId,v.task.title)} — ${projectTaskStatusLabel(v.status)}`).join('\n')}\n\n`:
      `This note preserves revision ${plan.revision}; it does not describe current progress. See the ${currentLink}.\n\n`;
    return `${frontmatter({type:'controlled-project-plan',id:plan.planId,revision:plan.revision,status:plan.status})}# Work plan - revision ${plan.revision}\n\n${status}## Proposal content${plan.status==='DRAFT'?'':" approved"}\n\nProposal prepared on ${plan.updatedAt}. ${approval}\n\nThe strategy, analysis and assumptions below describe that moment. Statements such as 'no completed tasks' are not the current status. The proposal remains unchanged; progress is read separately from the registry.\n\n## Objective\n\n${boundGoal.objective}\n\n## Clarified context\n\n${boundGoal.clarifications?.map(q=>`${q.question}\n\n${q.answer??"Awaiting an answer."}`).join('\n\n')||"No additional clarification requested."}\n\n${plan.design?`## Design and implementation\n\n${designNarrative(plan.design)}\n\n`:''}## Planned strategy\n\n${plan.strategy}\n\n## Planned tasks\n\n${plan.plannedTasks.map(t=>`### ${pointLink(t.plannedTaskId,t.title)}\n\n${t.objective}\n\n${t.rationale}\n\nPlanned scope: ${natural(t.scopeIntent,"none")}.\n\n${t.designIntent?`Design: ${paragraphs(t.designIntent,'')}\n\n`:''}${t.implementationSteps?`Planned implementation steps\n\n${numberedSteps(t.implementationSteps)}\n\n`:''}Expected result: ${natural(t.acceptanceIntent,"none")}.\n\nPlanned checks: ${natural(t.validationIntent,"none")}.\n\n${t.dependencyRationale.length?t.dependencyRationale.map(d=>`Requires ${pointLink(d.plannedTaskId,plan.plannedTasks.find(p=>p.plannedTaskId===d.plannedTaskId)!.title)} because ${d.rationale}`).join('\n\n'):"It has no planned dependencies."}\n\nRelevant memories: ${t.relevantMemoryRefs.map(r=>link(memoryNoteName(r.recordId))).join(', ')||"no linked memories"}.`).join('\n\n')}\n\n${isCurrent?advancement():''}## Meaning of approval\n\nThe plan determines what to propose and in which order. Each task must still pass the normal workflow checks. Approved Controlled Autonomy may authorize the specified steps within the agreed limits. The plan does not apply candidate copies or determine task status.\n\n## Technical details\n\nContent digest: ${plan.contentDigest}. Document status: ${plan.status}. Structured data is authoritative; editing this note does not change the plan.\n`;
  };
  for(const plan of history)managed(join(vaultRoot,'Planning','Plan History',`Piano ${safeId(plan.planId)} r${plan.revision}.md`),planText(plan),files,vaultRoot);
  managed(join(vaultRoot,'Planning','Current Plan.md'),current?planText(current,true)+`\n## Execution mode\n\n${modeText}\n\n[[Planning/Autonomy Activity|Autonomy activity]]\n`:"# Current plan\n\nNo plan has been approved yet. Drafts are preserved in history and require an explicit decision.\n",files,vaultRoot);
  // Removed tasks remain inspectable, while current membership is an explicit property.
  const identities=new Map(history.flatMap(p=>p.plannedTasks.map(t=>[t.plannedTaskId,t] as const)));
  for(const historicalTask of identities.values()){
    const view=views.find(v=>v.task.plannedTaskId===historicalTask.plannedTaskId),task=view?.task??historicalTask,
      executions=repo.links().filter(l=>l.plannedTaskId===task.plannedTaskId),notes=humanNotes(vaultRoot,'planned-task',task.plannedTaskId,files);
    managed(join(vaultRoot,'Planning','Planned Tasks',note(task.plannedTaskId)+'.md'),
      `${frontmatter({type:'controlled-planned-task',id:task.plannedTaskId,status:view?.status??'HISTORICAL',dependencies:task.dependsOn,linkedTask:executions.map(e=>e.controlledTaskId),revision:current?.revision??0,current:view?'yes':'no'})}# ${task.title}\n\n## Planned work\n\n${task.objective}\n\n${task.rationale}\n\n${task.designIntent?`## Task design\n\n${paragraphs(task.designIntent,'')}\n\n`:''}${task.implementationSteps?`## Implementation\n\n${numberedSteps(task.implementationSteps)}\n\n`:''}## Result and checks\n\n${paragraphs(task.acceptanceIntent,"No criteria.")}\n\n${paragraphs(task.validationIntent,"No checks.")}\n\n## Dependencies\n\n${task.dependencyRationale.map(d=>`Requires ${link(note(d.plannedTaskId))} because ${d.rationale}`).join('\n\n')||"It has no planned dependencies."}\n\n## Actual execution\n\n${view?.explanation??"The task is historical and is not in the current plan."}\n\n${executions.length?executions.map(e=>`The linked controlled task is ${markdownFileLink(relative(join(vaultRoot,'Planning','Planned Tasks'),join(vaultRoot,'Tasks',noteName.task(e.controlledTaskId)+'.md')),"Open the executed task")} (${link(noteName.task(e.controlledTaskId))}), originating from revision ${e.planRevision}.`).join('\n\n'):"This is a planned task: no controlled task is linked yet."}\n\n## Project memory\n\n${task.relevantMemoryRefs.map(r=>link(memoryNoteName(r.recordId))).join(', ')||"No explicit memories."}\n\n## Personal notes\n\nYou may write in ${link(notes)}. Notes are preserved and do not change the plan or task.\n`,files,vaultRoot);
  }
  const group=(status:string)=>views.filter(v=>v.status===status).map(v=>link(note(v.task.plannedTaskId),v.task.title)).join(', ')||"no tasks";
  managed(join(vaultRoot,'Project.md'),`# Software project\n\n${initial}${goals.at(-1)?.clarifications?.length?`## Discussion of the requested work\n\n${goals.at(-1)!.objective}\n\n${goals.at(-1)!.clarifications!.map(q=>`${q.question} — ${q.answer??"Awaiting your answer."}`).join('\n\n')}\n\n`:''}## Execution mode\n\n${modeText}\n\n[[Planning/Autonomy Activity|Autonomy activity]]\n\n## Objective\n\n${goal?.objective??"No objective has been defined yet."}\n\n## Plan and progress\n\n${current?`The current plan is revision ${current.revision}, with ${views.length} planned tasks. Read it in [[Planning/Current Plan|Current plan]].`:"The project has only drafts and is awaiting plan approval."}\n\nCompleted tasks: ${group('COMPLETED')}.\n\nTasks in progress: ${group('ACTIVE')}.\n\nReady tasks: ${group('READY')}.\n\nWaiting tasks: ${group('WAITING')}.\n\nBlocked tasks: ${group('BLOCKED')}.\n\nFailed tasks: ${group('FAILED')}.\n\n## Integration of results\n\n${views.filter(v=>v.integrationStatus).map(v=>`${link(note(v.task.plannedTaskId),v.task.title)}: ${v.explanation}`).join("\n\n")||"No Git result available for integration."}\n\n## Relevant decisions and knowledge\n\n${memory?.entries().filter(e=>e.record.recordKind==='software-adr'&&e.record.status==='ACCEPTED').map(e=>link(memoryNoteName(e.record.recordId),e.record.title)).join(', ')||"No accepted architectural decisions are present."} Technical knowledge is in [[Indexes/Project Memory|Project memory]].\n\n## Possible next steps\n\n${views.some(v=>v.status==='READY')?`You may choose ${group('READY')} and start normal TaskSpec formulation.`:"Approve a draft, complete a prerequisite or resolve a blocker."} A completed predecessor may still have its result in the candidate copy: the baseline is checked before formulation, without automatic application.\n\n## History\n\n${history.map(p=>link(`Planning/Plan History/Piano ${safeId(p.planId)} r${p.revision}`,`Revision ${p.revision} (${p.status})`)).join('\n\n')}\n\nThe [[Indexes/Planned Tasks.base|Planned tasks]] view distinguishes the plan from executions. Structured data is authoritative; Notes contains personal notes.\n`,files,vaultRoot);
  managed(join(vaultRoot,'Indexes','Planned Tasks.base'),`filters:\n  and:\n    - 'type == "controlled-planned-task"'\nproperties:\n  dependencies:\n    displayName: "Dependencies"\n  linkedTask:\n    displayName: "Controlled task"\n  revision:\n    displayName: "Plan revision"\nviews:\n  - type: table\n    name: "Planned tasks"\n    order:\n      - file.name\n      - status\n      - current\n      - dependencies\n      - linkedTask\n      - revision\n`,files,vaultRoot);
  const home=join(vaultRoot,'Home.md'),marker="## Project planning";vaultFile(vaultRoot,home);
  const previous=existsSync(home)?readFileSync(home).toString('utf8'):'# Controlled Dev\n\n';
  if(autonomy){
    const runPolicy=autonomyRun?autonomy.policy(autonomyRun):undefined,runViews=views.filter(v=>v.links.some(l=>l.planDigest===runPolicy?.plan.digest));
    const interruptions=autonomy.interruptions(),final=autonomyRun?.finalCheckpointRef?parseJson(autonomy.store.read(autonomyRun.finalCheckpointRef),2*1024*1024) as any:undefined;
    const summary=autonomyRun?`## Run summary\n\nCompleted tasks: ${runViews.filter(v=>v.status==='COMPLETED').length}.\nIntegrated tasks: ${autonomyRun.promotions.length}.\nCorrections performed within budget: ${runViews.reduce((n,v)=>n+(v.reworkAttempts??0),0)}.\nFinal checkpoint: ${final?.outcome??"not concluded"}.\nBaseline ${final?"verified":"expected"}: ${autonomyRun.expectedHead}.\n\nOutstanding decisions: ${autonomyRun.interruption?.decisionNeeded??(autonomyRun.status==='FINISHED'?"none within the run's scope":"the run has not concluded")}.\n\nMandatory human interruptions recorded in project history: ${interruptions.filter(i=>i.mandatory).length}.\n${interruptions.map(i=>`${i.decisionNeeded} Already integrated: ${i.alreadyDone.join(', ')||"no tasks"}. Options: ${i.safeOptions.join('; ')}.`).join('\n\n')}`:"No run started.";
    managed(join(vaultRoot,'Planning','Autonomy Activity.md'),`# Autonomy activity\n\n${modeText}\n\n${summary}\n\n${autonomy.decisions().map(d=>d.decision==='ALLOWED'?`${AUTONOMY_ACTION_LABELS[d.actionKind as keyof typeof AUTONOMY_ACTION_LABELS]??d.actionKind}: authorized by the approved plan's limits.`:`Automatic development suspended: ${d.reason}`).join('\n\n')}\n\n${autonomyRun?.promotions.map(p=>`${p.taskId}: ${p.previousHead===p.resultingHead?"result already present in the baseline, with no Git changes":"integrated into the authorized baseline"}.`).join('\n')??''}\n`,files,vaultRoot);
  }
  managed(home,previous.replace(/## (?:Project planning|Pianificazione del progetto)\n[\s\S]*?(?=\n## |$)/,'')+`${marker}\n\n[[Project|Software project]] explains the objective, plan and upcoming tasks. [[Planning/Current Plan|Current plan]] presents the planned work.\n`,files,vaultRoot);
  const checkpoints=IntegrationCheckpointRepository.open(repo.store.agentDataRoot,repo.repoRoot,repo.store.artifactInspection);if(checkpoints)files.push(...rebuildIntegrationCheckpointView(checkpoints,false));
  return Object.freeze([...new Set(files)].sort());
}

/** These notes are projections only. Git ancestry, immutable records and receipts remain authority. */
export function rebuildCandidatePromotionView(repo:CandidatePromotionRepository):readonly string[]{
  const vaultRoot=assertHumanVaultLocation(repo.projectRoot,repo.repoRoot),files:string[]=[];
  for(const folder of ['Promotions','Evidence','Reviews'])vaultDirectory(vaultRoot,join(vaultRoot,folder));
  for(const b of repo.bindings()){
    const view=repo.status(b.taskId),p=view.proposal,reviewName=`Review integrazione ${safeId(b.taskId)}`;
    const restored=repo.terminalRestorationHistory(b.taskId),restorationText=restored.length?`## Restored local copies\n\n${restored.map(location=>`- Folder saved in history: ${location.historicalWorkRoot}\n  Restored folder: ${location.workRoot}\n  ${location.current?"Authorized in the current session.":"Historical record: a new session requires confirmation again."} Confirmation: ${location.confirmationRef.id}; evidence: ${location.locationRef.id}.`).join('\n')}\n\n`:'';
    const evidenceNames=p?.validationRefs.map((_,n)=>`Verifica integrazione ${safeId(b.taskId)} ${n+1}`)??[];
    for(const [n,ref] of (p?.validationRefs??[]).entries()){
      managed(join(vaultRoot,'Evidence',evidenceNames[n]+'.md'),`# Verification of the integrated result\n\nThe task's verification passed on the exact proposed merge. This is evidence for the individual task.\n\nProposal: [[Promotions/Integrazione ${safeId(b.taskId)}|Project integration]].\n\n## Technical details\n\nEvidence: ${ref.id}. Digest: ${ref.digest}. Commit: ${p!.integrationCommit}.\n`,files,vaultRoot);
    }
    if(p)managed(join(vaultRoot,'Reviews',reviewName+'.md'),`# Review of the integrated result\n\nThe result has a positive independent review. If the destination remained on the baseline and its content matches the candidate, the task's review is reused; otherwise the Reviewer examined the merge in read-only mode.\n\nTask: [[Tasks/${noteName.task(b.taskId)}|Verified task]]. Proposal: [[Promotions/Integrazione ${safeId(b.taskId)}|Project integration]].\n\n## Technical details\n\nReview: ${p.reviewRef.id}. Digest: ${p.reviewRef.digest}.\n`,files,vaultRoot);
    managed(join(vaultRoot,'Promotions',`Integrazione ${safeId(b.taskId)}.md`),`# Project integration\n\n${view.explanation}\n\nDestination: \`${b.targetRef.slice('refs/heads/'.length)}\`.\n\nTask: [[Tasks/${noteName.task(b.taskId)}|Verified controlled task]].\n\n${restorationText}${p?`## Proposed changes\n\n${p.changedFiles.map(c=>`- \`${c.path}\`: ${{A:"added",M:"modified",D:"removed",T:"type changed"}[c.kind]}`).join('\n')}\n\n## Checks and review\n\n${evidenceNames.map(name=>`[[Evidence/${name}|Task verification]]`).join(', ')}; [[Reviews/${reviewName}|Independent review]].\n\n`:''}## Decision and result\n\n${view.result?"Human approval was verified and the exact authorized merge was applied. The original folder was updated and verified clean.":view.baselineReady?"No new mutation is required: the result is already available in target history or the task changes no files.":"Completion of the candidate does not authorize integration. The user makes that decision in the TUI."}\n\n## Technical details\n\nCandidate commit: ${b.candidateCommit??"not frozen"}.\n\nCandidate digest: ${b.candidateDigest??"unavailable"}.\n\nIntegration commit: ${view.result?.integrationCommit??p?.integrationCommit??"not prepared"}.\n\nResult: ${view.result?.resultId??"no persisted result"}.\n\nEditing this note does not change Git, authorizations or plan dependencies.\n`,files,vaultRoot);
  }
  return files;
}


/** Human projections remain disposable views: editing PASS, coverage or a baseline in Markdown
 * never changes the immutable project store. Personal Notes are outside generated paths. */
export function rebuildIntegrationCheckpointView(repo:IntegrationCheckpointRepository,refreshPlanning=true):readonly string[]{
  if(refreshPlanning){const planning=ProjectPlanningRepository.open(repo.store.agentDataRoot,repo.repoRoot,repo.store.artifactInspection);if(planning)return rebuildProjectPlanningView(planning);}
  const vault=assertHumanVaultLocation(repo.projectRoot,repo.repoRoot),files:string[]=[],definitions=repo.definitions(),runs=repo.runs(),status=repo.status();
  for(const folder of ['Integration/Checkpoints','Integration/Runs','Integration/Evidence','Indexes'])vaultDirectory(vault,join(vault,folder));
  const definitionNote=(id:string,revision:number)=>`Integration/Checkpoints/${safeId(id)} r${revision}`;
  const runNote=(id:string)=>`Integration/Runs/${safeId(id)}`;
  for(const d of definitions){
    const latest=runs.filter(r=>r.definitionDigest===d.contentDigest).at(-1),baseline=latest?.baseline??status.baseline;
    managed(join(vault,definitionNote(d.checkpointId,d.revision)+'.md'),`${frontmatter({type:'integration-checkpoint',id:d.checkpointId,revision:d.revision,status:d.status})}# Integration checkpoint — ${d.title}\n\n## Why it exists\n\n${d.purpose}\n\n## What it includes\n\n${d.controlledTaskRefs.map(id=>link(noteName.task(id))).join(', ')}\n\n${d.plannedTaskRefs.map(r=>link(`Planning/Planned Tasks/Attività ${safeId(r.plannedTaskId)}`)).join(', ')}\n\n## Baseline\n\n${baseline.targetRef.slice(11)} @ ${baseline.commit}. The definition establishes intent; each run preserves its own exact commit.\n\n## Planned checks\n\n${paragraphs(d.validationIntent,"No checks.")}\n\n${paragraphs(d.validationPlan.map(v=>v.description),"No checks.")}\n\n## Scenarios\n\n${d.scenarios.map(s=>`${s.title}, version ${s.version}: ${s.purpose}`).join('\n\n')||"No additional scenarios."}\n\n## Relevant memory\n\n${d.relevantMemoryRefs.map(r=>link(memoryNoteName(r.recordId))).join(', ')||"No explicitly requested memories."}\n\n## Executions\n\n${runs.filter(r=>r.definitionDigest===d.contentDigest).map(r=>link(runNote(r.checkpointRunId),`${r.outcome??"incomplete"} — ${r.baseline.commit}`)).join('\n\n')||"Not executed yet."}\n\nThe approved definition is immutable. A correction requires a new revision and approval. This note grants no authority.\n`,files,vault);
  }
  for(const r of runs){const d=definitions.find(d=>d.contentDigest===r.definitionDigest)!,current=r.baseline.commit===status.baseline.commit;
    for(const ref of r.evidenceRefs)managed(join(vault,'Integration/Evidence',safeId(ref.id)+'.md'),`${frontmatter({type:'integration-checkpoint-evidence',id:ref.id,run:r.checkpointRunId})}# Verification evidence\n\nExecution: ${link(runNote(r.checkpointRunId))}.\n\nBaseline: ${r.baseline.commit}.\n\nType: ${ref.mediaType}. Digest: ${ref.digest}.\n\nAuthoritative bytes are preserved in the structured store, at reference ${ref.relativeStorePath}.\n`,files,vault);
    managed(join(vault,runNote(r.checkpointRunId)+'.md'),`${frontmatter({type:'integration-checkpoint-run',id:r.checkpointRunId,baseline:r.baseline.commit,outcome:r.outcome??'INCOMPLETE',coveredTasks:r.coverage.map(c=>c.taskId),date:r.finishedAt??r.startedAt,current:current?'yes':'no'})}# Checkpoint execution — ${d.title}\n\n## Result\n\n${r.outcome??"Incomplete execution"}. ${errorPresentation(new Error(r.reason)).code==='CONTROLLED_ACTION_FAILED'?r.reason:errorPresentation(new Error(r.reason)).message}\n\n${r.outcome==='BLOCKED'?"Checks or sufficient evidence are missing: review the reason and evidence before starting another check.":r.outcome==='FAIL'?"A check failed: the evidence can be used to formulate a normal controlled correction task.":''}\n\n## Verified baseline\n\n${r.baseline.targetRef.slice(11)} @ ${r.baseline.commit}. Tree: ${r.baseline.tree}. ${current?"This is the current commit.":"The project has advanced: this result concerns an earlier version."}\n\n## What was checked together\n\n${r.coverage.map(c=>`${link(noteName.task(c.taskId))}: ${c.integrationRequired?link(`Promotions/Integrazione ${safeId(c.taskId)}`)+" — integration "+c.integrationCommit:"integration unnecessary, completion proven"}`).join('\n\n')||"Coverage not proven."}\n\nDefinition: ${link(definitionNote(d.checkpointId,d.revision))}.\n\n## Checks performed\n\n${r.evidenceRefs.filter(ref=>ref.mediaType=== 'application/vnd.pi-controlled-dev.integration-checkpoint+json').map(ref=>{const e=repo.read(ref);return e.kind==='checkpoint-validation'?`${e.result.commandId}: ${e.result.status}. ${e.scenarioHash?"Scenario version "+e.scenarioVersion+'.':''}`:''}).filter(Boolean).join('\n\n')||"No proven execution."}\n\n## Evidence\n\n${r.evidenceRefs.map(ref=>link(`Integration/Evidence/${safeId(ref.id)}`)).join('\n\n')||"Unavailable."}\n\n## Review\n\n${r.reviewRef?repo.read(r.reviewRef).result.verdict:d.reviewRequired?"A verifiable independent review is missing.":"The definition does not require review."}\n\n## What we can conclude\n\n${r.outcome==='PASS'?"The checks specified by the definition passed on this exact commit.":"A successful integrated verification outcome has not been proven."}\n\n## Limitations\n\nThis check concerns selected software interactions; it does not certify every system requirement or a release. It does not correct code or undo integrations. Local changes in the main folder are excluded. Generated files in the isolated copy may require explicit cleanup.\n`,files,vault);
  }
  const section=`## Integration verification\n\nCurrent baseline: ${status.baseline.targetRef.slice(11)} @ ${status.baseline.commit}.\n\nLatest checkpoint: ${status.latest?link(runNote(status.latest.checkpointRunId)): "none"}. Result: ${status.latest?.outcome??"unavailable"}. Status: ${status.status}.\n\nTasks covered by the latest checkpoint: ${status.latest?.coverage.map(c=>c.taskId).join(', ')||"none"}.\n\n${status.status==='STALE'?"The latest checkpoint concerns an earlier project version.":"Plan completion, task integration and baseline verification remain separate facts."}\n`;
  for(const name of ['Project.md','Planning/Current Plan.md']){const file=join(vault,name);if(name.startsWith('Planning/')&&!existsSync(file))continue;
    const previous=existsSync(file)?readFileSync(file).toString('utf8'):"# Software project\n\n";
    managed(file,previous.replace(/## (?:Integration verification|Verifica dell'integrazione)\n[\s\S]*?(?=\n## |$)/,'')+ '\n'+section,files,vault);
  }
  managed(join(vault,'Indexes','Integration Checkpoints.base'),`filters:\n  and:\n    - 'type == "integration-checkpoint-run"'\nviews:\n  - type: table\n    name: "Integration verification"\n    order:\n      - file.name\n      - baseline\n      - outcome\n      - coveredTasks\n      - date\n      - current\n`,files,vault);
  return Object.freeze([...new Set(files)].sort());
}
