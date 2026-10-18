import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSourceLoader } from './load-source.mjs';
import { fixtures } from './contract-fixtures.mjs';
installSourceLoader();
const runtime=await import('../src/runtime-observability.ts');
const event=(more={})=>({schemaVersion:runtime.RUNTIME_EVENT_SCHEMA,timestamp:'2026-09-30T00:00:00.000Z',source:'calculator',
  eventType:'calculation.failed',severity:'ERROR',correlationId:'scenario-1',data:{intermediate:4},...more});

test('runtime JSONL requires complete valid bounded events',()=>{
  assert.equal(runtime.parseRuntimeJsonl(JSON.stringify(event())+'\n').length,1);
  for(const text of ['','{}\n','{\n',JSON.stringify(event()),JSON.stringify(event({data:{nested:{secret:'x'}}}))+'\n'])
    assert.throws(()=>runtime.parseRuntimeJsonl(text));
  assert.throws(()=>runtime.parseRuntimeJsonl((JSON.stringify(event())+'\n').repeat(33)));
  assert.throws(()=>runtime.parseRuntimeJsonl(JSON.stringify(event({message:'x'.repeat(300)}))+'\n'));
  assert.throws(()=>runtime.parseRuntimeJsonl(Buffer.from([0xff,0x0a])),/RUNTIME_UTF8_INVALID/);
  assert.throws(()=>runtime.extractRuntimeEvents(runtime.RUNTIME_EVENT_PREFIX+JSON.stringify(event()),''),/RUNTIME_LOG_INCOMPLETE/);
});

test('child output extraction is opt-in and secrets are redacted before evidence',()=>{
  const output='ordinary test output\n'+runtime.RUNTIME_EVENT_PREFIX+JSON.stringify(event({message:'Bearer abcdefghijklmno',data:{apiKey:'sensitive',count:2}}))+'\n';
  const {events,redactions}=runtime.extractRuntimeEvents(output,'');
  assert.equal(events.length,1);assert.ok(redactions>0);
  assert.equal(events[0].data.apiKey,'[REDACTED]');
  assert.ok(!JSON.stringify(events).includes('abcdefghijklmno'));
  assert.equal(runtime.extractRuntimeEvents('ordinary test output','').events.length,0);
  assert.equal(runtime.redactRuntimeText('token=abc123 Bearer abcdefghijklmno').text.includes('abc123'),false);
  assert.equal(runtime.redactRuntimeText('{"apiKey":"test-secret","count":2}').text.includes('test-secret'),false);
});

test('diagnosis separates observation, inference and unknown; comparison binds the exact scenario',()=>{
  const row=event(),base={schemaVersion:1,taskId:'task-1',validationId:'validation-before',scenarioId:'test-1',commandHash:'a'.repeat(64),candidateDigest:'b'.repeat(64),
    startedAt:row.timestamp,endedAt:row.timestamp,exitCode:1,eventCount:1,eventLogRef:'events-1',redactions:0};
  const before={...base,id:'before',candidateGeneration:1,status:'FAILED',complete:true,diagnosis:runtime.runtimeDiagnosis('FAILED',[row],true)};
  const after={...base,id:'after',candidateGeneration:2,status:'PASSED',exitCode:0,complete:true,
    diagnosis:runtime.runtimeDiagnosis('PASSED',[],true)};
  assert.match(before.diagnosis.inferred[0],/calculator/);
  const comparison=runtime.compareRuntimeEvidence(before,[row],after,[]);
  assert.equal(comparison.conclusion,'RESOLVED');assert.match(comparison.eventTypeChanges[0],/1 → 0/);
  assert.throws(()=>runtime.compareRuntimeEvidence(before,[row],{...after,commandHash:'c'.repeat(64)},[]));
  assert.equal(runtime.compareRuntimeEvidence({...before,complete:false},[row],after,[]).conclusion,'UNKNOWN');
});

test('temporary diagnostic markers in added patch lines are detectable',()=>{
  const patch=content=>JSON.stringify({schemaVersion:1,operations:[{op:'write',path:'file.txt',mode:'100644',hex:Buffer.from(content).toString('hex')}]});
  assert.equal(runtime.temporaryInstrumentationResidue(patch('// CONTROLLED_DEV_TEMP_TRACE: temporary\n')).length,1);
  assert.equal(runtime.temporaryInstrumentationResidue(patch('ordinary product change\n')).length,0);
  assert.equal(runtime.temporaryInstrumentationResidue('malformed').length,1);
});

