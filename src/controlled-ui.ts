import { setTimeout, clearTimeout } from 'node:timers';

export type CustomUI = <T>(factory:(tui:{requestRender():void;terminal?:{rows:number}},theme:unknown,keys:{matches(data:string,action:string):boolean}|null,done:(value:T)=>void)=>{
  render(width:number):string[];handleInput(data:string):void;invalidate():void;dispose?():void;
})=>Promise<T>;
export interface ControlledUI {
  notify(message:string,type?:'info'|'warning'|'error'):void;
  confirm(title:string,message:string,options?:{timeout?:number}):Promise<boolean>;
  input?(title:string,placeholder?:string):Promise<string|undefined>;
  editor?(title:string,prefill?:string):Promise<string|undefined>;
  select?(title:string,options:string[]):Promise<string|undefined>;
  custom?:CustomUI;
  readPlanSnapshot?():Readonly<{summary:string;points:readonly {title:string;detail:string}[]}>|Promise<Readonly<{summary:string;points:readonly {title:string;detail:string}[]}>>;
  wizardInput?(title:string,prefill:string,presentation:WizardPresentation):Promise<string|undefined>;
  wizardTextWidth?(text:string):number;
  setWidget?(key:string,content:string[]|((tui:{requestRender():void;terminal?:{rows:number}},theme:unknown)=>{render(width:number):string[];invalidate():void})|undefined):void;
  setStatus?(key:string,value:string|undefined):void;
}
// Pi creates fresh UI functions for command and shortcut contexts. An explicit
// session scope lets those contexts share one viewport and modal queue.
const readingPanels = new WeakMap<CustomUI,number>();
const progressFrames = new WeakMap<object,{redraw:()=>void}[]>();
interface PanelQueue {custom:CustomUI;enqueue:<R>(work:()=>Promise<R>)=>Promise<R>;methods:WeakMap<object,object>}
const serializedPanels = new WeakMap<CustomUI,PanelQueue>();
const sessionPanels = new WeakMap<object,PanelQueue>();
/** Concurrent read-only commands share the native viewport with workflow gates.
 * Queue complete panels; never replace a confirmation the operator is reading. */
