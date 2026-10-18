import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { loadContracts } from './load-contracts.mjs';
import { fixtures, context, clone, H, TIME, GIT } from './contract-fixtures.mjs';
const api = await loadContracts();
const sha = text => createHash('sha256').update(text,'utf8').digest('hex');
const good = result => { assert.equal(result.ok,true,JSON.stringify(result)); return result.value; };
const bad = (result,code) => { assert.equal(result.ok,false); if(code) assert.ok(result.errors.some(e=>e.code===code),JSON.stringify(result.errors)); };
const record=(ctx,id,kind,value)=>{ ctx.records=ctx.records.filter(r=>r.id!==id); ctx.records.push({id,kind,value}); };
function scenario(name) {
  const f=fixtures(api),ctx=context(f);
  if (name==='Candidate') f.WorkflowState={...f.WorkflowState,baselineCommit:GIT};
  if (['ValidationResult','ReviewResult','OracleResult'].includes(name)) {
    f.WorkflowState={...f.WorkflowState,revision:1,state:'TESTING',baselineCommit:GIT,candidate:f.Candidate};
  }
  if (name==='HumanGate' || name==='HumanDecisionEvidence') {
    f.WorkflowState={...f.WorkflowState,revision:1,state:'AWAITING_HUMAN',pendingGateId:'gate',gates:['gate']};
    record(ctx,'gate','HumanGate',f.HumanGate);
  }
  if (['ScoutResult','ReviewResult','OracleResult'].includes(name)) {
    const role={ScoutResult:'Scout',ReviewResult:'Reviewer',OracleResult:'Oracle'}[name];
    const a={...f.AssignmentEnvelope,role,authority:['OP-01']};
    if(role==='Reviewer') Object.assign(a,{workRoot:'/candidate',candidateDigest:H,candidateGeneration:1});
    a.assignmentHash=api.hashContract('AssignmentEnvelope',a);
    f.AssignmentEnvelope=a; f[name]={...f[name],assignmentHash:a.assignmentHash};
    record(ctx,'assignment','AssignmentEnvelope',a);
  }
  if(name==='ReviewResult') {
    f.WorkflowState={...f.WorkflowState,state:'REVIEWING',runs:[
      {...f.RunRecord,assignmentId:'developer',attemptId:'developer-attempt'},
      {...f.RunRecord,role:'Reviewer',requestId:'review-request',runId:'review-run',childSessionId:'review-session'},
    ]};
    record(ctx,'validation','ValidationResult',f.ValidationResult); ctx.currentValidationIds=['validation'];
  }
  if(name==='OracleResult' || name==='Escalation') {
    f.Escalation={...f.Escalation,oracleAttemptId:'attempt'};
    f.WorkflowState={...f.WorkflowState,revision:1,state:'BLOCKED',blockedReason:'Diagnose',failures:[f.FailureRecord],escalations:[f.Escalation],runs:[{...f.RunRecord,role:'Oracle'}]};
  }
  const st=f.WorkflowState;
  f.WorkflowState={...st,counters:{...st.counters,attempts:st.runs.length,dispatches:st.runs.length,
    escalationEpisodes:st.escalations.length,oracleInvocations:st.runs.filter(r=>r.role==='Oracle').length}};
  record(ctx,'state','WorkflowState',f.WorkflowState);
  return {f,ctx,value:f[name]};
}

