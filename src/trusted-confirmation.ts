import { randomUUID } from 'node:crypto';
import { confirmChoice } from './controlled-ui.js';
import type { CustomUI } from './controlled-ui.js';
import { canonicalize, copyJson, byteLength, hashCanonical } from './contract-json.js';
import type { Json } from './contract-json.js';
import { validateScalar, validateStructure, hashBytes, parseJson } from './contracts.js';
import type { ArtifactRef } from './contracts.js';

export interface HumanConfirmationChannel {
  readonly mode:string; readonly sessionManager:{getSessionId():string|undefined};
  readonly ui:{confirm(title:string,message:string,options?:{timeout?:number}):Promise<boolean>;custom?:CustomUI};
}
export type ConfirmationSource='ctx.ui.confirm'|'ctx.ui.custom';
/** Shared native transport. An affirmative return is not itself an authorization receipt. */
export async function requestHumanConfirmation(ctx:HumanConfirmationChannel,display:string,title:string):Promise<ConfirmationSource|undefined>{
  const session=ctx?.sessionManager?.getSessionId();
  const custom=ctx?.ui?.custom,confirm=ctx?.ui?.confirm;
  if(ctx?.mode!=='tui'||!session||(typeof custom!=='function'&&typeof confirm!=='function'))throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  try{
    const result:unknown=typeof custom==='function'
      ?await confirmChoice(ctx.ui,title,display)
      :await confirm.call(ctx.ui,title,display,{timeout:120000});
    if(result!==true||ctx.mode!=='tui'||ctx.sessionManager.getSessionId()!==session)return undefined;
    if(typeof custom==='function')return ctx.ui.custom===custom?'ctx.ui.custom':undefined;
    return ctx.ui.confirm===confirm?'ctx.ui.confirm':undefined;
  }catch{return undefined}
}

export type ConfirmationPurpose='task-human-gate'|'project-memory-approval'|'project-plan-approval'|'candidate-promotion'|'integration-checkpoint'|'greenfield-bootstrap'|'source-project-import'|'current-project-setup'|'project-autonomy-policy-approval'|'scout-clarification'|'project-handoff'|'project-runtime-import';
export type ConfirmationAction='APPROVE'|'REJECT'|'ANSWER';
export interface TrustedConfirmationInput {
  readonly purpose:ConfirmationPurpose; readonly subjectKind:string; readonly subjectId:string;
  readonly subjectRevision:number; readonly action:ConfirmationAction; readonly payload:Json;
  readonly presentation:{readonly title:string;readonly content:string};
}
export interface TrustedConfirmationRequest extends TrustedConfirmationInput {
  readonly schemaVersion:1; readonly confirmationId:string; readonly payloadDigest:string;
}
export interface TrustedConfirmationReceipt {
  readonly schemaVersion:1; readonly confirmationId:string; readonly purpose:ConfirmationPurpose;
  readonly subjectKind:string; readonly subjectId:string; readonly subjectRevision:number; readonly action:ConfirmationAction;
  readonly payloadDigest:string; readonly presentationDigest:string; readonly requestDigest:string;
  readonly decision:ConfirmationAction; readonly confirmedAt:string;
  readonly confirmationInstance:{readonly id:string;readonly sessionId:string;readonly source:ConfirmationSource};
}
export interface TrustedConfirmationEvidence {
  readonly schemaVersion:1; readonly request:TrustedConfirmationRequest; readonly receipt:TrustedConfirmationReceipt;
}
interface ReceiptStore {put(id:string,content:string,mediaType:string):ArtifactRef;read(ref:ArtifactRef):Uint8Array}
export const TRUSTED_CONFIRMATION_MEDIA='application/vnd.pi-controlled-dev.trusted-confirmation+json';
export const CONFIRMATION_LIMITS=Object.freeze({payloadBytes:65536,presentationBytes:65536,requestBytes:132096,evidenceBytes:135168});
const requests=new WeakSet<object>(),receipts=new WeakMap<object,{request:TrustedConfirmationRequest;ctx:HumanConfirmationChannel;source:ConfirmationSource;method:unknown}>();
function fail(code:string):never{throw new Error(code)}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v)}return v}
function closed(v:unknown,keys:readonly string[]):asserts v is Record<string,unknown>{
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==[...keys].sort().join(','))fail('TRUSTED_CONFIRMATION_INVALID');
}
function scalar(kind:'ID'|'UInt'|'Hash'|'Time'|'Text',v:unknown):void{if(!validateScalar(kind,v).ok)fail('TRUSTED_CONFIRMATION_INVALID')}
function checkedRequest(input:unknown):TrustedConfirmationRequest{
  const v=copyJson(input) as unknown as TrustedConfirmationRequest;
  closed(v,['schemaVersion','confirmationId','purpose','subjectKind','subjectId','subjectRevision','action','payload','payloadDigest','presentation']);
  if(v.schemaVersion!==1||!['task-human-gate','project-memory-approval','project-plan-approval','candidate-promotion','integration-checkpoint','greenfield-bootstrap','source-project-import','current-project-setup','project-autonomy-policy-approval','scout-clarification','project-handoff','project-runtime-import'].includes(v.purpose)||!['APPROVE','REJECT','ANSWER'].includes(v.action))fail('TRUSTED_CONFIRMATION_INVALID');
  scalar('ID',v.confirmationId);scalar('ID',v.subjectKind);scalar('ID',v.subjectId);scalar('UInt',v.subjectRevision);scalar('Hash',v.payloadDigest);
  closed(v.presentation,['title','content']);scalar('Text',v.presentation.title);
  // Reject text the native renderer would sanitize, so persisted text is the exact logical display.
  for(const text of [v.presentation.title,v.presentation.content])if(typeof text!=='string'||!text.trim()||/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(text))fail('TRUSTED_CONFIRMATION_INVALID');
  if(byteLength(canonicalize(v.payload))>CONFIRMATION_LIMITS.payloadBytes||byteLength(canonicalize(v.presentation))>CONFIRMATION_LIMITS.presentationBytes||
    byteLength(canonicalize(v))>CONFIRMATION_LIMITS.requestBytes||hashCanonical(v.payload)!==v.payloadDigest)fail('TRUSTED_CONFIRMATION_INVALID');
  return freeze(v);
}
/** Host-code API only. Trusted extensions are in the existing trust model; never register this as an agent/RPC tool.
 * JSON copies do not acquire the process-local request capability. */
