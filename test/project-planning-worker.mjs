import {installSourceLoader} from './load-source.mjs';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
installSourceLoader();
const {ProjectPlanningRepository}=await import('../src/project-planning-repository.ts');
const {LockManager,withLockMutation}=await import('../src/lock-manager.ts');
const [mode,data,repo,barrier]=process.argv.slice(2),planning=ProjectPlanningRepository.open(data,repo,()=> 'ACCEPT');
if(mode==='reload')console.log(JSON.stringify({history:planning.history(),links:planning.links(),progress:planning.progress(),inputs:planning.inputs()}));
if(mode==='race'){
  const plan=planning.current(),seed=planning.prepareStart(plan.planId,plan.revision,'protocol');
  writeFileSync(join(barrier,`ready-${process.pid}`),'ready');
  while(!existsSync(join(barrier,'go')))await new Promise(r=>setTimeout(r,10));
  try{const spec=JSON.parse(readFileSync(join(barrier,'spec.json'),'utf8')),manager=new LockManager(data,`racer-${process.pid}`,'planning-race');
    withLockMutation(manager.root,planning.projectId,()=>planning.linkPreparedTask(seed,spec,manager,true));console.log('LINKED');
  }catch(error){console.log('REFUSED '+error.message)}
}
