import {execFileSync} from 'node:child_process';
import {closeSync,existsSync,fchmodSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {dirname,join,relative,resolve} from 'node:path';
import {Buffer} from 'node:buffer';
import {canonicalize,hashBytes,hashCanonical,parseJson} from './contracts.js';
import type {ArtifactRef} from './contracts.js';
import {DurableStore} from './store.js';
import type {ArtifactInspection} from './store.js';
import {projectIdentity} from './project-identity.js';
import {initializeProjectCustodian,readProjectCustodian} from './project-custodian.js';
import type {ProjectCustodian} from './project-custodian.js';
import {hostGitEnvironment} from './host-git-policy.js';
import {consumeTrustedConfirmation,createTrustedConfirmationRequest} from './trusted-confirmation.js';
import type {TrustedConfirmationReceipt,TrustedConfirmationRequest} from './trusted-confirmation.js';
import {withLockMutation} from './lock-manager.js';
import type {LockHandle,LockManager} from './lock-manager.js';

export interface HandoffFile {readonly path:string;readonly digest:string;readonly bytes:number;readonly mode:number}
export interface HandoffTaskHead {readonly taskId:string;readonly specHash:string;readonly stateRevision:number;readonly stateDigest:string;readonly eventHash:string}
export interface ProjectHandoff {
  readonly schemaVersion:1;readonly kind:'ADOPTION'|'CHECKPOINT';readonly projectId:string;readonly originalRepoRoot:string;
  readonly sourceHead:string;readonly sourceTree:string;readonly createdAt:string;
  readonly taskHeads:readonly HandoffTaskHead[];readonly namespaceManifest:readonly HandoffFile[];
  readonly candidateDescriptors:readonly string[];readonly quiescence:'VERIFIED';
  readonly ownerDisposition:'LEASE_HELD_CHECKPOINT'|'RELEASED_FOR_TRANSFER';readonly ownerSessionId:string;readonly runtimeGeneration:string;
  readonly ownerRelease:null|{readonly previousToken:string;readonly workspaceHash:string;readonly ownerRepoRoot:string;readonly releasedAt:string};
}
export interface ProjectHandoffProposal {
  readonly id:string;readonly projectId:string;readonly repoRoot:string;readonly machineDataRoot:string;
  readonly sourceHead:string;readonly sourceTree:string;readonly sourceDigest:string;readonly taskHeadsDigest:string;
  readonly taskCount:number;readonly fileCount:number;readonly bytes:number;
  readonly recovery?:'ROLLBACK'|'CLEANUP';readonly migrationId?:string;readonly intentDigest?:string;
}
export interface ProjectHandoffCapability extends ProjectHandoffProposal {readonly confirmationRef:ArtifactRef}
export interface VerifiedProjectHandoff extends ProjectHandoff {readonly descriptorDigest:string}
export interface HandoffHumanChange {readonly path:string;readonly status:'ADDED'|'CHANGED'|'REMOVED'}
export interface RuntimeImportHandoff {readonly record:VerifiedProjectHandoff;readonly humanChanges:readonly HandoffHumanChange[];readonly humanDigest:string}
interface Snapshot {files:HandoffFile[];directories:string[]}
interface Recovery {journal:MigrationJournal;local:Snapshot;human:Snapshot;stage:Snapshot;intentDigest:string;localReceiptPath?:string}
interface MigrationJournal {schemaVersion:1;id:string;projectId:string;repoRoot:string;machineDataRoot:string;sourceDigest:string;phase:string;source:Snapshot;control:Snapshot;proposal:ProjectHandoffCapability;stagingRoot:string;stageManifest:Snapshot;fileModePolicy?:FileModePolicy}
interface Acquired {proposal:ProjectHandoffProposal;sourceRoot:string;controlRoot:string;source:Snapshot;control:Snapshot;heads:HandoffTaskHead[];request?:TrustedConfirmationRequest;recovery?:Recovery}
interface Authorized {acquired:Acquired;manager:LockManager;workspaceLock:LockHandle;assertQuiescent:()=>void;store:DurableStore}
const proposals=new WeakMap<object,Acquired>(),capabilities=new WeakMap<object,Authorized>();
export class ProjectHandoffError extends Error {constructor(readonly code:string){super(code)}}
function fail(code:string):never{throw new ProjectHandoffError(code)}
const MAX_FILES=100000,MAX_BYTES=1024*1024*1024,MAX_FILE=64*1024*1024;
function git(repo:string,args:readonly string[]):string{return execFileSync('git',['--no-optional-locks','-C',repo,'-c','core.fsmonitor=false',...args],{encoding:'utf8',env:hostGitEnvironment(),timeout:30000,maxBuffer:4*1024*1024}).trim()}
function directory(path:string):void{const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(path)!==path)fail('PROJECT_HANDOFF_PATH_INVALID')}
function regular(path:string):Uint8Array {const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>MAX_FILE||realpathSync(path)!==path)fail('PROJECT_HANDOFF_FILE_INVALID');const raw=readFileSync(path);if(raw.byteLength>MAX_FILE)fail('PROJECT_HANDOFF_LIMIT');return raw}
function snapshot(root:string,skip?:string):Snapshot {
  if(!existsSync(root))return {files:[],directories:[]};directory(root);const result:Snapshot={files:[],directories:[]};let bytes=0;
  function walk(folder:string){for(const name of readdirSync(folder).sort()){
    const path=join(folder,name),rel=relative(root,path);if(rel===skip)continue;
    if(/[\u0000-\u001f\u007f]/.test(rel))fail('PROJECT_HANDOFF_PATH_INVALID');const s=lstatSync(path);
    if(s.isSymbolicLink())fail('PROJECT_HANDOFF_FILE_INVALID');
    if(s.isDirectory()){directory(path);result.directories.push(rel);walk(path)}
    else{const raw=regular(path);bytes+=raw.byteLength;result.files.push({path:rel,digest:hashBytes(raw),bytes:raw.byteLength,mode:s.mode&0o777});}
    if(result.files.length+result.directories.length>MAX_FILES||bytes>MAX_BYTES)fail('PROJECT_HANDOFF_LIMIT');
  }}walk(root);return result;
}
function equal(a:unknown,b:unknown):boolean{return canonicalize(a)===canonicalize(b)}
function withReceipt(previous:Snapshot,next:Snapshot,path:string,ref:ArtifactRef):Snapshot {
  const receipt=next.files.find(f=>f.path===path);
  if(!receipt||receipt.digest!==ref.digest||receipt.bytes!==ref.bytes
    ||!equal({files:next.files.filter(f=>f.path!==path),directories:next.directories},previous))fail('PROJECT_HANDOFF_SOURCE_CHANGED');
  return next;
}
function heads(root:string):HandoffTaskHead[] {
  const tasks=join(root,'tasks');if(!existsSync(tasks))return [];directory(tasks);
  return readdirSync(tasks).sort().map(taskId=>{if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId))fail('PROJECT_HANDOFF_TASK_INVALID');
    const ledger=DurableStore.load(join(tasks,taskId));if(ledger.truncatedTailBytes||ledger.state.taskId!==taskId)fail('PROJECT_HANDOFF_TASK_INVALID');
    return {taskId,specHash:ledger.state.specHash,stateRevision:ledger.state.revision,stateDigest:hashCanonical(ledger.state),eventHash:ledger.events.at(-1)!.eventHash};
  });
}
function clean(repo:string):void {if(git(repo,['status','--porcelain','--untracked-files=all']))fail('PROJECT_HANDOFF_SOURCE_DIRTY')}
function absent(path:string):void{try{lstatSync(path);fail('PROJECT_HANDOFF_DESTINATION_EXISTS')}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error}}
function sync(path:string):void{const fd=openSync(path,'r');try{fsyncSync(fd)}finally{closeSync(fd)}}
function make(path:string):void{if(existsSync(path)){directory(path);return}make(dirname(path));mkdirSync(path,{mode:0o700});directory(path);sync(dirname(path))}
function atomic(path:string,value:unknown):void{directory(dirname(path));const temp=join(dirname(path),`.handoff-${randomUUID()}.tmp`),fd=openSync(temp,'wx',0o600);try{writeFileSync(fd,canonicalize(value));fsyncSync(fd)}finally{closeSync(fd)}renameSync(temp,path);sync(dirname(path))}
function copy(source:string,target:string,value:Snapshot,inspect:(raw:Uint8Array,mediaType:string)=>'ACCEPT'|'REJECT'):void {
  make(target);for(const dir of value.directories)make(join(target,dir));
  for(const item of value.files){const raw=regular(join(source,item.path));if(hashBytes(raw)!==item.digest||raw.byteLength!==item.bytes)fail('PROJECT_HANDOFF_SOURCE_CHANGED');
    if(inspect(raw,'application/octet-stream')!=='ACCEPT')fail('PROJECT_HANDOFF_DISCLOSURE_REJECTED');
    const path=join(target,item.path);directory(dirname(path));const fd=openSync(path,'wx',item.mode);try{writeFileSync(fd,raw);try{fchmodSync(fd,item.mode)}catch{}fsyncSync(fd)}finally{closeSync(fd)}
  }for(const dir of [...value.directories].reverse())sync(join(target,dir));sync(target);
}
interface FileModePolicy {readonly kind:'EXACT'|'FIXED';readonly mode?:number}
function fileModePolicy(root:string):FileModePolicy {
  const path=join(root,`.mode-probe-${randomUUID()}`),fd=openSync(path,'wx',0o600);let a:number,b:number;
  try{try{fchmodSync(fd,0o600)}catch{}a=lstatSync(path).mode&0o777;try{fchmodSync(fd,0o700)}catch{}b=lstatSync(path).mode&0o777;fsyncSync(fd)}finally{closeSync(fd);unlinkSync(path);sync(root)}
  if(a===0o600&&b===0o700)return {kind:'EXACT'};
  if(a===b)return {kind:'FIXED',mode:a};fail('PROJECT_HANDOFF_FILE_MODE_UNSUPPORTED');
}
function copied(actual:Snapshot,expected:Snapshot,policy:FileModePolicy):boolean {
  return equal(actual,{directories:expected.directories,files:expected.files.map(f=>({...f,mode:policy.kind==='FIXED'?policy.mode!:f.mode}))});
}
function assertLease(a:Authorized):void {
  if(!a.manager.verifyWorkspaceLock(a.workspaceLock)||a.workspaceLock.record.workspaceHash!==a.manager.workspaceIdentity(a.acquired.proposal.repoRoot).workspaceHash)fail('PROJECT_HANDOFF_LEASE_LOST');
  a.assertQuiescent();
}
function fresh(a:Acquired,receiptPath?:string):void {
  clean(a.proposal.repoRoot);
  if(git(a.proposal.repoRoot,['rev-parse','HEAD'])!==a.proposal.sourceHead||git(a.proposal.repoRoot,['rev-parse','HEAD^{tree}'])!==a.proposal.sourceTree
    ||!equal(snapshot(a.sourceRoot,receiptPath),a.source)||!equal(snapshot(a.controlRoot),a.control))fail('PROJECT_HANDOFF_SOURCE_CHANGED');
  // Preparation verified each ledger's chain and semantic head. The complete namespace
  // comparison above includes its state, events, spec and artifacts (bytes, names and modes).
  // Identical acquired bytes cannot produce a different head; replaying every ledger at
  // each publication boundary adds cost without strengthening this exact snapshot check.
  if(a.recovery){
    if(hashBytes(regular(join(a.proposal.repoRoot,'.controlled-dev','migration.json')))!==a.recovery.intentDigest
      ||!equal(snapshot(join(a.proposal.repoRoot,'.controlled-dev'),a.recovery.localReceiptPath),a.recovery.local)
      ||!equal(snapshot(join(a.proposal.repoRoot,'Documentazione')),a.recovery.human))fail('PROJECT_HANDOFF_RECOVERY_CHANGED');
  }
}
/** Read-only preparation. No relocation, marker, source modification or credential copying. */
export function prepareProjectHandoff(input:{repoRoot:string;machineDataRoot:string}):ProjectHandoffProposal {
  const repo=realpathSync(input.repoRoot),machine=realpathSync(input.machineDataRoot);
  if(repo!==input.repoRoot||machine!==input.machineDataRoot||resolve(repo)!==repo||resolve(machine)!==machine||repo.startsWith(machine+'/')||machine.startsWith(repo+'/'))fail('PROJECT_HANDOFF_PATH_INVALID');
  if(readProjectCustodian(repo))fail('PROJECT_HANDOFF_ALREADY_ADOPTED');clean(repo);
  absent(join(repo,'Documentazione'));const projectId=projectIdentity(repo),sourceRoot=join(machine,'controlled-dev','projects',projectId),controlRoot=join(machine,'controlled-dev','control',projectId);
  directory(sourceRoot);const source=snapshot(sourceRoot),control=snapshot(controlRoot),taskHeads=heads(sourceRoot);
  const proposal:Object & ProjectHandoffProposal=Object.freeze({id:`handoff-${randomUUID()}`,projectId,repoRoot:repo,machineDataRoot:machine,
    sourceHead:git(repo,['rev-parse','HEAD']),sourceTree:git(repo,['rev-parse','HEAD^{tree}']),sourceDigest:hashCanonical({source,control}),taskHeadsDigest:hashCanonical(taskHeads),
    taskCount:taskHeads.length,fileCount:source.files.length+control.files.length,bytes:[...source.files,...control.files].reduce((sum,f)=>sum+f.bytes,0)});
  proposals.set(proposal,{proposal,sourceRoot,controlRoot,source,control,heads:taskHeads});return proposal;
}
function journal(repo:string,machine:string):{value:MigrationJournal;digest:string} {
  const raw=regular(join(repo,'.controlled-dev','migration.json')),value=parseJson(raw,MAX_FILE) as unknown as MigrationJournal;
  if(!value||value.schemaVersion!==1||value.repoRoot!==repo||value.machineDataRoot!==machine||!/^handoff-[a-f0-9-]{36}$/.test(value.id)
    ||!/^[a-f0-9]{64}$/.test(value.projectId)||value.proposal?.id!==value.id||value.proposal?.repoRoot!==repo||value.proposal?.machineDataRoot!==machine||value.proposal?.projectId!==value.projectId
    ||value.stagingRoot!==join(machine,'controlled-dev','project-handoff-staging',value.id)||!['PREPARING','PUBLISHING','PUBLISHED'].includes(value.phase)
    ||canonicalize(value)!==Buffer.from(raw).toString('utf8')||hashCanonical({source:value.source,control:value.control})!==value.sourceDigest)fail('PROJECT_HANDOFF_RECOVERY_INVALID');
  return {value,digest:hashBytes(raw)};
}
function partialMatches(actual:Snapshot,expected:Snapshot,policy:FileModePolicy={kind:'EXACT'}):void {
  if(!['EXACT','FIXED'].includes(policy.kind)||(policy.kind==='FIXED'&&(!Number.isInteger(policy.mode)||policy.mode!<0||policy.mode!>0o777)))fail('PROJECT_HANDOFF_RECOVERY_INVALID');
  const files=new Map(expected.files.map(f=>[f.path,{...f,mode:policy.kind==='FIXED'?policy.mode!:f.mode}]));
  if(actual.directories.some(p=>!expected.directories.includes(p))||actual.files.some(f=>!equal(f,files.get(f.path))))fail('PROJECT_HANDOFF_RECOVERY_CONFLICT');
}
/** Explicit native restart preparation. It never treats an incomplete marker as a fresh project.
 * Personal changes in either collection are conflicts requiring the operator's decision. */
