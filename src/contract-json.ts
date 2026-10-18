import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { Buffer, isUtf8 } from 'node:buffer';

export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };
export type Issue = Readonly<{ stage: 'json' | 'structural' | 'semantic' | 'context'; code: string; path: string }>;
export class ContractError extends Error {
  readonly issue: Issue;
  constructor(stage: Issue['stage'], code: string, path = '$') {
    super(`${stage}:${code}:${path}`);
    this.issue = Object.freeze({ stage, code, path });
  }
}
export const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8');
export function codePointCompare(a: string, b: string): number {
  if(a===b)return 0;
  let ai=0,bi=0;
  while(ai<a.length&&bi<b.length){
    const ac=a.codePointAt(ai)!,bc=b.codePointAt(bi)!;
    if(ac!==bc)return ac-bc;
    ai+=ac>0xffff?2:1;bi+=bc>0xffff?2:1;
  }
  return Array.from(a.slice(ai)).length-Array.from(b.slice(bi)).length;
}
// Only values produced and deeply frozen by this module are reusable. External
// frozen objects, proxies and getters still undergo the complete inertness check.
const inertCopies=new WeakSet<object>();
function freezeInert<T extends object>(value:T):Readonly<T>{const result=Object.freeze(value);inertCopies.add(result);return result}
const parsedCopies=new Map<string,Json>();
let parsedBytes=0;
function unicode(text: string, path: string): void {
  if (/[\uD800-\uDFFF]/u.test(text)) throw new ContractError('json', 'SURROGATE', path);
}

/** Copy an inert JSON value. No getters, toJSON, custom prototypes or coercion. */
export function copyJson(input: unknown): Json {
  const active = new Set<object>();
  function copy(value: unknown, path: string): Json {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') { unicode(value, path); return value; }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) throw new ContractError('json', 'UNSAFE_INTEGER', path);
      return value;
    }
    if (typeof value !== 'object') throw new ContractError('json', 'NON_JSON', path);
    if(inertCopies.has(value))return value as Json;
    if (types.isProxy(value)) throw new ContractError('json', 'PROXY', path);
    if (active.has(value)) throw new ContractError('json', 'CYCLE', path);
    const array = Array.isArray(value);
    const proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
      throw new ContractError('json', 'PROTOTYPE', path);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string')) throw new ContractError('json', 'SYMBOL_KEY', path);
    for (const key of keys as string[]) {
      unicode(key, path);
      const d = descriptors[key];
      if (!Object.hasOwn(d, 'value') || (!d.enumerable && !(array && key === 'length')))
        throw new ContractError('json', 'DESCRIPTOR', path);
    }
    active.add(value);
    let result: Json;
    if (array) {
      const length = descriptors.length.value as number;
      if (keys.length !== length + 1) throw new ContractError('json', 'SPARSE_OR_EXTRA_ARRAY', path);
      const items: Json[] = [];
      for (let i = 0; i < length; i++) {
        if (!Object.hasOwn(descriptors, String(i))) throw new ContractError('json', 'SPARSE_OR_EXTRA_ARRAY', path);
        items.push(copy(descriptors[String(i)].value, `${path}[${i}]`));
      }
      result = Object.freeze(items);
    } else {
      result = Object.freeze(Object.fromEntries((keys as string[]).sort(codePointCompare)
        .map(key => [key, copy(descriptors[key].value, `${path}.${key}`)])));
    }
    if(result!==null&&typeof result==='object')inertCopies.add(result);
    active.delete(value);
    return result;
  }
  try { return copy(input, '$'); }
  catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError('json', 'UNREADABLE_INPUT');
  }
}

