/**
 * Verify the host-created empty root commit that identifies a new project.
 * The project marker, empty tree, lack of parents and ancestry must all match.
 * Keep this module independent of candidate storage to avoid an identity/storage
 * import cycle. All Git operations here are observations, not mutations.
 */
import {execFileSync} from 'node:child_process';
import {HOST_GIT_CONFIG,hostGitEnvironment} from './host-git-policy.js';

/** Low-level identity check shared by project discovery and CandidateGit.
 * It depends on neither storage placement nor candidate/scope services. */
export function verifyGitProjectIdentity(repo:string,projectId:string,baseline:string,reader?:(args:string[])=>string):void {
 const fail=():never=>{throw Object.assign(new Error('GREENFIELD_PROJECT_ID_INVALID'),{code:'GREENFIELD_PROJECT_ID_INVALID'})};
 if(!/^[a-f0-9]{64}$/.test(projectId)||!(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/).test(baseline))fail();
 const run=reader??((args:string[])=>{try{return execFileSync('git',['-C',repo,'-c','core.hooksPath=',...HOST_GIT_CONFIG,...args],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024,env:hostGitEnvironment(),stdio:['ignore','pipe','pipe']}).replace(/\n$/,'')}catch{throw Object.assign(new Error('GIT_OPERATION_FAILED'),{code:'GIT_OPERATION_FAILED'})}});
 if(run(['rev-list','--parents','-n','1',baseline])!==baseline||run(['ls-tree','-r','--name-only',baseline])
   ||run(['show','-s','--format=%B',baseline]).trim()!==`chore: initialize project baseline\n\nControlled-Dev-Project: ${projectId}`)fail();
 run(['merge-base','--is-ancestor',baseline,'HEAD']);
}