export function prepareProjectHandoffRecovery(input:{repoRoot:string;machineDataRoot:string}):ProjectHandoffProposal {
  const repo=realpathSync(input.repoRoot),machine=realpathSync(input.machineDataRoot);if(repo!==input.repoRoot||machine!==input.machineDataRoot)fail('PROJECT_HANDOFF_PATH_INVALID');clean(repo);
  const {value:j,digest}=journal(repo,machine),sourceRoot=join(machine,'controlled-dev','projects',j.projectId),controlRoot=join(machine,'controlled-dev','control',j.projectId);
  const source=snapshot(sourceRoot),control=snapshot(controlRoot);
  if((existsSync(sourceRoot)&&!equal(source,j.source))||(existsSync(controlRoot)&&!equal(control,j.control)))fail('PROJECT_HANDOFF_RECOVERY_CONFLICT');
  const published=existsSync(join(repo,'.controlled-dev','project.json'));
  if(published){const marker=readProjectCustodian(repo);if(marker?.projectId!==j.projectId||!readProjectHandoff(repo))fail('PROJECT_HANDOFF_RECOVERY_INVALID')}
  else{
    if(!existsSync(sourceRoot))fail('PROJECT_HANDOFF_RECOVERY_CONFLICT');
    if(j.phase==='PREPARING'){
      // During the first copy, accept only an exact subset of the captured original files.
      // A partially written candidate with no completed descriptor remains an explicit conflict.
      const expected:Snapshot={files:[...j.stageManifest.files],directories:[...j.stageManifest.directories]};
      for(const [prefix,source] of [[`state/controlled-dev/projects/${j.projectId}`,j.source],[`control/${j.projectId}`,j.control]] as const){
        const parts=prefix.split('/');for(let i=1;i<=parts.length;i++)expected.directories.push(parts.slice(0,i).join('/'));
        expected.directories.push(...source.directories.map(p=>`${prefix}/${p}`));expected.files.push(...source.files.map(f=>({...f,path:`${prefix}/${f.path}`})));
      }partialMatches(snapshot(j.stagingRoot),expected);
    }else if(!equal(snapshot(j.stagingRoot),j.stageManifest))fail('PROJECT_HANDOFF_RECOVERY_CONFLICT');
    for(const name of ['state','control','candidates'])partialMatches(snapshot(join(repo,'.controlled-dev',name)),snapshot(join(j.stagingRoot,name)),j.fileModePolicy);
    partialMatches(snapshot(join(repo,'Documentazione')),snapshot(join(j.stagingRoot,'human')),j.fileModePolicy);
    // Unexpected operator files are never removed as part of a rollback.
    for(const name of readdirSync(join(repo,'.controlled-dev')))if(!['state','control','candidates','migration.json','handoffs','handoff.json'].includes(name))fail('PROJECT_HANDOFF_RECOVERY_CONFLICT');
    const seal=join(repo,'.controlled-dev','handoff.json');if(existsSync(seal)){
      const pointer=parseJson(regular(seal),4096) as {schemaVersion:number;descriptorDigest:string};
      if(pointer.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(pointer.descriptorDigest)||readdirSync(join(repo,'.controlled-dev','handoffs')).some(name=>name!==`${pointer.descriptorDigest}.json`)
        ||hashBytes(regular(join(repo,'.controlled-dev','handoffs',`${pointer.descriptorDigest}.json`)))!==pointer.descriptorDigest)fail('PROJECT_HANDOFF_RECOVERY_CONFLICT');
    }else if(existsSync(join(repo,'.controlled-dev','handoffs'))&&readdirSync(join(repo,'.controlled-dev','handoffs')).length)fail('PROJECT_HANDOFF_RECOVERY_CONFLICT');
  }
  const taskHeads=existsSync(sourceRoot)?heads(sourceRoot):heads(join(repo,'.controlled-dev','state','controlled-dev','projects',j.projectId));
  const proposal:ProjectHandoffProposal=Object.freeze({id:`handoff-${randomUUID()}`,projectId:j.projectId,repoRoot:repo,machineDataRoot:machine,sourceHead:git(repo,['rev-parse','HEAD']),sourceTree:git(repo,['rev-parse','HEAD^{tree}']),
    sourceDigest:hashCanonical({source,control}),taskHeadsDigest:hashCanonical(taskHeads),taskCount:taskHeads.length,fileCount:source.files.length+control.files.length,bytes:[...source.files,...control.files].reduce((sum,f)=>sum+f.bytes,0),
    recovery:published?'CLEANUP':'ROLLBACK',migrationId:j.id,intentDigest:digest});
  // The recovery compares absent legacy tasks separately: an absent cleaned source has no heads.
  proposals.set(proposal,{proposal,sourceRoot,controlRoot,source,control,heads:heads(sourceRoot),recovery:{journal:j,local:snapshot(join(repo,'.controlled-dev')),human:snapshot(join(repo,'Documentazione')),stage:snapshot(j.stagingRoot),intentDigest:digest}});return proposal;
}
export function projectHandoffRequest(proposal:ProjectHandoffProposal):TrustedConfirmationRequest {
  const a=proposals.get(proposal);if(!a)fail('PROJECT_HANDOFF_PROPOSAL_UNACQUIRED');fresh(a);
  if(!a.request)a.request=createTrustedConfirmationRequest({purpose:'project-handoff',subjectKind:'project',subjectId:proposal.projectId,subjectRevision:0,action:'APPROVE',payload:{...proposal},
    presentation:{title:proposal.recovery?"Resume the interrupted move?":"Keep everything in the project folder?",content:proposal.recovery
      ?`The move was interrupted. The documents and saved state have been verified.\n\n${proposal.recovery==='CLEANUP'?"The collection in the project folder is complete. The temporary copy in the old archive will be deleted after a final comparison.":"Publication was incomplete. Only verified temporary copies will be removed; the original collection remains available and the move can be repeated."}\n\nAn unrecognized personal change stops recovery and requires clarification.`
      :`The existing document collection, personal notes and state will move here for ${proposal.taskCount} tasks.\n\nDocuments: ${join(proposal.repoRoot,'Documentazione')}\nState and working copies: ${join(proposal.repoRoot,'.controlled-dev')}\n\nThere will be one collection. Pi credentials and personal settings will remain on this computer. The move starts only when work is stopped and verified.`}});
  return a.request;
}
/** The receipt always belongs to the same selected archive. An incomplete marker cannot
 * redirect this acquired legacy path, and no arbitrary caller-supplied store root is accepted. */
