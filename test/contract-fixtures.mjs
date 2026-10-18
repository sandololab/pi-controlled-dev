import { createHash } from 'node:crypto';
export const H = 'a'.repeat(64);
export const GIT = 'b'.repeat(40);
export const TIME = '2026-01-01T00:00:00Z';
export const clone = value => structuredClone(value);
export function fixtures(api) {
  const v={schemaVersion:1};
  const artifact=(id='evidence')=>({...v,id,digest:H,relativeStorePath:`artifacts/${id}`,bytes:1,mediaType:'application/json'});
  const source={...v,inline:'input',snapshot:{...artifact('source'),bytes:5,digest:createHash('sha256').update('input').digest('hex')}};
  const requirement={...v,id:'req',text:'Implement requirement'};
  const criterion={...v,id:'criterion',requirementIds:['req'],text:'Check requirement',method:'AUTOMATED',commandIds:['check'],reviewInstruction:'Inspect candidate'};
  const command={...v,id:'check',executable:'/usr/bin/check',argv:[],timeoutMs:1000,required:true};
  const scope={...v,repoRoot:'/original',baseRef:'HEAD',allowedPaths:['file.txt'],deniedPaths:[],strongConfinementRequired:false};
  const retry={...v,maxReworkAttempts:2,maxInfrastructureRetries:1,maxDispatches:64,maxEscalationEpisodes:4};
  const gates={...v,beforeImplementation:true,onScopeChange:true,onOracleDecision:true,beforeCompletion:true,onRetryExhausted:true};
  const observation={...v,id:'observation',text:'Observed',evidenceRefs:['evidence']};
  const risk={...v,id:'risk',text:'Risk',criterionIds:['criterion'],blocking:false};
  const finding={...v,id:'finding',text:'Finding',severity:'P2',blocking:false,paths:['file.txt'],criterionIds:['criterion'],evidenceRefs:['evidence']};
  const assessment={...v,status:'PASS',evidenceRefs:['evidence'],reason:'Evidence inspected'};
  const ca={...v,criterionId:'criterion',assessment};
  const decision={...v,id:'decision',kind:'ACCEPT_FINDING',subjectId:'finding',reason:'Accepted',evidenceRefs:['evidence']};
  const run={...v,assignmentId:'assignment',attemptId:'attempt',role:'Developer',requestId:'request',ownerSessionId:'owner',status:'TERMINAL',runId:'developer-run',childSessionId:'developer-session',terminalProofRef:'evidence'};
  const failure={...v,id:'failure',phase:'TESTING',category:'TEST',code:'CHECK_FAILED',subjectIds:['check'],fingerprint:H,evidenceRefs:['evidence']};
  failure.fingerprint=api.failureFingerprint(failure);
  const counters={...v,attempts:0,reworkAttempts:0,infrastructureRetries:0,dispatches:0,escalationEpisodes:0,oracleInvocations:0};
  const escalation={...v,id:'escalation',triggerFailureIds:['failure'],question:'Why?',closed:false};
  const candidate={...v,root:'/candidate',baseCommit:GIT,digest:H,generation:1,manifest:artifact('manifest'),patch:artifact('patch'),handoff:artifact('handoff'),terminalProof:artifact('proof')};
  const capability={...v,id:'capability',itemId:'UV-001',status:'UNVERIFIED',environmentHash:H,evidenceRefs:[]};
  const hd={...v,id:'human-decision',gateId:'gate',taskId:'task',decision:'APPROVE',actorId:'human',channelId:'channel',confirmationId:'confirmation',displayedRevision:1,displayedDataHash:H,confirmedAt:TIME,trustedChannelEvidenceRef:'evidence'};
  const entry={...v,path:'file.txt',kind:'FILE',mode:'100644',contentHash:H};
  const manifest={...v,baseCommit:GIT,entries:[entry]};
  const spec={...v,taskId:'task',specRevision:0,title:'Task',objective:'Objective',plan:source,currentTask:source,requirements:[requirement],acceptanceCriteria:[criterion],scope,constraints:[],validationCommands:[command],humanGates:gates,retryPolicy:retry,specHash:H};
  spec.specHash=api.hashContract('TaskSpec',spec);
  const controlledContext={...v,defaultContext:'fresh',allowedContexts:['fresh']};
  const controlledExtension={...v,id:'extension',artifactHash:H};
  const controlledCapabilities={...v,operationIds:['OP-01'],mutationPolicy:'DENY',scopePolicy:'SCP-001',additionalRuntimePermissions:'NONE'};
  const controlledLaunch={...v,controlledAgentId:'controlled.scout',registrationProtocolVersion:1,expectedRole:'Scout',baseSystemPromptHash:H,
    systemPromptMode:'replace',contextPolicy:controlledContext,allowedTools:['read'],excludedTools:['bg_wait','contact_supervisor','watchdog_diff'],
    allowNestedSubagents:false,inheritProjectContext:false,inheritGlobalContext:false,inheritSkills:false,extensions:[],subagentOnlyExtensions:[],
    mutationTools:[],internalProtocolTools:['structured_output'],capabilityConstraints:controlledCapabilities};
  const controlledRegistration={...v,id:'registration',controlledAgentId:'controlled.scout',expectedRole:'Scout',registrationProtocolVersion:1,rpcVersion:1,
    ownerSessionId:'owner',runtimeGeneration:'generation',launchContractHash:api.launchContractHash(controlledLaunch),contractRef:'evidence',definitionRef:'evidence',
    accepted:true,handleActiveAtObservation:true,capabilityEvidenceRefs:['evidence']};
  const assignment={...v,schemaVersion:2,assignmentId:'assignment',taskId:'task',attemptId:'attempt',role:'Developer',specHash:spec.specHash,objective:'Implement',repoRoot:'/original',workRoot:'/writer',baseRef:'HEAD',baseCommit:GIT,allowedPaths:['file.txt'],deniedPaths:[],requirements:[requirement],acceptanceCriteria:[criterion],constraints:[],stopConditions:['Stop on ambiguity'],inputArtifactRefs:['evidence'],authority:['OP-01','OP-02'],validationCommands:[command],context:'fresh',launchContractHash:H,assignmentHash:H};
  assignment.assignmentHash=api.hashContract('AssignmentEnvelope',assignment);
  const envelope={...v,taskId:'task',assignmentId:'assignment',attemptId:'attempt',role:'Developer',specHash:spec.specHash,assignmentHash:assignment.assignmentHash,evidenceRefs:['evidence']};
  const scout={...envelope,role:'Scout',observations:[observation],relevantFiles:['file.txt'],risks:[risk],ambiguities:[],recommendedScope:scope};
  const developer={...envelope,summary:'Implemented',changedFiles:['file.txt'],commandsRun:['check'],tests:[observation],residualRisks:[]};
  const review={...envelope,role:'Reviewer',verdict:'PASS',reviewedTreeHash:H,candidateGeneration:1,criteria:[ca],findings:[],scopeAssessment:assessment,testAssessment:assessment,actualChangesAssessment:assessment,residualRisks:[],validationResultIds:['validation']};
  const oracle={...envelope,role:'Oracle',escalationId:'escalation',diagnosis:'Diagnosis',options:['Option'],recommendation:'Advice',unresolvedQuestions:[],needsHumanDecision:false};
  const state={...v,taskId:'task',packageVersion:'0.0.0-dev',revision:0,state:'PENDING',spec:artifact('spec'),specHash:spec.specHash,ownerSessionId:'owner',repoRoot:'/original',baselineEvidence:[],runs:[],counters,failures:[],escalations:[],decisions:[],validations:[],reviews:[],results:[],gates:[],capabilities:[],invalidEvidenceIds:[],completionEvidenceRefs:[],lastEventId:'event',createdAt:TIME,updatedAt:TIME};
  const validation={...v,id:'validation',taskId:'task',commandId:'check',specHash:spec.specHash,candidateDigest:H,candidateGeneration:1,commandHash:api.hashCanonical(command),status:'PASSED',issuer:'Orchestrator',reason:'Passed',startedAt:TIME,endedAt:TIME,exitCode:0,logRef:'evidence',processProofRef:'evidence',postCandidateDigest:H};
  const gate={...v,id:'gate',taskId:'task',type:'beforeImplementation',requestedBy:'Orchestrator',status:'PENDING',specHash:spec.specHash,approvedData:artifact('evidence'),approvedDataHash:H,stateRevision:1,resumeState:'READY',continuation:'PREPARE',requestedAt:TIME};
  const event={...v,id:'event',taskId:'task',kind:'CREATE',actor:'Orchestrator',targetState:'PENDING',revision:0,timestamp:TIME,reason:'Created',evidenceRefs:[],invalidatedEvidenceIds:[],stateAfter:artifact('state'),eventHash:H};
  event.eventHash=api.hashContract('TransitionEvent',event);
  return { ArtifactRef:artifact(),InputSource:source,Requirement:requirement,Criterion:criterion,CommandSpec:command,ScopeSpec:scope,RetryPolicy:retry,GatePolicy:gates,Observation:observation,Risk:risk,Finding:finding,Assessment:assessment,CriterionAssessment:ca,DecisionRecord:decision,RunRecord:run,FailureRecord:failure,Counters:counters,Escalation:escalation,Candidate:candidate,CapabilityEvidence:capability,HumanDecisionEvidence:hd,CandidateEntry:entry,CandidateManifest:manifest,TaskSpec:spec,ControlledContextPolicy:controlledContext,ControlledExtensionRef:controlledExtension,ControlledCapabilityConstraints:controlledCapabilities,ControlledLaunchContract:controlledLaunch,ControlledRegistrationEvidence:controlledRegistration,AssignmentEnvelope:assignment,ScoutResult:scout,DeveloperResult:developer,ReviewResult:review,OracleResult:oracle,WorkflowState:state,ValidationResult:validation,HumanGate:gate,TransitionEvent:event };
}
export function context(f) {
  const r=(id,kind,value)=>({id,kind,value});
  return {modelExtracted:false,specId:'spec',assignmentId:'assignment',stateId:'state',records:[
    r('evidence','ArtifactRef',f.ArtifactRef),r('source','ArtifactRef',f.InputSource.snapshot),
    r('spec','TaskSpec',f.TaskSpec),r('assignment','AssignmentEnvelope',f.AssignmentEnvelope),
    r('state','WorkflowState',f.WorkflowState),r('event','TransitionEvent',f.TransitionEvent),r('finding','Finding',f.Finding),
    ...['manifest','patch','handoff','proof'].map((id,i)=>r(id,'ArtifactRef',[f.Candidate.manifest,f.Candidate.patch,f.Candidate.handoff,f.Candidate.terminalProof][i])),
  ]};
}
