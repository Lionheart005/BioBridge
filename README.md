# BioBridge — Bionik-Kreuzungslabor

**BioBridge** ist eine *Local-First*-Web-App (React + TypeScript + IndexedDB + Web Worker) zur systematischen, wissenschaftlich belegten Ideenfindung zwischen **Biologie (Domäne A)** und **Technik (Domäne B)**.

Statt oberflächlicher Chat-Metaphern erzwingt BioBridge eine **5-Phasen-Prüfpipeline**:
1. **Multi-Format-Parsing:** Liest `.pdf` (spaltenbewusstes XY-Cut-Layout), `.docx` (inkl. Word-Formeln `OMML → LaTeX`), `.md` und `.txt` lokal ein.
2. **Strikte Blind-Extraktion:** Biologie und Technik werden vollständig getrennt ausgewertet — keine Seite kennt die andere.
3. **Deterministische Zitatprüfung:** Jedes Originalzitat wird programmatisch gegen den Quelltext geprüft (`Exact → Normalized → Fuzzy ≥ 0.88`, inkl. Seitenumbruch `N±1` und 1× ehrlicher Self-Correction / Retraction).
4. **Kreuzungs-Engine & Isolierter *Advocatus Diaboli*:** Zwei wählbare Strategien (*Embedding-Matching* oder *Thematisches Clustering*) sowie ein isolierter Gutachter mit harten K.O.-Regeln gegen Schein-Metaphern, Skalierungsbrüche und bekannte Klassiker. **Web-Search durch LLMs ist strikt gesperrt.**
5. **Interaktive Bewertungsmatrix:** Filterbar nach Score/Status, Dual-Beleg-Ansicht mit KaTeX-Formeln & aufklappbarem Absatzkontext sowie Export (`.md`, `.csv`, `.biobridge.json`).

---

## Schnellstart

Voraussetzung: **Node.js ≥ 20**

```bash
npm install
npm run dev
```

Die App läuft lokal unter `http://localhost:5173/`. Im Tab **Setup** kannst du über **„Demo-Experiment laden“** sofort alle Funktionen (inkl. Dark Mode, Bewertungsmatrix & Dual-Beleg-Ansicht) ohne API-Key testen.

---

## Zwei Wege zur Nutzung

### Weg 1: Direkt im Browser mit API-Key (BYOK)

Ideal für den direkten Einsatz im Browser oder für nicht-technische Nutzer:

1. Öffne in der App **5. Einstellungen & Prompts → API-Keys & Modelle**.
2. Hinterlege deinen eigenen API-Key (**Google Gemini**, **OpenAI**, **Anthropic Claude**, **DeepSeek**, **OpenRouter** oder lokales **Ollama**).
   - Keys bleiben lokal in `sessionStorage` (Standard für geteilte Rechner) oder `localStorage`.
3. Wähle pro Rolle Modell und **Denktiefe** (`Auto / Low / Medium / High / Extreme`) oder eines der Presets (*Sparsam*, *Ausgewogen*, *Maximale Tiefe / Cross-Model*).
4. Ziehe im **Setup** deine Biologie- und Technik-Dokumente in die beiden Dropzones, prüfe die **Pre-Flight-Kostenschätzung** (inkl. optionalem Budget-Limit) und starte den Lauf.

> **CORS-Hinweis:** Gemini, OpenAI, DeepSeek und OpenRouter funktionieren out-of-the-box im Browser. Anthropic nutzt den Direct-Browser-Header (`anthropic-dangerous-direct-browser-access`); für lokales Ollama muss `OLLAMA_ORIGINS="*"` gesetzt sein.

---

### Weg 2: Ohne API-Key über den Antigravity-Skill (`biobridge-local`)

Wenn du bereits ein **Antigravity-Abo** nutzt, kannst du die gesamte 5-Phasen-Pipeline **ohne externe API-Kosten** lokal über isolierte Subagenten/Swarm-Worker und die deterministische BioBridge-CLI ausführen — und das Ergebnis anschließend in der Web-App auswerten:

1. **Quellen lokal ablegen** (Ordner wird per `.gitignore` nicht gepusht):
   ```text
   quellen/
   ├── bio/       # Biologie-PDFs / DOCX / MD
   └── technik/   # Technik-PDFs / DOCX / MD
   ```
2. **In Antigravity im Projekt-Workspace starten:**
   Der Skill [`.agents/skills/biobridge-local/SKILL.md`](.agents/skills/biobridge-local/SKILL.md) wird automatisch erkannt. Beispiel-Prompt:
   ```text
   Nutze den Skill biobridge-local und führe ein Kreuzungs-Experiment durch:
   - Biologie: quellen/bio/
   - Technik: quellen/technik/
   - Name: Herz-Vortex × Ventilator
   - Cross-Model: Nutze für Phase 3 Gemini 4 Neon (High) und für Phase 4 (Advocatus Diaboli) Claude Opus 5.5 (High).
   ```
   Antigravity ruft dabei automatisch die lokale CLI (`npm run cli -- ingest`, `verify`, `build-bundle`) für Parsing, Zitatprüfung und K.O.-Regeln auf und erzeugt `runs/<slug>/experiment.biobridge.json` (plus `report.md` & `matrix.csv`).
3. **In der BioBridge-Web-App öffnen:**
   Starte `npm run dev`, klicke auf **„Importieren (.biobridge.json)“** und wähle `runs/<slug>/experiment.biobridge.json` aus.

Ausführliche Details & CLI-Referenz: [`docs/antigravity_abo_workflow.md`](docs/antigravity_abo_workflow.md)

---

## Wichtige Befehle

```bash
npm run dev                  # Lokaler Dev-Server (Vite)
npm run build                # Statischer Produktions-Build (dist/)
npm run typecheck            # TypeScript strict check
npm run lint                 # ESLint
npm test                     # Alle Unit- & Integrations-Tests (Vitest)
npm run eval -- --mock       # Offline-Kalibrierungs-Eval (4 Test-Fixtures)
npm run cli -- --help        # Lokale BioBridge-CLI (ingest / verify / build-bundle)
```

---

## Projektstruktur

- `src/core/` — Zod-Schemas, deterministische K.O.- & Scoring-Regeln, Hashing & Text-Normalisierung
- `src/ingestion/` — Lokale Parser für PDF (XY-Cut), DOCX (`OMML → LaTeX`), Markdown & Chunker
- `src/ai/`, `src/prompts/`, `src/estimation/` — Multi-Provider-Adapter (No-Web-Search-Guard), 8 editierbare Prompts & Pre-Flight-Kostenschätzer
- `src/verification/` — Deterministischer Zitat-Verifier & Self-Correction-Loop
- `src/pipeline/`, `src/workers/` — 5-Phasen-Orchestrator, Dual Crossing Engine & Web Worker
- `src/ui/` — React-19-Oberfläche (Light/Dark Mode, Setup, Bibliothek, Runner, Bewertungsmatrix, Dual-Beleg-Drawer, Prompt-Werkstatt)
- `scripts/biobridge-cli.ts` & `.agents/skills/biobridge-local/` — Lokaler CLI- & Antigravity-Skill-Workflow
- `eval/` — Kalibrierungs-Suite (`npm run eval`)
