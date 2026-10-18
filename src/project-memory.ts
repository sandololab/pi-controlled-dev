import { canonicalize, copyJson, hashCanonical, byteLength } from './contract-json.js';
import type { Issue, Json } from './contract-json.js';
import { object, literal, enumeration, list, scalar, scalars, integer } from './contract-schema.js';
import type { Schema } from './contract-schema.js';
import { validateStructure } from './contracts.js';
import type { ArtifactRef } from './contracts.js';

export const MEMORY_OWNER='pi-controlled-dev';
export const MEMORY_MEDIA='application/vnd.pi-controlled-dev.project-memory+json';
export const MEMORY_CONTEXT_MEDIA='application/vnd.pi-controlled-dev.memory-context+json';
export const MEMORY_RECEIPT_MEDIA='application/vnd.pi-controlled-dev.memory-context-receipt+json';
export const MEMORY_LIMITS=Object.freeze({records:256,history:4096,recordBytes:16384,indexBytes:2*1024*1024,
  Scout:Object.freeze({records:8,bytes:12288,characters:10000}),
  Developer:Object.freeze({records:8,bytes:12288,characters:10000}),
  Reviewer:Object.freeze({records:8,bytes:16384,characters:12000})});
export type MemoryKind='software-adr'|'technical-lesson'|'project-convention'|'technical-constraint';
export type MemoryStatus='PROPOSED'|'ACCEPTED'|'UNVERIFIED'|'ACTIVE'|'SUPERSEDED'|'DEPRECATED'|'RETIRED';
export type MemoryAuthority='proposal'|'software-decision'|'advisory'|'convention'|'technical-constraint'|'historical';
export type MemoryScope={readonly kind:'repository'}|{readonly kind:'directory'|'component';readonly path:string};
export type ReferenceKind=MemoryKind|'system-adr'|'requirement-interpretation'|'system-evidence-assessment';
export interface ProjectMemoryReference {
  readonly schemaVersion:1;readonly ownerPackage:'pi-controlled-dev'|'Systemist';readonly projectId:string;
  readonly recordKind:ReferenceKind;readonly recordId:string;readonly revision:number;readonly status:string;
  readonly scope:MemoryScope;readonly authorityKind:string;readonly relativePath?:string;readonly digest:string;
}
export interface MemoryEvidenceReference {
  readonly kind:'task'|'scenario'|'scenario-run'|'technical-evidence-bundle'|'validation'|'review'|'artifact'|'repository-source';
  readonly id:string;readonly taskId?:string;readonly relativePath:string;readonly digest:string;
}
export interface SoftwareDecisionContent {readonly decisionKey:string;readonly context:string;readonly decision:string;
  readonly rationale:string;readonly consequences:readonly string[];readonly alternatives:readonly string[]}
export interface TechnicalLessonContent {readonly problemKey:string;readonly problem:string;readonly cause:string;readonly rule:string;
  readonly loadWhen:{readonly terms:readonly string[];readonly paths:readonly string[]};readonly invalidatedWhen:readonly string[]}
export interface ConventionContent {readonly convention:string;readonly rationale:string;readonly sourcePath?:string}
export interface ConstraintContent {readonly constraint:string;readonly rationale:string;readonly consequences:readonly string[]}
export type MemoryContent=SoftwareDecisionContent|TechnicalLessonContent|ConventionContent|ConstraintContent;
export interface ProjectMemoryProposal {
  readonly recordKind:MemoryKind;readonly title:string;readonly scope:MemoryScope;readonly content:MemoryContent;
  readonly evidenceRefs:readonly MemoryEvidenceReference[];readonly relatedTaskRefs:readonly string[];
  readonly relatedRecordRefs:readonly ProjectMemoryReference[];
}
export interface ProjectMemoryRecord extends ProjectMemoryProposal {
  readonly schemaVersion:1;readonly projectId:string;readonly recordId:string;readonly revision:number;readonly status:MemoryStatus;
  readonly createdAt:string;readonly updatedAt:string;readonly origin:{readonly role:'Scout'|'Developer'|'Reviewer'|'host';readonly taskId?:string};
  readonly authorityKind:MemoryAuthority;readonly supersedes:readonly string[];readonly supersededBy:readonly string[];readonly contentDigest:string;
}
const scopeSchema=object('MemoryScope',{kind:enumeration('repository','directory','component')},{path:scalars.Path});
const evidenceSchema=object('MemoryEvidenceReference',{kind:enumeration('task','scenario','scenario-run','technical-evidence-bundle','validation','review','artifact','repository-source'),
  id:scalars.ID,relativePath:scalars.Path,digest:scalars.Hash},{taskId:scalars.ID});
