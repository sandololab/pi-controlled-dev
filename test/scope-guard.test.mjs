import assert from 'node:assert/strict';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { installSourceLoader } from './load-source.mjs';
import { loadContracts } from './load-contracts.mjs';
import { fixtures, TIME } from './contract-fixtures.mjs';
installSourceLoader();
const api=await loadContracts();
const { ScopeGuard, ScopeGuardError }=await import('../src/scope-guard.ts');
const { CentralOrchestrator }=await import('../src/orchestrator.ts');
const git=(cwd,args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8'}).trim();
function workspace(files={ 'allow.txt':'before\n','deny.txt':'deny\n','other.txt':'other\n' }){
  const parent=mkdtempSync(join(tmpdir(),'scope-guard-')),repo=join(parent,'repo'),work=join(parent,'work');mkdirSync(repo);
  git(repo,['init','-q']);git(repo,['config','user.email','test@example.invalid']);git(repo,['config','user.name','Test']);
  for(const [path,content] of Object.entries(files)){mkdirSync(join(repo,...path.split('/').slice(0,-1)),{recursive:true});writeFileSync(join(repo,path),content)}
  git(repo,['add','.']);git(repo,['commit','-qm','base']);const base=git(repo,['rev-parse','HEAD']);git(repo,['worktree','add','--quiet','--detach',work,base]);
  return {parent,repo,work,base};
}
const scope=(ws,allowed=['allow.txt'],denied=[])=>({schemaVersion:1,repoRoot:ws.repo,baseRef:'HEAD',allowedPaths:allowed,deniedPaths:denied,strongConfinementRequired:false});
const close=ws=>rmSync(ws.parent,{recursive:true,force:true});
const rejects=(fn,code)=>assert.throws(fn,error=>error instanceof ScopeGuardError&&error.code===code);

test('P11 TEST-007 — exact allow, deny precedence, default deny and all change classes',()=>{
  for(const [label,path,denied] of [['deny','deny.txt',['deny.txt']],['default','other.txt',[]]]){const ws=workspace(),guard=ScopeGuard.open(scope(ws,['allow.txt','deny.txt'],denied),ws.work,ws.base);writeFileSync(join(ws.work,path),'changed\n');rejects(()=>guard.capture(1,'terminal'), 'SCOPE_VIOLATION');close(ws)}
  const ws=workspace({'modify.txt':'a','delete.txt':'d','rename.txt':'r','mode.txt':'m'}),allowed=['modify.txt','delete.txt','rename.txt','renamed.txt','mode.txt','new.bin'];
  const guard=ScopeGuard.open(scope(ws,allowed),ws.work,ws.base);writeFileSync(join(ws.work,'modify.txt'),'b');rmSync(join(ws.work,'delete.txt'));writeFileSync(join(ws.work,'new.bin'),Uint8Array.from([0,255,1]));
  git(ws.work,['mv','rename.txt','renamed.txt']);chmodSync(join(ws.work,'mode.txt'),0o755);const result=guard.capture(1,'terminal');
  assert.deepEqual(new Set(result.changes.map(c=>c.kind)),new Set(['MODIFY','DELETE','CREATE','RENAME','MODE']));assert.deepEqual(result.changedFiles,allowed.slice().sort());close(ws);
});

test('P11 TEST-008 — traversal, absolute, backslash, fixed denies and case/Unicode aliases fail closed',()=>{
  for(const path of ['../x','/x','a\\b','a//b','.git/config','.env']){const ws=workspace();rejects(()=>ScopeGuard.open(scope(ws,[path]),ws.work,ws.base),'SCOPE_PATH_INVALID');close(ws)}
  for(const files of [{'A':'x','a':'y'},{'é':'x','é':'y'}]){const ws=workspace(files);rejects(()=>ScopeGuard.open(scope(ws,Object.keys(files)),ws.work,ws.base),'SCOPE_ALIAS_UNVERIFIABLE');close(ws)}
});

test('P11 TEST-009/033 — symlink mutation, parent substitution, hardlinks and strong-confinement claims are rejected',()=>{
  {const ws=workspace(),guard=ScopeGuard.open(scope(ws,['allow.txt']),ws.work,ws.base);rmSync(join(ws.work,'allow.txt'));symlinkSync('/etc/passwd',join(ws.work,'allow.txt'));rejects(()=>guard.capture(1,'terminal'),'SCOPE_VIOLATION');close(ws)}
  {const ws=workspace({'dir/file.txt':'x'}),guard=ScopeGuard.open(scope(ws,['dir/file.txt']),ws.work,ws.base);rmSync(join(ws.work,'dir'),{recursive:true});mkdirSync(join(ws.work,'dir'));writeFileSync(join(ws.work,'dir/file.txt'),'y');rejects(()=>guard.capture(1,'terminal'),'SCOPE_ALIAS_UNVERIFIABLE');close(ws)}
  {const ws=workspace(),guard=ScopeGuard.open(scope(ws,['allow.txt','linked.txt']),ws.work,ws.base);linkSync(join(ws.work,'allow.txt'),join(ws.work,'linked.txt'));rejects(()=>guard.capture(1,'terminal'),'SCOPE_UNSUPPORTED_FILE');close(ws)}
  {const ws=workspace();rejects(()=>ScopeGuard.open({...scope(ws),strongConfinementRequired:true},ws.work,ws.base),'SCOPE_BASELINE_INVALID');close(ws)}
});

test('P11 TEST-010/012 — dirty, staged, untracked, non-Git and moved refs never admit a writer/candidate',()=>{
  for(const dirty of [ws=>writeFileSync(join(ws.repo,'allow.txt'),'dirty'),ws=>{writeFileSync(join(ws.repo,'x'),'x');git(ws.repo,['add','x'])},ws=>writeFileSync(join(ws.repo,'x'),'x'),ws=>{writeFileSync(join(ws.repo,'.gitignore'),'ignored\n');git(ws.repo,['add','.gitignore']);git(ws.repo,['commit','-qm','ignore']);writeFileSync(join(ws.repo,'ignored'),'x')}]){
    const ws=workspace();dirty(ws);rejects(()=>ScopeGuard.open(scope(ws),ws.work,ws.base),'SCOPE_BASELINE_INVALID');close(ws)
  }
  const root=mkdtempSync(join(tmpdir(),'scope-nongit-'));rejects(()=>ScopeGuard.open({schemaVersion:1,repoRoot:root,baseRef:'HEAD',allowedPaths:['x'],deniedPaths:[],strongConfinementRequired:false},join(root,'work'),'a'.repeat(40)),'SCOPE_BASELINE_INVALID');rmSync(root,{recursive:true,force:true});
  const ws=workspace(),guard=ScopeGuard.open(scope(ws),ws.work,ws.base);writeFileSync(join(ws.repo,'new'),'x');git(ws.repo,['add','new']);git(ws.repo,['commit','-qm','move']);rejects(()=>guard.capture(1,'terminal'),'SCOPE_ORIGINAL_CHANGED');close(ws);
});

test('ignored local files stay outside the baseline while ignored candidate writes still violate scope',()=>{
 const ws=workspace({'allow.txt':'before\n','.gitignore':'.env\n__pycache__/\nignored.txt\n'});
 try{
  writeFileSync(join(ws.repo,'.env'),'local credentials');mkdirSync(join(ws.repo,'__pycache__'));writeFileSync(join(ws.repo,'__pycache__','module.pyc'),'local cache');
  const guard=ScopeGuard.open(scope(ws),ws.work,ws.base);writeFileSync(join(ws.work,'allow.txt'),'after\n');
  writeFileSync(join(ws.repo,'__pycache__','module.pyc'),'updated local cache');
  const captured=guard.capture(1,'terminal');assert.deepEqual(captured.changedFiles,['allow.txt']);assert.equal(captured.manifest.entries.some(e=>e.path==='.env'),false);
  writeFileSync(join(ws.work,'ignored.txt'),'an unauthorized write');rejects(()=>guard.capture(2,'terminal'),'SCOPE_VIOLATION');
  assert.equal(readFileSync(join(ws.repo,'.env'),'utf8'),'local credentials');
 }finally{close(ws)}
});

test('Git source modes admit a clean cross-filesystem baseline without weakening physical mutation guards',()=>{
 const ws=workspace({'allow.txt':'before\n','setup.txt':'same bytes\n'});
 try{
  git(ws.repo,['config','core.filemode','false']);chmodSync(join(ws.repo,'setup.txt'),0o777);
  assert.equal(git(ws.repo,['status','--porcelain']),'');
  const guard=ScopeGuard.open(scope(ws),ws.work,ws.base);
  writeFileSync(join(ws.work,'allow.txt'),'after\n');
  const captured=guard.capture(1,'terminal');
  assert.deepEqual(captured.changedFiles,['allow.txt']);
  assert.equal(captured.manifest.entries.find(e=>e.path==='setup.txt').mode,'100644');
  chmodSync(join(ws.work,'setup.txt'),0o755);
  rejects(()=>guard.capture(2,'terminal'),'SCOPE_VIOLATION');
  chmodSync(join(ws.work,'setup.txt'),0o644);chmodSync(join(ws.repo,'setup.txt'),0o775);
  rejects(()=>guard.capture(2,'terminal'),'SCOPE_ORIGINAL_CHANGED');
 }finally{close(ws)}
});

test('source mode normalization does not admit staged modes or physical modes when Git tracks them',()=>{
 for(const staged of [false,true]){
  const ws=workspace();
  try{
   if(staged){git(ws.repo,['config','core.filemode','false']);git(ws.repo,['update-index','--chmod=+x','allow.txt'])}
   else{git(ws.repo,['config','core.filemode','true']);chmodSync(join(ws.repo,'allow.txt'),0o755)}
   rejects(()=>ScopeGuard.open(scope(ws),ws.work,ws.base),'SCOPE_BASELINE_INVALID');
  }finally{close(ws)}
 }
});

test('verified baseline manifest compares the full clean copy with tracked source despite protected custody, ignored files and fixed source modes',async()=>{
 const ws=workspace();try{
  const {initializeProjectCustodian}=await import('../src/project-custodian.ts');
  const {workspaceManifest}=await import('../src/scope-guard.ts');
  const {hashCanonical,hashBytes}=await import('../src/contracts.ts');
  writeFileSync(join(ws.repo,'.git','info','exclude'),'/Documentazione/\n/.controlled-dev/\n/cache.bin\n');
  mkdirSync(join(ws.repo,'Documentazione'));writeFileSync(join(ws.repo,'Documentazione','Home.md'),'Personal notes and host views\n');
  mkdirSync(join(ws.repo,'.controlled-dev'));
  initializeProjectCustodian(ws.repo,{schemaVersion:1,projectId:hashBytes(Buffer.from(ws.repo)),originalRepoRoot:ws.repo,
    baselineCommit:ws.base,baselineTree:git(ws.repo,['rev-parse','HEAD^{tree}'])},()=>{});
  writeFileSync(join(ws.repo,'cache.bin'),'ignored generated file');
  git(ws.repo,['config','core.filemode','false']);chmodSync(join(ws.repo,'allow.txt'),0o777);
  const guard=ScopeGuard.open(scope(ws),ws.work,ws.base),baseline=guard.baselineManifest();
  assert.equal(hashCanonical(baseline),hashCanonical(workspaceManifest(ws.work,ws.base)));
  assert.notEqual(hashCanonical(baseline),hashCanonical(workspaceManifest(ws.repo,ws.base)));
  assert.deepEqual(baseline.entries.map(entry=>entry.path),['allow.txt','deny.txt','other.txt']);
  baseline.entries[0].contentHash='0'.repeat(64);
  assert.equal(hashCanonical(guard.baselineManifest()),hashCanonical(workspaceManifest(ws.work,ws.base)),'Returned data cannot change the private baseline');
  writeFileSync(join(ws.work,'unexpected.txt'),'foreign copy bytes');rejects(()=>ScopeGuard.open(scope(ws),ws.work,ws.base),'SCOPE_BASELINE_INVALID');rmSync(join(ws.work,'unexpected.txt'));
  writeFileSync(join(ws.repo,'allow.txt'),'changed source');rejects(()=>ScopeGuard.open(scope(ws),ws.work,ws.base),'SCOPE_BASELINE_INVALID');writeFileSync(join(ws.repo,'allow.txt'),'before\n');
  const exact=ScopeGuard.open(scope(ws),ws.work,ws.base);chmodSync(join(ws.repo,'allow.txt'),0o700);
  rejects(()=>exact.capture(1,'terminal'),'SCOPE_ORIGINAL_CHANGED');
 }finally{close(ws)}
});

test('P11 real workflow — host inventory admits scope-pass through REVIEWING and blocks scope violation without retry',async()=>{
  async function run(path){
    const ws=workspace(),f=fixtures(api),task={...f.TaskSpec,scope:{...f.TaskSpec.scope,repoRoot:ws.repo,allowedPaths:['allow.txt'],deniedPaths:[]},
      humanGates:{...f.TaskSpec.humanGates,beforeImplementation:false,beforeCompletion:false}};task.specHash=api.hashContract('TaskSpec',task);
    const evidence=a=>({runId:`run-${a.role}`,requestId:`request-${a.role}`,childSessionId:`session-${a.role}`,ownerSessionId:'owner',runtimeGeneration:'g',launchContractHash:a.launchContractHash,effectiveTools:[],invokedTools:[],context:a.context,source:'operational-runtime-registration'});
    const envelope=(a,role,refs=[])=>({schemaVersion:1,taskId:a.taskId,assignmentId:a.assignmentId,attemptId:a.attemptId,role,specHash:a.specHash,assignmentHash:a.assignmentHash,evidenceRefs:refs});
    const runners={scout:async a=>({result:{...envelope(a,'Scout'),observations:[],relevantFiles:[],risks:[],ambiguities:[],recommendedScope:task.scope},evidence:evidence(a)}),
      developer:async a=>{writeFileSync(join(ws.work,path),'after\n');return {result:{...envelope(a,'Developer'),summary:'done',changedFiles:['allow.txt'],commandsRun:[],tests:[],residualRisks:[]},evidence:evidence(a)}},
      reviewer:async(a,p)=>{const assessment={schemaVersion:1,status:'PASS',evidenceRefs:[p.validationResults[0].id],reason:'verified'};return {result:{...envelope(a,'Reviewer',[p.validationResults[0].id]),verdict:'PASS',reviewedTreeHash:a.candidateDigest,candidateGeneration:a.candidateGeneration,criteria:[{schemaVersion:1,criterionId:'criterion',assessment}],findings:[],scopeAssessment:assessment,testAssessment:assessment,actualChangesAssessment:assessment,residualRisks:[],validationResultIds:[p.validationResults[0].id]},evidence:evidence(a)}}};
    const o=CentralOrchestrator.initialize(task,{ownerSessionId:'owner',runners,artifacts:[f.InputSource.snapshot,f.ArtifactRef],baselineRef:'HEAD',baselineCommit:ws.base,now:()=>TIME});
    await o.analyze(0);o.ready(o.state.revision);let error;try{await o.implement(o.state.revision,ws.work)}catch(e){error=e}
    if(!error){o.testing(o.state.revision);const c=o.state.candidate,validation={...f.ValidationResult,specHash:task.specHash,candidateDigest:c.digest,candidateGeneration:c.generation,postCandidateDigest:c.digest};
      o.recordValidations([validation],[],o.state.revision);const capture=o.candidateCapture;await o.review(o.state.revision,{candidateManifest:capture.manifest,diff:capture.patch,changedFiles:capture.changedFiles,handoff:capture.handoff,residualRisks:[],evidenceRefs:[]});}
    const result={state:o.state.state,error,dispatches:o.state.counters.dispatches};close(ws);return result;
  }
  const pass=await run('allow.txt');assert.equal(pass.error,undefined);assert.equal(pass.state,'REVIEWING');assert.equal(pass.dispatches,3);
  const violation=await run('other.txt');assert.equal(violation.error.code,'SCOPE_GUARD_FAILED');assert.equal(violation.state,'BLOCKED');assert.equal(violation.dispatches,2);
});

test('P12.4 — cumulative rework preserves a.txt while adding b.txt and binary content against B0',()=>{
  const ws=workspace({'a.txt':'a0','b.txt':'b0'}),guard=ScopeGuard.open(scope(ws,['a.txt','b.txt','new.bin']),ws.work,ws.base);
  const original=()=>({head:git(ws.repo,['rev-parse','HEAD']),branch:git(ws.repo,['symbolic-ref','HEAD']),index:readFileSync(join(ws.repo,'.git/index')).toString('hex'),status:git(ws.repo,['status','--porcelain=v1']),a:readFileSync(join(ws.repo,'a.txt')).toString(),b:readFileSync(join(ws.repo,'b.txt')).toString()});
  const before=original();
  try{
    writeFileSync(join(ws.work,'a.txt'),'a1');const one=guard.capture(1,'terminal-1'),base=guard.prepareRework(one,join(ws.parent,'rework'));
    assert.equal(git(base.workRoot,['status','--porcelain=v1']),'');assert.equal(readFileSync(join(base.workRoot,'a.txt')).toString(),'a1');
    writeFileSync(join(base.workRoot,'b.txt'),'b1');writeFileSync(join(base.workRoot,'new.bin'),Uint8Array.from([0,255,2]));
    const two=guard.finishRework(base,'terminal-2');assert.equal(two.generation,2);assert.equal(two.candidate.baseCommit,ws.base);
    assert.deepEqual(two.changedFiles,['a.txt','b.txt','new.bin']);assert.equal(readFileSync(join(ws.work,'a.txt')).toString(),'a1');
    assert.equal(readFileSync(join(ws.work,'b.txt')).toString(),'b1');assert.deepEqual(readFileSync(join(ws.work,'new.bin')),Buffer.from([0,255,2]));
    assert.deepEqual(original(),before);assert.ok(two.handoff.includes('previousHandoffs'));assert.notEqual(two.digest,one.digest);
    rejects(()=>guard.prepareRework(one,join(ws.parent,'stale')),'SCOPE_GENERATION_INVALID');
    rejects(()=>guard.finishRework(base,'replay'),'SCOPE_GENERATION_INVALID');
  }finally{close(ws)}
});

test('P12.4 — original same-commit branch switch and index-only changes remain forbidden between attempts',()=>{
  for(const mutate of [ws=>git(ws.repo,['checkout','-qb','moved']),ws=>git(ws.repo,['update-index','--assume-unchanged','allow.txt'])]){
    const ws=workspace(),guard=ScopeGuard.open(scope(ws),ws.work,ws.base);writeFileSync(join(ws.work,'allow.txt'),'after');const capture=guard.capture(1,'terminal');
    mutate(ws);rejects(()=>guard.prepareRework(capture,join(ws.parent,'rework')),'SCOPE_ORIGINAL_CHANGED');close(ws);
  }
});

test('P12.4 — rework cannot import out-of-scope changes into the cumulative candidate',()=>{
  const ws=workspace(),guard=ScopeGuard.open(scope(ws),ws.work,ws.base);writeFileSync(join(ws.work,'allow.txt'),'first');
  const base=guard.prepareRework(guard.capture(1,'terminal'),join(ws.parent,'rework'));
  writeFileSync(join(base.workRoot,'other.txt'),'outside');rejects(()=>guard.finishRework(base,'terminal'),'SCOPE_VIOLATION');
  assert.equal(readFileSync(join(ws.work,'other.txt')).toString(),'other\n');close(ws);
});

test('P11 TEST-011/013 — full binary/untracked patch round-trip and digest/generation sensitivity are deterministic',()=>{
  const ws=workspace({'allow.txt':'before\n'}),guard=ScopeGuard.open(scope(ws,['allow.txt','new.bin']),ws.work,ws.base);
  writeFileSync(join(ws.work,'allow.txt'),'after\n');writeFileSync(join(ws.work,'new.bin'),Uint8Array.from([0,255,1]));
  const a=guard.capture(1,'terminal'),b=guard.capture(1,'terminal'),newGeneration=guard.capture(2,'terminal');
  writeFileSync(join(ws.work,'new.bin'),Uint8Array.from([0,255,2]));const changed=guard.capture(3,'terminal');
  assert.equal(a.digest,b.digest);assert.equal(a.patch,b.patch);assert.notEqual(a.digest,changed.digest);assert.equal(a.digest,newGeneration.digest);assert.notEqual(a.candidate.patch.id,newGeneration.candidate.patch.id);
  assert.equal(a.candidate.generation,1);assert.equal(newGeneration.candidate.generation,2);assert.equal(readFileSync(new URL('../docs/PROTOCOL.md',import.meta.url)).length>0,true);close(ws);
});
