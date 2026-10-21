import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installSourceLoader} from './load-source.mjs';
import {fixtures,TIME} from './contract-fixtures.mjs';
installSourceLoader();
const api=await import('../src/contracts.ts'),scenarioApi=await import('../src/scenario-management.ts');
const {DurableStore}=await import('../src/store.ts');
const {CentralOrchestrator}=await import('../src/orchestrator.ts');
const human=await import('../src/human-repository.ts');
const {productionStatusPages}=await import('../src/production-bridge.ts');

function fixture(t,{designRationale=true,repeatedTitle=false}={}){
  const root=mkdtempSync(join(tmpdir(),'controlled-human-')),repo=join(root,'repo'),data=join(root,'data');t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(repo);mkdirSync(data);
  const store=DurableStore.create(data,repo,'task',()=> 'ACCEPT'),f=fixtures(api),source=store.put('source','input','text/plain');
  const repeated='Fissare il comportamento dei due validatori duplicati prima di modificarli.';
  const requirement={...f.Requirement,text:repeatedTitle?repeated:'Il calcolo deve restituire il valore atteso.'};
  const criterion1={...f.Criterion,text:'Il calcolo restituisce il valore atteso'};
  const command2={...f.CommandSpec,id:'check-secondary',argv:['secondary']},criterion2={...f.Criterion,id:'criterion-secondary',commandIds:[command2.id],text:'Controlla il secondo comportamento'};
  const spec={...f.TaskSpec,title:repeatedTitle?repeated:'Calcolo controllato',objective:repeatedTitle?repeated:'Correggere il calcolo e conservarne prove tecniche comprensibili.',scope:{...f.TaskSpec.scope,repoRoot:repo},
    plan:{...f.InputSource,snapshot:source},currentTask:{...f.InputSource,snapshot:source},requirements:[requirement],acceptanceCriteria:[criterion1,criterion2],validationCommands:[f.CommandSpec,command2]};
  spec.specHash=api.hashContract('TaskSpec',spec);const runner=async()=>{throw new Error('no dispatch')};
  const o=CentralOrchestrator.initialize(spec,{ownerSessionId:'owner',runners:{scout:runner},store,artifacts:[source],now:()=>TIME});
  const ref=(id,content,media)=>store.put(id,api.canonicalize(content),media),scenario1=scenarioApi.createExecutableScenario(spec,'check',TIME),scenario2=scenarioApi.createExecutableScenario(spec,'check-secondary',TIME);
  const validation=(id,command,generation,status)=>({...f.ValidationResult,id,commandId:command.id,specHash:spec.specHash,commandHash:api.hashCanonical(command),candidateGeneration:generation,status,
    exitCode:status==='PASSED'?0:1,startedAt:TIME,endedAt:TIME,logRef:`log-${id}`,processProofRef:`proof-${id}`});
  const runtime=(validation,id,status)=>({schemaVersion:1,id,taskId:'task',validationId:validation.id,scenarioId:validation.commandId,commandHash:validation.commandHash,
    candidateDigest:validation.candidateDigest,candidateGeneration:validation.candidateGeneration,startedAt:TIME,endedAt:TIME,exitCode:validation.exitCode,status,
    complete:true,eventCount:1,eventLogRef:`events-${id}`,redactions:0,summary:status==='PASSED'?"The check passed.":'La verifica è fallita.',
    importantObservations:[status==='PASSED'?'Il valore osservato è 5, come previsto.':'Il valore osservato è 6 invece di 5.'],metrics:{calculatedValue:status==='PASSED'?5:6},
    diagnosis:{observed:[status==='PASSED'?'Il calcolo ha restituito 5.':'Il calcolo ha restituito 6.'],inferred:[],unknown:[]}});
  const refs=[],makeRun=(scenario,validationId,command,generation,status)=>{const v=validation(validationId,command,generation,status),r=runtime(v,`runtime-${validationId}`,status);
    const rr=ref(r.id,r,scenarioApi.EVIDENCE_BUNDLE_MEDIA_TYPE.replace('technical-evidence-bundle','runtime-evidence')),er=store.put(r.eventLogRef,'{}\n','application/x-ndjson');refs.push(rr,er);return scenarioApi.createScenarioRun(scenario,v,r,rr,er)};
  const before=makeRun(scenario1,'validation-before',f.CommandSpec,1,'FAILED'),after=makeRun(scenario1,'validation-after',f.CommandSpec,2,'PASSED'),secondary=makeRun(scenario2,'validation-secondary',command2,2,'PASSED');
  const comparisonValue={schemaVersion:1,scenarioId:scenario1.scenarioId,commandHash:scenario1.execution.commandHash,
    before:{evidenceId:'runtime-validation-before',validationId:'validation-before',eventLogRef:'events-runtime-validation-before',generation:1,status:'FAILED',diagnosis:{observed:['Il calcolo ha restituito 6.'],inferred:[],unknown:[]},events:[]},
    after:{evidenceId:'runtime-validation-after',validationId:'validation-after',eventLogRef:'events-runtime-validation-after',generation:2,status:'PASSED',diagnosis:{observed:['Il calcolo ha restituito 5.'],inferred:[],unknown:[]},events:[]},
    eventTypeChanges:[],metricChanges:['calculatedValue: 6 → 5'],residualAnomalies:[],conclusion:'RESOLVED'};
  const comparison=store.put('runtime-comparison-after',api.canonicalize(comparisonValue),'application/vnd.pi-controlled-dev.runtime-comparison+json');refs.push(comparison);
  const bundle1=scenarioApi.createTechnicalEvidenceBundle(scenario1,[before,after],spec.acceptanceCriteria,{beforeAfterComparisonRef:comparison.id,patchRef:'patch'}),bundle2=scenarioApi.createTechnicalEvidenceBundle(scenario2,[secondary],spec.acceptanceCriteria,{patchRef:'patch'});
  for(const [id,value,media] of [[`scenario-${scenario1.scenarioHash.slice(0,24)}`,scenario1,scenarioApi.SCENARIO_MEDIA_TYPE],[`scenario-${scenario2.scenarioHash.slice(0,24)}`,scenario2,scenarioApi.SCENARIO_MEDIA_TYPE],
    [before.runId,before,scenarioApi.SCENARIO_RUN_MEDIA_TYPE],[after.runId,after,scenarioApi.SCENARIO_RUN_MEDIA_TYPE],[secondary.runId,secondary,scenarioApi.SCENARIO_RUN_MEDIA_TYPE],
    [bundle1.bundleId,bundle1,scenarioApi.EVIDENCE_BUNDLE_MEDIA_TYPE],[bundle2.bundleId,bundle2,scenarioApi.EVIDENCE_BUNDLE_MEDIA_TYPE]])refs.push(ref(id,value,media));
  const assessment={schemaVersion:1,status:'PASS',evidenceRefs:[bundle1.bundleId],reason:'Le prove tecniche corrispondono alla candidata corrente.'};
  const scopeAssessment={...assessment,reason:'Le modifiche restano nei percorsi autorizzati.'},testAssessment={...assessment,reason:'Le verifiche previste sono passate sulla candidata corrente.'},actualChangesAssessment={...assessment,reason:'Le modifiche osservate corrispondono a quelle dichiarate.'};
  const review={...f.ReviewResult,specHash:spec.specHash,verdict:'PASS',candidateGeneration:2,
    criteria:spec.acceptanceCriteria.map(value=>({schemaVersion:1,criterionId:value.id,assessment})),scopeAssessment,testAssessment,actualChangesAssessment,
    validationResultIds:['validation-after','validation-secondary'],evidenceRefs:[bundle1.bundleId,bundle2.bundleId]},decision={...f.DecisionRecord,id:'decision-human',reason:'Il problema iniziale è stato riconosciuto come reale e ha richiesto una correzione.',evidenceRefs:[bundle1.bundleId]};
  const developer={...f.DeveloperResult,specHash:spec.specHash,evidenceRefs:[],commandsRun:[],tests:[],
    summary:'Correzione minima completata. Design rationale: La modifica riutilizza il servizio di calcolo esistente e ne corregge la trasformazione interna, senza introdurre una seconda utility o una nuova astrazione. La struttura attuale resta quindi invariata.'};
  const records=[...o.context().records,...refs.map(value=>({id:value.id,kind:'ArtifactRef',value})),
    ...(designRationale?[{id:'developer-human',kind:'DeveloperResult',value:developer}]:[]),{id:'review-human',kind:'ReviewResult',value:review},{id:decision.id,kind:'DecisionRecord',value:decision}];
  const catalog=store.catalog(records),state={...o.state,revision:1,lastEventId:'projection-event',updatedAt:'2026-10-01T12:00:00.000Z'},stateAfter=store.put('projection-state',api.canonicalize(state));
  const event={schemaVersion:1,id:state.lastEventId,taskId:'task',kind:'RECORD',recordType:'RECONCILED',actor:'Orchestrator',sourceState:'PENDING',targetState:'PENDING',previousRevision:0,revision:1,
    timestamp:state.updatedAt,reason:'Realistic human projection fixture',evidenceRefs:[catalog.id],invalidatedEvidenceIds:[],stateAfter,previousEventHash:o.events.at(-1).eventHash,eventHash:'0'.repeat(64)};
  event.eventHash=api.hashContract('TransitionEvent',event);store.commit(state,event,records);return{root,repo,data,store};
}
const markdownFiles=root=>['Home.md',...['Tasks','Scenarios','Runs','Evidence','Reviews','Decisions','Notes'].flatMap(folder=>readdirSync(join(root,folder)).filter(value=>value.endsWith('.md')).map(value=>join(folder,value)))];

