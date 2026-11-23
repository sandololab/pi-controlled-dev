import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {randomBytes} from 'node:crypto';
import {PaperclipHumanClient} from './client.mjs';
import {seal,verify,redact,safeId,digest} from './protocol.mjs';
const jobPath=process.argv[2],job=JSON.parse(fs.readFileSync(jobPath,'utf8')),directory=path.dirname(jobPath);
if(!safeId(job.id)||!Array.isArray(job.workerArgv)||!job.workerArgv.length)throw Error('BRIDGE_JOB_INVALID');
const key=randomBytes(32).toString('hex'),socket=path.join(directory,'control.sock'),stateFile=path.join(directory,'state.json');
let state={version:1,jobId:job.id,profile:job.profile,issueId:job.issueId,companyId:job.companyId,phase:'starting',pid:process.pid,startedAt:new Date().toISOString(),events:[],pending:null};
const commands=new Map();
let card=null,queue=Promise.resolve(),childReady=false,workTimer=null,activeSince=null;
let stopCleanupPending=false,stopTimer=null;
const workBudgetMs=30*60*1000;
function remainingWork(){return workBudgetMs-(state.workMs??0)-(activeSince===null?0:Date.now()-activeSince);}
function pauseClock(){if(activeSince!==null){state.workMs=(state.workMs??0)+Date.now()-activeSince;activeSince=null;}clearTimeout(workTimer);workTimer=null;}
function startClock(){if(activeSince!==null)return;activeSince=Date.now();workTimer=setTimeout(()=>{pauseClock();state.phase='failed';state.error='BRIDGE_ACTIVE_WORK_BUDGET_EXHAUSTED';save();child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),3000).unref();},Math.max(0,remainingWork()));workTimer.unref();}
function save(){const t=stateFile+'.tmp';fs.writeFileSync(t,JSON.stringify(state,null,2)+'\n',{mode:0o600});fs.renameSync(t,stateFile);}
function event(v){const record={at:new Date().toISOString(),...v};fs.appendFileSync(path.join(directory,'native-events.jsonl'),JSON.stringify(record)+'\n',{mode:0o600});state.events.push(record);if(state.events.length>200)state.events.shift();save();}
// A job directory belongs to one native session, even after interruption.
fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n',{mode:0o600,flag:'wx'});
const child=spawn(job.workerArgv[0],job.workerArgv.slice(1),{cwd:job.project,env:{},stdio:['pipe','pipe','pipe']});
child.stdin.write(JSON.stringify({type:'bootstrap',key,config:job.workerConfig})+'\n');
child.stdin.on('error',e=>event({type:'worker-input-failed',error:redact(e.message)}));
const send=v=>child.stdin.write(JSON.stringify(seal(key,v))+'\n');
function launch(input){
 if(!safeId(input?.commandId)||!safeId(input.name)||typeof input.args!=='string'||input.args.length>20000)throw Error('BRIDGE_COMMAND_INVALID');
 const {name,args,commandId}=input;
 const fingerprint=digest({name,args});
 const previous=commands.get(commandId);
 if(previous){
  if(previous.fingerprint!==fingerprint)throw Error('BRIDGE_COMMAND_ID_CONFLICT');
  return {commandId,result:previous.result};
 }
 if(!childReady||state.phase!=='idle')throw Error('BRIDGE_JOB_NOT_IDLE');
 const command={name,args,commandId};
 state.phase='running';state.workMs=0;startClock();state.currentCommand=command;state.monitorAttempts=0;state.commandStartedAt=new Date().toISOString();save();
 commands.set(commandId,{fingerprint,result:null});
 send({type:'command',...command});
 return null;
}
readline.createInterface({input:child.stdout,crlfDelay:Infinity}).on('line',line=>{
 if(line.length>1024*1024){child.kill('SIGTERM');return;}
 let packet;try{packet=JSON.parse(line);}catch{return;}
 if(!verify(key,packet)){event({type:'ignored-untrusted-output'});return;}
 const v=packet.value;
 if(v.type==='ready'){childReady=true;if(state.phase==='starting')state.phase='idle';state.runtime=v;save();}
 else if(v.type==='human-request'){
  if(['stopping','stopped','failed','interrupted'].includes(state.phase))return;
  if(state.pending){state.phase='failed';state.error='BRIDGE_DUPLICATE_PENDING';save();return;}
  pauseClock();state.pending=v.request;card=null;state.phase='awaiting-publication';event({type:'human-request',requestId:v.request.requestId,digest:v.request.digest});
 }
 else if(v.type==='stopped'&&v.clean===true&&state.phase==='stopping'){
  state.phase='stopped';state.stopConfirmed=true;event(v);
 }else if(v.type==='stop-failed'){
  state.phase='failed';state.error=v.error;event(v);
 }else if(v.type==='command-finished'||v.type==='command-failed'){
  const command=commands.get(v.commandId);
  if(!command||command.result||state.currentCommand?.commandId!==v.commandId){event(v);return;}
  command.result=v;
  pauseClock();
  if(['running','awaiting-publication','awaiting-human'].includes(state.phase))state.phase=v.type==='command-finished'?'idle':'failed';
  state.lastCommand=v;state.pending=null;card=null;event(v);
 }else event(v);
});
let stderrBytes=0;child.stderr.on('data',b=>{if(stderrBytes>32768)return;const text=redact(b.toString());stderrBytes+=b.length;fs.appendFileSync(path.join(directory,'worker.log'),text,{mode:0o600});});
function finishDaemon(){
 if(state.exit&&!stopCleanupPending)setTimeout(()=>process.exit(0),1000).unref();
}
child.on('close',(code,signal)=>{pauseClock();clearTimeout(stopTimer);state.phase=state.phase==='stopped'&&state.stopConfirmed&&code===0?'stopped':'interrupted';state.exit={code,signal};state.pending=null;event({type:'worker-exit',code,signal});server.close();try{fs.unlinkSync(socket);}catch{}finishDaemon();});
child.on('error',e=>{state.phase='failed';state.error=redact(e.message);save();});
function validateCredentials(c){
 if(!c||c.apiUrl!==job.apiUrl||c.companyId!==job.companyId||c.issueId!==job.issueId||c.agentId!==job.agentId)throw Error('BRIDGE_CONTEXT_MISMATCH');
 return new PaperclipHumanClient(c);
}
async function posture(client){
 // A null policy is the server's normal default, not a missing authorization.
 // Preserve every explicit review/trust field when attaching this job's monitor.
 const issue=client.issue,policy=issue.executionPolicy??{mode:'normal',commentRequired:true,stages:[],maxReviewRounds:null};
 const pending=['awaiting-publication','awaiting-human'].includes(state.phase);
 if(pending){
  if(!card)return;
  await client.api('PATCH','/issues/'+job.issueId,{status:'in_review',executionPolicy:{...policy,monitor:null}});
 }else if(state.phase==='running'||state.phase==='starting'){
  const timeoutAt=new Date(Date.now()+Math.max(0,remainingWork())).toISOString();
  state.monitorAttempts=(state.monitorAttempts??0)+1;
  if(state.monitorAttempts>30||Date.now()>=Date.parse(timeoutAt))throw Error('BRIDGE_MONITOR_BUDGET_EXHAUSTED');
  const result=await client.api('PATCH','/issues/'+job.issueId,{status:'in_progress',executionPolicy:{...policy,monitor:{
   kind:'external_service',serviceName:'pi-native-worker',externalRef:job.id,nextCheckAt:new Date(Date.now()+60000).toISOString(),
   timeoutAt,maxAttempts:30,scheduledBy:'assignee',notes:'Controllo limitato del solo lavoratore Pi attivo; nessun monitor GitHub.'}}});
  if(!result.monitorNextCheckAt||result.assigneeAgentId!==job.agentId||result.assigneeUserId||!['in_progress','in_review'].includes(result.status))throw Error('BRIDGE_MONITOR_NOT_SAVED');
  state.monitorNextCheckAt=result.monitorNextCheckAt;save();
 }else if(policy.monitor?.serviceName==='pi-native-worker'&&policy.monitor?.externalRef===job.id){
  await client.api('PATCH','/issues/'+job.issueId,{executionPolicy:{...policy,monitor:null}});
 }
}
async function tick(credentials,waitMs=15000){
 const client=validateCredentials(credentials);await client.identity();
 const deadline=Date.now()+Math.min(Math.max(waitMs,0),30000);

 do{
  if(job.initialCommand&&!state.initialCommandStarted&&state.phase==='idle'){launch(job.initialCommand);state.initialCommandStarted=true;save();}
  if(state.pending){
   const request=state.pending;
   if(!card){card=await client.publish(job.id,request);state.interactionId=card.id;state.phase='awaiting-human';save();}
   const answer=await client.read(card,request);
   if(!answer){await posture(client);return state;}
   const response={type:'human-response',requestId:request.requestId,requestDigest:request.digest,...answer};
   fs.appendFileSync(path.join(directory,'human-decisions.jsonl'),JSON.stringify({request,response})+'\n',{mode:0o600});
   // A response can be emitted once in this live native session. Restart never replays it.
   state.pending=null;card=null;state.interactionId=null;state.phase='running';state.commandStartedAt??=new Date().toISOString();save();
   startClock();send(response);
  }
  if(['idle','failed','interrupted','stopped'].includes(state.phase))break;
  if(Date.now()>=deadline)break;
  await new Promise(r=>setTimeout(r,100));
 }while(true);
 await posture(client);return state;
}
async function stop(client){
 if(['stopping','stopped','interrupted'].includes(state.phase)||state.exit)return;
 const pendingCard=card;
 pauseClock();
 state.phase='stopping';
 save();
 stopCleanupPending=true;
 stopTimer=setTimeout(()=>child.kill('SIGKILL'),30000);
 send({type:'stop'});
 try{
  // The local shutdown can finish while Paperclip is still handling cleanup.
  const deadline=Date.now()+5000;
  if(pendingCard?.status==='pending'){
   try{await client.api('POST','/issues/'+job.issueId+'/interactions/'+pendingCard.id+'/withdraw',{});}
   catch(error){state.withdrawError=redact(error.message);event({type:'interaction-withdraw-failed',error:state.withdrawError});}
  }
  try{await posture(client);}
  catch(error){state.monitorClearError=redact(error.message);event({type:'monitor-clear-failed',error:state.monitorClearError});}
  while(state.phase==='stopping'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
 }finally{
  stopCleanupPending=false;
  finishDaemon();
 }
}
const server=net.createServer(connection=>{
 let data='';connection.setTimeout(45000,()=>connection.destroy());
 connection.on('data',b=>{
  data+=b;if(data.length>100000){connection.destroy();return;}if(!data.includes('\n'))return;
  const line=data.slice(0,data.indexOf('\n'));data='';connection.pause();
  queue=queue.then(async()=>{
   try{
    const message=JSON.parse(line);
    if(message.action==='status'){connection.end(JSON.stringify({ok:true,state})+'\n');return;}
    const client=validateCredentials(message.credentials);await client.identity();
    if(message.action==='command'){
     const commandReplay=launch(message.command);
     if(commandReplay){connection.end(JSON.stringify({ok:true,state,commandReplay})+'\n');return;}
    }
    else if(message.action==='stop')await stop(client);
    else if(message.action!=='tick')throw Error('BRIDGE_ACTION_INVALID');
    const result=message.action==='stop'?state:await tick(message.credentials,message.waitMs);
    connection.end(JSON.stringify({ok:true,state:result})+'\n');
   }catch(e){connection.end(JSON.stringify({ok:false,error:redact(e.message),state})+'\n');}
  });
 });
});
server.listen(socket,()=>{fs.chmodSync(socket,0o600);save();});
process.on('SIGTERM',()=>{pauseClock();state.phase='interrupted';save();child.kill('SIGTERM');server.close();setTimeout(()=>process.exit(0),1000).unref();});
setTimeout(()=>{state.phase='interrupted';state.error='BRIDGE_SESSION_LIFETIME_EXPIRED';save();child.kill('SIGTERM');server.close();setTimeout(()=>process.exit(0),1000).unref();},8*60*60*1000).unref();
save();
