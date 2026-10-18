import {mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installSourceLoader} from './load-source.mjs';
import {restartFixture} from './recovery-fixture.mjs';
installSourceLoader();
export const {CandidatePromotionRepository:Promotion}=await import('../src/candidate-promotion-repository.ts');
export const api=await import('../src/contracts.ts');
export const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
export const inspect=()=> 'ACCEPT';
export const channel=(yes=true)=>({mode:'tui',sessionManager:{getSessionId:()=> 'promotion-human-double'},ui:{confirm:async()=>yes,notify(){}}});
export async function completedFixture(options={}){
  const root=options.root??mkdtempSync(join(tmpdir(),'candidate-promotion-'));let initial;
  const fixture=await restartFixture(root,options.checkpoint??'COMPLETED',false,false,undefined,async({data,repo,spec})=>{
    if(!options.existingRepo)git(repo,'branch','-m',options.branch??'main');git(repo,'config','user.name','Fixture');git(repo,'config','user.email','fixture@example.invalid');
    if(options.configure)await options.configure({repo,data,spec});spec.specHash=api.hashContract('TaskSpec',spec);
    const promotion=Promotion.open(data,repo,inspect,{create:true});initial=promotion.initialize(spec,git(repo,'rev-parse','HEAD'));
    const candidateRoot=promotion.materialize(spec.taskId);return {candidateRoot,...(options.developerContent?{developerContent:options.developerContent}:{}),...(options.noChange?{noChange:true}:{})};
  },{taskId:options.taskId,existingRepo:options.existingRepo});
  const promotion=Promotion.open(fixture.data,fixture.repo,inspect);const binding=options.freeze===false?initial:promotion.freeze(options.taskId??'task');return {...fixture,root,initial,binding,promotion};
}
// This explicitly declared provider double exercises service policy with real Git and the
// production terminal-verified task ledger; separate tests exercise native Reviewer RPC.
export const reviewerDouble={async reviewIntegration(_repo,_work,packet){return {schemaVersion:1,source:'controlled.reviewer',packetDigest:api.hashCanonical(packet),
  result:{packetDigest:api.hashCanonical(packet),verdict:'PASS',reason:'Declared independent Reviewer policy double',criteria:packet.criteria.map(c=>({criterionId:c.id,status:'PASS',reason:'Fixture criterion'}))},
  runId:'fixture-review',requestId:'fixture-request',sessionDigest:'a'.repeat(64),launchContractHash:'b'.repeat(64),invokedTools:['read'],terminalProofDigest:'c'.repeat(64),candidateUnchanged:true,originalWorkspaceUnchanged:true}}};
