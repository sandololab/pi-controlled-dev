import {Checkpoints,inspect,checkpointReviewer} from './integration-checkpoint-fixture.mjs';
const [mode,data,repo,id,revision='1',point]=process.argv.slice(2);
const operation=mode.replace(/^checkpoint-/, '');
try{
  const service=Checkpoints.open(data,repo,inspect,{fault(p){
    if(p===point){console.log(JSON.stringify({checkpoint:p}));process.exit(73)}
    if(operation==='hold'&&p==='afterCreated'){console.log('LOCKED');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)}
  }});
  if(operation==='reload'){console.log(JSON.stringify({definitions:service.definitions(),runs:service.runs(),status:service.status()}));}
  else if(operation==='recover'){console.log(JSON.stringify(service.recover(id)))}
  else console.log(JSON.stringify(await service.run(id,Number(revision),undefined,checkpointReviewer())));
}catch(error){console.log(JSON.stringify({error:error.code??error.message}));process.exitCode=1}