test('P4-001 — all DATA/AUX structures, required fields, closed nested records, no coercion', t=>{
  const f=fixtures(api);
  assert.equal(Object.keys(f).length,38);
  const optional={InputSource:['inline','path'],DecisionRecord:['humanGateId'],RunRecord:['runId','childSessionId','terminalProofRef','dispatchProofRef','resultRef'],
    Escalation:['oracleAttemptId','resultRef','decisionId'],HumanDecisionEvidence:['answer'],TaskSpec:['sourceApprovalGateId'],
    AssignmentEnvelope:['baseCommit','candidateDigest','candidateGeneration'],DeveloperResult:['blockedReason'],
    WorkflowState:['baselineRef','baselineCommit','candidate','pendingGateId','blockedReason','terminalReason'],
    ValidationResult:['startedAt','endedAt','exitCode','durationMs','logRef','processProofRef','postCandidateDigest'],
    HumanGate:['proposedSpecHash','candidateDigest','candidateGeneration','decidedAt','humanDecisionRef','consumedEventId','invalidationReason'],
    TransitionEvent:['transitionId','recordType','sourceState','previousRevision','previousEventHash']};
  // Optional fields are exercised structurally too; state-dependent combinations
  // are tested separately by the semantic groups below.
  const extras={InputSource:{path:'/source'},DecisionRecord:{humanGateId:'gate'},RunRecord:{resultRef:'result'},
    Escalation:{oracleAttemptId:'attempt',resultRef:'advice',decisionId:'decision'},HumanDecisionEvidence:{answer:'answer'},
    TaskSpec:{sourceApprovalGateId:'gate'},AssignmentEnvelope:{candidateDigest:H,candidateGeneration:1},DeveloperResult:{blockedReason:'blocked'},
    WorkflowState:{baselineRef:'HEAD',baselineCommit:GIT,candidate:f.Candidate,pendingGateId:'gate',blockedReason:'blocked',terminalReason:'terminal'},
    ValidationResult:{durationMs:0},HumanGate:{proposedSpecHash:H,candidateDigest:H,candidateGeneration:1,decidedAt:TIME,humanDecisionRef:'decision',consumedEventId:'event',invalidationReason:'invalid'},
    TransitionEvent:{transitionId:'TR-001',recordType:'SPEC_SNAPSHOT',sourceState:'PENDING',previousRevision:0,previousEventHash:H}};
  for(const [name,fields] of Object.entries(extras))f[name]={...f[name],...fields};
  let variants=0;
  for (const [name,value] of Object.entries(f)) {
    good(api.validateStructure(name,value));
    for(const key of Object.keys(value)) {
      const missing=clone(value); delete missing[key];
      if(!(optional[name]??[]).includes(key)) {bad(api.validateStructure(name,missing),'REQUIRED');variants++;}
      bad(api.validateStructure(name,{...value,[key]:null})); variants++;
    }
    function closed(node,path=[]) {
      if(node===null || typeof node!=='object')return;
      if(!Array.isArray(node)) {
        const altered=clone(value); let target=altered; for(const key of path) target=target[key];
        target.unexpected=true; bad(api.validateStructure(name,altered),'UNKNOWN_PROPERTY');variants++;
      }
      for(const [key,child] of Object.entries(node))closed(child,[...path,key]);
    }
    closed(value);
    bad(api.validateStructure(name,{...value,schemaVersion:name==='AssignmentEnvelope'?1:name==='HumanGate'?3:2}),name==='HumanGate'?'GATE_VERSION':'LITERAL');
  }
  bad(api.validateStructure('NotAContract',{}),'UNKNOWN_CONTRACT');
  t.diagnostic(`${Object.keys(f).length} structures; ${variants} required/type/closed-record variants`);
});

test('P4-002 — scalar boundaries, Unicode byte limits, exact formats and enums',()=>{
  const pass=(k,v)=>good(api.validateScalar(k,v)),fail=(k,v)=>bad(api.validateScalar(k,v));
  for(const value of ['a','a'.repeat(128)])pass('ID',value);
  for(const value of ['', 'a'.repeat(129),'é','a\n','a b','-a'])fail('ID',value);
  pass('Text','é'.repeat(2048));fail('Text','é'.repeat(2049));fail('Text','');fail('Text','a\0');
  pass('LongText','x'.repeat(65536));fail('LongText','x'.repeat(65537));
  for(const value of [0,-0,Number.MAX_SAFE_INTEGER])pass('UInt',value);
  for(const value of [-1,'12',1.2,NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1])fail('UInt',value);
  pass('Hash',H);for(const value of ['A'.repeat(64),H+'\n','a'.repeat(63),'g'.repeat(64)])fail('Hash',value);
  pass('GitOID',GIT);pass('GitOID','A'.repeat(64));fail('GitOID','a'.repeat(41));
  for(const value of [TIME,'2000-02-29T23:59:59.123Z','2000-02-29t23:59:59Z','2016-12-31T23:59:60Z'])pass('Time',value);
  for(const value of ['1900-02-29T00:00:00Z','2026-02-30T00:00:00Z','2026-01-01T24:00:00Z',TIME+'\n','2026-01-01T00:00:00+00:00'])fail('Time',value);
  pass('Path','file.txt');pass('Path','é'.repeat(2048));
  const drive=String.fromCharCode(67,58); // Synthetic Windows fixtures, not machine-local paths.
  for(const value of ['','/abs','../x','a/../b','a//b','a\\b',drive+'/x','a\0','a/'.repeat(2049)])fail('Path',value);
  pass('Root','/candidate');pass('Root',drive+'\\candidate');fail('Root','relative');fail('Root','/a/../b');
  pass('State','PENDING');fail('State','UNKNOWN');pass('Role','Reviewer');fail('Role','Orchestrator');
  const f=fixtures(api);for(const n of [-2147483648,2147483647,-0])good(api.validateStructure('ValidationResult',{...f.ValidationResult,exitCode:n}));
  for(const n of [-2147483649,2147483648,'0'])bad(api.validateStructure('ValidationResult',{...f.ValidationResult,exitCode:n}));
  bad(api.validateStructure('ReviewResult',{...f.ReviewResult,verdict:'OK'}),'ENUM');
});

