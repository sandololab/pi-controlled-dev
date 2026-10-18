---
title: "pi-controlled-dev"
subtitle: "Manuale utente — versione 0.1.0-beta.2"
lang: it-IT
toc-title: Indice
---

[English](../../USER-MANUAL.md) · **Italiano**

La TUI e i prompt inclusi sono in inglese; i nomi dei pulsanti riportati qui corrispondono alle etichette inglesi a schermo. I testi forniti dall’utente e le evidenze storiche mantengono la lingua originale.


# Che cos'è pi-controlled-dev

pi-controlled-dev è un package per Pi Coding Agent. Ti permette di affidare un lavoro di sviluppo a ruoli distinti, con confini espliciti, verifiche del risultato e conferme richieste a te.

Questo manuale descrive la versione **0.1.0-beta.2**. È una versione preliminare: alcuni problemi richiedono un intervento dell'operatore invece di una ripresa automatica.

# Stato effettivo di questa beta

**Disponibile:** menu generale, creazione di nuovi progetti con baseline tecnica vuota, wizard navigabile in cinque passaggi, Scout pre-task read-only, proposta di verifiche senza codice manuale, riepilogo modificabile, viste separate per stato, attività, verifiche e dettagli, recovery spiegata, Project Memory cross-task, Project Planning con dipendenze e revisioni approvate, integrazione Git locale approvata dall’utente, verifica dell’integrazione su commit esatti, conferme nel pannello di Pi e Autonomia controllata entro una policy esplicitamente approvata.

**Verifica del prototipo:** oltre ai test automatici, P17 ha completato un task documentale in un repository Git pulito con Pi, pi-subagents, Scout, Developer e Reviewer reali, due verifiche host superate e conferme native date da una persona. La modifica è rimasta nella copia candidata; l’originale è rimasto invariato. È una prova di questo percorso, non di ogni possibile task o ambiente. La regressione `RESULT_SCHEMA_INVALID` sui criteri REVIEW resta coperta dai test positivi e negativi.

Il sistema propone, l’utente corregge e autorizza. La TUI non decide scope, validation, completion, recovery o gate umani.

# Quante volte devo intervenire?

Puoi scegliere **Supervised mode**, con conferme nei normali punti di controllo, oppure **Controlled autonomy**. Questa seconda modalità viene attivata soltanto con una tua scelta esplicita e una conferma del piano insieme ai suoi limiti.

In Autonomia controllata, dopo aver approvato il piano pi-controlled-dev può sviluppare, verificare, correggere entro i budget e integrare progressivamente i task previsti senza richiedere una conferma ad ogni passaggio. Restano Scout, protezioni dei percorsi, test e review indipendente. Al termine viene eseguita la verifica finale della baseline integrata.

Non ti interrompe per test normali, rework consentito, review positiva o integrazione già prevista. Ti interrompe per un cambio architetturale o del piano, scope aggiuntivo, conflitto Git, nuova dipendenza inattesa, rischio irrisolto, budget esaurito, modifiche esterne inattese o processi di cui non può provare la fine. La schermata spiega quanto è già stato integrato, perché si è fermato e quale decisione serve.

## Come autorizzare il piano

Nel menu Piano del progetto, dopo aver letto o corretto la proposta, scegli la modalità. In Autonomia controllata il package prepara file e cartelle ammessi e verifiche dalle proposte degli Scout, usando il repository corrente. Puoi correggere il piano prima di autorizzarlo. Leggi il riepilogo: attività ammesse, branch, limiti e condizioni di stop. Una conferma nativa approva gli esatti piano e policy con prove distinte. Non viene attribuita a te una nuova conferma per ogni candidata futura.

I criteri dei task autonomi devono restare quelli del piano e i comandi quelli autorizzati. Se lo Scout deve proporre una variazione non dimostrabile dentro i limiti, il sistema si ferma. La v1 esegue un solo task per volta nell'ordine approvato. I file protetti e i confini fissi restano protetti.

## Seguire, mettere in pausa e riprendere

La vista Sviluppo automatico mostra attività completate, in corso e attese. P richiede pausa al prossimo confine sicuro; D mostra dettagli; Esc nasconde il pannello e lascia proseguire il lavoro. Non occorre restare davanti alla TUI finché non serve una decisione.

Sono disponibili anche `/controlled-dev project pause`, `resume`, `revoke`, `cancel` e `autonomy`. La pausa conserva il task e l'audit; la ripresa non richiede di approvare tutto se piano, policy e baseline sono ancora validi. La revoca impedisce nuove azioni automatiche. Una modifica esterna o un nuovo binding richiede una nuova approvazione. Nessuna pulizia delle modifiche dell'utente avviene automaticamente.

Per un progetto nuovo autorizzi prima il bootstrap e le decisioni iniziali, poi il piano con autonomia. Il bootstrap non scrive codice applicativo: questo continua a passare dai ControlledTask. Per un progetto esistente parti dal piano. A conclusione il riepilogo indica attività integrate, verifica finale e cartella del progetto: non è una certificazione di tutto il software.

## Limiti della prima versione

Il controllo di nuove dipendenze legge le sezioni dependency di package.json: nomi/versioni devono essere esplicitamente previsti. Cambi a lockfile o manifesti di altri ecosistemi richiedono una decisione; non esiste un parser universale delle dipendenze. Le nuove decisioni vincolanti della memoria restano umane. Le lesson possono essere proposte come UNVERIFIED.

Project.md, Piano corrente e Attività di autonomia mostrano progresso e interruzioni senza note per ogni micro-azione. Le note sono viste: modificarle non cambia autorizzazioni o risultati. Le azioni autonome restano collegate alla policy realmente approvata, mentre le conferme dirette conservano la propria origine.

# A cosa serve

Puoi usarlo sia per modifiche circoscritte, come aggiornare un documento o correggere un problema, sia per una feature articolata o un’iniziativa software più ampia. In questo secondo caso il lavoro viene suddiviso in attività pianificate; ciascuna passa poi attraverso il normale workflow di sviluppo, verifica e conferma.

Non è un comando per applicare automaticamente qualunque suggerimento al tuo repository. Il risultato viene preparato e verificato in una directory separata.

# Come funziona in breve

```text
Tu descrivi il lavoro
              |
              v
Scout pre-task propone scope, criteri e verifiche
              |
              v
Correggi e confermi la creazione del task
              |
              v
Scout analizza il progetto
              |
              v
Confermi l'inizio dell'implementazione
              |
              v
Developer lavora su una copia isolata
              |
              v
Il package controlla percorsi e verifiche
              |
              v
Reviewer controlla indipendentemente il risultato
              |
              v
Confermi il completamento, se tutte le condizioni passano
              |
              v
COMPLETED: risultato verificato nella copia candidata
```

In caso di dubbi, errori o prove insufficienti, il percorso si ferma. Una consulenza Oracle o una correzione possono essere richieste nei casi previsti, ma non autorizzano a ignorare i confini concordati.

Prima delle modifiche, il package esegue sulla copia di lavoro le verifiche approvate già disponibili e ne consegna al Developer il commit effettivo e gli esiti osservati. L’agente legge queste prove senza dichiarare di aver eseguito i comandi. Se un controllo iniziale fallisce, lo sviluppo non parte. I test o la configurazione da creare nell’attività vengono indicati come rinviati, senza attribuire loro un PASS. Dopo le modifiche, i controlli vengono sempre eseguiti di nuovo: le prove iniziali non sostituiscono quelle della candidata finale.

Se il Developer si ferma con una consegna completa che segnala un problema, ma senza modifiche o comandi, puoi riprendere la stessa attività soltanto dopo che il package ha verificato le prove e le copie invariate e ti ha chiesto una nuova conferma. Il dialogo spiega il problema e il ruolo delle verifiche eseguite dal package. La storia e i tentativi già usati restano conteggiati; queste riprese rispettano il limite `maxReworkAttempts` e il limite totale degli avvii. Non vengono classificate come errori di connessione e non consumano né azzerano il budget separato delle ripetizioni per guasti di infrastruttura.

**COMPLETED non significa che il progetto originale sia stato modificato.**

## Come viene considerata la qualità del codice

Prima di proporre il cambiamento, lo Scout individua la struttura pertinente del progetto: moduli e responsabilità, confini, componenti riutilizzabili, convenzioni e strumenti di qualità già configurati. Da questi fatti ricava aspettative progettuali specifiche per il task, visibili nel riepilogo prima della creazione.

Il Developer cerca prima di riutilizzare, estendere, comporre o parametrizzare ciò che esiste. OOP, interfacce e design pattern sono usati soltanto quando chiariscono un problema reale nel linguaggio e nel repository corrente. Una modifica diretta e coerente resta preferibile a una gerarchia o a un framework artificiale. Allo stesso tempo, logica, invarianti, validazioni e trasformazioni realmente comuni non devono essere duplicate.

Nomi, responsabilità ed effetti collaterali devono restare comprensibili. La logica non ovvia, come recovery, concorrenza, lock, retry o comportamento fail-closed, viene documentata spiegando ragioni, assunzioni, invarianti e casi limite senza commentare banalmente ogni riga. Il Reviewer controlla anche riuso, duplicazione, complessità, documentazione, dead code e overengineering. Non blocca il task per preferenze estetiche o differenze di formattazione che il formatter o il linter del progetto già governano.

# Project Memory: decisioni ed esperienze fra task

La memoria del task spiega un singolo lavoro: obiettivo, candidata, verifiche, review e decisioni richieste durante il suo svolgimento. La memoria del progetto conserva invece conoscenze tecniche che possono restare utili quando quel task è terminato e ne comincia un altro. Non è una roadmap e non organizza dipendenze o milestone.

Immagina che un primo task stabilisca di usare il repository di persistenza già presente invece di accedere direttamente ai file. In un task successivo sullo stesso componente, lo Scout può ricevere quella decisione insieme ai fatti osservati nel codice; la proposta di lavoro ne ricava un’aspettativa progettuale breve. Il Developer conosce il confine da rispettare e il Reviewer ne valuta la coerenza indipendentemente. Il sistema conserva una ricevuta del contesto fornito a ciascun dispatch, con le versioni esatte della memoria.

## Le quattro forme della memoria

