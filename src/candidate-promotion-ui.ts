import { hasHumanChannel } from './external-human-channel.js';
import { chooseAction, withProgress } from './controlled-ui.js';
import type { ControlledUI } from './controlled-ui.js';
import type { CandidatePromotionRepository } from './candidate-promotion-repository.js';
import type { ControlledReviewerRunner } from './controlled-reviewer.js';
import { presentTrustedConfirmation } from './trusted-confirmation.js';
import type { HumanConfirmationChannel } from './trusted-confirmation.js';
import { promotionNarrative } from './candidate-promotion.js';
export async function showCandidatePromotion(ctx:HumanConfirmationChannel&{ui:ControlledUI},repo:CandidatePromotionRepository,taskId:string,reviewer?:ControlledReviewerRunner):Promise<void>{
  if(!hasHumanChannel(ctx)||!ctx.sessionManager.getSessionId())throw new Error('HUMAN_CHANNEL_UNAVAILABLE');
  if(repo.terminalRestorationRequired(taskId)){
    const request=repo.prepareTerminalRestoration(taskId),receipt=await presentTrustedConfirmation(ctx,request);
    if(!receipt){ctx.ui.notify("Resume was not confirmed. The saved version and completion are preserved.",'info');return}
    await withProgress(ctx.ui,()=> "Status: Restoring the saved version in the new workspace",
      async()=>repo.restoreTerminalCandidate(request,receipt),"Restoring the saved version");
    ctx.ui.notify("The saved version has been restored in the new workspace. Checks and a new review will follow before integration is proposed.",'info');
  }
  const reconciled=repo.recover();if(reconciled.length){ctx.ui.notify("The previously authorized integration has been completed and verified. The original folder is updated and the Git working tree is clean.",'info');return}
  const p=await repo.prepare(taskId,reviewer);
  if(!p){ctx.ui.notify(repo.status(taskId).explanation,'info');return}
  const action=await chooseAction(ctx.ui,"Integrate this task into the project?",promotionNarrative(p),["Back","Approve","Reject"],undefined,{section:"Project integration",scrollWithArrows:true});
  if(!action||action==="Back")return;
  const request=repo.prepareDecision(p.proposalId,action==="Approve"?'APPROVE':'REJECT'),receipt=await presentTrustedConfirmation(ctx,request);
  if(!receipt){ctx.ui.notify("Confirmation was not received. The verified result remains available.",'info');return}
  const result=await withProgress(ctx.ui,()=> "Status: Integrating the confirmed result into the project",
    async()=>repo.applyDecision(request,receipt),"Integrating the confirmed result");
  ctx.ui.notify(result?`Result integrated into branch ${result.targetRef.slice('refs/heads/'.length)}. The original folder contains the changes and the Git working tree is clean.`:
    "Integration rejected. The verified candidate remains available.",'info');
}
