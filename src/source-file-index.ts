import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import type {ArtifactRef} from './contracts.js';

export interface SourceIndexStore {readonly root:string;put(id:string,content:string,mediaType?:string):ArtifactRef}
export const SOURCE_INDEX_RESPONSE_BYTES=32768;
const excluded=['.git','node_modules','.venv'];
const source=(path:string)=>/\.(?:py|pyi|ts|tsx|js|jsx|mjs|cjs|rs|go|java|kt|c|h|cpp|hpp|cs|rb|sh|md|toml|ini|cfg|yaml|yml)$/i.test(path)||/(?:^|\/)(?:package\.json|Makefile|Cargo\.lock|requirements\.txt)$/.test(path);
const eligible=(path:string)=>!path.split('/').some(p=>excluded.includes(p));
const dependency=(path:string)=>/^(vendor|third_party)(\/|$)/.test(path);
const parent=(path:string)=>path.includes('/')?path.slice(0,path.lastIndexOf('/')):'.';
const compare=(a:string,b:string)=>Number(dependency(a))-Number(dependency(b))||(a<b?-1:a>b?1:0);
const size=(kind:string)=>{const n=Number(kind.split('\t')[2]);return Number.isSafeInteger(n)&&n>=0?n:null};
const fail=(code:string):never=>{throw Object.assign(new Error(code),{code})};
/** Deterministic discovery only. Small views retain their historical exact bytes.
 * The complete canary inventory is never truncated or modified by this function. */