export function serializeControlledPanels<T extends ControlledUI>(ui:T,sessionScope?:object):T {
  const native=ui.custom;if(!native)return ui;
  let queue=sessionScope?sessionPanels.get(sessionScope):serializedPanels.get(native);
  if(!queue){
    let tail:Promise<unknown>=Promise.resolve();
    const enqueue=<R>(work:()=>Promise<R>):Promise<R>=>{
      const next=tail.then(work);
      tail=next.catch(()=>undefined);return next;
    };
    const custom:CustomUI=<R>(factory:Parameters<CustomUI>[0])=>enqueue(()=>native.call(ui,factory) as Promise<R>);
    queue={custom,enqueue,methods:new WeakMap()};
    serializedPanels.set(native,queue);serializedPanels.set(custom,queue);
  }
  if(sessionScope)sessionPanels.set(sessionScope,queue);
  const adapter={...ui,custom:queue.custom};
  for(const key of ['editor','select','input','confirm'] as const){
    const method=ui[key];if(typeof method!=='function')continue;
    let queued=queue.methods.get(method);
    if(!queued){const invoke=method as (...args:unknown[])=>Promise<unknown>;
      const current=queue;queued=(...args:unknown[])=>current.enqueue(()=>invoke.apply(ui,args));
      queue.methods.set(method,queued);queue.methods.set(queued,queued);}
    Object.assign(adapter,{[key]:queued});
  }
  return adapter;
}
/** Repository and provider text is display data, never terminal control. */
export function safeText(value:string):string {
  return value.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,'').replace(/[\u202a-\u202e\u2066-\u2069]/g,'');
}
/** Conservative width bound: non-ASCII is charged two columns, including emoji. */
export function displayLines(lines:readonly string[],width:number):string[] {
  const limit=Math.max(1,Math.floor(width));
  return lines.flatMap(line=>safeText(line).split('\n')).flatMap(line=>{
    const out:string[]=[];let row='',used=0;
    for(const char of line.replace(/\t/g,'  ')){
      const size=char.codePointAt(0)!>126?2:1;
      if(size>limit){if(row)out.push(row);out.push('?');row='';used=0;continue}
      if(used+size>limit){
        const space=row.lastIndexOf(' ');
        if(space>0&&row.slice(0,space).trim()){
          out.push(row.slice(0,space));row=row.slice(space+1);
          used=[...row].reduce((n,c)=>n+(c.codePointAt(0)!>126?2:1),0);
        }else{out.push(row);row='';used=0}
      }row+=char;used+=size;
    }
    out.push(row);return out;
  });
}
export function errorPresentation(error:unknown):{message:string;code:string;path?:string;diagnostic?:{phase:string;path:string}} {
  const raw=error instanceof Error?error.message:'';
  const code=(error as {code?:string})?.code?.match(/^[A-Z][A-Z0-9_]{1,90}$/)?.[0]??raw.match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/)?.[0]??'CONTROLLED_ACTION_FAILED';
  const known:Record<string,string>={
    HOST_COMMAND_TERMINATION_UNPROVEN:"A previous check has no verified end record. Work remains saved and protected. Check the host-command details before resuming; no new check or agent has started.",
    HOST_COMMAND_SUPERVISION_UNAVAILABLE:"This computer cannot provide the process supervision required for the approved checks. Work remains stopped. Check local process visibility before retrying.",
    HOST_COMMAND_BUSY:"An approved check is already running for this task. Open Status and wait for its result before starting another check.",
    HOST_COMMAND_ASYNC_REQUIRED:"This task uses supervised checks. Continue through the normal validation action so progress and completion remain recorded. No new command has started.",
    PROJECT_RESULT_SAVE_FAILED:"The agent has finished, but saving its candidate files failed. Keep the working copy and protective permissions. Use /controlled-dev checkpoint in this session to retry saving the same result. No new agent is needed; incomplete or corrupt storage still requires repair.",
    PROJECT_CHECKPOINT_SAVE_FAILED:"Saved task data is preserved, but its portable checkpoint could not be completed. Keep the working copy and protective permissions. Use /controlled-dev checkpoint to retry saving; no agent will be started.",
    INVALID_REVIEW_PACKET:"Independent review has not started: the saved review data failed a consistency check. The candidate is preserved. Check the indicated field before retrying; implementation does not need to be repeated.",
    CANDIDATE_STORAGE_CLOSE_REQUIRED:"Close Pi normally at a safe point and reopen it before reducing saved copies. This maintenance requires a released project with no active task controller.",
    CANDIDATE_STORAGE_CHANGED:"Saved copies changed during the storage proposal. No cleanup was authorized. Preserve the files and request an updated proposal.",
    CANDIDATE_STORAGE_LIMIT:"The saved copies exceed this maintenance step's verified size limit. No cleanup was authorized. Preserve the copies and review the storage inventory.",
    CANDIDATE_STORAGE_PATH_INVALID:"A saved-copy path cannot be verified. Storage reduction remains stopped and preserves the copies.",
    CANDIDATE_STORAGE_BUSY:"A storage reduction is already running. Use Alt+I to request a pause after the current file.",
    PROJECT_HANDOFF_ROLE_NOT_QUIESCENT:"A previous agent has not been confirmed as terminated. The move remains stopped and preserves the data. Check task status before resuming.",
    PROJECT_HANDOFF_SOURCE_CHANGED:"Project data changed during the move. Work is preserved: review the status before resuming the move.",
    PROJECT_HANDOFF_RECOVERY_CONFLICT:"Documents or data changed after the interruption. Recovery preserves both sides and requires a decision about which changes to keep.",
    PROJECT_HANDOFF_ALREADY_ADOPTED:"The documents and state are already in the project folder. Open Documentazione to view them.",
    PROJECT_HANDOFF_PROJECT_MISSING:"No saved plan is available to move. Open the project first and check its status.",
    PROJECT_CUSTODIAN_ADOPTION_INCOMPLETE:"Moving the data into the project folder has not finished. Preserve the existing folders and use /controlled-dev project recover-storage to check and resume the move.",
    PROJECT_REBIND_REQUIRED:"This task was saved in a previous folder. Choose Resume transferred project to check the work and confirm resuming it in the current folder.",
    PROJECT_RUNTIME_IMPORT_REQUIRED:"The project was saved and released on shutdown: there are no old locks to recover. Choose Resume transferred project or use /controlled-dev project resume-storage, even in the same folder. The work will be checked and presented for a new local confirmation before acquiring control.",
    PAYLOAD_LIMIT:"The data to verify exceeds the limit for this step. Resuming may be incomplete: check the status and preserve files and protective locks before retrying.",
    PROJECT_HANDOFF_LIMIT:"Saving the project exceeded a storage-check limit. Completed agent work and candidate files are preserved; do not repeat implementation. Check the saved task and technical details before resuming its checks.",
    HOST_VERIFICATION_TERMINATION_UNPROVEN:"The previous process ended, but recovery in the same working folder cannot rule out an unfinished host command. Saved work and used attempts are preserved. For a project already saved in its own folder, choose Resume transferred project: it checks the saved candidate and asks to close the old permissions before restoring a separate copy with new checks and local permissions.",
    TAKEOVER_OWNER_DEATH_UNPROVEN:"There is insufficient evidence to recover the previous control. The task remains stopped: check the status and preserve data and protective locks. A missing lock alone does not prove that previous agents have terminated.",
    PROJECT_RUNTIME_IMPORT_RELEASE_REQUIRED:"The previous instance has not handed over the project for transfer. Shut down Pi normally in the previous folder and check the saved data before resuming here. Copying data does not prove that previous processes have terminated.",
    PROJECT_RUNTIME_IMPORT_RECONCILIATION_REQUIRED:"Termination of all previous agents has not yet been verified. Resuming remains blocked: check the status and processes before continuing.",
    PROJECT_RUNTIME_IMPORT_STALE:"Saved work changed since the resume proposal. No permission was acquired: review a new, updated proposal.",
    PROJECT_RUNTIME_IMPORT_HUMAN_CHANGED:"Notes or documents changed during confirmation. They are preserved: reopen the proposal to review the current changes before resuming.",
    PROJECT_RUNTIME_IMPORT_TERMINAL:"This task has already ended. View its result; if it is completed but not integrated, choose Integrate into project.",
    PROJECT_RUNTIME_IMPORT_BASELINE_MISMATCH:"The project version does not match the version required by the saved work. Data is preserved and resuming remains blocked until the starting point is clarified.",
    PROMOTION_TRANSFER_NOT_RELEASED:"The previous project has not been confirmed as handed over for transfer. Preserve the copy and check that the previous instance shut down normally before resuming integration.",
    PROMOTION_RESTORATION_STALE:"The saved copy or project changed after the proposal. Completion is preserved: review a new proposal before restoring or integrating.",
    CONTEXT_INVESTIGATION_OPERATOR_REQUIRED:"The available investigation attempts did not clarify the context. This step remains stopped: answer the saved questions before resuming. Reopening the screen does not add attempts.",
    CONTEXT_INVESTIGATION_INVALID:"The investigation and clarification record cannot be verified. No new investigation will start: preserve the data and check the technical details.",
    CONTEXT_INVESTIGATION_LIMIT:"The clarification record reached its size limit. Saved data is preserved. Break down the work before continuing.",
    SCOUT_CLARIFICATION_INVALID:"The answer does not match the current question or evidence. The task remains stopped: reopen clarifications from the current status.",
    SCOUT_CLARIFICATION_STALE:"The project changed while you were answering. Your answer was not applied: reopen the updated question.",
    SCOUT_CLARIFICATION_UNRESOLVED:"Confirmed answers to the analysis questions are missing. The dependent step remains stopped; complete the clarifications before continuing.",
    SCOUT_CLARIFICATION_SPEC_REVISION_REQUIRED:"The answer requires changes to the requirements or authorized files. Revise the task proposal and approve the revision before resuming.",
    SCOUT_CLARIFICATION_DELIVERY_INVALID:"The clarifications cannot be reliably linked to the current assignment. No agent will start: check the status and reopen clarifications.",
    SCOUT_CLARIFICATION_DELIVERY_LIMIT:"The clarifications are too long for this assignment. The full text is preserved: split the task or make the answers more concise before continuing.",
    TASK_REQUEST_LIMIT:"The request is too long to send to the agent (limit: 256 KiB). Split the work into smaller tasks. No agent was started; the full content is preserved.",
    RUN_NOT_SUCCESSFUL:"The agent did not complete its assignment. The task remains stopped and preserves the available evidence. Open Status to understand why before resuming or closing the attempt.",
    MISSING_STRUCTURED_OUTPUT:"The agent ended without delivering a response in the required format. No result was accepted. Verify that the previous process has closed before retrying.",
    ENOENT:"A required path or resource is unavailable. Check the reported path and retry from the wizard.",
    GIT_EXECUTABLE_UNAVAILABLE:"Git is unavailable in Pi's environment. Check that Git is installed and accessible, then restart Pi.",
    SOURCE_IMPORT_SOURCE_MISSING:"The source folder does not exist. Correct the path: relative paths start from Pi's current folder.",
    SOURCE_IMPORT_PARENT_MISSING:"The parent folder for the new project does not exist. Choose a destination with an existing parent.",
    SOURCE_IMPORT_PROFILE_MISSING:"The Pi profile folder is unavailable. Check the configured profile before creating the project.",
    GREENFIELD_TARGET_NOT_EMPTY:"The folder already contains files. To work on source code, choose Start from existing code in the menu; for a new project, choose an empty or nonexistent folder.",
    SOURCE_IMPORT_TARGET_EXISTS:"The destination already exists. Choose a new folder that does not exist; to resume a previously created project, choose Open an existing project.",
    SOURCE_IMPORT_ALREADY_STARTED:"An import has already been authorized for this destination. If the baseline is complete, choose Open an existing project; if copying was interrupted, preserve the folder and data for manual verification. No work will be overwritten or repeated.",
    SOURCE_IMPORT_PATH_UNSAFE:"Choose direct, separate folders outside the Pi profile. Imported source files must be regular files without links, reserved paths or credentials.",
    SOURCE_IMPORT_CHANGED:"The source or destination changed. Import stops and preserves the data; review the copy before continuing.",
    SOURCE_IMPORT_LIMIT:"The source exceeds the import limits: 100,000 entries, 512 MiB in total or 32 MiB per file. Choose a smaller scope.",
    SOURCE_IMPORT_EMPTY:"The folder contains no importable source files after excluding caches and metadata. Choose the code folder.",
    GIT_ROOT_INVALID:"Open the root folder of a valid Git repository separate from the Pi profile. To prepare the current folder, use /controlled-dev.",
    GREENFIELD_ALREADY_INITIALIZED:"This project is already initialized. Open its folder and use the normal Project plan or New task action.",
    GREENFIELD_UNBORN_UNSUPPORTED:"This Git repository has no baseline. The first version supports only empty or nonexistent folders; preserve this repository and choose a new folder.",
    GREENFIELD_NESTED_REPOSITORY:"The folder is inside another Git project. Choose an external location for the new project.",
    GREENFIELD_PATH_UNSAFE:"The path contains an ambiguous link, crosses reserved folders or lacks an existing parent folder. Choose a direct location separate from the Pi profile.",
    GREENFIELD_TARGET_STALE:"The folder changed during confirmation. Review a new proposal before authorizing creation.",
    GREENFIELD_PROPOSAL_STALE:"The proposal has been replaced. Review the current revision.",
    GREENFIELD_RECOVERY_REQUIRED:"A previously authorized initialization was interrupted. Reopen Create a new project with the same folder to check it.",
    GREENFIELD_RECOVERY_AMBIGUOUS:"The folder or Git data does not match the authorized initialization. Recovery stops and preserves all data; manual verification is required.",
    GREENFIELD_ACTIVE_TASK:"Finish or recover the active task before selecting a new project in this session.",
    GREENFIELD_DECISION_REQUIRED:"A material decision is missing. Clarify it and review a new proposal before creation.",
    CHECKPOINT_INPUT_NOT_IN_BASELINE:"A selected task is not recorded as integrated into the specified commit. Integrate the result through the normal process and review the check.",
    CHECKPOINT_PLAN_STALE:"The linked plan has been revised. A new check proposal with current references is required.",
    CHECKPOINT_APPROVAL_STALE:"The proposal or baseline changed. Review the check before approving it again.",
    CHECKPOINT_SCENARIO_UNRESOLVABLE:"A selected scenario is unavailable in the required version. Review the proposal.",
    CHECKPOINT_PRIMARY_CHANGED:"The primary folder changed without sufficient integration evidence. The check remains blocked.",
    CHECKPOINT_REVIEWER_TERMINALITY_UNKNOWN:"Termination of the previous Reviewer has not been proven. No equivalent Reviewer will be started.",
    CHECKPOINT_COMMAND_TERMINALITY_UNKNOWN:"Persisted termination evidence for a previous check is missing. No equivalent command will be repeated.",
    CHECKPOINT_RECOVERY_OWNER_UNCERTAIN:"The process running the check may still be active. Recovery requires proof of its termination.",
    CHECKPOINT_REVIEW_PACKET_LIMIT:"The evidence exceeds the permitted review context. Propose a narrower check; no PASS has been recorded.",
    GIT_CHECKPOINT_BASELINE_CHANGED:"The verification copy no longer matches the approved commit. Execution remains blocked.",
    GIT_IDENTITY_REQUIRED:"Git has no name and email for commits in this project. Start from existing code can collect and save them in the new project after your confirmation; for other projects, configure the local Git identity and retry.",
    GIT_IDENTITY_INVALID:"Enter a nonempty name and email without control characters or angle brackets. The email cannot contain spaces; each field allows at most 256 characters.",
    GIT_LOCAL_TARGET_REQUIRED:"A Git repository with at least one commit and a selected local branch is required.",
    GIT_TARGET_DIRTY:"The primary folder contains local changes. Preserve and manage your work before integrating.",
    GIT_WRONG_TARGET_BRANCH:"The primary folder is on a different branch. Integration requires the destination in the proposal.",
    MERGE_CONFLICT:"The isolated merge found a conflict. The project is unchanged. The incompatible changes need a normal controlled intervention.",
    INTEGRATION_VALIDATION_FAILED:"The task checks on the merge failed. The project was not integrated; evidence is preserved.",
    INTEGRATION_REVIEW_FAILED:"The Reviewer did not approve the integrated result. The project was not integrated.",
    INTEGRATION_REVIEW_REQUIRED:"The target has advanced: an independent Reviewer is required before proposing integration.",
    PROMOTION_TARGET_STALE:"The target changed. This approval cannot be applied: prepare a new proposal.",
    PROMOTION_RECOVERY_REQUIRED:"An authorized integration needs reconciliation. Open Integrate into project to check its exact outcome.",
    LEGACY_CANDIDATE_NOT_AUTOPROMOTABLE:"This historical task has no verifiable Git binding. Its candidate remains available for inspection but cannot be integrated automatically.",
    RESULT_SCHEMA_INVALID:"The response is missing required data or does not match the assignment. The task remains stopped; check the technical details to identify the problem.",
    INVALID_STRUCTURED_OUTPUT:"The agent's response contains incomplete or invalid data. The task has not been declared complete. Check Status and the technical details before retrying.",
    PRE_TASK_PROPOSAL_INVALID:"The Scout's proposal failed a consistency check. No task was created and no code change was accepted. Check the response format before requesting another analysis.",
    PROJECT_CONTEXT_INCOMPLETE:"An answer needed to define the work is still missing. Reopen /controlled-dev to continue from the saved clarifications.",
    PROJECT_TASK_REFINEMENT_REQUIRED:"This task still represents a broad body of work. Choose Break down the work and prepare specific increments before starting it.",
    PROJECT_REFINEMENT_STALE:"The plan or context changed. Reopen Break down the work to choose a task from the current plan.",
    PROJECT_REFINEMENT_LINKED:"This task or one of its successors is already linked to an execution. Use the normal plan revision process; evidence, links and counters are preserved.",
    PROJECT_REFINEMENT_NOT_PREPARED:"Breaking down work requires a selection in the current project. Reopen Break down the work; no proposal has been adopted.",
    PROJECT_REFINEMENT_LIMIT:"The proposal is too long for the selected work or contains more than three tasks. Request a shorter proposal. The limit grows with the number of tasks and outcomes described, up to 24 KiB. The approved plan remains current; no content was truncated.",
    PROJECT_REFINEMENT_BINDING:"The proposal does not match the selected task and revision. No breakdown has been adopted.",
    PROJECT_REFINEMENT_INCOMPLETE:"The proposal does not describe the increments sufficiently. The approved plan remains current.",
    PROJECT_REFINEMENT_DEPENDENCY:"The proposed dependencies do not preserve the task's prerequisites. The breakdown has not been adopted.",
    PROJECT_REFINEMENT_COVERAGE:"The proposal does not reconcile all expected task outcomes. The approved plan remains current.",
    PROJECT_REFINEMENT_IDENTITY:"The proposal reuses an already registered work identity. No counter or result has been replaced.",
    PROJECT_REFINEMENT_MATERIALIZATION:"The new draft does not match the verified breakdown. The approved plan remains current.",
    PROJECT_REFINEMENT_NO_CHANGE:"The proposal repeats the same task without refining it. No implementation progress has been recorded.",
    PROJECT_REFINEMENT_REMAINDER:"The proposal must identify at least one concrete increment and may retain only one remainder for further breakdown. The approved plan remains current.",
    PROJECT_PLAN_CONTEXT_STALE:"The context was updated after this proposal. Regenerate the plan using the current clarifications before approving it.",
    PROJECT_GOAL_STALE:"The context changed during analysis. The previous proposal was discarded; resume from the project using the saved answers.",
    PROJECT_CLARIFICATION_REPEATED:"The Scout repeated an already resolved question. Your answers are saved; request a new analysis from the project without entering them again.",
    PROJECT_PLAN_NEEDS_SCOPE_REVIEW:"Task analysis requires files outside the plan. Revise the plan to include them before authorizing automatic development.",
    PRE_TASK_PROVIDER_CONNECTION_FAILED:"The Scout could not finish because its model connection failed. No usable proposal was accepted. Check the connection and model availability before retrying analysis from the saved project.",
    CURRENT_PROJECT_AMBIGUOUS:"This folder contains multiple repositories. Start Pi in the project folder you want to work on: no additional project will be created here.",
    CURRENT_PROJECT_GIT_INVALID:"The folder contains unusable Git metadata. The project will not be overwritten; check the existing repository.",
    CURRENT_PROJECT_UNBORN:"The project is open, but the Git repository has no commit yet. Preserve your changes and prepare the first commit before starting work.",
    CURRENT_PROJECT_DIRECTORY_INVALID:"The project folder must be separate from the Pi profile and identifiable without ambiguous links.",
    CURRENT_PROJECT_DISCOVERY_LIMIT:"Project discovery reached the scan limit. Start Pi closer to the project folder.",
    CURRENT_PROJECT_CHANGED:"The folder changed during preparation. Reopen the project to review the current state; no source files will be overwritten.",
    CURRENT_PROJECT_SETUP_INTERRUPTED:"Preparing local history was interrupted. Files and evidence are preserved; check the repository before retrying.",
    CANARY_UNSUPPORTED_ENTRY:"Project verification found a live socket, pipe or another unsupported file type. Stop the local service or move its working files outside the source tree, then retry. The Git baseline may already be saved; source files have not been overwritten.",
    PRE_TASK_SCOUT_FAILED:"The Scout ended without a usable proposal. The project and objective are saved; you can retry analysis from the project panel. The Scout session is listed in the technical details.",
    PRE_TASK_SCOUT_UNAVAILABLE:"The Scout is unavailable. Check that pi-subagents is installed and restart Pi.",
    PRE_TASK_PROPOSAL_UNAVAILABLE:"A new analysis cannot start yet. Check the previous Scout in /subagents-fleet; if it is active, stop that run. Then retry /controlled-dev project plan in the selected project.",
    PRE_TASK_PROPOSAL_CANCELLED:"Preparation cancelled. No task was created.",
    PRE_TASK_PROPOSAL_UNCERTAIN:"The Scout's termination has not yet been confirmed. The project and objective are saved. Check the run in /subagents-fleet; if it is active, stop it. Then use /controlled-dev project plan: the package will recheck termination before starting a new Scout.",
    PRE_TASK_READ_ONLY_VIOLATION:"The project changed during analysis. The proposal was discarded.",
    HUMAN_DECISION_STALE:"The confirmation referred to a previous state. Check the current status and reopen the decision.",
    CONTROLLED_RUNTIME_UNAVAILABLE:"Starting agents requires the pi-subagents package. Check that it is installed, then restart Pi.",
    CONTROLLED_COMMAND_INVALID:"Unknown command. Use /controlled-dev for the project or /controlled-dev menu for advanced controls.",
    HUMAN_CHANNEL_UNAVAILABLE:"This action requires an active Pi TUI session.",
    RECOVERY_AMBIGUOUS:"The outcome of the previous execution cannot yet be established. The task remains stopped and preserves all data. Verify the processes and available evidence before resuming.",
    WORKFLOW_ALREADY_ACTIVE:"A task is already running. Open Status to follow it; if it was interrupted, use the recovery process.",
    HUMAN_DECISION_WRONG_TASK:"The requested confirmation concerns a different task from the one active in the project. Reopen Status and choose the correct task.",
    CONTROLLED_DEV_TASK_INPUT_MISSING:"No task has been prepared yet. Open /controlled-dev and choose the next work item.",
    CONTROLLED_DEV_TASK_INPUT_INVALID:"The task's saved data cannot be read, or the Pi profile is inside the project. Preserve the data and check the technical details.",
    CONTROLLED_DEV_TASK_BASELINE_INVALID:"The current project does not match the task's required starting version. Check that you opened the correct folder and review Git status.",
    CANARY_LIMIT:"The project is too large for this read-only analysis. Limits: 100,000 files and folders, 512 MiB of content and 512 MiB of Git metadata. No proposal was created; choose a smaller scope.",
    SOURCE_INDEX_LIMIT:"The source file list exceeds the 64 KiB limit. Split the analysis into smaller scopes. All paths are preserved; no incomplete list was sent to the agent.",
    RETRY_EXHAUSTED:"The task reached its allowed attempt limit. Open Status and Checks to understand what prevents completion; a decision on the next step is required.",
    VALIDATION_CANDIDATE_CHANGED:"The working copy changed from the version to be checked. Verification stops: results from the previous version cannot certify the current one.",
    VALIDATION_PRECONDITION:"The check cannot start because the task state or working copy does not match the approved assignment. Open Status and check the technical details.",
    VALIDATION_TERMINAL_PROOF_UNAVAILABLE:"There is no conclusive evidence that the verification process closed. No successful outcome will be recorded; clarify the previous execution before repeating the check.",
    SCOPE_VIOLATION:"Changes outside the authorized files were detected. The result remains blocked. Review the allowed files and working copy before continuing.",
    SCOPE_GUARD_FAILED:"Verification of the starting version or permitted changes failed. Check Status to identify which phase stopped before resuming. Files, analysis and previous confirmations are preserved.",
    SCOPE_BASELINE_INVALID:"The initial copy does not match the project version recorded for this task. Work remains stopped: check the original folder and working copy before resuming.",
    SCOPE_ORIGINAL_CHANGED:"The original project folder changed while work was running in the separate copy. The result remains blocked; preserve the changes and verify which version to use.",
    SCOPE_WORKSPACE_CHANGED:"The working copy no longer matches the recorded version. The task remains stopped; preserve the data and check Status.",
    SCOUT_RECOVERY_UNAVAILABLE:"The previous analysis cannot be resumed with the available evidence and attempts. Open Status to read the reason and choose the next step.",
    DEVELOPER_RECOVERY_UNAVAILABLE:"Interrupted development cannot be resumed with the available evidence and attempts. The working copy is preserved; open Status before deciding how to continue.",
    NO_PENDING_GATE:"There are no pending confirmations.",
    HUMAN_GATE_REOPEN_REQUIRED:"A confirmation is still saved, but this session cannot safely present it after an interrupted operation. Close Pi normally, reopen it and resume the saved task. Do not repeat the decision in this session.",
    STORE_NAMESPACE_CHANGED:"Saved task files changed while they were being checked. The operation stopped; no new agent was started. Close Pi normally and resume the saved task before making another decision. Technical details identify the check that stopped.",
    GATE_ALREADY_DECIDED:"This session already recorded a decision for that confirmation. After an interrupted operation, close Pi normally and resume the saved task so its recorded outcome can be checked before continuing.",
    HUMAN_CONFIRMATION_REQUIRED:"Open Decision from the menu to read the data and confirm in the Pi panel.",
  };
  // Bounded host-authored English messages may be shown. Unknown technical payloads stay withheld.
  const readable=/^(The |A |An |No |Cannot |Invalid |Enter |Select |Use |Before |Saved |Required |Nonempty |Objective |Repository |Task |Command |Controlled Dev )/.test(raw)&&!raw.includes('\n');
  const proposalField=(error as {diagnostic?:{validationPath?:unknown}})?.diagnostic?.validationPath;
  const proposalPath=code==='PRE_TASK_PROPOSAL_INVALID'&&typeof proposalField==='string'&&proposalField.length<=256&&/^\$[.\[\]A-Za-z0-9_]*$/.test(proposalField)?proposalField:undefined;
  const reportedPath=(error as {path?:unknown})?.path??proposalPath;
  const path=typeof reportedPath==='string'&&reportedPath.length<=1024?safeText(reportedPath):undefined;
  const detail=(error as {diagnostic?:{phase?:unknown;path?:unknown}})?.diagnostic;
  const diagnostic=['STORE_NAMESPACE_CHANGED','INVALID_REVIEW_PACKET'].includes(code)&&typeof detail?.phase==='string'&&/^[A-Z_]{1,64}$/.test(detail.phase)&&typeof detail.path==='string'&&detail.path.length<=1024?{phase:detail.phase,path:safeText(detail.path)}:undefined;
  const connectionFailure=(error as {diagnostic?:{providerFailure?:unknown}})?.diagnostic?.providerFailure==='CONNECTION_FAILED';
  const providerError=(error as {diagnostic?:{providerError?:unknown}})?.diagnostic?.providerError;
  // Older connection diagnostics identified only fetch failure and lack a subtype.
  const connectionLabel=providerError==='FETCH_FAILED'||providerError===undefined?'fetch failed'
    :providerError==='WEBSOCKET_ERROR'?'WebSocket connection failed'
    :providerError==='TERMINATED'?'connection ended unexpectedly':'connection error';
  const connectionMessage=!connectionFailure?undefined
    :code==='PRE_TASK_PROPOSAL_UNCERTAIN'
      ?`The Scout encountered a model connection error (${connectionLabel}), and its termination has not yet been verified. No proposal was accepted. Check the run in /subagents-fleet; if it is active, stop it. /subagents-doctor checks the runtime, not the model connection. The project and objective are saved; after resolving the connection, use /controlled-dev project plan to recheck termination and request a new analysis.`
      :code==='PRE_TASK_PROVIDER_CONNECTION_FAILED'
        ?`The Scout lost its model connection (${connectionLabel}). No usable proposal was accepted. Its process ended; the project and objective are saved. Check the connection and model availability before requesting another analysis.`
        :undefined;
  const message=connectionMessage??known[code]??(readable?safeText(raw.replace(/\s*\([A-Z_]+\)/g,'')).slice(0,500):"The operation did not complete. Check the status and technical details before retrying.");
  return {code,message:message+(path?`\n${proposalPath?'Response field':'Path'}: ${path}`:'')+(diagnostic&&code==='INVALID_REVIEW_PACKET'?`\nCheck: ${diagnostic.path}`:''),...(path?{path}:{}),...(diagnostic?{diagnostic}:{})};
}
export interface StatusPages {overview:string;activity:string;checks:string;technical:string}
const activityStateLabels:Record<string,string>={
  'Task ready':'Task ready','Task ready to start':'Task ready to start','Task analysis':'Task analysis','Task blocked':'Task stopped',
  'Task pronto':"Task ready",'Task pronto da avviare':"Task ready to start",
  'Analisi del task':"Task analysis",'Task bloccato':"Task stopped",
  'Completato (COMPLETED)':"Completed and verified",'Non completato (FAILED)':"Attempt ended without completing the task",
};
function progressStatus(line:string):string {
  const prefix=line.startsWith('Stato: ')?'Stato: ':'Status: ';return line.startsWith(prefix)?'Status: '+(activityStateLabels[line.slice(prefix.length)]??line.slice(prefix.length)):line;
}
/** Translate only known host-authored status rows. Objectives, source paths,
 * criterion text, confirmation bodies and technical records retain their bytes. */
