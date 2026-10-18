import { prepareProjectRuntimeImport, projectRuntimeImportRequest, authorizeProjectRuntimeImport, completeProjectRuntimeImport, abortProjectRuntimeImport, prepareProjectRuntimeImportRecovery, projectRuntimeImportRecoveryRequest, recoverProjectRuntimeImport } from './project-runtime-import.js';
import { takeOverImportedWorkflow } from './recovery-resume.js';
import { setTimeout } from 'node:timers';
import { resolveProjectStorage, assertProjectStoragePath, physicalProjectRootForTask } from './project-storage.js';
import { presentTrustedConfirmation } from './trusted-confirmation.js';
import { runQuiescent } from './run-quiescence.js';
import { prepareProjectHandoff, prepareProjectHandoffRecovery, projectHandoffRequest, authorizeProjectHandoff, completeProjectHandoff, openHandoffReceiptStore, recoverProjectHandoff, currentProjectHandoffCandidatePaths, releaseProjectHandoff, readProjectHandoffForRuntimeImport } from './project-handoff.js';
import { humanVaultRoot, readProjectCustodian } from './project-custodian.js';
import { captureCandidateCheckpointStaging, captureCandidateCheckpoint, verifyCandidateCheckpoint } from './candidate-checkpoints.js';
import type { HumanGateRequest, TrustedHumanDecision } from './orchestrator.js';
import { ProjectAutonomyRepository } from './project-autonomy.js';
import { consumePolicyCapability } from './policy-authorization.js';
import type { PolicyAuthorizationCapability } from './policy-authorization.js';
import { isHostPreTaskProposal, proposalDraft } from './pre-task-proposal.js';
import type { PreTaskProposalResult } from './pre-task-proposal.js';
import { projectIdentity } from './project-identity.js';
import { GreenfieldBootstrap } from './greenfield-bootstrap.js';
import { SourceProject } from './source-project.js';
import { CandidateGit } from './candidate-git.js';
import { IntegrationCheckpointRepository } from './integration-checkpoint-repository.js';
import { contextInvestigationScopeDigest } from './context-investigation.js';
import { ContextInvestigationRepository } from './context-investigation-repository.js';
import { hashCanonical } from './contract-json.js';
import { ProjectPlanningRepository, plannedSeedInvestigationBinding } from './project-planning-repository.js';
import { CandidatePromotionRepository } from './candidate-promotion-repository.js';
import type { PlannedTaskSeed } from './project-planning-repository.js';
import { ProjectMemoryRepository } from './project-memory-repository.js';
import type { ControlledUI, StatusPages } from './controlled-ui.js';
import { showStatus } from './controlled-ui.js';
import { taskWizard, wizardSummary } from './task-wizard.js';
import type { ProposeTask } from './task-wizard.js';
import { compileValidations } from './validation-proposals.js';
import { CurrentProject } from './current-project.js';
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { accessSync, constants, closeSync, fsyncSync, openSync, writeFileSync, renameSync, lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, existsSync } from 'node:fs';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { canonicalize, hashBytes, hashContract, parseJson, validateStructure, validateScalar } from './contracts.js';
import type { ArtifactRef, InputSource, TaskSpec, ValidationContext } from './contracts.js';
import { freezeTaskSpec } from './task-spec.js';
import { currentValidationEvidence } from './contract-semantic.js';
import { DurableStore } from './store.js';
import { LockManager, withLockMutation } from './lock-manager.js';
import { OrchestratorHost, presentHumanGate, confirmHumanDisplay } from './orchestrator.js';
import type { CentralOrchestrator, HumanDecisionChoice } from './orchestrator.js';
import { classifyResumeAction, takeOverWorkflow, reconcileUnknownChildren } from './recovery-resume.js';
import { classifyRecoveryState, reconciliationAttempts } from './recovery.js';
import { classifyStore, repairStore } from './store-repair.js';
import { RpcAdapter } from './pi-subagents-rpc.js';
import type { RpcEvents } from './pi-subagents-rpc.js';
import type { RuntimeComparison, RuntimeEvidence } from './runtime-observability.js';
import { rebuildHumanView, rebuildProjectPlanningView } from './human-repository.js';
import { EVIDENCE_BUNDLE_MEDIA_TYPE, SCENARIO_MEDIA_TYPE, SCENARIO_RUN_MEDIA_TYPE,
  validateExecutableScenario, validateScenarioRun, validateTechnicalEvidenceBundle } from './scenario-management.js';

export interface ProductionCommandContext {
  prepareProjectBaseline?:()=>Promise<boolean>;
  continueAfterPlan?:boolean;
  readonly planningRequest?:string;
  readonly prepareAutonomyTask?:(task:import('./project-planning.js').PlannedTask,plan:import('./project-planning.js').ProjectPlan)=>Promise<PreTaskProposalResult>;
  readonly autonomyPlanning?:boolean;
  readonly onAutonomyApproved?:(policyId:string)=>Promise<void>;
  readonly autonomy?:{readonly repo:ProjectAutonomyRepository;readonly runId:string;readonly plannedTaskId:string};
  readonly mode:string;readonly cwd:string;readonly sessionManager:{getSessionId():string|undefined};
  readonly ui:ControlledUI;
}
export interface ProductionRunResult {readonly outcome:'COMPLETED'|'NOT_CONFIRMED'|'REWORK_REQUIRED'|'BLOCKED'|'FAILED';readonly taskId:string}
export interface ProductionTaskInputStatus {readonly source:'host-control-plane';readonly path:string;readonly exists:boolean;readonly valid:boolean;readonly specHash?:string}
export class ProductionTaskInputError extends Error{
  constructor(readonly code:'CONTROLLED_DEV_TASK_INPUT_MISSING'|'CONTROLLED_DEV_TASK_INPUT_INVALID'|'CONTROLLED_DEV_TASK_BASELINE_INVALID',readonly expectedPath:string,readonly reasonCode?:BaselineDiagnostic['reasonCode']){
    super(`${{
      CONTROLLED_DEV_TASK_INPUT_MISSING:"No task prepared. Use /controlled-dev new.",
      CONTROLLED_DEV_TASK_INPUT_INVALID:"The saved task cannot be read, or the Pi profile is not separate from the project. See /controlled-dev status --technical; do not edit the data manually.",
      CONTROLLED_DEV_TASK_BASELINE_INVALID:"The project cannot be used as the task's starting point. Check the folder, initial Git commit and whether any changes need to be saved."
    }[code]}\n${code}\nExpected: ${expectedPath}`);
  }
}
declare const process:{readonly env:Readonly<Record<string,string|undefined>>};
const git=(repo:string,...args:string[])=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024,
  stdio:['ignore','pipe','pipe']}).trim();
const configRoot=()=>resolve(process.env.PI_CODING_AGENT_DIR??join(process.env.HOME??'', '.pi','agent'));
export function productionGreenfield(target:string):GreenfieldBootstrap{return new GreenfieldBootstrap(configRoot(),target,inspectArtifact)}
export function productionSourceProject(source:string,target:string):SourceProject{return new SourceProject(configRoot(),source,target,inspectArtifact)}
export function productionCurrentProject(root:string):CurrentProject{return new CurrentProject(root,configRoot(),inspectArtifact)}
export function productionProjectHasBaseline(ctx:Pick<ProductionCommandContext,'cwd'>):boolean {
 try{return git(ctx.cwd,'rev-parse','--show-toplevel')===realpathSync(ctx.cwd)&&!!git(ctx.cwd,'rev-parse','--verify','HEAD')}
 catch(error){if((error as {code?:string}).code==='ENOENT')throw Object.assign(new Error('GIT_EXECUTABLE_UNAVAILABLE'),{code:'GIT_EXECUTABLE_UNAVAILABLE',path:'git'});return false}
}
export function productionOpenProject(root:string):void {const git=new CandidateGit(realpathSync(root),configRoot());git.assertTarget(git.target(),git.head())}
export function productionProjectMemory(ctx:Pick<ProductionCommandContext,'cwd'>,create=false):ProjectMemoryRepository|undefined{
  return ProjectMemoryRepository.open(configRoot(),realpathSync(ctx.cwd),inspectArtifact,{create});
}
export function productionProjectPlanning(ctx:Pick<ProductionCommandContext,'cwd'>,create=false):ProjectPlanningRepository|undefined{
  return ProjectPlanningRepository.open(configRoot(),realpathSync(ctx.cwd),inspectArtifact,{create,memory:productionProjectMemory(ctx)});
}
export function productionIntegrationCheckpoints(ctx:Pick<ProductionCommandContext,'cwd'>,create=false):IntegrationCheckpointRepository|undefined{
  return IntegrationCheckpointRepository.open(configRoot(),realpathSync(ctx.cwd),inspectArtifact,{create,memory:productionProjectMemory(ctx)});
}
export function productionCandidatePromotion(ctx:Pick<ProductionCommandContext,'cwd'>):CandidatePromotionRepository|undefined{
  // Historical gate continuations may carry only UI/session context, with no project lookup.
  if(typeof ctx.cwd!=='string')return undefined;
  return CandidatePromotionRepository.open(configRoot(),realpathSync(ctx.cwd),inspectArtifact);
}
export async function withProductionPromotion<T>(ctx:ProductionCommandContext,action:(repo:CandidatePromotionRepository,taskId:string)=>Promise<T>,taskId?:string):Promise<T>{
  if(ctx.mode!=='tui'||!ctx.sessionManager.getSessionId())throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  const target=recoveryTarget(ctx,taskId??readProductionTaskInput(ctx).spec.taskId);if(!target)throw new Error('RECOVERY_TASK_NOT_FOUND');
  return CandidatePromotionRepository.withLease(configRoot(),realpathSync(ctx.cwd),inspectArtifact,async repo=>{
    const result=await action(repo,target.taskId);
    // All human projections precede the seal. Rebuilding timestamped plan views
    // afterward would invalidate an otherwise exact portable checkpoint.
    rebuildProductionHumanView(ctx,target.taskId);const planning=productionProjectPlanning(ctx);if(planning)rebuildProjectPlanningView(planning);
    if(readProjectCustodian(repo.repoRoot)){
      const manager=repo.options.manager!,workspaceLock=repo.options.workspaceLock!,storage=resolveProjectStorage(configRoot(),repo.repoRoot);
      const descriptors=[...currentProjectHandoffCandidatePaths(repo.repoRoot)],ledger=DurableStore.load(target.storeRoot);
      if(ledger.state.candidate){
        const checkpoint=(()=>{try{return verifyCandidateCheckpoint(repo.repoRoot,target.storeRoot,configRoot(),ledger.state)}catch(error){
          if((error as {code?:string}).code!=='ENOENT')throw error;
          return captureCandidateCheckpoint(repo.repoRoot,target.storeRoot,configRoot(),{manager,workspaceLock});}})();
        for(let i=descriptors.length-1;i>=0;i--)if(descriptors[i].startsWith(`candidates/${target.taskId}/checkpoints/`))descriptors.splice(i,1);
        descriptors.push(`candidates/${target.taskId}/checkpoints/${checkpoint.descriptorDigest}.json`);
      }
      const tasks=join(storage.projectRoot,'tasks'),verify=projectQuiescenceCheck(tasks,manager,workspaceLock);verify();
      const proofOnly=()=>{for(const id of readdirSync(tasks)){const loaded=DurableStore.load(join(tasks,id));if(loaded.truncatedTailBytes||loaded.state.runs.some(run=>!runQuiescent(run)))throw new Error('PROJECT_HANDOFF_NOT_QUIESCENT')}};
      releaseProjectHandoff({repoRoot:repo.repoRoot,manager,workspaceLock,candidateDescriptors:descriptors,assertQuiescent:proofOnly,
        retireAuthority:()=>repo.retireForProjectTransfer()});
    }
    return result;
  });
}
/** Orderly close without an active workflow still saves project changes.
 * No old approval is reused; an uncertain task prevents transfer release. */
