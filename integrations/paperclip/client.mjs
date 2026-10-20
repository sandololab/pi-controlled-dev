import {canonical,safeId} from './protocol.mjs';
/** No credentials are persisted. All writes use the current Paperclip run audit. */
export class PaperclipHumanClient{
 constructor({apiUrl,companyId,issueId,agentId,runId,apiKey,fetcher=fetch}){
  const url=new URL(apiUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('PAPERCLIP_URL_INVALID');
  if(![companyId,issueId,agentId,runId].every(safeId)||!apiKey)throw Error('PAPERCLIP_CONTEXT_REQUIRED');
  Object.assign(this,{apiUrl:url.href.replace(/\/$/,'').replace(/\/api$/,''),companyId,issueId,agentId,runId,apiKey,fetcher});
 }
 async api(method,path,body){
  const response=await this.fetcher(this.apiUrl+'/api'+path,{method,redirect:'error',signal:AbortSignal.timeout(12000),
   headers:{Authorization:'Bearer '+this.apiKey,'X-Paperclip-Run-Id':this.runId,...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Error('PAPERCLIP_HTTP_'+response.status);
  return response.json();
 }
 async identity(){
  const [actor,issue]=await Promise.all([this.api('GET','/agents/me'),this.api('GET','/issues/'+this.issueId)]);
  if(actor.id!==this.agentId||actor.companyId!==this.companyId||issue.companyId!==this.companyId||issue.assigneeAgentId!==this.agentId||issue.assigneeUserId||!issue.projectId||!['in_progress','in_review'].includes(issue.status))throw Error('PAPERCLIP_ASSIGNMENT_MISMATCH');
  this.issue=issue;return issue;
 }
 async publish(jobId,request){
  if(!safeId(jobId)||!safeId(request.requestId)||!['confirm','select','editor'].includes(request.kind)||typeof request.title!=='string'||!request.title.trim()||request.title.length>180||typeof request.display!=='string'||Buffer.byteLength(request.display)>65536||(request.kind==='select'&&(!Array.isArray(request.options)||!request.options.length||request.options.length>128||request.options.some(x=>typeof x!=='string'||!x.trim()||x!==x.trim()||x.length>1000))))throw Error('PAPERCLIP_REQUEST_INVALID');
  const idempotencyKey='pi-human:'+jobId+':'+request.requestId+':'+request.digest;
  const rows=await this.api('GET','/issues/'+this.issueId+'/interactions');
  const list=Array.isArray(rows)?rows:rows.interactions;
  if(!Array.isArray(list))throw Error('PAPERCLIP_INTERACTION_RESPONSE_INVALID');
  const existing=list.find(x=>x.idempotencyKey===idempotencyKey);
  const key='pi-'+request.requestId;
  const body='# Decisione del lavoratore Pi\n\n'+request.title+'\n\n'+request.display+'\n\n---\nRiferimento verificabile: '+request.digest;
  let document;
  try{document=await this.api('GET','/issues/'+this.issueId+'/documents/'+key);}
  catch(e){if(e.message!=='PAPERCLIP_HTTP_404')throw e;}
  if(document&&document.body!==body)throw Error('PAPERCLIP_DOCUMENT_CHANGED');
  if(!document)document=await this.api('PUT','/issues/'+this.issueId+'/documents/'+key,{title:'Decisione Pi — '+request.title.slice(0,100),format:'markdown',body,baseRevisionId:null});
  document=await this.api('GET','/issues/'+this.issueId+'/documents/'+key);
  if(document.body!==body||!document.latestRevisionId)throw Error('PAPERCLIP_DOCUMENT_NOT_VERIFIED');
  const prefix=this.issue?.identifier?.split('-')[0];
  if(!prefix)throw Error('PAPERCLIP_ISSUE_PREFIX_REQUIRED');
  const details='Leggi la richiesta completa: [Decisione del lavoratore](/'+prefix+'/issues/'+this.issue.identifier+'#document-'+key+').\n\nLa scelta vale solo per questa versione. Rifiutare o annullare non autorizza il passo.';
  const confirm=request.kind==='confirm';
  const questionHelp=(request.display.length<3400?request.display+'\n\n':'')+details+'\n\nRiferimento: '+request.digest+' / revisione: '+document.latestRevisionId;
  const payload=confirm?{version:1,allowDeclineReason:true,prompt:'Autorizzi il passo descritto nel documento?',acceptLabel:'Conferma questo passo',rejectLabel:'Non autorizzare',rejectRequiresReason:true,rejectReasonLabel:'Che cosa deve cambiare?',detailsMarkdown:details,supersedeOnUserComment:true,
   target:{type:'issue_document',issueId:this.issueId,documentId:document.id,key,revisionId:document.latestRevisionId}}:
   {version:1,title:request.title,submitLabel:'Invia la tua scelta',supersedeOnUserComment:true,questions:[{
    id:'answer',prompt:request.title,helpText:questionHelp,selectionMode:'single',required:true,
    allowOther:false,options:request.kind==='select'?request.options.map((label,i)=>({id:'option-'+i,label})):
     [{id:'text',label:'Scrivi la risposta',freeText:true},{id:'empty',label:'Lascia vuoto'}]}]};
  const result=existing??await this.api('POST','/issues/'+this.issueId+'/interactions',{kind:confirm?'request_confirmation':'ask_user_questions',idempotencyKey,
   title:'Pi — '+request.title.slice(0,140),resolverPolicy:'human_only',continuationPolicy:'wake_assignee',payload});
  const verified=this.validate(result,request);
  if(canonical(result.payload)!==canonical(payload))throw Error('PAPERCLIP_PRESENTATION_MISMATCH');
  await this.api('PATCH','/issues/'+this.issueId,{status:'in_review'});
  return verified;
 }
 validate(row,request){
  if(row.issueId!==this.issueId||row.companyId!==this.companyId||row.effectiveResolverPolicy!=='human_only'||row.requestedResolverPolicy!=='human_only')throw Error('PAPERCLIP_HUMAN_POLICY_REQUIRED');
  if(row.kind!==(request.kind==='confirm'?'request_confirmation':'ask_user_questions'))throw Error('PAPERCLIP_KIND_MISMATCH');
  if(request.kind==='confirm'&&row.payload?.target?.key!=='pi-'+request.requestId)throw Error('PAPERCLIP_TARGET_MISMATCH');
  if(request.kind!=='confirm'){
   const q=row.payload?.questions?.[0];
   if(row.payload?.questions?.length!==1||q?.id!=='answer'||q.prompt!==request.title||typeof q.helpText!=='string'||!q.helpText.includes('Riferimento: '+request.digest+' / revisione: ')||q.selectionMode!=='single')throw Error('PAPERCLIP_PRESENTATION_MISMATCH');
   if(q.required!==true||q.allowOther!==false)throw Error('PAPERCLIP_PRESENTATION_MISMATCH');
   if(request.kind==='editor'&&canonical(q.options)!==canonical([{id:'text',label:'Scrivi la risposta',freeText:true},{id:'empty',label:'Lascia vuoto'}]))throw Error('PAPERCLIP_PRESENTATION_MISMATCH');
   if(request.kind==='select'&&canonical(q.options)!==canonical(request.options.map((label,i)=>({id:'option-'+i,label}))))throw Error('PAPERCLIP_PRESENTATION_MISMATCH');
  }
  return row;
 }
 async read(row,request){
  // The canonical issue endpoint returns current staleness and authoritative resolver fields.
  const rows=await this.api('GET','/issues/'+this.issueId+'/interactions');
  const current=(Array.isArray(rows)?rows:rows.interactions)?.find(x=>x.id===row.id);
  if(!current)throw Error('PAPERCLIP_INTERACTION_MISSING');
  this.validate(current,request);
  if(canonical(current.payload)!==canonical(row.payload)||current.idempotencyKey!==row.idempotencyKey)throw Error('PAPERCLIP_REQUEST_CHANGED');
  const document=await this.api('GET','/issues/'+this.issueId+'/documents/pi-'+request.requestId);
  const expected='# Decisione del lavoratore Pi\n\n'+request.title+'\n\n'+request.display+'\n\n---\nRiferimento verificabile: '+request.digest;
  if(document.body!==expected)throw Error('PAPERCLIP_PRESENTATION_MISMATCH');
  const revision=request.kind==='confirm'?current.payload.target.revisionId:current.payload.questions[0].helpText.split(' / revisione: ').at(-1);
  if(document.latestRevisionId!==revision)throw Error('PAPERCLIP_STALE_TARGET');
  if(request.kind==='confirm'&&document.id!==current.payload.target.documentId)throw Error('PAPERCLIP_TARGET_MISMATCH');
  if(current.status==='pending')return null;
  if(!['accepted','answered','rejected'].includes(current.status))return {cancelled:true,reason:current.status};
  if(typeof current.resolvedByUserId!=='string'||!current.resolvedByUserId||current.resolvedByAgentId||current.resolvedByRunId||!current.resolvedAt)throw Error('PAPERCLIP_HUMAN_RESOLVER_REQUIRED');
  const proof={provider:'paperclip',interactionId:current.id,actorUserId:current.resolvedByUserId,requestDigest:request.digest,resolvedAt:current.resolvedAt};
  if(request.kind==='confirm'){
   if(current.status==='accepted'&&current.result?.outcome!=='accepted'||current.status==='rejected'&&current.result?.outcome!=='rejected')throw Error('PAPERCLIP_OUTCOME_INVALID');
   return {...proof,accepted:current.status==='accepted'};
  }
  if(current.status!=='answered'||current.result?.cancelled||current.result?.outcome)return {cancelled:true,reason:'not-answered'};
  const answers=current.result?.answers;
  if(!Array.isArray(answers)||answers.length!==1||answers[0].questionId!=='answer')throw Error('PAPERCLIP_ANSWER_INVALID');
  const a=answers[0];let value;
  if(request.kind==='select'){
   if(a.optionIds?.length!==1||a.otherText)throw Error('PAPERCLIP_ANSWER_INVALID');
   const index=request.options.findIndex((_,i)=>a.optionIds[0]==='option-'+i);if(index<0)throw Error('PAPERCLIP_ANSWER_INVALID');value=request.options[index];
  }else{
   if(!Array.isArray(a.optionIds)||a.optionIds.length>1)throw Error('PAPERCLIP_ANSWER_INVALID');
   if(a.optionIds.length===1&&a.optionIds[0]==='empty'&&!a.otherText)value='';
   // Paperclip's canonical free-text response omits the custom option ID.
   // Explicit legacy 'text' remains accepted; an empty selection alone is never consent.
   else if((a.optionIds.length===0||a.optionIds[0]==='text')&&typeof a.otherText==='string'&&a.otherText.trim()&&a.otherText.length<=60000)value=a.otherText;
   else throw Error('PAPERCLIP_ANSWER_INVALID');
  }
  return {...proof,value};
 }
}

