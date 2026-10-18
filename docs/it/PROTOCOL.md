[English](../PROTOCOL.md) · **Italiano**

# P1 — Protocollo normativo del workflow controllato

Stato: **specifica emendata Operational Registration/RPC Binding; nessuna implementazione dell'amendment/P6**. `schemaVersion = 1`, salvo AssignmentEnvelope DATA-002 v2.
Autorità superiore: [ARCHITECTURE.md](ARCHITECTURE.md), P0 con il presente amendment. SHA-256 della P0 originale (solo storico): `bc7e8a646fd591cef3bfea90d0901925018f8bf25a7d1c82954291c80434e010`.
Matrice dei test e tracciabilità: [TEST-MATRIX.md](TEST-MATRIX.md).

## NOR-001 — Interpretazione e confini

DEVE/VIETATO sono requisiti normativi. Questo documento precisa P0 senza sostituirla. ID stabili non vengono riutilizzati. Una revisione incompatibile richiede nuova schemaVersion e approvazione, non coercizione dei dati precedenti. I valori finiti e i formati qui definiti sono scelte di specifica P1, non affermazioni su funzionalità già collaudate di Pi.

I soli stati globali sono quelli di P0. Stato child, stato evidenza e stato gate sono dati, non nuovi stati del workflow. `COMPLETED` significa candidato locale validato e patch/evidenze durevoli; non integrazione nel checkout originale, merge o pubblicazione. Le condizioni UNVERIFIED restano tali: vedere CAP-001 e registro UV.

Le etichette di collaudo FUT-CONTRACT, FUT-INTEGRATION, FUT-RECOVERY e FUT-RELEASE nella matrice indicano milestone future, non assegnano né autorizzano contenuti di P2 o altre fasi numerate.

## A. Invarianti globali

| ID | Invariante non derogabile |
|---|---|
| INV-001 | Solo l'Orchestrator valida e persiste modifiche dello stato globale, incluse approvazioni, contatori e finding disposition. |
| INV-002 | Nessun child può scegliere uno stato globale o dichiarare COMPLETED. La sua fine esecuzione è soltanto evidenza. |
| INV-003 | Developer non valida autorevolmente il proprio lavoro: eventuali controlli esplorativi non soddisfano TESTING né REVIEWING. |
| INV-004 | Reviewer è read-only, indipendente e fresh; non corregge il candidato che verifica. |
| INV-005 | Oracle è advisory e invocabile solo per ambiguità, blocco o fallimenti ripetuti; non approva decisioni. |
| INV-006 | Nessuna espansione dello scope senza gate umano onScopeChange valido e nuova revisione della spec. |
| INV-007 | Testo libero, JSON estratto arbitrariamente da prose e messaggi di steering non autorizzano transizioni. |
| INV-008 | `ok: true`, exit zero del child e receipt di dispatch non equivalgono al successo del workflow. |
| INV-009 | Test assente, NOT_RUN, INVALID, FAILED o TIMED_OUT non è PASSED. Tutte le verifiche obbligatorie devono essere PASSED. |
| INV-010 | Nessun modello/child/tool model-callable può produrre approvazione umana valida, neppure invocando indirettamente un comando. |
| INV-011 | Mutazione candidato/spec invalida evidenze e approvazioni legate all'identità precedente; restano conservate solo come storico. |
| INV-012 | Ambiguità, contraddizione, esito ignoto o capability necessaria non verificata impediscono l'avanzamento positivo. |
| INV-013 | Scope default deny; deny prevale su allow. Ledger, metadata Git e credenziali non sono destinazioni autorizzabili ai child. |
| INV-014 | Un solo writer per workspace canonico; nessuna validazione/review sul candidato durante una mutazione. |
| INV-015 | Il package non modifica il checkout originale, Pi o pi-subagents; non esegue merge, push o publish. |
| INV-016 | Ogni risultato è correlato a task, assignment, attempt, ruolo, sessione e run realmente attribuiti dal runtime. Un'identità dichiarata dal modello non basta. |
| INV-017 | Contatori persistiti non diminuiscono; retry ed escalation hanno limiti finiti e non si resettano cambiando sessione/spec. |
| INV-018 | Nessun redispatch dopo un intent con esito ignoto; prima riconciliare. Nessun fallback implicito di protocollo, runner o modello. |
| INV-019 | Solo transizioni TR elencate; revisione attesa e lock sono obbligatori. Nessuna transizione uscente da COMPLETED/FAILED. |
| INV-020 | Nessuna evidenza necessaria è un semplice riferimento a un artifact temporaneo non più disponibile. |
| INV-021 | Modifica consentita solo con Git pulito, commit/ref risolvibile e handoff/candidato verificabili. Nessun auto-commit/stash per riparare precondizioni. |
| INV-022 | Tutti gli oggetti di contratto sono chiusi, versionati e validati strutturalmente e semanticamente. |
| INV-023 | Un PASS del Reviewer è necessario ma mai sufficiente; vale soltanto canComplete di CMP-001. |
| INV-024 | Tool allowlist, cwd e worktree non sono sandbox OS. Confinement forte richiesto ma non dimostrato blocca la mutazione. |
| INV-025 | Scout e Oracle non modificano file; leaf agent senza delegazione e senza estensioni ambient non autorizzate. |
| INV-026 | L'approvazione umana autorizza una decisione precisa, mai la rinuncia ai gate di correttezza; spec ambigua o criterio non verificabile non raggiunge READY. |

## B. Macchina a stati formale

### STM-001 — Stati

| Stato | Significato operativo |
|---|---|
| PENDING | TaskSpec accettata strutturalmente; analisi non ancora avviata. |
| ANALYZING | Scout e verifiche preliminari; eventuale Oracle per trigger esplicito. |
| READY | Spec, scope e programma di verifica congelati e non ambigui. |
| IMPLEMENTING | Assignment Developer autorizzato; comprende raccolta handoff prima di TESTING. |
| TESTING | Scope/digest ricontrollati e validazione autorevole del candidato già materializzato. |
| REVIEWING | Reviewer indipendente o rivalutazione deterministica finale delle sue evidenze. |
| REWORK | Difetto attribuito e finding ammesso; nessuna scrittura finché non autorizzato nuovo assignment. |
| BLOCKED | Capability, integrità o informazione necessaria mancante; nessun progresso positivo. |
| AWAITING_HUMAN | Un gate pendente, target resumeState già congelato. |
| COMPLETED | Terminale positivo giustificato da CMP-001. |
| FAILED | Terminale negativo, motivo e artifact disponibili conservati. |

### STM-002 — Semantica comune a TUTTE le righe TR

Ogni riga è la tupla `(source, target, actor=Orchestrator, guard/evidence, effect, invalidation, event, crash)`.
Le colonne sintetiche ereditano **obbligatoriamente** le definizioni seguenti; non sono autorizzazioni implicite.

Precondizioni comuni G0: stato/revisione esatti, schema valido, lock task e lock workspace quando mutabile, attore host autorizzato, nessun conflitto di identità. Prima di un effetto di scrittura o dispatch: capability verificata e intent durable. Side effect non nominati sono vietati. Gli input malformati sono rifiutati prima di creare un task, senza inventare uno stato.

Evidenze richieste oltre G0:

- **A**: input snapshot/hash disponibili, limiti residui, assignment Scout controllato.
- **R**: ScoutResult valido; ambiguità vuote/risolte con decisioni persistite; criteri ID/metodo verificabili; comandi obbligatori non vuoti; spec/scope congelati. Se mutazione necessaria, precondizioni Git/capability provate prima di READY.
- **I**: R ancora valido; gate beforeImplementation richiesto soddisfatto; writer precedente sicuramente terminale; baseline/candidate source integra; budget Developer residuo; assignment nuovo, scoped e fresh.
- **T**: DeveloperResult schema-valid e attribuito senza blockedReason; writer terminale provato; handoff completo durevole, base esatta, patch validata e candidato già materializzato in IMPLEMENTING dopo la fine del writer. Scope check e digest acquisiti prima dell'ingresso TESTING.
- **V**: candidato materializzato in scope; tutte le verifiche obbligatorie PASSED su digest/spec correnti; nessuna mutazione/identità ignota; profilo Reviewer indipendente verificato.
- **C**: CMP-001 integralmente vero, ricalcolato immediatamente prima del commit.
- **W**: difetto concreto attribuibile, finding accettato entro scope, evidenza del fallimento, writer terminale; nuovo tentativo non ancora consumato. Consente REWORK anche a budget esaurito solo per scegliere escalation/fallimento, mai per lanciare.
- **B**: motivo tecnico/informativo, evidenza mancante/contraddittoria identificata. Nessuna inferenza di successo.
- **H**: richiesta di gate tipizzata, target esplicito ammesso da GAT-001, dati/hash congelati; nessun writer attivo o non riconciliato. Se non è possibile provare quiescenza, prima BLOCKED.
- **F**: rifiuto definitivo umano, violazione non recuperabile o budget esaurito senza decisione sbloccante. Run vivi devono essere fermati e riconciliati; finché sconosciuti si resta BLOCKED, non si dichiara cleanup riuscito.
- **U**: blocco risolto con evidenza nuova, stato repo/processi noto, tutti i guard del target soddisfatti.
- **X**: recovery rileva incoerenza mentre l'ultimo stato attendibile è non terminale; evidenze contraddittorie conservate.
- **GA**: authority verificata e distinta: DirectHumanApproval autentica oppure PolicyDerivedAuthorization conforme a PA-001 per un gate v2 ammesso. Gate/hash/revisione devono corrispondere, consumo una volta e guard del target invariati. Oracle e retry esauriti restano esclusivamente umani.

Effetti consentiti:

- **analyze**: congelare assignment e intent Scout; acquisire risultato. Oracle soltanto secondo RET-001.
- **ready**: congelare spec approvata, scope e piano comandi; nessun lancio writer.
- **implement**: prenotare contatori, registrare intent, lanciare un Developer; mai originale.
- **test**: ricontrollare digest/scope del candidato materializzato ed eseguire comandi autorizzati. La raccolta handoff/materializzazione deterministica è un RECORD in IMPLEMENTING, dopo writer terminale e prima di TR-013.
- **review**: inviare packet al Reviewer fresh. Su rientro da gate finale riusa una review ancora valida, non lancia automaticamente un nuovo child.
- **rework**: persistere finding/disposition e piano di correzione bounded; nessuna modifica file.
- **block**: sospendere nuovi effetti, registrare motivo, richiedere stop/status sicuri se necessari; preservare prove.
- **gate**: persistere HumanGate e richiedere conferma esplicita nella TUI di Pi; nessun auto-reply.
- **fail/complete**: copiare evidenze durevoli e persistere terminale; nessun merge/push/cleanup distruttivo.
- **resume**: consumare gate una sola volta; eseguire soltanto l'effetto previsto dal target/continuation registrati, non ripetere spawn già attribuiti.

Invalidazioni:

- **N**: nessuna nuova invalidazione; continuano tutti i controlli di freschezza.
- **E**: evidenze test/review/finale e gate legati al candidato non riutilizzabili per un nuovo candidato. La vecchia base resta storico, non risultato corrente.
- **S**: come E, più analisi/spec approval/assignment precedenti se cambia spec; nessuna cancellazione dello storico.
- **Q**: evidenze interessate dal blocco messe in quarantena; nessuna usata per completare finché non riconciliata.
- **G**: gate consumato e non riutilizzabile; approvazione resta evidenza se hash e contenuto non cambiano. Se la decisione cambia spec/candidato applicare anche S/E.

Evento per ogni riga: TransitionEvent con `transitionId` uguale al TR, `kind=TRANSITION`, da/a/revisioni/motivo/evidenceRefs. Crash **CR-1** per tutte le righe: WAL prima dello snapshot, replay soltanto di eventi completi synced; effetti esterni tramite intent separato. Evento committed non implica effetto esterno concluso. Nessuna riesecuzione cieca; esito ignoto produce riconciliazione e, se incoerente, il TR recovery esplicito. Vedere PST-001.

### STM-003 — Elenco esaustivo delle transizioni

Tutte le righe: attore Orchestrator, evento e crash come STM-002/CR-1.

| ID | Source | Target | Guard/evidenze | Effetto | Invalidazione |
|---|---|---|---|---|---|
| TR-001 | PENDING | ANALYZING | A | analyze | N |
| TR-002 | PENDING | AWAITING_HUMAN | H | gate | N |
| TR-003 | PENDING | FAILED | F | fail | Q |
| TR-004 | PENDING | BLOCKED | X | block | Q |
| TR-005 | ANALYZING | READY | R | ready | N |
| TR-006 | ANALYZING | BLOCKED | B o X | block | Q |
| TR-007 | ANALYZING | AWAITING_HUMAN | H | gate | N |
| TR-008 | ANALYZING | FAILED | F | fail | Q |
| TR-009 | READY | IMPLEMENTING | I | implement | E |
| TR-010 | READY | AWAITING_HUMAN | H | gate | N |
| TR-011 | READY | FAILED | F | fail | Q |
| TR-012 | READY | BLOCKED | X | block | Q |
| TR-013 | IMPLEMENTING | TESTING | T | test | N |
| TR-014 | IMPLEMENTING | REWORK | W | rework | E |
| TR-015 | IMPLEMENTING | BLOCKED | B o X | block | Q |
| TR-016 | IMPLEMENTING | AWAITING_HUMAN | H | gate | N |
| TR-017 | IMPLEMENTING | FAILED | F | fail | Q |
| TR-018 | TESTING | REVIEWING | V | review | N |
| TR-019 | TESTING | REWORK | W | rework | E |
| TR-020 | TESTING | BLOCKED | B o X | block | Q |
| TR-021 | TESTING | FAILED | F | fail | Q |
| TR-022 | REVIEWING | COMPLETED | C | complete | N |
| TR-023 | REVIEWING | REWORK | W | rework | E |
| TR-024 | REVIEWING | BLOCKED | B o X | block | Q |
| TR-025 | REVIEWING | AWAITING_HUMAN | H | gate | N |
| TR-026 | REVIEWING | FAILED | F | fail | Q |
| TR-027 | REWORK | IMPLEMENTING | I e finding ammessi | implement | E |
| TR-028 | REWORK | ANALYZING | A e necessità rianalisi registrata | analyze | S |
| TR-029 | REWORK | BLOCKED | B o X | block | Q |
| TR-030 | REWORK | AWAITING_HUMAN | H | gate | N |
| TR-031 | REWORK | FAILED | F | fail | Q |
| TR-032 | BLOCKED | ANALYZING | U e A | analyze | S se spec nuova, altrimenti N |
| TR-033 | BLOCKED | REWORK | U e W | rework | E |
| TR-034 | BLOCKED | AWAITING_HUMAN | H | gate | N |
| TR-035 | BLOCKED | FAILED | F | fail | Q |
| TR-036 | AWAITING_HUMAN | PENDING | GA e resumeState=PENDING | resume | G |
| TR-037 | AWAITING_HUMAN | ANALYZING | GA e resumeState=ANALYZING e A | resume/analyze | G, S se nuova spec |
| TR-038 | AWAITING_HUMAN | READY | GA e resumeState=READY e R | resume/ready | G |
| TR-039 | AWAITING_HUMAN | IMPLEMENTING | GA e resumeState=IMPLEMENTING e I | resume/implement | G+E |
| TR-040 | AWAITING_HUMAN | REVIEWING | GA e resumeState=REVIEWING e V | resume/review | G |
| TR-041 | AWAITING_HUMAN | REWORK | GA e resumeState=REWORK e W | resume/rework | G+E |
| TR-042 | AWAITING_HUMAN | BLOCKED | B o X, oppure GA con resumeState=BLOCKED | block | Q; G se consumato |
| TR-043 | AWAITING_HUMAN | FAILED | F | fail | Q; chiudere gate |