export async function releaseProductionProjectStorage(ctx:Pick<ProductionCommandContext,'cwd'>):Promise<void>{
  const storage=resolveProjectStorage(configRoot(),realpathSync(ctx.cwd));if(!storage.custodian)return;
  await CandidatePromotionRepository.withLease(configRoot(),storage.repoRoot,inspectArtifact,async repo=>{
    const manager=repo.options.manager!,workspaceLock=repo.options.workspaceLock!,tasks=join(storage.projectRoot,'tasks');
    const ids=(()=>{try{return readdirSync(tasks).sort()}catch(error){if((error as {code?:string}).code==='ENOENT')return [];throw error}})();
    const proofOnly=()=>{
      const current=(()=>{try{return readdirSync(tasks).sort()}catch(error){if((error as {code?:string}).code==='ENOENT')return [];throw error}})();
      if(canonicalize(current)!==canonicalize(ids))throw new Error('PROJECT_HANDOFF_SOURCE_CHANGED');
      for(const id of ids){
        if(!validateScalar('ID',id).ok)throw new Error('PROJECT_STORAGE_PATH_INVALID');
        const root=join(tasks,id),stat=lstatSync(root);
        if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(root)!==root)throw new Error('PROJECT_STORAGE_PATH_INVALID');
        const ledger=DurableStore.load(root);
        if(ledger.truncatedTailBytes||ledger.state.runs.some(run=>!runQuiescent(run)))throw new Error('PROJECT_HANDOFF_ROLE_NOT_QUIESCENT');
      }
    };
    const verify=projectQuiescenceCheck(tasks,manager,workspaceLock);verify();proofOnly();
    const descriptors=[...currentProjectHandoffCandidatePaths(storage.repoRoot)];
    for(const id of ids){
      const root=join(tasks,id),ledger=DurableStore.load(root);
      if(ledger.state.candidate){
        const saved=captureCandidateCheckpoint(storage.repoRoot,root,configRoot(),{manager,workspaceLock});
        for(let i=descriptors.length-1;i>=0;i--)if(descriptors[i].startsWith(`candidates/${id}/checkpoints/`))descriptors.splice(i,1);
        descriptors.push(`candidates/${id}/checkpoints/${saved.descriptorDigest}.json`);
      }
      rebuildHumanView(root,{machineDataRoot:configRoot()});
    }
    const planning=productionProjectPlanning(ctx);if(planning)rebuildProjectPlanningView(planning);
    proofOnly();releaseProjectHandoff({repoRoot:storage.repoRoot,manager,workspaceLock,assertQuiescent:proofOnly,candidateDescriptors:descriptors,
      retireAuthority:()=>repo.retireForProjectTransfer()});
  },undefined,{retainLeaseOnFailure:true});
}
/** Reuse decoded terminal proofs only while every authoritative task byte and
 * physical file identity still matches the initially verified namespace. */
function projectQuiescenceCheck(tasksRoot:string,manager:LockManager,lock:import('./lock-manager.js').LockHandle):()=>void{
  let verified:string|undefined;
  const fingerprint=()=>{
    const entries:unknown[]=[];let total=0;
    const walk=(path:string)=>{
      const stat=lstatSync(path);
      if(stat.isSymbolicLink()||realpathSync(path)!==path)throw new Error('PROJECT_HANDOFF_SOURCE_CHANGED');
      entries.push([relative(tasksRoot,path),stat.mode,stat.dev,stat.ino,stat.nlink,stat.size,String(stat.mtimeMs),String(stat.ctimeMs)]);
      if(entries.length>100000)throw new Error('PROJECT_HANDOFF_LIMIT');
      if(stat.isDirectory()){for(const name of readdirSync(path).sort())walk(join(path,name));return}
      if(!stat.isFile()||stat.nlink!==1||stat.size>64*1024*1024)throw new Error('PROJECT_HANDOFF_SOURCE_CHANGED');
      const raw=readFileSync(path);total+=raw.byteLength;if(total>1024*1024*1024)throw new Error('PROJECT_HANDOFF_LIMIT');
      entries.push([raw.byteLength,hashBytes(raw)]);
    };
    try{walk(tasksRoot)}catch(error){if((error as {code?:string}).code==='ENOENT'&&entries.length===0)return hashCanonical([]);throw error}
    return hashCanonical(entries);
  };
  return ()=>{
    if(!manager.verifyWorkspaceLock(lock))throw new Error('PROJECT_HANDOFF_LEASE_LOST');
    const before=fingerprint();
    if(verified!==undefined){if(before!==verified)throw new Error('PROJECT_HANDOFF_SOURCE_CHANGED');return}
    let names:string[];try{names=readdirSync(tasksRoot)}catch(error){if((error as {code?:string}).code==='ENOENT')names=[];else throw error}
    for(const id of names){const ledger=DurableStore.load(join(tasksRoot,id));if(ledger.truncatedTailBytes||ledger.state.runs.some(run=>!runQuiescent(run)))throw new Error('PROJECT_HANDOFF_ROLE_NOT_QUIESCENT')}
    if(fingerprint()!==before||!manager.verifyWorkspaceLock(lock))throw new Error('PROJECT_HANDOFF_SOURCE_CHANGED');
    verified=before;
  };
}
/** The sole project adoption path: native confirmation, one existing lease and
 * verified saved role results before moving the existing collection. */
export async function adoptProductionProject(ctx:ProductionCommandContext):Promise<boolean>{
  if(ctx.mode!=='tui'||!ctx.sessionManager.getSessionId())throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  const repoRoot=realpathSync(ctx.cwd),machineDataRoot=configRoot();
  return CandidatePromotionRepository.withLease(machineDataRoot,repoRoot,inspectArtifact,async promotion=>{
    const planning=productionProjectPlanning(ctx);if(!planning)throw new Error('PROJECT_HANDOFF_PROJECT_MISSING');
    const manager=promotion.options.manager!,workspaceLock=promotion.options.workspaceLock!;
    const tasksRoot=join(planning.projectRoot,'tasks');
    const taskRoots=(()=>{try{return readdirSync(tasksRoot).sort().map(id=>join(tasksRoot,id))}catch(error){if((error as {code?:string}).code==='ENOENT')return [];throw error}})();
    const assertQuiescent=projectQuiescenceCheck(tasksRoot,manager,workspaceLock);
    assertQuiescent();
    const proposal=prepareProjectHandoff({repoRoot,machineDataRoot});
    const receipt=await presentTrustedConfirmation(ctx,projectHandoffRequest(proposal));if(!receipt)return false;
    await showHostOperation(ctx,"Verifying history and moving project data");
    const capability=authorizeProjectHandoff(proposal,receipt,{store:planning.store,manager,workspaceLock,assertQuiescent});
    completeProjectHandoff(capability,{captureCandidates:cap=>taskRoots.flatMap(root=>{
      if(!DurableStore.load(root).state.candidate)return [];
      return [captureCandidateCheckpointStaging(cap,root,{manager,workspaceLock}).descriptorRelativePath];
    })});
    ctx.ui.notify(`Project saved in its own folder. The existing collection is now in ${join(repoRoot,'Documentazione')}. The plan, tasks, evidence and working versions are preserved; credentials and processes remain on this machine.`,'info');
    return true;
  });
}
export async function recoverProductionProjectHandoff(ctx:ProductionCommandContext):Promise<boolean>{
  if(ctx.mode!=='tui'||!ctx.sessionManager.getSessionId())throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  const repoRoot=realpathSync(ctx.cwd),machineDataRoot=configRoot();
  const manager=new LockManager(machineDataRoot,`candidate-promotion-${randomUUID()}`,`handoff-${randomUUID()}`),workspaceLock=manager.acquireWorkspace(repoRoot);
  try{
    const proposal=prepareProjectHandoffRecovery({repoRoot,machineDataRoot}),store=openHandoffReceiptStore(proposal,inspectArtifact);
    const tasksRoot=join(dirname(store.root),'tasks');
    const assertQuiescent=projectQuiescenceCheck(tasksRoot,manager,workspaceLock);
    assertQuiescent();const receipt=await presentTrustedConfirmation(ctx,projectHandoffRequest(proposal));if(!receipt)return false;
    await showHostOperation(ctx,"Verifying and recovering the interrupted move");
    const result=recoverProjectHandoff(authorizeProjectHandoff(proposal,receipt,{store,manager,workspaceLock,assertQuiescent}));
    ctx.ui.notify(result.action==='COMPLETED'?"Move completed: the collection and state are in the project folder.":"Move canceled and original collection preserved. You can review the move before retrying.",'info');return true;
  }finally{manager.release(workspaceLock)}
}
async function freezeProductionCandidate(ctx:ProductionCommandContext,taskId:string):Promise<void>{
  await showHostOperation(ctx,"Preparing the verified version for integration");
  const repo=productionCandidatePromotion(ctx);if(!repo?.binding(taskId))return;
  try{let explanation='';await withProductionPromotion(ctx,async held=>{held.freeze(taskId);explanation=held.status(taskId).explanation},taskId);
    ctx.ui.notify(explanation+(ctx.autonomy?" Local integration specified by policy.":" Use Integrate into project in the menu."),'info');
  }catch(error){ctx.ui.notify(`Task completed; saving the verified version in Git requires attention: ${(error as {code?:string;message:string}).code??(error as Error).message}. No integration applied.`,'warning')}
}
export function inspectArtifact(content:Uint8Array):'ACCEPT'|'REJECT'{
  if(content.byteLength>64*1024*1024)return 'REJECT';
  const text=Buffer.from(content).toString('utf8');
  return /SYNTHETIC_SECRET|FULL_TRANSCRIPT|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)?'REJECT':'ACCEPT';
}

