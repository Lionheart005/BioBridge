---
name: biobridge-local
description: Führt den vollständigen 5-Phasen-BioBridge-Workflow lokal über das Antigravity-Abo (ohne externe LLM-API-Keys) mit streng isolierten Subagenten/Swarm-Workern und deterministischer Zitat- & Regelprüfung durch und erzeugt eine direkt importierbare .biobridge.json-Datei.
---

# BioBridge Local Workflow (Antigravity-Abo-Brücke)

Dieser Skill orchestriert die komplette BioBridge-Forschungspipeline lokal über dein Antigravity-Abo — **ohne externe LLM-API-Keys** und mit **100 % identischer deterministischer Zitatverifikation und Anti-Sycophancy-Bewertung** wie in der BioBridge-Web-App.

---

## Verbindliche Grundregeln (Epistemische Hygiene)

1. **KEIN Internet-Zugriff (`search_web` strikt verboten):** Während der gesamten Analyse dürfen keinerlei Websuchen durchgeführt werden. Alle Aussagen, Mechanismen und Zitate stammen ausschließlich aus den eingelesenen Quelldokumenten.
2. **Strikte Blind-Isolation in Phase 2:** Der Biologie-Worker darf niemals Technik-Chunks sehen; der Technik-Worker darf niemals Biologie-Chunks sehen.
3. **Isolierter Advocatus Diaboli in Phase 4:** Der Gutachter darf den Phase-3-Kontext (Ideengeber-Argumentation) nicht erben. Nutze zwingend einen brandneuen, isolierten Subagenten/Swarm-Worker.
4. **Maximal 1× Self-Correction-Runde:** Fehlgeschlagene Zitate dürfen genau einmal anhand von `nearbySourceText` korrigiert oder ehrlich mit `"retracted": true` zurückgezogen werden.

---

## Die 5 Phasen im Detail

### Phase 1 · Deterministische CLI-Ingestion

Wähle einen kurzen Run-Slug (z. B. `runs/haifisch-turbinen`) und führe die lokale Ingestion aus:

```bash
npm run cli -- ingest --bio <pfad_bio_1> [--bio <pfad_bio_2>] --tech <pfad_tech_1> [--tech <pfad_tech_2>] --out runs/<slug>
```

Ergebnis in `runs/<slug>/`:
- `documents.json`, `parsedPages.json`, `manifest.json`
- `chunks/bio/<docId>_chunk_<idx>.txt` (mit `[[PAGE:N]]`-Markern & Metadaten-Header)
- `chunks/tech/<docId>_chunk_<idx>.txt`

---

### Phase 2 · Strikte Blind-Extraktion & 1× Zitat-Verifikation

Spawne **zwei getrennte, frische Worker/Subagenten** (z. B. über `swarm` oder `invoke_subagent`):

1. **Worker A (`bio-extractor`):**
   - **Darf ausschließlich** `runs/<slug>/chunks/bio/*` lesen (**verboten:** `chunks/tech/*`).
   - Befolgt die Instruktionen aus `src/prompts/defaults/extractBio.prompt.ts`.
   - Schreibt `runs/<slug>/raw_biology.json`.

2. **Worker B (`tech-extractor`):**
   - **Darf ausschließlich** `runs/<slug>/chunks/tech/*` lesen (**verboten:** `chunks/bio/*`).
   - Befolgt die Instruktionen aus `src/prompts/defaults/extractTech.prompt.ts`.
   - Schreibt `runs/<slug>/raw_technology.json`.

Führe anschließend für beide Domänen die deterministische Zitatprüfung aus:

```bash
npm run cli -- verify --run runs/<slug> --domain biology --input runs/<slug>/raw_biology.json
npm run cli -- verify --run runs/<slug> --domain technology --input runs/<slug>/raw_technology.json
```

