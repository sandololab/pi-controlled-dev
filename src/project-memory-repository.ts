import { projectIdentity } from './project-identity.js';
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Buffer } from 'node:buffer';
import { canonicalize, hashBytes, hashCanonical, parseJson } from './contracts.js';
import type { ArtifactRef } from './contracts.js';
import { DurableStore } from './store.js';
import type { ArtifactInspection } from './store.js';
import { LockManager } from './lock-manager.js';
import type { LockHandle } from './lock-manager.js';
import { createTrustedConfirmationRequest, presentTrustedConfirmation, consumeTrustedConfirmation, readTrustedConfirmationEvidence } from './trusted-confirmation.js';
import type { HumanConfirmationChannel, TrustedConfirmationRequest, TrustedConfirmationReceipt } from './trusted-confirmation.js';
import { MEMORY_LIMITS, MEMORY_MEDIA, currentMemory, freezeMemory, memoryAuthority, memoryError, memoryPrefix, recordDigest,
  validateMemoryArtifact, validateMemoryProposal, validateMemoryRecord, memoryPresentation } from './project-memory.js';
import type { ProjectMemoryProposal, ProjectMemoryRecord, MemoryStatus } from './project-memory.js';

interface MemoryIndex {readonly schemaVersion:1;readonly projectId:string;readonly revision:number;
  readonly records:readonly ArtifactRef[];readonly history:readonly ArtifactRef[];readonly confirmations:readonly ArtifactRef[]}
export interface MemoryEntry {readonly record:ProjectMemoryRecord;readonly ref:ArtifactRef;readonly staleEvidence:readonly string[]}
export interface ProjectMemoryOptions {readonly create?:boolean;readonly manager?:LockManager;readonly workspaceLock?:LockHandle;readonly now?:()=>string}
interface Mutation {readonly base:ArtifactRef|undefined;readonly changes:readonly ProjectMemoryRecord[]}

/** A host-owned record namespace over DurableStore, not a task engine. The one index is a current snapshot;
 * record revisions and human receipts are immutable artifacts. Interrupted writes can leave orphans,
 * never a partially committed supersession. Existing workspace locks serialize all mutations. */
