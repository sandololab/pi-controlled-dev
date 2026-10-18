[English](../P16C-WAL-AUDIT.md) · **Italiano**

# P16C — audit del modello durevole prima dell'implementazione

Esito: **BLOCKED in attesa di chiarimento della regola fsync-confirmed**.
Nessun codice, documento normativo o store storico originale modificato.
Questo documento descrive il comportamento attuale e le decisioni ancora da autorizzare; non dichiara implementata una repair.

## Baseline

- Suite completa: 365/365 PASS, zero failure/skip.
- Probe storico su copie: 1/1 PASS; inventario originale invariato.
- Typecheck, package dry-run, dependency audit e git diff --check: PASS.
- Hash normativi conservati in `<temporary-directory>/p16c-baseline-hashes.log`.
- Log completi: `<temporary-directory>/p16c-baseline-*`.

## 1. Ordine reale delle scritture

### Artifact e spec

Sorgente: `src/store.ts`, `import`, `writeSpec`, `catalog`, `writeExclusive`.

1. Validare ID/path/metadata e digest/size dei byte; effettuare il disclosure check host.
2. Se il file esiste, verificare i byte esistenti; nessuna sostituzione silenziosa.
3. Altrimenti `openSync(path, 'wx', 0600)`.
4. `writeFileSync(fd, bytes)`.
5. Per artifact immutabili: `fchmodSync(fd, 0400)`.
6. `fsyncSync(fd)`, `closeSync(fd)`.
7. `fsync` della directory contenente l'artifact.
8. Per la spec iniziale: persistere prima `artifacts/spec`, poi `spec.json`, ciascuno con sync; infine sync della directory task.

Il catalogo completo dei ContextRecord viene scritto come artifact con ID content-addressed. L'evento cita il catalogo; gli ArtifactRef impegnano digest, size, path e mediaType. Il mediaType è metadata del riferimento/catalogo: non esiste un MIME filesystem indipendente. I file non hanno un flag kernel di immutabilità; l'immutabilità è un vincolo del protocollo, della validazione e delle permission applicate.

### Commit workflow

Sorgenti: `src/orchestrator.ts:#commit` e `src/store.ts:commit`.

1. Costruire `next state`, catalogo e `stateAfter` immutabile; gli artifact sono già scritti e synced prima del WAL.
2. Costruire l'evento con revision, previousEventHash, eventHash e refs esatti.
3. Verificare catalogo, storia, schema, sequenza, artifact, terminal proof e, quando applicabile, terminal completion.
4. Aprire `events.jsonl`: `wx` per CREATE, `a` per commit successivi.
5. `writeFileSync(fd, canonicalJSON(event) + '\n')`.
6. `fsyncSync(fd)`, poi close del WAL.
7. `fsync` della directory task.
8. Creare esclusivamente `state-<revision>.tmp` nel control plane.
9. Scrivere snapshot canonico, `fsync` del file temporaneo, close.
10. Verificare il precedente `state.json` come file regolare, quando già esistente.
11. `renameSync(temp, state.json)`.
12. `fsync` della directory task.
13. Solo ora aggiornare revision/eventHash dell'handle Store in memoria e ritornare al chiamante.
14. Solo dopo il ritorno aggiornare lo stato in memoria dell'Orchestrator.

Il nome temporaneo attuale è deterministico per revisione, non un UUID. Non è uno stato committed né una receipt di sync versionata. Un residuo provoca collisione su `wx`, non una cancellazione automatica.

### Dispatch INTENT ed effetti esterni

Sorgente: `src/orchestrator.ts:#intent` e chiamanti Scout/Developer/Reviewer/Oracle.

1. Congelare l'AssignmentEnvelope.
2. Commit `RECORD/SPAWN_INTENT`, aggiungendo RunRecord INTENT e incrementando i contatori.
3. Soltanto dopo il ritorno del commit chiamare il runner.
4. Dopo acquisizione verificata della terminal proof, un nuovo RECORD/RECONCILED aggiorna il run preservando lo storico.
5. Il risultato accettato viene registrato separatamente.

L'INTENT iniziale usa un request ID locale `intent-<attemptId>`; non ha necessariamente il runId/childSessionId/requestId RPC successivi. L'assenza del binding o del risultato non dimostra che il dispatch non sia avvenuto.

Gli effetti host non hanno tutti un identico protocollo di admission/outcome: il rework registra un RECORD/RECONCILED con reason descrittiva prima della preparazione Git; la validazione esegue i comandi approvati e poi registra i risultati. Il testo della reason non può diventare una prova macchina di un effetto specifico. P16C non deve rieseguire questi effetti per colmare l'assenza di evidenze.

### Lock, guard e reclaim

Sorgenti: `src/lock-manager.ts`, `src/recovery.ts`.

