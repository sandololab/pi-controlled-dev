# Stato delle verifiche

[English](../VALIDATION.md) · **Italiano**

Questa è una beta di sviluppo. I fallimenti registrati alla prima pubblicazione sono stati analizzati e corretti. I resoconti storici e i controlli automatici correnti descrivono revisioni diverse.

## Verifica corrente — 18 ottobre 2026

La verifica finale copre **1.305 casi portabili distinti: 1.303 riusciti, 0 fallimenti residui, 2 saltati per impostazione predefinita**, combinando un giro completo e la riesecuzione finale della suite interessata. Il giro completo, considerato da solo, ha registrato **1.302 riusciti, 1 fallito, 2 saltati**. L'unico errore era in una fixture che eliminava e ricreava una cartella: il filesystem poteva riutilizzare lo stesso inode. Ora la fixture conserva la cartella originale fuori dal worktree e controlla che la sostituzione abbia un identificatore distinto; l'intera suite Scope Guard è poi riuscita **13/13**. Dopo il giro completo non è cambiato codice runtime. È una copertura combinata, non l'attestazione di un unico giro completo senza errori. Sono riusciti anche i controlli TypeScript, inventario del package, lingua inglese e installazione/reinstallazione in un profilo nativo Pi isolato. La prova verifica un'estensione, 12 skill e 3 prompt, e conferma che l'uso senza interfaccia non può aggirare la conferma nativa.

Verifica su Linux con Node.js 22.22.1, npm 9.2.0, TypeScript 5.9.3 e Pi nativo 1.3.0.

Il totale maggiore comprende i singoli casi delle suite che prima si fermavano durante l’importazione. L'esecuzione completa comprende tutti i file portabili elencati da `npm test`, con otto processi di test isolati. Ogni controllo usa fixture sintetiche, cartelle temporanee univoche e un profilo Pi separato. Il normale comando `npm test` esegue gli stessi file in sequenza.

I due test saltati per impostazione predefinita richiedono `CONTROLLED_DEV_TEST_SSD`. Sono stati eseguiti anche separatamente sul disco SSD effettivo: **2/2 riusciti**. Verificano byte, policy dei permessi di destinazione e rollback con conservazione delle Notes personali. Non certificano un altro sistema operativo o un workflow con modelli reali su un secondo computer.

## Correzioni

- La validazione dei contratti dipende dal modulo puro `runtime-root-mapping`. Il verificatore operativo continua a controllare artefatti, trascrizioni e prove di terminazione prima di registrare un collegamento locale al processo. I test mantengono una lista limitata di import e vietano dipendenze da filesystem, RPC e timer.
- La chiusura ordinata conserva ora la baseline verificata di un Developer fermatosi senza effetti. Trasferimenti ripetuti mantengono i byte originali delle evidenze e la storia dei contatori. La prova di recupero è legata all'importazione runtime corrente; un'autorizzazione READY ritirata richiede una nuova conferma nativa prima di ammettere un solo nuovo tentativo.
- Un artefatto di autonomia mancante nel namespace del task produce l'errore tipizzato di integrità già previsto. Le vecchie identità degli artefatti restano leggibili senza migrazioni o sostituzioni.
- Annullare prima dell'analisi evita di creare l'archivio dell'indagine. Una sostituzione di sessione non può pubblicare un task eseguibile. Le evidenze già registrate delle indagini in sola lettura restano disponibili; i test controllano che il segreto sintetico non finisca nei file persistenti.
- Le fixture di integrazione partono ora da un modulo valido e da controlli adottati già superati. I criteri di contenuto esatto del checkpoint richiedono ancora i componenti implementati. La simulazione RPC legge il pacchetto canonico separatamente dalle istruzioni aggiunte al ruolo.
- I test usano le etichette inglesi e i riferimenti effettivi ai gate consumati. La cancellazione dello Scout attende l'avvio reale della chiamata; i controlli della TUI riservano spazio ai comandi nativi Pi; casi di errore indipendenti hanno budget di indagine distinti. I test attendono la chiusura asincrona della sessione prima di rimuovere le fixture. I blocker reali vengono controllati prima dell'ammissione a READY.

Restano attivi scope, validazioni obbligatorie, review indipendente, conferme umane e limiti dei tentativi. Per questa revisione non si attesta una nuova accettazione con modelli reali. I controlli di installazione e caricamento usano un profilo nativo Pi isolato e risposte deterministiche di test.

## Storia conservata

La precedente baseline completa, prima della traduzione, registrava **1.055 test: 1.015 riusciti, 38 falliti, 2 saltati**. I successivi tentativi diagnostici e le riesecuzioni mirate restano conservati insieme ai log finali, alle impronte dei sorgenti e al commit pubblicato nell'archivio esterno dell'autore. Gli originali non sono stati riscritti per mostrare un successo successivo. Sessioni grezze, credenziali e log specifici del computer sono esclusi dal package pubblico.

I resoconti P15 e P16C restano storici. I loro precedenti PASS non sostituiscono le verifiche correnti riportate sopra.

## Riprodurre

Su Linux, con Node.js >=22.19.0, npm e Git:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm pack --dry-run --ignore-scripts
```

`test/product-install.test.mjs`, `test/recovery-historical.test.mjs` e `npm run test:pi-integration` richiedono dati o installazioni esterne espliciti. Non fanno parte della suite portabile: vedere README e file corrispondenti. La licenza resta `UNLICENSED` e la pubblicazione npm resta disabilitata.
