import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { hashCanonical, hashBytes, parseJson } from './contracts.js';
import { inventoryTree, inventoryHash, changedInventoryPaths } from './controlled-agent-runtime.js';
import type { TreeInventory } from './controlled-agent-runtime.js';
import { CandidateGit } from './candidate-git.js';
import { CandidatePromotionRepository } from './candidate-promotion-repository.js';
import type { ArtifactInspection } from './store.js';
import { execFileSync } from 'node:child_process';
import { trackedWorkspaceManifest } from './scope-guard.js';
import { HOST_GIT_CONFIG, hostGitEnvironment } from './host-git-policy.js';
const issued=new WeakSet<object>();
/** Recognizes only a proven promotion chain. It never authorizes a mutation. A changed primary
 * directory without authenticated results is rejected even when its new HEAD looks valid.
 * Dirty primary files must remain byte-identical; approved promotion cannot overwrite them. */
export class IntegrationPrimaryCanary {
  readonly #git:CandidateGit;readonly #head:string;readonly #target:string;readonly #inventory:string;readonly #status:string;readonly #sensitive:string;
  readonly #initialTree:TreeInventory;
  constructor(readonly data:string,readonly repo:string,readonly inspect:ArtifactInspection){
    this.#git=new CandidateGit(repo,data);this.#head=this.#git.head();this.#target=this.#git.target();this.#initialTree=inventoryTree(repo,['.git']);this.#inventory=inventoryHash(this.#initialTree);
    this.#status=this.#readStatus();this.#sensitive=this.#sensitiveDigest();issued.add(this);
  }
  #readStatus(){return execFileSync('git',['-C',this.repo,...HOST_GIT_CONFIG,'status','--porcelain=v1','-z','--untracked-files=all'],
    {encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024,env:hostGitEnvironment()})}
  #sensitiveDigest(){
    const gitDir=execFileSync('git',['-C',this.repo,...HOST_GIT_CONFIG,'rev-parse','--absolute-git-dir'],{encoding:'utf8',timeout:30000,maxBuffer:16384,env:hostGitEnvironment()}).trim();
    return hashCanonical(['config','HEAD','hooks','info'].map(name=>{const p=join(gitDir,name);return [name,existsSync(p)?name==='hooks'||name==='info'?inventoryHash(inventoryTree(p)):hashBytes(readFileSync(p)):null]}));
  }
  verify(repo=this.repo):boolean {
    if(!issued.has(this)||repo!==this.repo)return false;
    try{
      if(this.#git.target()!==this.#target||this.#sensitiveDigest()!==this.#sensitive)return false;
      const head=this.#git.head(),physical=inventoryTree(this.repo,['.git']),inventory=inventoryHash(physical),status=this.#readStatus();
      if(head===this.#head)return inventory===this.#inventory&&status===this.#status;
      // Every changed primary byte must be the clean checkout of a trusted promotion result.
      // A clean Git tree alone is insufficient: arbitrary commits and ref updates are rejected.
      if(this.#status||status)return false;
      const promotion=CandidatePromotionRepository.open(this.data,this.repo,this.inspect);if(!promotion)return false;
      let cursor=this.#head,finalResult:ReturnType<typeof promotion.results>[number]|undefined;const results=promotion.results();
      for(let n=0;n<results.length&&cursor!==head;n++){
        const result=results.find(r=>r.targetRef===this.#target&&r.previousHead===cursor&&this.#git.ancestor(r.resultingHead,head));
        if(!result)return false;cursor=result.resultingHead;finalResult=result;
      }
      if(cursor!==head||!finalResult)return false;
      // A trusted promotion may change source paths, not unrelated local files.
      // Ignored credentials/cache can exist without becoming writable authority.
      const sourcePaths=new Set([...this.#git.pathsAt(this.#head),...this.#git.pathsAt(head)]
        .flatMap(path=>path.split('/').map((_,i,parts)=>parts.slice(0,i+1).join('/'))));
      if(changedInventoryPaths(this.#initialTree,physical).some(path=>!sourcePaths.has(path)))return false;
      // Git status can conceal bytes via assume-unchanged/skip-worktree flags. Compare the
      // physical manifest with the authenticated integration digest, not the index's claim.
      const intent=parseJson(promotion.store.read(finalResult.intentRef),2*1024*1024) as any;
      const proposal=parseJson(promotion.store.read(intent.proposalRef),2*1024*1024) as any;
      return proposal.integrationCommit===head&&hashCanonical(trackedWorkspaceManifest(this.repo,head))===proposal.integrationDigest;
    }catch{return false}
  }
}

/** JSON or duck-typed callbacks cannot waive the Reviewer canary. */
export function verifyIntegrationPrimaryCanary(value:unknown,repo:string):boolean {
  return !!value&&typeof value==='object'&&issued.has(value)&&IntegrationPrimaryCanary.prototype.verify.call(value,repo);
}
