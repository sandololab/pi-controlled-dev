import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {completedFixture,Promotion,inspect,channel,git,api,reviewerDouble} from './candidate-promotion-fixture.mjs';
export {Promotion,inspect,channel,git,api};
export const {IntegrationCheckpointRepository:Checkpoints}=await import('../src/integration-checkpoint-repository.ts');
export const {DurableStore}=await import('../src/store.ts');
export const {presentTrustedConfirmation}=await import('../src/trusted-confirmation.ts');
export const resolver=name=>name==='node'?process.execPath:git('/tmp','--exec-path')&&'/usr/bin/'+name;
const part1='exports.a = () => 2;\n',part2=part1+'exports.b = () => 3;\n';
const configuration=({repo,spec})=>{
  if(!readFileSafe(join(repo,'package.json'))){
    writeFileSync(join(repo,'package.json'),JSON.stringify({scripts:{test:'node integration.cjs'}})+'\n');
    // Initial fixture must pass its adopted tests before the Developer runs.
    // Feature presence is checked by the checkpoint's exact-content criterion.
    writeFileSync(join(repo,'file.txt'),'module.exports = {};\n');
    writeFileSync(join(repo,'integration.cjs'),"const assert=require('node:assert/strict'),m=require('./file.txt');assert.equal(typeof m,'object');if(m.a)assert.equal(m.a(),2);if(m.b){assert.equal(m.b(),3);assert.equal(m.a()+m.b(),5)}\n");
    git(repo,'add','.');git(repo,'commit','-qm','fixture integration tests');
  }
  spec.validationCommands=[{schemaVersion:1,id:'validation-1',executable:'/usr/bin/git',argv:['diff','--check'],timeoutMs:120000,required:true},
    {schemaVersion:1,id:'validation-2',executable:'/usr/bin/npm',argv:['test'],timeoutMs:120000,required:true}];
  spec.acceptanceCriteria=spec.acceptanceCriteria.map(c=>({...c,commandIds:['validation-2']}));
};
function readFileSafe(path){try{return readFileSync(path,'utf8')}catch{return}}
export async function integrate(f,taskId){return Promotion.withLease(f.data,f.repo,inspect,async p=>{const proposal=await p.prepare(taskId,reviewerDouble);if(!proposal)return;
  const q=p.prepareDecision(proposal.proposalId,'APPROVE'),r=await presentTrustedConfirmation(channel(),q);return p.applyDecision(q,r)});}
