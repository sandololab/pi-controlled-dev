import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {canonicalize,hashBytes}=await import('../src/contracts.ts');
const {projectIdentity}=await import('../src/project-identity.ts');
const {readProjectCustodian,initializeProjectCustodian,humanVaultRoot,assertHumanVaultLocation}=await import('../src/project-custodian.ts');
const api=await import('../src/contracts.ts');
const {fixtures}=await import('./contract-fixtures.mjs');
const {readProductionTaskInput}=await import('../src/production-bridge.ts');
const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}}).trim();
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'pi-custodian-')),repo=join(root,'repo'),profile=join(root,'profile');t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(repo);mkdirSync(profile);git(repo,'init','-q','--initial-branch=main');git(repo,'config','user.name','Test');git(repo,'config','user.email','test@example.invalid');
  writeFileSync(join(repo,'signal.py'),'signal = 1\n');git(repo,'add','signal.py');git(repo,'commit','-qm','nonempty source import');
  const marker={schemaVersion:1,projectId:hashBytes(Buffer.from(repo)),originalRepoRoot:repo,baselineCommit:git(repo,'rev-parse','HEAD'),baselineTree:git(repo,'rev-parse','HEAD^{tree}')};
  const create=()=>{mkdirSync(join(repo,'.controlled-dev'));return initializeProjectCustodian(repo,marker,()=>{})};
  return {root,repo,profile,marker,create};
}
test('legacy identity and human collection remain unchanged until explicit host adoption',t=>{
  const f=fixture(t);assert.equal(readProjectCustodian(f.repo),undefined);assert.equal(projectIdentity(f.repo),f.marker.projectId);
  assert.equal(humanVaultRoot(f.profile,f.repo),join(f.profile,'human'));assert.equal(existsSync(join(f.repo,'.controlled-dev')),false);
});
test('adopted nonempty-source project retains identity after moving the entire folder',t=>{
  const f=fixture(t),source=readFileSync(join(f.repo,'signal.py')),head=git(f.repo,'rev-parse','HEAD');let authorizations=0;
  mkdirSync(join(f.repo,'.controlled-dev'));initializeProjectCustodian(f.repo,f.marker,()=>{authorizations++});
  assert.equal(authorizations,2);const moved=join(f.root,'another machine path');renameSync(f.repo,moved);
  assert.equal(projectIdentity(moved),f.marker.projectId);assert.equal(readProjectCustodian(moved).originalRepoRoot,f.repo);
  assert.equal(humanVaultRoot(f.profile,moved),join(moved,'Documentazione'));assert.equal(git(moved,'rev-parse','HEAD'),head);
  assert.deepEqual(readFileSync(join(moved,'signal.py')),source);assert.equal(existsSync(join(f.profile,'human')),false);
});
test('marker publication is explicit, bound, idempotent and refuses a changed binding',t=>{
  const f=fixture(t);mkdirSync(join(f.repo,'.controlled-dev'));
  assert.throws(()=>initializeProjectCustodian(f.repo,f.marker),/AUTHORIZATION_REQUIRED/);assert.equal(existsSync(join(f.repo,'.controlled-dev','project.json')),false);
  let calls=0;assert.throws(()=>initializeProjectCustodian(f.repo,f.marker,()=>{if(++calls===2)throw new Error('Approval or lease changed')}),/Approval or lease changed/);
  assert.equal(existsSync(join(f.repo,'.controlled-dev','project.json')),false);
  initializeProjectCustodian(f.repo,f.marker,()=>{});assert.deepEqual(initializeProjectCustodian(f.repo,f.marker,()=>{}),f.marker);
  writeFileSync(join(f.repo,'signal.py'),'signal = 2\n');git(f.repo,'add','signal.py');git(f.repo,'commit','-qm','next');
  assert.throws(()=>initializeProjectCustodian(f.repo,{...f.marker,baselineCommit:git(f.repo,'rev-parse','HEAD'),baselineTree:git(f.repo,'rev-parse','HEAD^{tree}')},()=>{}),/ALREADY_BOUND/);
});
for(const fault of ['foreign identity','wrong tree','unknown property','absolute-root alias','marker symlink','dangling marker','folder symlink'])test(`custodian refuses ${fault}`,t=>{
  const f=fixture(t);mkdirSync(join(f.repo,'.controlled-dev'));const path=join(f.repo,'.controlled-dev','project.json');let marker=f.marker;
  if(fault==='foreign identity')marker={...marker,projectId:'a'.repeat(64)};
  if(fault==='wrong tree')marker={...marker,baselineTree:'1'.repeat(40)};
  if(fault==='unknown property')marker={...marker,secretPath:'/private'};
  if(fault==='absolute-root alias')marker={...marker,originalRepoRoot:f.repo+'/../repo'};
  writeFileSync(path,canonicalize(marker));
  if(fault.includes('marker')){renameSync(path,path+'.saved');symlinkSync(fault==='dangling marker'?path+'.missing':path+'.saved',path)}
  if(fault==='folder symlink'){renameSync(join(f.repo,'.controlled-dev'),join(f.root,'foreign'));symlinkSync(join(f.root,'foreign'),join(f.repo,'.controlled-dev'))}
  assert.throws(()=>projectIdentity(f.repo),/PROJECT_CUSTODIAN_.*INVALID/);
});
test('an incomplete adoption is never silently interpreted as an empty legacy project',t=>{
  const f=fixture(t);mkdirSync(join(f.repo,'.controlled-dev'));assert.throws(()=>projectIdentity(f.repo),/ADOPTION_INCOMPLETE/);
});
test('the sole human location rejects aliases before the existing generator writes there',t=>{
  const f=fixture(t);f.create();mkdirSync(join(f.root,'foreign-human'));symlinkSync(join(f.root,'foreign-human'),join(f.repo,'Documentazione'));
  assert.throws(()=>assertHumanVaultLocation(f.profile,f.repo),/PROJECT_HUMAN_VAULT_INVALID/);
  assert.equal(existsSync(join(f.profile,'human')),false);
});
test('historical task roots resolve the same human collection from the current protected capsule',t=>{
  const f=fixture(t);f.create();const suffix=['.controlled-dev','state','controlled-dev','projects',f.marker.projectId];
  mkdirSync(join(f.repo,...suffix),{recursive:true});const moved=join(f.root,'new-host');renameSync(f.repo,moved);
  const projectRoot=join(moved,...suffix);
  assert.equal(humanVaultRoot(projectRoot,f.repo),join(moved,'Documentazione'));
  assert.equal(humanVaultRoot(projectRoot,moved),join(moved,'Documentazione'));
  assert.throws(()=>humanVaultRoot(projectRoot,join(f.root,'foreign-project')),/ROOT_INVALID/);
  assert.equal(existsSync(join(projectRoot,'human')),false);
});
test('the adopted generator refuses a tracked or nonignored human collection',t=>{
  const f=fixture(t);f.create();mkdirSync(join(f.repo,'Documentazione'));
  assert.throws(()=>assertHumanVaultLocation(f.profile,f.repo),/NOT_IGNORED/);
  writeFileSync(join(f.repo,'.git','info','exclude'),'/.controlled-dev/\n/Documentazione/\n');
  assert.equal(assertHumanVaultLocation(f.profile,f.repo),join(f.repo,'Documentazione'));
  writeFileSync(join(f.repo,'Documentazione','note.md'),'personal');git(f.repo,'add','-f','Documentazione/note.md');
  assert.throws(()=>assertHumanVaultLocation(f.profile,f.repo),/TRACKED/);
});
for(const sourceKind of ['inline','file'])test(`copied local control selector reads unchanged historical ${sourceKind} TaskSpec with a new global profile`,t=>{
  const f=fixture(t);writeFileSync(join(f.repo,'.git','info','exclude'),'/.controlled-dev/\n/Documentazione/\n');
  const base=fixtures(api);let source=base.InputSource;
  if(sourceKind==='file'){
    writeFileSync(join(f.repo,'request.txt'),'input');git(f.repo,'add','request.txt');git(f.repo,'commit','-qm','request');
    source={schemaVersion:1,path:join(f.repo,'request.txt'),snapshot:base.InputSource.snapshot};
  }
  const spec={...base.TaskSpec,plan:source,currentTask:source,scope:{...base.ScopeSpec,repoRoot:f.repo}};spec.specHash=api.hashContract('TaskSpec',spec);
  f.create();const control=join(f.repo,'.controlled-dev','control',f.marker.projectId);mkdirSync(control,{recursive:true});writeFileSync(join(control,'task.json'),canonicalize(spec));
  const machine=join(f.root,'new-profile');mkdirSync(machine);const moved=join(f.root,'new-host');renameSync(f.repo,moved);
  const prior=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=machine;
  t.after(()=>prior===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=prior);
  const result=readProductionTaskInput({cwd:moved});
  assert.equal(result.repo,moved);assert.equal(result.spec.scope.repoRoot,f.repo);assert.equal(result.spec.specHash,spec.specHash);
  assert.equal(result.path,join(moved,'.controlled-dev','control',f.marker.projectId,'task.json'));
  assert.equal(readFileSync(result.path,'utf8'),canonicalize(spec));
});