export function createTrustedConfirmationRequest(input:TrustedConfirmationInput):TrustedConfirmationRequest{
  const v=copyJson(input) as unknown as TrustedConfirmationInput;
  closed(v,['purpose','subjectKind','subjectId','subjectRevision','action','payload','presentation']);
  closed(v.presentation,['title','content']);
  // Validate before interpolating: coercion must never turn malformed host input into valid display text.
  const exact=checkedRequest({...v,schemaVersion:1,confirmationId:`local-${randomUUID()}`,payloadDigest:hashCanonical(v.payload)});
  // Bind both the host narrative and an explicit decision/subject label in the actual display.
  const content=`${exact.presentation.content}\n\nDecision to confirm: ${exact.action}\nSubject: ${exact.subjectKind} / ${exact.subjectId}, revision ${exact.subjectRevision}\nNo/Esc cancels: no decision recorded.`;
  const request=checkedRequest({...exact,presentation:{title:exact.presentation.title,content}});
  requests.add(request);return request;
}
/** One attempt per request. False, cancellation, timeout and invalid responses never mean REJECT or APPROVE. */
export async function presentTrustedConfirmation(ctx:HumanConfirmationChannel,request:TrustedConfirmationRequest):Promise<TrustedConfirmationReceipt|undefined>{
  if(!request||!requests.has(request))fail('TRUSTED_CONFIRMATION_REQUEST_UNREGISTERED');
  requests.delete(request);
  const exact=checkedRequest(request),sessionId=ctx?.sessionManager?.getSessionId();
  const methods={confirm:ctx?.ui?.confirm,custom:ctx?.ui?.custom};
  const source=await requestHumanConfirmation(ctx,exact.presentation.content,exact.presentation.title);
  if(!source)return undefined;
  const receipt:TrustedConfirmationReceipt=freeze({schemaVersion:1,confirmationId:exact.confirmationId,purpose:exact.purpose,
    subjectKind:exact.subjectKind,subjectId:exact.subjectId,subjectRevision:exact.subjectRevision,action:exact.action,
    payloadDigest:exact.payloadDigest,presentationDigest:hashCanonical(exact.presentation),requestDigest:hashCanonical(exact),decision:exact.action,
    confirmedAt:new Date().toISOString(),confirmationInstance:{id:randomUUID(),sessionId:sessionId!,source}});
  receipts.set(receipt,{request:exact,ctx,source,method:source==='ctx.ui.custom'?methods.custom:methods.confirm});return receipt;
}
/** One genuine TUI decision for several exact, separately bound subjects. No inferred approval. */
export async function presentTrustedConfirmationBundle(ctx:HumanConfirmationChannel,items:readonly TrustedConfirmationRequest[]):Promise<readonly TrustedConfirmationReceipt[]|undefined>{
  if(items.length<2||items.length>4||new Set(items).size!==items.length||items.some(q=>!requests.has(q)))fail('TRUSTED_CONFIRMATION_REQUEST_UNREGISTERED');
  const content=items.map(q=>checkedRequest(q).presentation.content).join('\n\n────────────────────────\n\n');
  if(byteLength(content)>CONFIRMATION_LIMITS.presentationBytes)fail('TRUSTED_CONFIRMATION_INVALID');
  const sessionId=ctx.sessionManager.getSessionId(),method=ctx.ui.custom??ctx.ui.confirm;
  for(const q of items)requests.delete(q);
  const source=await requestHumanConfirmation(ctx,content,"Approve the plan and controlled autonomy?");
  if(!source||ctx.sessionManager.getSessionId()!==sessionId||(ctx.ui.custom??ctx.ui.confirm)!==method)return;
  return Object.freeze(items.map(request=>{const q=checkedRequest(request),receipt:TrustedConfirmationReceipt=freeze({schemaVersion:1,confirmationId:q.confirmationId,purpose:q.purpose,
    subjectKind:q.subjectKind,subjectId:q.subjectId,subjectRevision:q.subjectRevision,action:q.action,payloadDigest:q.payloadDigest,
    presentationDigest:hashCanonical(q.presentation),requestDigest:hashCanonical(q),decision:q.action,confirmedAt:new Date().toISOString(),
    confirmationInstance:{id:randomUUID(),sessionId:sessionId!,source}});
    receipts.set(receipt,{request:q,ctx,source,method});return receipt;}));
}
function sameCurrent(request:TrustedConfirmationRequest,current:unknown):void{
  if(canonicalize(checkedRequest(current))!==canonicalize(request))fail('TRUSTED_CONFIRMATION_STALE');
}
/** Consume capability before I/O, persist exact evidence through the existing store, then recheck freshness.
 * Consumer must hold its existing lock/CAS and perform the authoritative action only after this returns.
 * Any failure burns the receipt. Reopening historical JSON never restores action authority. */