Espansione del `resumeState` P0: l'insieme ammesso è `{PENDING, ANALYZING, READY, IMPLEMENTING, REVIEWING, REWORK, BLOCKED}`. Non si creano target TESTING/COMPLETED/FAILED attraverso approvazione: TESTING richiede TR-013, COMPLETED TR-022 e FAILED TR-043. Il gate non sceglie il proprio target.

Recovery su BLOCKED resta BLOCKED con evento di riconciliazione, non self-transition. Su stati terminali non esistono TR: un ledger terminale corrotto viene rifiutato/quarantinato dal loader e non viene esposto come completamento valido; non si riscrive il suo stato inventando una transizione.

### STM-004 — Aggiornamenti senza cambio di stato

Ricezione risultati, intent, run binding, contatori, apertura escalation, decisioni e progressi producono eventi RECORD (DATA-010) e incrementano revision, ma NON cambiano `state`. Sono autorizzati solo all'Orchestrator nei seguenti stati:

- ANALYZING: Scout/Oracle, analisi e decisioni;
- IMPLEMENTING: Developer, handoff, prove terminali e materializzazione deterministica del candidato dopo quiescenza;
- TESTING: candidato, scope, ValidationResult;
- REVIEWING: ReviewResult/disposition/final check;
- REWORK/BLOCKED: riconciliazione, diagnosi, Oracle condizionato;
- AWAITING_HUMAN: soltanto decisione gate e diagnostica; nessun nuovo child;
- PENDING/READY: diagnostica, snapshot, verifica capability; nessun writer;
- terminali: nessun nuovo record mutante del task.

Un guasto prima dell'ingresso IMPLEMENTING rifiuta TR-009/TR-027/TR-039; in READY non si inventa un READY→BLOCKED generico: un aggiornamento incompatibile delle precondizioni è incoerenza rilevata dalla riconciliazione e segue TR-012. In TESTING una richiesta scope nuova va prima TR-020, poi TR-034: TESTING→AWAITING_HUMAN non è ammessa.

## C. Contratti dati

### DAT-000 — Notazione comune e validazione

La notazione seguente equivale a JSON Schema più vincoli semantici espliciti. `?` = opzionale; ogni altro campo è obbligatorio. Tutti gli oggetti, inclusi quelli annidati, hanno `additionalProperties: false`. `null` è vietato salvo tipo esplicito. Mancante non significa false/zero/PASSED. Non coercire stringhe in numeri, non eliminare campi sconosciuti. Ogni struttura nominata porta `schemaVersion: 1`, salvo AssignmentEnvelope DATA-002 che richiede `schemaVersion: 2`; nessun oggetto è un dizionario aperto.

Tipi scalari:

- `ID`: stringa ASCII 1–128, pattern `[A-Za-z0-9][A-Za-z0-9._-]*`, univoca nel relativo insieme.
- `Text`: UTF-8 non vuoto, max 4096 byte, senza NUL; `LongText`: max 65536 byte.
- `UInt`: intero sicuro 0..9007199254740991; overflow rifiutato; contatori entro i cap della policy.
- `Hash`: 64 cifre hex minuscole, SHA-256; `GitOID`: 40 o 64 hex, conforme al repository.
- `Time`: RFC3339 UTC con suffisso Z; durata ms `UInt`; timeout 1..2147483647 ms.
- `Path`: percorso relativo conforme SCP-001, max 4096 byte. `Root`: assoluto canonico verificato dall'host, max 4096 byte; mai ricavato dall'output child.
- `State`: uno degli undici stati STM-001. `Role`: Scout|Developer|Reviewer|Oracle.
- `List<T>[a..b]`: array con cardinalità inclusiva; niente duplicati dove contiene ID/riferimenti/path.

Limiti oggetti serializzati: TaskSpec e AssignmentEnvelope max 256 KiB ciascuno; ogni result max 1 MiB; WorkflowState max 4 MiB; TransitionEvent max 1 MiB. Superamento → invalido/BLOCKED, non truncation con perdita semantica. I dati voluminosi sono artifact. Tutti gli hash si riferiscono ai byte effettivamente conservati. Non includere segreti nei packet/log contrattuali.

Serializzazione canonica per hash di oggetti: JSON UTF-8 senza whitespace, chiavi ordinate lessicograficamente per code point, array nell'ordine dichiarato, niente numeri non interi, duplicati di chiave vietati, Unicode senza surrogate isolati e senza normalizzazione silenziosa. Escape JSON canonici: quote e backslash escapati, controlli U+0000..001F in `\u00xx` minuscolo, altri caratteri letterali. Hash fields auto-riferiti esclusi soltanto dove dichiarato. Collisioni/path non rappresentabili → BLOCKED, mai normalizzazione che cambi identità.

#### Rappresentazione canonica degli interi

Ogni valore numerico ammesso dai contratti deve essere un intero entro i limiti già definiti per il relativo campo. La sua rappresentazione canonica JSON deve rispettare tutte le seguenti regole:

- decimale ASCII base 10;
- nessun segno `+`;
- segno `-` esclusivamente per valori strettamente negativi;
- nessuna parte frazionaria;
- nessuna notazione esponenziale;
- nessuno zero iniziale, eccetto il valore `0`;
- IEEE-754 `-0` deve essere canonicalizzato esattamente come `0`.

La canonicalizzazione opera sul valore validato, non sulla forma lessicale con cui il numero era originariamente espresso: valori numericamente equivalenti devono produrre gli stessi byte canonici. `NaN`, `Infinity`, `-Infinity`, valori non interi e valori fuori dai limiti del relativo campo sono invalidi e non devono essere canonicalizzati. Non viene introdotto supporto per valori floating-point non interi né modificato alcun limite numerico o vincolo di parsing JSON.

Esempi normativi (a destra il testo canonico, non un valore JSON di tipo stringa; i valori negativi sono ammessi solo nei campi che li consentono, come `exitCode`, mai in `UInt`):

```text
0   -> "0"
-0  -> "0"
1   -> "1"
-1  -> "-1"
42  -> "42"
```

### AUX-001 — Tipi condivisi chiusi

Ogni record qui sotto include implicitamente `schemaVersion:1`; tutti i campi elencati non marcati ? sono richiesti.

| Tipo | Campi e limiti | Vincoli semantici |
|---|---|---|
| ArtifactRef | id:ID, digest:Hash, relativeStorePath:Path, bytes:UInt, mediaType:Text | Path dentro storage orchestratore; digest/size verificati; nessuna lettura di path arbitrari suggeriti dal child. |
| InputSource | una sola fra inline:LongText o path:Root; snapshot:ArtifactRef | Contenuto letto/approvato; inline e file corrispondono ai byte snapshot. Path è provenienza, non autorizzazione di scrittura. |
| Requirement | id:ID, text:Text | ID unico e referenziato da almeno un criterion. |
| Criterion | id:ID, requirementIds:List<ID>[1..256], text:Text, method:AUTOMATED\|REVIEW\|BOTH, commandIds:List<ID>[0..64], reviewInstruction:Text | AUTOMATED/BOTH richiede commandIds non vuoti e tutti required=true; REVIEW richiede array vuoto; ogni ID esiste. Anche AUTOMATED viene controllato dal Reviewer. |
| CommandSpec | id:ID, executable:Root, argv:List<Text>[0..64], timeoutMs:UInt positivo, required:boolean | cwd sempre candidato, nessuna shell implicita né interpolazione task; eseguibile/argomenti esatti approvati; stdout/stderr non sono verdetti. Comandi esplicitamente shell richiedono stesso trattamento di trust e approvazione, mai inferiti. |
| ScopeSpec | repoRoot:Root, baseRef:Text, allowedPaths:List<Path>[0..4096], deniedPaths:List<Path>[0..4096], strongConfinementRequired:boolean | Semantica SCP-001; `baseRef` normalizzato a HEAD se omesso in input; mutazione con allow vuoto impossibile. |
| RetryPolicy | maxReworkAttempts:UInt, maxInfrastructureRetries:UInt, maxDispatches:UInt, maxEscalationEpisodes:UInt | Default 2,1,64,4; vincoli RET-001. Tetti globali approvati non superabili. |
| GatePolicy | beforeImplementation:boolean, onScopeChange:true, onOracleDecision:boolean, beforeCompletion:boolean, onRetryExhausted:boolean | Default true per tutti; scope non disattivabile; nessuna policy autorizza modello ad approvare. |
| Observation | id:ID, text:Text, evidenceRefs:List<ID>[1..64] | Evidenze esistenti, non prova a sé stante. |
| Risk | id:ID, text:Text, criterionIds:List<ID>[0..256], blocking:boolean | Blocking o requisito non verificabile impedisce PASS/completion. |
| Finding | id:ID, text:Text, severity:P0\|P1\|P2, blocking:boolean, paths:List<Path>[0..64], criterionIds:List<ID>[0..256], evidenceRefs:List<ID>[1..64] | Finding concreto sul candidato, non nuova authority. |
| Assessment | status:PASS\|FAIL\|UNVERIFIABLE, evidenceRefs:List<ID>[0..64], reason:Text | PASS/FAIL richiede evidenza non vuota; UNVERIFIABLE non può soddisfare un criterio. |
| CriterionAssessment | criterionId:ID, assessment:Assessment | Esattamente una per criterion del TaskSpec. |
| DecisionRecord | id:ID, kind:ACCEPT_FINDING\|DISMISS_FINDING\|DEFER_RISK\|RESOLVE_RISK\|ADOPT_ADVICE\|REJECT_ADVICE\|RESOLVE_AMBIGUITY, subjectId:ID, reason:Text, evidenceRefs:List<ID>[1..64], humanGateId?:ID | Decisione Orchestrator; non deroga ai criteri. Scope/product tradeoff richiede gate. |
| RunRecord | assignmentId:ID, attemptId:ID, role:Role, requestId:ID, runId?:Text, childSessionId?:Text, ownerSessionId:Text, status:INTENT\|BOUND\|RUNNING\|TERMINAL\|UNKNOWN, terminalProofRef?:ID, resultRef?:ID | BOUND+ richiede runId; TERMINAL richiede proof; identità fornite dal runtime, non dal child. |
| FailureRecord | id:ID, phase:State, category:INFRA\|TEST\|REVIEW\|SCOPE\|SCHEMA\|RECOVERY\|AMBIGUITY, code:ID, subjectIds:List<ID>[0..64], fingerprint:Hash, evidenceRefs:List<ID>[1..64] | Fingerprint RET-001; categoria non sostituita per ottenere più retry. |
| Counters | attempts:UInt, reworkAttempts:UInt, infrastructureRetries:UInt, dispatches:UInt, escalationEpisodes:UInt, oracleInvocations:UInt | Monotoni; ogni incremento collegato a intent/episode. |
| Escalation | id:ID, triggerFailureIds:List<ID>[1..64], question:Text, oracleAttemptId?:ID, resultRef?:ID, decisionId?:ID, closed:boolean | Un solo Oracle dispatch per episodio; chiusura richiede decisione motivata. |
| Candidate | root:Root, baseCommit:GitOID, digest:Hash, generation:UInt, manifest:ArtifactRef, patch:ArtifactRef, handoff:ArtifactRef, terminalProof:ArtifactRef | Digest ricalcolato; root diverso dall'originale; generation cresce anche se un rework ripristina byte precedenti. |
| CapabilityEvidence | id:ID, itemId:ID, status:VERIFIED\|UNVERIFIED\|FAILED, environmentHash:Hash, evidenceRefs:List<ID>[0..64] | VERIFIED solo dopo test pertinente superato; ambiente/versione diversi invalidano l'attestazione. |

Ulteriori record chiusi (sempre schemaVersion:1):

| Tipo | Campi | Vincoli |
|---|---|---|
| HumanDecisionEvidence | id:ID, gateId:ID, taskId:ID, decision:APPROVE\|REJECT\|ANSWER, answer?:Text, actorId:Text, channelId:ID, confirmationId:ID, displayedRevision:UInt, displayedDataHash:Hash, confirmedAt:Time, trustedChannelEvidenceRef:ID | Creato solo dal canale host di conferma verificato; answer obbligatorio per ANSWER. Il trasporto attestato deve legare identità/revisione/hash alla stessa conferma. GAT-002 distingue il binding storico del canale v1 dal canale v2 con GatePresentation esplicita: nessuna migrazione implicita. JSON fornito da modello/file non fidato non è prova; ANSWER non equivale ad APPROVE. |
| CandidateEntry | path:Path, kind:FILE\|SYMLINK, mode:100644\|100755\|120000, contentHash:Hash | mode è stringa; kind/mode coerenti. Hash di byte file oppure target link, senza follow. |
| CandidateManifest | baseCommit:GitOID, entries:List<CandidateEntry>[0..100000] | Path unici ordinati per byte UTF-8; max 64 MiB di manifest, altrimenti BLOCKED. Tutti i record hanno schemaVersion incluso nel digest. |

Ogni ID di evidenza risolve a un ArtifactRef host registrato e tipizzato; ID validi sintatticamente ma non attribuiti sono invalidi. L'host associa i riferimenti alle letture/trace reali, non accetta path arbitrari come prova. HumanDecisionEvidence resta UNVERIFIED a livello di trasporto fino a UV-007.

I limiti numerici di RetryPolicy sono configurabili prima del task: maxReworkAttempts 0..tetto globale (default globale 2); maxInfrastructureRetries 0..1 per task; maxDispatches 1..64; maxEscalationEpisodes 1..4. Ridurre cap sotto contatori consumati è invalido. Non aumentarli per il task attivo dopo esaurimento.

