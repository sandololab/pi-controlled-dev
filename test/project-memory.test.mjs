import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,readdirSync,chmodSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const m=await import('../src/project-memory.ts');
const {ProjectMemoryRepository:Repository}=await import('../src/project-memory-repository.ts');
const c=await import('../src/project-memory-context.ts');
const {DurableStore}=await import('../src/store.ts');
const {LockManager}=await import('../src/lock-manager.ts');
const {hashCanonical,hashBytes,canonicalize}=await import('../src/contracts.ts');
const {presentTrustedConfirmation}=await import('../src/trusted-confirmation.ts');
const {RpcAdapter}=await import('../src/pi-subagents-rpc.ts');
const {rebuildProjectMemoryView,rebuildHumanView}=await import('../src/human-repository.ts');
const {recoveryFixture}=await import('./recovery-fixture.mjs');
// UI and provider doubles below verify mechanism branches; they do not certify real human/provider use.
const ui=(yes=true)=>({mode:'tui',sessionManager:{getSessionId:()=> 'human-test-session'},ui:{confirm:async()=>yes,notify(){}}});
function fixture(t){const root=mkdtempSync(join(tmpdir(),'project-memory-')),data=join(root,'data'),repo=join(root,'repo');mkdirSync(data);mkdirSync(repo);mkdirSync(join(repo,'src'));mkdirSync(join(repo,'src','storage'));writeFileSync(join(repo,'src','storage','store.ts'),'export const persistence = 1;\n');
 t.after(()=>rmSync(root,{recursive:true,force:true}));const memory=Repository.open(data,repo,()=> 'ACCEPT',{create:true});return {root,data,repo,memory};}
function proposal(kind='software-adr',patch={}){const contents={
 'software-adr':{decisionKey:'storage-boundary',context:'Il progetto ha già un repository per la persistenza.',decision:'Riutilizzare ScenarioRepository per ogni accesso ai dati.',rationale:'Un unico confine rende verificabili i salvataggi.',consequences:['La nuova logica passa dal repository esistente.'],alternatives:['Accesso diretto ai file, escluso perché duplicherebbe il confine.']},
 'technical-lesson':{problemKey:'atomic-write',problem:'Un salvataggio interrotto ha lasciato dati incompleti.',cause:'Il file corrente veniva sovrascritto prima di completare la scrittura.',rule:'Scrivere e sincronizzare una nuova versione prima della sostituzione atomica.',loadWhen:{terms:['persistenza'],paths:['src/storage']},invalidatedWhen:['Il confine di persistenza o la garanzia di atomicità cambia.']},
 'project-convention':{convention:'Usare nomi espliciti per i metodi del repository.',rationale:'Il chiamante deve capire che cosa viene persistito.'},
 'technical-constraint':{constraint:'Non creare un secondo percorso di scrittura dei dati.',rationale:'I controlli di integrità devono restare sul confine esistente.',consequences:['Il nuovo comportamento riusa il repository.']}};
 return {recordKind:kind,title:kind==='software-adr'?'Un solo confine per la persistenza':kind==='technical-lesson'?'Salvataggi interrotti senza dati parziali':kind==='project-convention'?'Nomi comprensibili':'Un solo percorso di scrittura',scope:{kind:'component',path:'src/storage'},content:contents[kind],evidenceRefs:[],relatedTaskRefs:['task-1'],relatedRecordRefs:[],...patch};}
async function accepted(memory,p=proposal(),origin={role:'host',taskId:'task-1'}){const r=memory.propose(p,origin);await memory.decide(ui(),r.recordId,p.recordKind==='software-adr'?'ACCEPTED':'ACTIVE');return memory.entries().find(e=>e.record.recordId===r.recordId).record;}
function query(patch={}){return {taskId:'task-8',role:'Scout',assignmentId:'dispatch-task-8-scout',objective:'Migliorare la persistenza nel componente storage',files:['src/storage/store.ts'],...patch};}
function evidence(memory,data,repo){const store=DurableStore.create(data,repo,'task-A',()=> 'ACCEPT'),ref=store.put('validation-write','atomic-write passed');return {kind:'validation',id:ref.id,taskId:'task-A',relativePath:`tasks/task-A/${ref.relativeStorePath}`,digest:ref.digest};}

