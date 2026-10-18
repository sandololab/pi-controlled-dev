// Explicit installed-tarball probe. UI responses below are test doubles, NOT real-human E2E certification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
test('P17 real npm/Pi clean installation loads package resources and survives reinstall',async t=>{
  assert.ok(process.env.P17_PACKAGE_TARBALL,'Provide the newly built tarball explicitly');
  const tarball=resolve(process.env.P17_PACKAGE_TARBALL),root=mkdtempSync(join(tmpdir(),'p17-install-')),home=join(root,'home'),repo=join(root,'project');
  mkdirSync(home);mkdirSync(repo);t.after(()=>rmSync(root,{recursive:true,force:true}));
  const data=join(home,'.pi','agent'),prefix=join(home,'packages'),installed=join(prefix,'node_modules','pi-controlled-dev');
  assert.equal(existsSync(data),false);assert.equal(existsSync(installed),false);
  const env={...process.env,HOME:home,PI_CODING_AGENT_DIR:data,npm_config_cache:join(home,'.npm'),PI_OFFLINE:'1',PI_TELEMETRY:'0',PI_SKIP_VERSION_CHECK:'1'};
  for(const name of ['PI_SESSION_ID','PI_SESSION_FILE','PI_PROVIDER','PI_MODEL','PI_REASONING_LEVEL'])delete env[name];
  const run=(command,args,cwd=repo)=>{const r=spawnSync(command,args,{cwd,env,encoding:'utf8',timeout:60000});assert.ifError(r.error);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr+r.stdout);return r.stdout};
  const install=()=>run('npm',['install','--prefix',prefix,'--ignore-scripts','--omit=dev','--omit=optional','--no-audit','--no-fund',tarball]);
  install();assert.equal(existsSync(join(installed,'test')),false);assert.equal(existsSync(join(installed,'USER-MANUAL.md')),true);assert.equal(existsSync(join(installed,'USER-MANUAL.pdf')),false);
  const archive=run('tar',['-tzf',tarball]);assert.ok(archive.includes('package/USER-MANUAL.md'));
  for(const retired of ['package/USER-MANUAL.pdf','package/src/trusted-human-probe.ts','package/src/greenfield-bootstrap-ui.ts','package/test/'])assert.equal(archive.includes(retired),false,retired);
  run('pi',['install',installed]);assert.ok(run('pi',['list']).includes(installed));
  const rpc=spawnSync('pi',['--mode','rpc','--no-session','--offline','--no-approve'],{cwd:repo,env,encoding:'utf8',timeout:60000,
    input:JSON.stringify({id:'commands',type:'get_commands'})+'\n'+JSON.stringify({id:'headless',type:'prompt',message:'/controlled-dev run'})+'\n'+JSON.stringify({id:'headless-integrate',type:'prompt',message:'/controlled-dev integrate'})+'\n'+JSON.stringify({id:'headless-checkpoint',type:'prompt',message:'/controlled-dev project check'})+'\n'+JSON.stringify({id:'headless-greenfield',type:'prompt',message:'/controlled-dev project new'})+'\n'});
  assert.ifError(rpc.error);assert.equal(rpc.status,0,rpc.stderr);
  const replies=rpc.stdout.split('\n').filter(Boolean).map(JSON.parse),commandsReply=replies.find(r=>r.id==='commands');
  assert.equal(commandsReply?.success,true,rpc.stderr);assert.ok(commandsReply.data.commands.some(c=>c.name==='controlled-dev'&&c.sourceInfo.path.startsWith(installed)));
  const expectedResources=[...['repository-analysis','validation-planning','controlled-review','task-planning','recovery-explanation','runtime-observability','scenario-management','evidence-management','software-design-quality','project-memory','project-planning','greenfield-bootstrap'].map(name=>[`skill:${name}`,'skill',`skills/${name}/SKILL.md`]),
    ...['controlled-dev-task','controlled-dev-recovery','controlled-dev-result'].map(name=>[name,'prompt',`prompts/${name}.md`])];
  for(const [name,source,path] of expectedResources){
    const resource=commandsReply.data.commands.find(c=>c.name===name&&c.source===source);assert.ok(resource,`Native Pi did not load ${name}: ${rpc.stderr}\n${JSON.stringify(commandsReply.data.commands)}`);
    assert.equal(resource.sourceInfo.origin,'package');assert.equal(resource.sourceInfo.path,join(installed,path));
    assert.ok(readFileSync(join(installed,path),'utf8').startsWith('---\n'));
  }
  // RPC success acknowledges command handling, not workflow approval; Pi reports the handler error separately.
  assert.ok(replies.some(r=>r.id==='headless'));assert.ok(replies.some(r=>r.id==='headless-integrate'));assert.ok(replies.some(r=>r.id==='headless-checkpoint'));assert.ok(replies.some(r=>r.id==='headless-greenfield'));assert.match(rpc.stdout+rpc.stderr,/HUMAN_CHANNEL_UNAVAILABLE/);
  assert.equal(existsSync(join(data,'controlled-dev')),false);
  run('git',['init','-q']);writeFileSync(join(repo,'README.md'),'Demo\n');run('git',['add','README.md']);run('git',['-c','user.name=Probe','-c','user.email=probe@example.invalid','commit','-qm','Initial']);
  const old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=data;
  t.after(()=>{if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=old});
  const before=readFileSync(join(installed,'src','runtime-observability.ts'));
  run('pi',['remove',installed]);run('npm',['uninstall','--prefix',prefix,'--ignore-scripts','--no-audit','--no-fund','pi-controlled-dev']);
  install();run('pi',['install',installed]);assert.ok(run('pi',['list']).includes(installed));
  assert.deepEqual(readFileSync(join(installed,'src','runtime-observability.ts')),before);
  assert.equal(existsSync(data),true);
  console.log(JSON.stringify({npmTarballInstall:'PASS',piInstallList:'PASS',nativePiLoader:'PASS',nativeSkillsLoaded:12,nativePromptsLoaded:3,headlessRefusal:'PASS',freshHome:true,reinstallPackagePreserved:true,realHumanE2E:false}));
});