### DATA-001 — TaskSpec

| Campo | Tipo | Semantica/validazione |
|---|---|---|
| schemaVersion | 1 | Obbligatorio. |
| taskId | ID | Identità durevole, non cambia su retry. |
| specRevision | UInt | Parte da 0, nuova spec = +1. |
| title | Text | Titolo. |
| objective | LongText | Obiettivo bounded. |
| plan | InputSource | Piano inline o path esplicito, nessun nome magico. |
| currentTask | InputSource | Task corrente snapshot esplicito. |
| requirements | List<Requirement>[1..256] | ID unici. |
| acceptanceCriteria | List<Criterion>[1..256] | Copertura completa requirement. |
| scope | ScopeSpec | Default deny. |
| constraints | List<Text>[0..128] | Non può derogare a INV. |
| validationCommands | List<CommandSpec>[1..64] | Almeno uno required=true. |
| humanGates | GatePolicy | Default normalizzati prima di hash. |
| retryPolicy | RetryPolicy | Default normalizzati. |
| sourceApprovalGateId? | ID | Obbligatorio se requisiti/criteri sono estratti dal modello. |
| specHash | Hash | Hash canonico dell'oggetto escluso solo specHash. |

Invalido: fonte assente/non leggibile/non coincidente, ID duplicati/dangling, criterio senza metodo, hash errato, constraint contraddittorio, comando non autorizzato, scope non rappresentabile. Una spec strutturalmente valida ma ambigua resta ANALYZING/BLOCKED; non READY. Cambiare file fonte dopo freeze non cambia la spec in place: attivare gate/rianalisi, mantenere versioni immutabili.

### DATA-002 — AssignmentEnvelope

| Campo | Tipo | Semantica/validazione |
|---|---|---|
| schemaVersion | 2 | Obbligatorio; nuova semantica launchContractHash CLA-001, nessuna coercizione da v1. |
| assignmentId, taskId, attemptId | ID ciascuno | Identità distinta per ogni dispatch. |
| role | Role | Ruolo unico. |
| specHash | Hash | Spec congelata corrente. |
| objective | LongText | Sotto-task autorizzato, non nuovo scope. |
| repoRoot | Root | Originale per provenienza. |
| workRoot | Root | Root effettiva consentita al child. |
| baseRef | Text | Ref ammessa, non expression/SHA raw per allocazione pi-subagents. |
| baseCommit? | GitOID | Obbligatorio per Developer/Reviewer. |
| allowedPaths, deniedPaths | List<Path>[0..4096] ciascuno | Copia scope approvata; role read-only non acquisisce write tramite allow. |
| requirements, acceptanceCriteria | Come TaskSpec | Copia esatta dei requisiti pertinenti; Reviewer riceve tutti. |
| constraints, stopConditions | List<Text>[0..128], List<Text>[1..128] | Comprende stop per scope/ambiguità/schema. |
| inputArtifactRefs | List<ID>[0..256] | Solo riferimenti verificati. |
| authority | List<ID>[0..16] | ID operazioni AUT-001 permesse; subset del ruolo. |
| validationCommands | List<CommandSpec>[0..64] | Developer: esplorativi, mai autorevoli; Reviewer riceve metadata/log non grant exec. |
| context | fresh\|fork | Fresh obbligatorio Scout/Developer/Reviewer; Oracle fork solo verificato. |
| candidateDigest?, candidateGeneration? | Hash, UInt | Obbligatori per Reviewer, entrambi presenti o assenti. |
| launchContractHash | Hash | SHA-256 canonico del ControlledLaunchContract CLA-001 posseduto dal package; mai un provider launchContractDigest. |
| assignmentHash | Hash | Hash canonico escluso assignmentHash. |

Invalido: authority eccessiva, scope non subset, candidato errato, contesto reviewer fork, hash/identity non concordi. Ref approvata va risolta e ri-controllata al launch per evitare HEAD mobile.

### CLA-001 — ControlledLaunchContract (Controlled Launch Authority Contract)

Nuovo oggetto chiuso, max 64 KiB; nessun campo opzionale o sconosciuto. È la proiezione deterministica dell'authority del package **before** del dispatch, non una copia del contratto del provider. Role→nome fisso: Scout→`controlled.scout`, Developer→`controlled.developer`, Reviewer→`controlled.reviewer`, Oracle→`controlled.oracle`. Nessun alias, nome path-like o nome proveniente da TaskSpec/modello è ammesso.

| Campo | Tipo/limite | Semantica |
|---|---|---|
| schemaVersion | 1 | Versione autonoma del contratto di authority. |
| controlledAgentId | ID | Esattamente il nome fisso del ruolo. |
| registrationProtocolVersion | 1 | Contratto event registration v1. |
| expectedRole | Role | Deve coincidere con AssignmentEnvelope.role. |
| baseSystemPromptHash | Hash | SHA-256 dei byte UTF-8 esatti del prompt base controllato, non del task né del prompt aumentato dal provider. |
| systemPromptMode | replace\|append | Scout/Reviewer/Oracle replace nel minimo; nessun override normale può ampliarlo. |
| contextPolicy | ControlledContextPolicy | Policy chiusa sotto; assignment.context deve esserne membro e rispettare DATA-002. |
| allowedTools, excludedTools | List<ID>[0..64] ciascuno | Allowlist esplicita e deny-list; nomi tool, mai path o grant impliciti. |
| allowNestedSubagents | false | Tutti i child controllati sono leaf; niente delegazione. |
| inheritProjectContext, inheritGlobalContext, inheritSkills | boolean ciascuno | Valori espliciti controllati, non default impliciti dell'host. |
| extensions, subagentOnlyExtensions | List<ControlledExtensionRef>[0..16] ciascuno | Liste esplicite, niente ambient discovery; ordine di caricamento significativo. |
| mutationTools | List<ID>[0..64] | Classificazione controllata; non concede tool o scrittura da sola. |
| internalProtocolTools | List<ID>[0..1] | Esattamente `["structured_output"]` per DATA-003..006; nessun altro tool interno implicito autorizzato. |
| capabilityConstraints | ControlledCapabilityConstraints | Authority logica separata dalle preferenze e dallo scope del singolo task. |

Record annidati chiusi, tutti con `schemaVersion:1`:

- **ControlledContextPolicy**: `defaultContext:fresh|fork`, `allowedContexts:List<fresh|fork>[1..2]`. Default membro della lista; Scout/Developer/Reviewer: fresh e `["fresh"]`. Oracle può includere fork solo secondo CAP-001/RET-001, senza fallback implicito; cambiare la policy cambia l'hash.
- **ControlledExtensionRef**: `id:ID`, `artifactHash:Hash`. ID di risorsa controllata dal package, digest dei byte del bundle immutabile comprensivo delle dipendenze eseguibili necessarie; risoluzione host verificata prima del dispatch. Non è un path provider. Risorsa/chiusura non verificabile → BLOCKED; non bastano nome o digest del solo entrypoint con dipendenze sconosciute. Scout usa liste vuote.
- **ControlledCapabilityConstraints**: `operationIds:List<ID>[0..14]` (solo OP-01..OP-14 con ALLOW/ALLOW* del ruolo in AUT-001; PROPOSE_ONLY non è un grant), `mutationPolicy:DENY|ASSIGNMENT_SCOPE`, `scopePolicy:"SCP-001"`, `additionalRuntimePermissions:"NONE"`. Scout/Reviewer/Oracle mutationPolicy=DENY; Developer ASSIGNMENT_SCOPE solo col grant OP-02 condizionato. Nessun grant per stato globale, scrittura dell'originale, delegazione, merge/push/publish. Le permissions native non ricevono grant ulteriori; questo schema non ammette configurazioni arbitrarie di permissions. Una permission/restrizione necessaria non rappresentabile richiede revisione esplicita del contratto, altrimenti BLOCKED, mai omissione. Policy del package non è automaticamente un campo supportato dal provider: la traduzione/enforcement pertinente va verificata, non presunta. AUT-001 e SCP-001 restano vincolanti.

Liste che rappresentano insiemi (`allowedTools`, `excludedTools`, `mutationTools`, `internalProtocolTools`, `allowedContexts`, `operationIds`) senza duplicati e ordinate lessicograficamente per code point; input non conforme rifiutato, non riparato. Liste extensions preservano l'ordine dichiarato e non ammettono ID duplicati. Ogni allow mutante deve rispettare mutationPolicy e ruolo; niente tool `subagent` o equivalente delegation. La proiezione deve coprire **tutti** i campi authority-sensitive della definition: un campo nuovo/non rappresentato non può essere ignorato; nuova versione/amendment o blocco.

Mapping della definition: `name=controlledAgentId`, `tools=allowedTools`, `excludeTools=excludedTools`, `defaultContext=contextPolicy.defaultContext`; prompt base, mode, nesting, inheritance e mutationTools devono corrispondere ai campi/hash sopra. Le extension refs si risolvono soltanto in risorse immutabili controllate e verificate del package, non in path scelti da task/modello. `internalProtocolTools` descrive il protocollo richiesto da outputSchema, non una seconda allowlist arbitraria. I vincoli logici AUT/SCP governano l'host/assignment e non vanno inviati come campi provider inventati. Nessuna selezione model/provider/thinking può alterare questa proiezione. Ogni campo authority-sensitive della request non rappresentabile in questo mapping richiede blocco/revisione, non esclusione silenziosa dall'hash.

`launchContractHash = SHA256(canonicalJSON(ControlledLaunchContract))`, usando DAT-000 e includendo tutti i campi (nessun self-hash presente). La definition immutabile del package produce il contratto; hash del prompt e delle eventuali risorse sono verificati sui byte registrati/risolti. `assignmentHash` include launchContractHash e schemaVersion 2. Il contratto deve essere conservato come ArtifactRef tipizzato, risolvibile dal registro host per hash; corrispondenza esatta nome/ruolo/context/hash verificata prima di spawn. L'hash non autentica l'owner e non prova enforcement.

**Esclusioni normative:** model/provider/thinking/fast non-authority non sono campi del contratto né input indiretti del suo hash. Non invalidano authority identity perché non cambiano i permessi; si conservano separatamente come execution metadata attribuiti. Vietati anche runId, timestamp, task text, scope/path volatili del task/runtime, transcript, model output e digest provider. Scope specifico resta vincolato da specHash/assignmentHash/SCP-001, non sparisce dai controlli. Cambiare una proprietà di authority cambia il contratto/hash; cambiare una preferenza lecita no. Nessun fallback modello autorizzato da questa esclusione.

**Compatibilità:** DATA-002 v1 aveva un'altra semantica; resta soltanto storico e non è ammesso per nuovi dispatch secondo questo amendment. Non rinominarlo v2 né sostituirne il digest automaticamente. Altri DATA conservano v1 e legano il nuovo assignment tramite assignmentHash. L'implementazione P4/P5 non viene modificata né dichiarata conforme ai nuovi record/v2: il futuro allineamento richiede autorizzazione e test. Nessuna migrazione/recovery o P6 avviata qui.

### REG-001 — RuntimeAgentRegistrationBoundary e Operational Binding

Evento pubblico process-local `pi-subagents:runtime-agent-register:v1`, emesso direttamente tramite `pi.events`, senza import `pi-subagents/agents`. Request pubblica `{version:1,name,definition}`; il listener compatibile scrive sincronicamente `result`. Successo: `result.ok===true` e `registration.dispose` funzione; assenza result → **capability unavailable**, errore/versione non supportata → BLOCKED per l'uso necessario. Non riparare definition rifiutata, non cercare installazioni né altri launcher. Il wire contract del provider (inclusi Error e disposer) non è un record JSON persistibile DAT-000.

Pi risolve i package per identità; una entry di progetto normalmente sostituisce l'equivalente personale e dichiarazioni equivalenti non caricano due volte lo stesso package. pi-controlled-dev si affida a questo package-loading model e tratta host Pi, extension caricate e pi-subagents già caricato come trusted infrastructure. Non deduce installazioni dal filesystem, non conta copie npm sul disco e non tenta di autenticare extension ostili che imitino intenzionalmente il contratto: tale scenario è fuori dal threat model normale. Conta il servizio disponibile nel processo Pi corrente; le anomalie osservabili restano fail-closed.

Controlled Runtime Agent = nome fisso e definition immutabile prodotti da pi-controlled-dev, registrati tramite il servizio process-local e risolti/eseguiti tramite RPC nello stesso runtime Pi, con cleanup tramite il handle. Runtime registration è l'unica fonte controllata; file `agents/*.md` sono template/documentazione non registrati, non una fonte concorrente. Registration non concede authority globale e non lancia child.

**EXTENSION-OWNED:** prompt base/mode, tools/exclusions, nesting, context policy, inheritance project/global/skills, extensions/subagent-only extensions, mutation tools e permissions/capability constraints pertinenti. Ogni campo necessario deve essere supportato e verificato; nessuna configurazione ordinaria può ampliare questa authority. **OPERATOR-CONFIGURABLE:** model, provider, thinking e fast quando documentato, purché non cambino quei campi. L'applicazione di una scelta operatore non è escalation; una modifica indiretta a tools/context/inheritance lo è. Augmentations interne del provider (protocollo output/acceptance/bridge) vanno distinte dal prompt base e non autorizzano tools aggiuntivi fuori CLA-001.

**Operational Registration/Execution Binding.** Il binding è valido, nella stessa sessione/runtime Pi, soltanto quando: (1) registration v1 restituisce accepted; (2) il nome runtime è esattamente quello controllato dal package; (3) la definition è quella prodotta da pi-controlled-dev; (4) il registration handle è attivo; (5) RPC v1 è disponibile nello stesso processo; (6) RPC risolve esattamente lo stesso runtime agent name; (7) spawn restituisce un runId valido; (8) completion è correlata; (9) structured output è attribuito; (10) le verifiche post-launch identity/authority EVD-001 non rilevano contraddizioni. Nessun owner ID aggiuntivo è richiesto.

Prima dello spawn, il registro host lega **localmente** handle, definition snapshot, contract artifact/hash, sessione e generazione runtime e verifica i punti 1–6; i punti 7–10 completano il binding dopo il launch. Questa associazione non è un token o un'attestazione completa del provider; registration receipt da sola resta insufficiente.

