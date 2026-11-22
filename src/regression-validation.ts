import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import type { CommandSpec } from './contracts.js';
import { validateScalar } from './contracts.js';

export const REGRESSION_RUNNER = 'scripts/controlled-dev-regression';
const bootstrap = "eval(process.argv.splice(1,2).join(''))";
const source = readFileSync(fileURLToPath(new URL('./regression-recipe.cjs', import.meta.url))).toString('utf8');
const chunks = [source.slice(0, 3000), source.slice(3000)];

export interface RegressionExpectation {
  readonly testId: string;
  readonly expectedFailure: string;
  readonly criterion: number;
}

export function validRegression(input: RegressionExpectation, files: readonly string[]): boolean {
  const label = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(value);
  return label(input.testId) && label(input.expectedFailure)
    && Number.isInteger(input.criterion) && input.criterion >= 1 && input.criterion <= 32
    && files.length > 0 && files.length <= 8 && new Set(files).size === files.length
    && files.every(file => validateScalar('Path', file).ok && /^(?:tests?|spec)\/[A-Za-z0-9_./-]+$/.test(file)
      && file.split('/').every(part => part !== '' && !part.startsWith('.')));
}

export function regressionArguments(input: RegressionExpectation, files: readonly string[], recheck: boolean): string[] {
  if (!validRegression(input, files)) throw new Error('PRE_TASK_PROPOSAL_INVALID');
  return ['-e', bootstrap, '--', ...chunks, recheck ? 'recheck' : 'pair',
    input.testId, input.expectedFailure, String(input.criterion), ...files];
}

export function regressionCommand(command: CommandSpec) {
  const [flag, script, separator, first, second, mode, testId, expectedFailure, index, ...files] = command.argv;
  if (flag !== '-e' || script !== bootstrap || separator !== '--'
    || first !== chunks[0] || second !== chunks[1]
    || (mode !== 'pair' && mode !== 'recheck') || !testId || !expectedFailure || !index) return undefined;
  const criterion = Number(index);
  if (String(criterion) !== index || !validRegression({ testId, expectedFailure, criterion }, files)) return undefined;
  return { mode, testId, expectedFailure, criterion, files };
}

export const REGRESSION_BASE_ENV = 'PI_CONTROLLED_DEV_REGRESSION_BASE';
