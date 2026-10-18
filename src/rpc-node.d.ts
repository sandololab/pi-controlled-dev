// Node stdlib declarations used only by the RPC boundary; no runtime code.
declare module 'node:crypto' { export function randomUUID(): string; }
declare module 'node:util' { export function isDeepStrictEqual(a: unknown, b: unknown): boolean; }
declare module 'node:timers' {
  export interface Timeout { readonly __rpcTimeout: unique symbol }
  export function setTimeout(callback: () => void, milliseconds: number): Timeout;
  export function clearTimeout(timer: Timeout | undefined): void;
}
