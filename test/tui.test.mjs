import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {taskWizard}=await import('../src/task-wizard.ts');
const {compileValidations}=await import('../src/validation-proposals.ts');
const {chooseAction,confirmChoice,displayLines,safeText,errorPresentation,showStatus,withProgress,serializeControlledPanels}=await import('../src/controlled-ui.ts');
test('concurrent consultation cannot replace a native confirmation; cloned adapters share the viewport queue',async()=>{
 const opened=[],done=[];let active=0,maximum=0;
 const raw={custom:async factory=>{active++;maximum=Math.max(maximum,active);opened.push(factory);return new Promise(resolve=>done.push(value=>{active--;resolve(value)}))}};
 const a=serializeControlledPanels(raw),b=serializeControlledPanels({...raw});assert.equal(a.custom,b.custom);assert.equal(serializeControlledPanels(a).custom,a.custom);
 const confirmation=()=>{},consultation=()=>{};
 const first=a.custom(confirmation),second=b.custom(consultation);await Promise.resolve();assert.deepEqual(opened,[confirmation]);
 done.shift()(true);assert.equal(await first,true);await Promise.resolve();assert.deepEqual(opened,[confirmation,consultation]);
 done.shift()("Back");assert.equal(await second,"Back");assert.equal(maximum,1);
});
test('a cancelled or failing panel releases the viewport without approving the next panel',async()=>{
 let calls=0;const ui=serializeControlledPanels({custom:async()=>{if(++calls===1)throw new Error('closed panel');return undefined}});
 const first=ui.custom(()=>{}),next=ui.custom(()=>{});await assert.rejects(first,/closed panel/);assert.equal(await next,undefined);assert.equal(calls,2);
});
test('fresh native shortcut and command contexts share the session viewport and suppress progress while reading',async()=>{
 const scope={},widgets=[],opened=[];
 const raw=()=>({setWidget:(_key,value)=>widgets.push(value),setStatus(){},custom:factory=>new Promise(resolve=>opened.push(factory({requestRender(){},terminal:{rows:44}},null,null,resolve)))});
 const command=serializeControlledPanels(raw(),scope),shortcut=serializeControlledPanels(raw(),scope);
 assert.equal(command.custom,shortcut.custom);
 assert.notEqual(serializeControlledPanels(raw(),{}).custom,command.custom,'Another session has its own queue');
 await withProgress(command,()=> 'Status: Independent review',async()=>{
  const reading=chooseAction(shortcut,'Piano','Punti approvati',['Chiudi']);
  await new Promise(resolve=>setTimeout(resolve,550));
  assert.equal(widgets.at(-1),undefined,'Fresh native functions cannot put progress above the reading panel');
  const gate=confirmChoice(command,"Confirmation",'Nuova autorizzazione');
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(opened.length,1);
  opened[0].handleInput('\x1b');await reading;
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(opened.length,2);
  opened[1].handleInput('\x1b');assert.equal(await gate,false);
 });
});
test('the initial progress frame paints before synchronous work with native 16 ms render throttling',async()=>{
 let painted=false;
 const ui={setWidget:(_key,value)=>{if(value)setTimeout(()=>painted=true,16)},setStatus(){}};
 await withProgress(ui,()=> 'Stato: Verifica dei dati salvati',async()=>{assert.equal(painted,true)});
});
test('a nested phase owns progress until it ends, then restores the outer preparation frame',async()=>{
 const widgets=[],ui={setWidget:(_key,value)=>widgets.push(value),setStatus(){},custom:async()=>undefined};
 const text=()=>widgets.at(-1)({requestRender(){}},null).render(120).join('\n');
 await withProgress(ui,()=> 'Status: Project preparation',async()=>{
  await withProgress({...ui},()=> 'Status: Independent review',async()=>{
   await new Promise(resolve=>setTimeout(resolve,550));
   assert.match(text(),/Independent review/);assert.doesNotMatch(text(),/Project preparation/);
  });
  assert.match(text(),/Project preparation/);assert.equal(typeof widgets.at(-1),'function');
 });
 assert.equal(widgets.at(-1),undefined);
});
test('a native answer editor waits for consultation to close and retains the explicit submitted answer',async()=>{
 let close,opened=0;const raw={custom:async()=>new Promise(resolve=>close=resolve),editor:async(title,prefill)=>{opened++;assert.equal(prefill,"Proposal");return 'Risposta modificata'}};
 const view=serializeControlledPanels(raw),reading=view.custom(()=>{}),answer=serializeControlledPanels({...raw}).editor('Domanda',"Proposal");
 await Promise.resolve();assert.equal(opened,0);close(undefined);await reading;assert.equal(await answer,'Risposta modificata');assert.equal(opened,1);
});
const proposal=()=>({schemaVersion:1,phase:'PRE_TASK_PROPOSAL',proposalOnly:true,requestId:'request',requestHash:'a'.repeat(64),relevantFiles:['README.md'],proposedScope:['README.md'],acceptanceCriteria:['Contiene la frase richiesta'],existingTests:[],validations:[{kind:'REVIEW',description:'Verifica la frase',paths:['README.md'],expectedLines:[]}],architectureFindings:['README.md è la guida esistente'],designExpectations:['Riutilizzare la struttura della guida'],ambiguities:[],risks:[],explanation:'Proposta in sola lettura'});
test('operator clarification follows bounded investigations and successive explicit answers; suggested text is editable',async()=>{
 const view=ui(["Create the task"],['CSV con punto e virgola','UTF-8']);let runs=0;const received=[];
 const result=await taskWizard(view,async(_objective,hints)=>{
  runs++;received.push(hints);
  if(runs<=2)return {...proposal(),clarificationQuestions:[{question:'Quale formato vuoi?',why:'Il destinatario richiede un formato preciso.',suggestedAnswer:'CSV con virgola'}]};
  if(runs<=4)return {...proposal(),clarificationQuestions:[{question:'Quale codifica?',why:'Il formato è noto, manca la codifica.',suggestedAnswer:'UTF-8'}]};
  return proposal();
 },{objective:'Documenta l’esportazione',hints:[],compact:true});
 assert.equal(runs,5);assert.equal(result.clarifications.length,2);
 assert.deepEqual(result.clarifications.map(q=>q.answer),['CSV con punto e virgola','UTF-8']);
 assert.ok(received[2].join('\n').includes('CSV con punto e virgola'));
 assert.ok(received[4].join('\n').includes('CSV con punto e virgola'));assert.ok(received[4].join('\n').includes('UTF-8'));
 const editor=view.calls.find(call=>call.prefill==='CSV con virgola');assert.match(editor.title,/proposal.*approve or edit it/);
});
test('an unanswered suggested clarification never creates an activity or accepts the suggestion',async()=>{
 const view=ui(["Create the task"],[undefined]);let runs=0;
 const result=await taskWizard(view,async()=>{runs++;return {...proposal(),clarificationQuestions:[{question:'Quale formato?',why:'Manca una decisione.',suggestedAnswer:'CSV'}]};},{objective:'Esporta dati',hints:[],compact:true});
 assert.equal(result,undefined);assert.equal(runs,2);
 assert.equal(view.calls.filter(call=>call.options?.includes("Create the task")).length,0);
});
test('legacy ambiguities block task creation until the operator answers and analysis resolves them',async()=>{
 const view=ui(["Create the task"],['Mantieni la compatibilità']);let runs=0;
 const result=await taskWizard(view,async(_objective,hints)=>{runs++;return runs<3?{...proposal(),ambiguities:['La compatibilità richiesta non è chiara.']}:(assert.ok(hints.join('\n').includes('Mantieni la compatibilità')),proposal());},{objective:'Aggiorna la libreria',hints:[],compact:true});
 assert.equal(runs,3);assert.equal(result.clarifications[0].answer,'Mantieni la compatibilità');
});
test('tall terminals use available space for proposal reading and retain actions',async()=>{
 await chooseAction({custom:factory=>new Promise(resolve=>{
  const c=factory({requestRender(){},terminal:{rows:44}},null,null,resolve);
  const rendered=c.render(130);
  assert.ok(rendered.filter(line=>line.includes('Source detail')).length>=20);
  assert.ok(rendered.length<=44);assert.match(rendered.join('\n'),/Confirm/);c.handleInput('\x1b');
 })},'Proposal',Array.from({length:80},(_,i)=>`Source detail ${i}`).join('\n'),['Cancel','Confirm']);
});
function ui(actions,edits){const calls=[],widgets=[];return {calls,widgets,notify:m=>calls.push(m),confirm:async()=>true,
  editor:async(title,prefill)=>{calls.push({title,prefill});return edits.shift()},select:async(title,options)=>{const action=actions.shift();assert.ok(action===undefined||options.includes(action),`${action} in ${options}`);calls.push({title,options});return action},setWidget:(key,lines)=>widgets.push(lines)}}
