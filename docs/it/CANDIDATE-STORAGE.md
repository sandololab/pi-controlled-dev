[English](../CANDIDATE-STORAGE.md) · **Italiano**

# Ridurre le copie salvate

Ogni candidato continua a descrivere l'intero albero dei file. I nuovi salvataggi
condividono i contenuti, identificati tramite SHA-256, nella cartella
`.controlled-dev/candidates/.objects`. Ogni candidato conserva il proprio
manifesto canonico originale e un piccolo `storage.json`. Per ripristinarlo
servono il suo manifesto e i contenuti condivisi richiamati: nessuna dipendenza
da candidati precedenti o da una catena di differenze. Contenuti, permessi e
impronte dei manifesti mantengono il significato originale.

È lo stesso principio usato da pi-editorial-factory per le parti ripetute della
cronologia, applicato qui ai sorgenti e alle risorse. Non viene copiata la sua
rotazione dei checkpoint: le prove dei candidati hanno obblighi di conservazione
diversi. Manifesti storici, eventi, file sconosciuti e oggetti non richiamati non
vengono eliminati automaticamente.

## Convertire le copie esistenti

Chiudere Pi normalmente a un checkpoint sicuro e riaprire il progetto con questo
package. Prima di riprendere il task scegliere **Reduce duplicate saved copies**
in `/controlled-dev menu`, oppure `/controlled-dev project reduce-storage`.
Il package richiede un progetto rilasciato e acquisisce il controllo esclusivo.
Verifica le copie, mostra quantità e risparmio stimato e chiede una conferma
nativa riferita a quell'inventario. Annullare conserva identici i dati e il
checkpoint di trasferimento. Non vengono chiamati modelli.

Lo stato distingue verifica, scrittura condivisa, rimozione dei duplicati e
verifica finale del trasferimento. Alt+I richiede una pausa dopo il file corrente:
una scrittura iniziata viene completata. L'inventario iniziale del namespace e
il sigillo finale restano sincroni e possono richiedere tempo. Ogni originale
viene rimosso solo dopo aver reso durevole e verificato la sua copia condivisa.
Una conversione in pausa resta leggibile e viene salvata per il trasferimento;
per proseguire occorrono inventario e conferma aggiornati. Perdita del controllo,
file inattesi o corruzione fermano la pulizia conservando gli originali residui:
preservare i file e consultare l'errore prima di riprovare.

Il resoconto diagnostico viene salvato nell'archivio esistente degli artifact di
pianificazione. Registra file e byte effettivamente rimossi, durata della
conversione, ricevuta nativa e zero chiamate ai modelli. I byte rimossi dalle
vecchie copie differiscono dal risparmio netto se è stato necessario scrivere
nuovi contenuti condivisi. Stato del task, risultati accettati, verifiche,
cronologia e tentativi consumati restano invariati.

## Compatibilità e trasferimento

Il lettore accetta sia le vecchie copie indipendenti sia il formato condiviso.
Quest'ultimo richiede **0.1.0-beta.3 o successiva**; i package precedenti non
sanno leggerlo. Installare una versione compatibile prima della ripresa su un
altro PC. Trasferire tutto il progetto, compresi `.git`, `.controlled-dev`
(in particolare `candidates/.objects`) e `Documentazione`. La sola cartella di
un manifesto non è un archivio trasferibile autonomo. Credenziali e processi
restano locali alla macchina. I task importati richiedono ancora le verifiche
e la conferma nativa previste per la ripresa.

Il ripristino verifica tutti i contenuti richiamati. Dopo la creazione della
copia Git iniziale conserva i file già identici invece di riscriverli; verifica
comunque il manifesto completo finale. La condivisione riduce lo spazio delle
copie conservate; controllare grandi alberi può restare costoso. Non dimostra
risposte più rapide dei modelli né il completamento del refactoring.

La chiusura normale riusa un checkpoint già rilasciato solo dopo aver verificato tutti i dati correnti, il commit dei sorgenti e i riferimenti dei task. La sola consultazione o una manutenzione già conclusa non richiedono di ricreare tutti i candidati salvati. Note personali modificate richiedono comunque un nuovo checkpoint.

## Candidato salvato dopo un arresto inatteso di Pi

**Resume transferred project** verifica anche un task importato interrotto durante
i controlli, quando candidato completo e stato corrente erano già stati salvati
in un checkpoint verificato. Controlla la fine del processo Pi, la coppia esatta
dei vecchi permessi, il registro dell'importazione e il collegamento accettato,
tutti i risultati dei modelli e il checkpoint completo. Prove mancanti, cambiate
o incomplete fermano questo percorso.

La prima proposta nativa chiude soltanto i vecchi permessi locali e conserva i
dati esatti per il trasferimento. Non riprende la vecchia cartella di lavoro né
dichiara terminato un eventuale comando locale precedente. La vecchia cartella
può essere indisponibile: il recupero legge la copia salvata. Una seconda
conferma ripristina una copia separata, conserva tutti i tentativi consumati e
invalida i vecchi controlli prima di nuove verifiche e revisione. La sola chiusura
dei permessi non avvia modelli.

Il recupero nella stessa cartella di lavoro resta prudente quando la fine dei
comandi locali non è provata. Un'esecuzione ambigua non autorizza a indovinare
l'esito di una riparazione. Usare la ripresa del progetto per esaminare una
proposta concreta e verificata; se non può essere preparata, conservare tutte
le evidenze.
