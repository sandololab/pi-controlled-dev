/**
 * Bind registered role runtimes to the existing pi-subagents connection.
 * Dispatchers share the host session and resolved development profile, while
 * each role runner retains its own permission and terminal-evidence checks.
 * This adapter neither schedules work nor grants workflow transition authority.
 */
import type {AssignmentEnvelope,ValidationContext} from './contracts.js';
import {resolveDevelopmentProfile} from './development-profile.js';
import type {DevelopmentProfile} from './development-profile.js';
import {runScout} from './controlled-scout.js';
import type {ControlledRegistration,ScoutRun,ScoutRunOptions} from './controlled-scout.js';
import {runDeveloper} from './controlled-developer.js';
import type {ControlledDeveloperRegistration,DeveloperRun,DeveloperRunOptions} from './controlled-developer.js';
import {runReviewer} from './controlled-reviewer.js';
import type {ControlledReviewerRegistration,ReviewPacket,ReviewerRun,ReviewerRunOptions} from './controlled-reviewer.js';
import {runOracle} from './controlled-oracle.js';
import type {ControlledOracleRegistration,OracleEscalationPacket,OracleRun,OracleRunOptions} from './controlled-oracle.js';
import type {RpcEvents} from './pi-subagents-rpc.js';

export interface RoleDispatchers {
  readonly scout?: (assignment: AssignmentEnvelope, context: ValidationContext, options?: ScoutRunOptions) => Promise<ScoutRun>;
  readonly developer?: (assignment: AssignmentEnvelope, context: ValidationContext, options?: DeveloperRunOptions) => Promise<DeveloperRun>;
  readonly reviewer?: (assignment: AssignmentEnvelope, packet: ReviewPacket, context: ValidationContext, options?: ReviewerRunOptions) => Promise<ReviewerRun>;
  readonly oracle?: (assignment: AssignmentEnvelope, packet: OracleEscalationPacket, context: ValidationContext, options?: OracleRunOptions) => Promise<OracleRun>;
}
export interface RegisteredRuntimes {
  readonly developmentProfile?: DevelopmentProfile;
  readonly events: RpcEvents; readonly ownerSessionId: string;
  readonly scout: ControlledRegistration; readonly developer: ControlledDeveloperRegistration;
  readonly reviewer: ControlledReviewerRegistration; readonly oracle: ControlledOracleRegistration;
}
const terminalDispatchers=new WeakSet<object>();
/** Create the host-bound dispatcher set; keep native origin private by identity. */
export function registeredRoleDispatchers(runtime: RegisteredRuntimes): RoleDispatchers {
  const developmentProfile=resolveDevelopmentProfile(runtime.developmentProfile);
  const dispatchers=Object.freeze({
    scout: (assignment: AssignmentEnvelope, validationContext: ValidationContext, options?: ScoutRunOptions) =>
      runScout(assignment,{registration:runtime.scout,events:runtime.events,ownerSessionId:runtime.ownerSessionId,validationContext,options,developmentProfile}),
    developer: (assignment: AssignmentEnvelope, validationContext: ValidationContext, options?: DeveloperRunOptions) =>
      runDeveloper(assignment,{registration:runtime.developer,events:runtime.events,ownerSessionId:runtime.ownerSessionId,validationContext,options,developmentProfile}),
    reviewer: (assignment: AssignmentEnvelope, packet: ReviewPacket, validationContext: ValidationContext, options?: ReviewerRunOptions) =>
      runReviewer(assignment,packet,{registration:runtime.reviewer,events:runtime.events,ownerSessionId:runtime.ownerSessionId,validationContext,options,developmentProfile}),
    oracle: (assignment: AssignmentEnvelope, packet: OracleEscalationPacket, validationContext: ValidationContext, options?: OracleRunOptions) =>
      runOracle(assignment,packet,{registration:runtime.oracle,events:runtime.events,ownerSessionId:runtime.ownerSessionId,validationContext,options,developmentProfile}),
  });
  terminalDispatchers.add(dispatchers);return dispatchers;
}

/** Factory-origin check only; it does not replace proof for an individual run. */
export function isRegisteredRoleDispatchers(value:object):boolean{return terminalDispatchers.has(value)}
