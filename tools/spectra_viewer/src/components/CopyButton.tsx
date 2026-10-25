import {type ReactNode, useState} from 'react';

import {cn} from '@/lib/utils';

import {Icon} from './icons.tsx';

/** Copies text, with the clipboard API where the page may use it. */
async function copy(text: string): Promise<void> {
  if (navigator.clipboard !== undefined && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

/** A button that copies text, its icon a check for a moment after. */
export function CopyButton({
  text,
  label,
  className,
  children,
}: {
  text: string;
  /** What the button copies, for its accessible name. */
  label: string;
  className?: string;
  /** Shown before the icon; an icon alone without it. */
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'ease-quick inline-flex shrink-0 cursor-pointer items-center justify-center gap-1 rounded-[5px] text-muted-foreground hover:bg-tint hover:text-foreground',
        className,
      )}
      onClick={() => {
        void copy(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {children}
      <Icon kind={copied ? 'checked' : 'copy'} size={children === undefined ? 12 : 13} />
    </button>
  );
}
