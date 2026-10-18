[English](../SYSTEMIST-COMPOSITION.md) · **Italiano**

# Composizione con Systemist Factory

`pi-controlled-dev` è la base generica di sviluppo del futuro `systemist_factory`.
La personalizzazione deve riusare dialogo, Project Memory, piano, task, agenti,
verifiche, instrumentazione, scenari, review, integrazione e recupero del motore.
Il livello Systemist conserva interpretazione delle fonti, requisiti, tracciabilità,
documenti e decisioni sistemistiche. Un risultato tecnico PASS non certifica la
conformità di un requisito di sistema.

## Punto di composizione implementato

`pi-controlled-dev/host` espone `createControlledDevExtension` e il contratto
`DevelopmentProfile` con `schemaVersion: 1`. Un package derivato può fornire
metodologia comune e supplementi per ProjectPlanning, TaskPlanning, Greenfield,
Scout, Developer, Reviewer, IntegrationReview e Oracle. Il profilo viene copiato,
validato e congelato alla costruzione. La configurazione di un package non modifica
quella di un altro; non esiste un registro globale di personalizzazioni.

Esempio di extension wrapper del futuro package:

```typescript
import { createControlledDevExtension } from 'pi-controlled-dev/host';
import type { DevelopmentProfile } from 'pi-controlled-dev/host';

const profile: DevelopmentProfile = {
  schemaVersion: 1,
  id: 'systemist_factory',
  common: ['Conserva i collegamenti alle fonti e distingui evidenza tecnica e valutazione sistemistica.'],
  phases: {
    ProjectPlanning: ['Esplicita le interfacce e collega gli incrementi ai requisiti forniti.'],
    Reviewer: ['Valuta le evidenze tecniche richieste senza dichiarare approvati requisiti sistemistici.'],
    IntegrationReview: ['Identifica eventuali lacune nelle evidenze richieste dal piano.'],
  },
};

export default createControlledDevExtension(profile);
```

Il wrapper è l'unica extension che registra il motore in quella sessione: non
caricare anche l'extension predefinita, che registrerebbe gli stessi comandi e
agenti. Il comando rimane `/controlled-dev`; alias `/syst` e orchestrazione
sistemistica non sono introdotti da questo punto di composizione. Senza profilo
il package conserva il comportamento predefinito.

Le skill di dominio possono essere fornite come testo selezionato esplicitamente
dal wrapper dal proprio package installato. Non viene ereditata automaticamente
la configurazione di skill, agenti o extension della cartella di lavoro.
Ogni lista contiene al massimo 16 testi, ciascuno fino a 4096 byte; l'intero
profilo è limitato a 32 KiB. Il profilo è un supplemento alla metodologia core:
non sostituisce i prompt dei ruoli e non configura strumenti, executor, permessi,
stati, storage o conferme. Schema errato e campi sconosciuti sono respinti.

Identità, digest e testi pertinenti del profilo entrano nel prompt effettivo,
usando il binding e le evidenze RPC esistenti. Non sono un'approvazione né una
prova che il modello abbia seguito la metodologia. Il profilo non è un record
di Project Memory: le decisioni tecniche prodotte dal design continuano a usare
proposte, adozione, supersessione, selezione e ricevute della memoria esistente.
I dati forniti dal profilo non acquistano automaticamente lo stato di decisioni
accettate. Cambiare profilo richiede una nuova istanza/sessione; i piani salvati
non vengono riscritti o invalidati automaticamente. Richiedere una nuova analisi
prima di usare una metodologia cambiata per lavoro già pianificato.

## Confine dell'adapter futuro

L'adapter Systemist dovrà inviare obiettivo, contesto con riferimenti alle fonti,
intenzione di scope, criteri e verifiche richieste al normale dialogo di
pianificazione. Questi dati restano proposte fino alla creazione e autorizzazione
host del piano/task. Non deve scrivere direttamente nello store Controlled Dev,
fabbricare capability o pilotare internamente Developer.

Il risultato da esporre all'adapter dovrà riferire gli artefatti esistenti: stato
del task, candidata, file cambiati, verifiche, scenari, review, rischi residui e
stato di integrazione. Systemist conserverà il collegamento fra il proprio run,
il piano, i task tecnici e le loro evidenze. La memoria software resta nel motore;
interpretazioni, tracciabilità e decisioni sistemistiche restano nel livello di
dominio. Non duplicare il motore di sviluppo né introdurre una seconda memoria
tecnica per personalizzare il comportamento.

L'API di richiesta/risultato sistemistico e il nuovo package non sono ancora
implementati. Il punto di composizione attuale prepara metodologia e skill per
fase, senza fingere già disponibile un adapter completo. Prima di ampliarlo,
verificare un percorso reale con modello e utente: richiesta, chiarimento,
design, task, sviluppo, review, memoria, recupero e restituzione delle evidenze.

## Verifica e limiti

I test del profilo verificano congelamento, separazione fra istanze e fasi,
limiti e rifiuto di campi di autorità. I test dei ruoli e dello Scout preliminare
controllano il testo inviato al provider e la conservazione dei contratti core.
Usano provider dichiaratamente simulati; i test Developer/Reviewer mantengono
repository Git e worktree reali. Non certificano un'esecuzione Systemist con
modello reale o l'integrazione del wrapper nel loader di una specifica versione Pi.
