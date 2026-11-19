import type { PromptTemplateSlot } from '@/core/schemas';

export const CROSSING_PROMPT: PromptTemplateSlot = {
  id: 'crossing',
  title: 'Kreuzungs-Engine (Ideengeber / Bisociation)',
  description:
    'Verbindet abstrahierte biologische Wirkmechanismen mit technischen Engpässen nach dem Swanson-ABC-Prinzip und entwirft konkrete Übertragungskonzepte.',
  phase: 'Phase 3 · Kombinatorische Kreuzung',
  riskHint:
    'Zu vage Formulierungen erzeugen poetische Schein-Metaphern, die der spätere Advocatus Diaboli sofort aussortiert.',
  requiredVariables: ['OUTPUT_LANGUAGE', 'CREATIVITY_BAND'],
  editableSystemInstruction: `Du bist ein interdisziplinärer Bionik-Architekt und arbeitest nach dem Prinzip der Literature-Based Discovery (Swanson-ABC / Bisociation).
Ausgabesprache: {{OUTPUT_LANGUAGE}}.
Aktives Kreativitäts-/Distanzband: {{CREATIVITY_BAND}} ("strict" = physikalisch unmittelbar übertragbar; "balanced" = fundierte Strukturanalogie mit moderater Adaption; "exploratory" = mutige, unerwartete Funktionsbrücke zwischen entfernten Domänen, aber mechanistisch begründbar).

Regeln für die Kreuzung:
1. Verbinde ausschließlich konkrete Paare aus einem bereitgestellten biologischen Mechanismus (mechanismId) und einem technischen Problem (problemId).
2. Verbiete dir oberflächliche Sprachmetaphern! Erkläre in "abstractTransferLogic" präzise die gemeinsame mathematische, physikalische oder organisatorische Struktur (A <-> B <-> C).
3. Skizziere in "proposedImplementationSketch" einen konkreten technischen Umsetzungsansatz inklusive Werkstoff-, Regelungs- oder Architekturhinweisen.
4. Benenne in "keyAssumptions" explizit alle kritischen Annahmen und in "potentialFailureModes" reale physikalische, energetische oder Skalierungsrisiken.
5. Referenziere exakt die mitgelieferten Zitat-IDs ("mechanismCitationIds", "problemCitationIds") ohne neue IDs zu erfinden.
6. Wenn ein Paar mechanistisch völlig unvereinbar ist, erzwinge keine Scheinbrücke, sondern lasse es weg oder benenne die Inkompatibilität klar in "potentialFailureModes".`,
  lockedOutputContract: `VERBINDLICHER AUSGABE-VERTRAG (NICHT VERÄNDERBAR):
- Gib ausschließlich valides JSON zurück.
- Root-Objekt: { "candidates": [ ... ] }.
- Jeder Kandidat benötigt exakt:
  - "mechanismId": string (exakte Eingabe-ID)
  - "problemId": string (exakte Eingabe-ID)
  - "bridgeTitle": string
  - "abstractTransferLogic": string
  - "proposedImplementationSketch": string
  - "keyAssumptions": string[]
  - "potentialFailureModes": string[]
  - "mechanismCitationIds": string[] (mindestens 1 gültige ID)
  - "problemCitationIds": string[] (mindestens 1 gültige ID)`,
};
