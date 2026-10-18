import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {ContextInvestigationBudget,recordContextInvestigationReads,investigationQuestionHints}=await import('../src/context-investigation.ts');
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'context-reads-')),transcript=join(root,'session.jsonl');t.after(()=>rmSync(root,{recursive:true,force:true}));
 return (path,content,extra={})=>{
  const id=`read-${Math.random()}`;
  if(!path.startsWith('../')&&!extra.isError)writeFileSync(join(root,path),content);
  writeFileSync(transcript,[{message:{role:'assistant',content:[{type:'toolCall',name:'read',id,arguments:{path}}]}},{message:{role:'toolResult',toolName:'read',toolCallId:id,isError:false,content:[{type:'text',text:content}],...extra}}].map(JSON.stringify).join('\n'));
  return recordContextInvestigationReads({},transcript,root);
 };
}
test('investigations count source reads cumulatively; A-B-A and fresh IDs do not manufacture new information',t=>{
 const read=fixture(t),budget=new ContextInvestigationBudget();
 assert.deepEqual(budget.observe(read('a.py','source A')),{retry:true,attempts:1,noProgress:0,newFacts:1});
 assert.equal(budget.observe(read('b.py','source B')).newFacts,1);
 const third=budget.observe(read('a.py','source A'));assert.equal(third.newFacts,0);assert.equal(third.retry,false);
 budget.reset();const repeated=budget.observe(read('b.py','source B'));assert.equal(repeated.newFacts,0);
 assert.equal(budget.observe(read('b.py','source B')).retry,false);
});
test('failed reads, outside-repository material and model text provide no new source evidence',t=>{
 const read=fixture(t),budget=new ContextInvestigationBudget();
 assert.equal(budget.observe(read('missing.py','ENOENT',{isError:true})).newFacts,0);
 assert.equal(budget.observe(read('../outside.py','unrelated')).retry,false);
 const claimed=new ContextInvestigationBudget();
 assert.equal(claimed.observe({observations:['NEW FACT'],requestId:'fresh'}).newFacts,0);
 assert.equal(claimed.observe({observations:['rephrased'],requestId:'another'}).retry,false);
});
test('even genuinely new reads have a finite investigation count before operator clarification',t=>{
 const read=fixture(t),budget=new ContextInvestigationBudget();
 for(let i=1;i<=3;i++)assert.equal(budget.observe(read(`source${i}.py`,`value ${i}`)).retry,i<3);
});
test('large question context retains complete questions across bounded input fields',()=>{
 const questions=[{question:'Quale risultato? '+'à'.repeat(3900),why:'Manca il contratto.'}];
 const parts=investigationQuestionHints(questions);assert.ok(parts.length>2);
 assert.ok(parts.every(part=>Buffer.byteLength(part)<=4096));
 assert.deepEqual(JSON.parse(parts.slice(1).join('').split("Questions to investigate (complete): ")[1]),questions);
});
