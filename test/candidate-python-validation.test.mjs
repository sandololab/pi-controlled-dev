import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {validateCandidateTestProposal,compileValidations,hostValidationRecipeName,compiledValidationResolver}=await import('../src/validation-proposals.ts');
const {executeHostValidationCommand,collectValidationEvidence}=await import('../src/validation-runner.ts');
const {inventoryTree}=await import('../src/controlled-agent-runtime.ts');
const {workspaceManifest}=await import('../src/scope-guard.ts');
const {hashCanonical,validateStructure}=await import('../src/contracts.ts');
const {DurableStore}=await import('../src/store.ts');
const candidate=(patch={})=>({kind:'CANDIDATE_TEST',mechanism:'PYTEST',paths:['tests/test_setup.py'],expectedLines:[],configPath:'pyproject.toml',description:'Eseguire il test della configurazione preparata',...patch});
const draft=validation=>({objective:'Set up Python tests',scope:['pyproject.toml','tests/test_setup.py'],criteria:['A meaningful setup test passes'],architectureFindings:[],designExpectations:[],validationPlan:[validation]});
const resolver=name=>({git:'/usr/bin/git',python3:'/usr/bin/python3',node:process.execPath})[name];
function setup(t,source='def test_setup():\n    assert 1 + 1 == 2\n',config='[tool.pytest.ini_options]\npythonpath = ["src"]\n'){
 const parent=mkdtempSync(join(tmpdir(),'candidate-pytest-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const root=join(parent,'candidate');mkdirSync(root);mkdirSync(join(root,'tests'));mkdirSync(join(root,'src'));
 writeFileSync(join(root,'pyproject.toml'),config);writeFileSync(join(root,'tests/test_setup.py'),source);
 return {parent,root};
}
function command(v=candidate()){const commands=compileValidations(draft(v),resolver);assert.equal(commands.length,2);assert.equal(validateStructure('CommandSpec',commands[1]).ok,true);return commands[1]}
function run(root,v=candidate()){return executeHostValidationCommand(command(v),root).child}
test('prospective Python tests/config are authorized only by exact proposed file scope, not presumed existing',t=>{
 const {root}=setup(t),future=candidate({paths:['newtests/test_new.py'],configPath:'pytest.ini'});
 assert.doesNotThrow(()=>validateCandidateTestProposal(future,{repoRoot:root,proposedScope:['newtests/test_new.py','pytest.ini'],observedFiles:[]}));
 assert.throws(()=>validateCandidateTestProposal(future,{repoRoot:root,proposedScope:['newtests'],observedFiles:[]}),/INVALID/);
 assert.throws(()=>validateCandidateTestProposal(future,{repoRoot:root,proposedScope:['newtests/test_new.py'],observedFiles:['pytest.ini']}));
 assert.doesNotThrow(()=>validateCandidateTestProposal(candidate(),{repoRoot:root,proposedScope:[],observedFiles:['pyproject.toml','tests/test_setup.py']}));
});
test('candidate proposal has bounded literal files and one supported config, never generic commands',t=>{
 const {root}=setup(t),context={repoRoot:root,proposedScope:['pyproject.toml','tests/test_setup.py'],observedFiles:[]};
 for(const patch of [{paths:[]},{paths:Array(33).fill('tests/test_setup.py')},{paths:['tests/test_setup.py','tests/test_setup.py']},
  {paths:['../escape.py']},{paths:['tests/*.py']},{paths:['.git/test_setup.py']},{paths:['tests/test_setup.js']},{paths:['tests\\test_setup.py']},
  {mechanism:'NPM_TEST'},{configPath:'tox.ini'},{configPath:undefined},{expectedLines:['import os']},
  {paths:['tests/test_setup.py;echo.py']},{paths:['/__invalid_absolute_path__/test.py']}])assert.throws(()=>validateCandidateTestProposal(candidate(patch),context),JSON.stringify(patch));
 const many=Array.from({length:32},(_,i)=>`tests/test_${i}.py`),v=candidate({paths:many});
 assert.doesNotThrow(()=>validateCandidateTestProposal(v,{repoRoot:root,proposedScope:['pyproject.toml',...many],observedFiles:[]}));assert.equal(command(v).argv.length,36);
});
test('proposal rejects symlinks, directories and observed configs without pytest configuration',t=>{
 const {root,parent}=setup(t);symlinkSync(join(root,'tests/test_setup.py'),join(root,'tests/link.py'));
 const validate=v=>validateCandidateTestProposal(v,{repoRoot:root,proposedScope:['pyproject.toml',...v.paths],observedFiles:[]});
 assert.throws(()=>validate(candidate({paths:['tests/link.py']})));
 mkdirSync(join(root,'tests/directory.py'));assert.throws(()=>validate(candidate({paths:['tests/directory.py']})));
 symlinkSync(join(root,'tests'),join(parent,'linked-tests'));symlinkSync(join(parent,'linked-tests'),join(root,'alias'));
 assert.throws(()=>validate(candidate({paths:['alias/test_setup.py']})));
 writeFileSync(join(root,'pyproject.toml'),'[project]\nname="fixture"\n');
 assert.doesNotThrow(()=>validate(candidate()));
 assert.throws(()=>validateCandidateTestProposal(candidate(),{repoRoot:root,proposedScope:['tests/test_setup.py'],observedFiles:['pyproject.toml']}),/INVALID/);
});
test('closed host compiler and resolver recognize the exact candidate recipe; legacy argv remain unchanged',()=>{
 const c=command();assert.deepEqual(c.argv.slice(0,2),['-B','-c']);assert.deepEqual(c.argv.slice(3),['pyproject.toml','tests/test_setup.py']);
 assert.equal(hostValidationRecipeName(c),'python3');assert.equal(compiledValidationResolver([c])('python3'),'/usr/bin/python3');
 assert.equal(hostValidationRecipeName({...c,argv:c.argv.map((v,i)=>i===2?v+'\nprint("injected")':v)}),undefined);
 assert.equal(hostValidationRecipeName({...c,argv:[...c.argv,'../outside.py']}),undefined);
 assert.equal(hostValidationRecipeName({...c,argv:[...c.argv.slice(0,3),'tox.ini',...c.argv.slice(4)]}),undefined);
 assert.throws(()=>compileValidations(draft(candidate({mechanism:'NPM_TEST'})),resolver),/INVALID/);
 const legacy=compileValidations(draft({kind:'EXISTING_TEST',description:'Legacy pytest',paths:[],expectedLines:[],mechanism:'PYTEST'}),resolver);
 assert.deepEqual(legacy[1].argv,['-m','pytest']);assert.equal(hostValidationRecipeName(legacy[1]),'python3');
});
test('native Python candidate test passes meaningfully with no bytecode/cache, including a child interpreter',t=>{
 const source=`import os, subprocess, sys\nimport helper\ndef test_setup():\n    assert helper.value == 42\n    assert os.environ['PYTHONDONTWRITEBYTECODE'] == '1'\n    assert sys.dont_write_bytecode\n    assert os.environ['PYTEST_DISABLE_PLUGIN_AUTOLOAD'] == '1'\n    subprocess.run([sys.executable, '-c', 'import helper; assert helper.value == 42'], check=True, env={**os.environ, 'PYTHONPATH': 'src'})\n`;
 const {root}=setup(t,source,'[tool.pytest.ini_options]\npythonpath=["src"]\naddopts="--collect-only"\n');writeFileSync(join(root,'src/helper.py'),'value = 42\n');
 const before=inventoryTree(root);const old=process.env.PYTEST_ADDOPTS,plugins=process.env.PYTEST_PLUGINS;
 process.env.PYTEST_ADDOPTS='--collect-only';process.env.PYTEST_PLUGINS='unavailable_ambient_plugin';
 try{const child=run(root);assert.equal(child.status,0,child.stdout+child.stderr);assert.match(child.stdout,/candidate-pytest: collected=1 passed=1 failed=0 skipped=0/);}
 finally{old===undefined?delete process.env.PYTEST_ADDOPTS:process.env.PYTEST_ADDOPTS=old;plugins===undefined?delete process.env.PYTEST_PLUGINS:process.env.PYTEST_PLUGINS=plugins;}
 assert.deepEqual(inventoryTree(root),before);assert.deepEqual(readdirSync(join(root,'src')),['helper.py']);assert.deepEqual(readdirSync(join(root,'tests')),['test_setup.py']);
});
for(const config of ['pytest.ini','setup.cfg'])test(`native candidate recipe supports ${config}`,t=>{
 const {root}=setup(t);writeFileSync(join(root,config),config==='pytest.ini'?'[pytest]\n':'[tool:pytest]\n');
 const before=inventoryTree(root),child=run(root,candidate({configPath:config}));assert.equal(child.status,0,child.stdout+child.stderr);assert.deepEqual(inventoryTree(root),before);
});
for(const [label,source,passed,skipped] of [
 ['ordinary fail','def test_failure():\n    assert False\n',0,0],
 ['all skipped','import pytest\n@pytest.mark.skip(reason="profile unavailable")\ndef test_skipped():\n    assert True\n',0,1],
 ['all xfail','import pytest\n@pytest.mark.xfail(reason="known")\ndef test_known():\n    assert False\n',0,1],
 ['empty collection','VALUE = 42\n',0,0],
 ['stdout is not a pass signal','def test_bad():\n    print("candidate-pytest: collected=1 passed=1 failed=0 skipped=0")\n    assert False\n',0,0],
])test(`native ${label} cannot pass candidate validation`,t=>{
 const {root}=setup(t,source),before=inventoryTree(root),child=run(root);assert.notEqual(child.status,0,child.stdout+child.stderr);
 assert.match(child.stdout,new RegExp(`passed=${passed} .*skipped=${skipped}`));assert.deepEqual(inventoryTree(root),before);
});
test('a meaningful pass plus explicitly skipped optional case remains distinguishable and can pass',t=>{
 const {root}=setup(t,'import pytest\ndef test_pass():\n    assert True\n@pytest.mark.skip(reason="extra absent")\ndef test_extra():\n    assert True\n');
 const child=run(root);assert.equal(child.status,0,child.stdout+child.stderr);assert.match(child.stdout,/collected=2 passed=1 failed=0 skipped=1/);
});
for(const mode of ['missing-config','unsupported-config-content','wrong-config-section','missing-test','symlink-test'])test(`native runtime rejects ${mode} before pytest`,t=>{
 const {root}=setup(t);let v=candidate();
 if(mode==='missing-config')v=candidate({configPath:'pytest.ini'});
 if(mode==='unsupported-config-content')writeFileSync(join(root,'pyproject.toml'),'[project]\nname="fixture"\n');
 if(mode==='wrong-config-section')writeFileSync(join(root,'pyproject.toml'),'[pytest]\n');
 if(mode==='missing-test')v=candidate({paths:['tests/test_missing.py']});
 if(mode==='symlink-test'){symlinkSync(join(root,'tests/test_setup.py'),join(root,'tests/link.py'));v=candidate({paths:['tests/link.py']});}
 const before=inventoryTree(root),child=run(root,v);assert.equal(child.status,2,child.stdout+child.stderr);assert.match(child.stderr,/candidate-pytest: (missing|non-literal)/);assert.deepEqual(inventoryTree(root),before);
});
test('actual test mutation remains INVALID under ordinary candidate digest validation, without cleanup or exclusions',t=>{
 const {root,parent}=setup(t,'from pathlib import Path\ndef test_mutation():\n    Path("unexpected.txt").write_text("real mutation")\n    assert True\n');
 const git=(...args)=>execFileSync('/usr/bin/git',['-C',root,...args],{encoding:'utf8'}).trim();git('init','-q');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Baseline');
 const baseCommit=git('rev-parse','HEAD'),digest=hashCanonical(workspaceManifest(root,baseCommit)),data=join(parent,'profile');mkdirSync(data);
 const store=DurableStore.create(data,root,'candidate-mutation-test',()=> 'ACCEPT'),c=command();
 const {result}=collectValidationEvidence(c,store,{taskId:'candidate-mutation-test',specHash:'a'.repeat(64),candidate:{root,baseCommit,digest,generation:1},criteria:[],createdAt:new Date().toISOString()});
 assert.equal(result.exitCode,0);assert.equal(result.status,'INVALID');assert.notEqual(result.postCandidateDigest,digest);assert.equal(readFileSync(join(root,'unexpected.txt'),'utf8'),'real mutation');
});
for(const [label,source,status] of [
 ['meaningful pass','def test_valid():\n    assert True\n','PASSED'],
 ['all skipped','import pytest\n@pytest.mark.skip(reason="absent")\ndef test_skip():\n    assert True\n','FAILED'],
])test(`host evidence for ${label} keeps the candidate digest and records ${status}`,t=>{
 const {root,parent}=setup(t,source),git=(...args)=>execFileSync('/usr/bin/git',['-C',root,...args],{encoding:'utf8'}).trim();
 git('init','-q');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Baseline');
 const baseCommit=git('rev-parse','HEAD'),digest=hashCanonical(workspaceManifest(root,baseCommit)),data=join(parent,'profile');mkdirSync(data);
 const store=DurableStore.create(data,root,'candidate-evidence-test',()=> 'ACCEPT');
 const {result}=collectValidationEvidence(command(),store,{taskId:'candidate-evidence-test',specHash:'a'.repeat(64),candidate:{root,baseCommit,digest,generation:1},criteria:[],createdAt:new Date().toISOString()});
 assert.equal(result.status,status);assert.equal(result.postCandidateDigest,digest);assert.equal(hashCanonical(workspaceManifest(root,baseCommit)),digest);
 assert.deepEqual(readdirSync(join(root,'tests')),['test_setup.py']);assert.ok(result.processProofRef);
});
