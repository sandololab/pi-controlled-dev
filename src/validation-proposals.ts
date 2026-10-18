import type { TaskWizardDraft } from './pre-task-proposal.js';
import type { TaskSpec } from './contracts.js';
import { validateScalar } from './contracts.js';
import { lstatSync, realpathSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Closed host-owned recipes. Model/user prose can never become executable code or shell syntax.
const recipes={NPM_TEST:['npm',['test']],PYTEST:['python3',['-m','pytest']],CARGO_TEST:['cargo',['test']],MAVEN_TEST:['mvn',['test']],GRADLE_TEST:['gradle',['test']],MAKE_TEST:['make',['test']]} as const;
const contentCheck="const fs=require('node:fs'),path=require('node:path');const [p,expected]=process.argv.slice(1);const root=fs.realpathSync('.'),file=path.resolve(root,p);if(!file.startsWith(root+path.sep)||fs.realpathSync(file)!==file||!fs.lstatSync(file).isFile())process.exit(2);process.exit(fs.readFileSync(file,'utf8')===JSON.parse(expected).join('\\n')?0:1);";
const pytestConfigs=['pyproject.toml','pytest.ini','setup.cfg'] as const;
const pytestSections={'pyproject.toml':/^\s*\[tool\.pytest\.ini_options\]\s*$/m,
  'pytest.ini':/^\s*\[pytest\]\s*$/m,'setup.cfg':/^\s*\[tool:pytest\]\s*$/m};
interface CandidateTestProposal {
  readonly kind:string;readonly mechanism?:string;readonly paths:readonly string[];
  readonly expectedLines:readonly string[];readonly configPath?:string;
}
function literalPythonPath(path:unknown):path is string {
  return typeof path==='string'&&validateScalar('Path',path).ok&&path.endsWith('.py')
    &&!/[\\*?\[\]]/.test(path)&&!path.split('/').some(p=>['','.', '..','.git'].includes(p));
}
function candidateTestFields(v:CandidateTestProposal):boolean {
  return v.kind==='CANDIDATE_TEST'&&v.mechanism==='PYTEST'&&v.expectedLines.length===0
    &&typeof v.configPath==='string'&&(pytestConfigs as readonly string[]).includes(v.configPath)
    &&v.paths.length>=1&&v.paths.length<=32&&new Set(v.paths).size===v.paths.length&&v.paths.every(literalPythonPath);
}
/** A prospective test is not an observed test. Its exact path and configuration
 * must be in the proposed editable scope, or independently observed by the host. */
export function validateCandidateTestProposal(v:CandidateTestProposal,context:{readonly repoRoot:string;
  readonly proposedScope:readonly string[];readonly observedFiles:readonly string[]}):void {
  const invalid=()=>{throw new Error('PRE_TASK_PROPOSAL_INVALID')};
  if(!candidateTestFields(v)||realpathSync(context.repoRoot)!==context.repoRoot)invalid();
  for(const path of [v.configPath!,...v.paths]){
    const editable=context.proposedScope.includes(path),observed=context.observedFiles.includes(path);
    if(!editable&&!observed)invalid();
    let absolute=context.repoRoot,missing=false;
    const parts=path.split('/');
    for(let i=0;i<parts.length;i++){
      absolute=resolve(absolute,parts[i]!);
      if(missing)continue;
      try{
        const stat=lstatSync(absolute);
        if(stat.isSymbolicLink()||realpathSync(absolute)!==absolute
          ||(i<parts.length-1?!stat.isDirectory():!stat.isFile()))invalid();
      }catch(error){if((error as {code?:string}).code!=='ENOENT')throw error;missing=true}
    }
    if(missing&&!editable)invalid();
    // An editable config may acquire its pytest section in this task. Only an
    // observed, uneditable config has to be pytest-ready before implementation.
    if(path===v.configPath&&!missing&&!editable){
      const stat=lstatSync(absolute);if(stat.size>131072)invalid();
      if(!pytestSections[path as keyof typeof pytestSections].test(readFileSync(absolute).toString('utf8')))invalid();
    }
  }
}
// Exact host code, never generated from a proposal. Each file is an argv value,
// not shell syntax; approved config still controls pythonpath and test behavior.
// Logs explain the decision, but only observed process exit determines success.
const candidatePytest=String.raw`import os, sys, pathlib, re
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
os.environ["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
os.environ.pop("PYTEST_ADDOPTS", None)
os.environ.pop("PYTEST_PLUGINS", None)
sys.dont_write_bytecode = True
root = pathlib.Path.cwd().resolve()
config, paths = sys.argv[1], sys.argv[2:]
def fail(message):
    print("candidate-pytest: " + message, file=sys.stderr)
    raise SystemExit(2)
if config not in ("pyproject.toml", "pytest.ini", "setup.cfg") or not 1 <= len(paths) <= 32 or len(set(paths)) != len(paths):
    fail("invalid host recipe arguments")
for name in [config] + paths:
    parts = name.split("/")
    if any(p in ("", ".", "..", ".git") for p in parts) or name.startswith("/") or any(c in name for c in "\\*?[]\x00"):
        fail("non-literal path")
    file = root.joinpath(*parts)
    if file.resolve() != file or not file.is_file():
        fail("missing or symlinked path: " + name)
    if name != config and not name.endswith(".py"):
        fail("test file must be Python")
cf = root / config
section = {"pyproject.toml": "tool.pytest.ini_options", "pytest.ini": "pytest", "setup.cfg": "tool:pytest"}[config]
if cf.stat().st_size > 131072 or not re.search(r"^\s*\[" + re.escape(section) + r"\]\s*$", cf.read_text(encoding="utf-8"), re.M):
    fail("missing supported pytest configuration")
import pytest
class Counts:
    def __init__(self):
        self.collected = self.passed = self.failed = self.skipped = self.xfailed = 0
    def pytest_collection_finish(self, session):
        self.collected = len(session.items)
    def pytest_runtest_logreport(self, report):
        if report.failed:
            self.failed += 1
        elif report.skipped:
            self.skipped += 1
        elif report.when == "call" and report.passed:
            if getattr(report, "wasxfail", None):
                self.xfailed += 1
            else:
                self.passed += 1
counts = Counts()
code = int(pytest.main(["-p", "no:cacheprovider", "-o", "addopts=", "-c", config, "--"] + paths, plugins=[counts]))
print("candidate-pytest: collected=%d passed=%d failed=%d skipped=%d xpassed=%d exit=%d" % (counts.collected, counts.passed, counts.failed, counts.skipped, counts.xfailed, code))
if code == 0 and (counts.passed < 1 or counts.failed):
    print("candidate-pytest: no successful ordinary test; validation rejected", file=sys.stderr)
    code = 5
raise SystemExit(code)
`;
export function compileValidations(draft:TaskWizardDraft,resolveExecutable:(name:string)=>string):TaskSpec['validationCommands'] {
  const commands:TaskSpec['validationCommands'][number][]=[];
  const add=(executable:string,argv:string[])=>{if(commands.some(c=>c.executable===executable&&JSON.stringify(c.argv)===JSON.stringify(argv)))return;
    commands.push({schemaVersion:1,id:`validation-${commands.length+1}`,executable,argv,timeoutMs:120000,required:true})};
  add(resolveExecutable('git'),['diff','--check']);
  for(const v of draft.validationPlan){
    if(v.kind==='REVIEW')continue;
    if(v.kind==='CANDIDATE_TEST'){
      if(!candidateTestFields(v))throw new Error('PRE_TASK_PROPOSAL_INVALID');
      add(resolveExecutable('python3'),['-B','-c',candidatePytest,v.configPath!,...v.paths]);
    }else if(v.kind==='CONTENT'){
      if(v.paths.length!==1||!v.expectedLines.length)throw new Error('PRE_TASK_PROPOSAL_INVALID');
      add(resolveExecutable('node'),['-e',contentCheck,'--',v.paths[0],JSON.stringify(v.expectedLines)]);
    }else {
      const recipe=v.mechanism&&recipes[v.mechanism];if(!recipe)throw new Error('PRE_TASK_PROPOSAL_INVALID');
      add(resolveExecutable(recipe[0]),[...recipe[1]]);
    }
  }
  return commands;
}

/** Identify existing host recipes without inferring code from prose or executable basenames.
 * Canonical executable paths can end in npm-cli.js/python3.x after native resolution. */
export function hostValidationRecipeName(command:TaskSpec['validationCommands'][number]):string|undefined {
  const argv=command.argv;
  if(JSON.stringify(argv)===JSON.stringify(['diff','--check']))return 'git';
  if(argv[0]==='-B'&&argv[1]==='-c'&&argv[2]===candidatePytest
    &&candidateTestFields({kind:'CANDIDATE_TEST',mechanism:'PYTEST',configPath:argv[3],paths:argv.slice(4),expectedLines:[]}))return 'python3';
  for(const [name,args] of Object.values(recipes))if(JSON.stringify(argv)===JSON.stringify(args))return name;
  if(argv.length===5&&argv[0]==='-e'&&argv[1]===contentCheck&&argv[2]==='--'){
    try{const lines=JSON.parse(argv[4]);if(Array.isArray(lines)&&lines.length&&lines.length<=128&&lines.every(l=>typeof l==='string'&&!/[\r\n\0]/.test(l)))return 'node'}catch{}
  }
}
export function compiledValidationResolver(commands:TaskSpec['validationCommands']):(name:string)=>string {
  return name=>{const command=commands.find(c=>hostValidationRecipeName(c)===name);if(!command)throw new Error('PRE_TASK_PROPOSAL_INVALID');return command.executable};
}
