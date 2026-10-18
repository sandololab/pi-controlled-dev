import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

let installed=false;
export function installSourceLoader(){
  if(installed)return; installed=true;
  registerHooks({
    resolve(specifier,context,nextResolve){
      if(specifier.startsWith('.')&&specifier.endsWith('.js')&&context.parentURL){
        const url=new URL(specifier.slice(0,-3)+'.ts',context.parentURL);
        if(existsSync(url))return {url:url.href,shortCircuit:true};
      }
      return nextResolve(specifier,context);
    },
    load(url,context,nextLoad){
      if(url.endsWith('.ts'))return {format:'module',source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2023}}).outputText,shortCircuit:true};
      return nextLoad(url,context);
    },
  });
}
