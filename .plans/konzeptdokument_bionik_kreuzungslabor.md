# Konzeptdokument: Das Bionik-Kreuzungslabor (Arbeitstitel: *BioBridge*)

## 1. Vision & Ausgangsproblem

In der Bionik (Biomimetics) entstehen echte Innovationen an der Schnittstelle zweier Welten:
* **Technology Pull:** Für ein konkretes technisches Problem wird ein biologisches Wirkprinzip gesucht und abstrahiert.
* **Biology Push:** Eine faszinierende biologische Eigenschaft wird entdeckt und auf ein neues technisches Anwendungsfeld übertragen.

In der Praxis scheitert die systematische Suche nach *neuen* bionischen Brücken heute an drei Hürden:
1. **Aufwändige, isolierte Recherche:** Biologie und Ingenieurwissenschaften sprechen völlig unterschiedliche Fachsprachen. Wer nach „hydraulischer Aktorik“ sucht, findet kaum Arbeiten über „Turgordruck-Bewegungen“ in Pflanzen.
2. **Grenzen bestehender Datenbanken:** Plattformen wie *AskNature* sind hervorragende kuratierte Bibliotheken, bilden aber überwiegend Prinzipien ab, die bereits bekannt, erforscht und oft schon technisch umgesetzt wurden.
3. **Unzuverlässigkeit moderner KI-Chats:** Allgemeine Sprachmodelle halluzinieren physikalische Zusammenhänge, erfinden Quellen und neigen zu übermäßiger Gefälligkeit (*Sycophancy*). Fragt man sie nach einer Verbindung zwischen zwei Themen, liefern sie fast immer eine gut klingende, aber technisch unbrauchbare Schein-Analogie.

### Der Lösungsansatz: „Bring Your Own Documents“ (BYOD) als Kreuzungs-Labor
Statt sofort eine riesige Suchmaschine über Millionen wissenschaftlicher Artikel aufzubauen, verfolgt dieses Konzept einen fokussierten, realistischen Ansatz: **Der Nutzer bringt seine eigenen, vertrauenswürdigen Quellen selbst mit** – beispielsweise wissenschaftliche Paper, Datenblätter oder ganze Sachbücher (PDFs) aus der Biologie und aus einer technischen Disziplin.

Die Anwendung zerlegt beide Wissensquellen unabhängig voneinander in belastbare Wirkmechanismen, sucht systematisch nach potenziellen funktionalen Brücken und unterzieht jede Idee einer **strengen, ehrlichen Gegenprüfung**. Das Ziel ist nicht, *immer* eine Lösung zu finden, sondern gezielt **Kreativität und vernetztes Denken (Bisociation)** auf einem hundertprozentig belegbaren Fundament zu fördern – und schlechte Ideen konsequent auszusortieren.

---

## 2. Methodisches Fundament

Das Werkzeug stützt sich auf zwei bewährte Konzepte aus der Innovations- und Bionikforschung:

1. **Literature-Based Discovery (Swanson-ABC-Modell):** Ein biologisches Dokument beschreibt ein System $A$ mit einem physikalischen oder organisatorischen Wirkmechanismus $B$. Ein technisches Dokument beschreibt ein Problem $C$, das nach genau einer solchen Funktion $B$ verlangt. Die Innovation liegt in der bisher ungezogenen Brücke $A \leftrightarrow B \leftrightarrow C$.
2. **Funktionale Abstraktion (inspiriert von SAPPhIRE & BioTRIZ):** Um das Fachsprachen-Problem zu lösen, vergleicht der Algorithmus nicht einfach Wörter zwischen den Dokumenten. Stattdessen übersetzt er Inhalte in eine neutrale Beschreibung aus *Struktur*, *Wirkmechanismus*, *Randbedingungen* (Skala, Medium, Energieform, Zeithorizont) und *erzieltem Effekt*.

---

## 3. Detaillierte Funktionsweise (Der 5-Phasen-Workflow)

Um Halluzinationen und schöngeredete Ergebnisse zu verhindern, arbeitet die Anwendung **nicht** mit einer einzigen KI-Abfrage, sondern als mehrstufige Prüf-Pipeline:

```text
[PDFs Biologie]                     [PDFs Technik]
       │                                   │
       ▼                                   ▼
┌─────────────────────┐             ┌─────────────────────┐
│ Phase 2:            │             │ Phase 2:            │
│ Blind-Extraktion    │             │ Blind-Extraktion    │
│ (Mechanismen+Zitate)│             │ (Probleme + Zitate) │
└──────────┬──────────┘             └──────────┬──────────┘
           │                                   │
           └─────────────────┬─────────────────┘
                             ▼
              ┌─────────────────────────────┐
              │ Phase 3: Kreuzungs-Engine   │
              │ (Ideengeber / Abstraktion)  │
              └──────────────┬──────────────┘
                             ▼
              ┌─────────────────────────────┐
              │ Phase 4: Advocatus Diaboli  │
              │ (Strenger Gutachter & K.O.) │
              └──────────────┬──────────────┘
                             ▼
              ┌─────────────────────────────┐
              │ Phase 5: Bewertungsmatrix   │
              │ (Filter, Scores & Belege)   │
              └─────────────────────────────┘
```

### Phase 1: Dokumenten-Upload & Strukturierung
Der Nutzer lädt ein oder mehrere Dokumente in zwei getrennte Bereiche:
* **Domäne A (Biologie):** z. B. ein Sachbuch über Ameisenkolonien oder fünf Fachartikel über Insektenflügel.
* **Domäne B (Technik):** z. B. ein Fachbuch über verteilte Serverarchitekturen oder Datenblätter zu Wärmetauschern.

Die Software extrahiert den Text sauber inklusive **exakter Seitenzahlen und Kapitelüberschriften** und zerlegt große Dokumente (wie Sachbücher) in thematische Abschnitte.

### Phase 2: Blind-Extraktion (Wissen sichern ohne Tunnelblick)
Die Dokumente aus Domäne A und Domäne B werden **strikt getrennt voneinander** analysiert.
* Beim Lesen der Biologie-Dokumente weiß das System noch gar nicht, womit diese später gekreuzt werden. Es extrahiert nüchtern alle realen Mechanismen: *Was passiert? Welche Struktur oder Regel bewirkt es? Unter welchen physikalischen Bedingungen? Auf welcher Seite steht der Originalbeleg?*
* Beim Lesen der Technik-Dokumente extrahiert es analog die konkreten Kernprobleme, Engpässe, Zielgrößen und Randbedingungen inklusive Seitenzahl.

**Effekt:** Das Modell kann keine erfundenen Parallelen in den Text hineininterpretieren, weil es die Gegenseite noch gar nicht kennt.

### Phase 3: Kombinatorische Kreuzung (Der Ideengeber)
Erst jetzt werden die extrahierten Listen aus Domäne A und B gegenübergestellt. Der Algorithmus (der „Ideengeber“) sucht nach funktionalen Übereinstimmungen auf abstrakter Ebene und schlägt konkrete Übertragungen vor.
* Optional steuert der Nutzer über einen **Kreativitäts-/Distanz-Regler**, wie eng oder weit die Analogien gesucht werden sollen (von *streng physikalisch übertragbar* bis *experimentell / konzeptionell*).
* Jeder Vorschlag muss exakt benennen, *welcher* extrahierte Mechanismus mit *welchem* technischen Engpass verknüpft wird.

### Phase 4: Der „Advocatus Diaboli“-Filter (Der strenge Gutachter)
Jeder generierte Vorschlag wird an eine **zweite, isolierte Prüfinstanz** weitergereicht. Diese Instanz hat die explizite Aufgabe, **die Idee zu widerlegen** und Schwachstellen aufzudecken:
* Ist das nur eine oberflächliche Metapher ohne technischen Nutzen?
* Bricht der Mechanismus bei der Übertragung auf die technische Größenordnung, Geschwindigkeit oder Materialklasse zusammen (Skalierungsproblem)?
* Ist das vorgeschlagene Prinzip in der Technik bereits ein alter Standard?
* Decken die angegebenen Originalzitate die Behauptung wirklich ab?

