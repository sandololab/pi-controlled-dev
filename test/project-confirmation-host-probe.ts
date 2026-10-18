import { mkdtempSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DurableStore } from '../src/store.js';
import { createTrustedConfirmationRequest, presentTrustedConfirmation, consumeTrustedConfirmation, readTrustedConfirmationEvidence } from '../src/trusted-confirmation.js';
import { isolateParentTools } from '../extensions/controlled-dev.js';

/** Fixture only: not packaged and not Project Memory. A native dialog is required; no test fallback. */
export async function projectConfirmationFixture(ctx:any,store:Pick<DurableStore,'put'|'read'>){
  const request=createTrustedConfirmationRequest({purpose:'project-memory-approval',subjectKind:'ProjectMemoryProposalFixture',
    subjectId:'fixture-proposal',subjectRevision:1,action:'APPROVE',payload:{schemaVersion:1,fixtureOnly:true,proposal:'Usare il repository esistente per la persistenza.'},
    presentation:{title:'Confermare la fixture di progetto?',content:'Questa è una prova del trasporto di conferma. Confermi il payload fittizio che propone di usare il repository esistente per la persistenza? Non crea Project Memory e non autorizza modifiche al progetto.'}});
  const receipt=await presentTrustedConfirmation(ctx,request);if(!receipt)return undefined;
  const ref=consumeTrustedConfirmation(receipt,()=>request,store);
  return {ref,evidence:readTrustedConfirmationEvidence(store,ref,request)};
}
/** Explicit-load manual probe. A command is a human host action, never an agent tool. */
export default function projectConfirmationHostProbe(pi:any):void{
  isolateParentTools(pi);
  pi.registerCommand('project-confirmation-fixture',{description:'Explicit native TUI confirmation fixture; no project mutation',async handler(args:string,ctx:any){
    if(args.trim())throw new Error('PROBE_ARGUMENTS_NOT_ALLOWED');
    if(ctx.mode!=='tui'||!ctx.sessionManager.getSessionId())throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
    const data=realpathSync(mkdtempSync(join(tmpdir(),'project-confirmation-fixture-')));
    const store=DurableStore.create(data,realpathSync(ctx.cwd),'confirmation-fixture',()=> 'ACCEPT');
    const result=await projectConfirmationFixture(ctx,store);
    ctx.ui.notify(result?`Fixture confermata. Ricevuta: ${join(store.root,result.ref.relativeStorePath)}`:'Fixture annullata: nessuna ricevuta autorevole.','info');
  }});
}