test('P4-003 — canonical ordering, arrays, ASCII integer values and lexical independence',()=>{
  assert.equal(api.canonicalize({b:2,a:1}),'{"a":1,"b":2}');
  assert.equal(api.hashCanonical({b:2,a:1}),sha('{"a":1,"b":2}'));
  assert.equal(api.hashCanonical({a:1,b:2}),api.hashCanonical({b:2,a:1}));
  assert.equal(api.canonicalize({'\u{10000}':1,'\ue000':2,'2':2,'10':10}),'{"10":10,"2":2,"\ue000":2,"\u{10000}":1}');
  assert.notEqual(api.hashCanonical([1,2]),api.hashCanonical([2,1]));
  for(const [n,s] of [[0,'0'],[-0,'0'],[1,'1'],[-1,'-1'],[42,'42'],[Number.MAX_SAFE_INTEGER,'9007199254740991']])assert.equal(api.canonicalize(n),s);
  assert.deepEqual(api.canonicalBytes(0),api.canonicalBytes(-0));assert.equal(api.hashCanonical(0),api.hashCanonical(-0));
  for(const token of ['1','1.0','1e0','10e-1','0.1e1']) assert.equal(api.canonicalize(api.parseJson(token,100)), '1');
  for(const token of ['0','-0','0.0','-0e100']) assert.equal(api.canonicalize(api.parseJson(token,100)), '0');
  for(const n of [NaN,Infinity,-Infinity,0.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>api.canonicalize(n));
  for(const token of ['1.0000000000000000001','9007199254740991.1','9007199254740992','1e9999','1e-9999'])assert.throws(()=>api.parseJson(token,100));
  for(let i=0;i<30;i++)assert.equal(api.canonicalize({b:[1,-0],a:'é'}),'{"a":"é","b":[1,0]}');
});

test('P4-004 — prescribed escaping, no Unicode normalization, surrogate rejection',()=>{
  for(let c=0;c<32;c++)assert.equal(api.canonicalize(String.fromCharCode(c)),`"\\u${c.toString(16).padStart(4,'0')}"`);
  assert.equal(api.canonicalize('"\\/é😀'),'"\\"\\\\/é😀"');
  assert.notEqual(api.hashCanonical('é'),api.hashCanonical('e\u0301'));
  for(const s of ['\ud800','\udc00','x\ud800y']) {
    assert.throws(()=>api.canonicalize(s));assert.throws(()=>api.canonicalize({[s]:1}));
    assert.throws(()=>api.parseJson(JSON.stringify(s),100));
  }
  assert.equal(api.parseJson('"\\ud83d\\ude00"',100),'😀');
});

test('P4-005 — strict parsing rejects duplicate decoded keys, invalid UTF-8 and prose',()=>{
  for(const s of ['{"x":1,"x":2}','{"a":1,"\\u0061":2}','{"outer":{"x":1,"x":2}}'])assert.throws(()=>api.parseJson(s,100),/DUPLICATE_KEY/);
  for(const s of ['```json\n{}\n```','prose {}','{} trailing','01','+1','NaN','Infinity','[1,]','{"x":1,}','"\\x20"','\ufeff{}'])assert.throws(()=>api.parseJson(s,100));
  for(const bytes of [[0xff],[0xc0,0xaf],[0xed,0xa0,0x80]])assert.throws(()=>api.parseJson(Uint8Array.from(bytes),100),/UTF8/);
  good(api.validateScalar('Text',api.parseJson(Buffer.from('"é"'),100)));
  assert.deepEqual(api.parseJson('{"__proto__":{"polluted":true}}',100),JSON.parse('{"__proto__":{"polluted":true}}'));
  assert.equal({}.polluted,undefined);
  assert.throws(()=>api.parseJson('{}',1),/PAYLOAD_LIMIT/);
});

test('P4-006 — unknown-object ingress is inert, immutable, independent and fail-closed',()=>{
  let calls=0;
  const getter={get schemaVersion(){calls++;return 1;}};
  const proxy=new Proxy({}, {getPrototypeOf(){calls++;return Object.prototype;}});
  for(const v of [getter,proxy,{toJSON(){calls++;return {};}},new Date(),new Map(),Object.create({}),[,,],Object.assign([1],{extra:1}),{x:undefined},{x:Symbol()}, {x:1n}])bad(api.validateStructure('TaskSpec',v));
  const cyclic={};cyclic.self=cyclic;bad(api.validateStructure('TaskSpec',cyclic));
  const hidden={};Object.defineProperty(hidden,'x',{value:1});bad(api.validateStructure('TaskSpec',hidden));
  const bytes=Uint8Array.from(Buffer.from('{}'));
  for(const key of ['buffer','byteLength','byteOffset','length','valueOf'])Object.defineProperty(bytes,key,{get(){calls++;throw new Error('User getter');}});
  assert.deepEqual(api.parseJson(bytes,100),{});assert.equal(api.hashBytes(bytes),sha('{}'));
  assert.throws(()=>api.hashBytes('not bytes'));
  const hostileName={[Symbol.toPrimitive](){calls++;return 'TaskSpec';}};
  bad(api.validateStructure(hostileName,{}));bad(api.parseContract(hostileName,'{}'));bad(api.validateScalar(hostileName,0));
  assert.equal(calls,0);
  const {value,ctx}=scenario('TaskSpec');const result=api.validateContract('TaskSpec',value,ctx);const data=good(result);
  assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(data));assert.ok(Object.isFrozen(data.requirements));assert.ok(Object.isFrozen(data.requirements[0]));
  value.title='changed';assert.notEqual(data.title,value.title);
  const second=good(api.validateStructure('TaskSpec',fixtures(api).TaskSpec));assert.notEqual(data,second);assert.notEqual(data.requirements,second.requirements);
  const e=api.validateStructure('TaskSpec',{});bad(e);assert.ok(Object.isFrozen(e.errors));assert.ok(Object.isFrozen(e.errors[0]));
  assert.deepEqual(api.validateStructure('TaskSpec',{extra:1}),api.validateStructure('TaskSpec',{extra:1}));
});

