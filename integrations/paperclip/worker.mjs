import readline from 'node:readline';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {digest,seal,verify,redact} from './protocol.mjs';
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
const incoming=[],waiters=[];lines.on('line',line=>{try{const v=JSON.parse(line);const next=waiters.shift();next?next(v):incoming.push(v);}catch{process.exit(2);}});
const next=()=>incoming.length?Promise.resolve(incoming.shift()):new Promise(r=>waiters.push(r));
const bootstrap=await next();if(bootstrap.type!=='bootstrap'||!bootstrap.key)throw Error('BRIDGE_BOOTSTRAP_REQUIRED');
const key=bootstrap.key,config=bootstrap.config;
const emit=value=>process.stdout.write(JSON.stringify(seal(key,value))+'\n');
const pending=new Map();let session,context,commandBusy=false,alive=true;
const notifications=[];
function ask(request){
 if(pending.size)throw Error('BRIDGE_PARALLEL_HUMAN_REQUEST');
 return new Promise((resolve,reject)=>{pending.set(request.requestId,{request,resolve,reject});emit({type:'human-request',request});});
}
function request(kind,title,display,options){
 if(typeof title!=='string'||typeof display!=='string'||Buffer.byteLength(title+display)>65536)throw Error('BRIDGE_PRESENTATION_LIMIT');
 const material={version:1,requestId:randomUUID(),sessionId:context.sessionManager.getSessionId(),title:title.split('\n')[0].trim().slice(0,180),display,...(options?{options}:{})};
 return {...material,kind,digest:digest(material)};
}
const ui={
 notify(text,level='info'){const v={text:redact(text),level};notifications.push(v);if(notifications.length>100)notifications.shift();emit({type:'notice',...v});},
 async confirm(title,display){const q=request('confirm',title,display);const answer=await ask(q);return answer.accepted===true;},
 async select(title,options){if(!Array.isArray(options)||!options.length||options.length>128)throw Error('BRIDGE_OPTIONS_LIMIT');const q=request('select',title,title,options);return (await ask(q)).value;},
 async editor(title,prefill=''){const q=request('editor',title,title+(prefill?'\n\nTesto di partenza:\n'+prefill:''));return (await ask(q)).value;},
 async input(title,prefill=''){return this.editor(title,prefill);},
 setStatus(){},setWidget(){},setWorkingMessage(){},setTitle(){},setFooter(){},setHeader(){},
 setTheme(){return {success:false,error:'Headless host'};},getEditorText(){return '';},setEditorText(){},
};
const sdk=await import(pathToFileURL(config.sdkEntry).href);
const settingsManager=config.packages?sdk.SettingsManager.inMemory({defaultProvider:config.model.provider,defaultModel:config.model.id,packages:config.packages}):undefined;
const bus=sdk.createEventBus(),loader=new sdk.DefaultResourceLoader({cwd:process.cwd(),agentDir:process.env.PI_CODING_AGENT_DIR,...(settingsManager?{settingsManager}:{}),eventBus:bus,noContextFiles:true});
await loader.reload();const loaded=loader.getExtensions();if(loaded.errors.length)throw Error('BRIDGE_EXTENSION_LOAD_FAILED: '+loaded.errors.map(e=>e.error).join(';'));
({session}=await sdk.createAgentSession({cwd:process.cwd(),...(settingsManager?{settingsManager}:{}),resourceLoader:loader,sessionManager:sdk.SessionManager.create(process.cwd(),config.sessionDirectory)}));
await session.bindExtensions({mode:'rpc',uiContext:ui,onError:e=>emit({type:'runtime-error',error:redact(e.error)})});
if(session.model?.provider!==config.model.provider||session.model?.id!==config.model.id)throw Error('BRIDGE_MODEL_MISMATCH');
const actual=session.extensionRunner.createCommandContext();
context={...actual,ui,hasUI:true,mode:'external-human'};
if(config.profile==='sviluppo'){
 const q={context,confirm:async native=>{
  const reply=await ask({...native,kind:'confirm'});
  return {accepted:reply.accepted===true,requestDigest:reply.requestDigest,provider:reply.provider,interactionId:reply.interactionId,actorUserId:reply.actorUserId};
 }};
 bus.emit('controlled-dev:human-host-context:v1',q);
 if(!q.result)throw Error('BRIDGE_NATIVE_EXTERNAL_CHANNEL_UNAVAILABLE');context=q.result;
}
const allowed=config.profile==='sviluppo'?['controlled-dev']:['editorial','photobook'];
const commands=new Map(loaded.extensions.flatMap(e=>[...e.commands.entries()]));
emit({type:'ready',model:session.model?{provider:session.model.provider,id:session.model.id}:null,tools:session.getActiveToolNames(),commands:allowed});
async function execute(message){
 if(commandBusy)throw Error('BRIDGE_COMMAND_BUSY');
 if(!allowed.includes(message.name)||typeof message.args!=='string'||message.args.length>20000)throw Error('BRIDGE_COMMAND_INVALID');
 if(config.profile==='redazione'&&message.name==='editorial'&&!/^(create|revise|workspace-(?:status|resume|decide|retry|preview|brief))\b/.test(message.args))throw Error('BRIDGE_LEGACY_EDITORIAL_COMMAND_UNSUPPORTED');
 const handler=commands.get(message.name)?.handler;if(!handler)throw Error('BRIDGE_COMMAND_UNAVAILABLE');
 commandBusy=true;emit({type:'command-start',commandId:message.commandId});
 try{await handler(message.args,context);let nativeStatus=null;
  if(config.profile==='sviluppo'){const q={sessionId:context.sessionManager.getSessionId()};bus.emit('controlled-dev:human-host-status:v1',q);nativeStatus=q.result??null;}
  emit({type:'command-finished',commandId:message.commandId,notifications:[...notifications],nativeStatus,nativeCompletionNotInferred:true});}
 catch(e){emit({type:'command-failed',commandId:message.commandId,error:redact(e.message)});}
 finally{commandBusy=false;}
}
while(alive){
 const packet=await next();if(!verify(key,packet)){emit({type:'protocol-error',error:'BRIDGE_BAD_SIGNATURE'});continue;}
 const message=packet.value;
 if(message.type==='human-response'){
  const held=pending.get(message.requestId);if(!held||message.requestDigest!==held.request.digest){emit({type:'protocol-error',error:'BRIDGE_RESPONSE_BINDING'});continue;}
  pending.delete(message.requestId);
  if(message.cancelled)held.reject(Error('BRIDGE_HUMAN_REQUEST_CANCELLED'));else held.resolve(message);
 }else if(message.type==='command')execute(message).catch(e=>emit({type:'command-failed',error:redact(e.message)}));
 else if(message.type==='stop'){alive=false;for(const q of pending.values())q.reject(Error('BRIDGE_STOPPED'));await session.abort();session.dispose();context.disposeHumanChannel?.();lines.close();process.exit(0);}
}

