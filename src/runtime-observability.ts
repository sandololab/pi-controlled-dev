import { Buffer, isUtf8 } from 'node:buffer';
import { canonicalize } from './contracts.js';

/** Child processes may emit these lines on stdout/stderr. The host extracts them
 * into a separate, bounded JSONL artifact; ordinary test output is not an event. */
export const RUNTIME_EVENT_PREFIX = 'CONTROLLED_RUNTIME_EVENT ';
export const RUNTIME_EVENT_SCHEMA = 'controlled.runtime-event.v1';
export const RUNTIME_LIMITS = Object.freeze({ bytes: 32 * 1024, events: 32, eventBytes: 2048 });
type Scalar = string | number | boolean | null;
export interface RuntimeEvent {
  readonly schemaVersion: typeof RUNTIME_EVENT_SCHEMA;
  readonly timestamp: string; readonly source: string; readonly eventType: string;
  readonly severity: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'; readonly correlationId: string;
  readonly message?: string; readonly data?: Readonly<Record<string, Scalar>>;
  readonly metrics?: Readonly<Record<string, number>>;
}
export interface RuntimeDiagnosis {
  readonly observed: readonly string[]; readonly inferred: readonly string[]; readonly unknown: readonly string[];
}
export interface RuntimeEvidence {
  readonly schemaVersion: 1; readonly id: string; readonly taskId: string;
  readonly validationId: string; readonly scenarioId: string; readonly commandHash: string; readonly candidateDigest: string;
  readonly candidateGeneration: number; readonly startedAt: string; readonly endedAt: string;
  readonly exitCode: number | null; readonly status: 'PASSED' | 'FAILED' | 'TIMED_OUT' | 'INVALID';
  readonly complete: boolean; readonly eventCount: number; readonly eventLogRef: string;
  readonly redactions: number; readonly summary: string; readonly importantObservations: readonly string[];
  readonly metrics: Readonly<Record<string,number>>; readonly diagnosis: RuntimeDiagnosis;
}
export interface RuntimeComparison {
  readonly schemaVersion: 1; readonly scenarioId: string; readonly commandHash: string;
  readonly before: {readonly evidenceId: string; readonly validationId: string; readonly eventLogRef: string;
    readonly generation: number; readonly status: RuntimeEvidence['status']; readonly diagnosis: RuntimeDiagnosis;
    readonly events: readonly RuntimeEvent[]};
  readonly after: {readonly evidenceId: string; readonly validationId: string; readonly eventLogRef: string;
    readonly generation: number; readonly status: RuntimeEvidence['status']; readonly diagnosis: RuntimeDiagnosis;
    readonly events: readonly RuntimeEvent[]};
  readonly eventTypeChanges: readonly string[]; readonly metricChanges: readonly string[];
  readonly residualAnomalies: readonly string[]; readonly conclusion: 'RESOLVED' | 'PERSISTS' | 'UNKNOWN';
}
export class RuntimeEvidenceError extends Error { constructor(readonly code:string){super(code)} }
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const key=/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const sensitiveKey=/(?:api[_-]?key|auth(?:orization)?|password|secret|token|credential|private[_-]?key|cookie)/i;
const secretPatterns=[/\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{8,})\b/gi,
  /\b((?:api[_-]?key|password|secret|token|credential)\s*[:=]\s*)[^\s,;]+/gi,
  /SYNTHETIC_SECRET/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g];
