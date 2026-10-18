import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, cpSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { registerControlledScout } from '../src/controlled-scout.js';
import { registerControlledDeveloper } from '../src/controlled-developer.js';
import { registerControlledReviewer } from '../src/controlled-reviewer.js';
import { registerControlledOracle } from '../src/controlled-oracle.js';
import { CentralOrchestrator, registeredRoleDispatchers } from '../src/orchestrator.js';
import { DurableStore } from '../src/store.js';
import { canonicalize, hashBytes, hashContract } from '../src/contracts.js';
import { verifyCompletionPackage } from '../src/completion-package.js';
import { isolateParentTools } from '../extensions/controlled-dev.js';

export default function terminalHostProbe(pi:any):void{
  isolateParentTools(pi);
  pi.registerCommand('controlled-terminal-probe',{description:'P14B explicit real durable evidence chain; never completes',async handler(args:string,ctx:any){
    const reportPath=process.env.PI_CONTROLLED_TERMINAL_REPORT;if(!reportPath)throw new Error('REPORT_REQUIRED');
    const report:any={result:'BLOCKED',providerCopies:[]},offs:(()=>void)[]=[],registrations:any[]=[];let o:any,store:any;
    const dirs=new Map<string,string>();
    offs.push(pi.events.on('subagents:rpc:v1:request',(request:any)=>{
      if(request.method!=='spawn')return;
      offs.push(pi.events.on(`subagents:rpc:v1:reply:${request.requestId}`,(reply:any)=>{const d=reply.data?.details;
        if(reply.success&&d?.asyncId===d?.runId&&typeof d?.asyncDir==='string')dirs.set(d.runId,d.asyncDir)}));
    }));
    try{
      const root=mkdtempSync(join(tmpdir(),'controlled-terminal-real-'));report.root=root;
      const repo=join(root,'original'),work=join(root,'candidate'),data=join(root,'data');mkdirSync(repo);mkdirSync(data);
      const git=(path:string,...argv:string[])=>execFileSync('git',['-C',path,...argv],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024}).trim();
      writeFileSync(join(repo,'file.txt'),'before\n');git(repo,'init','-q');git(repo,'-c','user.name=Probe','-c','user.email=probe@example.invalid','add','.');
      git(repo,'-c','user.name=Probe','-c','user.email=probe@example.invalid','commit','-qm','base');const baseCommit=git(repo,'rev-parse','HEAD');
      git(repo,'worktree','add','--quiet','--detach',work,baseCommit);
      const original=()=>canonicalize({head:git(repo,'rev-parse','HEAD'),status:git(repo,'--no-optional-locks','status','--porcelain=v1'),
        bytes:hashBytes(readFileSync(join(repo,'file.txt'))),index:hashBytes(readFileSync(join(repo,'.git','index'))),headFile:hashBytes(readFileSync(join(repo,'.git','HEAD')))});
      const before=original(),ownerSessionId=ctx.sessionManager.getSessionId();if(!ownerSessionId)throw new Error('SESSION_REQUIRED');
      const scout=registerControlledScout(pi),developer=registerControlledDeveloper(pi),reviewer=registerControlledReviewer(pi),oracle=registerControlledOracle(pi);
      registrations.push(scout,developer,reviewer,oracle);if(registrations.some(r=>!r))throw new Error('REGISTRATION_UNAVAILABLE');
      // This fixture contains only controlled public test data; reject injected secret/transcript sentinels.
      store=DurableStore.create(data,repo,'terminal-real',raw=>/SYNTHETIC_SECRET|FULL_TRANSCRIPT/.test(Buffer.from(raw).toString('utf8'))?'REJECT':'ACCEPT');
      const v={schemaVersion:1},source={...v,inline:'Bounded public terminal evidence fixture',snapshot:store.put('source','Bounded public terminal evidence fixture','text/plain')};
      const requirement={...v,id:'req',text:'file.txt contains exactly terminal-safe followed by newline'};
      const command={...v,id:'check',executable:process.execPath,argv:['-e',"if(require('node:fs').readFileSync('file.txt','utf8')!=='terminal-safe\\n')process.exit(1)"],timeoutMs:5000,required:true};
      const spec:any={...v,taskId:'terminal-real',specRevision:0,title:'Durable terminal fixture',objective:'Replace file.txt with exactly terminal-safe followed by a newline.',
        plan:source,currentTask:source,requirements:[requirement],acceptanceCriteria:[{...v,id:'criterion',requirementIds:['req'],text:requirement.text,
          method:'AUTOMATED',commandIds:['check'],reviewInstruction:'After implementation, read file.txt and independently inspect the host canonical patch, manifest and validation evidence in the ReviewPacket. These are generated after Developer termination, not inputs required for Scout analysis.'}],
        scope:{...v,repoRoot:repo,baseRef:'HEAD',allowedPaths:['file.txt'],deniedPaths:[],strongConfinementRequired:false},constraints:['No delegation or shell'],validationCommands:[command],
        humanGates:{...v,beforeImplementation:false,onScopeChange:true,onOracleDecision:false,beforeCompletion:true,onRetryExhausted:false},
        retryPolicy:{...v,maxReworkAttempts:0,maxInfrastructureRetries:0,maxDispatches:3,maxEscalationEpisodes:1},specHash:'0'.repeat(64)};
      spec.specHash=hashContract('TaskSpec',spec);
      o=CentralOrchestrator.initialize(spec,{store,ownerSessionId,baselineRef:'HEAD',baselineCommit:baseCommit,artifacts:[source.snapshot],
        runners:registeredRoleDispatchers({events:pi.events,ownerSessionId,scout,developer,reviewer,oracle})});
      report.stage='Scout';await o.analyze(o.state.revision,{timeoutMs:120000,historyCanary:args.trim()});o.ready(o.state.revision);
      report.stage='Developer';await o.implement(o.state.revision,work,{timeoutMs:120000,historyCanary:args.trim()});
      report.stage='Validation';o.testing(o.state.revision);o.validateApproved(o.state.revision);
      report.stage='Reviewer';const capture=o.candidateCapture;
      const reviewed=await o.review(o.state.revision,{candidateManifest:capture.manifest,diff:capture.patch,changedFiles:capture.changedFiles,
        handoff:capture.handoff,residualRisks:[],evidenceRefs:[]},{timeoutMs:120000,historyCanary:args.trim()});
      if(reviewed.decision!=='HUMAN_GATE_REQUIRED')throw new Error(`REVIEW_${reviewed.decision}`);
      report.stage='Completion package';const ready=o.completionPackage(o.state.revision);report.package=ready;
      const packet=JSON.parse(Buffer.from(store.read(ready.artifact)).toString('utf8'));report.packet=packet;
      for(const run of o.state.runs){
        const ref=o.context().records.find((r:any)=>r.id===run.terminalProofRef).value;
        const proof=JSON.parse(Buffer.from(store.read(ref)).toString('utf8')),dir=dirs.get(run.runId);
        if(!dir)throw new Error('PUBLIC_PROVIDER_ARTIFACT_PATH_UNAVAILABLE');
        const path=join(dir,'process-terminal.json'),raw=readFileSync(path);
        const provider=JSON.parse(raw.toString('utf8'));
        if(provider.runId!==run.runId||provider.state!=='observed'||Object.entries(proof.provider).some(([key,value])=>canonicalize(provider[key])!==canonicalize(value)))throw new Error('PROVIDER_PROOF_MISMATCH');
        unlinkSync(path); // Only the public proof of this exact probe-owned terminal run.
        report.providerCopies.push({runId:run.runId,role:run.role,artifact:ref,providerDigest:hashBytes(raw),proof,providerProofRemoved:true});
      }
      report.retention=verifyCompletionPackage(packet,o.state,o.context().records,store);
      const loaded=DurableStore.load(store.root);if(canonicalize(loaded.state)!==canonicalize(o.state))throw new Error('LOAD_MISMATCH');
      const records=o.context().records,catalog=store.catalog(records),revision=o.state.revision+1;
      const forged={...o.state,state:'COMPLETED',terminalReason:'Adversarial fixture without human approval',revision,lastEventId:'forged-completion',updatedAt:new Date().toISOString()};
      const stateAfter=store.put('forged-terminal-snapshot',canonicalize(forged));
      const event:any={schemaVersion:1,id:'forged-completion',taskId:o.state.taskId,kind:'TRANSITION',actor:'Orchestrator',transitionId:'TR-022',
        sourceState:'REVIEWING',targetState:'COMPLETED',previousRevision:o.state.revision,revision,timestamp:forged.updatedAt,
        previousEventHash:o.events.at(-1).eventHash,reason:'Adversarial test without human approval',evidenceRefs:[catalog.id],invalidatedEvidenceIds:[],stateAfter,eventHash:'0'.repeat(64)};
      event.eventHash=hashContract('TransitionEvent',event);
      const denied=(action:()=>void)=>{try{action()}catch(error:any){if(String(error).includes('HUMAN_GATE_REQUIRED'))return 'HUMAN_GATE_REQUIRED';throw error}throw new Error('FALSE_COMPLETED_ACCEPTED')};
      report.terminalCommitRejection=denied(()=>store.commit(forged,event,records));
      const cloned=join(root,'negative-terminal-store');cpSync(store.root,cloned,{recursive:true});
      appendFileSync(join(cloned,'events.jsonl'),canonicalize(event)+'\n');writeFileSync(join(cloned,'state.json'),canonicalize(forged));
      report.terminalLoadRejection=denied(()=>DurableStore.load(cloned));
      if(canonicalize(DurableStore.load(store.root).state)!==canonicalize(o.state))throw new Error('NEGATIVE_TEST_MUTATED_STATE');
      report.originalUnchanged=before===original();report.parentReadOnly=canonicalize(pi.getActiveTools())===canonicalize(['read']);
      if(!report.originalUnchanged||!report.parentReadOnly||o.state.state!=='REVIEWING')throw new Error('ISOLATION_FAILED');
      report.result='PASS';
    }catch(error:any){report.error=String(error)}finally{
      for(const off of offs)off();for(const registration of registrations.reverse())registration?.dispose();
      if(o){report.state=o.state;report.events=o.events}if(store)report.storeRoot=store.root;
      writeFileSync(reportPath,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
    }
  }});
}