Una **Software Architecture Decision**, o Software ADR, racconta una scelta architetturale software: il problema iniziale, la decisione presa, le ragioni, le alternative considerate e le conseguenze. Specifica dove si applica e conserva le evidenze e i task collegati. Una proposta è **PROPOSED**: si può leggere e discutere, ma non è ancora una decisione corrente. Diventa **ACCEPTED** soltanto dopo una conferma umana esplicita. Se una decisione successiva la sostituisce, resta nella storia come **SUPERSEDED**, collegata al sostituto. Se non è più applicabile, può diventare **DEPRECATED** senza richiedere una nuova decisione sostitutiva.

Una **Technical Lesson** racconta un’esperienza reale: problema incontrato, causa, lezione appresa, condizioni in cui il consiglio è utile e condizioni che richiedono di riesaminarlo. Nasce **UNVERIFIED** perché un singolo risultato positivo non dimostra che il consiglio sia corretto in ogni situazione. Prima di attivarla, la persona deve valutarne pertinenza, ambito, evidenze e condizioni di utilizzo. Solo una conferma separata la rende **ACTIVE**. Rimane un consiglio tecnico, non un’autorizzazione e non un vincolo implicito. Una lezione superata può essere ritirata o sostituita mantenendone la storia.

Una **Project Convention** descrive una pratica del progetto: per esempio come si nominano i metodi, come si organizzano i moduli o come si gestiscono gli errori. Quando la pratica è già espressa interamente da una configurazione corrente, la memoria preferisce un riferimento a quella fonte invece di copiarne tutte le regole.

Un **Technical Constraint** spiega un limite persistente del software: compatibilità, piattaforma, dipendenze o un confine protetto da mantenere. Le conseguenze devono essere comprensibili per chi prepara e controlla la modifica. Non rappresenta un requirement di sistema né una decisione architetturale Systemist.

## Come leggere e decidere

Apri `/controlled-dev memory`, oppure scegli **Project memory** nel menu. Puoi leggere significato, stato, ambito ed evidenze prima di prendere una decisione. I ruoli possono proporre memorie strutturate durante i task, ma non possono accettarle o attivarle. Anche un host trusted può raccogliere una proposta con lo stesso contratto.

Per una proposta disponibile puoi scegliere l’accettazione o l’attivazione, oppure decidere di non adottarla. Per una memoria corrente puoi registrarne il ritiro. Una nuova proposta può sostituire una memoria corrente: il dialogo presenta entrambe le modifiche e la storia resta collegata. Ogni cambiamento di questo tipo richiede il pannello umano di conferma. Se scegli No o annulli, nessuna decisione viene registrata.

La conferma della memoria è distinta dalla creazione del task, dall’approvazione dell’implementazione e dal completamento. Non modifica candidata o scope. Una decisione project-level separata richiede che il workspace sia libero; se un task ne detiene i lock, termina o recupera quel task attraverso il percorso previsto prima di cambiare la memoria. Non cancellare manualmente i lock o i dati dello store.

## Quali memorie vengono usate

L’host seleziona soltanto memorie correnti e pertinenti all’ambito e ai file del task. Per una lezione controlla anche le condizioni esplicite di caricamento e le evidenze. I limiti sono otto record per ruolo: Scout e Developer ricevono al massimo 12 KiB e 10.000 caratteri; Reviewer al massimo 16 KiB e 12.000 caratteri. Il testo effettivo può includere meno record quando sono più estesi. Le omissioni vengono indicate e un conflitto fra decisioni dello stesso tema non viene risolto scegliendo automaticamente una delle due.

Il Reviewer riceve le stesse identità, revisioni e digest delle decisioni, convenzioni e vincoli selezionati per il Developer. Se quella base è cambiata, serve una nuova valutazione: il sistema non la sostituisce silenziosamente. Le lezioni pertinenti possono differire fra ruoli.

Quando un’evidenza collegata manca o ha un digest diverso, una lezione non viene usata come consiglio valido. L’host può riportarla a UNVERIFIED per richiedere una nuova valutazione. Per un ADR accettato, invece, il problema dell’evidenza viene segnalato senza revocare automaticamente la decisione. Le condizioni di invalidazione descritte dalla lezione richiedono anche giudizio umano: il package non interpreta semanticamente qualsiasi cambiamento del progetto.

## Vedere che cosa ha influenzato un task

La nota del task collega le memorie effettivamente fornite ai ruoli. Le ricevute strutturate conservano record, revisione, digest, motivo di selezione, dimensione e identità del dispatch. Distinguono l’intenzione di inviare il contesto dal riconoscimento del dispatch da parte del provider. Non dimostrano che il modello abbia compreso o rispettato ogni consiglio: la verifica della candidata e la review indipendente restano necessarie.

Nel repository Obsidian trovi **Architecture**, **Lessons**, **Conventions** e **Constraints**, insieme alla vista **Project Memory** negli indici. I collegamenti portano ai task, alle prove disponibili e alle memorie precedenti o sostitutive. Le note spiegano la storia e il significato prima dei dettagli tecnici.

I record JSON nello store sono la fonte autorevole. Scrivere ACCEPTED nel frontmatter di una nota non accetta una proposta; modificare una lezione Markdown non la attiva e non cambia un task. La rigenerazione ricostruisce le note dai record e conserva **Notes**, dove puoi scrivere osservazioni personali senza attribuire loro autorità operativa.

# Dal progetto alle attività controllate

Un **progetto** raccoglie un obiettivo software ampio. Un **piano** descrive le attività necessarie e il loro ordine. Un’**attività pianificata** racconta ciò che intendiamo ottenere, perché serve, quale ambito coinvolge e come pensiamo di verificarla. Un **task controllato** è invece l’unità concreta di lavoro: ha file autorizzati, criteri e verifiche definiti sul repository corrente, e segue il workflow già descritto.

Una **dipendenza** indica che un’attività deve attendere il completamento di un’altra. La **Project Memory** conserva decisioni e conoscenza che guidano queste scelte tra task diversi; non duplica il piano e non esegue il lavoro.

## Preparare e correggere il piano

Con il progetto aperto puoi scrivere direttamente nella chat ciò che vuoi ottenere, oppure usare `/controlled-dev request <descrizione>` o **New request**. Lo Scout usa sorgenti e memoria già disponibili e chiede chiarimenti soltanto quando cambiano il risultato, l’architettura o la compatibilità. Non devi compilare elenchi di file o ricostruire configurazioni che può leggere.

Le risposte vengono salvate immediatamente. Se interrompi il dialogo, `/controlled-dev` riprende dai chiarimenti rimasti. Il piano arriva quando il contesto è sufficiente e contiene design, motivazioni delle decisioni, componenti e interfacce, flussi dei dati, compatibilità, strategia di verifica, rischi e passi di implementazione per ciascun task. Il design completo accompagna il TaskSpec utilizzato dagli agenti.

Le decisioni tecniche riutilizzabili vengono proposte nella **Project Memory già esistente**. Da **Design memory** puoi adottarle, ritirarle o sostituire una decisione precedente attraverso i normali controlli della memoria. Dopo una modifica il package rilegge la memoria corrente e prepara una nuova proposta del piano. La conferma del piano, da sola, lascia le memorie proposte nello stato di proposta.

Apri `/controlled-dev project` oppure scegli **Project and next steps** nel menu avanzato. Con `/controlled-dev project plan` entri direttamente nella preparazione o nella correzione. Descrivi il risultato ampio: per esempio, aggiungere sincronizzazione locale a una piccola applicazione. Lo Scout legge il repository e la memoria pertinente, senza chiederti di riscrivere architettura, componenti o test che può osservare.

La proposta può separare protocollo, discovery dei peer, trasferimento, gestione dei conflitti, interfaccia e verifica end-to-end. Ogni attività deve spiegare un incremento reale e verificabile. La decomposizione privilegia comportamenti completi quando è utile, ma ammette fondamenta infrastrutturali se sono prerequisiti motivati. Non deve ridursi a un task gigantesco o a una lista artificiale di file e metodi.

Leggi il riepilogo e correggilo in linguaggio naturale: “unisci questi due task”, “questa parte deve venire prima”, “non modificare il modulo X”, “separa la UI dal protocollo”. La correzione produce una nuova bozza. Puoi tornare indietro conservando la proposta senza renderla operativa.

L’approvazione presenta obiettivo, strategia, attività, criteri previsti, dipendenze motivate e memorie collegate. La conferma riguarda quella revisione e quel contenuto esatti. No o annullamento lasciano il piano non approvato. L’invocazione di un comando o una risposta del modello non sostituiscono il dialogo umano.

## Revisioni e nuove scoperte

Una bozza è **DRAFT**. Dopo la conferma il piano è **APPROVED** e il suo contenuto non cambia. Una nuova scoperta, un vincolo o un blocco possono motivare una revisione, che riparte come bozza. Il piano precedente diventa **SUPERSEDED** soltanto quando approvi la sostituzione. Tutta la storia, incluse attività rimosse ed esecuzioni già avvenute, resta disponibile.

Un fallimento non cancella o riordina automaticamente il piano. Se le decisioni nella memoria sono in conflitto, la preparazione o l’approvazione si ferma per una risoluzione esplicita. Il sistema non sceglie silenziosamente una decisione da seguire.

## Scegliere il prossimo lavoro

`/controlled-dev project status` mostra la revisione corrente, il numero di attività, gli esiti e le alternative pronte. **WAITING** significa che manca un prerequisito; **READY** indica che le dipendenze sono soddisfatte e si può proporre la formulazione; **ACTIVE** indica un task collegato ancora in corso oppure un TaskSpec preparato; **COMPLETED**, **BLOCKED** e **FAILED** riflettono lo stato del vero task controllato.

Se una prossima attività è troppo ampia, scegli **Break down the work** oppure
`/controlled-dev project refine`. Scegli un’attività non ancora avviata: lo Scout
propone soltanto uno, due o tre incrementi al suo posto. Il package conserva
design e altre attività, aggiorna le dipendenze e mostra il piano completo da
confermare. Non avvia il Developer o scritture parallele. Se l’attività
contiene un residuo ampio, questo resta **da suddividere** e non può essere avviato
come un unico incarico. Se l’attività
o i suoi successori sono già collegati a un’esecuzione, usa la revisione ordinaria
del piano: il percorso di suddivisione non modifica quei collegamenti.
Le dimensioni dei sorgenti aiutano a stimare il lavoro; non sostituiscono la lettura.

