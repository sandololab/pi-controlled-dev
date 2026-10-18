import {existsSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {Bootstrap,technical,channel,inspect,presentTrustedConfirmation} from './greenfield-bootstrap-fixture.mjs';
const [mode,data,repo,point,barrier]=process.argv.slice(2);
try{
 const host=new Bootstrap(data,repo,inspect,p=>{if(mode==='crash'&&p===point){process.stdout.write(JSON.stringify({point:p})+'\n');process.exit(73)}});
 if(mode==='recover'){const id=host.pending();const result=host.recover(id);console.log(JSON.stringify({ok:true,result}))}
 else{
  const p=host.propose('Realizzare un piccolo calcolatore locale',technical()),q=host.prepare(p),r=await presentTrustedConfirmation(channel(),q);
  if(barrier){writeFileSync(join(barrier,String(process.pid)),'ready');while(!existsSync(join(barrier,'go')))await new Promise(r=>setTimeout(r,10))}
  const result=host.apply(q,r);console.log(JSON.stringify({ok:true,result}));
 }
}catch(error){console.log(JSON.stringify({ok:false,error:error.code??error.message}))}