export function openHandoffReceiptStore(proposal:ProjectHandoffProposal,inspect:ArtifactInspection):DurableStore {
  const a=proposals.get(proposal);if(!a)fail('PROJECT_HANDOFF_PROPOSAL_UNACQUIRED');fresh(a);
  if(existsSync(a.sourceRoot))return DurableStore.legacyPlanningForHandoff(proposal.machineDataRoot,proposal.projectId,inspect);
  if(!a.recovery||proposal.recovery!=='CLEANUP')fail('PROJECT_HANDOFF_RECOVERY_INVALID');
  const store=DurableStore.project(proposal.machineDataRoot,proposal.repoRoot,'planning',inspect,false);if(!store)fail('PROJECT_HANDOFF_RECOVERY_INVALID');return store;
}
export function authorizeProjectHandoff(proposal:ProjectHandoffProposal,receipt:TrustedConfirmationReceipt,options:{store:DurableStore;manager:LockManager;workspaceLock:LockHandle;assertQuiescent:()=>void}):ProjectHandoffCapability {
  const a=proposals.get(proposal);if(!a||!a.request)fail('PROJECT_HANDOFF_PROPOSAL_UNACQUIRED');
  const localPlanning=join(proposal.repoRoot,'.controlled-dev','state','controlled-dev','projects',proposal.projectId,'planning');
  const localReceipt=!!a.recovery&&!existsSync(a.sourceRoot);
  if(options.store.root!==(localReceipt?localPlanning:join(a.sourceRoot,'planning'))||typeof options.assertQuiescent!=='function')fail('PROJECT_HANDOFF_AUTHORITY_INVALID');
  const auth:Authorized={acquired:a,...options};assertLease(auth);fresh(a);
  const receiptPath=`planning/artifacts/confirmation-${receipt.confirmationInstance.id}`;
  if(localReceipt)a.recovery!.localReceiptPath=`state/controlled-dev/projects/${proposal.projectId}/${receiptPath}`;
  const confirmationRef=consumeTrustedConfirmation(receipt,()=>{assertLease(auth);fresh(a,receiptPath);return a.request!},options.store);
  // Only the exact authenticated receipt artifact may augment the captured namespace.
  if(localReceipt){
    a.recovery!.local=withReceipt(a.recovery!.local,snapshot(join(proposal.repoRoot,'.controlled-dev')),a.recovery!.localReceiptPath!,confirmationRef);
    a.recovery!.localReceiptPath=undefined;
  }else a.source=withReceipt(a.source,snapshot(a.sourceRoot),receiptPath,confirmationRef);
  fresh(a);const cap=Object.freeze({...proposal,confirmationRef});capabilities.set(cap,auth);return cap;
}
export function isProjectHandoffCapability(value:unknown):value is ProjectHandoffCapability{return !!value&&typeof value==='object'&&capabilities.has(value)}
export function handoffStagingRoot(cap:ProjectHandoffCapability):string {const a=capabilities.get(cap);if(!a)fail('PROJECT_HANDOFF_AUTHORITY_INVALID');assertLease(a);return join(cap.machineDataRoot,'controlled-dev','project-handoff-staging',cap.id)}
export function handoffTaskHead(cap:ProjectHandoffCapability,taskId:string):HandoffTaskHead {
  const auth=capabilities.get(cap);if(!auth)fail('PROJECT_HANDOFF_AUTHORITY_INVALID');assertLease(auth);fresh(auth.acquired);
  const head=auth.acquired.heads.find(h=>h.taskId===taskId);if(!head)fail('PROJECT_HANDOFF_TASK_INVALID');return Object.freeze({...head});
}
function exclude(repo:string):void {
  const info=join(repo,'.git','info');directory(info);const path=join(info,'exclude');let raw='';if(existsSync(path))raw=Buffer.from(regular(path)).toString('utf8');
  for(const line of ['/.controlled-dev/','/Documentazione/'])if(!raw.split('\n').includes(line))raw+=(raw.endsWith('\n')||!raw?'':'\n')+line+'\n';
  const temp=join(info,`.handoff-exclude-${randomUUID()}`),fd=openSync(temp,'wx',0o600);try{writeFileSync(fd,raw);fsyncSync(fd)}finally{closeSync(fd)}renameSync(temp,path);sync(info);
}
function localManifest(repo:string,projectId:string):HandoffFile[] {
  const result:HandoffFile[]=[];
  for(const prefix of [`.controlled-dev/state/controlled-dev/projects/${projectId}`,`.controlled-dev/control/${projectId}`,'.controlled-dev/candidates','Documentazione']){
    const root=join(repo,prefix);for(const item of snapshot(root).files)result.push({...item,path:`${prefix}/${item.path}`});
  }return result.sort((a,b)=>a.path.localeCompare(b.path));
}
function publishSeal(repo:string,record:ProjectHandoff):void {
  const pointerPath=join(repo,'.controlled-dev','handoff.json'),expected=existsSync(pointerPath)?hashBytes(regular(pointerPath)):undefined;
  for(const path of record.candidateDescriptors)if(!/^candidates\/[A-Za-z0-9._-]+\/checkpoints\/[a-f0-9]{64}\.json$/.test(path)||!existsSync(join(repo,'.controlled-dev',path)))fail('PROJECT_HANDOFF_CANDIDATE_DESCRIPTOR_INVALID');
  const folder=join(repo,'.controlled-dev','handoffs');make(folder);const digest=hashCanonical(record),path=join(folder,`${digest}.json`);
  if(existsSync(path)){if(hashBytes(regular(path))!==digest)fail('PROJECT_HANDOFF_SEAL_CORRUPT')}
  else{const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,canonicalize(record));fsyncSync(fd)}finally{closeSync(fd)}sync(folder)}
  if((existsSync(pointerPath)?hashBytes(regular(pointerPath)):undefined)!==expected)fail('PROJECT_HANDOFF_SEAL_CAS_CONFLICT');
  atomic(pointerPath,{schemaVersion:1,descriptorDigest:digest});
}
function protectedNamespaces(repo:string):void {
  for(const name of ['.controlled-dev','Documentazione']){
    if(git(repo,['ls-files','--',name]))fail('PROJECT_HANDOFF_METADATA_TRACKED');
    try{if(git(repo,['check-ignore','--no-index','--',`${name}/`])!==`${name}/`)fail('PROJECT_HANDOFF_METADATA_NOT_IGNORED')}
    catch{fail('PROJECT_HANDOFF_METADATA_NOT_IGNORED')}
  }
}
export interface CompleteHandoffOptions {
  /** Host checkpoint collector; receives only this consumed native capability. Saves candidate
   * descriptors/snapshots in handoffStagingRoot(cap)/candidates before marker publication. */
  captureCandidates?:(cap:ProjectHandoffCapability)=>readonly string[];
  fault?:(point:'afterCopy'|'beforePublish'|'afterPlacement'|'afterPublish'|'beforeCleanup')=>void;
}
/** Moves the existing archive and collection. The sole marker is published only after all copied
 * bytes have been verified; an interrupted cleanup retains an explicit recovery intent. */
