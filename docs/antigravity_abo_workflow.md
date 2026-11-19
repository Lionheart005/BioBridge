# BioBridge über das Antigravity-Abo nutzen (ohne externe API-Keys)

Mit der lokalen **Antigravity-Abo-Brücke** kannst du die komplette 5-Phasen-Forschungspipeline von BioBridge (Blind-Extraktion, deterministische Zitatprüfung, Kreuzung, isolierter Advocatus Diaboli und Regelwerk-Auswertung) **kostenlos über dein bestehendes Antigravity-Abo** ausführen — ganz ohne OpenAI-, Anthropic- oder Gemini-API-Keys.

## Warum das genauso streng ist wie die Web-App

Alle kritischen Qualitäts- und Sicherheitsprüfungen laufen **deterministisch in TypeScript** über dieselben Kernmodule wie die BioBridge-Web-App:
- **Ingestion & Chunking:** `ingestDocument` & `chunkDocumentPages` (`.pdf`, `.docx`, `.md`, `.txt` inkl. `[[PAGE:N]]`-Marker)
- **Zitatverifikation:** `verifyCitationAgainstPages` (3-stufige Kaskade: Exact → Normalized → Fuzzy)
- **Anti-Sycophancy & K.O.-Regeln:** `enforceDeterministicReviewRules` (Beleg-K.O., Metapher-Deckelung ≤ 2, Skalierungs-Deckelung ≤ 3)
- **Bundle-Export:** `exportProjectBundle` erzeugt eine zu 100 % kompatible `.biobridge.json`-Datei.

---

## Schritt 1: Quelldokumente ablegen

Lege deine biologischen und technischen Quelldokumente in einem Projektordner ab, z. B.:
- `input/bio/` (z. B. `haifischhaut.pdf`, `termite_ventilation.md`)
- `input/tech/` (z. B. `verdichter_engpass.pdf`, `rechenzentrum_kuehlung.docx`)

---

## Schritt 2: In Antigravity den Skill `biobridge-local` starten

Öffne den Workspace in Antigravity und kopiere einfach folgenden Prompt in den Chat (passe nur die Pfade und den Experimentnamen an):

```text
Nutze den Skill biobridge-local und führe ein vollständiges BioBridge-Experiment durch:
- Biologie-Quellen: input/bio/haifischhaut.pdf
- Technik-Quellen: input/tech/verdichter_engpass.pdf
- Run-Ordner: runs/haifisch-verdichter
- Experimentname: "Haifischhaut vs. Verdichter-Grenzschicht"

Wichtig: Halte die strikte Blind-Isolation zwischen Bio- und Tech-Worker ein und nutze für Phase 4 (Advocatus Diaboli) nach Möglichkeit ein anderes Modell als in Phase 3 (Cross-Model-Review).
```

> **Cross-Model-Tipp:** Wenn du in Phase 3 (Ideengeber) z. B. Gemini und in Phase 4 (Advocatus Diaboli) ein Claude-Modell über den Swarm einsetzt, vermeidest du „Selbst-Bestätigung“ zwischen Ideengeber und Gutachter noch effektiver.

---

## Schritt 3: 1-Klick-Import in die BioBridge-Web-App

Am Ende des Laufs erzeugt die CLI im Ordner `runs/<slug>/`:
- `experiment.biobridge.json` (komplettes Projekt-Bundle)
- `report.md` (formatierter Markdown-Forschungsbericht)
- `matrix.csv` (Excel-kompatible Bewertungsmatrix mit UTF-8 BOM)

So lädst du das Ergebnis in die interaktive BioBridge-Oberfläche:
1. Starte die Web-App:
   ```bash
   npm run dev
   ```
2. Öffne die App im Browser und wechsle in **Tab 1 (Setup)** oder **Tab 4 (Bewertungsmatrix)**.
3. Klicke auf **„Importieren (.biobridge.json)“** und wähle `runs/<slug>/experiment.biobridge.json`.
4. Alle Dokumente, verifizierten Originalzitate, Kandidaten und Bewertungen stehen sofort interaktiv mit Zitat-Inspektor und Markdown/CSV-Export zur Verfügung.

---

## CLI-Kurzreferenz (für manuelle Aufrufe)

```bash
# Hilfe anzeigen
npm run cli -- --help

# 1. Dokumente einlesen & in Chunks aufteilen
npm run cli -- ingest --bio input/bio/a.pdf --tech input/tech/b.md --out runs/mein-lauf

# 2. Zitate deterministisch prüfen (Runde 1 & optional Runde 2 nach Self-Correction)
npm run cli -- verify --run runs/mein-lauf --domain biology --input runs/mein-lauf/raw_biology.json
npm run cli -- verify --run runs/mein-lauf --domain biology --input runs/mein-lauf/raw_biology.json --attempt 2

# 3. Deterministische Regeln anwenden & .biobridge.json + report.md + matrix.csv erzeugen
npm run cli -- build-bundle --run runs/mein-lauf --name "Mein Experiment" --export-md --export-csv
```
