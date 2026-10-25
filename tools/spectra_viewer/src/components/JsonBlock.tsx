import {type ReactNode, useMemo, useState} from 'react';

import {jsonLines} from '@/model/json_lines.ts';

import {CopyButton} from './CopyButton.tsx';
import {Icon} from './icons.tsx';

/** A labelled block of JSON on one tinted block, with a copy button and each object and array foldable. */
export function JsonBlock({label, value, meta}: {label: string; value: unknown; meta?: ReactNode}) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const lines = useMemo(() => jsonLines(value, folded), [value, folded]);
  const toggle = (path: string) => {
    const next = new Set(folded);
    if (!next.delete(path)) next.add(path);
    setFolded(next);
  };
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <BlockLabel label={label} meta={meta}>
        <CopyButton
          text={JSON.stringify(value, null, 2)}
          label={`Copy the ${label.toLowerCase()}`}
          className="h-[22px] px-1.5 text-xs"
        >
          Copy
        </CopyButton>
      </BlockLabel>
      <div className="overflow-x-auto rounded-lg bg-tint py-2 font-mono text-xs leading-[1.6]">
        {lines.map((line, index) => (
          <div key={index} className="flex w-max min-w-full pr-3 pl-1 whitespace-pre">
            <span className="flex w-[18px] shrink-0 items-center justify-center">
              {line.fold !== undefined && (
                <button
                  type="button"
                  aria-label={line.folded ? 'Unfold' : 'Fold'}
                  aria-expanded={!line.folded}
                  onClick={() => toggle(line.fold!)}
                  className="flex size-4 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-border hover:text-foreground"
                >
                  <Icon kind={line.folded ? 'chevronRight' : 'chevronDown'} size={11} />
                </button>
              )}
            </span>
            <span>{line.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** A block's label in small capitals, with what sits on its right. */
export function BlockLabel({
  label,
  meta,
  children,
}: {
  label: string;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-[22px] items-center gap-2">
      <span className="section-label">{label}</span>
      {meta !== undefined && <span className="text-xs text-muted-foreground">{meta}</span>}
      <div className="flex-1" />
      {children}
    </div>
  );
}
