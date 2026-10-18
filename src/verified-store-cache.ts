import {closeSync,fstatSync,lstatSync,openSync,readSync,readdirSync,realpathSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {Buffer} from 'node:buffer';
import {hashBytes} from './contracts.js';

type Reader=(path:string)=>Uint8Array;
interface Snapshot {fingerprint:string;files:Map<string,Uint8Array>}
interface Entry {fingerprint:string;json:string;bytes:number}
export class VerifiedStoreCacheError extends Error {constructor(readonly code:string){super(code)}}
class AcquisitionLimit extends Error {}
const MAX_ENTRIES=8,MAX_BYTES=64*1024*1024,MAX_NAMES=100000;
function fail(code:string):never{throw new VerifiedStoreCacheError(code)}
function physical(path:string):string {
  const s=lstatSync(path,{bigint:true});
  return [s.dev,s.ino,s.mode,s.nlink,s.size,s.birthtimeNs,s.ctimeNs,s.mtimeNs].join(':');
}
/** Full bytes, not a timestamp/head shortcut. File descriptors are compared with their
 * pathname before and after reading. Ancestors are canonical and retain their identity;
 * unrelated siblings outside the task namespace do not invalidate a ledger. */
function acquire(root:string,retain:boolean):Snapshot {
  const rows:string[]=[],files=new Map<string,Uint8Array>();let bytes=0,names=0;
  for(let path=root;;path=dirname(path)){
    const s=lstatSync(path,{bigint:true});
    if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(path)!==path)fail('STORE_DIRECTORY_ALIAS');
    rows.push(`ancestor:${path}:${s.dev}:${s.ino}:${s.mode}:${s.birthtimeNs}`);
    if(path===dirname(path))break;
  }
  function walk(path:string):void {
    if(++names>MAX_NAMES)throw new AcquisitionLimit();
    const before=lstatSync(path,{bigint:true}),identity=[before.dev,before.ino,before.mode,before.nlink,before.size,before.birthtimeNs,before.ctimeNs,before.mtimeNs].join(':'),rel=relative(root,path);
    if(before.isSymbolicLink()||realpathSync(path)!==path)fail('STORE_FILE_ALIAS');
    if(before.isDirectory()){
      const entries=readdirSync(path).sort();rows.push(`directory:${rel}:${identity}:${JSON.stringify(entries)}`);
      for(const name of entries)walk(join(path,name));
      if(physical(path)!==identity||JSON.stringify(readdirSync(path).sort())!==JSON.stringify(entries))fail('STORE_NAMESPACE_CHANGED');
    }else{
      if(!before.isFile()||before.nlink!==1n)fail('STORE_FILE_ALIAS');
      bytes+=Number(before.size);if(bytes>MAX_BYTES)throw new AcquisitionLimit();
      const fd=openSync(path,'r');let raw:Uint8Array;
      try{
        const s=fstatSync(fd,{bigint:true});
        if(!s.isFile()||[s.dev,s.ino,s.mode,s.nlink,s.size,s.birthtimeNs,s.ctimeNs,s.mtimeNs].join(':')!==identity)fail('STORE_NAMESPACE_CHANGED');
        raw=new Uint8Array(Number(before.size));let offset=0;
        while(offset<raw.byteLength){const count=readSync(fd,raw,offset,raw.byteLength-offset,offset);if(!count)fail('STORE_NAMESPACE_CHANGED');offset+=count}
        // Never allocate from a file that grew after its bounded acquisition.
        if(readSync(fd,new Uint8Array(1),0,1,raw.byteLength))fail('STORE_NAMESPACE_CHANGED');
        const after=fstatSync(fd,{bigint:true});
        if(raw.byteLength!==Number(before.size)||[after.dev,after.ino,after.mode,after.nlink,after.size,after.birthtimeNs,after.ctimeNs,after.mtimeNs].join(':')!==identity)fail('STORE_NAMESPACE_CHANGED');
      }finally{closeSync(fd)}
      if(physical(path)!==identity||realpathSync(path)!==path)fail('STORE_NAMESPACE_CHANGED');
      rows.push(`file:${rel}:${identity}:${hashBytes(raw)}`);if(retain)files.set(path,raw);
    }
  }
  walk(root);return {fingerprint:JSON.stringify(rows),files};
}
/** Each factory owns a private bounded cache. A caller cannot seed another cache with an
 * unvalidated result. Entries contain serialized data only, never reader bytes or authority.
 * A miss validates the acquired immutable bytes; the public WAL/repair reader stays separate. */
export function createVerifiedStoreCache<T>(decode:(root:string,reader?:Reader)=>T):(root:string)=>T {
  const entries=new Map<string,Entry>();let total=0;
  function discard(root:string){const previous=entries.get(root);if(previous){total-=previous.bytes;entries.delete(root)}}
  return root=>{
    let before:Snapshot;
    try{before=acquire(root,true)}catch(error){
      discard(root);if(error instanceof AcquisitionLimit)return decode(root);throw error;
    }
    const previous=entries.get(root);
    if(previous&&previous.fingerprint===before.fingerprint){
      const value=JSON.parse(previous.json) as T;
      try{if(acquire(root,false).fingerprint!==before.fingerprint)fail('STORE_NAMESPACE_CHANGED')}catch(error){discard(root);if(error instanceof AcquisitionLimit)fail('STORE_NAMESPACE_CHANGED');throw error}
      entries.delete(root);entries.set(root,previous);return value;
    }
    discard(root);
    const read:Reader=path=>{const raw=before.files.get(path);if(!raw)fail('ENOENT');return raw};
    const value=decode(root,read),json=JSON.stringify(value);
    try{if(acquire(root,false).fingerprint!==before.fingerprint)fail('STORE_NAMESPACE_CHANGED')}catch(error){if(error instanceof AcquisitionLimit)fail('STORE_NAMESPACE_CHANGED');throw error}
    const size=Buffer.byteLength(json,'utf8')+Buffer.byteLength(before.fingerprint,'utf8');
    if(size<=MAX_BYTES){
      while(entries.size>=MAX_ENTRIES||total+size>MAX_BYTES)discard(entries.keys().next().value!);
      entries.set(root,{fingerprint:before.fingerprint,json,bytes:size});total+=size;
    }
    return JSON.parse(json) as T;
  };
}
