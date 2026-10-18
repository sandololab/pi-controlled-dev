[English](../SOURCE-REFACTORING.md) · **Italiano**

# Progetto corrente e importazione di codice esistente

## Percorso principale

`/controlled-dev` apre o registra il progetto della cartella corrente. Cartelle vuote e codice esistente seguono lo stesso percorso; l’obiettivo è libero. I comandi precedenti `project new`, `project existing`, `project refactor` e `project open` sono alias di questo ingresso. Nessuno richiede una destinazione né precompila un obiettivo di refactoring.

La radice Git prevale sulla sottocartella da cui è avviato Pi. Senza un repository contenitore, un unico repository discendente viene riconosciuto e aperto. Più repository discendenti impediscono la creazione di un progetto padre; si deve avviare Pi nella cartella desiderata. Il percorso canonico identifica un solo progetto nel profilo Pi.

Il primo avvio chiede il risultato desiderato e lo conserva prima dell’analisi. Se Git manca, una conferma trusted `current-project-setup` lega cartella, inventario, identità, esclusioni locali e numero di file alla creazione della baseline locale. I file conservano posizione, byte e modalità. Esclusioni locali in `.git/info/exclude` mantengono fuori cache, impostazioni e percorsi noti di credenziali, anche quando vengono creati successivamente, senza riscrivere `.gitignore`. La cartella vuota è ammessa. Se nome/email mancano, vengono richiesti e configurati soltanto localmente dopo la conferma.

Preparazione e piano sono conservati fuori dal progetto. Un annullamento prima della preparazione conserva l’obiettivo senza inizializzare Git. Un’interruzione dopo l’intento conserva le prove e richiede una verifica; non ripete automaticamente il setup. Git già inizializzato ma senza commit richiede un primo commit preparato dall’utente. Un repository dirty può essere analizzato; formulare un task eseguibile richiede invece sorgenti puliti. File ignorati nella cartella ufficiale restano fuori dal manifest dei sorgenti, mentre le scritture nella candidata continuano a essere controllate integralmente.

Dopo l’approvazione del piano, **Continue the work** seleziona direttamente l’unica attività pronta oppure propone le alternative. La proposta del task riunisce risultato, file, criteri e verifiche, conserva l’obiettivo noto e permette correzioni in linguaggio naturale. Le note tecniche sono consultabili separatamente. Dopo la creazione il percorso supervisionato avvia il normale workflow; autonomia, implementazione, completamento e integrazione conservano le proprie autorizzazioni.

Se manca una configurazione di test adottata, il piano può includerne la preparazione. Proporre nuovi test non dimostra che siano stati eseguiti: le ricette distinguono contenuti esatti, test esistenti osservati e review. Una baseline documentale non certifica equivalenza del comportamento numerico.

## Dialogo, design e memoria

Il progetto aperto accetta una nuova descrizione direttamente nella chat interattiva o tramite `/controlled-dev request <descrizione>`. Domande e risposte necessarie sono revisioni del ProjectGoal; restano legate alle analisi native e riprendono senza richiedere risposte già salvate. La proposta pronta aggiunge ProjectDesign e designIntent/implementationSteps per attività. I record storici privi di questi campi restano leggibili. Una revisione del contesto invalida una bozza precedente; una nuova richiesta lascia corrente il vecchio piano fino all’approvazione della sostituzione.

Le proposte riutilizzabili del design usano ProjectMemoryProposal e il repository di memoria già presente, con deduplicazione alla riapertura. L’adozione mantiene la conferma nativa della memoria e causa una nuova analisi con selezione e ricevute aggiornate. Il design completo passa anche allo snapshot del piano nel TaskSpec; i suoi hint sono suddivisi entro i limiti di testo, senza troncamenti. L’autonomia ricava scope e CommandSpec dalle proposte native per ciascun task e avvia il controller esistente dopo la conferma del piano e della policy.

## Copia separata, solo su richiesta

`/controlled-dev project import` conserva il wizard di importazione esplicita:

1. Indicare origine e destinazione inesistente, con padre presente, separata da sorgenti, profilo e altri repository.
2. Descrivere il risultato desiderato; inserire nome/email locali quando mancanti.
3. Rivedere file, esclusioni, identità e destinazione; confermare la copia e la baseline.
4. Correggere e approvare il piano, quindi proseguire in modalità supervisionata o autonoma.