export function redactRuntimeText(value:string):{text:string;redactions:number}{
  let text=value,redactions=0;
  for(const pattern of secretPatterns)text=text.replace(pattern,(_match,prefix?:string)=>{redactions++;return typeof prefix==='string'?`${prefix}[REDACTED]`:'[REDACTED]'});
  // Test runners often print structured events as JSON. Redact the raw log too,
  // before it is stored, rather than relying only on the parsed event artifact.
  text=text.replace(/("(?:api[_-]?key|auth(?:orization)?|password|secret|token|credential|private[_-]?key|cookie)"\s*:\s*")((?:\\.|[^"\\])*)(")/gi,
    (_match,prefix:string,_value:string,suffix:string)=>{redactions++;return `${prefix}[REDACTED]${suffix}`});
  return {text,redactions};
}
function safeScalar(value:unknown,field:string):Scalar{
  if(typeof value==='string'){
    if(value.length>256)throw new RuntimeEvidenceError('RUNTIME_FIELD_LIMIT');
    return sensitiveKey.test(field)?'[REDACTED]':redactRuntimeText(value).text;
  }
  if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return sensitiveKey.test(field)?'[REDACTED]':value;
  throw new RuntimeEvidenceError('RUNTIME_FIELD_INVALID');
}
function safeMap(value:unknown,metrics=false):Readonly<Record<string,Scalar>>|undefined{
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>8)throw new RuntimeEvidenceError('RUNTIME_FIELD_INVALID');
  const result:Record<string,Scalar>={};
  for(const [name,item] of Object.entries(value)){
    if(!key.test(name))throw new RuntimeEvidenceError('RUNTIME_FIELD_INVALID');
    if(metrics&&(typeof item!=='number'||!Number.isFinite(item)||sensitiveKey.test(name)))throw new RuntimeEvidenceError('RUNTIME_METRIC_INVALID');
    result[name]=safeScalar(item,name);
  }
  return result;
}
function event(value:unknown):RuntimeEvent{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new RuntimeEvidenceError('RUNTIME_EVENT_INVALID');
  const row=value as Record<string,unknown>;
  const allowed=['schemaVersion','timestamp','source','eventType','severity','correlationId','message','data','metrics'];
  if(Object.keys(row).some(name=>!allowed.includes(name))||row.schemaVersion!==RUNTIME_EVENT_SCHEMA
    ||typeof row.timestamp!=='string'||!Number.isFinite(Date.parse(row.timestamp))||new Date(row.timestamp).toISOString()!==row.timestamp
    ||typeof row.source!=='string'||!id.test(row.source)||typeof row.eventType!=='string'||!id.test(row.eventType)
    ||!['DEBUG','INFO','WARN','ERROR'].includes(String(row.severity))||typeof row.correlationId!=='string'||!id.test(row.correlationId))
    throw new RuntimeEvidenceError('RUNTIME_EVENT_INVALID');
  if(row.message!==undefined&&typeof row.message!=='string')throw new RuntimeEvidenceError('RUNTIME_EVENT_INVALID');
  const clean:RuntimeEvent={schemaVersion:RUNTIME_EVENT_SCHEMA,timestamp:row.timestamp,source:row.source,eventType:row.eventType,
    severity:row.severity as RuntimeEvent['severity'],correlationId:row.correlationId,
    ...(row.message!==undefined?{message:safeScalar(row.message,'message') as string}:{}),
    ...(row.data!==undefined?{data:safeMap(row.data)}:{}),
    ...(row.metrics!==undefined?{metrics:safeMap(row.metrics,true) as Record<string,number>}:{})};
  if(Buffer.byteLength(canonicalize(clean),'utf8')>RUNTIME_LIMITS.eventBytes)throw new RuntimeEvidenceError('RUNTIME_EVENT_LIMIT');
  return clean;
}
/** A missing final newline is incomplete evidence, never an implicit PASS. */
export function parseRuntimeJsonl(input:string|Uint8Array):readonly RuntimeEvent[]{
  const bytes=typeof input==='string'?Buffer.from(input):Buffer.from(input);
  if(bytes.byteLength>RUNTIME_LIMITS.bytes)throw new RuntimeEvidenceError('RUNTIME_LOG_LIMIT');
  if(!bytes.byteLength||bytes.at(-1)!==10)throw new RuntimeEvidenceError('RUNTIME_LOG_INCOMPLETE');
  if(!isUtf8(bytes))throw new RuntimeEvidenceError('RUNTIME_UTF8_INVALID');
  const decoded=bytes.toString('utf8');
  const lines=decoded.slice(0,-1).split('\n');
  if(lines.length>RUNTIME_LIMITS.events)throw new RuntimeEvidenceError('RUNTIME_EVENT_COUNT_LIMIT');
  return Object.freeze(lines.map(line=>{
    if(!line||Buffer.byteLength(line,'utf8')>RUNTIME_LIMITS.eventBytes)throw new RuntimeEvidenceError('RUNTIME_EVENT_LIMIT');
    let parsed:unknown;try{parsed=JSON.parse(line)}catch{throw new RuntimeEvidenceError('RUNTIME_JSONL_INVALID')}
    return Object.freeze(event(parsed));
  }));
}
export function extractRuntimeEvents(stdout:string,stderr:string):{events:readonly RuntimeEvent[];redactions:number}{
  for(const output of [stdout,stderr])if(output.includes(RUNTIME_EVENT_PREFIX)&&!output.endsWith('\n')
    &&output.split('\n').at(-1)?.startsWith(RUNTIME_EVENT_PREFIX))throw new RuntimeEvidenceError('RUNTIME_LOG_INCOMPLETE');
  const lines=[...stdout.split('\n'),...stderr.split('\n')].filter(line=>line.startsWith(RUNTIME_EVENT_PREFIX));
  if(lines.length>RUNTIME_LIMITS.events-2)throw new RuntimeEvidenceError('RUNTIME_EVENT_COUNT_LIMIT');
  const raw=lines.map(line=>line.slice(RUNTIME_EVENT_PREFIX.length)).join('\n')+(lines.length?'\n':'');
  if(!raw)return {events:[],redactions:0};
  if(Buffer.byteLength(raw,'utf8')>RUNTIME_LIMITS.bytes-2048)throw new RuntimeEvidenceError('RUNTIME_LOG_LIMIT');
  const parsed=parseRuntimeJsonl(raw),redactions=lines.filter(line=>redactRuntimeText(line).redactions>0).length
    +lines.filter(line=>sensitiveKey.test(line)).length;
  if(parsed.some(row=>row.source==='validation-runner'||row.eventType.startsWith('validation.')))
    throw new RuntimeEvidenceError('RUNTIME_HOST_EVENT_SPOOF');
  return {events:parsed,redactions};
}
export function runtimeDiagnosis(status:RuntimeEvidence['status'],events:readonly RuntimeEvent[],complete:boolean):RuntimeDiagnosis{
  const errors=events.filter(row=>row.severity==='ERROR').slice(0,4);
  const observed=[`Process: ${status}.`,...errors.map(row=>`${row.source}: ${row.eventType}${row.message?` — ${row.message}`:''}`)];
  const inferred=status==='FAILED'&&errors.length?[`Likely failure area: ${errors[0].source}; check the code and repeat the same scenario.`]:[];
  const unknown=complete?status==='FAILED'&&!errors.length?["The process failed, but events do not identify the cause."]:[]
    :["Incomplete evidence: neither a cause nor a successful outcome can be established."];
  return {observed,inferred,unknown};
}
export function compareRuntimeEvidence(before:RuntimeEvidence,beforeEvents:readonly RuntimeEvent[],after:RuntimeEvidence,afterEvents:readonly RuntimeEvent[]):RuntimeComparison{
  if(before.scenarioId!==after.scenarioId||before.commandHash!==after.commandHash||before.taskId!==after.taskId
    ||before.candidateGeneration>=after.candidateGeneration)throw new RuntimeEvidenceError('RUNTIME_SCENARIO_MISMATCH');
  const counts=(rows:readonly RuntimeEvent[])=>{const map=new Map<string,number>();for(const row of rows)map.set(row.eventType,(map.get(row.eventType)??0)+1);return map};
  const oldCounts=counts(beforeEvents),newCounts=counts(afterEvents);
  const eventTypeChanges=[...new Set([...oldCounts.keys(),...newCounts.keys()])].sort().filter(name=>oldCounts.get(name)!==newCounts.get(name))
    .map(name=>`${name}: ${oldCounts.get(name)??0} → ${newCounts.get(name)??0}`);
  const lastMetrics=(rows:readonly RuntimeEvent[])=>{const map=new Map<string,number>();for(const row of rows)for(const [name,value] of Object.entries(row.metrics??{}))map.set(name,value);return map};
  const oldMetrics=lastMetrics(beforeEvents),newMetrics=lastMetrics(afterEvents);
  const metricChanges=[...new Set([...oldMetrics.keys(),...newMetrics.keys()])].sort().filter(name=>oldMetrics.get(name)!==newMetrics.get(name))
    .map(name=>`${name}: ${oldMetrics.get(name)??'n/d'} → ${newMetrics.get(name)??'n/d'}`);
  const complete=before.complete&&after.complete;
  const conclusion:RuntimeComparison['conclusion']=!complete?'UNKNOWN':before.status==='FAILED'&&after.status==='PASSED'?'RESOLVED':'PERSISTS';
  return {schemaVersion:1,scenarioId:before.scenarioId,commandHash:before.commandHash,
    before:{evidenceId:before.id,validationId:before.validationId,eventLogRef:before.eventLogRef,
      generation:before.candidateGeneration,status:before.status,diagnosis:before.diagnosis,events:beforeEvents},
    after:{evidenceId:after.id,validationId:after.validationId,eventLogRef:after.eventLogRef,
      generation:after.candidateGeneration,status:after.status,diagnosis:after.diagnosis,events:afterEvents},
    eventTypeChanges,metricChanges,residualAnomalies:afterEvents.filter(row=>row.severity==='ERROR'||row.severity==='WARN').map(row=>`${row.source}: ${row.eventType}`).slice(0,8),conclusion};
}
export function temporaryInstrumentationResidue(patch:string):readonly string[]{
  let parsed:unknown;try{parsed=JSON.parse(patch)}catch{return ["Unreadable patch: temporary traces cannot be ruled out."]}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return ["Invalid patch: temporary traces cannot be ruled out."];
  const value=parsed as {schemaVersion?:unknown;operations?:unknown};
  if(value.schemaVersion!==1||!Array.isArray(value.operations)||value.operations.length>100_000)
    return ["Invalid patch: temporary traces cannot be ruled out."];
  const marker=[...Buffer.from('CONTROLLED_DEV_TEMP_TRACE','utf8')].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  const found:string[]=[];
  for(const raw of value.operations){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return ["Invalid patch: temporary traces cannot be ruled out."];
    const op=raw as {op?:unknown;path?:unknown;hex?:unknown};
    if(typeof op.path!=='string'||(op.op!=='write'&&op.op!=='delete')||op.op==='write'&&typeof op.hex!=='string')
      return ["Invalid patch: temporary traces cannot be ruled out."];
    if(op.op==='write'&&(op.hex as string).toLowerCase().includes(marker))found.push(`Temporary trace in ${redactRuntimeText(op.path).text.slice(0,128)}`);
  }
  return Object.freeze(found.slice(0,16));
}
