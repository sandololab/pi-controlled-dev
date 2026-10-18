import assert from 'node:assert/strict';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {api} from './candidate-promotion-fixture.mjs';
const {REVIEWER_RUNTIME_DEFINITION}=await import('../src/controlled-reviewer.ts');
export class Bus{
  listeners=new Map();tools=['read','structured_output'];mode='PASS';
  constructor(root,work){this.root=root;this.work=work}
  on(name,fn){const set=this.listeners.get(name)??new Set();set.add(fn);this.listeners.set(name,set);return()=>set.delete(fn)}
  emit(name,q){
    if(name==='pi-subagents:runtime-agent-register:v1'){assert.equal(q.name,'controlled.reviewer');assert.deepEqual(q.definition,REVIEWER_RUNTIME_DEFINITION);q.result={ok:true,registration:{dispose(){}}};return}
    if(name!=='subagents:rpc:v1:request'){for(const fn of this.listeners.get(name)??[])fn(q);return}
    let value;
    if(q.method==='ping')value={version:1,methods:['ping','spawn','status','interrupt','stop','resume'],session:{sessionId:'owner',sessionFile:null},events:{asyncComplete:'subagent:async-complete'},capabilities:{asyncSpawn:true,status:true,interrupt:true,stop:true,resume:true,processTerminalProof:{version:1,lifecycleArtifactVersion:3}}};
    else if(q.method==='spawn'){
      this.task=q.params.task;assert.equal(q.params.agent,'controlled.reviewer');assert.equal(q.params.cwd,this.work??q.params.cwd);assert.equal(q.params.context,'fresh');
      this.work??=q.params.cwd;const packet=JSON.parse(q.params.task.split('PACKET=')[1].split('\n')[0]),packetDigest=api.hashCanonical(packet);this.packet=packet;
      this.output={packetDigest,verdict:this.mode==='FAIL'?'FAIL':'PASS',reason:'Declared provider review double',criteria:packet.criteria.map(c=>({criterionId:c.id,status:this.mode==='FAIL'?'FAIL':'PASS',reason:'Observed fixture criterion'}))};
      if(this.mode==='WRONG_BINDING')this.output.packetDigest='0'.repeat(64);
      if(this.mode==='MISSING_CRITERION')this.output.criteria=[];
      if(this.mode==='EXTRA_AUTHORITY')this.output.approved=true;
      this.session=join(this.root,'review-session.jsonl');writeFileSync(this.session,[{type:'session',cwd:this.work},{type:'message',message:{role:'system',sections:{preamble:'<active_agent name="controlled.reviewer"/>'},toolsAdded:this.tools.map(name=>({name}))}},{type:'message',message:{role:'assistant',content:[{type:'toolCall',name:'read'}]}}].map(JSON.stringify).join('\n'));
      value={details:{asyncId:'integration-review-run',runId:'integration-review-run'}};
    }else value={details:{lifecycleStatus:{processTerminal:{version:1,state:'observed',runId:'integration-review-run',runnerProcessInstanceId:'fixture-instance',observedAt:1,instances:[{kind:'runner',processInstanceId:'fixture-instance',closeObservedAt:1,exitCode:0,signal:null}],resumeDisposition:'resumable'}}},asyncSnapshot:{version:1,kind:'pi-subagents.async-status-snapshot',runs:[{id:'integration-review-run',state:'complete'}]}};
    this.emit(`subagents:rpc:v1:reply:${q.requestId}`,{version:1,requestId:q.requestId,success:true,data:value});
    if(q.method==='spawn'){this.mutate?.();this.emit('subagent:async-complete',{id:'integration-review-run',runId:'integration-review-run',sessionId:'owner',state:'complete',success:true,exitCode:0,
      results:[{agent:'controlled.reviewer',context:'fresh',sessionFile:this.session,status:'completed',success:true,structuredOutput:this.output,launchResolvedExtensions:{version:1,source:'launch-resolved',disableAmbientExtensions:true,configured:[],required:[],runtime:['structured-output'],effective:['structured-output']}}]})}
  }
}
