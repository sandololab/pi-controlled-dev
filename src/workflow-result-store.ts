/**
 * Publish candidate bytes already captured and bound by ScopeGuard.
 * Storage failure is distinct from an agent failure: the coordinator may retry
 * this publication from the retained capture without starting another Developer.
 * Partial writes do not themselves admit a result or advance workflow state.
 */
import { canonicalize } from './contracts.js';
import type { ScopeCapture } from './scope-guard.js';
import type { DurableStore } from './store.js';

export class WorkflowResultSaveError extends Error {
  readonly code = 'PROJECT_RESULT_SAVE_FAILED';
  readonly diagnostic = Object.freeze({ phase: 'RESULT_SAVE', path: 'candidate.artifacts' });

  constructor(readonly cause: unknown) {
    super('PROJECT_RESULT_SAVE_FAILED');
  }
}
/**
 * Save the captured manifest, patch, handoff and terminal proof without recapture.
 * Every saved reference must match the captured digest and byte count.
 * @throws WorkflowResultSaveError on publication failure or a reference mismatch.
 */
export function saveCandidateArtifacts(store: DurableStore, capture: ScopeCapture, terminalEvidence: string): ScopeCapture {
  try {
    const capturedCandidate = capture.candidate;
    const manifest = store.put(capturedCandidate.manifest.id, canonicalize(capture.manifest), capturedCandidate.manifest.mediaType);
    const patch = store.put(capturedCandidate.patch.id, capture.patch, capturedCandidate.patch.mediaType);
    const handoff = store.put(capturedCandidate.handoff.id, capture.handoff, capturedCandidate.handoff.mediaType);
    const terminalProof = store.put(capturedCandidate.terminalProof.id, terminalEvidence, capturedCandidate.terminalProof.mediaType);

    for (const [capturedArtifact, savedArtifact] of [
      [capturedCandidate.manifest, manifest],
      [capturedCandidate.patch, patch],
      [capturedCandidate.handoff, handoff],
      [capturedCandidate.terminalProof, terminalProof],
    ]) {
      if (capturedArtifact.digest !== savedArtifact.digest || capturedArtifact.bytes !== savedArtifact.bytes) {
        throw new Error('CANDIDATE_ARTIFACT_MISMATCH');
      }
    }
    return {
      ...capture,
      candidate: { ...capturedCandidate, manifest, patch, handoff, terminalProof },
      artifacts: [manifest, patch, handoff, terminalProof],
    };
  } catch (error) {
    throw new WorkflowResultSaveError(error);
  }
}
