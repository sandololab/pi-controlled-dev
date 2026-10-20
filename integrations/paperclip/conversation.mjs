/** Native Pi conversation, not a substitute for a domain approval receipt. */
export async function runPhotobookConversation({session,initial,ask,makeRequest,emit,maxTurns=4,maxToolCalls=120}){
 if(!Number.isInteger(maxTurns)||maxTurns<1||maxTurns>8||!Number.isInteger(maxToolCalls)||maxToolCalls<1||maxToolCalls>200)throw Error('BRIDGE_CONVERSATION_BUDGET_INVALID');
 let tools=0,text=initial;
 const unsubscribe=session.subscribe(event=>{
  if(event.type==='tool_execution_start'){
   tools++;emit({type:'native-tool-start',toolName:event.toolName,toolCallId:event.toolCallId});
   if(tools>maxToolCalls)void session.abort();
  }else if(event.type==='tool_execution_end')emit({type:'native-tool-end',toolName:event.toolName,toolCallId:event.toolCallId,isError:event.isError===true});
 });
 try{
  for(let turn=0;turn<maxTurns;turn++){
   const before=session.messages.length;
   await session.prompt(text,{source:'rpc',expandPromptTemplates:false});await session.waitForIdle();
   if(tools>maxToolCalls)throw Error('BRIDGE_TOOL_BUDGET_EXHAUSTED');
   const last=session.messages.slice(before).findLast(m=>m.role==='assistant');
   if(!last||last.stopReason==='error'||last.stopReason==='aborted')throw Error('BRIDGE_NATIVE_TURN_INCOMPLETE');
   const display=last.content.filter(c=>c.type==='text').map(c=>c.text).join('\n\n');
   if(!display.trim())throw Error('BRIDGE_NATIVE_RESPONSE_EMPTY');
   emit({type:'native-turn-finished',turn:turn+1,tools,nativeCompletionNotInferred:true});
   if(turn===maxTurns-1){emit({type:'notice',text:display,level:'info'});return {turns:turn+1,tools,needsNewMandate:true,nativeCompletionNotInferred:true};}
   // This is the author's next conversational input, never an integration/approval receipt.
   const response=await ask(makeRequest('editor','Redazione Pi — esamina il risultato e rispondi',display));
   if(response.cancelled)throw Error('BRIDGE_HUMAN_REQUEST_CANCELLED');
   text=response.value;
   if(typeof text!=='string'||!text.trim())throw Error('BRIDGE_EMPTY_CONVERSATION_REPLY');
  }
 }finally{unsubscribe();}
}
