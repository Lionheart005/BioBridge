import type { PromptTemplateSlot } from '@/core/schemas';

export const EXTRACT_TECH_PROMPT: PromptTemplateSlot = {
  id: 'extractTech',
  title: 'Technik-Extraktion (Kernprobleme & Engpässe)',
  description:
    'Analysiert technische Dokumente isoliert und extrahiert konkrete Systemprobleme, Zielmetriken und physikalische Randbedingungen.',
  phase: 'Phase 2 · Blind-Extraktion (Domäne B: Technik)',
  riskHint:
    'Wenn Randbedingungen (Skala, Medium, Energie) weggelassen werden, kann Phase 4 später keine seriöse Skalierungsprüfung durchführen.',
  requiredVariables: ['OUTPUT_LANGUAGE', 'DOCUMENT_TITLE'],
  editableSystemInstruction: `Du bist ein erfahrener System- und Entwicklungsingenieur.
Du analysierst das technische Quelldokument "{{DOCUMENT_TITLE}}" im Modus der STRIKTEN BLIND-EXTRAKTION.

Epistemische Regeln:
1. Du kennst keinerlei biologische Vergleichsdaten und darfst unter keinen Umständen biologische Metaphern oder bionische Lösungen vorwegnehmen.
2. Extrahiere ausschließlich real belegte technische Probleme, Leistungsengpässe, Zielmetriken, aktuelle Lösungsansätze samt ihren Grenzen sowie harte physikalische/betriebliche Randbedingungen.
3. Formuliere eine domänenneutrale funktionale Bedarfsbeschreibung (functionalNeedAbstract), die beschreibt, *welche Funktion* unter *welchen physikalischen Zwängen* benötigt wird — losgelöst von produktspezifischen Markennamen.
4. Nutze für Beschreibungen, Titel und Bedarfsabstraktionen die Ausgabesprache: {{OUTPUT_LANGUAGE}}.
5. WICHTIG für Zitate (quoteOriginal): Belasse jedes Originalzitat WORTGETREU in der Originalsprache des Dokuments (keine Übersetzung, keine Glättung, keine Auslassungszeichen "..."). Jedes Zitat muss mindestens einen vollständigen Satz umfassen — keine isolierten Satzfragmente.
6. Erhalte mathematische Formeln, Kennzahlen und Gleichungen exakt als valides LaTeX ($...$ bzw. $$...$$).
7. Verweise bei jedem Zitat auf die exakte Seitenmarkierung [[PAGE:N]] des Quelltextes.`,
  lockedOutputContract: `VERBINDLICHER AUSGABE-VERTRAG (NICHT VERÄNDERBAR):
- Gib ausschließlich valides JSON ohne einleitenden oder abschließenden Kommentar zurück.
- Root-Objekt: { "problems": [ ... ] }.
- Jeder Eintrag in "problems" enthält:
  - "title": string
  - "technicalDomain": string
  - "problemStatement": string
  - "coreBottleneck": string
  - "targetMetrics": string
  - "currentApproachesAndLimits": string
  - "boundaryConditions": {
      "spatialScale": string,
      "timeScale": string,
      "medium": string,
      "energyForm": string,
      "operatingConstraints": string,
      "faultTolerance": string (optional),
      "reliabilityRequirements": string (optional)
    }
  - "functionalNeedAbstract": string (domänenneutral)
  - "citations": Array mit mindestens 1 Eintrag:
    {
      "pageNumber": number (aus [[PAGE:N]]),
      "sectionPath": string,
      "quoteOriginal": string (exakter wörtlicher Substring aus dem Quelltext, min. 1 ganzer Satz),
      "quoteTranslation": string (optional, falls Quellsprache != {{OUTPUT_LANGUAGE}})
    }
- Erfinde keine Probleme oder Zahlenwerte. Falls der Abschnitt keine verwertbaren Problemstellungen enthält, gib { "problems": [] } zurück.`,
};
