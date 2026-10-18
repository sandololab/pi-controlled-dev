declare module 'node:fs' {
  interface BigIntStats {
    readonly dev:bigint;readonly ino:bigint;readonly mode:bigint;readonly nlink:bigint;readonly size:bigint;
    readonly birthtimeNs:bigint;readonly ctimeNs:bigint;readonly mtimeNs:bigint;
    isDirectory():boolean;isSymbolicLink():boolean;isFile():boolean;
  }
  export function lstatSync(path:string,options:{bigint:true}):BigIntStats;
  export function fstatSync(fd:number,options:{bigint:true}):BigIntStats;
  export function readSync(fd:number,buffer:Uint8Array,offset:number,length:number,position:number):number;
}