test('realistic fixture builds readable task, scenario, run, evidence, review and Base views',t=>{
  const {store}=fixture(t),result=human.rebuildHumanView(store.root);assert.equal(result.status,'CURRENT');
  for(const folder of ['Tasks','Scenarios','Runs','Evidence','Reviews','Decisions','Indexes','Notes'])assert.equal(existsSync(join(result.vaultRoot,folder)),true);
  assert.equal(readdirSync(join(result.vaultRoot,'Scenarios')).length,2);assert.equal(readdirSync(join(result.vaultRoot,'Runs')).length,3);
  const all=markdownFiles(result.vaultRoot).map(path=>readFileSync(join(result.vaultRoot,path),'utf8')).join('\n');
  for(const heading of ['# Controlled Dev','# Scenario —','# Run —','# Evidence —','# Review —','# Decision —'])assert.match(all,new RegExp(heading));
  assert.match(all,/\[\[Scenario /);assert.match(all,/What we cannot conclude/);assert.doesNotMatch(all,new RegExp(store.root.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  for(const file of readdirSync(join(result.vaultRoot,'Indexes')).filter(name=>name.endsWith('.base')))assert.match(readFileSync(join(result.vaultRoot,'Indexes',file),'utf8'),/^filters:\n[\s\S]*views:\n/);
});

test('human projection explains facts in context without moving technical authority into prose',t=>{
  const {store}=fixture(t),{vaultRoot}=human.rebuildHumanView(store.root),read=(folder,name)=>readFileSync(join(vaultRoot,folder,name),'utf8');
  const home=readFileSync(join(vaultRoot,'Home.md'),'utf8'),task=read('Tasks','Task task.md'),scenario=read('Scenarios','Scenario check.md');
  const failed=read('Runs','Run scenario-run-before.md'),passed=read('Runs','Run scenario-run-after.md');
  const evidenceName=readdirSync(join(vaultRoot,'Evidence')).find(name=>read('Evidence',name).includes('calculatedValue: 6 → 5'));
  assert.ok(evidenceName);const evidence=read('Evidence',evidenceName),single=readdirSync(join(vaultRoot,'Evidence')).map(name=>read('Evidence',name)).find(value=>value.includes('only one comparable execution'));
  const review=read('Reviews','Review assignment.md'),decision=read('Decisions','Decision decision-human.md');
  assert.match(home,/Where to start[\s\S]*Start with \[\[Task task\|Calcolo controllato\]\]/);
  assert.match(task,/What to do[\s\S]*Why it matters[\s\S]*Parts of the project that may change[\s\S]*Outstanding issues/);
  assert.match(task,/## Design choices[\s\S]*riutilizza il servizio di calcolo esistente[\s\S]*senza introdurre una seconda utility/);
  assert.match(scenario,/Reproduced behavior[\s\S]*Why it is useful[\s\S]*Observations and expectations/);
  assert.match(failed,/first documented execution[\s\S]*Il valore osservato è 6 invece di 5/);
  assert.match(passed,/This run repeats the same scenario[\s\S]*Il valore osservato è 5, come previsto/);
  assert.match(evidence,/In the first run[\s\S]*generation 2 with outcome \*\*PASS\*\*[\s\S]*`calculatedValue: 6 → 5`/);
  assert.match(evidence,/a different test was not selected after the correction/);
  assert.match(review,/Automated verification alone was not considered sufficient[\s\S]*Reasons for this outcome/);
  assert.match(decision,/## Decision[\s\S]*## Reason[\s\S]*Consequences[\s\S]*Rejected alternative/);
  assert.match(single,/not enough information to describe a before\/after change/);
  for(const content of [home,task,scenario,failed,passed,evidence,review,decision]){
    assert.doesNotMatch(content,/\{"schemaVersion"|"candidateDigest"\s*:/);
    for(const [index,line] of content.split('\n').entries())if(line.startsWith('> [!')){
      assert.match(line,/^> \[!(?:success|failure|warning)\] .+/);assert.match(content.split('\n')[index+1]??'',/^> .+/);
    }
  }
  for(const content of [task,scenario,failed,passed,evidence,review,decision]){
    const [main,technical]=content.split('## Technical details');assert.ok(technical);assert.doesNotMatch(main,/Candidate digest:|Command hash:|Assignment ID:|Subject ID:/);
  }
  assert.match(evidence,/scenario \[\[Scenario check\|Check check\]\]/);assert.match(review,/consulted \[\[Evidence /);
});

test('design rationale is omitted when no Developer decision was recorded',t=>{
  const {store}=fixture(t,{designRationale:false}),{vaultRoot}=human.rebuildHumanView(store.root);
  assert.doesNotMatch(readFileSync(join(vaultRoot,'Tasks','Task task.md'),'utf8'),/## Design choices/);
});
test('personal notes have a discoverable parent and untouched old templates gain backlinks while personal edits stay byte-exact',t=>{
  const {store}=fixture(t),{vaultRoot}=human.rebuildHumanView(store.root);
  const home=readFileSync(join(vaultRoot,'Home.md'),'utf8'),indexPath=join(vaultRoot,'Indexes','Personal Notes.md');
  assert.match(home,/\[\[Indexes\/Personal Notes\|All personal notes\]\]/);
  assert.match(readFileSync(indexPath,'utf8'),/\[\[Notes\/task-task-notes\|Notes: Calcolo controllato\]\].*\[\[Tasks\/Task task\|Related page\]\]/);
  for(const name of readdirSync(join(vaultRoot,'Notes')).filter(name=>name.endsWith('.md'))){
    const text=readFileSync(join(vaultRoot,'Notes',name),'utf8'),match=text.match(/\[\[([^|]+)\|Back to the related page\]\]/);
    assert.ok(match,name);assert.ok(existsSync(join(vaultRoot,match[1]+'.md')),name);
  }
  const taskNote=join(vaultRoot,'Notes','task-task-notes.md'),original=readFileSync(taskNote,'utf8');
  writeFileSync(taskNote,original.split('# Personal notes')[0]+'# Annotazioni personali\n\nQuesto spazio è tuo. La rigenerazione automatica non modifica questo file.\n');
  const personal=join(vaultRoot,'Notes','scenario-check-notes.md'),personalBytes=Buffer.from(readFileSync(personal,'utf8')+'\nLa mia osservazione personale: non modificarla.\n');
  writeFileSync(personal,personalBytes);const before=DurableStore.load(store.root);
  human.rebuildHumanView(store.root);
  assert.match(readFileSync(taskNote,'utf8'),/\[\[Tasks\/Task task\|Back to the related page\]\]/);
  assert.deepEqual(readFileSync(personal),personalBytes);assert.deepEqual(DurableStore.load(store.root),before);
  const index=readFileSync(indexPath);human.rebuildHumanView(store.root);assert.deepEqual(readFileSync(indexPath),index);
});

test('empty project memory has a readable collection without creating authoritative memory records',t=>{
  const {store}=fixture(t),memoryRoot=join(store.root,'..','..','memory');assert.equal(existsSync(memoryRoot),false);
  const {vaultRoot}=human.rebuildHumanView(store.root),text=readFileSync(join(vaultRoot,'Indexes','Project Memory.md'),'utf8');
  assert.match(text,/No technical memories are registered/);assert.match(text,/separate from the saved plan, task status and execution history/);
  assert.match(readFileSync(join(vaultRoot,'Home.md'),'utf8'),/\[\[Indexes\/Project Memory\|Project technical memory\]\]/);
  assert.equal(existsSync(memoryRoot),false);
});

test('generation is deterministic, preserves separate human notes and Markdown cannot change authority',t=>{
  const {store}=fixture(t),first=human.rebuildHumanView(store.root),generated=Object.fromEntries(markdownFiles(first.vaultRoot).filter(path=>!path.startsWith('Notes/')).map(path=>[path,readFileSync(join(first.vaultRoot,path),'utf8')]));
  const note=join(first.vaultRoot,'Notes','task-task-notes.md');writeFileSync(note,readFileSync(note,'utf8')+'\nPromemoria personale.\n');
  const task=join(first.vaultRoot,'Tasks','Task task.md');writeFileSync(task,readFileSync(task,'utf8').replace('PENDING','COMPLETED'));
  const second=human.rebuildHumanView(store.root);assert.match(readFileSync(note,'utf8'),/Promemoria personale/);assert.equal(DurableStore.load(store.root).state.state,'PENDING');assert.match(readFileSync(task,'utf8'),/PENDING/);
  for(const [path,content] of Object.entries(generated))assert.equal(readFileSync(join(second.vaultRoot,path),'utf8'),content);
});

test('projection failure records STALE without changing the authoritative ledger',t=>{
  const {store}=fixture(t),current=human.rebuildHumanView(store.root),state=readFileSync(join(store.root,'state.json')),events=readFileSync(join(store.root,'events.jsonl'));
  rmSync(current.vaultRoot,{recursive:true,force:true});writeFileSync(current.vaultRoot,'blocks directory creation');
  const result=human.refreshHumanView(store.root);assert.equal(result.status,'STALE');assert.deepEqual(readFileSync(join(store.root,'state.json')),state);assert.deepEqual(readFileSync(join(store.root,'events.jsonl')),events);
  assert.equal(JSON.parse(readFileSync(join(store.root,'human-projection.json'),'utf8')).status,'STALE');
});

test('TUI checks show concise scenario, last run, count and evidence availability',t=>{
  const {repo,data}=fixture(t),prior=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=data;t.after(()=>{if(prior===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=prior});
  const pages=productionStatusPages({mode:'tui',cwd:repo,sessionManager:{getSessionId:()=> 'owner'},ui:{}},undefined,'task');
  assert.match(pages.checks,/Scenario: Check check/);assert.match(pages.checks,/Latest execution: PASS/);assert.match(pages.checks,/Executions: 2/);assert.match(pages.checks,/Evidence: available/);
  assert.doesNotMatch(pages.checks,/scenarioHash|candidateDigest|\{"schemaVersion"/);
});

test('task description does not repeat identical title objective and requirement or invent a missing motivation',t=>{
 const {store}=fixture(t,{repeatedTitle:true,designRationale:false}),before=DurableStore.load(store.root),{vaultRoot}=human.rebuildHumanView(store.root),text=readFileSync(join(vaultRoot,'Tasks','Task task.md'),'utf8');
 const title='Fissare il comportamento dei due validatori duplicati prima di modificarli.';
 assert.equal(text.split(title).length-1,1);assert.match(text,/## What to do\n\nIl calcolo restituisce il valore atteso/);assert.match(text,/Specific scope:/);
 assert.match(text,/## Why it matters\n\nThe records contain no additional rationale/);assert.match(text,/## Expected result/);assert.match(text,/Controlla il secondo comportamento/);assert.match(text,/## Planned checks/);assert.deepEqual(DurableStore.load(store.root),before);
});

test('blocked no-op Developer note reports the current recorded reason instead of claiming no open problems',async t=>{
 const {restartFixture}=await import('./recovery-fixture.mjs');
 const root=mkdtempSync(join(tmpdir(),'human-bounded-block-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const f=await restartFixture(root,'DEVELOPER_BOUNDED',false,true),before=DurableStore.load(f.storeRoot);
 const {vaultRoot}=human.rebuildHumanView(f.storeRoot),text=readFileSync(join(vaultRoot,'Tasks','Task task.md'),'utf8');
 assert.match(text,/## Outstanding issues[\s\S]*unmet prerequisite/);
 assert.match(text,/Reason given by the agent[\s\S]*The approved checks must be executed by the host before development/);
 assert.doesNotMatch(text,/The structured data indicates no outstanding technical issues/);
 assert.match(text,/## Technical details[\s\S]*Developer reported a bounded blocker/);
 assert.deepEqual(DurableStore.load(f.storeRoot),before);
});