Una proposta di verifica **CANDIDATE_TEST** può eseguire anche test Python preparati
dal task corrente. Leggi configurazione e file indicati prima di creare il task:
la ricetta del package esegue quei file nella copia candidata, senza cache o bytecode
e senza caricamento automatico dei plugin pytest o opzioni aggiuntive. I plugin
dichiarati nelle fixture restano possibili. File mancanti, raccolta vuota o tutti
i test saltati non sono un PASS;
le modifiche prodotte dalla verifica non vengono ignorate. Le ricette dei task
già salvati restano invariate.

Dopo un arresto, verifica prima la chiusura dei processi con i controlli di recupero.
Puoi poi usare **Close blocked attempt** o `/controlled-dev close-attempt`:
la conferma registra FAILED e conserva copie candidate, log e contatori. Nessun
file parziale viene integrato. L’obiettivo del progetto resta disponibile per
preparare una proposta più piccola. Un Developer terminato con risultato già
accettato o una candidata già registrata richiedono il proprio percorso di recupero.

Per i nuovi task una dipendenza richiede COMPLETED e un risultato disponibile nella baseline: il commit candidato deve essere nella storia della destinazione, oppure il task deve essere un no-op verificabile. Un predecessore ancora in review o in attesa della persona non basta. Se è bloccato o fallito, la vista spiega quale risultato manca. Se due attività sono pronte, scegli esplicitamente quale formulare: il package non le esegue automaticamente in parallelo.

Scegli **Continue the work** nella vista progetto. La proposta compatta conserva obiettivo e intenzioni del piano. Lo Scout riesamina il repository corrente, perché file, test e architettura potrebbero essere cambiati. Scope concreto e verifiche possono quindi essere corretti prima della creazione. L’approvazione del piano non approva quel TaskSpec: conferma della creazione, implementazione, ampliamenti e completamento rimangono separati.

Dopo la scelta del prossimo lavoro, la preparazione mostra subito l’obiettivo e il motivo conservati nel piano. Lo Scout legge i file e prepara una proposta: questo passaggio non modifica il codice e non crea ancora l’attività.

Il collegamento al task reale viene salvato fuori dal TaskSpec. Le richieste concorrenti sulla stessa identità vengono rifiutate. Questa prima versione collega una sola esecuzione per identità; retry e rework interni rimangono nel task controllato. Dopo un fallimento puoi proporre e approvare una nuova attività. Un’interruzione tra il collegamento e il salvataggio del TaskSpec conserva una prenotazione prudente, visibile come preparazione da verificare; non autorizza un secondo avvio automatico.

## Un prerequisito completato può ancora mancare nella baseline

La conclusione del task certifica la copia candidata. Per i nuovi task, un successore resta WAITING finché il commit del predecessore non è presente nella storia della branch target. Dopo un’integrazione approvata diventa READY, se gli altri prerequisiti sono soddisfatti. Deve comunque passare il normale Scout pre-task e i controlli del TaskSpec e del workflow. In modalità supervisionata usi il wizard e le conferme individuali; in Autonomia controllata la policy può autorizzare questi passaggi entro i limiti approvati.

Per i task storici privi di binding Git viene preservato il precedente controllo della baseline. Queste candidate restano consultabili e recuperabili ma non possono essere promosse automaticamente. Somiglianza dei file o cherry-pick non dimostrano l’integrazione del nuovo commit candidato; un merge manuale che lo rende antenato della target è invece riconoscibile.


## Leggere il progetto in Markdown o Obsidian

**Project.md** spiega l’obiettivo, il piano corrente, le attività completate/pronte/bloccate e i prossimi passi. **Planning/Current Plan.md** racconta strategia e lavoro previsto. **Plan History** conserva le revisioni. Le note **Planned Tasks** distinguono attività pianificate e task effettivamente collegati, con motivazione delle dipendenze e riferimenti alla memoria. Una sola Base negli indici permette di filtrare stato, dipendenze, task collegati e revisione.

Il piano Markdown mostra in apertura la situazione corrente e la data di aggiornamento. Il corpo della proposta approvata conserva la propria data e le osservazioni fatte allora; non sostituisce l’avanzamento ricavato dalle attività. La scheda di un task distingue cosa fare, motivazione disponibile, passi pianificati, risultato atteso e verifiche. I passi previsti non sono una dichiarazione di lavoro già eseguito.

Durante un’attività usa **Alt+P** per consultare il piano e **Alt+S** per lo stato. Pi può accodare un normale comando mentre attende il completamento di un altro comando: dall’editor le scorciatoie native aprono la consultazione senza attendere quel ciclo.

Nel pannello **Prepare the work**, mentre lo Scout prepara la proposta, **Alt+P** apre una lettura interna del piano. Usa Tab o le frecce laterali per scegliere un punto, Invio per i dettagli e le frecce verticali per scorrere. Esc dai dettagli torna all’elenco; Esc dall’elenco torna all’attesa senza annullare il lavoro. Se la proposta arriva mentre stai leggendo, resta pronta fino a quando chiudi la lettura. Esc nella schermata d’attesa, invece, annulla la preparazione.

Le altre finestre mantengono il proprio controllo dei tasti: chiudi il pannello per tornare alle scorciatoie dell’editor. Una consultazione non sostituisce una conferma. Per modificare il piano attendi il prossimo punto sicuro.

I record strutturati restano autorevoli. Cambiare una dipendenza in Current Plan.md non cambia il DAG, approva un piano o crea un task. La rigenerazione ricostruisce pianificazione, memoria e viste dei task; le annotazioni personali in **Notes** restano conservate. Puoi usare `/controlled-dev rebuild-view` anche prima di eseguire il primo task del progetto.

La pianificazione è facoltativa: `/controlled-dev new` continua a funzionare per un singolo task, anche senza piano o memoria. Una cartella vuota viene preparata dallo stesso `/controlled-dev`. La pianificazione Systemist resta fuori scope.

# Aprire o creare il progetto corrente

Avvia Pi nella cartella del progetto e usa `/controlled-dev`. Il package riapre il progetto salvato; se manca, lo registra nella stessa cartella. Non devi scegliere un nome, una destinazione o se il codice esistente debba essere rifattorizzato. Ogni cartella identifica un solo progetto.

Da una sottocartella Git viene riconosciuta la radice del repository. Da una cartella che contiene un solo repository discendente viene aperto quel repository. Se ne contiene più di uno, avvia Pi nella cartella desiderata: il package non crea un progetto che li inglobi.

## Il primo avvio

Descrivi il risultato desiderato: nuove funzionalità, completamento del programma, correzione, integrazione o refactoring. Puoi includere preferenze e vincoli nella stessa richiesta. Il package conserva l’obiettivo prima di avviare lo Scout.

Se Git manca, una conferma mostra cartella, quantità di file ed esclusioni della prima baseline locale. I file mantengono posizione e contenuto; in una cartella vuota la baseline è vuota. Cache, impostazioni locali e percorsi noti di credenziali sono esclusi tramite configurazione locale Git. Il package non genera codice applicativo durante questa preparazione.

Nome ed email per i commit vengono richiesti se mancanti e salvati soltanto localmente dopo la conferma. Annullare conserva l’obiettivo senza inizializzare Git. Un repository Git già presente ma senza commit richiede la preparazione del primo commit da parte tua.

## Piano e sviluppo

Lo Scout analizza il progetto e propone il piano. Puoi correggerlo in linguaggio naturale. Dopo l’approvazione, **Continue the work** porta all’unica attività pronta oppure permette di scegliere fra le alternative. La proposta del task conserva l’obiettivo e mostra insieme risultato, file modificabili, criteri e verifiche; dettagli e note sono consultabili separatamente.

**Create the task** conferma la proposta e porta al workflow supervisionato. Restano le autorizzazioni di implementazione e completamento. In **Controlled autonomy** gli Scout preparano i limiti della sequenza: li rivedi insieme al piano e, dopo la conferma, lo sviluppo parte automaticamente. Il percorso riusa agenti, skill, memoria, scenari, instrumentazione e review del package, secondo le necessità del lavoro. I Developer lavorano in aree isolate; l’integrazione approvata rende il risultato disponibile nella cartella ufficiale.

`/controlled-dev` riapre anche un’attività già preparata o interrotta, mostrando il lavoro salvato prima di proporne uno nuovo. `/controlled-dev project plan` richiede una nuova analisi o revisione; `/controlled-dev menu` espone i controlli avanzati. Gli alias `project new`, `project existing`, `project refactor` e `project open` riconoscono anch’essi la cartella corrente.

## Conservare il lavoro esistente

Puoi aprire e pianificare un repository con modifiche locali. L’avvio dello sviluppo richiede sorgenti salvati in una baseline pulita. Il package non elimina né nasconde le modifiche e non le committa automaticamente in un repository esistente. File locali ignorati da Git non rendono sporca la baseline.

Un’interruzione dell’inizializzazione conserva i dati e le prove; non viene ripetuta automaticamente. Se Git e il primo commit sono completi, riapri il progetto e prosegui. Se sono incompleti, verifica lo stato prima di riprovare. Nessuna cancellazione o sovrascrittura viene usata come recupero.

## Importare una copia separata

Soltanto `/controlled-dev project import` chiede origine e destinazione per creare una copia distinta. La destinazione deve essere inesistente e separata dai sorgenti e dal profilo Pi. Rivedi inventario, esclusioni, identità e obiettivo prima di confermare. I dettagli sono in [SOURCE-REFACTORING.md](SOURCE-REFACTORING.md).

# Requisiti

Servono Node.js 22.19.0 o successivo, npm, Git e Pi Coding Agent. Configura in Pi un modello utilizzabile e le sue credenziali.

Installa separatamente pi-subagents nel profilo Pi che utilizzerai. pi-controlled-dev non lo include e non importa i suoi moduli. Controlla che il servizio esponga le capability pubbliche richieste: una versione installata o una risposta generica di successo non bastano.

pi-controlled-dev rileva a runtime le capability pubbliche RPC realmente disponibili. Non richiede una versione rigida di pi-subagents per scegliere il comportamento: il numero di versione, se dichiarato dal servizio, appare soltanto nei dettagli diagnostici. Versioni future sconosciute possono funzionare quando espongono le capability necessarie; versioni precedenti possono funzionare parzialmente. Le funzioni non supportate vengono disabilitate in modo sicuro.

