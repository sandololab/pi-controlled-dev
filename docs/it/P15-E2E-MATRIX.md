# Campagna E2E P15 — registro delle evidenze

[English](../P15-E2E-MATRIX.md) · **Italiano**

> Resoconto storico. Conteggi, stato delle fasi e risultati PASS descrivono la campagna P15, non il package corrente. Vedere lo [stato attuale delle verifiche](VALIDATION.md). Le evidenze originali sono conservate nell'archivio privato.

Questo documento riporta un'esecuzione e non modifica il protocollo. **Risultato P15.4: PASS. Risultato della fase P15: PASS.** Al termine della campagna P16 non era iniziata; il task positivo completato restava un'evidenza storica in sola lettura.

## Livelli di evidenza

- **UNIT/FAKE**: output strutturati deterministici, processi/trasporti simulati o predicati isolati; non attestano modelli o host reali.
- **INTEGRATION**: Orchestrator di produzione, worktree Git e ScopeGuard reali, validazione Node e store/gate/verificatore persistenti, con ruoli e TUI simulati quando indicato. Non attesta una conferma umana reale.
- **REAL-HOST**: ruoli controllati Pi/pi-subagents e conferma umana nativa effettivi, supportati da evidenze persistenti.
- **REAL-HOST + fault injection**: ruoli reali seguiti da una modifica del candidato introdotta dall'host di prova. Non significa che il modello abbia violato spontaneamente lo scope.

I riferimenti automatici indicano titoli e file dei test della campagna. La baseline era 313/313, poi 314/314 con i nuovi casi, infine 315/315 dopo il chiarimento delle responsabilità dello Scout, senza fallimenti o skip. Typecheck, confezionamento, hash normativi, diff e audit risultavano PASS. Un tentativo di audit restituì HTTP 500: fu registrato come UNAVAILABLE, poi ripetuto con zero vulnerabilità. I log storici nella radice temporanea erano `p15-scout-boundary-tests.log`, `p15-scout-boundary-typecheck.log`, `p15-scout-boundary-hashes.log` e `p15-scout-boundary-audit.log`.

## Matrice

