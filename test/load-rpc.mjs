import { readFileSync } from 'node:fs';
import ts from 'typescript';
export async function loadRpc() {
  const { outputText } = ts.transpileModule(readFileSync(new URL('../src/pi-subagents-rpc.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}
