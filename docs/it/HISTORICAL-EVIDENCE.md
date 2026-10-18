[English](../HISTORICAL-EVIDENCE.md) · **Italiano**

# Evidenze storiche del package

Il repository pubblico parte da una selezione dei sorgenti del 18 ottobre 2026. La cronologia di sviluppo precedente e le evidenze delle prove reali sono conservate integralmente negli archivi locali dell’autore e non sono pubblicate.

Gli archivi comprendono le verifiche reviewer/recovery e runtime/osservabilità, il precedente manuale PDF, il wizard ritirato e i test precedenti. Gli originali conservano byte, date, risultati e hash senza riscrivere le prove storiche. Nella copia pubblica della documentazione architetturale sono omessi percorsi personali e identificativi locali; le regole del protocollo non sono modificate.

Questi materiali non sono dipendenze del package né prerequisiti dei test portabili. Le attestazioni storiche non certificano la revisione corrente: per questa consultare [VALIDATION.md](VALIDATION.md).

Le prove su proposta, correzione, chiarimenti e mancata approvazione del vecchio wizard sono trasferite all’ingresso corrente in `test/current-project.test.mjs`. Le prove del motore bootstrap, della promozione e del checkpoint restano in `test/greenfield-bootstrap.test.mjs` e `test/greenfield-e2e.test.mjs`.

Il probe facoltativo `test/recovery-historical.test.mjs` richiede un archivio esterno indicato esplicitamente tramite `P16A_HISTORICAL_DATA_ROOT`. Non fa parte di `npm test` e non richiede di rendere pubblici dati reali.