export function consumeTrustedConfirmation(receipt:TrustedConfirmationReceipt,readCurrent:()=>unknown,store:ReceiptStore):ArtifactRef{
  const issued=receipt&&receipts.get(receipt);if(!issued)fail('TRUSTED_CONFIRMATION_RECEIPT_INVALID');
  receipts.delete(receipt);
  const {request,ctx,source,method}=issued;
  const channelCurrent=()=>{if(ctx.mode!=='tui'||ctx.sessionManager.getSessionId()!==receipt.confirmationInstance.sessionId||
    (source==='ctx.ui.custom'?ctx.ui.custom:ctx.ui.confirm)!==method)fail('TRUSTED_CONFIRMATION_STALE')};
  channelCurrent();sameCurrent(request,readCurrent());
  const packet:TrustedConfirmationEvidence={schemaVersion:1,request,receipt},content=canonicalize(packet);
  const ref=store.put(`confirmation-${receipt.confirmationInstance.id}`,content,TRUSTED_CONFIRMATION_MEDIA);
  readTrustedConfirmationEvidence(store,ref,request);
  sameCurrent(request,readCurrent());channelCurrent();return ref;
}
/** Read-only historical integrity/binding check. Trusted store provenance is required; hashes alone do not
 * authenticate a human. This function never registers requests/receipts or grants permission to act. */
export function readTrustedConfirmationEvidence(store:Pick<ReceiptStore,'read'>,ref:ArtifactRef,expected:unknown):TrustedConfirmationEvidence{
  if(!validateStructure('ArtifactRef',ref).ok||ref.mediaType!==TRUSTED_CONFIRMATION_MEDIA||ref.bytes>CONFIRMATION_LIMITS.evidenceBytes)fail('TRUSTED_CONFIRMATION_EVIDENCE_INVALID');
  const raw=store.read(ref);if(raw.byteLength!==ref.bytes||hashBytes(raw)!==ref.digest)fail('TRUSTED_CONFIRMATION_EVIDENCE_INVALID');
  const packet=parseJson(raw,CONFIRMATION_LIMITS.evidenceBytes) as unknown as TrustedConfirmationEvidence;
  closed(packet,['schemaVersion','request','receipt']);if(packet.schemaVersion!==1)fail('TRUSTED_CONFIRMATION_EVIDENCE_INVALID');
  const q=checkedRequest(packet.request),r=packet.receipt;
  closed(r,['schemaVersion','confirmationId','purpose','subjectKind','subjectId','subjectRevision','action','payloadDigest','presentationDigest','requestDigest','decision','confirmedAt','confirmationInstance']);
  closed(r.confirmationInstance,['id','sessionId','source']);scalar('ID',r.confirmationInstance.id);scalar('Text',r.confirmationInstance.sessionId);scalar('Time',r.confirmedAt);
  if(!['ctx.ui.confirm','ctx.ui.custom'].includes(r.confirmationInstance.source)||r.schemaVersion!==1||r.decision!==q.action||
    r.requestDigest!==hashCanonical(q)||r.payloadDigest!==q.payloadDigest||r.presentationDigest!==hashCanonical(q.presentation)||
    ['confirmationId','purpose','subjectKind','subjectId','subjectRevision','action'].some(k=>r[k as keyof TrustedConfirmationReceipt]!==q[k as keyof TrustedConfirmationRequest]))fail('TRUSTED_CONFIRMATION_EVIDENCE_INVALID');
  sameCurrent(q,expected);
  // The receipt artifact is exact canonical JSON, not a permissive JSON import.
  if(hashCanonical(packet)!==ref.digest)fail('TRUSTED_CONFIRMATION_EVIDENCE_INVALID');
  return freeze(packet);
}
