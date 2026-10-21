import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,channel,git,api,ProposalBus,planningProposal} from './greenfield-bootstrap-fixture.mjs';
const {default:extension}=await import('../extensions/controlled-dev.ts');
const {ProjectPlanningRepository}=await import('../src/project-planning-repository.ts');

test('native plan shortcut executes while the ordinary Pi command is still awaiting its Scout',async t=>{
 const f=fixture(t,{empty:true}),old=process.env.PI_CODING_AGENT_DIR;
 process.env.PI_CODING_AGENT_DIR=f.data;t.after(()=>old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old);
 const bus=new ProposalBus(f.root,q=>planningProposal({schemaVersion:1,phase:'PROJECT_PLANNING_PROPOSAL',proposalOnly:true,requestId:q.requestId,requestHash:api.hashCanonical(q),strategy:'Risultati piccoli e verificabili',plannedTasks:[{plannedTaskId:'first',title:'Primo risultato',objective:q.objective,rationale:'Preparare la prima capacità',scopeIntent:['src/app.py'],acceptanceIntent:['Risultato disponibile'],validationIntent:['Verifica mirata'],dependsOn:[],dependencyRationale:[],relevantMemoryIds:[]}]}));
 const hooks=new Map(),shortcuts=new Map(),notices=[];let command;
 extension({events:bus,registerCommand(_name,c){command=c},registerShortcut(key,c){shortcuts.set(key,c)},getAllTools:()=>[],setActiveTools(){},on(name,fn){const hs=hooks.get(name)??[];hs.push(fn);hooks.set(name,hs);return()=>{}}});
 const ctx={...channel(),cwd:f.repo};ctx.sessionManager.getSessionId=()=> 'owner';ctx.ui.notify=(message,type)=>notices.push({message,type});
 for(const fn of hooks.get('session_start'))fn({},ctx);t.after(()=>{for(const fn of hooks.get('session_shutdown'))fn()});
 ctx.ui.editor=async()=> 'Preparare una capacità';const actions=["Approve the plan","Supervised mode","Back"];
 ctx.ui.select=async(_title,choices)=>{const action=actions.shift();assert.ok(choices.includes(action),`${action} in ${choices}`);return action};
 await command.handler('',ctx);assert.equal(actions.length,0);assert.ok(ProjectPlanningRepository.open(f.data,f.repo,()=> 'ACCEPT').current());
 const emit=bus.emit.bind(bus);let held,notifyHeld;const dispatched=new Promise(resolve=>notifyHeld=resolve);
 bus.emit=(name,value)=>{if(name==='subagents:rpc:v1:request'&&value.method==='spawn'&&!held){held=[name,value];notifyHeld();return}return emit(name,value)};
 const screens=[];ctx.ui.select=async(title,choices)=>{screens.push(title);assert.ok(choices.includes("Back"));return "Back"};
 let finished=false;const running=command.handler('project plan',ctx).finally(()=>finished=true);await dispatched;
 assert.equal(finished,false);const before=git(f.repo,'rev-parse','HEAD'),spawnCount=bus.run;
 for(const fn of hooks.get('input')){
  assert.deepEqual(await fn({source:'extension',text:'Subagent updates above.'},ctx),{action:'handled'},'The controlled wizard receives completion without a competing parent question');
  assert.deepEqual(await fn({source:'extension',text:'Inspect subagent updates above. Answer pending supervisor requests within your authority. For completed work, read saved results and resume the already-authorized parent task, or report completion. If approval is required, explicitly ask the user. Do not silently yield, rerun completed work, or infer new authorization.'},ctx),{action:'handled'},'Current pi-subagents wake text cannot start a competing parent turn');
  assert.deepEqual(await fn({source:'extension',text:'Different extension notice'},ctx),{action:'continue'});
 }
 assert.match(shortcuts.get('alt+p').description,/while work is running/);
 await shortcuts.get('alt+p').handler(ctx);
 assert.equal(finished,false,'Consultation must not wait for the normal command loop');
 assert.ok(screens.some(text=>text.includes("Consult the plan")));assert.equal(bus.run,spawnCount,'No second Scout');
 assert.equal(git(f.repo,'rev-parse','HEAD'),before);assert.equal(git(f.repo,'status','--porcelain'),'');
 assert.ok(notices.some(n=>n.message.includes('Work continues')));
 emit(...held);await running;assert.equal(notices.filter(n=>n.type==='error').length,0,JSON.stringify(notices));
});