/** Strict JSON ingress; duplicate decoded keys are rejected before construction. */
export function parseJson(input: string | Uint8Array, maxBytes: number): Json {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new ContractError('json', 'INVALID_LIMIT');
  let text: string;
  if (typeof input === 'string') { unicode(input, '$'); text = input; }
  else {
    const bytes = inertBytes(input, maxBytes);
    if (!isUtf8(bytes)) throw new ContractError('json', 'UTF8');
    if (bytes.byteLength > maxBytes) throw new ContractError('json', 'PAYLOAD_LIMIT');
    text = Buffer.from(bytes).toString('utf8');
  }
  if (byteLength(text) > maxBytes) throw new ContractError('json', 'PAYLOAD_LIMIT');
  const cached=parsedCopies.get(text);
  if(cached!==undefined){parsedCopies.delete(text);parsedCopies.set(text,cached);return cached}
  let i = 0;
  const bad = (code = 'SYNTAX'): never => { throw new ContractError('json', code, `$@${i}`); };
  const space = () => { while (i < text.length && /[\x20\t\r\n]/.test(text[i])) i++; };
  function string(): string {
    const start = i++;
    while (i < text.length) {
      const c = text[i++];
      if (c === '"') {
        let result: string;
        try { result = JSON.parse(text.slice(start, i)) as string; } catch { return bad(); }
        unicode(result, `$@${start}`);
        return result;
      }
      if (c === '\\') i++;
      else if (c.charCodeAt(0) < 32) return bad();
    }
    return bad();
  }
  // Validate the decimal value exactly before conversion to IEEE-754. This avoids
  // accepting a fractional/overflowing token merely because Number rounds it.
  function number(token: string): number {
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token)!;
    let digits = (m[2] + (m[3] ?? '')).replace(/^0+/, '');
    if (!digits) return m[1] ? -0 : 0;
    const shift = BigInt(m[4] ?? '0') - BigInt((m[3] ?? '').length);
    if (shift < 0n) {
      const trim = -shift;
      if (trim > BigInt(digits.length)) return bad('NON_INTEGER');
      const n = Number(trim);
      if (!/^0+$/.test(digits.slice(-n))) return bad('NON_INTEGER');
      digits = digits.slice(0, -n);
    } else {
      if (BigInt(digits.length) + shift > 16n) return bad('UNSAFE_INTEGER');
      digits += '0'.repeat(Number(shift));
    }
    const n = Number(m[1] + digits);
    if (!Number.isSafeInteger(n)) return bad('UNSAFE_INTEGER');
    return n;
  }
  function value(): Json {
    space();
    if (text[i] === '"') return string();
    if (text[i] === '{') {
      i++; space();
      const entries: [string, Json][] = []; const keys = new Set<string>();
      if (text[i] === '}') { i++; return freezeInert({}); }
      while (true) {
        if (text[i] !== '"') return bad();
        const key = string();
        if (keys.has(key)) return bad('DUPLICATE_KEY');
        keys.add(key); space();
        if (text[i++] !== ':') return bad();
        entries.push([key, value()]); space();
        const c = text[i++];
        if (c === '}') return freezeInert(Object.fromEntries(entries));
        if (c !== ',') return bad();
        space();
      }
    }
    if (text[i] === '[') {
      i++; space(); const items: Json[] = [];
      if (text[i] === ']') { i++; return freezeInert(items); }
      while (true) {
        items.push(value()); space(); const c = text[i++];
        if (c === ']') return freezeInert(items);
        if (c !== ',') return bad();
      }
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(literal, i)) { i += literal.length; return result; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (!match) return bad();
    i += match[0].length;
    return number(match[0]);
  }
  try {
    const result = value(); space();
    if (i !== text.length) bad('TRAILING_DATA');
    // Exact validated bytes only, with bounded retention. File identity, digest,
    // alias checks and cross-record validation remain the caller's responsibility.
    const size=byteLength(text);
    if(size<=1024*1024){
      while(parsedCopies.size>=128||parsedBytes+size>8*1024*1024){const oldest=parsedCopies.keys().next().value;if(oldest===undefined)break;parsedBytes-=byteLength(oldest);parsedCopies.delete(oldest)}
      parsedCopies.set(text,result);parsedBytes+=size;
    }
    return result;
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError('json', 'UNREADABLE_INPUT', `$@${i}`);
  }
}

function quote(text: string): string {
  return '"' + text.replace(/["\\\x00-\x1f]/g, c => c === '"' ? '\\"' : c === '\\' ? '\\\\'
    : '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '"';
}
/** JSON representability only, not contract acceptance or provenance. */
export function canonicalize(input: unknown): string {
  const data = copyJson(input);
  function encode(value: Json): string {
    if (value === null) return 'null';
    if (typeof value === 'string') return quote(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return '[' + value.map(encode).join(',') + ']';
    const object = value as { readonly [key: string]: Json };
    return '{' + Object.keys(object).sort(codePointCompare).map(key => quote(key) + ':' + encode(object[key])).join(',') + '}';
  }
  return encode(data);
}
export const canonicalBytes = (value: unknown): Uint8Array => Buffer.from(canonicalize(value), 'utf8');
export const hashCanonical = (value: unknown): string => createHash('sha256').update(canonicalBytes(value)).digest('hex');
function inertBytes(input: Uint8Array, maxBytes = Number.MAX_SAFE_INTEGER): Uint8Array {
  if (types.isProxy(input) || !types.isUint8Array(input)) throw new ContractError('json', 'BYTE_INPUT');
  // Intrinsic getters bypass user-defined buffer/offset/length/valueOf accessors.
  const proto = Object.getPrototypeOf(Uint8Array.prototype);
  const buffer = Object.getOwnPropertyDescriptor(proto, 'buffer')!.get!.call(input) as ArrayBuffer;
  const offset = Object.getOwnPropertyDescriptor(proto, 'byteOffset')!.get!.call(input) as number;
  const length = Object.getOwnPropertyDescriptor(proto, 'byteLength')!.get!.call(input) as number;
  if (length > maxBytes) throw new ContractError('json', 'PAYLOAD_LIMIT');
  return new Uint8Array(new Uint8Array(buffer, offset, length));
}
export const hashBytes = (bytes: Uint8Array): string => createHash('sha256').update(inertBytes(bytes)).digest('hex');
