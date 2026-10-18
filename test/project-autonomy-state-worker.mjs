import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {ProjectAutonomyRepository}=await import('../src/project-autonomy.ts');
const [data,repo,barrier]=process.argv.slice(2),request=JSON.parse(readFileSync(join(barrier,'request.json'),'utf8'));
// Open before the barrier so only actual effect mutations race for the native project guard.
let service;const deadline=Date.now()+10000;
while(!service){try{service=ProjectAutonomyRepository.open(data,repo,()=> 'ACCEPT');}catch(error){if(!/EEXIST|LOCK/.test(error.code??error.message)||Date.now()>deadline)throw error;await new Promise(resolve=>setTimeout(resolve,10));}}
writeFileSync(join(barrier,`ready-${process.pid}`),'ready');
while(!existsSync(join(barrier,'go')))await new Promise(resolve=>setTimeout(resolve,10));
try{service.recordTaskStateEffect(request.authorizationRef,request.sourceRef);console.log('RECORDED');}
catch(error){console.log('REFUSED '+(error.code??error.message));}