| ID | Scenario | Livello | Risultato atteso ed evidenza effettiva |
|---|---|---|---|
| E2E-01 | Percorso positivo entro limiti | REAL-HOST; INTEGRATION con ruoli/TUI simulati | COMPLETED, originale invariato, lock rilasciati e reload valido. PASS reale `p15-live-biF6Gs`, `real-host-positive-result.json`, `durable-verification.json`; test `terminal-evidence.test.mjs`, `P14F.7 durable affirmative...`. |
| E2E-02 | Approvazione di implementazione e completamento | REAL-HOST; INTEGRATION con ruoli/TUI simulati | Nessuno scrittore prima dell'autorizzazione; due gate consumati nel positivo reale. `P14G.3 TEST-042 both gate lifecycles complete through production bridge`. |
| E2E-03 | FAIL → rework autorizzato → PASS | INTEGRATION con ruoli/TUI simulati | REWORK, generazione 2, invalidazione storica e COMPLETED. `P15 E2E-03 integration...` usa worktree, verifiche host e finalizzazione reali. Byte finali uguali fra generazioni intenzionali; patch cumulativa non banale coperta da `scope-guard.test.mjs`, `P12.4 — cumulative rework preserves a.txt...`. |
| E2E-04 | Ampliamento dello scope o rifiuto | INTEGRATION con ruoli/TUI simulati | APPROVE → ANALYZING/nuova specifica; REJECT → FAILED senza installazione. `P14G.2A TEST-021...`, `P14G.2A onScopeChange REJECT...` e completamento con più gate. |
| E2E-05 | Decisione umana richiesta dall'Oracle | INTEGRATION con Oracle/TUI simulati | needsHumanDecision apre il gate; APPROVE conduce solo a BLOCKED/RECONCILE. `P14G.2B TEST-021 onOracleDecision...` copre le tre decisioni, il legame con l'episodio e l'assenza di autorità del parere. |
| E2E-06 | Esaurimento dei tentativi | INTEGRATION; UNIT/FAKE sulla policy | Solo continuazioni ammesse e registrate; limiti/contatori invariati; UNKNOWN non ritenta. `P14G.2B TEST-021 onRetryExhausted...`, `P14G.2B no retry gate...`, RET-001; nessuna nuova autorizzazione allo scrittore. |
| E2E-07 | Review parallele PASS/PASS | REAL-HOST PASS; UNIT/FAKE | Stesso candidato, review indipendenti e concorrenti, scrittore escluso, nessun completamento automatico. `p154-overlap-9859dr1b/real-host-overlap-result.json`: sovrapposizione conservativa 21.095 ms, prove terminali, candidato/originale invariati. Probe `orchestrator-host-probe.ts`, `PI_CONTROLLED_PARALLEL_PROBE=1`, fanout 2. Stato finale REVIEWING / COMPLETION_NOT_YET_AUTHORIZED. |
| E2E-08 | Disaccordo fra review parallele | UNIT/FAKE | PASS+FAIL → REWORK solo dopo quiescenza; PASS+BLOCKED → BLOCKED. `P13 — FAIL plus PASS is not a majority vote...`, `P13 — BLOCKED plus PASS...`, fallimento del fratello e UNKNOWN. |
| E2E-09 | Effetto fuori scope | INTEGRATION con ruolo simulato; REAL-HOST + fault injection PASS | BLOCKED, nessun Reviewer/completamento/retry, originale invariato. `P15 E2E-09 integration...` attraversa `implement()` e ScopeGuard. Probe esplicito `p15-negative-host-probe.ts`. PASS reale `p15-negative-5F88hD`, BLOCKED r13, byte/hash e reload verificati. I primi tentativi `p15-negative-rAchEi` e `p15-negative-hRLrKl` non raggiunsero l'iniezione e non valgono come PASS negativo. |
| E2E-10 | Output strutturato invalido | INTEGRATION con provider/contesto simulati | Rifiuto con errore tipizzato, nessuna scrittura di ripiego o retry implicito. `controlled-scout.test.mjs` e `production-bridge.test.mjs`, `P14F.4 command records typed failure...`. Nessuna attestazione reale di output invalido. |
| E2E-11 | UNKNOWN | INTEGRATION con errore iniettato; UNIT/FAKE | BLOCKED senza retry/scrittore/completamento, lock mantenuti. `P14G.2B UNKNOWN prevents either gate...`, casi P12 e bridge. `p15-live-KhlTl5` conserva INTENT irrisolto, non un recupero riuscito. |
| E2E-12 | Decisione umana obsoleta | INTEGRATION con TUI simulata | Rifiutata senza consumo; `P14F.7...`, `P14G.1 shared freshness...`, P14G.2A/2B TEST-019. |
| E2E-13 | Replay o falsa approvazione | INTEGRATION con ruoli/TUI simulati | Rifiutati riuso fra gate/task/specifica/candidato e doppio consumo; P14G TEST-019/020/021, storia con scope e ricevute locali al processo. |
| E2E-14 | Gate umano attraverso JSON/RPC | INTEGRATION con UI simulata | HUMAN_CHANNEL_UNAVAILABLE, nessuna autorità; `P14G.1 shared boundary rejects JSON/RPC...` e P14G.2B TEST-019/020. |
| E2E-15 | Manomissione terminale | INTEGRATION con ruoli/TUI simulati | Reload rifiuta corruzione di patch, autorizzazione, pacchetto terminale, decisione e catena eventi; `P14G.3A TEST-042/046 scoped multi-gate...`, casi materiali/legami/replay. |
| E2E-16 | Interruzione del gate | INTEGRATION con fault injection su commit/TUI | Pending o deciso ma non consumato resta incompleto; caricamento senza effetti di recovery. `P14G.3 TEST-046 interruption...`. Consume/resume è atomico; un falso mezzo-resume viene rifiutato, non dichiarato recuperabile. |
| E2E-17 | Autorizzazione superata, scope e gate correnti | INTEGRATION con ruoli/TUI simulati | Gate storico valido nella propria fase, autorizzazioni correnti valide e COMPLETED/reload. `P14G.3A TEST-042/046 scoped multi-gate...`: autorizzazione A, due cambi di scope, nuova autorizzazione allo scrittore, verifiche/review/conferma finale. |

## Evidenza positiva conservata

