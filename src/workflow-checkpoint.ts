/**
 * Preserve portable project checkpoints after task results have been recorded.
 * Candidate capture and handoff sealing reuse the existing custody services.
 * Releasing custody requires all project tasks and host commands to be quiescent;
 * failure is reported separately from the already accepted agent result.
 */
import { inspectHostCommandRecovery } from './host-command-recovery.js';
import { captureCandidateCheckpoint } from './candidate-checkpoints.js';
import { captureBoundedDeveloperCheckpoint } from './bounded-developer-checkpoint.js';
import { sealProjectHandoff, releaseProjectHandoff, currentProjectHandoffCandidatePaths } from './project-handoff.js';
import { readProjectCustodian } from './project-custodian.js';
import { runQuiescent } from './run-quiescence.js';
import { DurableStore } from './store.js';
import { validateScalar } from './contracts.js';
import type { WorkflowState } from './contracts.js';
import type { LockManager, WorkflowLocks } from './lock-manager.js';
import { readdirSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

export class WorkflowCheckpointError extends Error {
  readonly code='PROJECT_CHECKPOINT_SAVE_FAILED';
  readonly diagnostic:Readonly<{phase:string;path:string}>;
  constructor(readonly taskId:string,readonly revision:number,readonly cause:unknown){
    super('PROJECT_CHECKPOINT_SAVE_FAILED');
    const code=(cause as {code?:unknown})?.code??(cause instanceof Error?cause.message:'CHECKPOINT_IO_FAILED');
    this.diagnostic=Object.freeze({phase:'CHECKPOINT_SAVE',path:typeof code==='string'&&/^[A-Z_]{1,90}$/.test(code)?code:'CHECKPOINT_IO_FAILED'});
  }
}
export interface WorkflowCheckpointInput {
  readonly state:WorkflowState;readonly store:DurableStore;readonly manager:LockManager;readonly locks:WorkflowLocks;
  readonly assertCurrent:()=>void;readonly assertQuiescent:()=>void;readonly retireAuthority:()=>void;
}
/** Storage owns checkpoint acquisition and publication. It never routes a model
 * failure, changes a task state, starts an agent or grants execution authority. */
export class WorkflowCheckpointService {
  /** Save a checkpoint; release=true additionally hands off project custody.
   * Throws WorkflowCheckpointError without classifying an agent as failed. */
  save(input:WorkflowCheckpointInput,release=false):void {
    try{this.publish(input,release)}catch(error){throw new WorkflowCheckpointError(input.state.taskId,input.state.revision,error)}
  }
  private publish({state,store,manager,locks,assertCurrent,assertQuiescent,retireAuthority}:WorkflowCheckpointInput,release:boolean):void {
    if(!readProjectCustodian(state.repoRoot))return;
    assertCurrent();assertQuiescent();
    const previous=currentProjectHandoffCandidatePaths(state.repoRoot);
    const descriptors=previous.filter(path=>!path.startsWith(`candidates/${state.taskId}/checkpoints/`));
    if(state.candidate){
      const saved=captureCandidateCheckpoint(state.repoRoot,store.root,store.agentDataRoot,
        {manager:manager,workspaceLock:locks.workspace});
      descriptors.push(`candidates/${state.taskId}/checkpoints/${saved.descriptorDigest}.json`);
    }else if(['BLOCKED','AWAITING_HUMAN','READY'].includes(state.state)&&state.blockedReason==='Developer reported a bounded blocker'){
      // Persist the verified no-effects baseline before sealing/releasing custody.
      // The checkpoint preserves evidence; import still requires fresh approval.
      captureBoundedDeveloperCheckpoint(state.repoRoot,store.root,store.agentDataRoot,
        {manager:manager,workspaceLock:locks.workspace,inspect:store.artifactInspection});
    }
    const assertProjectQuiescent=()=>{
      assertQuiescent();
      const tasksRoot=dirname(store.root);
      for(const id of readdirSync(tasksRoot)){
        if(!validateScalar('ID',id).ok)throw new Error('PROJECT_HANDOFF_SOURCE_CHANGED');
        const root=join(tasksRoot,id),stat=lstatSync(root);
        if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(root)!==root)throw new Error('PROJECT_HANDOFF_SOURCE_CHANGED');
        const ledger=DurableStore.load(root);
        if(ledger.truncatedTailBytes||inspectHostCommandRecovery(root,ledger).status!=='QUIESCENT'||ledger.state.runs.some(run=>!runQuiescent(run)))throw new Error('PROJECT_HANDOFF_ROLE_NOT_QUIESCENT');
        if(id===state.taskId&&ledger.state.revision!==state.revision)throw new Error('PROJECT_CHECKPOINT_STALE');
      }
    };
    const input={repoRoot:state.repoRoot,manager:manager,workspaceLock:locks.workspace,
      assertQuiescent:assertProjectQuiescent,candidateDescriptors:descriptors};
    if(release)releaseProjectHandoff({...input,retireAuthority:retireAuthority});
    else sealProjectHandoff(input);
  }
}