const inside=(root:string,path:string)=>{const r=relative(root,path);return r===''||(!r.startsWith('..')&&!r.startsWith('/'))};
function expectedTaskPath(ctx:Pick<ProductionCommandContext,'cwd'>):{repo:string;path:string;data:string}{
  const repo=realpathSync(ctx.cwd),data=configRoot();
  if(inside(repo,data)||inside(data,repo))throw new ProductionTaskInputError('CONTROLLED_DEV_TASK_INPUT_INVALID',join(data,'controlled-dev','control',hashBytes(Buffer.from(repo)),'task.json'));
  const path=join(resolveProjectStorage(data,repo).controlRoot,'task.json');
  return {repo,path,data};
}
function sourceBytes(source:InputSource,repo:string,path:string,historicalRepo=repo):Uint8Array{
  let raw:Uint8Array;
  if(source.inline!==undefined)raw=Buffer.from(source.inline,'utf8');
  else{
    if(!source.path||resolve(source.path)!==source.path||!inside(historicalRepo,source.path))throw new ProductionTaskInputError('CONTROLLED_DEV_TASK_INPUT_INVALID',path);
    const physical=historicalRepo===repo?source.path:join(repo,relative(historicalRepo,source.path));
    const stat=lstatSync(physical);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||realpathSync(physical)!==physical)
      throw new ProductionTaskInputError('CONTROLLED_DEV_TASK_INPUT_INVALID',path);
    raw=readFileSync(physical);
  }
  const ref=source.snapshot;
  if(ref.bytes!==raw.byteLength||ref.digest!==hashBytes(raw)||inspectArtifact(raw)!=='ACCEPT')
    throw new ProductionTaskInputError('CONTROLLED_DEV_TASK_INPUT_INVALID',path);
  return raw;
}
export function readProductionTaskInput(ctx:Pick<ProductionCommandContext,'cwd'>):{spec:TaskSpec;artifacts:readonly [ArtifactRef,Uint8Array][];path:string;repo:string}{
  const {repo,path,data}=expectedTaskPath(ctx);
  let stat,raw:Uint8Array;
  try{
    stat=lstatSync(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>256*1024)
      throw new ProductionTaskInputError('CONTROLLED_DEV_TASK_INPUT_INVALID',path);
    const anchor=resolveProjectStorage(data,repo).storageAnchor;
    for(let parent=dirname(path);;parent=dirname(parent)){
      const directory=lstatSync(parent);
      if(!directory.isDirectory()||directory.isSymbolicLink()||realpathSync(parent)!==parent)
        throw new ProductionTaskInputError('CONTROLLED_DEV_TASK_INPUT_INVALID',path);
      if(parent===anchor)break;
      if(parent===dirname(parent)||!inside(anchor,parent))throw new ProductionTaskInputError('CONTROLLED_DEV_TASK_INPUT_INVALID',path);
    }
    if(realpathSync(path)!==path)throw new ProductionTaskInputError('CONTROLLED_DEV_TASK_INPUT_INVALID',path);
    raw=readFileSync(path);
  }catch(error){
    if((error as {code?:string}).code==='ENOENT')throw new ProductionTaskInputError('CONTROLLED_DEV_TASK_INPUT_MISSING',path);
    throw new ProductionTaskInputError('CONTROLLED_DEV_TASK_INPUT_INVALID',path);
  }
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||realpathSync(path)!==path||inspectArtifact(raw)!=='ACCEPT')
    throw new ProductionTaskInputError('CONTROLLED_DEV_TASK_INPUT_INVALID',path);
  try{
    const input=parseJson(raw,256*1024),unique=new Map<string,[ArtifactRef,Uint8Array]>();
    const checked=validateStructure('TaskSpec',input);if(!checked.ok)throw new Error();
    const candidate=checked.value;
    const original=resolveProjectStorage(data,repo).custodian?.originalRepoRoot;
    if(![repo,original].includes(candidate.scope?.repoRoot)||!candidate.validationCommands?.some(command=>command.required))throw new Error();
    for(const source of [candidate.plan,candidate.currentTask]){
      const bytes=sourceBytes(source,repo,path,candidate.scope.repoRoot),ref=source.snapshot,prior=unique.get(ref.id);
      if(prior&&(hashBytes(prior[1])!==hashBytes(bytes)||canonicalize(prior[0])!==canonicalize(ref)))throw new Error();
      unique.set(ref.id,[ref,bytes]);
    }
    const records=[...unique.values()].map(([value])=>({id:value.id,kind:'ArtifactRef' as const,value}));
    const context:ValidationContext={records,modelExtracted:false},spec=freezeTaskSpec(input,context);
    return {spec,artifacts:[...unique.values()],path,repo};
  }catch(error){if(error instanceof ProductionTaskInputError)throw error;throw new ProductionTaskInputError('CONTROLLED_DEV_TASK_INPUT_INVALID',path)}
}
function ensureNewTaskAvailable(ctx:Pick<ProductionCommandContext,'cwd'>):void{
  const {repo,data,path}=expectedTaskPath(ctx),tasks=join(resolveProjectStorage(data,repo).projectRoot,'tasks');
  let names:string[]=[];try{names=readdirSync(tasks)}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error}
  for(const name of names){
    if(!validateScalar('ID',name).ok)throw new Error("Saved task unreadable. Use /controlled-dev status before creating another.");
    let state;try{state=DurableStore.load(join(tasks,name)).state}catch{throw new Error("A task requires recovery or repair. Use /controlled-dev status.");}
    if(!['COMPLETED','FAILED'].includes(state.state))throw new Error("A task is already in progress in this project. Use /controlled-dev status.");
  }
  try{
    const old=readProductionTaskInput(ctx).spec;
    if(!names.includes(old.taskId))throw new Error("A task is already ready to start. Use /controlled-dev run.");
  }catch(error){if(!(error instanceof ProductionTaskInputError)||error.code!=='CONTROLLED_DEV_TASK_INPUT_MISSING')throw error}
}
export function executablePath(input:string):string{
  const paths=input.startsWith('/')?[input]:(process.env.PATH??'').split(delimiter).filter(p=>p.startsWith('/')).map(p=>join(p,input));
  if(!input||(!input.startsWith('/')&&/[\\/\s]/.test(input)))throw new Error("Enter only the executable's name or path, without arguments.");
  for(const path of paths)try{const canonical=realpathSync(path);if(lstatSync(canonical).isFile()){accessSync(canonical,constants.X_OK);return canonical}}catch{}
  throw new Error("Verification command not found or not executable.");
}
/** Interactive command UI only. Task creation is not an implementation/completion approval. */
export async function createProductionTask(ctx:ProductionCommandContext,propose?:ProposeTask,planned?:{readonly seed:PlannedTaskSeed;readonly beforeSave:(spec:TaskSpec,manager:LockManager)=>void;readonly scoutResult?:PreTaskProposalResult}):Promise<TaskSpec|undefined>{
  if(ctx.mode!=='tui'||!ctx.ui.editor||!ctx.ui.select||!ctx.sessionManager.getSessionId())throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  if(ctx.prepareProjectBaseline&&!await ctx.prepareProjectBaseline())return;
  const {repo,data,path}=expectedTaskPath(ctx),session=ctx.sessionManager.getSessionId();
  const checkRepo=()=>{
    try{if(realpathSync(git(repo,'rev-parse','--show-toplevel'))!==repo)throw new Error();git(repo,'rev-parse','--verify','HEAD')}
    catch{throw new Error("Invalid Git repository: open a project's root directory with at least one commit.");}
    if(git(repo,'status','--porcelain=v1','--untracked-files=all'))throw new Error("The project has unsaved changes. Commit or set them aside before creating the task.");
  };
  checkRepo();ensureNewTaskAvailable(ctx);const initialHead=git(repo,'rev-parse','--verify','HEAD');
  if(!propose)throw new Error('PRE_TASK_SCOUT_UNAVAILABLE');
  const automatic=ctx.autonomy;
  if(automatic&&(!planned?.scoutResult||!isHostPreTaskProposal(planned.scoutResult)||planned.scoutResult.ambiguities.length||planned.scoutResult.risks.length))throw new Error('UNRESOLVED_RISK');
  let investigations:ContextInvestigationRepository|undefined;
  const seedBinding=planned?plannedSeedInvestigationBinding(planned.seed):undefined;
  const investigationFor=(objective:string,humanScope:readonly string[])=>(investigations??=ContextInvestigationRepository.open(data,repo,inspectArtifact)).bind({kind:'pre-task',
    subjectId:seedBinding?.subjectId??`request-${hashCanonical({objective})}`,scopeDigest:seedBinding?.scopeDigest??contextInvestigationScopeDigest(humanScope)});
  const proposal=automatic?proposalDraft(planned!.seed.objective,planned!.scoutResult!):await taskWizard(ctx.ui,propose,planned?{...planned.seed,compact:true}:undefined,investigationFor);if(!proposal)return;
  const {objective,scope:allowedPaths,criteria}=proposal;
  const commands=compileValidations(proposal,executablePath);
  const planText=[planned?.seed.designContext,wizardSummary(proposal)].filter(Boolean).join('\n\n');
  const confirmed=automatic?true:await confirmHumanDisplay(ctx,`${wizardSummary(proposal)}\n\nYou are creating this task with the specified files and checks. Another confirmation will be requested before files are changed.${planned?.seed.designContext?"\n\nPreviously planned project structure\n"+planned.seed.designContext:''}`,"Create the task?");
  if(ctx.sessionManager.getSessionId()!==session||realpathSync(ctx.cwd)!==repo)throw new Error("The session changed: creation canceled.");
  if(!confirmed)return;
  // Direct creation requires confirmation; autonomous creation requires the separate exact policy admission below.
  const source=(id:string,inline:string):InputSource=>({schemaVersion:1,inline,snapshot:{schemaVersion:1,id,digest:hashBytes(Buffer.from(inline)),
    relativeStorePath:`artifacts/${id}`,bytes:Buffer.byteLength(inline,'utf8'),mediaType:'text/plain'}});
  const plan=source('plan-snapshot',planText),currentTask=source('task-snapshot',objective);
  const draft:TaskSpec={schemaVersion:1,taskId:`task-${randomUUID()}`,specRevision:0,title:[...objective].slice(0,120).join(''),objective,plan,currentTask,
    requirements:[{schemaVersion:1,id:'requirement-1',text:objective}],
    acceptanceCriteria:criteria.map((text,i)=>({schemaVersion:1,id:`criterion-${i+1}`,requirementIds:['requirement-1'],text,method:'REVIEW',commandIds:[],reviewInstruction:text})),
    scope:{schemaVersion:1,repoRoot:repo,baseRef:'HEAD',allowedPaths,deniedPaths:automatic?[...automatic.repo.policy(automatic.repo.run(automatic.runId)).taskBounds.find(b=>b.plannedTaskId===automatic.plannedTaskId)!.protectedPaths]:[],strongConfinementRequired:false},
    constraints:[...proposal.architectureFindings.map(value=>`Architecture finding: ${value}`),...proposal.designExpectations.map(value=>`Design expectation: ${value}`)],validationCommands:commands,
    humanGates:{schemaVersion:1,beforeImplementation:true,onScopeChange:true,onOracleDecision:true,beforeCompletion:true,onRetryExhausted:true},
    retryPolicy:{schemaVersion:1,maxReworkAttempts:2,maxInfrastructureRetries:1,maxDispatches:8,maxEscalationEpisodes:1},specHash:'0'.repeat(64)};
  const spec=freezeTaskSpec({...draft,specHash:hashContract('TaskSpec',draft)},
    {records:[plan,currentTask].map(s=>({id:s.snapshot.id,kind:'ArtifactRef',value:s.snapshot})),modelExtracted:false});
  const admission=automatic?automatic.repo.authorize(automatic.runId,'TaskSpec',{plannedTaskId:automatic.plannedTaskId,spec,scout:planned!.scoutResult!} as any):undefined;
  const encoded=Buffer.from(canonicalize(spec),'utf8');
  if(encoded.byteLength>256*1024||inspectArtifact(encoded)!=='ACCEPT')throw new Error("The task is too large or contains data that cannot be exported safely.");
  const manager=new LockManager(data,session!,`new-${randomUUID()}`);
  withLockMutation(manager.root,manager.workspaceIdentity(repo).workspaceHash,()=>{
    checkRepo();ensureNewTaskAvailable(ctx);
    if(git(repo,'rev-parse','--verify','HEAD')!==initialHead)throw new Error("The project changed during task preparation.");
    for(const p of [dirname(dirname(path)),dirname(path)]){
      try{mkdirSync(p,{mode:0o700})}catch(error){if((error as {code?:string}).code!=='EEXIST')throw error}
      const st=lstatSync(p);if(!st.isDirectory()||st.isSymbolicLink()||realpathSync(p)!==p)throw new Error('CONTROLLED_DEV_TASK_INPUT_INVALID');
      const fd=openSync(dirname(p),'r');try{fsyncSync(fd)}finally{closeSync(fd)}
    }
    if(admission)consumePolicyCapability(admission,'TaskSpec',admission.authorization.subject,automatic!.repo.store);
    planned?.beforeSave(spec,manager);
    const temp=join(dirname(path),`task-${randomUUID()}.tmp`),fd=openSync(temp,'wx',0o600);
    try{writeFileSync(fd,encoded);fsyncSync(fd)}finally{closeSync(fd)}
    renameSync(temp,path);const dir=openSync(dirname(path),'r');try{fsyncSync(dir)}finally{closeSync(dir)}
  });
  if(admission){const resultRef=automatic!.repo.store.put(`created-spec-${spec.specHash}`,canonicalize(spec),'application/json');automatic!.repo.recordEffect(admission.ref,[resultRef]);}
  if(!automatic)ctx.ui.notify(planned?"Task prepared from the plan. The original project was not modified.":"Task prepared. Use /controlled-dev run to start it. The original project was not modified.",'info');return spec;
}

export function inspectProductionTaskInput(ctx:Pick<ProductionCommandContext,'cwd'>):ProductionTaskInputStatus{
  const {path}=expectedTaskPath(ctx);
  try{const {spec}=readProductionTaskInput(ctx);return Object.freeze({source:'host-control-plane',path,exists:true,valid:true,specHash:spec.specHash})}
  catch(error){return Object.freeze({source:'host-control-plane',path,exists:error instanceof ProductionTaskInputError&&error.code!=='CONTROLLED_DEV_TASK_INPUT_MISSING',valid:false})}
}
export interface BaselineDiagnostic {
  readonly repoRoot:string;readonly canonicalRepoRoot:string|null;readonly baseRef:string;
  readonly resolvedBaseCommit:string|null;readonly headCommit:string|null;readonly currentBranch:string|null;
  readonly gitStatus:string|null;readonly indexState:string|null;readonly untrackedState:string|null;readonly ignoredState:string|null;
  readonly expectedPredicate:string;readonly reasonCode:'PASS'|'REPO_ROOT_UNAVAILABLE'|'HEAD_UNRESOLVED'|'BASE_REF_UNRESOLVED'|'BASE_COMMIT_MISMATCH';
}
/** Read-only host diagnostic. Status classes are observations, not new baseline admission rules.
 * In particular, PASS here does not bypass the stricter P7/P11 workspace checks. */
export function diagnoseProductionBaseline(repoRoot:string,baseRef:string):BaselineDiagnostic{
  const observe=(...args:string[]):string|null=>{try{return git(repoRoot,...args).slice(0,4096)}catch{return null}};
  let canonicalRepoRoot:string|null=null;try{canonicalRepoRoot=realpathSync(repoRoot)}catch{}
  const headCommit=observe('rev-parse','--verify','HEAD'),resolvedBaseCommit=observe('rev-parse','--verify',`${baseRef}^{commit}`);
  const reasonCode=!canonicalRepoRoot?'REPO_ROOT_UNAVAILABLE':!headCommit?'HEAD_UNRESOLVED':!resolvedBaseCommit?'BASE_REF_UNRESOLVED'
    :headCommit!==resolvedBaseCommit?'BASE_COMMIT_MISMATCH':'PASS';
  return Object.freeze({repoRoot,canonicalRepoRoot,baseRef,headCommit,resolvedBaseCommit,
    currentBranch:observe('symbolic-ref','-q','HEAD'),gitStatus:observe('status','--porcelain=v1','--untracked-files=all'),
    indexState:observe('diff','--cached','--name-status'),untrackedState:observe('ls-files','--others','--exclude-standard'),
    ignoredState:observe('ls-files','--others','--ignored','--exclude-standard'),
    expectedPredicate:'resolve(baseRef^{commit}) === resolve(HEAD); both commands succeed',reasonCode});
}
function productionTaskInput(ctx:Pick<ProductionCommandContext,'cwd'>):ReturnType<typeof readProductionTaskInput>&{baselineCommit:string}{
  const input=readProductionTaskInput(ctx);
  if(input.spec.scope.repoRoot!==input.repo)throw new Error('PROJECT_REBIND_REQUIRED');
  const diagnostic=diagnoseProductionBaseline(input.repo,input.spec.scope.baseRef);
  if(diagnostic.reasonCode!=='PASS')throw new ProductionTaskInputError('CONTROLLED_DEV_TASK_BASELINE_INVALID',input.path,diagnostic.reasonCode);
  return {...input,baselineCommit:diagnostic.headCommit!};
}

