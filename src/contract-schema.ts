import { byteLength, codePointCompare } from './contract-json.js';
import type { Issue, Json } from './contract-json.js';

export type Schema<T> = Readonly<{
  check: (value: Json, path: string, errors: Issue[]) => void;
  walk(value: T, path: string, visit: (name: string, value: unknown, path: string) => void): void;
}>;
export type Infer<S> = S extends Schema<infer T> ? T : never;
type Fields = Readonly<Record<string, Schema<unknown>>>;
export function issue(errors: Issue[], stage: Issue['stage'], code: string, path: string): void {
  errors.push(Object.freeze({ stage, code, path }));
}
export function scalar<T>(code: string, check: (value: Json) => boolean): Schema<T> {
  return Object.freeze({ check(value: Json, path: string, errors: Issue[]) {
    if (!check(value)) issue(errors, 'structural', code, path);
  }, walk() {} });
}
export function literal<const T extends string | boolean | number>(v: T): Schema<T> {
  return scalar('LITERAL', value => value === v);
}
export function enumeration<const T extends readonly string[]>(...values: T): Schema<T[number]> {
  return scalar('ENUM', value => typeof value === 'string' && values.includes(value));
}
export function integer(min: number, max: number): Schema<number> {
  return scalar('INTEGER_RANGE', v => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max);
}
export function list<S extends Schema<unknown>>(item: S, min: number, max: number): Schema<readonly Infer<S>[]> {
  return Object.freeze({ check(value: Json, path: string, errors: Issue[]) {
    if (!Array.isArray(value)) { issue(errors, 'structural', 'ARRAY', path); return; }
    if (value.length < min || value.length > max) { issue(errors, 'structural', 'CARDINALITY', path); return; }
    value.forEach((v, i) => item.check(v, `${path}[${i}]`, errors));
  }, walk(value: readonly Infer<S>[], path: string, visit: (name: string, value: unknown, path: string) => void) {
    value.forEach((v, i) => item.walk(v, `${path}[${i}]`, visit));
  } });
}
export function object<const R extends Fields, const O extends Fields = Record<never, never>>(
  name: string, required: R, optional: O = {} as O,
): Schema<{ readonly [K in keyof R]: Infer<R[K]> } & { readonly [K in keyof O]?: Infer<O[K]> }> {
  type T = { readonly [K in keyof R]: Infer<R[K]> } & { readonly [K in keyof O]?: Infer<O[K]> };
  const fields = { ...required, ...optional } as Fields;
  return Object.freeze({ check(value: Json, path: string, errors: Issue[]) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      issue(errors, 'structural', 'OBJECT', path); return;
    }
    const data = value as Record<string, Json>;
    for (const key of Object.keys(data).sort(codePointCompare)) {
      if (!Object.hasOwn(fields, key)) issue(errors, 'structural', 'UNKNOWN_PROPERTY', `${path}.${key}`);
    }
    for (const key of Object.keys(required)) if (!Object.hasOwn(data, key)) issue(errors, 'structural', 'REQUIRED', `${path}.${key}`);
    for (const key of Object.keys(fields)) if (Object.hasOwn(data, key)) fields[key].check(data[key], `${path}.${key}`, errors);
  }, walk(value: T, path: string, visit: (name: string, value: unknown, path: string) => void) {
    visit(name, value, path);
    for (const key of Object.keys(fields)) if (Object.hasOwn(value, key)) fields[key].walk((value as Record<string, unknown>)[key], `${path}.${key}`, visit);
  } });
}
const match = (pattern: RegExp, value: string): boolean => pattern.exec(value)?.[0] === value;
const text = (max: number) => scalar<string>('TEXT', v => typeof v === 'string' && v.length > 0 && !v.includes('\0') && byteLength(v) <= max);
function time(value: Json): boolean {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);
  if (!m || m[0] !== value) return false;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= days[mo - 1] && h <= 23 && mi <= 59 && s <= 60
    && (s !== 60 || (h === 23 && mi === 59 && ((mo === 6 && d === 30) || (mo === 12 && d === 31))));
}
export const scalars = Object.freeze({
  ID: scalar<string>('ID', v => typeof v === 'string' && v.length <= 128 && match(/[A-Za-z0-9][A-Za-z0-9._-]*/, v)),
  Text: text(4096), LongText: text(65536), UInt: integer(0, Number.MAX_SAFE_INTEGER),
  Hash: scalar<string>('HASH', v => typeof v === 'string' && match(/[a-f0-9]{64}/, v)),
  GitOID: scalar<string>('GIT_OID', v => typeof v === 'string' && match(/(?:[a-fA-F0-9]{64}|[a-fA-F0-9]{40})/, v)),
  Time: scalar<string>('TIME', time),
  Path: scalar<string>('PATH', v => typeof v === 'string' && byteLength(v) <= 4096 && v.length > 0
    && !v.startsWith('/') && !v.includes('\\') && !v.includes('\0') && !/^[A-Za-z]:/.test(v)
    && v.split('/').every(p => p !== '' && p !== '.' && p !== '..')),
  // Root identity/realpath is external; this check only establishes lexical absoluteness.
  Root: scalar<string>('ROOT', v => typeof v === 'string' && v.length > 0 && byteLength(v) <= 4096 && !v.includes('\0')
    && (/^\//.test(v) || /^[A-Za-z]:[\\/]/.test(v) || /^\\\\[^\\]+\\[^\\]+/.test(v))
    && !v.split(/[\\/]/).some(p => p === '.' || p === '..')),
  State: enumeration('PENDING', 'ANALYZING', 'READY', 'IMPLEMENTING', 'TESTING', 'REVIEWING', 'REWORK', 'BLOCKED', 'AWAITING_HUMAN', 'COMPLETED', 'FAILED'),
  Role: enumeration('Scout', 'Developer', 'Reviewer', 'Oracle'),
});
