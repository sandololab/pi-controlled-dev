import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { Buffer } from 'node:buffer';
import type { RpcEvents } from './pi-subagents-rpc.js';
import { projectProtectedFolderCanaries } from './project-storage.js';

export const RUNTIME_AGENT_REGISTER_EVENT = 'pi-subagents:runtime-agent-register:v1';
/** Per-operation deadline, independent of productive task/rework totals. */
export const DEFAULT_CONTROLLED_ROLE_TIMEOUT_MS = 600000;

interface RuntimeRegistration { dispose(): void }
export interface RuntimeAgentRegistration<Name extends string = string, Definition extends object = object> {
  readonly name: Name; readonly definition: Definition; readonly runtimeGeneration: string;
  active(): boolean; dispose(): void;
}

export function registerRuntimeAgent<Name extends string, Definition extends object>(
  pi: { events: RpcEvents }, name: Name, definition: Definition, runtimeGeneration = randomUUID(),
): RuntimeAgentRegistration<Name, Definition> | undefined {
  const request: { version: 1; name: string; definition: Definition; result?: unknown } = { version: 1, name, definition };
  pi.events.emit(RUNTIME_AGENT_REGISTER_EVENT, request);
  const result = request.result as { ok?: unknown; registration?: RuntimeRegistration; error?: unknown } | undefined;
  if (result === undefined) return undefined;
  if (!result || result.ok !== true || !result.registration || typeof result.registration.dispose !== 'function')
    throw result && result.ok === false && result.error instanceof Error ? result.error : new Error('INVALID_RUNTIME_REGISTRATION_REPLY');
  let live = true;
  return Object.freeze({ name, definition, runtimeGeneration, active: () => live,
    dispose: () => { if (live) { live = false; result.registration!.dispose(); } } });
}

export class ControlledRuntimeError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function verifyExtensions(value: { readonly [key: string]: unknown }): void {
  if (value.version !== 1 || value.source !== 'launch-resolved' || value.disableAmbientExtensions !== true
    || !Array.isArray(value.configured) || value.configured.length || !Array.isArray(value.required) || value.required.length
    || !Array.isArray(value.runtime) || value.runtime.length !== 1 || !Array.isArray(value.effective)
    || value.effective.length !== 1 || value.runtime[0] !== value.effective[0] || typeof value.runtime[0] !== 'string')
    throw new ControlledRuntimeError('UNEXPECTED_EXTENSIONS');
}

export function verifyTranscript(sessionPath: string, cwd: string, agent: string, expectedTools: readonly string[],
  allowedInvocations: readonly string[], historyCanary?: string, historyCanaryMode: 'absent' | 'present' = 'absent'):
  { effectiveTools: readonly string[]; invokedTools: readonly string[] } {
  const bytes = readFileSync(sessionPath);
  return verifyTranscriptBytes(bytes,cwd,agent,expectedTools,allowedInvocations,historyCanary,historyCanaryMode);
}
/** Same verifier for immutable terminal evidence already acquired by the host store.
 * Historical cwd and agent identity stay exact; bytes grant no runtime authority. */
export function verifyTranscriptBytes(bytes:Uint8Array,cwd:string,agent:string,expectedTools:readonly string[],
  allowedInvocations:readonly string[],historyCanary?:string,historyCanaryMode:'absent'|'present'='absent'):
  {effectiveTools:readonly string[];invokedTools:readonly string[]} {
  if (bytes.byteLength > 16 * 1024 * 1024) throw new ControlledRuntimeError('RUNTIME_EVIDENCE_LIMIT');
  const raw = Buffer.from(bytes).toString('utf8');
  if (historyCanary && (raw.includes(historyCanary) !== (historyCanaryMode === 'present')))
    throw new ControlledRuntimeError(historyCanaryMode === 'present' ? 'FORK_HISTORY_MISSING' : 'HISTORY_CANARY_LEAKED');
  const lines = raw.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
  const header = lines[0];
  if (!header || header.type !== 'session' || header.cwd !== cwd) throw new ControlledRuntimeError('RUNTIME_IDENTITY_MISMATCH');
  const system = lines.find(line => line.type === 'message' && record(line.message) && line.message.role === 'system');
  if (!system || !record(system.message) || !record(system.message.sections)
    || typeof system.message.sections.preamble !== 'string' || !system.message.sections.preamble.includes(`<active_agent name="${agent}"/>`)
    || !Array.isArray(system.message.toolsAdded)) throw new ControlledRuntimeError('RUNTIME_IDENTITY_MISMATCH');
  const preamble = system.message.sections.preamble;
  if (preamble.includes('Intercom orchestration channel:') || /\bUse contact_supervisor first\b/.test(preamble))
    throw new ControlledRuntimeError('UNEXPECTED_SUPERVISOR_PROMPT');
  const effectiveTools = system.message.toolsAdded.map(tool => record(tool) && typeof tool.name === 'string' ? tool.name : '');
  if (effectiveTools.some(name => !name) || [...effectiveTools].sort().join(',') !== [...expectedTools].sort().join(','))
    throw new ControlledRuntimeError('UNEXPECTED_EFFECTIVE_TOOLS');
  const invokedTools: string[] = [];
  for (const line of lines) if (line.type === 'message' && record(line.message) && line.message.role==='assistant' && Array.isArray(line.message.content))
    for (const part of line.message.content) if (record(part) && part.type === 'toolCall' && typeof part.name === 'string') {
      invokedTools.push(part.name);
      if(['write','edit'].includes(part.name)&&record(part.arguments)&&typeof part.arguments.path==='string'
        &&protectedMutationPath(cwd,part.arguments.path))throw new ControlledRuntimeError('PROTECTED_PROJECT_STATE_WRITE');
    }
  if (invokedTools.some(name => !allowedInvocations.includes(name))) throw new ControlledRuntimeError('UNEXPECTED_TOOL_USE');
  return { effectiveTools: Object.freeze(effectiveTools), invokedTools: Object.freeze(invokedTools) };
}

