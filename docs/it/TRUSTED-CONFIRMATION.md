[English](../TRUSTED-CONFIRMATION.md) · **Italiano**

# Trusted Human Confirmation Boundary

Questa primitive interna rende riutilizzabile il trasporto trusted della conferma TUI. Non implementa Project Memory e non aggiunge stati, transizioni, authority globali o strumenti per gli agenti. L’umano resta l’authority della decisione; l’Orchestrator resta l’unica authority dello stato del task.

## Separazione delle responsabilità

`requestHumanConfirmation` contiene il percorso nativo precedentemente interno all’Orchestrator: richiede TUI e sessione, usa il pannello `ctx.ui.custom` oppure `ctx.ui.confirm`, accetta soltanto il ritorno booleano true e controlla che sessione, modo e metodo UI non siano cambiati. Anche `confirmHumanDisplay` e `presentHumanGate` usano questo stesso trasporto.

Il contratto dei task resta invariato. `presentHumanGate` continua a richiedere un gate registrato. `acceptHumanDecision` conserva integralmente la propria admission logic: gate corrente, TaskSpec, revisione, lock, `AWAITING_HUMAN`, presentation corrente, protezioni stale e ricevuta single-use. Una ricevuta generica non può essere passata al suo posto. `GatePresentation` e i documenti canale storici non cambiano.

## Uso esclusivamente host

Il codice trusted costruisce una richiesta con `createTrustedConfirmationRequest`. I purpose ammessi sono `task-human-gate`, `project-memory-approval`, `project-plan-approval`, `candidate-promotion`, `integration-checkpoint` e `greenfield-bootstrap`. I consumer applicano le rispettive regole di dominio e le approvazioni restano separate. I purpose non concedono permessi.

Una richiesta contiene schemaVersion, confirmationId locale, purpose, subjectKind, subjectId, subjectRevision, action, payload canonico, payloadDigest e presentation. L’host deve preparare una spiegazione completa e fedele al payload; il trasporto non può provarne l’equivalenza semantica. Al testo vengono aggiunti azione, oggetto, revisione e significato dell’annullamento. Il digest della presentazione comprende titolo e intero contenuto logico fornito al renderer; non certifica pixel, scorrimento completo o lettura umana. I caratteri che il renderer eliminerebbe sono rifiutati.

Il payload è limitato a 64 KiB canonici, la presentazione a 64 KiB, la richiesta a 129 KiB e l’evidenza a 132 KiB. Le copie JSON sono inerti e profondamente congelate. Solo l’oggetto registrato nello stesso processo può essere presentato, una sola volta. Queste API non sono registrate come tool o endpoint RPC; i moduli dei ruoli non le importano. Come nel modello di fiducia esistente, host Pi ed extension caricate sono trusted: una extension ostile in-process è fuori dal threat model.

`presentTrustedConfirmation` conferma esattamente il testo della richiesta e restituisce una ricevuta soltanto dopo risposta nativa true. APPROVE, REJECT e ANSWER sono azioni esplicite scelte dall’host e mostrate all’umano; ANSWER deve avere il suo contenuto esatto nel payload e nella spiegazione. False, Esc, timeout, risposta non booleana e perdita del binding non registrano una decisione. Nessuna simulazione è presente nel modulo di produzione.

La ricevuta lega purpose, oggetto, revisione, azione, digest del payload, digest della presentazione e digest dell’intera richiesta. La confirmationInstance contiene ID locale, sessione host e sorgente UI. Non viene inventata un’identità personale, una firma o una confirmation ID del provider.

## Persistenza e consumo

`consumeTrustedConfirmation` richiede la ricevuta originale, un lettore dell’esatta richiesta corrente e lo store esistente con `put`/`read`. Consuma la capability prima dell’I/O, controlla freshness e canale, persiste richiesta e ricevuta come un unico artifact canonico, verifica i byte riletti, poi ricontrolla freshness e canale. Restituisce l’ArtifactRef solo dopo queste verifiche. Anche un errore brucia la capability.

Il consumer deve detenere i propri lock/CAS esistenti, includere l’ArtifactRef nel proprio aggiornamento durevole e applicare l’azione autorevole solo dopo il ritorno. Il boundary non modifica nessun oggetto di dominio, non interpreta APPROVE/REJECT e non crea un WAL. Il consumer è responsabile della corretta implementazione di `put`/`read`, della durabilità, della decisione locale e dell’atomicità del proprio aggiornamento. Non esiste un’assunzione di atomicità fra artifact e futura azione: un crash può lasciare un artifact orfano, che non autorizza a ripetere l’azione.

`readTrustedConfirmationEvidence` verifica integrità canonica e correlazione dell’artifact storico con l’esatta richiesta attesa. Non autentica da solo un JSON arbitrario: richiede provenienza da uno store trusted. Un digest prova integrità, non origine umana. Il reload non registra la ricevuta e non ripristina una capability consumabile. Dopo un crash il consumer deve verificare il proprio stato durevole; per una nuova azione serve una nuova conferma umana.

`test/trusted-human-probe.ts` resta esclusivamente diagnostico e non viene distribuito nel package. Le sue risposte, i booleani e le copie serializzate non possono essere consumati come ricevute autorevoli.

## Fixture e verifica

`test/project-confirmation-host-probe.ts` contiene soltanto `ProjectMemoryProposalFixture`, non modelli o uno store Project Memory. La fixture usa `DurableStore.put` e permette una prova con dialogo TUI nativo caricando esplicitamente il probe in Pi e invocando `/project-confirmation-fixture`. Il probe limita il parent a read-only, rifiuta headless e conserva gli artifact in un’area temporanea separata dal repository. Non viene distribuito nel package.

I test automatici utilizzano UI doubles dichiarati per verificare approvazione, rifiuto, risposta, annullamento, sessione, replay, falsificazione e cambiamenti della richiesta. La fixture verifica inoltre persistenza e rilettura in un processo nuovo senza recuperare authority. Queste prove non attestano una conferma umana reale.

Non serve modificare ARCHITECTURE, PROTOCOL o TEST-MATRIX: i gate normativi continuano a utilizzare il percorso esistente e l’estrazione conserva la sua semantica. Il nuovo trasporto host è una primitive interna senza cambiamenti al modello globale 11/43. README e manuale restano coerenti con le capability effettivamente disponibili.
