[English](../PROJECT-PLANNING.md) · **Italiano**

# Project Planning / Task Decomposition

Project Planning propone cosa sviluppare e in quale ordine. Project Memory conserva conoscenza cross-task. ControlledTask esegue e verifica una singola unità attraverso il workflow esistente: 11 stati e 43 transizioni. Nessun ruolo, writer, Orchestrator, contratto TaskSpec o autorità globale viene aggiunto.

## Contratti project-level

`ProjectGoal` conserva identità, revisione, obiettivo, vincoli, successo atteso e digest. `PlannedTask` contiene intento, motivazione, scope e acceptance/validation intent, dipendenze hard con spiegazione e riferimenti alla memoria. Non contiene comandi eseguibili o uno scope file-level autorizzato.

`ProjectPlan` conserva un DAG, strategia, identità/revisione, riferimento al goal e alla precedente revisione approvata. Le proposte rifiutano schema aperto, campi di autorità, ID duplicati, obiettivi semanticamente duplicati, intenzioni vuote, archi duplicati, riferimenti mancanti, self dependency, rationale incompleta e cicli. ID non posizionali rimangono stabili; il binding host di identità richiede objective, scopeIntent e acceptanceIntent identici, incluso l’ordine degli array. Modificare questi campi richiede una nuova identità e l’aggiornamento dei riferimenti delle dipendenze. Strategia, spiegazioni, verifiche e archi possono cambiare senza sostituire l’identità. Le sovrapposizioni di scope sono avvisi, non errori.

I documenti proposti sono immutabili nello store. Una correzione genera una nuova revisione DRAFT. Il lifecycle DRAFT/APPROVED/SUPERSEDED è una proiezione dell’indice atomico e delle ricevute trusted: non è uno stato operativo. Il digest del contenuto esclude solo `status` e `contentDigest`; la richiesta di approvazione lega invece il payload canonico completo, con stato DRAFT, riferimento dell’artefatto, planId, revisione, digest dell’indice e presentazione. Una ricevuta persistita autorizza quella proposta esatta. La precedente revisione è SUPERSEDED solo dopo l’approvazione della sostituzione. I record di tutte le revisioni e tutte le identità rimosse restano ispezionabili.

## Input e Scout

La modalità analitica del pre-task Scout riusa la stessa registrazione, RPC, strumenti read-only, transcript verification, terminal proof, isolamento e limiti di inventario. Non esiste un agente ProjectPlanner. L’host seleziona la Project Memory pertinente ai file del repository, bounded a otto record e ai limiti Scout esistenti, e rifiuta conflitti. Il modello restituisce solo riferimenti a memorie effettivamente fornite; digest e revisioni sono risolti dall’host.

`PlanningInputReceipt` lega goal revision/digest, commit e inventario della baseline, memorie selezionate con digest/revisioni, artefatto del contesto effettivo, analisi Scout e proposta risultante. Le ricevute di dispatch della memoria continuano a distinguere intent da acknowledgement. Non attestano comprensione del modello. Approvazione e selezione rivalutano conflitti e riferimenti obsoleti senza sostituzioni silenziose.

## Avvio ed esecuzioni

`/controlled-dev project` apre la vista, `project plan` riapre la bozza salvata senza rigenerarla oppure prepara una proposta quando non esiste una bozza; `project status` consulta il progresso. Obiettivo, correzione e revisione usano il pannello comune del wizard, con domanda, motivo e avanzamento. Il riepilogo include l’obiettivo generale e si scorre indipendentemente dalle azioni. Annullare la conferma finale riporta al piano, ancora correggibile. Una correzione Scout che viola l’identità non viene salvata e offre una nuova richiesta di correzione. L’utente sceglie esplicitamente fra le attività READY. La selezione produce una capability host process-local contenente un prefill: il normale Scout deve riesaminare il repository e proporre scope concreto e verifiche. Il normale wizard e la conferma di creazione restano obbligatori. Il Developer non viene avviato dalla pianificazione.

La creazione salva un `PlannedTaskExecutionLink` separato dal TaskSpec, legato alla revisione/digest del piano, all’identità/digest pianificata, all’identità/hash del TaskSpec e al commit della baseline. La guardia di mutazione esistente serializza il collegamento e l’input di controllo. Il collegamento viene pubblicato prima dell’input eseguibile: un crash può lasciare una prenotazione conservativa, mai un input non collegato che consenta una seconda esecuzione. Una prenotazione senza ledger appare ACTIVE con spiegazione della preparazione/interruzione e richiede verifica esplicita. Questa versione consente una sola esecuzione per identità stabile; un nuovo tentativo dopo un fallimento richiede una nuova attività approvata, mentre retry e rework interni restano nel ControlledTask.

WAITING/READY/ACTIVE/COMPLETED/BLOCKED/FAILED sono calcolati leggendo i veri ledger tramite DurableStore.load. AWAITING_HUMAN e REVIEWING non soddisfano una dipendenza. Un predecessore FAILED o BLOCKED lascia il successore WAITING e ne spiega la causa. Non esiste scheduler, runner automatico o esecuzione parallela dei task.

Prima di formulare un successore, l’host verifica le modifiche nei handoff e manifest autorevoli dei predecessori completati contro il manifest del repository corrente. Considera anche gli antenati e usa il risultato più recente lungo ogni ramo: una modifica successiva legittima può sostituire i byte precedenti. Creazioni, modifiche, eliminazioni, rename e mode devono coincidere. Il controllo non dipende dalla presenza fisica del vecchio candidate né si fida dei changedFiles dichiarati dal modello. Un risultato assente causa PROJECT_BASELINE_NOT_READY, con prerequisito e percorso mancanti. L’integrazione della candidata è una decisione esterna: nessuna copia, merge, commit o promotion automatica.

## Persistenza e vista umana

La namespace `planning` usa lo stesso DurableStore, artefatti immutabili, fsync, replace atomico/CAS e LockManager già usati dalla memoria. Un indice rende visibili goal, proposte, input receipts, approvazioni, collegamenti e revisione corrente. Artefatti orfani dopo un crash non diventano autorevoli. Il reload verifica integrità, identità, sequenza delle revisioni, binding delle ricevute, supersession, DAG e unicità dei collegamenti. Non introduce database, WAL o recovery engine.

Project.md, Planning/Current Plan.md, Plan History, Planned Tasks e un unico indice Obsidian Base estendono lo stesso vault. Rebuild dei task ricostruisce anche pianificazione e memoria. Home collega il progetto. Le note mostrano motivazione delle dipendenze, conoscenza tecnica e collegamenti ai task reali; Notes sopravvive al rebuild. Modificare Markdown non cambia lo store, approva piani o modifica stati.

## Limiti e verifica

La pianificazione è opzionale: progetti senza memoria o piano e task storici senza link conservano il workflow corrente. Sono esclusi Greenfield Bootstrap, Integration Checkpoints, candidate promotion e Systemist. La validazione strutturale non può certificare qualità semantica completa della decomposizione: la skill guida functional slicing e foundation task proporzionati, ma revisione e correzione umane restano necessarie.

La suite aggiunge una fixture media da sei attività, DAG negativi, receipt forgery/staleness/headless, revisioni, memory conflict/bounds, Scout RPC read-only, normale formulazione, cambio di scope approvato, competizione fra processi, stati derivati, completion reale del workflow con provider/UI double dichiarati, baseline mancante/presente, Markdown non autorevole e reload separato. Le risposte UI dei test non certificano una nuova prova umana TUI. Il problema storico segnalato STORE_COMPLETION_PACKAGE_MISSING resta fuori scope; il probe deve riportare il proprio risultato effettivo.