**Falls `Failed > 0` im `verification_report_<domain>.json`:**
- Gib dem jeweiligen Extraktions-Worker ausschließlich die `failedQuotes` (inkl. `nearbySourceText` der Seiten `N-1..N+1`).
- Der Worker entscheidet pro Zitat:
  - **`CORRECT_QUOTE`:** Ersetzt `quoteOriginal` durch den exakten wörtlichen Substring (mind. 1 vollständiger Satz) und korrigiert `pageNumber`, ODER
  - **`RETRACT_HALLUCINATION`:** Setzt `"retracted": true` und `"retractionReason": "..."`.
- Starte exakt **1×** die zweite Verifikationsrunde:

```bash
npm run cli -- verify --run runs/<slug> --domain biology --input runs/<slug>/raw_biology.json --attempt 2
npm run cli -- verify --run runs/<slug> --domain technology --input runs/<slug>/raw_technology.json --attempt 2
```

---

### Phase 3 · Kombinatorische Kreuzung (Ideengeber-Worker)

Spawne einen **frischen Subagenten/Worker** (`crossing-architect`):
- Liest `runs/<slug>/verified_biology.json` und `runs/<slug>/verified_technology.json`.
- Befolgt `src/prompts/defaults/crossing.prompt.ts` (Swanson-ABC / Bisociation, keine Sprachmetaphern, explizite `keyAssumptions` und `potentialFailureModes`).
- Referenziert reale `mechanismId`, `problemId`, `mechanismCitationIds` und `problemCitationIds`.
- Schreibt `runs/<slug>/candidates.json`.

---

### Phase 4 · Isolierter Advocatus Diaboli (Cross-Model empfohlen!)

Spawne einen **brandneuen, vollständig isolierten Subagenten/Worker** (`devils-advocate`):
- **Cross-Model-Tipp:** Falls `swarm` verfügbar ist, nutze hier bewusst ein **anderes Modell** als in Phase 3 (z. B. `claude-opus-5-5-high` oder `claude-sonnet-5-5-high` gegen `gemini-4-neon-high`), um Modell-Sycophancy zu brechen!
- Darf **keinen** Phase-3-Kontext erben. Liest ausschließlich `runs/<slug>/candidates.json` sowie die zugehörigen verifizierten Originalzitate aus `verified_biology.json` & `verified_technology.json`.
- Befolgt `src/prompts/defaults/critic.prompt.ts`:
  - **70–90 % Ablehnungsquote** ist explizit erwünscht (`REJECTED_METAPHOR`, `REJECTED_SCALING`, `KNOWN_STANDARD`, `REJECTED_EVIDENCE`).
  - `criticalCounterarguments` ist **Pflicht** (mindestens 1 nicht-leeres technisches Gegenargument pro Kandidat).
- Schreibt `runs/<slug>/raw_reviews.json`.

---

### Phase 5 · Deterministisches Bundle & UI-Import

Führe das finale CLI-Kommando aus (wendet `enforceDeterministicReviewRules` auf jedes Review an und validiert via `exportProjectBundle`):

```bash
npm run cli -- build-bundle --run runs/<slug> --name "<Experiment Name>" --language de --strategy cluster-batch --critic-model "<modell-id>" --export-md --export-csv
```

Melde dem Nutzer anschließend die erzeugten Dateien (`runs/<slug>/experiment.biobridge.json`, `report.md`, `matrix.csv`) und weise auf den 1-Klick-Import in der BioBridge-Web-App hin (`npm run dev` → Tab 1 Setup / Tab 4 Bewertungsmatrix → „Importieren (.biobridge.json)“).

---

## Kompakte JSON-Referenzschemata

### `raw_biology.json`
```json
{
  "mechanisms": [
    {
      "id": "mech_1",
      "title": "Riblet-Struktur der Haifischhaut",
      "biologicalSystem": "Elasmobranchii (Placoid-Schuppen)",
      "structure": "Längsgerichtete Mikro-Rillen im Abstand von 50-100 µm",
      "workingPrinciple": "Begrenzung querverlaufender Wirbelbildung in der viskosen Unterschicht",
      "achievedEffect": "Reduktion des turbulenten Reibungswiderstands um bis zu 8 %",
      "boundaryConditions": {
        "spatialScale": "50-100 µm Rillenabstand",
        "timeScale": "kontinuierlich stationär",
        "medium": "Wasser (inkompressibel)",
        "energyForm": "passiv hydrodynamisch",
        "operatingConstraints": "Re > 10^5, geringe Verschmutzung"
      },
      "functionalAbstract": "Passive Mikrostrukturierung einer Grenzfläche zur Dämpfung queraxialer Impulsübertragung in turbulenten Strömungen.",
      "citations": [
        {
          "documentId": "<docId aus manifest/chunk>",
          "pageNumber": 2,
          "sectionPath": "2.1 Hydrodynamik",
          "quoteOriginal": "Exakter vollständiger Originalsatz aus dem Chunk."
        }
      ]
    }
  ]
}
```

