import {existsSync,lstatSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {join,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CandidateGit} from './candidate-git.js';
import type {SnapshotStorageProgress} from './candidate-git.js';
import {canonicalize,hashCanonical,parseJson} from './contracts.js';
import type {ArtifactRef,CandidateManifest,Json} from './contracts.js';
import {projectCustodianRoot} from './project-storage.js';
import {projectHandoffCandidateManifest} from './project-handoff.js';
import {consumeTrustedConfirmation,createTrustedConfirmationRequest} from './trusted-confirmation.js';
import type {TrustedConfirmationReceipt,TrustedConfirmationRequest} from './trusted-confirmation.js';

interface Snapshot {readonly root:string;readonly manifest:CandidateManifest}
export interface CandidateStorageProposal {
 readonly id:string;readonly namespaceDigest:string;readonly snapshotCount:number;readonly legacyFiles:number;
 readonly legacyBytes:number;readonly uniqueBytes:number;readonly newSharedBytes:number;readonly estimatedSavedBytes:number;
}
interface Prepared {repo:string;git:CandidateGit;snapshots:Snapshot[];request?:TrustedConfirmationRequest}
interface ReceiptStore {put(id:string,content:string,mediaType:string):ArtifactRef;read(ref:ArtifactRef):Uint8Array}
const proposals=new WeakMap<object,Prepared>();
const fail=(code:string):never=>{throw new Error(code)};
export function candidateStorageNamespaceDigest(repo:string):string{
 return hashCanonical(projectHandoffCandidateManifest(repo));
}
function directory(path:string):void{const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(path)!==path)fail('CANDIDATE_STORAGE_PATH_INVALID')}
/** Read-only inventory. Preparation neither rewrites a container nor creates
 * action authority. Native confirmation and the existing owner lease follow. */
export async function prepareCandidateStorageReduction(repo:string,data:string,boundary:()=>Promise<void>,progress?:(p:SnapshotStorageProgress,index:number,total:number)=>void):Promise<CandidateStorageProposal>{
 const custodian=projectCustodianRoot(repo);if(!custodian)fail('PROJECT_HANDOFF_NOT_ADOPTED');
 const before=candidateStorageNamespaceDigest(repo),git=new CandidateGit(repo,data),snapshots:Snapshot[]=[],candidates=join(custodian!,'candidates');
 if(existsSync(candidates)){
  directory(candidates);
  for(const task of readdirSync(candidates).sort()){
   if(task==='.objects')continue;const folder=join(candidates,task);directory(folder);
   for(const name of readdirSync(folder).sort()){
    if(!/^[a-f0-9]{64}$/.test(name))continue;
    const root=join(folder,name);directory(root);const path=join(root,'manifest.json'),s=lstatSync(path);
    if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>64*1024*1024||realpathSync(path)!==path)fail('CANDIDATE_STORAGE_PATH_INVALID');
    const bytes=readFileSync(path),manifest=parseJson(bytes,64*1024*1024) as unknown as CandidateManifest;
    if(hashCanonical(manifest)!==name||bytes.toString('utf8')!==canonicalize(manifest))fail('GIT_SNAPSHOT_DIGEST_MISMATCH');
    snapshots.push({root,manifest});if(snapshots.length>256)fail('CANDIDATE_STORAGE_LIMIT');await boundary();
   }
  }
 }
 const unique=new Map<string,number>();let legacyFiles=0,legacyBytes=0,newSharedBytes=0;
 for(let i=0;i<snapshots.length;i++){
  const s=snapshots[i],observed=await git.inspectSnapshotStorage(s.root,s.manifest,boundary,p=>progress?.(p,i+1,snapshots.length));
  for(const [hash,path] of observed.blobs){const size=lstatSync(path).size;if(unique.has(hash)&&unique.get(hash)!==size)fail('GIT_SNAPSHOT_DIGEST_MISMATCH');unique.set(hash,size)}
  for(const path of observed.legacyBlobs.values()){legacyFiles++;legacyBytes+=lstatSync(path).size}
 }
 const shared=join(candidates,'.objects');
 for(const [hash,size] of unique)if(!existsSync(join(shared,hash)))newSharedBytes+=size;
 const uniqueBytes=[...unique.values()].reduce((n,v)=>n+v,0);if(uniqueBytes>1024*1024*1024)fail('CANDIDATE_STORAGE_LIMIT');
 if(candidateStorageNamespaceDigest(repo)!==before)fail('CANDIDATE_STORAGE_CHANGED');
 const proposal=Object.freeze({id:`storage-${randomUUID()}`,namespaceDigest:before,snapshotCount:snapshots.length,legacyFiles,legacyBytes,uniqueBytes,newSharedBytes,estimatedSavedBytes:Math.max(0,legacyBytes-newSharedBytes)});
 proposals.set(proposal,{repo,git,snapshots});return proposal;
}
export function candidateStorageReductionRequest(proposal:CandidateStorageProposal):TrustedConfirmationRequest{
 const p=proposals.get(proposal);if(!p)fail('CANDIDATE_STORAGE_PROPOSAL_INVALID');
 const mib=(n:number)=>(n/1048576).toFixed(1)+' MiB';
 return p!.request??=createTrustedConfirmationRequest({purpose:'project-storage-optimization',subjectKind:'candidate-storage',subjectId:proposal.id,subjectRevision:0,action:'APPROVE',payload:proposal as unknown as Json,
  presentation:{title:'Reduce duplicate saved copies?',content:`Saved copies checked: ${proposal.snapshotCount}.\nFiles in the old saved copies: ${proposal.legacyFiles} (${mib(proposal.legacyBytes)}).\nContent needed after sharing: ${mib(proposal.uniqueBytes)}.\nAdditional space needed before cleanup: ${mib(proposal.newSharedBytes)}.\nExpected space recovered: ${mib(proposal.estimatedSavedBytes)}.\nSource code, candidate contents, task history, test results and consumed attempts remain unchanged. The package saves and verifies shared content before removing old copies. Alt+I requests a pause after the current file. Continuing requires a fresh confirmation. Shared copies require package version 0.1.0-beta.3 or later, including on another computer.`}});
}
/** The native receipt is burned before the first mutation. File boundaries
 * verify the caller's lease and remain cooperative with pause/consultation. */
