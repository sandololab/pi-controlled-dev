[English](../TEST-MATRIX.md) · **Italiano**

# P1 — Test design, tracciabilità e review documentale

Stato: **test design emendato; nessun nuovo test implementato/eseguito in questo amendment**. P0–P5 esistenti non vengono modificati o ricertificati; P6 non ripresa.
Fonti normative: [ARCHITECTURE.md](ARCHITECTURE.md) P0 e [PROTOCOL.md](PROTOCOL.md) P1.
P0 originale, riferimento SHA-256 solo storico (non hash della revisione emendata): `bc7e8a646fd591cef3bfea90d0901925018f8bf25a7d1c82954291c80434e010`.

## 1. Convenzioni

Ogni TEST-xxx è un obbligo di collaudo. Un test parametrico deve eseguire **tutte** le varianti indicate, non una scelta rappresentativa. `PASS` in un risultato atteso significa comportamento del test, non stato globale; le stringhe maiuscole di stato si riferiscono ai contratti.

Milestone future (non numerazione delle fasi del progetto, non autorizzazione a iniziarle):

- **FUT-CONTRACT:** prima accettazione di contratti/state machine/validator implementati.
- **FUT-INTEGRATION:** prima abilitazione dell'integrazione Pi/pi-subagents, ruoli, Git, comandi e gate.
- **FUT-RECOVERY:** prima dichiarazione di supporto a ripresa/crash/reload.
- **FUT-RELEASE:** prima distribuzione del package riutilizzabile.

Fixture standard F: repository Git temporaneo pulito con commit, spec valida approvata, comando required, un candidato separato, runner controllabile e artifact privati. Non usare questo repository o componenti Pi installati come fixture mutanti. F non attesta capability reali: test integration devono usare anche il runtime reale nella versione supportata.

## 2. Catalogo dei test futuri

