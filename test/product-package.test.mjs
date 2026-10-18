import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const manifest=JSON.parse(read('package.json'));
test('P17 manual, README and lockfile match release; documentation has no local paths or removed commands',async()=>{
  const manual=read('USER-MANUAL.md'),readme=read('README.md'),lock=JSON.parse(read('package-lock.json'));
  assert.equal(lock.packages[''].license,manifest.license);
  assert.equal(lock.version,manifest.version);assert.equal(lock.packages[''].version,manifest.version);
  for(const text of [manual,readme]){
    assert.ok(text.includes(manifest.version));
    assert.ok(text.includes('pi install git:github.com/sandololab/pi-controlled-dev'));
    assert.ok(text.includes('pi update git:github.com/sandololab/pi-controlled-dev'));
    assert.ok(text.includes('pi remove git:github.com/sandololab/pi-controlled-dev'));
    assert.ok(text.includes('docs/VALIDATION.md'));assert.doesNotMatch(text,/\/(?:home|Users|tmp|media)\/|(?<![A-Za-z])[A-Za-z]:[\\/]|0\.0\.0-dev/);
    assert.doesNotMatch(text,/\/controlled-dev (?:approve|apply|confirm)\b/);
  }
  const {default:extension}=await import('../extensions/controlled-dev.ts');let registered;
  extension({registerCommand(name,command){assert.equal(name,'controlled-dev');registered=command},events:{on(){return()=>{}},emit(){}},
    on(){return()=>{}},getAllTools:()=>[],setActiveTools(){}});
  for(const text of [manual,readme])for(const [,command] of text.matchAll(/\/controlled-dev ([a-z][a-z-]*)/g))
    assert.ok(new RegExp(`\\b${command}\\b`).test(registered.description),`Undocumented implementation command: ${command}`);
  for(const topic of ['Scout','Developer','Reviewer','Oracle','UNKNOWN','COMPLETED','candidate workspace','Reinstall','Uninstall','Frequently asked questions'])assert.ok(manual.includes(topic),topic);
  assert.ok(manifest.files.includes('USER-MANUAL.md'));assert.ok(!manifest.files.includes('USER-MANUAL.pdf'));
});
test('P17.2A native skills have bounded metadata, role guidance is explicit and cannot expand runtime permissions',async()=>{
  const {packageGuidance}=await import('../src/package-guidance.ts');
  const names=['repository-analysis','validation-planning','controlled-review','task-planning','recovery-explanation','runtime-observability','scenario-management','evidence-management','software-design-quality','project-memory','project-planning','greenfield-bootstrap'];
  for(const name of names){
    const source=read(`skills/${name}/SKILL.md`);assert.ok(source.startsWith(`---\nname: ${name}\n`));
    assert.match(source,/\ndescription: [^\n]+\n/);assert.doesNotMatch(source,/^allowed-tools:/m);
    const body=packageGuidance(name);assert.match(body,/not authority/);assert.ok(body.length<32768);assert.doesNotMatch(body,/^---/);
  }
  for(const name of ['../other','/absolute','unknown'])assert.throws(()=>packageGuidance(name),/PACKAGE_GUIDANCE_INVALID/);
  for(const [role,key] of [['scout','SCOUT'],['developer','DEVELOPER'],['reviewer','REVIEWER'],['oracle','ORACLE']]){
    const runtime=await import(`../src/controlled-${role}.ts`),contract=runtime[`${key}_LAUNCH_CONTRACT`];
    assert.equal(contract.inheritSkills,false);assert.equal(contract.inheritProjectContext,false);assert.equal(contract.inheritGlobalContext,false);
    assert.equal(contract.allowNestedSubagents,false);assert.deepEqual(contract.extensions,[]);
  }
  assert.deepEqual(manifest.pi.skills,['./skills']);assert.deepEqual(manifest.pi.prompts,['./prompts/*.md']);
  assert.ok(manifest.files.includes('skills/'));assert.ok(manifest.files.includes('prompts/'));
  for(const name of ['controlled-dev-task','controlled-dev-recovery','controlled-dev-result']){
    const source=read(`prompts/${name}.md`);assert.match(source,/^---\ndescription: /);assert.ok(source.includes('$@'));
  }
});
test('P17 distribution omits retired PDF and diagnostic source; no provider or runtime dependency added',()=>{
  for(const path of ['USER-MANUAL.pdf','src/trusted-human-probe.ts','src/greenfield-bootstrap-ui.ts'])
    assert.equal(existsSync(new URL(`../${path}`,import.meta.url)),false,path);
  assert.deepEqual(manifest.dependencies??{},{});assert.equal(manifest.peerDependencies?.['pi-subagents'],undefined);
  assert.equal(manifest.private,true);assert.equal(manifest.license,'UNLICENSED');
});
