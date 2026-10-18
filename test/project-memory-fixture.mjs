import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {installSourceLoader} from './load-source.mjs';
installSourceLoader();
const {ProjectMemoryRepository}=await import('../src/project-memory-repository.ts');
const {selectProjectMemory,prepareMemoryContext}=await import('../src/project-memory-context.ts');
/** Shared mechanism fixture. Native response is a declared test double, not real-human certification. */
export async function memoryForRole(repoRoot,dataParent,assignment){
  const data=join(dataParent,'memory-data');mkdirSync(data);
  const repo=ProjectMemoryRepository.open(data,repoRoot,()=> 'ACCEPT',{create:true});
  const record=repo.propose({recordKind:'software-adr',title:'Riutilizzare il confine esistente',scope:{kind:'repository'},
    content:{decisionKey:'repository-boundary',context:'Il repository ha un componente condiviso per la persistenza.',decision:'Riutilizzare ScenarioRepository per ogni nuova operazione di persistenza.',rationale:'Evita un percorso di scrittura duplicato.',consequences:['Il nuovo codice rispetta il confine esistente.'],alternatives:[]},
    evidenceRefs:[],relatedTaskRefs:['task-1'],relatedRecordRefs:[]},{role:'host',taskId:'task-1'});
  await repo.decide({mode:'tui',sessionManager:{getSessionId:()=> 'fixture-human'},ui:{confirm:async()=>true}},record.recordId,'ACCEPTED');
  const selection=selectProjectMemory(repo,{taskId:assignment.taskId,role:assignment.role,assignmentId:assignment.assignmentId,objective:assignment.objective,files:assignment.allowedPaths});
  const receipts=[];const projectMemory=prepareMemoryContext(selection,repo.store,(ref,receipt)=>receipts.push({ref,receipt}));
  return {projectMemory,selection,receipts,repo,record,proposal:Object.fromEntries(['recordKind','title','scope','content','evidenceRefs','relatedTaskRefs','relatedRecordRefs'].map(key=>[key,record[key]]))};
}