### Phase 5: Die interaktive Bewertungsmatrix
Das Ergebnis wird nicht als Fließtext ausgegeben, sondern als **sortier- und filterbare Matrix**.
* **Transparenz statt Blackbox:** Verworfenen Ideen wird ein klares Ablehnungslabel gegeben (standardmäßig eingeklappt oder ausgegraut, aber jederzeit einsehbar, um daraus zu lernen).
* **Dual-Beleg-Ansicht:** Klickt der Nutzer auf eine Zeile, öffnen sich links das exakte Originalzitat aus dem Biologie-Dokument (mit Seitenzahl) und rechts das Originalzitat aus dem Technik-Dokument, daneben der Abstraktionsvorschlag sowie die konkreten Gegenargumente des Gutachters.

---

## 4. Praxisbeispiel: Sachbuch „Ameisen“ × Sachbuch „Serverarchitektur“

Um zu veranschaulichen, wie die ehrliche Bewertung im Alltag arbeitet, zeigt diese Tabelle drei typische Ausgaben, die das System bei einer solchen Kreuzung erzeugen würde:

| Nr. | Vorgeschlagene Brücke | Bewertung | Status | Begründung des Gutachters (Advocatus Diaboli) |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Ameisenkönigin als Vorbild für einen zentralen Master-Node / Orchestrator** | **1 / 10** | **VERWORFEN** *(Schein-Metapher)* | Biologisch und technisch falsch. Laut Biologie-Quelle (S. 42) steuert die Königin den Staat *nicht* zentral, sondern legt Eier; die Koordination erfolgt dezentral. Zudem bringt der Vergleich keinen neuen technischen Mechanismus für Server. |
| **2** | **Pheromonspuren auf Futterwegen für dynamisches Netzwerk-Routing** | **4 / 10** | **BEKANNT** *(Geringe Neuheit)* | Funktional schlüssig und gut belegt (Biologie S. 118, Technik S. 204). Jedoch als *Ant Colony Optimization (ACO)* seit Jahrzehnten in der Informatik etabliert. Als Referenz nützlich, aber kein innovativer Ansatz. |
| **3** | **Dynamische Aufgabenverteilung durch lokale Begegnungsraten (Ernteameisen) für selbstregulierendes Autoscaling ohne zentralen Monitor** | **8 / 10** | **VIELVERSPRECHEND** *(Prüfenswert)* | Starker, formalisierbarer Mechanismus (Biologie S. 163: Arbeitsteilung passt sich rein über lokale Kontaktfrequenz an). Potenziell übertragbar auf fehlertolerante Edge-Cluster mit sporadischer Verbindung (Technik S. 311). **Offene Hürde:** Reaktionszeit bei plötzlichen Lastspitzen (Latenz-Risiko) muss simuliert werden. |

---

## 5. Die Bewertungsmatrix & Anti-Halluzinations-Regeln

Damit eine KI nicht alles mit „7 von 10 Punkten – interessante Idee!“ bewertet, erzwingt das System ein festes Schema aus **fünf Bewertungsdimensionen** und **harten K.O.-Kriterien**.

### Bewertungskategorien
1. **Mechanismus-Tiefe (0–3 Punkte):**
   * *0 (K.O.):* Reine Sprachmetapher oder poetische Ähnlichkeit.
   * *1:* Grobe konzeptionelle Inspiration ohne klares Wirkprinzip.
   * *2:* Übertragbare Funktionslogik, erfordert aber starke Anpassung.
   * *3:* Klar formalisierbares physikalisches, mathematisches oder organisatorisches Prinzip.
2. **Randbedingungen & Skalierbarkeit (0–3 Punkte):**
   * Prüft gezielt Brüche bei Größenordnung (z. B. Mikrometer vs. Meter), Medium, Energiebedarf, Fehlertoleranz oder Zeitskala. Ein unlösbarer physikalischer Widerspruch führt zur sofortigen Abwertung und einer sichtbaren **Skalierungs-Warnung**.
3. **Technischer Mehrwert (0–2 Punkte):**
   * Löst der Ansatz das Problem im Technik-Dokument tatsächlich besser (z. B. robuster, sparsamer, leichter) als klassische Standardlösungen?
4. **Neuheitsgrad (0–2 Punkte):**
   * Unterscheidet explizit zwischen *bekannten Bionik-Klassikern* (z. B. Lotuseffekt, Klettverschluss, ACO) und *unüblichen, noch wenig erforschten Übertragungen*.
