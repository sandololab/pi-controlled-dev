import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerControlledScout } from '../src/controlled-scout.js';
import { registerControlledDeveloper } from '../src/controlled-developer.js';
import { registerControlledReviewer } from '../src/controlled-reviewer.js';
import { registerControlledOracle } from '../src/controlled-oracle.js';
import { CentralOrchestrator, registeredRoleDispatchers } from '../src/orchestrator.js';
import { canonicalize, hashCanonical, hashContract } from '../src/contracts.js';
import { evaluateFailure } from '../src/retry-engine.js';
import { isolateParentTools } from '../extensions/controlled-dev.js';
import { inventoryTree } from '../src/controlled-agent-runtime.js';

const git=(cwd:string,args:string[])=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',timeout:10_000,maxBuffer:16*1024*1024}).replace(/\n$/,'');
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export default function orchestratorHostProbe(pi:any):void{
  isolateParentTools(pi);
  pi.registerCommand('controlled-orchestrator-probe',{description:'Run the explicit real serial P10 Scout/Developer/Reviewer integration probe',async handler(args:string,ctx:any){
    const reportPath=process.env.PI_CONTROLLED_ORCHESTRATOR_REPORT;if(!reportPath)throw new Error('PI_CONTROLLED_ORCHESTRATOR_REPORT is required');
    const reworkProbe=process.env.PI_CONTROLLED_REWORK_PROBE==='1',parallelProbe=process.env.PI_CONTROLLED_PARALLEL_PROBE==='1';
    const report:any={result:'BLOCKED',reworkProbe,parallelProbe,developerRuns:[],reviewerTerminals:[],reviewPackets:[],writerExclusion:{},validationEvidence:[],isolation:{snapshots:{}}};let scout:any,developer:any,reviewer:any,oracle:any,orchestrator:any;
    let repoRoot='',workRoot='';
    const snapshot=(stage:string,hasWork=true)=>{
      if(!repoRoot)return;
      report.isolation.snapshots[stage]={original:{head:git(repoRoot,['rev-parse','HEAD']),
        status:git(repoRoot,['--no-optional-locks','status','--porcelain=v1','-z','--untracked-files=all']),inventory:[...inventoryTree(repoRoot)]},
        originalCheckout:{inventory:[...inventoryTree(repoRoot,['.git'])],headFile:sha(readFileSync(join(git(repoRoot,['rev-parse','--absolute-git-dir']),'HEAD'))),
          index:sha(readFileSync(join(git(repoRoot,['rev-parse','--absolute-git-dir']),'index')))},
        candidate:hasWork?[...inventoryTree(workRoot)]:null,parentTools:pi.getActiveTools()};
    };
    try{
      const ownerSessionId=ctx.sessionManager.getSessionId();if(!ownerSessionId)throw new Error('NO_SESSION_ID');
      const root=mkdtempSync(join(tmpdir(),'controlled-orchestrator-real-')),repo=join(root,'original'),work=join(root,'candidate');mkdirSync(repo);
      writeFileSync(join(repo,'allowed.txt'),'before\n');if(reworkProbe)writeFileSync(join(repo,'second.txt'),'before\n');git(repo,['init','-q']);git(repo,['config','user.email','probe@example.invalid']);
      git(repo,['config','user.name','Probe']);git(repo,['add','.']);git(repo,['commit','-qm','base']);const baseCommit=git(repo,['rev-parse','HEAD']);
      repoRoot=repo;workRoot=work;report.fixtureRoot=root;snapshot('T0',false);
      git(repo,['worktree','add','--quiet','--detach',work,baseCommit]);snapshot('T1');const v={schemaVersion:1};
      scout=registerControlledScout(pi,'real-orchestrator-generation');developer=registerControlledDeveloper(pi,'real-orchestrator-generation');
      reviewer=registerControlledReviewer(pi,'real-orchestrator-generation');oracle=registerControlledOracle(pi,'real-orchestrator-generation');
      if(!scout||!developer||!reviewer||!oracle)throw new Error('REGISTRATION_UNAVAILABLE');
      const sourceArtifact={...v,id:'source',digest:sha('input'),relativeStorePath:'artifacts/source',bytes:5,mediaType:'text/plain'};
      const evidence={...v,id:'evidence',digest:'a'.repeat(64),relativeStorePath:'artifacts/evidence',bytes:1,mediaType:'application/json'};
      const source={...v,inline:'input',snapshot:sourceArtifact},requirement={...v,id:'req',text:reworkProbe?'Final candidate: allowed.txt contains orchestrated-safe newline and second.txt contains reworked-safe newline':'allowed.txt must contain exactly orchestrated-safe followed by a newline'};
      const criterion={...v,id:'criterion',requirementIds:['req'],text:requirement.text,method:'AUTOMATED',commandIds:['check'],reviewInstruction:'After implementation, read the target files and inspect the host-supplied ReviewPacket: canonical P11 JSON patch, CandidateManifest, cumulative handoff, and current-generation ValidationResult with log/process-proof ArtifactRefs. These are generated after the Developer terminates, not inputs required for Scout analysis.'};
      const command={...v,id:'check',executable:reworkProbe?process.execPath:'/usr/bin/true',
        argv:reworkProbe?['-e',`const fs=require('node:fs');process.exit(fs.readFileSync('allowed.txt','utf8')==='orchestrated-safe\\n'&&fs.readFileSync('second.txt','utf8')==='reworked-safe\\n'&&process.env.CONTROLLED_FORCE_FAIL!=='1'?0:1)`]:[],timeoutMs:1000,required:true};
      const spec:any={...v,taskId:'orchestrator-real-task',specRevision:0,title:'Real serial probe',objective:reworkProbe?'Controlled two-stage fixture, deliberately incomplete after its first writer. Scout only analyzes this complete plan; it does not select a writer stage. The first Developer assignment has no candidateGeneration field: write only allowed.txt to orchestrated-safe followed by newline and preserve second.txt. The host then records a forced validation failure. The Developer rework assignment has candidateGeneration=1: preserve allowed.txt without writing it and write only second.txt to reworked-safe followed by newline. Final acceptance requires both files. Absence of candidateGeneration explicitly identifies the first writer, not missing information.':'Replace allowed.txt with exactly orchestrated-safe followed by a newline.',
        plan:source,currentTask:source,requirements:[requirement],acceptanceCriteria:[criterion],scope:{...v,repoRoot:repo,baseRef:'HEAD',allowedPaths:reworkProbe?['allowed.txt','second.txt']:['allowed.txt'],deniedPaths:[],strongConfinementRequired:false},
        constraints:['No shell, delegation, commit, merge, push, or publish'],validationCommands:[command],humanGates:{...v,beforeImplementation:false,onScopeChange:true,onOracleDecision:false,beforeCompletion:false,onRetryExhausted:false},
        retryPolicy:{...v,maxReworkAttempts:reworkProbe?1:0,maxInfrastructureRetries:0,maxDispatches:8,maxEscalationEpisodes:1},specHash:'0'.repeat(64)};spec.specHash=hashContract('TaskSpec',spec);
      const runners=registeredRoleDispatchers({events:pi.events,ownerSessionId,scout,developer,reviewer,oracle});
      const denySecondWriter=async(phase:string)=>{
        const before=canonicalize(orchestrator.state.counters);let code='ADMITTED';
        try{await orchestrator.implement(orchestrator.state.revision,work)}catch(error:any){code=error.code}
        report.writerExclusion[phase]={code,countersUnchanged:before===canonicalize(orchestrator.state.counters)};
        if(!['ORCHESTRATOR_BLOCKED','ORCHESTRATOR_STATE_INVALID'].includes(code)||!report.writerExclusion[phase].countersUnchanged)throw new Error('WRITER_EXCLUSION_FAILED');
      };
      const tracedRunners={...runners,developer:async(assignment:any,context:any,options:any)=>{
        if(options?.reworkBase){report.authorizedReworkBase=options.reworkBase;snapshot('REWORK_PREPARED')}
        const pending=runners.developer!(assignment,context,options);
        if(parallelProbe&&!report.writerExclusion.developer){report.writerExclusion.developer={pending:true};await denySecondWriter('developer')}
        const output=await pending;report.developerRuns.push({assignment,evidence:output.evidence});return output;
      },reviewer:async(assignment:any,packet:any,context:any,options:any)=>{
        const diagnostic={assignment,packet,currentValidationIds:context.currentValidationIds,
          refs:packet.evidenceRefs.map((id:string)=>({id,records:context.records.filter((r:any)=>r.id===id).map((r:any)=>({kind:r.kind,issuer:r.value.issuer??'not-a-contract-field'}))}))};
        if(canonicalize(diagnostic).length>64*1024)throw new Error('REVIEW_PACKET_DIAGNOSTIC_LIMIT');
        report.reviewPacket=diagnostic;report.reviewPackets.push(diagnostic);
        const pending=runners.reviewer!(assignment,packet,context,options);
        if(parallelProbe&&!report.writerExclusion.review){report.writerExclusion.review={pending:true};await denySecondWriter('review')}
        const output=await pending;report.reviewerTerminals.push(output);report.reviewerTerminal=output;return output;
      }};
      orchestrator=CentralOrchestrator.initialize(spec,{ownerSessionId,runners:tracedRunners,parallelReviewEnabled:parallelProbe,
        artifacts:[sourceArtifact,evidence],baselineRef:'HEAD',baselineCommit:baseCommit});
      report.stage='SCOUT';const scoutDecision=await orchestrator.analyze(0,{timeoutMs:120_000,historyCanary:args.trim()});if(scoutDecision.decision!=='CONTINUE_TO_READY')throw new Error(`SCOUT_${scoutDecision.decision}:${JSON.stringify(scoutDecision.value?.ambiguities)}`);
      snapshot('SCOUT_TERMINAL');const originalBefore=inventory(repo,spec.scope.allowedPaths);
      orchestrator.ready(orchestrator.state.revision);report.stage='DEVELOPER';
      try{await orchestrator.implement(orchestrator.state.revision,work,{timeoutMs:120_000,historyCanary:args.trim()})}
      finally{snapshot('DEVELOPER_RETURN')}
      if(readFileSync(join(work,'allowed.txt'),'utf8')!=='orchestrated-safe\n')throw new Error('DEVELOPER_CONTENT_MISMATCH');
      report.isolation.developerAllowedEdit=true;
      const artifact=(id:string,content:string)=>({...v,id,digest:sha(content),relativeStorePath:`artifacts/${id}`,bytes:Buffer.byteLength(content,'utf8'),mediaType:'text/plain'});
      const validate=(forcedFailure:boolean)=>{
        orchestrator.testing(orchestrator.state.revision);const candidate=orchestrator.state.candidate,id=`validation-${candidate.generation}`;
        const startedAt=new Date().toISOString();let log='',exitCode=0;
        try{log=execFileSync(command.executable,command.argv,{cwd:work,encoding:'utf8',timeout:command.timeoutMs,maxBuffer:64*1024,
          env:{...process.env,CONTROLLED_FORCE_FAIL:forcedFailure?'1':'0'}})}catch(error:any){if(error.status!==1)throw error;exitCode=1;log=String(error.stdout??'')}
        const endedAt=new Date().toISOString(),proof=canonicalize({command,startedAt,endedAt,exitCode,forcedFailure});
        const validation={...v,id,taskId:spec.taskId,commandId:'check',specHash:spec.specHash,candidateDigest:candidate.digest,candidateGeneration:candidate.generation,
          commandHash:hashCanonical(command),status:exitCode===0?'PASSED':'FAILED',issuer:'Orchestrator',reason:forcedFailure?'Explicit host fault injection':'Host command passed',
          startedAt,endedAt,exitCode,logRef:`${id}-log`,processProofRef:`${id}-proof`,postCandidateDigest:candidate.digest};
        report.validationEvidence.push({validation,log,proof});
        orchestrator.recordValidations([validation],[artifact(validation.logRef,log),artifact(validation.processProofRef,proof)],orchestrator.state.revision);return validation;
      };
      report.generation1=orchestrator.state.candidate;
      if(reworkProbe){
        const failed=validate(true);if(failed.status!=='FAILED')throw new Error('FORCED_VALIDATION_DID_NOT_FAIL');
        const routed=orchestrator.routeFailure({phase:'TESTING',source:'VALIDATION_FAILED',code:'FORCED_CHECK_FAILED',subjectIds:['check'],evidenceRefs:[failed.id]},
          {dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:false,writerTerminal:true,workspaceSafe:true,sameProtocol:true,concreteHumanResolution:false,duplicateEscalation:false},orchestrator.state.revision);
        if(routed.decision!=='REWORK_REQUIRED')throw new Error('REWORK_NOT_ADMITTED');report.stage='REWORK';
        try{await orchestrator.rework(orchestrator.state.revision,join(root,'rework'),{timeoutMs:120_000,historyCanary:args.trim()})}finally{snapshot('REWORK_RETURN')}
        report.generation2=orchestrator.state.candidate;
      }
      validate(false);
      const capture=orchestrator.candidateCapture!,candidateManifest=capture.manifest,candidateDigest=capture.digest;
      report.stage='REVIEWER';const beforeReviews=[...inventoryTree(work)];
      const hostPacket={candidateManifest,diff:capture.patch,changedFiles:capture.changedFiles,handoff:capture.handoff,residualRisks:[],evidenceRefs:['evidence']};
      const result=await (parallelProbe?orchestrator.reviewParallel(orchestrator.state.revision,hostPacket,{timeoutMs:120_000,historyCanary:args.trim()}):
        orchestrator.review(orchestrator.state.revision,hostPacket,{timeoutMs:120_000,historyCanary:args.trim()}));
      if(parallelProbe){
        // Windows come from actual verified child transcripts, not Promise scheduling or wrapper timestamps.
        const windows=report.reviewerTerminals.map((output:any)=>{
          const path=output.evidence.childSessionId,raw=readFileSync(path);if(raw.byteLength>16*1024*1024)throw new Error('TIMING_EVIDENCE_LIMIT');
          const rows=raw.toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
          const start=rows.find(row=>row.message?.role==='toolResult'&&row.message?.toolName==='read');
          const end=rows.findLast(row=>row.message?.role==='toolResult'&&row.message?.toolName==='structured_output');
          return {runId:output.evidence.runId,childSessionId:path,transcriptHash:sha(raw),start:Date.parse(start?.timestamp),end:Date.parse(end?.timestamp)};
        });
        const overlapMs=Math.min(...windows.map((w:any)=>w.end))-Math.max(...windows.map((w:any)=>w.start));
        const candidateUnchanged=canonicalize(beforeReviews)===canonicalize([...inventoryTree(work)]);
        report.p13={windows,overlapMs,candidateUnchanged,writerExclusion:report.writerExclusion,uv012:'UNVERIFIED'};
        if(windows.length!==2||new Set(windows.map((w:any)=>w.runId)).size!==2||new Set(windows.map((w:any)=>w.childSessionId)).size!==2
          ||!Number.isFinite(overlapMs)||overlapMs<=0||!candidateUnchanged)throw new Error('TEST_041_NOT_PROVEN');
        report.p13.uv012='VERIFIED_FOR_THIS_RUN';
      }
      if(result.decision!=='COMPLETION_NOT_YET_AUTHORIZED'||orchestrator.state.state!=='REVIEWING')throw new Error(`FINAL_${result.decision}_${orchestrator.state.state}`);
      const originalAfter=inventory(repo,spec.scope.allowedPaths);if(JSON.stringify(originalBefore)!==JSON.stringify(originalAfter))throw new Error('ORIGINAL_CHANGED');
      const retryBase={input:{phase:'REVIEWING' as const,source:'RPC_TRANSIENT' as const,code:'TRANSIENT',subjectIds:['Reviewer'],evidenceRefs:['evidence']},
        failures:[],counters:orchestrator.state.counters,policy:spec.retryPolicy};
      const retryProof={dispatchOutcome:'KNOWN_FAILED' as const,transientInfrastructure:true,writerTerminal:true,workspaceSafe:true,sameProtocol:true,concreteHumanResolution:false,duplicateEscalation:false};
      const countersBefore=canonicalize(orchestrator.state.counters);
      const zero=evaluateFailure({...retryBase,policy:{...spec.retryPolicy,maxInfrastructureRetries:0},proof:retryProof});
      // Independent pure classifier case, not a policy increase for the active workflow.
      const positivePolicy={...spec.retryPolicy,maxInfrastructureRetries:1};
      const first=evaluateFailure({...retryBase,policy:positivePolicy,proof:retryProof});
      const exhausted=evaluateFailure({...retryBase,policy:positivePolicy,counters:{...retryBase.counters,infrastructureRetries:1},proof:retryProof});
      const unknown=evaluateFailure({...retryBase,policy:positivePolicy,proof:{...retryProof,dispatchOutcome:'UNKNOWN'}});
      report.p12={workflowPolicy:spec.retryPolicy,positivePolicy,countersBefore:retryBase.counters,countersAfter:orchestrator.state.counters,proof:retryProof,zero,first,exhausted,unknown};
      if(zero.action!=='FAIL'||first.action!=='RETRY_INFRASTRUCTURE'||exhausted.action!=='FAIL'||unknown.action!=='BLOCK'
        ||canonicalize(orchestrator.state.counters)!==countersBefore)throw new Error('P12_RETRY_CLASSIFICATION_MISMATCH');
      report.result='PASS';report.fixtureRoot=root;report.baseCommit=baseCommit;report.finalState=orchestrator.state;report.events=orchestrator.events;report.originalBefore=originalBefore;report.originalAfter=originalAfter;
    }catch(error){report.error=error instanceof Error?`${error.name}:${error.message}`:String(error)}
    finally{oracle?.dispose();reviewer?.dispose();developer?.dispose();scout?.dispose();snapshot('T3');
      if(orchestrator){report.finalState=orchestrator.state;report.events=orchestrator.events}
      const s=report.isolation.snapshots;
      report.isolation.originalStable=!!s.T1&&['SCOUT_TERMINAL','DEVELOPER_RETURN','T3'].every(stage=>s[stage]&&JSON.stringify(s[stage].original)===JSON.stringify(s.T1.original));
      if(reworkProbe&&s.REWORK_PREPARED&&s.REWORK_RETURN){
        const before=new Map(s.T1.original.inventory),prepared=new Map(s.REWORK_PREPARED.original.inventory);
        report.isolation.hostPreparationDelta=[...new Set([...before.keys(),...prepared.keys()])].filter(path=>before.get(path)!==prepared.get(path)).map(path=>({path,before:before.get(path)??null,after:prepared.get(path)??null}));
        const allocationOnly=report.isolation.hostPreparationDelta.every((d:any)=>d.before===null&&(d.path.startsWith('.git/objects/')||d.path.startsWith('.git/worktrees/rework')));
        const checkoutStable=['SCOUT_TERMINAL','DEVELOPER_RETURN','REWORK_PREPARED','REWORK_RETURN','T3'].every(stage=>s[stage]
          &&JSON.stringify(s[stage].originalCheckout)===JSON.stringify(s.T1.originalCheckout)&&s[stage].original.head===s.T1.original.head&&s[stage].original.status===s.T1.original.status);
        const firstCanary=JSON.stringify(s.T1.original)===JSON.stringify(s.DEVELOPER_RETURN.original);
        const secondCanary=JSON.stringify(s.REWORK_PREPARED.original)===JSON.stringify(s.REWORK_RETURN.original)&&JSON.stringify(s.REWORK_RETURN.original)===JSON.stringify(s.T3.original);
        report.isolation.originalStable=allocationOnly&&checkoutStable&&firstCanary&&secondCanary;
      }
      report.isolation.scoutPreservedCandidate=!!s.SCOUT_TERMINAL&&JSON.stringify(s.T1.candidate)===JSON.stringify(s.SCOUT_TERMINAL.candidate);
      report.isolation.parentReadOnly=Object.values(s).every((value:any)=>JSON.stringify(value.parentTools)===JSON.stringify(['read']));
      if(report.result==='PASS'&&(!report.isolation.originalStable||!report.isolation.parentReadOnly)){report.result='BLOCKED';report.error='ISOLATION_PROBE_FAILED'}
      writeFileSync(reportPath,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'})}
  }});
}
function inventory(root:string,paths=['allowed.txt']):any[]{return paths.map(path=>({path,mode:statSync(join(root,path)).mode&0o7777,hash:sha(readFileSync(join(root,path)))}))}