Record chiuso **ControlledRegistrationEvidence**, schemaVersion:1: `id:ID`, `controlledAgentId:ID`, `expectedRole:Role`, `registrationProtocolVersion:1`, `rpcVersion:1`, `ownerSessionId:Text`, `runtimeGeneration:ID`, `launchContractHash:Hash`, `contractRef:ID`, `definitionRef:ID`, `accepted:true`, `handleActiveAtObservation:true`, `capabilityEvidenceRefs:List<ID>[1..64]`. Tutti i riferimenti sono ArtifactRef host attribuiti; max 64 KiB. `ownerSessionId` identifica la sessione host, non un owner ID interno di pi-subagents; `runtimeGeneration` identifica la generazione locale di pi-controlled-dev. Il record documenta registration accepted e binding operativo locale, senza pretendere un'identità provider non esposta. Liveness del handle va ricontrollata in memoria prima di ogni dispatch, non dedotta da un record persistito. Un JSON equivalente fornito dal modello non è prova valida; non si aggiungono `providerOwnerId` o `executorOwnerId` fittizi.

La receipt non espone snapshot completo, digest della definition, source metadata, unicità o identità interna del provider: VIETATO attribuirglieli. La possibilità teorica di più responder non blocca da sola. Evidenza concreta di responder incompatibili o reply contraddittorie → BLOCKED; duplicate identiche possono essere trattate idempotentemente soltanto se tutti gli altri controlli restano coerenti.

Fail-closed su anomalie osservate: reply di registration contraddittorie; doppia registrazione o altro runtime agent omonimo/alias; static profile ambiguity; RPC che non risolve il runtime agent registrato; source runtime inattesa; effective tools o context differenti; delegazione disponibile quando vietata; extensions inattese; structured output non attribuibile; registration handle non più valido; session/runtime replacement non riconciliato. La receipt può precedere la discovery delle collisioni statiche dipendenti dal cwd: non autorizza a ignorare un successivo rifiuto RPC. Source inattesa dopo launch comporta evidenza respinta/quarantena e blocco, nessun nuovo dispatch. Non rinominare/sanitizzare agenti e non ampliare il dominio ID perché un provider accetta nomi path-like.

Lifecycle: register durante session startup con servizio compatibile, handle solo nel runtime corrente; dispose su shutdown/reload cleanup, eliminazione del binding e chiusura dei listener propri. Idempotenza richiesta e da collaudare, non inferita dalla sola presenza del metodo. Nuova sessione/runtime → nuova registrazione, mai riuso/deserializzazione di handle precedenti. Dispose non ferma un run già partito e nuova registrazione non autorizza retry di un intent UNKNOWN: controllo/reconciliation restano RPC/PST-001. Questo è lifecycle normale, non implementazione di recovery avanzata.

### SCOUT-001 — Contratto minimo del futuro controlled.scout

Nome fisso `controlled.scout`, expectedRole=Scout, prompt base bounded del package, systemPromptMode=replace; defaultContext e assignment.context=fresh, allowedContexts=[fresh]. `allowedTools=[read]`; `excludedTools=[bg_wait,contact_supervisor,watchdog_diff]` nell'ordine canonico. Allowlist esplicita nega ogni tool non elencato, compresi write/edit/bash/subagent; esclusioni negano anche helper runtime non necessari. `allowNestedSubagents=false`, tutti gli inheritance flag=false, extensions/subagentOnlyExtensions/mutationTools vuoti. internalProtocolTools=[structured_output]; operationIds=[OP-01], mutationPolicy=DENY, scopePolicy=SCP-001, additionalRuntimePermissions=NONE. Nessun runner esterno, machine binding, grant di stato/scope/publication. Campo richiesto non supportato → BLOCKED.

Output richiesto: ScoutResult DATA-003 con DAT-RESULT, validato nuovamente e correlato a assignment/run/sessione. recommendedScope resta PROPOSE_ONLY; ambiguità non risolte non sono riparate dal child. L'hash esatto del prompt sarà derivato dalla definition implementata e autorizzata, non da un placeholder inventato in questo amendment. Nessun profilo operativo è creato qui.

### EVD-001 — Verifica indipendente post-launch e digest provider

Verificare indipendentemente dopo il launch, tramite evidenze runtime attribuibili quando disponibili, runtime agent identity, source runtime della registrazione attesa, context fresh effettivo, tool registry effettivo (non solo tools invocati), effective extensions, no-delegation e attribuzione dello structured output. Per Scout e gli altri ruoli read-only, confrontare hash/inventario/diff e metadata rilevanti prima/dopo, rilevando anche aggiunte/delezioni/rename: il read-only canary resta obbligatorio. Questi sono i controlli sostanziali dell'authority. History-canary per fresh non è prova assoluta contro leakage; allowlist non è sandbox OS. Una proprietà necessaria non osservabile/verificabile resta UNVERIFIED e impedisce accettazione: nessun PASS dalla sola receipt, dal nome o dall'hash.

Artefatti letti nello spike sono evidenza sperimentale, non una nuova API o meccanismo production autorizzato. L'integrazione futura deve documentare e collaudare la provenienza dei controlli senza import privati. P4 valida i dati, non autentica il trasporto; l'Orchestrator resta unica authority globale.

Conservare separatamente il nostro launchContractHash e gli eventuali `launchContractDigest` del provider, con issuer, campo/livello (spawn, completion principale, child), run/session e riferimento ai byte originali. Questi ultimi sono evidence provider, non root of trust universale. Vietato copiarli nel nostro hash, modificarli/normalizzarli per coincidere o imporre uguaglianza fra i due domini senza futura specifica che provi stessi byte/oggetto.

Questione aperta: **provider launchContractDigest consistency under operator model/provider/thinking overrides**, osservata nello spike 0.72.1; causa non risolta. Differenze fra campi/livelli provider si conservano e non bloccano da sole CLA-001 quando authority e identità sono provate indipendentemente. Non usarle come prova positiva di equivalenza. Contraddizioni nella medesima evidenza/campo correlato, nostro hash errato, source/tools/context discordi o prove necessarie mancanti continuano a bloccare secondo INV-012/PST-001. Nessuna eccezione ai digest di spec/candidato/assignment o alle completion duplicate contraddittorie.

### DAT-RESULT — Envelope comune risultati

I quattro result DATA-003..006 includono tutti: `schemaVersion:1`, `taskId:ID`, `assignmentId:ID`, `attemptId:ID`, `role:Role` con valore esatto per il tipo, `specHash:Hash`, `assignmentHash:Hash`, `evidenceRefs:List<ID>[0..256]`. I campi aggiuntivi sono sotto. Run/session effettivi vengono collegati dall'Orchestrator tramite RunRecord; non vengono attestati affidandosi al result.

Un result è invalido se schema sbagliato, ruolo/assignment non corrispondenti, riferimenti inesistenti, duplicati contraddittori, structured output runtime assente o identità di trasporto ambigua. Un documento JSON stampato in output testuale non sostituisce `structuredOutput` verificato. Result valido non è accettazione.

### DATA-003 — ScoutResult

| Campo aggiuntivo | Tipo | Semantica |
|---|---|---|
| observations | List<Observation>[0..128] | Fatti con evidenza. |
| relevantFiles | List<Path>[0..1024] | File realmente ispezionabili nel repository. |
| risks | List<Risk>[0..128] | Rischi dichiarati, array vuoto esplicito. |
| ambiguities | List<Text>[0..128] | Non vuoto blocca READY finché risolto. |
| recommendedScope | ScopeSpec | PROPOSE_ONLY, non sovrascrive TaskSpec. |

Invalido anche se ha scritto file durante il run: il trasporto può essere riuscito, ma la sua evidenza è respinta per violazione INV-025.

### DATA-004 — DeveloperResult

| Campo aggiuntivo | Tipo | Semantica |
|---|---|---|
| summary | Text | Resoconto, non verdict globale. |
| changedFiles | List<Path>[0..4096] | Dichiarazione confrontata col diff effettivo. |
| commandsRun | List<ID>[0..64] | Comandi esplorativi consentiti e attribuibili. |
| tests | List<Observation>[0..128] | Report esplorativo, mai ValidationResult autorevole. |
| residualRisks | List<Risk>[0..128] | Non nascondere blocchi. |
| blockedReason? | Text | Se presente vieta progresso a TESTING. |

Handoff e patch sono raccolti dal runtime/host, non inventati come path nel report. Liste omesse, file dichiarati non congruenti o tentativo `completed:true` rendono l'oggetto invalido.

### DATA-005 — ReviewResult

| Campo aggiuntivo | Tipo | Semantica |
|---|---|---|
| verdict | PASS\|FAIL\|BLOCKED | REV-001. |
| reviewedTreeHash | Hash | Nome P0 mantenuto; è candidate digest SCP-002, non solo Git HEAD. |
| candidateGeneration | UInt | Generazione assegnata. |
| criteria | List<CriterionAssessment>[1..256] | Copertura esatta, nessun criterion omesso/duplicato. |
| findings | List<Finding>[0..256] | Evidenze concrete. |
| scopeAssessment | Assessment | Scope e modifiche effettive, non solo report Developer. |
| testAssessment | Assessment | Verifiche obbligatorie e loro attribuzione. |
| actualChangesAssessment | Assessment | Diff baseline→candidato. |
| residualRisks | List<Risk>[0..128] | Risk assessment obbligatorio, anche array vuoto. |
| validationResultIds | List<ID>[1..64] | Risultati correnti letti dal Reviewer. |

Invalido se PASS contraddetto da FAIL/UNVERIFIABLE, finding blocking, missing criterion o digest mismatch. Inoltre identità run/session del Developer e Reviewer devono differire, indipendentemente dal nome profilo/modello.

### DATA-006 — OracleResult

| Campo aggiuntivo | Tipo | Semantica |
|---|---|---|
| escalationId | ID | Episodio aperto corrispondente. |
| diagnosis | Text | Consiglio bounded. |
| options | List<Text>[1..16] | Alternative, non istruzioni esecutive. |
| recommendation | Text | Motivazione di una scelta proposta. |
| unresolvedQuestions | List<Text>[0..64] | Non possono essere assunte risolte. |
| needsHumanDecision | boolean | true impone gate, false non lo evita se la policy/ambiguità lo richiede. |

Invalido se episodio assente, invocazione non autorizzata o schema esteso con authority/stato. Solo una DecisionRecord dell'Orchestrator può adottare la raccomandazione; scope/product richiede umano.

### DATA-007 — WorkflowState

| Campo | Tipo | Semantica/validazione |
|---|---|---|
| schemaVersion | 1 | Versione persistita. |
| taskId | ID | Task esistente. |
| packageVersion | Text | Versione che scrive il ledger. |
| revision | UInt | Parte da 0; ogni evento +1. |
| state | State | Stato corrente. |
| spec | ArtifactRef | TaskSpec normalizzata durevole. |
| specHash | Hash | Concorde col contenuto. |
| ownerSessionId | Text | Proprietario runtime. |
| repoRoot | Root | Identità canonica. |
| baselineRef? | Text | Ref verificata quando disponibile. |
| baselineCommit? | GitOID | Necessaria prima del writer. |
| baselineEvidence | List<ID>[0..64] | Status/index/untracked/base digest. |
| candidate? | Candidate | Assente finché non materializzato. |
| runs | List<RunRecord>[0..64] | Include intent senza runId. |
| counters | Counters | Monotoni. |
| failures | List<FailureRecord>[0..256] | Mai resettati da retry. |
| escalations | List<Escalation>[0..4] | Episodi bounded. |
| decisions | List<DecisionRecord>[0..256] | Audit authority. |
| validations, reviews, results, gates | List<ID>[0..256] ciascuno | Artifact tipizzati, non prosa. |
| pendingGateId? | ID | Obbligatorio solo AWAITING_HUMAN. |
| capabilities | List<CapabilityEvidence>[0..64] | Necessarie per azione corrente. |
| invalidEvidenceIds | List<ID>[0..1024] | Storico non eliminato. |
| blockedReason? | Text | Obbligatorio BLOCKED. |
| terminalReason? | Text | Obbligatorio FAILED/COMPLETED. |
| completionEvidenceRefs | List<ID>[0..256] | Non vuoto per COMPLETED, CMP-001. |
| lastEventId | ID | Evento committed corrispondente a revision. |
| createdAt, updatedAt | Time ciascuno | Ordinamento causale da revision, non solo wall clock. |

Stato iniziale viene creato da evento CREATE (state=PENDING, revision=0, contatori zero), non da uno stato fittizio. Stato invalido: terminale con run vivo/ignoto, gate pendente incompatibile, ref/candidate non attribuibili, contatori impossibili, revisione/evento divergenti. Loader non espone mai stato terminale invalido come successo.

### DATA-008 — ValidationResult

| Campo | Tipo | Semantica/validazione |
|---|---|---|
| schemaVersion | 1 | Obbligatorio. |
| id, taskId, commandId | ID ciascuno | Comando TaskSpec. |
| specHash, candidateDigest | Hash ciascuno | Binding obbligatorio anche NOT_RUN. |
| candidateGeneration | UInt | Generazione esatta. |
| commandHash | Hash | CommandSpec canonico. |
| status | PASSED\|FAILED\|NOT_RUN\|INVALID\|TIMED_OUT | VAL-001. |
| issuer | Orchestrator | Valore costante. |
| startedAt?, endedAt? | Time | Richiesti se processo avviato e terminato. |
| exitCode? | intero -2147483648..2147483647 | Assente se non noto, mai inventato zero. |
| durationMs? | UInt | Misurata dall'host. |
| logRef? | ID | Artifact durevole; richiesto per esecuzione avviata. |
| processProofRef? | ID | Necessario per risultato terminale accettato. |
| postCandidateDigest? | Hash | Necessario per PASSED, uguale al digest iniziale. |
| reason | Text | Ragione esplicita, anche successo. |

Non creato finché non esiste un candidato; prima della materializzazione si registra un blocco, non un digest fittizio.

### DATA-009 — HumanGate

