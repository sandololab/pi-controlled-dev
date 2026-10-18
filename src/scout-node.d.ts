declare module 'node:fs' {
  export const constants: { readonly R_OK: number; readonly W_OK: number; readonly X_OK: number };
  export function accessSync(path: string, mode?: number): void;
  interface Stats { mode: number; size: number; mtimeMs: number; ctimeMs: number; birthtimeMs: number; dev: number; ino: number; nlink: number; isDirectory(): boolean; isSymbolicLink(): boolean; isFile(): boolean }
  export function lstatSync(path: string): Stats;
  export function chmodSync(path: string, mode: number): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function unlinkSync(path: string): void;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
  export function statSync(path: string): Stats;
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string): Uint8Array & { toString(encoding: 'utf8'): string };
  export function readlinkSync(path: string): string;
  export function realpathSync(path: string): string;
  export function existsSync(path: string): boolean;
}
declare module 'node:child_process' {
  export function execFileSync(executable: string, args: readonly string[], options: {
    encoding: 'utf8'; timeout: number; maxBuffer: number; stdio?: readonly ['ignore'|'pipe','pipe','pipe'];env?:Record<string,string>;input?:string|Uint8Array;
  }): string;
}
declare module 'node:os' { export function tmpdir(): string; }
declare module 'node:path' {
  export const sep: string;
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function resolve(...paths: string[]): string;
  export function basename(path: string): string;
}