test('PM schema is closed and proposals cannot set lifecycle, authority or Systemist kinds',()=>{
 assert.ok(m.validateMemoryProposal(proposal()));
 for(const patch of [{status:'ACCEPTED'},{authorityKind:'software-decision'},{recordKind:'system-adr'},{scope:{kind:'repository',path:'src'}}])assert.throws(()=>m.validateMemoryProposal({...proposal(),...patch}));
 assert.throws(()=>m.validateMemoryProposal(proposal('technical-lesson',{content:{...proposal('technical-lesson').content,loadWhen:{terms:[],paths:[]}}})),/LOAD_WHEN/);
});
const posix=(...parts)=>['',...parts].join('/');
for(const path of [posix('home','user','file'),posix('media','volume','file'),posix('run','media','user','disk'),posix('tmp','file'),['C:','Users','person','file'].join(String.fromCharCode(92)),'../outside','a/../b','a'+String.fromCharCode(92)+'b'])test(`PM rejects nonportable scope ${path}`,()=>assert.throws(()=>m.validateMemoryProposal(proposal('software-adr',{scope:{kind:'directory',path}}))));
test('PM portability applies to narrative and evidence, not only scope',()=>{
 for(const prefix of ['home','etc','opt','var'])assert.throws(()=>m.validateMemoryProposal(proposal('software-adr',{title:'Leggere '+posix(prefix,'person','config')})),/ABSOLUTE_PATH/);
 assert.throws(()=>m.validateMemoryProposal(proposal('software-adr',{evidenceRefs:[{kind:'artifact',id:'x',taskId:'task-1',relativePath:'tasks/task-2/artifacts/x',digest:'a'.repeat(64)}]})),/EVIDENCE_PATH/);
});
test('PM canonical record identity is independent of Markdown naming and persists all revisions',async t=>{
 const {memory}=fixture(t),p=memory.propose(proposal(),{role:'Developer',taskId:'task-1'});assert.match(p.recordId,/^SAD-/);assert.equal(p.status,'PROPOSED');assert.equal(p.revision,1);assert.equal(p.contentDigest,m.recordDigest(p));
 assert.equal(p.contentDigest,hashCanonical(Object.fromEntries(Object.entries(p).filter(([k])=>k!=='contentDigest').reverse())));
 await memory.decide(ui(),p.recordId,'ACCEPTED');const r=memory.entries()[0].record;assert.equal(r.recordId,p.recordId);assert.equal(r.revision,2);assert.deepEqual(memory.history(p.recordId).map(r=>r.status),['PROPOSED','ACCEPTED']);
 assert.throws(()=>m.validateMemoryRecord({...r,title:'tampered'}),/RECORD_INVALID/);
});
test('PM all IDs are collision-safe exclusive artifacts; IDs never come from a numeric max',t=>{
 const {memory}=fixture(t),ids=Array.from({length:20},()=>memory.propose(proposal(),{role:'host'}).recordId);assert.equal(new Set(ids).size,20);
 for(const id of ids)assert.equal(memory.history(id).length,1);
});
test('PM native approval binds exact decision and promotes only after persistent receipt',async t=>{
 const {memory}=fixture(t),p=memory.propose(proposal(),{role:'Developer'});let shown;
 const ctx=ui();ctx.ui.confirm=async(title,content)=>{shown={title,content};assert.equal(memory.entries()[0].record.status,'PROPOSED');return true};
 await memory.decide(ctx,p.recordId,'ACCEPTED');assert.match(shown.content,/ScenarioRepository/);assert.match(shown.content,/ACCEPTED/);
 const index=JSON.parse(memory.store.read(memory.store.readProjectIndex()));assert.equal(index.confirmations.length,1);
 const packet=JSON.parse(memory.store.read(index.confirmations[0]));assert.equal(packet.receipt.decision,'APPROVE');assert.equal(packet.request.payload.changes[0].recordId,p.recordId);
});
test('PM cancellation and headless refuse architecture acceptance',async t=>{
 const {memory}=fixture(t),p=memory.propose(proposal(),{role:'host'});assert.equal(await memory.decide(ui(false),p.recordId,'ACCEPTED'),undefined);assert.equal(memory.entries()[0].record.status,'PROPOSED');
 await assert.rejects(()=>memory.decide({...ui(),mode:'rpc'},p.recordId,'ACCEPTED'),/HUMAN_CHANNEL_UNAVAILABLE/);assert.equal(memory.entries()[0].record.status,'PROPOSED');
});
test('PM proposal content, revisions and store changes invalidate a pending native decision',async t=>{
 const {memory}=fixture(t),p=memory.propose(proposal(),{role:'host'}),request=memory.prepareDecision(p.recordId,'ACCEPTED'),receipt=await presentTrustedConfirmation(ui(),request);
 memory.propose(proposal('project-convention'),{role:'Reviewer'});assert.throws(()=>memory.applyDecision(request,receipt),/PROJECT_MEMORY_STALE/);assert.equal(memory.entries().find(e=>e.record.recordId===p.recordId).record.status,'PROPOSED');
 assert.throws(()=>memory.applyDecision(request,receipt),/DECISION_INVALID/);
});
test('PM receipt copying, diagnostic booleans and unregistered requests cannot accept memory',async t=>{
 const {memory}=fixture(t),p=memory.propose(proposal(),{role:'host'}),q=memory.prepareDecision(p.recordId,'ACCEPTED'),r=await presentTrustedConfirmation(ui(),q);
 assert.throws(()=>memory.applyDecision(q,JSON.parse(JSON.stringify(r))),/RECEIPT_INVALID/);
 const other=memory.prepareDecision(p.recordId,'ACCEPTED');assert.throws(()=>memory.applyDecision(other,{humanAccepted:true}),/RECEIPT_INVALID/);
 assert.throws(()=>memory.applyDecision(JSON.parse(JSON.stringify(other)),r),/DECISION_INVALID/);
});
test('PM explicit supersession commits both sides atomically and preserves navigable history',async t=>{
 const {memory}=fixture(t),old=await accepted(memory),next=memory.propose(proposal('software-adr',{content:{...proposal().content,decision:'Riutilizzare la nuova versione di ScenarioRepository.'}}),{role:'host'});
 await memory.decide(ui(),next.recordId,'ACCEPTED',old.recordId);const entries=memory.entries();
 assert.equal(entries.find(e=>e.record.recordId===old.recordId).record.status,'SUPERSEDED');assert.deepEqual(entries.find(e=>e.record.recordId===old.recordId).record.supersededBy,[next.recordId]);
 const selection=c.selectProjectMemory(memory,query());assert.deepEqual(selection.selected.map(s=>s.record.recordId),[next.recordId]);assert.equal(memory.history(old.recordId).length,3);
 const files=rebuildProjectMemoryView(memory);const previous=files.find(f=>f.includes(old.recordId)&&f.startsWith('Architecture/'));assert.match(readFileSync(join(memory.projectRoot,'human',previous),'utf8'),new RegExp(next.recordId));
});
test('PM cannot create SUPERSEDED without a valid replacement or supersede a different kind',async t=>{
 const {memory}=fixture(t),old=await accepted(memory),proposalId=memory.propose(proposal('project-convention'),{role:'host'}).recordId;
 assert.throws(()=>memory.prepareDecision(old.recordId,'SUPERSEDED'),/LIFECYCLE/);assert.throws(()=>memory.prepareDecision(proposalId,'ACTIVE',old.recordId),/SUPERSESSION/);
});
test('PM ADR deprecation preserves history and filters current retrieval',async t=>{
 const {memory}=fixture(t),r=await accepted(memory);await memory.decide(ui(),r.recordId,'DEPRECATED');assert.equal(memory.entries()[0].record.status,'DEPRECATED');assert.equal(c.selectProjectMemory(memory,query()).selected.length,0);assert.equal(memory.history(r.recordId).length,3);
});
test('PM explicit overlapping decision keys conflict; host never chooses a winner',async t=>{
 const {memory}=fixture(t);await accepted(memory);await accepted(memory,proposal('software-adr',{scope:{kind:'repository'},content:{...proposal().content,decision:'Usare un altro accesso ai dati.'}}));
 assert.throws(()=>c.selectProjectMemory(memory,query()),/PROJECT_MEMORY_CONFLICT/);
});
test('PM distinct keys and nonoverlapping scopes are not conflicts',async t=>{
 const {memory}=fixture(t);await accepted(memory);await accepted(memory,proposal('software-adr',{scope:{kind:'directory',path:'src/other'}}));assert.equal(c.selectProjectMemory(memory,query()).selected.length,1);
});
test('PM lesson starts UNVERIFIED and needs retained evidence plus explicit activation',async t=>{
 const {memory,data,repo}=fixture(t),p=memory.propose(proposal('technical-lesson'),{role:'Reviewer',taskId:'task-A'});assert.equal(p.status,'UNVERIFIED');assert.throws(()=>memory.prepareDecision(p.recordId,'ACTIVE'),/EVIDENCE_STALE/);
 const e=evidence(memory,data,repo),lesson=memory.propose(proposal('technical-lesson',{evidenceRefs:[e]}),{role:'Developer',taskId:'task-A'});assert.equal(c.selectProjectMemory(memory,query()).selected.length,0);
 await memory.decide(ui(),lesson.recordId,'ACTIVE');const selected=c.selectProjectMemory(memory,query());assert.equal(selected.selected[0].record.recordId,lesson.recordId);assert.equal(selected.selected[0].reference.authorityKind,'advisory');
});
test('PM stale lesson evidence is excluded and host demotion requires fresh explicit reactivation',async t=>{
 const {memory,data,repo}=fixture(t),e=evidence(memory,data,repo),r=await accepted(memory,proposal('technical-lesson',{evidenceRefs:[e]}));const file=join(memory.projectRoot,e.relativePath);chmodSync(file,0o600);writeFileSync(file,'different evidence');
 assert.equal(c.selectProjectMemory(memory,query()).selected.length,0);assert.deepEqual(memory.entries()[0].staleEvidence,[e.id]);assert.equal(memory.invalidateLessons()[0].status,'UNVERIFIED');
 assert.throws(()=>memory.prepareDecision(r.recordId,'ACTIVE'),/EVIDENCE_STALE/);assert.equal(memory.history(r.recordId).length,3);
});
test('PM accepted ADR keeps its decision when evidence changes and reports stale evidence',async t=>{
 const {memory,data,repo}=fixture(t),e=evidence(memory,data,repo),r=await accepted(memory,proposal('software-adr',{evidenceRefs:[e]}));const file=join(memory.projectRoot,e.relativePath);chmodSync(file,0o600);writeFileSync(file,'changed');
 memory.invalidateLessons();const selected=c.selectProjectMemory(memory,query());assert.equal(selected.selected[0].record.status,'ACCEPTED');assert.deepEqual(selected.selected[0].staleEvidence,[e.id]);assert.equal(selected.selected[0].record.contentDigest,r.contentDigest);
});
test('PM lesson explicit loadWhen excludes a relevant scope with unrelated objective and paths',async t=>{
 const {memory,data,repo}=fixture(t),e=evidence(memory,data,repo);await accepted(memory,proposal('technical-lesson',{scope:{kind:'repository'},evidenceRefs:[e],content:{...proposal('technical-lesson').content,loadWhen:{terms:['salvataggio'],paths:['src/storage']}}}));
 assert.equal(c.selectProjectMemory(memory,query({objective:'Cambiare colori',files:['src/ui.ts']})).selected.length,0);
 assert.equal(c.selectProjectMemory(memory,query({objective:'salvataggio',files:['src/ui.ts']})).selected.length,1);
});
test('PM retirement and lesson supersession retain tombstones',async t=>{
 const {memory,data,repo}=fixture(t),e=evidence(memory,data,repo),old=await accepted(memory,proposal('technical-lesson',{evidenceRefs:[e]}));
 const p=memory.propose(proposal('technical-lesson',{evidenceRefs:[e]}),{role:'host'});await memory.decide(ui(),p.recordId,'ACTIVE',old.recordId);await memory.decide(ui(),p.recordId,'RETIRED');assert.equal(c.selectProjectMemory(memory,query()).selected.length,0);assert.equal(memory.entries().length,2);
});
for(const kind of ['project-convention','technical-constraint'])test(`PM ${kind} lifecycle, authority and contextual expectation`,async t=>{
 const {memory}=fixture(t),record=await accepted(memory,proposal(kind)),selection=c.selectProjectMemory(memory,query());assert.equal(record.status,'ACTIVE');assert.equal(selection.selected[0].record.recordKind,kind);assert.match(c.memoryDesignExpectations(selection)[0],new RegExp(record.recordId));await memory.decide(ui(),record.recordId,'RETIRED');assert.equal(c.selectProjectMemory(memory,query()).selected.length,0);
});
test('PM repository configuration references avoid automatic rule duplication',async t=>{
 const {memory,repo}=fixture(t);writeFileSync(join(repo,'tsconfig.json'),'{}');const source={kind:'repository-source',id:'ts-config',relativePath:'tsconfig.json',digest:hashBytes(Buffer.from('{}'))};
 const record=await accepted(memory,proposal('project-convention',{scope:{kind:'repository'},content:{convention:'Seguire la configurazione TypeScript corrente.',rationale:'La fonte già esprime la convenzione.',sourcePath:'tsconfig.json'},evidenceRefs:[source]}));assert.equal(memory.staleEvidence(record).length,0);
 writeFileSync(join(repo,'tsconfig.json'),'{"strict":true}');assert.equal(memory.staleEvidence(record).length,1);
});
test('PM scope matching is relative and component/directory boundaries do not match prefix siblings',()=>{
 assert.equal(m.scopeMatches({kind:'component',path:'src/storage'},['src/storage/store.ts']),true);assert.equal(m.scopeMatches({kind:'directory',path:'src/storage'},['src/storage-other/store.ts']),false);assert.equal(m.scopeMatches({kind:'repository'},[]),true);assert.equal(m.scopeMatches({kind:'component',path:'src/storage'},['src']),true);
});
test('PM bounded deterministic retrieval records exact bytes, characters and omitted records',async t=>{
 const {memory}=fixture(t);for(let i=0;i<12;i++)await accepted(memory,proposal('project-convention',{title:`Convenzione ${i}`}));
 const a=c.selectProjectMemory(memory,query()),b=c.selectProjectMemory(memory,query());assert.deepEqual(a,b);assert.ok(a.selected.length<=m.MEMORY_LIMITS.Scout.records);assert.ok(a.omittedRecordIds.length>0);assert.equal(a.totalBytes,Buffer.byteLength(a.text));assert.equal(a.totalCharacters,a.text.length);assert.ok(a.totalBytes<=m.MEMORY_LIMITS.Scout.bytes);
});
test('PM Reviewer preserves Developer binding identities or rejects stale supersession',async t=>{
 const {memory}=fixture(t),r=await accepted(memory),developer=c.selectProjectMemory(memory,query({role:'Developer'})),requiredBinding=developer.selected.map(s=>s.reference);
 const reviewer=c.selectProjectMemory(memory,query({role:'Reviewer',requiredBinding}));assert.deepEqual(reviewer.selected.map(s=>s.reference),developer.selected.map(s=>s.reference));
 const p=memory.propose(proposal(),{role:'host'});await memory.decide(ui(),p.recordId,'ACCEPTED',r.recordId);assert.throws(()=>c.selectProjectMemory(memory,query({role:'Reviewer',requiredBinding})),/CONTEXT_STALE/);
});
test('PM Task1 → Task8 crosses unrelated tasks and excludes an accepted ADR outside scope',async t=>{
 const {memory,data,repo}=fixture(t),first=await accepted(memory,proposal(),{role:'Developer',taskId:'task-1'});await accepted(memory,proposal('software-adr',{scope:{kind:'component',path:'src/unrelated'},content:{...proposal().content,decisionKey:'unrelated-boundary'}}));
 for(let i=2;i<=7;i++){const task=DurableStore.create(data,repo,`task-${i}`,()=> 'ACCEPT');task.put('unrelated-task',`Task ${i} is unrelated`);assert.equal(c.selectProjectMemory(memory,query({taskId:`task-${i}`,objective:'Correggere UI',files:['src/ui.ts']})).selected.length,0)}
 const planning=c.selectProjectMemory(memory,query());assert.match(c.memoryDesignExpectations(planning)[0],/ScenarioRepository/);
 for(const role of ['Scout','Developer','Reviewer']){const selected=c.selectProjectMemory(memory,query({role}));assert.equal(selected.selected.length,1);assert.equal(selected.selected[0].record.recordId,first.recordId);assert.equal(selected.selected[0].reference.revision,2);assert.equal(selected.selected[0].reference.digest,first.contentDigest)}
});
test('PM store/reload in a fresh real process retains lifecycle, revisions and digests',async t=>{
 const {memory,data,repo}=fixture(t),record=await accepted(memory),before=c.selectProjectMemory(memory,query());
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {installSourceLoader} from './test/load-source.mjs';installSourceLoader();const {ProjectMemoryRepository}=await import('./src/project-memory-repository.ts');const {selectProjectMemory}=await import('./src/project-memory-context.ts');const r=ProjectMemoryRepository.open(process.argv[1],process.argv[2],()=> 'ACCEPT');console.log(JSON.stringify(selectProjectMemory(r,JSON.parse(process.argv[3]))));`,data,repo,JSON.stringify(query())],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),before);assert.equal(record.status,'ACCEPTED');
});
test('PM unindexed orphan record revisions are ignored after interrupted persistence',async t=>{
 const {memory}=fixture(t),r=await accepted(memory),prior=memory.store.readProjectIndex();const orphan={...r,revision:3,status:'DEPRECATED',authorityKind:'historical'};orphan.contentDigest=m.recordDigest(orphan);memory.store.put(`${r.recordId}-r3`,canonicalize(orphan),m.MEMORY_MEDIA);
 assert.deepEqual(memory.store.readProjectIndex(),prior);assert.equal(memory.entries()[0].record.revision,2);
});
test('PM workspace concurrency and CAS use existing lock authority',t=>{
 const {memory,data,repo}=fixture(t),manager=new LockManager(data,'task-owner','task-generation'),locks=manager.acquire('task',repo);assert.throws(()=>memory.propose(proposal(),{role:'host'}),/WORKSPACE_LOCK_UNAVAILABLE/);
 const owned=Repository.open(data,repo,()=> 'ACCEPT',{manager,workspaceLock:locks.workspace});assert.ok(owned.propose(proposal(),{role:'Scout'}));manager.releaseAll(locks);
 assert.throws(()=>owned.propose(proposal(),{role:'host'}),/LOCK_REQUIRED/);
});
test('PM tampered index, record bytes or forged active status fail closed',async t=>{
 const {memory}=fixture(t),r=await accepted(memory),entry=memory.entries()[0],path=join(memory.store.root,entry.ref.relativeStorePath);chmodSync(path,0o600);writeFileSync(path,'{}');assert.throws(()=>memory.entries(),/INTEGRITY/);
});
test('PM standalone namespace cannot become a second task ledger',t=>{
 const {memory}=fixture(t);memory.propose(proposal(),{role:'host'});assert.equal(existsSync(join(memory.store.root,'events.jsonl')),false);assert.equal(existsSync(join(memory.store.root,'state.json')),false);assert.equal(existsSync(join(memory.store.root,'spec.json')),false);
});
test('PM Systemist reference envelope permits references but rejects cross-owner writes',()=>{
 const ref={schemaVersion:1,ownerPackage:'Systemist',projectId:'a'.repeat(64),recordKind:'system-adr',recordId:'system-adr-1',revision:1,status:'ACCEPTED',scope:{kind:'repository'},authorityKind:'system-architecture',digest:'b'.repeat(64)};assert.ok(m.validateMemoryReference(ref));
 assert.throws(()=>m.validateMemoryReference({...ref,ownerPackage:'pi-controlled-dev'}),/OWNERSHIP/);assert.throws(()=>m.validateMemoryReference({...ref,recordKind:'software-adr'}),/OWNERSHIP/);
});
test('PM Markdown is a deterministic projection and manual status edits cannot accept a proposal',t=>{
 const {memory}=fixture(t),r=memory.propose(proposal(),{role:'host'}),first=rebuildProjectMemoryView(memory),vault=join(memory.projectRoot,'human');const path=join(vault,first.find(f=>f.startsWith('Architecture/'))),original=readFileSync(path,'utf8');
 assert.match(original,/## Context/);assert.match(original,/## Why this decision was made/);assert.match(original,/authority: "proposal"/);assert.doesNotMatch(original,/"decisionKey":|"schemaVersion":/);
 writeFileSync(path,original.replace('status: "PROPOSED"','status: "ACCEPTED"'));assert.equal(memory.entries()[0].record.status,'PROPOSED');rebuildProjectMemoryView(memory);assert.equal(readFileSync(path,'utf8'),original);assert.equal(memory.history(r.recordId).length,1);
});
test('PM lesson, convention and constraint projections use narrative and preserve personal Notes',async t=>{
 const {memory,data,repo}=fixture(t),e=evidence(memory,data,repo);await accepted(memory,proposal('technical-lesson',{evidenceRefs:[e]}));await accepted(memory,proposal('project-convention'));await accepted(memory,proposal('technical-constraint'));
 const files=rebuildProjectMemoryView(memory),vault=join(memory.projectRoot,'human'),note=join(vault,files.find(f=>f.startsWith('Notes/')));writeFileSync(note,'Appunto personale da conservare.');rebuildProjectMemoryView(memory);assert.equal(readFileSync(note,'utf8'),'Appunto personale da conservare.');
 assert.ok(files.includes('Indexes/Project Memory.base'));
 for(const prefix of ['Lessons/Lezione TL-','Conventions/Convenzione PC-','Constraints/Vincolo TC-'])assert.ok(files.some(f=>f.startsWith(prefix)),`Preserve historical note path: ${prefix}`);
 const home=join(vault,'Home.md');writeFileSync(home,'# Home\n\n## Memoria tecnica del progetto\n\nVecchio indice generato.\n\n## Personal notes\n\nAppunto da conservare.\n');rebuildProjectMemoryView(memory);rebuildProjectMemoryView(memory);
 const rebuilt=readFileSync(home,'utf8');assert.equal((rebuilt.match(/## Project technical memory/g)||[]).length,1);assert.doesNotMatch(rebuilt,/## Memoria tecnica del progetto|Vecchio indice generato/);assert.match(rebuilt,/Appunto da conservare/);
 const lesson=files.find(f=>f.startsWith('Lessons/'));assert.match(readFileSync(join(vault,lesson),'utf8'),/## When it is no longer valid/);
 for(const folder of ['Conventions','Constraints'])assert.ok(files.some(f=>f.startsWith(folder+'/')));
 for(const f of files)assert.doesNotMatch(readFileSync(join(vault,f),'utf8'),new RegExp(['(?:/'+['home','tmp','run/media'].join('|/')+')/','[A-Za-z][:]'+String.fromCharCode(92).repeat(4)+'Users'].join('|')));
});
test('PM ordinary rebuildHumanView includes memory and links real task notes',async t=>{
 const root=mkdtempSync(join(tmpdir(),'memory-historical-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const f=recoveryFixture(root),owned=Repository.open(f.data,f.repo,()=> 'ACCEPT',{create:true,manager:f.manager,workspaceLock:f.locks.workspace});owned.propose(proposal('software-adr',{relatedTaskRefs:['task']}),{role:'host',taskId:'task'});
 rebuildHumanView(f.storeRoot);rebuildHumanView(f.storeRoot);const vault=join(owned.projectRoot,'human');const file=readdirSync(join(vault,'Architecture'))[0];assert.match(readFileSync(join(vault,'Architecture',file),'utf8'),/\[\[Task task\]\]/);assert.match(readFileSync(join(vault,'Home.md'),'utf8'),/Indexes\/Project Memory/);f.manager.releaseAll(f.locks);
});
test('PM historical tasks without memory remain readable and no namespace is created on recall',t=>{
 const root=mkdtempSync(join(tmpdir(),'memory-optional-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const f=recoveryFixture(root);assert.equal(Repository.open(f.data,f.repo,()=> 'ACCEPT'),undefined);assert.equal(DurableStore.load(f.storeRoot).state.state,'PENDING');rebuildHumanView(f.storeRoot);assert.equal(existsSync(join(dirname(dirname(f.storeRoot)),'memory')),false);f.manager.releaseAll(f.locks);
});
test('PM evidence symlink escape is stale and cannot activate a lesson',async t=>{
 const {memory,data,repo}=fixture(t),e=evidence(memory,data,repo),r=await accepted(memory,proposal('technical-lesson',{evidenceRefs:[e]}));const artifacts=dirname(join(memory.projectRoot,e.relativePath));rmSync(artifacts,{recursive:true});const outside=join(data,'outside');mkdirSync(outside);writeFileSync(join(outside,e.id),'atomic-write passed');symlinkSync(outside,artifacts);assert.equal(memory.staleEvidence(r).length,1);assert.equal(c.selectProjectMemory(memory,query()).selected.length,0);
});
test('PM optional structured sidecar is stripped from normative result and cannot promote status',()=>{
 const r={schemaVersion:1,taskId:'task',memoryProposals:[proposal()]};const side=m.splitMemoryProposals(r);assert.equal(side.proposals.length,1);assert.equal(Object.hasOwn(side.result,'memoryProposals'),false);assert.throws(()=>m.splitMemoryProposals({...r,memoryProposals:[{...proposal(),status:'ACCEPTED'}]}),/SCHEMA/);assert.throws(()=>m.splitMemoryProposals({...r,memoryProposals:Array(5).fill(proposal())}),/PROPOSAL_LIMIT/);
});
test('PM context identity cannot be forged or rebound to a different role/task',async t=>{
 const {memory}=fixture(t);await accepted(memory);const prepared=c.prepareMemoryContext(c.selectProjectMemory(memory,query()),memory.store);assert.throws(()=>c.memoryDispatch(JSON.parse(JSON.stringify(prepared)),query(),{}),/CONTEXT_INVALID/);assert.throws(()=>c.memoryDispatch(prepared,{...query(),role:'Reviewer'},{}),/CONTEXT_INVALID/);
});
class Bus {map=new Map();on(name,fn){const set=this.map.get(name)??new Set();set.add(fn);this.map.set(name,set);return()=>set.delete(fn)}emit(name,v){for(const fn of [...(this.map.get(name)??[])])fn(v)}}
for(const role of ['Scout','Developer','Reviewer'])test(`PM ${role} exact injection has provider-correlated receipt, not a read counter`,async t=>{
 const {memory}=fixture(t);const record=await accepted(memory),q=query({role,assignmentId:`dispatch-${role}`}),selection=c.selectProjectMemory(memory,q),receipts=[];
 const prepared=c.prepareMemoryContext(selection,memory.store,(ref,receipt)=>receipts.push({ref,receipt})),transport=c.memoryDispatch(prepared,q,{}),bus=new Bus();let sent;
 bus.on('subagents:rpc:v1:request',request=>{const reply=data=>bus.emit('subagents:rpc:v1:reply:'+request.requestId,{version:1,requestId:request.requestId,method:request.method,success:true,data});
  if(request.method==='ping')reply({version:1,methods:['ping','spawn','status','interrupt','stop','resume'],capabilities:{status:true,asyncSpawn:true,steer:true,interrupt:true,stop:true,resume:true},events:{request:'subagents:rpc:v1:request',replyPrefix:'subagents:rpc:v1:reply:',ready:'subagents:rpc:v1:ready',asyncComplete:'subagents:complete'},session:{sessionId:'owner',sessionFile:null}});
  if(request.method==='spawn'){sent=request.params.task;reply({text:'spawned',details:{asyncId:'real-rpc-fixture-run',runId:'real-rpc-fixture-run'}});}});
 const rpc=new RpcAdapter(bus,{sessionId:'owner',environmentHash:'a'.repeat(64),piVersion:'test',subagentsVersion:'test'});t.after(()=>rpc.dispose());assert.equal((await rpc.handshake()).status,'VERIFIED');
 assert.equal((await rpc.spawn({agent:`controlled.${role.toLowerCase()}`,task:'Ordinary task'+transport.text,cwd:memory.repoRoot,timeoutMs:1000,outputSchema:{type:'object',additionalProperties:false,properties:{},required:[]}},transport.options)).ok,true);
 assert.equal(sent,'Ordinary task\n'+selection.text);const ack=receipts.find(r=>r.receipt.delivery==='PROVIDER_ACKNOWLEDGED');assert.ok(ack);assert.equal(ack.receipt.records[0].recordId,record.recordId);assert.equal(ack.receipt.records[0].revision,2);assert.equal(ack.receipt.records[0].digest,record.contentDigest);assert.equal(ack.receipt.contextDigest,selection.digest);assert.equal(ack.receipt.totalBytes,Buffer.byteLength(selection.text));assert.equal(JSON.parse(memory.store.read(ack.ref)).dispatchId,ack.receipt.dispatchId);assert.deepEqual(c.readMemoryContextReceipt(memory.store,ack.ref),ack.receipt);
});
test('PM normative state and permission contracts remain 11 states / 43 transitions',async()=>{
 const state=await import('../src/state-machine.ts');assert.equal(state.STATES.length,11);assert.equal(state.TRANSITIONS.length,43);
 for(const [role,expected] of [['scout',['read']],['developer',['edit','read','write']],['reviewer',['read']]]){const runtime=await import(`../src/controlled-${role}.ts`);assert.deepEqual(runtime[`${role.toUpperCase()}_RUNTIME_DEFINITION`].tools,expected);assert.equal(runtime[`${role.toUpperCase()}_LAUNCH_CONTRACT`].inheritProjectContext,false)}
 const {packageGuidance}=await import('../src/package-guidance.ts');assert.match(packageGuidance('project-memory'),/not authority/);
});

test('PM missing index target fails closed instead of treating a corrupted namespace as empty',t=>{
 const {memory}=fixture(t);memory.propose(proposal(),{role:'host'});const ref=memory.store.readProjectIndex();rmSync(join(memory.store.root,ref.relativeStorePath));assert.throws(()=>memory.entries());assert.throws(()=>memory.propose(proposal(),{role:'host'}));
});
test('PM copied selection does not acquire the host dispatch capability',async t=>{
 const {memory}=fixture(t);await accepted(memory);const selection=c.selectProjectMemory(memory,query());assert.throws(()=>c.prepareMemoryContext(JSON.parse(JSON.stringify(selection)),memory.store),/CONTEXT_INVALID/);
});
test('PM crash before snapshot swap keeps both supersession sides at the prior revision',async t=>{
 const {memory,data,repo}=fixture(t),old=await accepted(memory),replacement=memory.propose(proposal(),{role:'host'}),request=memory.prepareDecision(replacement.recordId,'ACCEPTED',old.recordId),receipt=await presentTrustedConfirmation(ui(),request);
 memory.store.replaceProjectIndex=()=>{throw new Error('SIMULATED_CRASH')};assert.throws(()=>memory.applyDecision(request,receipt),/SIMULATED_CRASH/);
 const reopened=Repository.open(data,repo,()=> 'ACCEPT'),entries=reopened.entries();assert.equal(entries.find(e=>e.record.recordId===old.recordId).record.status,'ACCEPTED');assert.equal(entries.find(e=>e.record.recordId===replacement.recordId).record.status,'PROPOSED');assert.equal(reopened.history(old.recordId).length,2);
});
test('PM self-consistent ACTIVE JSON without a committed native receipt has no authority',t=>{
 const {memory}=fixture(t),p=memory.propose(proposal('project-convention'),{role:'host'}),before=memory.store.readProjectIndex(),index=JSON.parse(memory.store.read(before));
 const forged={...p,revision:2,status:'ACTIVE',authorityKind:'convention'};forged.contentDigest=m.recordDigest(forged);const ref=memory.store.put(`${p.recordId}-r2`,canonicalize(forged),m.MEMORY_MEDIA),next={...index,revision:2,records:[ref],history:[...index.history,ref]};const idx=memory.store.put('forged-index',canonicalize(next),'application/json');memory.store.replaceProjectIndex(before,idx);assert.throws(()=>memory.entries(),/APPROVAL_MISSING/);
});
test('PM current-record deletion from an otherwise valid index is rejected as lost history',t=>{
 const {memory}=fixture(t);memory.propose(proposal(),{role:'host'});const before=memory.store.readProjectIndex(),index=JSON.parse(memory.store.read(before)),next={...index,revision:index.revision+1,records:[]};const ref=memory.store.put('deleted-index',canonicalize(next),'application/json');memory.store.replaceProjectIndex(before,ref);assert.throws(()=>memory.entries(),/HISTORY_INVALID/);
});

test('PM namespace inherits the task store disclosure policy and rejected proposals leave no record',t=>{
 const {data,repo}=fixture(t),task=DurableStore.create(data,repo,'security-task',(bytes)=>Buffer.from(bytes).toString().includes('REJECT_THIS_TEXT')?'REJECT':'ACCEPT');
 const memory=Repository.open(data,repo,task.artifactInspection);
 assert.throws(()=>memory.propose(proposal('software-adr',{title:'REJECT_THIS_TEXT'}),{role:'Developer',taskId:'security-task'}),/STORE_DISCLOSURE_REJECTED/);
 assert.deepEqual(memory.entries(),[]);
});

test('PM host workflow retains exact role receipts in its existing ledger and completion closure',async t=>{
 const {restartFixture}=await import('./recovery-fixture.mjs');
 const root=mkdtempSync(join(tmpdir(),'memory-workflow-'));t.after(()=>rmSync(root,{recursive:true,force:true}));let decision;
 const f=await restartFixture(root,'FINAL_GATE',false,false,undefined,async({data,repo})=>{
   const memory=Repository.open(data,repo,()=> 'ACCEPT',{create:true});
   decision=await accepted(memory,proposal('software-adr',{scope:{kind:'repository'}}));return {proposal:proposal('project-convention',{scope:{kind:'repository'}})};
 });
 const ledger=DurableStore.load(f.storeRoot),reader={read:ref=>readFileSync(join(f.storeRoot,ref.relativeStorePath))};
 const receiptRefs=ledger.records.filter(r=>r.kind==='ArtifactRef'&&r.value.mediaType===m.MEMORY_RECEIPT_MEDIA).map(r=>r.value);
 const receipts=receiptRefs.map(ref=>c.readMemoryContextReceipt(reader,ref));
 for(const role of ['Scout','Developer','Reviewer']){
   const receipt=receipts.find(r=>r.role===role&&r.delivery==='PROVIDER_ACKNOWLEDGED');assert.ok(receipt,role);
   assert.deepEqual(receipt.records.map(r=>[r.recordId,r.revision,r.digest]),[[decision.recordId,decision.revision,decision.contentDigest]]);
   assert.ok(ledger.state.runs.some(run=>run.role===role&&run.requestId===receipt.dispatchId&&run.runId===receipt.runId));
 }
 assert.deepEqual(receipts.find(r=>r.role==='Developer'&&r.runId).records.map(({reason,...r})=>r),receipts.find(r=>r.role==='Reviewer'&&r.runId).records.map(({reason,...r})=>r));
 const packets=ledger.records.filter(r=>r.kind==='ArtifactRef'&&r.value.mediaType==='application/vnd.pi-controlled-dev.completion+json').map(r=>JSON.parse(reader.read(r.value)));
 assert.ok(packets.length);assert.ok(packets.some(p=>receiptRefs.every(ref=>p.completionEvidenceRefs.some(r=>r.id===ref.id&&r.digest===ref.digest))));
 const memory=Repository.open(f.data,f.repo,()=> 'ACCEPT');const proposed=memory.entries().find(e=>e.record.recordKind==='project-convention').record;assert.equal(proposed.status,'PROPOSED');assert.equal(proposed.origin.role,'Developer');assert.equal(proposed.origin.taskId,ledger.state.taskId);assert.ok(packets.some(p=>p.completionEvidenceRefs.some(r=>r.mediaType==='application/vnd.pi-controlled-dev.memory-proposal-reference+json')));
 assert.equal(ledger.state.state,'AWAITING_HUMAN');
});

test('PM dispatch without an archive records an exact empty receipt and creates no memory namespace',async t=>{
 const {restartFixture}=await import('./recovery-fixture.mjs');
 const root=mkdtempSync(join(tmpdir(),'empty-memory-workflow-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const f=await restartFixture(root,'READY'),ledger=DurableStore.load(f.storeRoot);
 const reader={read:ref=>readFileSync(join(f.storeRoot,ref.relativeStorePath))};
 const receipts=ledger.records.filter(r=>r.kind==='ArtifactRef'&&r.value.mediaType===m.MEMORY_RECEIPT_MEDIA).map(r=>c.readMemoryContextReceipt(reader,r.value));
 assert.ok(receipts.some(r=>r.role==='Scout'&&r.delivery==='PROVIDER_ACKNOWLEDGED'&&r.records.length===0));
 assert.equal(existsSync(join(dirname(dirname(f.storeRoot)),'memory')),false);
 assert.equal(ledger.state.state,'READY');
});