test('real Node scenario fails, yields bounded JSONL, receives a candidate-only fix and passes the same check',t=>{
  const root=mkdtempSync(join(tmpdir(),'controlled-runtime-')),repo=join(root,'original'),candidateRoot=join(root,'candidate'),profile=join(root,'profile');
  t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(repo);mkdirSync(profile);
  const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8'}).trim();
  git(repo,'init','-q');
  writeFileSync(join(repo,'calc.cjs'),'exports.multiply=(a,b)=>a+b;\n');
  writeFileSync(join(repo,'test.cjs'),`const value=require('./calc.cjs').multiply(2,3);\n`+
    `console.log('CONTROLLED_RUNTIME_EVENT '+JSON.stringify({schemaVersion:'controlled.runtime-event.v1',timestamp:new Date().toISOString(),`+
    `source:'calculator',eventType:value===6?'calculation.ok':'calculation.failed',severity:value===6?'INFO':'ERROR',`+
    `correlationId:'multiply-2x3',message:value===6?'Result correct':'Intermediate result differs',`+
    `data:{expected:6,intermediate:value,apiKey:'test-secret'},metrics:{result:value}}));\n`+
    `if(value!==6)process.exitCode=1;\n`);
  writeFileSync(join(repo,'bad.cjs'),"console.log('CONTROLLED_RUNTIME_EVENT {\\\"bad\\\":1}');\n");
  writeFileSync(join(repo,'overflow.cjs'),"process.stdout.write('x'.repeat(100000));\n");
  git(repo,'add','.');git(repo,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','baseline');
  const base=git(repo,'rev-parse','HEAD');git(repo,'worktree','add','--quiet','--detach',candidateRoot,base);
  const apiPromise=import('../src/contracts.ts');
  return apiPromise.then(async api=>{
    const { DurableStore }=await import('../src/store.ts');
    const { ScopeGuard,workspaceManifest }=await import('../src/scope-guard.ts');
    const { runApprovedValidation }=await import('../src/validation-runner.ts');
    const store=DurableStore.create(profile,repo,'runtime-task',()=> 'ACCEPT'),f=fixtures(api);
    const source=store.put('source','input','text/plain');
    const command={...f.CommandSpec,id:'check',executable:process.execPath,argv:['test.cjs'],timeoutMs:5000};
    const badCommand={...command,id:'bad',argv:['bad.cjs']},overflowCommand={...command,id:'overflow',argv:['overflow.cjs']};
    const spec={...f.TaskSpec,taskId:'runtime-task',plan:{...f.InputSource,snapshot:source},currentTask:{...f.InputSource,snapshot:source},
      scope:{...f.ScopeSpec,repoRoot:repo,allowedPaths:['calc.cjs']},validationCommands:[command,badCommand,overflowCommand]};
    spec.specHash=api.hashContract('TaskSpec',spec);const specRef=store.writeSpec(spec);
    const guard=ScopeGuard.open(spec.scope,candidateRoot,base);
    writeFileSync(join(candidateRoot,'diagnostic-outside-scope.cjs'),'// CONTROLLED_DEV_TEMP_TRACE\n');
    assert.throws(()=>guard.capture(1,'diagnostic-run'),/SCOPE_VIOLATION/);
    rmSync(join(candidateRoot,'diagnostic-outside-scope.cjs'));
    const state=generation=>({...f.WorkflowState,taskId:spec.taskId,state:'TESTING',spec:specRef,specHash:spec.specHash,repoRoot:repo,runs:[],
      candidate:{...f.Candidate,root:candidateRoot,baseCommit:base,generation,digest:api.hashCanonical(workspaceManifest(candidateRoot,base))}});
    const firstState=state(1),first=runApprovedValidation(spec,firstState,'check',store);
    assert.equal(first.result.status,'FAILED');
    assert.doesNotMatch(Buffer.from(store.read(first.artifacts.find(ref=>ref.id.startsWith('validation-log-')))).toString('utf8'),/test-secret/);
    const read=(run,prefix)=>JSON.parse(Buffer.from(store.read(run.artifacts.find(ref=>ref.id.startsWith(prefix)))).toString('utf8'));
    for(const id of ['bad','overflow']){
      const invalid=runApprovedValidation(spec,firstState,id,store);
      assert.equal(invalid.result.status,'INVALID');
      assert.equal(read(invalid,'runtime-evidence-').complete,false);
    }
    const before=read(first,'runtime-evidence-'),beforeEvents=runtime.parseRuntimeJsonl(store.read(first.artifacts.find(ref=>ref.id.startsWith('runtime-events-'))));
    assert.equal(before.complete,true);assert.equal(before.scenarioId,'check');assert.equal(before.validationId,first.result.id);
    assert.match(before.summary,/The check failed/);assert.equal(before.metrics.result,5);assert.match(JSON.stringify(beforeEvents),/intermediate/);
    assert.doesNotMatch(JSON.stringify(beforeEvents),/test-secret/);
    writeFileSync(join(candidateRoot,'calc.cjs'),'exports.multiply=(a,b)=>a*b;\n');
    const secondState=state(2),second=runApprovedValidation(spec,secondState,'check',store);
    assert.equal(second.result.status,'PASSED');
    const after=read(second,'runtime-evidence-'),afterEvents=runtime.parseRuntimeJsonl(store.read(second.artifacts.find(ref=>ref.id.startsWith('runtime-events-'))));
    const comparison=runtime.compareRuntimeEvidence(before,beforeEvents,after,afterEvents);
    assert.equal(comparison.conclusion,'RESOLVED');assert.match(comparison.metricChanges.join(' '),/result: 5 → 6/);
    assert.equal(git(repo,'status','--porcelain=v1','--untracked-files=all'),'');
    assert.equal(git(repo,'rev-parse','HEAD'),base);
  });
});
