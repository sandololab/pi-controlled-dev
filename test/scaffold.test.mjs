import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { installSourceLoader } from './load-source.mjs';
installSourceLoader();

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('package.json'));
const modules = [
  'current-project','source-project','source-project-ui','scout-clarifications','context-investigation','context-investigation-repository','project-plan-consultation',
  'project-autonomy','project-autonomy-ui','project-autonomy-production','policy-authorization','autonomy-dependencies',
  'greenfield-bootstrap','project-identity','host-git-policy','candidate-git','candidate-promotion','candidate-promotion-repository','candidate-promotion-ui',
  'integration-checkpoint','integration-checkpoint-repository','integration-checkpoint-ui','integration-primary-canary',
  'orchestrator', 'state-machine', 'task-spec', 'pi-subagents-rpc', 'controlled-agent-runtime', 'controlled-scout', 'controlled-developer', 'controlled-reviewer', 'controlled-oracle',
  'legacy-reviewer-preflight', 'run-quiescence', 'scope-guard', 'retry-engine', 'validation-runner', 'runtime-observability', 'scenario-management', 'human-repository', 'store', 'contracts', 'completion-package',  'lock-manager', 'production-bridge', 'process-incarnation', 'recovery', 'recovery-resume', 'gate-presentation', 'store-repair', 'package-guidance', 'pre-task-proposal', 'controlled-ui', 'task-wizard', 'validation-proposals', 'wizard-input', 'trusted-confirmation', 'project-memory', 'project-memory-repository', 'project-memory-context', 'project-memory-ui', 'project-planning', 'project-planning-repository', 'project-planning-scout', 'project-planning-ui',
].map((name) => `src/${name}.ts`);
const placeholders = modules.filter(path => !['src/run-quiescence.ts','src/legacy-reviewer-preflight.ts','src/current-project.ts','src/source-project.ts','src/source-project-ui.ts','src/scout-clarifications.ts','src/context-investigation.ts','src/context-investigation-repository.ts','src/project-plan-consultation.ts','src/project-autonomy.ts','src/project-autonomy-ui.ts','src/project-autonomy-production.ts','src/policy-authorization.ts','src/autonomy-dependencies.ts','src/greenfield-bootstrap.ts','src/project-identity.ts','src/integration-checkpoint.ts','src/integration-checkpoint-repository.ts','src/integration-checkpoint-ui.ts','src/integration-primary-canary.ts','src/host-git-policy.ts','src/candidate-git.ts','src/candidate-promotion.ts','src/candidate-promotion-repository.ts','src/candidate-promotion-ui.ts','src/runtime-observability.ts', 'src/scenario-management.ts', 'src/human-repository.ts', 'src/orchestrator.ts', 'src/task-spec.ts', 'src/state-machine.ts', 'src/contracts.ts', 'src/pi-subagents-rpc.ts', 'src/controlled-agent-runtime.ts', 'src/controlled-scout.ts', 'src/controlled-developer.ts', 'src/controlled-reviewer.ts', 'src/controlled-oracle.ts', 'src/scope-guard.ts', 'src/retry-engine.ts', 'src/store.ts', 'src/validation-runner.ts', 'src/completion-package.ts', 'src/lock-manager.ts', 'src/production-bridge.ts', 'src/process-incarnation.ts', 'src/recovery.ts', 'src/recovery-resume.ts', 'src/gate-presentation.ts', 'src/store-repair.ts', 'src/package-guidance.ts', 'src/pre-task-proposal.ts', 'src/controlled-ui.ts', 'src/task-wizard.ts', 'src/validation-proposals.ts', 'src/wizard-input.ts', 'src/trusted-confirmation.ts','src/project-memory.ts','src/project-memory-repository.ts','src/project-memory-context.ts','src/project-memory-ui.ts','src/project-planning.ts','src/project-planning-repository.ts','src/project-planning-scout.ts','src/project-planning-ui.ts'].includes(path));
const p4Modules = ['src/contract-json.ts', 'src/contract-schema.ts', 'src/contract-semantic.ts', 'src/contract-node.d.ts'];
const p5Modules = ['src/rpc-node.d.ts', 'src/pi-tui.d.ts'];
const p6Modules = ['src/scout-node.d.ts', 'src/store-node.d.ts'];
const domainModules = ['src/bounded-developer-checkpoint.ts','src/developer-baseline.ts','src/development-profile.ts','src/host-api.ts','src/project-custodian.ts','src/project-storage.ts','src/project-handoff.ts','src/candidate-checkpoints.ts','src/runtime-root-binding.ts','src/project-runtime-import.ts','src/verified-store-cache.ts','src/verified-store-cache-node.d.ts'];
const entry = 'extensions/controlled-dev.ts';
const agents = ['scout', 'developer', 'reviewer', 'oracle'].map((name) => `agents/${name}.md`);
const skills = ['repository-analysis','validation-planning','controlled-review','task-planning','recovery-explanation','runtime-observability','scenario-management','evidence-management','software-design-quality','project-memory','project-planning','greenfield-bootstrap'].map(name=>`skills/${name}/SKILL.md`);
const prompts = ['controlled-dev-task','controlled-dev-recovery','controlled-dev-result'].map(name=>`prompts/${name}.md`);
const hashes = {
  // Reviewed bilingual publication snapshots; raw historical originals stay in the external archive.
  'docs/ARCHITECTURE.md': '3ba155a83f77673864229618e6cc5400dbc517a24c70e90533af9918b48cd8be',
  'docs/PROTOCOL.md': '54b4284ea00ff4cf998e6175423f99b002007c15bae050b6e8478bb371bf8467',
  'docs/TEST-MATRIX.md': '410d521618bc9b2d5ba3907eb50d161c34a5e2d3ee248953fa5ff3db21f08cf6',
};
const bilingualDocs = [
  "docs/README.md",
  "docs/it/ARCHITECTURE.md",
  "docs/it/CANDIDATE-PROMOTION.md",
  "docs/it/GREENFIELD-BOOTSTRAP.md",
  "docs/it/HISTORICAL-EVIDENCE.md",
  "docs/it/INTEGRATION-CHECKPOINTS.md",
  "docs/it/P15-E2E-MATRIX.md",
  "docs/it/P16C-WAL-AUDIT.md",
  "docs/it/PROJECT-AUTONOMY.md",
  "docs/it/PROJECT-MEMORY.md",
  "docs/it/PROJECT-PLANNING.md",
  "docs/it/PROTOCOL.md",
  "docs/it/README.md",
  "docs/it/SOURCE-REFACTORING.md",
  "docs/it/SYSTEMIST-COMPOSITION.md",
  "docs/it/TEST-MATRIX.md",
  "docs/it/TRUSTED-CONFIRMATION.md",
  "docs/it/USER-MANUAL.md",
  "docs/it/VALIDATION.md"
];
const expected = [
  ...bilingualDocs, 'test/language.test.mjs',
  'test/proposal-waiting-ux.test.mjs','test/project-opening-preview.test.mjs','test/developer-baseline.test.mjs',
  ...domainModules,'docs/SYSTEMIST-COMPOSITION.md','test/development-profile.test.mjs','test/contract-cache.test.mjs','test/scout-clarification-integration.test.mjs','test/candidate-git-batch.test.mjs','test/scout-clarifications.test.mjs','test/context-investigation.test.mjs','test/context-investigation-persistence.test.mjs','test/project-plan-consultation.test.mjs','test/project-shortcuts.test.mjs',
  'test/candidate-python-validation.test.mjs','test/candidate-git-filemode.test.mjs',
  'test/project-custodian.test.mjs','test/project-storage.test.mjs','test/candidate-portability.test.mjs','test/project-handoff.test.mjs','test/project-runtime-import.test.mjs','test/candidate-terminal-portability.test.mjs','test/verified-store-cache.test.mjs',
  'test/current-project.test.mjs','test/pi-runtime.integration.mjs',
  'docs/SOURCE-REFACTORING.md','test/source-project.test.mjs',
  'docs/PROJECT-AUTONOMY.md','test/project-autonomy.test.mjs','test/project-autonomy-e2e.test.mjs','test/project-autonomy-state-worker.mjs',
  'docs/GREENFIELD-BOOTSTRAP.md','test/greenfield-bootstrap.test.mjs','test/greenfield-bootstrap-fixture.mjs','test/greenfield-bootstrap-worker.mjs','test/greenfield-e2e.test.mjs',
  'docs/INTEGRATION-CHECKPOINTS.md','test/integration-checkpoint.test.mjs','test/integration-checkpoint-fixture.mjs','test/integration-checkpoint-worker.mjs','test/integration-review-rpc-fixture.mjs',
  'docs/CANDIDATE-PROMOTION.md','test/candidate-promotion-review.test.mjs','test/candidate-promotion.test.mjs','test/candidate-promotion-fixture.mjs','test/candidate-promotion-worker.mjs',
  'test/project-memory.test.mjs', 'test/project-memory-fixture.mjs', 'docs/PROJECT-MEMORY.md',
  'test/trusted-confirmation.test.mjs', 'test/project-confirmation-host-probe.ts', 'docs/TRUSTED-CONFIRMATION.md',
  'docs/HISTORICAL-EVIDENCE.md', 'docs/VALIDATION.md', 'test/trusted-human-probe.ts',
  'test/bounded-developer-checkpoint.test.mjs', 'test/project-runtime-import-bounded.test.mjs', 'test/runtime-root-binding.test.mjs',
  '.gitignore', 'README.md', 'USER-MANUAL.md', 'package.json', 'package-lock.json', 'tsconfig.json',
  'test/scaffold.test.mjs', 'test/state-machine.test.mjs', 'test/contracts.test.mjs',
  'test/load-contracts.mjs', 'test/contract-fixtures.mjs', 'test/rpc-host-probe.mjs', 'test/load-rpc.mjs', 'test/rpc.test.mjs',
  'test/load-source.mjs', 'test/controlled-scout.test.mjs', 'test/scout-host-probe.ts',
  'test/controlled-developer.test.mjs', 'test/developer-host-probe.ts',
  'test/controlled-reviewer.test.mjs', 'test/reviewer-host-probe.ts',
  'test/controlled-oracle.test.mjs', 'test/oracle-host-probe.ts',
  'test/trusted-human-probe.test.mjs', 'test/human-confirmation-host-probe.ts', 'test/terminal-evidence.test.mjs', 'test/terminal-host-probe.ts', 'test/p15-negative-host-probe.ts', 'test/store.test.mjs', 'test/orchestrator.test.mjs', 'test/orchestrator-host-probe.ts', 'test/scope-guard.test.mjs', 'test/retry-engine.test.mjs', 'test/retry-host-probe.ts', 'test/lock-manager.test.mjs', 'test/production-bridge.test.mjs',
  'test/recovery.test.mjs', 'test/recovery-fixture.mjs', 'test/recovery-historical.test.mjs', 'test/recovery-resume.test.mjs', 'test/store-repair.test.mjs', 'test/store-repair-worker.mjs', 'test/product-ux.test.mjs', 'test/product-package.test.mjs', 'test/product-install.test.mjs', 'test/pre-task-proposal.test.mjs', 'test/tui.test.mjs', 'test/runtime-observability.test.mjs', 'test/scenario-management.test.mjs', 'test/human-repository.test.mjs', 'test/software-design-quality.test.mjs', 'test/project-planning.test.mjs', 'test/project-planning-worker.mjs', 'docs/PROJECT-PLANNING.md',
  entry, ...modules, ...p4Modules, ...p5Modules, ...p6Modules, ...agents, ...skills, ...prompts, 'docs/P15-E2E-MATRIX.md', 'docs/P16C-WAL-AUDIT.md', 'docs/examples/controlled-dev-task.example.json', ...Object.keys(hashes),
].sort();

