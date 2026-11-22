// Frozen into the approved command. The repository runner is invoked directly.
const fs = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const adapter = 'scripts/controlled-dev-regression';
const maxFile = 1024 * 1024;
const maxTree = 64 * maxFile;

function read(root, relative, executable = false) {
  const file = path.join(root, relative);
  const stat = fs.lstatSync(file);
  if (fs.realpathSync(file) !== file || !stat.isFile() || stat.nlink !== 1
    || stat.size > maxFile || (executable && (stat.mode & 0o100) === 0)) {
    throw new Error('Unsupported runner or test file');
  }
  const data = fs.readFileSync(file);
  if (data.length > maxFile) throw new Error('Test input exceeds size limit');
  return data;
}

function materialize(root, destination, commit) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  env.GIT_NO_REPLACE_OBJECTS = '1';
  const git = (args, maxBuffer) => execFileSync('git', ['-C', root, ...args], {
    env, maxBuffer, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (git(['rev-parse', '--verify', commit + '^{commit}'], 1024).toString().trim() !== commit) {
    throw new Error('Wrong baseline commit');
  }
  // Read Git's raw blobs, avoiding checkout filters, archive attributes and links.
  const index = git(['ls-tree', '-rlz', commit], maxFile).toString('utf8').split('\0').filter(Boolean);
  if (index.length > 2048) throw new Error('Baseline exceeds file limit');
  let total = 0;
  for (const entry of index) {
    const match = /^(100644|100755) blob ([a-f0-9]+) +([0-9]+)\t([^\0]+)$/.exec(entry);
    if (!match) throw new Error('Unsupported baseline entry');
    const [, mode, oid, length, relative] = match;
    if (relative.split('/').some(part => ['', '.', '..', '.git'].includes(part))
      || relative.includes('\ufffd')) throw new Error('Invalid baseline entry path');
    const size = Number(length);
    total += size;
    if (!Number.isSafeInteger(size) || total > maxTree) throw new Error('Baseline exceeds size limit');
    const bytes = git(['cat-file', 'blob', oid], Math.max(size + 1, 1024));
    if (bytes.length !== size) throw new Error('Baseline blob size mismatch');
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, bytes, { flag: 'wx', mode: mode === '100755' ? 0o700 : 0o600 });
  }
}

function observe(root, files, testId, expectedFailure) {
  const result = spawnSync(path.join(root, adapter), [testId, ...files], {
    cwd: root, shell: false, encoding: 'utf8', maxBuffer: 64 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.signal || result.status !== 0) return 'INCONCLUSIVE';
  let report;
  try { report = JSON.parse(result.stdout); } catch { return 'INCONCLUSIVE'; }
  if (!report || report.testId !== testId) return 'INCONCLUSIVE';
  const keys = Object.keys(report).sort().join(',');
  if (keys === 'outcome,testId' && report.outcome === 'PASS') return 'PASS';
  if (keys === 'failure,outcome,testId' && report.outcome === 'FAIL' && report.failure === expectedFailure) return 'EXPECTED_FAILURE';
  return 'INCONCLUSIVE';
}

function main(mode, testId, expectedFailure, criterion, ...files) {
  const root = fs.realpathSync(process.cwd());
  const base = mode === 'recheck' ? 'recheck' : process.env.PI_CONTROLLED_DEV_REGRESSION_BASE;
  delete process.env.PI_CONTROLLED_DEV_REGRESSION_BASE;
  if (base !== 'recheck' && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(base ?? '')) {
    throw new Error('Missing approved baseline');
  }
  const runner = read(root, adapter, true);
  const inputs = files.map(file => ({
    bytes: read(root, file),
    executable: Boolean(fs.lstatSync(path.join(root, file)).mode & 0o100),
  }));
  let before = 'NOT_RUN';
  if (base !== 'recheck') {
    const temporaryRoot = fs.realpathSync(tmpdir());
    if (temporaryRoot === root || temporaryRoot.startsWith(root + path.sep)) {
      throw new Error('Invalid baseline location');
    }
    const temp = fs.mkdtempSync(path.join(temporaryRoot, 'controlled-regression-'));
    try {
      materialize(root, temp, base);
      if (!read(temp, adapter, true).equals(runner)) throw new Error('Regression runner changed');
      files.forEach((file, index) => {
        const target = path.join(temp, file);
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.writeFileSync(target, inputs[index].bytes, { mode: 0o600 });
        fs.chmodSync(target, inputs[index].executable ? 0o700 : 0o600);
      });
      before = observe(temp, files, testId, expectedFailure);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
  if (!read(root, adapter, true).equals(runner)
    || files.some((file, index) => !read(root, file).equals(inputs[index].bytes)
      || Boolean(fs.lstatSync(path.join(root, file)).mode & 0o100) !== inputs[index].executable)) {
    throw new Error('Regression inputs changed before candidate execution');
  }
  const after = observe(root, files, testId, expectedFailure);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  console.log('controlled-regression: ' + JSON.stringify({
    base, testId, before, after, runnerDigest: digest(runner),
    files: files.map((file, index) => ({ file, digest: digest(inputs[index].bytes) })),
  }));
  if (after !== 'PASS') return 1;
  return base === 'recheck' || before === 'EXPECTED_FAILURE' ? 0 : 2;
}
try {
  process.exitCode = main(...process.argv.slice(1));
} catch (error) {
  console.error('controlled-regression: inconclusive (' + (error.code ?? error.message) + ')');
  process.exitCode = 2;
}