Per il recupero di un Reviewer, `status` permette di osservare lo stato logico; `stop` permette di richiedere l'arresto del run esatto; `processTerminalProof` insieme ad `asyncComplete` permette di attribuire la terminazione. Se manca `stop`, il package attende soltanto per un intervallo limitato. Se manca una prova terminale verificabile, il task resta bloccato e non viene avviato un Reviewer sostitutivo. Le prove storiche non vengono dedotte da timeout, riavvii o scomparsa della sessione.

Per avviare lo sviluppo serve una baseline Git pulita con almeno un commit. Se Git manca, il package prepara la baseline nella cartella corrente dopo la tua autorizzazione. Il package deve poter creare copie di lavoro esterne e sincronizzare file e directory. La verifica della morte di un processo per il recupero usa prove Linux; in altri ambienti, o dopo un cambio di sistema non verificabile, il recupero può restare bloccato.

# Installazione

## Scegli un profilo Pi dedicato

Quando questa estensione è caricata, il modello nella conversazione principale può soltanto leggere. La protezione dura tutta la sessione, anche dopo un task completato. Non è un malfunzionamento.

Per non cambiare le normali sessioni Pi, usa un profilo dedicato in un terminale riservato:

```sh
export PI_CODING_AGENT_DIR="$HOME/.pi-controlled-dev"
```

I comandi Pi di quel terminale useranno il profilo dedicato. Un altro terminale, senza questa variabile, continuerà a usare il profilo abituale. Configura modello e credenziali anche nel profilo dedicato, con le normali funzioni di Pi.

## Installa da GitHub

```sh
export PI_CODING_AGENT_DIR="$HOME/.pi-controlled-dev"
pi install git:github.com/sandololab/pi-controlled-dev
pi install npm:pi-subagents
pi list
```

Questa installazione segue il branch predefinito del repository pubblico. Per fissare una revisione verificata, aggiungi `@COMMIT_SHA` alla sorgente Git, sostituendo il segnaposto con il commit desiderato. Un commit fissato non avanza agli aggiornamenti successivi.

I comandi sono documentati per Pi 1.3.0. Consulta anche lo [stato delle verifiche](VALIDATION.md): questa revisione è una beta di sviluppo con problemi noti.

## Installa il tarball, in alternativa

Supponendo che il file ricevuto sia nella directory Downloads:

```sh
npm install --prefix "$HOME/.local/share/pi-controlled-dev" \
  --ignore-scripts --omit=dev --omit=optional \
  "$HOME/Downloads/pi-controlled-dev-0.1.0-beta.2.tgz"
pi install "$HOME/.local/share/pi-controlled-dev/node_modules/pi-controlled-dev"
pi install npm:pi-subagents
pi list
```

Pi carica la directory installata dal tarball, non una working copy del progetto di sviluppo. Non occorre pubblicare il package su npm. Se il file è altrove, sostituisci soltanto il percorso del tarball.

Tieni package e profilo fuori dal repository su cui lavorerai. Non installarli in una directory che contiene quel repository. Non usare l'installazione locale al progetto per questo tutorial: non è necessario aggiungere file di controllo al progetto.

# Primo avvio

Apri Pi nella directory principale del progetto:

```sh
pi
```

Poi usa:

```text
/controlled-dev
```

Il progetto viene riconosciuto automaticamente. Se manca un obiettivo, descrivi il risultato desiderato. La preparazione Git viene proposta solo quando necessaria. Un progetto esistente viene riaperto con piano e lavoro salvati.

Se il runtime degli agenti non è disponibile, installa pi-subagents nello stesso profilo e riavvia Pi. Il riconoscimento della cartella e le informazioni salvate non sostituiscono un runtime funzionante.

## Prima di eseguire lo sviluppo

Le modifiche locali possono essere analizzate, ma prima di avviare un task decidi tu quali salvare con un commit. Il package conserva i file esistenti. Non installare il package o il profilo Pi dentro la cartella su cui lavorerai.

# Creare un nuovo task

Usa:

```text
/controlled-dev new
```

Il wizard mostra un passaggio alla volta, con avanzamento da 1/5 a 5/5:

1. **Objective:** descrivi il risultato desiderato in linguaggio naturale. Lo Scout legge il repository e le guide pertinenti senza scrivere file né eseguire comandi. Non esiste ancora un TaskSpec.
2. **Scope:** controlla i file esatti proposti, compresi quelli nuovi da creare. Una directory nel piano indica un ambito progettuale; nel task lo Scout deve elencare i singoli file necessari. Modifica permette di inserire fino a 4.096 percorsi relativi, uno per riga, entro la capacità del risultato. Non usare percorsi esterni, `..`, `.git` o caratteri jolly.
3. **Criteri:** correggi i risultati verificabili, uno per riga.
4. **Checks:** leggi la proposta. Usa Chiedi una correzione allo Scout per descrivere una verifica diversa, senza scrivere programmi o comandi.
5. **Riepilogo:** controlla tutti i dati, torna a uno dei campi oppure scegli Crea l’attività. Segue una conferma separata nel pannello di Pi.

Avanti e Indietro conservano tutti i valori. Modifica riapre il campo con il testo già inserito. Esc nell’editor mantiene il valore precedente; Esc nel navigatore propone l’annullamento della preparazione. Puoi rifiutare l’annullamento e continuare. La bozza è locale alla sessione e viene scartata quando annulli o chiudi Pi.

Usa ←/→ o Tab per scegliere l’azione e Invio per aprirla; ↑/↓ o PgUp/PgDn scorrono le proposte lunghe. Nell’editor Ctrl+J inserisce una nuova riga. Cambiare l’obiettivo o chiedere una correzione provoca una nuova proposta Scout, da ricontrollare; tornare indietro senza cambiare obiettivo non ripete l’analisi.

Durante lo Scout puoi premere Esc: viene richiesto lo stop, si attende l’esito del controllo e il risultato viene scartato. Se la terminazione resta incerta, la sessione non riutilizza lo Scout. Non viene creato un task come ripiego.

Le verifiche possibili comprendono contenuto esatto, test esistenti osservati nel repository (npm, pytest, Cargo, Maven, Gradle, Make) e review indipendente. L’host usa ricette fisse; non esegue testo naturale come codice. Il controllo delle differenze è sempre incluso, ma da solo non prova la correttezza del risultato. I test del repository eseguono codice nella candidata: controlla la proposta prima di autorizzare.

Il package costruisce e valida la configurazione interna e la salva nell'archivio del progetto soltanto dopo la conferma: nel profilo Pi per i progetti precedenti, oppure nella cartella del progetto dopo lo spostamento descritto in **Conservare il progetto nella sua cartella**. Non devi scrivere JavaScript, shell, argv, comandi di test o JSON. La creazione non sostituisce i gate per implementazione e completamento. Non è previsto un editor pubblico dopo il congelamento del TaskSpec.

Un task ancora attivo, incompleto o già preparato impedisce di crearne un secondo nello stesso progetto.

# Avviare il task

Usa:

```text
/controlled-dev run
```

Il package trova il task del progetto corrente, verifica l'ambiente e acquisisce il controllo esclusivo necessario. Scout analizza il progetto. Prima che Developer possa scrivere nella copia separata, viene richiesta la conferma prevista dal percorso guidato.

Non lanciare `run` una seconda volta per cercare di riprendere un task interrotto. Usa i comandi di recupero descritti più avanti.

# Cosa fanno i quattro ruoli

**Scout** legge il progetto, raccoglie le informazioni pertinenti e identifica rischi o ambiguità. Non modifica file.

**Developer** realizza la modifica nella copia separata, entro i percorsi autorizzati. Non ha una shell o il potere di avviare altri agenti. Le sue dichiarazioni sui test non sostituiscono le verifiche del package.

**Reviewer** controlla indipendentemente il risultato e i criteri. Non modifica il risultato e non completa il workflow da solo. Può accettare, chiedere correzioni o segnalare un blocco.

**Oracle** fornisce consulenza nei casi previsti dal workflow. Non autorizza modifiche, non sostituisce Reviewer e non può approvare al posto tuo.

# Conferme richieste all'utente

Le conferme appaiono nel pannello di Pi, coerente con il wizard quando è disponibile la TUI personalizzata. La scelta iniziale è «No»: usa ←→ per selezionare e Invio per confermare. Leggi il testo: il comando digitato, un messaggio al modello o un file che dice «approvato» non costituiscono conferma.

Gli esempi seguenti illustrano il significato dei dialoghi; il testo concreto dipende dal task e dalle evidenze disponibili.

## Autorizzare l'implementazione

Esempio: «Il lavoro riguarda README.md. Developer lavorerà su una copia separata. Vuoi autorizzare l'implementazione?»

Controlla obiettivo, percorsi e verifiche. Non approvare se i confini sono più ampi del necessario.

## Autorizzare un'estensione dei percorsi

Esempio: «Per completare la modifica è stato proposto anche docs/intro.md. Vuoi autorizzare questo cambiamento dei confini?»

Una proposta non concede accesso automaticamente. Una risposta negativa non amplia i permessi.

## Decidere su una proposta Oracle

Esempio: «Oracle suggerisce di chiarire quale formato preservare. Vuoi accettare questa indicazione per la riconciliazione?»

Accettare una consulenza non autorizza automaticamente un altro Developer o una modifica del progetto.

## Decidere dopo l'esaurimento dei tentativi

Esempio: «I tentativi disponibili sono esauriti. È stata individuata una possibile decisione di chiarimento. Vuoi accettarla?»

La conferma non azzera i contatori e non aumenta i limiti. Se non esiste una continuazione consentita, il package non inventa una nuova possibilità di esecuzione.

## Approvare il completamento

Esempio: «README.md è stato modificato nella copia candidata; le verifiche sono passate e Reviewer ha accettato. Vuoi approvare il completamento?»

Questa conferma non applica la modifica al progetto originale.

## Se lasci una conferma in attesa

No, Escape o un errore del dialogo non danno approvazione. Per decidere su una richiesta ancora valida:

```text
/controlled-dev decide APPROVE
/controlled-dev decide REJECT
/controlled-dev decide ANSWER Vorrei chiarire il testo richiesto
```

Ogni scelta richiede ancora una conferma esplicita nella TUI di Pi. `REJECT` indica un rifiuto definitivo; `ANSWER` registra un chiarimento e non è un'approvazione. Non usare queste parole come semplice risposta al modello.