5. **Belegqualität (Bestanden / K.O.):**
   * Existieren für beide Seiten wörtliche Textbelege mit Seitenangabe aus den hochgeladenen Dokumenten? Fehlt ein Beleg, wird der Vorschlag automatisch blockiert.

### Vier Schutzregeln gegen KI-Gefälligkeit (*Sycophancy*)
* **Explizite Ablehnungs-Erlaubnis:** Das System ist fest darauf eingestellt, dass in einem echten Kreuzungs-Experiment **70–90 % der getesteten Kombinationen unbrauchbar sind**. „Verworfen“ ist kein Fehler, sondern das erwünschte Standardergebnis.
* **Strukturierte Ausgabe (JSON-Zwang):** Die KI darf keine schmeichelhaften Einleitungen schreiben, sondern muss feste Datenfelder (inklusive Pflichtfeld `kritische_gegenargumente`) ausfüllen.
* **Rollen-Trennung:** Der Ideengeber und der Gutachter teilen sich keinen gemeinsamen Chatverlauf. Der Gutachter sieht nicht, wie „begeistert“ der Ideengeber war, sondern nur die nackte Hypothese plus die Originalzitate.
* **Kalibrierung mit Negativ-Tests:** Bei der Entwicklung wird das System absichtlich mit völlig unpassenden Dokumenten getestet (z. B. *Pilzsporen × Steuern sparen*). Nur wenn das System dort konsequent fast alles verwirft, ist der Filter streng genug eingestellt.

---

## 6. Grobe technische Umsetzung & Wahl des besten Formats

Die Anwendung besteht auf technischer Ebene grob aus vier Bausteinen:
1. **Benutzeroberfläche (Frontend):** Upload-Bereich für PDFs, Fortschrittsanzeige, Einstellungen (z. B. Kreativitätsgrad, Bewertungsstrenge) sowie die interaktive Bewertungsmatrix mit Exportfunktion (CSV/Markdown).
2. **Dokumenten-Aufbereitung (PDF-Parser):** Liest hochgeladene PDFs aus, bereinigt Layout-Artefakte und merkt sich zu jedem Textabschnitt die genaue Seitenzahl.
3. **Analyse-Pipeline (Logik):** Steuert die Abfolge aus *Blind-Extraktion → Kreuzung → Advocatus-Diaboli-Prüfung* und validiert, dass die KI das feste Bewertungsschema einhält.
4. **KI-Anbindung (Austauschbar):** Nutzt eine moderne, kostengünstige LLM-API (Cent-Beträge pro Buch-Kreuzung) oder optional ein lokal laufendes Sprachmodell (z. B. über *Ollama*), sodass kein teures Abo und kein eigener KI-Server nötig sind.

### Wie macht man die App für Nicht-Techniker einfach nutzbar?
Ein zentrales Ziel ist, dass Kommilitonen, Dozenten oder Freunde die Anwendung nutzen können, **ohne Python, Pakete oder Entwicklertools installieren zu müssen**. Dafür kommen vor allem drei Auslieferungsformate in Frage:

| Format / Technologie | Wie nutzen andere es? | Vorteile | Nachteile / Stolpersteine |
| :--- | :--- | :--- | :--- |
| **Option A: Reine Web-App (TypeScript + React, statisch gehostet)** | Einfach einen Link im Browser öffnen – fertig. | **Null Installation**; läuft auf Windows, Mac, Linux und Tablets; PDFs können direkt im Browser ausgelesen werden (kein eigener Server nötig, 0 € Hosting z. B. über GitHub Pages oder Cloudflare Pages); kein Virenscanner-Alarm. | Nutzer brauchen einen eigenen API-Key (*Bring Your Own Key*) oder du stellst ein kleines Backend mit eigenem Budget bereit. |
| **Option B: Leichtgewichtige Desktop-App als `.exe` / `.dmg` (Tauri: TypeScript/React + Rust)** | Eine einzelne Datei herunterladen, Doppelklick, startet wie ein normales Programm. | Sehr kleine Dateien (oft nur **10–25 MB**); arbeitet perfekt mit lokalen Dateien und lokalen KI-Modellen (*Ollama*) zusammen; modernes Web-Interface im Inneren. | Ohne kostenpflichtiges Entwickler-Zertifikat zeigt Windows beim ersten Start eine SmartScreen-Warnung („Unbekannter Herausgeber“); man muss Versionen für Windows und Mac separat bauen. |
| **Option C: Python-App verpackt als `.exe` (PyInstaller / Streamlit)** | Entpacken und `.exe` starten. | Schneller Bau, da Python im Wissenschaftsbereich stark verbreitet ist. | Oft riesige Pakete (**200–500 MB**), langsamer Start, und Windows Defender schlägt bei PyInstaller-Dateien sehr häufig Fehlalarm. Für den Versand an Laien meist frustrierend. |

