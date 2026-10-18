[English](../PROJECT-MEMORY.md) · **Italiano**

# Project Memory

Project Memory conserva decisioni architetturali software, lezioni tecniche, convenzioni e vincoli fra task differenti. I record strutturati nel namespace `memory/` dello store project-level sono autorevoli; il repository Obsidian spiega i record e le annotazioni personali restano non autorevoli.

## Persistenza e authority

`ProjectMemoryRepository` riusa `DurableStore` per artifact canonici, verifica di integrità, sincronizzazione e snapshot atomico. L’unico indice corrente punta a record immutabili; le revisioni precedenti restano nella storia. Gli ID SAD/TL/PC/TC includono un UUID, non dipendono dai nomi Markdown e non vengono riallocati. Un crash può lasciare artifact orfani, esclusi dall’indice corrente. Non esistono WAL, ledger o recovery alternativi. I lock workspace di `LockManager` serializzano le mutazioni. Durante un task le proposte del ruolo passano dal lock già detenuto dall’host; le decisioni TUI separate richiedono un workspace libero.

L’host crea solo PROPOSED per ADR, convenzioni e vincoli, o UNVERIFIED per lezioni. Accettazione, attivazione, supersession e ritiro/deprecazione richiedono il Trusted Human Confirmation Boundary nativo. Il payload comprende progetto, snapshot atteso e revisioni complete da aggiornare. La receipt viene consumata sotto lock e persistita prima dello snapshot. Il reload verifica che ogni revisione corrente dotata di authority sia legata a una conferma impegnata nell’indice. Un artifact di conferma orfano non promuove record. La persona valuta significato ed evidenze; hash e test non certificano la verità di una lezione.

ADR: PROPOSED, ACCEPTED, SUPERSEDED, DEPRECATED. Lezioni: UNVERIFIED, ACTIVE, SUPERSEDED, RETIRED. Convenzioni e vincoli: PROPOSED, ACTIVE, SUPERSEDED, RETIRED. Supersession aggiorna insieme il sostituto e la memoria precedente; entrambe le relazioni restano verificabili. Record ritirati, deprecati e sostituiti restano tombstone.

## Applicabilità e contesto

Scope repository, directory o component usa soltanto percorsi relativi. Il componente è identificato inizialmente dal suo percorso; non esiste un classificatore semantico. Il prefilter host considera status corrente, scope e file pertinenti. Le lezioni richiedono inoltre un match esplicito loadWhen (termine nell’obiettivo o percorso pertinente) ed evidenze correnti. Le evidenze fanno riferimento ai byte originali di task, scenario, run, bundle, validazione, review, artifact o configurazione del repository; non vengono copiate. Un digest non corrispondente esclude la lezione dal contesto. `invalidateLessons()` la riporta a UNVERIFIED mantenendo storia; un ADR accettato resta ACCEPTED e segnala evidenze stale. InvalidatedWhen descrive le assunzioni da riesaminare: non è un motore NLP automatico.

Conflitti strutturali fra record correnti con lo stesso decisionKey/problemKey e scope sovrapposto producono PROJECT_MEMORY_CONFLICT, senza vincitore automatico. I limiti di contesto sono otto record per ruolo: Scout/Developer 12 KiB e 10.000 caratteri; Reviewer 16 KiB e 12.000 caratteri. La selezione deterministica privilegia memorie vincolanti e identifica le omissioni. Il Reviewer conserva identità/revisioni/digest dei record vincolanti selezionati per il Developer; se sono cambiati o non entrano nei limiti, il dispatch fallisce esplicitamente. Le lezioni possono differire fra ruoli.

Anche senza archivio, ogni dispatch del workflow registra una selezione vuota e la sua ricevuta nello store del task, senza creare il namespace di memoria. I ledger storici già salvati non richiedono ricevute retroattive. La selezione produce un artifact di contesto esatto. I runner lo aggiungono al prompt RPC effettivo. Le MemoryContextReceipt riportano task, ruolo, assignment, request ID, eventuale run ID, record ID/revisione/digest, dimensioni, motivo e timestamp. DISPATCH_INTENT conserva l’intenzione prima dell’invio; PROVIDER_ACKNOWLEDGED attesta che il provider ha riconosciuto quel dispatch. Le ricevute sono artifact immutabili già sincronizzati nello store. I riferimenti entrano nel ledger attraverso la successiva osservazione del run o riconciliazione terminale/di errore, senza un evento del task separato per ciascuna ricevuta. Le ricevute non provano comprensione, conformità del codice o lettura umana. Scout distingue fatti osservati e memoria; il planning ricava aspettative contestuali bounded con riferimenti; il Reviewer valuta divergenze architetturali esplicitamente. Il completion package contiene riferimenti a receipt e proposte, senza l’intero archivio e senza un nuovo completion predicate.

## Proposte, TUI e Obsidian

Scout, Developer e Reviewer possono restituire un sidecar opzionale memoryProposals separato dai contratti normativi dei risultati. Il validator chiuso ammette solo i quattro tipi software e impedisce status/authority autoattribuiti. L’host registra origine e task e conserva soltanto proposte non autorevoli. Il protocollo PreTaskProposalResult resta distinto e non accetta questo sidecar. Un host trusted può usare `propose()` con lo stesso contratto. `/controlled-dev memory` permette di leggere, accettare/attivare, ritirare o sostituire una proposta attraverso il dialogo umano; invocare il comando non è approvazione.

`rebuildHumanView` rigenera anche Architecture, Lessons, Conventions e Constraints; `rebuildProjectMemoryView` permette la rigenerazione separata. Una Base Project Memory filtra per tipo, stato e ambito. Wikilink collegano task/note di evidence realmente disponibili, memorie correlate e sostituzioni. Notes non viene sovrascritta. La modifica manuale del Markdown non entra in alcun caricamento autorevole.

## Compatibilità e confini

Il namespace è opzionale: i task storici non richiedono memoria né nuovi campi nei contratti TaskSpec/AssignmentEnvelope. La state machine resta 11/43; il parent resta read-only, il Developer l’unico writer semantico nella candidata e il Reviewer indipendente. Le ricevute generiche non sostituiscono acceptHumanDecision. Systemist kinds sono ammessi esclusivamente come riferimenti con ownership Systemist: il package non scrive requirement interpretation, System ADR o system evidence assessment. Project Planning, Greenfield e Integration Checkpoints restano fuori scope.

La prova storica può incontrare STORE_COMPLETION_PACKAGE_MISSING su store legacy già incompatibili con la baseline precedente; questo problema preesistente non viene riparato da Project Memory.