- Lock normale: guard esclusivo -> creazione lock con `wx` -> metadata con token/incarnation -> write -> file fsync -> close -> directory fsync -> handle in memoria.
- Il pair viene acquisito workspace prima, task dopo; i due passaggi hanno ciascuno il guard condiviso. Esiste quindi una finestra con solo workspace lock acquisito.
- Guard corrente: `wx` -> scrittura di un solo UUID -> file fsync -> close -> directory fsync -> operazione protetta.
- Rilascio guard: confronto token -> unlink -> directory fsync. Se l'esito è incerto viene trattenuto.
- Reclaim: classificazione e verifica fresca sotto guard -> scrittura/sync del record di autorizzazione -> verifica token e unlink task -> sync directory -> verifica token e unlink workspace -> sync directory -> scrittura/sync del record PAIR_RECLAIMED -> rilascio guard.
- I journal di riconciliazione P16B usano la stessa persistenza esclusiva con sync e il guard, ma non sono un'autorizzazione di repair.

Il guard corrente contiene soltanto un token: non identifica l'incarnation del suo proprietario. La morte del proprietario dei lock non dimostra la morte di un eventuale secondo processo che abbia acquisito il guard. I guard legacy non possono essere eliminati automaticamente usando PID/età dei lock.

## 2. Crash point osservabili

| Punto | Possibile residuo | Conseguenza conservativa |
|---|---|---|
| Durante artifact write | Artifact parziale/orfano | Non usare come evento o prova di commit |
| Artifact synced, prima del WAL | Artifact validi senza evento | Nessuna nuova workflow revision autorizzata |
| Durante append WAL | Tail senza newline, eventualmente UTF-8 parziale | Non interpretare come evento |
| Riga completa, prima del WAL fsync | WAL valido visibile, snapshot precedente | Sync precedente non dimostrato dai soli byte |
| WAL fsync riuscito, prima del temp snapshot | Stesso WAL valido e snapshot precedente | Indistinguibile dal caso precedente nel workflow store |
| Durante temp snapshot write/fsync | Temp parziale o completo, vecchio snapshot | Temp non committed; nessuna promozione cieca |
| Dopo temp fsync, prima del rename | Temp completo e vecchio snapshot | Candidato a prova causale, ma ruolo normativo del temp da chiarire |
| Dopo rename, prima di directory fsync | Nuovo snapshot visibile | Visibilità non dimostra il ritorno del directory fsync |
| Dopo commit INTENT, prima/durante runner | INTENT senza binding/outcome | Effetto ambiguo, nessun redispatch |
| Dopo effetto, prima del relativo evento | Possibili artifact orfani | Nessun result/decision/effetto ricostruito da chat o transcript |
| Dopo autorizzazione reclaim | Audit presente, pair ancora presente | Non dedurre che gli unlink siano avvenuti |
| Fra i due unlink | Pair parziale, guard residuo | Nessuna cancellazione indiscriminata |
| Dopo unlink, prima del record conclusivo | Lock assenti, authorization/guard presenti | Non dedurre l'esito completo dalla sola assenza |

## 3. Fasi equivalenti, senza nuovi stati workflow

Questi sono nomi analitici, non un nuovo enum implementato:

- **NOT_STARTED**: nessun evento di commit pubblicato; eventuali artifact preparatori non autorizzano progresso.
- **EVENT_DURABLE**: append completo seguito dal ritorno positivo di WAL fsync e directory sync.
- **SNAPSHOT_DURABLE**: temp scritto/synced, rename effettuato e directory sync completato.
- **COMMITTED**: per questa implementazione coincide col completamento di SNAPSHOT_DURABLE; l'aggiornamento dell'handle è soltanto in memoria. Non occorre inventare un ulteriore stato persistito.
- **INTENT_DURABLE**: qualificazione di un evento SPAWN_INTENT attraverso il medesimo protocollo di commit, non una fase universale intermedia fra tutti gli eventi. Non prova inizio o fine dell'effetto. Il runner viene chiamato solo dopo il ritorno del commit dell'INTENT.

`#revision`, `#eventHash`, `#poisoned` e il ritorno di fsync non sono persistiti come receipt. Dopo la morte del processo non possono essere usati dal successore.

## 4. Verifiche già esistenti nel loader

`DurableStore.load` legge solo il prefisso terminato da newline, rifiuta UTF-8 invalido nel prefisso completo, verifica eventHash, previousEventHash, revisioni continue, preservazione dello storico, contratti, path immutabili, digest e size degli artifact, spec originale, terminal proof e attestazione COMPLETED quando applicabile.

La coda senza newline resta sul disco e non viene applicata. Append successivi sono rifiutati. Il loader richiede che lo snapshot coincida esattamente con lo stato derivato dall'ultimo evento completo: sia WAL-ahead sia snapshot-ahead sono oggi rifiutati, senza repair.

