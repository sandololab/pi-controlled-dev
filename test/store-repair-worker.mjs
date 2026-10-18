import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {recoveryFixture} from './recovery-fixture.mjs';
const {repairStore,classifyStore}=await import('../src/store-repair.ts');
const {hashBytes}=await import('../src/contracts.ts');
const [mode,root,point]=process.argv.slice(2),data=join(root,'data'),repo=join(root,'repo');
const store=join(data,'controlled-dev','projects',hashBytes(Buffer.from(repo)),'tasks','task');
if(mode==='crash-owner'){
  const original=fs.fsyncSync;let wal=0;
  fs.fsyncSync=fd=>{const isWal=fs.readlinkSync(`/proc/self/fd/${fd}`).endsWith('/events.jsonl');original(fd);
    if(isWal&&++wal===2&&['wal','terminal-wal'].includes(point))process.kill(process.pid,'SIGKILL')};syncBuiltinESMExports();
  const f=recoveryFixture(root,point==='intent'?'ANALYZING':'BLOCKED',point==='intent'?'INTENT':point==='terminal-wal'?'TERMINAL':'NONE');
  if(point==='intent'){
    // Real external process, deterministic effect double; deliberately no durable outcome binding.
    const child=spawnSync(process.execPath,['-e','require("node:fs").writeFileSync(process.argv[1],"once")',join(root,'effect')]);
    if(child.status!==0)throw new Error('External worker failed');process.kill(process.pid,'SIGKILL');
  }
  console.log(JSON.stringify({data,storeRoot:f.storeRoot}));
}else if(mode==='reclaim-crash'){
  const {recoverLocks}=await import('../src/recovery.ts');
  console.log(JSON.stringify(recoverLocks(data,store,p=>{if(p===point)process.kill(process.pid,'SIGKILL')})));
}else if(mode==='repair'){
  try{console.log(JSON.stringify(repairStore(data,store,p=>{if(p===point)process.kill(process.pid,'SIGKILL')})))}
  catch(error){console.log(JSON.stringify({denied:error.message,status:classifyStore(data,store)}))}
}else if(mode==='command'){
  process.env.PI_CODING_AGENT_DIR=data;
  const {default:extension}=await import('../extensions/controlled-dev.ts');
  const handlers=new Map(),commands=new Map(),notifications=[];let rpcCalls=0,confirmations=0;
  const ctx={mode:'tui',cwd:repo,sessionManager:{getSessionId:()=> 'repair-successor'},ui:{notify(m){notifications.push(m)},async confirm(){confirmations++;return true}}};
  extension({events:{on(){return()=>{}},emit(name,r){if(name==='pi-subagents:runtime-agent-register:v1')r.result={ok:true,registration:{dispose(){}}};else rpcCalls++}},
    on(n,fn){handlers.set(n,[...(handlers.get(n)??[]),fn]);return()=>{}},registerCommand(n,v){commands.set(n,v)},
    getAllTools:()=>[{name:'read',sourceInfo:{source:'builtin',path:'<builtin:read>'}}],setActiveTools(){}});
  for(const fn of handlers.get('session_start'))fn({},ctx);
  let denied;try{await commands.get('controlled-dev').handler(point??'repair',ctx)}catch(e){denied=e.message}
  await commands.get('controlled-dev').handler('status --technical',ctx);
  const details=JSON.parse(notifications.at(-1));denied??=details.lastFailure?.code;
  console.log(JSON.stringify({denied,notifications,rpcCalls,confirmations,status:classifyStore(data,store)}));
}