export function sourceFileIndex(inventory:ReadonlyMap<string,string>,store?:SourceIndexStore):string {
 const files=[...inventory].filter(([path,kind])=>kind.startsWith('f\t')&&eligible(path)).map(([path])=>path);
 const sourceFiles=files.filter(source).sort(),sourceFileBytes=sourceFiles.map(path=>[path,size(inventory.get(path)!)] as const);
 const sourceByteCount=sourceFileBytes.every(([,n])=>n!==null)?sourceFileBytes.reduce((n,[,s])=>n+s!,0):null;
 const legacy=JSON.stringify({sourceFiles,sourceFileCount:sourceFiles.length,sourceByteCount,sourceFileBytes,otherFileCount:files.length-sourceFiles.length,sourceIndexComplete:true});
 if(Buffer.byteLength(legacy,'utf8')<=65536)return legacy;
 const inventoryDigest=createHash('sha256').update([...inventory].map(([path,value])=>`${path}\t${value}`).join('\n')).digest('hex');
 const rows=files.sort((a,b)=>compare(parent(a),parent(b))||compare(a,b)).map(path=>({path,bytes:size(inventory.get(path)!),source:source(path)}));
 const groups=new Map<string,{path:string;files:number;sourceFiles:number;start:number;end:number;dependency:boolean}>();
 for(const [i,row] of rows.entries()){
  const folder=parent(row.path),g=groups.get(folder)??{path:folder,files:0,sourceFiles:0,start:i,end:i,dependency:dependency(row.path)};
  g.files++;if(row.source)g.sourceFiles++;g.end=i+1;groups.set(folder,g);
 }
 for(const [path,kind] of inventory)if(kind.startsWith('d\t')&&eligible(path)&&!groups.has(path))groups.set(path,{path,files:0,sourceFiles:0,start:0,end:0,dependency:dependency(path)});
 const directories=[...groups.values()].sort((a,b)=>compare(a.path,b.path));
 let catalog:null|{filesPage:string;directoriesPage:string;artifactPrefix:string;responseByteLimit:number}=null;
 if(store){
  const prefix=`source-index-${inventoryDigest}`;
  const pages=(view:string,entries:readonly unknown[])=>{
   const chunks:{start:number;end:number;entries:unknown[]}[]=[];let chunk:unknown[]=[],start=0,bytes=0;
   for(const [i,entry] of entries.entries()){
    const n=Buffer.byteLength(JSON.stringify(entry),'utf8')+1;
    if(n>24576)fail('SOURCE_INDEX_ENTRY_LIMIT');
    if(chunk.length&&bytes+n>24576){chunks.push({start,end:i,entries:chunk});chunk=[];start=i;bytes=0}
    chunk.push(entry);bytes+=n;
   }
   if(chunk.length||!chunks.length)chunks.push({start,end:entries.length,entries:chunk});
   let next:string|null=null;const refs:{start:number;end:number;path:string}[]=[];
   for(let i=chunks.length-1;i>=0;i--){
    const c=chunks[i],content=JSON.stringify({schemaVersion:2,inventoryDigest,view,offset:c.start,end:c.end,total:entries.length,pageComplete:true,viewComplete:c.start===0&&c.end===entries.length,sourceIndexComplete:false,next,entries:c.entries});
    if(Buffer.byteLength(content,'utf8')>SOURCE_INDEX_RESPONSE_BYTES)fail('SOURCE_INDEX_ENTRY_LIMIT');
    const ref=store.put(`${prefix}-${view}-${c.start}`,content,'application/vnd.pi-controlled-dev.source-index+json');
    next=join(store.root,ref.relativeStorePath);refs.unshift({start:c.start,end:c.end,path:next});
   }
   return refs;
  };
  const filePages=pages('files',rows);
  let pageIndex=0;
  const folderRows=directories.map(g=>{if(g.files)while(filePages[pageIndex].end<=g.start)pageIndex++;return {...g,firstFilePage:g.files?filePages[pageIndex].path:null}});
  const directoryPages=pages('directories',folderRows);
  catalog={filesPage:filePages[0].path,directoriesPage:directoryPages[0].path,artifactPrefix:join(store.root,'artifacts',prefix),responseByteLimit:SOURCE_INDEX_RESPONSE_BYTES};
 }
 // The preview itself must stay bounded even when there are many long folder names.
 const buckets=new Map<string,{path:string;files:number;sourceFiles:number;directories:number;dependency:boolean}>();
 for(const g of directories){const path=g.path==='.'?'.':g.path.split('/')[0],b=buckets.get(path)??{path,files:0,sourceFiles:0,directories:0,dependency:dependency(path)};b.files+=g.files;b.sourceFiles+=g.sourceFiles;b.directories++;buckets.set(path,b)}
 const top=[...buckets.values()].sort((a,b)=>compare(a.path,b.path));
 const preview:unknown[]=[];let previewBytes=0;
 for(const g of top){const n=Buffer.byteLength(JSON.stringify(g),'utf8');if(preview.length>=16||previewBytes+n>8192)break;preview.push(g);previewBytes+=n}
 const text=JSON.stringify({schemaVersion:2,inventoryDigest,sourceFileCount:sourceFiles.length,sourceByteCount,otherFileCount:files.length-sourceFiles.length,
  sourceIndexComplete:false,viewComplete:false,directoryPreview:preview,directoryPreviewComplete:preview.length===top.length,
  excludedDirectoryNames:excluded,inventoryComplete:true,catalogComplete:catalog!==null,catalog,
  consultation:'Discovery metadata only, never source evidence or authority. Project folders precede vendor/third_party. First read directoriesPage, then pertinent firstFilePage links and next pages before choosing source files; folder start/end identify exact file ranges. Read only the advertised catalog artifact prefix, never other profile files. Every page binds the same inventoryDigest; pageComplete concerns that page, viewComplete the entire view. Read source files as needed within the existing assignment scope.'});
 if(Buffer.byteLength(text,'utf8')>SOURCE_INDEX_RESPONSE_BYTES)fail('SOURCE_INDEX_ENTRY_LIMIT');
 return text;
}
/** Agent dispatch must never advertise an inaccessible catalog. The store is the
 * existing host-owned project/task artifact store, outside source/work trees. */
export function sourceIndexForAgent(inventory:ReadonlyMap<string,string>,store?:SourceIndexStore):string {
 const text=sourceFileIndex(inventory,store),view=JSON.parse(text);
 if(!view.sourceIndexComplete&&!view.catalogComplete)fail('SOURCE_INDEX_STORE_REQUIRED');
 return text;
}
