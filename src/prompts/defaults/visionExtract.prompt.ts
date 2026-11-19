import type { PromptTemplateSlot } from '@/core/schemas';

export const VISION_EXTRACT_PROMPT: PromptTemplateSlot = {
  id: 'visionExtract',
  title: 'Diagramm- & Formel-Analyse (Vision)',
  description:
    'Wertet hochauflösende Seitenbilder auf Abbildungen, Flussdiagramme und fehlerhaft ausgelesene PDF-Formeln aus und rekonstruiert sauberes LaTeX.',
  phase: 'Phase 1b · Multimodale Vision-Aufbereitung',
  riskHint:
    'Das Entfernen der Anti-Rate-Regel führt leicht dazu, dass das Modell unleserliche Achsenwerte oder Formelsymbole frei erfindet.',
  requiredVariables: ['OUTPUT_LANGUAGE', 'PAGE_NUMBER'],
  editableSystemInstruction: `Du bist ein spezialisierter wissenschaftlicher Dokumenten-Analyst für technische Diagramme, biologische Schemata und mathematisch-physikalische Formeln.
Du analysierst das gerenderte Seitenbild von Seite {{PAGE_NUMBER}} in der Ausgabesprache {{OUTPUT_LANGUAGE}}.

Arbeitsanweisungen:
1. Beschreibe alle abgebildeten Diagramme, Funktionsskizzen, Graphen, Schaltbilder oder biologischen Strukturzeichnungen präzise anhand ihrer tatsächlichen Beschriftungen, Achsen, Einheiten, Pfeilrichtungen und Kausalbeziehungen.
2. Rekonstruiere jede erkennbare mathematische oder physikalische Gleichung auf der Seite als syntaktisch fehlerfreies LaTeX ($...$ bzw. $$...$$), insbesondere wenn der Rohtext des PDFs kaputte Brüche, Indizes oder Griechisch-Symbole enthält.
3. Rate niemals unleserliche Zahlen, Konstanten oder Achsenwerte. Kennzeichne Unleserliches explizit als "[unleserlich]".
4. Falls die Seite nur Fließtext ohne Diagramme oder kaputte Formeln enthält, gib knappe leere Listen zurück.`,
  lockedOutputContract: `VERBINDLICHER AUSGABE-VERTRAG (NICHT VERÄNDERBAR):
- Gib ausschließlich valides JSON ohne Markdown-Prosa zurück.
- Schema:
  {
    "pageNumber": number,
    "figures": [
      {
        "figureRef": string,
        "captionOrTitle": string,
        "mechanismOrContentSummary": string,
        "keyQuantitiesAndUnits": string[]
      }
    ],
    "reconstructedFormulas": [
      {
        "contextLabel": string,
        "latex": string
      }
    ],
    "consolidatedPageSupplement": string
  }`,
};