export function completeProjectHandoff(cap:ProjectHandoffCapability,options:CompleteHandoffOptions={}):ProjectHandoff {
  const auth=capabilities.get(cap);if(!auth)fail('PROJECT_HANDOFF_AUTHORITY_INVALID');assertLease(auth);fresh(auth.acquired);
  if(auth.acquired.recovery)fail('PROJECT_HANDOFF_USE_RECOVERY');
  const a=auth.acquired,repo=cap.repoRoot,stage=handoffStagingRoot(cap),target=join(repo,'.controlled-dev');absent(stage);absent(target);absent(join(repo,'Documentazione'));make(stage);
  const intent={schemaVersion:1,id:cap.id,projectId:cap.projectId,repoRoot:repo,machineDataRoot:cap.machineDataRoot,sourceDigest:hashCanonical({source:a.source,control:a.control}),phase:'PREPARING'};
  atomic(join(stage,'intent.json'),intent);
  exclude(repo);make(target);atomic(join(target,'migration.json'),{...intent,source:a.source,control:a.control,proposal:cap,stagingRoot:stage,stageManifest:snapshot(stage)});
  const state=join(stage,'state','controlled-dev','projects',cap.projectId);copy(a.sourceRoot,state,a.source,auth.store.artifactInspection);
  const control=join(stage,'control',cap.projectId);copy(a.controlRoot,control,a.control,auth.store.artifactInspection);
  const candidateDescriptors=options.captureCandidates?.(cap)??[];
  if(a.heads.some(h=>DurableStore.load(join(a.sourceRoot,'tasks',h.taskId)).state.candidate)&&!options.captureCandidates)fail('PROJECT_HANDOFF_CANDIDATE_CHECKPOINT_REQUIRED');
  assertLease(auth);fresh(a);
  if(!equal(snapshot(state),a.source)||!equal(snapshot(control),a.control))fail('PROJECT_HANDOFF_COPY_CHANGED');
  const human=join(state,'human'),humanExists=existsSync(human);if(humanExists)renameSync(human,join(stage,'human'));
  const journal={...intent,source:a.source,control:a.control,proposal:cap,stagingRoot:stage,stageManifest:snapshot(stage)};
  atomic(join(target,'migration.json'),{...journal,phase:'PUBLISHING'});options.fault?.('afterCopy');
  const marker:ProjectCustodian={schemaVersion:1,projectId:cap.projectId,originalRepoRoot:repo,baselineCommit:cap.sourceHead,baselineTree:cap.sourceTree};
  assertLease(auth);fresh(a);options.fault?.('beforePublish');exclude(repo);clean(repo);
  const modePolicy=fileModePolicy(target);
  const publicationJournal={...journal,fileModePolicy:modePolicy};atomic(join(target,'migration.json'),{...publicationJournal,phase:'PUBLISHING'});
  // The marker is deliberately absent while the state, selector and saved candidates are placed.
  // Profile and SSD commonly have different filesystems. Copy verified actual files;
  // only the final small marker is an atomic rename on the destination filesystem.
  for(const name of ['state','control','candidates'])if(existsSync(join(stage,name))){
    const src=join(stage,name),expected=snapshot(src);copy(src,join(target,name),expected,auth.store.artifactInspection);
    if(!copied(snapshot(join(target,name)),expected,modePolicy))fail('PROJECT_HANDOFF_COPY_CHANGED');
  }
  if(humanExists){const expected=snapshot(join(stage,'human'));copy(join(stage,'human'),join(repo,'Documentazione'),expected,auth.store.artifactInspection);
    if(!copied(snapshot(join(repo,'Documentazione')),expected,modePolicy))fail('PROJECT_HANDOFF_COPY_CHANGED');}
  else make(join(repo,'Documentazione'));
  const record:ProjectHandoff={schemaVersion:1,kind:'ADOPTION',projectId:cap.projectId,originalRepoRoot:repo,sourceHead:cap.sourceHead,sourceTree:cap.sourceTree,createdAt:new Date().toISOString(),
    taskHeads:a.heads,namespaceManifest:localManifest(repo,cap.projectId),candidateDescriptors,quiescence:'VERIFIED',ownerDisposition:'LEASE_HELD_CHECKPOINT',ownerSessionId:auth.manager.ownerSessionId,runtimeGeneration:auth.manager.runtimeGeneration,ownerRelease:null};
  publishSeal(repo,record);
  options.fault?.('afterPlacement');
  initializeProjectCustodian(repo,marker,()=>{assertLease(auth);fresh(a);if(!equal(localManifest(repo,cap.projectId),record.namespaceManifest))fail('PROJECT_HANDOFF_COPY_CHANGED')});
  atomic(join(target,'migration.json'),{...publicationJournal,phase:'PUBLISHED'});options.fault?.('afterPublish');assertLease(auth);options.fault?.('beforeCleanup');fresh(a);
  // A source mismatch always preserves the original; a later explicit recovery can reconcile it.
  rmSync(a.sourceRoot,{recursive:true});if(existsSync(a.controlRoot))rmSync(a.controlRoot,{recursive:true});
  atomic(join(target,'migration.json'),{...journal,phase:'COMPLETE',fileModePolicy:modePolicy});rmSync(stage,{recursive:true});capabilities.delete(cap);return record;
}
/** Fresh native receipt and exact lease are required again after a restart. JSON journals alone
 * authorize nothing. Rollback removes only verified temporary copies; cleanup retains one vault. */