export class ProjectMemoryRepository {
  readonly projectId:string;readonly projectRoot:string;
  readonly #pending=new WeakMap<object,Mutation>();
  private constructor(readonly store:DurableStore,readonly repoRoot:string,readonly options:ProjectMemoryOptions){
    this.projectRoot=dirname(store.root);this.projectId=projectIdentity(repoRoot);
    this.#index();
  }
  static open(dataRoot:string,repoRoot:string,inspect:ArtifactInspection,options:ProjectMemoryOptions={}):ProjectMemoryRepository|undefined{
    const open=()=>{const store=DurableStore.project(dataRoot,repoRoot,'memory',inspect,options.create===true);
      return store?new ProjectMemoryRepository(store,repoRoot,options):undefined;};
    if(!options.create)return open();
    const manager=options.manager??new LockManager(dataRoot,'project-memory-host',`memory-${randomUUID()}`);
    const lock=options.workspaceLock??manager.acquireWorkspace(repoRoot);
    try{if(!manager.verifyWorkspaceLock(lock)||lock.record.workspaceHash!==hashBytes(Buffer.from(repoRoot)))memoryError('PROJECT_MEMORY_LOCK_REQUIRED');return open()}
    finally{if(!options.workspaceLock)manager.release(lock)}
  }
  #write<T>(action:()=>T):T{
    const manager=this.options.manager??new LockManager(this.store.agentDataRoot,'project-memory-host',`memory-${randomUUID()}`);
    const lock=this.options.workspaceLock??manager.acquireWorkspace(this.repoRoot);
    try{if(!manager.verifyWorkspaceLock(lock)||lock.record.workspaceHash!==manager.workspaceIdentity(this.repoRoot).workspaceHash)memoryError('PROJECT_MEMORY_LOCK_REQUIRED');return action()}
    finally{if(!this.options.workspaceLock)manager.release(lock)}
  }
  #index():{ref:ArtifactRef|undefined;value:MemoryIndex}{
    const ref=this.store.readProjectIndex();
    if(!ref)return {ref,value:{schemaVersion:1,projectId:this.projectId,revision:0,records:[],history:[],confirmations:[]}};
    const value=parseJson(this.store.read(ref),MEMORY_LIMITS.indexBytes) as unknown as MemoryIndex;
    if(!value||Object.keys(value).sort().join(',')!=='confirmations,history,projectId,records,revision,schemaVersion'||value.schemaVersion!==1
      ||value.projectId!==this.projectId||!Number.isSafeInteger(value.revision)||value.revision<1
      ||!Array.isArray(value.records)||value.records.length>MEMORY_LIMITS.records||!Array.isArray(value.history)||value.history.length>MEMORY_LIMITS.history
      ||!Array.isArray(value.confirmations)||value.confirmations.length>MEMORY_LIMITS.history||hashCanonical(value)!==ref.digest)memoryError('PROJECT_MEMORY_INDEX_INVALID');
    for(const r of [...value.records,...value.history,...value.confirmations])validateMemoryArtifact(r);
    if(new Set(value.history.map(r=>r.id)).size!==value.history.length)memoryError('PROJECT_MEMORY_HISTORY_INVALID');
    return {ref,value};
  }
  #record(ref:ArtifactRef):ProjectMemoryRecord{
    if(ref.mediaType!==MEMORY_MEDIA)memoryError('PROJECT_MEMORY_ARTIFACT_INVALID');
    const record=validateMemoryRecord(parseJson(this.store.read(ref),MEMORY_LIMITS.recordBytes));
    if(hashCanonical(record)!==ref.digest||record.projectId!==this.projectId||ref.id!==`${record.recordId}-r${record.revision}`)memoryError('PROJECT_MEMORY_IDENTITY_INVALID');
    return record;
  }
  /** Reads trusted structured artifacts only. Human Markdown is never an input. */
  entries():readonly MemoryEntry[]{
    const {value}=this.#index(),records=value.records.map(ref=>({record:this.#record(ref),ref}));
    const historicalIds=new Set(value.history.map(ref=>this.#record(ref).recordId));
    if(historicalIds.size!==records.length||records.some(e=>!historicalIds.has(e.record.recordId)))memoryError('PROJECT_MEMORY_HISTORY_INVALID');
    if(new Set(records.map(e=>e.record.recordId)).size!==records.length)memoryError('PROJECT_MEMORY_IDENTITY_INVALID');
    for(const {record,ref} of records){
      if(!value.history.some(h=>h.id===ref.id&&h.digest===ref.digest))memoryError('PROJECT_MEMORY_HISTORY_INVALID');
      const history=value.history.filter(h=>h.id.startsWith(record.recordId+'-r')).map(h=>this.#record(h)).sort((a,b)=>a.revision-b.revision);
      if(history.length!==record.revision||history.some((h,i)=>h.revision!==i+1||h.createdAt!==record.createdAt
        ||(i>0&&Date.parse(h.updatedAt)<Date.parse(history[i-1].updatedAt))))memoryError('PROJECT_MEMORY_HISTORY_INVALID');
      for(const id of record.supersededBy){const replacement=records.find(e=>e.record.recordId===id)?.record;
        if(!replacement||replacement.recordKind!==record.recordKind||!replacement.supersedes.includes(record.recordId))memoryError('PROJECT_MEMORY_SUPERSESSION_INVALID');}
      for(const id of record.supersedes){const previous=records.find(e=>e.record.recordId===id)?.record;
        if(!previous||previous.status!=='SUPERSEDED'||!previous.supersededBy.includes(record.recordId))memoryError('PROJECT_MEMORY_SUPERSESSION_INVALID');}
      // Authority comes from a committed native receipt bound to the exact revision, never a JSON status alone.
      if(currentMemory(record)||['SUPERSEDED','DEPRECATED','RETIRED'].includes(record.status)){
        const approved=value.confirmations.some(confirmation=>{
          const packet=parseJson(this.store.read(confirmation),135168) as any;
          const verified=readTrustedConfirmationEvidence(this.store,confirmation,packet.request);
          const payload=verified.request.payload as any;
          return verified.receipt.purpose==='project-memory-approval'&&verified.receipt.decision==='APPROVE'&&payload?.projectId===this.projectId
            &&Array.isArray(payload.changes)&&payload.changes.some((r:unknown)=>canonicalize(r)===canonicalize(record));
        });
        if(!approved)memoryError('PROJECT_MEMORY_APPROVAL_MISSING');
      }
    }
    return freezeMemory(records.map(e=>({...e,staleEvidence:this.staleEvidence(e.record)})).sort((a,b)=>a.record.recordId.localeCompare(b.record.recordId)));
  }
  history(recordId:string):readonly ProjectMemoryRecord[]{
    return freezeMemory(this.#index().value.history.map(r=>this.#record(r)).filter(r=>r.recordId===recordId).sort((a,b)=>a.revision-b.revision));
  }
  staleEvidence(record:ProjectMemoryRecord):readonly string[]{
    return Object.freeze(record.evidenceRefs.filter(e=>{
      try{
        const root=e.kind==='repository-source'?this.repoRoot:this.projectRoot,path=join(root,e.relativePath);
        // Validate every ancestor: following an intermediate symlink would bypass a relative-path boundary.
        let next=root;for(const part of e.relativePath.split('/')){next=join(next,part);const s=lstatSync(next);
          if(s.isSymbolicLink()||realpathSync(next)!==next)throw new Error('alias');}
        const stat=lstatSync(path);if(!stat.isFile()||stat.nlink!==1||stat.size>64*1024*1024)throw new Error('file');
        return hashBytes(readFileSync(path))!==e.digest;
      }catch{return true}
    }).map(e=>e.id));
  }
  propose(input:unknown,origin:ProjectMemoryRecord['origin']):ProjectMemoryRecord{
    const proposal=validateMemoryProposal(input);
    return this.#write(()=>{
      const {ref,value}=this.#index();if(value.records.length>=MEMORY_LIMITS.records)memoryError('PROJECT_MEMORY_LIMIT');
      const now=this.options.now?.()??new Date().toISOString(),status=proposal.recordKind==='technical-lesson'?'UNVERIFIED':'PROPOSED';
      const material={...proposal,schemaVersion:1 as const,projectId:this.projectId,recordId:`${memoryPrefix[proposal.recordKind]}-${randomUUID()}`,
        revision:1,status:status as MemoryStatus,createdAt:now,updatedAt:now,origin,authorityKind:memoryAuthority(proposal.recordKind,status),supersedes:[],supersededBy:[]};
      const record=validateMemoryRecord({...material,contentDigest:recordDigest(material)});
      this.#commit(ref,value,[record]);return record;
    });
  }
  #next(record:ProjectMemoryRecord,status:MemoryStatus,links:Partial<Pick<ProjectMemoryRecord,'supersedes'|'supersededBy'>>={}):ProjectMemoryRecord{
    const value={...record,...links,revision:record.revision+1,status,authorityKind:memoryAuthority(record.recordKind,status),updatedAt:this.options.now?.()??new Date().toISOString()};
    return validateMemoryRecord({...value,contentDigest:recordDigest(value)});
  }
  /** Prepare exact changes before UI. Supersession binds both sides in one payload and one snapshot. */
  prepareDecision(recordId:string,target:MemoryStatus,supersedes?:string):TrustedConfirmationRequest{
    const {ref}=this.#index(),entries=this.entries(),record=entries.find(e=>e.record.recordId===recordId)?.record;
    if(!record)memoryError('PROJECT_MEMORY_NOT_FOUND');
    const allowed:Readonly<Record<string,readonly MemoryStatus[]>>={PROPOSED:record.recordKind==='software-adr'?['ACCEPTED','DEPRECATED']:['ACTIVE','RETIRED'],
      UNVERIFIED:['ACTIVE','RETIRED'],ACCEPTED:['DEPRECATED'],ACTIVE:['RETIRED'],SUPERSEDED:[],DEPRECATED:[],RETIRED:[]};
    if(!allowed[record.status]?.includes(target))memoryError('PROJECT_MEMORY_LIFECYCLE_INVALID');
    if(target==='ACTIVE'&&record.recordKind==='technical-lesson'&&(!record.evidenceRefs.length||this.staleEvidence(record).length))memoryError('PROJECT_MEMORY_EVIDENCE_STALE');
    const changes:ProjectMemoryRecord[]=[];
    if(supersedes){
      const previous=entries.find(e=>e.record.recordId===supersedes)?.record;
      if(!previous||previous.recordKind!==record.recordKind||!currentMemory(previous)||!['ACCEPTED','ACTIVE'].includes(target))memoryError('PROJECT_MEMORY_SUPERSESSION_INVALID');
      changes.push(this.#next(previous,'SUPERSEDED',{supersededBy:[recordId]}));
    }
    changes.push(this.#next(record,target,supersedes?{supersedes:[supersedes]}:{}));
    const payload={projectId:this.projectId,baseDigest:ref?.digest??'0'.repeat(64),changes};
    const content=changes.map(r=>`${r.title}\nRequested status: ${r.status}\nScope: ${r.scope.kind==='repository'?"entire repository":r.scope.path}\n${memoryPresentation(r)}\nEvidence: ${r.evidenceRefs.map(e=>`${e.kind}: ${e.id} (${e.digest})`).join('; ')||"none"}\nRelationships: ${r.relatedTaskRefs.join(', ')||"no tasks"}; supersedes ${r.supersedes.join(', ')||"no memories"}; superseded by ${r.supersededBy.join(', ')||"no memories"}`).join('\n\n');
    const request=createTrustedConfirmationRequest({purpose:'project-memory-approval',subjectKind:'ProjectMemoryRecord',subjectId:recordId,
      subjectRevision:record.revision,action:'APPROVE',payload:payload as unknown as import('./contract-json.js').Json,
      presentation:{title:`Confirm memory: ${record.title}?`,content:`This decision concerns the project's technical memory and does not authorize code or task changes. Check relevance, scope and evidence; for a lesson, also check when to load it and when it is no longer valid.\n\n${content}`}});
    this.#pending.set(request,{base:ref,changes:freezeMemory(changes)});return request;
  }
  applyDecision(request:TrustedConfirmationRequest,receipt:TrustedConfirmationReceipt):readonly ProjectMemoryRecord[]{
    const mutation=this.#pending.get(request);if(!mutation)memoryError('PROJECT_MEMORY_DECISION_INVALID');this.#pending.delete(request);
    return this.#write(()=>{
      const {ref,value}=this.#index();
      const fresh=()=>{
        if(canonicalize(this.#index().ref??null)!==canonicalize(mutation.base??null))memoryError('PROJECT_MEMORY_STALE');
        for(const r of mutation.changes)if(r.recordKind==='technical-lesson'&&r.status==='ACTIVE'&&this.staleEvidence(r).length)memoryError('PROJECT_MEMORY_EVIDENCE_STALE');
        return request;
      };
      const approval=consumeTrustedConfirmation(receipt,fresh,this.store);
      this.#commit(ref,value,mutation.changes,approval);return mutation.changes;
    });
  }
  async decide(ctx:HumanConfirmationChannel,recordId:string,target:MemoryStatus,supersedes?:string):Promise<readonly ProjectMemoryRecord[]|undefined>{
    const request=this.prepareDecision(recordId,target,supersedes),receipt=await presentTrustedConfirmation(ctx,request);
    if(!receipt){this.#pending.delete(request);return undefined}return this.applyDecision(request,receipt);
  }
  /** Evidence loss only removes applicability; it never promotes a lesson or changes an accepted ADR. */
  invalidateLessons():readonly ProjectMemoryRecord[]{
    return this.#write(()=>{
      const {ref,value}=this.#index(),changes=this.entries().filter(e=>e.record.recordKind==='technical-lesson'&&e.record.status==='ACTIVE'&&e.staleEvidence.length)
        .map(e=>this.#next(e.record,'UNVERIFIED'));
      if(changes.length)this.#commit(ref,value,changes);return freezeMemory(changes);
    });
  }
  #commit(base:ArtifactRef|undefined,index:MemoryIndex,changes:readonly ProjectMemoryRecord[],approval?:ArtifactRef):void{
    if(index.history.length+changes.length>MEMORY_LIMITS.history)memoryError('PROJECT_MEMORY_LIMIT');
    const refs=changes.map(r=>this.store.put(`${r.recordId}-r${r.revision}`,canonicalize(r),MEMORY_MEDIA));
    const changedIds=new Set(changes.map(r=>r.recordId)),current=index.records.filter(ref=>!changedIds.has(this.#record(ref).recordId));
    const next:MemoryIndex={schemaVersion:1,projectId:this.projectId,revision:index.revision+1,records:[...current,...refs].sort((a,b)=>a.id.localeCompare(b.id)),
      history:[...index.history,...refs],confirmations:[...index.confirmations,...(approval?[approval]:[])]};
    const raw=canonicalize(next);if(Buffer.byteLength(raw,'utf8')>MEMORY_LIMITS.indexBytes)memoryError('PROJECT_MEMORY_LIMIT');
    const ref=this.store.put(`memory-index-${hashCanonical(next)}`,raw,'application/vnd.pi-controlled-dev.project-memory-index+json');
    this.store.replaceProjectIndex(base,ref);
  }
}
