import test from 'node:test';
import assert from 'node:assert/strict';
import {runPhotobookConversation} from '../integrations/paperclip/conversation.mjs';
function fixture(){
 let listener;const messages=[],prompts=[],events=[];let removed=false,aborted=false;
 const session={messages,subscribe(fn){listener=fn;return()=>{removed=true}},async prompt(text,options){prompts.push({text,options});listener({type:'tool_execution_start',toolName:'photobook_factory',toolCallId:'tool-'+prompts.length});listener({type:'tool_execution_end',toolName:'photobook_factory',toolCallId:'tool-'+prompts.length,isError:false});messages.push({role:'assistant',stopReason:'stop',content:[{type:'text',text:'Exact native presentation '+prompts.length}]})},async waitForIdle(){},async abort(){aborted=true}};
 return {session,prompts,events,get removed(){return removed},get aborted(){return aborted}};
}
test('photobook follows real session turn boundaries and presents full native text before a user continuation (synthetic session)',async()=>{
 const f=fixture(),questions=[];
 const result=await runPhotobookConversation({session:f.session,initial:'Original author request',maxTurns:2,ask:async q=>{questions.push(q);return {value:'Actual test reply'}},makeRequest:(kind,title,display)=>({kind,title,display}),emit:v=>f.events.push(v)});
 assert.equal(f.prompts[0].text,'Original author request');assert.equal(f.prompts[1].text,'Actual test reply');assert.equal(f.prompts[1].options.expandPromptTemplates,false);
 assert.deepEqual(questions.map(q=>q.display),['Exact native presentation 1']);assert.equal(result.nativeCompletionNotInferred,true);assert.equal(result.needsNewMandate,true);assert.equal(f.removed,true);
 assert.deepEqual(f.events.filter(v=>v.type==='native-tool-start').map(v=>v.toolName),['photobook_factory','photobook_factory']);
});
test('cancellation, failed native turns and tool budget cannot be reported as completed photographic work',async()=>{
 for(const mode of ['cancel','error','budget']){
  const f=fixture();
  if(mode==='error')f.session.prompt=async()=>{f.session.messages.push({role:'assistant',stopReason:'error',content:[]})};
  await assert.rejects(runPhotobookConversation({session:f.session,initial:'Read-only pilot',maxToolCalls:mode==='budget'?1:120,maxTurns:2,
   ask:async()=>mode==='cancel'?{cancelled:true}:{value:'Continue'},makeRequest:(kind,title,display)=>({kind,title,display}),emit:()=>{}}),/CANCELLED|INCOMPLETE|BUDGET_EXHAUSTED/);
  assert.equal(f.removed,true);if(mode==='budget')assert.equal(f.aborted,true);
 }
});
