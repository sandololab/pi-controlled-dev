import { execFileSync } from 'node:child_process';
import { readFileSync,lstatSync,realpathSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize } from './contract-json.js';

export interface DependencyChange {readonly manifestPath:string;readonly section:'dependencies'|'devDependencies'|'peerDependencies'|'optionalDependencies';readonly name:string;readonly version:string}
const sections=['dependencies','devDependencies','peerDependencies','optionalDependencies'] as const;
const manifests=/(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.(toml|lock)|pyproject\.toml|requirements[^/]*\.txt|poetry\.lock|Pipfile(\.lock)?|pom\.xml|build\.gradle(\.kts)?|go\.(mod|sum))$/;
/** Conservative v1 manifest check. Node package.json is parsed; other changed dependency
 * manifests require a decision. This is not a universal dependency or supply-chain scanner. */
export function assertDependencyChanges(repo:string,candidate:string,base:string,approved:readonly DependencyChange[]):void{
 const git=(...args:string[])=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
 const changed=execFileSync('git',['-C',candidate,'diff','--name-only','-z',base],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024}).split('\0').filter(Boolean);
 // New untracked files are part of the ScopeGuard capture too.
 changed.push(...execFileSync('git',['-C',candidate,'ls-files','--others','--exclude-standard','-z'],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024}).split('\0').filter(Boolean));
 for(const path of new Set(changed.filter(p=>manifests.test(p)))){
  if(!path.endsWith('package.json'))throw new Error("UNEXPECTED_DEPENDENCY: changed manifest cannot be verified in v1");
  let before:any={};try{before=JSON.parse(git('show',`${base}:${path}`))}catch(error){const present=git('ls-tree',base,'--',path).trim();if(present)throw new Error("UNEXPECTED_DEPENDENCY: baseline manifest cannot be read")}
  const file=join(candidate,path);let after:any={};try{const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>1024*1024||realpathSync(file)!==file)throw new Error('unsafe');after=JSON.parse(readFileSync(file).toString('utf8'))}catch(error){if((error as {code?:string}).code!=='ENOENT')throw new Error("UNEXPECTED_DEPENDENCY: candidate manifest cannot be read")}
  if(!before||typeof before!=='object'||Array.isArray(before)||!after||typeof after!=='object'||Array.isArray(after))throw new Error("UNEXPECTED_DEPENDENCY: invalid manifest structure");
  for(const section of sections){const old=before[section]??{},next=after[section]??{};if(typeof old!=='object'||!old||Array.isArray(old)||typeof next!=='object'||!next||Array.isArray(next))throw new Error('UNEXPECTED_DEPENDENCY');
   for(const name of new Set([...Object.keys(old),...Object.keys(next)])){if(canonicalize(old[name]??null)===canonicalize(next[name]??null))continue;
    if(typeof next[name]!=='string'||!approved.some(d=>d.manifestPath===path&&d.section===section&&d.name===name&&d.version===next[name]))throw new Error(`UNEXPECTED_DEPENDENCY: ${path}, ${name}`);}
  }
 }
}