Un pacchetto Python con `__init__.py` viene copiato in `src/<nome-cartella>`; gli altri sorgenti mantengono il proprio layout. Non vengono generati test, dipendenze o manifesti durante l’importazione. Test e configurazioni esterni alla cartella origine non vengono importati: il piano deve considerarne la preparazione.

## Importazione e autorità

`SourceProject` acquisisce un inventario read-only con hash dei file e modalità Git. Esclude `.git`, `.pi`, `.codex`, `.agents`, `node_modules`, `.venv`, `venv`, `__pycache__`, cache pytest/mypy/ruff e bytecode Python. Rifiuta percorsi ambigui, symlink, hardlink, file speciali e percorsi di credenziali. Limiti: 100.000 voci, 512 MiB totali, 32 MiB per file e profondità 64.

La conferma trusted `source-project-import` lega origine, destinazione, obiettivo e digest dell’intero inventario, oltre alle identità delle directory e all’eventuale nome/email scelti. Questi ultimi sono validati senza scrivere configurazione durante il preflight; vengono configurati con `--local` solo dopo la conferma e l’inizializzazione Git nella destinazione. L’host ricontrolla lo stato dopo la conferma e sotto il lock della destinazione. Conserva byte esatti nel DurableStore, applica l’ispezione già usata per gli altri artefatti e registra l’intento prima di creare file. La namespace separata `source-import` usa lo stesso store immutabile e l’indice atomico; non aggiunge stati al ControlledTask.

La destinazione viene creata esclusivamente e ogni file viene scritto in modalità esclusiva. `CandidateGit.importSourceBaseline` usa il solo executor Git host esistente: template e hook esclusi, niente filtri, nessun remote. Ogni file importato entra nell’indice, anche se una regola di ignore lo nasconderebbe. La baseline è un root commit non vuoto. L’identità usa il percorso canonico come per gli altri progetti esistenti; spostare la cartella non conserva automaticamente l’associazione al piano nel profilo.

Il passaggio dal piano al TaskSpec conserva l’istanza che ha emesso il `PlannedTaskSeed`: riaprire un repository crea una nuova istanza e non trasferisce quella capability. Questo binding si applica anche al bootstrap da zero.

## Interruzioni e limiti

La pianificazione del progetto concede allo Scout fino a dieci minuti; la proposta di un singolo task e il bootstrap conservano il proprio limite di due minuti. Il termine host per ricevere la notifica include quindici secondi aggiuntivi, senza anticipare il timeout del provider. Dopo la notifica, il package interroga brevemente lo stesso run per attendere la prova fisica di chiusura del runner: la pubblicazione del risultato può precedere questa prova. Se la prova resta assente o incoerente, la quarantena resta attiva; nessun timeout equivale a una conferma.

Se l’analisi fallisce prima di produrre una proposta, il progetto e l’obiettivo restano salvati. Un errore del modello `fetch failed` è mostrato come problema di connessione, non come piano malformato. Il pannello offre **Retry analysis** solo dopo aver verificato la terminazione fisica del run precedente, il binding della sessione, i tool read-only e la configurazione delle estensioni. Il nuovo tentativo richiede una scelta esplicita e usa lo stesso obiettivo; non ricrea la copia. In caso di terminazione incerta, la sessione conserva il binding RPC del run precedente: un nuovo `/controlled-dev project plan` ricontrolla la terminazione esatta e l’inventario originale prima di consentire una nuova analisi. Nessuna notifica logica, attesa o risposta parziale sblocca il run. Il risultato interrotto viene scartato. Se mancano ancora prove fisiche valide, il nuovo tentativo resta bloccato. I dettagli tecnici conservano codice RPC, run, sessione e stato della verifica, senza riportare il contenuto del provider.

Per riprendere dopo essere usciti dal pannello, usare `/controlled-dev project plan` nel progetto selezionato; dopo un reload usare `/controlled-dev` dalla cartella di lavoro o dalla cartella superiore che contiene quel solo repository. Il parent resta in sola lettura anche dopo un errore: le notifiche non autorizzano `subagents_enable` né l’esecuzione diretta del lavoro al di fuori del package.

