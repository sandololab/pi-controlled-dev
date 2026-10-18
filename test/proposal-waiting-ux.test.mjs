import test from 'node:test';
import assert from 'node:assert/strict';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {taskWizard}=await import('../src/task-wizard.ts');
const {withWizardInput}=await import('../src/wizard-input.ts');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<100;i++){if(check())return;await pause(5)}throw new Error('bounded test wait expired')}
const proposal={schemaVersion:1,phase:'PRE_TASK_PROPOSAL',proposalOnly:true,requestId:'proposal-request',requestHash:'a'.repeat(64),relevantFiles:[],existingTests:[],proposedScope:['file.py'],acceptanceCriteria:['Risultato corretto'],architectureFindings:[],designExpectations:[],validations:[{kind:'REVIEW',description:"Review",paths:[],expectedLines:[]}],ambiguities:[],risks:[],explanation:"Proposal"};
function harness(readPlanSnapshot){
 const components=[],frames=[],ui={readPlanSnapshot,notify(){},select:async()=>undefined,editor:async()=>undefined,
  custom:factory=>new Promise(resolve=>{let component;component=factory({terminal:{rows:28},requestRender(){frames.push(component.render(76).join('\n'))}},null,null,value=>{component?.dispose?.();resolve(value)});components.push(component);frames.push(component.render(76).join('\n'));if(components.length>1)setTimeout(()=>component.handleInput('\x1b'),0)})};
 return {ui,components,frames};
}
test('proposal panel paints its objective before provider setup and reads list/details without a second modal or authority',async()=>{
 let resolveProposal,started=false,signal;const snapshot={summary:'Approved plan r7\nSolo lettura',points:[{title:'Validatore pubblico',detail:'Scopo\nControllare il comportamento del validatore\n'+Array.from({length:40},(_,i)=>`Passo ${i}`).join('\n')},{title:"Compatibility",detail:'Secondo punto approvato'}]};
 const f=harness(()=>snapshot);const running=taskWizard(f.ui,async(_objective,_hints,cancel)=>{started=true;signal=cancel;return new Promise(resolve=>resolveProposal=resolve)},{objective:'Conservare gli errori pubblici durante la separazione dei controlli',hints:[],rationale:'Separare i controlli senza cambiare gli errori visibili a chi usa la libreria.',compact:true});
 const waiting=f.components[0];assert.match(f.frames[0],/Conservare gli errori pubblici/);assert.match(f.frames[0],/Separare i controlli/);assert.equal(started,false,'Factory returns before synchronous provider setup');
 waiting.handleInput('\x1bp');await until(()=>started&&f.frames.some(frame=>frame.includes('Approved plan r7')));
 waiting.handleInput('\r');assert.match(waiting.render(76).join('\n'),/Controllare il comportamento/);const initial=waiting.render(76).join('\n');for(let i=0;i<12;i++)waiting.handleInput('\x1b[B');assert.notEqual(waiting.render(76).join('\n'),initial);
 resolveProposal(proposal);await pause(5);assert.equal(f.components.length,1,'Completed Scout waits while the operator reads');assert.equal(signal.aborted,false);
 waiting.handleInput('\x1b');assert.match(waiting.render(76).join('\n'),/Approved plan/);waiting.handleInput('\x1b');await running;assert.equal(signal.aborted,false,'Esc from reading does not cancel the proposal');
});
test('waiting cancellation before first frame dispatches no provider; errors survive the internal reading view',async()=>{
 let calls=0;const cancelled=harness();const run=taskWizard(cancelled.ui,async()=>{calls++;return proposal},{objective:"Objective",hints:[],compact:true});cancelled.components[0].handleInput('\x1b');assert.equal(await run,undefined);assert.equal(calls,0);assert.doesNotMatch(cancelled.frames[0],/Alt\+P/);
 let fail;const f=harness(()=>({summary:'Piano salvato',points:[]}));const broken=taskWizard(f.ui,()=>new Promise((_resolve,reject)=>fail=reject),{objective:"Objective",hints:[],compact:true});const assertion=assert.rejects(broken,/provider failed/);f.components[0].handleInput('\x1bp');await until(()=>fail&&f.frames.some(frame=>frame.includes('Piano salvato')));fail(new Error('provider failed'));await pause(5);assert.equal(f.components.length,1);f.components[0].handleInput('\x1b');await assertion;
});
test('wizard input forwards the existing readonly snapshot callback without creating another repository',async()=>{
 class Editor {setText(){}render(){return ['border','text','border']}handleInput(){}invalidate(){}}
 const callback=()=>({summary:'Approvato',points:[]}),ui={custom(){},readPlanSnapshot:callback};const wrapped=await withWizardInput(ui,{Editor,visibleWidth:text=>text.length,CURSOR_MARKER:'cursor'});assert.equal(wrapped.readPlanSnapshot,callback);
});

