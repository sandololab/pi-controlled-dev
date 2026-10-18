import test from 'node:test';
import assert from 'node:assert/strict';
import { installSourceLoader } from './load-source.mjs';
installSourceLoader();
const { resolveDevelopmentProfile, developmentGuidance } = await import('../src/development-profile.ts');
const { createControlledDevExtension } = await import('pi-controlled-dev/host');

test('host profile snapshots are isolated, phase-specific and deterministically identified', () => {
  const input={schemaVersion:1,id:'systemist_factory',common:['Preserve source traceability'],phases:{ProjectPlanning:['Identify interfaces'],Reviewer:['Assess technical evidence']}};
  const profile=resolveDevelopmentProfile(input),digest=profile.digest;
  input.common[0]='Changed later';input.phases.ProjectPlanning.push('Changed later');
  assert.equal(profile.common[0],'Preserve source traceability');assert.equal(profile.phases.ProjectPlanning.length,1);
  assert.equal(resolveDevelopmentProfile(profile),profile);assert.equal(profile.digest,digest);
  assert.throws(()=>profile.common.push('mutation'),TypeError);
  const planning=developmentGuidance(profile,'ProjectPlanning');assert.match(planning,/Identify interfaces/);assert.doesNotMatch(planning,/Assess technical evidence/);
  assert.match(developmentGuidance(profile,'Reviewer'),/Assess technical evidence/);assert.match(planning,new RegExp(digest));
  assert.match(planning,/not authority/);assert.match(planning,/Project Memory remain binding/);
  assert.equal(developmentGuidance(undefined,'Scout'),'');
  assert.equal(resolveDevelopmentProfile({phases:{Reviewer:['Assess technical evidence'],ProjectPlanning:['Identify interfaces']},common:['Preserve source traceability'],id:'systemist_factory',schemaVersion:1}).digest,digest);
});

test('profiles cannot inject tools, executors, state, memory stores or unknown phases',()=>{
  const base={schemaVersion:1,id:'systemist_factory'};
  for(const extra of [{tools:['bash']},{extensions:['other']},{mutationPolicy:'ALLOW'},{memoryRoot:'other'},{executor:()=>{}},{phases:{Unknown:['text']}},{phases:{Developer:'text'}},{common:['']},{common:['x'.repeat(4097)]},{common:Array(17).fill('text')},{common:Array(16).fill('x'.repeat(4096))},{id:'../escape'},{digest:'a'.repeat(64)}])
    assert.throws(()=>createControlledDevExtension({...base,...extra}),/DEVELOPMENT_PROFILE_INVALID/);
  const cycle={...base};cycle.common=[cycle];assert.throws(()=>resolveDevelopmentProfile(cycle),/DEVELOPMENT_PROFILE_INVALID/);
});

test('wrapper uses the same command and session boundary; separate profiles share no global configuration',()=>{
  for(const id of ['systemist_factory','another_factory']){
    const commands=[],hooks=[],active=[];
    createControlledDevExtension({schemaVersion:1,id,common:['Installed domain methodology']})({events:{on(){return()=>{}},emit(){}},registerCommand(name){commands.push(name)},on(name,fn){hooks.push([name,fn]);return()=>{}},getAllTools:()=>[],setActiveTools:names=>active.push(names)});
    assert.deepEqual(commands,['controlled-dev']);assert.ok(hooks.some(([name])=>name==='input'));
    assert.deepEqual(hooks.find(([name])=>name==='tool_call')[1]({toolName:'bash'}),{block:true,reason:'PARENT_MUTATION_ISOLATION: only builtin read is permitted'});
  }
});
