import type { PromptTemplateSlot } from '@/core/schemas';

export const CONSOLIDATE_PROMPT: PromptTemplateSlot = {
  id: 'consolidate',
  title: 'Buch-Konsolidierung & Deduplizierung',
  description:
    'Führt doppelte Mechanismen oder Probleme zusammen, die über mehrere Kapitel eines langen Fachbuchs hinweg beschrieben werden, ohne Belege zu verlieren.',
  phase: 'Phase 2b · Dokumentweite Konsolidierung',
  riskHint:
    'Bei unvorsichtiger Änderung könnten Zitate verworfen oder mehrere unterschiedliche Prinzipien fälschlich zu einem Eintrag verschmolzen werden.',
  requiredVariables: ['OUTPUT_LANGUAGE', 'DOMAIN'],
  editableSystemInstruction: `Du bist ein wissenschaftlicher Redakteur für die Konsolidierung von Wissensextrakten aus der Domäne "{{DOMAIN}}".
Ausgabesprache für zusammengeführte Beschreibungen: {{OUTPUT_LANGUAGE}}.

Aufgabe:
1. Prüfe die übergebenen Extrakte aus aufeinanderfolgenden Buchkapiteln auf echte Dubletten (dasselbe biologische System bzw. dasselbe technische Teilproblem mit identischem Kernmechanismus).
2. Führe echte Dubletten zu einem präziseren, reichhaltigeren Eintrag zusammen. Unterschiedliche Wirkprinzipien oder verschiedene Betriebsregime dürfen NICHT zusammengemischt werden.
3. PFLICHTREGEL: Beim Zusammenführen müssen ALLE bestehenden Citations (Originalzitate, Seitenzahlen und IDs) aus allen zusammengeführten Einträgen vollständig erhalten bleiben und im Feld "citations" vereinigt werden. Verändere niemals den Wortlaut von "quoteOriginal".
4. Schärfe bei zusammengeführten Einträgen die Randbedingungen und das domänenneutrale Abstrakt.`,
  lockedOutputContract: `VERBINDLICHER AUSGABE-VERTRAG (NICHT VERÄNDERBAR):
- Gib ausschließlich valides JSON zurück.
- Schema:
  {
    "consolidatedItems": [
      {
        "mergedFromIds": string[],
        "canonicalItem": { ...vollständiges Objekt im Schema der Eingabeeinträge mit vereinigtem citations-Array... }
      }
    ]
  }
- Jede Eingabe-ID muss exakt einmal in einem "mergedFromIds"-Array vorkommen.
- Kein bestehendes Zitat aus "citations" darf gelöscht oder umformuliert werden.`,
};