test('P4-007 — every DATA/AUX fixture passes both layers with explicit data context',()=>{
  for(const name of Object.keys(fixtures(api))) {
    const {value,ctx}=scenario(name);
    const result=api.validateContract(name,value,ctx);
    assert.equal(result.ok,true,`${name}: ${JSON.stringify(result)}`);
    assert.equal(result.level,'semantic-data-only');assert.equal(result.externalVerification,'NOT_PERFORMED');
  }
});

test('P4-008 — semantic failures are distinct from structural and missing-context failures',()=>{
  const {value,ctx}=scenario('TaskSpec');
  good(api.validateStructure('TaskSpec',value));bad(api.validateContract('TaskSpec',value),'CONTEXT_REQUIRED');
  const duplicate=clone(value);duplicate.requirements.push(clone(duplicate.requirements[0]));
  good(api.validateStructure('TaskSpec',duplicate));bad(api.validateContract('TaskSpec',duplicate,ctx),'DUPLICATE');
  const dangling=clone(value);dangling.acceptanceCriteria[0].requirementIds=['missing'];bad(api.validateContract('TaskSpec',dangling,ctx),'REQUIREMENT_COVERAGE');
  const cmd=clone(value);cmd.acceptanceCriteria[0].commandIds=['missing'];bad(api.validateContract('TaskSpec',cmd,ctx),'COMMAND_REFERENCE');
  const method=clone(value);method.acceptanceCriteria[0].method='REVIEW';bad(api.validateContract('TaskSpec',method,ctx),'COMMAND_METHOD');
  const noRequired=clone(value);noRequired.validationCommands[0].required=false;bad(api.validateContract('TaskSpec',noRequired,ctx),'REQUIRED_COMMAND');
  const empty=clone(value);empty.validationCommands=[];bad(api.validateStructure('TaskSpec',empty),'CARDINALITY');
  const duplicateRefs=fixtures(api).Assessment;duplicateRefs.evidenceRefs=['evidence','evidence'];bad(api.validateContract('Assessment',duplicateRefs,ctx),'DUPLICATE');
  bad(api.validateContract('Assessment',{...duplicateRefs,evidenceRefs:['missing']},ctx),'UNRESOLVED_REFERENCE');
  bad(api.validateContract('TaskSpec',value,{...ctx,modelExtracted:true}),'EXTRACTION_APPROVAL');
  bad(api.validateContract('TaskSpec',value,{...ctx,globalReworkCap:1}),'REWORK_CAP');
  bad(api.validateContract('TaskSpec',value,{...ctx,records:[...ctx.records,ctx.records[0]]}),'INVALID_RECORD');
});

