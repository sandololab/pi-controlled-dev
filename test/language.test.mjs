import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const root=fileURLToPath(new URL('../',import.meta.url));
const read=path=>readFileSync(resolve(root,path),'utf8');
const {showStatus,errorPresentation}=await import('../src/controlled-ui.ts');
const {HUMAN_LANGUAGE_GUIDANCE}=await import('../src/package-guidance.ts');

test('English status presentation reads legacy labels without translating user text or evidence',async()=>{
  let shown;
  await showStatus({notify(text){shown=text}},()=>({
    overview:'Obiettivo\nConservare il testo originale\n\nStato del task\nCompletato (COMPLETED)\nGenerazione candidata: 2\nCopia candidata: cartella/progetto\nConferma richiesta: no — nessun gate umano è attualmente aperto',
    activity:'Developer · Copia candidata prodotta\nReviewer · PASS',
    checks:'Criteri di accettazione\nIl contenuto fornito dall’utente resta identico\nScenari eseguibili\n  Ultima esecuzione: PASS',
    technical:'Evidenza originale non tradotta',
  }));
  assert.match(shown,/Objective\nConservare il testo originale/);
  assert.match(shown,/Task status\nCompleted and verified/);
  assert.match(shown,/Working copy version: 2\nSeparate working copy: cartella\/progetto/);
  assert.match(shown,/Confirmation required: no/);
  assert.match(shown,/Development · Working copy prepared\nReview · Successful outcome/);
  assert.match(shown,/Acceptance criteria\nIl contenuto fornito dall’utente resta identico\nVerification cases\n  Latest execution: check passed/);
  assert.doesNotMatch(shown,/Stato del task|Generazione candidata|Copia candidata prodotta|Ultima esecuzione|Conferma richiesta/);
});

test('English recovery explanations retain typed failures and role guidance preserves literal evidence',()=>{
  const value=errorPresentation(new Error('PAYLOAD_LIMIT'));
  assert.equal(value.code,'PAYLOAD_LIMIT');
  assert.match(value.message,/limit/);
  assert.match(HUMAN_LANGUAGE_GUIDANCE,/Human-facing fields must use clear, natural English/);
  assert.match(HUMAN_LANGUAGE_GUIDANCE,/Never translate or omit verbatim evidence/);
});

test('English and Italian documentation are paired and every relative document link resolves',()=>{
  const english=readdirSync(resolve(root,'docs')).filter(x=>x.endsWith('.md'));
  const italian=readdirSync(resolve(root,'docs/it')).filter(x=>x.endsWith('.md'));
  assert.deepEqual(italian.sort(),[...english,'USER-MANUAL.md'].sort());
  for(const name of english){assert.match(read(`docs/${name}`),/Italiano/);assert.match(read(`docs/it/${name}`),/English/)}
  for(const file of ['README.md','USER-MANUAL.md',...english.map(x=>'docs/'+x),...italian.map(x=>'docs/it/'+x)]){
    const source=read(file);
    for(const match of source.matchAll(/\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)){
      const target=match[1].split('#')[0];
      if(!target||/^[a-z][a-z\d+.-]*:/i.test(target))continue;
      assert.ok(existsSync(resolve(root,dirname(file),decodeURIComponent(target))),`${file}: ${target}`);
    }
  }
});

test('Bilingual protocol retains every normative transition and its technical identity',()=>{
  const rows=source=>source.split('\n').filter(x=>/^\| TR-\d{3} \|/.test(x)).map(x=>x.split('|').slice(1,-1).map(x=>x.trim()));
  const english=rows(read('docs/PROTOCOL.md')),italian=rows(read('docs/it/PROTOCOL.md'));
  assert.equal(english.length,43);assert.equal(italian.length,43);
  assert.deepEqual(english.map(r=>[...r.slice(0,3),r[4]]),italian.map(r=>[...r.slice(0,3),r[4]]));
  const ids=text=>[...new Set(text.match(/\b(?:INV|TR|TEST|CMP|DATA|AUX|STM|RET|AC-P0|NEG|UV|CAP|WAL|REC)-\d{2,3}\b/g))].sort();
  for(const name of ['ARCHITECTURE','PROTOCOL','TEST-MATRIX']){
    const en=new Set(ids(read(`docs/${name}.md`)));
    for(const id of ids(read(`docs/it/${name}.md`)))assert.ok(en.has(id),`${name}: missing ${id}`);
  }
});
