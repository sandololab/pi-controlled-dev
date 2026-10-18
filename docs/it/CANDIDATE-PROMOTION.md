[English](../CANDIDATE-PROMOTION.md) · **Italiano**

# Candidate Promotion / Git Integration

La baseline usa già worktree Git detached esterni al progetto. ScopeGuard confronta commit base, indice, file tracciati e manifest, include file nuovi/binary/mode e vieta percorsi protetti, alias e modifiche fuori scope. La candidate resta al commit base durante le generazioni. Il rework prepara un worktree detached del risultato precedente e ricompone i cambiamenti cumulativi nella candidate originale. Reviewer e validazioni sono legati a digest e generazione; recovery riattacca soltanto byte e prove persistiti. Il CompletionPackage chiuso conserva questo significato.

I nuovi task aggiungono un binding project-level e una branch stabile in un worktree esterno. Developer conserva read/edit/write; parent e Reviewer restano read-only. Task senza binding restano caricabili e recuperabili, senza migrazione implicita. Non sono inizializzati repository vuoti. I record nuovi conservano identità, ref e commit, senza path assoluti di worktree come autorità.

L’identità dei commit viene dalla configurazione Git disponibile, senza configurarla o impersonare una persona. Primitive host costruiscono argv validati e disabilitano hook, firma e autostash senza modificare configurazione permanente. Filter/merge driver esterni sono rifiutati. Non sono invocati comandi remoti. Branch e worktree sono conservati per audit e recovery; non viene introdotta una skill perché la capability è infrastruttura host.

COMPLETED significa candidate verificata. Il commit candidato congela il risultato senza aggiornare la target. Un worktree detached dall’HEAD corrente prepara un merge esplicito con due genitori. Conflitti o validazioni fallite conservano evidenza e lasciano invariata la destinazione. La proposta lega HEAD, candidate, commit/albero d’integrazione, riepilogo, validazioni e review; la conferma riusa il boundary trusted. Rifiuto e annullamento non fanno fallire il task.

Un intent durevole precede ref CAS e aggiornamento verificato di indice/worktree sotto lock dell’indice Git. Recovery verifica intent, receipt, commit, ref, indice e byte prima di completare la stessa operazione. Ambiguità restano bloccate: niente hard reset, rollback, stash o risoluzione automatica. Il merge non viene ricalcolato dopo l’approvazione.

La cartella originale resta il progetto ufficiale. Project Planning distingue esecuzione e integrazione: nuovi predecessori richiedono il commit candidato nella storia della target. No-op non richiedono merge artificiale; cherry-pick/somiglianza dei byte non provano identità. I task storici mantengono il controllo della baseline precedente.

Le prove usano Git e processi reali; eventuali provider/UI double sono dichiarati. Nessuna modifica agli 11 stati/43 transizioni o al CompletionPackage. Integration Checkpoints, Greenfield, remoti e Systemist restano fuori scope.

Se targetHead differisce da B0, la review del task non dimostra l'interazione con codice aggiunto alla destinazione: il medesimo controlled.reviewer riceve un packet exact del merge, criteri e nuove evidenze, con context fresh, read-only, output chiuso e prova terminale/transcript/canary. Non viene creato un IntegrationReviewer. Se HEAD e tree coincidono con la candidata, la review terminale verificata viene riusata.

Limiti conservativi: ref locali nel profilo ASCII validato; repository senza driver esterni e con checkout byte-exact. Workspace dirty (anche ignorati), branch diversa o operazioni Git in corso richiedono intervento esplicito. Un intent stale o un aggiornamento parziale non dimostrabile resta bloccato, senza approvazione inventata o riparazione dei file. La riconciliazione dell'indice è ammessa solo quando tutti i byte coincidono con il tree completo autorizzato. I lock workspace serializzano anche target differenti dello stesso progetto, un limite più forte del minimo project+targetRef. Un no-op riusa B0 e non richiede identity per creare un commit inesistente. Nessuna pulizia automatica: prove/worktree/branch vengono conservati localmente.

La policy host comune copre anche il worktree tecnico di rework: hook e firma restano disabilitati e le nuove branch task usano l'identità Git configurata anche per quel commit temporaneo. Solo il rework detached storico conserva l'identità tecnica sintetica esplicita preesistente; non diventa un commit candidate/integration retroattivo. Una candidata non congelata resta NOT_READY nella proiezione Git; l'azione verifica separatamente il ledger COMPLETED prima di preparare l'integrazione.