Per recuperare un blocco di una versione precedente, controllare il run indicato nei dettagli con `/subagents-fleet` e arrestarlo se ancora attivo. Dopo la conferma della terminazione, usare `/reload` e `/controlled-dev` dalla cartella già creata. L’obiettivo è conservato nello store del progetto. Non ripetere l’importazione e non usare il recupero di un task: prima della proposta e della formulazione non esiste ancora un TaskSpec.

`/subagents-doctor` controlla disponibilità del runtime, directory, capacità e bridge; non effettua una richiesta al servizio del modello. Zero run attivi e directory sane non dimostrano che la connessione del processo figlio funzioni. `chain-runs` mancante, in un’analisi singola, non identifica la causa di `fetch failed`. Il log della sessione dello Scout resta la fonte per diagnosticare il fallimento del modello; se anche una normale risposta di Pi fallisce, controllare la connessione del parent, altrimenti confrontare il runtime e la configurazione di rete del figlio. Un retry dell’analisi non risolve da solo un errore persistente di connessione.

L’importazione non ha un motore di replay automatico. Se esiste un intento precedente, una nuova importazione verso la stessa destinazione viene rifiutata. Copia ed evidenze restano disponibili per verifica manuale; nessun reset, cancellazione o sovrascrittura è eseguito. Se Git e la baseline sono già completi, `/controlled-dev` può riprendere la pianificazione dalla cartella importata. L’apertura non certifica né riscrive un intento d’importazione incompleto.

Una sola conferma di creazione non approva il piano, la policy, il TaskSpec o i risultati. Esecuzione e integrazione continuano attraverso le autorità già esistenti. Il percorso supervisionato avvia la singola attività scelta; la sequenza autonoma completa richiede una policy esplicita.

Le fixture automatiche usano Git reale e il runtime Scout verificato con provider/UI doubles dichiarati. Verificano importazione, byte e modalità, esclusioni, cancellation, binding, staleness, interruzioni e passaggio alla formulazione nativa del TaskSpec. Il protocollo produttivo richiede anche design, chiarimenti, proposte di memoria e passi per task: le risposte delle fixture rispettano questi stessi campi. Prove negative rifiutano risposte live incomplete, mentre i record storici conservano compatibilità. Non certificano una prova personale del wizard o il refactoring con modelli reali.

Le verifiche del dialogo coprono ripresa dei soli chiarimenti rimasti, nuove richieste naturali nel progetto aperto, revisione concorrente del contesto, trasmissione completa del design, proposte native di memoria senza duplicati e rilettura dopo l’adozione. L’autonomia verifica limiti distinti per task, creazione automatica di un TaskSpec reale con una sola conferma iniziale, annullamento e scope aggiuntivo senza avvio, ordine delle dipendenze e controlli finali senza contenuti intermedi superati. Le regressioni Project Memory includono le ricevute dei ruoli nel normale workflow; lo scenario di instrumentazione esegue davvero il programma prima e dopo la correzione nella candidata.

La verifica del nuovo ingresso include cartella vuota, codice esistente mantenuto sul posto, riapertura del progetto e di un task preparato, identità Git locale mancante, repository discendenti ambigui, modifiche concorrenti durante la conferma, cache successive e integrazione Git reale con file locali ignorati conservati. Pianificazione e Reviewer sono verificati separatamente, comprese correzioni naturali, sorgenti dirty in sola lettura e nuove directory autorizzate. La suite completa è stata interrotta dopo oltre cinque minuti sulla prova di promozione della candidata: non è dichiarata superata. La pianificazione riuscita con un servizio di modello reale resta da verificare.

`npm run test:pi-integration` esegue una verifica separata con Pi e pi-subagents installati. Richiede `PI_TEST_HOST_ROOT` e `PI_TEST_SUBAGENTS_ROOT`, i percorsi delle rispettive cartelle del package. Usa un profilo temporaneo, un’interfaccia senza terminale e un endpoint locale volutamente irraggiungibile; trasporto RPC e runtime sono quelli installati. Verifica il boundary del parent nel suo hook nativo e richiede che il fallimento del figlio venga diagnosticato dopo una terminazione fisica verificata. Dipendenze incompatibili producono un fallimento visibile, non un test saltato o una certificazione simulata. Anche questa verifica non certifica una pianificazione riuscita con il servizio del modello reale.