function recoveryTarget(ctx:ProductionCommandContext,taskId?:string,observe?:(ledger:ReturnType<typeof DurableStore.load>)=>void){
  const {repo,data}=expectedTaskPath(ctx),tasks=join(resolveProjectStorage(data,repo).projectRoot,'tasks');
  if(taskId&&!validateScalar('ID',taskId).ok)throw new Error('RECOVERY_TASK_INVALID');
  const storageAnchor=resolveProjectStorage(data,repo).storageAnchor;
  const checkDirectory=(leaf:string)=>{for(let path=leaf;path!==dirname(storageAnchor);path=dirname(path)){
    const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(path)!==path)throw new Error('RECOVERY_PATH_INVALID');
  }};
  let names:string[];try{checkDirectory(tasks);names=readdirSync(tasks)}catch(error){if((error as {code?:string}).code==='ENOENT')return undefined;throw error}
  for(const name of names){if(!validateScalar('ID',name).ok)throw new Error('RECOVERY_TASK_INVALID');checkDirectory(join(tasks,name))}
  if(!taskId){
    const active=names.filter(name=>{try{return !['COMPLETED','FAILED'].includes(DurableStore.load(join(tasks,name)).state.state)}catch{return true}});
    const choices=active.length?active:names;if(!choices.length)return undefined;if(choices.length!==1)throw new Error("Explicitly select the repository task to recover.");taskId=choices[0];
  }
  if(!names.includes(taskId))throw new Error('RECOVERY_TASK_NOT_FOUND');
  const storeRoot=join(tasks,taskId);
  try{const ledger=DurableStore.load(storeRoot);if(ledger.state.repoRoot!==repo)throw new Error('RECOVERY_REPO_MISMATCH');observe?.(ledger)}
  catch(error){if((error as Error).message==='RECOVERY_REPO_MISMATCH')throw error}
  return {data,storeRoot,taskId};
}
const stateLabels:Record<string,string>={PENDING:"Task ready",ANALYZING:"Task analysis",READY:"Analysis approved",IMPLEMENTING:"Implementation in progress",
  TESTING:"Result verification",REVIEWING:"Independent review",REWORK:"Corrections required",BLOCKED:"Task blocked",AWAITING_HUMAN:"Waiting for your confirmation",COMPLETED:"Completed",FAILED:"Ended without completion"};
const display=(text:string)=>text.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,1000);
/** Presentation only: progress ticks must never reload ledgers or run Git/proofs. */
export function renderProductionProgress(current?:Pick<CentralOrchestrator,'state'|'humanGateStatus'>&Partial<Pick<CentralOrchestrator,'spec'>>,taskId?:string,operation="Preparing the task"):string{
  if(!current)return `Status: ${display(operation)}`;
  const state=current.state;if(taskId&&taskId!==state.taskId)return `Status: ${display(operation)}`;
  const gate=state.state==='AWAITING_HUMAN'?current.humanGateStatus():undefined;
  const label=gate&&['APPROVED','CONSUMED'].includes(gate.status)
    ?gate.type==='beforeCompletion'?"Final checks and save":gate.type==='beforeReviewerRedispatch'?"Preparing independent review":"Checking authorization"
    :stateLabels[state.state]??display(state.state);
  return `Status: ${label}${current.spec?.objective?`\nObjective: ${display(current.spec.objective)}`:''}`;
}
export function renderProductionStatus(ctx:ProductionCommandContext,current?:CentralOrchestrator,taskId?:string):string{
  if(current&&(!taskId||taskId===current.state.taskId))return withIntegrationSummary(ctx,current.state.taskId,renderTaskSummary({state:current.state,events:current.events,records:current.context().records,truncatedTailBytes:0},true));
  let input:ReturnType<typeof readProductionTaskInput>|undefined;try{input=readProductionTaskInput(ctx)}catch{}
  let target:ReturnType<typeof recoveryTarget>;
  try{target=recoveryTarget(ctx,taskId??current?.state.taskId??input?.spec.taskId)}catch(error){
    if((error as Error).message!=='RECOVERY_TASK_NOT_FOUND'||taskId)throw error;
  }
  if(!target){
    if(input)return `Objective: ${display(input.spec.objective)}\nStatus: Task ready to start\nLast completed step: Task preparation\nWorking version: none\nConfirmation required: before changing code\nRecovery required: no\nCompletion: not reached yet\nUse /controlled-dev run.`;
    return "No Controlled Dev task in progress in this project.\nUse /controlled-dev new.";
  }
  const repair=classifyStore(target.data,target.storeRoot);let ledger:ReturnType<typeof DurableStore.load>;
  try{ledger=DurableStore.load(target.storeRoot)}catch{
    if(repair.classification==='REPAIRABLE')return "Saving the task was interrupted.\nThe available data is sufficient to reconstruct its state after checking the responsible processes.\nUse /controlled-dev repair. No automatic resume.";
    if(repair.classification==='AMBIGUOUS')return "The outcome of a previous task cannot be determined with certainty.\nThe task remains blocked. Do not remove data or protective locks, and do not start a new agent.\nUse /controlled-dev status --technical for details.";
    return "The saved task state contains missing or inconsistent data.\nThe task cannot be resumed safely. Preserve the data and consult /controlled-dev status --technical.";
  }
  const storageResumeHint=releasedProjectResumeHint(ctx,target,ledger);
  return withIntegrationSummary(ctx,ledger.state.taskId,renderTaskSummary(ledger,false,repair,classifyResumeAction(target.data,target.storeRoot),storageResumeHint));
}
function withIntegrationSummary(ctx:ProductionCommandContext,taskId:string,summary:string):string{
  if(typeof ctx.cwd!=='string')return summary;
  const promotion=productionCandidatePromotion(ctx);if(!promotion?.binding(taskId))return summary;const view=promotion.status(taskId);
  if(view.baselineReady)summary=summary.replace("Changes are in the working copy. The original project was not modified.","Verified changes are available in the original project folder.").replace("The original repository is unchanged.","The result is available in the current project version.");
  return summary+`\n\nProject integration\n${view.explanation}\nDestination: ${view.binding!.targetRef.slice('refs/heads/'.length)}`;
}
export function productionStatusPages(ctx:ProductionCommandContext,current?:CentralOrchestrator,taskId?:string):StatusPages {
  const input=(()=>{try{return readProductionTaskInput(ctx).spec}catch{return undefined}})();
  let ledger:ReturnType<typeof DurableStore.load>|undefined;
  if(current&&(!taskId||taskId===current.state.taskId))ledger={state:current.state,events:current.events,records:current.context().records,truncatedTailBytes:0};
  else try{recoveryTarget(ctx,taskId??input?.taskId,value=>{ledger=value})}catch{}
  let storeRoot:string|undefined;
  if(ledger)try{storeRoot=recoveryTarget(ctx,ledger.state.taskId)?.storeRoot}catch{}
  const artifact=(id:string):unknown=>{
    if(!storeRoot||!ledger)return undefined;
    const record=ledger.records.find(value=>value.id===id&&value.kind==='ArtifactRef');
    if(record?.kind!=='ArtifactRef'||record.value.relativeStorePath!==`artifacts/${id}`||record.value.bytes>32*1024)return undefined;
    try{const raw=readFileSync(join(storeRoot,record.value.relativeStorePath));if(hashBytes(raw)!==record.value.digest)return undefined;
      return parseJson(raw,32*1024)}catch{return undefined}
  };
  const runtimeFor=(id:string):{evidence?:RuntimeEvidence;comparison?:RuntimeComparison}=>{
    const event=ledger?.events.findLast(value=>value.kind==='RECORD'&&value.recordType==='VALIDATION_RECORDED'&&value.evidenceRefs.includes(id));
    const evidenceId=event?.evidenceRefs.find(value=>value.startsWith('runtime-evidence-'));
    const comparisonId=event?.evidenceRefs.find(value=>value.startsWith('runtime-comparison-'));
    return {evidence:evidenceId?artifact(evidenceId) as RuntimeEvidence|undefined:undefined,
      comparison:comparisonId?artifact(comparisonId) as RuntimeComparison|undefined:undefined};
  };
  // A verified terminal ledger needs no recovery classification. Share the same
  // snapshot across all pages instead of repeatedly loading every artifact.
  const spec=ledger?.records.find(r=>r.kind==='TaskSpec'&&r.id===ledger!.state.spec.id)?.value as TaskSpec|undefined??input;
  const terminal=ledger&&!ledger.truncatedTailBytes&&['COMPLETED','FAILED'].includes(ledger.state.state);
  const overview=terminal?withIntegrationSummary(ctx,ledger!.state.taskId,[
    "Objective",display(spec?.objective??"unavailable"),'',
    "Task status",ledger!.state.state==='COMPLETED'?"Completed":"Incomplete",
    ledger!.state.state==='COMPLETED'?"Last step: final verification and confirmations":"Last step: closing the task",'',
    "Result",ledger!.state.state==='COMPLETED'
      ?`Verified changes in the working copy (version ${ledger!.state.candidate?.generation??"unavailable"}).`
      :"The task ended without completion. Consult Activity and Checks.",
    productionCandidatePromotion(ctx)?.status(ledger!.state.taskId).baselineReady?"The result is available in the current project version.":"The original repository is unchanged.",'',
    "Confirmations and recovery","No pending confirmations.","Recovery not required.",
  ].join('\n')):renderProductionStatus(ctx,current,taskId);
  const activityLines:string[]=[];let validationNumber=0;
  for(const event of ledger?.events.slice(-80)??[]){
    let label:string|undefined;
    if(event.kind==='CREATE')label="Task prepared";
    else if(event.kind==='TRANSITION'){
      if(event.targetState==='ANALYZING')label="Scout · Task analysis started";
      else if(event.targetState==='READY')label=event.sourceState==='AWAITING_HUMAN'?"Implementation authorized":"Scout · Analysis completed";
      else if(event.targetState==='IMPLEMENTING')label="Developer · Implementation started";
      else if(event.targetState==='TESTING')label="Working copy checks started";
      else if(event.targetState==='REVIEWING'){
        const gate=(event.evidenceRefs??[]).map(id=>ledger?.records.find(r=>r.id===id&&r.kind==='HumanGate')).find(r=>r?.kind==='HumanGate');
        label=event.sourceState!=='AWAITING_HUMAN'?"Reviewer · Review started":gate?.kind==='HumanGate'&&gate.value.type==='beforeReviewerRedispatch'
          ?"New Reviewer authorized":"Completion authorized";
      }
      else if(event.targetState==='AWAITING_HUMAN')label=event.sourceState==='READY'?"Awaiting implementation authorization":"Awaiting final confirmation";
      else label=stateLabels[event.targetState]??event.targetState;
    }else if(event.kind==='RECORD'){
      if(event.recordType==='CANDIDATE_MATERIALIZED')label="Developer · Working copy produced";
      else if(event.recordType==='VALIDATION_RECORDED'){
        validationNumber++;
        const result=ledger?.records.find(r=>r.kind==='ValidationResult'&&event.evidenceRefs.includes(r.id));
        label=`Check ${validationNumber} · ${result?.kind==='ValidationResult'?result.value.status==='PASSED'?"passed":result.value.status==='FAILED'?"failed":"inconclusive outcome":"recorded outcome"}`;
        if(event.evidenceRefs.some(id=>id.startsWith('runtime-evidence-')))activityLines.push("Runtime events collected for this check");
      }else if(event.recordType==='REVIEW_RECORDED'){
        const result=ledger?.records.find(r=>r.kind==='ReviewResult'&&event.evidenceRefs.includes(r.id));
        label=`Reviewer · ${result?.kind==='ReviewResult'?result.value.verdict:"recorded outcome"}`;
      }else if(event.recordType==='GATE_DECIDED'){const gate=ledger?.records.find(r=>r.kind==='HumanGate'&&event.evidenceRefs.includes(r.id));label=gate?.kind==='HumanGate'&&gate.value.authorizationKind==='PolicyDerivedAuthorization'?"Authorization from the approved plan recorded":"Human confirmation recorded";}
    }
    if(label)activityLines.push(label);
  }
  const activity=activityLines.join('\n\n')||"No execution activity recorded.";
  const checks:string[]=[];
  if(spec?.acceptanceCriteria?.length)checks.push("Acceptance criteria",...spec.acceptanceCriteria.map(criterion=>`• ${display(criterion.text)} (${criterion.method==='REVIEW'?'Reviewer':"automated check"})`),'');
  if(spec?.validationCommands?.length)checks.push("Automated checks");
  for(const command of spec?.validationCommands??[]){
    const record=ledger?.records.findLast(r=>r.kind==='ValidationResult'&&r.value.commandId===command.id&&ledger!.state.validations.includes(r.id)
      &&r.value.specHash===ledger!.state.specHash&&r.value.candidateDigest===ledger!.state.candidate?.digest&&r.value.candidateGeneration===ledger!.state.candidate?.generation&&!ledger!.state.invalidEvidenceIds.includes(r.id));
    checks.push(`• Check ${command.id.replace('validation-','')}: ${record?.kind==='ValidationResult'?record.value.status==='PASSED'?"passed":record.value.status==='FAILED'?"failed":"inconclusive outcome":"not executed on the current working copy"}`);
    if(record?.kind==='ValidationResult'&&record.value.reason.startsWith("Check "))checks.push(display(record.value.reason));
    if(record?.kind==='ValidationResult'){
      const runtime=runtimeFor(record.id);
      if(runtime.evidence){
        checks.push(`  Runtime events: ${runtime.evidence.eventCount}. ${runtime.evidence.complete?"Complete evidence.":"Incomplete evidence: outcome cannot be inferred."}`);
        if(record.value.status!=='PASSED')checks.push(...runtime.evidence.diagnosis.observed.map(text=>`  Observed: ${display(text)}`),
          ...runtime.evidence.diagnosis.inferred.map(text=>`  Hypothesis: ${display(text)}`),
          ...runtime.evidence.diagnosis.unknown.map(text=>`  To verify: ${display(text)}`));
      }
      if(runtime.comparison)checks.push(`  Same scenario, before/after: ${runtime.comparison.conclusion==='RESOLVED'?"the symptom does not recur":runtime.comparison.conclusion==='PERSISTS'?"the symptom persists":"inconclusive comparison"}.`);
    }
  }
  const scenarioRecords=ledger?.records.filter(record=>record.kind==='ArtifactRef'&&record.value.mediaType===SCENARIO_MEDIA_TYPE)
    .map(record=>artifact(record.id)).filter(validateExecutableScenario)??[];
  const scenarioRuns=ledger?.records.filter(record=>record.kind==='ArtifactRef'&&record.value.mediaType===SCENARIO_RUN_MEDIA_TYPE)
    .map(record=>artifact(record.id)).filter(validateScenarioRun)??[];
  const evidenceBundles=ledger?.records.filter(record=>record.kind==='ArtifactRef'&&record.value.mediaType===EVIDENCE_BUNDLE_MEDIA_TYPE)
    .map(record=>artifact(record.id)).filter(validateTechnicalEvidenceBundle)??[];
  if(scenarioRecords.length)checks.push('',"Executable scenarios");
  for(const scenario of scenarioRecords){
    const runs=scenarioRuns.filter(run=>run.scenarioHash===scenario.scenarioHash),latest=runs.at(-1),evidence=evidenceBundles.some(bundle=>bundle.scenarioHash===scenario.scenarioHash);
    checks.push(`• Scenario: ${display(scenario.title)}`,`  Latest execution: ${latest?.result??"not executed"}`,`  Executions: ${runs.length}`,`  Evidence: ${evidence?"available":"unavailable"}`);
  }
  const review=ledger?.records.findLast(r=>r.kind==='ReviewResult'&&ledger!.state.reviews.includes(r.id)&&!ledger!.state.invalidEvidenceIds.includes(r.id));
  if(review?.kind==='ReviewResult')checks.push('',"Independent review",`• Reviewer: ${review.value.verdict}. The orchestrator decides completion.`);
  const runtimeRefs=ledger?.events.filter(value=>value.recordType==='VALIDATION_RECORDED').flatMap(value=>value.evidenceRefs.filter(id=>id.startsWith('runtime-')))??[];
  return {overview,activity,checks:checks.join('\n')||"No checks defined.",technical:JSON.stringify({taskId:ledger?.state.taskId??spec?.taskId,state:ledger?.state.state??'NO_RUN',revision:ledger?.state.revision,
    candidate:ledger?.state.candidate,runs:ledger?.state.runs,validations:spec?.validationCommands,runtimeEvidenceRefs:runtimeRefs,
    executableScenarios:scenarioRecords.map(value=>({scenarioId:value.scenarioId,version:value.version,scenarioHash:value.scenarioHash})),
    scenarioRuns:scenarioRuns.map(value=>({runId:value.runId,scenarioId:value.scenarioId,result:value.result,generation:value.candidateGeneration})),pendingGate:ledger?.state.pendingGateId},null,2)};
}

