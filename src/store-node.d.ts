interface ImportMeta { readonly url:string }
declare module 'node:url' {
  export class URL { constructor(input:string,base?:string|URL); }
  export function fileURLToPath(url:URL):string;
}
declare module 'node:process' { export const pid:number; export const platform:string; }
declare module 'node:child_process' {
  export function spawnSync(executable:string,args:string[],options:{cwd:string;encoding:'utf8';timeout:number;killSignal:string;maxBuffer:number;shell:false}):
    {pid:number;status:number|null;signal:string|null;stdout:string;stderr:string;error?:Error & {code?:string}};
}
declare module 'node:path' { export const delimiter:string; }
declare module 'node:fs' {
  export function mkdirSync(path:string,options:{mode:number}):string|undefined;
  export function openSync(path:string,flags:string,mode?:number):number;
  export function closeSync(fd:number):void;
  export function fsyncSync(fd:number):void;
  export function fchmodSync(fd:number,mode:number):void;
  export function writeFileSync(fd:number,data:string|Uint8Array):void;
  export function renameSync(from:string,to:string):void;
}
