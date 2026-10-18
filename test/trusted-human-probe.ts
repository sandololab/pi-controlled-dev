import { randomUUID } from 'node:crypto';
import { hashCanonical } from '../src/contracts.js';

/** Host-only diagnostic. Never register this as a model tool or use its JSON as gate authority.
 * Trusts Pi's native context; it cannot authenticate a hostile in-process extension or terminal automation. */
interface ProbeContext {
  readonly mode:string;
  readonly ui:{confirm(title:string,message:string,options:{timeout:number}):Promise<boolean>};
  readonly sessionManager:{getSessionId():string|undefined};
}
export interface ProbePayload {readonly gateProbeId:string;readonly testDataHash:string}
export interface HumanChannelProbeRecord {
  readonly schemaVersion:1;readonly kind:'HUMAN_CHANNEL_DIAGNOSTIC';readonly localRecordId:string;
  readonly mode:string;readonly sessionId:string|null;readonly uiConfirmAvailable:boolean;
  readonly payload:ProbePayload;readonly displayData:{readonly title:string;readonly message:string};readonly displayedDataHash:string;
  readonly confirmRequested:boolean;readonly confirmDisplayed:boolean|null;
  readonly humanAccepted:boolean;readonly humanRejected:null;
  readonly outcome:'CONFIRMED'|'NOT_CONFIRMED'|'TRUSTED_HUMAN_CHANNEL_UNAVAILABLE'|'BINDING_CHANGED'|'INVALID_UI_RESPONSE';
  readonly startedAt:string;readonly endedAt:string;
  readonly channelEvidence:{readonly channel:'TUI'|null;readonly source:'ctx.ui.confirm'|null;
    readonly providerConfirmationId:null;readonly actorIdentity:null;readonly negativeResponseDistinguishable:false};
}
const issued=new WeakSet<object>(),pending=new Set<string>();
export async function requestTrustedHumanConfirmation(ctx:ProbeContext,input:unknown):Promise<HumanChannelProbeRecord>{
  if(!input||typeof input!=='object'||Array.isArray(input)
    ||Object.keys(input).sort().join(',')!=='gateProbeId,testDataHash')throw new Error('INVALID_PROBE_PAYLOAD');
  const {gateProbeId,testDataHash}=input as ProbePayload;
  if(typeof gateProbeId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(gateProbeId)
    ||typeof testDataHash!=='string'||!/^[a-f0-9]{64}$/.test(testDataHash))throw new Error('INVALID_PROBE_PAYLOAD');
  const payload=Object.freeze({gateProbeId,testDataHash});
  const displayData=Object.freeze({title:'P14C: diagnostic only — no workflow approval',
    message:`gateProbeId = ${payload.gateProbeId}\ntestDataHash = ${payload.testDataHash}\ndecision = approve / reject\nYes confirms this probe only. No / Escape does not approve.`});
  const displayedDataHash=hashCanonical(displayData),mode=ctx.mode,sessionId=ctx.sessionManager.getSessionId()??null;
  const startedAt=new Date().toISOString(),uiConfirmAvailable=typeof ctx.ui?.confirm==='function';
  let outcome:HumanChannelProbeRecord['outcome']='TRUSTED_HUMAN_CHANNEL_UNAVAILABLE',confirmRequested=false;
  if(mode==='tui'&&uiConfirmAvailable&&sessionId&&!pending.has(sessionId)){
    pending.add(sessionId);
    try{
      confirmRequested=true;
      const response:unknown=await ctx.ui.confirm(displayData.title,displayData.message,{timeout:120000});
      outcome=ctx.mode!==mode||ctx.sessionManager.getSessionId()!==sessionId?'BINDING_CHANGED'
        :response===true?'CONFIRMED':response===false?'NOT_CONFIRMED':'INVALID_UI_RESPONSE';
    }catch{outcome='TRUSTED_HUMAN_CHANNEL_UNAVAILABLE'}finally{pending.delete(sessionId)}
  }
  const humanAccepted=outcome==='CONFIRMED';
  const record:HumanChannelProbeRecord=Object.freeze({schemaVersion:1,kind:'HUMAN_CHANNEL_DIAGNOSTIC',localRecordId:randomUUID(),mode,sessionId,
    uiConfirmAvailable,payload,displayData,displayedDataHash,confirmRequested,
    // No independent render acknowledgement: only native affirmative return implies display.
    confirmDisplayed:humanAccepted?true:confirmRequested?null:false,humanAccepted,humanRejected:null,outcome,startedAt,endedAt:new Date().toISOString(),
    channelEvidence:Object.freeze({channel:confirmRequested?'TUI':null,source:confirmRequested?'ctx.ui.confirm':null,
      providerConfirmationId:null,actorIdentity:null,negativeResponseDistinguishable:false})});
  issued.add(record);return record;
}
/** Same-process diagnostic binding check, not a production gate or authenticated JSON import. */
export function isCurrentConfirmedProbeRecord(record:unknown,sessionId:string,payload:ProbePayload,displayedDataHash:string):boolean{
  if(!record||typeof record!=='object'||!issued.has(record))return false;
  const r=record as HumanChannelProbeRecord;
  return r.humanAccepted&&r.sessionId===sessionId&&r.payload.gateProbeId===payload.gateProbeId&&r.payload.testDataHash===payload.testDataHash
    &&r.displayedDataHash===displayedDataHash&&hashCanonical(r.displayData)===displayedDataHash;
}