export function recoverProjectHandoff(cap:ProjectHandoffCapability):{action:'ROLLED_BACK'|'COMPLETED';record?:ProjectHandoff} {
  const auth=capabilities.get(cap),a=auth?.acquired;if(!auth||!a?.recovery)fail('PROJECT_HANDOFF_AUTHORITY_INVALID');assertLease(auth);fresh(a);
  const repo=cap.repoRoot,recovery=a.recovery,j=recovery.journal;
  if(cap.recovery==='ROLLBACK'){
    // Recheck after the native decision; all original bytes are still present, including Notes.
    if(!equal(snapshot(j.stagingRoot),recovery.stage))fail('PROJECT_HANDOFF_RECOVERY_CONFLICT');
    assertLease(auth);fresh(a);rmSync(join(repo,'Documentazione'),{recursive:true,force:true});rmSync(join(repo,'.controlled-dev'),{recursive:true});rmSync(j.stagingRoot,{recursive:true});capabilities.delete(cap);return {action:'ROLLED_BACK'};
  }
  // The new recovery receipt belongs to the same authoritative archive. Preserve its exact bytes
  // in the selected local archive before removing the verified legacy archive.
  const localPlanning=join(repo,'.controlled-dev','state','controlled-dev','projects',cap.projectId,'planning');
  if(existsSync(a.sourceRoot)){
    const raw=auth.store.read(cap.confirmationRef),path=join(localPlanning,cap.confirmationRef.relativeStorePath);absent(path);directory(dirname(path));
    const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,raw);fsyncSync(fd)}finally{closeSync(fd)}sync(dirname(path));
  }
  assertLease(auth);
  const record=sealProjectHandoff({repoRoot:repo,manager:auth.manager,workspaceLock:auth.workspaceLock,assertQuiescent:auth.assertQuiescent,
    candidateDescriptors:readProjectHandoffCandidatePaths(repo)});
  if(!equal(snapshot(a.sourceRoot),a.source)||!equal(snapshot(a.controlRoot),a.control))fail('PROJECT_HANDOFF_RECOVERY_CONFLICT');
  if(existsSync(a.sourceRoot))rmSync(a.sourceRoot,{recursive:true});if(existsSync(a.controlRoot))rmSync(a.controlRoot,{recursive:true});
  atomic(join(repo,'.controlled-dev','migration.json'),{schemaVersion:1,id:j.id,projectId:cap.projectId,repoRoot:repo,machineDataRoot:cap.machineDataRoot,phase:'COMPLETE'});
  if(existsSync(j.stagingRoot)){if(!equal(snapshot(j.stagingRoot),j.stageManifest))fail('PROJECT_HANDOFF_RECOVERY_CONFLICT');rmSync(j.stagingRoot,{recursive:true})}
  capabilities.delete(cap);return {action:'COMPLETED',record};
}
function readProjectHandoffCandidatePaths(repo:string):readonly string[]{
  const pointer=parseJson(regular(join(repo,'.controlled-dev','handoff.json')),4096) as {descriptorDigest:string};
  if(!/^[a-f0-9]{64}$/.test(pointer.descriptorDigest))fail('PROJECT_HANDOFF_SEAL_CORRUPT');
  const raw=regular(join(repo,'.controlled-dev','handoffs',`${pointer.descriptorDigest}.json`));if(hashBytes(raw)!==pointer.descriptorDigest)fail('PROJECT_HANDOFF_SEAL_CORRUPT');
  return (parseJson(raw,MAX_FILE) as unknown as ProjectHandoff).candidateDescriptors;
}
/** Integrity-only paths from the previous immutable checkpoint, including when its state
 * has advanced. They preserve other tasks' saved copies and grant no execution authority. */