const referenceSchema=object('ProjectMemoryReference',{schemaVersion:literal(1),ownerPackage:enumeration('pi-controlled-dev','Systemist'),
  projectId:scalars.Hash,recordKind:enumeration('software-adr','technical-lesson','project-convention','technical-constraint','system-adr','requirement-interpretation','system-evidence-assessment'),
  recordId:scalars.ID,revision:integer(1,Number.MAX_SAFE_INTEGER),status:scalars.ID,scope:scopeSchema,authorityKind:scalars.ID,digest:scalars.Hash},{relativePath:scalars.Path});
const contentSchema={
  'software-adr':object('SoftwareArchitectureDecision',{decisionKey:scalars.ID,context:scalars.Text,decision:scalars.Text,rationale:scalars.Text,
    consequences:list(scalars.Text,1,16),alternatives:list(scalars.Text,0,16)}),
  'technical-lesson':object('TechnicalLesson',{problemKey:scalars.ID,problem:scalars.Text,cause:scalars.Text,rule:scalars.Text,
    loadWhen:object('LoadWhen',{terms:list(scalars.Text,0,16),paths:list(scalars.Path,0,16)}),invalidatedWhen:list(scalars.Text,1,16)}),
  'project-convention':object('ProjectConvention',{convention:scalars.Text,rationale:scalars.Text},{sourcePath:scalars.Path}),
  'technical-constraint':object('TechnicalConstraint',{constraint:scalars.Text,rationale:scalars.Text,consequences:list(scalars.Text,1,16)}),
} as const;
const json=scalar<Json>('JSON',()=>true);
const proposalFields={recordKind:enumeration('software-adr','technical-lesson','project-convention','technical-constraint'),title:scalars.Text,
  scope:scopeSchema,content:json,evidenceRefs:list(evidenceSchema,0,32),relatedTaskRefs:list(scalars.ID,0,32),relatedRecordRefs:list(referenceSchema,0,32)};
const proposalSchema=object('ProjectMemoryProposal',proposalFields);
const recordSchema=object('ProjectMemoryRecord',{...proposalFields,schemaVersion:literal(1),projectId:scalars.Hash,recordId:scalars.ID,
  revision:integer(1,Number.MAX_SAFE_INTEGER),status:enumeration('PROPOSED','ACCEPTED','UNVERIFIED','ACTIVE','SUPERSEDED','DEPRECATED','RETIRED'),
  createdAt:scalars.Time,updatedAt:scalars.Time,origin:object('MemoryOrigin',{role:enumeration('Scout','Developer','Reviewer','host')},{taskId:scalars.ID}),
  authorityKind:enumeration('proposal','software-decision','advisory','convention','technical-constraint','historical'),
  supersedes:list(scalars.ID,0,1),supersededBy:list(scalars.ID,0,1),contentDigest:scalars.Hash});