export async function integratedFixture({secondIntegrated=true,planning=false}={}){
  let planRepository,plan;
  const configure=async args=>{configuration(args);if(!planning)return;
    const {ProjectPlanningRepository}=await import('../src/project-planning-repository.ts'),{LockManager,withLockMutation}=await import('../src/lock-manager.ts');
    const {repo,data,spec}=args;
    planRepository??=ProjectPlanningRepository.open(data,repo,inspect,{create:true});
    if(!plan){const goal=planRepository.createGoal('Integrare due componenti che funzionano insieme');
      const task=(id,title,dependsOn=[])=>({plannedTaskId:id,title,objective:title,rationale:'Un incremento software verificabile',scopeIntent:['file.txt'],acceptanceIntent:['Il componente è disponibile'],validationIntent:['Suite e scenario integrati'],dependsOn,dependencyRationale:dependsOn.map(id=>({plannedTaskId:id,rationale:'Usa il componente precedente'})),relevantMemoryRefs:[]});
      const draft=planRepository.propose(goal.goalId,{proposal:{strategy:'A prima di B, poi verifica dell’interazione',plannedTasks:[task('planned-A','Introdurre A'),task('planned-B','Collegare B',['planned-A'])]},analysis:{}},planRepository.baseline());
      plan=await planRepository.approve(channel(),draft.revision);
    }
    const id=spec.taskId==='P1'?'planned-A':'planned-B',seed=planRepository.prepareStart(plan.planId,plan.revision,id);spec.objective=seed.objective;spec.specHash=api.hashContract('TaskSpec',spec);
    const m=new LockManager(data,'checkpoint-plan-fixture','checkpoint-plan-link');withLockMutation(m.root,planRepository.projectId,()=>planRepository.linkPreparedTask(seed,spec,m,true));
  };
  const f=await completedFixture({taskId:'P1',configure,developerContent:part1});await integrate(f,'P1');const m1=git(f.repo,'rev-parse','HEAD');
  const second=await completedFixture({root:f.root,existingRepo:true,taskId:'P2',configure,developerContent:part2});
  if(secondIntegrated)await integrate(f,'P2');const m2=git(f.repo,'rev-parse','HEAD');
  const checkpoints=Checkpoints.open(f.data,f.repo,inspect,{create:true});
  const ledger=DurableStore.load(f.storeRoot),scenario=ledger.records.filter(r=>r.kind==='ArtifactRef'&&r.value.mediaType==='application/vnd.pi-controlled-dev.executable-scenario+json')
    .map(r=>JSON.parse(readFileSync(join(f.storeRoot,r.value.relativeStorePath),'utf8'))).find(s=>s.scenarioId==='validation-2');
  const proposal={title:'Verifica insieme A e B',purpose:'Verificare l’interazione dei due componenti integrati.',controlledTaskRefs:['P1','P2'],
    validationIntent:['A e B sono presenti e funzionano insieme.'],validationPlan:[{kind:'EXISTING_TEST',description:'Suite integrata del repository',paths:[],expectedLines:[],mechanism:'NPM_TEST'},
      {kind:'CONTENT',description:'Sono presenti entrambi i componenti approvati',paths:['file.txt'],expectedLines:part2.split('\n')}],scenarios:[scenario],reviewRequired:true,...(plan?{plannedTaskRefs:planRepository.links().map(l=>({planId:l.planId,revision:l.planRevision,digest:l.planDigest,plannedTaskId:l.plannedTaskId,controlledTaskId:l.controlledTaskId}))}:{})};
  return {...f,second,m1,m2,checkpoints,proposal,planRepository,plan};
}
// Explicit policy/provider double only. Production adapters and transcript/terminal enforcement
// are exercised separately through the existing controlled.reviewer registration.
export function checkpointReviewer(verdict='PASS',hook){return {async reviewIntegration(repo,work,packet,options={}){
  await hook?.({repo,work,packet});const digest=api.hashCanonical(packet);
  const dispatch={requestId:'checkpoint-request',runId:'checkpoint-review',childSessionId:'fixture-child',ownerSessionId:'fixture-owner',agent:'controlled.reviewer'};
  options.onDispatchIdentity?.(dispatch);const proof={schemaVersion:1,runId:dispatch.runId,role:'Reviewer',requestId:dispatch.requestId,ownerSessionId:dispatch.ownerSessionId,childSessionId:dispatch.childSessionId,
    statusRequestId:'checkpoint-status',completionSessionId:'fixture-owner',terminalStatus:'complete',observedAt:new Date().toISOString(),source:'targeted-rpc-status',
    provider:{version:1,state:'observed',runId:dispatch.runId,runnerProcessInstanceId:'fixture-instance',observedAt:1,instances:[{kind:'runner',processInstanceId:'fixture-instance',closeObservedAt:1,exitCode:0,signal:null}],resumeDisposition:'resumable'}};
  options.onTerminalProof?.(proof);
  return {schemaVersion:1,source:'controlled.reviewer',packetDigest:digest,result:{packetDigest:digest,verdict,reason:'Declared policy double',criteria:packet.criteria.map(c=>({criterionId:c.id,status:verdict==='PASS'?'PASS':'FAIL',reason:'Fixture criterion'}))},
    runId:dispatch.runId,requestId:dispatch.requestId,sessionDigest:'a'.repeat(64),launchContractHash:'b'.repeat(64),invokedTools:['read'],terminalProofDigest:api.hashCanonical(proof),candidateUnchanged:true,originalWorkspaceUnchanged:true};
}};}

export async function checkpointMemory(f){
  const {ProjectMemoryRepository}=await import('../src/project-memory-repository.ts');
  const memory=ProjectMemoryRepository.open(f.data,f.repo,inspect,{create:true}),contents={
    'software-adr':{decisionKey:'component-boundary',context:'A e B condividono una baseline',decision:'Usare il confine esistente dei componenti',rationale:'Interazione verificabile',consequences:['Riutilizzare i componenti'],alternatives:[]},
    'technical-lesson':{problemKey:'integration-fixtures',problem:'Interazione non verificata',cause:'Test isolati',rule:'Verificare insieme A e B',loadWhen:{terms:['interazione'],paths:['file.txt']},invalidatedWhen:['Il componente cambia']},
    'project-convention':{convention:'Nomi espliciti per i componenti',rationale:'Verifiche leggibili'},
    'technical-constraint':{constraint:'Nessuna seconda persistenza',rationale:'Un solo store',consequences:['Riutilizzare le infrastrutture']}
  };
  for(const [recordKind,content] of Object.entries(contents)){
    const evidenceRefs=recordKind==='technical-lesson'?[{kind:'repository-source',id:'integration-source',relativePath:'file.txt',digest:api.hashBytes(readFileSync(join(f.repo,'file.txt')))}]:[];
    const r=memory.propose({recordKind,title:recordKind,scope:{kind:'component',path:'file.txt'},content,evidenceRefs,relatedTaskRefs:['P1','P2'],relatedRecordRefs:[]},{role:'host'});
    await memory.decide(channel(),r.recordId,recordKind==='software-adr'?'ACCEPTED':'ACTIVE');
  }
  const outside=memory.propose({recordKind:'project-convention',title:'Fuori ambito',scope:{kind:'directory',path:'unrelated'},content:contents['project-convention'],evidenceRefs:[],relatedTaskRefs:[],relatedRecordRefs:[]},{role:'host'});await memory.decide(channel(),outside.recordId,'ACTIVE');return memory;
}