# Controllare lo stato

```text
/controlled-dev status
```

Lo stato apre quattro viste: **Overview**, **Activity**, **Checks**, **Technical details**. Usa ←/→ o Tab per cambiare vista (1–4 sono scorciatoie), ↑/↓ o PgUp/PgDn per scorrere, Esc per chiudere. Le viste osservano lo stato host; non autorizzano azioni.

Overview mostra obiettivo, stato, risultato, conferme e recupero necessari. Attività riassume in ordine Scout, Developer, verifiche, Reviewer e conferme. Verifiche separa criteri, controlli automatici e revisione indipendente. Percorsi completi, codici e riferimenti interni restano nei Dettagli tecnici. Durante un comando in corso un riquadro mostra l’avanzamento per fase.

Apri `/controlled-dev` per scegliere anche Avvia task, Decisione in attesa e le operazioni di recovery. Ogni operazione di recovery spiega cosa farà prima della conferma; l’ammissione resta decisa dal motore esistente.

I messaggi usano espressioni come «Task analysis», «Implementazione in corso», «Revisione indipendente» e «Waiting for your confirmation», non soltanto sigle interne.

Per una diagnosi dettagliata:

```text
/controlled-dev status --technical
```

I dettagli possono contenere identificativi, percorsi e dati tecnici. Non servono per approvare il lavoro. In presenza di più task storici, i comandi di stato e recupero possono richiedere un identificativo esplicito.

# Diagnosi dei test che falliscono

Se una verifica non passa, il package registra il risultato del processo e, quando il test li emette, eventi runtime strutturati. Non legge indiscriminatamente l'ambiente, le credenziali o file arbitrari. Gli eventi e l'output sono limitati e vengono redatti prima di essere conservati tra le evidenze del task. La redazione copre segreti comuni, ma non sostituisce la scelta di non inserire dati riservati nei test.

In **Checks** trovi il risultato, le osservazioni, le ipotesi prudenti e le informazioni ancora mancanti. **Activity** indica quando l'evidenza è stata raccolta. I riferimenti ai log e agli artifact sono nei **Technical details**. Una spiegazione non trasforma un test fallito in un test superato.

Quando è disponibile un tentativo di correzione, il package chiede nuovamente la tua autorizzazione prima di affidarlo al Developer. Il Developer può aggiungere tracce o contatori temporanei soltanto nella copia candidata e nei file ammessi dallo scope. Le tracce usate solo per la diagnosi devono sparire dal risultato finale; una modifica di logging destinata a restare nel prodotto va invece valutata come cambiamento ordinario. Se servono altri file, il normale controllo di estensione dello scope resta obbligatorio.

Dopo la correzione il package esegue **la stessa verifica**, conserva le evidenze prima e dopo e mostra al Reviewer il confronto tra esito, eventi e metriche disponibili. Il Reviewer controlla anche la modifica effettiva e che la verifica non sia stata aggirata. Il ciclo usa il limite di rework già previsto: non riparte all'infinito. Se l'esecuzione o l'evidenza è incompleta, l'esito resta incerto e il completamento viene bloccato. Non devi scrivere JSONL, codice o comandi di test per avviare questa diagnosi.

# Dove vengono applicate le modifiche

La cartella originale del repository resta il **progetto ufficiale**. Per i nuovi task il Developer lavora in una branch Git stabile e in un worktree esterno isolato, chiamato **candidate workspace** o copia candidata. I worktree sono aree tecniche normalmente gestite dal package: il Developer non può eseguire comandi Git né scrivere `.git`. La branch resta la stessa durante le correzioni del task.

Quando esiste una candidata, apri la vista **Technical details** di `/controlled-dev status` per trovare il percorso sotto `candidate.root`:

```text
"candidate": { "root": "<percorso-della-copia>" }
```

Il numero della candidata aumenta quando viene prodotta una nuova generazione del risultato. Non modificare la copia mentre il task è in corso: le verifiche si riferiscono ai suoi contenuti esatti.

Dopo il completamento il package congela esattamente il risultato verificato in un commit della branch candidata. Non modifica ancora la destinazione. Puoi conservarlo e ispezionarlo, oppure scegliere **Integrate into project**. Branch e worktree sono conservati per audit e recovery.

# Cosa significa COMPLETED

Quando un task raggiunge **COMPLETED**:

- le modifiche sono state prodotte nella candidata;
- le verifiche previste sono passate;
- Reviewer ha accettato il risultato;
- le autorizzazioni previste sono dimostrate: conferme umane dirette, oppure autorizzazioni derivate da piano e policy approvati;
- l’integrazione nel progetto richiede una decisione separata.

Questo non è una garanzia di assenza di qualsiasi bug. È il completamento del lavoro rispetto ai confini e alle verifiche concordati. Scegli criteri e test adeguati all'importanza del progetto.

# Integrare il risultato nel progetto

Scegli **Integrate into project** dal menu oppure usa `/controlled-dev integrate` (con l’identificatore del task se necessario). Questa operazione è disponibile anche per un singolo task senza Project Planning.

Il package prepara un merge esplicito in un worktree tecnico sull’HEAD corrente della destinazione e ripete le verifiche del task. Se la target è avanzata, richiede anche una nuova review in sola lettura al Reviewer esistente. Se target e contenuto coincidono con la candidata già revisionata, riusa la review del task. Non produce un verdetto di verifica globale del progetto.

Nel percorso supervisionato, il pannello mostra obiettivo, branch di destinazione, file aggiunti/modificati/rimossi, verifiche e review. Puoi scegliere **Approve**, **Reject** o **Back**. L’approvazione richiede la conferma umana trusted nella TUI; una risposta del modello o un comando headless non autorizzano il merge. Nel percorso automatico, l'autorizzazione può invece derivare dal piano e dalla policy approvati, entro i loro limiti. L'integrazione resta una fase distinta dal completamento del task.

Se approvi, il package applica localmente l’esatto commit preparato e verificato, aggiorna i file della cartella originale e controlla che Git sia pulito. Non devi copiare manualmente file dalla candidata. Se rifiuti, il task resta COMPLETED e la candidata disponibile; il progetto non cambia.

La cartella ufficiale deve essere pulita, sulla branch prevista e senza operazioni Git in corso. Se l’HEAD cambia dopo la proposta, serve una nuova preparazione, nuove verifiche e una nuova approvazione. Un conflitto o una verifica fallita bloccano l’integrazione: il package conserva le prove e non corregge automaticamente. Serve un normale intervento controllato.

Git deve avere nome ed email configurati esplicitamente. Il package usa l’identità configurata e non cambia configurazioni permanenti. Hook e firma sono disabilitati soltanto per queste operazioni host non interattive; filter e merge driver esterni non sono supportati. Non vengono contattati remoti.

Prima dell’applicazione viene salvato un intent legato all’approvazione esatta. Dopo un’interruzione, riaprire **Integrate into project** può completare o riconciliare quella stessa operazione autorizzata. Se Git o i file sono ambigui, il package si ferma e richiede intervento. Non usa hard reset, stash, rollback o cancellazione aggressiva delle branch.

# Verificare insieme i risultati integrati

Un task può superare le proprie verifiche e avere una candidata approvata. Dopo l'integrazione di più task, serve talvolta una prova ulteriore: i componenti devono funzionare insieme nella stessa versione del progetto. La verifica dell'integrazione, o Integration Checkpoint, serve a raccogliere questa prova tecnica.

Il percorso è: **task controllato → integrazione Git autorizzata → nuova baseline → verifica dell'integrazione**. Completare tutti i task del piano, integrarli nel progetto e verificare la baseline sono tre fatti distinti. Un checkpoint è facoltativo: il normale uso con un singolo task non cambia.

## Proporre e approvare una verifica

Apri **Details and checks → Integration check**, oppure `/controlled-dev project check`. Seleziona i risultati già integrati, spiega perché vanno controllati insieme e scegli le verifiche disponibili nel commit. Puoi includere scenari esistenti quando il loro comando esatto è compatibile con le verifiche selezionate.

Il riepilogo mostra task compresi, branch e commit, verifiche previste, versioni degli scenari e review indipendente. L'approvazione passa dal dialogo nativo di Pi e riguarda questo contenuto esatto. Una definizione approvata non si modifica: per cambiare copertura, scopo o verifiche occorre una nuova revisione e una nuova approvazione. Non devi approvare separatamente ogni comando della verifica.

Non basta che un task risulti COMPLETED: il programma controlla le prove dell'integrazione e la storia Git. Un task che non modifica software può essere incluso solo quando completion e integrazione non necessaria sono dimostrate. Un task non presente nella baseline impedisce l'approvazione o blocca l'esecuzione.

## Avviare la verifica

L'avvio è esplicito, attraverso **Run an approved verification**. La definizione descrive cosa verificare; ogni esecuzione conserva un'identità separata e il commit realmente verificato. Puoi rieseguire lo stesso intento, anche dopo un avanzamento del progetto: il riepilogo mostra sempre il nuovo commit esatto e la storia precedente resta disponibile.

Le verifiche usano un worktree Git detached, temporaneo e separato dalla cartella principale. Anche se hai modifiche locali non committate, il programma verifica soltanto il commit scelto: quelle modifiche restano escluse e non vengono applicate alla copia di verifica.

Si riusano le verifiche del repository attraverso ricette controllate dall'host. Test e build possono produrre file temporanei nella copia isolata. Se questi file impediscono la rimozione normale del worktree, la copia viene conservata per un'ispezione e una pulizia esplicite. Non si forza la cancellazione di file.

## Leggere il risultato

- **PASS:** le verifiche richieste sono riuscite sull'esatto commit indicato, inclusi gli scenari selezionati e la review quando richiesta. Non significa che ogni comportamento del prodotto sia corretto, che tutti i requisiti di sistema siano soddisfatti o che una release sia approvata.
- **FAIL:** almeno una verifica eseguita o la review ha rilevato un problema. Le evidenze e i log restano consultabili. Il checkpoint non corregge il codice, non annulla merge e non rimuove commit: puoi formulare un normale task controllato di correzione usando quelle prove.
- **BLOCKED:** mancano condizioni o prove sufficienti, per esempio un task non integrato, un comando non disponibile, uno scenario non risolvibile o una review priva di prova terminale. Non è un esito positivo e non implica che il software abbia fallito un test.
- **STALE:** una verifica riuscita riguarda un commit precedente. Il vecchio run resta PASS per quel commit; la versione attuale non è per questo verificata.