| Test | Requisito/protocollo | Scenario e precondizioni | Azione | Risultato atteso | Tipo | Milestone |
|---|---|---|---|---|---|---|
| TEST-001 | INV-019; STM-001..004; TR-001..043 | Stati validi e guard/evidenze controllabili; matrice di ogni coppia degli 11 stati. | Eseguire ciascun TR con guard soddisfatti; negare ogni guard uno alla volta; tentare ogni coppia non elencata. | Solo TR espliciti ammessi; attore, invalidazioni, evento e side effect esattamente previsti. Ogni coppia illegale respinta senza cambiare stato; terminali immutabili. | unit | FUT-CONTRACT |
| TEST-002 | INV-001,002,008; AUT-001; CMP-001 | F in IMPLEMENTING; Developer invia `completed:true`, testo COMPLETED o `ok:true`. | Tentare transizione e scrittura globale come child. | Campi extra/result respinti; nessuna authority globale e nessun COMPLETED, anche con exit zero. | security | FUT-INTEGRATION |
| TEST-003 | INV-003; VAL-001; DATA-004,008 | F con report Developer «tutti test passati», nessuna validazione host. | Presentare report come prova per TESTING→REVIEWING/COMPLETED. | Report esplorativo non è ValidationResult; guard V/C falsi, nessun avanzamento positivo. | unit | FUT-CONTRACT |
| TEST-004 | INV-004,014; AUT-001; REG-001; EVD-001; REV-001; UV-003 | Controlled Runtime Reviewer registrato, fresh sul candidato immutabile; Operational Binding e canary/runtime evidence post-launch separati. | Tentare edit/write/bash, mutazione tramite extension o report; verificare filesystem prima/dopo. | Tool mutanti non disponibili/negati; canary invariato. Ogni mutazione osservata invalida review e blocca il task. Reviewer non corregge. | security | FUT-INTEGRATION |
| TEST-005 | INV-025; REG-001; CLA-001; SCOUT-001; EVD-001; DATA-003; UV-002,003 | controlled.scout registrato realmente tramite servizio process-local compatibile; consumer senza dependency pi-subagents; canary/inventario esterni al repository di sviluppo. | Registration→RPC→Operational Binding→completion→ScoutResult; varianti file/task ostile con richieste write/create/delete/rename, provider mutante e delegazione; ispezionare registry effettivo, source e filesystem. | Nome/source runtime attesi; solo read e structured_output, nessun tool mutante/delegazione; hash/inventario/metadata invariati. Output ri-validato e attribuito, recommendedScope PROPOSE_ONLY; prove mancanti/mutazioni bloccano, receipt da sola insufficiente. | security | FUT-INTEGRATION |
| TEST-006 | INV-005,025; REG-001; EVD-001; RET-001; DATA-006 | Controlled Runtime Oracle registrato su escalation autorizzata; canary e verifiche effettive indipendenti dalla receipt. | Tentare edit, spawn, approvazione, modifica scope o stato; restituire raccomandazione normale. | Effetti negati; consiglio ammesso soltanto come dato advisory, nessun unblock automatico. | security | FUT-INTEGRATION |
| TEST-007 | INV-006,013; SCP-001; GAT-001 | Allow di un file, deny di un altro anche presente nell'allow; terzo non elencato. | Modify/create/delete/mode change e rename su ogni combinazione. | Deny prevale; default deny; rename richiede entrambi i path; fuori scope rifiutato/rilevato senza COMPLETED. Scope change solo con gate e rianalisi. | security | FUT-INTEGRATION |
| TEST-008 | INV-013; SCP-001 | Path relativo valido e varianti traversal, assoluto, UNC, drive, backslash, NUL, alias Unicode/case. | Sottoporre path ad input e guard al momento dell'accesso, inclusi file nuovi. | Input invalidi rifiutati, nessuna normalizzazione permissiva o scrittura fuori root. Collisione non verificabile → BLOCKED. | security | FUT-INTEGRATION |
| TEST-009 | INV-013,024; SCP-001; UV-008 | Symlink interno/esterno e parent cambiabile, nuovo file ancora assente. | Scrivere attraverso link; sostituire parent fra verifica e operazione; introdurre hardlink/alias non dimostrabile. | Nessuna escape accettata; mutazione symlink negata; guard non dimostrabile/TOCTOU → BLOCKED, non PASSED per sola verifica iniziale. | security | FUT-INTEGRATION |
| TEST-010 | INV-021; SCP-001; UV-004 | Fixture non-Git, unborn, staged/dirty, untracked preesistenti e ignored interferenti. | Richiedere implementazione. | Analisi possibile, writer mai lanciato; BLOCKED al guard appropriato, nessun commit/stash/cleanup automatico. | integration | FUT-INTEGRATION |
| TEST-011 | INV-011,021; SCP-001,002; UV-004 | Base pulita con file normali, binari, nuovi file untracked e rename/mode/delete autorizzati. | Developer produce patch; runtime elimina worktree; host ricostruisce candidato. | Round-trip completo con identico manifest/digest; nuovi file/binari inclusi; patch incompleta o ref mossa blocca. Originale invariato. | integration | FUT-INTEGRATION |
| TEST-012 | INV-012,020; SCP-002; UV-004,011 | Child apparentemente concluso ma proof terminale ignota, patch mancante o artifact già rimossi. | Richiedere TESTING/materializzazione. | Nessun uso del vecchio cwd child; nessun test con writer ignoto; BLOCKED e preservazione evidenze. | integration | FUT-INTEGRATION |
| TEST-013 | INV-011,014; SCP-002; CMP-001 | Candidato e prove valide; file nuovi/binari o executable mode modificabili. | Alterare ogni classe di file prima/dopo test/review/gate/final commit; ripristinare poi byte identici in nuova generation. | Digest/mode/new-file variazione rilevata; vecchie evidenze invalidate; stesso digest con generation diversa non le resuscita. | integration | FUT-INTEGRATION |
| TEST-014 | INV-004,016; DATA-002,005; REV-001; UV-010 | Run Developer e Reviewer identificati; varianti stessa sessione/run, fork, fresh indipendente. | Inviare review da ciascuna combinazione; verificare cold-start packet e assenza di history Developer. | Solo fresh indipendente può soddisfare gate; modello uguale non è di per sé errore, session/run uguali sì; leakage/context ignoto blocca. | integration | FUT-INTEGRATION |
| TEST-015 | INV-009,026; DATA-001,008; VAL-001 | Candidato valido, almeno un comando required e fixture che registra esecuzioni effettive. | Eseguire exit0/non-zero/mai eseguito/deadline/abort; proporre lista required vuota. | PASSED solo con prova completa; FAILED, NOT_RUN, TIMED_OUT o INVALID secondo VAL-001; lista required vuota respinta; completion negata per ciascuna variante negativa. | integration | FUT-INTEGRATION |
| TEST-016 | INV-009,011,016; VAL-001 | Risultato apparentemente PASSED ma comando/spec/digest/generation/log/proof alterabili. | Corrompere un binding alla volta; dichiarare issuer Developer; fare test che modifica sorgenti; usare risultato di rerun precedente. | INVALID o oggetto rifiutato; nessun aggiornamento silenzioso binding. Solo comandi esatti approvati, niente interpolazione o vecchio successo scelto contro ultimo fallimento. | security | FUT-INTEGRATION |
| TEST-017 | INV-007,022,023; DATA-005; REV-001 | ReviewResult valido di riferimento. | Togliere criterion; duplicare ID; aggiungere proprietà; enum errato; PASS con finding blocking/UNVERIFIABLE; stampare JSON soltanto in prose. | Schema/semantica respinti; nessun parsing permissivo né completamento. | unit | FUT-CONTRACT |
| TEST-018 | INV-004,011,023; REV-001; CMP-001 | Review schema-valid, tree hash o test ID di candidato differente. | Consegnare review; poi PASS corretto con un altro gate mancante. | Primo caso BLOCKED, secondo caso canComplete=false. PASS necessario ma insufficiente. | unit | FUT-CONTRACT |
| TEST-019 | INV-010,011; GAT-001; DATA-009 | Gate valido mostrato all'umano e ancora non consumato. | Cambiare spec/digest/generation/revision/dati o riusare decisione già consumata. | Approvazione obsoleta/duplicata rifiutata; gate nuovo e nuova conferma necessari. Eventi leciti di persistenza/consumo non invalidano retroattivamente decisione immutata. | integration | FUT-INTEGRATION |
| TEST-020 | INV-010; AUT-001; GAT-001; UV-007 | Modello e child conoscono task/gate/session/hash corretti. | Invocare tool, slash command indiretta, fake boolean/attestazione, messaggio «utente approva». | Nessuna approvazione valida senza scelta esplicita nella TUI host e binding di sessione/dati/presentation verificati; nessun tool model-callable di approvazione. | security | FUT-INTEGRATION |
| TEST-021 | INV-006,010,026; GAT-001; TR-002,007,010,016,025,030,034,036..043 | Parametrizzare i cinque gate, modalità TUI/headless e approvazione/rifiuto/risposta incompleta. | Richiedere gate e rispondere tramite canale umano; testare resumeState non ammesso e scope gate disabilitato. | Target congelato e guard verificati; final gate rientra REVIEWING; scope sempre ANALYZING; headless non fidato resta AWAITING_HUMAN; nessun bypass test. | integration | FUT-INTEGRATION |
| TEST-022 | INV-017; RET-001 | Task con cap=2 rework,1 infra,64 dispatch,4 escalation; contatori prossimi ai limiti. | Consumare cap; tentare decremento/reset con nuova sessione/spec, incremento cap in corsa o overflow. | Ogni decremento/sforamento respinto; intent ignoto conta comunque; nessun writer dopo exhaustion, nessun loop infinito. | unit | FUT-CONTRACT |
| TEST-023 | INV-005,017; RET-001 | Due failure equivalenti con log/timestamp diversi; altra failure semanticamente distinta. | Calcolare fingerprint e aprire episodio; invocare Oracle due volte nello stesso episodio; riaprire episodio identico. | Equivalenti hanno stesso fingerprint, escalation prima del prossimo tentativo; un solo Oracle; duplicazioni/cap respinti. | unit | FUT-CONTRACT |
| TEST-024 | INV-005,017,018,026; RET-001; GAT-001 | Failure infrastrutturale provata vs timeout ambiguo; budget esaurito con/senza decisione concreta. | Retry, fallback modello/runner, proposta Oracle, gate exhaustion. | Un solo infra retry stesso protocollo con quiescenza; ignoto blocca; niente fallback; approvazione non aumenta cap; FAILED se nessuna azione legale residua. | integration | FUT-INTEGRATION |
| TEST-025 | INV-012,018; CAP-001; UV-001 | Pi reale e pi-subagents compatibili; varianti assente, versione cambiata, ping shape/capability incompatibili. | Handshake e prova bounded spawn→status→completion; verificare posizioni events/capabilities senza assumere equivalenza. | Contratto reale correlato dimostrato oppure BLOCKED prima di side effect child; nessuna API inventata o fallback. | integration | FUT-INTEGRATION |
| TEST-026 | INV-007,008,016,022; DAT-RESULT; UV-001 | RPC `ok:true` con structuredOutput assente, invalido, testo JSON o valido. | Elaborare risultato di ciascuna variante. | Solo campo strutturato schema-valid e attribuito viene acquisito; altri casi BLOCKED, anche con exit0 o artifact prose. | integration | FUT-INTEGRATION |
| TEST-027 | INV-012,016,018; CAP-001; PST-001; UV-001,006 | Completion duplicate, foreign run/session, contraddittorie, fuori ordine o arrivate prima del binding. | Consegnare sequenze di eventi e status riconciliabili/non riconciliabili. | Duplicate identiche idempotenti; ambigue non producono transizione; riconciliazione esatta o BLOCKED, nessuna doppia accettazione. | recovery | FUT-RECOVERY |
| TEST-028 | INV-018,019; PST-001; UV-005,006,011 | Dispatch controllabile, intent durable, run creato ma runId non ancora registrato. | Crash prima intent, dopo intent/prima spawn, dopo spawn/prima binding, dopo binding e dopo completion. | Nessun redispatch cieco; dopo intent esito ignoto fino a prova; contatori non decrementati; run unico riconciliato o BLOCKED. | recovery | FUT-RECOVERY |
| TEST-029 | INV-001,012,019,020; DATA-007,010; PST-001 | WAL/snapshot/artifact consistenti e varianti corrotte. | Crash in ogni boundary di artifact sync/WAL sync/snapshot rename; troncare coda, alterare prefisso/hash/revision; caricare terminale corrotto. | Replay solo eventi completi; nessun side effect ripetuto; non terminale incoerente BLOCKED; terminale quarantinato, mai attestato valido e nessuna TR inventata. | recovery | FUT-RECOVERY |
| TEST-030 | INV-014,017; PST-001; UV-005 | Due processi/task sul medesimo workspace; lock vivo, morto dimostrato, PID riutilizzato, ignoto. | Tentare acquisizioni concorrenti e recovery. | Un solo writer; nessun reclaim per sola età/PID; ignoto conserva lock; contatori restano monotoni. | recovery | FUT-RECOVERY |
| TEST-031 | INV-015; REG-001; CAP-001; UV-002,009 | Pi temporaneo, due repository e package finale da path/tarball; servizio pi-subagents assente oppure reso presente separatamente dall'utente con differenti modalità supportate. | Installare/caricare consumer senza dependency/peer/import runtime pi-subagents; provare registration e RPC, cambiare repository/ambiente. | Consumer caricabile anche senza servizio: capability unavailable e zero auto-install/upgrade/fallback. Con servizio compatibile funziona senza conoscere directory/metodo d'installazione o copie sul disco; nessuna modifica Pi/pi-subagents. | E2E | FUT-INTEGRATION; ripetere FUT-RELEASE |
| TEST-032 | INV-012,025; DATA-002; REG-001; CLA-001; EVD-001; CAP-001; UV-002,003 | Runtime registration reale con servizio assente/incompatibile, duplicati/alias, static profile omonimo; definition invalida, override user/project e multi-responder simulato. | Verificare registration accepted, RPC disponibile, stesso controlled agent name risolto, spawn/runId/completion correlati, structured output attribuito ed effective authority; testare §2.1, handle/lifecycle e preferenze lecite. | Operational Binding completo richiesto, senza owner-ID equality. Fail-closed su collisioni, reply concretamente contraddittorie, source/authority inattese, handle o binding invalidi; servizio assente = capability unavailable, nessun child. Authority extension-owned invariata; nessun fallback, riuso handle o equality coi digest provider. | security | FUT-INTEGRATION |
| TEST-033 | INV-024,025; SCP-001; CAP-001; UV-003,008 | Host fidato con shell generica; task che richiede isolamento forte; provider custom non consentito. | Richiedere mutation con/senza prova isolamento; tentare tool/provider non ammesso. | Nessuna falsa promessa sandbox; task forte bloccato senza prova; custom provider/tool negati; dati originali/credenziali non concessi dalla policy. | security | FUT-INTEGRATION |
| TEST-034 | INV-012,019; PST-001; UV-005 | Filesystem con fault injection su exclusive-create, fsync, rename, directory sync. | Fallire ogni operazione di persistenza/lock. | Nessun side effect successivo a commit incerto; stato precedente o replay valido; errore visibile e fail-closed. | recovery | FUT-RECOVERY |
| TEST-035 | INV-016,018,020; PST-001; UV-006,011 | Run detached attivo durante reload/shutdown, nuova sessione e precedente session runtime non disponibile. | Riavviare, ricollegare eventi e richiedere status/resume; eliminare artifact temporanei solo nella fixture. | Nessun nuovo run per assenza notifiche; session ownership non provata blocca; evidenze durevoli restano disponibili oppure completion negata. | recovery | FUT-RECOVERY |
| TEST-036 | INV-015,020; NOR-001; REG-001; CAP-001; UV-009 | Tarball finale in altra root/macchina, servizio pi-subagents configurato separatamente oppure assente; artifact/path degli spike nelle fixture. | Ispezionare manifest, bundle, import e caricamento; verificare assenza di Node resolution per pi-subagents e di registration statica dei template agents/*.md. | Nessuna dependency/peer runtime pi-subagents, copia/vendoring, lookup node_modules/globale/home, NODE_PATH, symlink di risoluzione o auto-install; nessun log/secret/temp artifact. Unica definition runtime-owned, unico executor RPC, libertà d'installazione dell'utente preservata. | E2E | FUT-RELEASE |
| TEST-037 | INV-004,018; DATA-002; SCOUT-001; EVD-001; CAP-001; UV-010 | Parent persistito con leaf/history-canary e non persistito; controlled.scout runtime e altri ruoli; override defaultContext=fork. | Lanciare Scout fresh esplicito e, come probe, con context omesso; canary solo nel parent, mai task/schema/prompt child; verificare context runtime e sessione. Provocare anche errore fork Oracle. | Scout/Reviewer/Developer fresh realmente indipendenti; proprietà effettiva verificata, non mera dichiarazione del modello. Nessun canary osservato nel child, senza promettere assenza assoluta di leakage; fork solo Oracle autorizzato, nessun fallback silenzioso. | integration | FUT-INTEGRATION |
| TEST-038 | INV-012,017,018; RET-001; CAP-001; UV-010 | Run/tool deadline, budget runtime, stop/interrupt/resume con writer controllato. | Superare limiti e chiedere ripresa. | Timeout non trattato come checkpoint sicuro; proof richiesta prima di nuovo writer; stopped non resumed; nessun aggiramento budget/fallback. | integration | FUT-INTEGRATION |
| TEST-039 | INV-016,020; DATA-007,010; PST-001; UV-011 | Task con retry, review FAIL/PASS, Oracle, decisioni e gate. | Ricostruire da soli state.json+events.jsonl+artifact riferiti, senza chat. | Stessi stato, contatori, test, review, decisioni, escalation, approvazioni e correlazioni; storico invalido distinto da corrente. | recovery | FUT-RECOVERY |
| TEST-040 | INV-020; PST-001; CMP-001; UV-011 | Log con segreti sintetici e transcript voluminosi, retention provider in scadenza. | Acquisire/copiare evidenze necessarie, redigere log e rimuovere temp. | Solo prove necessarie durevoli, niente segreti/transcript completi; se prova non conservabile, BLOCKED invece di perdita nascosta. | security | FUT-RECOVERY |
| TEST-041 | INV-014; CAP-001; UV-012 | Solo se futuro parallelismo abilitato, due ruoli read-only e timestamp/proof controllati. | Fan-out e misurazione sovrapposizione; tentativo due writer. | Risultati distinti e attribuiti; sovrapposizione verificata o capability non abilitata; due writer sullo stesso workspace negati. Minimo seriale non dipende dal test. | integration | FUT-INTEGRATION |
| TEST-042 | INV-009,023,026; CMP-001 | Bundle completo valido con 18 condizioni CMP numerate. | Verificare true; poi rendere falsa/unknown ciascuna condizione singolarmente, inclusi risk/disposition/criterion mancanti. REV-001A: Risk storico preservato, validation host corrente PASSED, RESOLVE_RISK host persistito e CMP-14 true; DEFER_RISK distinto per rischio residuale non bloccante. Negativi: evidenza stale/mancante/invalidata, criterion/spec/digest/generation errati, resolver non autorizzato, RESOLVE_RISK+DEFER_RISK e duplicati incompatibili. Cambio generation non riusa disposition storiche. | canComplete=true solo sul bundle completo; tutte le varianti negative false; nessun voto maggioritario/override umano. | unit | FUT-CONTRACT |
| TEST-043 | INV-006,011,022,026; DATA-001; SCP-001 | TaskSpec inline/file JSON/Markdown con nomi arbitrari, fonti/versioni e criteri. | Normalizzare; modificare fonte dopo READY; inserire criterion senza metodo e extraction modello non approvata. | Nessun nome PLAN/CURRENT obbligatorio; snapshot congelati; estrazione richiede approvazione; nuova fonte non aggiorna implicitamente spec e blocca fino a gate/rianalisi. | unit | FUT-CONTRACT |
| TEST-044 | INV-016,022; DAT-000; AUX-001; DATA-001..010 | Ogni oggetto e record annidato con fixture valida e tutti i campi/limiti; varianti numeriche della rappresentazione canonica degli interi DAT-000. | Togliere required, aggiungere campo, versione sconosciuta, coercizione/null, overflow, ID duplicato/dangling, hash errato, payload oltre cap. Confrontare `0` e IEEE-754 `-0`; verificare gli esempi normativi DAT-000 e interi positivi/negativi nei campi che li ammettono; confrontare forme lessicali JSON numericamente equivalenti (`1`, `1.0`, `1e0`) dopo validazione; tentare valori non interi, `NaN`, `Infinity`, `-Infinity` e valori fuori dai limiti del relativo campo. | Rifiuto strutturale/semantico senza riparazione silenziosa; stessa canonicalizzazione/hash su piattaforme supportate. `0` e `-0` producono gli stessi byte canonici e SHA-256; interi validi producono decimale ASCII deterministico conforme a DAT-000, indipendente dalla forma lessicale originaria; valori numerici invalidi sono rifiutati, mai canonicalizzati. | unit | FUT-CONTRACT |
| TEST-045 | INV-001,002,005,015; AUT-001 | Tutte le 6 identità × 14 operazioni, condizioni ALLOW* variabili. | Tentare ogni operazione con attore reale e con ruolo semplicemente dichiarato nel JSON. | Solo grant espliciti e condizionati ammessi; PROPOSE_ONLY senza effetto; merge/push/publish/original mutation sempre negati tramite package. | security | FUT-INTEGRATION |
| TEST-046 | INV-001,010,018; GAT-001; PST-001 | Gate autentico in AWAITING_HUMAN, decisione e consumo separabili. | Crash prima/dopo conferma, event sync, snapshot, consumo e resume. | Nessuna approvazione fabbricata o doppio consumo; output umano non persistito non viene presunto; ripresa richiede evidenza o nuova conferma. | recovery | FUT-RECOVERY |
| TEST-047 | INV-019; STM-002,003; PST-001 | Per ciascuno dei 43 TR, stato/guard validi, effetti fake deterministici e WAL. | Crash in ogni punto CR-1; ricostruire e tentare effetto duplicato. | Stesso TR/evento una volta; invalidazioni corrette; side effect sconosciuti riconciliati/bloccati, nessuna transizione implicita. | recovery | FUT-RECOVERY |
| TEST-048 | INV-003,004,008,011,015,023; CMP-001 | F con implementazione piccola, test required, reviewer indipendente e gate umani reali. | Eseguire intero ciclo Scout→Developer→test→review→rework→test→review→gate→completion. | COMPLETED soltanto per candidato validato con pacchetto completo; originale/peer invariati; vecchie evidenze non riutilizzate, nessun merge/push. | E2E | FUT-RELEASE |

### 2.1 Varianti aggiunte dall'amendment — non eseguite

TEST-032 deve coprire singolarmente: servizio/owner assente (result non scritto, capability unavailable, nessun fallback/install/child); version non supportata; receipt malformata/asincrona; nome non fisso proveniente da modello/TaskSpec; definition invalida; registration accepted e handle attivo; RPC disponibile nello stesso processo; stesso controlled agent name risolto; spawn con runId valido; completion correlata; structured output attribuito; effective identity/authority verificata; duplicato runtime; collisione nome/alias con altro runtime; static-name ambiguity nel cwd; source inattesa; handle invalidato; session/runtime replacement non riconciliato. Registration accepted non annulla un successivo rifiuto RPC prima dello spawn. Contratti/handle non serializzabili non diventano attestazioni JSON del provider. Non è richiesta equality fra owner identity di registration ed executor.

Caso multi-responder negativo opzionale: simulare reply incompatibili in entrambi gli ordini; se concretamente osservate → BLOCKED. La mera possibilità astratta di più owner/responder non blocca e il test non deve dimostrarne l'esistenza nel normale loader Pi. Duplicate identiche restano idempotenti soltanto in assenza di altre contraddizioni.

Override ampliativi: tools/excludeTools, nesting, context, tutte le inheritance, extensions/subagent-only extensions, mutation policy, permissions e prompt base. Ogni proprietà necessaria non supportata/inverificabile deve bloccare, non essere ignorata. Separatamente model/provider/thinking/fast documentato devono poter cambiare come preferenze senza ampliamento authority o variazione CLA-001; cambiamenti effettivi di capability bloccano comunque.

P16A mapping eseguibile limitato: `test/recovery.test.mjs` copre TEST-028 (INTENT/UNKNOWN senza redispatch), TEST-029 (classificazione incoerenze/proof mancanti, nessun repair), TEST-030 (owner live/dead/uncertain, incarnation Linux verificata, PID reuse, pair reclaim, ABA e race fra processi Node), TEST-034 (audit durevole prima degli unlink, fault e guard persistente sul partial reclaim), TEST-035/039/046 (stato/contatori/gate immutati). API host `classifyRecoveryState`/`recoverLocks`: nessun resume, consumo gate o dispatch. `test/recovery-historical.test.mjs`, con root storica esplicita, copia gli store prima di ogni operazione e verifica invariato l'inventario originale; lock residui mancanti sono fixture esplicite nella sola copia. I test storage usano terminal proof fixture; il probe di morte owner/reclaim usa processi Node reali. Reconciliation/continuation restano P16B, WAL repair e guard interrotti restano P16C: questi mapping non promuovono l'intera FUT-RECOVERY né UV-005 a VERIFIED.

P16B.1/GAT-002 estende i mapping **esistenti** TEST-019/020/021/030/035/039/042/044/046: gate immutabile distinto da GatePresentation durevole, generation monotona e CAS sulla presentation corrente; percorso normale generation 1 e takeover A→B con generation 2, stessi approvedData, nuova conferma B. Il negativo storico stesso gate+session B senza takeover/presentation resta SESSION_CHANGED. Rifiutare receipt generation 1 dopo 2, altro gate/task, sessione vecchia con generation corrente, record copiati, takeover circolare/non provato, doppia generation N+1, proof/ref/digest/revision mancanti o contraddittori. TEST-044 copre documenti chiusi GatePresentation v1, ProcessIncarnation v1 e canale umano v2; canale v1 resta storico senza migrazione implicita. TEST-046 distingue pending senza decisione, adozione legacy esplicita, decisione persistita non consumata, consumed/invalidated/REJECT/ANSWER non ripresentabili e incomplete commit P16C. TEST-042 verifica l'intera catena originaria→death/recovery/reclaim→takeover→presentation→decision→consume e preservazione dell'authority storica; TEST-021 richiede stessa presentazione human-readable P14H e headless HUMAN_ACTION_REQUIRED. Questi sono requisiti normativi, non dichiarazioni di implementazione o nuovi TEST ID; P16B deve produrre evidenza eseguibile prima di PASS.

P16B mapping eseguibile **parziale**: `test/recovery-resume.test.mjs` copre takeover esclusivo fra processi Node, owner reale ucciso, ANALYZING→READY senza replay, current spec durevole, pending presentation generation 2 e conferma nella sessione nuova, completion dopo restart con candidato e gate consumati preservati, abbandono BLOCKED→FAILED tramite TR-035, UNKNOWN senza redispatch, decisione persistita senza consume, lock mancanti senza prova e terminal no-op. Copre inoltre Reviewer A terminato senza verdict, acquisizione durevole della prova terminale pubblica, decisione `RETRY_INFRASTRUCTURE`, gate `beforeReviewerRedispatch`, APPROVE senza dispatch diretto e Reviewer B in un nuovo processo con identità fresh, senza replay Developer/validation. `test/terminal-evidence.test.mjs` copre FAIL/BLOCKED/PASS/UNKNOWN, stale/replay/session, candidata ed evidence runtime mutate, REJECT/ANSWER, contatori, preservation del confronto before/after e separazione da beforeCompletion. I leaf/provider sono double deterministici dichiarati; owner/successori, processi Reviewer della fixture, Git/worktree, lock, WAL e validation subprocess sono reali. Il probe storico verifica classificazione/rifiuto conservativo e originali invariati, non inventa una prova di morte per ownership legacy o lock assenti. Restano fuori da questa prova l’affidabilità del provider reale e la promozione globale P16B/FUT-RECOVERY a PASS.

Lifecycle: startup→registrazione, doppio dispose, nome non più risolvibile come runtime agent della fixture, nuova registrazione, shutdown/reload cleanup, nuova sessione/runtime senza vecchi handle/listener. Dispose non dimostra termine di run già partito e non autorizza redispatch di UNKNOWN; recovery avanzata resta TEST-028/035.

P14G.3A/CMP-002 estende TEST-042: congelare AuthorizationPackage A prima della conferma, approvare HA, consumare, costruire TerminalCompletionPackage v2 T che riferisce esattamente A/HA. HA diverso da HT è positivo; nessun T è richiesto prima della conferma. Mutare A, HA, il binding HumanDecisionEvidence, il riferimento terminale, candidato/generation, validation/review o decisione deve impedire completion. V1 non viene migrato implicitamente. Il probe storico con hash 75641670… e 826ff66f… documenta la regressione circolare.

TEST-042 multi-gate include beforeImplementation(spec A), onScopeChange A→B, beforeImplementation(spec B), beforeCompletion corrente; CMP-15 e tutte le 18 condizioni devono passare. Negativi: gate applicabile mancante, writer stale, scope approval assente, Oracle episodio errato, retry fingerprint errato, gate finale non consumato/stale/candidato errato, receipt riusato, decisioni contraddittorie. Restano tutti i 18 negativi individuali. TEST-046 subset P14 verifica creazione/persistenza/decisione/consumo, reload read-only e no double consume, interruzioni prima della decisione e dopo persistenza prima del consumo. Consumo/resume atomici non ammettono un prefisso con solo metà effetto; una storia artificiale separata è rifiutata. Nessun load consuma, riprende, rilascia lock o dispatcha; recovery P16 resta fuori scope.

TEST-044 estende tutti i casi DAT-000 ai record chiusi CLA-001/REG-001 e a AssignmentEnvelope v2: hash canonico deterministico, prompt/resource hash verificati, ID/ruolo/context coerenti, liste canoniche e completezza della proiezione authority. Cambiare ciascun campo authority deve cambiare l'hash; le preferenze lecite sono assenti dall'oggetto e non lo cambiano. Tentare runId/timestamp/task/path volatile/provider digest/output come campo aggiunto → rifiuto. V1 non reinterpretato/migrato in v2; hash del provider usato come nostro hash o artifact mancante → rifiuto. Nessuna modifica dei test P4 eseguibili con questo amendment.

TEST-026/032 devono distinguere nostro authority hash, digest spec/assignment/candidato e provider launchContractDigest. Riprodurre anche differenze spawn/completion principale vs child sotto override: preservare valori/issuer/livelli, nessuna normalizzazione o equality fra domini. Una differenza provider non blocca da sola quando Operational Binding e authority/identity hanno prova indipendente; nostro hash errato, effective authority discordante o prova mancante bloccano. TEST-027 mantiene il rifiuto delle duplicate contraddittorie dello stesso campo correlato.

Queste sono nuove prescrizioni di test del package finale, **non** esiti del precedente spike né promozioni UV.

## 3. Tracciabilità di tutti i criteri P0 §15

Gli ID `AC-P0-xx` sono etichette di tracciabilità assegnate qui ai bullet originali in ordine; non sono nuovi ID di authority. Questo amendment aggiorna i bullet packaging/registration corrispondenti senza cambiare il numero 34; ogni riga mantiene l'obbligo e punta a protocollo normativo e test futuro.

| Architecture requirement (§15) | Protocol ID | Test ID |
|---|---|---|
| AC-P0-01 Packaging: path/tarball senza dependency/peer runtime pi-subagents | NOR-001; REG-001; CAP-001; UV-009 | TEST-031,036 |
| AC-P0-02 Nessun path assoluto hardcoded/requisito specifico del repository di sviluppo | NOR-001; DATA-001; CAP-001 | TEST-031,036,043 |
| AC-P0-03 Registration v1 + RPC v1 con Operational Binding; servizio assente unavailable/incompatibile BLOCKED, nessun child/install | REG-001; CAP-001; INV-012; UV-001,002 | TEST-025,026,032 |
| AC-P0-04 Nessuna modifica Pi/pi-subagents | INV-015; AUT-001 | TEST-031,036,048 |
| AC-P0-05 Transizioni illegali rifiutate | INV-019; STM-001..004; TR-001..043 | TEST-001,047 |
| AC-P0-06 Solo Orchestrator scrive stato globale | INV-001; AUT-001; DATA-010 | TEST-002,045,047 |
| AC-P0-07 COMPLETED impossibile con schema/test/review/scope/digest/gate invalidi | INV-007..012,023; CMP-001 | TEST-007,015,017,018,019,020,026,042 |
| AC-P0-08 Recovery non duplica spawn o approvazioni | INV-018; PST-001; GAT-001 | TEST-027,028,046 |
| AC-P0-09 Corruzione/incoerenza BLOCKED | INV-012,019; STM-003; PST-001 | TEST-029,034,047 |
| AC-P0-10 Scout/Reviewer/Oracle non scrivono in canary | INV-004,005,025; AUT-001 | TEST-004,005,006 |
| AC-P0-11 Developer senza delegazione/completion globale | INV-002,025; DATA-002; AUT-001 | TEST-002,032,045 |
| AC-P0-12 Reviewer fresh distinto e senza correzione | INV-004; DATA-005; REV-001 | TEST-004,014,037 |
| AC-P0-13 Review stesso run/session Developer rifiutata | INV-016; DATA-005; REV-001 | TEST-014 |
| AC-P0-14 Traversal/symlink escape/fuori allow/denied bloccati | INV-013; SCP-001; UV-008 | TEST-007,008,009 |
| AC-P0-15 Baseline dirty non attribuibile rilevata | INV-021; SCP-001 | TEST-010 |
| AC-P0-16 Un solo writer per checkout | INV-014; PST-001 | TEST-030,041 |
| AC-P0-17 Managed worktree fixture pulita con commit, handoff e ricostruzione dopo cleanup | SCP-002; STM-002 guard T; UV-004 | TEST-011,012 |
| AC-P0-18 Test/review/completion stesso digest, nuovi file/binari, patch incompleta blocca | INV-011; SCP-002; VAL-001; REV-001; CMP-001 | TEST-011,012,013,016,018 |
| AC-P0-19 Shell non è confinement; isolamento forte non verificato blocca | INV-024; SCP-001; CAP-001; UV-008 | TEST-009,033 |
| AC-P0-20 Artifact temporanei fuori package pubblicato | INV-020; NOR-001; CAP-001 | TEST-036,040 |
| AC-P0-21 Comandi autorizzati associati al tree hash esatto | DATA-008; VAL-001; SCP-002 | TEST-015,016 |
| AC-P0-22 Timeout/non-zero/non-esecuzione impediscono completion | INV-009; VAL-001; CMP-001 | TEST-015,016,038,042 |
| AC-P0-23 Review schema-valid PASS necessaria ma insufficiente | INV-023; DATA-005; REV-001; CMP-001 | TEST-017,018,042 |
| AC-P0-24 Rework invalida test/review/approval del tree precedente | INV-011; STM-002 E/S; SCP-002; GAT-001 | TEST-013,019,048 |
| AC-P0-25 Retry cap monotono persistito | INV-017; RET-001; DATA-007 | TEST-022,028,030 |
| AC-P0-26 Failure fingerprint ripetuto attiva escalation | RET-001; AUX-001 FailureRecord/Escalation | TEST-023,024 |
| AC-P0-27 Oracle advisory, niente sblocco automatico scope/product | INV-005,006,026; DATA-006; RET-001; GAT-001 | TEST-006,021,024 |
| AC-P0-28 Approval su revision/hash obsoleti rifiutata | INV-010,011; DATA-009; GAT-001 | TEST-019,046 |
| AC-P0-29 Approval modello/child/non fidata rifiutata, inclusi comandi indiretti | INV-010; AUT-001; GAT-001; UV-007 | TEST-020,021 |
| AC-P0-30 Retry exhaustion non mascherata come successo | INV-017; RET-001; CMP-001 | TEST-022,024,042 |
| AC-P0-31 Ricostruzione stato/tentativi/decisioni/test/review/escalation/approvals dal ledger | DATA-007,010; PST-001 | TEST-029,039,046 |
| AC-P0-32 Run esterno correlato request/run/role/attempt | INV-016; AUX-001 RunRecord; CAP-001; PST-001 | TEST-025,026,027,028,039 |
| AC-P0-33 Segreti e transcript completi non copiati nel ledger | INV-020; DAT-000; PST-001 | TEST-036,040 |
| AC-P0-34 Recovery prima/dopo spawn, completion, state write e gate | STM-002 CR-1; PST-001; GAT-001 | TEST-027,028,029,035,046,047 |

**Copertura di progetto:** 34/34 bullet §15 associati ad almeno un protocollo e un test futuro. Non è una percentuale di test eseguiti.

## 4. Copertura invarianti e requisiti P1

| Requisito | Copertura |
|---|---|
| INV-001 | TEST-002,029,045,047 |
| INV-002 | TEST-002,045 |
| INV-003 | TEST-003,048 |
| INV-004 | TEST-004,014,018,037,048 |
| INV-005 | TEST-006,023,024,045 |
| INV-006 | TEST-007,021,043 |
| INV-007 | TEST-017,026 |
| INV-008 | TEST-002,026,048 |
| INV-009 | TEST-015,016,042 |
| INV-010 | TEST-019,020,021,046 |
| INV-011 | TEST-013,016,018,019,043,048 |
| INV-012 | TEST-012,025,027,029,034,038 |
| INV-013 | TEST-007,008,009 |
| INV-014 | TEST-004,013,030,041 |
| INV-015 | TEST-031,036,045,048 |
| INV-016 | TEST-014,016,026,027,035,039,044 |
| INV-017 | TEST-022,023,024,030,038 |
| INV-018 | TEST-024,025,027,028,035,037,038,046 |
| INV-019 | TEST-001,028,029,034,047 |
| INV-020 | TEST-012,029,035,036,039,040 |
| INV-021 | TEST-010,011 |
| INV-022 | TEST-017,026,043,044 |
| INV-023 | TEST-017,018,042,048 |
| INV-024 | TEST-009,033 |
| INV-025 | TEST-005,006,032,033,045 |
| INV-026 | TEST-015,021,024,042,043 |

Le 10 strutture richieste sono DATA-001..010; TEST-044 copre tutti i campi/limiti e i vincoli semantici, i test specifici coprono le interazioni. Tutte le 43 transizioni hanno caso positivo/negativo in TEST-001 e crash in TEST-047. Authority matrix completa in TEST-045. CanComplete è falsificato condizione per condizione in TEST-042.

### Test negativi esplicitamente richiesti dalla P1

| Rifiuto richiesto | Test |
|---|---|
| Transizione illegale | TEST-001 |
| Developer tenta COMPLETED | TEST-002 |
| Reviewer modifica file | TEST-004 |
| Scout modifica file | TEST-005 |
| Modifica fuori scope | TEST-007 |
| Path traversal | TEST-008 |
| Symlink escape | TEST-009 |
| Test non eseguito | TEST-015 |
| Test fallito | TEST-015 |
| ReviewResult invalido | TEST-017 |
| Review candidate digest errato | TEST-018 |
| Approval umana obsoleta | TEST-019 |
| Approval proveniente dal modello | TEST-020 |
| Retry oltre limite | TEST-022 |
| Structured output RPC mancante/invalido | TEST-026 |
| Completion event ambiguo | TEST-027 |
| Crash fra spawn intent e run id | TEST-028 |
| Recovery stato incoerente | TEST-029 |

Copertura richiesta: **18/18 scenari negativi** con test dedicato o parametrico esplicito.

## 5. UNVERIFIED e fail-closed

Registro normativo completo: PROTOCOL.md CAP-001, UV-001..012. La matrice include questioni fuori dalla sola lista P0 §14: shape ping/event, structured output, runtime registration/Operational Binding/source, authority hash distinto dai digest provider, origine umana, symlink/TOCTOU, round-trip/rework, ownership dopo reload, packaging senza dependency Node pi-subagents, fresh/fork, prove terminali/retention e parallelismo non misurato.

| Item | Test | Stato P1 | Default |
|---|---|---|---|
| UV-001 RPC/output | TEST-025,026,027 | UNVERIFIED | BLOCKED quando necessario |
| UV-002 Runtime registration/operational registration→RPC binding/collision/source | TEST-031,032 | UNVERIFIED | Nessun launch non dimostrato |
| UV-003 Definition ownership/tools/context/extensions/no-delegation/canary | TEST-004,005,006,032,033 | UNVERIFIED | BLOCKED |
| UV-004 Git/handoff | TEST-010..013 | UNVERIFIED | Scrittura BLOCKED |
| UV-005 Lock/durability | TEST-028..030,034 | UNVERIFIED | Mutazioni/recovery non abilitati |
| UV-006 Reload/ownership | TEST-027..029,035 | UNVERIFIED | BLOCKED, nessun redispatch |
| UV-007 Human-origin | TEST-019..021 | UNVERIFIED | AWAITING_HUMAN, approvazione impossibile finché non provata |
| UV-008 Scope/confinement | TEST-007..009,033 | UNVERIFIED | Mutazione BLOCKED se la capability è necessaria |
| UV-009 Package finale senza Node dependency pi-subagents; installazioni differenti | TEST-031,036 | UNVERIFIED | Combinazione non collaudata non abilitata |
| UV-010 Fresh/history-canary/no silent fallback/deadline | TEST-014,037,038 | UNVERIFIED | Launch dipendenti BLOCKED |
| UV-011 Proof/audit/retention | TEST-012,028,029,035,039,040 | UNVERIFIED | Nessuna completion senza prove durevoli |
| UV-012 Sovrapposizione parallelismo | TEST-041 | UNVERIFIED | Feature parallela disabilitata; minimo seriale valido |

Nessuna riga è promossa a VERIFIED dall'amendment; UV-002/003/009/010 rimangono UNVERIFIED. Il subset RPC/output osservato in P5 per UV-001 resta storico separato, non esteso al gruppo. Nessuna evidenza dello spike sostituisce i test del package finale. Per gate umano il blocco operativo è rappresentato da AWAITING_HUMAN come P0 prescrive, non da una nuova transizione arbitraria a BLOCKED. Un test di integrazione che fallisce non autorizza modifiche silenziose a P0.

## 6. Review documentale P1 originale (storico)

Le affermazioni di P0 immutata, inventario e assenza di implementazione sotto descrivono la consegna originale, non l'amendment corrente né P0–P5 successivi.

Review interna dell'autore, non review indipendente delegata e non test runtime del package.

| Verifica obbligatoria | Evidenza documentale | Esito della review |
|---|---|---|
| 1. Completezza rispetto P0 | 10 contratti, 26 invarianti, 43 TR, sezioni authority/scope/validation/review/retry/gate/completion/persistenza | Coperta |
| 2. Assenza authority ambigua | AUT-001 default deny; Human autorizza ma Orchestrator persiste; OP-02 limitata a patch host | Coperta |
| 3. Assenza transizioni implicite | TR esaustive, RECORD senza cambio stato, recovery esplicito; gate finale torna REVIEWING | Coperta |
| 4. Acceptance P0 coperti | AC-P0-01..34, un protocollo e test per riga | 34/34 |
| 5. Test negativi | Tabella 18 rifiuti richiesti | 18/18 |
| 6. Questioni UNVERIFIED | UV-001..012, prova/test/milestone/default; rischi permanenti separati | Coperte, non risolte |
| 7. Nessuna implementazione prematura | Solo due documenti P1; P0 immutata verificata tramite SHA-256; inventario finale senza manifest/profilo/runner/extension | Coperta |
| 8. COMPLETED riconducibile a prove precise | CMP-001 condizioni 1..18; DATA-010 stateAfter; TEST-042,048 | Coperta |

Controlli di coerenza applicati alla revisione finale: schema umano non si autentica con campi child; scope change passa rianalisi; spec/current candidate binding non viene riscritto sui risultati vecchi; intent ignoto non produce retry; ogni RECORD è univoco e non introduce self-transition; il limite dispatcher copre anche analisi e review, non solo Developer.

### Rilievi della prima lettura e seconda verifica

Correzioni effettuate esclusivamente nei documenti P1:

1. Anticipata la materializzazione al termine di IMPLEMENTING, prima di TR-013, per rispettare letteralmente P0 §7; TESTING non ricrea il candidato dopo essere entrato nello stato.
2. Distinte autorizzazioni storiche del writer e approvazione finale del candidato: nessuna decisione consumata viene riutilizzata per nuovi effetti o per la generazione successiva.
3. Specificati record di conferma umana e manifest, hash della baseline originale attraverso i rework, continuation per ogni resumeState e obbligo di comandi required nei criteri AUTOMATED/BOTH.
4. Eliminata l'ambiguità exit zero/prosa di fallimento: il minimo considera exit status del comando autorizzato, non inventa un parser di risultati test.
5. Allineate milestone dei test di installazione e reconciliation; corretto escaping delle union nelle tabelle.

La seconda verifica ricontrolla le otto voci sopra, tutti i TR e il percorso positivo completo, inclusi gate iniziale/finale e rework. Nessuna correzione richiede modifiche a P0; nessun BLOCKING ISSUE P0 identificato. Verifica di tracciabilità solo documentale, non esecuzione dei 48 test futuri.

Controllo finale read-only sui documenti: ID definiti univoci (26 INV, 43 TR, 10 DATA, 12 UV, 48 TEST, 34 AC-P0), riferimenti numerici entro gli insiemi definiti, ogni bullet P0 §15 associato a protocollo/test, tabelle e code fence coerenti. SHA-256 P0 immutato. Inventario repository: ARCHITECTURE.md preesistente, PROTOCOL.md e TEST-MATRIX.md nuovi; nessun altro file fuori `.git`. Il controllo temporaneo non è stato salvato come codice/test nel repository.

**PHASE RESULT: PASS** per la specifica P1. **P0 CONFLICTS:** nessuno identificato. **IMPLEMENTATION STARTED: NO**. Le 12 voci UV rimangono aperte per i collaudi futuri; nessuna fase successiva autorizzata.

## 7. Limiti della fase P1 originale e prossima autorizzazione (storico)

P1 consegna contratti e test design, non prova eseguibilità dell'integrazione ancora UNVERIFIED. Nessuna estensione, agent profile, package.json, adapter RPC, orchestrator, store, scope guard o validation runner implementati. Nessuna fase successiva avviata.

L'accettazione P1 riguarda completezza/coerenza delle specifiche. Per abilitare una capability futura occorreranno l'autorizzazione dell'utente e i test della relativa milestone. Una contraddizione dimostrata con P0 richiede BLOCKING ISSUE e arresto, non un cambio di architettura sotto forma di dettaglio implementativo.

## 8. Review interna dell'amendment Operational Registration/RPC Binding

Review documentale dell'autore, non indipendente delegata e non collaudo runtime. Modificati soltanto ARCHITECTURE.md, PROTOCOL.md e TEST-MATRIX.md. Nessuna implementazione P6 o aggiornamento delle API/validator P4/P5.

| Condizione obbligatoria | Disposizione normativa |
|---|---|
| 1. Nessuna dependency runtime pi-subagents | P0 §13; CAP-001: vietati dependency/peer, import e workaround di risoluzione |
| 2. Libertà d'installazione | P0 §13; TEST-031/036: servizio scelto dall'utente, assenza gestita senza installazioni |
| 3. Fonte controllata unica | P0 §2.2/12; REG-001: runtime definition; Markdown solo documentazione/template non registrati |
| 4. Unico execution boundary | P0 §1.2; REG-001/CAP-001: registration non esegue, solo RPC lancia/controlla |
| 5. Preferenze senza escalation | CLA-001/REG-001; TEST-032: model/provider/thinking/fast separati dall'authority |
| 6. Hash autonomo deterministico | CLA-001 + DAT-000; AssignmentEnvelope v2; TEST-044, nessuna migrazione implicita |
| 7. Digest provider non equiparati | EVD-001; TEST-026/032: anomalia conservata, nessuna normalizzazione |
| 8. Anomalie fail-closed | REG-001; TEST-032: collisioni, reply contraddittorie, source/authority/context/extensions/delegation/output/handle/replacement inattesi bloccano |
| 9. Lifecycle normale definito | REG-001; TEST-032: handle solo corrente, dispose e nuova registrazione; distinto da recovery |
| 10. Operational Binding | Registration accepted + stesso controlled runtime agent risolto/eseguito via RPC nello stesso runtime + nessuna authority evidence contraddittoria; nessun owner ID inventato |
| 11. Coerenza P0/P1 | P0 §2.2/6/13 e CLA-001/REG-001/SCOUT-001/EVD-001 allineati; 26 INV, 43 TR, AUT-001 e CMP-001 non modificati |

L'evidenza registrazione è host-acquired, non un'asserita attestazione completa del provider; documenta il binding operativo locale. Solo responder/reply incompatibili concretamente osservati bloccano, non la loro possibilità astratta. La nuova specifica DATA-002 v2 e i record aggiunti non sono dichiarati implementati: l'allineamento futuro richiede autorizzazione separata. Il cambiamento dei documenti può richiedere manutenzione futura dei test che fissano gli hash documentali; nessun test eseguibile viene alterato o dichiarato superato qui.

**AMENDMENT RESULT: PASS** documentale. Nessuna nuova capability VERIFIED; causa della divergenza provider digest irrisolta e non bloccante per CLA-001 se authority verificata indipendentemente. **IMPLEMENTATION CHANGED: NO. P6 RESUMED: NO.**

Reviewer redispatch — regressioni di integrità: `test/terminal-evidence.test.mjs` verifica spec, validation, process proof e terminal proof alterati prima del gate, Cancel/No senza authority e perdita dei lock dopo APPROVE senza dispatch o contatori aggiuntivi. Questi controlli sono richiesti anche sul percorso ripristinato.

## Candidate Promotion — matrice eseguibile aggiuntiva

`test/candidate-promotion.test.mjs` usa veri repository/commit/branch/worktree/merge Git e il ledger terminale verificato del workflow. Provider e risposte UI automatizzate sono double dichiarati, distinti dalla prova umana nativa. Copre binding e digest, tree/identity, completion distinta, no-op, branch generiche, target advanced, conflitti, validation failure, stale/wrong/forged/replayed receipt, dirty/untracked/wrong branch, rifiuto, ancestry manuale e ambiguità cherry-pick, proiezioni Markdown, WAITING→READY con normale preparazione TaskSpec. `candidate-promotion-worker.mjs` verifica esclusione di lease, crash prima/dopo intent, ref e file update, reload e pubblicazione idempotente del risultato in processi separati. La review del merge usa il medesimo Reviewer read-only, con controlli RPC/terminal/transcript/canary.

Le regressioni esistenti su Project Memory, Project Planning, Trusted Confirmation, recovery e task storici restano obbligatorie nella suite seriale. Gli 11 stati/43 transizioni non cambiano. Packaging esclude tutte le fixture e i worktree. La verifica umana TUI usa un progetto temporaneo innocuo e conferme personali; nessun risultato automatico la sostituisce. La fase non certifica Integration Checkpoints, bootstrap greenfield, remoti o correttezza universale delle review.


## PA-TEST — Project Autonomy amendment (2026-10-04)

Le nuove suite `project-autonomy.test.mjs` e `project-autonomy-e2e.test.mjs` si aggiungono a tutte le suite baseline. I doubles sono dichiarati: non certificano persona o modelli reali.

| Gruppo | Evidenza richiesta |
|---|---|
| Policy boundary | Bundle piano/policy con un dialogo e proof distinti; forgery, copy, wrong revision, scope/plan/target digest, cancellation e revoca rifiutati |
| Admission | Scout reale come boundary host con provider double; objective/intent esatti, scope e comandi contenuti; nessun HumanDecisionEvidence sintetico |
| Gates/Completion | onScopeChange nativo dentro/fuori policy; proposta ADR prima del writer; V1 compatibile; v2 policy refs esclusivi; Oracle/retry non autorizzabili; terminal v2/v3 e closure verificabili; 11/43 invariati |
| Staleness | Piano corrente, memory binding, branch, head e dirty changes; lesson advisory non ampliano authority |
| Dependency | package.json aggiunte/cambi esatti, nome/versione espliciti; manifesti non supportati richiedono decisione |
| Production workflow | Rework reale nel budget, budget esaurito, Reviewer A terminale senza verdict → Reviewer B, incertezza senza Reviewer B, Developer no-effect recovery; zero conferme di routine |
| Controller | Ordine approvato, seriale, limiti finiti, pause/resume/revoke/cancel, escalation persistita e nessuna scelta nascosta |
| E2E existing | Quattro task controllati, provider doubles con processi separati, validation reale, scope nativo, review, quattro integrazioni Git, checkpoint finale; un dialogo iniziale e zero per-task |
| E2E greenfield | Bootstrap separato, decisioni memory native, poi piano/policy bundle e stesso percorso autonomo |
| Exception | P1 integrato, P2 fuori scope: safe pause, nessun writer fuori limite, risultato P1 conservato |
| Recovery | SIGKILL reale del controller dopo P1, reload e ripresa P2 senza nuova approvazione; effetto promotion già avvenuto contabilizzato una sola volta; binding stale/terminalità incerta non autorizzano nuovi effetti; lease controller esatto |
| Human UX | Modalità esplicita, policy spiegata, progress con pausa/dettagli, Project/Current Plan/Activity e summary senza digest routinari |
| Regression | Tutti i test storici, Greenfield, checkpoint, promotion, planning, memory, trusted confirmation, ControlledTask e recovery |

Le prove manuali umane e real-model restano distinte dalle fixture. Un provider indisponibile non è PASS. Il report finale deve riportare conteggi realmente eseguiti, zero failure/skipped e limiti residui.

PA-TEST comprende il rifiuto di gate disattivati e di task appartenenti a un altro run prima del writer; verifica inoltre il completamento nativo NOT_REQUIRED con HEAD invariato, una sola approvazione iniziale e checkpoint finale PASS.
