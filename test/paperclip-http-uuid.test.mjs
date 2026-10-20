import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const source=fs.readFileSync(new URL('../integrations/paperclip/compat/http-uuid.js',import.meta.url),'utf8');
test('HTTP compatibility uses the platform CSPRNG and returns RFC 4122 v4 identifiers',()=>{
 const crypto={getRandomValues:array=>webcrypto.getRandomValues(array)};vm.runInNewContext(source,{crypto,Uint8Array});
 const ids=Array.from({length:500},()=>crypto.randomUUID());assert.equal(new Set(ids).size,500);
 for(const id of ids)assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('native secure-context UUID is preserved; absent secure randomness does not acquire a weak fallback',()=>{
 const native=()=> 'native',crypto={randomUUID:native};vm.runInNewContext(source,{crypto,Uint8Array});assert.equal(crypto.randomUUID,native);
 const absent={};vm.runInNewContext(source,{crypto:absent,Uint8Array});assert.equal(absent.randomUUID,undefined);
 vm.runInNewContext(source,{Uint8Array});
});
test('compat installer preserves a verified backup, is idempotent and refuses an unknown release',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'paperclip-http-compat-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'ui-dist','assets'),{recursive:true});fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'2026.1012.0'}));
 const html='<html><script type="module" crossorigin src="/assets/index-xCoSuYwt.js"></script></html>';
 fs.writeFileSync(path.join(root,'ui-dist','index.html'),html);
 const script=fileURLToPath(new URL('../integrations/paperclip/compat/install-http-compat.mjs',import.meta.url)),backup=path.join(root,'backup');
 const run=()=>spawnSync(process.execPath,[script,root,backup,'--apply'],{encoding:'utf8'});
 assert.equal(run().status,0);assert.equal(fs.readFileSync(path.join(backup,'index-before-http-uuid.html'),'utf8'),html);
 const installed=fs.readFileSync(path.join(root,'ui-dist','index.html'),'utf8');assert.ok(installed.includes('paperclip-http-uuid-'));assert.equal(run().status,0);assert.equal(fs.readFileSync(path.join(root,'ui-dist','index.html'),'utf8'),installed);
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'unsupported'}));assert.notEqual(run().status,0);assert.equal(fs.readFileSync(path.join(root,'ui-dist','index.html'),'utf8'),installed);
});
