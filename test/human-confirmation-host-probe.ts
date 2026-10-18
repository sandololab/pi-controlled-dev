import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { canonicalize, hashCanonical } from '../src/contracts.js';
import { HUMAN_GATE_TITLES, humanGateDisplay } from '../src/orchestrator.js';
import type { HumanGateRequest, ImplementedHumanGate } from '../src/orchestrator.js';

/** Synthetic presentation fixtures only: never registered with the trusted gate engine. */
export function humanReadabilityExamples():HumanGateRequest[]{
  const objective='Modificare allowed.txt da "before" a "after".';
  const data:Record<ImplementedHumanGate,object>={
    beforeImplementation:{objective,allowedPaths:['allowed.txt'],deniedPaths:['forbidden.txt'],
      requirements:[{id:'requirement-example',text:'allowed.txt contenga esattamente "after" seguito da un ritorno a capo.'}],
      validationCommands:[{id:'validation-example',executable:'node',argv:['check.cjs']}],knownRisks:[]},
    beforeCompletion:{objective,changedFiles:['allowed.txt'],validation:[{status:'PASSED'}],reviewResult:{verdict:'PASS'},residualRisks:[],decisions:[]},
    onScopeChange:{objective,oldAllowedPaths:['allowed.txt'],proposedAllowedPaths:['allowed.txt','extra.txt'],oldDeniedPaths:[],proposedDeniedPaths:[],
      oldRequirements:[],proposedRequirements:[{id:'requirement-new',text:'Aggiornare anche extra.txt.'}],reason:'Il requisito include un secondo file.'},
    onOracleDecision:{objective,ambiguity:'Quale formato mantenere?',options:['Mantenere il formato attuale.','Proporre una modifica dei requisiti.'],
      recommendation:'Mantenere il formato attuale.',consequences:'Rivalutazione da parte dell’Orchestrator; nessuna modifica immediata.'},
    onRetryExhausted:{objective,lastFailure:{category:'TEST',code:'TEST_FAILED'},counters:{attempts:3,dispatches:3,reworkAttempts:2,infrastructureRetries:0},legalContinuations:['RECONCILE']},
  };
  return Object.entries(data).map(([gateType,value])=>({gateType:gateType as ImplementedHumanGate,displayText:canonicalize(value),
    snapshot:{gateId:'probe-gate',taskId:'probe-task',stateRevision:1,specHash:'a'.repeat(64),candidateDigest:'b'.repeat(64),candidateGeneration:1,
      approvedDataHash:hashCanonical(value),completionPackageHash:'c'.repeat(64),sessionId:'probe-session'}}));
}
import { requestTrustedHumanConfirmation } from './trusted-human-probe.js';
import { isolateParentTools } from '../extensions/controlled-dev.js';

/** Explicit-load diagnostic only: no role registration, workflow, gate or model tool. */
export default function humanConfirmationHostProbe(pi:any):void{
  isolateParentTools(pi);
  let folder:string|undefined,sequence=0,requested=0,records:unknown[]=[],modelClaimObserved=false,modelMessages=0;
  const save=(ctx:any)=>{
    if(!folder)throw new Error('PROBE_SESSION_UNAVAILABLE');
    const path=join(folder,`report-${sequence++}.json`);
    writeFileSync(path,JSON.stringify({schemaVersion:1,probeOnly:true,mode:ctx.mode,sessionId:ctx.sessionManager.getSessionId(),
      parentTools:pi.getActiveTools(),records,modelMessages,modelClaimObserved,approvalEvidenceCreated:false},null,2),{flag:'wx',mode:0o600});
    if(ctx.mode==='tui')ctx.ui.notify(`P14C diagnostic: ${path}`,'info');else console.error(`P14C_REPORT=${path}`);
  };
  pi.on('session_start',(_event:any,ctx:any)=>{
    folder=undefined;
    const temp=realpathSync(tmpdir()),repo=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
    for(const root of [repo,realpathSync(ctx.cwd)]){
      const path=relative(root,temp);if(!path||(!isAbsolute(path)&&path!=='..'&&!path.startsWith(`..${process.platform==='win32'?'\\':'/'}`)))
        throw new Error('PROBE_REPORT_ROOT_OVERLAP');
    }
    folder=mkdtempSync(join(temp,'controlled-human-probe-'));sequence=0;requested=0;records=[];modelClaimObserved=false;modelMessages=0;save(ctx);
  });
  pi.on('message_end',(event:any)=>{
    if(event.message?.role!=='assistant')return;
    modelMessages++;
    const text=(event.message.content??[]).filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n');
    modelClaimObserved ||= /(?:approved|humanConfirmed)["']?\s*[:=]\s*true/.test(text);
    // Observation only: model text never calls the probe or mints a record.
  });
  pi.registerCommand('controlled-human-probe',{description:'Native TUI diagnostic only; run three times for Yes, No, Escape',async handler(args:string,ctx:any){
    if(args.trim())throw new Error('PROBE_ARGUMENTS_NOT_ALLOWED');
    if(!folder)throw new Error('PROBE_SESSION_UNAVAILABLE');
    if(requested>=3)throw new Error('PROBE_LIMIT');
    requested++;const ownerFolder=folder;
    const record=await requestTrustedHumanConfirmation(ctx,{gateProbeId:randomUUID(),testDataHash:hashCanonical('P14C public diagnostic data')});
    if(folder!==ownerFolder||record.sessionId!==ctx.sessionManager.getSessionId())throw new Error('PROBE_SESSION_CHANGED');
    records.push(record);save(ctx);
  }});
  pi.registerCommand('controlled-human-readability',{description:'P14H presentation-only check; never authorizes a task',async handler(args:string,ctx:any){
    if(args.trim()||ctx.mode!=='tui'||!folder)throw new Error('PROBE_TUI_REQUIRED');
    const ownerFolder=folder,session=ctx.sessionManager.getSessionId();
    ctx.ui.notify('P14H: esempi sintetici. Nessuna risposta autorizza un task o avvia un child. Dopo ogni esempio verrà chiesto se il testo è comprensibile.','info');
    for(const request of humanReadabilityExamples().filter(r=>['beforeImplementation','beforeCompletion'].includes(r.gateType))){
      const display=humanGateDisplay(request,{decision:'APPROVE'});
      const exampleAnswer=await ctx.ui.confirm(HUMAN_GATE_TITLES[request.gateType],display);
      const readable=await ctx.ui.confirm('Verifica di leggibilità — non è un’approvazione', 'Capisci chiaramente cosa autorizzerebbe Sì nel dialogo appena mostrato?');
      if(folder!==ownerFolder||ctx.sessionManager.getSessionId()!==session)throw new Error('PROBE_SESSION_CHANGED');
      records.push({probe:'P14H',gateType:request.gateType,display,displayHash:hashCanonical(display),exampleAnswer,readable:readable===true,approvalEvidenceCreated:false});save(ctx);
    }
  }});
  pi.on('session_shutdown',(_event:any,ctx:any)=>{if(folder)save(ctx);folder=undefined});
}