export function rebuildProductionHumanView(ctx:ProductionCommandContext,taskId?:string):ReturnType<typeof rebuildHumanView>{
  const input=(()=>{try{return readProductionTaskInput(ctx).spec}catch{return undefined}})();
  const target=recoveryTarget(ctx,taskId??input?.taskId);
  if(!target){const planning=productionProjectPlanning(ctx);if(planning&&!taskId)return {status:'CURRENT',taskId:'project',vaultRoot:humanVaultRoot(planning.projectRoot,planning.repoRoot),files:rebuildProjectPlanningView(planning)};throw new Error('RECOVERY_TASK_NOT_FOUND')}
  return rebuildHumanView(target.storeRoot,{machineDataRoot:configRoot()});
}

function renderTaskSummary(ledger:ReturnType<typeof DurableStore.load>,active:boolean,repair?:ReturnType<typeof classifyStore>,recovery?:ReturnType<typeof classifyResumeAction>,storageResumeHint?:string):string{
  const {state}=ledger,spec=ledger.records.find(r=>r.kind==='TaskSpec'&&r.id===state.spec.id);
  const steps:Record<string,string>={PENDING:"Preparing the task",READY:"Analysis approved",TESTING:"Implementation and path checks",REVIEWING:"Automated checks",REWORK:"Review requiring corrections",COMPLETED:"Final verification and confirmations",FAILED:"Closing the task"};
  const last=[...ledger.events].reverse().find(e=>e.kind!=='RECORD'&&steps[e.targetState]);
  const terminal=['COMPLETED','FAILED'].includes(state.state);
  const uncertainRun=state.runs.findLast(run=>!runQuiescent(run));
  const unknownReviewer=uncertainRun?.role==='Reviewer';
  const validation=state.validations.length?ledger.records.find(r=>r.kind==='ValidationResult'&&r.id===state.validations.at(-1)):undefined;
  const verifiedStep=unknownReviewer&&validation?.kind==='ValidationResult'
    ?`Automated working copy check ${validation.value.status==='PASSED'?"passed":validation.value.status==='FAILED'?"failed":"inconclusive"}; previous review outcome unverified`
    :last?steps[last.targetState]:"none";
  const needsRecovery=!active&&!terminal;
  const lines=["Objective",display(spec?.kind==='TaskSpec'?spec.value.objective:"unavailable"),'',"Task status",`Status: ${stateLabels[state.state]}`,
    `Last completed step: ${verifiedStep}`,`Working version: ${state.candidate?.generation??"none"}`,
    `Completion: ${state.state==='COMPLETED'?"verified":"not reached"}`,'',"Confirmations and recovery",
    `Confirmation required: ${state.state==='AWAITING_HUMAN'?"yes — open the separate panel and read the requested authorization":"no — no authorization is pending"}`,
    `Recovery required: ${needsRecovery?"yes":'no'}`];
  if(state.candidate)lines.push('',`Working copy: ${display(state.candidate.root)}`);
  if(state.candidate&&!terminal&&spec?.kind==='TaskSpec'){
    const checks=currentValidationEvidence(spec.value,state,ledger.records.flatMap(record=>record.kind==='ValidationResult'?[record.value]:[]));
    lines.push(`Automated checks on the current copy: ${checks.filter(check=>check.status==='PASSED').length} passed out of ${spec.value.validationCommands.length} planned.`);
  }
  if(state.state==='BLOCKED'&&state.blockedReason==='Reviewer batch failed')lines.push("Independent review: incomplete. The task remains blocked.");
  if(state.state==='BLOCKED'&&state.blockedReason==='Scope baseline could not be proven'&&!state.runs.some(run=>run.role==='Developer'))lines.push(
    "Development stopped before the Developer started: the isolated copy's baseline could not be verified.",
    "The analysis and previous confirmation are preserved; recovery requires verification and confirmation again.");
  if(state.state==='BLOCKED'&&state.blockedReason==='Required host validation did not pass')lines.push(
    "A mandatory check failed or was interrupted. The task cannot be completed.",
    "Open the Checks view for outcomes. Recovering control does not validate the checks or remove the blocker.");
  if(state.state==='COMPLETED')lines.push("The work was completed and verified.","Changes are in the working copy. The original project was not modified.",
    "The result was not merged, committed, pushed or published to the original project.");
  else if(!active){
    if(storageResumeHint)lines.push('',"Resume after closing",storageResumeHint);
    else if(repair?.classification==='AMBIGUOUS'||recovery?.action==='CHILD_RECONCILIATION_REQUIRED')lines.push('',
      `Reason for blocking: the terminal state ${uncertainRun?`of the ${uncertainRun.role} previous`:"of the previous task"} is unverified.`,
      "Next safe action: /controlled-dev reconcile.",
      `Confirmation authorizes a read-only consultation only. ${unknownReviewer?"It does not start a new Reviewer, the Developer or checks":"It does not start new agents or checks"} and does not modify the working copy.`,
      "If the agent service cannot confirm termination of the previous process, the task remains blocked.");
    else if(repair?.classification==='REPAIRABLE')lines.push("Saving or recovering the task was interrupted. Use /controlled-dev repair.");
    else if(state.state==='BLOCKED')lines.push("Use /controlled-dev recover to check whether control can be recovered. The task remains blocked: the problem must be resolved and verified before resuming. Do not delete protective locks or edit saved data.");
    else if(!terminal)lines.push("Use /controlled-dev recover to verify the previous process and acquire control of the task.","After recovery, use /controlled-dev resume. Do not delete protective locks.");
  }
  return lines.join('\n');
}

/** Discovery only: a verified released checkpoint directs the operator to
 * fresh local import. It never claims owner death or authorizes a takeover. */