### `raw_technology.json`
```json
{
  "problems": [
    {
      "id": "prob_1",
      "title": "Reibungsverluste in Verdichterstufen",
      "technicalDomain": "Strömungsmaschinen / Turbomaschinen",
      "problemStatement": "Turbulente Grenzschichtablösung an Verdichterschaufeln senkt den Wirkungsgrad.",
      "coreBottleneck": "Hoher Wandschubspannungsverlust bei hohen Reynoldszahlen",
      "targetMetrics": "Reduktion des Profilverlusts um > 3 %",
      "currentApproachesAndLimits": "Polierte Oberflächen erreichen physikalisches Limit der glatten Wand.",
      "boundaryConditions": {
        "spatialScale": "Schaufellänge 10-30 cm",
        "timeScale": "stationär / hochfrequent",
        "medium": "Luft / Gas",
        "energyForm": "aerodynamisch",
        "operatingConstraints": "Hohe Temperatur, Erosionsrisiko"
      },
      "functionalNeedAbstract": "Reduktion der turbulenten Wandschubspannung an angeströmten Profilen ohne aktive Energiezufuhr.",
      "citations": [
        {
          "documentId": "<docId aus manifest/chunk>",
          "pageNumber": 1,
          "sectionPath": "1. Problemstellung",
          "quoteOriginal": "Exakter vollständiger Originalsatz aus dem Tech-Chunk."
        }
      ]
    }
  ]
}
```

### `candidates.json`
```json
{
  "candidates": [
    {
      "id": "cand_1",
      "mechanismId": "mech_1",
      "problemId": "prob_1",
      "bridgeTitle": "Mikro-Riblets auf Verdichterschaufeln zur Grenzschichtstabilisierung",
      "abstractTransferLogic": "Passive Dämpfung queraxialer Wirbelstrukturen in der viskosen Unterschicht reduziert den turbulenten Impulsaustausch.",
      "proposedImplementationSketch": "Laserstrukturierte Längsrillen (skaliert auf viskose Länge y+ ≈ 15 in Luft) entlang der Saugseite.",
      "keyAssumptions": ["Visco-Skalierung y+ bleibt im Betriebspunkt konstant"],
      "potentialFailureModes": ["Erosion/Fouling der Mikro-Rillen durch Partikel im Luftstrom"],
      "mechanismCitationIds": ["mech_1_cit_1"],
      "problemCitationIds": ["prob_1_cit_1"]
    }
  ]
}
```

### `raw_reviews.json`
```json
{
  "reviews": [
    {
      "candidateId": "cand_1",
      "scores": {
        "mechanismDepth": 3,
        "scalabilityAndConstraints": 1,
        "technicalValue": 2,
        "novelty": 0,
        "evidenceQuality": "PASS"
      },
      "knownPriorArt": "Riblets auf Flugzeugtragflächen und Turbinenschaufeln sind etablierte Forschung (z. B. Bechert et al.).",
      "criticalCounterarguments": [
        "In Gas-Verdichtern führt Partikelerosion rasch zur Abstumpfung der scharfen Riblet-Spitzen und kehrt den Effekt um."
      ],
      "openHurdles": ["Langzeit-Erosionsbeständigkeit bei > 400 °C"],
      "verdictSummary": "Physikalisch fundiert, aber als bekannter Standard mit hoher Erosionsanfälligkeit einzustufen."
    }
  ]
}
```