| Campo | Tipo | Semantica/validazione |
|---|---|---|
| schemaVersion | 1 oppure 2 | V1 resta direct-human; v2 richiede authorizationKind esplicito. |
| id, taskId | ID ciascuno | Identità unica, mai riutilizzata. |
| type | beforeImplementation\|onScopeChange\|onOracleDecision\|beforeCompletion\|onRetryExhausted\|beforeReviewerRedispatch | Policy GAT-001. |
| requestedBy | Orchestrator | Il child può proporre, non creare approvazione. |
| status | PENDING\|APPROVED\|REJECTED\|INVALIDATED\|CONSUMED | Dato gate, non stato globale. |
| specHash | Hash | Spec vigente al momento richiesta. |
| proposedSpecHash? | Hash | Obbligatorio onScopeChange. |
| candidateDigest?, candidateGeneration? | Hash, UInt | Entrambi o nessuno; obbligatori se candidato esiste. |
| approvedData | ArtifactRef | Contenuto esatto congelato; mostrato individualmente soltanto per DirectHumanApproval. La policy lega lo stesso contenuto senza dichiarare una presentazione umana individuale. |
| approvedDataHash | Hash | Uguale artifact digest. |
| stateRevision | UInt | Revisione originaria di creazione del gate in AWAITING_HUMAN, immutabile. Per nuove presentazioni il CAS usa GatePresentation.workflowRevision secondo GAT-002; nessuna riscrittura dello snapshot originario. |
| resumeState | insieme STM-003 | GAT-001 restringe per tipo. |
| continuation | ANALYZE\|PREPARE\|IMPLEMENT\|REVIEW_FINAL\|REWORK\|RECONCILE | Non è codice arbitrario; concorde col target. |
| requestedAt | Time | Obbligatorio. |
| decidedAt? | Time | Richiesto se decisione disponibile. |
| humanDecisionRef? | ID | Attestazione canale umano fidato, non token in mano al modello. |
| authorizationKind? | DirectHumanApproval\|PolicyDerivedAuthorization | Richiesto v2; vietato v1. |
| policyAuthorizationRef? | ID ArtifactRef | Solo policy v2; alternativa esclusiva a humanDecisionRef. |
| consumedEventId? | ID | Richiesto CONSUMED. |
| invalidationReason? | Text | Richiesto INVALIDATED. |

Invalido: approvazione senza prova di origine, revisione/hash obsoleti, target non conforme, uso ripetuto, dati modificati. REJECTED non significa FAILED automatico: Orchestrator sceglie solo TR ammessa e motivata.

### DATA-010 — TransitionEvent

| Campo | Tipo | Semantica/validazione |
|---|---|---|
| schemaVersion | 1 | Obbligatorio. |
| id, taskId | ID ciascuno | Unicità. |
| kind | CREATE\|TRANSITION\|RECORD | Discriminante. |
| transitionId? | ID | Obbligatorio soltanto TRANSITION, uno dei TR. |
| recordType? | SPEC_SNAPSHOT\|SPAWN_INTENT\|RUN_BOUND\|RESULT_RECEIVED\|CANDIDATE_MATERIALIZED\|VALIDATION_RECORDED\|REVIEW_RECORDED\|GATE_DECIDED\|ESCALATION_OPENED\|DECISION_RECORDED\|EVIDENCE_INVALIDATED\|RECONCILED | Obbligatorio soltanto RECORD. |
| actor | Orchestrator | Costante; richiedente umano/child in evidenceRefs, non actor. |
| sourceState? | State | Assente CREATE; richiesto altrimenti. |
| targetState | State | PENDING per CREATE, uguale source per RECORD. |
| previousRevision? | UInt | Assente CREATE; richiesto altrimenti. |
| revision | UInt | 0 CREATE, previousRevision+1 altrimenti. |
| timestamp | Time | Non unica fonte d'ordine. |
| reason | Text | Motivazione esplicita. |
| evidenceRefs | List<ID>[0..256] | Rispetta guard del TR/record. |
| invalidatedEvidenceIds | List<ID>[0..1024] | Non rimuove storico. |
| stateAfter | ArtifactRef | Snapshot completo successivo immutabile, scritto/synced prima del WAL. |
| previousEventHash? | Hash | Assente CREATE; catena causale. |
| eventHash | Hash | Hash canonico escluso eventHash. |

Il WAL e gli snapshot storici referenziati bastano a ricostruire i dati senza field-patch non tipizzate. Artifact stateAfter contiene lastEventId ma non eventHash, evitando auto-riferimento. Eventi mancanti/incompleti/contraddittori non autorizzano replay o side effect.

## D. AUT-001 — Authority matrix (default DENY)

`ALLOW*` = ALLOW soltanto alle condizioni specificate; PROPOSE_ONLY non autorizza effetto né transizione. Human indica le operazioni **tramite il package**, non limita ciò che l'utente può fare esternamente al sistema.

| Operazione / ID | Orchestrator | Scout | Developer | Reviewer | Oracle | Human |
|---|---|---|---|---|---|---|
| read repository / OP-01 | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW |
| modify candidate / OP-02 | ALLOW* | DENY | ALLOW* | DENY | DENY | PROPOSE_ONLY |
| modify original workspace / OP-03 | DENY | DENY | DENY | DENY | DENY | DENY |
| spawn sub-agent / OP-04 | ALLOW* | DENY | DENY | DENY | DENY | PROPOSE_ONLY |
| change scope / OP-05 | ALLOW* | PROPOSE_ONLY | PROPOSE_ONLY | PROPOSE_ONLY | PROPOSE_ONLY | ALLOW* |
| run authoritative validation / OP-06 | ALLOW | DENY | DENY | DENY | DENY | PROPOSE_ONLY |
| issue review verdict / OP-07 | DENY | DENY | DENY | ALLOW | DENY | DENY |
| request rework / OP-08 | ALLOW | PROPOSE_ONLY | PROPOSE_ONLY | PROPOSE_ONLY | PROPOSE_ONLY | PROPOSE_ONLY |
| approve human gate / OP-09 | DENY | DENY | DENY | DENY | DENY | ALLOW* |
| transition workflow / OP-10 | ALLOW | DENY | DENY | DENY | DENY | PROPOSE_ONLY |
| mark completed / OP-11 | ALLOW* | DENY | DENY | DENY | DENY | DENY |
| merge / OP-12 | DENY | DENY | DENY | DENY | DENY | DENY |
| push / OP-13 | DENY | DENY | DENY | DENY | DENY | DENY |
| publish / OP-14 | DENY | DENY | DENY | DENY | DENY | DENY |

OP-02 Orchestrator: esclusivamente materializzazione deterministica della patch; nessuna correzione semantica. Developer: solo assignment IMPLEMENTING nel proprio checkout e in scope. OP-04: cap, capability, intent e leaf profile verificati. OP-05: Human autorizza dati nuovi; solo Orchestrator persiste nuova spec dopo gate e rianalisi. OP-09: umano autenticato nel canale fidato; Orchestrator registra la decisione senza possederne authority. OP-11: solo TR-022 e CMP-001.

## E. Scope contract

### SCP-001 — Path e baseline

- repoRoot: realpath assoluto dell'originale; identità congelata. WorkRoot/candidate root sono separati, owned, mai alias dell'originale.
- baseRef: HEAD o named ref supportata dal runtime; niente revision expression o SHA raw come input di allocazione. Conservare anche baseCommit risolto; ricontrollarlo prima e dopo allocazione. Movimento ref → BLOCKED.
- allowedPaths/deniedPaths: lista **di file esatti**, non glob/prefix/regex. Nessuna espansione implicita di directory. Per nuovi file l'entry deve essere già presente. Rename richiede source e destination entrambe allow; delete richiede path allow. Mode change è modifica.
- Default deny, deny precede allow. Path vuoto, assoluto, `.`/`..` come segmenti, doppio slash, backslash, NUL, drive/UNC o alias ambiguo sono invalidi, non vengono ripuliti silenziosamente. Confronti case-sensitive; filesystem che produce collisioni case/Unicode → BLOCKED.
- Symlink: lettura confinata alla root solo se target verificato; nessuna scrittura attraverso componenti symlink. Creazione/modifica di symlink nel minimo iniziale non autorizzata. Symlink preesistenti sono hashati come link/target, mai seguiti per digest. Target esterno necessario al task → BLOCKED. Nuovo path: verificare realpath del parent esistente più vicino e ogni componente prima della creazione; TOCTOU va collaudato, non risolto da un controllo iniziale soltanto.
- Baseline dirty/index staged/untracked non attribuibili → niente writer, nessun auto-stash/commit. File ignored preesistenti non diventano invisibili alla policy: provisioning esplicito, altrimenti blocco se interferiscono con candidato/verifica.
- Untracked creati dal Developer sono modifiche: devono essere allow, catturati nella patch/manifest e presenti nel digest; niente `git diff` da solo come inventario completo.
- `.git`, ledger/artifact store, credenziali e root esterne sono deny fissi; non approvabili come scope child. Dipendenze/log/build output stanno in root separate dichiarate e non contengono sorgenti esclusi dall'hash.
- Submodule, file speciali, nomi non UTF-8, hardlink/alias non verificabili o patch non rappresentabile → BLOCKED, nessuna perdita silenziosa di contenuto. Il package minimo non inventa supporto.

### SCP-002 — Candidate digest e handoff

Manifest conforme a CandidateManifest/AUX-001, ordinato per path UTF-8, con CandidateEntry versionati e chiusi; `mode` Git `100644|100755|120000`. Per FILE contentHash=SHA-256 byte interi anche binari; SYMLINK hash dei byte target senza follow. Include **tutti** i file del candidato, tracked e nuovi, indipendentemente da gitignore, esclusa sola metadata Git; log/deps provisionati sono fuori root. Directory vuote non semanticamente rappresentate. Mancanza di un byte/file richiesto rende il digest ignoto.

`candidateDigest = SHA256(canonical({schemaVersion:1, baseCommit, entries:manifest}))`. Associare sempre anche generation monotona: il ritorno a un vecchio digest non resuscita evidenze di una vecchia generazione. SpecHash è binding separato.

Prima di TESTING: writer terminale provato; handoff/patch/manifest copiati e verificati; patch applicata identica dal baseCommit al candidato dedicato; confronto completo del contenuto ricostruito. Dati mancanti, binari persi o processo ignoto → BLOCKED. Nessuna assunzione che il worktree child sopravviva al cleanup.

Per un rework, l'assignment Developer parte dalla ref locale del candidato precedente approvato; il baseCommit dell'assignment identifica quella base intermedia. Candidate.baseCommit e WorkflowState.baselineCommit identificano invece la baseline originale del task e restano immutabili. L'Orchestrator materializza la patch incrementale e conserva la catena handoff come artifact aggregato, producendo la patch cumulativa baseline originale→candidato corrente senza cambi semantici. Il digest manifest usa sempre la baseline originale; scope e review considerano l'intero diff cumulativo. Preparazione ref/round-trip restano UV-004; nessun commit nell'originale.

Controllare digest/generation/spec prima e dopo test, review e decisione umana, e prima di TR-022. Mutazione inattesa → invalidazione E/Q e blocco; nessun aggiornamento silenzioso dei digest sui vecchi report. Nuovo rework produce nuova generation e nuovo pacchetto test/review.

## F. VAL-001 — Validation contract

| Stato risultato | Condizione esatta |
|---|---|
| PASSED | Comando autorizzato realmente eseguito dall'host, processo terminato con prova, exitCode=0, log durevole, spec/command/digest/generation corretti, digest post identico. |
| FAILED | Esecuzione attribuita e terminale, exit non-zero senza timeout, artifact/provenienza disponibili. Un check che fallisce deve rendere exit non-zero: il minimo non interpreta output testuale per correggere exit zero. |
| NOT_RUN | Nessun processo di validazione iniziato; prerequisito/decisione mancante registrata. Mai exitCode=0 sintetico. |
| TIMED_OUT | Deadline del comando superata; interrompere, raccogliere log e prova terminale. Se termine non provato, workflow BLOCKED anche se etichetta timeout già registrata. |
| INVALID | Hash/command/provenienza errati, artifact non attendibile, digest cambiato, risultato contraddittorio o irreperibile. Prevale su una pretesa PASSED/FAILED. |

Priorità: provenienza/integrità sconosciuta → INVALID; altrimenti timeout → TIMED_OUT; non avviato → NOT_RUN; exit≠0 → FAILED; tutte le condizioni positive → PASSED. Segnale/abort senza exit noto e senza prova sufficiente → INVALID. L'assenza di ValidationResult equivale a obbligo insoddisfatto, non a PASSED.

Ogni required=true deve avere esattamente un risultato corrente autorevole identificato dall'ultimo evento VALIDATION_RECORDED per commandId/specHash/digest/generation; vecchi fallimenti restano storico. Non si sceglie un vecchio successo ignorando un rerun fallito. Comandi opzionali non possono coprire un criterion obbligatorio al posto di uno required. Zero required vietato. Nessun memoization cross-generation del package. Test che modificano codice invalidano il candidato; output generati devono andare nelle directory separate approvate.

## G. REV-001 — Review contract

Review parte solo dopo V; packet include spec completa, diff reale, manifest/digest/generation, tutte le ValidationResult richieste, handoff e rischi. Reviewer fresh separato da Developer, tools read-only verificati, nessuna shell generica.

- **PASS**: ogni criterion ha Assessment PASS supportato; scope, test e actual changes PASS; candidate binding identico; nessun finding/risk blocking; residual risks non bloccanti esplicitamente elencati. L'Orchestrator deve registrarne disposition prima di completare.
- **FAIL**: difetto concreto dimostrato nel candidato/test/scope o criterion non soddisfatto. Produce finding riproducibile/citato; Orchestrator valuta W oppure blocco, non correzione Reviewer.
- **BLOCKED**: informazioni mancanti/ambigue, criterio non verificabile o impossibilità di inspection. Nessuna promozione a PASS da parte dell'Orchestrator.

Un result schema-invalido non è un FAIL semantico utilizzabile: è errore protocollo e blocca. Un PASS che omette un criterio è invalido. Il Reviewer non può modificare dati/test per ottenere PASS. Un finding blocking non si può ignorare con una decisione testuale; serve nuovo risultato coerente oppure rianalisi autorizzata, mai override dell'invariante.

### REV-001A — Disposition dei rischi (DecisionRecord schemaVersion:1)

`RESOLVE_RISK` ha `subjectId` riferito a un `Risk`: preserva il rischio e il result storico, ma attesta che la sua condizione è soddisfatta da evidenza autorevole corrente. Non significa cancellazione, accettazione o deferral. `DEFER_RISK` conserva invece un rischio realmente residuale non bloccante, esplicitamente accettato/deferito con motivazione; tradeoff di scope/prodotto richiedono il gate pertinente, mai override dei criteri.

Entrambi usano esclusivamente i campi chiusi esistenti: `subjectId`, `reason` non vuota, `evidenceRefs`. Questi ultimi devono includere esattamente uno snapshot WorkflowState con specHash, candidateDigest e candidateGeneration uguali al candidato corrente, il result Developer/Reviewer corrente che contiene il Risk identico e le evidenze della motivazione. Nessun binding viene ricavato dal testo libero. ID duplicati incompatibili sono invalidi. Il record resta schemaVersion:1: estensione esplicita dell'enum, non cambiamento della forma; lettori precedenti rifiutano il nuovo kind senza coercion.

