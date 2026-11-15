import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import readline from 'node:readline';
import {randomBytes} from 'node:crypto';
import {seal,verify} from '../integrations/paperclip/protocol.mjs';

// A declared SDK lifecycle double, not evidence of a real human response.
for(const blocked of [false,'throw','reported'])test('worker stop awaits native shutdown and '+(blocked?'preserves a blocked shutdown via '+blocked:'acknowledges only clean disposal'),{timeout:15000},async t=>{
 const root=mkdtempSync(join(tmpdir(),'paperclip-worker-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const sdk=join(root,'sdk.mjs');
 writeFileSync(sdk,`
 export const SettingsManager={inMemory:settings=>settings};
 export const SessionManager={create:()=>({getSessionId:()=> 'fixture-session'})};
 export const createEventBus=()=>({emit(name,q){if(name==='controlled-dev:human-host-context:v1')q.result={...q.context,disposeHumanChannel(){}}}});
 export class DefaultResourceLoader{async reload(){}getExtensions(){return {errors:[],extensions:[]}}}
 export async function createAgentSession({settingsManager,sessionManager}){
  let ui,onError;
  const session={model:{provider:settingsManager.defaultProvider,id:settingsManager.defaultModel},sessionManager,
   async bindExtensions(bindings){ui=bindings.uiContext;onError=bindings.onError},getActiveToolNames:()=>['read'],async abort(){},
   extensionRunner:{createCommandContext:()=>({sessionManager}),async emit(event){
    if(event.type!=='session_shutdown')throw Error('unexpected event');
    await new Promise(r=>setTimeout(r,30));ui.notify('fixture-native-shutdown');
    if(${JSON.stringify(blocked)}==='throw')throw Error('ORCHESTRATOR_BLOCKED');
    if(${JSON.stringify(blocked)}==='reported')onError({event:'session_shutdown',error:'ORCHESTRATOR_BLOCKED'});
   }},dispose(){ui.notify('fixture-native-dispose')}};
  return {session};
 }
 `);
 const key=randomBytes(32).toString('hex'),events=[];
 const child=spawn(process.execPath,[fileURLToPath(new URL('../integrations/paperclip/worker.mjs',import.meta.url))],{cwd:root,env:{},stdio:['pipe','pipe','pipe']});
 t.after(()=>child.kill('SIGKILL'));let stderr='';child.stderr.on('data',b=>stderr+=b);
 const exited=once(child,'exit');
 readline.createInterface({input:child.stdout}).on('line',line=>{
  const packet=JSON.parse(line);assert.equal(verify(key,packet),true);events.push(packet.value);
  if(packet.value.type==='ready')child.stdin.write(JSON.stringify(seal(key,{type:'stop'}))+'\n');
 });
 child.stdin.write(JSON.stringify({type:'bootstrap',key,config:{sdkEntry:sdk,packages:[],profile:'sviluppo',model:{provider:'fixture',id:'fixture'},sessionDirectory:join(root,'sessions')}})+'\n');
 const [code,signal]=await exited;assert.equal(signal,null,stderr);assert.equal(code,blocked?1:0,stderr);
 const shutdown=events.findIndex(e=>e.type==='notice'&&e.text==='fixture-native-shutdown'),disposed=events.findIndex(e=>e.type==='notice'&&e.text==='fixture-native-dispose');
 assert.ok(shutdown>=0&&disposed>shutdown,JSON.stringify(events));
 assert.equal(events.some(e=>e.type==='stopped'),!blocked);
 if(blocked)assert.match(events.find(e=>e.type==='stop-failed').error,/ORCHESTRATOR_BLOCKED/);
 else assert.equal(events.at(-1).clean,true);
});