test('a planned task uses one proposal and natural-language corrections without asking the known objective again',async()=>{
 const view=ui(["Read details","Back to proposal","Correct the proposal","Create the task"],['Aggiungi anche esempi di uso']);const calls=[];
 const initial={objective:'Documenta il progetto',hints:['Usa la guida esistente'],compact:true};
 const draft=await taskWizard(view,async(objective,hints)=>{calls.push({objective,hints});return {...proposal(),acceptanceCriteria:calls.length===1?['Guida leggibile']:['Guida leggibile con esempi']};},initial);
 assert.equal(draft.objective,initial.objective);assert.deepEqual(draft.criteria,['Guida leggibile con esempi']);assert.equal(calls.length,2);assert.equal(calls[1].hints.at(-1),'Aggiungi anche esempi di uso');
 assert.equal(view.calls.filter(call=>call.prefill!==undefined).length,1);assert.ok(view.calls.some(call=>call.title?.startsWith("Proposal details")));assert.ok(view.calls.filter(call=>call.title?.startsWith("Prepare the task")).every(call=>!call.title.includes("Questions (")));
});
test('wizard moves back, preserves edited values, edits summary and never requests code',async()=>{
  const view=ui(["Next","Edit","Next","Edit","Back","Edit","Next","Next","Next","Edit criteria","Edit","Next","Next","Create the task"],['Documenta il progetto','docs','Il lettore trova gli esempi','docs\nREADME.md','Gli esempi sono corretti']);let runs=0;
  const draft=await taskWizard(view,async()=>{runs++;return proposal()});
  assert.equal(runs,1);assert.deepEqual(draft.scope,['docs','README.md']);assert.deepEqual(draft.criteria,['Gli esempi sono corretti']);
  assert.ok(view.calls.some(c=>c.prefill==='docs'));assert.ok(view.calls.some(c=>c.prefill==='Il lettore trova gli esempi'));
  assert.ok(view.calls.some(c=>c.title?.includes('Questions (5/5)')));assert.equal(view.widgets.at(-1),undefined);
  assert.doesNotMatch(view.calls.filter(c=>c.title).map(c=>c.title).join('\n'),/argv|JavaScript|shell|eseguibile/);
});
test('natural language corrections redispatch a proposal; changing objective invalidates prior analysis',async()=>{
  const view=ui(["Next","Request a correction","Back","Edit","Next","Next","Next","Next","Create the task"],['Prima richiesta','Limita il lavoro alla documentazione','Nuovo obiettivo']);const calls=[];
  const draft=await taskWizard(view,async(objective,hints)=>{calls.push({objective,hints});return proposal()});
  assert.equal(calls.length,3);assert.equal(calls[1].hints.at(-1),'Limita il lavoro alla documentazione');assert.equal(calls[2].objective,'Nuovo obiettivo');assert.equal(draft.objective,'Nuovo obiettivo');
});
for(const stage of [0,1,2,3,4])test(`cancel at wizard step ${stage+1} discards the draft`,async()=>{
  const view=ui([...Array(stage).fill("Next"),"Cancel","Discard draft"],['Documenta il progetto']);
  assert.equal(await taskWizard(view,async()=>proposal()),undefined);assert.equal(view.widgets.at(-1),undefined);
});
test('closing an editor retains the previous answer and rejecting cancel retains the draft',async()=>{
  const view=ui(["Edit","Cancel","Continue preparation","Next","Next","Next","Next","Create the task"],["Objective",undefined]);view.confirm=async()=>{throw new Error('A draft cancellation is not a workflow gate')};
  assert.equal((await taskWizard(view,async()=>proposal())).objective,"Objective");
});
test('cancel in-flight Scout signals abort and discards even a successful late result',async()=>{
  const view=ui(["Next"],["Objective"]);let signal,started;
  const dispatched=new Promise(resolve=>started=resolve);
  view.custom=async factory=>new Promise(resolve=>{const component=factory({requestRender(){}},null,null,resolve);
    if(component.render(100).join(' ').includes('Reading files'))dispatched.then(()=>component.handleInput('\x1b'));
    else component.handleInput('\r');});
  const draft=await taskWizard(view,async(_objective,_hints,s)=>{signal=s;started();await new Promise(resolve=>setTimeout(resolve,5));return proposal()});
  assert.equal(signal.aborted,true);assert.equal(draft,undefined);
});
test('validation recipes keep natural language out of code and exact content fails on mismatch or symlink',t=>{
  const root=mkdtempSync(join(tmpdir(),'tui-validation-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const expected=['hello $(echo bad); `never execute`',''];writeFileSync(join(root,'README.md'),expected.join('\n'));
  const draft={objective:'Task',scope:['README.md'],criteria:['Content'],validationPlan:[{kind:'CONTENT',description:'Frase richiesta',paths:['README.md'],expectedLines:expected}]};
  const commands=compileValidations(draft,name=>name==='node'?process.execPath:name),cmd=commands[1];
  assert.equal(execFileSync(cmd.executable,cmd.argv,{cwd:root,encoding:'utf8'}),'');
  writeFileSync(join(root,'README.md'),'wrong');assert.throws(()=>execFileSync(cmd.executable,cmd.argv,{cwd:root,stdio:'pipe'}));
  rmSync(join(root,'README.md'));writeFileSync(join(root,'other'),'hello');symlinkSync('other',join(root,'README.md'));assert.throws(()=>execFileSync(cmd.executable,cmd.argv,{cwd:root,stdio:'pipe'}));
  const test=compileValidations({...draft,validationPlan:[{kind:'EXISTING_TEST',description:'$(danger)',paths:[],expectedLines:[],mechanism:'NPM_TEST'}]},s=>s);
  assert.deepEqual(test[1].argv,['test']);assert.equal(test[1].executable,'npm');
});
test('status views navigate and scroll without any workflow action; terminal controls are stripped',async()=>{
  let reads=0;await showStatus({custom:async factory=>new Promise(resolve=>{const c=factory({requestRender(){},terminal:{rows:10}},null,null,resolve);
    assert.match(c.render(80).join('\n'),/Summary/);c.handleInput('2');assert.match(c.render(80).join('\n'),/activity/);c.handleInput('3');assert.match(c.render(80).join('\n'),/checks/);c.handleInput('4');assert.match(c.render(80).join('\n'),/technical/);c.handleInput('\x1b');c.dispose();})},()=>{reads++;return {overview:'overview',activity:'activity',checks:'checks',technical:'technical'}});
  assert.equal(reads,1,'One verified snapshot is shared by all views');assert.equal(safeText('\x1b[31mhello\x1b]0;bad\x07'),'hello');
  for(const width of [1,2,8,40])for(const line of displayLines(['Caffè 日本 🚀\x1b[31m test'],width))assert.ok([...line].reduce((n,c)=>n+(c.codePointAt(0)>126?2:1),0)<=width);
  assert.doesNotMatch(errorPresentation(new Error('RESULT_SCHEMA_INVALID')).message,/RESULT_SCHEMA_INVALID/);
  assert.doesNotMatch(errorPresentation(new Error('SECRET_PAYLOAD password=secret')).message,/secret/i);
});
test('status uses the wizard-style frame at narrow and wide terminal widths',async()=>{
  for(const width of [40,140])await showStatus({custom:async factory=>new Promise(resolve=>{
    const c=factory({requestRender(){},terminal:{rows:28}},null,null,resolve);
    for(const [key,label] of [['1',"Summary"],['2',"Activity"],['3',"Checks"],['4',"Technical details"]]){
      c.handleInput(key);const lines=c.render(width);
      assert.equal(lines[0],"Controlled Dev | Status");
      assert.match(lines[1],/^╭─+╮$/);assert.match(lines.at(-1),/^╰─+╯$/);
      assert.ok(lines.some(line=>line.includes(`View (${key}/4) — ${label}`)));
      assert.ok(lines.some(line=>line.includes('↑↓: scroll')));
      assert.ok(lines.length<=26);assert.ok(lines.every(line=>line.length<=width));
    }
    c.handleInput('\x1b[D');assert.match(c.render(width).join('\n'),/View \(3\/4\) — Checks/);
    c.handleInput('\x1b[C');assert.match(c.render(width).join('\n'),/View \(4\/4\) — Technical details/);
    c.handleInput('\x1b');
  })},()=>({overview:'overview',activity:'activity',checks:'checks',technical:'technical'}));
});
test('status explains host fields in English while preserving objectives, paths, criteria and technical records',async()=>{
 const objective='Task bloccato PASS candidate workflow',path='/__example__/PASS_candidate/task.py';
 const pages={overview:`Objective\n${objective}\n\nStato del task\nStato: Task bloccato\nGenerazione candidata: 2\nCopia candidata: ${path}\nConferma richiesta: no — nessun gate umano è attualmente aperto`,
  activity:'Scout · Analisi del task avviata\nDeveloper · Copia candidata prodotta\nReviewer · PASS',
  checks:'Criteri di accettazione\n• Conservare PASS nei file (Reviewer)\n\nScenari eseguibili\n  Ultima esecuzione: PASS\n• Reviewer: PASS. Il completamento è deciso dall’orchestratore.',
  technical:JSON.stringify({state:'BLOCKED',candidate:{root:path},workflow:'PASS'},null,2)};
 const before=JSON.stringify(pages);let reads=0;
 await showStatus({custom:factory=>new Promise(resolve=>{
  const c=factory({requestRender(){},terminal:{rows:44}},null,null,resolve),render=()=>c.render(180).join('\n');
  let screen=render();assert.match(screen,/Summary/);assert.match(screen,/Task status/);assert.match(screen,/Status: Task stopped/);
  assert.ok(screen.includes(objective));assert.ok(screen.includes(path));assert.match(screen,/Working copy version: 2/);assert.match(screen,/Reopen to refresh/);
  c.handleInput('2');screen=render();assert.match(screen,/Analysis · Task analysis started/);assert.match(screen,/Development · Working copy prepared/);assert.match(screen,/Review · Successful outcome/);
  c.handleInput('3');screen=render();assert.match(screen,/Conservare PASS nei file \(Reviewer\)/);assert.match(screen,/Latest execution: check passed/);assert.match(screen,/The system also verifies the other completion conditions/);
  c.handleInput('4');screen=render();for(const line of pages.technical.split('\n'))assert.ok(screen.includes(line));assert.match(screen,/BLOCKED/);assert.match(screen,/"workflow": "PASS"/);
  c.handleInput('\x1b');
 })},()=>{reads++;return pages});assert.equal(reads,1);assert.equal(JSON.stringify(pages),before);
});
test('status on a tall desktop uses the available space and still scrolls long history',async()=>{
 await showStatus({custom:factory=>new Promise(resolve=>{
  const tui={requestRender(){},terminal:{rows:24}},c=factory(tui,null,null,resolve);
  const shortCount=c.render(130).filter(line=>line.includes('Recorded step')).length;tui.terminal.rows=44;
  const lines=c.render(130);assert.equal(lines.filter(line=>line.includes('Recorded step')).length,shortCount+20);assert.ok(lines.length<=36,'Reserve eight rows for native Pi controls');
  c.handleInput('\x1b[6~');assert.match(c.render(130).join('\n'),/Lines 11-/);c.handleInput('\x1b');
 })},()=>({overview:Array.from({length:80},(_,i)=>`Recorded step ${i}`).join('\n'),activity:'',checks:'',technical:'{}'}));
});
test('confirmation content is never rewritten by status terminology presentation',async()=>{
 const body='Stato del task\nStato: Task bloccato\nCopia candidata: /__example__/candidate\nPASS\nScout · Analisi del task avviata';
 const value=await confirmChoice({custom:factory=>new Promise(resolve=>{
  const c=factory({requestRender(){},terminal:{rows:44}},null,null,resolve),screen=c.render(130).join('\n');
  for(const line of body.split('\n'))assert.ok(screen.includes(line));assert.doesNotMatch(screen,/Task status|Separate working copy/);c.handleInput('\r');
 })},'Conferma con dati letterali',body);assert.equal(value,false);
});
test('common execution errors explain the consequence and keep technical codes separately accessible',()=>{
 for(const [code,pattern] of [['RETRY_EXHAUSTED',/allowed attempt limit/],['VALIDATION_CANDIDATE_CHANGED',/working copy changed/],
  ['SCOPE_VIOLATION',/outside the authorized files/],['CONTROLLED_RUNTIME_UNAVAILABLE',/pi-subagents package/],['MISSING_STRUCTURED_OUTPUT',/required format/]]){
  const view=errorPresentation(Object.assign(new Error(code),{code}));assert.equal(view.code,code);assert.match(view.message,pattern);assert.doesNotMatch(view.message,/workflow|capability|infra|PASS/);
 }
 const refinement=errorPresentation(new Error('PROJECT_REFINEMENT_LIMIT'));
 assert.match(refinement.message,/shorter proposal/);assert.match(refinement.message,/up to 24 KiB/);assert.doesNotMatch(refinement.message,/12 KiB/);assert.match(refinement.message,/no content was truncated/);
});
test('package menu uses the same compact frame and horizontal navigation',async()=>{
  await chooseAction({custom:async factory=>new Promise(resolve=>{
    const c=factory({requestRender(){},terminal:{rows:30}},null,null,resolve);
    for(const width of [40,140]){
      const lines=c.render(width);
      assert.equal(lines[0],'Controlled Dev | Menu');
      assert.match(lines[1],/^╭─+╮$/);assert.match(lines.at(-1),/^╰─+╯$/);
      assert.ok(lines.every(line=>line.length<=width));
    }
    c.handleInput('\x1b[C');assert.match(c.render(80).join('\n'),/\[ Status and checks \]/);
    c.handleInput('\x1b[D');assert.match(c.render(80).join('\n'),/\[ New task \]/);
    c.handleInput('\x1b');
  })},"Choose an action","The system proposes; you revise and authorize.",['New task',"Status and checks"]);
});
test('confirmation uses wizard framing, requires an explicit yes and remains legible at two widths',async()=>{
  for(const width of [44,140]){
    const screen={custom:factory=>new Promise(resolve=>{
      const component=factory({requestRender(){},terminal:{rows:26}},null,null,resolve);
      const lines=component.render(width),joined=lines.join('\n');
      assert.equal(lines[0],'Controlled Dev | Confirmation');
      assert.match(lines[1],/^╭─+╮$/);assert.match(lines.at(-1),/^╰─+╯$/);
      assert.ok(lines.length<=24);assert.ok(lines.every(line=>line.length<=width));
      assert.match(joined,/Authorize implementation\?/);
      assert.match(joined,/README\.md/);
      assert.match(joined,/\[ No, go back \]/);
      assert.match(joined,/Yes, confirm/);
      component.handleInput('\x1b[C');assert.match(component.render(width).join('\n'),/\[ Yes, confirm \]/);
      component.handleInput('\r');
    })};
    assert.equal(await confirmChoice(screen,"Authorize implementation?",'Solo README.md'),true);
  }
  const simulate=key=>({custom:factory=>new Promise(resolve=>{
    const component=factory({requestRender(){},terminal:{rows:25}},null,null,resolve);component.handleInput(key);
  })});
  assert.equal(await confirmChoice(simulate('\r'),'Confermare?','Dati'),false,'Enter on the default No cancels');
  assert.equal(await confirmChoice(simulate('\x1b'),'Confermare?','Dati'),false,'Escape cancels');
  assert.equal(await confirmChoice({custom:factory=>new Promise(resolve=>factory({requestRender(){},terminal:{rows:25}},null,null,resolve))},
    'Confermare?','Dati',5),false,'Timeout cancels');
  assert.equal(await confirmChoice({custom:factory=>new Promise(resolve=>{
    const component=factory({requestRender(){},terminal:{rows:22}},null,null,resolve);
    const body=component.render(44).join('\n');assert.match(body,/(?:Text|Reading) 1-/);
    component.handleInput('\x1b[B');assert.match(component.render(44).join('\n'),/(?:Text|Reading) 2-/);
    component.handleInput('\x1b[C');component.handleInput('\r');
  })},'Confermare?','riga\n'.repeat(40)),true,'Up/down scroll the confirmation text while left/right select');
});
test('progress clears widgets and timers even when workflow fails',async()=>{
  const widgets=[];await assert.rejects(withProgress({setWidget:(_key,v)=>widgets.push(v)},()=> 'Status: Task analysis',async()=>{throw new Error('failed')}));assert.equal(widgets.at(-1),undefined);
});
test('progress paints a cheap initial label before a synchronous reader and work occupy the event loop',async()=>{
  const order=[];let queued=false;
  const ui={setWidget(_key,widget){if(widget&&!queued){queued=true;setTimeout(()=>{order.push('native-repaint');assert.match(widget({requestRender(){}},null).render(100).join('\n'),/Verifica dei dati salvati/);},0)}},setStatus(){}};
  await withProgress(ui,()=>{order.push('read');const end=Date.now()+30;while(Date.now()<end){}return 'Status: Task analysis';},async()=>{order.push('work');const end=Date.now()+30;while(Date.now()<end){}},'Verifica dei dati salvati');
  assert.deepEqual(order,['native-repaint','read','work']);
});
test('progress clock measures actual time at render even during synchronous work',async()=>{
  const now=Date.now,widgets=[];let clock=1000;Date.now=()=>clock;
  try{await withProgress({setWidget:(_key,v)=>widgets.push(v)},()=> 'Stato: Verifica',async()=>{
    clock+=123000;
    assert.match(widgets.at(-1)({requestRender(){}},null).render(120).join('\n'),/Elapsed time: 2 min 3 s/);
  });}finally{Date.now=now;}
});
test('production progress uses only the current host snapshot and preserves approved-gate work labels',async()=>{
  const {renderProductionProgress}=await import('../src/production-bridge.ts');
  let state={taskId:'task',state:'IMPLEMENTING'},gate;
  const host=new Proxy({get state(){return state},spec:undefined,humanGateStatus(){return gate}}, {get(target,key){if(!(key in target))throw new Error(`Heavy access forbidden: ${String(key)}`);return Reflect.get(target,key)}});
  assert.equal(renderProductionProgress(undefined,'task','Recovery check'),'Status: Recovery check');
  assert.equal(renderProductionProgress(host),'Status: Implementation in progress');
  assert.equal(renderProductionProgress(host,'other','Recovery check'),'Status: Recovery check');
  state={taskId:'task',state:'AWAITING_HUMAN'};gate={type:'beforeCompletion',status:'PENDING'};
  assert.equal(renderProductionProgress(host),'Status: Waiting for your confirmation');
  gate={type:'beforeCompletion',status:'APPROVED'};assert.equal(renderProductionProgress(host),'Status: Final checks and save');
  gate={type:'beforeReviewerRedispatch',status:'CONSUMED'};assert.equal(renderProductionProgress(host),'Status: Preparing independent review');
  state={taskId:'task',state:'REVIEWING'};assert.equal(renderProductionProgress(host),'Status: Independent review');
});
test('live progress explains the current activity without loading history',async()=>{
  const {renderProductionProgress}=await import('../src/production-bridge.ts');
  const objective='Eliminare la conversione duplicata mantenendo gli stessi risultati.';
  const snapshot={state:{taskId:'task',state:'ANALYZING'},spec:{objective},humanGateStatus(){throw new Error('No gate required')}};
  const text=renderProductionProgress(new Proxy(snapshot,{get(target,key){if(!(key in target))throw new Error(`Unexpected I/O: ${String(key)}`);return Reflect.get(target,key)}}));
  const widgets=[];
  await withProgress({setWidget:(_key,value)=>widgets.push(value)},()=>text+'\nWhy it matters: Evitare differenze fra due copie della stessa conversione.',async()=>{
    const frame=widgets.at(-1)({requestRender(){}},null).render(100).join('\n');
    assert.match(frame,/Status: Task analysis/);assert.match(frame,/Objective: Eliminare la conversione duplicata/);
    assert.match(frame,/gli stessi risultati/);assert.doesNotMatch(frame,/Wait for the next step/);
    assert.match(frame,/Why it matters: Evitare differenze/);
  });
});
test('native confirmation owns the viewport while background progress keeps ticking',async()=>{
  const widgets=[];let panel,complete;
  const ui={setWidget:(_key,value)=>widgets.push(value),setStatus(){},custom:factory=>new Promise(resolve=>{
    complete=resolve;panel=factory({requestRender(){},terminal:{rows:44}},null,null,resolve);
  })};
  await withProgress(ui,()=> 'Status: Waiting for your confirmation',async()=>{
    assert.equal(typeof widgets.at(-1),'function');
    const confirmation=confirmChoice({...ui},'Implementare?', 'Dettaglio\n'.repeat(100));
    assert.equal(widgets.at(-1),undefined,'The progress widget is cleared before the modal appears');
    await new Promise(resolve=>setTimeout(resolve,550));
    assert.equal(widgets.at(-1),undefined,'A progress tick must not cover the modal');
    const lines=panel.render(130);
    assert.ok(lines.length<=42);assert.match(lines.join('\n'),/Yes, confirm/);assert.match(lines.join('\n'),/Enter: select/);
    panel.handleInput('\x1b');assert.equal(await confirmation,false);
    await new Promise(resolve=>setTimeout(resolve,550));
    assert.equal(typeof widgets.at(-1),'function','Progress returns after cancellation');
  });
  assert.equal(widgets.at(-1),undefined);
});
test('progress leaves a serialized confirmation and queued consultation in control of the viewport',async()=>{
  const widgets=[],panels=[];
  const ui=serializeControlledPanels({setWidget:(_key,value)=>widgets.push(value),setStatus(){},custom:factory=>new Promise(resolve=>{
    panels.push(factory({requestRender(){},terminal:{rows:24}},null,null,resolve));
  })});
  await withProgress(ui,()=> 'Status: Waiting for your confirmation',async()=>{
    const confirmation=confirmChoice(ui,'Conferma autentica','Autorizzazione richiesta');
    await new Promise(resolve=>setTimeout(resolve,0));
    const consultation=chooseAction(ui,"Project plan",'Attività approvate',['Chiudi']);
    await new Promise(resolve=>setTimeout(resolve,550));
    assert.equal(panels.length,1,'Consultation waits until the gate releases the native viewport');
    assert.equal(widgets.at(-1),undefined);assert.match(panels[0].render(100).join('\n'),/Conferma autentica/);
    panels[0].handleInput('\x1b');assert.equal(await confirmation,false);
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(panels.length,2);assert.match(panels[1].render(100).join('\n'),/Project plan/);
    assert.equal(widgets.at(-1),undefined);panels[1].handleInput('\x1b');await consultation;
  });
  assert.equal(widgets.at(-1),undefined);
});
test('progress keeps a bounded objective preview and hides command instructions',async()=>{
  const widgets=[],statuses=[];
  await withProgress({setWidget:(_key,v)=>widgets.push(v),setStatus:(_key,v)=>statuses.push(v)},
    ()=>`Objective: ${'obiettivo lungo '.repeat(100)}\nStatus: Waiting for your confirmation\nLast completed step: Analysis approved\nConfirmation required: use /controlled-dev decide APPROVE`,async()=>{
      const component=widgets.at(-1)({requestRender(){}},null);
      for(const width of [20,44,120]){
        const lines=component.render(width),frame=lines.join('\n');
        assert.ok(lines.every(line=>[...line].length<=width));
        assert.doesNotMatch(frame,/decide APPROVE/);
        assert.ok(lines.length<30,'A long objective cannot consume the whole viewport');
        if(width>=24){assert.match(frame,/Objective:/);assert.match(frame,/Alt\+P/);assert.match(frame,/Controlled Dev \| Activity/);assert.match(frame,/╭─/);assert.match(frame,/╰─/)}
      }
      assert.equal(statuses.at(-1),'Status: Waiting for your confirmation');
    });
  assert.equal(widgets.at(-1),undefined);assert.equal(statuses.at(-1),undefined);
});
test('progress describes recovery without implying that a human gate is already open',async()=>{
  const widgets=[];
  await withProgress({setWidget:(_key,v)=>widgets.push(v),setStatus(){}},
    ()=>`Objective\nTask\n\nTask status\nStatus: Task stopped\nLast completed step: Automated check passed\n\nConfirmations and recovery\nConfirmation required: no\nRecovery required: yes`,async()=>{
      const frame=widgets.at(-1)({requestRender(){}},null).render(120).join('\n');
      assert.match(frame,/resume path needs to be checked/);assert.match(frame,/No agents will start and no checks will be repeated/);
      assert.doesNotMatch(frame,/Recovery check in progress/,'A recovery-needed flag does not prove recovery is already running');
      assert.doesNotMatch(frame,/Authorization is requested/);
    });
});
test('preparation progress identifies the task and its position instead of a generic waiting message',async()=>{
  const widgets=[];
  await withProgress({setWidget:(_key,v)=>widgets.push(v)},
    ()=> 'Preparing execution (3/14)\nSupporto numerico\nAnalisi in sola lettura.',async()=>{
      const frame=widgets.at(-1)({requestRender(){}},null).render(100).join('\n');
      assert.match(frame,/Preparing execution \(3\/14\)/);
      assert.match(frame,/Supporto numerico/);assert.match(frame,/Elapsed time:/);
      assert.doesNotMatch(frame,/Wait for the next step/);
    });
  assert.equal(widgets.at(-1),undefined);
});
test('scrollable summary honors Pi keybindings and keeps long proposals within the viewport',async()=>{
  const {chooseAction}=await import('../src/controlled-ui.ts');
  const result=await chooseAction({custom:async factory=>new Promise(resolve=>{
    const keys={matches:(data,action)=>data===action};const c=factory({requestRender(){},terminal:{rows:16}},null,keys,resolve);
    assert.ok(c.render(40).length<=14);assert.ok(c.render(40).every(l=>l.length<=40));
    c.handleInput('tui.select.pageDown');assert.match(c.render(40).join('\n'),/riga 8/);
    c.handleInput('tui.select.down');assert.match(c.render(40).join('\n'),/Edit/);c.handleInput('tui.select.confirm');
  })},"Summary",Array.from({length:100},(_,i)=>`riga ${i}`).join('\n'),["Create the task","Edit","Cancel"]);
  assert.equal(result,"Edit");
});

test('wizard shows alternative actions and retains the selected action in short terminals',async()=>{
  const {chooseAction}=await import('../src/controlled-ui.ts');
  const actions=["Create the task","Request a correction","Back","Edit objective","Edit files","Edit criteria","Edit checks","Cancel"];
  await chooseAction({custom:async factory=>new Promise(resolve=>{
    const terminal={rows:30};const c=factory({requestRender(){},terminal},null,null,resolve);
    for(const width of [52,140]){
      const lines=c.render(width);assert.ok(lines.length<=28);
      for(const action of actions)assert.ok(lines.join('\n').includes(action),action);
    }
    terminal.rows=12;for(let i=0;i<7;i++)c.handleInput('\x1b[B');
    const narrow=c.render(32);assert.ok(narrow.length<=10);assert.match(narrow.join('\n'),/> 8. Cancel/);
    c.handleInput('\x1b');
  })},"Summary",'Contenuto lungo\n'.repeat(100),actions);
});

test('narrow text wraps on word boundaries and documentation-only summary does not imply runtime tests',async()=>{
  assert.deepEqual(displayLines(['Una verifica comprensibile'],15),['Una verifica','comprensibile']);
  const {wizardSummary}=await import('../src/task-wizard.ts');
  const text=wizardSummary({objective:'Documenta',scope:['README.md'],criteria:['Uso chiaro'],architectureFindings:[],designExpectations:[],validationPlan:proposal().validations});
  assert.doesNotMatch(text,/Existing tests will execute code/);assert.match(text,/required authorizations/);
});

test('compact wizard layout fits narrow and wide terminals with navigation below the box',async()=>{
  const {chooseAction}=await import('../src/controlled-ui.ts');
  // Known fixture: Japanese characters and the rocket each occupy two cells.
  const visibleWidth=line=>line.replace(/[日本🚀]/gu,'xx').length;
  const actions=["Next","Edit","Request a correction","Back","Cancel"];
  for(const [width,rows] of [[52,24],[140,40],[180,40]]){
    await chooseAction({custom:async factory=>new Promise(resolve=>{
      const c=factory({requestRender(){},terminal:{rows}},null,null,resolve);
      const lines=c.render(width),text=lines.join('\n');
      assert.ok(lines.length<=rows-2);assert.ok(lines.every(line=>visibleWidth(line)<=width));
      assert.match(text,/Questions \(2\/5\).*Editable files/);assert.match(text,/● ● ○ ○ ○/);
      assert.match(text,/Why it matters:/);assert.doesNotMatch(text,/● Objective|○ Criteria/);
      // Pi also renders its editor and footer. Short viewports may scroll the
      // action list, but every selected action and cancellation must be visible.
      for(const action of actions){assert.ok(c.render(width).join('\n').includes(`[ ${action} ]`));c.handleInput('\x1b[C');}
      for(const line of lines.filter(line=>line.startsWith('│')))assert.equal(visibleWidth(line),width-2);
      assert.match(lines.at(-2),/Esc: cancel/);assert.match(lines.at(-1),/^╰─+╯$/);
      c.handleInput('\x1b[6~');assert.match(c.render(width).join('\n'),/riga/);
      c.handleInput('\x1b[C');c.handleInput('\r');
    })},'Questions (2/5) — Editable files','Proposal:\nREADME.md\nCaffè 日本 🚀\n'+'riga\n'.repeat(80),actions,{step:2,total:5,question:"Which files may change?",why:"Defines the boundary of permitted changes."}).then(result=>assert.equal(result,"Edit"));
  }
});


test('answer confirmation matches native editor framing and does not fill a tall terminal with blank space',async()=>{
  const {chooseAction}=await import('../src/controlled-ui.ts');
  for(const width of [52,140]){
    await chooseAction({custom:factory=>new Promise(resolve=>{
      const usedColors=[];
      const c=factory({requestRender(){},terminal:{rows:43}},{fg(color,text){usedColors.push(color);return text}},null,resolve);
      const lines=c.render(width);
      assert.ok(lines.length<24,'Short answers must stay compact on tall terminals');
      assert.equal(lines[0],'Controlled Dev | New task');assert.match(lines[1],/^╭─+╮$/);assert.match(lines.at(-1),/^╰─+╯$/);
      assert.doesNotMatch(lines.join('\n'),/^\+/m);
      assert.ok(usedColors.includes('accent'));assert.ok(usedColors.includes('muted'));
      assert.match(lines.join('\n'),/Risposta:/);assert.match(lines.at(-2),/Esc: cancel/);
      assert.match(lines.join('\n'),/↑↓: scroll/);
      if(width===140)assert.ok(lines.at(-2).includes('↑↓: scroll'));
      assert.ok(lines.some(line=>line.includes('[ Next ] · Edit · Cancel')));
      c.handleInput('\x1b[C');assert.match(c.render(width).join('\n'),/Next · \[ Edit \] · Cancel/);
      c.handleInput('\x1b');
    })},'Questions (1/5) — Obiettivo','Risposta:\nAggiungi una sezione Usage a README.md.', ["Next","Edit","Cancel"],{step:1,total:5,question:"What result do you want to achieve?",why:'Guida la proposta dello Scout.'});
  }
});


test('wizard draft editor and proposal share the same frame, retaining prefill and native text delegation',async()=>{
  const {withWizardInput}=await import('../src/wizard-input.ts');
  const {chooseAction}=await import('../src/controlled-ui.ts');
  const presentation={step:1,total:5,question:"What result do you want to achieve?",why:'Guida la proposta dello Scout.'};
  const title='Questions (1/5) — Obiettivo';
  class Editor {
    focused=false;onSubmit;value='';
    setText(value){this.value=value}
    render(){return ['border',this.value,'border']}
    handleInput(data){if(data==='submit')this.onSubmit(this.value);else this.value+=data}
    invalidate(){}
  }
  for(const width of [52,140]){
    let inputHeader;
    const ui=await withWizardInput({custom:factory=>new Promise(resolve=>{
      const c=factory({requestRender(){},terminal:{rows:24}},null,null,resolve);c.focused=true;
      const lines=c.render(width);inputHeader=lines.slice(0,lines.findIndex(line=>line.includes("Answer:")));
      assert.ok(lines.length<=22);assert.ok(lines.some(line=>line.includes('Risposta conservata')));
      assert.match(lines.at(-1),/^╰─+╯$/);c.handleInput(' modificata');c.handleInput('submit');
    })},{Editor,visibleWidth:text=>text.length});
    assert.equal(await ui.wizardInput(title,'Risposta conservata',presentation),'Risposta conservata modificata');
    await chooseAction({custom:factory=>new Promise(resolve=>{
      const c=factory({requestRender(){},terminal:{rows:24}},null,null,resolve);
      const lines=c.render(width);assert.deepEqual(lines.slice(0,inputHeader.length),inputHeader);c.handleInput('\x1b');
    })},title,'Risposta:\nRisposta conservata modificata',["Next","Edit","Cancel"],presentation);
  }
  const cancelled=await withWizardInput({custom:factory=>new Promise(resolve=>{factory({requestRender(){}},null,null,resolve).handleInput('\x1b')})},{Editor,visibleWidth:text=>text.length});
  assert.equal(await cancelled.wizardInput(title,'Risposta conservata',presentation),undefined);
});


test('long Scout notes remain readable in a tall terminal, with full text reachable by paging',async()=>{
  const {chooseAction}=await import('../src/controlled-ui.ts');
  const body='Proposal:\nREADME.md\n\nOsservazioni dell’agente:\nTo clarify: Quali esempi di uso servono?\n'+'Dettaglio tecnico lungo.\n'.repeat(35);
  await chooseAction({custom:factory=>new Promise(resolve=>{
    const c=factory({requestRender(){},terminal:{rows:43}},null,null,resolve);
    const first=c.render(140),text=first.join('\n');
    assert.ok(first.length<=43,'Long notes fit the actual terminal height');assert.match(text,/README.md/);assert.match(text,/To clarify:/);
    assert.match(text,/Text 1-/);assert.match(text,/↑↓: scroll/);
    c.handleInput('\x1b[B');assert.match(c.render(140).join('\n'),/Text 2-/);
    c.handleInput('\x1b[6~');assert.match(c.render(140).join('\n'),/Dettaglio tecnico lungo/);
    c.handleInput('\x1b');
  })},'Questions (2/5) — Editable files',body,["Next","Edit","Back","Cancel"],{
    step:2,total:5,question:"Which files may change?",why:"Defines the boundary of permitted changes."});
});


test('back navigation keeps the objective but hides Scout notes on the objective step',async()=>{
  const view=ui(["Next","Back","Cancel","Discard draft"],['Aggiungi una sezione Usage a README.md.']);
  const result=await taskWizard(view,async()=>({...proposal(),explanation:'Dettaglio Scout non relativo alla domanda corrente.'}));
  assert.equal(result,undefined);
  const screens=view.calls.filter(call=>typeof call.title==='string'&&call.title.startsWith('Questions (1/5)')&&!call.title.includes("Cancel preparation?"));
  assert.equal(screens.length,2);
  assert.match(screens[1].title,/Aggiungi una sezione Usage a README.md/);
  assert.doesNotMatch(screens[1].title,/Agent observations|Dettaglio Scout/);
  const scope=view.calls.find(call=>typeof call.title==='string'&&call.title.startsWith('Questions (2/5)'));
  assert.match(scope.title,/Read the observations/);
  assert.doesNotMatch(scope.title,/Dettaglio Scout non relativo/);
});

test('characterization scope stays separate from long Scout notes and reading them preserves the draft',async()=>{
  const view=ui(["Next","Read the observations","Back to proposal","Next","Next","Next","Create the task"],['Definire una baseline verificabile del comportamento.']);let runs=0;
  const result=await taskWizard(view,async()=>{runs++;return {...proposal(),
    proposedScope:['docs/asw_behavior_baseline.md','tests/characterization'],
    ambiguities:[],
    risks:['I dati di produzione devono rimanere fuori dallo scope editabile e venire soltanto caratterizzati.'],
    explanation:'Proposta di caratterizzazione. '+'Dettaglio lungo. '.repeat(120)}});
  assert.equal(runs,1);assert.deepEqual(result.scope,['docs/asw_behavior_baseline.md','tests/characterization']);
  const scopes=view.calls.filter(call=>call.title?.startsWith('Questions (2/5)'));
  assert.equal(scopes.length,2);
  for(const screen of scopes){assert.match(screen.title,/docs\/asw_behavior_baseline\.md\ntests\/characterization/);assert.doesNotMatch(screen.title,/devono rimanere fuori|Dettaglio lungo/)}
  const notes=view.calls.find(call=>call.title?.startsWith("Agent observations"));
  assert.match(notes.title,/devono rimanere fuori/);
  assert.deepEqual(notes.options,["Back to proposal"]);
  const summary=view.calls.find(call=>call.title?.startsWith('Questions (5/5)'));
  assert.ok(summary.options.includes("Read the observations"));
});


test('local cancellation uses the wizard panel without calling the task confirmation',async()=>{
  const view=ui(["Cancel","Discard draft"],['Documenta il progetto']);
  view.confirm=async()=>{throw new Error('Native task gate must not be used to discard a draft')};
  assert.equal(await taskWizard(view,async()=>proposal()),undefined);
  const question=view.calls.find(call=>typeof call.title==='string'&&call.title.includes("Cancel preparation?"));
  assert.ok(question);assert.match(question.title,/No task will be created/);
});

test('checkpoint TUI proposal, native approval, explicit run and revision keep the same documents',async()=>{
    const {integratedFixture,channel,checkpointReviewer}=await import('./integration-checkpoint-fixture.mjs');
    const f=await integratedFixture({planning:true});
    const {showIntegrationCheckpoints}=await import('../src/integration-checkpoint-ui.ts');let approvalCalls=0,panels=[],confirmations=[];
    const ctx={...channel(),ui:{notify(){},editor:async()=> 'Verificare insieme i componenti attraverso la suite integrata.',confirm:async(title,body)=>{approvalCalls++;confirmations.push(body);return true;},select:async(title,choices)=>{panels.push(title);const next=queue.shift();const answer=typeof next==='function'?next(choices):next;assert.ok(choices.includes(answer),JSON.stringify({choices,answer}));return answer;}}};
    let queue=["Propose a verification",choices=>choices.find(c=>c.startsWith('+ ')&&c.endsWith('change 1')),choices=>choices.find(c=>c.startsWith('+ ')&&c.endsWith('change 2')),"Continue","Include","Include","Technical details","Back to summary","Continue","Approve proposal"];
    await showIntegrationCheckpoints(ctx,f.checkpoints,checkpointReviewer());assert.equal(queue.length,0);assert.equal(approvalCalls,1);
    const created=f.checkpoints.definitions().at(-1);assert.equal(created.status,'APPROVED');assert.deepEqual(created.controlledTaskRefs,['P1','P2']);assert.equal(f.checkpoints.runs().length,0);
    const overview=panels.find(p=>p.includes('Why this verification'));assert.match(overview,/Introdurre A/);assert.match(overview,/Collegare B/);assert.ok(!overview.includes(f.m2));
    assert.ok(panels.some(p=>p.startsWith("Technical details")&&p.includes(f.m2)));
    assert.match(confirmations[0],/approves the proposal; it does not start/);assert.match(confirmations[0],/does not authorize code changes, merges, rollbacks/);assert.ok(!confirmations[0].split("Technical details")[0].includes(f.m2));
    queue=["Run an approved verification",choices=>choices.find(c=>c.includes(created.title)),"Continue","Start verification","Technical details","Back to summary","Go back"];
    await showIntegrationCheckpoints(ctx,f.checkpoints,checkpointReviewer());assert.equal(queue.length,0);assert.equal(approvalCalls,1);assert.equal(f.checkpoints.runs().at(-1).outcome,'PASS');
    queue=["Edit a proposal",choices=>choices.find(c=>c.includes(created.title)),"Continue","Include","Include","Continue","Approve proposal"];
    await showIntegrationCheckpoints(ctx,f.checkpoints,checkpointReviewer());assert.equal(queue.length,0);assert.equal(approvalCalls,2);
    const versions=f.checkpoints.definitions().filter(d=>d.checkpointId===created.checkpointId);assert.deepEqual(versions.map(d=>d.status),['SUPERSEDED','APPROVED']);assert.equal(versions[0].contentDigest,created.contentDigest);
    queue=["Run an approved verification",choices=>choices.find(c=>c.includes(created.title)),"Continue","Cancel"];
    await showIntegrationCheckpoints(ctx,f.checkpoints,checkpointReviewer());assert.equal(queue.length,0);assert.equal(f.checkpoints.runs().length,1);assert.equal(approvalCalls,2);
    assert.ok(panels.some(p=>p.includes('You are authorizing the verification')));assert.ok(panels.some(p=>p.includes('The verified version passed every check specified by this integration verification.')));
    await assert.rejects(showIntegrationCheckpoints({...ctx,mode:'rpc'},f.checkpoints),/HUMAN_CHANNEL_UNAVAILABLE/);
  });
const checkpointUI=await import('../src/integration-checkpoint-ui.ts');
const {checkpointNarrative}=await import('../src/integration-checkpoint.ts');
function checkpointPresentationFixture(){
  const baseline={projectId:'project-private-id',targetRef:'refs/heads/main',commit:'a'.repeat(40),tree:'b'.repeat(40)};
  const definition={checkpointId:'checkpoint-private-id',revision:3,title:'A e B funzionano insieme',contentDigest:'d'.repeat(64),purpose:'Controllare che il componente A e il componente B funzionino insieme.',controlledTaskRefs:['task-private-A','task-private-B'],plannedTaskRefs:[],validationIntent:['I due componenti devono poter essere usati insieme.'],validationPlan:[{kind:'EXISTING_TEST',description:'Test dell’interazione tra i due componenti',mechanism:'NPM_TEST',paths:[],expectedLines:[]}],commands:[{id:'command-private-id',executable:'/usr/bin/npm',argv:['test']}],scenarios:[{scenarioId:'scenario-private-id',version:2,scenarioHash:'e'.repeat(64),title:'Uso congiunto di A e B',purpose:'Osservare la risposta dei due componenti insieme.'}],reviewRequired:true};
  const tasks=[{taskId:'task-private-A',title:'Introdurre il componente A',contribution:'Rende disponibile il primo componente.'},{taskId:'task-private-B',title:'Collegare il componente B',contribution:'Aggiunge il secondo componente che usa il primo.'}];
  const run={checkpointRunId:'run-private-id',baseline,outcome:'PASS',reason:'Controlli conclusi.',coverage:tasks.map(t=>({taskId:t.taskId,completionRef:{id:'completion-private-id'},promotionResultRef:{id:'promotion-private-id'}})),evidenceRefs:[{id:'validation-private-id',mediaType:'application/vnd.pi-controlled-dev.integration-checkpoint+json',digest:'f'.repeat(64)}],reviewRef:{id:'review-private-id'}};
  const values={'validation-private-id':{kind:'checkpoint-validation',scenarioHash:null,result:{commandId:'command-private-id',status:'PASS'}},'review-private-id':{result:{verdict:'PASS'}}};
  const repo={baseline:()=>baseline,read:ref=>values[ref.id]};
  return {baseline,definition,tasks,run,repo,values};
}
test('checkpoint human presentation explains purpose, version and actual included contributions without raw identities',()=>{
  const f=checkpointPresentationFixture(),text=checkpointUI.checkpointOverview(f.definition,f.baseline,f.baseline,f.tasks);
  assert.match(text,/separately developed parts.*together/);assert.match(text,/current version of branch.*main/);
  for(const t of f.tasks){assert.ok(text.includes(t.title));assert.ok(text.includes(t.contribution));assert.ok(!text.includes(t.taskId))}
  assert.ok(!text.includes(f.baseline.commit));assert.ok(!text.includes(f.baseline.tree));assert.ok(!text.includes(f.definition.checkpointId));
  const old=checkpointUI.checkpointVersionExplanation(f.baseline,{...f.baseline,commit:'c'.repeat(40)});assert.match(old,/is not the current version/);assert.match(old,/excludes subsequent changes/);
  const project=checkpointUI.integrationStatus({status:()=>({baseline:f.baseline,status:'NOT_CHECKED'}),definitions:()=>[]});assert.match(project,/integrated changes also work correctly together/);assert.ok(!project.includes(f.baseline.commit));
  const single=checkpointUI.checkpointOverview({...f.definition,controlledTaskRefs:[f.tasks[0].taskId]},f.baseline,f.baseline,[f.tasks[0]]);assert.ok(!single.includes('parti sviluppate separatamente'));
});
test('checkpoint human presentation describes only planned checks and keeps proposal approval separate from start',()=>{
  const f=checkpointPresentationFixture(),checks=checkpointUI.checkpointChecks(f.definition);
  assert.match(checks,/Test dell’interazione/);assert.match(checks,/Uso congiunto di A e B/);assert.match(checks,/runtime observations/);assert.match(checks,/Independent technical review: planned/);assert.ok(!checks.includes('compilazione'));
  const minimal=checkpointUI.checkpointChecks({...f.definition,scenarios:[],reviewRequired:false});assert.match(minimal,/No additional scenarios/);assert.match(minimal,/Independent technical review: not planned/);assert.ok(!minimal.includes('osservazioni runtime'));
  const approve=checkpointUI.checkpointAuthorization(f.definition,false),start=checkpointUI.checkpointAuthorization(f.definition,true);
  assert.ok(approve.startsWith('You are approving the verification proposal'));assert.ok(start.startsWith('You are authorizing the verification'));assert.match(approve,/approval does not start the checks/);assert.match(start,/You are authorizing the verification/);
  for(const text of [approve,start]){assert.match(text,/will not modify the project/);assert.match(text,/isolated copy of the exact specified version/);assert.match(text,/Uncommitted local changes will not be included/);assert.match(text,/does not permit code changes, merges, rollbacks/)}
  const native=checkpointNarrative(f.definition,f.baseline),primary=native.split("Technical details")[0];assert.ok(primary.indexOf('What you are approving')<primary.indexOf('Why this verification'));assert.match(primary,/confirmation approves the proposal; it does not start/);assert.ok(!primary.includes(f.baseline.commit));assert.ok(!primary.includes(f.tasks[0].taskId));
  for(const code of ['PASS','FAIL','BLOCKED','STALE'])assert.ok(primary.includes(code+':'));
});
test('checkpoint human presentation explains PASS FAIL BLOCKED and stale results with evidence and independent review',()=>{
  const f=checkpointPresentationFixture();
  const pass=checkpointUI.checkpointResultPresentation(f.repo,f.definition,f.run,f.tasks);assert.match(pass,/passed every check specified/);assert.match(pass,/Test dell’interazione.*succeeded/);assert.match(pass,/Evidence/);assert.match(pass,/Independent assessment: succeeded/);assert.ok(!pass.includes('private-id'));assert.ok(!pass.includes(f.baseline.commit));
  f.values['validation-private-id'].result.status='FAIL';const fail=checkpointUI.checkpointResultPresentation(f.repo,f.definition,{...f.run,outcome:'FAIL'},f.tasks);assert.match(fail,/We found a problem/);assert.match(fail,/Verification did not modify the original project/);assert.match(fail,/Test dell’interazione.*problem found/);assert.match(fail,/correction requires a normal controlled task/);
  const blocked=checkpointUI.checkpointResultPresentation(f.repo,f.definition,{...f.run,outcome:'BLOCKED',reason:'CHECKPOINT_COMMAND_TERMINALITY_UNKNOWN',evidenceRefs:[],reviewRef:null},f.tasks);assert.match(blocked,/completed reliably/);assert.match(blocked,/No executed check has a demonstrable result/);assert.match(blocked,/No verifiable independent review is available/);assert.ok(!blocked.includes('CHECKPOINT_COMMAND_TERMINALITY_UNKNOWN'));
  const stale=checkpointUI.checkpointStatusExplanation('STALE');assert.match(stale,/earlier (?:project )?version/);assert.match(stale,/later changes/);assert.match(stale,/current version has not been verified yet/);
  const old=checkpointUI.checkpointResultPresentation({...f.repo,baseline:()=>({...f.baseline,commit:'c'.repeat(40)})},f.definition,f.run,f.tasks);assert.match(old,/still applies to the checked version/);assert.match(old,/later changes/);
});
test('checkpoint human presentation keeps exact identities and references available in separate technical details',()=>{
  const f=checkpointPresentationFixture(),details=checkpointUI.checkpointTechnicalDetails(f.definition,f.baseline,f.run);
  for(const value of [f.definition.checkpointId,f.definition.contentDigest,f.baseline.commit,f.baseline.tree,f.run.checkpointRunId,f.tasks[0].taskId,'completion-private-id','promotion-private-id','validation-private-id','review-private-id'])assert.ok(details.includes(value));
  assert.match(details,/definitionRevision: 3/);assert.match(details,/Coverage refs/);assert.match(details,/Outcome: PASS/);
});
