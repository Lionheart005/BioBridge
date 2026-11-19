import {
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { CitationVerification, VerificationStatus } from '@/core/schemas';

export interface CitationBadgeProps {
  verification: CitationVerification;
  className?: string;
}

interface StatusVisualConfig {
  label: string;
  classes: string;
  icon: typeof CheckCircle2;
}

const STATUS_CONFIG: Record<VerificationStatus, StatusVisualConfig> = {
  VERIFIED_EXACT: {
    label: 'Exakt belegt',
    classes:
      'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/80',
    icon: CheckCircle2,
  },
  VERIFIED_NORMALIZED: {
    label: 'Normalisiert belegt',
    classes:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/80',
    icon: CheckCircle2,
  },
  VERIFIED_FUZZY: {
    label: 'Ähnlich belegt',
    classes:
      'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/80',
    icon: Sparkles,
  },
  CORRECTED_VERIFIED: {
    label: 'Korrigiert & belegt',
    classes:
      'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/80',
    icon: AlertTriangle,
  },
  RETRACTED_HALLUCINATION: {
    label: 'Zurückgezogen',
    classes:
      'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/80',
    icon: ShieldAlert,
  },
  FAILED_UNVERIFIED: {
    label: 'Unbelegt (K.O.)',
    classes:
      'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/80',
    icon: XCircle,
  },
};

export function CitationBadge({
  verification,
  className = '',
}: CitationBadgeProps) {
  const cfg = STATUS_CONFIG[verification.status];
  const Icon = cfg.icon;
  const scorePct = Math.round(verification.matchScore * 100);
  const attemptsLabel =
    verification.attempts === 1 ? '1 Versuch' : `${verification.attempts} Versuche`;
  const reasonSuffix = verification.retractionReason
    ? ` • Grund: ${verification.retractionReason}`
    : '';
  const tooltipText = `${cfg.label} • Übereinstimmung: ${scorePct}% • Seite ${verification.matchedPageNumber} • ${attemptsLabel}${reasonSuffix}`;

  return (
    <span
      title={tooltipText}
      aria-label={tooltipText}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${cfg.classes} ${className}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{cfg.label}</span>
      <span className="text-[11px] opacity-75">({scorePct}%)</span>
    </span>
  );
}