export function memoryError(code:string):never{throw new Error(code)}
export function freezeMemory<T>(value:T):T{
  if(value&&typeof value==='object'){for(const v of Object.values(value))freezeMemory(v);Object.freeze(value)}return value;
}
export function checkMemorySchema<T>(schema:Schema<T>,input:unknown,max:number=MEMORY_LIMITS.recordBytes):T{
  const value=copyJson(input),errors:Issue[]=[];
  if(byteLength(canonicalize(value))>max)memoryError('PROJECT_MEMORY_LIMIT');
  schema.check(value,'$',errors);if(errors.length)memoryError('PROJECT_MEMORY_SCHEMA_INVALID');return value as T;
}
function portable(value:unknown):void{
  if(typeof value==='string'&&(/(?:^|[\s`"'(=])\/[^\s/]/.test(value)||/[A-Za-z]:[\\/]|(?:file|link)[:]|\\\\[^\\]+\\/.test(value)))memoryError('PROJECT_MEMORY_ABSOLUTE_PATH');
  if(value&&typeof value==='object')for(const child of Object.values(value))portable(child);
}
export function validateMemoryScope(input:unknown):MemoryScope{
  const scope=checkMemorySchema(scopeSchema,input);
  if((scope.kind==='repository')!==!Object.hasOwn(scope,'path'))memoryError('PROJECT_MEMORY_SCOPE_INVALID');
  if(scope.path?.split('/').some(v=>['.git','.pi','.ssh'].includes(v)))memoryError('PROJECT_MEMORY_SCOPE_INVALID');
  return scope as MemoryScope;
}
export function validateMemoryReference(input:unknown):ProjectMemoryReference{
  const ref=checkMemorySchema(referenceSchema,input) as ProjectMemoryReference;validateMemoryScope(ref.scope);portable(ref);
  if((ref.ownerPackage===MEMORY_OWNER)!==Object.hasOwn(contentSchema,ref.recordKind))memoryError('PROJECT_MEMORY_OWNERSHIP');
  return freezeMemory(ref);
}
export function validateMemoryProposal(input:unknown):ProjectMemoryProposal{
  const v=checkMemorySchema(proposalSchema,input) as unknown as ProjectMemoryProposal;
  validateMemoryScope(v.scope);checkMemorySchema(contentSchema[v.recordKind] as Schema<unknown>,v.content);portable(v);
  v.relatedRecordRefs.forEach(validateMemoryReference);
  if(v.recordKind==='technical-lesson'){
    const c=v.content as TechnicalLessonContent;if(!c.loadWhen.terms.length&&!c.loadWhen.paths.length)memoryError('PROJECT_MEMORY_LOAD_WHEN_REQUIRED');
  }
  for(const e of v.evidenceRefs){
    if(e.kind==='repository-source'){if(e.taskId)memoryError('PROJECT_MEMORY_EVIDENCE_PATH')}
    else if(!e.taskId||e.relativePath!==`tasks/${e.taskId}/artifacts/${e.id}`)memoryError('PROJECT_MEMORY_EVIDENCE_PATH');
  }
  if(new Set(v.evidenceRefs.map(e=>`${e.kind}:${e.relativePath}`)).size!==v.evidenceRefs.length)memoryError('PROJECT_MEMORY_EVIDENCE_DUPLICATE');
  return freezeMemory(v);
}
export const memoryPrefix:Readonly<Record<MemoryKind,string>>=Object.freeze({'software-adr':'SAD','technical-lesson':'TL','project-convention':'PC','technical-constraint':'TC'});
export function memoryAuthority(kind:MemoryKind,status:MemoryStatus):MemoryAuthority{
  if(['PROPOSED','UNVERIFIED'].includes(status))return 'proposal';
  if(['SUPERSEDED','DEPRECATED','RETIRED'].includes(status))return 'historical';
  return ({'software-adr':'software-decision','technical-lesson':'advisory','project-convention':'convention','technical-constraint':'technical-constraint'} as const)[kind];
}
export function recordDigest(record:Omit<ProjectMemoryRecord,'contentDigest'>|ProjectMemoryRecord):string{
  const {contentDigest,...material}=record as ProjectMemoryRecord;return hashCanonical(material);
}
export function validateMemoryRecord(input:unknown):ProjectMemoryRecord{
  const r=checkMemorySchema(recordSchema,input) as unknown as ProjectMemoryRecord;
  const {recordKind,title,scope,content,evidenceRefs,relatedTaskRefs,relatedRecordRefs}=r;
  validateMemoryProposal({recordKind,title,scope,content,evidenceRefs,relatedTaskRefs,relatedRecordRefs});
  if(!new RegExp(`^${memoryPrefix[r.recordKind]}-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`).test(r.recordId)||r.contentDigest!==recordDigest(r)
    ||Date.parse(r.updatedAt)<Date.parse(r.createdAt)||r.authorityKind!==memoryAuthority(r.recordKind,r.status))memoryError('PROJECT_MEMORY_RECORD_INVALID');
  const statuses=r.recordKind==='software-adr'?['PROPOSED','ACCEPTED','SUPERSEDED','DEPRECATED']:
    r.recordKind==='technical-lesson'?['UNVERIFIED','ACTIVE','RETIRED','SUPERSEDED']:['PROPOSED','ACTIVE','RETIRED','SUPERSEDED'];
  if(!statuses.includes(r.status)||(r.status==='SUPERSEDED')!==(r.supersededBy.length===1)||r.supersedes.includes(r.recordId)||r.supersededBy.includes(r.recordId))memoryError('PROJECT_MEMORY_LIFECYCLE_INVALID');
  return freezeMemory(r);
}
export function memoryReference(record:ProjectMemoryRecord,ref:ArtifactRef):ProjectMemoryReference{
  return validateMemoryReference({schemaVersion:1,ownerPackage:MEMORY_OWNER,projectId:record.projectId,recordKind:record.recordKind,
    recordId:record.recordId,revision:record.revision,status:record.status,scope:record.scope,authorityKind:record.authorityKind,
    relativePath:`memory/${ref.relativeStorePath}`,digest:record.contentDigest});
}
export function validateMemoryArtifact(ref:unknown):asserts ref is ArtifactRef{
  if(!validateStructure('ArtifactRef',ref).ok)memoryError('PROJECT_MEMORY_ARTIFACT_INVALID');
}
export function scopeMatches(scope:MemoryScope,files:readonly string[]):boolean{
  return scope.kind==='repository'||files.some(file=>file===scope.path||file.startsWith(scope.path+'/')||scope.path.startsWith(file+'/'));
}
export function scopesOverlap(a:MemoryScope,b:MemoryScope):boolean{
  return a.kind==='repository'||b.kind==='repository'||a.path===b.path||a.path.startsWith(b.path+'/')||b.path.startsWith(a.path+'/');
}
export function currentMemory(record:ProjectMemoryRecord):boolean{return ['ACCEPTED','ACTIVE'].includes(record.status)}
export function memoryKey(record:ProjectMemoryRecord):string|undefined{
  return record.recordKind==='software-adr'?(record.content as SoftwareDecisionContent).decisionKey:
    record.recordKind==='technical-lesson'?(record.content as TechnicalLessonContent).problemKey:undefined;
}
/** Conflict is structural and conservative: overlapping current records with the same explicit key.
 * There is no semantic ranking or automatic winner. An explicit supersession resolves the ambiguity. */
export function memoryConflicts(records:readonly ProjectMemoryRecord[]):readonly {key:string;recordIds:readonly string[]}[]{
  const conflicts:{key:string;recordIds:readonly string[]}[]=[];
  for(let i=0;i<records.length;i++)for(const b of records.slice(i+1)){
    const a=records[i],key=memoryKey(a);
    if(key&&currentMemory(a)&&currentMemory(b)&&a.recordKind===b.recordKind&&memoryKey(b)===key&&scopesOverlap(a.scope,b.scope))conflicts.push({key,recordIds:[a.recordId,b.recordId].sort()});
  }
  return freezeMemory(conflicts);
}
export function memoryExpectation(record:ProjectMemoryRecord):string{
  const c=record.content;
  const text=record.recordKind==='software-adr'?(c as SoftwareDecisionContent).decision:
    record.recordKind==='technical-lesson'?(c as TechnicalLessonContent).rule:
    record.recordKind==='project-convention'?(c as ConventionContent).convention:(c as ConstraintContent).constraint;
  return `${record.recordId}@${record.revision} [${record.contentDigest}] (${record.authorityKind}): ${text.slice(0,800)}`;
}
/** Capability sidecar, separate from the frozen task result contracts. Proposals carry no status or
 * authority fields. The host supplies origin and always creates PROPOSED/UNVERIFIED records. */
export function splitMemoryProposals(input:unknown):{result:unknown;proposals:readonly ProjectMemoryProposal[]}{
  const snapshot=copyJson(input);
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||!Object.hasOwn(snapshot,'memoryProposals'))return {result:snapshot,proposals:[]};
  const {memoryProposals,...result}=snapshot as {readonly [key:string]:import('./contract-json.js').Json};
  if(!Array.isArray(memoryProposals)||memoryProposals.length>4)memoryError('PROJECT_MEMORY_PROPOSAL_LIMIT');
  return {result,proposals:freezeMemory(memoryProposals.map(validateMemoryProposal))};
}
/** The existing RPC adapter requires exact transport equality. Keep a validated sidecar in the
 * acquired transport object; strip it only after correlated acquisition, before workflow admission. */
export function memoryTransportResult<T extends object>(result:T,wire:unknown,proposals:readonly ProjectMemoryProposal[]):T{
  return wire&&typeof wire==='object'&&Object.hasOwn(wire,'memoryProposals')?{...result,memoryProposals:proposals}:result;
}
// The optional transport schema is permissive only about content shape; the explicit per-kind host
// validator above remains fail-closed. No change to TaskSpec, AssignmentEnvelope or role authority.
const wireText={type:'string',minLength:1,maxLength:4096};
const wireScope={type:'object',additionalProperties:false,properties:{kind:{enum:['repository','directory','component']},path:wireText},required:['kind']};
const wireEvidence={type:'object',additionalProperties:false,properties:{kind:{enum:['task','scenario','scenario-run','technical-evidence-bundle','validation','review','artifact','repository-source']},id:wireText,taskId:wireText,relativePath:wireText,digest:wireText},required:['kind','id','relativePath','digest']};
const wireReference={type:'object',additionalProperties:false,properties:{schemaVersion:{const:1},ownerPackage:{enum:['pi-controlled-dev','Systemist']},projectId:wireText,recordKind:wireText,recordId:wireText,revision:{type:'integer',minimum:1},status:wireText,scope:wireScope,authorityKind:wireText,relativePath:wireText,digest:wireText},required:['schemaVersion','ownerPackage','projectId','recordKind','recordId','revision','status','scope','authorityKind','digest']};
export const MEMORY_PROPOSALS_WIRE={type:'array',maxItems:4,items:{type:'object',additionalProperties:false,
  properties:{recordKind:{enum:['software-adr','technical-lesson','project-convention','technical-constraint']},title:wireText,scope:wireScope,
    content:{type:'object',properties:{decisionKey:wireText,context:wireText,decision:wireText,rationale:wireText,consequences:{type:'array',items:wireText},alternatives:{type:'array',items:wireText},
      problemKey:wireText,problem:wireText,cause:wireText,rule:wireText,loadWhen:{type:'object',additionalProperties:false,properties:{terms:{type:'array',items:wireText},paths:{type:'array',items:wireText}},required:['terms','paths']},invalidatedWhen:{type:'array',items:wireText},convention:wireText,sourcePath:wireText,constraint:wireText},additionalProperties:false},
    evidenceRefs:{type:'array',maxItems:32,items:wireEvidence},relatedTaskRefs:{type:'array',maxItems:32,items:wireText},relatedRecordRefs:{type:'array',maxItems:32,items:wireReference}},
  required:['recordKind','title','scope','content','evidenceRefs','relatedTaskRefs','relatedRecordRefs']}} as const;

/** Shared host-authored human narrative, reused by confirmation and Markdown projection. */
export function memoryPresentation(record:Pick<ProjectMemoryRecord,'recordKind'|'content'|'scope'|'status'|'authorityKind'>):string{
  const c=record.content;
  let text:string;
  if(record.recordKind==='software-adr'){
    const a=c as SoftwareDecisionContent;
    text=`Context\n${a.context}\n\nDecision\n${a.decision}\n\nWhy this decision was made\n${a.rationale}

Conseguenze
${a.consequences.join('\n\n')}\n\nAlternatives considered\n${a.alternatives.join('\n\n')||"No further alternatives were documented."}`;
  }else if(record.recordKind==='technical-lesson'){
    const l=c as TechnicalLessonContent;
    text=`Problem encountered\n${l.problem}\n\nCause\n${l.cause}\n\nWhat we learned\n${l.rule}\n\nWhen this lesson is useful\n${l.loadWhen.terms.length?"For objectives concerning "+l.loadWhen.terms.join(', ')+'.':''} ${l.loadWhen.paths.length?"When working on "+l.loadWhen.paths.join(', ')+'.':''}\n\nWhen it is no longer valid\n${l.invalidatedWhen.join('\n\n')}`;
  }else if(record.recordKind==='project-convention'){
    const p=c as ConventionContent;text=`Project convention\n${p.convention}\n\nWhy we follow it\n${p.rationale}${p.sourcePath?"\n\nCurrent source\nThe reference configuration is in "+p.sourcePath+'.':''}`;
  }else{const t=c as ConstraintContent;text=`Technical constraint\n${t.constraint}\n\nReason for the constraint\n${t.rationale}\n\nConsequences for the software\n${t.consequences.join('\n\n')}`}
  return `${text}\n\nWhere it applies\n${record.scope.kind==='repository'?"This memory concerns the repository as a whole.":"This memory concerns "+record.scope.path+'.'}\n\nStatus\n${record.status}. ${record.authorityKind==='proposal'?"It is a proposal to assess, not a current decision.":record.authorityKind==='advisory'?"It is technical advice: it does not expand scope or replace constraints.":record.authorityKind==='historical'?"It is preserved as history; it is not loaded as current memory.":"It is a confirmed current memory; any divergence must be declared and explicitly assessed."}`;
}
