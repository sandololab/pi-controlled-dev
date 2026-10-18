import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Bounded in-memory loader: no generated files, arbitrary resolver or dependency installs.
const files = new Set(['contracts', 'contract-json', 'contract-schema', 'contract-semantic','run-quiescence','runtime-root-binding']);
const urls = new Map();
function url(name) {
  if (!files.has(name)) throw new Error(`Unapproved P4 module: ${name}`);
  if (urls.has(name)) return urls.get(name);
  const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
  });
  const resolved = outputText.replace(/from ['"]\.\/([a-z-]+)\.js['"]/g, (_, target) => `from ${JSON.stringify(url(target))}`);
  const result = 'data:text/javascript;base64,' + Buffer.from(resolved + `\n//# sourceURL=p4-${name}.js`).toString('base64');
  urls.set(name, result);
  return result;
}
export const loadContracts = () => import(url('contracts'));