Se una nuova integrazione approvata avanza la target durante la verifica, il checkpoint continua a controllare il commit isolato originale. Una catena di promotion persistite permette di riconoscere l'avanzamento legittimo. Cambiamenti della cartella principale senza quella prova restano ambigui e bloccano la verifica. Il checkpoint non trattiene un lock della target per l'intera durata e non impedisce automaticamente promotion future.

## Evidenze, memoria e note del progetto

Il risultato collega definizione, commit e tree Git, task e promotion, verifiche, scenari, osservazioni runtime e review. Le memorie tecniche pertinenti possono essere fornite in modo limitato e tracciato; la verifica non modifica Project Memory e non attiva automaticamente nuove lezioni.

Nelle note umane trovi `Integration/Checkpoints`, `Integration/Runs` e i relativi riferimenti alle evidenze. `Project.md` e, quando esiste, `Planning/Current Plan.md` mostrano baseline corrente, ultimo checkpoint, risultato e copertura. Una sola Base aggiuntiva permette di confrontare run, date e baseline attuale o precedente. Modificare una nota da FAIL a PASS non cambia il risultato nello store.

## Dopo un'interruzione

L'esecuzione conserva le fasi e le evidenze parziali. Con **Recover an interrupted verification**, un processo nuovo può riconoscere un proprietario sicuramente terminato e registrare un blocco; non inventa PASS o FAIL e non riavvia agenti automaticamente. Un risultato già concluso resta immutabile anche quando il recupero libera una proprietà residua del processo terminato. Se non è dimostrata la terminalità di un comando o di un Reviewer già avviato, un'altra esecuzione equivalente resta bloccata.

I checkpoint non implementano task, non effettuano promotion, non valutano requisiti di sistema e non introducono nuovi stati del workflow. Il parent Pi resta in sola lettura e il Developer resta l'unico writer software nei normali ControlledTask.

# Cosa resta fuori da questa fase

Sono supportati progetti Git esistenti, nuovi progetti inizializzati sulla branch approvata e l'importazione esplicita di sorgenti in una destinazione distinta tramite `/controlled-dev project import`. I repository annidati e i repository Git unborn preesistenti restano fuori scope.

Non vengono eseguiti push, fetch, pull, pubblicazioni o release. Non sono implementate integrazione remota o pull request. La persona autorizza l'integrazione direttamente o, nel percorso automatico, attraverso piano e policy; l'esecuzione Git locale spetta al package.

# Riprendere dopo un'interruzione

Se Pi o il computer vengono chiusi durante un task, il package conserva informazioni per verificare se il lavoro può essere ripreso in sicurezza. Non sempre le informazioni sono sufficienti, soprattutto dopo cambi di sistema o quando un agente non è più verificabile.

Per un progetto ancora conservato nel profilo, apri Pi nello stesso progetto e nello stesso profilo. Per un progetto già spostato nella sua cartella, conserva tutta quella cartella; la verifica del controllo e degli agenti resta necessaria. Poi usa:

```text
/controlled-dev status
```

Se lo stato indica che il recupero è possibile:

```text
/controlled-dev recover
/controlled-dev status
/controlled-dev resume
```

`recover` verifica il precedente proprietario e prova ad acquisire nuovi lock. `resume` è una richiesta separata di continuazione da un punto sicuro. Il recupero non azzera i tentativi e non rilancia attività già registrate.

Se serve verificare nuovamente un agente precedente:

```text
/controlled-dev reconcile
```

Questo comando richiede nuove evidenze tramite il servizio pubblico disponibile. Non crea una prova soltanto perché lo hai invocato. Può lasciare il task bloccato.

Dopo un cambio di sessione, una richiesta di conferma ancora pendente può essere ripresentata con una nuova conferma. Una vecchia risposta non viene riciclata per una richiesta differente.

# Riparare un salvataggio incompleto

Il package conserva un diario degli eventi e uno stato riassuntivo del task. Se Pi si interrompe durante il salvataggio, il diario può contenere informazioni più recenti del riepilogo.

Se queste informazioni sono complete e verificabili:

```text
/controlled-dev repair
```

può ricostruire lo stato salvato. **Non ripete** Developer, test, review, conferme o modifiche esterne. Non conclude che un'attività sia terminata soltanto perché il diario può essere letto.

Dopo una repair riuscita, controlla lo stato. Recupero e ripresa rimangono operazioni distinte:

```text
/controlled-dev status
/controlled-dev recover
/controlled-dev resume
```

Se i dati sono contraddittori o manca una prova importante, la repair viene negata. Non eliminare a mano file del diario, lock o dati del task.

# Quando un vecchio agente resta UNKNOWN

**UNKNOWN** significa che il package non riesce a stabilire con certezza se un agente precedente abbia terminato il proprio lavoro.

In questo caso non avvia automaticamente un sostituto: potrebbero esistere due agenti sullo stesso task. La sola assenza di messaggi, un processo apparentemente vecchio o una risposta testuale non provano la terminazione.

Puoi richiedere `/controlled-dev reconcile`. Se il servizio non espone evidenze storiche sufficienti, il risultato resta bloccato. Non creare un nuovo task con un nome diverso per aggirare questa protezione.

# Errori e messaggi comuni

## Nessun task attivo

**Significa:** non è presente un task utilizzabile per il progetto corrente.

**Fai:** verifica la directory e usa `/controlled-dev new`.

**Non fare:** creare manualmente file di configurazione interni.

## Repository Git non valido

**Significa:** per il task corrente la directory non è la radice di un repository con baseline. Per preparare la cartella corrente usa `/controlled-dev`; non inizializzare Git attraverso il modello parent.

**Fai:** apri la directory giusta o prepara il progetto con Git.

**Non fare:** aggirare il controllo con percorsi artificiali.

## Repository sporco

**Significa:** ci sono modifiche o file non registrati che impediscono una base pulita.

**Fai:** salva o metti da parte consapevolmente il tuo lavoro.

**Non fare:** cancellare modifiche solo per far passare il controllo senza averle conservate.

## pi-subagents non disponibile

**Significa:** la sessione non dispone del servizio pubblico necessario o delle sue capability richieste.

**Fai:** installalo nel profilo corretto e riavvia Pi; verifica la compatibilità.

**Non fare:** copiare internals del provider nel package o forzare un risultato positivo.

## Task già attivo

**Significa:** esiste già un lavoro preparato o in corso nello stesso progetto.

**Fai:** usa `/controlled-dev status` e gestisci quel task.

**Non fare:** sovrascrivere la sua preparazione o cambiare nome per duplicarlo.

## Scope violation: modifiche fuori dai confini

**Significa:** sono state rilevate modifiche non ammesse nei percorsi o nei contenuti protetti.

**Fai:** conserva le evidenze e controlla i dettagli del blocco.

**Non fare:** ampliare i permessi retroattivamente o applicare la candidata come se fosse verificata.

## UNKNOWN

**Significa:** la terminazione di un agente precedente non è dimostrabile.

**Fai:** richiedi una riconciliazione e accetta che possa restare bloccato.

**Non fare:** avviare un duplicato o cancellare il lock.

## Recovery required: recupero richiesto

**Significa:** il precedente proprietario deve essere verificato prima di continuare.

**Fai:** usa `/controlled-dev recover` se indicato dallo stato.

**Non fare:** rilanciare `/controlled-dev run` come se il task fosse nuovo.

## Repair required: riparazione richiesta

**Significa:** il salvataggio o il recupero precedente è incompleto.

**Fai:** consulta lo stato e usa `/controlled-dev repair` quando ammesso.

**Non fare:** modificare a mano i dati salvati.

## Task BLOCKED

**Significa:** una condizione necessaria non è soddisfatta o non è dimostrabile.

**Fai:** leggi il motivo e i dettagli tecnici; intervieni soltanto con i percorsi previsti.

**Non fare:** interpretarlo come un successo parziale da pubblicare o un permesso di retry illimitato.

## RESULT_SCHEMA_INVALID dopo una review positiva

**Significa:** un oggetto non ha superato i controlli del package; un messaggio testuale «Review passed» non annulla l'errore.

Nel probe manuale è stato individuato un bug preciso: il wizard aveva creato un criterio di sola review senza collegarlo ai comandi di verifica. Quando l'host ha tentato di registrare la risoluzione del rischio «verifica ancora da eseguire», il controllo semantico ha respinto quel collegamento mancante. Il controllo sui contenuti della candidata e il Reviewer erano entrambi PASS, ma lo stato durevole era ancora REVIEWING, non COMPLETED. Questa diagnosi non significa che ogni errore con lo stesso codice abbia la medesima causa.

**Stato della correzione:** il codice corrente gestisce i criteri REVIEW tramite la review indipendente della candidata corrente. Il test di regressione arriva a COMPLETED e respinge prove obsolete, mancanti o invalidate. Il codice generico può segnalare anche altri errori: non viene ignorato.

**Fai:** conserva il task e consulta `/controlled-dev status`, eventualmente con `--technical`. Non considerare risolto automaticamente un task storico bloccato.

**Non fare:** rilanciare `run`, modificare criteri o prove salvate, applicare la candidata all'originale, oppure usare `repair` per aggirare l'errore. La repair non corregge un bug nella costruzione del task.

Se un agente dice che la modifica «non è stata applicata al workspace host», ricorda che **l’originale resta invariato prima dell’integrazione approvata**. Il completamento verifica la candidata; la promotion aggiorna poi il progetto ufficiale con una decisione separata.

## Confirmation required: conferma richiesta

**Significa:** serve una tua decisione su dati specifici.

**Fai:** leggi il pannello di conferma e scegli consapevolmente.

**Non fare:** chiedere al modello di dichiarare che hai approvato.

# Sicurezza e limiti

La conversazione principale rimane read-only mentre l'estensione è caricata. Il package non riabilita gli strumenti di scrittura dopo un completamento o una notifica ritardata. Usa un profilo o una sessione separata per il normale coding Pi.

Questo è un controllo degli strumenti dentro un processo Pi fidato, non una sandbox del sistema operativo. Un'estensione host malevola o un programma di verifica distruttivo non diventano sicuri grazie a questo workflow. Scegli con attenzione le estensioni e i comandi.