Campagna `p15-live-biF6Gs` nella radice temporanea del sistema. Task `p15-live-positive`, COMPLETED revisione 27. Scout, Developer e Reviewer terminali, nessun Oracle; entrambi i gate umani nativi consumati. RESOLVE_RISK persistito; tutte le 18 attestazioni CMP vere. HEAD, branch, index, byte/modi dei file tracciati e inventario untracked/ignored dell'originale coincidono con lo snapshot iniziale. Il candidato contiene `after\n`. I due file di lock sono assenti dopo il commit terminale; reload persistente in sola lettura PASS.

Hash autorizzazione: `a8c29d84579456c2c0cc6f8f643a89cdc90ed8d1da6ad4a1bfc5b5a16bb464d1`.
Hash terminale: `2d9c83c13993e90dfa77a341f5258679b5c77fc5c78325a328498ef649e1ef08`.

Gli hash sono diversi per costruzione: il terminale riferisce l'hash esatto dell'autorizzazione. Le successive modifiche di presentazione P14H non vengono attribuite retroattivamente a questa prova.

## Procedura negativa e confine di autorità

La prova usa repository, B0, task, percorso di controllo e copia esterna del package nuovi. Solo `allowed.txt` è autorizzato; `forbidden.txt` è tracciato e protetto. L'estensione esplicita attende il ritorno del Developer reale, registra un intent esterno e modifica `forbidden.txt` nel candidato isolato esatto. Non modifica ScopeGuard, risultati dei figli o originale, né fabbrica approvazioni. La cattura di produzione deve rifiutare l'effetto. Si riportano stato, run e lock effettivi: BLOCKED non viene forzato a FAILED, e i lock non si cancellano manualmente.

La prosa del parent, incluse richieste di merge/applicazione, non costituisce evidenza del workflow. I suoi strumenti restano in sola lettura. Il probe non espone strumenti o approvazioni chiamabili dal modello ed è escluso dall'archivio installabile.

## Evidenza negativa reale

`p15-negative-5F88hD`: **PASS REAL-HOST con fault injection controllata dall'host**, non violazione spontanea del modello. Evidenze: `scope-injection.json`, `durable-verification.json`, `real-host-negative-result.json`; controllo `verify-negative.py`, che crea il risultato in esclusiva senza sovrascriverlo.

`implement()` rifiuta con SCOPE_GUARD_FAILED. Stato persistente BLOCKED revisione 13, motivo `Candidate scope/integrity failed`. Scout e Developer TERMINAL con prove persistenti dei processi. Il gate beforeImplementation è approvato nativamente e consumato a event-r8. Il candidato contiene `allowed.txt=after\n` e i byte vietati corrispondenti all'hash di iniezione; nessun candidato viene ammesso. Nessun Reviewer, validazione, Oracle, rework o retry infrastrutturale. Originale invariato rispetto allo snapshot, compresi modi e file untracked/ignored. Entrambi i lock restano all'owner registrato; nessun rilascio o recovery.

L'operatore segnala anche errori/retry di fetch del parent e `subagents_enable` rifiutato con PARENT_MUTATION_ISOLATION. Non sono retry del workflow, autorizzazioni o prove di modifica: i dispatch persistenti restano esattamente due.

I tentativi precedenti restano conservati:

- `p15-negative-rAchEi`: l'iniezione non avvenne perché l'estensione separata usava un grafo di moduli diverso dalla classe di produzione. Stato AWAITING_HUMAN con Reviewer PASS, report di iniezione assente. È un errore del probe, non una prova di ScopeGuard. Il probe corretto compone la factory di produzione nello stesso grafo.
- `p15-negative-hRLrKl`: lo Scout dichiarò di non poter stabilire il diff cumulativo rispetto a HEAD. ADVISORY_REQUIRED lasciò ANALYZING r4, uno Scout terminale, nessun gate o Developer, originale invariato, reload PASS. L'iniezione non fu raggiunta. La formulazione successiva distingue verifiche host di ScopeGuard e ambiguità preimplementazione; le ambiguità restituite non vengono filtrate.

## Certificazione P15.4 della sovrapposizione reale

Report nella radice temporanea: `p154-overlap-9859dr1b/real-host-overlap-result.json`. Evidenze grezze `host-report.json`, `runtime.jsonl` e trascrizioni indipendenti in `sessions/`; controllo dalla campagna: `python3 verify-overlap.py`.

