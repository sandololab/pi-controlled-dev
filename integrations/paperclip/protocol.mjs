import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
export function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
export const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
export const sign=(key,value)=>createHmac('sha256',key).update(canonical(value)).digest('hex');
export function verify(key,packet){if(!packet||typeof packet.mac!=='string'||!/^[0-9a-f]{64}$/.test(packet.mac))return false;return timingSafeEqual(Buffer.from(sign(key,packet.value),'hex'),Buffer.from(packet.mac,'hex'));}
export const seal=(key,value)=>({value,mac:sign(key,value)});
export const safeId=s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(s);
export function redact(s){return String(s).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted token]');}