export function currentProjectHandoffCandidatePaths(repo:string):readonly string[]{
  const marker=readProjectCustodian(repo);if(!marker)fail('PROJECT_HANDOFF_NOT_ADOPTED');protectedNamespaces(repo);
  const path=join(repo,'.controlled-dev','handoff.json');if(!existsSync(path))return [];
  const pointer=parseJson(regular(path),4096) as {schemaVersion:number;descriptorDigest:string};
  if(!pointer||Object.keys(pointer).sort().join(',')!=='descriptorDigest,schemaVersion'||pointer.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(pointer.descriptorDigest))fail('PROJECT_HANDOFF_SEAL_CORRUPT');
  const raw=regular(join(repo,'.controlled-dev','handoffs',`${pointer.descriptorDigest}.json`));if(hashBytes(raw)!==pointer.descriptorDigest)fail('PROJECT_HANDOFF_SEAL_CORRUPT');
  const record=parseJson(raw,MAX_FILE) as unknown as ProjectHandoff;
  if(!record||record.schemaVersion!==1||record.projectId!==marker.projectId||record.originalRepoRoot!==marker.originalRepoRoot||canonicalize(record)!==Buffer.from(raw).toString('utf8')
    ||!Array.isArray(record.candidateDescriptors)||record.candidateDescriptors.some(p=>typeof p!=='string'||!/^candidates\/[A-Za-z0-9._-]+\/checkpoints\/[a-f0-9]{64}\.json$/.test(p)||!existsSync(join(repo,'.controlled-dev',p))))fail('PROJECT_HANDOFF_SEAL_CORRUPT');
  return Object.freeze([...record.candidateDescriptors]);
}
/** Automatic durable checkpoint at a verified writer terminal/publication/normal-close boundary.
 * The caller holds the actual host lease and verifies all run proofs; this records no approval. */