Nuova copia esterna, task `p154-overlap-9859dr1b`, destinazione `${TMPDIR}/controlled-orchestrator-real-5Ip6AK/original`, B0 `b78b5387887be29ae8a83719e400d3e8189a0f65`, nuovo namespace automatico dei lock. Cambia solo il taskId del probe, non il prodotto. Scout e Developer terminano, ScopeGuard ammette la generazione 1 e la validazione host passa prima della review. Il comando del probe è `/usr/bin/true`; byte esatti della fixture sono anche verificati dall'host e dai due Reviewer. La prova certifica sovrapposizione, non qualità del comando né completamento persistente.

Le sessioni ricevono il candidato `fc65c407e6b99c03b4aad3e9104c772063d1db05022a9f4b4833fcd9d41fc11d`, generazione 1, specifica `286373dbe3f39ffe4ebf823b5c77674fdb2c349f55079822e3876a12af77a75c` e identiche evidenze di validazione. Assignment/attempt/request/run ID distinti e prove terminali sono nel report. Strumenti limitati a `read` e `structured_output`; nessuna storia, output o comunicazione fra pari.

Finestre UTC conservative, dal primo risultato read alla fine di structured_output:

- A `2bc68b86-8916-47d6-823d-b79368d17e40`: `2026-09-28T16:56:51.600Z` → `2026-09-28T16:57:18.802Z`, PASS.
- B `9470ab34-208e-40b3-a983-4a5f7576338d`: `2026-09-28T16:56:57.707Z` → `2026-09-28T16:57:23.176Z`, PASS.
- Entrambe le disuguaglianze di sovrapposizione valgono: **21.095 ms**. Il report conserva anche avvii e osservazioni terminali attribuite; non sono tempi dichiarati dal modello.

Durante la review il guard host rifiuta lo scrittore con ORCHESTRATOR_STATE_INVALID senza cambiare contatori. Il budget ammette tutto il batch prima degli intent: 2 usati + 2 richiesti <= 8. Tentativi, dispatch e RunRecord distinti portano i totali da 2 a 4. L'aggregazione attende tutti i risultati, tratta BLOCKED/FAIL senza voto di maggioranza e restituisce COMPLETION_NOT_YET_AUTHORIZED. Entrambi i Reviewer sono terminali prima dell'accettazione; nessuna continuazione o chiusura del task. Inventari e digest del candidato pre/post coincidono. HEAD/index/byte/modi/inventario dell'originale T0–T3 coincidono, compresi untracked/ignored; i metadati di registrazione worktree non vengono scambiati per modifiche del checkout. Lock conservati, nessun reclaim/recovery.

## Verifica finale storica P15.4

**315/315 PASS**, zero fallimenti, skip o cancellazioni; typecheck, confezionamento, hash normativi e diff PASS. Audit finale PASS con zero vulnerabilità. Log in `final-verification-retry/`, audit positivo `audit-retry.json`. Un primo errore era la regola sui percorsi locali nel resoconto, corretta con riferimenti portabili. HTTP 500 dell'audit fu conservato come indisponibilità e seguito da un successo; non fu contato PASS. La prima invocazione della baseline superò il limite del chiamante: il rerun completo riuscì prima dell'avvio delle fixture.

La matrice è completa ai livelli dichiarati. Le prove positive/negative reali restano PASS; P2–P14 PASS. Nessuna funzionalità o hash normativo cambiò in quella fase. Fase successiva allora autorizzata: P16; **fase successiva iniziata: no**.

## Confine storico con P16

- Le due prove negative non riuscite rimangono non-PASS: non riprendere automaticamente `p15-negative-hRLrKl` o `p15-negative-rAchEi` e non cancellarne i lock. L'isolamento del loader fu riprodotto: stessa classe nello stesso grafo, identità diversa fra estensioni. Caricare solo il probe negativo combinato e pi-subagents; ogni prova usa B0/repository/task/copia esterna nuovi.
- P15.4 chiude la prova mancante di sovrapposizione P13: **TEST-041 PASS; UV-012 VERIFIED** per questa campagna. Il risultato supera il precedente stato non verificato senza modificare documenti/hash normativi congelati.
- Le simulazioni di integrazione conservano il loro livello e non diventano prove reali retroattivamente.
- Reclaim dei lock obsoleti, takeover, riconciliazione fra riavvii, riparazione WAL e recovery di INTENT interrotto erano **rinviati a P16**. Store e lock interrotti restano conservati.
