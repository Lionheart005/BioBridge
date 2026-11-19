import type { PromptTemplateSlot } from '@/core/schemas';

export const CITATION_REPAIR_PROMPT: PromptTemplateSlot = {
  id: 'citationRepair',
  title: 'Zitat-Korrektur & Halluzinations-Prüfung',
  description:
    'Wird automatisch aufgerufen, wenn ein Zitat im Quelltext nicht gefunden wurde. Lässt dem Modell nur die ehrliche Wahl zwischen exaktem Originalzitat und Eingeständnis einer Halluzination.',
  phase: 'Phase 2 / 4 · Self-Correction-Loop',
  riskHint:
    'Die Option RETRACT_HALLUCINATION darf niemals entfernt werden, da das Modell sonst falsche Zitate durch Umformulierungen zu retten versucht.',
  requiredVariables: ['FAILED_QUOTE', 'FAILURE_REASON'],
  editableSystemInstruction: `Das folgende von dir gelieferte Zitat konnte in der deterministischen Quelltext-Prüfung NICHT verifiziert werden:
- Fehlerhaftes Zitat: "{{FAILED_QUOTE}}"
- Fehlergrund: "{{FAILURE_REASON}}"

Dir liegt nun der tatsächliche Original-Quelltext dieses Abschnitts vor. Du hast genau zwei strikte Optionen:
1. "CORRECT_QUOTE": Falls die Aussage im vorliegenden Original-Quelltext tatsächlich belegt ist, liefere einen EXAKTEN, unveränderten, zusammenhängenden Substring aus diesem Quelltext (mindestens 1 vollständiger grammatikalischer Satz, keine Auslassungszeichen "...", keine Übersetzung, keine Paraphrase) inklusive passender Seitenzahl.
2. "RETRACT_HALLUCINATION": Falls der Quelltext diese Aussage so NICHT trägt oder du sie versehentlich hinzugedichtet bzw. fehlinterpretiert hast, gib ehrlich "RETRACT_HALLUCINATION" zurück und begründe kurz, was gefehlt hat.

Ehrlichkeit hat oberste Priorität: Erfinde niemals ein Ersatzzitat.`,
  lockedOutputContract: `VERBINDLICHER AUSGABE-VERTRAG (NICHT VERÄNDERBAR):
- Gib ausschließlich valides JSON zurück.
- Schema:
  {
    "decision": "CORRECT_QUOTE" | "RETRACT_HALLUCINATION",
    "correctedQuoteOriginal": string (Pflicht bei CORRECT_QUOTE: exakter Substring aus dem vorliegenden Quelltext, min. 1 ganzer Satz),
    "pageNumber": number (Pflicht bei CORRECT_QUOTE),
    "retractionReason": string (Pflicht bei RETRACT_HALLUCINATION)
  }`,
};
