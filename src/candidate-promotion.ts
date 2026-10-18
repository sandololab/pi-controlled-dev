import { canonicalize, copyJson, byteLength } from './contract-json.js';
import type { Issue } from './contract-json.js';
import { object, literal, list, scalars, scalar, enumeration, integer } from './contract-schema.js';
import type { Schema, Infer } from './contract-schema.js';
import { validateStructure } from './contracts.js';
import type { ArtifactRef } from './contracts.js';
import { freezeMemory } from './project-memory.js';
import { validatePlanningPortability } from './project-planning.js';
import { localRef } from './candidate-git.js';

export const PROMOTION_MEDIA='application/vnd.pi-controlled-dev.candidate-promotion+json';
export function promotionError(code:string):never{throw new Error(code)}
const ref=scalar<string>('LOCAL_REF',v=>{try{return typeof v==='string'&&localRef(v)===v}catch{return false}});
const artifact=scalar<ArtifactRef>('ARTIFACT',v=>validateStructure('ArtifactRef',v).ok);
const nullable=<T>(schema:Schema<T>)=>scalar<T|null>('OPTIONAL',v=>{if(v===null)return true;const issues:Issue[]=[];schema.check(v,'$',issues);return !issues.length});
const binding=object('CandidateGitBinding',{
  schemaVersion:literal(1),taskId:scalars.ID,projectId:scalars.Hash,specHash:scalars.Hash,targetRef:ref,baseCommit:scalars.GitOID,candidateRef:ref,
  candidateCommit:nullable(scalars.GitOID),candidateDigest:nullable(scalars.Hash),candidateGeneration:nullable(scalars.UInt),completedSpecHash:nullable(scalars.Hash),createdAt:scalars.Time,
});
export type CandidateGitBinding=Infer<typeof binding>;
const change=object('PromotionChange',{path:scalars.Path,kind:enumeration('A','M','D','T')});
const proposal=object('CandidatePromotionProposal',{
  schemaVersion:literal(1),proposalId:scalars.ID,projectId:scalars.Hash,taskId:scalars.ID,specHash:scalars.Hash,title:scalars.Text,
  targetRef:ref,targetHead:scalars.GitOID,taskBaseCommit:scalars.GitOID,candidateRef:ref,candidateCommit:scalars.GitOID,candidateDigest:scalars.Hash,
  integrationCommit:scalars.GitOID,integrationTree:scalars.GitOID,integrationDigest:scalars.Hash,
  validationRefs:list(artifact,1,64),reviewRef:artifact,changedFiles:list(change,0,2048),createdAt:scalars.Time,
});
export type CandidatePromotionProposal=Infer<typeof proposal>;
const intent=object('CandidatePromotionIntent',{
  schemaVersion:scalar<1|2>('INTENT_VERSION',v=>v===1||v===2),intentId:scalars.ID,projectId:scalars.Hash,taskId:scalars.ID,proposalRef:artifact,approvalRef:artifact,createdAt:scalars.Time,
},{authorizationKind:enumeration('DirectHumanApproval','PolicyDerivedAuthorization')});
export type CandidatePromotionIntent=Infer<typeof intent>;
const result=object('CandidatePromotionResult',{
  schemaVersion:literal(1),resultId:scalars.ID,projectId:scalars.Hash,taskId:scalars.ID,intentRef:artifact,targetRef:ref,
  previousHead:scalars.GitOID,resultingHead:scalars.GitOID,integrationCommit:scalars.GitOID,completedAt:scalars.Time,
});
export type CandidatePromotionResult=Infer<typeof result>;
const failure=object('PromotionObservation',{
  schemaVersion:literal(1),observationId:scalars.ID,projectId:scalars.Hash,taskId:scalars.ID,targetHead:scalars.GitOID,
  code:enumeration('MERGE_CONFLICT','INTEGRATION_VALIDATION_FAILED','INTEGRATION_REVIEW_FAILED','REJECTED'),evidenceRefs:list(artifact,0,64),createdAt:scalars.Time,
});
export type PromotionObservation=Infer<typeof failure>;
const index=object('PromotionIndex',{
  schemaVersion:literal(1),projectId:scalars.Hash,revision:integer(0,100000),bindings:list(artifact,0,4096),proposals:list(artifact,0,4096),
  intents:list(artifact,0,4096),results:list(artifact,0,4096),observations:list(artifact,0,4096),
});
export type PromotionIndex=Infer<typeof index>;
export function checkPromotion<T>(schema:Schema<T>,input:unknown,max=2*1024*1024):T{
  const value=copyJson(input),issues:Issue[]=[];if(byteLength(canonicalize(value))>max)promotionError('PROMOTION_RECORD_LIMIT');
  schema.check(value,'$',issues);if(issues.length)promotionError('PROMOTION_RECORD_INVALID');validatePlanningPortability(value);return freezeMemory(value as T);
}
export const validateGitBinding=(v:unknown)=>checkPromotion(binding,v);
export const validatePromotionProposal=(v:unknown)=>checkPromotion(proposal,v);
export const validatePromotionIntent=(v:unknown)=>{const i=checkPromotion(intent,v);if(i.schemaVersion===1&&i.authorizationKind!==undefined||i.schemaVersion===2&&i.authorizationKind===undefined)promotionError('PROMOTION_INTENT_AUTHORITY');return i;};
export const validatePromotionResult=(v:unknown)=>checkPromotion(result,v);
export const validatePromotionObservation=(v:unknown)=>checkPromotion(failure,v);
export const validatePromotionIndex=(v:unknown)=>checkPromotion(index,v);
export type IntegrationStatus='NOT_READY'|'LEGACY_CANDIDATE_NOT_AUTOPROMOTABLE'|'NOT_REQUIRED'|'READY_FOR_INTEGRATION'|'INTEGRATED'|'CONFLICT'|'STALE';
export function promotionNarrative(p:CandidatePromotionProposal):string{
  const kinds={A:"added",M:"modified",D:"removed",T:"type changed"};
  return `Task\n${p.title}\n\nDestination\n${p.targetRef.slice('refs/heads/'.length)}\n\nChanges\n${p.changedFiles.length?p.changedFiles.map(c=>`${c.path} · ${kinds[c.kind]}`).join('\n'):"No files change: integration connects the task's verified history to the target."}\n\nChecks\n✓ ${p.validationRefs.length} task checks on the integrated result\n✓ Independent review\n\nIf you approve, pi-controlled-dev will update the local branch and the original project folder with this exact result.\nReject preserves the candidate; Back leaves everything pending. Other tasks retain their own confirmations.\n\nTechnical details\nCurrent target: ${p.targetHead}\nCandidate: ${p.candidateCommit}\nIntegration: ${p.integrationCommit}\nTree: ${p.integrationTree}\nDigest: ${p.integrationDigest}`;
}
