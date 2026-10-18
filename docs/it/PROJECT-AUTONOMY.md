[English](../PROJECT-AUTONOMY.md) · **Italiano**

# Project Autonomy / Bounded Autonomous Execution

La modalità supervisionata continua a chiedere le conferme normali. Autonomia controllata richiede una scelta esplicita: la persona approva il piano esatto e una policy con limiti verificabili. Lo stesso dialogo può mostrare entrambi, conservando prove indipendenti.

## Percorso

Project Plan → pre-task Scout → TaskSpec dentro policy → ControlledTask → validation/rework → Reviewer → completion → Candidate Promotion → prossimo task → Integration Checkpoint finale.

La policy non approva ogni futura candidata come se fosse stata mostrata. Ogni azione registra PolicyDerivedAuthorization e i check deterministici correnti. Nessun modello può attivare policy o produrre capability eseguibili con JSON copiato. Gli stati e le transizioni dei task restano 11 e 43.

Il menu permette la scelta della modalità durante la review finale del piano. Nel percorso produttivo gli Scout pre-task propongono scope e verifiche in sola lettura; l’host verifica che i file rientrino negli ambiti del piano e compila soltanto le ricette esistenti ammesse. Non sono richiesti input manuali di percorsi o comandi. Una sola conferma nativa lega piano e policy esatti, poi avvia il controller esistente. `project auto` avvia una policy già approvata; `project pause`, `resume`, `revoke`, `cancel`, `autonomy` gestiscono il run. Nel pannello live P richiede pausa al prossimo punto sicuro, D apre dettagli, Esc nasconde il pannello lasciando il lavoro in corso.

Design e passi di implementazione arrivano sia al pre-task Scout sia allo snapshot del piano nel TaskSpec. Il normale workflow conserva selezione e ricevute Project Memory, skill dei ruoli, scenari, instrumentazione, validazione, rework, Reviewer e integrazione. La pianificazione può proporre decisioni nello stesso Project Memory; adottarle richiede il normale percorso della memoria e una nuova analisi con il contesto aggiornato.

## Limiti v1

- Recovery adotta soltanto task già ammessi da quello stesso run; task storici o completati fuori dal run restano supervisionati. I gate non possono essere disattivati.
- Una candidata senza modifiche riusa il risultato nativo NOT_REQUIRED: si registra che la baseline già soddisfa il task, senza creare un merge o una falsa receipt.
- Esecuzione sequenziale, ordine del piano fra task READY, massimo 64 attività autorizzate.
- Limiti letterali relativi per cartelle/file, eventuale `/**` terminale nella policy. ScopeGuard continua a ricevere file concreti, senza nuova semantica glob.
- Objective e acceptance intent devono coincidere testualmente col PlannedTask. Non si delega al modello la prova di equivalenza semantica.
- CommandSpec esatti: derivano dalle proposte native, con review e controllo diff obbligatori e test osservati fra le ricette host disponibili. Una variazione indispensabile durante l’esecuzione richiede una nuova decisione.
- Checkpoint finale con ricette esatte, review obbligatoria e soli task del run. Nessuno scenario aggiuntivo implicito.
- package.json: dependency name/version aggiunti o cambiati devono essere esplicitamente previsti; manifesti di altri ecosistemi e lockfile modificati provocano escalation conservativa. Non vengono analizzati tutti gli import o le operazioni di rete.
- Una proposta vincolante di memoria richiede decisione umana; le lesson UNVERIFIED non diventano ACTIVE automaticamente.

## Interruzioni

Cambio piano/architettura, scope aggiuntivo, conflitto Git, dependency inattesa, budget esaurito, rischio o ambiguità, baseline esterna/dirty, revoca e terminalità incerta producono HumanInterruption. La vista mostra cosa è già integrato, quale decisione serve e opzioni sicure; nessuna viene selezionata automaticamente.

Pause/resume conservano l'audit. La policy può essere revocata; i risultati già conclusi restano verificabili. Recovery riusa le primitive native con identità esatte: proof storiche non autorizzano un nuovo writer. Nessun reset, stash, rollback, force update o Git remoto.

## Audit e viste

DurableStore è autorevole. Gate v2 e TerminalCompletionPackage v3 indicano policy authority senza humanDecisionRef; i vecchi v1/v2 direct-human mantengono la loro semantica. PromotionIntent v2 e checkpoint approvals legano esattamente il soggetto concreto alla policy.

Project.md, Current Plan e una sola Autonomy Activity spiegano modalità, progresso, risultati e interruzioni. Modificarli non altera autorizzazioni. Digest e receipt appartengono ai dettagli tecnici, non a richieste ripetute.

## Prova manuale da eseguire personalmente

In un repository fixture innocuo, aprire Pi e `/controlled-dev project plan`. Chiedere quattro piccoli incrementi su un file locale, scegliere Autonomia controllata, rivedere design, file previsti e verifiche proposte, leggere piano e policy e confermare una volta. Verificare progresso, zero conferme per singolo task, P per pausa al confine sicuro, resume con binding correnti e riepilogo finale sul commit verificato. In una seconda fixture chiedere deliberatamente un file fuori limite: il sistema deve fermarsi conservando i risultati già integrati. Greenfield richiede prima il bootstrap e le eventuali decisioni memory separate.

Le fixture automatiche usano doubles dichiarati dei provider e canali umani, Git/processi/validation reali. Non sostituiscono la prova umana o una prova con modelli reali. Il relativo stato viene riportato separatamente nel report di verifica.

Revisioni dello stato del workflow come `state-r11` appartengono a un solo ControlledTask. Le copie immutabili nello store Autonomy di progetto usano `autonomy-task-state-<hash>`, derivato canonicamente da run di autonomia, attività pianificata, task controllato, tipo di artifact e revisione locale. L'host legge soltanto dal namespace del task legato all'autorizzazione verificata e conserva byte e digest esatti. Cambia soltanto l'indirizzamento delle prove, non autorità della policy o transizioni. Riferimenti storici validi agli effetti conservano i nomi originali e si caricano/recuperano senza migrazione. La registrazione esatta degli effetti rimane idempotente per il recupero dopo crash; capability di azione consumate rifiutano ancora il replay e byte diversi non possono sovrascrivere un'identità esistente.