function releasedProjectResumeHint(ctx:Pick<ProductionCommandContext,'cwd'>,target:NonNullable<ReturnType<typeof recoveryTarget>>,knownLedger?:ReturnType<typeof DurableStore.load>):string|undefined{
  try{
    const storage=resolveProjectStorage(target.data,realpathSync(ctx.cwd));if(!storage.custodian||target.storeRoot!==join(storage.projectRoot,'tasks',target.taskId))return;
    const ledger=knownLedger??DurableStore.load(target.storeRoot),state=ledger.state;
    if(ledger.truncatedTailBytes||['COMPLETED','FAILED'].includes(state.state)||state.runs.some(run=>!runQuiescent(run)))return;
    const workspaceHash=hashBytes(Buffer.from(storage.repoRoot,'utf8')),lockRoot=join(target.data,'controlled-dev','locks');
    if(existsSync(join(lockRoot,'workspaces',workspaceHash+'.lock'))||existsSync(join(lockRoot,'workspaces',workspaceHash+'.guard'))
      ||existsSync(join(lockRoot,'tasks',hashBytes(Buffer.from(workspaceHash+'\0'+state.taskId,'utf8'))+'.lock')))return;
    const checkpoint=readProjectHandoffForRuntimeImport(storage.repoRoot)?.record;
    if(checkpoint?.ownerDisposition!=='RELEASED_FOR_TRANSFER'||!checkpoint.taskHeads.some(head=>head.taskId===state.taskId&&head.specHash===state.specHash
      &&head.stateRevision===state.revision&&head.stateDigest===hashCanonical(state)&&head.eventHash===ledger.events.at(-1)?.eventHash))return;
    return `The project was saved and released on closing. There are no old locks to recover.\nChoose Resume transferred project or use /controlled-dev project resume-storage ${state.taskId}, even if the folder is unchanged.\nThis path verifies saved work and requires a new local confirmation before acquiring control. This read does not start recovery.`;
  }catch{return undefined} // An unverifiable checkpoint never advertises import as proven.
}
export function productionRecoveryStatus(ctx:ProductionCommandContext,taskId?:string){
  const target=recoveryTarget(ctx,taskId);if(!target)return undefined;
  const recovery=classifyRecoveryState(target.data,target.storeRoot).recovery,resume=classifyResumeAction(target.data,target.storeRoot);
  let attempts:ReturnType<typeof reconciliationAttempts>=[],unknown=0,ledger:ReturnType<typeof DurableStore.load>|undefined;
  try{ledger=DurableStore.load(target.storeRoot);unknown=ledger.state.runs.filter(r=>!runQuiescent(r)).length;attempts=reconciliationAttempts(target.data,ledger)}catch{}
  const storageResumeHint=releasedProjectResumeHint(ctx,target,ledger);
  const owner={DEAD:"terminated",LIVE:"active",UNCERTAIN:"unverifiable",NONE:"no evidence available"}[recovery.lockOwnerStatus];
  const store=classifyStore(target.data,target.storeRoot);
  return {...target,recovery,resume,store,...(storageResumeHint?{storageResumeHint}:{}),attempts:attempts.map(a=>({runId:a.runId,result:a.result,reason:a.reason,observedAt:a.observedAt})),
    message:`Store: ${store.classification} (${store.reason}). Explicit repair: /controlled-dev repair ${target.taskId}.\n${resume.action==='NO_ACTION_TERMINAL'?"The task has ended.":storageResumeHint?"The project was closed with a verified save.":"The task was interrupted during a previous execution."}\nSaved status: ${resume.lastSafeState}\nOwning process: ${owner}\nLock: ${recovery.safeReclaimPossible?"recoverable":"not recoverable without further evidence"}\nUncertain children: ${unknown}\nAutomatic resume: not permitted\n${storageResumeHint?"\nResume after closing\n"+storageResumeHint:resume.message}`};
}
/** Menu routing only. A terminal, fully verified ledger needs no recovery
 * classification. Explicit recovery/repair still performs its full checks. */
export function productionOpeningTaskPreview(ctx:Pick<ProductionCommandContext,'cwd'>,taskId?:string):{taskId:string;terminal:boolean}|undefined{
 const {repo,data}=expectedTaskPath(ctx),storage=resolveProjectStorage(data,repo);
 if(!taskId){try{taskId=readProductionTaskInput(ctx).spec.taskId}catch(error){if(error instanceof ProductionTaskInputError&&error.code==='CONTROLLED_DEV_TASK_INPUT_MISSING')return;throw error}}
 if(!validateScalar('ID',taskId).ok)throw new Error('RECOVERY_TASK_INVALID');
 const root=join(storage.projectRoot,'tasks',taskId);try{lstatSync(root)}catch(error){if((error as {code?:string}).code==='ENOENT')return;throw error}assertProjectStoragePath(storage,root);
 const ledger=DurableStore.load(root),spec=ledger.records.find(record=>record.kind==='TaskSpec'&&record.id===ledger.state.spec.id);
 if(spec?.kind!=='TaskSpec'||ledger.state.taskId!==taskId||physicalProjectRootForTask(root,spec.value.scope.repoRoot,ledger)!==repo)throw new Error('RECOVERY_REPO_MISMATCH');
 return {taskId,terminal:!ledger.truncatedTailBytes&&['COMPLETED','FAILED'].includes(ledger.state.state)&&ledger.state.runs.every(runQuiescent)};
}
/** Read-only chooser. Failed proof/unsupported checkpoints never appear as
 * resumable entries; preparing a proposal performs no store or permission write. */
export function productionProjectStorageResumeChoices(ctx:ProductionCommandContext):readonly {taskId:string;title:string}[]{
  if(ctx.mode!=='tui'||!ctx.sessionManager.getSessionId())throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  const storage=resolveProjectStorage(configRoot(),realpathSync(ctx.cwd));if(!storage.custodian)return [];
  const root=join(storage.projectRoot,'tasks'),choices:{taskId:string;title:string}[]=[];
  let ids:string[];try{ids=readdirSync(root).sort()}catch(error){if((error as {code?:string}).code==='ENOENT')return [];throw error}
  for(const id of ids){
    const taskRoot=join(root,id),stat=lstatSync(taskRoot);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(taskRoot)!==taskRoot)throw new Error('PROJECT_STORAGE_PATH_INVALID');
    const ledger=DurableStore.load(taskRoot);if(['COMPLETED','FAILED'].includes(ledger.state.state))continue;
    try{prepareProjectRuntimeImport(configRoot(),storage.repoRoot,id,ctx.sessionManager.getSessionId()!,inspectArtifact)}catch(error){
      if(error instanceof Error&&error.message.startsWith('PROJECT_RUNTIME_IMPORT_'))continue;throw error;
    }
    const spec=ledger.records.find(r=>r.kind==='TaskSpec'&&r.id===ledger.state.spec.id);if(spec?.kind!=='TaskSpec')throw new Error('PROJECT_RUNTIME_IMPORT_BINDING_INVALID');
    choices.push({taskId:id,title:spec.value.title});
  }
  return Object.freeze(choices.map(choice=>Object.freeze(choice)));
}
/** Explicit native acquisition of local authority for an intact released
 * portable task. Ordinary run/recover never substitutes this approval. */
export async function resumeProductionProjectStorage(host:OrchestratorHost,ctx:ProductionCommandContext,taskId:string):Promise<boolean>{
  if(ctx.mode!=='tui'||ctx.sessionManager.getSessionId()!==host.ownerSessionId)throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  if(host.current){
    const locks=host.current.lockStatus();
    if(!['COMPLETED','FAILED'].includes(host.current.state.state)||locks.taskLockHeld||locks.workspaceLockHeld)throw new Error('WORKFLOW_ALREADY_ACTIVE');
    host.dispose();
  }
  await showHostOperation(ctx,"Verifying saved work in the current folder");
  const cleanup=prepareProjectRuntimeImportRecovery(configRoot(),realpathSync(ctx.cwd),taskId,host.ownerSessionId,inspectArtifact);
  if(cleanup){
    const decision=await presentTrustedConfirmation(ctx,projectRuntimeImportRecoveryRequest(cleanup));
    if(!decision){ctx.ui.notify("Closure of the interrupted resume was not confirmed. History and preserved permissions were not modified.",'info');return false;}
    await showHostOperation(ctx,"Verified closure of permissions from the previous terminated instance");
    recoverProjectRuntimeImport(cleanup,decision);
    ctx.ui.notify("The interrupted resume is closed. Prepared evidence and used attempts are preserved; a new confirmation is now required to acquire the task.",'info');
  }
  const proposal=prepareProjectRuntimeImport(configRoot(),realpathSync(ctx.cwd),taskId,host.ownerSessionId,inspectArtifact);
  const receipt=await presentTrustedConfirmation(ctx,projectRuntimeImportRequest(proposal));
  if(!receipt){ctx.ui.notify("Resume not confirmed. Saved work and counters are preserved.",'info');return false;}
  await showHostOperation(ctx,"Restoring the verified copy and acquiring local permissions");
  const capability=authorizeProjectRuntimeImport(proposal,receipt);
  try{host.restore(takeOverImportedWorkflow(capability));completeProjectRuntimeImport(capability)}catch(error){
    if(!host.current){try{abortProjectRuntimeImport(capability,error)}catch{ctx.ui.notify("Resume was interrupted, and permission closure cannot be verified. Evidence and the recovery journal are preserved; explicit recovery is required.",'warning')}}
    throw error;
  }
  ctx.ui.notify(proposal.payload.schemaVersion===2?"The Git baseline and evidence of the Developer stopping without changes are available in the current folder. Choose Continue in the same task: another attempt requires a new implementation confirmation and preserves used limits.":"The current folder is linked to saved work. The plan, history and used attempts are preserved. Choose Continue: necessary checks and confirmations will be acquired here before the dependent step.",'info');
  return true;
}
export async function recoverProductionWorkflow(host:OrchestratorHost,ctx:ProductionCommandContext,action:'recover'|'reconcile'|'resume'|'repair'|'close-attempt',events:RpcEvents,taskId?:string){
  if(ctx.mode!=='tui'||ctx.sessionManager.getSessionId()!==host.ownerSessionId)throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  const target=recoveryTarget(ctx,taskId??host.current?.state.taskId);if(!target)throw new Error("No saved task for this repository.");
  if(host.current&&(host.current.state.taskId!==target.taskId||host.current.state.repoRoot!==realpathSync(ctx.cwd)))throw new Error('RECOVERY_TASK_MISMATCH');
  const status=()=>productionRecoveryStatus(ctx,target.taskId)!;
  if(action==='repair'){
    if(host.current)throw new Error('WORKFLOW_ALREADY_ACTIVE');
    const repair=repairStore(target.data,target.storeRoot);
    ctx.ui.notify(repair.repaired?"Saved data repaired. No work repeated and no automatic resume. Use /controlled-dev status, then recover and resume if permitted.":"Saved data intact: no repair required.",'info');
    return {...status(),repair};
  }
  if(!host.current&&['recover','resume'].includes(action)&&releasedProjectResumeHint(ctx,target))throw new Error('PROJECT_RUNTIME_IMPORT_REQUIRED');
  const initial=classifyResumeAction(target.data,target.storeRoot);
  if(initial.action==='P16C_REPAIR_REQUIRED')throw new Error("Cannot resume: store repair is required.");
  const shouldReconcile=action==='reconcile'&&!host.current;
  if(shouldReconcile){
    const rpc=new RpcAdapter(events,{sessionId:host.ownerSessionId,environmentHash:hashBytes(Buffer.from(host.ownerSessionId,'utf8')),piVersion:'host',subagentsVersion:'public-capability-detection'});
    try{await rpc.handshake();await reconcileUnknownChildren(target.data,target.storeRoot,rpc,host.ownerSessionId,true)}finally{rpc.dispose()}
  }
  // Only reconciliation can change the ledger between these presentation
  // checks. takeOverWorkflow and execution boundaries still verify afresh.
  const next=shouldReconcile?classifyResumeAction(target.data,target.storeRoot):initial;
  if(['CHILD_RECONCILIATION_REQUIRED','NO_ACTION_TERMINAL'].includes(next.action)){
    if(action==='resume')throw new Error(next.message);return status();
  }
  if(!host.current){
    if(action==='resume')throw new Error("Run recover and check the locks before resuming.");
    host.restore(takeOverWorkflow(target.data,target.storeRoot,host.ownerSessionId,'Explicit production recovery command',inspectArtifact));
  }
  if(action==='close-attempt'){
    const workflow=host.current!;
    if(workflow.state.state!=='BLOCKED'||workflow.state.candidate||workflow.state.runs.some(run=>!['Scout','Developer'].includes(run.role)||run.role==='Developer'&&run.resultRef))throw new Error('RECOVERY_ABANDON_DENIED');
    await workflow.abandonRecovered(ctx,"Task incomplete; closing the attempt to split the work after diagnosis. Objective, counters, candidate copies and previous evidence preserved. No partial change is integrated.");
    const resultingState:string=workflow.state.state;
    return {outcome:resultingState==='FAILED'?'FAILED':'NOT_CONFIRMED',taskId:workflow.state.taskId};
  }
  if(action==='resume'){
    const workflow=host.current!;
    // A live session can explicitly retry its own proven no-effect Developer failure.
    if(workflow.state.state==='BLOCKED'&&(workflow.canOpenBeforeDeveloperRecovery()||workflow.canOpenBeforeScopeBaselineRecovery()||workflow.canOpenBeforeBoundedDeveloperRecovery()))return continueProductionWorkflow(workflow,ctx);
    if(!workflow.developerRecoveryWorktree()&&!workflow.boundedDeveloperRecoveryWorktree())workflow.resumeRecovered();
    if(ctx.autonomy&&!workflow.scopeBaselineRecoveryWorktree()&&!workflow.boundedDeveloperRecoveryWorktree()){
      ctx.autonomy.repo.assertCurrent(ctx.autonomy.repo.run(ctx.autonomy.runId));
      if(workflow.state.state==='AWAITING_HUMAN'){const request=workflow.representPendingGate(ctx);if(!['beforeImplementation','beforeCompletion','beforeReviewerRedispatch','onScopeChange'].includes(request.gateType))throw new Error(request.gateType==='onRetryExhausted'?'RETRY_EXHAUSTED':'UNRESOLVED_RISK');const authorization=await presentWorkflowGate(ctx,workflow,request);if(!authorization)throw new Error('UNRESOLVED_RISK');await acceptWorkflowGate(ctx,workflow,request,authorization);}
      if(['PENDING','ANALYZING'].includes(workflow.state.state)&&!await prepareProductionAnalysis(workflow,ctx))return {outcome:'NOT_CONFIRMED',taskId:workflow.state.taskId};
      return continueProductionWorkflow(workflow,ctx);
    }
    if(workflow.state.state==='BLOCKED'&&workflow.canOpenBeforeReviewerRedispatch()){
      const request=workflow.openBeforeReviewerRedispatch(workflow.state.revision,host.ownerSessionId),receipt=await presentHumanGate(ctx,request);
      if(!receipt)return {outcome:'NOT_CONFIRMED',taskId:workflow.state.taskId};
      await showHostOperation(ctx,"Preparing independent review");
      const decision=workflow.acceptHumanDecision(request.snapshot,receipt);
      const gateState:string=workflow.state.state;
      if(decision.decision!=='APPROVE')return {outcome:gateState==='FAILED'?'FAILED':'BLOCKED',taskId:workflow.state.taskId};
    }
    if(workflow.state.state==='AWAITING_HUMAN'){
      if(!workflow.pendingHumanGate)workflow.representPendingGate(ctx);
      return decideProductionHumanGate(host,ctx,{decision:'APPROVE'});
    }
    if(['PENDING','ANALYZING'].includes(workflow.state.state)&&!await prepareProductionAnalysis(workflow,ctx))return {outcome:'NOT_CONFIRMED',taskId:workflow.state.taskId};
    return continueProductionWorkflow(workflow,ctx);
  }
  return status();
}
export async function requestBeforeCompletionConfirmation(ctx:ProductionCommandContext,displayText:string):Promise<boolean>{
  return confirmHumanDisplay(ctx,displayText);
}

