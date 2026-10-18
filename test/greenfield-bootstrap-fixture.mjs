import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
export const {GreenfieldBootstrap:Bootstrap,validateGreenfieldScout}=await import('../src/greenfield-bootstrap.ts');
export const {projectIdentity}=await import('../src/project-identity.ts');
export const {presentTrustedConfirmation}=await import('../src/trusted-confirmation.ts');
export const {DurableStore}=await import('../src/store.ts');
export const api=await import('../src/contracts.ts');
export const inspect=()=> 'ACCEPT';
/** Explicit provider fixture for the current native planning protocol, never runtime normalization. */
export function planningProposal(value){return {design:{context:'Baseline locale della fixture.',approach:value.strategy,decisions:['Riutilizzare i componenti osservati nella fixture.'],components:[...new Set(value.plannedTasks.flatMap(t=>t.scopeIntent))].slice(0,16).map(path=>`${path}: realizzare l’incremento richiesto.`),dataFlow:['Ingresso locale → modulo → risultato osservabile.'],compatibility:['Conservare il comportamento esterno richiesto.'],implementationSequence:value.plannedTasks.map(t=>t.title).slice(0,16),validationStrategy:['Verifiche previste per ogni incremento e review indipendente.'],risks:[],assumptions:['Nessuna dipendenza aggiuntiva richiesta dalla fixture.']},clarificationQuestions:[],memoryProposals:[],...value,plannedTasks:value.plannedTasks.map(t=>({designIntent:['Riutilizzare il componente locale e mantenere i confini previsti.'],implementationSteps:['Implementare il risultato richiesto.','Verificare i criteri previsti.'],...t}))};}
export const channel=(yes=true)=>({mode:'tui',sessionManager:{getSessionId:()=> 'greenfield-human-double'},ui:{confirm:async()=>yes,notify(){}}});
export const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
export const technical=()=>({projectTitle:'Calcolatore locale',initialBranch:'main',missingDecisions:[],initialTechnicalChoices:[
 {recordKind:'software-adr',title:'Runtime minimo',scope:{kind:'repository'},content:{decisionKey:'runtime',context:'Piccolo calcolatore locale',decision:'JavaScript su Node senza dipendenze',rationale:'Un modulo semplice è sufficiente',consequences:['Nessun framework'],alternatives:['TypeScript richiederebbe una compilazione aggiuntiva']},evidenceRefs:[],relatedTaskRefs:[],relatedRecordRefs:[]},
 {recordKind:'project-convention',title:'Test del comportamento',scope:{kind:'repository'},content:{convention:'Verificare il comportamento con assert nativo Node',rationale:'Test leggibili senza toolchain aggiuntiva'},evidenceRefs:[],relatedTaskRefs:[],relatedRecordRefs:[]},
 {recordKind:'technical-constraint',title:'Uso locale',scope:{kind:'repository'},content:{constraint:'Nessuna connessione remota richiesta',rationale:'Il calcolo è locale',consequences:['Nessuna persistenza remota']},evidenceRefs:[],relatedTaskRefs:[],relatedRecordRefs:[]}
]});
export function fixture(t,{empty=false,identity=true}={}){
 const root=mkdtempSync(join(tmpdir(),'greenfield-bootstrap-')),data=join(root,'data'),repo=join(root,'repo'),home=join(root,'home');mkdirSync(data);mkdirSync(home);if(empty)mkdirSync(repo);
 const old=process.env.HOME;process.env.HOME=home;if(identity)writeFileSync(join(home,'.gitconfig'),'[user]\nname = Fixture\nemail = fixture@example.invalid\n');
 t.after(()=>{if(old===undefined)delete process.env.HOME;else process.env.HOME=old;rmSync(root,{recursive:true,force:true})});
 const host=new Bootstrap(data,repo,inspect),proposal=()=>host.propose('Realizzare un piccolo calcolatore locale',technical());return {root,data,repo,home,host,proposal};
}

/** Public runtime/provider double. Native Scout validates schema, transcript, tools and terminal proof.
 * Real model certification is deliberately separate. */
export class ProposalBus {
 listeners=new Map();requests=[];run=0;
 constructor(root,output){this.root=root;this.output=output}
 on(name,fn){const s=this.listeners.get(name)??new Set();s.add(fn);this.listeners.set(name,s);return()=>s.delete(fn)}
 emit(name,data){
  if(name==='pi-subagents:runtime-agent-register:v1'){data.result={ok:true,registration:{dispose(){}}};return}
  if(name!=='subagents:rpc:v1:request'){for(const fn of this.listeners.get(name)??[])fn(data);return}
  this.requests.push(data);let value;
  if(data.method==='ping')value={version:1,methods:['ping','spawn','status','interrupt','stop','resume'],session:{sessionId:'owner',sessionFile:null},events:{asyncComplete:'subagent:async-complete'},capabilities:{asyncSpawn:true,status:true,interrupt:true,stop:true,resume:true,processTerminalProof:{version:1,lifecycleArtifactVersion:3}}};
  else if(data.method==='spawn'){
   this.run++;this.cwd=data.params.cwd;this.agent=data.params.agent;this.session=join(this.root,`proposal-${this.run}.jsonl`);this.id=`proposal-${this.run}`;
   const q=JSON.parse(data.params.task.split('\nREQUEST=')[1].split('\nrequestHash=')[0]);this.result=this.output(q,data.params);
   writeFileSync(this.session,[{type:'session',cwd:this.cwd},{type:'message',message:{role:'system',sections:{preamble:`<active_agent name="${this.agent}"/>`},toolsAdded:['read','structured_output'].map(name=>({name}))}}].map(JSON.stringify).join('\n'));
   value={details:{asyncId:this.id,runId:this.id}};
  }else value={details:{lifecycleStatus:{processTerminal:{version:1,state:'observed',runId:this.id,runnerProcessInstanceId:'proposal-instance',observedAt:1,instances:[{kind:'runner',processInstanceId:'proposal-instance',closeObservedAt:1,exitCode:0,signal:null}],resumeDisposition:'resumable'}}},asyncSnapshot:{version:1,kind:'pi-subagents.async-status-snapshot',runs:[{id:this.id,state:'complete'}]}};
  this.emit(`subagents:rpc:v1:reply:${data.requestId}`,{version:1,requestId:data.requestId,success:true,data:value});
  if(data.method==='spawn')this.emit('subagent:async-complete',{id:this.id,runId:this.id,sessionId:'owner',state:'complete',success:true,exitCode:0,results:[{agent:this.agent,context:'fresh',sessionFile:this.session,status:'completed',success:true,structuredOutput:this.result,launchResolvedExtensions:{version:1,source:'launch-resolved',disableAmbientExtensions:true,configured:[],required:[],runtime:['structured-output'],effective:['structured-output']}}]});
 }
}
