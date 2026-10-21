declare module 'node:child_process' {
  interface HostStream {on(event:'data',listener:(chunk:Uint8Array)=>void):void;on(event:'error',listener:(error:unknown)=>void):void}
  interface HostChild {readonly pid?:number;readonly stdout?:HostStream;readonly stderr?:HostStream;
    once(event:'spawn',listener:()=>void):void;
    once(event:'error',listener:(error:{code?:string})=>void):void;
    once(event:'exit',listener:(code:number|null,signal:string|null)=>void):void;
    once(event:'close',listener:(code:number|null,signal:string|null)=>void):void;
    kill(signal:string):boolean;
  }
  export function spawn(executable:string,args:readonly string[],options:{cwd:string;shell:false;detached:true;stdio:readonly ['ignore','pipe','pipe']}):HostChild;
}
declare module 'node:process' {export function hrtime():[number,number];export namespace hrtime {function bigint():bigint}}

declare module 'node:process' {export function kill(pid:number,signal:string):void}