Solo l'Orchestrator host-side registra la decisione mediante DATA-010 RECORD/DECISION_RECORDED; Reviewer fornisce evidenza, Developer non decide, Oracle resta advisory. APPROVE umano non è una disposition automatica. Nel minimo, RESOLVE_RISK automatico è ammesso soltanto per il Risk non bloccante `host-validation-pending`, con criterionIds non vuoti: ogni criterion deve avere comandi required e tutti devono avere ValidationResult host PASSED correnti, con identici specHash/digest/generation, commandHash approvato, log/proof presenti e riferimenti non invalidati. La decisione deve citare tali ValidationResult; altre condizioni richiedono una regola normativa esplicita, non inferenza da testo.

Per ogni rischio dei result Developer/Reviewer correnti serve esattamente una disposition valida per lo snapshot corrente. RESOLVE_RISK + DEFER_RISK, o due disposition incompatibili per lo stesso rischio/snapshot, sono contraddittorie e bloccano. Cambio specHash, digest, generation o validità dell'evidenza rende stale la disposition; lo storico rimane e non autorizza il nuovo candidato. Disposition assente/stale/contraddittoria rende CMP-14 false anche con blocking=false. Nessuna disposizione qui permette un rischio blocking. La disposition va persistita prima di congelare review/test/risk disposition nel gate beforeCompletion; nessuna riapertura di gate storici.

## H. RET-001 — Retry ed escalation

- **attempt**: ogni assignment child effettivamente ammesso dall'Orchestrator ha attemptId nuovo. `attempts` e `dispatches` aumentano durable prima del dispatch; tentativo di esito ignoto rimane consumato.
- **rework attempt**: secondo e successivi assignment Developer per correggere risultato precedente; incrementa reworkAttempts prima del lancio. Default massimo 2 oltre al primo. Un retry INFRA senza lavoro partito non è rework, ma è nuovo attempt e dispatch.
- **infrastructure retry**: al massimo 1 per task (policy può restringere a 0), stesso protocollo/runner/modello/assignment semantico; richiede failure transitoria dimostrata, nessun writer ancora vivo, diff conservato o tree pulito. Esito ignoto non è transitorio dimostrato. `RETRY_INFRASTRUCTURE` viene persistito come decisione del motore, ma non è authority di dispatch: per un Reviewer terminale senza verdict serve anche `beforeReviewerRedispatch`. Nessun loop automatico di tool/protocol errors.
- **failure fingerprint**: SHA-256 canonico di `{phase, category, code, subjectIds ordinati}`. Timestamp, log volatile e attemptId esclusi; riferimenti di test/criterion/path stabili inclusi. Conteggio per fingerprint derivato dal ledger, mai reset su session/spec. Due occorrenze equivalenti attivano escalation prima di ulteriore tentativo.
- **escalation episode**: ID, trigger e domanda concreta; aperto per ambiguità prima di scrivere, due failure equivalenti o conflitto di evidenze. Massimo 4 per task e sempre entro dispatch cap. Episodio chiuso solo con DecisionRecord; stesso blocco senza nuove evidenze non può aprire episodio identico per aggirare limiti.
- **Oracle invocation**: massimo un dispatch per episodio; nuova sessione advisory, fork solo se capability verificata, altrimenti fresh packet esplicitamente selezionato prima del launch. Nessun retry Oracle nello stesso episodio; failure → BLOCKED/umano. Mai routine reviewer o writer.
- **retry exhaustion**: nessun contatore può oltrepassare il cap. Se c'è decisione concreta risolutiva e gate onRetryExhausted, andare AWAITING_HUMAN tramite TR ammesso; l'approvazione non aumenta budget. Può autorizzare riconciliazione senza nuovo writer, rifiuto o definizione di un diverso futuro task, non riaprire quello terminale. Senza azione legale residua → FAILED dopo quiescenza.

Tetti sono frozen nel TaskSpec. Anche Scout/Reviewer/reanalysis consumano dispatch cap; cicli ANALYZING/REWORK non creano tentativi gratis. Rientro in analisi richiede nuove evidenze o domanda risolta, non identico payload ripetuto. Attesa umana non è retry attivo e non lancia child. Nessun loop autonomo senza consumo bounded o nuova decisione umana.

## I. GAT-001 — Human gates

Tutti richiesti/persistiti dall'Orchestrator; ogni ruolo/Human può proporre la necessità, non costruire un gate approvato. Nel ramo DirectHumanApproval approva/rifiuta/risponde solo Human con conferma esplicita nella TUI di Pi, verificata dall'host; modello e child sempre esclusi. Il trasporto della conferma non può essere un booleano o un token fornito dal modello. Il pannello `ctx.ui.custom` è il percorso corrente; `ctx.ui.confirm` resta accettato per i canali storici o gli host senza pannello custom. Entrambi richiedono la stessa sessione attiva, il contenuto approvato ancora corrente e una scelta positiva esplicita; No, Esc, scadenza ed errore non producono una decisione. Il ramo PolicyDerivedAuthorization v2 è distinto: PA-001 consente all’host di verificare e consumare l’autorità del piano e della policy già approvati, senza attribuire alla persona una nuova scelta individuale. Restano tutti i guard del gate.

| Tipo | Trigger e dati approvati | resumeState / continuation |
|---|---|---|
| beforeImplementation | Primo writer e ogni nuovo writer se spec/candidato approvati cambiati; specHash, scope, base, comandi, rischi; include approvazione dell'estrazione modello se necessaria. | PENDING/ANALYZING se input ancora da analizzare; READY per TR-009; IMPLEMENTING solo da punto sospeso quiescente che soddisfa I. |
| onScopeChange | Qualsiasi cambiamento richiesto a allow/deny/requisiti che espanda authority; old specHash + proposedSpecHash, diff e motivazione. Sempre abilitato. | ANALYZING; nuova spec solo dopo approvazione, mai implementazione diretta. |
| onOracleDecision | Consiglio Oracle con tradeoff materiale/non risolto; resultRef, opzione scelta, conseguenze su spec/candidato. | ANALYZING se spec/criteri cambiano; REWORK per fix già in scope; BLOCKED se serve riconciliazione. |
| beforeCompletion | PASS indipendente e verifiche già valide; candidate digest/generation, specHash, review/test/risk disposition e patch durevole. | REVIEWING / REVIEW_FINAL; poi rivalutare CMP-001. |
| onRetryExhausted | Contatori/cap, fallimenti, unica decisione sbloccante identificata e suo effetto legale senza aumento cap. | ANALYZING/REWORK/BLOCKED solo se esiste azione finita autorizzabile; altrimenti nessun gate fittizio, FAILED. |
| beforeReviewerRedispatch | Reviewer precedente con identità durevole completa e termine provato, nessun verdict, failure INFRA e `RETRY_INFRASTRUCTURE` già ammesso; spec/candidato/validation/runtime evidence correnti e invariati, nessun run UNKNOWN, budget e lock validi. | BLOCKED→TR-034→AWAITING_HUMAN; APPROVE usa TR-040→REVIEWING. Il dialogo non dispatcha: il normale admission crea poi un Reviewer fresh. |

Mappa continuation esatta: PENDING e READY→PREPARE; ANALYZING→ANALYZE; IMPLEMENTING→IMPLEMENT; REVIEWING→REVIEW_FINAL; REWORK→REWORK; BLOCKED→RECONCILE. Il tipo beforeImplementation è anche il gate di autorizzazione iniziale dei dati estratti: se tale estrazione esiste, è obbligatorio per quei dati anche se la policy disattiva la conferma routinaria prima del writer. Scope change approva proposedSpecHash come nuovo contenuto, senza convalidare gli hash di evidenze passate.

Il guard H deve essere soddisfatto prima di entrare AWAITING_HUMAN. Nel minimo si sospendono i child: non si tengono writer in attesa di approvazioni. Questions strutturate terminano in blocco/report; l'Orchestrator prepara il prossimo assignment dopo decisione. Contatto supervisor non scavalca questi contratti.

`stateRevision` del gate identifica la vista originaria dopo ingresso in AWAITING_HUMAN. Il canale storico v1 mantiene il CAS su quella revisione. Il nuovo canale v2 usa il CAS sulla revisione della GatePresentation corrente secondo GAT-002. Cambiamenti materiali richiedono invalidazione/nuovo gate e nuova conferma; soltanto il rebinding host espressamente autorizzato da GAT-002 conserva lo stesso gate. Persistenza della decisione e consumo cambiano revision legittimamente senza invalidare retroattivamente la decisione immutata. Catena degli eventi e presentation corrente dimostrano il consumo unico.

Mutazione spec/candidate, diversa generation, validation/runtime evidence stale, gate superseded o vecchia sessione non riconciliata invalidano l'approvazione per nuovi effetti. Una decisione beforeImplementation consumata documenta storicamente l'autorizzazione del relativo assignment sulla base d'ingresso: non è approvazione del risultato futuro. Analogamente, onScopeChange documenta il passaggio old→new approvato. `beforeReviewerRedispatch` autorizza soltanto un nuovo Reviewer e non Developer, rework, validation, scope change o completion; conserva le evidence precedenti e consuma unicamente un nuovo attempt/dispatch Reviewer con assignmentId, attemptId, requestId, runId, childSessionId e sessione fresh. Queste prove di authority passata restano consultabili, ma non possono essere riutilizzate per un nuovo writer o per approvare un candidato diverso. beforeCompletion resta separato e deve sempre legare il candidato finale corrente. Rifiuto definitivo → F; risposta incompleta/ambigua → BLOCKED, non scelta automatica. Headless/RPC senza canale umano verificato resta AWAITING_HUMAN. Policy che disattiva un gate opzionale non approva scope change né risolve ambiguità materiale.

Per `beforeReviewerRedispatch` tutte le precondizioni sono congiunte e vanno ricontrollate prima della creazione, al consumo della decisione e prima del nuovo dispatch: lease di recovery se presente, lock task/workspace, binding dello stesso assignment Reviewer a spec/digest/generation, prova terminale e byte immutabili di spec, validation PASS, log e process proof, runtime evidence e confronto. Basta una precondizione falsa per negare gate o redispatch. FAIL/BLOCKED/PASS del Reviewer, schema failure, scope violation, mutation e UNKNOWN non sono guasti infrastrutturali autorizzabili da questo gate. Cancel/No non producono decisione; ANSWER non approva; REJECT segue il rifiuto definitivo già previsto da TR-043.

### GAT-002 — Gate immutabile e presentazione dopo takeover verificato (P16B.1)

**HumanGate identity != GatePresentation.** Il gate definisce la decisione materiale; una presentation identifica la singola istanza di presentazione da parte dell'host. Il cambio di sessione da solo NON crea authority. Restano immutabili id/task/type, specHash/proposedSpecHash, candidateDigest/generation, approvedData/ref/hash/byte, resumeState/continuation, requestedAt e stateRevision originari. Nessun gate nuovo per il solo cambio di sessione. Qualunque cambiamento materiale invalida il gate e richiede un nuovo gate; non è un rebinding.

**GatePresentation v1**, documento chiuso host-owned conservato come ArtifactRef con mediaType `application/vnd.pi-controlled-dev.gate-presentation+json`, massimo 64 KiB. Campi obbligatori: `schemaVersion:1`, `id:ID`, `gateId:ID`, `taskId:ID`, `presentationGeneration:UInt positivo`, `workflowRevision:UInt`, `displayedDataHash:Hash`, `hostProcessIncarnation:ProcessIncarnation`, `hostSessionId:Text`, `presentedAt:Time`. Campi opzionali: `recoveryAuthorityRef:ArtifactRef`, `previousPresentationRef:ArtifactRef`. ArtifactRef impegna bytes/digest/path confinato al control plane; i documenti riferiti sono verificati, non basta un ID o il JSON copiato. Il record autorizza una richiesta di visualizzazione, NON attesta che l'umano l'abbia vista o decisa. Tale fatto richiede una successiva scelta positiva nel canale TUI host.

**ProcessIncarnation v1** è evidence host sul lifetime del processo, non identità utente: `schemaVersion:1`, `platform:linux`, `bootId:Text`, `pidNamespace:Text`, `pid:UInt positivo`, `startTicks:Text decimale`. È la proiezione versionata della prova P16A, non una nuova autenticazione. Ambiente non verificabile → nessun rebinding autorizzato. PID, età, sessione diversa, /reload, booleani del caller non provano morte. Una serializzazione equivalente non autentica il processo.

**Ordering e CAS.** Nel percorso normale il gate e la prima presentation (generation=1, nessun previous/recovery ref) sono persistiti nello stesso commit di ingresso in AWAITING_HUMAN; workflowRevision coincide con gate.stateRevision. Soltanto dopo sync può essere acquisita la scelta tramite `ctx.ui.custom` o `ctx.ui.confirm`. Ogni presentation successiva è un RECORD/RECONCILED in AWAITING_HUMAN: incrementa revision esattamente di uno secondo DATA-010, senza state transition né mutazioni materiali. workflowRevision è la revisione dello stateAfter di quel RECORD. Non si forza la revision per farla coincidere con la sessione; HumanGate.stateRevision resta immutabile. La nuova presentation deve riferire la precedente e avere generation precedente+1, senza salti/fork/duplicati. Il CAS richiede revision corrente esattamente uguale a workflowRevision. Una diagnostica o qualsiasi evento intermedio rende stale una richiesta già mostrata; non autorizza a riutilizzarne receipt o riscriverne revision.

**Prerequisiti indipendenti del rebinding.** Prima del RECORD, l'host deve aver verificato: store coerente, classification P16A compatibile, vecchio processo provabilmente morto, quiescenza di tutti i child/run, reclaim P16A dove necessario, takeover esclusivo e fresco pair TaskLock/WorkspaceLock. Il gate deve essere ancora PENDING e non deve esistere alcuna HumanDecisionEvidence accettata per esso. Il record recoveryAuthorityRef identifica una prova durevole di takeover contenente almeno task, precedente/nuova incarnation e sessione, classification, refs di death/quiescence/reclaim, reason, revision/eventHash di partenza e token dei nuovi lock. L'authority operativa è un handle corrente host-only sotto esclusione, MAI il semplice record copiato. Recovery proof → takeover authority → presentation; la presenza di una presentation NON dimostra retroattivamente il takeover. Due processi concorrenti non possono creare due generation N+1: il solo winner con authority e lock correnti può effettuare il CAS.

