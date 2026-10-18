import { canonicalize } from './contract-json.js';
import type { ArtifactRef, WorkflowState } from './contracts.js';
import type { BoundedDeveloperCheckpointDescriptor } from './bounded-developer-checkpoint.js';

interface RuntimeRootBindingPayloadBase {
 readonly projectId:string;readonly taskId:string;readonly specHash:string;
 readonly sourceRevision:number;readonly sourceEventHash:string;readonly sourceStateDigest:string;
 readonly projectOriginalRepoRoot:string;readonly historicalRepoRoot:string;readonly previousRepoRoot:string;readonly repoRoot:string;
 readonly previousCandidateRoot:string|null;readonly candidateRoot:string|null;
 readonly candidateDigest:string|null;readonly candidateGeneration:number|null;
 readonly sourceHead:string;readonly sourceTree:string;readonly sourceInventoryDigest:string;readonly humanDigest:string;readonly handoffDigest:string;
 readonly resumeState:WorkflowState['state'];
}
export interface RuntimeBoundedBaseline {
 readonly descriptor:BoundedDeveloperCheckpointDescriptor;readonly descriptorRelativePath:string;
 readonly transcriptRelativePath:string;readonly workRoot:string;
}
export type RuntimeRootBindingPayload=RuntimeRootBindingPayloadBase & (
 {readonly schemaVersion:1;readonly boundedBaseline?:never} |
 {readonly schemaVersion:2;readonly boundedBaseline:RuntimeBoundedBaseline}
);
export interface RuntimeRootBinding {
 readonly schemaVersion:1;readonly id:string;readonly payload:RuntimeRootBindingPayload;
 readonly confirmationRef:ArtifactRef;readonly handoffRef:ArtifactRef;
 readonly boundedBaselineRef?:ArtifactRef;readonly boundedTranscriptRef?:ArtifactRef;
}
export interface RuntimeRootMapping {readonly refId:string;readonly payload:RuntimeRootBindingPayload}
const mappings=new WeakSet<object>();
function fail():never{throw new Error('PROJECT_RUNTIME_BINDING_INVALID')}

export function runtimeRootMappingFor(state:WorkflowState,available:readonly RuntimeRootMapping[]|undefined):RuntimeRootMapping|undefined{
 if(!state.runtimeBindingRef)return undefined;
 const m=available?.find(m=>mappings.has(m)&&m.refId===state.runtimeBindingRef?.id&&m.payload.taskId===state.taskId&&m.payload.specHash===state.specHash&&m.payload.repoRoot===state.repoRoot);
 if(!m)fail();return m;
}
export function runtimeRootMatches(historical:string,physical:string,state:WorkflowState|undefined,available:readonly RuntimeRootMapping[]|undefined):boolean{
 if(historical===physical)return true;if(!state)return false;
 try{const m=runtimeRootMappingFor(state,available);return !!m&&m.payload.historicalRepoRoot===historical&&m.payload.repoRoot===physical}catch{return false}
}

function immutablePayload(p:RuntimeRootBindingPayload):RuntimeRootBindingPayload{
 const copy=JSON.parse(canonicalize(p));
 const freeze=(v:any):any=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v)}return v};
 return freeze(copy);
}
/** @internal Called only after the host verifier checks the complete retained chain.
 * A JSON projection never acquires this process-local identity. No runtime or
 * filesystem dependency is needed by contract validation to inspect it. */
export function recordVerifiedRuntimeRootMapping(refId:string,payload:RuntimeRootBindingPayload):RuntimeRootMapping{
 const mapping=Object.freeze({refId,payload:immutablePayload(payload)});mappings.add(mapping);return mapping;
}