Non inserire password, token o chiavi nei task. Il controllo sugli artifact non riconosce universalmente tutti i segreti. Le prove di crash di processo non garantiscono che qualsiasi filesystem, cache hardware o interruzione elettrica mantenga gli stessi comportamenti.

Il package preferisce bloccarsi anziché inventare una conferma, una terminazione o un risultato mancante.

# Aggiornamento e reinstallazione

Per la copia installata da GitHub, chiudi le sessioni attive, usa lo stesso profilo Pi ed esegui `pi update git:github.com/sandololab/pi-controlled-dev`, poi riavvia Pi. La pubblicazione di un commit non aggiorna automaticamente le installazioni sugli altri PC. Una sorgente fissata a un commit resta su quel commit. In Pi 1.3.0, `pi update` senza argomenti aggiorna Pi stesso; `pi update --extensions` aggiorna tutti i package.

Le istruzioni seguenti riguardano l’alternativa da tarball.

Chiudi le sessioni attive. Conserva il profilo Pi e le copie candidate dei progetti precedenti; per quelli già spostati conserva anche l'intera cartella del progetto, compresi i file nascosti. Reinstalla il tarball desiderato nello stesso prefix usato in precedenza, poi riavvia Pi.

I dati dei task sono separati dalla directory installata del package: nel profilo Pi per i progetti precedenti, nella cartella `.controlled-dev` per quelli già spostati. Reinstallare il package non è un reset del workflow e non cancella gli storici.

Non aggiornare mentre un processo sta ancora scrivendo. Una nuova versione non rende automaticamente recuperabile un task privo di prove sufficienti.

# Disinstallazione

Per l’installazione GitHub, nel medesimo profilo esegui `pi remove git:github.com/sandololab/pi-controlled-dev`.

Per l’installazione alternativa da tarball, nel profilo in cui avevi registrato il package:

```sh
pi remove "$HOME/.local/share/pi-controlled-dev/node_modules/pi-controlled-dev"
```

Per rimuovere anche i file installati, dopo aver chiuso le sessioni:

```sh
npm uninstall --prefix "$HOME/.local/share/pi-controlled-dev" pi-controlled-dev
```

Conserva profilo e candidate dei progetti precedenti finché ti servono. Per i progetti già spostati, conserva tutta la cartella del progetto. Disinstallare non completa, annulla o riconcilia un agente ancora incerto. Non eliminare i dati di un task attivo.

# Domande frequenti

**Perché il normale modello Pi non può scrivere?** Perché l'estensione protegge il parent per l'intera sessione. Apri una normale sessione senza questo package o usa il profilo abituale in un terminale separato.

**Devo conoscere JSON, hash o identificativi?** No. Il percorso `new` costruisce i dati interni. I dettagli tecnici servono solo per diagnosi avanzate.

**Devo scrivere io i test?** No: descrivi il risultato atteso. Lo Scout propone verifiche e l’host le traduce in ricette supportate. Puoi correggerle in linguaggio naturale. Developer può modificare test solo entro lo scope autorizzato; il loro successo non sostituisce la review indipendente.

**Posso tornare indietro se sbaglio un campo?** Sì. Usa Indietro o, nel riepilogo, Modifica il campo desiderato. I valori già inseriti restano nella bozza. La creazione del task richiede comunque una conferma finale nel pannello di Pi.

**Un PASS del Reviewer è già COMPLETED?** No: devono essere soddisfatte anche le verifiche, le conferme e le condizioni finali del package.

**Posso modificare la candidata mentre attendo?** No. Cambiare i contenuti rende obsolete le prove legate a quella copia.

**Posso integrare quando vedo COMPLETED?** Sì, per i nuovi task con binding Git: scegli Integra nel progetto, leggi la proposta e autorizza nella TUI. Il package esegue l’esatta integrazione locale. I task storici senza binding restano consultabili, senza auto-promotion.

**Il repository pubblico è open source?** Il codice è consultabile su GitHub, ma resta `UNLICENSED` finché l’autore non sceglie una licenza open source. `private: true` riguarda soltanto la pubblicazione sul registro npm e non la visibilità GitHub.

# Tutorial: preparare una richiesta senza scrivere test

## Prepara il progetto

Usa un repository Git pulito con almeno un commit e un file `README.md` contenente:

```text
Before
```

Apri Pi nella directory principale del progetto, con il profilo dedicato. Non aggiungere file di controllo del package.

## Descrivi il lavoro in italiano

Apri `/controlled-dev new`. Nel primo editor scrivi:

> Aggiungi la riga After dopo Before in README.md. Modifica solo README.md. Il risultato deve contenere esattamente queste due righe, con newline finale.

Avanza: lo Scout propone scope, criteri e verifiche. Controlla che lo scope sia solo README.md. Nella sezione Verifiche chiedi, se necessario: «Controlla automaticamente il contenuto esatto e conserva la review indipendente». Non scrivere programmi.

Dal riepilogo scegli Modifica criteri, correggi il testo e torna al riepilogo. Poi crea il task e usa `/controlled-dev run`. Leggi le conferme nel pannello di Pi prima di implementazione e completamento. Il template `/controlled-dev-task` resta una scorciatoia di assistenza testuale separata, non crea un task.

## Come riconoscere un completamento reale

Lo stato host deve indicare COMPLETED dopo validation, Reviewer e conferme nella TUI di Pi. Il risultato atteso nella candidata sarà:

```text
Before
After
```

L'originale dovrà contenere ancora soltanto `Before`, con Git pulito. Il percorso della candidata sarà visibile nei Dettagli tecnici di `/controlled-dev status`. Una risposta del modello o una proposta corretta non equivalgono a questo risultato durevole.

# Skill e assistenza testuale

Il package include dodici guide per il modello:

- `repository-analysis`: osservare file, configurazioni e rischi senza modificare il progetto;
- `validation-planning`: proporre cosa verificare, preferendo test esistenti e distinguendo proposte da risultati reali;
- `controlled-review`: confrontare requisiti, candidata, test e prove host senza auto-certificare il lavoro;
- `task-planning`: aiutarti a formulare obiettivo, file modificabili e risultato atteso;
- `recovery-explanation`: spiegare un blocco senza aggirare controlli o cancellare dati.
- `runtime-observability`: interpretare eventi runtime bounded distinguendo fatti, ipotesi e limiti;
- `scenario-management`: descrivere scenari ripetibili legati a verifiche approvate dall’host;
- `evidence-management`: organizzare prove tecniche e resoconti leggibili senza attribuire loro autorità.
- `software-design-quality`: applicare riuso, naming, documentazione e scelte progettuali proporzionate senza imporre OOP, pattern o astrazioni artificiali;
- `project-planning`: suddividere un obiettivo software ampio in attività verificabili, spiegare dipendenze e proporre revisioni da correggere e approvare;
- `greenfield-bootstrap`: proporre scelte iniziali pertinenti e un’architettura minima prima della creazione host, senza scrivere codice o concedere permessi;
- `project-memory`: richiamare memoria pertinente, distinguere decisioni accettate e lezioni advisory e proporre cambiamenti senza promuoverli autonomamente.

Le responsabilità restano distinte: `repository-analysis` osserva il progetto, `task-planning` traduce i fatti in aspettative specifiche, `software-design-quality` offre principi generali, Developer applica e `controlled-review` verifica. Le convenzioni già consolidate nel repository hanno precedenza sui default generici della nuova guida.

Per richiamare esplicitamente una guida puoi usare, per esempio, `/skill:validation-planning`. Normalmente Pi seleziona le skill in base alla richiesta. Se segnala un conflitto di nomi, controlla i package installati: il profilo dedicato evita interferenze con altre guide.

Sono disponibili anche tre scorciatoie testuali:

```text
/controlled-dev-task Aggiungi la riga After a README.md
/controlled-dev-recovery Spiega questo stato UNKNOWN
/controlled-dev-result Spiega la differenza tra Reviewer PASS e COMPLETED
```

Questi template aprono una conversazione di assistenza. Non sono comandi del workflow: non creano TaskSpec, non avviano agenti controllati, non riparano dati e non confermano nulla al posto tuo. Una risposta del modello rimane una proposta o spiegazione, non una prova host.

Le parti pertinenti delle guide sono fornite esplicitamente dall'host ai ruoli controllati. Scout, Developer e Reviewer non ereditano skill globali o di progetto. L'estensione mantiene tutte le decisioni di sicurezza e autorità.

Il pre-task Scout riceve esplicitamente le guide del package e può leggere guide pertinenti del repository come dati non fidati. Non eredita autorizzazioni o strumenti dalle skill. Una skill non autorizza un comando proposto.

# Consultare le prove con Obsidian

Il package usa una sola raccolta Markdown. Per i progetti precedenti si trova nel profilo Pi, sotto `controlled-dev/projects/<project-id>/human`. Dopo **Keep the project in its own folder**, la stessa raccolta si trova in `Documentazione`, nella cartella del progetto. Puoi aprire la cartella indicata nella TUI direttamente come Vault Obsidian.

**Regenerate documentation** nel menu avanzato, oppure `/controlled-dev rebuild-view`, riusa questa stessa raccolta e mostra nella TUI il percorso completo della cartella. La rigenerazione viene eseguita dal package in Pi.

`Home.md` conduce ai task e agli ultimi risultati. Le cartelle `Tasks`, `Scenarios`, `Runs`, `Evidence`, `Reviews` e `Decisions` contengono spiegazioni generate in inglese con frontmatter stabile e wikilink. `Indexes` contiene viste `.base` opzionali per elencare gli stessi documenti. Obsidian Bases migliora la navigazione, ma non è necessario per leggere i file.

I file generati sono una rappresentazione. Lo stato autorevole, le identità, gli hash, i risultati di validazione, il Reviewer e le conferme restano nello store JSON strutturato. Cambiare a mano `status: PASS` in una nota non cambia il workflow.

Se il Developer ha registrato una scelta architetturale significativa, la pagina Task contiene la sezione **Design choices**. Spiega ciò che è stato riutilizzato, le eventuali nuove astrazioni o pattern e il motivo della coerenza con l’architettura esistente. La sezione non appare per una modifica priva di decisioni progettuali rilevanti e il suo testo resta una spiegazione derivata dai record, non autorità.

Per annotare liberamente un task, uno scenario o una prova usa il file collegato nella cartella `Notes`. Questi file vengono creati una sola volta e non sono riscritti. Se una nota generata è stata modificata o manca, ricostruisci la vista con:

```text
/controlled-dev rebuild-view
```

La rigenerazione rilegge lo store verificato e conserva `Notes`. Se la proiezione fallisce, il workflow non viene alterato e la vista viene indicata come non aggiornata. Obsidian CLI è soltanto un possibile strumento manuale di controllo; il package non lo richiede. Non viene generato JSON Canvas perché il grafo dei wikilink copre già le relazioni task → scenario → run → evidence → review. Non è incluso alcun plugin Obsidian o launcher di Pi.

# Conservare il progetto nella sua cartella

Nel menu avanzato scegli **Keep the project in its own folder**, oppure usa:

```text
/controlled-dev project adopt
```

Il package prepara lo spostamento e chiede una conferma nella TUI. Il lavoro deve essere fermo, gli agenti verificati e Git pulito. Vengono conservati lo stato delle attività, il piano, la memoria, le prove, i documenti, le note personali e le copie verificate delle candidate. Le credenziali e le impostazioni personali di Pi restano sul computer.

La raccolta esistente viene spostata in `Documentazione`: non viene creata una seconda raccolta. Lo stato strutturato e le copie delle candidate sono sotto `.controlled-dev`. Queste due cartelle vengono escluse localmente da Git e restano separate dai sorgenti su cui possono lavorare gli agenti. L'esclusione locale mantiene i file sul disco. Un trasferimento o un backup deve includerli esplicitamente.

Lo spostamento verifica i byte prima di pubblicare il nuovo archivio e prima di rimuovere il vecchio. Una modifica personale concorrente ferma l'operazione. Se Pi si interrompe, non cancellare le cartelle conservate: usa `/controlled-dev project recover-storage`. Il package propone, con una nuova conferma, di completare la pulizia oppure rimuovere soltanto le copie temporanee verificate. Se trova dati diversi da quelli attesi, si ferma e richiede chiarimenti.

Per conservare o trasferire un progetto spostato, copia l'intera cartella, inclusi `.git`, `.controlled-dev` e `Documentazione`; una copia dei soli file seguiti da Git non è sufficiente. Sul nuovo computer servono Pi, il package, il servizio pi-subagents compatibile e le proprie credenziali configurate. La presenza dei dati non dimostra che un agente del vecchio computer sia terminato, né riattiva automaticamente conferme o autorizzazioni precedenti. La ripresa di un'attività su un altro computer richiede la verifica e l'autorizzazione locale previste dal recupero.

Per riprendere un’attività ancora da completare nella cartella trasferita, o dopo una chiusura regolare che ha salvato e rilasciato il progetto anche nella stessa cartella, scegli **Resume transferred project** nel menu oppure usa `/controlled-dev project resume-storage`. Senza indicare un’attività, il package propone quelle il cui lavoro salvato può essere verificato. Puoi anche aggiungere l’identificativo dell’attività al comando.

La nuova conferma presenta la posizione precedente e quella attuale, il lavoro conservato e le eventuali modifiche alle annotazioni personali. Autorizza il ripristino e il controllo locale di quel lavoro: le conferme precedenti non autorizzano la nuova esecuzione. Il package riesegue le verifiche richieste e chiede le nuove autorizzazioni previste. Se il salvataggio non è verificabile o la fine di un vecchio agente resta incerta, il passaggio dipendente rimane fermo.

Lo spostamento della raccolta e degli archivi è stato verificato anche in Pi su un progetto reale. La lettura dopo la copia in un nuovo percorso e con un profilo vuoto è coperta da test. La ripresa completa con modello reale su un altro computer richiede ancora una prova dedicata: non è una garanzia fornita da questo manuale.

# Appendice A — Concetti tecnici facoltativi

Questa appendice non è necessaria per l'uso normale.

- **TaskSpec:** la descrizione strutturata del task costruita dal percorso guidato.

- **Candidate:** la copia del progetto che contiene il risultato proposto.

- **Generation:** il numero della versione candidata, utile per non confondere prove riferite a risultati diversi.

- **Hash:** un'impronta dei dati; aiuta a rilevare modifiche, ma non dimostra da sola approvazioni o esecuzioni.

- **Lock:** un vincolo di proprietà che impedisce workflow concorrenti sullo stesso progetto. La sua età non autorizza a eliminarlo.

- **Recovery:** verifica e recupero del controllo dopo un'interruzione, senza azzerare la storia.

- **WAL:** il diario degli eventi salvati prima del riepilogo.

- **Snapshot:** lo stato riassuntivo del task.

- **fsync:** la richiesta al sistema operativo di rendere durevoli dati già scritti. La repair può eseguirla di nuovo senza pretendere di conoscere l'esito della vecchia chiamata.

- **Terminal proof:** evidenza strutturata della terminazione di un processo. Non è automaticamente prova di un risultato corretto o accettato.

I dati si trovano nella directory `controlled-dev` del profilo Pi per i progetti precedenti, oppure sotto `.controlled-dev` nella cartella dei progetti già spostati; non nella directory del package. Lo stato tecnico aiuta a individuare i riferimenti necessari senza modificare questi dati.

# Appendice B — Limiti del prototipo

Il wizard non accetta eseguibili o argomenti arbitrari. Le ricette coprono i meccanismi elencati e il contenuto esatto; altre verifiche richiedono review o un’estensione futura dell’host. Se manca un eseguibile necessario, il task non viene creato.

L'inventario di protezione read-only ha un limite di 100.000 voci e due budget separati: 512 MiB per i file del progetto e 512 MiB per i dati Git. Include anche i file ignorati, salvo gli archivi del package riconosciuti e protetti dall'host. L'importazione dei sorgenti ha limiti propri: 100.000 voci, 512 MiB complessivi e 32 MiB per singolo file. Per lo spostamento dell'archivio ogni inventario acquisito ha un limite di 100.000 voci e 1 GiB, con 64 MiB per file. Superare uno di questi limiti ferma la relativa operazione; non riduce i controlli per proseguire.

L'avanzamento mostra fasi osservate, non percentuali stimate. Durante le verifiche e le copie sincrone la TUI può restare sull'ultima fase fino al ritorno dell'host; archivi con migliaia di file possono richiedere diversi minuti. P17 ha verificato un task semplice con modello reale e conferme personali native. Le prove native successive hanno verificato il pannello personalizzato per il completamento, l'integrazione locale e lo spostamento dell'archivio. Altri tipi di task, repository e ambienti richiedono prove proprie. Il pannello conserva il controllo host su sessione, dati mostrati e decisione.


Il testo delle schermate usa inglese semplice. Lo stato del lavoro e il prossimo passo sono nel riepilogo; i Dettagli tecnici raccolgono i dati di diagnosi. Alcune conferme mostrano anche identificatori e revisioni per riconoscere i dati esatti da autorizzare. Le notifiche del servizio degli agenti possono avere testo diverso da quello del package.

La suddivisione di un’attività richiede una sola proposta completa. La dimensione consigliata è circa 8 KiB; il limite effettivo cresce con il numero di attività e risultati da coprire, fino a 24 KiB. Un piccolo sforamento della dimensione consigliata è ammesso. Il testo non viene tagliato: file, verifiche e dipendenze restano completi. Invii a pezzi non sono necessari per queste proposte.

# Piano e informazioni mancanti

Nel menu del progetto, **Consult the plan** apre il piano corrente senza avviare
analisi. Puoi scegliere un punto e leggere cosa deve produrre, i suoi prerequisiti,
i passi previsti e l’attività collegata. Per quest’ultima sono disponibili stato,
file modificati, verifiche e decisioni registrate. Se un dato manca, viene indicato
come non disponibile. Il lavoro completato nella copia di lavoro e l’integrazione
nel progetto sono mostrati separatamente.

Mentre un agente lavora, dall’editor usa **Alt+P** per leggere il piano oppure
**Alt+S** per lo stato dell’attività. I normali comandi
`/controlled-dev project consult` e `/controlled-dev status` possono restare
in attesa finché termina il comando già in corso. Nel pannello **Prepare the work**
usa la lettura interna con Alt+P descritta sopra. La consultazione non interrompe
l’agente. I pannelli vengono presentati uno alla volta: una conferma non sostituisce
il testo che stai leggendo. Per modificare il piano, attendi che l’operazione corrente
si fermi e scegli **Edit the plan**.

**Edit the plan** ti permette di descrivere liberamente una correzione. L’agente
prepara una proposta che puoi leggere e correggere prima della conferma. Consultare
il piano o proporre una modifica non autorizza lo sviluppo.

Prima di chiederti informazioni, gli agenti cercano nei file del progetto. Ogni
giro può svolgere al massimo tre indagini; dopo due consecutive senza nuove letture
il package chiede i chiarimenti rimasti. Il tentativo viene registrato prima di
avviare l’agente: chiudere la finestra, annullare o interrompere l’analisi non
restituisce quel tentativo. Riaprendo lo stesso lavoro ritrovi il conteggio e le
domande salvate. Un nuovo giro comincia dopo l’invio esplicito delle risposte
richieste; i contenuti già letti restano nel conteggio del progresso.
Le riletture e le riformulazioni non sono
nuovo progresso. Questo controllo riguarda le letture osservate, non garantisce la
comprensione del codice. La domanda spiega perché serve una risposta. Un’eventuale
risposta suggerita è riconoscibile come proposta: puoi approvarla o modificarla;
annullare la lascia aperta. Le risposte vengono riesaminate e il package continua
a chiedere ciò che manca prima di creare l’attività. Il riepilogo conserva i
chiarimenti forniti dall’operatore.


### Chiarimenti durante il lavoro

Se l’analisi di un’attività già approvata lascia un dubbio, il passaggio che dipende
dalla risposta resta fermo. La TUI presenta la domanda esatta; puoi scrivere o
correggere la risposta e leggerla prima di confermarla. Una risposta suggerita è
sempre una proposta. Annullare non significa accettarla.

La risposta confermata rimane consultabile con le decisioni dell’attività e viene
fornita agli agenti incaricati di svilupparla e verificarla. Rispondere non autorizza
lo sviluppo: valgono ancora i file ammessi, i requisiti e le conferme previste.
Se la risposta richiede requisiti o file diversi, occorre rivedere la proposta
dell’attività. Il package non inventa quella revisione e non prosegue in autonomia.