### Empfehlung für Sprache & Format
Die mit Abstand zukunftssicherste und nutzerfreundlichste Wahl ist **TypeScript (mit einem modernen Web-Frontend wie React oder Svelte)**:

1. **Start als reine Browser-Anwendung (Zero-Install):** Da PDFs heute problemlos direkt im Browser (lokal auf dem Rechner des Nutzers, ohne Upload auf fremde Server!) ausgelesen werden können, brauchst du **keinen eigenen Server**. Du stellst die App kostenlos ins Netz und schickst anderen einfach einen Link.
2. **Kein Kostenrisiko durch „Bring Your Own Key“ (BYOK):** Im Einstellungsmenü der App kann jeder Nutzer seinen eigenen kostenlosen oder günstigen API-Key (z. B. für Gemini oder OpenAI) eintragen, der nur lokal im Browser gespeichert wird. So zahlst du nicht für die Nutzung anderer Leute.
3. **Nahtlose Option auf eine echte `.exe`:** Weil die gesamte Oberfläche bereits in TypeScript/Web-Technologien gebaut ist, lässt sich exakt derselbe Code bei Bedarf später mit **Tauri** in eine winzige, vollwertige Desktop-App (`.exe` für Windows / `.dmg` für macOS) verpacken – inklusive direkter Unterstützung für komplett lokale, kostenlose KI-Modelle.

---

## 7. Mögliche Ausbaustufen (Roadmap)