Un hash valido prova integrità/binding, non l'avvenuta esecuzione di una syscall fsync. Timestamp, età e spiegazioni testuali non colmano questa distinzione.

## 5. Prova empirica del problema fsync

Comando: `node <temporary-directory>/p16c-fsync-window-probe.mjs`.

Il worker usa il commit reale su fixture temporanee. Due esecuzioni separate sono terminate tramite SIGKILL, rispettivamente:

1. dopo l'append completo della revisione 1, prima della sua chiamata WAL fsync;
2. dopo il ritorno della stessa chiamata WAL fsync, prima dello snapshot.

Risultato verificato:

- entrambe: WAL completo e hash-valid a revision 1;
- entrambe: snapshot a revision 0;
- tutti i 10 file del workflow store byte-identici fra i casi;
- entrambe: loader rifiuta STORE_SNAPSHOT_MISMATCH;
- nessuna repair e nessun effetto workflow rieseguito.

Il diagnostico usa Linux e il crash di processo, non simula power loss. I lock dei due processi hanno naturalmente token/incarnation differenti; sono stati creati prima del commit e non attestano la sua fase fsync. La distinzione nota al fault injector non è una prova presente nello store e non può essere passata al repair come flag di authority.

Log: `<temporary-directory>/p16c-fsync-window-probe.log`.

## 6. Fixture storica INTENT

L'ispezione separata ha copiato lo store storico `p15-live-positive` e verificato il loader sulla copia:

- state ANALYZING, revision 2;
- un INTENT senza runId, childSessionId, terminalProofRef o resultRef;
- nessun risultato durevole correlato all'esatto assignment;
- inventario originale invariato.

Esito dell'audit read-only: **ambiguo rispetto all'effetto esterno**. Non è prova di mancato lancio e non autorizza retry, abort sintetico o completion. Non è un nuovo classificatore P16C implementato.

Log: `<temporary-directory>/p16c-historical-intent-inspect.log`.

## 7. Chiarimento richiesto prima dell'implementazione

STM-002/CR-1 prescrive replay di eventi completi synced; il requisito P16C richiede eventi fsync-confirmed e vieta di risolvere arbitrariamente casi ambigui. Il formato attuale non definisce una receipt del sync né quale altra evidenza renda confermato il sync nel caso WAL-ahead/snapshot-behind.

Occorre scegliere esplicitamente la regola:

**A. Barriera nel processo di repair.** Autorizzare il repair, sotto esclusione e dopo verifica completa, a fsyncare il prefisso WAL già esistente e i dati necessari, quindi ricostruire lo snapshot dagli eventi esistenti. Questo rende durevole il prefisso ora: non dimostra che il precedente fsync fosse riuscito. Nessun evento nuovo o effetto esterno sarebbe inventato; gli effetti ancora ambigui resterebbero bloccati.

**B. Prova del sync precedente.** Richiedere una receipt/versione esplicita o definire normativamente se e quando un temp snapshot completo e correlato può essere una prova causale dell'ordine di commit. I casi legacy senza prova sufficiente resterebbero AMBIGUOUS. La sola presenza di un temp non viene qui promossa ad authority.

Non è stata scelta implicitamente nessuna delle due. Il punto 43 richiede di fermarsi prima di introdurre una nuova semantica. I guard legacy privi di owner e gli INTENT senza prova restano comunque fail-closed, senza cancellazione o replay.

## 8. Limiti di piattaforma

Il codice usa fsync di file/directory e rename nella stessa directory del control plane. Gli errori di sync non hanno fallback silenzioso. Il probe è Linux-specifico (/proc e SIGKILL). Un test di crash di processo non certifica power-loss durability, cache hardware, filesystem remoti o mount che non rispettano fsync. Nessuna garanzia cross-platform o per filesystem non verificati viene aggiunta da questo audit.

## Verifica finale ripetuta dopo l'audit

- Suite completa: **365/365 PASS**, zero failure/cancelled/skip/todo.
- Probe storico: **1/1 PASS**, zero failure/skip; originali preservati.
- Typecheck e package dry-run: PASS.
- Dependency audit: PASS, zero vulnerabilità.
- Hash di ARCHITECTURE.md, PROTOCOL.md e TEST-MATRIX.md: identici alla baseline.
- `git diff --check`: PASS.
- `git status --short`: byte-identico alla baseline, 68 tracked changes e 10 untracked preesistenti.
- Nessun file repository creato/modificato da P16C; nessun commit.
- Log: `<temporary-directory>/p16c-final-*`.

## Esito

P16C non implementato: manca la scelta normativa sulla prova/barriera di durabilità per il replay WAL-ahead. Nessuna repair eseguita, nessuna revisione o contatore modificato, nessun provider interrogato. P17 non iniziato.
