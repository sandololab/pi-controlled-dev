import { hasHumanChannel } from './external-human-channel.js';
import { resolve } from 'node:path';
import { chooseAction, errorPresentation } from './controlled-ui.js';
import { validateSourceLocation, validateDestinationLocation } from './source-project.js';
import { showProjectPlanning } from './project-planning-ui.js';
import { rebuildProjectPlanningView } from './human-repository.js';
import type { ProductionCommandContext } from './production-bridge.js';
import type { SourceProject, SourceProjectProposal } from './source-project.js';
import type { PreTaskScout } from './pre-task-proposal.js';
import type { ProjectPlanningRepository, PlannedTaskSeed } from './project-planning-repository.js';
declare const process:{readonly env:Readonly<Record<string,string|undefined>>};
export const REFACTORING_OBJECTIVE="Refactor all existing code: reduce duplication and complexity, improve separation of responsibilities and readability, while preserving public APIs and behavior.";
export function projectLocation(cwd:string,value:string):string {
 const path=value.trim();if(!path||path.includes('\0'))throw new Error('SOURCE_IMPORT_PATH_UNSAFE');
 return resolve(cwd,path.startsWith('~/')?resolve(process.env.HOME??'',path.slice(2)):path);
}
/** Import is followed by normal plan review and task formulation in the selected project. */
export async function showSourceProject(ctx:ProductionCommandContext,scout:PreTaskScout|undefined,
 factory:(source:string,target:string)=>SourceProject,planningFor:(root:string)=>ProjectPlanningRepository,
 selected:(root:string)=>void,start:(root:string,seed:PlannedTaskSeed,planning:ProjectPlanningRepository)=>Promise<void>,prefill:{source?:string;objective?:string}={}):Promise<void> {
 if(!hasHumanChannel(ctx)||!ctx.sessionManager.getSessionId()||!ctx.ui.editor||!ctx.ui.select)throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
 if(!scout)throw new Error('PRE_TASK_SCOUT_UNAVAILABLE');
 const session=ctx.sessionManager.getSessionId(),check=()=>{if(!hasHumanChannel(ctx)||ctx.sessionManager.getSessionId()!==session)throw new Error('HUMAN_CHANNEL_UNAVAILABLE')};
 const input=async(question:string,why:string,step:number,prefill='')=>{
  const value=ctx.ui.wizardInput?await ctx.ui.wizardInput(`Questions (${step}/3)`,prefill,{step,total:3,section:"Start from existing code",question,why}):await ctx.ui.editor!(question,prefill);check();return value;
 };
 const location=async(question:string,why:string,step:number,validate:(path:string)=>void,initial='')=>{
  let previous=initial;
  while(true){const value=await input(question,why,step,previous);if(!value?.trim())return;previous=value;
   try{const path=projectLocation(ctx.cwd,value);validate(path);return path}catch(error){
    const code=(error as {code?:string}).code;if(!['SOURCE_IMPORT_SOURCE_MISSING','SOURCE_IMPORT_PARENT_MISSING','SOURCE_IMPORT_PATH_UNSAFE'].includes(code??''))throw error;
    ctx.ui.notify(errorPresentation(error).message,'warning');
   }
  }
 };
 const source=await location("Which code folder do you want to start from?","You may choose existing sources even without Git, to complete the project, add features, fix problems or refactor. Work will use a separate copy.",1,validateSourceLocation,prefill.source);if(!source)return;
 const target=await location("Where do you want to create the project's working copy?","Choose a new, nonexistent folder with an existing parent, outside the sources and other Git repositories.",2,validateDestinationLocation);if(!target)return;
 const objectiveInput=await input("What do you want to build from this code?","Describe the result and constraints freely: continue development, add a feature, fix a bug or refactor. The plan will address the requested work.",3,prefill.objective??'');if(!objectiveInput?.trim())return;
 const host=factory(source,target);let proposal:SourceProjectProposal;
 try{proposal=host.propose(objectiveInput.trim())}catch(error){
  if((error as {code?:string}).code!=='GIT_IDENTITY_REQUIRED')throw error;
  ctx.ui.notify("The new project requires a name and email for commits. Enter them here: they will appear in the summary and be saved only in the new project after confirmation.",'info');
  const identityInput=async(question:string,step:number)=>{
   const value=ctx.ui.wizardInput?await ctx.ui.wizardInput(`Git identity (${step}/2)`,'',{step,total:2,section:"Commit identity",question,why:"These details identify the commit author. Global configuration and original sources remain unchanged."}):await ctx.ui.editor!(question,'');check();return value?.trim();
  };
  while(true){
   const name=await identityInput("Which name do you want to use as the commit author?",1);if(!name)return;
   const email=await identityInput("What email do you want to use for this project's commits?",2);if(!email)return;
   try{proposal=host.propose(objectiveInput.trim(),{name,email});break}catch(error){
    if((error as {code?:string}).code!=='GIT_IDENTITY_INVALID')throw error;
    ctx.ui.notify(errorPresentation(error).message,'warning');
   }
  }
 }
 const choice=await chooseAction(ctx.ui,"Review the project",host.narrative(proposal),["Create the project","Back"]);check();if(choice!=="Create the project")return;
 const root=await host.approve(ctx,proposal);check();if(!root)return;
 let autonomyStarted=false;
 selected(root);const projectCtx={...ctx,cwd:root,...(ctx.onAutonomyApproved?{onAutonomyApproved:async(id:string)=>{autonomyStarted=true;await ctx.onAutonomyApproved!(id)}}:{})},planning=planningFor(root);
 planning.createGoal(proposal.objective);
 rebuildProjectPlanningView(planning);
 ctx.ui.notify(`Project created and opened from existing code\nFolder: ${root}\nImported sources: ${proposal.fileCount} files\nNext step: analysis and a plan for your objective.`,'info');
 await showProjectPlanning(projectCtx,planning,scout,planning.options.memory,'plan',seed=>start(root,seed,planning));check();
 // Autonomy starts through its existing exact policy callback. Supervised execution
 // offers the next explicit task selection immediately, without another slash command.
 if(!autonomyStarted&&planning.current()&&planning.progress().some(t=>t.status==='READY')){
  const action=await chooseAction(ctx.ui,"Continue the project","The plan is approved. You may prepare and start a ready task with the normal confirmations.",["Prepare and start a ready task","Back to project"]);check();
  if(action==="Prepare and start a ready task")await showProjectPlanning(projectCtx,planning,scout,planning.options.memory,'start',seed=>start(root,seed,planning));
 }
}