/** Host-only bounded question sequence. Confirmed answers never substitute for writer authorization. */
export async function clarifyProductionScout(workflow:CentralOrchestrator,ctx:ProductionCommandContext):Promise<boolean>{
  if(ctx.mode!=='tui'||ctx.sessionManager.getSessionId()!==workflow.state.ownerSessionId)throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  let coverage=workflow.scoutClarifications();
  if(coverage.status==='INVALID_EVIDENCE')throw new Error('SCOUT_CLARIFICATION_INVALID');
  const scout=workflow.context().records.find(r=>r.kind==='ScoutResult'&&r.id===workflow.state.runs.findLast(r=>r.role==='Scout')?.resultRef);
  if(scout?.kind!=='ScoutResult')throw new Error('SCOUT_CLARIFICATION_INVALID');
  // At most one edit per frozen index per invocation. Cancellation retains all prior answers.
  let indices=coverage.status==='SPEC_REVISION_REQUIRED'?coverage.answers.filter(a=>a.impact==='SPEC_REVISION_REQUIRED').map(a=>a.ambiguityIndex):[...coverage.missingIndices];
  if(coverage.covered){
    try{workflow.verifyScoutClarificationDelivery()}catch(error){
      if(!(error instanceof Error)||error.message!=='SCOUT_CLARIFICATION_DELIVERY_LIMIT')throw error;
      const options=coverage.answers.map(a=>`Question ${a.ambiguityIndex+1}: ${a.ambiguityText}`);
      const choice=await ctx.ui.select?.("Complete answers exceed 16 KiB. Choose an answer to shorten; no data is truncated.",options);
      if(choice===undefined)return false;const selected=options.indexOf(choice);if(selected<0)return false;
      indices=[coverage.answers[selected].ambiguityIndex];
    }
  }
  for(const index of indices){
    const previous=coverage.answers.find(a=>a.ambiguityIndex===index);
    if(previous?.impact==='SPEC_REVISION_REQUIRED'){
      const choice=await ctx.ui.select?.("The answer requires revision of the approved requirements or files.", ["Revise the answer","Keep blocked and review the task"]);
      if(choice!=="Revise the answer"){ctx.ui.notify("Dependent tasks remain stopped. Revising requirements or files requires a new proposal and the normal approval path.",'warning');return false}
    }
    const title=`Question ${index+1} from the analysis: ${scout.value.ambiguities[index]}`;
    const answer=ctx.ui.editor?await ctx.ui.editor(title,previous?.answer??''):await ctx.ui.input?.(title);
    if(answer===undefined||!answer.trim())return false;
    const choice=await ctx.ui.select?.("What is the effect of this answer?", ["Clarifies the already approved requirements and files","Requires changes to approved requirements or files"]);
    if(!["Clarifies the already approved requirements and files","Requires changes to approved requirements or files"].includes(choice??''))return false;
    const impact=choice==="Clarifies the already approved requirements and files"?'WITHIN_APPROVED_SPEC':'SPEC_REVISION_REQUIRED';
    const revision=workflow.state.revision;
    const request=workflow.createScoutAnswer(index,answer,impact,impact==='WITHIN_APPROVED_SPEC'
      ?"The operator confirms that the answer clarifies the already approved assignment."
      :"The operator requires a new revision of the assignment before development.",revision,ctx.sessionManager.getSessionId()!);
    const receipt=await presentTrustedConfirmation(ctx,request);if(!receipt)return false;
    workflow.acceptScoutAnswer(request,receipt,revision);coverage=workflow.scoutClarifications();
    ctx.ui.notify(`Answer ${index+1} saved and linked to the analysis question. ${coverage.covered?"Required clarifications are complete.":coverage.status==='SPEC_REVISION_REQUIRED'?"The assignment needs revision before development.":"Questions still need clarification."}`,'info');
  }
  const covered=workflow.scoutClarifications().covered;
  if(covered)workflow.verifyScoutClarificationDelivery();return covered;
}
async function prepareProductionAnalysis(workflow:CentralOrchestrator,ctx:ProductionCommandContext):Promise<boolean>{
  if(workflow.scoutClarifications().status==='INVALID_EVIDENCE')await workflow.analyze(workflow.state.revision);
  if(!await clarifyProductionScout(workflow,ctx))return false;
  workflow.ready(workflow.state.revision);return true;
}

/** Host-only serial bridge. The interactive context is never serialized or sent to a child. */
export async function runProductionWorkflow(host:OrchestratorHost,ctx:ProductionCommandContext):Promise<ProductionRunResult>{
  if(ctx.mode!=='tui'||(typeof ctx.ui?.custom!=='function'&&typeof ctx.ui?.confirm!=='function')||typeof ctx.ui?.notify!=='function')throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  const sessionId=ctx.sessionManager?.getSessionId();
  if(!sessionId||sessionId!==host.ownerSessionId)throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  if(host.current)throw new Error('WORKFLOW_ALREADY_ACTIVE');
  const {spec,artifacts,baselineCommit}=productionTaskInput(ctx),data=configRoot();
  try{if(realpathSync(data)!==data)throw new Error()}catch{throw new Error('PRODUCTION_DATA_ROOT_UNAVAILABLE')}
  const manager=new LockManager(data,sessionId,`runtime-${randomUUID()}`),locks=manager.acquire(spec.taskId,spec.scope.repoRoot);
  let initialized=false;
  try{
    CandidatePromotionRepository.open(data,spec.scope.repoRoot,inspectArtifact,{create:true,manager,workspaceLock:locks.workspace})!.initialize(spec,baselineCommit);
    const store=DurableStore.create(data,spec.scope.repoRoot,spec.taskId,inspectArtifact);
    for(const [ref,raw] of artifacts)store.import(ref,raw);
    const workflow=host.initialize(spec,{store,lockManager:manager,locks,artifacts:artifacts.map(([ref])=>ref),baselineRef:spec.scope.baseRef,baselineCommit});
    initialized=true;
    if(!await prepareProductionAnalysis(workflow,ctx))return {outcome:'NOT_CONFIRMED',taskId:workflow.state.taskId};
    return await continueProductionWorkflow(workflow,ctx);
  }catch(error){if(!initialized)manager.releaseAll(locks);throw error}
}

