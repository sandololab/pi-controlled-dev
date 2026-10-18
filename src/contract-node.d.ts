// Minimal declarations for the Node stdlib surface used by pure P4 helpers.
// No runtime implementation and no dependency on host/package internals.
declare module 'node:crypto' {
  export function createHash(algorithm: 'sha256'): {
    update(data: string | Uint8Array): { digest(encoding: 'hex'): string };
  };
}
declare module 'node:util' {
  export const types: { isProxy(value: unknown): boolean; isUint8Array(value: unknown): boolean };
}
declare module 'node:buffer' {
  export const Buffer: {
    from(input: string | Uint8Array, encoding?: 'utf8'): Uint8Array & { toString(encoding: 'utf8'): string };
    byteLength(input: string, encoding: 'utf8'): number;
  };
  export function isUtf8(input: Uint8Array): boolean;
}
