import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { canonicalize, hashBytes } from '../src/contracts.js';
import { ControlledDeveloperRunner } from '../src/controlled-developer.js';
import controlledDev from '../extensions/controlled-dev.js';

/** Explicit test-only fault injection. No fabricated child output, approval or ScopeGuard result.
 * The real Developer returns first; the production Orchestrator then observes the forbidden
 * candidate mutation through its normal ScopeGuard capture. Never installed by the package. */
export function installP15ScopeFault(repoRoot:string,reportPath:string):()=>void{
  const root=realpathSync(repoRoot),reportDirectory=realpathSync(join(reportPath,'..'));
  const inside=(parent:string,path:string)=>{const r=relative(parent,path);return !r||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('../'))};
  if(root!==repoRoot||inside(root,reportDirectory))throw new Error('P15_PROBE_PATH_INVALID');
  const original=ControlledDeveloperRunner.prototype.run;let fired=false;
  const wrapped:typeof original=async function(assignment,context,options){
    const result=await original.call(this,assignment,context,options);
    const a=assignment as {taskId:string;assignmentId:string;repoRoot:string;workRoot:string};
    if(a.taskId!=='p15-real-scope-negative'||a.repoRoot!==root)return result;
    if(fired)throw new Error('P15_PROBE_ALREADY_FIRED');
    const work=realpathSync(a.workRoot);
    if(work!==a.workRoot||inside(root,work)||inside(work,root))throw new Error('P15_PROBE_WORKSPACE_INVALID');
    const target=join(work,'forbidden.txt'),stat=lstatSync(target);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new Error('P15_PROBE_FILE_INVALID');
    const before=readFileSync(target),after=Buffer.from('P15 host-controlled out-of-scope mutation\n');
    // Write intent outside either workspace before injecting. Existing reports are never overwritten.
    writeFileSync(reportPath,canonicalize({schemaVersion:1,probeOnly:true,evidenceLevel:'real-host with host-controlled fault injection',
      source:'after real Developer return, before Orchestrator ScopeGuard capture',taskId:a.taskId,assignmentId:a.assignmentId,
      runId:result.evidence.runId,originalRepoRoot:root,candidateWorkRoot:work,path:'forbidden.txt',
      beforeDigest:hashBytes(before),injectedDigest:hashBytes(after),originalTouched:false,approvalFabricated:false}),{flag:'wx',mode:0o600});
    fired=true;writeFileSync(target,after);
    return result;
  };
  ControlledDeveloperRunner.prototype.run=wrapped;
  return ()=>{if(ControlledDeveloperRunner.prototype.run===wrapped)ControlledDeveloperRunner.prototype.run=original};
}

export default function negativeHostProbe(pi:any):void{
  // Pi gives separately loaded extensions separate module graphs. Load the production factory
  // here so its runner and the test wrapper share one class identity. Do not load both entrypoints.
  controlledDev(pi);
  let dispose:(()=>void)|undefined;
  pi.on('session_start',(_event:unknown,ctx:any)=>{
    const root=process.env.PI_CONTROLLED_P15_NEGATIVE_ROOT,report=process.env.PI_CONTROLLED_P15_NEGATIVE_REPORT;
    if(!root||!report||ctx.mode!=='tui'||realpathSync(ctx.cwd)!==root)throw new Error('P15_PROBE_EXPLICIT_FIXTURE_REQUIRED');
    dispose=installP15ScopeFault(root,report);
    ctx.ui.notify('P15 NEGATIVE TEST: after the real Developer returns, the host probe will alter forbidden.txt ONLY in the candidate. The production ScopeGuard must block. No approval is fabricated.','warning');
  });
  pi.on('session_shutdown',()=>{dispose?.();dispose=undefined});
}