export async function decideProductionHumanGate(host:OrchestratorHost,ctx:ProductionCommandContext,choice:HumanDecisionChoice):Promise<ProductionRunResult>{
  if(ctx.mode!=='tui'||ctx.sessionManager?.getSessionId()!==host.ownerSessionId)throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  const workflow=host.current,request=workflow?.pendingHumanGate;
  if(!workflow||!request)throw new Error('NO_PENDING_GATE');
  const receipt=await presentHumanGate(ctx,request,choice);
  if(!receipt)return {outcome:'NOT_CONFIRMED',taskId:workflow.state.taskId};
  await showHostOperation(ctx,request.gateType==='beforeCompletion'?"Final checks and save":request.gateType==='beforeReviewerRedispatch'?"Preparing independent review":"Checking authorization");
  const decision=workflow.acceptHumanDecision(request.snapshot,receipt);
  if(decision.decision!=='APPROVE'||workflow.state.state==='BLOCKED')return {outcome:workflow.state.state==='FAILED'?'FAILED':'BLOCKED',taskId:workflow.state.taskId};
  return continueProductionWorkflow(workflow,ctx);
}
function openWorkflowGate(workflow:CentralOrchestrator,ctx:ProductionCommandContext,type:'beforeImplementation'|'beforeCompletion'|'beforeReviewerRedispatch'):HumanGateRequest{
  const session=ctx.sessionManager.getSessionId()!;
  if(ctx.autonomy)return workflow.openPolicyGate(type,workflow.state.revision,session);
  return type==='beforeImplementation'?workflow.openBeforeImplementation(workflow.state.revision,session):type==='beforeCompletion'?workflow.openBeforeCompletion(workflow.state.revision,session):workflow.openBeforeReviewerRedispatch(workflow.state.revision,session);
}
async function presentWorkflowGate(ctx:ProductionCommandContext,workflow:CentralOrchestrator,request:HumanGateRequest){
  if(!ctx.autonomy)return presentHumanGate(ctx,request);
  return ctx.autonomy.repo.authorize(ctx.autonomy.runId,request.gateType as any,{plannedTaskId:ctx.autonomy.plannedTaskId,spec:workflow.spec,...request.snapshot,approvedData:JSON.parse(request.displayText)} as any);
}
async function showHostOperation(ctx:ProductionCommandContext,label:string):Promise<void>{
  const status=`Status: ${label}`;ctx.ui.setStatus?.('controlled-dev',status);
  ctx.ui.setWidget?.('controlled-dev',[status,"Work continues. Wait for the next result; saved status remains available."]);
  await new Promise<void>(resolve=>setTimeout(resolve,25));
}
async function acceptWorkflowGate(ctx:ProductionCommandContext,workflow:CentralOrchestrator,request:HumanGateRequest,receipt:TrustedHumanDecision|PolicyAuthorizationCapability){
  await showHostOperation(ctx,request.gateType==='beforeCompletion'?"Final checks and save":request.gateType==='beforeReviewerRedispatch'?"Preparing independent review":"Checking authorization");
  if(!ctx.autonomy)return workflow.acceptHumanDecision(request.snapshot,receipt as TrustedHumanDecision);
  workflow.acceptPolicyAuthorization(request.snapshot,receipt as PolicyAuthorizationCapability);
  const stateRef=workflow.events.at(-1)!.stateAfter;ctx.autonomy.repo.recordTaskStateEffect((receipt as PolicyAuthorizationCapability).ref,stateRef);return {decision:'APPROVE' as const,authorizationKind:'PolicyDerivedAuthorization' as const};
}
export async function continueProductionWorkflow(workflow:CentralOrchestrator,ctx:ProductionCommandContext):Promise<ProductionRunResult>{
  const data=configRoot(),sessionId=ctx.sessionManager.getSessionId()!;
  if(ctx.autonomy)ctx.autonomy.repo.assertTaskEligible(ctx.autonomy.runId,ctx.autonomy.plannedTaskId,workflow.spec);
  if(workflow.state.state==='ANALYZING'){
    if(!await prepareProductionAnalysis(workflow,ctx))return {outcome:'NOT_CONFIRMED',taskId:workflow.state.taskId};
    return continueProductionWorkflow(workflow,ctx);
  }
  const spec=workflow.spec;
  if(workflow.state.state==='BLOCKED'&&workflow.state.blockedReason==='Scope baseline could not be proven')await showHostOperation(ctx,"Checking the approved baseline before recovery");
  if(workflow.state.state==='BLOCKED'&&workflow.canOpenBeforeScopeBaselineRecovery()){
    const request=workflow.openBeforeScopeBaselineRecovery(workflow.state.revision,sessionId);
    // Recovery of this host-side baseline check always requires a fresh native
    // operator decision, even when routine execution has an autonomy policy.
    const receipt=await presentHumanGate(ctx,request);
    if(!receipt)return {outcome:'NOT_CONFIRMED',taskId:spec.taskId};
    await showHostOperation(ctx,"Checking the baseline and new authorization");
    const decision=workflow.acceptHumanDecision(request.snapshot,receipt);
    if(decision.decision!=='APPROVE')return {outcome:'BLOCKED',taskId:spec.taskId};
  }
  if(workflow.state.state==='BLOCKED'&&workflow.canOpenBeforeDeveloperRecovery()){
    const request=ctx.autonomy?workflow.openPolicyDeveloperRecovery(workflow.state.revision,sessionId):workflow.openBeforeDeveloperRecovery(workflow.state.revision,sessionId),receipt=await presentWorkflowGate(ctx,workflow,request);
    if(!receipt)return {outcome:'NOT_CONFIRMED',taskId:spec.taskId};
    const decision=await acceptWorkflowGate(ctx,workflow,request,receipt);
    const resultingState:string=workflow.state.state;
    if(decision.decision!=='APPROVE')return {outcome:resultingState==='FAILED'?'FAILED':'BLOCKED',taskId:spec.taskId};
    return continueProductionWorkflow(workflow,ctx);
  }
  if(workflow.state.state==='BLOCKED'&&workflow.canOpenBeforeBoundedDeveloperRecovery()){
    await showHostOperation(ctx,"Checking the attempt that ended without changes");
    const sessionId=ctx.sessionManager.getSessionId();
    if(!sessionId)throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
    const request=workflow.openBeforeBoundedDeveloperRecovery(workflow.state.revision,sessionId);
    // This bounded retry always asks the operator, including under project autonomy.
    const receipt=await presentHumanGate(ctx,request);
    if(!receipt)return {outcome:'NOT_CONFIRMED',taskId:spec.taskId};
    const decision=workflow.acceptHumanDecision(request.snapshot,receipt);
    const resultingState:string=workflow.state.state;
    if(decision.decision!=='APPROVE')return {outcome:resultingState==='FAILED'?'FAILED':'BLOCKED',taskId:spec.taskId};
    return continueProductionWorkflow(workflow,ctx);
  }
  if(workflow.state.state==='BLOCKED'&&workflow.canOpenBeforeReviewerRedispatch()){
    const request=openWorkflowGate(workflow,ctx,'beforeReviewerRedispatch'),receipt=await presentWorkflowGate(ctx,workflow,request);
    if(!receipt)return {outcome:'NOT_CONFIRMED',taskId:spec.taskId};
    const decision=await acceptWorkflowGate(ctx,workflow,request,receipt);
    const gateState:string=workflow.state.state;
    if(decision.decision!=='APPROVE')return {outcome:gateState==='FAILED'?'FAILED':'BLOCKED',taskId:spec.taskId};
    return continueProductionWorkflow(workflow,ctx);
  }
  if(workflow.state.state==='REVIEWING'&&workflow.reviewerRedispatchAuthorized()){
    await showHostOperation(ctx,"Preparing independent review");
    let reviewed;
    try{reviewed=await workflow.redispatchReviewer(workflow.state.revision)}
    catch(error){ctx.ui.notify("Independent review was interrupted. Files and results of previously executed checks are preserved.\n\n"+renderProductionStatus(ctx,workflow),'warning');return {outcome:'BLOCKED',taskId:spec.taskId}}
    if(reviewed.decision==='REWORK_REQUIRED')return {outcome:'REWORK_REQUIRED',taskId:spec.taskId};
    if(reviewed.decision==='BLOCKED')return {outcome:'BLOCKED',taskId:spec.taskId};
    await showHostOperation(ctx,"Checking review evidence");
    workflow.resolveHostValidationRisks(workflow.state.revision);
    const request=openWorkflowGate(workflow,ctx,'beforeCompletion'),receipt=await presentWorkflowGate(ctx,workflow,request);
    if(!receipt){ctx.ui.notify("Confirmation not received: the task remains waiting. Use /controlled-dev status.",'warning');return {outcome:'NOT_CONFIRMED',taskId:spec.taskId}}
    await acceptWorkflowGate(ctx,workflow,request,receipt);workflow.complete(workflow.state.revision);
    await freezeProductionCandidate(ctx,spec.taskId);
    ctx.ui.notify(renderProductionStatus(ctx,workflow),'info');return {outcome:'COMPLETED',taskId:spec.taskId};
  }
  if(workflow.state.state==='READY'||workflow.state.state==='TESTING'){
    if(workflow.state.state==='READY'){
    if(workflow.requiresLocalWriterConfirmation&&(workflow.humanGateStatus()?.status!=='CONSUMED'||ctx.autonomy&&workflow.policyWriterReauthorizationRequired()||workflow.state.runtimeBindingRef)){
      const request=openWorkflowGate(workflow,ctx,'beforeImplementation'),receipt=await presentWorkflowGate(ctx,workflow,request);
      if(!receipt)return {outcome:'NOT_CONFIRMED',taskId:spec.taskId};
      const decision=await acceptWorkflowGate(ctx,workflow,request,receipt);
      const gateState:string=workflow.state.state;
      if(decision.decision!=='APPROVE'||gateState==='BLOCKED'||gateState==='FAILED')
        return {outcome:gateState==='FAILED'?'FAILED':'BLOCKED',taskId:spec.taskId};
    }
    // The dialog never dispatches: implement() independently rechecks live authorization and ScopeGuard.
    const retryWorkRoot=workflow.developerRecoveryWorktree()??workflow.scopeBaselineRecoveryWorktree()??workflow.boundedDeveloperRecoveryWorktree();
    let workRoot=retryWorkRoot??join(data,'controlled-dev','workspaces',`${spec.taskId}-${randomUUID()}`);mkdirSync(dirname(workRoot),{recursive:true});
    const rework=workflow.state.candidate!==undefined;
    if(!rework){const promotion=productionCandidatePromotion(ctx);
      if(!retryWorkRoot&&promotion?.binding(spec.taskId))workRoot=workflow.withProjectLease((manager,workspaceLock)=>CandidatePromotionRepository.open(data,workflow.state.repoRoot,inspectArtifact,{manager,workspaceLock})!.materialize(spec.taskId));
      else if(!retryWorkRoot)git(workflow.state.repoRoot,'worktree','add','--quiet','--detach',workRoot,workflow.state.baselineCommit!);
    }
    let developed;
    try{developed=rework?await workflow.rework(workflow.state.revision,workRoot):await workflow.implement(workflow.state.revision,workRoot)}
    catch(error){if(ctx.autonomy&&workflow.canOpenBeforeDeveloperRecovery())return continueProductionWorkflow(workflow,ctx);throw error;}
    if(developed.decision==='BLOCKED'){
      ctx.ui.notify(`The Developer stopped this attempt.\n${developed.value?.blockedReason??workflow.state.blockedReason??"A check is required before continuing."}\nEvidence and previously used attempts are preserved. Use /controlled-dev resume to check whether resuming with a new confirmation is possible.`,'warning');
      return {outcome:'BLOCKED',taskId:spec.taskId};
    }
    workflow.testing(workflow.state.revision);
    }
    const validation=workflow.validateApproved(workflow.state.revision);
    if(validation.decision==='BLOCKED'){
      const failed=validation.value?.find(value=>value.status==='FAILED');
      if(!failed||!spec.humanGates.beforeImplementation){
        ctx.ui.notify("Verification failed or evidence is incomplete. Open Checks in task status; no correction has started.",'warning');
        return {outcome:'BLOCKED',taskId:spec.taskId};
      }
      const token=failed.id.slice('validation-'.length);
      const routed=workflow.routeFailure({phase:'TESTING',source:'VALIDATION_FAILED',code:'HOST_VALIDATION_FAILED',
        subjectIds:[failed.id],evidenceRefs:[failed.id,`runtime-evidence-${token}`,`runtime-events-${token}`]},
      {dispatchOutcome:'KNOWN_FAILED',transientInfrastructure:false,writerTerminal:true,workspaceSafe:true,sameProtocol:true,
        concreteHumanResolution:false,duplicateEscalation:false},workflow.state.revision);
      if(routed.decision!=='REWORK_REQUIRED'){
        ctx.ui.notify("Verification failed. Evidence is preserved, but no correction path is available within the task's limits.",'warning');
        return {outcome:'BLOCKED',taskId:spec.taskId};
      }
      ctx.ui.notify(`Verification failed. Available events and a cautious diagnosis have been collected. ${ctx.autonomy?"Starting a minimal correction within the approved limits.":"A minimal correction requires a new authorization."}`,'warning');
      const request=openWorkflowGate(workflow,ctx,'beforeImplementation'),receipt=await presentWorkflowGate(ctx,workflow,request);
      if(!receipt)return {outcome:'NOT_CONFIRMED',taskId:spec.taskId};
      const decision=await acceptWorkflowGate(ctx,workflow,request,receipt);
      const gateState:string=workflow.state.state;
      if(decision.decision!=='APPROVE'||gateState==='BLOCKED'||gateState==='FAILED')
        return {outcome:gateState==='FAILED'?'FAILED':'BLOCKED',taskId:spec.taskId};
      return continueProductionWorkflow(workflow,ctx);
    }
    const capture=workflow.candidateCapture!;
    const localReviewRequest=workflow.createImportedReviewRequest(sessionId);
    if(localReviewRequest){
      const receipt=await presentTrustedConfirmation(ctx,localReviewRequest);
      if(!receipt)return {outcome:'NOT_CONFIRMED',taskId:spec.taskId};
      workflow.acceptImportedReview(localReviewRequest,receipt);
    }
    await showHostOperation(ctx,"Preparing independent review");
    let reviewed;
    try{reviewed=await workflow.review(workflow.state.revision,{candidateManifest:capture.manifest,diff:capture.patch,
      changedFiles:capture.changedFiles,handoff:capture.handoff,residualRisks:workflow.context().records.filter(r=>r.kind==='DeveloperResult').at(-1)?.value.residualRisks??[],evidenceRefs:[]})}
    catch(error){
      const routed=workflow.recordReviewerInfrastructureFailure(error,workflow.state.revision);
      if(routed?.decision==='RETRY_INFRASTRUCTURE'&&workflow.canOpenBeforeReviewerRedispatch()){
        const request=openWorkflowGate(workflow,ctx,'beforeReviewerRedispatch'),receipt=await presentWorkflowGate(ctx,workflow,request);
        if(!receipt)return {outcome:'NOT_CONFIRMED',taskId:spec.taskId};
        const decision=await acceptWorkflowGate(ctx,workflow,request,receipt);
        const gateState:string=workflow.state.state;
        if(decision.decision!=='APPROVE')return {outcome:gateState==='FAILED'?'FAILED':'BLOCKED',taskId:spec.taskId};
        return continueProductionWorkflow(workflow,ctx);
      }
      ctx.ui.notify("Independent review was not completed. Files and results of previously executed checks are preserved.\n\n"+renderProductionStatus(ctx,workflow),'warning');
      return {outcome:'BLOCKED',taskId:spec.taskId};
    }
    if(reviewed.decision==='REWORK_REQUIRED'){
      if(!spec.humanGates.beforeImplementation||workflow.state.counters.reworkAttempts>=spec.retryPolicy.maxReworkAttempts)
        return {outcome:'REWORK_REQUIRED',taskId:spec.taskId};
      const request=openWorkflowGate(workflow,ctx,'beforeImplementation'),receipt=await presentWorkflowGate(ctx,workflow,request);
      if(!receipt)return {outcome:'NOT_CONFIRMED',taskId:spec.taskId};
      const decision=await acceptWorkflowGate(ctx,workflow,request,receipt);
      const gateState:string=workflow.state.state;
      if(decision.decision!=='APPROVE'||gateState==='BLOCKED'||gateState==='FAILED')
        return {outcome:gateState==='FAILED'?'FAILED':'BLOCKED',taskId:spec.taskId};
      return continueProductionWorkflow(workflow,ctx);
    }
    if(reviewed.decision==='BLOCKED')return {outcome:'BLOCKED',taskId:spec.taskId};
    await showHostOperation(ctx,"Checking review evidence");
    workflow.resolveHostValidationRisks(workflow.state.revision);
    const request=openWorkflowGate(workflow,ctx,'beforeCompletion');
    const receipt=await presentWorkflowGate(ctx,workflow,request);
    if(!receipt){ctx.ui.notify("Confirmation not received: the task remains waiting. Use /controlled-dev status.",'warning');return {outcome:'NOT_CONFIRMED',taskId:spec.taskId}}
    await acceptWorkflowGate(ctx,workflow,request,receipt);
  }
    workflow.complete(workflow.state.revision);
    await freezeProductionCandidate(ctx,spec.taskId);
    ctx.ui.notify(renderProductionStatus(ctx,workflow),'info');return {outcome:'COMPLETED',taskId:spec.taskId};
}
