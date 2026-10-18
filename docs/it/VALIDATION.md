# Stato delle verifiche

[English](../VALIDATION.md) · **Italiano**

Questa è una beta di sviluppo, non una release stabile. Interfaccia inglese e documentazione bilingue non risolvono i problemi runtime preesistenti elencati sotto. I resoconti storici riguardano revisioni precedenti.

## Controlli per la pubblicazione — 18 ottobre 2026

La baseline completa della suite portabile prima della traduzione ha eseguito **1.055 test: 1.015 riusciti, 38 falliti, 2 saltati**, su Linux con Node.js 22.22.1 e TypeScript 5.9.3. È una baseline completa, non una certificazione positiva della release. Typecheck, creazione del package e prova isolata di installazione/caricamento nativo Pi sono riusciti. La prova di caricamento usa risposte sintetiche e non chiama modelli.

La revisione inglese verifica separatamente visualizzazione dello stato, conservazione dei testi letterali dell'utente e delle prove, collegamenti bilingui, 43 transizioni del protocollo, contenuto del package e test di interfaccia/flusso interessati. I log delle esecuzioni complete e mirate restano nell'archivio esterno dell'autore. I controlli interrotti dal limite di tempo sono distinti da quelli conclusi; un timeout non vale come successo.

### Controlli conclusi sulla revisione inglese

| Controllo | Risultato |
|---|---|
| Lingua, collegamenti, protocollo, memoria e note generate | 77/77 riusciti |
| Conferme, presentazione della promozione e stato | 30/30 riusciti |
| Conferma finale e riepilogo dell'autonomia | 2/2 riusciti |
| Verifica fallita → correzione entro i limiti → nuova verifica | 1/1 riuscito |
| Typecheck, package e installazione/reinstallazione nativa Pi isolata | Riusciti |
| Metadati, inventario e import dello scaffold | 5/6 riusciti; resta il problema noto del loader |

Il controllo runtime più ampio comprende suite con limite di tempo ed è seguito da correzioni e riesecuzioni mirate. Non viene presentato come una suite completa senza errori. I log conservano sia i tentativi non riusciti sia le verifiche finali positive.

## Problemi già presenti nella baseline

- Il caricatore dei test dei contratti rifiuta un'importazione operativa raggiunta attraverso `runtime-root-binding` (`Unapproved P4 module: pi-subagents-rpc`). Sono coinvolte varie suite contratti/ruoli/RPC/orchestratore/retry/scope e un test scaffold. Il confine del loader non viene ampliato soltanto per ottenere un risultato positivo.
- Alcune fixture di promozione del candidato e checkpoint di integrazione si fermano con `DISPATCH_OUTCOME_UNKNOWN` o `DEVELOPER_BASELINE_FAILED` prima della review prevista.
- Il trasferimento ripetuto può restituire una proposta con schema versione 1 dove il test bounded richiede la versione 2.
- Falliscono casi di limite del raffinamento, storia/identità dell'autonomia, worker di importazione runtime e alcune cancellazioni/sostituzioni di sessione nella UI. Un'asserzione sulla guida alla progettazione richiede una verifica separata.

Sono errori registrati, non garanzie di funzionamento. Finché restano aperti il package mantiene lo stato beta. I precedenti resoconti P15/P16 senza errori non certificano la revisione corrente.

## Riprodurre

Su Linux, con Node.js >=22.19.0, npm e Git:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm pack --dry-run --ignore-scripts
```

I test usano fixture sintetiche e directory temporanee univoche. Le prove native Pi richiedono un profilo isolato. I probe di installazione e recupero storico richiedono dati esterni espliciti e sono descritti nel README e nei rispettivi file; non fanno parte della suite portabile. Per questa pubblicazione non si attesta una nuova campagna con modelli reali o una nuova accettazione umana.
