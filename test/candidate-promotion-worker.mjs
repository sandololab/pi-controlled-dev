import {Promotion,inspect,channel,reviewerDouble,completedFixture} from './candidate-promotion-fixture.mjs';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {presentTrustedConfirmation}=await import('../src/trusted-confirmation.ts');
const [operation,data,repo,point,taskId='task']=process.argv.slice(2),mode=operation.replace(/^promotion-/, '');
try{
  if(mode==='rework-create'){const f=await completedFixture({root:data,checkpoint:'REWORK_READY',freeze:false});console.log(JSON.stringify({data:f.data,repo:f.repo,storeRoot:f.storeRoot,binding:f.binding,state:f.state}));process.exit(0)}
  if(mode==='rework-resume'){const {restartFixture}=await import('./recovery-fixture.mjs');const f=await restartFixture(data,'READY',true);console.log(JSON.stringify({state:f.state,errors:f.notifications.filter(x=>x.includes('Error:'))}));process.exit(0)}
  await Promotion.withLease(data,repo,inspect,async service=>{
    if(mode==='hold'){console.log('LOCKED');await new Promise(()=>setInterval(()=>{},1000));return}
    if(mode==='probe'){console.log(JSON.stringify({acquired:true}));return}
    if(mode==='freeze'){console.log(JSON.stringify({binding:service.freeze(taskId)}));return}
    if(mode==='recover'){const results=service.recover();console.log(JSON.stringify({results,head:service.git.head()}));return}
    const p=await service.prepare(taskId,reviewerDouble),q=service.prepareDecision(p.proposalId,'APPROVE'),receipt=await presentTrustedConfirmation(channel(),q);
    service.applyDecision(q,receipt);console.log(JSON.stringify({result:service.results().at(-1)}));
  },fault=>{if(mode==='approve-hold'&&fault==='afterPromotionIntent'){console.log('LOCKED');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)}if(fault===point){console.log(JSON.stringify({crash:point}));process.exit(73)}});
}catch(error){console.log(JSON.stringify({error:error.code??error.message}));process.exitCode=1}
