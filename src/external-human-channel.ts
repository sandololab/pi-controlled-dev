import { randomUUID } from 'node:crypto';
import { hashCanonical, copyJson } from './contract-json.js';

/** Host-only integration seam. Never expose registration as a model/RPC tool. */
export interface ExternalHumanRequest {
  readonly version:1; readonly requestId:string; readonly sessionId:string;
  readonly title:string; readonly display:string; readonly digest:string;
}
export interface ExternalHumanResponse {
  readonly accepted:boolean; readonly requestDigest:string;
  readonly provider:string; readonly interactionId:string; readonly actorUserId:string;
}
type Context={readonly mode:string;readonly sessionManager:{getSessionId():string|undefined}};
const capability=Symbol('external human channel');
type Branded=Context & {[capability]?:object};
const channels=new WeakMap<object,{sessionId:string;manager:Context['sessionManager'];confirm:(q:ExternalHumanRequest)=>Promise<ExternalHumanResponse>;active:boolean}>();

/** Context spreads retain the opaque capability; JSON and caller-supplied modes do not. */
export function createExternalHumanContext<T extends {sessionManager:Context['sessionManager']}>(
  context:T, confirm:(q:ExternalHumanRequest)=>Promise<ExternalHumanResponse>
):T & {mode:'external-human';disposeHumanChannel():void}{
  const sessionId=context.sessionManager.getSessionId();
  if(!sessionId||typeof confirm!=='function')throw new Error('EXTERNAL_HUMAN_CHANNEL_INVALID');
  const token=Object.freeze({}),record={sessionId,manager:context.sessionManager,confirm,active:true};
  channels.set(token,record);
  return {...context,mode:'external-human',[capability]:token,disposeHumanChannel(){record.active=false}};
}
export function hasHumanChannel(context:Context|undefined):boolean{
  if(context?.mode==='tui')return true;
  if(context?.mode!=='external-human')return false;
  const record=channels.get((context as Branded)[capability]??{});
  return Boolean(record?.active&&record.manager===context.sessionManager&&record.sessionId===context.sessionManager.getSessionId());
}
export function externalHumanMethod(context:Context):unknown{
  return channels.get((context as Branded)[capability]??{})?.confirm;
}
export async function confirmExternalHuman(context:Context,title:string,display:string):Promise<boolean>{
  if(context.mode!=='external-human'||!hasHumanChannel(context))throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  const record=channels.get((context as Branded)[capability]!)!;
  const material={version:1 as const,requestId:randomUUID(),sessionId:record.sessionId,title,display};
  const request=Object.freeze({...material,digest:hashCanonical(material)});
  const response=copyJson(await record.confirm(request)) as unknown as ExternalHumanResponse;
  if(!hasHumanChannel(context)||externalHumanMethod(context)!==record.confirm)return false;
  if(!response||Object.keys(response).sort().join(',')!==['accepted','requestDigest','provider','interactionId','actorUserId'].sort().join(',')
    ||typeof response.accepted!=='boolean'||response.requestDigest!==request.digest
    ||[response.provider,response.interactionId,response.actorUserId].some(v=>typeof v!=='string'||!v.trim()||v.length>256))
    throw new Error('EXTERNAL_HUMAN_RESPONSE_INVALID');
  return response.accepted;
}
