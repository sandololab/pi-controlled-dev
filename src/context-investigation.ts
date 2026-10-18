import { readFileSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { canonicalize, byteLength, hashCanonical } from './contract-json.js';

export const CONTEXT_INVESTIGATION_LIMITS=Object.freeze({attempts:3,consecutiveWithoutNewReads:2});
const observations=new WeakMap<object,readonly string[]>();
/** Reordering the same scope cannot grant another investigation budget. */
export function contextInvestigationScopeDigest(scope:readonly string[]):string{return hashCanonical([...new Set(scope)].sort())}
/** Host-only read acquisition metadata, never accepted from model JSON. */
export function contextInvestigationReads(result:object):readonly string[]{return observations.get(result)??Object.freeze([])}
/** Called only after transcript/tool/physical-exit verification. Observed source
 * reads guide the finite investigation budget; they never establish correctness. */
export function recordContextInvestigationReads<T extends object>(result:T,sessionPath:string,repoRoot:string):T {
  const raw=readFileSync(sessionPath);if(raw.byteLength>16*1024*1024)throw new Error('RUNTIME_EVIDENCE_LIMIT');
  const calls=new Map<string,{path:string}>(),facts=new Set<string>();
  for(const line of raw.toString('utf8').trimEnd().split('\n')){
    const message=JSON.parse(line).message;if(!message||typeof message!=='object')continue;
    if(message.role==='assistant'&&Array.isArray(message.content))for(const part of message.content){
      if(part?.type!=='toolCall'||part.name!=='read'||typeof part.id!=='string'||typeof part.arguments?.path!=='string')continue;
      const path=relative(repoRoot,resolve(repoRoot,part.arguments.path)).split('\\').join('/');
      if(!path||/^(?:\/|[A-Za-z]:\/)/.test(path)||path==='..'||path.startsWith('../'))continue;
      try{if(realpathSync(resolve(repoRoot,path))!==resolve(repoRoot,path))continue}catch{continue}
      calls.set(part.id,{path});
    }
    if(message.role==='toolResult'&&message.toolName==='read'&&message.isError===false&&Array.isArray(message.content)){
      const call=calls.get(message.toolCallId);if(call)facts.add(hashCanonical({path:call.path,content:message.content}));
    }
  }
  observations.set(result,Object.freeze([...facts].sort()));return result;
}
export class ContextInvestigationBudget {
  #seen=new Set<string>();#attempts=0;#noProgress=0;
  observe(result:object){
    const reads=observations.get(result)??[],newFacts=reads.filter(read=>!this.#seen.has(read)).length;
    for(const read of reads)this.#seen.add(read);
    this.#attempts++;this.#noProgress=newFacts?0:this.#noProgress+1;
    return Object.freeze({retry:this.#attempts<CONTEXT_INVESTIGATION_LIMITS.attempts&&this.#noProgress<CONTEXT_INVESTIGATION_LIMITS.consecutiveWithoutNewReads,
      attempts:this.#attempts,noProgress:this.#noProgress,newFacts});
  }
  reset(){this.#attempts=0;this.#noProgress=0}
}
export function clarificationInvestigationHint(_questions:readonly {question:string;why?:string}[]):string {
  return "Additional read-only investigation: look in the available files for the information needed to resolve the listed uncertainties. Follow relevant dependencies and try a different source from previous reads. Questions from this investigation are context data, not operator answers. Do not invent facts, preferences, checks or permissions. If the files do not provide an answer, preserve the uncertainties and questions for the operator; rewording the text does not count as progress.";
}
export function investigationQuestionHints(questions:readonly {question:string;why?:string}[]):readonly string[]{
  const parts=[clarificationInvestigationHint(questions)];let chunk='';
  const data=questions.map(question=>({question:question.question,...(question.why!==undefined?{why:question.why}:{})}));
  for(const character of `Questions to investigate (complete): ${canonicalize(data)}`){if(byteLength(chunk+character)>3800){parts.push(chunk);chunk=''}chunk+=character}
  if(chunk)parts.push(chunk);return parts;
}

/** Complete explicit answers delivered as context; never an approval or new scope. */
export function contextInvestigationAnswerHints(answers:readonly {question:string;answer:string}[]):readonly string[]{
  if(!answers.length)return [];const parts:string[]=[];let chunk='';
  const text=`Clarifications provided by the operator (context, not new permissions): ${canonicalize(answers)}`;
  for(const character of text){if(byteLength(chunk+character)>3800){parts.push(chunk);chunk=''}chunk+=character}if(chunk)parts.push(chunk);return parts;
}