function inventory(dir = '') {
  return readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })
    .filter(({ name }) => name !== '.git' && name !== 'node_modules' && `${dir}${name}` !== '.pi/controlled-dev-task.json' && `${dir}${name}` !== '.pi/settings.json')
    .flatMap((item) => {
      const path = `${dir}${item.name}`;
      assert.ok(!item.isSymbolicLink(), `Unexpected symlink: ${path}`);
      return item.isDirectory() ? inventory(`${path}/`) : [path];
    }).sort();
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result;
}

function assertInertSource() {
  // P5 RPC is an explicit-call boundary, not a permanently frozen placeholder.
  const rpc = ts.createSourceFile('rpc.ts', read('src/pi-subagents-rpc.ts'), ts.ScriptTarget.Latest, true);
  for (const statement of rpc.statements) {
    assert.ok(!ts.isExpressionStatement(statement), 'No top-level RPC dispatch or listener registration');
    if (ts.isImportDeclaration(statement)) {
      assert.doesNotMatch(statement.moduleSpecifier.text, /(?:pi-subagents|orchestrator|store|scope-guard|validation-runner)/);
    }
  }
  const code = (path) => read(path).replace(/^\/\/[^\n]*$/gm, '').trim();
  for (const path of placeholders) assert.equal(code(path), 'export {};', path);
  for(const path of [entry,'src/orchestrator.ts','src/controlled-agent-runtime.ts','src/controlled-scout.ts','src/controlled-developer.ts','src/controlled-reviewer.ts','src/controlled-oracle.ts','src/scope-guard.ts','src/retry-engine.ts'])
    assert.doesNotMatch(read(path),/from\s+['"]pi-subagents(?:\/|['"])/);
}

test('P2-TEST-001 — structure and normative document integrity', () => {
  assert.deepEqual(inventory(), expected);
  for (const [path, hash] of Object.entries(hashes)) {
    assert.equal(createHash('sha256').update(read(path)).digest('hex'), hash, path);
  }
});

test('P2-TEST-002 — strict TypeScript check', () => {
  const config = JSON.parse(read('tsconfig.json'));
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(config.compilerOptions.noEmit, true);
  run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']);
});

test('P2-TEST-003 — bounded imports and extension lifecycle registration', async () => {
  assertInertSource();
  const before = inventory().map((path) => [path, read(path)]);
  const result = run(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import ts from 'typescript';
    async function load(path) {
      const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
      });
      return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
    }
    for (const path of ${JSON.stringify(placeholders)}) {
      assert.deepEqual(Object.keys(await load(path)), []);
    }
    await load('src/pi-subagents-rpc.ts'); // Import must be inert; bounded subprocess detects timers/output.
    const { loadContracts } = await import('./test/load-contracts.mjs');
    const contracts = await loadContracts();
    for (const name of ['validateStructure', 'validateContract', 'canonicalize', 'hashContract']) {
      assert.equal(typeof contracts[name], 'function');
    }
    const core = await load('src/state-machine.ts');
    assert.deepEqual(Object.keys(core).sort(),
      ['COMPLETION_CONDITIONS', 'STATES', 'TRANSITIONS', 'evaluateTransition']);
  `]);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.deepEqual(inventory().map((path) => [path, read(path)]), before);
  const extension=await import('../extensions/controlled-dev.ts');
  const handlers=new Map(),registered=[],disposed=[];const bus={on(){return()=>{}},emit(name,request){
    if(name==='pi-subagents:runtime-agent-register:v1'){registered.push(request.name);request.result={ok:true,registration:{dispose(){disposed.push(request.name)}}}}
  }};
  let activeTools=['read','write','edit','bash'];
  extension.default({registerCommand(){},events:bus,getAllTools:()=>[{name:'read',sourceInfo:{source:'builtin',path:'<builtin:read>'}}],
    setActiveTools(names){activeTools=names},on(name,handler){const list=handlers.get(name)??[];list.push(handler);handlers.set(name,list);return()=>{}}});
  assert.deepEqual([...handlers.keys()].sort(),['before_agent_start','context_with_system','input','session_shutdown','session_start','tool_call']);
  for(const handler of handlers.get('session_start'))handler({}, {sessionManager:{getSessionId:()=> 'session'}});
  assert.deepEqual(activeTools,['read']);
  assert.deepEqual(registered,['controlled.scout','controlled.developer','controlled.reviewer','controlled.oracle']);
  for(const handler of handlers.get('session_shutdown'))handler({}, {sessionManager:{getSessionId:()=> 'session'}});
  assert.deepEqual(disposed,['controlled.oracle','controlled.reviewer','controlled.developer','controlled.scout']);
  assert.equal(handlers.get('tool_call')[0]({toolName:'write'}).block,true);
  for(const handler of handlers.get('before_agent_start'))handler();
  assert.deepEqual(activeTools,['read']);
});

test('P14F registration checkpoint — native context boundary, selectors and no invocation authority', async t => {
  const {default:extension}=await import('../extensions/controlled-dev.ts');
  const commands=new Map(),handlers=new Map();let tools=['read','write','bash'],calls=0;
  extension({registerCommand(name,command){commands.set(name,command)},events:{on(){return()=>{}},emit(){}},
    getAllTools:()=>[{name:'read',sourceInfo:{source:'builtin',path:'<builtin:read>'}}],setActiveTools(names){tools=names},
    on(name,handler){const list=handlers.get(name)??[];list.push(handler);handlers.set(name,list);return()=>{}}});
  const projectRoot=mkdtempSync(join(tmpdir(),'controlled-dev-status-'));t.after(()=>rmSync(projectRoot,{recursive:true,force:true}));
  const messages=[],ctx={mode:'tui',cwd:projectRoot,sessionManager:{getSessionId:()=> 'fresh-host-session'},
    ui:{notify(message){messages.push(message.startsWith('{')?JSON.parse(message):message)},async confirm(){calls++;return true}}};
  for(const handler of handlers.get('session_start'))handler({},ctx);
  assert.deepEqual([...commands.keys()],['controlled-dev']);
  const command=commands.get('controlled-dev').handler;
  await command('status --technical',ctx);
  assert.deepEqual(messages[0],{hostCommand:'controlled-dev',mode:'tui',nativeConfirmAvailable:true,sessionBound:true,
    runtimeAvailable:false,taskId:null,state:'NO_TASK',revision:null,pendingGate:null,candidateGeneration:null,
    locks:{taskLockHeld:false,workspaceLockHeld:false},humanActionRequired:false,
    taskInput:{source:'host-control-plane',path:join(resolve(process.env.PI_CODING_AGENT_DIR??join(homedir(),'.pi','agent')),
      'controlled-dev','control',createHash('sha256').update(projectRoot).digest('hex'),'task.json'),exists:false,valid:false},productionGateIntegration:'READY'});
  for(const mode of ['json','rpc','print','headless'])await assert.rejects(command('status',{...ctx,mode}),/HUMAN_CHANNEL_UNAVAILABLE/);
  for(const value of [undefined,null,{...ctx,ui:{}},{...ctx,sessionManager:{getSessionId:()=> 'foreign'}}])
    await assert.rejects(command('status',value),/HUMAN_CHANNEL_UNAVAILABLE/);
  const rejects=async(text,code)=>{await command(text,ctx);assert.equal(typeof messages.at(-1),'string');await command('status --technical',ctx);assert.equal(messages.at(-1).lastFailure.code,code)};
  await rejects('confirm','NO_PENDING_GATE');
  await rejects('run','CONTROLLED_RUNTIME_UNAVAILABLE');
  await rejects('run ../task.json','CONTROLLED_COMMAND_INVALID');
  await rejects('status wrong-task','HUMAN_DECISION_WRONG_TASK');
  for(const text of ['approve true','approved=true','humanConfirmed=true','confirm task revision','/controlled-dev approve'])
    await rejects(text,'CONTROLLED_COMMAND_INVALID');
  assert.equal(calls,0); // Not even a positive UI double can manufacture a missing production gate.
  assert.deepEqual(tools,['read']);
  for(const name of ['bash','write','edit','subagent'])assert.equal(handlers.get('tool_call')[0]({toolName:name}).block,true);
  for(const handler of handlers.get('session_shutdown'))handler();
  await assert.rejects(command('status',ctx),/HUMAN_CHANNEL_UNAVAILABLE/);
});

test('P2-TEST-004 — only four controlled roles are operational; markdown profiles are never registered', () => {
  assertInertSource();
  for (const path of agents) {
    assert.doesNotMatch(read(path), /^---\s*$/m);
    assert.doesNotMatch(read(path), /^(?:name|tools|extensions|model|runner|systemPrompt):/m);
  }
  assert.match(read('agents/scout.md'),/not registered or discovered/);
  assert.match(read('agents/developer.md'),/not registered or discovered/);
  assert.match(read('agents/reviewer.md'),/not registered or discovered/);
  assert.match(read('agents/oracle.md'),/not registered or discovered/);
  assert.deepEqual(manifest.pi, { extensions: [`./${entry}`], skills: ['./skills'], prompts: ['./prompts/*.md'] });
  assert.equal(manifest['pi-subagents'], undefined);
});

test('P2-TEST-005 — package metadata and archive inventory', () => {
  assert.equal(manifest.name, 'pi-controlled-dev');
  assert.equal(manifest.version, '0.1.0-beta.2');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.private, true); // npm publication stays disabled; GitHub is public.
  assert.deepEqual(manifest.repository, {type:'git',url:'git+https://github.com/sandololab/pi-controlled-dev.git'});
  assert.equal(manifest.license, 'UNLICENSED');
  assert.equal(manifest.engines.node, '>=22.19.0');
  assert.ok(manifest.keywords.includes('pi-package'));
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.deepEqual(manifest.peerDependencies, { '@earendil-works/pi-coding-agent': '*' });
  assert.deepEqual(manifest.peerDependenciesMeta, {
    '@earendil-works/pi-coding-agent': { optional: true },
  });
  assert.deepEqual(Object.keys(manifest.scripts).sort(), ['test','test:pi-integration','typecheck']);
  assert.equal(manifest.scripts.typecheck, 'tsc --noEmit');
  assert.equal(manifest.scripts['test:pi-integration'], 'node --test test/pi-runtime.integration.mjs');
  const testCommand = manifest.scripts.test.split(/\s+/);
  assert.deepEqual(testCommand.slice(0,3), ['node','--test','--test-concurrency=1']);
  // Only these two probes need explicitly supplied external fixtures/installations.
  const manualProbes = new Set(['test/product-install.test.mjs','test/recovery-historical.test.mjs']);
  const portableTests = inventory().filter(path => path.startsWith('test/') && path.endsWith('.test.mjs') && !manualProbes.has(path));
  assert.deepEqual(testCommand.slice(3).sort(), portableTests.sort(), 'Every portable test must run exactly once');
  const packed = JSON.parse(run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts']).stdout);
  const archive = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
  assert.deepEqual(archive.files.map(({ path }) => path).sort(),
    [...expected.filter(path=>path.startsWith('docs/')),...domainModules, 'package.json', 'README.md', 'USER-MANUAL.md', entry, ...modules, ...p4Modules, ...p5Modules, ...p6Modules, ...agents, ...skills, ...prompts].sort());
});

test('P2-TEST-006 — new files contain no machine-local paths', () => {
  const localPaths = new RegExp('(?:/(?:home|Users|run/media|mnt|tmp|private/var)/|(?<![A-Za-z])[A-Za-z]:[\\\\/]|\\b(?:file|link):/{1,2})');
  for (const path of inventory().filter((path) => !Object.hasOwn(hashes, path) && !path.endsWith('.pdf'))) {
    assert.doesNotMatch(read(path), localPaths, path);
  }
  const lock = JSON.parse(read('package-lock.json'));
  for (const dependency of Object.values(lock.packages)) {
    if (dependency.resolved) assert.match(dependency.resolved, /^https:\/\//);
  }
});
