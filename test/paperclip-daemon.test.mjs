import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function control(directory,value){
 const socket=net.createConnection(path.join(directory,'control.sock'));socket.setTimeout(8000,()=>socket.destroy(Error('test timeout')));
 let data='';socket.on('data',b=>data+=b);await once(socket,'connect');socket.write(JSON.stringify(value)+'\n');await once(socket,'end');return JSON.parse(data);
}
for(const explicitPolicy of [false,true])for(const stopCase of ['idle','pending','withdraw-error','monitor-error','blocked','no-ack'])test('private daemon preserves '+(explicitPolicy?'explicit review/trust policy':'server default null policy')+' and stops from '+stopCase,async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pi-paperclip-daemon-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const issue={id:'issue',identifier:'TST-1',companyId:'company',projectId:'project',assigneeAgentId:'agent',assigneeUserId:null,status:'in_progress',executionPolicy:explicitPolicy?{mode:'normal',commentRequired:true,stages:[{id:'preserved',type:'review',approvalsNeeded:1,participants:[{id:'participant',type:'user',userId:'owner'}]}],authorizationPolicy:{trustPreset:'test-preserved'},maxReviewRounds:3}:null};
 const documents=new Map(),interactions=[],patches=[];
 const server=http.createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer fixture-value');assert.equal(req.headers['x-paperclip-run-id'],'run');
  let data='';for await(const b of req)data+=b;const body=data?JSON.parse(data):null;
  const route=req.url;let result;
  if(route==='/api/agents/me')result={id:'agent',companyId:'company'};
  else if(route==='/api/issues/issue'){if(body){
   if(stopCase==='monitor-error'&&body.executionPolicy?.monitor===null&&issue.executionPolicy?.monitor){
    await pause(1300);res.writeHead(503);res.end('{}');return;
   }
   patches.push(body);Object.assign(issue,body);issue.monitorNextCheckAt=body.executionPolicy?.monitor?.nextCheckAt??null;if(!issue.executionPolicy?.monitor&&!issue.executionPolicy?.stages?.length)issue.executionPolicy=null;}result=issue;}
  else if(route==='/api/issues/issue/interactions'){
   if(body){const row={...body,id:'interaction',issueId:'issue',companyId:'company',requestedResolverPolicy:body.resolverPolicy,effectiveResolverPolicy:body.resolverPolicy,status:'pending'};interactions.push(row);result=row;}else result=interactions;
  }else if(route==='/api/issues/issue/interactions/interaction/withdraw'){
   if(stopCase==='withdraw-error'){res.writeHead(503);res.end('{}');return;}
   interactions[0].status='withdrawn';result=interactions[0];
  }else if(route.includes('/documents/')){
   const key=route.split('/documents/')[1];if(body)documents.set(key,{...body,id:'document',latestRevisionId:'revision'});result=documents.get(key);
   if(!result){res.writeHead(404);res.end('{}');return;}
  }else throw Error('unexpected route '+route);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const apiUrl='http://127.0.0.1:'+server.address().port;
 const fixture=path.join(directory,'worker.mjs');
 fs.writeFileSync(fixture,`
import readline from 'node:readline';
import {seal,verify,digest} from ${JSON.stringify(path.join(root,'integrations/paperclip/protocol.mjs'))};
const rl=readline.createInterface({input:process.stdin});let key;
const emit=(v,done)=>process.stdout.write(JSON.stringify(seal(key,v))+'\\n',done);
rl.on('line',line=>{const packet=JSON.parse(line);if(!key){key=packet.key;emit({type:'ready',credentialAbsent:!process.env.PAPERCLIP_API_KEY});return;}
 if(!verify(key,packet))process.exit(3);const v=packet.value;
 if(v.type==='command'){
  emit({type:'command-start',commandId:v.commandId});
  if(v.args==='second'){emit({type:'command-finished',commandId:v.commandId});return;}
  setTimeout(()=>{const material={version:1,requestId:'request',sessionId:'session',title:'Fixture only',display:'Synthetic test. No real approval.'};emit({type:'human-request',request:{...material,kind:'confirm',digest:digest(material)}});},500);}
 if(v.type==='human-response')emit({type:'command-finished',commandId:'first',received:v.accepted});
 if(v.type==='stop'){
  emit({type:'stop-received'});
  emit({type:'command-failed',error:'BRIDGE_STOPPED'});
  if(${JSON.stringify(stopCase)}==='no-ack')process.exit(0);
  else if(${JSON.stringify(stopCase)}==='blocked')emit({type:'stop-failed',error:'ORCHESTRATOR_BLOCKED'},()=>process.exit(1));
  else emit({type:'stopped',clean:true},()=>process.exit(0));
 }
});`);
 const job={id:'test-job',profile:'sviluppo',project:directory,apiUrl,companyId:'company',issueId:'issue',agentId:'agent',workerArgv:[process.execPath,fixture],workerConfig:{},initialCommand:{name:'fixture',args:'',commandId:'first'}};
 fs.writeFileSync(path.join(directory,'job.json'),JSON.stringify(job));
 const child=spawn(process.execPath,[path.join(root,'integrations/paperclip/daemon.mjs'),path.join(directory,'job.json')],{env:{},stdio:'pipe'});
 const daemonExited=once(child,'exit');
 let stderr='';child.stderr.on('data',b=>stderr+=b);t.after(()=>child.kill('SIGKILL'));
 for(let n=0;n<100&&!fs.existsSync(path.join(directory,'control.sock'));n++)await pause(30);
 assert.equal(fs.existsSync(path.join(directory,'control.sock')),true,stderr);
 let result;
 for(let n=0;n<100;n++){result=await control(directory,{action:'status'});if(result.state.phase!=='starting')break;await pause(30);}
 assert.equal(result.state.phase,'idle');assert.equal(result.state.runtime.credentialAbsent,true);assert.equal(interactions.length,0);
 const credentials={apiUrl,companyId:'company',issueId:'issue',agentId:'agent',runId:'run',apiKey:'fixture-value'};
 result=await control(directory,{action:'tick',credentials,waitMs:0});assert.equal(result.ok,true);assert.equal(issue.executionPolicy.monitor.kind,'external_service');assert.equal(issue.executionPolicy.monitor.scheduledBy,'assignee');assert.equal(issue.executionPolicy.mode,'normal');assert.equal(issue.executionPolicy.commentRequired,true);
 if(stopCase==='monitor-error'){
  const stopping=control(directory,{action:'stop',credentials});
  await pause(600);
  const during=JSON.parse(fs.readFileSync(path.join(directory,'state.json'),'utf8'));
  const stopped=await stopping;
  assert.ok(during.events.some(event=>event.type==='stop-received'),'local stop must precede the delayed Paperclip failure');
  assert.equal(stopped.ok,true);
  assert.equal(stopped.state.monitorClearError,'PAPERCLIP_HTTP_503');
  await daemonExited;
  const final=JSON.parse(fs.readFileSync(path.join(directory,'state.json'),'utf8'));
  assert.equal(final.phase,'stopped');
  assert.equal(final.monitorClearError,'PAPERCLIP_HTTP_503');
  return;
 }
 result=await control(directory,{action:'tick',credentials,waitMs:1000});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.state.phase,'awaiting-human');assert.equal(interactions.length,1);
 if(explicitPolicy){assert.equal(issue.executionPolicy.stages[0].participants[0].userId,'owner');assert.equal(issue.executionPolicy.authorizationPolicy.trustPreset,'test-preserved');assert.equal(issue.executionPolicy.maxReviewRounds,3);assert.equal(issue.executionPolicy.commentRequired,true);assert.equal(issue.executionPolicy.monitor,null);}else assert.equal(issue.executionPolicy,null);
 if(stopCase==='idle'){
  const retry={action:'command',credentials,waitMs:0,command:job.initialCommand};
  const pendingReplay=await control(directory,retry);
  assert.equal(pendingReplay.ok,true);
  assert.equal(pendingReplay.state.phase,'awaiting-human');
  assert.deepEqual(pendingReplay.commandReplay,{commandId:'first',result:null});
  Object.assign(interactions[0],{status:'accepted',resolvedByUserId:'fixture-user',resolvedByAgentId:null,resolvedByRunId:null,resolvedAt:new Date().toISOString(),result:{version:1,outcome:'accepted'}});
  result=await control(directory,{action:'tick',credentials,waitMs:500});assert.equal(result.state.phase,'idle');assert.equal(result.state.lastCommand.received,true);
  const second={name:'fixture',args:'second',commandId:'constructor'};
  const newer=await control(directory,{action:'command',credentials,waitMs:500,command:second});
  assert.equal(newer.state.lastCommand.commandId,second.commandId);
  const controller=spawn(process.execPath,[
   path.join(root,'integrations/paperclip/controller.mjs'),directory,'command','fixture','','first',
  ],{env:{
   PAPERCLIP_API_URL:apiUrl,PAPERCLIP_API_KEY:credentials.apiKey,PAPERCLIP_COMPANY_ID:credentials.companyId,
   PAPERCLIP_TASK_ID:credentials.issueId,PAPERCLIP_AGENT_ID:credentials.agentId,PAPERCLIP_RUN_ID:credentials.runId,
  },stdio:['ignore','pipe','pipe']});
  let output='';
  controller.stdout.on('data',chunk=>output+=chunk);
  assert.deepEqual(await once(controller,'close'),[0,null]);
  const completedReplay=JSON.parse(output);
  assert.equal(completedReplay.ok,true);
  assert.equal(completedReplay.state.phase,'idle');
  assert.equal(completedReplay.commandReplay.result.commandId,'first');
  assert.equal(completedReplay.commandReplay.result.received,true);
  const conflict=await control(directory,{...retry,command:{...retry.command,args:'changed'}});
  assert.equal(conflict.error,'BRIDGE_COMMAND_ID_CONFLICT');
  assert.equal(conflict.state.events.filter(event=>event.type==='command-start'&&event.commandId==='first').length,1);
  const audit=fs.readFileSync(path.join(directory,'human-decisions.jsonl'),'utf8');assert.ok(audit.includes('fixture-user'));assert.ok(!audit.includes('fixture-value'));
 }
 const stopped=await control(directory,{action:'stop',credentials});assert.equal(stopped.ok,true);await daemonExited;
 const final=JSON.parse(fs.readFileSync(path.join(directory,'state.json'),'utf8'));
 const clean=!['blocked','no-ack'].includes(stopCase);assert.equal(final.phase,clean?'stopped':'interrupted');assert.equal(final.stopConfirmed===true,clean);assert.equal(final.exit.code,stopCase==='blocked'?1:0);
 if(stopCase==='withdraw-error')assert.equal(final.withdrawError,'PAPERCLIP_HTTP_503');
 if(stopCase!=='idle')assert.equal(fs.existsSync(path.join(directory,'human-decisions.jsonl')),false,'Stop must not deliver a pending answer');
 assert.equal(fs.existsSync(path.join(directory,'control.sock')),false);assert.equal(fs.readFileSync(path.join(directory,'state.json'),'utf8').includes('fixture-value'),false);
 if(stopCase==='idle'&&!explicitPolicy){
  const restart=spawn(process.execPath,[path.join(root,'integrations/paperclip/daemon.mjs'),path.join(directory,'job.json')],{env:{},stdio:['ignore','ignore','pipe']});
  let failure='';
  restart.stderr.on('data',chunk=>failure+=chunk);
  assert.deepEqual(await once(restart,'close'),[1,null]);
  assert.match(failure,/EEXIST/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'state.json'),'utf8')),final);
 }
});
