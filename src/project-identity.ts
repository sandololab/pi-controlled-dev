import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { canonicalize, hashBytes, parseJson } from './contracts.js';
import { CandidateGit } from './candidate-git.js';
import { readProjectCustodian } from './project-custodian.js';
/** Existing projects retain their legacy identity. Bootstrap metadata binds a portable identity
 * to the immutable empty root commit; it is optional and grants no action authority. */
export function projectIdentity(repo:string):string {
  const custodian=readProjectCustodian(repo);if(custodian)return custodian.projectId;
  const path=join(repo,'.git','controlled-dev-project.json');
  let stat;try{stat=lstatSync(path)}catch(error){const code=(error as {code?:string}).code;if(code==='ENOENT')return hashBytes(Buffer.from(repo));if(code==='ENOTDIR'){const git=lstatSync(join(repo,'.git'));if(git.isFile()&&!git.isSymbolicLink()&&git.nlink===1)return hashBytes(Buffer.from(repo))}throw error}
  const dir=lstatSync(join(repo,'.git'));
  if(!dir.isDirectory()||dir.isSymbolicLink()||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>4096||realpathSync(path)!==path)throw new Error('GREENFIELD_PROJECT_ID_INVALID');
  const raw=readFileSync(path),v=parseJson(raw,4096) as any;
  if(Object.keys(v).sort().join(',')!=='baselineCommit,projectId,schemaVersion'||v.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(v.projectId)||canonicalize(v)!==Buffer.from(raw).toString('utf8'))throw new Error('GREENFIELD_PROJECT_ID_INVALID');
  CandidateGit.verifyProjectIdentity(repo,v.projectId,v.baselineCommit);return v.projectId;
}