test('P4-009 — self-hash exclusions are exact, explicit, and SHA-256 golden vectors',()=>{
  const f=fixtures(api);
  for(const [name,field,included] of [['TaskSpec','specHash','title'],['AssignmentEnvelope','assignmentHash','objective'],['TransitionEvent','eventHash','reason']]) {
    const v=f[name],copy=clone(v);delete copy[field];
    assert.equal(api.hashContract(name,v),sha(api.canonicalize(copy)));
    assert.equal(api.hashContract(name,{...v,[field]:'0'.repeat(64)}),api.hashContract(name,v));
    assert.notEqual(api.hashContract(name,{...v,[included]:'different'}),api.hashContract(name,v));
  }
  assert.notEqual(api.hashContract('AssignmentEnvelope',{...f.AssignmentEnvelope,specHash:'0'.repeat(64)}),f.AssignmentEnvelope.assignmentHash);
  assert.notEqual(api.hashContract('AssignmentEnvelope',{...f.AssignmentEnvelope,launchContractHash:'0'.repeat(64)}),f.AssignmentEnvelope.assignmentHash);
  const fp={...f.FailureRecord,subjectIds:['z','a']};
  assert.equal(api.failureFingerprint(fp),sha('{"category":"TEST","code":"CHECK_FAILED","phase":"TESTING","subjectIds":["a","z"]}'));
  assert.equal(api.failureFingerprint(fp),api.failureFingerprint({...fp,id:'other',evidenceRefs:['other'],subjectIds:['a','z'],fingerprint:'0'.repeat(64)}));
  assert.notEqual(api.failureFingerprint(fp),api.failureFingerprint({...fp,code:'OTHER'}));
  assert.deepEqual(fp.subjectIds,['z','a']);
  assert.equal(api.hashBytes(Buffer.from('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('P4-010 — assignment v2 authority, launch contract, copied criteria, role context and candidate bindings',()=>{
  const {value,ctx}=scenario('AssignmentEnvelope');
  assert.equal(value.schemaVersion,2);
  bad(api.validateStructure('AssignmentEnvelope',{...value,schemaVersion:1}),'LITERAL');
  const f=fixtures(api),launch=f.ControlledLaunchContract;
  assert.equal(api.launchContractHash(launch),api.hashCanonical(launch));
  assert.notEqual(api.launchContractHash({...launch,baseSystemPromptHash:'0'.repeat(64)}),api.launchContractHash(launch));
  for(const altered of [
    {...launch,allowedTools:['read','write']}, {...launch,excludedTools:['contact_supervisor','bg_wait','watchdog_diff']},
    {...launch,allowNestedSubagents:true}, {...launch,inheritProjectContext:true},
  ]) bad(api.validateContract('ControlledLaunchContract',altered));
  for(const authority of [['OP-04'],['OP-09'],['OP-11'],['OP-12'],['OP-99']])bad(api.validateContract('AssignmentEnvelope',{...value,authority},ctx),'AUTHORITY');
  bad(api.validateContract('AssignmentEnvelope',{...value,context:'fork'},ctx),'CONTEXT_ROLE');
  bad(api.validateContract('AssignmentEnvelope',{...value,workRoot:value.repoRoot},ctx),'ORIGINAL_WORKSPACE');
  bad(api.validateContract('AssignmentEnvelope',{...value,allowedPaths:['elsewhere']},ctx),'SCOPE_SUBSET');
  bad(api.validateContract('AssignmentEnvelope',{...value,candidateDigest:H},ctx),'CANDIDATE_PAIR');
  const missing=clone(value);delete missing.baseCommit;bad(api.validateContract('AssignmentEnvelope',missing,ctx),'CONDITIONAL_REQUIRED');
  const copy=clone(value);copy.requirements[0].text='different';bad(api.validateContract('AssignmentEnvelope',copy,ctx),'REQUIREMENT_COPY');
});

test('P4-011 — TEST-017 data projection: complete review, PASS contradictions, no prose repair',()=>{
  const {value,ctx}=scenario('ReviewResult');
  for(const status of ['FAIL','UNVERIFIABLE']) {
    const v=clone(value);v.criteria[0].assessment.status=status;bad(api.validateContract('ReviewResult',v,ctx),'PASS_CONTRADICTION');
  }
  const blocking=clone(value);blocking.findings=[{...fixtures(api).Finding,blocking:true}];bad(api.validateContract('ReviewResult',blocking,ctx),'PASS_CONTRADICTION');
  const risk=clone(value);risk.residualRisks=[{...fixtures(api).Risk,blocking:true}];bad(api.validateContract('ReviewResult',risk,ctx),'PASS_CONTRADICTION');
  const duplicate=clone(value);duplicate.criteria.push(clone(duplicate.criteria[0]));bad(api.validateContract('ReviewResult',duplicate,ctx),'DUPLICATE');
  const omitted=clone(value);omitted.criteria[0].criterionId='other';bad(api.validateContract('ReviewResult',omitted,ctx),'CRITERION_COVERAGE');
  bad(api.parseContract('ReviewResult','Review: '+JSON.stringify(value),ctx));
  good(api.validateContract('ReviewResult',{...blocking,verdict:'FAIL'},ctx));
  good(api.validateContract('ReviewResult',{...value,verdict:'BLOCKED',criteria:[{...value.criteria[0],assessment:{...value.criteria[0].assessment,status:'UNVERIFIABLE',evidenceRefs:[]}}]},ctx));
  bad(api.validateContract('ReviewResult',{...value,reviewedTreeHash:'0'.repeat(64)},ctx),'CANDIDATE_BINDING');
  bad(api.validateContract('ReviewResult',value,{...ctx,currentValidationIds:[]}),'CURRENT_VALIDATIONS');
  const reused=clone(ctx);const st=reused.records.find(r=>r.id==='state').value;st.runs[1].childSessionId=st.runs[0].childSessionId;
  bad(api.validateContract('ReviewResult',value,reused),'REVIEW_INDEPENDENCE');
});

test('P4-012 — validation statuses and mandatory conditional fields remain distinct',()=>{
  const {value,ctx}=scenario('ValidationResult');
  for(const key of ['startedAt','endedAt','exitCode','logRef','processProofRef','postCandidateDigest']) {const v=clone(value);delete v[key];bad(api.validateContract('ValidationResult',v,ctx));}
  bad(api.validateContract('ValidationResult',{...value,exitCode:1},ctx),'EXIT_STATUS');
  bad(api.validateContract('ValidationResult',{...value,postCandidateDigest:'0'.repeat(64)},ctx),'POST_DIGEST');
  good(api.validateContract('ValidationResult',{...value,status:'FAILED',exitCode:1},ctx));
  const notRun=clone(value);for(const key of ['startedAt','endedAt','exitCode','logRef','processProofRef','postCandidateDigest'])delete notRun[key];notRun.status='NOT_RUN';
  good(api.validateContract('ValidationResult',notRun,ctx));
  bad(api.validateContract('ValidationResult',{...notRun,exitCode:0},ctx),'NOT_RUN_EXECUTION');
  good(api.validateContract('ValidationResult',{...notRun,status:'INVALID'},ctx));
  good(api.validateContract('ValidationResult',{...notRun,status:'TIMED_OUT',startedAt:TIME,logRef:'evidence'},ctx));
  bad(api.validateContract('ValidationResult',{...value,commandHash:'0'.repeat(64)},ctx),'COMMAND_BINDING');
});

test('P4-013 — gate data consistency, continuation and decision binding, never authentication',()=>{
  const {value,ctx,f}=scenario('HumanGate');
  bad(api.validateContract('HumanGate',{...value,continuation:'REVIEW_FINAL'},ctx),'GATE_CONTINUATION');
  bad(api.validateContract('HumanGate',{...value,stateRevision:0},ctx),'GATE_REVISION');
  bad(api.validateContract('HumanGate',{...value,approvedDataHash:'0'.repeat(64)},ctx),'GATE_DATA_HASH');
  const approved={...value,status:'APPROVED',decidedAt:TIME,humanDecisionRef:'human-decision'};
  bad(api.validateContract('HumanGate',approved,ctx),'UNRESOLVED_REFERENCE');
  record(ctx,'human-decision','HumanDecisionEvidence',f.HumanDecisionEvidence);
  const result=api.validateContract('HumanGate',approved,ctx);good(result);assert.equal(result.externalVerification,'NOT_PERFORMED');
  record(ctx,'human-decision','HumanDecisionEvidence',{...f.HumanDecisionEvidence,decision:'ANSWER',answer:'Perhaps'});
  bad(api.validateContract('HumanGate',approved,ctx),'HUMAN_DECISION_BINDING');
  bad(api.validateContract('HumanGate',{...value,status:'CONSUMED'},ctx),'CONDITIONAL_REQUIRED');
});

test('P4-014 — WorkflowState and TransitionEvent local/cross-object consistency; no state application',()=>{
  const {value,ctx,f}=scenario('WorkflowState');good(api.validateContract('WorkflowState',value,ctx));
  bad(api.validateContract('WorkflowState',{...value,state:'COMPLETED'},ctx),'CONDITIONAL_REQUIRED');
  bad(api.validateContract('WorkflowState',{...value,state:'AWAITING_HUMAN'},ctx),'PENDING_GATE_STATE');
  bad(api.validateContract('WorkflowState',{...value,counters:{...value.counters,dispatches:1}},ctx),'INITIAL_STATE');
  const event=f.TransitionEvent;good(api.validateContract('TransitionEvent',event,ctx));
  bad(api.validateContract('TransitionEvent',{...event,revision:1},ctx),'CREATE');
  const text=readFileSync(new URL('../docs/PROTOCOL.md',import.meta.url),'utf8');
  const rows=text.split('\n').filter(line=>/^\| TR-\d{3} \|/.test(line)).map(line=>line.split('|').slice(1,4).map(s=>s.trim()));
  assert.equal(rows.length,43);
  for(const [id,source,target] of rows) {
    const e={...event,kind:'TRANSITION',transitionId:id,sourceState:source,targetState:target,previousRevision:0,revision:1};
    // Hash API checks local row admissibility but does not evaluate guards or apply state.
    assert.equal(api.hashContract('TransitionEvent',e).length,64);
    assert.throws(()=>api.hashContract('TransitionEvent',{...e,targetState:source}));
  }
  assert.throws(()=>api.hashContract('TransitionEvent',{...event,kind:'RECORD',recordType:'RECONCILED',sourceState:'FAILED',targetState:'FAILED',previousRevision:0,revision:1}));
  assert.equal(value.state,'PENDING');
});

test('P4-015 — object payload and list limits include the whole serialized input',()=>{
  const cases=[['TaskSpec',256*1024],['AssignmentEnvelope',256*1024],['WorkflowState',4*1024*1024],['TransitionEvent',1024*1024],['CandidateManifest',64*1024*1024],
    ...['ScoutResult','DeveloperResult','ReviewResult','OracleResult','ValidationResult'].map(name=>[name,1024*1024])];
  for(const [name,max] of cases) {
    const {value,ctx}=scenario(name);const text=JSON.stringify(value);const padded=text+' '.repeat(max-Buffer.byteLength(text));
    good(api.parseContract(name,padded,ctx));bad(api.parseContract(name,padded+' ',ctx),'PAYLOAD_LIMIT');
  }
  const f=fixtures(api);
  good(api.validateStructure('CommandSpec',{...f.CommandSpec,argv:Array(64).fill('x')}));
  bad(api.validateStructure('CommandSpec',{...f.CommandSpec,argv:Array(65).fill('x')}),'CARDINALITY');
  bad(api.validateStructure('OracleResult',{...f.OracleResult,options:[]}),'CARDINALITY');
  good(api.validateStructure('TaskSpec',{...f.TaskSpec,constraints:Array(128).fill('x')}));
  bad(api.validateStructure('TaskSpec',{...f.TaskSpec,constraints:Array(129).fill('x')}),'CARDINALITY');
  bad(api.validateStructure('TaskSpec',{...f.TaskSpec,constraints:Array(128).fill('x'.repeat(4096))}),'PAYLOAD_LIMIT');
  good(api.validateContract('CandidateManifest',f.CandidateManifest));
  bad(api.validateContract('CandidateManifest',{...f.CandidateManifest,entries:[f.CandidateEntry,f.CandidateEntry]}),'MANIFEST_ORDER');
  bad(api.validateContract('CandidateEntry',{...f.CandidateEntry,kind:'SYMLINK'}),'KIND_MODE');
});

test('P4-016 — pure implementation boundary, no operational integrations or dependencies',()=>{
  for(const name of ['contracts','contract-json','contract-schema','contract-semantic','run-quiescence','runtime-root-mapping']) {
    const source=readFileSync(new URL(`../src/${name}.ts`,import.meta.url),'utf8');
    const tree=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true);
    function visit(node) {
      if(ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
        assert.ok(['node:crypto','node:buffer','node:util','./contract-json.js','./contract-schema.js','./contract-semantic.js','./run-quiescence.js','./runtime-root-mapping.js'].includes(node.moduleSpecifier.text));
      }
      assert.notEqual(node.kind,ts.SyntaxKind.ImportKeyword);
      if(ts.isIdentifier(node))assert.ok(!['process','globalThis','require','eval','Function','fetch','setTimeout','setInterval','console'].includes(node.text),node.text);
      ts.forEachChild(node,visit);
    }
    visit(tree);
  }
  const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.deepEqual(manifest.dependencies??{},{});assert.deepEqual(manifest.devDependencies,{typescript:'5.9.3'});
});

test('P4-017 — list cardinalities independently extracted from the normative document',t=>{
  const f=fixtures(api),doc=readFileSync(new URL('../docs/PROTOCOL.md',import.meta.url),'utf8');
  const cases=[];let section='';
  for(const line of doc.split('\n')) {
    const heading=/^### DATA-\d{3} — (\w+)/.exec(line);if(heading)section=heading[1];
    if(line.startsWith('## D.'))section='';
    const columns=line.split(/(?<!\\)\|/).map(s=>s.trim());
    const named=columns[1];
    if(Object.hasOwn(f,named)) {
      for(const m of line.matchAll(/(\w+):List<([^>]+)>\[(\d+)\.\.(\d+)\]/g))cases.push([named,m[1],m[2],+m[3],+m[4]]);
    } else if(section && Object.hasOwn(f,section)) {
      const ranges=[...(columns[2]??'').matchAll(/List<([^>]+)>\[(\d+)\.\.(\d+)\]/g)];
      const fields=(named??'').split(',').map(s=>s.trim());
      fields.forEach((field,i)=>{const m=ranges[i]??ranges[0];if(m && Array.isArray(f[section][field]))cases.push([section,field,m[1],+m[2],+m[3]]);});
    }
  }
  for(const name of ['ScoutResult','DeveloperResult','ReviewResult','OracleResult'])cases.push([name,'evidenceRefs','ID',0,256]);
  for(const field of ['requirements','acceptanceCriteria'])cases.push(['AssignmentEnvelope',field,field==='requirements'?'Requirement':'Criterion',1,256]);
  assert.ok(cases.length>=50);
  for(const [name,field,type,min,max] of cases) {
    const item=f[type]??({ID:'item',Text:'text',Path:'file.txt'}[type]);assert.notEqual(item,undefined,`${name}.${field}: ${type}`);
    for(const n of new Set([min,max])) good(api.validateStructure(name,{...f[name],[field]:Array(n).fill(item)}));
    if(min>0)bad(api.validateStructure(name,{...f[name],[field]:Array(min-1).fill(item)}),'CARDINALITY');
    bad(api.validateStructure(name,{...f[name],[field]:Array(max+1).fill(item)}),'CARDINALITY');
  }
  t.diagnostic(`${cases.length} normative list limits, each min/max and out-of-range checked`);
});

test('P4-018 — auxiliary invariants, dangling references and invalid context never silently pass',()=>{
  const f=fixtures(api),ctx=context(f);
  const rejects=[
    ['InputSource',{...f.InputSource,path:'/source'},'SOURCE_EXCLUSIVITY'],
    ['InputSource',{...f.InputSource,inline:'other'},'SNAPSHOT_MISMATCH'],
    ['Assessment',{...f.Assessment,evidenceRefs:[]},'CONDITIONAL_REQUIRED'],
    ['RunRecord',{...f.RunRecord,status:'INTENT'},'INTENT_BINDING'],
    ['Escalation',{...f.Escalation,closed:true},'CONDITIONAL_REQUIRED'],
    ['CapabilityEvidence',{...f.CapabilityEvidence,status:'VERIFIED'},'CONDITIONAL_REQUIRED'],
    ['HumanDecisionEvidence',{...f.HumanDecisionEvidence,decision:'ANSWER'},'CONDITIONAL_REQUIRED'],
    ['Counters',{...f.Counters,dispatches:65},'COUNTERS'],
    ['RetryPolicy',{...f.RetryPolicy,maxReworkAttempts:3},'REWORK_CAP'],
    ['Criterion',{...f.Criterion,commandIds:['missing']},'CRITERION_REFERENCE'],
    ['Risk',{...f.Risk,criterionIds:['missing']},'DANGLING_CRITERION'],
    ['Requirement',{...f.Requirement,id:'missing'},'REQUIREMENT_COVERAGE'],
    ['Candidate',{...f.Candidate,root:f.TaskSpec.scope.repoRoot},'ORIGINAL_WORKSPACE'],
    ['ScopeSpec',{...f.ScopeSpec,baseRef:'HEAD~1'},'BASE_REF'],
    ['ScopeSpec',{...f.ScopeSpec,baseRef:GIT},'BASE_REF'],
    ['CriterionAssessment',{...f.CriterionAssessment,criterionId:'missing'},'DANGLING_CRITERION'],
    ['DecisionRecord',{...f.DecisionRecord,subjectId:'missing'},'UNRESOLVED_REFERENCE'],
    ['FailureRecord',{...f.FailureRecord,fingerprint:'0'.repeat(64)},'HASH_MISMATCH'],
  ];
  for(const [name,value,code] of rejects)bad(api.validateContract(name,value,ctx),code);
  bad(api.validateContract('TaskSpec',f.TaskSpec,{...ctx,records:ctx.records.filter(r=>r.id!=='source')}),'UNRESOLVED_REFERENCE');
  bad(api.validateContract('TaskSpec',f.TaskSpec,{...ctx,extra:true}),'INVALID_CONTEXT');
  bad(api.validateContract('TaskSpec',f.TaskSpec,{...ctx,globalReworkCap:'2'}),'INVALID_CONTEXT');
  assert.throws(()=>api.hashContract('WorkflowState',f.WorkflowState),/UNKNOWN_HASH_CONTRACT/);
});

test('P14F.9A DecisionRecord closed enum adds RESOLVE_RISK without coercion or hash aliasing',()=>{
  const f=fixtures(api),resolve={...f.DecisionRecord,kind:'RESOLVE_RISK',subjectId:f.Risk.id};
  good(api.validateStructure('DecisionRecord',resolve));
  bad(api.validateStructure('DecisionRecord',{...resolve,kind:'RESOLVED_BY_EVIDENCE'}));
  bad(api.validateStructure('DecisionRecord',{...resolve,schemaVersion:2}));
  bad(api.validateStructure('DecisionRecord',{...resolve,candidateGeneration:1}));
  assert.equal(api.canonicalize(JSON.parse(api.canonicalize(resolve))),api.canonicalize(resolve));
  assert.notEqual(api.hashCanonical(resolve),api.hashCanonical({...resolve,kind:'DEFER_RISK'}));
  bad(api.validateContract('DecisionRecord',resolve,context(f))); // A schema-valid decision is not authority or current evidence.
});

test('P4-019 — explicit historical context, monotone counters and record phases',()=>{
  const f=fixtures(api),ctx=context(f);
  const previous={...f.WorkflowState,revision:1,state:'ANALYZING',counters:{...f.Counters,attempts:1,dispatches:1}};
  const current={...previous,revision:2,lastEventId:'current-event'};
  const event={...f.TransitionEvent,id:'current-event',kind:'RECORD',recordType:'RECONCILED',sourceState:'ANALYZING',targetState:'ANALYZING',previousRevision:1,revision:2};
  event.eventHash=api.hashContract('TransitionEvent',event);
  record(ctx,'current-event','TransitionEvent',event);record(ctx,'previous','WorkflowState',previous);ctx.previousStateId='previous';
  good(api.validateContract('WorkflowState',current,ctx));
  bad(api.validateContract('WorkflowState',{...current,counters:f.Counters},ctx),'COUNTER_DECREASE');
  const missing=clone(ctx);delete missing.previousStateId;bad(api.validateContract('WorkflowState',current,missing),'CONTEXT_REQUIRED');
  for(const recordType of ['CANDIDATE_MATERIALIZED','VALIDATION_RECORDED','REVIEW_RECORDED','GATE_DECIDED'])
    assert.throws(()=>api.hashContract('TransitionEvent',{...event,recordType}));
  const narrow=clone(f.TaskSpec);narrow.retryPolicy.maxDispatches=1;narrow.specHash=api.hashContract('TaskSpec',narrow);
  record(ctx,'spec','TaskSpec',narrow);
  bad(api.validateContract('Counters',{...f.Counters,dispatches:2},ctx),'COUNTER_CAP');
});


test('NOT_DISPATCHED is a Reviewer host-receipt outcome, never a fabricated terminal run',()=>{
 const f=fixtures(api),r={schemaVersion:1,assignmentId:'assignment',attemptId:'attempt',role:'Reviewer',requestId:'intent-attempt',ownerSessionId:'owner',status:'NOT_DISPATCHED',dispatchProofRef:'host-proof'};
 const ctx=context(f),a={...f.AssignmentEnvelope,role:'Reviewer',authority:['OP-01','OP-07'],candidateDigest:H,candidateGeneration:1,workRoot:'/candidate'};a.assignmentHash=api.hashContract('AssignmentEnvelope',a);record(ctx,'assignment','AssignmentEnvelope',a);record(ctx,'host-proof','ArtifactRef',{...f.ArtifactRef,id:'host-proof'});
 good(api.validateContract('RunRecord',r,ctx));
 for(const patch of [{role:'Developer'},{runId:'invented'},{childSessionId:'invented'},{resultRef:'invented'},{terminalProofRef:'invented'},{requestId:'provider-request'}])bad(api.validateContract('RunRecord',{...r,...patch},ctx),'NO_DISPATCH_BINDING');
 const missing={...r};delete missing.dispatchProofRef;bad(api.validateContract('RunRecord',missing,ctx));
 bad(api.validateContract('RunRecord',{...f.RunRecord,dispatchProofRef:'host-proof'},ctx),'NO_DISPATCH_BINDING');
});
