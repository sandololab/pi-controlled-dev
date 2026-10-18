import { chooseAction } from './controlled-ui.js';
import type { ControlledUI } from './controlled-ui.js';
import type { HumanConfirmationChannel } from './trusted-confirmation.js';
import type { ProjectMemoryRepository } from './project-memory-repository.js';
import { currentMemory, memoryPresentation } from './project-memory.js';
import type { MemoryStatus } from './project-memory.js';
import { rebuildProjectMemoryView } from './human-repository.js';

/** Native human host action only. No agent tool, candidate writes or task-state changes. */
export async function showProjectMemory(ctx:HumanConfirmationChannel&{ui:ControlledUI},repo:ProjectMemoryRepository|undefined):Promise<void>{
  if(ctx.mode!=='tui'||!ctx.sessionManager.getSessionId())throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  if(!repo){ctx.ui.notify("There are no project memories yet. Technical proposals are collected during tasks and require a separate decision before becoming current.",'info');return}
  const entries=repo.entries(),choices=entries.map(e=>`${e.record.title.slice(0,120)} — ${e.record.status} (${e.record.recordId})`);
  if(!choices.length){ctx.ui.notify("There are no memory proposals to examine yet.",'info');return}
  const selected=await chooseAction(ctx.ui,"Project technical memory","Choose a memory to read its meaning, scope and evidence.",choices);
  if(!selected)return;const entry=entries[choices.indexOf(selected)],record=entry.record;
  const targets:Record<string,MemoryStatus>={};
  if(record.status==='PROPOSED'||record.status==='UNVERIFIED'){
    targets[record.recordKind==='software-adr'?"Accept the decision":"Activate the memory"]=record.recordKind==='software-adr'?'ACCEPTED':'ACTIVE';
    targets["Do not adopt this proposal"]=record.recordKind==='software-adr'?'DEPRECATED':'RETIRED';
  }else if(currentMemory(record))targets[record.recordKind==='software-adr'?"Declare no longer applicable":"Retire the memory"]=record.recordKind==='software-adr'?'DEPRECATED':'RETIRED';
  const replacements=entries.filter(e=>e.record.recordKind===record.recordKind&&currentMemory(e.record)&&e.record.recordId!==record.recordId);
  const actions=[...Object.keys(targets),...(replacements.length&&(record.status==='PROPOSED'||record.status==='UNVERIFIED')?["Accept and replace a current memory"]:[]),"Regenerate notes","Back"];
  const action=await chooseAction(ctx.ui,record.title,memoryPresentation(record)+(entry.staleEvidence.length?"\n\nLinked evidence requires verification again. A lesson with stale evidence is not loaded as current advice.":''),actions);
  if(!action||action==="Back")return;
  if(action==="Regenerate notes"){rebuildProjectMemoryView(repo);ctx.ui.notify("Memory notes were regenerated from structured data. Personal notes are preserved.",'info');return}
  let supersedes:string|undefined,target=targets[action];
  if(action==="Accept and replace a current memory"){
    const labels=replacements.map(e=>`${e.record.title.slice(0,120)} (${e.record.recordId})`);
    const old=await chooseAction(ctx.ui,"Which memory is being replaced?","The next confirmation will present both changes and preserve history.",labels);
    if(!old)return;supersedes=replacements[labels.indexOf(old)].record.recordId;target=record.recordKind==='software-adr'?'ACCEPTED':'ACTIVE';
  }
  const changed=await repo.decide(ctx,record.recordId,target,supersedes);
  if(changed){rebuildProjectMemoryView(repo);ctx.ui.notify("Memory decision recorded. This confirmation does not authorize code or task changes.",'info')}
  else ctx.ui.notify("Decision canceled: no memory activated or accepted.",'info');
}
