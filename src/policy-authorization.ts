import { canonicalize, hashCanonical, parseJson } from './contract-json.js';
import type { Json } from './contract-json.js';
import { validateScalar,validateStructure } from './contracts.js';
import type { ArtifactRef } from './contracts.js';
import { freezeMemory } from './project-memory.js';
import { readTrustedConfirmationEvidence } from './trusted-confirmation.js';

export const POLICY_AUTHORIZATION_MEDIA='application/vnd.pi-controlled-dev.policy-authorization+json';
export interface PolicyDerivedAuthorization {
  readonly schemaVersion:1; readonly kind:'PolicyDerivedAuthorization'; readonly authorizationId:string;
  readonly policyRef:ArtifactRef; readonly policyRevision:number; readonly policyDigest:string;
  readonly policyApprovalRef:ArtifactRef;readonly planApprovalRef:ArtifactRef;readonly resultingArtifactRefs:readonly ArtifactRef[]; readonly plan:{readonly planId:string;readonly revision:number;readonly digest:string};
  readonly runId:string; readonly actionKind:string; readonly subject:Json; readonly subjectDigest:string;
  readonly checks:readonly {readonly name:string;readonly passed:boolean}[];
  readonly decision:'ALLOWED'; readonly reason:string; readonly createdAt:string;
}
export interface PolicyAuthorizationCapability {readonly ref:ArtifactRef;readonly authorization:PolicyDerivedAuthorization}
interface Reader {read(ref:ArtifactRef):Uint8Array}
const capabilities=new WeakMap<object,{readCurrent:()=>void;reader:Reader;consumed:boolean}>();
/** Trusted host seam, never a model tool. A copied JSON capability is inert. */
export function issuePolicyCapability(reader:Reader,ref:ArtifactRef,readCurrent:()=>void):PolicyAuthorizationCapability {
  readCurrent();const authorization=readPolicyAuthorization(reader,ref);
  const capability=Object.freeze({ref,authorization});capabilities.set(capability,{reader,readCurrent,consumed:false});return capability;
}
export function assertPolicyCapabilityCurrent(capability:PolicyAuthorizationCapability):void{const held=capabilities.get(capability);if(!held)throw new Error('POLICY_CAPABILITY_INVALID');held.readCurrent();}
export function consumePolicyCapability(capability:PolicyAuthorizationCapability,action:string,subject:unknown,target:{import(ref:ArtifactRef,bytes:Uint8Array):unknown}):ArtifactRef {
  const held=capabilities.get(capability);if(!held||held.consumed)throw new Error('POLICY_CAPABILITY_INVALID');
  held.consumed=true;held.readCurrent();readPolicyAuthorization(held.reader,capability.ref,action,subject);
  // Preserve the exact policy and genuine approval as an independently verifiable evidence closure.
  for(const ref of [capability.authorization.policyRef,capability.authorization.policyApprovalRef,capability.authorization.planApprovalRef,capability.ref])target.import(ref,held.reader.read(ref));
  held.readCurrent();return capability.ref;
}
export function readPolicyAuthorization(reader:Reader,ref:ArtifactRef,action?:string,subject?:unknown):PolicyDerivedAuthorization {
  if(ref.mediaType!==POLICY_AUTHORIZATION_MEDIA||ref.bytes>512*1024)throw new Error('POLICY_AUTHORIZATION_INVALID');
  const a=parseJson(reader.read(ref),512*1024) as unknown as PolicyDerivedAuthorization;
  const keys='actionKind,authorizationId,checks,createdAt,decision,kind,plan,planApprovalRef,policyApprovalRef,policyDigest,policyRef,policyRevision,reason,resultingArtifactRefs,runId,schemaVersion,subject,subjectDigest';
  if(Object.keys(a).sort().join(',')!==keys||hashCanonical(a)!==ref.digest||a.schemaVersion!==1||a.kind!=='PolicyDerivedAuthorization'||a.decision!=='ALLOWED'
    ||!validateScalar('ID',a.authorizationId).ok||!validateScalar('ID',a.runId).ok||!validateScalar('Time',a.createdAt).ok||!validateStructure('ArtifactRef',a.policyRef).ok||!validateStructure('ArtifactRef',a.policyApprovalRef).ok||!validateStructure('ArtifactRef',a.planApprovalRef).ok||!Array.isArray(a.resultingArtifactRefs)||a.resultingArtifactRefs.some(r=>!validateStructure('ArtifactRef',r).ok)||!validateScalar('Hash',a.policyDigest).ok||!Number.isSafeInteger(a.policyRevision)||a.policyRevision<1
    ||Object.keys(a.plan).sort().join(',')!=='digest,planId,revision'||!validateScalar('ID',a.plan.planId).ok||!validateScalar('Hash',a.plan.digest).ok||!Number.isSafeInteger(a.plan.revision)||a.plan.revision<1||typeof a.actionKind!=='string'||typeof a.reason!=='string'||a.reason.length>8192||a.resultingArtifactRefs.length>64
    ||!Array.isArray(a.checks)||!a.checks.length||a.checks.length>64||new Set(a.checks.map(c=>c.name)).size!==a.checks.length||a.checks.some(c=>Object.keys(c).sort().join(',')!=='name,passed'||!c.name||c.passed!==true)
    ||a.subjectDigest!==hashCanonical(a.subject)||!a.reason||!a.runId||action!==undefined&&a.actionKind!==action
    ||subject!==undefined&&canonicalize(a.subject)!==canonicalize(subject))throw new Error('POLICY_AUTHORIZATION_INVALID');
  const policy=parseJson(reader.read(a.policyRef),512*1024) as any;
  const {contentDigest,...body}=policy;
  if(hashCanonical(policy)!==a.policyRef.digest||hashCanonical(body)!==contentDigest||contentDigest!==a.policyDigest||policy.revision!==a.policyRevision
    ||canonicalize(policy.plan)!==canonicalize(a.plan)||!policy.actions.includes(a.actionKind))throw new Error('POLICY_AUTHORIZATION_BINDING');
  const raw=parseJson(reader.read(a.policyApprovalRef),135168) as any;
  const proof=readTrustedConfirmationEvidence(reader,a.policyApprovalRef,raw.request);
  if(proof.receipt.decision!=='APPROVE'||proof.request.purpose!=='project-autonomy-policy-approval'||proof.request.action!=='APPROVE'||proof.request.subjectId!==policy.policyId
    ||proof.request.subjectRevision!==policy.revision||canonicalize(proof.request.payload)!==canonicalize({policyRef:a.policyRef,policy}))throw new Error('POLICY_APPROVAL_BINDING');
  const planRaw=parseJson(reader.read(a.planApprovalRef),135168) as any,planProof=readTrustedConfirmationEvidence(reader,a.planApprovalRef,planRaw.request),plan=(planProof.request.payload as any).plan;
  if(planProof.request.purpose!=='project-plan-approval'||planProof.receipt.decision!=='APPROVE'||planProof.request.subjectId!==a.plan.planId||planProof.request.subjectRevision!==a.plan.revision||plan?.contentDigest!==a.plan.digest)throw new Error('POLICY_PLAN_APPROVAL_BINDING');
  return freezeMemory(a);
}
