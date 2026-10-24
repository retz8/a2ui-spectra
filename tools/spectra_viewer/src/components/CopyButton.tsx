import {CheckIcon, CopyIcon} from 'lucide-react';
import {useState} from 'react';

import {Button} from '@/components/ui/button.tsx';

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

export function CopyButton({text, label}: {text: string; label: string}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      title={label}
      aria-label={label}
      onClick={() => {
        void copy(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}
