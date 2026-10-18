import test from 'node:test';
import assert from 'node:assert/strict';
import {installSourceLoader} from './load-source.mjs';
import {fixtures,context} from './contract-fixtures.mjs';
installSourceLoader();
const json=await import('../src/contract-json.ts'),api=await import('../src/contracts.ts');
test('cached JSON remains immutable and does not waive ingress checks',()=>{
 const text='{"a":[{"value":1}]}',value=json.parseJson(text,100);
 assert.throws(()=>{value.a[0].value=2},TypeError);
 assert.deepEqual(json.parseJson(text,100),value);
 assert.throws(()=>json.parseJson(text,1),/PAYLOAD_LIMIT/);
 assert.throws(()=>json.parseJson('{"a":1,"a":2}',100),/DUPLICATE_KEY/);
 assert.throws(()=>json.copyJson(Object.freeze({get value(){return 1}})),/DESCRIPTOR/);
 assert.throws(()=>json.copyJson(new Proxy(value,{})),/PROXY/);
 const bytes=Buffer.from(text);json.parseJson(bytes,100);bytes[bytes.indexOf('1')]=50;
 assert.equal(json.parseJson(bytes,100).a[0].value,2);
});
test('cached structural checks cannot accept a changed input or foreign context',()=>{
 const f=fixtures(api),ctx=context(f);
 const result=api.validateContract('AssignmentEnvelope',f.AssignmentEnvelope,ctx);
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(api.validateContract('AssignmentEnvelope',result.value,ctx).ok,true);
 assert.equal(api.validateContract('AssignmentEnvelope',result.value,{...ctx,specId:'missing-spec'}).ok,false);
 f.AssignmentEnvelope.assignmentHash='0'.repeat(64);
 assert.equal(api.validateContract('AssignmentEnvelope',f.AssignmentEnvelope,ctx).ok,false);
});
test('canonical key ordering preserves Unicode code point order',()=>{
 const a='a😀',b='a😀zz';assert.equal(json.codePointCompare(a,b),-2);
 assert.ok(json.codePointCompare('\ue000','😀')<0);
 assert.equal(json.canonicalize({'😀':1,'\ue000':2}),'{"\ue000":2,"😀":1}');
});