* **Stufe 1 – Kern-Prototyp (Kreuzungs-Labor, V1):** Multi-Dokument-Upload (PDF, Word `.docx`, Markdown `.md` — bis hin zu ganzen Sachbüchern), Pre-Flight Token- & Kostenschätzung, 5-Phasen-Pipeline mit wählbarer Matching-Strategie (Embeddings vs. Clustering), optionale Diagramm-/Formel-Analyse (inkl. LaTeX), deterministische Zitat-Verifikation mit Self-Correction, lokale Persistenz (Pause/Resume & Wiederverwendung extrahierter Wissensbasen), editierbare Systemprompts inkl. Standard-Reset, ehrliche Bewertungsmatrix mit Exportfunktion (Markdown/CSV/JSON).
* **Stufe 2 – Managed Service (Option B) & Interaktives Arbeiten:** Zuschaltbares dünnes API-Backend mit Pay-per-Use-Abrechnung (ohne eigenen API-Key nutzbar), eigene Notizen, tiefere Hypothesen-Vertiefung („Stelle drei konkrete experimentelle Tests für Hypothese #3 auf“) und optional Verpackung als Desktop-App (Tauri + Ollama).
* **Stufe 3 – Halbautomatische Literatur-Suche (Perspektive):** Anbindung an offene Wissenschafts-APIs (z. B. *OpenAlex* oder *PubMed Central*), sodass Nutzer nicht nur eigene Dokumente hochladen, sondern direkt aus der App heraus nach Open-Access-Papers suchen und diese in den Biologie- oder Technik-Slot ziehen können.

---

## 8. Festgelegte Produkt- & Architekturentscheidungen

Die folgenden Entscheidungen wurden vor Erstellung des detaillierten Softwarearchitekturplans verbindlich festgelegt und bilden die Grundlage für [architekturplan_biobridge.md](architekturplan_biobridge.md):

### 8.1 Auslieferung, API-Anbindung & späteres Bezahlmodell (Option A + Vorbereitung Option B)
* **Start als reine Client-Side Web-App (Option A):** Statisch hostbare TypeScript/React-Anwendung ohne Installationshürde, mit lokalem Parsing im Browser und *Bring Your Own Key* (BYOK).
* **Architektonische Vorbereitung auf Option B (Pay-per-Use Managed Proxy):** Die gesamte KI-Kommunikation wird hinter einem austauschbaren Transport- und Abrechnungs-Interface abstrahiert. Dadurch lässt sich später ohne Umbau der Analyse-Pipeline ein dünnes Backend (Proxy + Nutzerkonto/Credits) zuschalten, bei dem Nutzer pro Anfrage einen kleinen Betrag zahlen und keinen eigenen LLM-API-Key benötigen.

### 8.2 Dokumentformate, Multi-Dokument-Betrieb & ganze Sachbücher
* **Unterstützte Formate in V1:** PDF (`.pdf`), Word (`.docx`) und Markdown (`.md`) (optional Klartext `.txt`). Keine Freitext-Eingabe als Hauptmodus in V1, aber sauber erweiterbar.
* **Beliebige Dokumentanzahl pro Domäne:** Beide Domänen akzeptieren jeweils ein oder mehrere Dokumente — auch in asymmetrischer Anzahl (z. B. 1 Biologie-Sachbuch × 6 Technik-Paper).
* **Volle Sachbuch-Tauglichkeit ab V1:** Die Pipeline ist explizit für große Dokumentmengen und ganze Sachbücher (mehrere hundert Seiten pro Buch) ausgelegt, um echte, wenig bekannte Wirkmechanismen jenseits populärer Kurzartikel auffindbar zu machen.
* **Gemischtsprachige Quellen:** Dokumente dürfen unterschiedliche Sprachen haben (z. B. englische Paper × deutsche Sachbücher). Die Ausgabesprache der abstrahierten Analyse und Matrix ist frei wählbar; **Originalzitate verbleiben für die exakte Belegprüfung stets in der Originalsprache** (mit optionaler Übersetzungshilfe).

### 8.3 Kombinatorische Kreuzung in Phase 3 (Zwei wählbare Strategien)
* **Beide Strategien werden in V1 implementiert:**
  1. **Hybrid-Embedding-Vorauswahl:** Semantisches/funktionales Vektor-Matching auf den abstrahierten Wirkprinzipien, kombiniert mit steuerbarem Distanz-/Kreativitätsband zur Vorauswahl relevanter und überraschender Kandidatenpaare.
  2. **Thematisches Clustering + Batch-Kreuzung:** Gruppierung der extrahierten Elemente in thematische Cluster und systematische Gegenüberstellung der Cluster per LLM (weniger abhängig von Embedding-Ähnlichkeit, gut für strukturell weit entfernte Analogien).
* **Nutzerführung:** Der Nutzer wählt die Strategie selbst aus; direkt bei der Auswahl erklärt die Oberfläche kurz, präzise und ohne Fachjargon, wie beide Verfahren arbeiten und wann welches empfohlen ist.

### 8.4 PDF-Parsing, Diagramme & LaTeX-Formeln
* **Wählbare Diagramm-/Abbildungsanalyse:** Nutzer entscheiden pro Dokument/Lauf über eine klar erklärte Option, ob Abbildungen und Diagramme (via multimodaler Vision-Analyse) mit ausgewertet werden sollen oder ob eine reine Textanalyse genügt.
* **LaTeX- & Formelerkennung:** Mathematische und physikalische Formeln müssen sowohl aus Markdown/Word (inkl. Word-OMML-Formeln) als auch aus PDFs (heuristische Erkennung + optionale/gezielte Vision-Rekonstruktion kaputter PDF-Formeln) als valides LaTeX erhalten und in der UI sauber gerendert werden (KaTeX).

### 8.5 Deterministische Zitatprüfung, Self-Correction & Kontexttreue
* **Programmatische Verifikation (kein reines KI-Vertrauen):** Jedes Originalzitat wird per Code gegen den geparsten Quelltext verifiziert (inkl. Normalisierung typischer PDF-Umbrüche/Silbentrennung).
* **Self-Correction mit Ehrlichkeitspflicht:** Schlägt die deterministische Prüfung fehl, erhält das LLM einen kontrollierten Korrekturversuch mit dem entsprechenden Quellabschnitt und der expliziten Wahl: (a) das exakte, zusammenhängende Zitat korrigieren **oder** (b) transparent anerkennen, dass es sich um eine Halluzination bzw. unbelegte Behauptung handelte (was die Hypothese als zurückgezogen markiert).
* **Vollständiger Kontext statt Halbsätze:** Zitate müssen vollständige, sinnzusammenhängende Sätze bzw. kurze Absätze sein (keine isolierten Halbsätze), ergänzt um aufklappbaren Quellkontext. Eine eingebettete visuelle PDF-Seitenanzeige ist nicht erforderlich, solange der Beleg deterministisch verifiziert ist.

### 8.6 Persistenz, Resume & Wiederverwendung
* **Lokale Persistenz (IndexedDB):** Hochgeladene Dokumente, Chunks, Phase-2-Extraktionen, Embeddings, laufende Pipeline-Checkpoints und fertige Bewertungsmatrizen werden lokal im Browser gespeichert.
* **Pause/Resume & Fehlertoleranz:** Lange Buch-Analysen überstehen Seiten-Reloads, Pausen und API-Rate-Limits ohne Datenverlust.
* **Wiederverwendung extrahierter Wissensbasen:** Ein einmal extrahiertes Dokument (z. B. ein Biologie-Sachbuch) wird über seinen Inhalts-Hash gecacht und lässt sich für beliebige weitere Kreuzungen wiederverwenden, ohne Phase 2 erneut zu berechnen oder zu bezahlen.

### 8.7 KI-Modellstrategie, Epistemische Hygiene & Kein Internet-Zugriff
* **Multi-Modell-Schnittstelle:** Pro Pipeline-Rolle (Extraktion, Vision/Diagramme, Embeddings, Ideengeber, Advocatus Diaboli) können unterschiedliche Modelle und Provider konfiguriert werden — inklusive *Cross-Model-Critique* (Modell A schlägt vor, Modell B prüft).
* **Wissenschaftliches Fachwissen JA, Internet-Suche NEIN:** Die KI soll ihr trainiertes physikalisches, biologisches und technisches Verständnis aktiv für Abstraktion, Skalierungsprüfungen und Neuheitsbewertungen einsetzen, darf aber **strikt keinen Internet-Zugriff / kein Web-Search-Grounding** nutzen, um externe Biases und fremde Quellen auszuschließen.

### 8.8 Transparenz, Editierbare Systemprompts & Pre-Flight-Kostenschätzung
* **Offene, editierbare Prompts & Einstellungen:** Die Zielgruppe sind kluge, aber nicht zwingend technikaffine Nutzer. Alle Systemprompts, Kriterien-Gewichtungen und Pipeline-Parameter sind direkt in der App transparent einsehbar, verständlich dokumentiert und editierbar — geschützt gegen versehentliches Zerbrechen der technischen JSON-Ausgabe und jederzeit per 1-Klick auf den **Standard zurücksetzbar**.
* **Pre-Flight Token- & Kostenschätzung:** Unmittelbar nach Upload und lokalem Parsing — **vor dem ersten kostenpflichtigen API-Aufruf** — zeigt die App eine live aktualisierte Schätzung der erwarteten Tokens, Laufzeit und Kosten (Min / Erwartet / Max, aufgeschlüsselt nach Phasen und inklusive optionalem Budget-Stopp), sodass auch beim Hochladen mehrerer Bücher volle Kostensicherheit herrscht.

### 8.9 Kalibrierung & Evaluations-Harness
* Das Projekt erhält eine automatisierbare Evaluations-Suite mit kuratierten Testpaaren (starke Brücken, bekannte Klassiker, Schein-Metaphern und entfernte Domänenpaare). Entscheidendes Kriterium ist dabei kein dogmatisches Themenverbot, sondern **mechanistische Substanz**: Selbst bei ungewöhnlichen Domänenpaaren (z. B. Pilzsporen × Steuerrecht) sind echte strukturelle Analogien erlaubt, sofern sie formalisierbar und belegt sind — reine Sprachmetaphern und Schein-Analogien müssen jedoch zuverlässig verworfen werden.