export interface SealProjectHandoffInput {repoRoot:string;manager:LockManager;workspaceLock:LockHandle;assertQuiescent:()=>void;candidateDescriptors?:readonly string[]}
export function sealProjectHandoff(input:SealProjectHandoffInput):ProjectHandoff {
  const marker=readProjectCustodian(input.repoRoot);if(!marker)fail('PROJECT_HANDOFF_NOT_ADOPTED');
  const check=()=>{if(!input.manager.verifyWorkspaceLock(input.workspaceLock)||input.workspaceLock.record.workspaceHash!==input.manager.workspaceIdentity(input.repoRoot).workspaceHash)fail('PROJECT_HANDOFF_LEASE_LOST');input.assertQuiescent();clean(input.repoRoot);protectedNamespaces(input.repoRoot)};check();
  const root=join(input.repoRoot,'.controlled-dev','state','controlled-dev','projects',marker.projectId);
  const record:ProjectHandoff={schemaVersion:1,kind:'CHECKPOINT',projectId:marker.projectId,originalRepoRoot:marker.originalRepoRoot,sourceHead:git(input.repoRoot,['rev-parse','HEAD']),sourceTree:git(input.repoRoot,['rev-parse','HEAD^{tree}']),createdAt:new Date().toISOString(),
    taskHeads:heads(root),namespaceManifest:localManifest(input.repoRoot,marker.projectId),candidateDescriptors:input.candidateDescriptors??[],quiescence:'VERIFIED',ownerDisposition:'LEASE_HELD_CHECKPOINT',ownerSessionId:input.manager.ownerSessionId,runtimeGeneration:input.manager.runtimeGeneration,ownerRelease:null};
  check();if(!equal(heads(root),record.taskHeads)||!equal(localManifest(input.repoRoot,marker.projectId),record.namespaceManifest))fail('PROJECT_HANDOFF_SOURCE_CHANGED');publishSeal(input.repoRoot,record);return record;
}
/** Normal close/transfer only. Retirement must revoke the actual host's admissions and runtime
 * capabilities. Publication occurs under the lock-mutation guard after the real lease is absent;
 * an intervening successor leaves only a checkpoint, never a false release claim. */