export async function applyCandidateStorageReduction(proposal:CandidateStorageProposal,receipt:TrustedConfirmationReceipt,store:ReceiptStore,assertOwner:()=>void,boundary:()=>Promise<void>,progress?:(p:SnapshotStorageProgress,index:number,total:number)=>void){
 const p=proposals.get(proposal);if(!p?.request)fail('CANDIDATE_STORAGE_PROPOSAL_INVALID');
 const current=()=>{assertOwner();if(candidateStorageNamespaceDigest(p!.repo)!==proposal.namespaceDigest)fail('CANDIDATE_STORAGE_CHANGED');return p!.request};
 const confirmationRef=consumeTrustedConfirmation(receipt,current,store);proposals.delete(proposal);
 const startedAt=new Date().toISOString(),started=Date.now();let removedBytes=0,removedFiles=0,currentBytes=0,currentFiles=0,paused=false;
 try{
  for(let i=0;i<p!.snapshots.length;i++){
   currentBytes=0;currentFiles=0;
   const s=p!.snapshots[i],result=await p!.git.shareSnapshotStorage(s.root,s.manifest,async()=>{assertOwner();await boundary()},value=>{currentBytes=value.removedBytes??currentBytes;currentFiles=value.removedFiles??currentFiles;progress?.(value,i+1,p!.snapshots.length)});
   removedBytes+=result.removedBytes;removedFiles+=result.removedFiles;currentBytes=0;currentFiles=0;
  }
 }catch(error){if((error as Error).message!=='CANDIDATE_STORAGE_PAUSED')throw error;paused=true}
 assertOwner();
 return {schemaVersion:1,status:paused?'PAUSED':'COMPLETE',proposalId:proposal.id,confirmationRef,removedBytes:removedBytes+currentBytes,removedFiles:removedFiles+currentFiles,
  startedAt,endedAt:new Date().toISOString(),durationMs:Date.now()-started,logicalCandidatesUnchanged:true,providerCalls:0,
  snapshots:p!.snapshots.map(s=>relative(p!.repo,s.root))};
}