**Binding della decisione senza estendere HumanDecisionEvidence v1.** trustedChannelEvidenceRef punta per i nuovi gate a un documento canale esplicitamente **schemaVersion:2** con i campi v1 conservati e l'aggiunta obbligatoria `presentationRef:ArtifactRef`. Il documento v2 è chiuso; presentationRef impegna la presentation completa. `source` distingue `ctx.ui.custom` da `ctx.ui.confirm` ed entrambi sono verificati come canali TUI host; il verifier non accetta sorgenti arbitrarie. channelId/confirmationId mantengono la semantica esistente. HumanDecisionEvidence.displayedRevision coincide con presentation.workflowRevision, displayedDataHash con approvedDataHash immutato. Il verifier richiede: exact presentation id/generation, gate/task, hostSessionId uguale alla sessione effettiva della conferma TUI, workflowRevision, displayedDataHash e confirmationId; la stessa presentation deve essere ancora current al momento della decisione. La decisione è il primo GATE_DECIDED successivo a workflowRevision. Le vecchie receipt sono single-use e non tornano valide dopo una nuova generation: rifiuto HUMAN_DECISION_STALE/REPLAY o reasonCode equivalente. La conferma deve appartenere alla **GatePresentation corrente dimostrata**, non necessariamente alla sessione originaria del gate e mai a una sessione arbitraria solo perché corrente.

**Compatibilità esplicita.** Canali v1 e gate storici senza GatePresentation restano verificabili secondo le regole originali same-session; non vengono reinterpretati come v2 né migrati implicitamente. Un gate storico realmente PENDING, senza decisioni, può ricevere una prima presentation esplicita soltanto mediante takeover verificato: generation=1, recoveryAuthorityRef obbligatorio, previousPresentationRef assente, RECORD/RECONCILED collegato al gate originario. Questo è un evento di adozione esplicito, non una riscrittura della storia né una generation originaria inventata. Una presentation successiva a questa usa normalmente generation+1. Un campo presentationRef in un canale v1 o la sua assenza in v2 sono errori, non fallback.

**Gate già decisi.** CONSUMED, INVALIDATED, REJECTED e ogni gate con decisione durevole (APPROVE/REJECT/ANSWER) non possono essere ripresentati. Decisione persistita/non consumata segue P16B solo se guard e commit sono ricostruibili da prove durevoli; altrimenti P16C. Nessuna nuova decisione e nessun consume implicito. Commit/WAL incompleti e INTENT non risolti restano P16C, senza repair in questa amendment.

**Terminal verifier.** Verifica l'intera catena da gate originario e presentation iniziale (oppure adozione legacy esplicita), morte dell'owner, classification/quiescence, reclaim applicabile, takeover, conferma TUI host, HumanDecisionEvidence e consume. Ricostruisce da ledger/artifact la successione monotona, l'unica presentation current al momento della decisione, la revision chain decision/consume e il non-riuso delle receipt. Il confronto diretto con l'owner dello snapshot originario resta solo per canali v1; v2 richiede la catena GAT-002, non un controllo sessione rimosso. I takeover successivi non invalidano l'autorità storica di una decisione già consumata sui dati allora autorizzati, né la rendono riutilizzabile per nuovi effetti.

**UI e authority.** La nuova TUI mostra di nuovo gli stessi dati/material meaning P14H. Può aggiungere, fuori dai dati autorizzati, «Questo task è stato interrotto e ripreso dopo un riavvio. La decisione precedente non era stata registrata». Il testo materialmente autorizzato resta hash-bound; la nota non è una nuova approvazione. JSON/headless/RPC resta HUMAN_ACTION_REQUIRED: takeover non conferma un gate. GatePresentation, generation, recovery refs e rebinding sono creati esclusivamente dall'host; modello/child/prose/record copiati non conferiscono authority. Nessuna identità utente forte aggiunta, nessuna modifica a 11 stati, 43 TR, AUT-001, retry, scope o significati dei gate.

## J. CMP-001 — Completion predicate

`canComplete(state, evidence)` è true **se e soltanto se** tutte le seguenti proposizioni sono vere simultaneamente:

1. stato corrente REVIEWING; versione/revisione/ledger validi, lock task/workspace posseduti, TR-022 selezionata dall'Orchestrator;
2. TaskSpec corrente validata, fonti snapshot/hash coincidenti, nessuna ambiguità aperta e nessun requisito/criterion senza metodo di verifica;
3. capability necessarie verificate per ambiente/versioni/contratti effettivi correnti;
4. baseline Git pulita attribuita, baseCommit esatto, candidato separato dall'originale;
5. DeveloperResult strutturato valido e correlato all'ultimo assignment Developer autorizzato, blockedReason assente;
6. nessun child/intent/processo writer attivo o ignoto; prova terminale e assenza di mutazioni concorrenti;
7. handoff, patch e manifest completi durevoli; round-trip del candidato verificato, inclusi nuovi file/binari;
8. scope check host PASS sull'intero diff e sul filesystem; nessuna modifica a path denied/fuori allow/originale;
9. digest/generation correnti ricalcolati uguali al candidato verificato; nessuna evidenza in quarantena necessaria al completamento;
10. almeno un comando required e, per **ogni** comando required, ValidationResult autorevole corrente PASSED con identici specHash/candidateDigest/generation/commandHash, log e proof durevoli;
11. ReviewResult corrente schema-valid PASS; reviewer role/session/run indipendenti dal Developer, context fresh e read-only provati;
12. review lega stesso specHash/digest/generation e i risultati test correnti; scope/test/actualChanges PASS;
13. esattamente un CriterionAssessment PASS con evidenza per ogni criterion, nessun requisito senza copertura;
14. nessun finding/risk blocking o escalation/decisione materiale aperta; ogni rischio rilevante dei result correnti ha esattamente una disposition RESOLVE_RISK o DEFER_RISK valida e corrente secondo REV-001A, con semantiche distinte, motivazione e riferimenti;
15. ogni effetto già eseguito ha il gate autentico consumato per i dati autorizzati in quel momento; tutti i gate ancora applicabili al candidato/spec finali (incluso beforeCompletion se richiesto) sono autentici, consumati una volta e correnti. Nessun gate necessario pendente/invalidato/rifiutato; authority storica non viene riutilizzata come approvazione del risultato corrente;
16. contatori monotoni entro limiti; nessuna violazione retry/policy irrisolta e nessun fallback non approvato;
17. tutte le evidenze citate sono disponibili, integre, attribuite e conservate fuori da retention temporanea; nessun segreto/transcript integrale nel ledger;
18. il pacchetto di completamento identifica precisamente spec, base, patch, candidato, validation IDs, review ID, gate IDs e decision IDs; tutti corrispondono allo snapshot che TR-022 committerà.

Ogni unknown è false, nessuna logica a voto/maggioranza. Human approval e Reviewer PASS non possono sovrascrivere un false. I controlli e il commit sono serializzati: modifica osservata prima del commit rifiuta TR-022. Un report terminale non viene esposto come valido se successivamente gli artifact sono mancanti/corrotti; il task terminale resta immutabile, l'attestazione è indisponibile.

### CMP-002 — AuthorizationPackage e TerminalCompletionPackage (P14G.3A)

Due domini di hash distinti, senza dipendenze circolari:

- **AuthorizationPackage v1** è il documento immutabile congelato prima di beforeCompletion. Include taskId, specHash/specRef, baselineCommit, candidateDigest/generation, manifest/patch/handoff, risultati Developer, validation IDs/refs/log/proof, review ID/ref/proof, rischi e disposition, decisioni materiali già prese e tutti i fatti materiali review/test/risk/patch. I riferimenti sono content-addressed e ne impegnano i byte. Non include la decisione, receipt o consumo del beforeCompletion corrente né un riferimento al futuro pacchetto terminale.
- `authorizationPackageHash = SHA256(canonicalJSON(AuthorizationPackage))`. Il documento non contiene il proprio hash. approvedData contiene ref e hash di AuthorizationPackage; HumanGate.approvedDataHash e HumanDecisionEvidence.displayedDataHash vincolano transitivamente questo esatto ref/hash attraverso i byte canonici di approvedData. È questo contenuto, non un pacchetto futuro, che Human autorizza.
- **TerminalCompletionPackage v2** è un nuovo envelope esplicitamente versionato. Include AuthorizationPackage ref/hash, beforeCompletion gateRef, HumanDecisionEvidence ref, consumed event ref, tutti i decision refs e completion evidence refs, il pacchetto di evidenze finali e il binding task/spec/candidate/generation/targetState COMPLETED. Viene costruito solo dopo decisione, consumo e ritorno REVIEWING. `terminalCompletionPackageHash = SHA256(canonicalJSON(TerminalCompletionPackage))`; anche questo documento non contiene il proprio hash. L'attestazione durevole contiene tale hash e viene poi citata dall'evento TR-022, evitando anche la circolarità dell'evento terminale nel proprio input.

Il vecchio CompletionPackage v1 resta un bundle di evidenze, non un TerminalCompletionPackage v2. Nessuna migrazione implicita o reinterpretazione delle vecchie attestazioni: le evidenze live storiche restano inalterate, non certificano il nuovo contratto.

CMP-15 richiede esattamente una autorizzazione finale corrente, autentica e consumata, e la storia di tutti i gate applicabili. Non richiede uguaglianza tra authorizationPackageHash e terminalCompletionPackageHash. Il verifier ricalcola entrambi, controlla il binding transitivo della conferma e confronta integralmente la proiezione materiale del bundle finale con AuthorizationPackage. Spec, candidato/generation, manifest/patch, validation set, review, rischi/disposition e decisioni materiali non possono cambiare dopo l'approvazione: ogni cambiamento impone nuovo documento e nuovo gate. Sono aggiungibili solo fatti di autorizzazione/terminalizzazione (conferma, consumo, evento/ragione terminale, attestazione), non nuovi fatti materiali.

La storia distingue mai applicabile, soddisfatto/consumato, decisione negativa o ANSWER con continuation legale, invalidato/superseded, pendente e incompleto. Non richiede che ogni gate storico sia ancora corrente o CONSUMED. Ogni writer che richiedeva conferma lega spec/base/scope/authority esatti; ogni installazione espansiva della spec lega old→new; ogni decisione Oracle lega il proprio episodio; ogni continuation da esaurimento lega episodio/fingerprint/cap. REJECT e ANSWER non sono autorizzazioni positive. Decisioni duplicate/contraddittorie, riuso receipt, binding errati e consumi impossibili falliscono chiuso. La verifica usa solo artifact/event/store; load è read-only e non completa decisioni/consumi/resume mancanti. Consumo e resume possono essere un singolo commit atomico: non si inventa uno stato intermedio né una nuova transizione.

Evidenza della circolarità precedente (probe P14G.3): hash approvato `7564167085295286560f569f36b9711f3d098e819f063b59fc8f9bd71bbe6315`, hash terminale `826ff66f4cc0ec4c8b563f06955be2d74e4103df1747178a0fcc83f48e3fe6bc`; gateIds rispettivamente vuoto e contenente il beforeCompletion consumato. L'ineguaglianza è lecita; il legame esplicito e l'identità del contenuto materiale sono obbligatori. Stati, transizioni, authority, retry, scope e RESOLVE_RISK restano invariati.

## PST-001 — Persistenza, side effect e recovery

Riutilizzare P0: store locale task, state.json, events.jsonl, spec snapshot, artifacts, lock task e workspace. Nessun database/server. File sensibili privati, nessun transcript completo; log selettivi redatti senza rimuovere fatti necessari. Se un log contiene segreti non sanitizzabili in modo affidabile, bloccare esportazione e accettazione dell'artifact.

Ordine di commit: scrivere/sync artifact stateAfter immutabile → append evento completo e sync → scrivere snapshot temporaneo/sync → rename state.json (e sync directory ove supportata e verificata). Nessun effetto esterno prima dell'intent committed. Crash prima del WAL: artifact orfano non autoritativo. Crash dopo WAL prima snapshot: replay deterministico senza rilancio. Coda evento troncata: non applicare, preservare per audit. Contraddizione nel prefisso completo: BLOCKED/quarantena.

Dispatch: intent contiene assignment/attempt/request e incremento contatori; risposta collega runId/session solo se univoca. Crash o timeout dopo intent e prima binding è **UNKNOWN**, non prova di mancato lancio; status/receipt dell'esatta sessione devono riconciliare o bloccare. Duplicate completion identiche sono idempotenti; duplicate contraddittorie, eventi fuori ordine non riconciliabili o run non appartenente al task bloccano e non completano.

Lock con creazione esclusiva e owner metadata; PID da solo/file age non dimostrano morte. Owner ignoto mantiene lock. Session replacement/reload: ricostruire dal ledger, risottoscrivere eventi e riconciliare status; nessuna deduzione dal fatto che non arrivino notifiche. Session ownership differente senza percorso verificato → BLOCKED e intervento umano.

### PST-002 — P16C.1: repair esplicita del prefisso WAL esistente

Dopo un crash, byte completi sul filesystem non provano che il precedente fsync fosse riuscito. La repair host esplicita può rendere durevole **ora** il prefisso esistente: non attesta il vecchio sync. Startup/status classificano soltanto CLEAN, REPAIRABLE, AMBIGUOUS o CORRUPT; nessuna mutazione o ripresa automatica.

Sotto esclusione di repair e dei normali mutatori, verificare nuovamente encoding, record completi, hash chain, revisioni continue, transizioni, tutti gli artifact e relativi metadata, assenza di contraddizioni e snapshot esattamente corrispondente a un precedente stato della stessa storia. Quindi: fsync WAL esistente → ricostruzione deterministica snapshot → fsync nuovo snapshot → atomic replace → fsync directory → record durevole separato di repair. Il record contiene previous snapshot revision, valid WAL revision, previous fsync status=UNKNOWN, repair fsync performed=true, rebuilt snapshot revision ed evidence usate. Nessun nuovo evento/revisione workflow, modifica dello storico o reset di contatori.

Snapshot ahead è STORE_INCONSISTENT. Hash mismatch, revision gap, evento invalido, artifact mancante o evidenza contraddittoria vietano la ricostruzione. Una coda finale incompleta non è un evento committed: può essere esclusa soltanto dopo verifica dell'intero prefisso e conservazione dei byte originali per audit.

Il nuovo fsync non prova esiti esterni: dispatch, filesystem mutation, validation, review, HumanDecision e provider action senza sufficiente evidenza durevole rendono repair/resume denied, RECOVERY_AMBIGUOUS. Mai ripetere child, validation, review, conferma umana o mutazione esterna. INTENT sicuramente non eseguito e INTENT sicuramente già completato sono riconciliabili soltanto con prova durevole dell'esatto effetto; l'INTENT ambiguo resta bloccato. Assenza di binding/risultati, artifact orfani e testo libero non sono prova di mancata esecuzione.