export function releaseProjectHandoff(input:SealProjectHandoffInput&{retireAuthority:()=>void}):ProjectHandoff {
  if(typeof input.retireAuthority!=='function')fail('PROJECT_HANDOFF_RETIREMENT_REQUIRED');
  const record=sealProjectHandoff(input),hash=input.workspaceLock.record.workspaceHash,token=input.workspaceLock.record.token,path=input.workspaceLock.path;
  input.retireAuthority();input.assertQuiescent();
  if(!input.manager.verifyWorkspaceLock(input.workspaceLock)||!equal(localManifest(input.repoRoot,record.projectId),record.namespaceManifest))fail('PROJECT_HANDOFF_SOURCE_CHANGED');
  input.manager.release(input.workspaceLock);
  return withLockMutation(input.manager.root,hash,()=>{
    try{lstatSync(path);fail('PROJECT_HANDOFF_SUCCESSOR_EXISTS')}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error}
    input.assertQuiescent();clean(input.repoRoot);protectedNamespaces(input.repoRoot);
    const root=join(input.repoRoot,'.controlled-dev','state','controlled-dev','projects',record.projectId);
    if(!equal(localManifest(input.repoRoot,record.projectId),record.namespaceManifest)||!equal(heads(root),record.taskHeads)
      ||git(input.repoRoot,['rev-parse','HEAD'])!==record.sourceHead)fail('PROJECT_HANDOFF_SOURCE_CHANGED');
    const released:ProjectHandoff={...record,ownerDisposition:'RELEASED_FOR_TRANSFER',ownerRelease:{previousToken:token,workspaceHash:hash,ownerRepoRoot:input.repoRoot,releasedAt:new Date().toISOString()}};
    publishSeal(input.repoRoot,released);return released;
  });
}
function checkedProjectHandoff(repoRoot:string,allowHumanChanges=false):RuntimeImportHandoff|undefined {
  const marker=readProjectCustodian(repoRoot);if(!marker)return undefined;protectedNamespaces(repoRoot);const path=join(repoRoot,'.controlled-dev','handoff.json');if(!existsSync(path))return undefined;
  const pointer=parseJson(regular(path),4096) as {schemaVersion:number;descriptorDigest:string};
  if(!pointer||Object.keys(pointer).sort().join(',')!=='descriptorDigest,schemaVersion'||pointer.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(pointer.descriptorDigest))fail('PROJECT_HANDOFF_SEAL_CORRUPT');
  const raw=regular(join(repoRoot,'.controlled-dev','handoffs',`${pointer.descriptorDigest}.json`));if(hashBytes(raw)!==pointer.descriptorDigest)fail('PROJECT_HANDOFF_SEAL_CORRUPT');
  const value=parseJson(raw,MAX_FILE) as unknown as ProjectHandoff;
  if(!value||Object.keys(value).sort().join(',')!=='candidateDescriptors,createdAt,kind,namespaceManifest,originalRepoRoot,ownerDisposition,ownerRelease,ownerSessionId,projectId,quiescence,runtimeGeneration,schemaVersion,sourceHead,sourceTree,taskHeads'
    ||value.schemaVersion!==1||value.projectId!==marker.projectId||value.originalRepoRoot!==marker.originalRepoRoot||!['ADOPTION','CHECKPOINT'].includes(value.kind)||value.quiescence!=='VERIFIED'
    ||!['LEASE_HELD_CHECKPOINT','RELEASED_FOR_TRANSFER'].includes(value.ownerDisposition)||typeof value.ownerSessionId!=='string'||typeof value.runtimeGeneration!=='string'
    ||canonicalize(value)!==Buffer.from(raw).toString('utf8'))fail('PROJECT_HANDOFF_SEAL_CORRUPT');
  if(!Array.isArray(value.candidateDescriptors)||value.candidateDescriptors.some(p=>typeof p!=='string'||!/^candidates\/[A-Za-z0-9._-]+\/checkpoints\/[a-f0-9]{64}\.json$/.test(p)||!existsSync(join(repoRoot,'.controlled-dev',p))))fail('PROJECT_HANDOFF_SEAL_CORRUPT');
  if(value.ownerDisposition==='LEASE_HELD_CHECKPOINT'&&value.ownerRelease!==null)fail('PROJECT_HANDOFF_SEAL_CORRUPT');
  if(value.ownerDisposition==='RELEASED_FOR_TRANSFER'){
    const r=value.ownerRelease;if(!r||Object.keys(r).sort().join(',')!=='ownerRepoRoot,previousToken,releasedAt,workspaceHash'||typeof r.ownerRepoRoot!=='string'||resolve(r.ownerRepoRoot)!==r.ownerRepoRoot||!r.ownerRepoRoot.startsWith('/')
      ||!/^[a-f0-9-]{36}$/.test(r.previousToken)||r.workspaceHash!==hashBytes(Buffer.from(r.ownerRepoRoot,'utf8'))||typeof r.releasedAt!=='string'||!/^\d{4}-\d\d-\d\dT/.test(r.releasedAt))fail('PROJECT_HANDOFF_SEAL_CORRUPT');
  }
  if(!Array.isArray(value.namespaceManifest)||value.namespaceManifest.some((f:HandoffFile)=>!f||Object.keys(f).sort().join(',')!=='bytes,digest,mode,path'||typeof f.path!=='string'
    ||f.path.split('/').some(part=>!part||part==='.'||part==='..')||/[\u0000-\u001f\u007f]/.test(f.path)||!/^[a-f0-9]{64}$/.test(f.digest)
    ||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>MAX_FILE||!Number.isInteger(f.mode)||f.mode<0||f.mode>0o777))fail('PROJECT_HANDOFF_SEAL_CORRUPT');
  const current=localManifest(repoRoot,marker.projectId),human=(f:HandoffFile)=>f.path.startsWith('Documentazione/');
  if(git(repoRoot,['rev-parse','HEAD'])!==value.sourceHead||git(repoRoot,['rev-parse','HEAD^{tree}'])!==value.sourceTree
    ||!equal(allowHumanChanges?current.filter(f=>!human(f)):current,allowHumanChanges?value.namespaceManifest.filter(f=>!human(f)):value.namespaceManifest)
    ||!equal(heads(join(repoRoot,'.controlled-dev','state','controlled-dev','projects',marker.projectId)),value.taskHeads))fail('PROJECT_HANDOFF_CHECKPOINT_STALE');
  const before=new Map(value.namespaceManifest.filter(human).map(f=>[f.path,f])),after=new Map(current.filter(human).map(f=>[f.path,f]));
  const humanChanges=[...new Set([...before.keys(),...after.keys()])].sort().flatMap(path=>{
    const old=before.get(path),next=after.get(path);if(old&&next&&equal(old,next))return [];
    return [Object.freeze({path,status:(!old?'ADDED':!next?'REMOVED':'CHANGED') as HandoffHumanChange['status']})];
  });
  return Object.freeze({record:Object.freeze({...value,descriptorDigest:pointer.descriptorDigest}),humanChanges:Object.freeze(humanChanges),humanDigest:hashCanonical(current.filter(human))});
}
/** Integrity-only discovery. A JSON descriptor never restores live process/approval authority. */
export function readProjectHandoff(repoRoot:string):VerifiedProjectHandoff|undefined{return checkedProjectHandoff(repoRoot)?.record}
/** Read-only host inventory; no seal, lease or execution permission is minted. */
export function projectHandoffNamespaceManifest(repoRoot:string):readonly HandoffFile[]{const marker=readProjectCustodian(repoRoot);if(!marker)fail('PROJECT_HANDOFF_NOT_ADOPTED');protectedNamespaces(repoRoot);return Object.freeze(localManifest(repoRoot,marker.projectId))}
/** Import preparation may retain personal Markdown/Notes edits. All authoritative state,
 * control and candidate bytes still match the sealed checkpoint. The host must bind the
 * reported changes to a fresh native confirmation; this reader grants no authority. */
export function readProjectHandoffForRuntimeImport(repoRoot:string):RuntimeImportHandoff|undefined{return checkedProjectHandoff(repoRoot,true)}