/** Mutable host custody bytes are excluded from source canaries, so the
 * actual assistant mutation calls also have an explicit reserved-namespace guard.
 * Tool-result text is untrusted data and never treated as an invocation. */
function protectedMutationPath(cwd:string,path:string):boolean{
  const lexical=resolve(cwd,path);let nearest=lexical;
  for(;;){try{nearest=realpathSync(nearest);break}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error;const next=resolve(nearest,'..');if(next===nearest)break;nearest=next}}
  for(const candidate of [lexical,nearest]){
    const parts=candidate.split('/');if(parts.some(p=>p.toLowerCase()==='.controlled-dev'))return true;
    for(let i=0;i<parts.length;i++)if(parts[i].toLowerCase()==='documentazione'){
      const repo=parts.slice(0,i).join('/')||'/';
      if(projectProtectedFolderCanaries(repo).has('Documentazione'))return true;
    }
  }
  return false;
}

export type TreeInventory = ReadonlyMap<string, string>;
/** Complete discovery metadata for source/configuration paths, never evidence of
 * their behavior or permission to edit. Oversized indexes fail explicitly. */
export function sourceFileIndex(inventory:TreeInventory):string{
  const files=[...inventory].filter(([path,kind])=>kind.startsWith('f\t')&&!path.split('/').some(p=>['.git','node_modules','.venv'].includes(p))).map(([path])=>path);
  const sourceFiles=files.filter(path=>/\.(?:py|pyi|ts|tsx|js|jsx|mjs|cjs|rs|go|java|kt|c|h|cpp|hpp|cs|rb|sh|md|toml|ini|cfg|yaml|yml)$/i.test(path)||/(?:^|\/)(?:package\.json|Makefile|Cargo\.lock|requirements\.txt)$/.test(path)).sort();
  const sourceFileBytes=sourceFiles.map(path=>{const size=Number(inventory.get(path)!.split('\t')[2]);return [path,Number.isSafeInteger(size)&&size>=0?size:null] as const});
  const sourceByteCount=sourceFileBytes.every(([,size])=>size!==null)?sourceFileBytes.reduce((n,[,size])=>n+size!,0):null;
  const text=JSON.stringify({sourceFiles,sourceFileCount:sourceFiles.length,sourceByteCount,sourceFileBytes,otherFileCount:files.length-sourceFiles.length,sourceIndexComplete:true});
  if(Buffer.byteLength(text,'utf8')>65536)throw new ControlledRuntimeError('SOURCE_INDEX_LIMIT');
  return text;
}
export function inventoryTree(root: string, excludedTopLevel: readonly string[] = [], includedPaths?:ReadonlySet<string>): TreeInventory {
  const absolute = resolve(root);
  if (realpathSync(absolute) !== absolute) throw new ControlledRuntimeError('CANARY_ROOT_NOT_CANONICAL');
  const rows = new Map<string, string>(); let entries = 0, sourceBytes = 0, gitBytes = 0;
  const custodians=projectProtectedFolderCanaries(absolute);
  const included=includedPaths?new Set([...includedPaths].flatMap(path=>path.split('/').map((_,i,parts)=>parts.slice(0,i+1).join('/')))):undefined;
  function walk(pathname: string): void {
    // ponytail: bounded whole-tree scan; replace with a host manifest if larger repositories must be supported.
    if (++entries > 100_000) throw new ControlledRuntimeError('CANARY_LIMIT');
    const stat = lstatSync(pathname); const rel = relative(absolute, pathname).split(sep).join('/') || '.';
    const mode = stat.mode & 0o7777;
    if (stat.isDirectory()) {
      const custodian=custodians.get(rel);
      if(custodian){rows.set(rel,`d\t${mode}\tcustodian:${custodian}`);return}
      rows.set(rel, `d\t${mode}`);
      for (const name of readdirSync(pathname).sort()) if ((rel !== '.' || !excludedTopLevel.includes(name))&&(!included||included.has(rel==='.'?name:rel+'/'+name))) walk(join(pathname, name));
    } else if (stat.isSymbolicLink()) rows.set(rel, `l\t${mode}\t${readlinkSync(pathname)}`);
    else if (stat.isFile()) {
      // Git stores a second copy of source blobs. Keep both trees covered by
      // the read-only canary, with separate bounded budgets for each area.
      if(rel.startsWith('.git/'))gitBytes+=stat.size;else sourceBytes+=stat.size;
      if (sourceBytes > 512 * 1024 * 1024 || gitBytes > 512 * 1024 * 1024) throw new ControlledRuntimeError('CANARY_LIMIT');
      rows.set(rel, `f\t${mode}\t${stat.size}\t${createHash('sha256').update(readFileSync(pathname)).digest('hex')}`);
    } else throw new ControlledRuntimeError('CANARY_UNSUPPORTED_ENTRY');
  }
  walk(absolute); return rows;
}
export function inventoryHash(inventory: TreeInventory): string {
  return createHash('sha256').update([...inventory].map(([path, value]) => `${path}\t${value}`).join('\n')).digest('hex');
}
export function changedInventoryPaths(before: TreeInventory, after: TreeInventory): readonly string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return Object.freeze([...paths].filter(path => before.get(path) !== after.get(path)).sort());
}

function record(value: unknown): value is Record<string, any> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