Journal e guard di repair sono metadata host privati, non authority fornibile dal modello. Un'interruzione della repair richiede nuova verifica di owner death, token e immagini sorgente/destinazione; guard legacy privi di prova sufficiente restano ambigui. Una repair non acquisisce implicitamente authority di resume: restano obbligatori takeover e nuovi lock normali P16A/P16B. Restano invariati 11 stati, 43 transizioni, ruoli, scope, retry e gate.

## CAP-001 — Capability e limiti dell'integrazione

REG-001 è il boundary pubblico process-local di registration; RPC v1 event-bus resta l'unico execution boundary scelto P0, async-only per spawn. Nessun import di internals né uso di `manage` per operazioni agent non ammesse. Handshake verifica metodi/eventi/contratti effettivi; niente parsing di output slash. Structured output è richiesto e validato nuovamente; `ok:true` senza di esso è inutilizzabile. Processo terminato, child result e workflow accettato sono tre fatti distinti.

Nessuna dependency/peer dependency runtime pi-subagents, neppure opzionale; nessun import root/subpath, lookup node_modules/globale/home, NODE_PATH, symlink di risoluzione, vendoring/copia locale o auto-install/upgrade. Pi-controlled-dev resta installabile/caricabile senza il servizio; l'utente sceglie separatamente come renderlo presente nel processo Pi. Servizio assente → capability unavailable, nessun child. Nessun requisito di directory o metodo d'installazione.

Minimum capability: registration contract v1, RPC v1, async spawn, completion correlata e structured output richiesto. Verificare risposta reale e comportamento necessario, non solo advertisement/versione. Baseline sperimentale 0.72.1; release precedenti utilizzabili se espongono e superano gli stessi requisiti, prima release storica non determinata. Versione/configurazione/ambiente cambiati invalidano l'attestazione pertinente e richiedono nuova verifica, non upgrade automatico. REG-001/CLA-001 ed EVD-001 distinguono Operational Binding pre/post-dispatch e controlli authority post-launch: nessuna API preflight importata è presupposta. Prova necessaria mancante → BLOCKED.

### Registro completo UNVERIFIED ereditato da P0

Le righe sono il registro di obblighi del package finale: nessuna promozione con questo amendment. UV-002/003/009/010 restano **UNVERIFIED**. Lo storico P5 del solo subset RPC/output osservato di UV-001 resta separato, non viene annullato né esteso a tutto il gruppo. I nuovi test/varianti sono futuri, non eseguiti nell'amendment.

| ID | Origine P0 / cosa provare | Test futuro | Milestone | Comportamento finché non provato |
|---|---|---|---|---|
| UV-001 | §§1.6,1.8,14.1: RPC ping→spawn→event→status/receipt; correlazione esatta, structuredOutput presente/schema-valid, differenza events/capabilities | TEST-025,026,027 | FUT-INTEGRATION e FUT-RECOVERY per reconciliation | BLOCKED prima di usare risultati/avanzare. |
| UV-002 | §§1.2,1.9,2.2,14.2: runtime registration, operational registration→RPC binding, collision handling e runtime source attribution | TEST-031,032 | FUT-INTEGRATION | Nessun launch del ruolo non dimostrato. |
| UV-003 | §§2.2,7,14.3: controlled definition ownership, effective tools/context/extensions, no-delegation, evidenze runtime indipendenti e canary; preferenze operatore non espandono authority | TEST-004,005,006,032,033 | FUT-INTEGRATION | BLOCKED se authority effettiva non verificabile. |
| UV-004 | §§7,14.4: Git pulito con commit, cleanup child, capture/round-trip patch, ref rework, binary/untracked | TEST-010,011,012,013 | FUT-INTEGRATION | Analisi ammessa; mutazione BLOCKED. |
| UV-005 | §§11,14.5: lock multiprocesso/stale owner, sync/rename/crash in filesystem target | TEST-028,029,030,034 | FUT-RECOVERY | Nessuna mutazione/claim di recovery sicuro. |
| UV-006 | §§11,14.6: event ordering reload/replacement, ownership sessione precedente e reconciliation | TEST-027,028,029,035 | FUT-RECOVERY | BLOCKED su run ignoto; niente redispatch. |
| UV-007 | §§9,16: origine umana di comando+conferma, attacchi indiretti, headless | TEST-019,020,021 | FUT-INTEGRATION | Gate resta AWAITING_HUMAN; niente approvazione sintetica. |
| UV-008 | §§7,16: path guard child, symlink/TOCTOU e confinement richiesto; nessuna promessa shell | TEST-007,008,009,033 | FUT-INTEGRATION | BLOCKED sulla capability necessaria; isolamento forte esterno richiesto se previsto dal task. |
| UV-009 | §13: package finale in installazioni Pi differenti, senza dependency/peer/import runtime o risoluzione Node di pi-subagents; disponibilità process-local dei protocolli | TEST-031,036 | FUT-RELEASE | Distribuzione/uso della combinazione non collaudata bloccati. |
| UV-010 | §§1.4,1.9: fresh runtime incluso Scout, history-canary e isolamento non provati dalla sola registration; fork esplicito, no silent fallback e limiti/timeout | TEST-014,037,038 | FUT-INTEGRATION | Scout/Reviewer/Developer bloccati senza fresh verificato; Oracle fresh esplicito solo se verificato, nessun fallback silenzioso dopo errore fork. |
| UV-011 | §§1.8,11,16: prove process-terminal, artifact retention e ricostruzione completa audit | TEST-012,028,029,035,039,040 | FUT-RECOVERY | No test/review con writer ignoto; artifact mancanti → BLOCKED. |
| UV-012 | §§1.5,1.8: sovrapposizione temporale reale fan-out non misurata | TEST-041 | FUT-INTEGRATION, soltanto se si abilita parallelismo | Funzionalità parallela disabilitata; minimo seriale non dipende da questa prova. |

I rischi P0 §14.7–10 non sono promesse verificabili una volta per sempre: versione futura → nuovo handshake (TEST-025); sicurezza OS resta precondizione esterna (TEST-033); comandi espliciti e trust (TEST-015,016); verità semantica assoluta non garantita da LLM/schema (TEST-017,018,042 verificano solo il protocollo). Nessun test può certificare correttezza universale della review.

## DOC-REVIEW — Verifica P1

La review P1 originale è storica in TEST-MATRIX.md §6. Il presente amendment modifica esclusivamente i tre documenti normativi, compresa P0; review interna e tracciabilità in §8. Nessun test di implementazione eseguito qui, nessuna capability promossa, nessuna modifica P0–P5 eseguibile né autorizzazione P6. Invarianti, 43 TR, AUT-001 e CMP-001 restano invariati. Ogni contraddizione futura va esposta come BLOCKING ISSUE, non aggirata mediante schema/transizione implicita.

## CPG-001 — Candidate Promotion project-level

CandidateGitBinding collega task/spec iniziale, targetRef/B0 e candidateRef stabile. Il congelamento aggiunge commit, digest, generation e spec finale verificata; il CompletionPackage storico resta invariato. Il commit è costruito host-side dal manifest exact e confrontato con un nuovo checkout prima di pubblicare il binding. Ref/path/OID sono validati; gli argv Git sono costruiti da primitive host private su allowlist, mai da testo del modello.

CandidatePromotionProposal lega project/task, current target HEAD, candidate commit/digest, integration commit/tree/digest, changed files, validation e review refs. Il merge isolato ha due genitori ordinati targetHead/candidateCommit. Conflitti, validation failure e review negativa non producono proposta eseguibile. Target avanzata richiede nuova validazione e Reviewer indipendente; baseline e tree identici possono riusare la review terminale del task.

Nel percorso SUPERVISED, il purpose trusted candidate-promotion usa il boundary nativo esistente, senza un nuovo gate globale. APPROVE consuma una capability live, persiste la receipt esatta e pubblica CandidatePromotionIntent prima della mutazione. REJECT conserva candidata e task; Cancel/Back non autorizzano. Qualsiasi ref, commit, tree, evidenza o HEAD cambiato invalida la decisione. Headless resta fail-closed. Il percorso BOUNDED_AUTONOMOUS usa invece la distinta policy authorization formalizzata da PA-001.

Il ref update è CAS old targetHead → integrationCommit. L'indice esclusivo Git serializza checkout ordinari; two-tree read-tree applica i file senza hard reset e rifiuta byte locali inattesi. CandidatePromotionResult è pubblicato solo dopo la verifica dell'esatta branch/HEAD e della coerenza pulita di index/worktree. Un intent valido può essere riconciliato dopo crash se target è old HEAD oppure esatto integrationCommit. Lease dead sono reclamate con process-incarnation e l'attuale repair guard, mai per anzianità/PID. Index vecchio e albero interamente nuovo possono essere riconciliati dopo prova byte-exact; stati parziali o ambigui restano bloccati. Nessun merge viene ricalcolato, rollback o operazione remota eseguiti.


## PA-001 — Project Autonomy / Bounded Autonomous Execution

Amendment esplicito autorizzato il 2026-10-04. Questa autorizzazione non equivale a una nuova conferma umana diretta. Conserva STM-001/STM-003: 11 stati e 43 transizioni. Nessun nuovo stato globale, ruolo o Orchestrator.

La modalità SUPERVISED conserva i contratti v1 e le conferme native. BOUNDED_AUTONOMOUS richiede un ProjectPlan APPROVED esatto e un ProjectAutonomyPolicy APPROVED tramite Trusted Human Confirmation. Una sola interazione può mostrare entrambi i contenuti esatti; persistono richieste e ricevute distinte. Una scelta di menu, un documento Markdown o JSON del modello non approvano nulla.

La policy v1 lega projectId, policyId/revision/digest, planId/revision/digest, branch locale e baseline iniziale, task ammessi, limiti per task, percorsi protetti, CommandSpec esatti, azioni consentite, binding memory, cambi dependency previsti, condizioni di escalation e ricette della verifica finale. Limiti: 64 task, prefissi letterali relativi con eventuale /** terminale, nessuna algebra glob universale. ScopeGuard continua a richiedere file concreti e a verificare il diff effettivo. Il lifecycle DRAFT/APPROVED/SUPERSEDED/REVOKED è documentale.

Il controller osserva progress(), seleziona nel piano approvato il primo task READY e invoca le API native. Un task per volta, al massimo i task ammessi. Un task già collegato viene recuperato con identità esatta; non si crea un duplicato. La formulazione resta preceduta dallo Scout sul repository corrente. La v1 richiede objective e acceptance intent testuali esatti, scope contenuto e comandi esatti; equivalenza semantica dubbia comporta escalation.

PolicyDerivedAuthorization registra exact policy/vera approvazione policy/vera approvazione piano refs, revisione/digest, piano, run, action, subject/digest, check e ALLOWED. Un AutonomyActionResult separato lega gli effetti ai ref delle prove native risultanti; la decisione di autorizzazione resta immutabile. Le escalation producono AutonomyDecision ESCALATE/BLOCK e HumanInterruption con decisione necessaria, fase, lavoro già integrato, opzioni sicure, obbligatorietà e dettaglio tecnico. Le capability di esecuzione sono registrate nel processo, non copiabili e consumate una volta. Ogni consumo e nuovo writer rivaluta revoca, piano, memory e catena baseline corrente. Leggere un record storico non autorizza un nuovo effetto.

DATA-009 v2, GAT-001 e GA ammettono policy authority soltanto per beforeImplementation (incluso retry Developer con prova nativa no-effect), onScopeChange con sole aggiunte di allowedPaths contenute nella policy, senza cambi di requisiti, criteri, comandi, vincoli, deny o budget, beforeCompletion e beforeReviewerRedispatch. Restano quiescenza, target, CAS, lock, candidate generation, data hash, budget e prove terminali native. Nessuna HumanDecisionEvidence o TrustedConfirmationReceipt viene fabbricata per questi passaggi. onOracleDecision e onRetryExhausted richiedono decisione umana.

Il TerminalCompletionPackage v2 direct-human conserva humanDecisionRef. La nuova v3 policy-derived conserva authorizationKind e policyAuthorizationRef, senza humanDecisionRef. Il verificatore ricostruisce l'envelope esatto e la closure policy/vera approvazione; tutti i predicati CMP-001 rimangono necessari. GatePresentation e i record host di rendering non attestano un dialogo umano per un'azione policy-derived.

CandidatePromotionIntent v2 distingue authority e lega la proposta concreta a una policy authorization, non a una falsa approvazione dell'integrationCommit. La pipeline Git/validation/Reviewer/apply resta unica. IntegrationCheckpoint usa una PolicyDerivedAuthorization per definitionRef/Definition/baseline esatte, senza inventare una ricevuta della Definition. Copertura e review restano native; la v1 autonoma non aggiunge scenari fuori policy.

La catena target avanza esclusivamente tramite PromotionResult nativi dello stesso run e decisioni policy-derived esatte. Head esterna, branch diversa o directory ufficiale dirty comportano pausa; nessuno stash/reset/rollback/force/remote. Il recupero può completare l'audit di un effetto Git già avvenuto; un nuovo effetto richiede una capability corrente. Morte del controller non prova terminalità dei ruoli: si riusano process-incarnation, lock, store e recovery nativi. Un writer ripristinato da policy richiede nuova verifica della policy, mai replay della capability storica.

Project Memory binding rimane umana. Una nuova proposta vincolante attribuita al task interrompe prima della successiva azione autorizzata, compreso il writer; modifiche a binding accettati invalidano la policy. Technical Lesson UNVERIFIED resta advisory. Dependency check v1 confronta sezioni dependency di package.json con cambi nome/versione esplicitamente autorizzati; manifesti dependency diversi o lockfile modificati richiedono decisione. Non è uno scanner universale di import, rete o supply chain.

Pausa manuale al successivo confine sicuro, revoca senza nuovi dispatch, cancel conserva evidenze e risultati. Resume senza nuova approvazione solo con binding correnti e recovery esatta; staleness richiede nuova policy approvata. Markdown/TUI sono viste, non authority. La conclusione positiva riguarda attività autorizzate integrate e checkpoint PASS sul commit corrente, senza certificare tutti i requisiti o una release.

PA-001 conserva attivi tutti i gate nativi e ammette recovery soltanto per task già autorizzati da quello stesso run. La promozione richiede il completamento derivato dal run corrente e la sua esatta proposta nativa; una promozione diretta umana o di un altro run non diventa parte della catena autonoma. Il risultato nativo NOT_REQUIRED è ammesso soltanto quando binding, completamento verificato e baseline corrente coincidono: viene registrato come risultato già presente, senza mutazione Git, merge inventato o nuova receipt umana.
