/** Opt-in native compatibility check. No transport/Scout doubles; only the
 * terminal UI is headless. The model endpoint is intentionally unreachable.
 * Run with PI_TEST_HOST_ROOT and PI_TEST_SUBAGENTS_ROOT pointing to installed packages.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import readline from 'node:readline';
import {randomBytes} from 'node:crypto';
import {seal,verify} from '../integrations/paperclip/protocol.mjs';
import {registerHooks} from 'node:module';
import {installSourceLoader} from './load-source.mjs';

test('installed Pi and pi-subagents expose parent boundary and diagnose an actual detached connection failure', {timeout:60000},async t=>{
 const host=process.env.PI_TEST_HOST_ROOT,provider=process.env.PI_TEST_SUBAGENTS_ROOT;
 assert.ok(host&&provider,'Set PI_TEST_HOST_ROOT and PI_TEST_SUBAGENTS_ROOT; native integration is not certified by simulated tests.');
 const root=mkdtempSync(join(tmpdir(),'controlled-native-')),profile=join(root,'profile'),repo=join(root,'repo');
 mkdirSync(profile);mkdirSync(repo);writeFileSync(join(repo,'README.md'),'Native failure probe\n');
 let connectionAttempts=0;
 const failureServer=createServer(socket=>{connectionAttempts++;socket.destroy()});
 await new Promise(resolve=>failureServer.listen(0,'127.0.0.1',resolve));
 t.after(()=>failureServer.close());
 const failureEndpoint='http://127.0.0.1:'+failureServer.address().port+'/v1';
 const names=['PI_CODING_AGENT_DIR','PI_SUBAGENTS_TEMP_ROOT','PI_PACKAGE_DIR'],previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 Object.assign(process.env,{PI_CODING_AGENT_DIR:profile,PI_SUBAGENTS_TEMP_ROOT:join(root,'subagents'),PI_PACKAGE_DIR:resolve(host)});
 let session,scout;
 t.after(async()=>{scout?.close();if(session){await session.abort();await session.extensionRunner.emit({type:'session_shutdown',reason:'exit'});session.dispose()}
  for(const name of names)previous[name]===undefined?delete process.env[name]:process.env[name]=previous[name];rmSync(root,{recursive:true,force:true})});
 // Resolve the installed provider's optional peer packages from the actual host,
 // just as Pi's extension loader does. Do not invent a missing export.
 const sdkUrl=pathToFileURL(join(resolve(host),'dist/core/sdk.js')).href;
 registerHooks({resolve(spec,ctx,next){try{return next(spec,ctx)}catch(error){
  if(error.code==='ERR_MODULE_NOT_FOUND'&&(spec.startsWith('@earendil-works/')||spec==='typebox'||spec.startsWith('typebox/')))return next(spec,{...ctx,parentURL:sdkUrl});throw error;
 }}});installSourceLoader();
 const load=relative=>import(pathToFileURL(join(resolve(host),'dist',relative)).href);
 const {createAgentSession}=await load('core/sdk.js'),{ModelRuntime}=await load('core/model-runtime.js'),{SettingsManager}=await load('core/settings-manager.js'),{DefaultResourceLoader}=await load('core/resource-loader.js'),{SessionManager}=await load('core/session-manager.js');
 const {default:subagents}=await import(pathToFileURL(join(resolve(provider),'index.js')).href),{default:controlled}=await import('../extensions/controlled-dev.ts'),{PreTaskScout}=await import('../src/pre-task-proposal.ts');
 writeFileSync(join(profile,'models.json'),JSON.stringify({providers:{'local-recovery':{baseUrl:failureEndpoint,api:'openai-completions',apiKey:'fixture-only',models:[{id:'fixture',name:'Failure probe',reasoning:false,input:['text'],contextWindow:32768,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}));
 writeFileSync(join(profile,'settings.json'),JSON.stringify({retry:{enabled:false,maxRetries:0,provider:{maxRetries:0,timeoutMs:1000}},packages:[],compaction:{enabled:false},transport:'sse'}));
 let api;const errors=[],replies=[];
 const loader=new DefaultResourceLoader({cwd:repo,agentDir:profile,settingsManager:SettingsManager.create(repo,profile),noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,
  extensionFactories:[subagents,controlled,pi=>{api=pi;pi.events.on('subagents:rpc:v1:request',request=>{pi.events.on('subagents:rpc:v1:reply:'+request.requestId,reply=>{replies.push({method:request.method,success:reply.success,...(!reply.success?{error:reply.error}: {})})})})}]});
 await loader.reload();
 const runtime=await ModelRuntime.create({authPath:join(profile,'auth.json'),modelsPath:join(profile,'models.json'),allowModelNetwork:false}),model=runtime.getModel('local-recovery','fixture');assert.ok(model);
 ({session}=await createAgentSession({cwd:repo,agentDir:profile,modelRuntime:runtime,model,resourceLoader:loader,sessionManager:SessionManager.create(repo,join(root,'sessions')),tools:['read']}));
 await session.bindExtensions({mode:'tui',uiContext:{notify(){},confirm:async()=>false,select:async()=>undefined,editor:async()=>undefined,setWidget(){},setStatus(){},setWorkingMessage(){},setTitle(){},onTerminalInput:()=>()=>{},custom:async()=>undefined},onError:error=>errors.push(error)});
 assert.deepEqual(errors,[]);
 // Exercise the native hook used by a turn woken by a subagent notification.
 const messages=await session.extensionRunner.emitContext([{role:'system',content:'Parent prompt',timestamp:0},{role:'user',content:[{type:'text',text:'Scout failed; no proposal exists.'}],timestamp:0}]);
 assert.match(messages[0].sections['controlled-dev-boundary'],/offer to do the work directly/);
 scout=new PreTaskScout(api.events,session.sessionManager.getSessionId());
 await assert.rejects(scout.propose(repo,'Documentare il progetto'),error=>{
  assert.ok(['PRE_TASK_PROVIDER_CONNECTION_FAILED','PRE_TASK_SCOUT_FAILED'].includes(error.code),JSON.stringify({error:error.message,diagnostic:error.diagnostic,replies}));
  assert.equal(error.diagnostic.terminationVerified,true);
  const messages=readFileSync(error.diagnostic.sessionFile,'utf8').trimEnd().split('\n').map(JSON.parse).filter(row=>row.type==='message'&&row.message?.role==='assistant');
  assert.equal(messages.at(-1)?.message.stopReason,'error');assert.match(messages.at(-1)?.message.errorMessage??'',/^(?:fetch failed|Connection error\.)(?:: .+)?$/);assert.ok(connectionAttempts>0,'The child must reach the refused local connection');return true;
 });
});

for(const blocked of [false,true])test('real Pi SDK worker keeps native status and '+(blocked?'rejects a shutdown error reported by the SDK':'acknowledges orderly shutdown')+' without a model request',{timeout:60000},async t=>{
 const host=process.env.PI_TEST_HOST_ROOT,provider=process.env.PI_TEST_SUBAGENTS_ROOT;
 assert.ok(host&&provider,'Set PI_TEST_HOST_ROOT and PI_TEST_SUBAGENTS_ROOT.');
 const root=mkdtempSync(join(tmpdir(),'paperclip-native-')),profile=join(root,'profile'),repo=join(root,'repo');
 mkdirSync(profile);mkdirSync(repo);writeFileSync(join(repo,'README.md'),'Synthetic native transport probe\n');
 const packages=[fileURLToPath(new URL('../',import.meta.url)),resolve(provider)];
 if(blocked){
  const fixturePackage=join(root,'shutdown-package');mkdirSync(fixturePackage);
  writeFileSync(join(fixturePackage,'package.json'),JSON.stringify({name:'fixture-shutdown',pi:{extensions:['./index.mjs']}}));
  writeFileSync(join(fixturePackage,'index.mjs'),"export default pi=>pi.on('session_shutdown',()=>{throw Error('FIXTURE_SHUTDOWN_BLOCKED')});\n");
  packages.push(fixturePackage);
 }
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{stdio:'pipe'});
 git('init','-q');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');
 writeFileSync(join(profile,'models.json'),JSON.stringify({providers:{'fixture-local':{baseUrl:'http://127.0.0.1:9/v1',api:'openai-completions',apiKey:'fixture-only',models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:32768,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}));
 const key=randomBytes(32).toString('hex'),events=[];
 const child=spawn(process.execPath,[fileURLToPath(new URL('../integrations/paperclip/worker.mjs',import.meta.url))],{cwd:repo,env:{PATH:process.env.PATH,PI_CODING_AGENT_DIR:profile,PI_PACKAGE_DIR:resolve(host)},stdio:['pipe','pipe','pipe']});
 t.after(()=>{child.kill('SIGKILL');rmSync(root,{recursive:true,force:true})});
 let stderr='';child.stderr.on('data',b=>stderr+=b);const exited=once(child,'exit');
 readline.createInterface({input:child.stdout}).on('line',line=>{
  const packet=JSON.parse(line);assert.equal(verify(key,packet),true);const v=packet.value;events.push(v);
  if(v.type==='ready')child.stdin.write(JSON.stringify(seal(key,{type:'command',name:'controlled-dev',args:'status --technical',commandId:'fixture-status'}))+'\n');
  if(v.type==='command-finished'||v.type==='command-failed')child.stdin.write(JSON.stringify(seal(key,{type:'stop'}))+'\n');
 });
 child.stdin.write(JSON.stringify({type:'bootstrap',key,config:{sdkEntry:join(resolve(host),'dist/index.js'),profile:'sviluppo',sessionDirectory:join(root,'sessions'),packages,model:{provider:'fixture-local',id:'fixture'}}})+'\n');
 const [code,signal]=await exited;assert.equal(signal,null,stderr);assert.equal(code,blocked?1:0,stderr);
 const ready=events.find(e=>e.type==='ready');assert.deepEqual(ready.model,{provider:'fixture-local',id:'fixture'});assert.deepEqual(ready.commands,['controlled-dev']);
 assert.equal(events.some(e=>['command-failed','human-request'].includes(e.type)),false,JSON.stringify(events));
 const status=events.find(e=>e.type==='command-finished');assert.equal(status.nativeStatus.completed,false);assert.equal(status.nativeStatus.integrationNotInferred,true);
 const technical=events.filter(e=>e.type==='notice').map(e=>{try{return JSON.parse(e.text)}catch{return null}}).find(e=>e?.hostCommand==='controlled-dev');
 assert.equal(technical.mode,'external-human');assert.equal(technical.sessionBound,true);assert.equal(technical.runtimeAvailable,true);
 assert.equal(events.at(-1).type,blocked?'stop-failed':'stopped');
 if(blocked){assert.match(events.at(-1).error,/FIXTURE_SHUTDOWN_BLOCKED/);assert.equal(events.some(e=>e.type==='runtime-error'&&e.error==='FIXTURE_SHUTDOWN_BLOCKED'),true)}
 else assert.equal(events.at(-1).clean,true);
});
