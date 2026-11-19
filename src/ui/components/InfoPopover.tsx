import * as Popover from '@radix-ui/react-popover';
import { Info, X } from 'lucide-react';
import type { ReactNode } from 'react';

export interface InfoPopoverProps {
  title: string;
  description?: string;
  children?: ReactNode;
  ariaLabel?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

export function InfoPopover({
  title,
  description,
  children,
  ariaLabel,
  side = 'top',
  className = '',
}: InfoPopoverProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel ?? `Erklärung zu: ${title}`}
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${className}`}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-lg focus:outline-none dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-xs font-semibold tracking-wide text-slate-900 dark:text-slate-100">
              {title}
            </h4>
            <Popover.Close
              aria-label="Hinweis schließen"
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </Popover.Close>
          </div>
          {description ? (
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {description}
            </p>
          ) : null}
          {children ? (
            <div className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {children}
            </div>
          ) : null}
          <Popover.Arrow className="fill-white dark:fill-slate-900" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
