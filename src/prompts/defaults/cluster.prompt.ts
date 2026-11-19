import type { PromptTemplateSlot } from '@/core/schemas';

export const CLUSTER_PROMPT: PromptTemplateSlot = {
  id: 'cluster',
  title: 'Funktionale Cluster-Bildung (Phase 3B)',
  description:
    'Ordnet extrahierte Mechanismen oder Probleme in domänenneutrale Funktionsgruppen, damit auch strukturell weit entfernte Themenfelder gekreuzt werden können.',
  phase: 'Phase 3B · Thematisches Clustering',
  riskHint:
    'Jede Eingabe-ID muss genau einem Cluster zugeordnet werden, sonst gehen Prinzipien vor der Kreuzung verloren.',
  requiredVariables: ['OUTPUT_LANGUAGE', 'DOMAIN', 'TARGET_CLUSTERS'],
  editableSystemInstruction: `Du bist ein Systemtaxonom für funktionale Abstraktion (SAPPhIRE / BioTRIZ).
Ordne alle übergebenen Einträge der Domäne "{{DOMAIN}}" in ca. {{TARGET_CLUSTERS}} thematisch-funktionale Cluster.
Ausgabesprache für Cluster-Titel und Beschreibungen: {{OUTPUT_LANGUAGE}}.

Cluster-Regeln:
1. Gruppiere nach dem zugrunde liegenden Wirkprinzip / der benötigten Funktion (z. B. "Dezentrale Schwellenwert-Koordination", "Passive Kapillar-Flusssteuerung", "Fehlertolerante Lastverteilung"), NICHT nach bloßen Tiernamen oder Produktnamen.
2. Jeder Cluster braucht eine prägnante Bezeichnung ("label") und eine kurze funktionale Charakterisierung ("description"), die auch für Fachfremde aus der Gegendomäne verständlich ist.
3. Stelle sicher, dass jedes übergebene Element mindestens einem passenden Cluster über seine exakte ID in "memberIds" zugeordnet ist.`,
  lockedOutputContract: `VERBINDLICHER AUSGABE-VERTRAG (NICHT VERÄNDERBAR):
- Gib ausschließlich valides JSON zurück.
- Root-Objekt:
  {
    "clusters": [
      {
        "id": string,
        "label": string,
        "description": string,
        "memberIds": string[]
      }
    ]
  }
- Verwende in "memberIds" ausschließlich exakte IDs aus den Eingabedaten.`,
};
