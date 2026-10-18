import { runQuiescent } from './run-quiescence.js';
import { runtimeRootMatches, runtimeRootMappingFor } from './runtime-root-mapping.js';
import { Buffer } from 'node:buffer';
import { canonicalize, hashCanonical, hashBytes, byteLength } from './contract-json.js';
import type { Issue } from './contract-json.js';
import { issue } from './contract-schema.js';
import type { ContractName, ContractMap, ValidationContext, FailureRecord, TaskSpec, AssignmentEnvelope,
  ReviewResult, WorkflowState, ValidationResult, HumanGate, TransitionEvent, State } from './contracts.js';

type RecordValue = Record<string, unknown>;
const same = (a: unknown, b: unknown): boolean => canonicalize(a) === canonicalize(b);
const own = (v: object, key: string): boolean => Object.hasOwn(v,key);
const pairs = [
  'PENDING>ANALYZING','PENDING>AWAITING_HUMAN','PENDING>FAILED','PENDING>BLOCKED',
  'ANALYZING>READY','ANALYZING>BLOCKED','ANALYZING>AWAITING_HUMAN','ANALYZING>FAILED',
  'READY>IMPLEMENTING','READY>AWAITING_HUMAN','READY>FAILED','READY>BLOCKED',
  'IMPLEMENTING>TESTING','IMPLEMENTING>REWORK','IMPLEMENTING>BLOCKED','IMPLEMENTING>AWAITING_HUMAN','IMPLEMENTING>FAILED',
  'TESTING>REVIEWING','TESTING>REWORK','TESTING>BLOCKED','TESTING>FAILED',
  'REVIEWING>COMPLETED','REVIEWING>REWORK','REVIEWING>BLOCKED','REVIEWING>AWAITING_HUMAN','REVIEWING>FAILED',
  'REWORK>IMPLEMENTING','REWORK>ANALYZING','REWORK>BLOCKED','REWORK>AWAITING_HUMAN','REWORK>FAILED',
  'BLOCKED>ANALYZING','BLOCKED>REWORK','BLOCKED>AWAITING_HUMAN','BLOCKED>FAILED',
  'AWAITING_HUMAN>PENDING','AWAITING_HUMAN>ANALYZING','AWAITING_HUMAN>READY','AWAITING_HUMAN>IMPLEMENTING',
  'AWAITING_HUMAN>REVIEWING','AWAITING_HUMAN>REWORK','AWAITING_HUMAN>BLOCKED','AWAITING_HUMAN>FAILED',
] as const;
export function selfHash(name: 'TaskSpec' | 'AssignmentEnvelope' | 'TransitionEvent', value: unknown): string {
  const omitted = { TaskSpec: 'specHash', AssignmentEnvelope: 'assignmentHash', TransitionEvent: 'eventHash' }[name];
  return hashCanonical(Object.fromEntries(Object.entries(value as RecordValue).filter(([k]) => k !== omitted)));
}
export function fingerprint(v: FailureRecord): string {
  return hashCanonical({ phase:v.phase, category:v.category, code:v.code, subjectIds:[...v.subjectIds].sort() });
}
function before(a: string, b: string): boolean {
  const [aa,af=''] = a.slice(0,-1).replace('t','T').split('.'); const [bb,bf=''] = b.slice(0,-1).replace('t','T').split('.');
  return aa < bb || (aa === bb && af.padEnd(Math.max(af.length,bf.length),'0') <= bf.padEnd(Math.max(af.length,bf.length),'0'));
}
export function localSemantics(name: ContractName, input: unknown, path: string, errors: Issue[], checkHash: boolean): void {
  const v = input as RecordValue;
  const bad = (code: string, field = '') => issue(errors,'semantic',code,path + (field ? '.' + field : ''));
  const need = (condition: unknown, field: string) => { if (!condition) bad('CONDITIONAL_REQUIRED',field); };
  for (const [key,value] of Object.entries(v)) if (Array.isArray(value)) {
    const idList = /(?:Ids|Refs|Paths)$/.test(key) || ['paths','relevantFiles','changedFiles','commandsRun','authority','validations','reviews','results','gates'].includes(key);
    if (idList && new Set(value).size !== value.length) bad('DUPLICATE',key);
    for (const idKey of ['id','criterionId','assignmentId','attemptId','requestId']) {
      const ids = value.filter(x => x !== null && typeof x === 'object' && own(x,idKey)).map(x => x[idKey]);
      if (new Set(ids).size !== ids.length) bad('DUPLICATE',key + '.' + idKey);
    }
  }
  if (checkHash && (name === 'TaskSpec' || name === 'AssignmentEnvelope' || name === 'TransitionEvent')) {
    const field = { TaskSpec:'specHash', AssignmentEnvelope:'assignmentHash', TransitionEvent:'eventHash' }[name];
    if (v[field] !== selfHash(name,v)) bad('HASH_MISMATCH',field);
  }
  switch (name) {
    case 'ControlledContextPolicy': {
      const x=input as ContractMap['ControlledContextPolicy'];
      if (!x.allowedContexts.includes(x.defaultContext)) bad('CONTEXT_DEFAULT');
      if (new Set(x.allowedContexts).size!==x.allowedContexts.length || !ordered(x.allowedContexts)) bad('CANONICAL_LIST','allowedContexts');
      break;
    }
    case 'ControlledCapabilityConstraints': {
      const x=input as ContractMap['ControlledCapabilityConstraints'];
      if (new Set(x.operationIds).size!==x.operationIds.length || !ordered(x.operationIds)
        || x.operationIds.some(id=>!/^OP-(?:0[1-9]|1[0-4])$/.test(id))) bad('CAPABILITY_CONSTRAINTS','operationIds');
      break;
    }
    case 'ControlledLaunchContract': {
      const x=input as ContractMap['ControlledLaunchContract'];
      const names: Record<ContractMap['ControlledLaunchContract']['expectedRole'],string>={Scout:'controlled.scout',Developer:'controlled.developer',Reviewer:'controlled.reviewer',Oracle:'controlled.oracle'};
      if (x.controlledAgentId!==names[x.expectedRole]) bad('CONTROLLED_AGENT_ID');
      for (const key of ['allowedTools','excludedTools','mutationTools','internalProtocolTools'] as const)
        if (new Set(x[key]).size!==x[key].length || !ordered(x[key])) bad('CANONICAL_LIST',key);
      for (const key of ['extensions','subagentOnlyExtensions'] as const)
        if (new Set(x[key].map(e=>e.id)).size!==x[key].length) bad('DUPLICATE',key);
      if (x.allowedTools.includes('subagent') || x.allowNestedSubagents || x.internalProtocolTools.length!==1
        || x.internalProtocolTools[0]!=='structured_output') bad('DELEGATION_OR_PROTOCOL');
      if (x.capabilityConstraints.mutationPolicy==='DENY' && x.mutationTools.length) bad('MUTATION_POLICY');
      if (x.expectedRole==='Scout' && (!same(x.allowedTools,['read'])
        || !same(x.excludedTools,['bg_wait','contact_supervisor','watchdog_diff'])
        || x.systemPromptMode!=='replace' || !same(x.contextPolicy,{schemaVersion:1,defaultContext:'fresh',allowedContexts:['fresh']})
        || x.inheritProjectContext || x.inheritGlobalContext || x.inheritSkills || x.extensions.length
        || x.subagentOnlyExtensions.length || x.mutationTools.length
        || !same(x.capabilityConstraints,{schemaVersion:1,operationIds:['OP-01'],mutationPolicy:'DENY',scopePolicy:'SCP-001',additionalRuntimePermissions:'NONE'}))) bad('SCOUT_AUTHORITY');
      if (x.expectedRole==='Developer' && (!same(x.allowedTools,['edit','read','write'])
        || !same(x.excludedTools,['bash','bg_wait','contact_supervisor','subagent','watchdog_diff'])
        || x.systemPromptMode!=='replace' || !same(x.contextPolicy,{schemaVersion:1,defaultContext:'fresh',allowedContexts:['fresh']})
        || x.inheritProjectContext || x.inheritGlobalContext || x.inheritSkills || x.extensions.length
        || x.subagentOnlyExtensions.length || !same(x.mutationTools,['edit','write'])
        || !same(x.capabilityConstraints,{schemaVersion:1,operationIds:['OP-01','OP-02'],mutationPolicy:'ASSIGNMENT_SCOPE',scopePolicy:'SCP-001',additionalRuntimePermissions:'NONE'}))) bad('DEVELOPER_AUTHORITY');
      if (x.expectedRole==='Reviewer' && (!same(x.allowedTools,['read'])
        || !same(x.excludedTools,['bash','bg_wait','contact_supervisor','subagent','watchdog_diff'])
        || x.systemPromptMode!=='replace' || !same(x.contextPolicy,{schemaVersion:1,defaultContext:'fresh',allowedContexts:['fresh']})
        || x.inheritProjectContext || x.inheritGlobalContext || x.inheritSkills || x.extensions.length
        || x.subagentOnlyExtensions.length || x.mutationTools.length
        || !same(x.capabilityConstraints,{schemaVersion:1,operationIds:['OP-01','OP-07'],mutationPolicy:'DENY',scopePolicy:'SCP-001',additionalRuntimePermissions:'NONE'}))) bad('REVIEWER_AUTHORITY');
      if (x.expectedRole==='Oracle' && (!same(x.allowedTools,['read'])
        || !same(x.excludedTools,['bash','bg_wait','contact_supervisor','subagent','watchdog_diff'])
        || x.systemPromptMode!=='replace' || !same(x.contextPolicy,{schemaVersion:1,defaultContext:'fresh',allowedContexts:['fork','fresh']})
        || x.inheritProjectContext || x.inheritGlobalContext || x.inheritSkills || x.extensions.length
        || x.subagentOnlyExtensions.length || x.mutationTools.length
        || !same(x.capabilityConstraints,{schemaVersion:1,operationIds:['OP-01'],mutationPolicy:'DENY',scopePolicy:'SCP-001',additionalRuntimePermissions:'NONE'}))) bad('ORACLE_AUTHORITY');
      break;
    }
    case 'InputSource': {
      const x = input as ContractMap['InputSource'];
      if (own(x,'inline') === own(x,'path')) bad('SOURCE_EXCLUSIVITY');
      if (x.inline !== undefined && (byteLength(x.inline) !== x.snapshot.bytes || hashBytes(Buffer.from(x.inline,'utf8')) !== x.snapshot.digest)) bad('SNAPSHOT_MISMATCH');
      break;
    }
    case 'Criterion': {
      const x = input as ContractMap['Criterion'];
      if ((x.method === 'REVIEW') !== (x.commandIds.length === 0)) bad('COMMAND_METHOD','commandIds');
      break;
    }
    case 'ScopeSpec': {
      if (!validBaseRef((input as ContractMap['ScopeSpec']).baseRef)) bad('BASE_REF');
      break;
    }
    case 'TaskSpec': case 'AssignmentEnvelope': {
      const x = input as TaskSpec | AssignmentEnvelope;
      const requirements = new Set(x.requirements.map(r => r.id));
      const covered = new Set(x.acceptanceCriteria.flatMap(c => c.requirementIds));
      if (covered.size !== requirements.size || [...covered].some(id => !requirements.has(id))) bad('REQUIREMENT_COVERAGE');
      if (name === 'TaskSpec') {
        if (!x.validationCommands.some(c => c.required)) bad('REQUIRED_COMMAND');
        for (const c of x.acceptanceCriteria) for (const id of c.commandIds) {
          if (!x.validationCommands.some(cmd => cmd.id === id && cmd.required)) bad('COMMAND_REFERENCE',c.id);
        }
      } else {
        const a = input as AssignmentEnvelope;
        if (!validBaseRef(a.baseRef)) bad('BASE_REF');
        if (a.role !== 'Oracle' && a.context !== 'fresh') bad('CONTEXT_ROLE');
        if (['Developer','Reviewer'].includes(a.role)) need(a.baseCommit,'baseCommit');
        if (own(a,'candidateDigest') !== own(a,'candidateGeneration')) bad('CANDIDATE_PAIR');
        if (a.role === 'Reviewer') need(a.candidateDigest,'candidateDigest');
        if (a.role === 'Developer' && a.workRoot === a.repoRoot) bad('ORIGINAL_WORKSPACE');
        const allowed = a.role === 'Developer' ? ['OP-01','OP-02','OP-05','OP-08']
          : a.role === 'Reviewer' ? ['OP-01','OP-05','OP-07','OP-08']
          : a.role === 'Oracle' ? ['OP-01'] : ['OP-01','OP-05','OP-08'];
        if (a.authority.some(op => !allowed.includes(op))) bad('AUTHORITY');
        if (a.authority.includes('OP-02') && !a.allowedPaths.some(p => !a.deniedPaths.includes(p))) bad('EMPTY_WRITE_SCOPE');
      }
      break;
    }
    case 'Assessment': {
      const x = input as ContractMap['Assessment'];
      if (x.status !== 'UNVERIFIABLE') need(x.evidenceRefs.length,'evidenceRefs');
      break;
    }
    case 'RunRecord': {
      const x = input as ContractMap['RunRecord'];
      if (['BOUND','RUNNING','TERMINAL'].includes(x.status)) need(x.runId,'runId');
      if (x.status === 'TERMINAL') need(x.terminalProofRef,'terminalProofRef');
      if (x.status === 'NOT_DISPATCHED') {need(x.dispatchProofRef,'dispatchProofRef');if(x.role!=='Reviewer'||x.runId||x.childSessionId||x.terminalProofRef||x.resultRef||!x.requestId.startsWith('intent-'))bad('NO_DISPATCH_BINDING');}
      else if(x.dispatchProofRef)bad('NO_DISPATCH_BINDING');
      if (x.status === 'INTENT' && (x.runId || x.terminalProofRef || x.resultRef)) bad('INTENT_BINDING');
      break;
    }
    case 'Counters': {
      const c=input as ContractMap['Counters'];
      if (c.infrastructureRetries>1 || c.dispatches>64 || c.escalationEpisodes>4 || c.oracleInvocations>c.escalationEpisodes
        || c.reworkAttempts>c.attempts || c.attempts>c.dispatches) bad('COUNTERS');
      break;
    }
    case 'FailureRecord': if (checkHash && v.fingerprint !== fingerprint(input as FailureRecord)) bad('HASH_MISMATCH','fingerprint'); break;
    case 'Escalation': if (v.closed === true) need(v.decisionId,'decisionId'); break;
    case 'CapabilityEvidence': if (v.status === 'VERIFIED') need((v.evidenceRefs as readonly string[]).length,'evidenceRefs'); break;
    case 'HumanDecisionEvidence': if (v.decision === 'ANSWER') need(v.answer,'answer'); break;
    case 'CandidateEntry': if ((v.kind === 'SYMLINK') !== (v.mode === '120000')) bad('KIND_MODE'); break;
    case 'CandidateManifest': {
      const x = input as ContractMap['CandidateManifest'];
      // Well-formed Unicode UTF-8 byte order equals code-point order.
      let previous: string | undefined;
      for (const e of x.entries) {
        if (previous !== undefined && compareUtf8(previous,e.path) >= 0) bad('MANIFEST_ORDER');
        previous = e.path;
      }
      break;
    }
    case 'ReviewResult': {
      const x = input as ReviewResult;
      if (x.verdict === 'FAIL' && x.findings.length === 0) bad('FAIL_WITHOUT_FINDING');
      if (x.verdict === 'PASS' && (x.criteria.some(c => c.assessment.status !== 'PASS')
        || [x.scopeAssessment,x.testAssessment,x.actualChangesAssessment].some(a => a.status !== 'PASS')
        || x.findings.some(f => f.blocking) || x.residualRisks.some(r => r.blocking))) bad('PASS_CONTRADICTION');
      break;
    }
    case 'WorkflowState': {
      const x = input as WorkflowState; const c = x.counters;
      if ((x.state === 'AWAITING_HUMAN') !== (x.pendingGateId !== undefined)) bad('PENDING_GATE_STATE');
      if (x.pendingGateId && !x.gates.includes(x.pendingGateId)) bad('DANGLING_GATE');
      if (x.state === 'BLOCKED') need(x.blockedReason,'blockedReason');
      if (['COMPLETED','FAILED'].includes(x.state)) {
        need(x.terminalReason,'terminalReason');
        if (x.runs.some(r => !runQuiescent(r))) bad('TERMINAL_RUN');
      }
      if (x.state === 'COMPLETED') {
        need(x.completionEvidenceRefs.length,'completionEvidenceRefs'); need(x.candidate,'candidate');
        need(x.validations.length,'validations'); need(x.reviews.length,'reviews'); need(x.results.length,'results');
      }
      if (['IMPLEMENTING','TESTING','REVIEWING','COMPLETED'].includes(x.state)) need(x.baselineCommit,'baselineCommit');
      if (['TESTING','REVIEWING','COMPLETED'].includes(x.state)) need(x.candidate,'candidate');
      if (x.candidate && (x.candidate.root === x.repoRoot || x.candidate.baseCommit !== x.baselineCommit)) bad('CANDIDATE_BASE');
      if (c.attempts < x.runs.length || c.dispatches < x.runs.length || c.escalationEpisodes < x.escalations.length
        || c.oracleInvocations < x.runs.filter(r=>r.role==='Oracle').length) bad('COUNTERS');
      if (x.revision === 0 && (x.state !== 'PENDING' || Object.entries(c).some(([k,n]) => k !== 'schemaVersion' && n !== 0))) bad('INITIAL_STATE');
      if (!before(x.createdAt,x.updatedAt)) bad('TIME_ORDER');
      for (const e of x.escalations) {
        if (e.triggerFailureIds.some(id => !x.failures.some(f => f.id === id))) bad('DANGLING_FAILURE');
        if (e.decisionId && !x.decisions.some(d => d.id === e.decisionId)) bad('DANGLING_DECISION');
        if (e.oracleAttemptId && !x.runs.some(r => r.attemptId === e.oracleAttemptId && r.role === 'Oracle')) bad('ORACLE_ATTEMPT');
      }
      break;
    }
    case 'ValidationResult': {
      const x = input as ValidationResult;
      if (x.startedAt) need(x.logRef,'logRef');
      if (x.endedAt) { need(x.startedAt,'startedAt'); if (x.startedAt && !before(x.startedAt,x.endedAt)) bad('TIME_ORDER'); }
      if (x.status === 'NOT_RUN' && [x.startedAt,x.endedAt,x.exitCode].some(v => v !== undefined)) bad('NOT_RUN_EXECUTION');
      if (x.status === 'PASSED' || x.status === 'FAILED') {
        need(x.startedAt,'startedAt'); need(x.endedAt,'endedAt'); need(x.processProofRef,'processProofRef'); need(x.logRef,'logRef');
        if (x.exitCode === undefined || (x.status === 'PASSED') !== (x.exitCode === 0)) bad('EXIT_STATUS');
      }
      if (x.status === 'PASSED' && x.postCandidateDigest !== x.candidateDigest) bad('POST_DIGEST');
      if (x.status === 'TIMED_OUT') need(x.startedAt,'startedAt');
      break;
    }
    case 'HumanGate': {
      const x = input as HumanGate;
      if (x.approvedDataHash !== x.approvedData.digest) bad('GATE_DATA_HASH');
      if (own(x,'candidateDigest') !== own(x,'candidateGeneration')) bad('CANDIDATE_PAIR');
      if (x.type === 'onScopeChange') need(x.proposedSpecHash,'proposedSpecHash');
      if (x.status === 'APPROVED' || x.status === 'REJECTED' || x.status === 'CONSUMED') {
        need(x.decidedAt,'decidedAt'); if(x.authorizationKind==='PolicyDerivedAuthorization')need(x.policyAuthorizationRef,'policyAuthorizationRef');else need(x.humanDecisionRef,'humanDecisionRef');
      }
      if (x.humanDecisionRef) need(x.decidedAt,'decidedAt');
      if (x.decidedAt && x.authorizationKind!=='PolicyDerivedAuthorization') need(x.humanDecisionRef,'humanDecisionRef');
      if(x.schemaVersion===1&&(x.authorizationKind!==undefined||x.policyAuthorizationRef!==undefined))bad('GATE_VERSION_AUTHORITY');
      if(x.schemaVersion===2&&x.authorizationKind===undefined)bad('GATE_AUTHORITY_REQUIRED');
      if(x.authorizationKind==='PolicyDerivedAuthorization'&&(x.humanDecisionRef!==undefined||['onOracleDecision','onRetryExhausted'].includes(x.type)))bad('POLICY_GATE_AUTHORITY');
      if(x.authorizationKind!=='PolicyDerivedAuthorization'&&x.policyAuthorizationRef!==undefined)bad('POLICY_GATE_AUTHORITY');
      if (x.status === 'PENDING' && x.consumedEventId) bad('PENDING_DECISION');
      if (x.status === 'CONSUMED') need(x.consumedEventId,'consumedEventId');
      if (x.status === 'INVALIDATED') need(x.invalidationReason,'invalidationReason');
      if (x.decidedAt && !before(x.requestedAt,x.decidedAt)) bad('TIME_ORDER');
      const targets: Record<HumanGate['type'],readonly string[]> = {
        beforeImplementation:['PENDING','ANALYZING','READY','IMPLEMENTING'], onScopeChange:['ANALYZING'],
        onOracleDecision:['ANALYZING','REWORK','BLOCKED'], beforeCompletion:['REVIEWING'], onRetryExhausted:['ANALYZING','REWORK','BLOCKED'],
        beforeReviewerRedispatch:['REVIEWING'],
      };
      const continuation = { PENDING:'PREPARE',READY:'PREPARE',ANALYZING:'ANALYZE',IMPLEMENTING:'IMPLEMENT',REVIEWING:'REVIEW_FINAL',REWORK:'REWORK',BLOCKED:'RECONCILE' };
      if (!targets[x.type].includes(x.resumeState) || continuation[x.resumeState] !== x.continuation) bad('GATE_CONTINUATION');
      break;
    }
    case 'TransitionEvent': {
      const x = input as TransitionEvent;
      if (x.kind === 'CREATE') {
        if (x.targetState !== 'PENDING' || x.revision !== 0 || x.sourceState !== undefined || x.previousRevision !== undefined || x.previousEventHash !== undefined) bad('CREATE');
      } else {
        need(x.sourceState,'sourceState');
        if (x.previousRevision === undefined || x.previousRevision === Number.MAX_SAFE_INTEGER || x.revision !== x.previousRevision + 1) bad('REVISION');
        if (['COMPLETED','FAILED'].includes(x.sourceState ?? '')) bad('TERMINAL_EVENT');
      }
      if (x.kind === 'TRANSITION') {
        if (!x.transitionId || !/^TR-\d{3}$/.test(x.transitionId) || pairs[Number(x.transitionId.slice(3))-1] !== `${x.sourceState}>${x.targetState}`) bad('TRANSITION');
      } else if (x.transitionId !== undefined) bad('TRANSITION_ID');
      if (x.kind === 'RECORD') {
        need(x.recordType,'recordType'); if (x.targetState !== x.sourceState&&x.recordType!=='RECONCILED') bad('RECORD_STATE');
        const exclusive: Partial<Record<NonNullable<TransitionEvent['recordType']>,State>> = {
          CANDIDATE_MATERIALIZED:'IMPLEMENTING',VALIDATION_RECORDED:'TESTING',REVIEW_RECORDED:'REVIEWING',GATE_DECIDED:'AWAITING_HUMAN',
        };
        if (x.recordType && exclusive[x.recordType] && exclusive[x.recordType]!==x.sourceState) bad('RECORD_PHASE');
        if (['SPAWN_INTENT','RUN_BOUND','RESULT_RECEIVED','ESCALATION_OPENED'].includes(x.recordType??'')
          && ['PENDING','READY','AWAITING_HUMAN','TESTING'].includes(x.sourceState??'')) bad('RECORD_PHASE');
      } else if (x.recordType !== undefined) bad('RECORD_TYPE');
      break;
    }
  }
}
// Lexical ref checks only; existence/support in a repository is external.
function validBaseRef(ref: string): boolean {
  return !/^[a-fA-F0-9]{40}(?:[a-fA-F0-9]{24})?$/.test(ref) && ref!=='@' && !ref.startsWith('-')
    && !/[\x00-\x20\x7f~^:?*\[\\]/.test(ref) && !ref.includes('..') && !ref.includes('@{') && !ref.endsWith('.')
    && ref.split('/').every(part=>part!=='' && !part.startsWith('.') && !part.endsWith('.lock'));
}
function ordered(values: readonly string[]): boolean {
  return values.every((value,index)=>index===0 || codePoint(value,values[index-1])>0);
}
function codePoint(a: string,b: string): number {
  const aa=Array.from(a,c=>c.codePointAt(0)!),bb=Array.from(b,c=>c.codePointAt(0)!);
  for(let i=0;i<Math.min(aa.length,bb.length);i++) if(aa[i]!==bb[i]) return aa[i]-bb[i];
  return aa.length-bb.length;
}
function compareUtf8(a: string,b: string): number {
  const aa=Buffer.from(a,'utf8'),bb=Buffer.from(b,'utf8');
  for(let i=0;i<Math.min(aa.length,bb.length);i++) if(aa[i]!==bb[i]) return aa[i]-bb[i];
  return aa.length-bb.length;
}

/** Deterministic cross-object checks only; registry membership is not authentication. */
export function currentValidationEvidence(spec:TaskSpec,state:WorkflowState,records:readonly ValidationResult[]):readonly ValidationResult[]{
  const current=new Map<string,ValidationResult>();
  for(const id of state.validations){
    const matches=records.filter(value=>value.id===id);
    if(matches.length!==1)throw new Error('RESULT_CONTRADICTORY');
    const value=matches[0],command=spec.validationCommands.find(command=>command.id===value.commandId);
    if(state.invalidEvidenceIds.includes(id)||value.taskId!==state.taskId||value.specHash!==state.specHash
      ||value.candidateDigest!==state.candidate?.digest||value.candidateGeneration!==state.candidate?.generation
      ||!command||value.commandHash!==hashCanonical(command))continue;
    current.set(value.commandId,value);
  }
  return Object.freeze([...current.values()]);
}

export function crossSemantics(name: ContractName, input: unknown, ctx: ValidationContext, errors: Issue[]): void {
  const bad = (code: string,path='$') => issue(errors,'semantic',code,path);
  // ponytail: linear registry lookup; index by ID if packet size makes it costly.
  function resolve<K extends ContractName>(id: string | undefined, kind: K, path: string): ContractMap[K] | undefined {
    if (id === undefined) { issue(errors,'context','CONTEXT_REQUIRED',path); return; }
    const record = ctx.records.find(r => r.id === id);
    if (!record) { issue(errors,'context','UNRESOLVED_REFERENCE',path); return; }
    if (record.kind !== kind) { bad('REFERENCE_TYPE',path); return; }
    return record.value as ContractMap[K];
  }
  const anyRef = (id: string,path: string) => {
    if (!ctx.records.some(r => r.id === id)) issue(errors,'context','UNRESOLVED_REFERENCE',path);
  };
  function references(value: unknown,path: string): void {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((v,i) => references(v,`${path}[${i}]`)); return; }
    for (const [key,v] of Object.entries(value)) {
      const p=path+'.'+key;
      if (['evidenceRefs','inputArtifactRefs','baselineEvidence','completionEvidenceRefs','invalidEvidenceIds','invalidatedEvidenceIds'].includes(key))
        (v as readonly string[]).forEach((id,i) => anyRef(id,`${p}[${i}]`));
      if (['logRef','processProofRef','terminalProofRef','dispatchProofRef','trustedChannelEvidenceRef','resultRef'].includes(key)) anyRef(v as string,p);
      const typedRefs: Record<string,ContractName> = { humanGateId:'HumanGate',sourceApprovalGateId:'HumanGate',
        humanDecisionRef:'HumanDecisionEvidence',policyAuthorizationRef:'ArtifactRef',consumedEventId:'TransitionEvent',pendingGateId:'HumanGate' };
      if (own(typedRefs,key)) resolve(v as string,typedRefs[key],p);
      if (key==='subjectId' && own(value,'kind')) {
        const decision=value as ContractMap['DecisionRecord'];
        const subjects: Partial<Record<ContractMap['DecisionRecord']['kind'],ContractName>> = {
          ACCEPT_FINDING:'Finding',DISMISS_FINDING:'Finding',DEFER_RISK:'Risk',RESOLVE_RISK:'Risk',ADOPT_ADVICE:'OracleResult',REJECT_ADVICE:'OracleResult',
        };
        const kind=subjects[decision.kind];
        if (kind) resolve(v as string,kind,p); else anyRef(v as string,p);
      }
      if (key==='resultRef' && own(value,'role')) {
        const run=value as ContractMap['RunRecord'];
        const results: Record<ContractMap['RunRecord']['role'],ContractName> = {
          Scout:'ScoutResult',Developer:'DeveloperResult',Reviewer:'ReviewResult',Oracle:'OracleResult',
        };
        resolve(v as string,results[run.role],p);
      }
      if (key==='assignmentId' && own(value,'status') && own(value,'role')) {
        const run=value as ContractMap['RunRecord'];
        const assignments=ctx.records.filter(r=>r.kind==='AssignmentEnvelope' && r.value.assignmentId===run.assignmentId);
        if (assignments.length!==1) issue(errors,'context','UNRESOLVED_ASSIGNMENT',p);
        else {
          const a=assignments[0].value as AssignmentEnvelope;
          if (a.attemptId!==run.attemptId || a.role!==run.role) bad('RUN_BINDING',p);
        }
      }
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && own(v,'relativeStorePath') && own(v,'digest')) {
        const ref = v as ContractMap['ArtifactRef'];
        anyRef(ref.id,p+'.id');
        const record=ctx.records.find(r=>r.id===ref.id);
        if (record?.kind==='ArtifactRef' && !same(ref,record.value)) bad('ARTIFACT_BINDING',p);
      }
      references(v,p);
    }
  }
  references(input,'$');
  // Shape/context check only. Durable channel v2 bytes and presentation chain are verified by store/host.
  const decisionRevision=(d:ContractMap['HumanDecisionEvidence'],g:HumanGate)=>d.displayedRevision===g.stateRevision||
    (d.displayedRevision>g.stateRevision&&ctx.records.some(r=>r.id===d.trustedChannelEvidenceRef&&r.kind==='ArtifactRef'&&
      r.value.mediaType==='application/vnd.pi-controlled-dev.human-channel-v2+json'));
  const spec = () => resolve(ctx.specId,'TaskSpec','context.specId');
  const assignment = () => resolve(ctx.assignmentId,'AssignmentEnvelope','context.assignmentId');
  const state = () => resolve(ctx.stateId,'WorkflowState','context.stateId');
  function binding(x: { taskId: string; specHash: string },s: TaskSpec | undefined): void {
    if (s && (x.taskId !== s.taskId || x.specHash !== s.specHash)) bad('SPEC_BINDING');
  }
  function candidate(x: { candidateDigest: string; candidateGeneration: number },s: WorkflowState | undefined): void {
    if (s && (!s.candidate || x.candidateDigest !== s.candidate.digest || x.candidateGeneration !== s.candidate.generation)) bad('CANDIDATE_BINDING');
  }
  function risks(value: unknown,s: TaskSpec | undefined): void {
    if (!s || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(v => risks(v,s)); return; }
    for (const [key,v] of Object.entries(value)) {
      if (key === 'criterionIds' && (v as readonly string[]).some(id => !s.acceptanceCriteria.some(c => c.id === id))) bad('DANGLING_CRITERION');
      risks(v,s);
    }
  }
  switch(name) {
    case 'RetryPolicy': {
      const x=input as ContractMap['RetryPolicy'];
      if (x.maxReworkAttempts>(ctx.globalReworkCap??2)) bad('REWORK_CAP');
      break;
    }
    case 'Counters': {
      const x=input as ContractMap['Counters'],s=spec();
      if (s) for (const [count,cap] of [['reworkAttempts','maxReworkAttempts'],['infrastructureRetries','maxInfrastructureRetries'],['dispatches','maxDispatches'],['escalationEpisodes','maxEscalationEpisodes']] as const)
        if (x[count]>s.retryPolicy[cap]) bad('COUNTER_CAP');
      break;
    }
    case 'TaskSpec': {
      const x=input as TaskSpec;
      if (x.retryPolicy.maxReworkAttempts > (ctx.globalReworkCap ?? 2)) bad('REWORK_CAP');
      if (ctx.modelExtracted === undefined) issue(errors,'context','CONTEXT_REQUIRED','context.modelExtracted');
      if (ctx.modelExtracted && !x.sourceApprovalGateId) bad('EXTRACTION_APPROVAL');
      if (x.sourceApprovalGateId) {
        const g=resolve(x.sourceApprovalGateId,'HumanGate','$.sourceApprovalGateId');
        if (g && (g.taskId!==x.taskId || g.specHash!==x.specHash || g.type!=='beforeImplementation' || !['APPROVED','CONSUMED'].includes(g.status))) bad('EXTRACTION_GATE');
      }
      break;
    }
    case 'AssignmentEnvelope': {
      const x=input as AssignmentEnvelope,s=spec(); binding(x,s);
      if (s) {
        if (!runtimeRootMatches(s.scope.repoRoot,x.repoRoot,state(),ctx.runtimeRootMappings) || x.allowedPaths.some(p=>!s.scope.allowedPaths.includes(p))
          || s.scope.deniedPaths.some(p=>!x.deniedPaths.includes(p))) bad('SCOPE_SUBSET');
        if (x.constraints.some(c=>!s.constraints.includes(c)) || s.constraints.some(c=>!x.constraints.includes(c))) bad('CONSTRAINT_COPY');
        for (const r of x.requirements) if (!s.requirements.some(q=>same(q,r))) bad('REQUIREMENT_COPY');
        for (const c of x.acceptanceCriteria) {
          if (!s.acceptanceCriteria.some(q=>same(q,c))) bad('CRITERION_COPY');
          for (const id of c.commandIds) if (!s.validationCommands.some(cmd=>cmd.id===id && cmd.required)) bad('COMMAND_REFERENCE');
        }
        if (x.role==='Reviewer' && (!same(x.requirements,s.requirements) || !same(x.acceptanceCriteria,s.acceptanceCriteria))) bad('REVIEWER_COVERAGE');
        for (const c of x.validationCommands) if (!s.validationCommands.some(q=>same(q,c))) bad('COMMAND_COPY');
      }
      if (x.candidateDigest!==undefined) {
        const st=state(); candidate({candidateDigest:x.candidateDigest,candidateGeneration:x.candidateGeneration!},st);
        if (st?.candidate && x.role==='Reviewer' && x.workRoot!==st.candidate.root) bad('REVIEW_ROOT');
      }
      break;
    }
    case 'ScoutResult': case 'DeveloperResult': case 'ReviewResult': case 'OracleResult': {
      const x=input as ContractMap['ScoutResult'] | ContractMap['DeveloperResult'] | ReviewResult | ContractMap['OracleResult'];
      const a=assignment(),s=spec(); binding(x,s); risks(x,s);
      if (a && (x.assignmentId!==a.assignmentId || x.attemptId!==a.attemptId || x.role!==a.role || x.assignmentHash!==a.assignmentHash || x.taskId!==a.taskId || x.specHash!==a.specHash)) bad('ASSIGNMENT_BINDING');
      if (name==='DeveloperResult' && a) {
        const d=input as ContractMap['DeveloperResult'];
        if (d.commandsRun.some(id=>!a.validationCommands.some(c=>c.id===id))) bad('COMMAND_REFERENCE');
        if (d.changedFiles.some(p=>!a.allowedPaths.includes(p) || a.deniedPaths.includes(p))) bad('DECLARED_SCOPE');
      }
      if (name==='ReviewResult') {
        const r=input as ReviewResult,st=state();
        candidate({candidateDigest:r.reviewedTreeHash,candidateGeneration:r.candidateGeneration},st);
        if (a && (a.candidateDigest!==r.reviewedTreeHash || a.candidateGeneration!==r.candidateGeneration)) bad('REVIEW_BINDING');
        if (s && (r.criteria.length!==s.acceptanceCriteria.length || r.criteria.some(c=>!s.acceptanceCriteria.some(q=>q.id===c.criterionId)))) bad('CRITERION_COVERAGE');
        if (ctx.currentValidationIds===undefined) issue(errors,'context','CONTEXT_REQUIRED','context.currentValidationIds');
        else if (r.validationResultIds.length!==ctx.currentValidationIds.length || r.validationResultIds.some(id=>!ctx.currentValidationIds!.includes(id))) bad('CURRENT_VALIDATIONS');
        const validations=r.validationResultIds.map(id=>resolve(id,'ValidationResult','$.validationResultIds'));
        for (const v of validations) if (v && (v.taskId!==r.taskId || v.specHash!==r.specHash || !s?.validationCommands.some(c=>c.id===v.commandId && hashCanonical(c)===v.commandHash) || v.candidateDigest!==r.reviewedTreeHash || v.candidateGeneration!==r.candidateGeneration || (r.verdict==='PASS' && s?.validationCommands.some(c=>c.id===v.commandId && c.required) && v.status!=='PASSED'))) bad('REVIEW_VALIDATION');
        if (s && s.validationCommands.filter(c=>c.required).some(c=>validations.filter(v=>v?.commandId===c.id).length!==1)) bad('VALIDATION_COVERAGE');
        if (st) {
          const reviewer=st.runs.find(run=>run.assignmentId===r.assignmentId);
          const developers=st.runs.filter(run=>run.role==='Developer');
          if (!reviewer || !reviewer.runId || !reviewer.childSessionId || !developers.length) issue(errors,'context','CONTEXT_REQUIRED','reviewer/developer runs');
          else if (reviewer.role!=='Reviewer' || reviewer.attemptId!==r.attemptId || developers.some(d=>!d.runId || !d.childSessionId || d.runId===reviewer.runId || d.childSessionId===reviewer.childSessionId)) bad('REVIEW_INDEPENDENCE');
        }
      }
      if (name==='OracleResult') {
        const o=input as ContractMap['OracleResult'],st=state();
        const e=st?.escalations.find(e=>e.id===o.escalationId);
        if (st && (!e || e.closed || e.oracleAttemptId!==o.attemptId)) bad('ESCALATION_BINDING');
      }
      break;
    }
    case 'ValidationResult': {
      const x=input as ValidationResult,s=spec(),st=state(); binding(x,s); candidate(x,st);
      if (st && (st.taskId!==x.taskId || st.specHash!==x.specHash)) bad('STATE_BINDING');
      const command=s?.validationCommands.find(c=>c.id===x.commandId);
      if (s && (!command || hashCanonical(command)!==x.commandHash)) bad('COMMAND_BINDING');
      break;
    }
    case 'HumanGate': {
      const x=input as HumanGate,st=state();
      // Historical gates use an explicitly supplied historical state, not today's candidate.
      if (st) {
        if (x.taskId!==st.taskId || x.specHash!==st.specHash) bad('GATE_BINDING');
        if (st.candidate) {
          if (x.candidateDigest===undefined) bad('GATE_CANDIDATE_REQUIRED');
          else candidate({candidateDigest:x.candidateDigest,candidateGeneration:x.candidateGeneration!},st);
        } else if (x.candidateDigest!==undefined) bad('GATE_CANDIDATE');
        if (x.status==='PENDING' && (st.state!=='AWAITING_HUMAN' || st.revision!==x.stateRevision || st.pendingGateId!==x.id)) bad('GATE_REVISION');
      }
      if (x.humanDecisionRef) {
        const d=resolve(x.humanDecisionRef,'HumanDecisionEvidence','$.humanDecisionRef');
        if (d && (d.gateId!==x.id || d.taskId!==x.taskId || !decisionRevision(d,x) || d.displayedDataHash!==x.approvedDataHash
          || (['APPROVED','CONSUMED'].includes(x.status) && d.decision!=='APPROVE') || (x.status==='REJECTED' && d.decision!=='REJECT'))) bad('HUMAN_DECISION_BINDING');
      }
      if (x.consumedEventId) {
        const e=resolve(x.consumedEventId,'TransitionEvent','$.consumedEventId');
        if (e && (e.taskId!==x.taskId || e.kind!=='TRANSITION' || e.sourceState!=='AWAITING_HUMAN' || e.targetState!==x.resumeState || e.revision<=x.stateRevision)) bad('GATE_CONSUMPTION');
      }
      break;
    }
    case 'WorkflowState': {
      const x=input as WorkflowState,s=resolve(x.spec.id,'TaskSpec','$.spec'); binding(x,s);
      if (s) {
        if (!runtimeRootMatches(s.scope.repoRoot,x.repoRoot,x,ctx.runtimeRootMappings)) bad('REPO_BINDING');
        try {if(x.runtimeBindingRef)runtimeRootMappingFor(x,ctx.runtimeRootMappings)}catch{bad('RUNTIME_BINDING')}
        for (const [count,cap] of [['reworkAttempts','maxReworkAttempts'],['infrastructureRetries','maxInfrastructureRetries'],['dispatches','maxDispatches'],['escalationEpisodes','maxEscalationEpisodes']] as const)
          if (x.counters[count]>s.retryPolicy[cap]) bad('COUNTER_CAP',`$.counters.${count}`);
      }
      if (x.revision>0) {
        const previous=resolve(ctx.previousStateId,'WorkflowState','context.previousStateId');
        if (previous) {
          if (previous.taskId!==x.taskId || previous.revision+1!==x.revision) bad('PREVIOUS_STATE');
          for (const k of ['attempts','reworkAttempts','infrastructureRetries','dispatches','escalationEpisodes','oracleInvocations'] as const)
            if (x.counters[k]<previous.counters[k]) bad('COUNTER_DECREASE');
          if (previous.candidate && x.candidate && (x.candidate.generation<previous.candidate.generation || (x.candidate.digest!==previous.candidate.digest && x.candidate.generation===previous.candidate.generation))) bad('CANDIDATE_GENERATION');
        }
      }
      const e=resolve(x.lastEventId,'TransitionEvent','$.lastEventId');
      if (e && (e.taskId!==x.taskId || e.targetState!==x.state || e.revision!==x.revision)) bad('EVENT_BINDING');
      for (const id of x.validations) resolve(id,'ValidationResult','$.validations');
      for (const id of x.reviews) resolve(id,'ReviewResult','$.reviews');
      for (const id of x.results) {
        anyRef(id,'$.results');
        const result=ctx.records.find(r=>r.id===id);
        if (result && !['ScoutResult','DeveloperResult','ReviewResult','OracleResult'].includes(result.kind)) bad('REFERENCE_TYPE','$.results');
      }
      for (const id of x.gates) {
        const gate=resolve(id,'HumanGate','$.gates');
        if (gate && gate.status==='PENDING' && x.pendingGateId!==gate.id&&!x.invalidEvidenceIds.includes(gate.id)) bad('PENDING_GATE');
      }
      break;
    }
    case 'TransitionEvent': {
      const x=input as TransitionEvent,after=resolve(x.stateAfter.id,'WorkflowState','$.stateAfter');
      if (after && (after.taskId!==x.taskId || after.state!==x.targetState || after.revision!==x.revision || after.lastEventId!==x.id)) bad('STATE_AFTER');
      if(x.kind==='RECORD'&&x.targetState!==x.sourceState){
        try{const m=after&&runtimeRootMappingFor(after,ctx.runtimeRootMappings);
          if(x.recordType!=='RECONCILED'||!m||m.payload.sourceRevision+1!==x.revision||m.payload.resumeState!==x.targetState||!x.evidenceRefs.includes(m.refId))bad('RECORD_STATE');
        }catch{bad('RECORD_STATE')}
      }
      if (x.kind!=='CREATE') {
        const prev=resolve(ctx.previousStateId,'WorkflowState','context.previousStateId');
        if (prev) {
          if (prev.taskId!==x.taskId || prev.revision!==x.previousRevision || prev.state!==x.sourceState) bad('PREVIOUS_STATE');
          const event=resolve(prev.lastEventId,'TransitionEvent','previous.lastEventId');
          if (event && x.previousEventHash!==undefined && x.previousEventHash!==event.eventHash) bad('PREVIOUS_EVENT_HASH');
        }
      }
      break;
    }
    case 'Requirement': {
      const x=input as ContractMap['Requirement'],s=spec();
      if (s && !s.acceptanceCriteria.some(c=>c.requirementIds.includes(x.id))) bad('REQUIREMENT_COVERAGE');
      break;
    }
    case 'Candidate': {
      const x=input as ContractMap['Candidate'],s=spec(),st=state();
      if (s && x.root===s.scope.repoRoot) bad('ORIGINAL_WORKSPACE');
      if (st && st.baselineCommit===undefined) issue(errors,'context','CONTEXT_REQUIRED','baselineCommit');
      else if (st && x.baseCommit!==st.baselineCommit) bad('CANDIDATE_BASE');
      if (st?.candidate && (x.generation<st.candidate.generation || (x.generation===st.candidate.generation && x.digest!==st.candidate.digest))) bad('CANDIDATE_GENERATION');
      break;
    }
    case 'Criterion': {
      const x=input as ContractMap['Criterion'],s=spec();
      if (s && (x.requirementIds.some(id=>!s.requirements.some(r=>r.id===id))
        || x.commandIds.some(id=>!s.validationCommands.some(c=>c.id===id && c.required)))) bad('CRITERION_REFERENCE');
      break;
    }
    case 'RunRecord': {
      const x=input as ContractMap['RunRecord'],a=assignment();
      if (a && (a.assignmentId!==x.assignmentId || a.attemptId!==x.attemptId || a.role!==x.role)) bad('RUN_BINDING');
      break;
    }
    case 'DecisionRecord': {
      const x=input as ContractMap['DecisionRecord'];
      const st=state();
      const nested=st ? [...st.failures,...st.escalations,...st.decisions].some(r=>r.id===x.subjectId) : false;
      if (!nested) anyRef(x.subjectId,'$.subjectId');
      if (x.humanGateId) resolve(x.humanGateId,'HumanGate','$.humanGateId');
      if(x.kind==='RESOLVE_RISK'||x.kind==='DEFER_RISK'){
        const s=spec(),risk=resolve(x.subjectId,'Risk','$.subjectId');
        const refs=x.evidenceRefs.map(id=>ctx.records.find(r=>r.id===id));
        const snapshots=refs.filter(r=>r?.kind==='WorkflowState');
        const bound=snapshots[0]?.value as ContractMap['WorkflowState']|undefined;
        if(!st||!s||!risk||snapshots.length!==1||!st.candidate||!bound?.candidate
          ||bound.taskId!==st.taskId||bound.specHash!==st.specHash||bound.candidate.digest!==st.candidate.digest
          ||bound.candidate.generation!==st.candidate.generation){bad('RISK_BINDING');break}
        if(risk.blocking||x.evidenceRefs.some(id=>st.invalidEvidenceIds.includes(id)))bad('RISK_EVIDENCE');
        for(const ref of refs)if(ref?.kind==='ValidationResult'){
          const v=ref.value;
          const latest=[...st.validations].reverse().map(id=>ctx.records.find(r=>r.id===id&&r.kind==='ValidationResult')?.value as ContractMap['ValidationResult']|undefined)
            .find(r=>r&&r.commandId===v.commandId&&r.specHash===st.specHash&&r.candidateDigest===st.candidate!.digest&&r.candidateGeneration===st.candidate!.generation);
          if(v.id!==latest?.id||v.status!=='PASSED')bad('RISK_VALIDATION');
        }
        const sources=['Developer','Reviewer'].map(role=>[...st.runs].reverse().find(r=>r.role===role)?.resultRef);
        if(!refs.some(r=>r&&sources.includes(r.id)&&(r.kind==='DeveloperResult'||r.kind==='ReviewResult')
          &&r.value.specHash===st.specHash&&r.value.residualRisks.some(v=>hashCanonical(v)===hashCanonical(risk))))bad('RISK_SOURCE');
        if(x.kind==='RESOLVE_RISK'){
          if(risk.id!=='host-validation-pending'||!risk.criterionIds.length)bad('RISK_RESOLUTION_UNSUPPORTED');
          for(const id of risk.criterionIds){
            const criterion=s.acceptanceCriteria.find(c=>c.id===id);
            if(criterion?.method==='REVIEW'){
              const run=[...st.runs].reverse().find(r=>r.role==='Reviewer');
              const record=refs.find(r=>r?.id===run?.resultRef&&r?.kind==='ReviewResult');
              const review=record?.value as ReviewResult|undefined;
              if(!run||run.status!=='TERMINAL'||!run.terminalProofRef||!ctx.records.some(r=>r.id===run.terminalProofRef&&r.kind==='ArtifactRef')
                ||st.invalidEvidenceIds.includes(run.terminalProofRef)||!record||!st.reviews.includes(record.id)||!st.results.includes(record.id)
                ||!review||review.verdict!=='PASS'||review.criteria.filter(c=>c.criterionId===id&&c.assessment.status==='PASS').length!==1){bad('RISK_REVIEW');continue}
              const current=currentValidationEvidence(s,st,ctx.records.filter(r=>r.kind==='ValidationResult').map(r=>r.value as ValidationResult));
              crossSemantics('ReviewResult',review,{...ctx,assignmentId:run.assignmentId,currentValidationIds:current.map(v=>v.id)},errors);
              continue;
            }
            if(!criterion?.commandIds.length){bad('RISK_CRITERION');continue}
            for(const commandId of criterion.commandIds){
              const command=s.validationCommands.find(c=>c.id===commandId&&c.required);
              const current=[...st.validations].reverse().map(id=>ctx.records.find(r=>r.id===id&&r.kind==='ValidationResult')?.value as ContractMap['ValidationResult']|undefined)
                .find(v=>v&&v.commandId===commandId&&v.specHash===st.specHash&&v.candidateDigest===st.candidate!.digest&&v.candidateGeneration===st.candidate!.generation);
              if(!command||!current||current.status!=='PASSED'||current.issuer!=='Orchestrator'||!current.logRef||!current.processProofRef
                ||current.commandHash!==hashCanonical(command)||!x.evidenceRefs.includes(current.id)
                ||[current.id,current.logRef,current.processProofRef].some(id=>st.invalidEvidenceIds.includes(id)||!ctx.records.some(r=>r.id===id)))bad('RISK_VALIDATION');
            }
          }
        }
      }
      break;
    }
    case 'HumanDecisionEvidence': {
      const x=input as ContractMap['HumanDecisionEvidence'],g=resolve(x.gateId,'HumanGate','$.gateId');
      if (g && (g.taskId!==x.taskId || !decisionRevision(x,g) || g.approvedDataHash!==x.displayedDataHash)) bad('HUMAN_DECISION_BINDING');
      break;
    }
    case 'Escalation': {
      const x=input as ContractMap['Escalation'],st=state();
      if (st && (x.triggerFailureIds.some(id=>!st.failures.some(f=>f.id===id))
        || (x.decisionId!==undefined && !st.decisions.some(d=>d.id===x.decisionId)))) bad('ESCALATION_REFERENCE');
      break;
    }
    case 'Risk': case 'Finding': risks(input,spec()); break;
    case 'CriterionAssessment': {
      const s=spec(),x=input as ContractMap['CriterionAssessment'];
      if (s && !s.acceptanceCriteria.some(c=>c.id===x.criterionId)) bad('DANGLING_CRITERION');
      break;
    }
  }
}