function statusPage(text:string,kind:'overview'|'activity'|'checks'):string {
  let objective=false;
  return text.split('\n').map(line=>{
    if(kind==='overview'){
      if(line==="Objective"||line==='Obiettivo'){objective=true;return 'Objective'}
      if(objective){if(line==='')objective=false;return line}
      if(line==="Task status"||line==="Stato del task")return "Task status";
      if(activityStateLabels[line])return activityStateLabels[line];
      if(line.startsWith("Status: ")||line.startsWith("Stato: "))return progressStatus(line);
      const generation=line.match(/^(?:Candidate generation|Generazione candidata): (\d+|none|unavailable|nessuna|non disponibile)$/);
      if(generation)return `Working copy version: ${{nessuna:"none",'non disponibile':"unavailable"}[generation[1]!]??generation[1]}`;
      if(/^(?:Candidate copy|Copia candidata): /.test(line))return "Separate working copy: "+line.replace(/^(?:Candidate copy|Copia candidata): /,'');
      if(line==="Confirmation required: no — no human gate is currently open"||line==='Conferma richiesta: no — nessun gate umano è attualmente aperto')return "Confirmation required: no";
    }
    if(kind==='activity'){
      const role=line.match(/^(Scout|Developer|Reviewer) · (.*)$/);
      if(role){
        const labels:Record<string,string>={Scout:"Analysis",Developer:"Development",Reviewer:"Review"};
        const outcomes:Record<string,string>={PASS:"Successful outcome",FAIL:"Result not approved",BLOCKED:"Inconclusive outcome",
          'Candidate copy produced':'Working copy prepared','Task analysis started':'Task analysis started','Copia candidata prodotta':"Working copy prepared",'Analisi del task avviata':"Task analysis started"};
        return `${labels[role[1]!]} · ${outcomes[role[2]!]??role[2]}`;
      }
      if(line==="Runtime events collected for this check")return "Execution observations collected for this check";
    }
    if(kind==='checks'){
      const outcome=line.match(/^  (?:Latest execution|Ultima esecuzione): (PASS|FAIL|INVALID)$/);
      if(outcome)return "  Latest execution: "+({PASS:"check passed",FAIL:"check failed",INVALID:"unusable outcome"}[outcome[1]!]);
      const review=line.match(/^• Reviewer: (PASS|FAIL|BLOCKED)\. (?:The orchestrator decides completion|Il completamento è deciso dall’orchestratore)\.$/);
      if(review)return "• Independent review: "+({PASS:"successful outcome",FAIL:"result not approved",BLOCKED:"inconclusive outcome"}[review[1]!])+". The system also verifies the other completion conditions.";
      if(line==='Criteri di accettazione')return "Acceptance criteria";
      if(line==="Executable scenarios"||line==='Scenari eseguibili')return "Verification cases";
      if(/^  (?:Runtime events|Eventi runtime): \d+\. /.test(line))return line.replace(/(?:Runtime events|Eventi runtime): /,"Execution observations: ");
    }
    return line;
  }).join('\n');
}
/** Read-only observer; it never starts, approves, retries or completes work. */
export async function showStatus(ui:ControlledUI,read:()=>StatusPages):Promise<void> {
  const present=(p:StatusPages):StatusPages=>({...p,overview:statusPage(p.overview,'overview'),activity:statusPage(p.activity,'activity'),checks:statusPage(p.checks,'checks')});
  if(!ui.custom){const p=present(read());ui.notify(p.overview+"\n\nActivity\n"+p.activity+"\n\nChecks\n"+p.checks,'info');return}
  // One verified snapshot per opening. Revalidating the durable ledger during
  // every redraw blocks keyboard navigation and can mix different revisions.
  let pages:StatusPages;try{pages=present(read())}catch(error){pages={overview:errorPresentation(error).message,activity:"Status unavailable.",checks:"No verified outcome.",technical:errorPresentation(error).code}}
  await ui.custom<void>((tui,_theme,_keys,done)=>{
    let page=0,offset=0;
    const names=["Summary","Activity","Checks","Technical details"];
    const dispose=()=>{};
    return {render(width){
      // Pi keeps its input editor, agent summary and model footer below custom
      // panels. Reserve that native chrome so the panel's actions stay visible.
      const rows=Math.max(8,(tui.terminal?.rows??24)-8);
      if(width<24||rows<12){
        const body=displayLines([Object.values(pages)[page]],width),height=Math.max(1,rows-4);
        offset=Math.min(offset,Math.max(0,body.length-height));
        return [...displayLines([`Controlled Dev | ${names[page]}`,"1 Summary  2 Activity  3 Checks  4 Details","Tab: view · ↑↓: scroll · Esc: close"],width),...body.slice(offset,offset+height),...displayLines([`Lines ${offset+1}-${Math.min(body.length,offset+height)}/${body.length}`],width)];
      }
      const panelWidth=width-2,inner=panelWidth-4;
      const colors=_theme as {fg?:(color:string,text:string)=>string}|null;
      const paint=(color:string,value:string)=>colors?.fg?.(color,value)??value;
      const cells=(value:string)=>[...value.normalize('NFC')].reduce((n,c)=>n+(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Extended_Pictographic}]/u.test(c)?2:/\p{Mark}/u.test(c)?0:1),0);
      const row=(value:string,color='text')=>paint('border','│ ')+paint(color,value)+' '.repeat(Math.max(0,inner-cells(value)))+paint('border',' │');
      const edge=(left:string,right:string)=>paint('border',left+'─'.repeat(panelWidth-2)+right);
      const menu=names.map((name,i)=>`${i+1} ${i===page?`[${name}]`:name}`).join(' · ');
      const footer=[...displayLines([menu],inner).map(line=>row(line,'accent')),
        ...displayLines(["Status read on opening · Reopen to refresh"],inner).map(line=>row(line,'muted')),
        ...displayLines(["←→/Tab: view · ↑↓: scroll · Esc: close"],inner).map(line=>row(line,'muted'))];
      const top=[paint('accent',"Controlled Dev | Status"),edge('╭','╮'),row(`View (${page+1}/4) — ${names[page]}`,'accent'),
        row(names.map((_,i)=>i===page?'●':'○').join(' '),'accent'),edge('├','┤')];
      const body=displayLines([Object.values(pages)[page]],inner);
      const height=Math.max(1,rows-top.length-footer.length-4);
      const scrollable=body.length>height;
      const visible=Math.max(1,height-(scrollable?1:0));
      offset=Math.min(offset,Math.max(0,body.length-visible));
      const reading=scrollable?[row(`Lines ${offset+1}-${Math.min(body.length,offset+visible)}/${body.length} · ↑↓ to scroll`,'muted')]:[];
      const headings=new Set(["Objective","Task status","Result","Confirmations and recovery","Acceptance criteria","Automated checks","Independent review"]);
      return [...top,row(''),...body.slice(offset,offset+visible).map(line=>row(line,headings.has(line)?'accent':'text')),
        ...reading,row(''),edge('├','┤'),...footer,edge('╰','╯')];
    },handleInput(data){
      if(_keys?.matches(data,'tui.select.cancel')||data==='\x1b'){dispose();done();return}
      if(/^[1-4]$/.test(data)){page=Number(data)-1;offset=0}
      else if(_keys?.matches(data,'tui.input.tab')||data==='\t'||data==='\x1b[C'){page=(page+1)%4;offset=0}
      else if(data==='\x1b[Z'||data==='\x1b[D'){page=(page+3)%4;offset=0}
      else if(_keys?.matches(data,'tui.select.up')||data==='\x1b[A')offset=Math.max(0,offset-1);
      else if(_keys?.matches(data,'tui.select.down')||data==='\x1b[B')offset++;
      else if(_keys?.matches(data,'tui.select.pageUp')||data==='\x1b[5~')offset=Math.max(0,offset-10);
      else if(_keys?.matches(data,'tui.select.pageDown')||data==='\x1b[6~')offset+=10;
      tui.requestRender();
    },invalidate(){},dispose};
  });
}
export async function withProgress<T>(ui:ControlledUI,read:()=>string,work:()=>Promise<T>,initialStatus="Preparing the task"):Promise<T>{
  const started=Date.now();
  const key=ui.custom??ui,frames=progressFrames.get(key)??[];
  progressFrames.set(key,frames);
  let closed=false,timer:ReturnType<typeof setTimeout>|undefined;
  const draw=(lines:string[])=>{
    const status=progressStatus(lines.find(l=>l.startsWith("Status:"))??lines.find(l=>l.trim())??"Controlled Dev in progress");
    const last=lines.find(l=>l.startsWith("Last completed step:"));
    const recovery=lines.find(l=>l.startsWith("Recovery required:"));
    const waiting=status.includes("Waiting for your confirmation");
    const footer=waiting?"Authorization is requested in a separate panel."
      :recovery?.startsWith("Recovery required: yes")?"The task's resume path needs to be checked. Open Status to read the reason.\nNo agents will start and no checks will be repeated."
      :status==="Status: Task stopped"?"The task is stopped. Open Status and Checks to understand why and identify the next step."
      :"Status updates as work progresses. Alt+P: project plan · Alt+S: task status. Any confirmations will appear in a separate panel.";
    ui.setWidget?.('controlled-dev',ui.custom&&readingPanels.has(ui.custom)?undefined:(_tui,theme)=>({
      render(width){
        const seconds=Math.max(0,Math.floor((Date.now()-started)/1000));
        const elapsed=`Elapsed time: ${Math.floor(seconds/60)} min ${seconds%60} s since starting`;
        if(width<24)return displayLines(['Controlled Dev',status,...(last?[last]:[])],width);
        const panel=wizardPanel(theme,width,status,undefined,ui.wizardTextWidth,"Activity");
        const objective=lines.find(l=>l.startsWith("Objective:"));
        const rationale=lines.find(l=>l.startsWith("Why it matters:"));
        const detail=[...(objective?[objective]:[]),...(rationale?[rationale]:[]),...(last?[last]:objective||rationale?[]:lines.some(l=>l.startsWith("Status:"))?["Wait for the next step."]:lines.filter(l=>l!==status&&l.trim()))];
        const preview=detail.flatMap(line=>{
          const wrapped=displayLines([line],panel.inner);
          return wrapped.length<=3?wrapped:[...wrapped.slice(0,2),...displayLines(["… continued in the plan (Alt+P)."],panel.inner).slice(0,1)];
        });
        return panel.finish(displayLines([...preview,elapsed],panel.inner).map(line=>panel.row(line)),
          displayLines([footer],panel.inner).map(line=>panel.row(line,'muted')));
      },invalidate(){},
    }));
    ui.setStatus?.('controlled-dev',status);
  };
  const frame={redraw:()=>{try{draw(safeText(read()).split('\n'))}catch{}}};
  frames.push(frame);
  const tick=()=>{if(closed)return;if(frames.at(-1)===frame)frame.redraw();timer=setTimeout(tick,500)};
  try{
    // Pi throttles native rendering to 16 ms. Allow that first frame to paint
    // before synchronous ledger/Git work occupies the event loop.
    draw([`Status: ${safeText(initialStatus)}`]);
    await new Promise<void>(resolve=>setTimeout(resolve,25));
    tick();return await work();
  }finally{
    closed=true;clearTimeout(timer);const index=frames.indexOf(frame);if(index>=0)frames.splice(index,1);
    if(frames.length)frames.at(-1)!.redraw();
    else {progressFrames.delete(key);ui.setWidget?.('controlled-dev',undefined);ui.setStatus?.('controlled-dev',undefined)}
  }
}

