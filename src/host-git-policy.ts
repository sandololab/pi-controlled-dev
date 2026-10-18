declare const process:{readonly env:Readonly<Record<string,string|undefined>>};
/** Shared policy for bounded host Git operations, including existing rework primitives. */
export const HOST_GIT_CONFIG=Object.freeze(['-c','commit.gpgsign=false','-c','merge.gpgsign=false','-c','merge.autoStash=false','-c','submodule.recurse=false','-c','user.useConfigOnly=true','-c','core.fsync=all']);
export function hostGitEnvironment():Record<string,string>{
  const env:Record<string,string>={};for(const [key,value] of Object.entries(process.env))if(value!==undefined&&!key.startsWith('GIT_'))env[key]=value;
  return {...env,GIT_TERMINAL_PROMPT:'0',GIT_EDITOR:'false',GIT_SEQUENCE_EDITOR:'false'};
}