test('readonly snapshot errors remain visible and never cancel or replace the pending proposal',async()=>{
 let finish,signal;const f=harness(()=>{throw new Error('PROJECT_PLAN_CORRUPT')});const running=taskWizard(f.ui,(_objective,_hints,cancel)=>{signal=cancel;return new Promise(resolve=>finish=resolve)},{objective:'Verificare gli errori pubblici',hints:[],compact:true});
 f.components[0].handleInput('\x1bp');await until(()=>finish&&f.frames.some(frame=>frame.includes('PROJECT_PLAN_CORRUPT')));assert.equal(signal.aborted,false);f.components[0].handleInput('\x1b');assert.match(f.components[0].render(76).join('\n'),/Verificare gli errori pubblici/);finish(proposal);await running;assert.equal(signal.aborted,false);
});

test('each saved point remains reachable in a short viewport, including entries beyond the first screen',async()=>{
 let finish;const points=Array.from({length:32},(_,i)=>({title:`Punto approvato ${i+1}`,detail:`Descrizione precisa ${i+1}`})),f=harness(()=>({summary:'Approved plan',points}));const running=taskWizard(f.ui,()=>new Promise(resolve=>finish=resolve),{objective:'Verificare un passo alla volta',hints:[],compact:true});
 const waiting=f.components[0];waiting.handleInput('\x1bp');await until(()=>finish&&f.frames.some(frame=>frame.includes('1. Punto approvato 1')));for(let i=0;i<31;i++){waiting.handleInput('\t');waiting.render(44)}
 const list=waiting.render(44);assert.ok(list.length<=28);assert.match(list.join('\n'),/32\. Punto approvato 32/);waiting.handleInput('\r');assert.match(waiting.render(44).join('\n'),/Descrizione precisa 32/);finish(proposal);waiting.handleInput('\x1b');waiting.handleInput('\x1b');await running;
});

test('selected objective is painted before synchronous preparation, keeping exact plan revision and task binding',async()=>{
 const {showProjectPlanning}=await import('../src/project-planning-ui.ts');
 const task={plannedTaskId:'task-point',title:'Titolo tecnico approvato',objective:'Conservare gli errori pubblici',rationale:'Chi usa la libreria deve ricevere gli stessi messaggi.'},plan={planId:'plan',revision:7,plannedTasks:[task]},seed={objective:task.objective,hints:[],rationale:task.rationale};
 const frames=[],statuses=[];let painted=false,prepared=false,checks=0;
 const ui={notify(){},setStatus(_key,value){statuses.push(value)},setWidget(_key,component){if(typeof component==='function'){const frame=component({},null).render(100).join('\n');frames.push(frame);if(frame.includes(task.objective))setTimeout(()=>{painted=true},0)}},select:async()=> "Continue the work"};
 const repo={history:()=>[],goals:()=>[],current:()=>plan,progress:()=>[{task,status:'READY'}],prepareStart(...args){assert.equal(painted,true,'Native objective frame gets a macrotask before CPU work');assert.deepEqual(args,['plan',7,'task-point']);prepared=true;return seed}};
 await showProjectPlanning({mode:'tui',sessionManager:{getSessionId(){checks++;return 'host-session'}},cwd:'/readonly-test',ui},repo,undefined,{},'start',async value=>{assert.equal(value,seed);assert.equal(prepared,true)});
 assert.ok(frames.some(frame=>frame.includes(task.objective)));assert.ok(checks>=2);assert.ok(statuses.some(status=>status?.includes("Preparing")));
});