export interface WizardPresentation { step:number; total:number; question:string; why:string; section?:string }

/** Shared presentation only: draft input and proposal selection use the same panel. */
export function wizardPanel(theme:unknown,width:number,title:string,wizard?:WizardPresentation,measure?:(text:string)=>number,section='Menu'){
  const panelWidth=Math.max(8,width-2),inner=panelWidth-4;
  const colors=theme as {fg?:(color:string,text:string)=>string}|null;
  const paint=(color:string,text:string)=>colors?.fg?.(color,text)??text;
  const cells=measure??((text:string)=>[...safeText(text).normalize('NFC')].reduce((n,c)=>n+((/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Extended_Pictographic}]/u.test(c))?2:/\p{Mark}/u.test(c)?0:1),0));
  const row=(text:string,color='text')=>paint('border','│ ')+paint(color,text)+' '.repeat(Math.max(0,inner-cells(text)))+paint('border',' │');
  const edge=(left:string,right:string)=>paint('border',left+'─'.repeat(panelWidth-2)+right);
  const separator=edge('├','┤');
  const top=[paint('accent',`Controlled Dev | ${wizard?wizard.section??"New task":section}`),edge('╭','╮'),
    ...displayLines([title],inner).map(line=>row(line,'accent')),
    ...(wizard?[row(Array.from({length:wizard.total},(_,i)=>i<wizard.step?'●':'○').join(' '),'accent')]:[]),
    separator,row(''),
    ...(wizard?[...displayLines([wizard.question],inner).map(line=>row(line)),
      ...displayLines([`Why it matters: ${wizard.why}`],inner).map(line=>row(line,'muted')),row('')]:[])];
  return {inner,top,row,finish:(body:string[],footer:string[])=>[...top,...body,separator,...footer,edge('╰','╯')]};
}

