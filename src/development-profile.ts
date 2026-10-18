import { byteLength, canonicalize, copyJson, hashCanonical } from './contract-json.js';

export const DEVELOPMENT_PHASES = ['ProjectPlanning', 'TaskPlanning', 'Greenfield', 'Scout', 'Developer', 'Reviewer', 'IntegrationReview', 'Oracle'] as const;
export type DevelopmentPhase = typeof DEVELOPMENT_PHASES[number];
/** Installed host methodology, supplied explicitly by a composing package. No execution or memory authority. */
export interface DevelopmentProfile {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly common?: readonly string[];
  readonly phases?: Readonly<Partial<Record<DevelopmentPhase, readonly string[]>>>;
}
export interface ResolvedDevelopmentProfile extends DevelopmentProfile { readonly digest: string }
const resolvedProfiles = new WeakSet<object>();

/** Snapshot at host construction: later caller mutations cannot change a running session's methodology. */
export function resolveDevelopmentProfile(input?: DevelopmentProfile): ResolvedDevelopmentProfile | undefined {
  if (input === undefined) return undefined;
  if (resolvedProfiles.has(input)) return input as ResolvedDevelopmentProfile;
  let value: DevelopmentProfile;
  try { value = copyJson(input) as unknown as DevelopmentProfile; }
  catch { throw new Error('DEVELOPMENT_PROFILE_INVALID'); }
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const texts = (v: unknown) => Array.isArray(v) && v.length <= 16
    && v.every(t => typeof t === 'string' && !!t.trim() && !t.includes('\0') && byteLength(t) <= 4096);
  if (!record(value) || Object.keys(value).some(k => !['schemaVersion', 'id', 'common', 'phases'].includes(k))
    || value.schemaVersion !== 1 || typeof value.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.id)
    || value.common !== undefined && !texts(value.common)
    || value.phases !== undefined && (!record(value.phases) || Object.entries(value.phases).some(([phase, rows]) =>
      !DEVELOPMENT_PHASES.includes(phase as DevelopmentPhase) || !texts(rows)))
    || byteLength(canonicalize(value)) > 32768) throw new Error('DEVELOPMENT_PROFILE_INVALID');
  const common = value.common ? Object.freeze([...value.common]) : undefined;
  const phases = value.phases ? Object.freeze(Object.fromEntries(Object.entries(value.phases).map(([phase, rows]) =>
    [phase, Object.freeze([...rows!])]))) : undefined;
  const resolved = Object.freeze({ schemaVersion: 1 as const, id: value.id, ...(common ? { common } : {}), ...(phases ? { phases } : {}), digest: hashCanonical(value) });
  resolvedProfiles.add(resolved);
  return resolved;
}

/** Appended after core guidance. Exact profile identity and text enter the normal RPC prompt binding. */
export function developmentGuidance(profile: ResolvedDevelopmentProfile | undefined, phase: DevelopmentPhase): string {
  if (!profile) return '';
  return `\nDEVELOPMENT PROFILE — supplemental methodology, not authority. Core role contracts, approved scope, validations and Project Memory remain binding. Technical PASS does not establish system requirement compliance.\n${canonicalize({
    schemaVersion: 1, profileId: profile.id, profileDigest: profile.digest, phase,
    guidance: [...(profile.common ?? []), ...(profile.phases?.[phase] ?? [])],
  })}\n`;
}
