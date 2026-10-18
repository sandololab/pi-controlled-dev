import { writeFileSync } from 'node:fs';
import { evaluateFailure } from '../src/retry-engine.js';

export default function retryHostProbe(pi:any):void {
  pi.registerCommand('controlled-retry-probe',{description:'Run the bounded P12 RET-001 host probe',handler(){
    const reportPath=process.env.PI_CONTROLLED_RETRY_REPORT;if(!reportPath)throw new Error('PI_CONTROLLED_RETRY_REPORT is required');
    const counters={schemaVersion:1 as const,attempts:0,reworkAttempts:0,infrastructureRetries:0,dispatches:0,escalationEpisodes:0,oracleInvocations:0};
    const policy={schemaVersion:1 as const,maxReworkAttempts:2,maxInfrastructureRetries:1,maxDispatches:64,maxEscalationEpisodes:4};
    const proof={dispatchOutcome:'KNOWN_FAILED' as const,transientInfrastructure:true,writerTerminal:true,workspaceSafe:true,sameProtocol:true,
      concreteHumanResolution:false,duplicateEscalation:false};
    const run=(source:'RPC_TRANSIENT'|'VALIDATION_FAILED'|'REVIEW_FAILED'|'SCOPE_GUARD_FAILED'|'SCHEMA_REJECTED'|'RECOVERY_CONFLICT'|'AMBIGUITY',extra={})=>
      evaluateFailure({input:{phase:'TESTING',source,code:'PROBE',subjectIds:['probe'],evidenceRefs:['evidence']},failures:[],counters,policy,proof:{...proof,...extra}});
    const actions={infra:run('RPC_TRANSIENT').action,unknown:run('RPC_TRANSIENT',{dispatchOutcome:'UNKNOWN'}).action,
      test:run('VALIDATION_FAILED').action,review:run('REVIEW_FAILED').action,scope:run('SCOPE_GUARD_FAILED').action,
      schema:run('SCHEMA_REJECTED').action,ambiguity:run('AMBIGUITY').action};
    const expected={infra:'RETRY_INFRASTRUCTURE',unknown:'BLOCK',test:'REWORK',review:'REWORK',scope:'BLOCK',schema:'BLOCK',ambiguity:'ESCALATE'};
    const input={phase:'TESTING' as const,source:'RPC_TRANSIENT' as const,code:'PROBE',subjectIds:['probe'],evidenceRefs:['evidence']};
    const before=JSON.stringify(counters);
    const budgets=[{cap:0,used:0,expected:'FAIL'},{cap:1,used:0,expected:'RETRY_INFRASTRUCTURE'},{cap:1,used:1,expected:'FAIL'}].map(test=>{
      const currentCounters={...counters,infrastructureRetries:test.used},currentPolicy={...policy,maxInfrastructureRetries:test.cap};
      const snapshot=JSON.stringify(currentCounters);
      const outcome=evaluateFailure({input,failures:[],counters:currentCounters,policy:currentPolicy,proof});
      return {...test,policy:currentPolicy,counters:currentCounters,proof,outcome,countersUnchanged:JSON.stringify(currentCounters)===snapshot};
    });
    const result=JSON.stringify(actions)===JSON.stringify(expected)&&JSON.stringify(counters)===before
      &&budgets.every(test=>test.outcome.action===test.expected&&test.outcome.failure.category==='INFRA'&&test.countersUnchanged)?'PASS':'BLOCKED';
    writeFileSync(reportPath,JSON.stringify({result,actions,budgets},null,2),{mode:0o600,flag:'wx'});
    if(result!=='PASS')throw new Error('P12_RETRY_PROBE_MISMATCH');
  }});
}