/** Scrollable proposal body with an independent action selector. No workflow authority. */
export async function chooseAction(ui:Pick<ControlledUI,'custom'|'select'|'wizardTextWidth'|'setWidget'>,title:string,body:string,actions:string[],wizard?:WizardPresentation,
  options?:{section?:string;timeoutMs?:number;scrollWithArrows?:boolean}):Promise<string|undefined>{
  if(!ui.custom)return ui.select?.(safeText(`${title}\n${wizard ? `${wizard.question}\nWhy it matters: ${wizard.why}\n` : ''}${body}`),actions);
  const custom=ui.custom;
  readingPanels.set(custom,(readingPanels.get(custom)??0)+1);
  ui.setWidget?.('controlled-dev',undefined);
  try{return await custom<string|undefined>((tui,_theme,keys,done)=>{
    let selected=0,offset=0;
    let settled=false;
    const finish=(value:string|undefined)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);done(value)};
    const timer=options?.timeoutMs?setTimeout(()=>finish(undefined),options.timeoutMs):undefined;
    return {render(width){
      const rows=Math.max(6,(tui.terminal?.rows??24)-8);
      if(width>=24 && rows>=16){
        const panel=wizardPanel(_theme,width,title,wizard,ui.wizardTextWidth,options?.section);
        const hints=displayLines(["←→/Tab: action · ↑↓: scroll · Enter: select · Esc: cancel"],panel.inner);
        const menu:string[]=[''];let selectedStart=0,selectedEnd=1;
        actions.forEach((action,i)=>{
          const label=i===selected?`[ ${action} ]`:action;
          const last=menu.length-1,joined=menu[last]?`${menu[last]} · ${label}`:label;
          if(displayLines([joined],panel.inner).length===1)menu[last]=joined;
          else {if(menu[last])menu.push('');const parts=displayLines([label],panel.inner);menu[menu.length-1]=parts[0];menu.push(...parts.slice(1))}
          if(i===selected){selectedEnd=menu.length;selectedStart=selectedEnd-displayLines([label],panel.inner).length}
        });
        const menuHeight=Math.max(1,Math.min(menu.length,rows-panel.top.length-hints.length-4));
        const menuOffset=Math.min(selectedStart,Math.max(0,selectedEnd-menuHeight));
        const footer=menu.slice(menuOffset,menuOffset+menuHeight);
        const content=displayLines([body],panel.inner);
        const capacity=Math.max(1,rows-panel.top.length-hints.length-footer.length-2);
        const scrollable=content.length>capacity;
        const height=Math.max(1,capacity-(scrollable?1:0));
        offset=Math.min(offset,Math.max(0,content.length-height));
        const reading=scrollable?displayLines([`Text ${offset+1}-${Math.min(content.length,offset+height)}/${content.length}`],panel.inner).slice(0,1):[];
        return panel.finish([...content.slice(offset,offset+height).map(line=>panel.row(line)),...reading.map(line=>panel.row(line,'dim'))],
          [...footer.map(line=>panel.row(line,line.includes('[ ')?'accent':'text')),...hints.map(line=>panel.row(line,'muted'))]);
      }
      const header=displayLines([title],width).slice(0,2);
      const hints=displayLines(["Arrows/Tab: action | Enter: select","PgUp/PgDn: text | Esc: cancel"],width).slice(0,Math.max(1,Math.floor(rows/3)));
      const menu=actions.map((action,i)=>displayLines([`${i===selected?'>':' '} ${i+1}. ${action}`],width));
      const menuHeight=Math.max(1,rows-header.length-hints.length-4);
      const selectedEnd=menu.slice(0,selected+1).reduce((n,lines)=>n+lines.length,0);
      const menuOffset=Math.max(0,selectedEnd-menuHeight);
      const footer=[...menu.flat().slice(menuOffset,menuOffset+menuHeight),...hints];
      const lines=displayLines(wizard?[wizard.question,`Why it matters: ${wizard.why}`,body]:[body],width),height=Math.max(1,rows-header.length-footer.length-1);offset=Math.min(offset,Math.max(0,lines.length-height));
      return [...header,...lines.slice(offset,offset+height),...displayLines([`Reading ${offset+1}-${Math.min(lines.length,offset+height)}/${lines.length}`],width).slice(0,1),...footer];
    },handleInput(data){
      if(settled)return;
      if(keys?.matches(data,'tui.select.cancel')||data==='\x1b'){finish(undefined);return}
      if(keys?.matches(data,'tui.select.confirm')||data==='\r'||data==='\n'){finish(actions[selected]);return}
      const up=keys?.matches(data,'tui.select.up')||data==='\x1b[A';
      const down=keys?.matches(data,'tui.select.down')||data==='\x1b[B';
      if((wizard||options?.scrollWithArrows)&&up)offset=Math.max(0,offset-1);
      else if((wizard||options?.scrollWithArrows)&&down)offset+=1;
      else if((!wizard&&up)||data==='\x1b[D'||data==='\x1b[Z')selected=(selected+actions.length-1)%actions.length;
      else if((!wizard&&down)||keys?.matches(data,'tui.input.tab')||data==='\t'||data==='\x1b[C')selected=(selected+1)%actions.length;
      else if(keys?.matches(data,'tui.select.pageUp')||data==='\x1b[5~')offset=Math.max(0,offset-8);
      else if(keys?.matches(data,'tui.select.pageDown')||data==='\x1b[6~')offset+=8;
      tui.requestRender();
    },invalidate(){},dispose(){if(timer)clearTimeout(timer)}};
  })}finally{const count=(readingPanels.get(custom)??1)-1;if(count)readingPanels.set(custom,count);else readingPanels.delete(custom)}
}

/** Explicit affirmative input; the initial selection and timeout both cancel. */
export async function confirmChoice(ui:Pick<ControlledUI,'confirm'|'custom'|'setWidget'>,title:string,body:string,timeoutMs=120000):Promise<boolean>{
  if(!ui.custom)return ui.confirm(title,body,{timeout:timeoutMs});
  const yes="Yes, confirm";
  return await chooseAction(ui,title,body,["No, go back",yes],undefined,{section:"Confirmation",timeoutMs,scrollWithArrows:true})===yes;
}
