# BioBridge Kalibrierungs- & Eval-Harness (`eval/`)

Dieses Verzeichnis enthält das automatisierte Kalibrierungs-Harness für BioBridge. Es prüft die gesamte 5-Phasen-Pipeline (Ingestion, Blind-Extraktion, deterministische Zitat-Verifikation, Dual Crossing Engine, isolierter *Advocatus Diaboli* und deterministische Scoring-Regeln) gegen vier kuratierte Kalibrierungs-Fixtures.

---

## 1. Die 4 Kalibrierungs-Fixtures (`eval/datasets/`)

| Datei | Kategorie | Inhalt (Biologie × Technik) | Ziel-Kalibrierung |
| :--- | :--- | :--- | :--- |
| `positive_ants_autoscaling.json` | `positive_control` | Ernteameisen (*Pogonomyrmex barbatus*) mit lokaler Antennen-Kontaktfrequenz & Aktivierungsschwellen-Formel × dezentrales Edge-Cluster-Autoscaling bei WAN-Ausfällen | `PROMISING`, Top-Score ≥ 7 |
| `known_classic_aco_routing.json` | `known_classic` | Ameisen-Pheromonspuren mit Verdunstungsrate $\frac{d\tau_{ij}}{dt}$ × dynamisches Paket-Routing in Telekommunikationsnetzen | `KNOWN_STANDARD`, `novelty === 0` |
| `metaphor_trap_queen_master.json` | `metaphor_trap` | Ameisenkönigin (reine Eiablage/Fertilitätssignale, **keine** zentrale Steuerung) × zentraler Kubernetes Control-Plane / Master-Node | `REJECTED_METAPHOR`, `mechanismDepth === 0`, Score ≤ 2 |
| `distant_domain_calibration.json` | `distant_domain_calibration` | Pilzsporen-Ausbreitung (*Pilobolus*-Turgor, Buller-Tropfen, Myzel-Schwellenwerte) × kommunales Steuer- & Betriebsprüfungsrecht mit bewussten Scheinparallelen („Netzwerk“, „Verteilung“, „Schwellenwert“, „Prüfung“) | Ablehnungsrate ≥ 80 % (`minRejectionRate: 0.8`) |

---

## 2. Ausführung

### Offline-Test / CI-Modus (`--mock`)

Läuft komplett ohne API-Key oder Internetzugriff. Nutzt `fake-indexeddb/auto`, `ingestDocument`, `PipelineOrchestrator` sowie `DirectBrowserTransport` mit einem deterministischen Mock-`fetchFn`, sodass Adapter-Formatierung, No-Web-Search-Guard, strukturierte Schemas, Zitatprüfung und K.O.-Regeln 1:1 durchlaufen werden:

```bash
npm run eval -- --mock
```

Optional lässt sich ein einzelner Case filtern:

```bash
npm run eval -- --mock --case positive_ants_autoscaling
```

Hilfe anzeigen (Exit-Code 0):

```bash
npm run eval -- --help
```

### Live-API-Modus (Kalibrierung gegen echte LLMs)

Ohne `--mock` prüft das Harness die echten Prompts und Modelle über `DirectBrowserTransport` (inkl. striktem No-Web-Search-Guard):

```bash
# Linux / macOS
export BIOBRIDGE_PROVIDER="gemini"
export BIOBRIDGE_API_KEY="dein-api-key"
npm run eval
```

```powershell
# Windows PowerShell
$env:BIOBRIDGE_PROVIDER="gemini"
$env:BIOBRIDGE_API_KEY="dein-api-key"
npm run eval
```

#### Unterstützte Umgebungsvariablen

| Variable | Pflicht (ohne `--mock`) | Beschreibung | Standard |
| :--- | :--- | :--- | :--- |
| `BIOBRIDGE_PROVIDER` | Nein | `gemini` \| `openai` \| `anthropic` \| `openrouter` \| `custom` | `gemini` |
| `BIOBRIDGE_API_KEY` | Ja (außer `custom`) | API-Schlüssel des gewählten Anbieters | — |
| `BIOBRIDGE_EXTRACTION_MODEL` | Nein | Modell-ID für Phase 2 (Extraktion) | Provider-Default |
| `BIOBRIDGE_CROSSING_MODEL` | Nein | Modell-ID für Phase 3 (Kreuzung / Clustering) | Provider-Default |
| `BIOBRIDGE_CRITIC_MODEL` | Nein | Modell-ID für Phase 4 (Advocatus Diaboli) | Provider-Default |
| `BIOBRIDGE_EMBEDDING_MODEL` | Nein | Modell-ID für Embeddings (Phase 3A) | Provider-Default |
| `BIOBRIDGE_STRATEGY` | Nein | `embedding-hybrid` \| `cluster-batch` | `embedding-hybrid` (bei `anthropic`/`custom`: `cluster-batch`) |
| `BIOBRIDGE_BASE_URL` | Nein | Eigene Basis-URL (z. B. `http://localhost:11434/v1` für Ollama) | Provider-Default |

---

## 3. Interpretation der Metriken im Bericht

Der tabellarische Abschlussbericht zeigt pro Kalibrierungs-Case und in der Gesamtzusammenfassung:

- **Status Distribution:** Anzahl erzeugter Bewertungen je `VerdictStatus` (`PROMISING`, `NEEDS_CHECK`, `KNOWN_STANDARD`, `REJECTED_METAPHOR`, `REJECTED_SCALING`, `REJECTED_EVIDENCE`, `RETRACTED`).
- **Top (Score):** Höchster gewichteter Gesamtscore (`0.0–10.0`) im jeweiligen Case. Bei Scheinmetaphern muss dieser auf `≤ 2.0` gedeckelt bleiben.
- **Verif. (Verification Rate):** Anteil der extrahierten Originalzitate, die deterministisch oder per Self-Correction (`VERIFIED_*` / `CORRECTED_VERIFIED`) im Quelltext belegt werden konnten. Ziel: **≥ 90–100 %**.
- **Retr. (Retraction Rate):** Anteil der Zitate, die im Self-Correction-Loop als Halluzination zurückgezogen wurden (`RETRACTED_HALLUCINATION`). Zeigt ehrliche Selbstkorrektur bei grenzwertigen Extraktionen.
- **Rej. (Rejection Rate):** Anteil der Hypothesen mit Ablehnungsstatus (`REJECTED_METAPHOR`, `REJECTED_SCALING`, `REJECTED_EVIDENCE`, `RETRACTED`). Im `distant_domain_calibration`-Set muss diese Rate **≥ 80 %** betragen, um Sycophancy auszuschließen.
- **Cost ($):** Tatsächlich erfasste Token-Kosten laut `CostLedger` und `pricingCatalog.ts`.
- **Result (`PASS` / `FAIL`):** Prüft alle Erwartungen aus `expectations` im Dataset. Der Prozess beendet mit Exit-Code `0`, wenn alle Cases bestehen, sonst `1`.
