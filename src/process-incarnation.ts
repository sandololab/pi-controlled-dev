import { readFileSync, readlinkSync } from 'node:fs';
import { pid, platform } from 'node:process';
import { Buffer } from 'node:buffer';

export interface ProcessIncarnation {readonly platform:'linux';readonly bootId:string;readonly pidNamespace:string;readonly pid:number;readonly startTicks:string}
export interface OwnerEvidence {readonly status:'LIVE'|'DEAD'|'UNCERTAIN';readonly reason:string}
const text=(path:string)=>Buffer.from(readFileSync(path)).toString('utf8').trim();
function startTicks(processId:number):string {
  const raw=text(`/proc/${processId}/stat`),end=raw.lastIndexOf(')');
  if(end<0||raw.slice(0,raw.indexOf(' '))!==String(processId))throw new Error('PROC_STAT_INVALID');
  const ticks=raw.slice(end+2).split(' ')[19];
  if(!/^\d+$/.test(ticks))throw new Error('PROC_START_INVALID');return ticks;
}
/** Only a fully visible local Linux procfs in the current PID namespace supplies absence evidence.
 * Other hosts, namespaces, hidepid mounts and unsupported platforms remain uncertain. */
function domain():Pick<ProcessIncarnation,'platform'|'bootId'|'pidNamespace'> {
  if(platform!=='linux')throw new Error('PROC_UNSUPPORTED');
  const mounts=text('/proc/self/mountinfo').split('\n').filter(line=>line.split(' ')[4]==='/proc');
  if(mounts.length!==1||!mounts[0].includes(' - proc ')||/hidepid=(?!0(?:,|\s|$))/.test(mounts[0]))throw new Error('PROC_VISIBILITY_UNKNOWN');
  const pidNamespace=readlinkSync('/proc/self/ns/pid');
  // NSpid is relative to the procfs mount: a single entry proves it is not an ancestor namespace mount.
  const namespacePids=text('/proc/self/status').match(/^NSpid:\s*(.+)$/m)?.[1].trim();
  if(namespacePids!==String(pid)||!/^pid:\[\d+\]$/.test(pidNamespace))throw new Error('PROC_NAMESPACE_UNKNOWN');
  const bootId=text('/proc/sys/kernel/random/boot_id');
  if(!/^[a-f0-9-]{36}$/.test(bootId)||text('/proc/self/stat').split(' ')[0]!==String(pid))throw new Error('PROC_DOMAIN_UNKNOWN');
  return {platform:'linux',bootId,pidNamespace};
}
export function currentProcessIncarnation():ProcessIncarnation|undefined {
  try{return Object.freeze({...domain(),pid,startTicks:startTicks(pid)})}catch{return undefined}
}
export function inspectProcessOwner(owner:ProcessIncarnation|undefined):OwnerEvidence {
  try {
    if(!owner||owner.platform!=='linux'||!Number.isSafeInteger(owner.pid)||owner.pid<=0||!/^\d+$/.test(owner.startTicks))throw new Error();
    const current=domain();
    if(current.bootId!==owner.bootId||current.pidNamespace!==owner.pidNamespace)throw new Error();
    // Recheck the observation domain after reading the target; PID alone never authorizes reclaim.
    let observed:string|undefined;
    try{observed=startTicks(owner.pid)}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error}
    const after=domain();if(JSON.stringify(current)!==JSON.stringify(after))throw new Error();
    return observed===owner.startTicks?{status:'LIVE',reason:'SAME_PROCESS_INCARNATION'}:
      {status:'DEAD',reason:observed===undefined?'ABSENT_IN_VERIFIED_BOOT_AND_PID_NAMESPACE':'PID_REUSED_DIFFERENT_START_MARKER'};
  }catch{return {status:'UNCERTAIN',reason:'PROCESS_LIFETIME_NOT_PROVEN'}}
}
